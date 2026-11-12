import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { campaignRun, type CampaignSave } from '@engine/core/campaign';
import {
  decodeSaveCode,
  encodeSaveCode,
  normalizeSaveCode,
  saveCodeContext,
  type SaveCodeContext,
} from '@engine/core/campaign-code';
import type { ContentBundle } from '@engine/core/content/bundle';
import { MANIFEST_FILE } from '@engine/core/content/manifest';
import { contentError, type ContentError } from '@engine/core/content/validate';
import {
  type HeadlessEntry,
  type HeadlessGame,
  type JsonObject,
  type JsonValue,
  type LateMissionRefusal,
  type RunStart,
  type WorldEvents,
} from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { stateHash } from '@engine/core/state-hash';
import type { KitDef } from '@engine/core/kit';
import { UsageError } from './exit-codes';
import { loadGame } from './game-loader';
import { gameKits, lookupRuleId, qualifiedRuleId, type KitRuleRef } from './kits';
import {
  applyOrder,
  compressClock,
  eventsSince,
  worldTimeline,
  type ClockEntry,
  type MissionDef,
  type Timeline,
} from '@engine/sim/index';
import { unknownKeyAt, type WorldKeys } from './check-values';
import { failsCheck, readRunFile, type CheckOp, type LoadedRunFile, type OrderEntry } from './run-file';
import {
  applyMissionStep,
  loadMissionDefs,
  loadWorldRun,
  settleWorld,
  type MissionStep,
  type RefusedMission,
} from './world-run';

export type { RefusedMission } from './world-run';

/**
 * Plays a run file headless: loads the game's content, imports its headless module (the
 * `headless` path in `game.json`, by its path at run time: never a static import), and steps the
 * game tick by tick with the run's scripted input, checking invariants and assertions and hashing
 * the state. A world run (`world` in the run file) builds the world from its scenario instead
 * (`world-run.ts`) and steps it with no input. Recorded `orders` are applied in lockstep: each one
 * after the state of its tick (checks and hash taken) and before the step from it, on a world with
 * `applyOrder`, on a game through its `order` method. `missions` steps go in right after their
 * tick's orders: on a world the world settles its missions after every step (each commits by
 * itself at its commit tick); on a game (Engine 0.11, item 172) each goes, without `tick`, to the
 * game's `mission` method, and the game's `missionExperience` gives the run's `experience`. A
 * game run's `start` (Engine 0.14, gap G9) is checked against the game's `starts` and handed to
 * `createGame` as `HeadlessOptions.start`. Used
 * by `run`, `dump`, `code`, `mutants` and `trace` (which reads each tick through `onTick`).
 */

/**
 * The state hash: the first 16 hex digits (64 bits) of the SHA-256 of the snapshot's canonical
 * JSON (`canonicalJson` in `engine/core/headless.ts`). Same state, same hash, on every machine.
 * It lives in core (`engine/core/state-hash.ts`, Engine 0.14 T8) so a browser page's step hook
 * hashes with the same code; re-exported here for the tools.
 */
export { stateHash };

/** A check that failed: which one, at which tick, and what the snapshot held. */
export interface FailedCheck {
  tick: number;
  /** `code`: a save code in the run file's `codes` (Engine 0.13), `path` being `codes.<index>`. */
  kind: 'assertion' | 'invariant' | 'code';
  /** Its index in the run file's `assertions`, `invariants` or `codes`. */
  index: number;
  path: string;
  op: CheckOp;
  expected: JsonValue;
  /** The value at the path (null when the path is not in the snapshot). */
  actual: JsonValue | null;
  message: string;
}

export interface TickHash {
  tick: number;
  hash: string;
}

/** An order the world or game dropped: its tick, its `id` (null when it has none) and why. */
export interface RefusedOrder {
  tick: number;
  id: number | null;
  error: string;
}

/**
 * The first sync hash (the run file's `hashes`) that differs from the run's: the tick, the stored
 * hash, the run's, and the last tick whose stored hash still matched (null when none did), so the
 * state first differs after `lastMatch` and by `tick`.
 */
export interface HashMismatch {
  tick: number;
  expected: string;
  actual: string;
  lastMatch: number | null;
}

