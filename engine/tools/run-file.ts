import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { z } from 'zod';
import { Actions } from '@engine/core/input/actions';
import { canonicalJson, type JsonValue, type RunStart } from '@engine/core/headless';
import { contentError, validate, type ContentError } from '@engine/core/content/validate';
import { orderSchema } from '@engine/core/orders';
import { UsageError } from './exit-codes';

/**
 * Run files: a seeded, scripted headless run and the checks it must pass, as JSON
 * (`games/<game>/runs/<name>.run.json`). `pnpm cli run <run-file>` plays it; `dump` shows the
 * state at one tick.
 *
 *   { "game": "..",
 *     "seed": 1,
 *     "ticks": 200,
 *     "input": { "steps": [{ "frame": 0, "hold": ["right"] }] },
 *     "assertions": [{ "tick": 200, "path": "room", "op": "eq", "value": "guard-room" }],
 *     "invariants": [{ "path": "hero.hp", "op": "gte", "value": 0 }],
 *     "hashEvery": 50,
 *     "disableRules": [],
 *     "guards": ["doors-change-room"],
 *     "orders": [{ "tick": 40, "id": 1, "faction": "blue", "type": "move", "units": [5], "target": { "x": 9, "y": 2 } }],
 *     "hashes": [{ "tick": 0, "hash": "0123456789abcdef" }] }
 *
 * A run file plays either a game (`game`, a game folder) or a world (`world`, a `*.world.json`
 * scenario played by `engine/sim` with the engine's systems; see `world-run.ts`), never both. A
 * world run takes no input and has no kit rules (`input`, `disableRules` and `guards` are schema
 * errors on it); its snapshot is the world's (`World.snapshot()`).
 *
 * Recorded orders (Engine 0.9, items 124-125, the OpenRA lockstep idea): `orders` lists
 * `{ tick, ...order }` entries in tick order (same-tick entries in ascending `id`); each is applied
 * after the state of its tick and before the step from it. On a world run every entry must be an
 * `engine/core/orders.ts` order (applied with `applyOrder`); on a game run it is handed to the
 * game's `order` method (`engine/core/headless.ts`). `hashes` are the sync hashes a recorded run
 * must give: `run` compares each with the state hash at its tick and fails at the first that
 * differs, so a replay that drifts names the tick.
 *
 * Missions (Engine 0.10, item 161): a world run's `missions` lists `{ tick, mission, action,
 * outcome?, experienceTicks? }` steps (`open`, `delegate`, `play`, `quit`), applied after the
 * orders of their tick; each mission's result commits by itself at its commit tick
 * (`world-run.ts`). From Engine 0.11 (item 172) a game run takes them too, `{ tick, mission,
 * action, input? }`, handed to the game's `mission` method (a `play` starts the real kit round,
 * with `input` its recorded script). A refused step is reported, as a refused order is.
 *
 * Campaigns (Engine 0.13, item 228): a game run's `from` starts it from another run's end (`run`,
 * played first) or a save code (`code`), at the campaign's next entry from tick 0, and `codes`
 * lists `{ tick, code }` save codes the game's campaign save must give (see "Campaign runs and save
 * codes" in this folder's CLAUDE.md). World runs take neither.
 *
 * Start (Engine 0.14, gap G9): a game run's `start` begins it at a later level (`{ stage }`) or
 * campaign entry (`{ entry }`), fresh, from tick 0, so a later level's run file does not replay
 * the earlier levels' input. The game must list it (`HeadlessEntry.starts`); not with `from`.
 *
 * Ticks: tick 0 is the state the game starts in; tick `t` is the state after `t` steps. The input
 * is `ScriptedInput` steps: each step holds its actions from input frame `frame` on, and frame `f`
 * is the input of the step from tick `f` to tick `f + 1`.
 */

/** The comparison a check makes between the value at its path (`actual`) and its `value`. */
export const CHECK_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains'] as const;
export type CheckOp = (typeof CHECK_OPS)[number];

