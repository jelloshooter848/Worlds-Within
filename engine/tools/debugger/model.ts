import {
  canonicalJson,
  type HeadlessGame,
  type HeadlessOptions,
  type JsonObject,
  type JsonValue,
  type WorldEvents,
} from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { stateHash } from '@engine/core/state-hash';
import { compressClock, type Change, type ClockEntry, type Timeline } from '@engine/sim/index';
import { failsCheck, valueAt } from '../check-values';
import { filterChanges, type EventFilter } from '../event-filter';
import type { DebugCheck, DebugRunJob, ExpectedHash, StoredFailure } from './job';

/**
 * The debugger's model (Engine 0.14 T10; docs/BUILD-LOG.md, Engine 0.14, decision 2): loading a
 * run job, stepping it, rewinding it and diffing its states, with no DOM and no Node, so the page
 * uses it and Node tests check it against the run's golden hashes.
 *
 * **Stepping is the run played as `pnpm cli run` plays it**: the game is created from the content
 * and seed the job names (with its `from` save, `start` and switched-off rules), and each step
 * hands over that tick's recorded orders, then its mission steps, then steps the game with the
 * run's scripted input. **Rewinding re-simulates from tick 0**: going back builds a fresh game and
 * steps it to the tick asked for. With the cache on (the default) every tick's record (snapshot,
 * hash, checks) is kept once made, so a rewind only steps the game and the panels read the
 * records; the fresh game's hash at the tick it lands on is still compared with the record, so a
 * game that does not replay the same is caught (a `rewind` mismatch). With the cache off every
 * record is made again (the tests use it to prove the re-simulation alone gives the run's hashes).
 *
 * Every record's hash is compared with the job's expected hashes at that tick (the golden file,
 * the run file's sync hashes, a replay's): the first that differs is the session's `mismatch` and
 * stepping stops there, since what the page shows past it is not the run. A second game (the view,
 * which draws the picture) can be stepped alongside; its hash is compared at every tick shown (a
 * `view` mismatch).
 */

/** One tick's record: the snapshot, its hash, the world tick and the checks that failed there. */
export interface TickRecord {
  tick: number;
  hash: string;
  state: JsonObject;
  /** The world tick at this game tick (null for a game with no world hooks). */
  worldTick: number | null;
  /** The checks that failed at this tick (invariants, and the assertions of this tick). */
  failed: CheckResult[];
}

/** A check made at one tick. */
export interface CheckResult extends DebugCheck {
  passed: boolean;
  /** The value at the path (null when it is not in the snapshot). */
  actual: JsonValue | null;
  /** Why it failed, or null. */
  message: string | null;
}

/** An assertion's status: made at its tick (passed or not) or not reached yet. */
export interface AssertionStatus extends DebugCheck {
  status: 'passed' | 'failed' | 'pending';
}

/**
 * Something that is not the run: a stored hash that differs (`stored`), a rewind that landed on a
 * different state than the first time (`rewind`), or the view's state differing from the headless
 * game's (`view`).
 */
export interface DebugMismatch {
  tick: number;
  kind: 'stored' | 'rewind' | 'view';
  expected: string;
  actual: string;
  /** For `stored`: where the expected hash came from. */
  source?: ExpectedHash['source'];
}

/** A tick's stored hash compared with the page's. */
export interface HashRow extends ExpectedHash {
  /** The hash the session gave at that tick, or null when it has not been there. */
  actual: string | null;
  matches: boolean | null;
}

/** An order or mission step the game refused (reported, as `run` reports them). */
export interface Refusal {
  tick: number;
  kind: 'order' | 'mission';
  error: string;
}

/** One difference between two states, at a dotted path. */
export interface StateDiff {
  path: string;
  op: 'add' | 'remove' | 'change';
  before?: JsonValue;
  after?: JsonValue;
}

/**
 * A replay's stored failure as the session found it (Engine 0.14 T11): `reached` once the session
 * has played to its tick; then `actual` is the value at its path there and `reproduced` whether
 * the same check (kind, path, op, expected) failed at that tick. `reproduced` is null before the
 * tick is reached and for a `code` check (a save code, which the page does not check).
 */
