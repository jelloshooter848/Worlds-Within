import { z } from 'zod';
import { changeSchema, timelineSchema } from '@engine/sim/index';

/**
 * Dump files (Engine 0.14 T7; docs/BUILD-LOG.md, Engine 0.14, decision 2, item 248): what
 * `dump <run-file> --tick N --out <file>` writes, a still picture of one tick for the debugger. No
 * Node imports, so the debugger page reads it with the same schema (`dumpFileSchema`,
 * `parseDumpFile`).
 *
 * `run`, `game` and `world` are relative to the dump file's folder (as a replay file's `game` is),
 * so the file can be moved with its run; `events` is the world's kept event log up to `tick` and
 * `timeline` the timeline record there (`engine/sim/timeline.ts`), both null for a game with no
 * world (a platformer).
 */

export const DUMP_FORMAT = 'worlds-within/dump';
export const DUMP_VERSION = 1;

const Tick = z.int().min(0);

/** The kept event log a dump holds (`HeadlessGame.worldEvents(0)` at the dump's tick). */
export const dumpEventsSchema = z.strictObject({
  from: Tick.describe('the oldest world tick the log still keeps'),
  tick: Tick.describe('the world tick at the dump'),
  changes: z.array(changeSchema).describe('the kept changes, oldest first'),
});

/** The shape of a dump file. */
export const dumpFileSchema = z.strictObject({
  format: z.literal(DUMP_FORMAT).describe('always `worlds-within/dump`'),
  version: z.literal(DUMP_VERSION).describe('the dump format version'),
  run: z.string().min(1).describe('the run file it was played from, relative to the dump file'),
  game: z.string().nullable().describe('the game folder, relative to the dump file (null for a world run)'),
  world: z
    .string()
    .nullable()
    .describe('the world scenario, relative to the dump file (null for a game run)'),
  seed: z.int().describe('the seed the run used'),
  start: z
    .union([z.strictObject({ stage: Tick }), z.strictObject({ entry: z.string() })])
    .nullable()
    .describe("the run file's start (a stage or campaign entry), or null"),
  tick: Tick.describe('the game (or world run) tick shown'),
  hash: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .describe('the state hash at that tick'),
  state: z.record(z.string(), z.json()).describe('the whole snapshot at that tick'),
  orders: z.array(z.record(z.string(), z.json())).describe('the recorded orders applied before the tick'),
  missions: z.array(z.record(z.string(), z.json())).describe('the mission steps applied before the tick'),
  events: dumpEventsSchema.nullable().describe("the world's kept event log up to the tick (null: no world)"),
  timeline: timelineSchema.nullable().describe('the timeline record at the tick (null: no world)'),
});

export type DumpFile = z.infer<typeof dumpFileSchema>;

/**
 * A dump file's text as a `DumpFile`, or one line per problem (`path: message`). Never throws.
 */
export function parseDumpFile(text: string): { ok: true; dump: DumpFile } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`not JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const parsed = dumpFileSchema.safeParse(json);
  if (parsed.success) return { ok: true, dump: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(file)'}: ${i.message}`),
  };
}
