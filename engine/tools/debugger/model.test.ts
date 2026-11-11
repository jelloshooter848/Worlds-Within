import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { HeadlessEntry } from '@engine/core/headless';
import type { ViewEntry, ViewGame } from '@engine/core/view';
import { checkGameTexts } from '../game-check';
import type { DebugRunJob } from './job';
import { DebugSession, diffStates, headlessOptions, searchState, type SessionOptions } from './model';
import { buildDebugJob, debugKindOf } from './server';
import { playWorldData } from '../world-data';

// The debugger's model in Node (Engine 0.14 T10): stepping to N, rewinding to M < N and stepping
// back to N give the run's golden hashes at each tick, with the per-tick cache and without it (the
// re-simulation alone); the checks, the event log, the diff and the search; (T11) the timeline
// record with its clock and a replay's failed check.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
// The mini siege's tests load and run its whole game (3D skins and models included): a few seconds
// each, so they get more than vitest's 5 s default on a busy machine, as its own tests do.
vi.setConfig({ testTimeout: 60_000 });
const WALK = 'games/samples/dungeon/runs/walk-east.run.json';
const SIEGE = 'games/samples/mini-siege/runs/delegated.run.json';
const PLAYED = 'games/samples/mini-siege/runs/played.run.json';

/** The golden hashes of a run file, by tick. */
function golden(run: string): Map<number, string> {
  const file = JSON.parse(readFileSync(join(ROOT, run.replace(/\.run\.json$/, '.hashes.json')), 'utf8')) as {
    hashes: { tick: number; hash: string }[];
  };
  return new Map(file.hashes.map((h) => [h.tick, h.hash]));
}

async function jobFor(run: string): Promise<DebugRunJob> {
  const built = await buildDebugJob(ROOT, run);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const { job } = built.value;
  if (job.kind === 'dump') throw new Error('not a run');
  return job;
}

/** A session on `run` as the page makes one, its game from the headless module (and view). */
async function sessionFor(
  run: string,
  opts: { cache?: boolean; view?: boolean } = {},
): Promise<DebugSession<ViewGame>> {
  const job = await jobFor(run);
  const content = checkGameTexts(job.files, job.root);
  if (!content.ok) throw new Error(JSON.stringify(content.errors));
  const manifest = content.value.manifest;
  const gameDir = resolve(ROOT, job.game);
  const entry = (await import(pathToFileURL(resolve(gameDir, manifest.headless)).href)) as HeadlessEntry;
  const extra: SessionOptions<ViewGame> = { ...(opts.cache === undefined ? {} : { cache: opts.cache }) };
  if (opts.view && manifest.view !== undefined) {
    const view = (await import(pathToFileURL(resolve(gameDir, manifest.view)).href)) as ViewEntry;
    extra.makeView = () => view.createView(content.value, job.seed, headlessOptions(job));
  }
  return new DebugSession<ViewGame>(
    job,
    () => entry.createGame(content.value, job.seed, headlessOptions(job)),
    extra,
  );
}

/** A session on a (changed) job, its game from the job's headless module. */
async function sessionOn(job: DebugRunJob): Promise<DebugSession> {
  const content = checkGameTexts(job.files, job.root);
  if (!content.ok) throw new Error(JSON.stringify(content.errors));
  const entry = (await import(
    pathToFileURL(resolve(ROOT, job.game, content.value.manifest.headless)).href
  )) as HeadlessEntry;
  return new DebugSession(job, () => entry.createGame(content.value, job.seed, headlessOptions(job)));
}