export interface FailureReading extends StoredFailure {
  reached: boolean;
  actual: JsonValue | null;
  /** The page's message for the check at that tick (null when it passed or was not made). */
  pageMessage: string | null;
  reproduced: boolean | null;
  /** The tick before the failure (to step from), or null for a failure at tick 0. */
  tickBefore: number | null;
}

export interface SessionOptions<V extends HeadlessGame> {
  /** Keep every tick's record (default true). */
  cache?: boolean;
  /** A second game stepped alongside (the view module's, for the picture). */
  makeView?: () => V;
}

/** The options a job's game is created with, as `pnpm cli run` creates it. */
export function headlessOptions(job: DebugRunJob): HeadlessOptions {
  return {
    disabledRules: job.disabledRules,
    disabledRulesByKit: job.disabledRulesByKit,
    ...(job.campaign === null ? {} : { campaign: job.campaign }),
    ...(job.start === null ? {} : { start: job.start }),
  };
}

/** A plain copy of a JSON value, so two games never share an entry. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Steps a run job's game forward and back; see the file comment. */
export class DebugSession<V extends HeadlessGame = HeadlessGame> {
  /** How many times the game was built again from tick 0 (a rewind). */
  rebuilds = 0;
  private game!: HeadlessGame;
  private viewGame: V | null = null;
  private input!: ScriptedInput;
  private at = 0;
  private nextOrder = 0;
  private nextMission = 0;
  private refusalList: Refusal[] = [];
  private readonly records = new Map<number, TickRecord>();
  /** The record of the tick shown and of the tick before it (kept with the cache off too). */
  private shown!: TickRecord;
  private before: TickRecord | null = null;
  /** Failed checks by tick and assertion results by index: small, kept with the cache off too. */
  private readonly failedAt = new Map<number, CheckResult[]>();
  private readonly assertionResults = new Map<number, boolean>();
  private readonly expectedAt = new Map<number, ExpectedHash[]>();
  /** The hashes this session gave at expected ticks, kept with the cache off too. */
  private readonly seenHashes = new Map<number, string>();
  private firstMismatch: DebugMismatch | null = null;
  private readonly cache: boolean;
  /** The world tick at every game tick reached (the timeline's clock), kept with the cache off too. */
  private readonly worldTicks: number[] = [];
  /** The furthest tick reached so far. */
  private furthest = 0;

  constructor(
    readonly job: DebugRunJob,
    private readonly make: () => HeadlessGame,
    private readonly opts: SessionOptions<V> = {},
  ) {
    this.cache = opts.cache ?? true;
    for (const e of job.expected) this.expectedAt.set(e.tick, [...(this.expectedAt.get(e.tick) ?? []), e]);
    this.build();
    this.shown = this.recordNow();
    this.checkView();
  }

  /** The tick shown (the game's tick). */
  get tick(): number {
    return this.at;
  }

  /** The run's last tick. */
  get ticks(): number {
    return this.job.ticks;
  }

  /** The first thing found that is not the run, or null. Stepping stops at its tick. */
  get mismatch(): DebugMismatch | null {
    return this.firstMismatch;
  }

  /** The view game stepped alongside, at the tick shown, or null. */
  get view(): V | null {
    return this.viewGame;
  }

  /** The orders and mission steps the game refused on the way to the tick shown. */
  get refusals(): readonly Refusal[] {
    return this.refusalList;
  }

  /** The state hash at the tick shown. */
  hash(): string {
    return this.shown.hash;
  }

  /** The snapshot at the tick shown (do not change it). */
  state(): JsonObject {
    return this.shown.state;
  }

  /** The record at the tick shown. */
  record(): TickRecord {
    return this.shown;
  }

  /** A cached tick's record (the cache on), or the shown or previous tick's; else undefined. */
  recordAt(tick: number): TickRecord | undefined {
    if (tick === this.shown.tick) return this.shown;
    if (tick === this.before?.tick) return this.before;
    return this.records.get(tick);
  }