/** What each op means, one line each, for help and docs. */
export const CHECK_OP_MEANINGS: Readonly<Record<CheckOp, string>> = {
  eq: 'actual equals value (deep, for arrays and objects)',
  ne: 'actual does not equal value',
  lt: 'actual < value (numbers)',
  lte: 'actual <= value (numbers)',
  gt: 'actual > value (numbers)',
  gte: 'actual >= value (numbers)',
  in: 'actual equals one of value (an array)',
  nin: 'actual equals none of value (an array)',
  contains: 'actual (an array) has an item equal to value, or actual (a string) contains value',
};

const checkFields = {
  path: z
    .string()
    .min(1)
    .describe('a dotted path into the snapshot: hero.hp, entities.0.kind, entities.length'),
  op: z.enum(CHECK_OPS).describe('the comparison: eq, ne, lt, lte, gt, gte, in, nin, contains'),
  value: z.json().describe('what the value at the path is compared with'),
};

const listOps: readonly CheckOp[] = ['in', 'nin'];
const numberOps: readonly CheckOp[] = ['lt', 'lte', 'gt', 'gte'];

/** `in` and `nin` take an array; `lt`... take a number. */
function checkValue(c: { op: CheckOp; value: JsonValue }, ctx: z.RefinementCtx): void {
  if (listOps.includes(c.op) && !Array.isArray(c.value))
    ctx.addIssue({ code: 'custom', path: ['value'], message: `"${c.op}" needs an array value` });
  if (numberOps.includes(c.op) && typeof c.value !== 'number')
    ctx.addIssue({ code: 'custom', path: ['value'], message: `"${c.op}" needs a number value` });
}

export const assertionSchema = z
  .strictObject({
    tick: z.number().int().min(0).describe('the tick the check is made at'),
    ...checkFields,
  })
  .superRefine(checkValue);

export const invariantSchema = z.strictObject(checkFields).superRefine(checkValue);

/** A state hash: 16 hex digits (`stateHash` in `headless-run.ts`). */
const tickHashSchema = z.strictObject({
  tick: z.number().int().min(0).describe('the tick the hash was taken at'),
  hash: z
    .string()
    .regex(/^[0-9a-f]{16}$/, 'a state hash is 16 lower-case hex digits')
    .describe('the state hash at that tick'),
});

/**
 * What a replay file adds to a run file (`replay.ts`): where it came from, the check that failed,
 * and the state hashes the source run gave up to the failing tick. `run` checks those hashes.
 */
export const replaySchema = z.strictObject({
  source: z.string().min(1).describe('the run file that failed, relative to the replay file'),
  failure: z
    .strictObject({
      tick: z.number().int().min(0).describe('the first failing tick'),
      kind: z
        .enum(['assertion', 'invariant', 'code'])
        .describe('which list the failed check is in (`code`: a save code in `codes`)'),
      path: checkFields.path,
      op: checkFields.op,
      expected: z.json().describe("the check's value"),
      message: z.string().describe('why it failed, as the source run reported it'),
    })
    .describe('the first check that failed in the source run'),
  hashes: z.array(tickHashSchema).describe('the state hashes of the source run, up to the failing tick'),
});

/**
 * One recorded order: `tick` plus the order's own fields (a world run's are checked against
 * `orderSchema` in `runFileSchema`; a game's are the game's business).
 */
export const orderEntrySchema = z.looseObject({
  tick: z
    .number()
    .int()
    .min(0)
    .describe("the tick the order applies at: after that tick's state, before the step from it"),
  id: z
    .number()
    .int()
    .min(1)
    .exactOptional()
    .describe('the order number (required on a world run): unique, ascending within a tick'),
});

/** Scripted input: `ScriptedInput` steps (a run's input, or a played mission round's). */
export const scriptedInputSchema = z.strictObject({
  steps: z
    .array(
      z.strictObject({
        frame: z.number().int().min(0).describe('the input frame the hold starts at'),
        hold: z.array(z.enum(Actions)).describe('the actions held from that frame on'),
      }),
    )
    .describe('each step holds its actions from its frame until the next step'),
});