describe('DebugSession', () => {
  for (const cache of [true, false])
    it(`steps to N, rewinds to M < N and steps back to N with the golden hashes (cache ${cache ? 'on' : 'off'})`, async () => {
      const hashes = golden(WALK);
      const s = await sessionFor(WALK, { cache });
      expect(s.tick).toBe(0);
      expect(s.hash()).toBe(hashes.get(0));
      expect(s.step(40)).toBe(40);
      expect(s.hash()).toBe(hashes.get(40));
      expect(s.goto(120)).toBe(120);
      expect(s.hash()).toBe(hashes.get(120));
      expect(s.rebuilds).toBe(0);

      expect(s.goto(80)).toBe(80);
      expect(s.rebuilds).toBe(1);
      expect(s.hash()).toBe(hashes.get(80));
      expect(s.step(40)).toBe(120);
      expect(s.hash()).toBe(hashes.get(120));
      expect(s.goto(0)).toBe(0);
      expect(s.hash()).toBe(hashes.get(0));
      expect(s.goto(240)).toBe(240);
      expect(s.hash()).toBe(hashes.get(240));
      expect(s.mismatch).toBeNull();
      expect(s.hashRows().every((r) => r.matches === true)).toBe(true);
    });

  it('gives the same records from the cache as from re-simulation', async () => {
    const cached = await sessionFor(WALK);
    const fresh = await sessionFor(WALK, { cache: false });
    cached.goto(100);
    fresh.goto(100);
    for (const t of [99, 37, 1, 64]) {
      cached.goto(t);
      fresh.goto(t);
      expect(cached.hash()).toBe(fresh.hash());
      expect(cached.state()).toEqual(fresh.state());
      expect(cached.diff()).toEqual(fresh.diff());
    }
  });

  it('clamps to the run and refuses a step that is not a whole number', async () => {
    const s = await sessionFor(WALK);
    expect(s.goto(10_000)).toBe(240);
    expect(s.goto(-5)).toBe(0);
    expect(() => s.step(-1)).toThrow(/whole number/);
    expect(() => s.goto(1.5)).toThrow(/whole number/);
  });

  it("makes the run's checks at each tick and remembers each assertion's result", async () => {
    const s = await sessionFor(WALK);
    expect(s.checks().map((c) => `${c.kind}:${c.index}:${c.passed}`)).toEqual([
      'assertion:0:true',
      'invariant:0:true',
      'invariant:1:true',
    ]);
    expect(s.assertions().map((a) => a.status)).toEqual(['passed', 'pending', 'pending']);
    s.goto(240);
    expect(s.assertions().map((a) => a.status)).toEqual(['passed', 'passed', 'passed']);
    expect(s.failedTicks()).toEqual([]);
  });

  it('reports a stored hash that differs and stops stepping there', async () => {
    const job = await jobFor(WALK);
    const bad = {
      ...job,
      expected: [...job.expected, { tick: 50, hash: '0000000000000000', source: 'run' as const }],
    };
    const content = checkGameTexts(job.files, job.root);
    if (!content.ok) throw new Error('bad content');
    const entry = (await import(
      pathToFileURL(resolve(ROOT, job.game, content.value.manifest.headless)).href
    )) as HeadlessEntry;
    const s = new DebugSession(bad, () => entry.createGame(content.value, job.seed, headlessOptions(job)));
    expect(s.goto(200)).toBe(50);
    expect(s.mismatch).toMatchObject({
      tick: 50,
      kind: 'stored',
      expected: '0000000000000000',
      source: 'run',
    });
    expect(s.step(5)).toBe(50);
    expect(s.goto(20)).toBe(20);
  });

  it('steps the view alongside with the same state', async () => {
    const s = await sessionFor(WALK, { view: true });
    s.goto(60);
    expect(s.view).not.toBeNull();
    expect(s.mismatch).toBeNull();
  });

  it("reads the mini siege's event log, its mission steps and its golden hashes", async () => {
    const hashes = golden(SIEGE);
    const s = await sessionFor(SIEGE);
    expect(s.goto(120)).toBe(120);
    expect(s.hash()).toBe(hashes.get(120));
    const all = s.events();
    expect(all).not.toBeNull();
    expect(all!.changes.length).toBeGreaterThan(0);
    const mission = s.events({ cause: 'mission' })!.changes;
    expect(mission.length).toBeGreaterThan(0);
    expect(mission.every((c) => c.cause === 'mission' || c.cause.startsWith('mission:'))).toBe(true);
    expect(s.stepEvents()).not.toBeNull();
    expect(s.goto(40)).toBe(40);
    expect(s.hash()).toBe(hashes.get(40));
    expect(s.events()!.changes.length).toBeLessThan(all!.changes.length);
    expect(s.goto(120)).toBe(120);
    expect(s.hash()).toBe(hashes.get(120));
    expect(s.refusals).toEqual([]);
  });

  it('gives no event log for a game with no world', async () => {
    const s = await sessionFor(WALK);
    expect(s.events()).toBeNull();
    expect(s.stepEvents()).toBeNull();
  });
});