/** A run that got as far as playing (its content and run file were valid). */
export interface PlayedRun {
  loaded: LoadedRunFile;
  seed: number;
  /** The game's kit (`kit` in `game.json`); null for a world run, which has no kit. */
  kit: string | null;
  /**
   * The kit rules switched off (the run file's `disableRules` plus any asked for), in kit order
   * (`kit`'s, then each `uses` kit's): bare ids for the game's own kit, `kit:id` for another
   * (Engine 0.14, gap G12).
   */
  disabledRules: string[];
  /** The same rules by kit, every kit the game uses listed (empty for a world run). */
  disabledRulesByKit: Record<string, string[]>;
  /** The last tick played: the run's `ticks`, the first failing tick, or the tick asked for. */
  lastTick: number;
  hashes: TickHash[];
  /** Every check that failed at the first failing tick (empty when all passed). */
  failures: FailedCheck[];
  /** The snapshot at `lastTick`. */
  snapshot: JsonObject;
  /** The recorded orders handed over (applied or refused) before `lastTick`. */
  ordersPlayed: number;
  /** The orders the world or game dropped, in the order they came. */
  refusedOrders: RefusedOrder[];
  /** The mission steps handed over (applied or refused) before `lastTick`. */
  missionsPlayed: number;
  /** The mission steps the world refused, in the order they came. */
  refusedMissions: RefusedMission[];
  /**
   * Experience ticks the played (or quit) missions spent inside their stand-in rounds, per mission
   * in first-step order: counted here, never in the world (they cannot move it).
   */
  experience: { mission: string; ticks: number }[];
  /** How many of the run file's sync `hashes` were compared (0 without `hashes`). */
  hashesChecked: number;
  /** The first sync hash that differed (the run stops there), or null. */
  hashMismatch: HashMismatch | null;
  /**
   * Engine 0.13: the campaign save the run started from (its `from`: another run's end or a save
   * code), or null.
   */
  startSave: CampaignSave | null;
  /**
   * Engine 0.14 (gap G9): the level or campaign entry the run started at (its `start`), or null.
   */
  start: RunStart | null;
  /** How many of the run file's `codes` were compared. */
  codesChecked: number;
  /**
   * The game's campaign save at `lastTick` (`HeadlessGame.campaignSave`), only when asked for
   * (`PlayOptions.withSave`): null when the game plays no campaign, undefined when not asked or the
   * game has no `campaignSave`.
   */
  campaignSave?: CampaignSave | null;
  /** The game's save code context (its campaigns, missions and scenarios); null for a world run. */
  codeContext: SaveCodeContext | null;
  /**
   * Engine 0.14 T7: the world's whole kept event log at `lastTick` (`HeadlessGame.worldEvents(0)`,
   * or the world run's log), only when asked (`PlayOptions.withWorld`); null when the game has no
   * world hooks, undefined when not asked.
   */
  worldEvents?: WorldEvents | null;
  /**
   * Engine 0.14 T7: the timeline record at `lastTick` (`HeadlessGame.timeline()` with `clock` filled
   * from the world tick at every game tick played, or the world run's own with `clock` null), only
   * when asked (`PlayOptions.withWorld`); null when the game has no world hooks.
   */
  timeline?: Timeline | null;
}

export type PlayOutcome = { ok: true; value: PlayedRun } | { ok: false; errors: ContentError[] };

/** Imports the game's headless module. A missing file is a content error at `headless` in `game.json`. */
async function importEntry(
  cwd: string,
  gameDir: string,
  content: ContentBundle,
): Promise<{ ok: true; entry: HeadlessEntry } | { ok: false; errors: ContentError[] }> {
  const root = gameDir === '.' ? '' : `${gameDir}/`;
  const path = content.manifest.headless;
  const abs = resolve(cwd, gameDir, path);
  const where = `${root}${MANIFEST_FILE}`;
  if (!existsSync(abs))
    return {
      ok: false,
      errors: [contentError(where, ['headless'], 'missing_file', `no file at ${root}${path}`)],
    };
  const mod = (await import(pathToFileURL(abs).href)) as Partial<HeadlessEntry>;
  if (typeof mod.createGame !== 'function') {
    const message = `${root}${path} does not export createGame(content, seed) (engine/core/headless.ts)`;
    return { ok: false, errors: [contentError(where, ['headless'], 'no_headless_entry', message)] };
  }
  return { ok: true, entry: mod as HeadlessEntry };
}