/** What a mission entry does (Engine 0.10, item 161): open, delegate, play or quit a mission. */
export const MISSION_ACTIONS = ['open', 'delegate', 'play', 'quit'] as const;
export type MissionAction = (typeof MISSION_ACTIONS)[number];

/**
 * One mission step (`missions`): applied after the state of `tick` and that tick's orders, before
 * the step from it, in file order. On a world run the mission's definition is the
 * `<mission>.mission.json` file beside the world scenario (or in a `missions/` folder there) and a
 * `play` names its `outcome`; on a game run (Engine 0.11, item 172) the step goes to the game's
 * `mission` method and a `play` may carry the round's recorded `input` instead.
 */
export const missionEntrySchema = z.strictObject({
  tick: z
    .number()
    .int()
    .min(0)
    .describe("the tick it applies at: after that tick's state and orders, before the step from it"),
  mission: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'a mission id is lower-case letters, digits and "-"')
    .describe(
      "the mission id: on a world run its definition is <id>.mission.json beside the world scenario; on a game run one of the game's missions",
    ),
  action: z
    .enum(MISSION_ACTIONS)
    .describe(
      '`open` (freezes its event, fixes its commit tick), `delegate` (an outcome drawn by weight, seeded from the world seed and the mission id), `play` (world run: the outcome chosen; game run: the real kit round, played until it ends) or `quit` (its `onQuit` outcome); the commit comes by itself at the commit tick',
    ),
  outcome: z
    .string()
    .min(1)
    .exactOptional()
    .describe('world runs, `play` only, required there: the outcome the played round reached'),
  experienceTicks: z
    .number()
    .int()
    .min(0)
    .exactOptional()
    .describe(
      'world runs, `play` and `quit` only: ticks spent inside the stand-in round; reported in the result, never moving the world',
    ),
  input: scriptedInputSchema
    .exactOptional()
    .describe(
      "game runs, `play` only: the round's recorded input (ScriptedInput steps, frame 0 the round's first tick); left out, the round reads the run's input",
    ),
});

/**
 * Where a game run starts (Engine 0.13, decision 9, item 228): exactly one of another run's end
 * (`run`, a run file relative to this one, played first) and a save code (`code`).
 */
export const runFromSchema = z
  .strictObject({
    run: z
      .string()
      .min(1)
      .regex(/\.run\.json$/, 'a run file ends in .run.json')
      .exactOptional()
      .describe(
        "a run file of the same game, relative to this one: it is played first, and this run starts from its campaign save at its last tick (the campaign's next entry)",
      ),
    code: z
      .string()
      .min(1)
      .exactOptional()
      .describe('a save code (`pnpm cli code`): this run starts from the campaign save it packs'),
  })
  .superRefine((from, ctx) => {
    if ((from.run === undefined) === (from.code === undefined))
      ctx.addIssue({ code: 'custom', path: [], message: 'give exactly one of "run" and "code"' });
  });

/**
 * Where a game run starts (Engine 0.14, gap G9, decision 6): exactly one of a stage of the game's
 * level sequence (`stage`, 0-based like the platformer kit's snapshot `stage`) and a campaign entry
 * by id (`entry`, played fresh: no carried record). Tick 0 is that level's or entry's first state.
 */
export const runStartSchema = z
  .strictObject({
    stage: z
      .number()
      .int()
      .min(0)
      .exactOptional()
      .describe(
        "a level of the game's level sequence, 0-based as the snapshot's `stage`: the run starts at that level, fresh, from tick 0",
      ),
    entry: z
      .string()
      .min(1)
      .exactOptional()
      .describe(
        "a campaign entry's id: the run starts at that entry, fresh (its own start, no carried record), from tick 0",
      ),
  })
  .superRefine((start, ctx) => {
    if ((start.stage === undefined) === (start.entry === undefined))
      ctx.addIssue({ code: 'custom', path: [], message: 'give exactly one of "stage" and "entry"' });
  });

