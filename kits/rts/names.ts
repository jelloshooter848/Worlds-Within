import { z } from 'zod';

/**
 * Display names as data (Engine 0.16 polish Q, D2): the `rts-names` content kind, a game's table
 * of what the HUD calls each unit type and building kind, so the selection panel says "Town
 * Centre" and not the id `town-centre`:
 *
 *   { "units": { "worker": "Worker", "soldier": "Soldier" },
 *     "buildings": { "town-centre": "Town Centre", "barracks": "Barracks" } }
 *
 * Presentation only: the table never enters the world (the ids stay the world's and every
 * `when` condition's), so no hash depends on it. `presentWorld`'s `names` option reads it
 * (`selectedName`, `trainingName`); an id the table lacks shows as the id itself
 * (`unitName`, `buildingName`).
 */

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a letter followed by letters, digits, _ or -');
const Names = z.record(Id, z.string().min(1).describe('the display name'));

/** The `rts-names` file shape. */
export const rtsNamesSchema = z
  .strictObject({
    units: Names.default({}).describe('display name by unit type'),
    buildings: Names.default({}).describe('display name by building kind'),
  })
  .describe("a game's display names for its unit types and building kinds (presentation only)");
export type RtsNames = z.infer<typeof rtsNamesSchema>;

/** What the HUD calls unit type `type`: the table's name, else the type itself. */
export function unitName(names: RtsNames | undefined, type: string): string {
  return (names !== undefined && Object.hasOwn(names.units, type) ? names.units[type] : undefined) ?? type;
}

/** What the HUD calls building kind `kind`: the table's name, else the kind itself. */
export function buildingName(names: RtsNames | undefined, kind: string): string {
  return (
    (names !== undefined && Object.hasOwn(names.buildings, kind) ? names.buildings[kind] : undefined) ?? kind
  );
}
