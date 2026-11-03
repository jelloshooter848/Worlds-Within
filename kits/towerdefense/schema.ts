import { z } from 'zod';
import type { ContentKind, ContentLookup, KindIssue } from '@engine/core/content/kinds';
import { addGridIssues, gridProblems } from '@engine/core/content/text-grid';
import { CELL_KINDS, cellKinds, LEGEND, tracePath, type CellKind } from './map';

/**
 * The tower-defense kit's content kinds (docs/BUILD-LOG.md, Engine 0.12, decision 2, item 198):
 *
 * - `td-map`: a JSON header plus its `map` in a sibling `.map.txt` text grid (as the platformer's
 *   `level`): the cells (`map.ts`: path from one entry to one exit, build cells, blocked ground),
 *   the starting gold and lives, the tower types the map allows and the wave list it plays.
 *
 *     maps/meadow.json      { "id": "meadow", "start": { "gold": 50, "lives": 5 },
 *                             "towers": ["arrow"], "waves": "meadow" }
 *     maps/meadow.map.txt   S##.
 *                           .B#.
 *                           ..#X
 *
 * - `td-towers`: one file holding a table of tower types (`cost`, `range`, `damage`, `cooldown`,
 *   `sell?`), like `rts-types`. A game may split the table over several files; a type given twice
 *   is `duplicate_tower`.
 * - `td-waves`: one wave list per file (its `id` is the file name a map's `waves` gives), each wave
 *   a list of enemy groups `{ kind, count, spacing, hp, speed, bounty, jitter? }` in file order,
 *   and an optional `timer` that starts the next wave by itself.
 *
 * Grid problems (`unknown_char`, `ragged_row`, `empty_grid`) and path problems (`no_entry`,
 * `two_entries`, `no_exit`, `two_exits`, `path_broken`, `path_branch`, `path_off_walk`) are schema
 * errors at the `.map.txt` line with the row and col. Across files (`checkAll`), a map naming a
 * tower type no `td-towers` file has is `unknown_tower` at `towers.<i>`, and one naming a wave list
 * there is no `td-waves` file for is `unknown_waves` at `waves`. Since Engine 0.15 (lesson D8) a
 * map may leave `waves` out when only `td-defence` missions play it (their wave is the world's
 * units); one no mission names is `no_waves` at `waves` (it could only be played standalone, which
 * needs a wave list).
 */

/** Whole sub-cell units in one cell: an enemy's `progress` along the path and its `speed`. */
export const CELL_SUB = 16;

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lower-case letters, digits and "-"');

const tick = (what: string) => z.number().int().min(0).describe(what);

export const tdMapSchema = z
  .strictObject({
    id: z.string().min(1).describe('the map id: its file name'),
    title: z.string().min(1).exactOptional().describe('one line naming the map, for a page or HUD'),
    legend: z
      .record(z.string(), z.enum(CELL_KINDS as [CellKind, ...CellKind[]]))
      .default({})
      .describe(
        "the map's own grid characters (one character each, not a kit legend one) by the cell kind they mean: blocked, path, build, entry or exit",
      ),
    start: z
      .strictObject({
        gold: z.number().int().min(0).describe('the gold the round starts with, to pay for towers'),
        lives: z.number().int().min(1).describe('the lives the round starts with; a leak costs one'),
      })
      .describe('what the round starts with'),
    towers: z
      .array(Id)
      .min(1)
      .describe('the tower types that can be placed on this map, by `td-towers` id, in button order'),
    waves: z
      .string()
      .min(1)
      .exactOptional()
      .describe(
        "the wave list a standalone round plays: a `td-waves` file name; left out only on a map used by `td-defence` missions alone, whose wave is the world's units (Engine 0.15)",
      ),
    map: z
      .array(z.string())
      .describe('the grid, top row first, of legend characters; usually in the `.map.txt` file'),
  })
  .superRefine((def, ctx) => {
    const issue = (path: PropertyKey[], code: string, message: string, row?: number, col?: number) =>
      ctx.addIssue({ code: 'custom', path, message, params: { code, row, col } });
    for (const key of Object.keys(def.legend)) {
      if ([...key].length !== 1 || /\s/.test(key))
        issue(['legend', key], 'bad_legend_char', `legend key "${key}" must be one character, not a space`);
      else if (Object.hasOwn(LEGEND, key))
        issue(
          ['legend', key],
          'bad_legend_char',
          `"${key}" is a kit legend character (${LEGEND[key]!.meaning})`,
        );
    }
    const dupes = def.towers.filter((t, i) => def.towers.indexOf(t) !== i);
    for (const t of new Set(dupes)) issue(['towers'], 'duplicate_tower', `tower type "${t}" is listed twice`);
    const chars = new Set([...Object.keys(LEGEND), ...Object.keys(def.legend)]);
    addGridIssues(ctx, def.map, chars, ['map']);
    if (gridProblems(def.map, chars).length > 0) return;
    const traced = tracePath(cellKinds(def.map, def.legend));
    if (traced.ok) return;
    for (const p of traced.problems)
      issue(p.row === undefined ? ['map'] : ['map', p.row], p.code, p.message, p.row, p.col);
  });

export type TdMap = z.output<typeof tdMapSchema>;

export const towerTypeSchema = z.strictObject({
  cost: z.number().int().min(0).describe('the gold placing one costs'),
  range: z
    .number()
    .int()
    .min(0)
    .describe(
      'how far it reaches, in cells: an enemy whose cell is within this distance (squared, whole cells)',
    ),
  damage: z.number().int().min(1).describe('the hit points one shot takes'),
  cooldown: z.number().int().min(1).describe('ticks from one shot to the next (1: every tick)'),
  sell: z
    .number()
    .int()
    .min(0)
    .exactOptional()
    .describe('the gold selling one gives back; half its cost (rounded down) when left out'),
});
export type TowerType = z.output<typeof towerTypeSchema>;