/** A run file's `start` as `HeadlessOptions.start` takes it (undefined without one). */
export function runStartOf(start: z.output<typeof runStartSchema> | undefined): RunStart | undefined {
  if (start === undefined) return undefined;
  return start.stage !== undefined ? { stage: start.stage } : { entry: start.entry as string };
}

/** A save code a game run's campaign save must give at a tick (Engine 0.13, decision 9). */
export const codeEntrySchema = z.strictObject({
  tick: z.number().int().min(0).describe('the tick the save code is taken at'),
  code: z.string().min(1).describe('the save code expected there (case, dashes and spaces do not matter)'),
});

export const runFileSchema = z
  .strictObject({
    game: z
      .string()
      .min(1)
      .exactOptional()
      .describe('the game folder, relative to the run file (".." for games/<g>/runs/); give this or `world`'),
    world: z
      .string()
      .min(1)
      .regex(/\.world\.json$/, 'a world is a scenario file ending in .world.json')
      .exactOptional()
      .describe(
        'a world scenario (*.world.json, engine/sim), relative to the run file, played instead of a game; give this or `game`',
      ),
    seed: z
      .number()
      .int()
      .min(0)
      .exactOptional()
      .describe(
        "the world's seed; the manifest's start.seed (or the scenario's seed) if left out; with `from`, the save's seed, and another is a `seed_mismatch` error",
      ),
    ticks: z.number().int().min(1).max(1_000_000).describe('how many steps the run plays'),
    input: scriptedInputSchema.default({ steps: [] }).describe('the scripted input (ScriptedInput steps)'),
    assertions: z.array(assertionSchema).default([]).describe('checks made at one tick each'),
    invariants: z.array(invariantSchema).default([]).describe('checks made at every tick, 0 included'),
    hashEvery: z
      .number()
      .int()
      .min(1)
      .default(60)
      .describe('a state hash every this many ticks (tick 0 and the last tick always get one)'),
    disableRules: z
      .array(z.string().min(1))
      .default([])
      .describe("kit rules switched off for this run (ids from the kit's rule list; see `mutants`)"),
    guards: z
      .array(z.string().min(1))
      .exactOptional()
      .describe(
        "the kit rules this run is meant to guard (ids from the kit's rule list); `mutants` checks these, or every rule when left out",
      ),
    orders: z
      .array(orderEntrySchema)
      .default([])
      .describe(
        "recorded orders, `{ tick, ...order }` in tick order, applied before the step from their tick (world runs: engine/core orders; game runs: the game's `order` method)",
      ),
    missions: z
      .array(missionEntrySchema)
      .default([])
      .describe(
        "mission steps, `{ tick, mission, action, ... }` in tick order, applied after the tick's orders, before the step from it (world runs: `outcome?`, `experienceTicks?`; game runs: the game's `mission` method, `input?` on a `play`)",
      ),
    hashes: z
      .array(tickHashSchema)
      .exactOptional()
      .describe(
        'sync hashes the run must give, in tick order: `run` fails at the first tick whose state hash differs',
      ),
    from: runFromSchema
      .exactOptional()
      .describe(
        "game runs (Engine 0.13): start from another run's end or a save code, at the campaign's next entry, from tick 0",
      ),
    start: runStartSchema
      .exactOptional()
      .describe(
        "game runs (Engine 0.14): start at a later level (`{ stage }`, 0-based) or campaign entry (`{ entry }`), fresh, from tick 0, instead of the game's first; not with `from`",
      ),
    codes: z
      .array(codeEntrySchema)
      .exactOptional()
      .describe(
        "game runs (Engine 0.13): save codes the game's campaign save must give, `{ tick, code }` in tick order; `run` fails at the first that differs",
      ),
    replay: replaySchema
      .exactOptional()
      .describe('only in replay files: the source run, its failing check and its hashes'),
  })
  .superRefine((run, ctx) => {
    if (run.game === undefined && run.world === undefined)
      ctx.addIssue({
        code: 'custom',
        path: [],
        message:
          'a run file needs exactly one of "game" (a game folder) or "world" (a *.world.json scenario)',
      });
    if (run.game !== undefined && run.world !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['world'],
        message: 'a run file gives "game" or "world", not both',
      });
    if (run.world !== undefined) {
      // A world has no input and no kit (Engine 0.8): say so rather than ignore what was asked.
      if (run.input.steps.length > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['input', 'steps'],
          message: 'a world run takes no input (a world is driven by "orders"): leave "input" out',
        });
      if (run.disableRules.length > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['disableRules'],
          message: 'a world run has no kit rules to switch off: leave "disableRules" out',
        });
      if (run.guards !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['guards'],
          message: 'a world run has no kit rules to guard: leave "guards" out',
        });
      for (const field of ['from', 'codes', 'start'] as const)
        if (run[field] !== undefined)
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `a world run plays no campaign or levels: "${field}" is for game runs`,
          });
    }
    if (run.start !== undefined && run.from !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['start'],
        message: 'give "start" or "from", not both: "from" already names where the run starts',
      });
    run.disableRules.forEach((id, i) => {
      if (run.disableRules.indexOf(id) !== i)
        ctx.addIssue({
          code: 'custom',
          path: ['disableRules', i],
          message: `rule "${id}" is listed twice`,
        });
    });
    run.guards?.forEach((id, i, guards) => {
      if (guards.indexOf(id) !== i)
        ctx.addIssue({ code: 'custom', path: ['guards', i], message: `rule "${id}" is listed twice` });
      else if (run.disableRules.includes(id))
        ctx.addIssue({
          code: 'custom',
          path: ['guards', i],
          message: `rule "${id}" is in disableRules: a run cannot guard a rule it switches off`,
        });
    });
    run.assertions.forEach((a, i) => {
      if (a.tick > run.ticks)
        ctx.addIssue({
          code: 'custom',
          path: ['assertions', i, 'tick'],
          message: `tick ${a.tick} is after the run's last tick (${run.ticks})`,
        });
    });
    checkOrders(run, ctx);
    checkMissions(run, ctx);
    run.codes?.forEach((c, i, codes) => {
      if (c.tick > run.ticks)
        ctx.addIssue({
          code: 'custom',
          path: ['codes', i, 'tick'],
          message: `tick ${c.tick} is after the run's last tick (${run.ticks})`,
        });
      else if (i > 0 && c.tick <= codes[i - 1]!.tick)
        ctx.addIssue({
          code: 'custom',
          path: ['codes', i, 'tick'],
          message: `codes must be in tick order, one per tick (tick ${c.tick} after ${codes[i - 1]!.tick})`,
        });
    });
    run.hashes?.forEach((h, i, hashes) => {
      if (h.tick > run.ticks)
        ctx.addIssue({
          code: 'custom',
          path: ['hashes', i, 'tick'],
          message: `tick ${h.tick} is after the run's last tick (${run.ticks})`,
        });
      else if (i > 0 && h.tick <= hashes[i - 1]!.tick)
        ctx.addIssue({
          code: 'custom',
          path: ['hashes', i, 'tick'],
          message: `hashes must be in tick order, one per tick: tick ${h.tick} comes after tick ${hashes[i - 1]!.tick}`,
        });
    });
    run.replay?.hashes.forEach((h, i) => {
      if (h.tick > run.ticks)
        ctx.addIssue({
          code: 'custom',
          path: ['replay', 'hashes', i, 'tick'],
          message: `tick ${h.tick} is after the run's last tick (${run.ticks})`,
        });
    });
  });