export interface PlayOptions {
  /** Play only this far and make no checks (for `dump`). */
  untilTick?: number;
  /**
   * Kit rules to switch off on top of the run file's `disableRules` (`--disable-rule`, `mutants`).
   * An id that is not one of the kit's rules is a usage error.
   */
  disableRules?: readonly string[];
  /** Read the game's campaign save at the last tick (`PlayedRun.campaignSave`; Engine 0.13). */
  withSave?: boolean;
  /**
   * Called with every tick's snapshot as it is played (tick 0 the start), after that tick's orders,
   * mission steps and step and before its checks: how `trace` reads a few paths per tick without a
   * loop of its own. It must not change the snapshot.
   */
  onTick?(tick: number, snapshot: JsonObject, keys: WorldKeys): void;
  /**
   * Engine 0.14 T7: read the world's event log and timeline at the last tick (`PlayedRun.worldEvents`
   * and `.timeline`). A world run is built with its event log on; a game is asked through its
   * optional `worldEvents` and `timeline` hooks (`engine/core/headless.ts`), and its world tick is
   * sampled at every game tick for the timeline's `clock`. No hash changes: the log is never in a
   * snapshot.
   */
  withWorld?: boolean;
  /**
   * Engine 0.14 T9 (`record --bot`): called once with a game run's game right after it is created
   * (a world run has none), so a tool can turn on its round recording.
   */
  prepare?(game: HeadlessGame): void;
  /**
   * Engine 0.14 T9: the frame a game run's step reads, given the run's scripted frame (already
   * advanced to this tick); by default that frame. `record --bot` hands the hosted round a bot's.
   */
  frameFor?(game: HeadlessGame, scripted: InputFrame): InputFrame;
  /**
   * Engine 0.14 T9: the mission step handed over in place of the run file's entry `index` (by
   * default the entry). `record --bot` drops the recorded `input` of the `play` step it re-records.
   */
  missionStep?(step: MissionStep, index: number): MissionStep;
}

/** A content error in the run file at `path`. */
const runError = (loaded: LoadedRunFile, path: (string | number)[], code: string, message: string) => ({
  ok: false as const,
  errors: [contentError(loaded.file, path, code, message)],
});

/**
 * The campaign save a game run's `from` starts at (Engine 0.13, decision 9): the save code
 * decoded against the game's content, or the `from.run` file played to its last tick and its
 * game's campaign save read there. Errors name the run file's `from` field: a code's refusal code
 * (`code_typo`, ...), `from_chain` (the source run has a `from` itself; one step deep in 0.13),
 * `from_game` (another game's run), `no_campaign` (its game plays no campaign there), or
 * `campaign_done` (the save is past the campaign's last entry).
 */
async function startSave(
  cwd: string,
  loaded: LoadedRunFile,
  ctx: SaveCodeContext,
): Promise<{ ok: true; save: CampaignSave } | { ok: false; errors: ContentError[] }> {
  const from = loaded.run.from;
  let save: CampaignSave;
  if (from?.code !== undefined) {
    const decoded = decodeSaveCode(from.code, ctx);
    if (!decoded.ok) return runError(loaded, ['from', 'code'], decoded.code, decoded.error);
    save = decoded.save;
  } else {
    const source = readRunFile(cwd, loaded.fromRun as string);
    if (!source.ok) return source;
    const at = ['from', 'run'];
    if (source.value.run.from !== undefined)
      return runError(
        loaded,
        at,
        'from_chain',
        `${source.value.file} starts from another run itself: a run's "from" is one step deep`,
      );
    if (source.value.gameDir !== loaded.gameDir)
      return runError(
        loaded,
        at,
        'from_game',
        `${source.value.file} plays ${source.value.gameDir ?? source.value.worldFile ?? '?'}, not ${loaded.gameDir ?? '?'}`,
      );
    const played = await playRun(cwd, source.value.file, {
      untilTick: source.value.run.ticks,
      withSave: true,
    });
    if (!played.ok) return played;
    if (played.value.campaignSave === null || played.value.campaignSave === undefined)
      return runError(
        loaded,
        at,
        'no_campaign',
        `${source.value.file}'s game gives no campaign save at its last tick (${source.value.run.ticks})`,
      );
    save = played.value.campaignSave;
  }
  const campaign = ctx.campaigns.find((c) => c.id === save.campaign);
  if (campaign === undefined || campaignRun(campaign, save).done)
    return runError(
      loaded,
      ['from'],
      'campaign_done',
      `campaign "${save.campaign}" has no entry at position ${save.position} to start from`,
    );
  return { ok: true, save };
}

