import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { z } from 'zod';
import { Actions } from '@engine/core/input/actions';
import { canonicalJson, type JsonValue } from '@engine/core/headless';
import { contentError, validate, type ContentError } from '@engine/core/content/validate';
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
 *     "guards": ["doors-change-room"] }
 *
 * A run file plays either a game (`game`, a game folder) or a world (`world`, a `*.world.json`
 * scenario played by `engine/sim` with the engine's systems; see `world-run.ts`), never both. A
 * world run takes no input and has no kit rules (`input`, `disableRules` and `guards` are schema
 * errors on it); its snapshot is the world's (`World.snapshot()`).
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
      kind: z.enum(['assertion', 'invariant']).describe('which list the failed check is in'),
      path: checkFields.path,
      op: checkFields.op,
      expected: z.json().describe("the check's value"),
      message: z.string().describe('why it failed, as the source run reported it'),
    })
    .describe('the first check that failed in the source run'),
  hashes: z.array(tickHashSchema).describe('the state hashes of the source run, up to the failing tick'),
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
      .describe("the world's seed; the manifest's start.seed (or the scenario's seed) if left out"),
    ticks: z.number().int().min(1).max(1_000_000).describe('how many steps the run plays'),
    input: z
      .strictObject({
        steps: z
          .array(
            z.strictObject({
              frame: z.number().int().min(0).describe('the input frame the hold starts at'),
              hold: z.array(z.enum(Actions)).describe('the actions held from that frame on'),
            }),
          )
          .describe('each step holds its actions from its frame until the next step'),
      })
      .default({ steps: [] })
      .describe('the scripted input (ScriptedInput steps)'),
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
          message: 'a world run takes no input (a world has no input in Engine 0.8): leave "input" out',
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
    }
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
    run.replay?.hashes.forEach((h, i) => {
      if (h.tick > run.ticks)
        ctx.addIssue({
          code: 'custom',
          path: ['replay', 'hashes', i, 'tick'],
          message: `tick ${h.tick} is after the run's last tick (${run.ticks})`,
        });
    });
  });

export type RunFile = z.output<typeof runFileSchema>;
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
  return { ok: true, value: { file, gameDir, worldFile, run: result.value } };
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