/** `ctx.addIssue` at `path`, as the schema's refinements do. */
type IssueSink = Pick<z.RefinementCtx, 'addIssue'>;

/**
 * The checks on `orders` the shape alone cannot make: tick order, a tick the run plays a step
 * from, ids unique and ascending within a tick, and on a world run every entry an order.
 */
function checkOrders(
  run: { world?: string; ticks: number; orders: { tick: number; id?: number }[] },
  ctx: IssueSink,
): void {
  const seen = new Set<number>();
  run.orders.forEach((entry, i) => {
    const prev = i > 0 ? run.orders[i - 1] : undefined;
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path: ['orders', i, ...path], message });
    if (prev !== undefined && entry.tick < prev.tick)
      issue(['tick'], `orders must be in tick order: tick ${entry.tick} comes after tick ${prev.tick}`);
    if (entry.tick >= run.ticks)
      issue(
        ['tick'],
        `tick ${entry.tick} is not before the run's last tick (${run.ticks}): an order applies before the step from its tick`,
      );
    if (entry.id !== undefined) {
      if (seen.has(entry.id)) issue(['id'], `order id ${entry.id} is used twice`);
      else if (prev?.id !== undefined && prev.tick === entry.tick && entry.id < prev.id)
        issue(['id'], `orders of one tick must be in id order: id ${entry.id} comes after id ${prev.id}`);
      seen.add(entry.id);
    }
    if (run.world !== undefined) {
      const { tick: _tick, ...order } = entry;
      const parsed = orderSchema.safeParse(order);
      if (!parsed.success)
        for (const bad of parsed.error.issues)
          issue(
            bad.path as (string | number)[],
            `${bad.message} (a world run's orders are engine/core orders)`,
          );
    }
  });
}