export const tdTowersSchema = z.strictObject({
  towers: z.record(Id, towerTypeSchema).describe('tower types by id'),
});
export type TdTowers = z.output<typeof tdTowersSchema>;
/** Tower types by id, as a round uses them. */
export type TowerTable = Readonly<Record<string, TowerType>>;

export const enemyGroupSchema = z.strictObject({
  kind: Id.describe('the enemy kind, a name for skins and reports'),
  count: z.number().int().min(1).describe('how many come'),
  spacing: tick('ticks from one enemy of the group to the next (0: all at once)'),
  hp: z.number().int().min(1).describe('hit points each has'),
  speed: z
    .number()
    .int()
    .min(1)
    .max(CELL_SUB)
    .describe(`sub-cell units walked each tick (${CELL_SUB} to a cell, so at most one cell a tick)`),
  bounty: z.number().int().min(0).describe('the gold a kill pays'),
  jitter: tick(
    'up to this many more ticks (drawn from the round RNG) added to each spacing; 0 when left out',
  ).exactOptional(),
});
export type EnemyGroup = z.output<typeof enemyGroupSchema>;

export const tdWavesSchema = z.strictObject({
  id: z.string().min(1).describe('the wave list id: its file name, which a map names in `waves`'),
  timer: z
    .number()
    .int()
    .min(1)
    .exactOptional()
    .describe(
      'ticks after the round starts, or after the last wave started, at which the next wave starts by itself; left out, only the start button starts one',
    ),
  waves: z
    .array(
      z.strictObject({
        groups: z
          .array(enemyGroupSchema)
          .min(1)
          .describe('the enemy groups, one after another in file order'),
      }),
    )
    .min(1)
    .describe('the waves, in the order they come'),
});
export type TdWaves = z.output<typeof tdWavesSchema>;

/** Every tower type of a game's `td-towers` files, by id (the first file's when one is given twice). */
export function towerTable(files: readonly { value: TdTowers }[]): Record<string, TowerType> {
  const out: Record<string, TowerType> = {};
  for (const f of files)
    for (const [id, t] of Object.entries(f.value.towers)) if (!Object.hasOwn(out, id)) out[id] = t;
  return out;
}

/** A map's references across kinds: its tower types and its wave list. */
export function mapReferenceIssues(name: string, map: TdMap, others: ContentLookup): KindIssue[] {
  const towers = towerTable(others('td-towers') as readonly { value: TdTowers }[]);
  const issues: KindIssue[] = [];
  map.towers.forEach((t, i) => {
    if (!Object.hasOwn(towers, t)) {
      const known = Object.keys(towers).join(', ') || 'none';
      issues.push({
        name,
        path: ['towers', i],
        code: 'unknown_tower',
        message: `tower type "${t}" is in no td-towers file (known: ${known})`,
      });
    }
  });
  if (map.waves === undefined) {
    // Lesson D8: no wave list is fine for a map only `td-defence` missions play.
    const named = others('mission').some((m) => {
      const v = m.value as { play?: unknown; params?: { map?: unknown } } | null;
      return v?.play === 'td-defence' && v.params?.map === map.id;
    });
    if (!named)
      issues.push({
        name,
        path: ['waves'],
        code: 'no_waves',
        message: `td-map "${map.id}" has no "waves" and no td-defence mission plays it: a standalone round needs a td-waves list`,
      });
    return issues;
  }
  const waves = others('td-waves').map((e) => e.name);
  if (!waves.includes(map.waves))
    issues.push({
      name,
      path: ['waves'],
      code: 'unknown_waves',
      message: `no td-waves file "${map.waves}" (there are: ${waves.join(', ') || 'none'})`,
    });
  return issues;
}

/** The `td-map` content kind: a header with its grid in a sibling `.map.txt`. */
export function tdMapKind(): ContentKind<typeof tdMapSchema> {
  return {
    name: 'td-map',
    description:
      'A tower-defense map: starting gold and lives, the tower types and wave list it plays, with its grid (path from entry to exit, build cells, blocked ground) in a text grid',
    schema: tdMapSchema,
    gridParts: { map: '.map.txt' },
    checkAll: (entries, others) => entries.flatMap((e) => mapReferenceIssues(e.name, e.value, others)),
  };
}

/** The `td-towers` content kind: a table of tower types. */
export function tdTowersKind(): ContentKind<typeof tdTowersSchema> {
  return {
    name: 'td-towers',
    description: 'Tower-defense tower types: cost, range in cells, damage, cooldown in ticks and sell value',
    schema: tdTowersSchema,
    checkAll(entries) {
      const first = new Map<string, string>();
      const issues: KindIssue[] = [];
      for (const e of entries)
        for (const id of Object.keys(e.value.towers)) {
          const was = first.get(id);
          if (was === undefined) first.set(id, e.name);
          else
            issues.push({
              name: e.name,
              path: ['towers', id],
              code: 'duplicate_tower',
              message: `tower type "${id}" is also in ${was}`,
            });
        }
      return issues;
    },
  };
}

/** The `td-waves` content kind: one wave list. */
export function tdWavesKind(): ContentKind<typeof tdWavesSchema> {
  return {
    name: 'td-waves',
    description:
      'A tower-defense wave list: waves of enemy groups (kind, count, spacing, hp, speed, bounty) and an optional timer',
    schema: tdWavesSchema,
  };
}
