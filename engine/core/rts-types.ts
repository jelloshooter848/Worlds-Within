import { z } from 'zod';

/**
 * RTS unit and building types as plain JSON data (Engine 0.9 T8; docs/BUILD-LOG.md, Engine 0.9,
 * decisions 2 and 7, items 122 and 131): the stats, costs, build and training times, and what a
 * building can train. Defined here in `engine/core` so both `engine/sim` (which keeps the table in
 * the world as its `RtsTypes` component and copies a type's numbers into the components of each
 * unit or building it makes) and kits (which can read the same file as content) use one schema.
 * The sim holds no type of its own: every number comes from this table.
 *
 *   { "units": { "worker": { "health": 20, "speed": 3, "attack": 1, "range": 1, "cooldown": 4,
 *                            "sight": 5, "cost": { "gold": 40 }, "trainTicks": 30, "work": 2,
 *                            "gather": { "capacity": 5, "ticks": 4 } } },
 *     "buildings": { "barracks": { "health": 200, "size": { "w": 2, "h": 2 }, "work": 120,
 *                                  "cost": { "gold": 100 }, "trains": ["soldier"] } } }
 */

/** An id used in data: a letter, then letters, digits, `_` or `-` (as the sim's ids). */
const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');

/** A price: item id -> how many of it (at least 1 each); `{}` is free. */
export const rtsCostSchema = z
  .record(Id, z.int().min(1))
  .describe('what one costs, paid from the faction stockpile: item id -> count');

/** One unit type: the numbers copied into a unit's `Unit`, `Health`, `Worker` and `Gatherer`. */
export const rtsUnitTypeSchema = z.strictObject({
  health: z.int().min(1).describe('hit points of a new unit (Health.max)'),
  speed: z.int().min(1).describe('ticks to cross one cell of cost 1 in a straight line'),
  attack: z.int().min(0).describe('damage per hit (0: it never hurts anything)'),
  range: z.int().min(1).describe('how far it hits, in whole cells'),
  cooldown: z.int().min(1).describe('ticks from one hit to the next'),
  sight: z.int().min(0).describe('how far it sees, in whole cells (for the view)'),
  cost: rtsCostSchema.default({}),
  trainTicks: z.int().min(1).describe('ticks a building takes to train one'),
  work: z
    .int()
    .min(1)
    .nullable()
    .default(null)
    .describe('construction work it adds per tick; only units with it can build'),
  gather: z
    .strictObject({
      capacity: z.int().min(1).describe('how many items it carries at most'),
      ticks: z.int().min(1).describe('ticks to gather one item'),
    })
    .nullable()
    .default(null)
    .describe(
      '{ capacity, ticks }: it carries at most capacity, one item every ticks ticks; only units with it can gather',
    ),
});
export type RtsUnitType = z.infer<typeof rtsUnitTypeSchema>;

/** One building type: the numbers copied into a building's `Building`, `Construction`, `Health`, `Producer`. */
export const rtsBuildingTypeSchema = z.strictObject({
  health: z.int().min(1).describe('hit points once built (Health.max)'),
  size: z
    .strictObject({
      w: z.int().min(1).max(16).describe('width in cells, west to east'),
      h: z.int().min(1).max(16).describe('height in cells, north to south'),
    })
    .describe('its footprint in cells, from its Position (the north-west cell)'),
  work: z.int().min(1).describe("construction work to finish it (build time: work / the workers' rates)"),
  cost: rtsCostSchema.default({}),
  trains: z.array(Id).default([]).describe('the unit types it can train, once finished'),
  dropoff: z.boolean().default(false).describe('whether gatherers can drop resources here, once finished'),
});
export type RtsBuildingType = z.infer<typeof rtsBuildingTypeSchema>;

/** The whole table: unit types and building types by id. */
export const rtsTypesSchema = z
  .strictObject({
    units: z.record(Id, rtsUnitTypeSchema).describe('unit types by id'),
    buildings: z.record(Id, rtsBuildingTypeSchema).default({}).describe('building types by id'),
  })
  .superRefine((table, ctx) => {
    for (const [kind, building] of Object.entries(table.buildings)) {
      building.trains.forEach((unit, i) => {
        if (table.units[unit] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['buildings', kind, 'trains', i],
            message: `unit type "${unit}" is not in units`,
          });
        }
      });
    }
  });
export type RtsTypes = z.infer<typeof rtsTypesSchema>;