/**
 * Checks a game run's `start` against the starts its game lists (`HeadlessEntry.starts`, Engine
 * 0.14, gap G9), before the game is created. Errors name the run file: `no_start` at `start` (the
 * headless module has no `starts`, or lists no stages or no entries for that kind of start) and
 * `bad_start` at `start.stage` or `start.entry` (a stage past the last level, an entry the
 * campaign lacks), naming what the game has.
 */
function checkStart(
  loaded: LoadedRunFile,
  entry: HeadlessEntry,
  content: ContentBundle,
): { ok: true; start: RunStart | null } | { ok: false; errors: ContentError[] } {
  const start = loaded.run.start;
  if (start === undefined) return { ok: true, start: null };
  const headless = content.manifest.headless;
  const starts = entry.starts?.(content);
  if (start.stage !== undefined) {
    const stages = starts?.stages;
    if (stages === undefined || stages.length === 0)
      return runError(
        loaded,
        ['start'],
        'no_start',
        `the game cannot start at a stage: its headless module (${headless}) lists no level sequence (starts(content).stages, engine/core/headless.ts)`,
      );
    if (start.stage >= stages.length)
      return runError(
        loaded,
        ['start', 'stage'],
        'bad_start',
        `stage ${start.stage} is past the last level: the game has ${stages.length} (0 to ${stages.length - 1}: ${stages.join(', ')})`,
      );
    return { ok: true, start: { stage: start.stage } };
  }
  const id = start.entry as string;
  const entries = starts?.entries;
  if (entries === undefined || entries.length === 0)
    return runError(
      loaded,
      ['start'],
      'no_start',
      `the game cannot start at a campaign entry: its headless module (${headless}) lists none (starts(content).entries, engine/core/headless.ts)`,
    );
  if (!entries.includes(id))
    return runError(
      loaded,
      ['start', 'entry'],
      'bad_start',
      `the game's campaign has no entry "${id}" (its entries: ${entries.join(', ')})`,
    );
  return { ok: true, start: { entry: id } };
}

/**
 * The rules in `off` by kit, in each kit's own order, with every kit of `kits` listed (an empty
 * list for a kit with none off).
 */
function rulesOffByKit(kits: readonly KitDef[], off: readonly KitRuleRef[]): Record<string, string[]> {
  return Object.fromEntries(
    kits.map((k) => [
      k.name,
      k.rules.filter((r) => off.some((o) => o.kit === k.name && o.id === r.id)).map((r) => r.id),
    ]),
  );
}

/**
 * The rule options a game is created with (`HeadlessOptions`): `disabledRules`, the main kit's
 * list as before Engine 0.14, and `disabledRulesByKit`, every kit's (gap G12).
 */
export function headlessRules(
  mainKit: string,
  byKit: Readonly<Record<string, readonly string[]>>,
): { disabledRules: string[]; disabledRulesByKit: Record<string, string[]> } {
  return {
    disabledRules: [...(byKit[mainKit] ?? [])],
    disabledRulesByKit: Object.fromEntries(Object.entries(byKit).map(([k, ids]) => [k, [...ids]])),
  };
}

/**
 * Plays the run file at `runPath` (relative to `cwd`). With `untilTick` it plays only that far and
 * makes no checks (for `dump`); otherwise it plays every tick and stops at the first failing tick.
 * A rule in the run file's `disableRules` or `guards` that none of the game's kits names is a
 * content error (`unknown_rule`, at that entry): a bare id is a rule of the game's own kit,
 * `kit:id` one of a kit it `uses` (Engine 0.14, gap G12).
 */