  /** Steps `n` ticks forward (default 1), stopping at the last tick or a mismatch; returns the tick. */
  step(n = 1): number {
    if (!Number.isInteger(n) || n < 0) throw new Error(`step(n): n must be a whole number >= 0, got ${n}`);
    return this.goto(this.at + n);
  }

  /**
   * Goes to `tick` (clamped to 0 to the last tick, and to a mismatch's tick): forward by stepping,
   * back by building the game again and stepping from tick 0. Returns the tick reached.
   */
  goto(tick: number): number {
    if (!Number.isInteger(tick)) throw new Error(`goto(tick): tick must be a whole number, got ${tick}`);
    let target = Math.max(0, Math.min(tick, this.job.ticks));
    if (this.firstMismatch !== null) target = Math.min(target, this.firstMismatch.tick);
    if (target === this.at) return this.at;
    if (target < this.at) {
      this.build();
      this.rebuilds++;
      this.before = null;
      const cached = this.records.get(0);
      this.shown = this.recordNow();
      if (cached !== undefined && cached.hash !== this.shown.hash)
        this.noteMismatch({ tick: 0, kind: 'rewind', expected: cached.hash, actual: this.shown.hash });
    }
    while (this.at < target) {
      this.advance();
      const last = this.at === target;
      // A rewind's ticks are in the cache: only the tick before the target and the target itself
      // need a record, and the target's is made again to check the game replays the same.
      if (last || this.at === target - 1 || !this.records.has(this.at)) {
        const cached = this.records.get(this.at);
        const fresh = last || cached === undefined ? this.recordNow() : cached;
        if (cached !== undefined && fresh.hash !== cached.hash)
          this.noteMismatch({ tick: this.at, kind: 'rewind', expected: cached.hash, actual: fresh.hash });
        this.before = this.shown;
        this.shown = fresh;
      }
      if (this.firstMismatch !== null && this.at >= this.firstMismatch.tick) break;
    }
    this.checkView();
    return this.at;
  }

  /** The checks at the tick shown: every invariant, and the assertions of this tick. */
  checks(): CheckResult[] {
    return this.checksOn(this.shown.state, this.at);
  }

  /** Every assertion with its status: made at its tick (on this session's way there) or pending. */
  assertions(): AssertionStatus[] {
    return this.job.checks
      .filter((c) => c.kind === 'assertion')
      .map((c) => {
        const passed = this.assertionResults.get(c.index);
        return { ...c, status: passed === undefined ? 'pending' : passed ? 'passed' : 'failed' };
      });
  }

  /** The ticks reached so far where a check failed, in tick order. */
  failedTicks(): number[] {
    return [...this.failedAt.keys()].sort((a, b) => a - b);
  }

  /** Every expected hash with the hash this session gave at its tick (null when not reached). */
  hashRows(): HashRow[] {
    return this.job.expected.map((e) => {
      const actual = this.recordAt(e.tick)?.hash ?? this.seenHashes.get(e.tick) ?? null;
      return { ...e, actual, matches: actual === null ? null : actual === e.hash };
    });
  }

  /**
   * The world's kept event log now, filtered (world ticks, entity, cause, component), with the
   * log's `from` and the world tick; null for a game with no world hooks.
   */
  events(filter: EventFilter = {}): { from: number; tick: number; changes: Change[] } | null {
    const log = this.worldLog(filter.from ?? 0);
    if (log === null) return null;
    return { from: log.from, tick: log.tick, changes: filterChanges(log.changes as Change[], filter) };
  }

  /**
   * The changes of the world ticks the last step covered: the previous tick's world tick to the
   * world tick now, both included (at tick 0, every change up to now); null for a game with no
   * world hooks. While a played round holds the world still, that is the one world tick it stands at.
   */
  stepEvents(filter: Omit<EventFilter, 'from' | 'to'> = {}): Change[] | null {
    const now = this.shown.worldTick;
    if (now === null) return null;
    const from = this.at === 0 ? 0 : this.before?.tick === this.at - 1 ? (this.before.worldTick ?? 0) : now;
    return this.events({ ...filter, from, to: now })?.changes ?? [];
  }