describe('DebugSession: timeline and replay failures (Engine 0.14 T11)', () => {
  it("gives the mini siege's timeline record with the clock the tools fill", async () => {
    const s = await sessionFor(PLAYED);
    expect(s.goto(666)).toBe(666);
    const data = await playWorldData(ROOT, PLAYED, 666);
    if (!data.ok) throw new Error('no world data');
    expect(s.timeline()).toEqual(data.value.timeline);
    // Back at tick 100 (inside the round): the world stands at 40 and the siege is still frozen.
    s.goto(100);
    const back = s.timeline()!;
    expect(back.clock).toEqual([
      { game: 0, world: 0 },
      { game: 40, world: 40 },
      { game: 100, world: 40 },
    ]);
    expect(back.frozen).toEqual([{ event: 'siege', by: 'mission:sabotage', from: 40, to: null }]);
    // The cache off: the same clock from the re-simulation alone.
    const fresh = await sessionFor(PLAYED, { cache: false });
    fresh.goto(100);
    expect(fresh.timeline()).toEqual(back);
  }, 60_000);

  it('gives no timeline for a game with no world', async () => {
    expect((await sessionFor(WALK)).timeline()).toBeNull();
  });

  it("reads a replay's failed check at its tick: actual value, reproduced, the tick before", async () => {
    const job = await jobFor(WALK);
    const failing = {
      ...job,
      kind: 'replay' as const,
      checks: [
        ...job.checks,
        {
          kind: 'assertion' as const,
          index: 9,
          tick: 100,
          path: 'hero.room',
          op: 'eq' as const,
          value: 'nowhere',
        },
      ],
      failure: {
        tick: 100,
        kind: 'assertion',
        path: 'hero.room',
        op: 'eq',
        expected: 'nowhere',
        message: 'hero.room is "guard-room", expected "nowhere"',
      },
    };
    const s = await sessionOn(failing);
    expect(s.failure()).toMatchObject({ tick: 100, reached: false, reproduced: null, tickBefore: 99 });
    s.goto(100);
    expect(s.failure()).toMatchObject({
      reached: true,
      actual: 'guard-room',
      reproduced: true,
      path: 'hero.room',
      op: 'eq',
      expected: 'nowhere',
    });
    s.goto(99);
    expect(s.failure()!.reproduced).toBe(true);
    // A stored failure the run does not give (a different expected value passes there).
    const passes = await sessionOn({
      ...failing,
      checks: [...job.checks, { ...failing.checks.at(-1)!, value: 'guard-room' }],
      failure: { ...failing.failure, expected: 'guard-room' },
    });
    passes.goto(100);
    expect(passes.failure()).toMatchObject({ reached: true, reproduced: false, actual: 'guard-room' });
    expect((await sessionFor(WALK)).failure()).toBeNull();
  });
});

describe('diffStates and searchState', () => {
  it('lists added, removed and changed paths', () => {
    expect(diffStates({ a: 1, b: { c: [1, 2] }, d: 'x' }, { a: 2, b: { c: [1] }, e: true })).toEqual([
      { path: 'a', op: 'change', before: 1, after: 2 },
      { path: 'b.c.1', op: 'remove', before: 2 },
      { path: 'd', op: 'remove', before: 'x' },
      { path: 'e', op: 'add', after: true },
    ]);
    expect(diffStates({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffStates({ a: [1, 2, 3] }, { a: [4, 5, 6] }, 2)).toHaveLength(2);
  });

  it('finds paths and leaf values', () => {
    const state = { hero: { hp: 3, room: 'guard-room' }, rooms: ['courtyard', 'guard-room'] };
    expect(searchState(state, 'HP')).toEqual([{ path: 'hero.hp', value: 3 }]);
    expect(searchState(state, 'guard').map((m) => m.path)).toEqual(['hero.room', 'rooms.1']);
    expect(searchState(state, ' ')).toEqual([]);
  });
});

describe('debugKindOf', () => {
  it('tells a dump, a replay and a run file apart', () => {
    expect(debugKindOf({ format: 'worlds-within/dump' })).toBe('dump');
    expect(debugKindOf({ game: '..', replay: {} })).toBe('replay');
    expect(debugKindOf({ game: '..' })).toBe('run');
    expect(debugKindOf([])).toBe('run');
  });
});