/**
 * The checks on `missions` the shape alone cannot make: tick order, a tick the run plays a step
 * from, and the fields of each kind of run. On a world run `outcome` exactly on `play`,
 * `experienceTicks` only on a played path, no `input`; on a game run (item 172) no `outcome` or
 * `experienceTicks` (the round gives both) and `input` only on `play`.
 */
function checkMissions(
  run: { world?: string; ticks: number; missions: z.output<typeof missionEntrySchema>[] },
  ctx: IssueSink,
): void {
  const world = run.world !== undefined;
  run.missions.forEach((entry, i) => {
    const prev = i > 0 ? run.missions[i - 1] : undefined;
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path: ['missions', i, ...path], message });
    if (prev !== undefined && entry.tick < prev.tick)
      issue(['tick'], `missions must be in tick order: tick ${entry.tick} comes after tick ${prev.tick}`);
    if (entry.tick >= run.ticks)
      issue(
        ['tick'],
        `tick ${entry.tick} is not before the run's last tick (${run.ticks}): a mission step applies before the step from its tick`,
      );
    if (world) {
      if (entry.action === 'play' && entry.outcome === undefined)
        issue(['outcome'], 'a "play" entry needs the outcome the played round reached');
      if (entry.action !== 'play' && entry.outcome !== undefined)
        issue(['outcome'], `only a "play" entry takes an outcome, not "${entry.action}"`);
      if (entry.experienceTicks !== undefined && entry.action !== 'play' && entry.action !== 'quit')
        issue(['experienceTicks'], `only "play" and "quit" spend experience ticks, not "${entry.action}"`);
      if (entry.input !== undefined)
        issue(
          ['input'],
          'a world run plays no round: "input" is for a game run\'s "play" (a world run\'s "play" names its "outcome")',
        );
      return;
    }
    if (entry.outcome !== undefined)
      issue(
        ['outcome'],
        'a game run plays the real round: its outcome comes from the round, leave "outcome" out',
      );
    if (entry.experienceTicks !== undefined)
      issue(
        ['experienceTicks'],
        'a game run plays the real round: its experience ticks are the round\'s, leave "experienceTicks" out',
      );
    if (entry.input !== undefined && entry.action !== 'play')
      issue(['input'], `only a "play" entry carries the round's input, not "${entry.action}"`);
  });
}

export type MissionEntry = z.output<typeof missionEntrySchema>;
export type RunFile = z.output<typeof runFileSchema>;
export type OrderEntry = z.output<typeof orderEntrySchema>;
export type Replay = z.output<typeof replaySchema>;
export type Assertion = z.output<typeof assertionSchema>;
export type Invariant = z.output<typeof invariantSchema>;

