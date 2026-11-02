import { z } from 'zod';
import type { ContentKind, ContentLookup, KindIssue } from '@engine/core/content/kinds';
import { addGridIssues } from '@engine/core/content/text-grid';
import { rtsTypesSchema, type RtsTypes } from '@engine/core/rts-types';
import { enemyPlanSchema, type EnemyPlan } from './enemy';

/**
 * The RTS kit's content kinds (docs/BUILD-LOG.md, Engine 0.9, decision 7, item 131):
 *
 * - `rts-map`: the map, a world scenario (`*.world.json`, the `engine/sim` scenario format) that
 *   names the `rts` system set. The kit may not import `engine/sim`, so this kind checks the file's
 *   shape and its grids (rows the same width, every character in the legend, elevation digits the
 *   same size); the components themselves are checked by the sim when the game builds the world
 *   (`worldFromScenario`), which names every bad field.
 * - `rts-types`: the unit and building type table, `rtsTypesSchema` from `engine/core/rts-types.ts`
 *   (the same schema the sim's `RtsTypes` component uses), for a game that keeps it in its own
 *   file and copies it into the world.
 * - `rts-enemy`: a scripted enemy's plan (`enemy.ts`). Across files (`checkAll`), every unit and
 *   building type a plan names must be in the game's types: an `rts-types` file or an `RtsTypes`
 *   component in an `rts-map` (when the game has either).
 */

const Key = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
const Components = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'must be a letter followed by letters, digits or _'),
    z.json(),
  )
  .describe('components by name, checked by the simulation when the world is built');

/** The `rts-map` file shape: a world scenario with `"systems": "rts"`. */
export const rtsMapSchema = z
  .strictObject({
    format: z.literal('worlds-within/scenario').describe('always `worlds-within/scenario`'),
    version: z.literal(1).describe('the scenario format version'),
    seed: z.int().describe("the world's seed"),
    systems: z.literal('rts').describe('always `rts`: the RTS units and economy'),
    terrain: z
      .strictObject({
        legend: z
          .record(
            z.string().length(1),
            z.strictObject({
              name: Key.describe('the ground type name'),
              cost: z.int().min(1).describe('ticks to enter a cell of this type'),
              passable: z.boolean().describe('false: nothing can enter it'),
            }),
          )
          .describe('one ground type per grid character'),
        rows: z.array(z.string().min(1)).min(1).describe('the grid, one string per row, north first'),
        elevation: z
          .array(z.string().regex(/^[0-9]+$/, 'must be digits'))
          .describe('one elevation digit (0-9) per cell, the same size as `rows`'),
      })
      .describe('the terrain grid'),
    entities: z
      .array(
        z.strictObject({
          key: Key.optional().describe('a name other entities can `$ref`'),
          components: Components,
        }),
      )
      .default([])
      .describe('units, buildings, resource nodes, stockpiles and the types table, spawned in this order'),
    squads: z
      .array(z.record(z.string(), z.json()))
      .default([])
      .describe('squads with their named members (heroes), as in a world scenario'),
  })
  .superRefine((map, ctx) => {
    const legend = new Set(Object.keys(map.terrain.legend));
    addGridIssues(ctx, map.terrain.rows, legend, ['terrain', 'rows']);
    addGridIssues(ctx, map.terrain.elevation, new Set('0123456789'), ['terrain', 'elevation']);
    const rows = map.terrain.rows;
    const elev = map.terrain.elevation;
    if (elev.length !== rows.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['terrain', 'elevation'],
        message: `${elev.length} rows, the grid has ${rows.length}`,
      });
    } else if (elev[0] !== undefined && rows[0] !== undefined && elev[0].length !== [...rows[0]].length) {
      ctx.addIssue({
        code: 'custom',
        path: ['terrain', 'elevation', 0],
        message: `row 0 is ${elev[0].length} wide, the grid is ${[...rows[0]].length}`,
      });
    }
  });
export type RtsMap = z.infer<typeof rtsMapSchema>;

/** The unit and building types a game has: its `rts-types` files and its maps' `RtsTypes`. */
function gameTypes(others: ContentLookup, types: readonly { value: RtsTypes }[] = []): RtsTypes[] {
  const out = types.map((t) => t.value);
  for (const map of others('rts-map')) {
    for (const e of (map.value as RtsMap).entities) {
      const parsed = rtsTypesSchema.safeParse(e.components['RtsTypes']);
      if (e.components['RtsTypes'] !== undefined && parsed.success) out.push(parsed.data);
    }
  }
  return out;
}

/** Problems with the types a plan names (none when the game has no types to check against). */
export function planTypeIssues(name: string, plan: EnemyPlan, types: readonly RtsTypes[]): KindIssue[] {
  if (types.length === 0) return [];
  const units = new Set(types.flatMap((t) => Object.keys(t.units)));
  const buildings = new Set(types.flatMap((t) => Object.keys(t.buildings)));
  const issues: KindIssue[] = [];
  const check = (set: Set<string>, id: string | undefined, path: PropertyKey[], what: string) => {
    if (id !== undefined && !set.has(id))
      issues.push({ name, path, code: 'unknown_type', message: `${what} type "${id}" is in no types table` });
  };
  plan.steps.forEach((s, i) => {
    const at = ['steps', i, 'order'];
    const o = s.order;
    if (o.type === 'train') {
      check(buildings, o.building, [...at, 'building'], 'building');
      check(units, o.unit, [...at, 'unit'], 'unit');
    } else {
      check(units, o.units.type, [...at, 'units', 'type'], 'unit');
      if (o.type === 'build') check(buildings, o.building, [...at, 'building'], 'building');
    }
    if (s.when !== undefined && s.when.count !== 'stock' && s.when.type !== undefined) {
      const set = s.when.count === 'units' ? units : buildings;
      check(set, s.when.type, ['steps', i, 'when', 'type'], s.when.count === 'units' ? 'unit' : 'building');
    }
  });
  return issues;
}

/** The `rts-map` content kind. */
export function rtsMapKind(): ContentKind<typeof rtsMapSchema> {
  return {
    name: 'rts-map',
    description:
      'An RTS map: a world scenario with the rts system set (terrain text grids, units, buildings, resource nodes)',
    schema: rtsMapSchema,
  };
}

/** The `rts-types` content kind. */
export function rtsTypesKind(): ContentKind<typeof rtsTypesSchema> {
  return {
    name: 'rts-types',
    description:
      'RTS unit and building types: stats, costs, build and training times, what a building trains',
    schema: rtsTypesSchema,
  };
}

/** The `rts-enemy` content kind: a scripted enemy's plan, its types checked across files. */
export function rtsEnemyKind(): ContentKind<typeof enemyPlanSchema> {
  return {
    name: 'rts-enemy',
    description: "A scripted enemy's plan: its faction and the orders it gives, at ticks or on triggers",
    schema: enemyPlanSchema,
    checkAll(entries, others) {
      const types = gameTypes(others, others('rts-types') as { name: string; value: RtsTypes }[]);
      return entries.flatMap((e) => planTypeIssues(e.name, e.value, types));
    },
  };
}
