import { z } from 'zod';
import type { FieldPath } from '@engine/core/content/validate';
import { addGridIssues, gridProblems } from '@engine/core/content/text-grid';
import { LEGEND, legendEntry } from './legend';
import type { ProfileDef } from './profile';

/**
 * Level files: a JSON header plus its map in a sibling text grid, `levels/1-1.json` and
 * `levels/1-1.map.txt`, one character per 16x16 tile from the kit's `LEGEND` (`legend.ts`) and the
 * header's own spawn characters.
 *
 *   levels/1-1.json      { "id": "1-1", "profile": "runner", "scroll": "right",
 *                          "spawns": { "w": { "actor": "walker" } }, "blocks": ["coin"] }
 *   levels/1-1.map.txt   ..........G
 *                        ...?......#
 *                        .@...w....#
 *                        ####..#####
 *
 * The level's size comes from the grid; a header `size` must match it. Beyond the shape, a level
 * must have exactly one start, at least one goal, a profile that is there and spawns whose actor
 * types that profile defines: `checkLevel`, which the kind's `checkAll` runs once every file
 * passes its schema.
 */

/** What a bump block can hold: a coin, several coins, a power-up, an extra life or an actor type. */
export const BLOCK_CONTENTS = /^(coin|coins|powerup|life|actor:[a-z][a-z0-9-]*)$/;

/**
 * What a mini game's result does to the level, in order: `coins:<n>` gives n coins, `life` a life,
 * `clear` ends the level as cleared, `respawn` puts the player back on the trigger, standing, and
 * `open:<col>:<row>` empties that tile (a gate). An empty list does nothing.
 */
export const TRIGGER_OUTCOMES = /^(coins:[1-9][0-9]*|life|clear|respawn|open:[0-9]+:[0-9]+)$/;

const outcomes = (what: string) =>
  z
    .array(z.string().regex(TRIGGER_OUTCOMES))
    .default([])
    .describe(
      `what a ${what} does, in order: coins:<n>, life, clear, respawn (on the trigger) or open:<col>:<row>; nothing when left out`,
    );

const trigger = z.strictObject({
  game: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .describe('the id of the mini game it starts, one the game supplies'),
  params: z
    .record(z.string(), z.json())
    .default({})
    .describe("data for the mini game's round (its MiniGameContext.params)"),
  pass: outcomes('pass'),
  fail: outcomes('fail'),
  quit: outcomes('quit'),
  look: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .exactOptional()
    .describe(
      "how it looks (Engine 0.11, gap G13): presented as the tag `look:<id>` on the trigger's entity, for a skin's `byTag`; left out, no tag",
    ),
});

const spawn = z.strictObject({
  actor: z.string().min(1).describe("the actor type it spawns, defined in the level's profile"),
  facing: z.enum(['left', 'right']).default('left').describe('the way it starts moving'),
});

export const levelSchema = z
  .strictObject({
    id: z.string().min(1).describe('the level id: its file name'),
    profile: z.string().min(1).describe('the physics profile it is played with: a `profile` id'),
    scroll: z
      .enum(['right', 'free', 'none'])
      .default('right')
      .describe('`right`: the camera only scrolls forward; `free`: both ways; `none`: it never scrolls'),
    size: z
      .tuple([z.number().int().min(1), z.number().int().min(1)])
      .exactOptional()
      .describe('[columns, rows]; the size comes from the grid, and a size given here must match it'),
    clear: z
      .enum(['goal', 'boss'])
      .exactOptional()
      .describe(
        "`goal` (left out): a goal tile clears the level; `boss` (Engine 0.16 T2): so does the end of the last boss's defeat sequence, and the map needs no goal",
      ),
    spawns: z
      .record(z.string(), spawn)
      .default({})
      .describe('spawn characters of the map (one character, not a legend one) by the actor they spawn'),
    blocks: z
      .array(z.string().regex(BLOCK_CONTENTS))
      .exactOptional()
      .describe(
        'what each bump block (?) holds, in reading order: coin, coins, powerup, life or actor:<type>; all coins when left out',
      ),
    triggers: z
      .array(trigger)
      .default([])
      .describe(
        'what each mini-game trigger (!) starts, in reading order: the mini game id, its params and the outcome of each result',
      ),
    map: z
      .array(z.string())
      .describe(
        'the level grid, top row first, of legend and spawn characters; usually in the `.map.txt` file',
      ),
  })
  .superRefine((def, ctx) => {
    const issue = (path: PropertyKey[], code: string, message: string) =>
      ctx.addIssue({ code: 'custom', path, message, params: { code } });
    for (const key of Object.keys(def.spawns)) {
      if ([...key].length !== 1 || /\s/.test(key))
        issue(['spawns', key], 'bad_spawn_key', `spawn key "${key}" must be one character, not a space`);
      else if (legendEntry(key) !== undefined)
        issue(['spawns', key], 'bad_spawn_key', `"${key}" is a legend character (${LEGEND[key]!.meaning})`);
    }
    const chars = new Set([...Object.keys(LEGEND), ...Object.keys(def.spawns)]);
    addGridIssues(ctx, def.map, chars, ['map']);
    if (gridProblems(def.map, chars).length > 0) return;
    const cols = [...def.map[0]!].length;
    const rows = def.map.length;
    if (def.size && (def.size[0] !== cols || def.size[1] !== rows))
      issue(['size'], 'size_mismatch', `size is ${def.size.join('x')} but the map is ${cols}x${rows}`);
    const bumps = def.map.reduce((n, row) => n + [...row].filter((c) => c === '?').length, 0);
    if (def.blocks && def.blocks.length !== bumps)
      issue(
        ['blocks'],
        'wrong_block_count',
        `${def.blocks.length} block contents for ${bumps} bump blocks (?)`,
      );
    const triggers = def.map.reduce((n, row) => n + [...row].filter((c) => c === '!').length, 0);
    if (def.triggers.length !== triggers)
      issue(
        ['triggers'],
        'wrong_trigger_count',
        `${def.triggers.length} trigger entries for ${triggers} mini-game triggers (!)`,
      );
    def.triggers.forEach((t, i) => {
      for (const result of ['pass', 'fail', 'quit'] as const) {
        t[result].forEach((o, j) => {
          const m = /^open:(\d+):(\d+)$/.exec(o);
          if (m && (Number(m[1]) >= cols || Number(m[2]) >= rows))
            issue(['triggers', i, result, j], 'bad_outcome', `"${o}" is outside the ${cols}x${rows} map`);
        });
      }
    });
  });