export interface LoadedRunFile {
  /** The run file as given, relative to the working folder, with `/`. */
  file: string;
  /** The game folder, relative to the working folder, with `/` (null for a world run). */
  gameDir: string | null;
  /** The world scenario, relative to the working folder, with `/` (null for a game run). */
  worldFile: string | null;
  /** The run file `from.run` names, relative to the working folder, with `/` (null without one). */
  fromRun: string | null;
  run: RunFile;
}

/**
 * Reads and checks a run file. A file that is not there is a usage error; a file that breaks the
 * schema comes back as content errors naming the file and the field.
 */
export function readRunFile(
  cwd: string,
  path: string,
): { ok: true; value: LoadedRunFile } | { ok: false; errors: ContentError[] } {
  const abs = resolve(cwd, path);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new UsageError(`no run file at ${path}`);
  const file = relative(cwd, abs).replaceAll('\\', '/');
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [contentError(file, [], 'invalid_json', message)] };
  }
  const result = validate(file, data, runFileSchema);
  if (!result.ok) return { ok: false, errors: result.errors };
  const fromCwd = (path: string | undefined) =>
    path === undefined ? null : relative(cwd, resolve(dirname(abs), path)).replaceAll('\\', '/') || '.';
  const gameDir = fromCwd(result.value.game);
  const worldFile = fromCwd(result.value.world);
  const fromRun = fromCwd(result.value.from?.run);
  return { ok: true, value: { file, gameDir, worldFile, fromRun, run: result.value } };
}

/** The value at a dotted path (`hero.hp`, `entities.0.kind`, `entities.length`), or `undefined`. */
export function valueAt(state: JsonValue, path: string): JsonValue | undefined {
  let at: JsonValue | undefined = state;
  for (const key of path.split('.')) {
    if (Array.isArray(at)) {
      if (key === 'length') at = at.length;
      else if (/^\d+$/.test(key)) at = at[Number(key)];
      else return undefined;
    } else if (at !== null && typeof at === 'object' && Object.hasOwn(at, key)) at = at[key];
    else return undefined;
  }
  return at;
}

const same = (a: JsonValue, b: JsonValue) => canonicalJson(a) === canonicalJson(b);

/**
 * Makes one check against a snapshot. Returns null when it holds, or why it fails. A path that is
 * not in the snapshot always fails (so a typo cannot pass a `ne`).
 */
export function failsCheck(
  state: JsonValue,
  check: { path: string; op: CheckOp; value: JsonValue },
): { actual: JsonValue | null; message: string } | null {
  const actual = valueAt(state, check.path);
  if (actual === undefined) return { actual: null, message: `no value at "${check.path}"` };
  const want = check.value;
  const show = (v: JsonValue) => JSON.stringify(v);
  const fail = (what: string) => ({ actual, message: `${check.path} is ${show(actual)}, ${what}` });
  switch (check.op) {
    case 'eq':
      return same(actual, want) ? null : fail(`expected ${show(want)}`);
    case 'ne':
      return same(actual, want) ? fail(`expected anything but ${show(want)}`) : null;
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      if (typeof actual !== 'number') return fail(`not a number (expected ${check.op} ${show(want)})`);
      const n = want as number;
      const ok =
        check.op === 'lt'
          ? actual < n
          : check.op === 'lte'
            ? actual <= n
            : check.op === 'gt'
              ? actual > n
              : actual >= n;
      return ok ? null : fail(`expected ${check.op} ${show(want)}`);
    }
    case 'in':
    case 'nin': {
      const found = (want as JsonValue[]).some((v) => same(actual, v));
      if (check.op === 'in') return found ? null : fail(`expected one of ${show(want)}`);
      return found ? fail(`expected none of ${show(want)}`) : null;
    }
    case 'contains':
      if (Array.isArray(actual))
        return actual.some((v) => same(v, want)) ? null : fail(`expected it to contain ${show(want)}`);
      if (typeof actual === 'string' && typeof want === 'string')
        return actual.includes(want) ? null : fail(`expected it to contain ${show(want)}`);
      return fail(`not an array or string (expected it to contain ${show(want)})`);
  }
}