export async function playRun(cwd: string, runPath: string, opts: PlayOptions = {}): Promise<PlayOutcome> {
  const runFile = readRunFile(cwd, runPath);
  if (!runFile.ok) return runFile;
  const loaded = runFile.value;
  if (loaded.worldFile !== null) {
    if ((opts.disableRules ?? []).length > 0)
      throw new UsageError(`${loaded.file} plays a world, which has no kit rules to switch off`);
    const built = loadWorldRun(cwd, loaded.file, loaded.worldFile, loaded.run.seed, {
      log: opts.withWorld === true,
    });
    if (!built.ok) return built;
    const { world, keys } = built;
    let defs: ReadonlyMap<string, MissionDef> = new Map();
    if (loaded.run.missions.length > 0) {
      const read = loadMissionDefs(cwd, loaded.file, loaded.worldFile, loaded.run.missions);
      if (!read.ok) return read;
      defs = read.defs;
    }
    // Orders are RTS orders (`engine/core/orders.ts`): only the `rts` systems carry them out.
    if (loaded.run.orders.length > 0 && built.systems !== 'rts')
      return {
        ok: false,
        errors: [
          contentError(
            loaded.file,
            ['orders'],
            'no_orders',
            `${loaded.worldFile} runs the "${built.systems}" system set, which takes no orders: orders need "systems": "rts" in the scenario`,
          ),
        ],
      };
    const stepper: Stepper = {
      step: () => {
        world.step();
        settleWorld(world);
      },
      snapshot: () => world.snapshot(),
      order: (order) => {
        const applied = applyOrder(world, order);
        return applied.ok ? null : applied.error;
      },
      mission: (step) => applyMissionStep(world, step, defs, keys),
      worldEvents: (sinceTick) => eventsSince(world, sinceTick),
      timeline: () => worldTimeline(world),
      keys,
    };
    const noKey = unknownKeys(loaded, stepper);
    if (noKey !== null) return noKey;
    return { ok: true, value: play(loaded, stepper, world.seed, null, [], {}, opts, null, null, null) };
  }
  const { run } = loaded;
  const game = loadGame(cwd, loaded.gameDir ?? '.');
  if (!game.content.ok) return { ok: false, errors: game.content.errors };
  const content = game.content.value;
  const imported = await importEntry(cwd, game.dir, content);
  if (!imported.ok) return imported;

  // Rule ids: bare for the game's own kit, `kit:id` for a kit it `uses` (Engine 0.14, gap G12).
  const kits = gameKits(content.manifest);
  const lists = [
    ['disableRules', run.disableRules],
    ['guards', run.guards ?? []],
  ] as const;
  const badInFile = lists.flatMap(([field, ids]) =>
    ids.flatMap((id, i) => {
      const found = lookupRuleId(id, kits, ` in "${field}"`);
      return found.ok ? [] : [contentError(loaded.file, [field, i], 'unknown_rule', found.message)];
    }),
  );
  if (badInFile.length > 0) return { ok: false, errors: badInFile };
  const off: KitRuleRef[] = [];
  const badAsked: string[] = [];
  for (const id of [...run.disableRules, ...(opts.disableRules ?? [])]) {
    const found = lookupRuleId(id, kits);
    if (found.ok) off.push(found.rule);
    else badAsked.push(found.message);
  }
  if (badAsked.length > 0) throw new UsageError(badAsked.join('; '));
  const rulesOff = rulesOffByKit(kits, off);
  const disabledRules = kits.flatMap((k) =>
    rulesOff[k.name]!.map((id) => qualifiedRuleId({ kit: k.name, id }, content.manifest.kit)),
  );

  const runStart = checkStart(loaded, imported.entry, content);
  if (!runStart.ok) return runStart;
  const codeContext = saveCodeContext(content);
  let start: CampaignSave | null = null;
  if (run.from !== undefined) {
    const got = await startSave(cwd, loaded, codeContext);
    if (!got.ok) return got;
    start = got.save;
    // The code is the save: its seed is the world's, as on the game's page. A run file that
    // names another seed would replay the code on a different world.
    if (run.seed !== undefined && run.seed !== start.seed)
      return runError(
        loaded,
        ['seed'],
        'seed_mismatch',
        `"seed" is ${run.seed}, but the save "from" starts at has seed ${start.seed}: leave "seed" out or make it ${start.seed}`,
      );
  }
  const seed = start?.seed ?? run.seed ?? content.manifest.start.seed;
  const instance: HeadlessGame = imported.entry.createGame(content, seed, {
    ...headlessRules(content.manifest.kit, rulesOff),
    ...(start === null ? {} : { campaign: start }),
    ...(runStart.start === null ? {} : { start: runStart.start }),
  });
  if ((run.from !== undefined || run.codes !== undefined) && typeof instance.campaignSave !== 'function')
    throw new UsageError(
      `${loaded.file} has ${run.from !== undefined ? '"from"' : '"codes"'}, but the game's headless module (${content.manifest.headless}) plays no campaign: its game has no campaignSave() method (engine/core/headless.ts)`,
    );
  if (run.missions.length > 0 && typeof instance.mission !== 'function')
    throw new UsageError(
      `${loaded.file} has missions, but the game's headless module (${content.manifest.headless}) takes none: its game has no mission(step) method (engine/core/headless.ts)`,
    );
  if (run.orders.length > 0 && typeof instance.order !== 'function')
    throw new UsageError(
      `${loaded.file} has orders, but the game's headless module (${content.manifest.headless}) takes none: its game has no order(order) method (engine/core/headless.ts)`,
    );
  opts.prepare?.(instance);
  const input = new ScriptedInput(run.input);
  const stepper: Stepper = {
    step: () => {
      input.next();
      instance.step(opts.frameFor ? opts.frameFor(instance, input) : input);
    },
    snapshot: () => instance.snapshot(),
    order: (order) => instance.order?.(order) ?? null,
    mission: (step) => instance.mission?.(missionOf(step)) ?? null,
    ...(instance.missionExperience ? { experience: () => [...(instance.missionExperience?.() ?? [])] } : {}),
    ...(instance.lateRefusals ? { lateRefusals: (since: number) => [...instance.lateRefusals!(since)] } : {}),
    ...(instance.campaignSave ? { campaignSave: () => instance.campaignSave?.() ?? null } : {}),
    ...(instance.worldEvents && instance.timeline
      ? {
          worldEvents: (sinceTick: number) => instance.worldEvents!(sinceTick),
          timeline: (clock?: ClockEntry[]) => ({
            ...(instance.timeline!() as unknown as Timeline),
            clock: clock ?? null,
          }),
          gameRun: true,
        }
      : {}),
    keys: instance.worldKeys?.() ?? {},
  };
  const noKey = unknownKeys(loaded, stepper);
  if (noKey !== null) return noKey;
  return {
    ok: true,
    value: play(
      loaded,
      stepper,
      seed,
      content.manifest.kit,
      disabledRules,
      rulesOff,
      opts,
      start,
      runStart.start,
      codeContext,
    ),
  };
}