export type LevelDef = z.output<typeof levelSchema>;
/** One entry of a level's `triggers`: what a mini-game trigger (!) starts and what results do. */
export type LevelTrigger = LevelDef['triggers'][number];

/** One cell of a level's map. */
export interface LevelCell {
  row: number;
  col: number;
  ch: string;
}

/** Every cell of the map, in reading order. */
export function levelCells(level: Pick<LevelDef, 'map'>): LevelCell[] {
  const out: LevelCell[] = [];
  level.map.forEach((line, row) => [...line].forEach((ch, col) => out.push({ row, col, ch })));
  return out;
}

/** The level's size in tiles, from its grid. */
export function levelSize(level: Pick<LevelDef, 'map'>): { cols: number; rows: number } {
  return { cols: [...(level.map[0] ?? '')].length, rows: level.map.length };
}

/** A problem `checkLevel` finds: at a header field, or at a map row (with its row and col). */
export interface LevelProblem {
  path: FieldPath;
  code: string;
  message: string;
  row?: number;
  col?: number;
}

/**
 * What a level needs beyond its shape: exactly one start (`two_starts` at each extra one, `no_start`),
 * at least one goal (`no_goal`; not with `"clear": "boss"`, which needs a boss spawn on the map
 * instead: `no_boss`), every checkpoint (`K`) on ground to respawn on: a solid or one-way
 * tile under it, so not in the bottom row (`checkpoint_no_ground`, at the cell), its profile
 * (`missing_profile`, when `profile` is undefined), and
 * every spawn and block actor naming one of the profile's actor types (`unknown_actor`, at each map
 * cell that uses the spawn, or at the header field when no cell does).
 */
export function checkLevel(level: LevelDef, profile: ProfileDef | undefined): LevelProblem[] {
  const problems: LevelProblem[] = [];
  const at = (cell: LevelCell, code: string, message: string) =>
    problems.push({ path: ['map', cell.row], code, message, row: cell.row, col: cell.col });
  const cells = levelCells(level);
  const starts = cells.filter((c) => legendEntry(c.ch)?.cell === 'start');
  if (starts.length === 0)
    problems.push({ path: ['map'], code: 'no_start', message: 'the map has no player start (@)' });
  for (const extra of starts.slice(1)) {
    const first = starts[0]!;
    at(extra, 'two_starts', `a second player start (@); the first is at row ${first.row} col ${first.col}`);
  }
  if (level.clear !== 'boss' && !cells.some((c) => legendEntry(c.ch)?.cell === 'goal'))
    problems.push({ path: ['map'], code: 'no_goal', message: 'the map has no goal (G)' });
  for (const c of cells) {
    if (legendEntry(c.ch)?.cell !== 'checkpoint') continue;
    const below = level.map[c.row + 1] === undefined ? undefined : [...level.map[c.row + 1]!][c.col];
    const ground = below === undefined ? 'empty' : (legendEntry(below)?.collision ?? 'empty');
    if (ground === 'empty')
      at(c, 'checkpoint_no_ground', 'a checkpoint (K) needs a solid or one-way tile under it to respawn on');
  }
  if (profile === undefined) {
    const msg = `no profile "${level.profile}": add ${level.profile}.profile.json, or name a profile the game has`;
    problems.push({ path: ['profile'], code: 'missing_profile', message: msg });
    return problems;
  }
  const known = Object.keys(profile.actors);
  const unknown = (actor: string) =>
    `"${actor}" is not an actor type of profile "${profile.id}" (known: ${known.join(', ') || 'none'})`;
  for (const [key, s] of Object.entries(level.spawns)) {
    if (Object.hasOwn(profile.actors, s.actor)) continue;
    const used = cells.filter((c) => c.ch === key);
    if (used.length === 0)
      problems.push({ path: ['spawns', key, 'actor'], code: 'unknown_actor', message: unknown(s.actor) });
    for (const cell of used) at(cell, 'unknown_actor', `spawn "${key}": ${unknown(s.actor)}`);
  }
  if (level.clear === 'boss') {
    const bossSpawn = Object.entries(level.spawns).some(
      ([key, s]) => profile.actors[s.actor]?.boss !== undefined && cells.some((c) => c.ch === key),
    );
    if (!bossSpawn)
      problems.push({
        path: ['clear'],
        code: 'no_boss',
        message:
          'a level cleared by its boss ("clear": "boss") needs a spawn of a boss actor type on its map',
      });
  }
  (level.blocks ?? []).forEach((b, i) => {
    const actor = b.startsWith('actor:') ? b.slice('actor:'.length) : undefined;
    if (actor !== undefined && !Object.hasOwn(profile.actors, actor))
      problems.push({ path: ['blocks', i], code: 'unknown_actor', message: unknown(actor) });
  });
  return problems;
}