  /**
   * The timeline record at the tick shown (the game's `timeline()` hook, Engine 0.14 T7) with its
   * `clock` filled from the world tick at every game tick from 0 to the tick shown, as the tools
   * fill it (`compressClock`); null for a game with no world hooks.
   */
  timeline(): Timeline | null {
    const raw = this.game.timeline?.();
    if (raw === undefined) return null;
    const samples: ClockEntry[] = [];
    for (let game = 0; game <= this.at; game++) {
      const world = this.worldTicks[game];
      if (world === undefined) return { ...(raw as unknown as Timeline), clock: null };
      samples.push({ game, world });
    }
    return { ...(raw as unknown as Timeline), clock: compressClock(samples) };
  }

  /** A replay's stored failure as this session found it, or null for a job with none. */
  failure(): FailureReading | null {
    const f = this.job.failure;
    if (f === null) return null;
    const reached = this.furthest >= f.tick;
    const base = { ...f, reached, tickBefore: f.tick > 0 ? f.tick - 1 : null };
    const check = this.job.checks.find(
      (c) =>
        c.kind === f.kind &&
        c.path === f.path &&
        c.op === f.op &&
        canonicalJson(c.value) === canonicalJson(f.expected) &&
        (c.kind === 'invariant' || c.tick === f.tick),
    );
    if (!reached || check === undefined)
      return {
        ...base,
        actual: null,
        pageMessage: null,
        reproduced: reached && f.kind !== 'code' ? false : null,
      };
    const failed = (this.failedAt.get(f.tick) ?? []).find(
      (c) => c.kind === check.kind && c.index === check.index,
    );
    if (failed !== undefined)
      return { ...base, actual: failed.actual, pageMessage: failed.message, reproduced: true };
    // Passed there: read the value it saw from the record, when that tick's record is kept.
    const state = this.recordAt(f.tick)?.state;
    const value = state === undefined ? null : valueOrNull(state, f.path);
    return { ...base, actual: value, pageMessage: null, reproduced: false };
  }

  /** The differences between the tick shown and the tick before it (empty at tick 0). */
  diff(limit = 500): StateDiff[] {
    if (this.before === null || this.before.tick !== this.at - 1) return [];
    return diffStates(this.before.state, this.shown.state, limit);
  }

  private build(): void {
    this.game = this.make();
    this.viewGame = this.opts.makeView?.() ?? null;
    this.input = new ScriptedInput(this.job.input);
    this.at = 0;
    this.nextOrder = 0;
    this.nextMission = 0;
    this.refusalList = [];
  }

  /** One step from tick `at`, as `pnpm cli run` takes it. */
  private advance(): void {
    const tick = this.at;
    const { orders, missions } = this.job;
    for (; this.nextOrder < orders.length && orders[this.nextOrder]!.tick === tick; this.nextOrder++) {
      const { tick: _tick, ...order } = orders[this.nextOrder]!;
      const error = this.game.order?.(copy(order)) ?? null;
      this.viewGame?.order?.(copy(order));
      if (error !== null) this.refusalList.push({ tick, kind: 'order', error });
    }
    for (
      ;
      this.nextMission < missions.length && missions[this.nextMission]!.tick === tick;
      this.nextMission++
    ) {
      const { tick: _tick, ...step } = missions[this.nextMission]!;
      const refused = this.game.mission?.(copy(step)) ?? null;
      this.viewGame?.mission?.(copy(step));
      if (refused !== null)
        this.refusalList.push({ tick, kind: 'mission', error: `${refused.code}: ${refused.error}` });
    }
    this.input.next();
    this.game.step(this.input);
    this.viewGame?.step(this.input);
    this.at++;
  }