/** What `play` needs of a game or a world: one step, the snapshot after it, and taking an order. */
interface Stepper {
  step(): void;
  snapshot(): JsonObject;
  /** Applies one order between steps: null when applied, else why it was dropped. */
  order(order: JsonObject): string | null;
  /** Applies one mission step between steps: null when taken, else the refusal. */
  mission?(step: MissionStep): { code: string; error: string } | null;
  /**
   * A game's own count of its played rounds' ticks (`HeadlessGame.missionExperience`), used for
   * the result's `experience` instead of the run file's `experienceTicks` (a game run has none).
   */
  experience?(): { mission: string; ticks: number }[];
  /** Refusals that came after their step, from a game tick on (`HeadlessGame.lateRefusals`). */
  lateRefusals?(sinceTick: number): LateMissionRefusal[];
  /** The game's campaign save now (`HeadlessGame.campaignSave`). */
  campaignSave?(): CampaignSave | null;
  /** The world's event log from a world tick (`HeadlessGame.worldEvents`, or the world run's). */
  worldEvents?(sinceTick: number): WorldEvents;
  /** The timeline record now, with the game run's clock when it has one. */
  timeline?(clock?: ClockEntry[]): Timeline;
  /** True for a game run: its world tick is sampled every game tick for the timeline's `clock`. */
  gameRun?: boolean;
  /**
   * The world's key table (Engine 0.15 T7, gap M17: a world run's scenario keys, a game's
   * `worldKeys()`), for `world.key.<key>` paths; `{}` for a game without a world.
   */
  keys: WorldKeys;
}

/**
 * The run file's checks whose path names a scenario key the world's key table lacks (read on the
 * tick-0 snapshot): `no_key` at the check's `path` (Engine 0.15 T7, decision 8), or null.
 */
function unknownKeys(loaded: LoadedRunFile, stepper: Stepper): { ok: false; errors: ContentError[] } | null {
  const snapshot = stepper.snapshot();
  const errors: ContentError[] = [];
  const lists = [
    ['assertions', loaded.run.assertions],
    ['invariants', loaded.run.invariants],
  ] as const;
  for (const [field, checks] of lists)
    checks.forEach((c, i) => {
      const key = unknownKeyAt(snapshot, c.path, stepper.keys);
      if (key !== null)
        errors.push(
          contentError(
            loaded.file,
            [field, i, 'path'],
            'no_key',
            `"${c.path}" names the key "${key}", which the world's key table does not hold (${Object.keys(stepper.keys).join(', ') || 'no keys'})`,
          ),
        );
    });
  return errors.length > 0 ? { ok: false, errors } : null;
}

/**
 * The save code the game's campaign save gives now, or why there is none (a game with no
 * campaign there, or a save the code cannot hold).
 */
export function saveCodeNow(
  save: CampaignSave | null | undefined,
  ctx: SaveCodeContext,
): { ok: true; code: string } | { ok: false; code: string; error: string } {
  if (save === null || save === undefined)
    return { ok: false, code: 'no_campaign', error: 'the game gives no campaign save here' };
  return encodeSaveCode(save, ctx);
}

/** A game run's mission step as the game takes it: the entry without its `tick`. */
export function missionOf(step: MissionStep): JsonObject {
  const { tick: _tick, ...rest } = step;
  return rest as JsonObject;
}

/** An entry's order: the entry without its `tick`. */
export function orderOf(entry: OrderEntry): JsonObject {
  const { tick: _tick, ...order } = entry;
  return order as JsonObject;
}