  /** The record of the tick now, made fresh (and cached with the cache on). */
  private recordNow(): TickRecord {
    const state = this.game.snapshot();
    const hash = stateHash(state);
    const checks = this.checksOn(state, this.at);
    const failed = checks.filter((c) => !c.passed);
    for (const c of checks) if (c.kind === 'assertion') this.assertionResults.set(c.index, c.passed);
    if (failed.length > 0) this.failedAt.set(this.at, failed);
    else this.failedAt.delete(this.at);
    const log = this.worldLog(Number.MAX_SAFE_INTEGER);
    const record: TickRecord = { tick: this.at, hash, state, worldTick: log?.tick ?? null, failed };
    if (log !== null) this.worldTicks[this.at] = log.tick;
    this.furthest = Math.max(this.furthest, this.at);
    for (const e of this.expectedAt.get(this.at) ?? []) {
      this.seenHashes.set(this.at, hash);
      if (e.hash !== hash)
        this.noteMismatch({
          tick: this.at,
          kind: 'stored',
          expected: e.hash,
          actual: hash,
          source: e.source,
        });
    }
    if (this.cache) this.records.set(this.at, record);
    return record;
  }

  private checksOn(state: JsonObject, tick: number): CheckResult[] {
    return this.job.checks
      .filter((c) => c.kind === 'invariant' || c.tick === tick)
      .map((c) => {
        const failed = failsCheck(state, c);
        return failed === null
          ? { ...c, passed: true, actual: null, message: null }
          : { ...c, passed: false, actual: failed.actual, message: failed.message };
      });
  }

  private worldLog(sinceTick: number): WorldEvents | null {
    return this.game.worldEvents?.(sinceTick) ?? null;
  }

  /** Compares the view's state with the headless game's at the tick shown. */
  private checkView(): void {
    if (this.viewGame === null) return;
    const actual = stateHash(this.viewGame.snapshot());
    if (actual !== this.shown.hash)
      this.noteMismatch({ tick: this.at, kind: 'view', expected: this.shown.hash, actual });
  }

  private noteMismatch(m: DebugMismatch): void {
    if (this.firstMismatch === null || m.tick < this.firstMismatch.tick) this.firstMismatch = m;
  }
}

/** The value at a dotted path, or null when it is not there. */
function valueOrNull(state: JsonObject, path: string): JsonValue | null {
  const v = valueAt(state, path);
  return v === undefined ? null : v;
}

const isObject = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The differences between two JSON states, as dotted paths (`hero.x`, `entities.3.hp`), in key
 * order, at most `limit`: a value present in one only is `add` or `remove`, a different leaf (or a
 * value whose type changed) is `change`.
 */
export function diffStates(before: JsonValue, after: JsonValue, limit = 500): StateDiff[] {
  const out: StateDiff[] = [];
  const walk = (a: JsonValue | undefined, b: JsonValue | undefined, path: string): void => {
    if (out.length >= limit) return;
    if (a === undefined) {
      out.push({ path, op: 'add', after: b! });
      return;
    }
    if (b === undefined) {
      out.push({ path, op: 'remove', before: a });
      return;
    }
    const join = (key: string | number) => (path === '' ? String(key) : `${path}.${key}`);
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], join(i));
      return;
    }
    if (isObject(a) && isObject(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) walk(a[key], b[key], join(key));
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, op: 'change', before: a, after: b });
  };
  walk(before, after, '');
  return out;
}

/** One match of a state search: a dotted path and its value (a leaf, or an object or array). */
export interface StateMatch {
  path: string;
  value: JsonValue;
}

/**
 * The paths in `state` whose dotted path or leaf value contains `query` (case-insensitive), in
 * key order, at most `limit`. An empty query matches nothing.
 */
export function searchState(state: JsonValue, query: string, limit = 200): StateMatch[] {
  const q = query.trim().toLowerCase();
  const out: StateMatch[] = [];
  if (q === '') return out;
  const walk = (v: JsonValue, path: string): void => {
    if (out.length >= limit) return;
    const leaf = v === null || typeof v !== 'object';
    if (path.toLowerCase().includes(q) || (leaf && JSON.stringify(v).toLowerCase().includes(q)))
      out.push({ path, value: v });
    if (leaf) return;
    const join = (key: string | number) => (path === '' ? String(key) : `${path}.${key}`);
    if (Array.isArray(v)) v.forEach((item, i) => walk(item, join(i)));
    else for (const key of Object.keys(v).sort()) walk(v[key]!, join(key));
  };
  walk(state, '');
  return out;
}