/** Steps a game or world tick by tick, making the run file's checks and hashing the state. */
function play(
  loaded: LoadedRunFile,
  stepper: Stepper,
  seed: number,
  kit: string | null,
  disabledRules: string[],
  disabledRulesByKit: Record<string, string[]>,
  opts: PlayOptions,
  startSave: CampaignSave | null,
  start: RunStart | null,
  codeContext: SaveCodeContext | null,
): PlayedRun {
  const { run } = loaded;
  const checking = opts.untilTick === undefined;
  const last = opts.untilTick ?? run.ticks;
  const hashes: TickHash[] = [];
  const failures: FailedCheck[] = [];
  const refusedOrders: RefusedOrder[] = [];
  const refusedMissions: RefusedMission[] = [];
  const experience = new Map<string, number>();
  const stored = new Map((checking ? (run.hashes ?? []) : []).map((h) => [h.tick, h.hash]));
  let hashesChecked = 0;
  let codesChecked = 0;
  let hashMismatch: HashMismatch | null = null;
  let lastMatch: number | null = null;
  let next = 0; // the next order entry to hand over
  let nextMission = 0; // the next mission step to hand over
  // The snapshot of the tick played last, taken only when something reads it (a check, a hash,
  // `onTick`, the end): a long run that hashes every 100 ticks does not copy the world every tick.
  let taken: JsonObject | null = null;
  const snap = (): JsonObject => (taken ??= stepper.snapshot());
  // The world tick at every game tick played (a game run's timeline `clock`, Engine 0.14 T7).
  const sampling = opts.withWorld === true && stepper.gameRun === true && stepper.worldEvents !== undefined;
  const clock: ClockEntry[] = [];

  for (let tick = 0; ; tick++) {
    if (tick > 0) {
      // Lockstep: the orders of the previous tick go in after its state, before the step from it.
      for (; next < run.orders.length && run.orders[next]!.tick === tick - 1; next++) {
        const entry = run.orders[next]!;
        const error = stepper.order(orderOf(entry));
        if (error !== null) refusedOrders.push({ tick: entry.tick, id: entry.id ?? null, error });
      }
      // Then that tick's mission steps, in file order.
      for (
        ;
        nextMission < run.missions.length && run.missions[nextMission]!.tick === tick - 1;
        nextMission++
      ) {
        const step = run.missions[nextMission]!;
        const refused = stepper.mission?.(opts.missionStep?.(step, nextMission) ?? step) ?? null;
        if (refused !== null)
          refusedMissions.push({ tick: step.tick, mission: step.mission, action: step.action, ...refused });
        else if (step.experienceTicks !== undefined)
          experience.set(step.mission, (experience.get(step.mission) ?? 0) + step.experienceTicks);
      }
      stepper.step();
      taken = null;
      // Refusals that came after their step (gap M5), at the tick they came at.
      for (const r of stepper.lateRefusals?.(tick) ?? [])
        if (r.tick === tick)
          refusedMissions.push({
            tick,
            mission: r.mission,
            action: r.action,
            code: r.code,
            error: r.error,
            late: true,
          });
    }
    if (sampling) clock.push({ game: tick, world: stepper.worldEvents!(Number.MAX_SAFE_INTEGER).tick });
    if (opts.onTick) opts.onTick(tick, snap(), stepper.keys);
    if (checking) {
      run.invariants.forEach((c, index) => {
        const failed = failsCheck(snap(), c, stepper.keys);
        if (failed)
          failures.push({
            tick,
            kind: 'invariant',
            index,
            path: c.path,
            op: c.op,
            expected: c.value,
            ...failed,
          });
      });
      run.assertions.forEach((c, index) => {
        if (c.tick !== tick) return;
        const failed = failsCheck(snap(), c, stepper.keys);
        if (failed)
          failures.push({
            tick,
            kind: 'assertion',
            index,
            path: c.path,
            op: c.op,
            expected: c.value,
            ...failed,
          });
      });
      (run.codes ?? []).forEach((c, index) => {
        if (c.tick !== tick || codeContext === null) return;
        codesChecked++;
        const now = saveCodeNow(stepper.campaignSave?.(), codeContext);
        const actual = now.ok ? now.code : null;
        if (actual !== null && normalizeSaveCode(actual) === normalizeSaveCode(c.code)) return;
        failures.push({
          tick,
          kind: 'code',
          index,
          path: `codes.${index}`,
          op: 'eq',
          expected: c.code,
          actual,
          message: now.ok
            ? `the save code at tick ${tick} is ${now.code}, expected ${c.code}`
            : `no save code at tick ${tick} (${now.code}: ${now.error}), expected ${c.code}`,
        });
      });
    }
    const want = stored.get(tick);
    let hash: string | null = null;
    if (want !== undefined) {
      hash = stateHash(snap());
      hashesChecked++;
      if (hash === want) lastMatch = tick;
      else hashMismatch = { tick, expected: want, actual: hash, lastMatch };
    }
    const end = tick === last || failures.length > 0 || hashMismatch !== null;
    if (tick % run.hashEvery === 0 || end || want !== undefined)
      hashes.push({ tick, hash: hash ?? stateHash(snap()) });
    if (end)
      return {
        loaded,
        seed,
        kit,
        disabledRules,
        disabledRulesByKit,
        lastTick: tick,
        hashes,
        failures,
        snapshot: snap(),
        ordersPlayed: next,
        refusedOrders,
        missionsPlayed: nextMission,
        refusedMissions,
        experience: stepper.experience?.() ?? [...experience].map(([mission, ticks]) => ({ mission, ticks })),
        hashesChecked,
        hashMismatch,
        startSave,
        start,
        codesChecked,
        codeContext,
        ...(opts.withSave && stepper.campaignSave ? { campaignSave: stepper.campaignSave() } : {}),
        ...(opts.withWorld
          ? {
              worldEvents: stepper.worldEvents?.(0) ?? null,
              timeline: stepper.timeline?.(sampling ? compressClock(clock) : undefined) ?? null,
            }
          : {}),
      };
  }
}
