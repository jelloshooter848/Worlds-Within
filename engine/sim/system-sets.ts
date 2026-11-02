import { STANDARD_COMPONENTS } from './components';
import { RTS_COMPONENTS, RTS_SYSTEMS } from './rts-orders';
import { SYSTEM_COMPONENTS, buildSystem, haulSystem, patrolSystem } from './systems';
import { Terrain } from './terrain';
import { MISSION_COMPONENTS } from './mission';
import { TIME_COMPONENTS } from './time';
import type { AnyComponent, System } from './world';

/**
 * Named system sets (Engine 0.9 T9; items 118 and 132): the component kinds and systems, in run
 * order, a world is built with when its scenario names a set (`"systems": "rts"`) and the caller
 * gives none of its own. The tools' world runs build every world this way, `village` when the
 * scenario names none, so the 0.8 sample world and its hashes do not change.
 *
 * - `village`: the 0.8 set: standard components, `Terrain` and `SYSTEM_COMPONENTS`; systems
 *   `haulSystem`, `buildSystem`, `patrolSystem`.
 * - `rts`: standard components, `Terrain` and `RTS_COMPONENTS`; systems `RTS_SYSTEMS`.
 *
 * Both also register `TIME_COMPONENTS` and `MISSION_COMPONENTS` (Engine 0.10), which stay out of
 * snapshots until used, so a scenario may tag event members and the hashes of worlds that do not are unchanged.
 */

/** The set names a scenario may give in `systems`. */
export const SYSTEM_SET_NAMES = ['village', 'rts'] as const;
export type SystemSetName = (typeof SYSTEM_SET_NAMES)[number];

/** The set a scenario that names none is run with by the tools. */
export const DEFAULT_SYSTEM_SET: SystemSetName = 'village';

/** A set: the component kinds to register and the systems, in run order. */
export interface SystemSet {
  readonly components: readonly AnyComponent[];
  readonly systems: readonly System[];
}

export const SYSTEM_SETS: Readonly<Record<SystemSetName, SystemSet>> = Object.freeze({
  village: Object.freeze({
    components: Object.freeze([
      ...STANDARD_COMPONENTS,
      Terrain,
      ...SYSTEM_COMPONENTS,
      ...TIME_COMPONENTS,
      ...MISSION_COMPONENTS,
    ]),
    systems: Object.freeze([haulSystem, buildSystem, patrolSystem]),
  }),
  rts: Object.freeze({
    components: Object.freeze([
      ...STANDARD_COMPONENTS,
      Terrain,
      ...RTS_COMPONENTS,
      ...TIME_COMPONENTS,
      ...MISSION_COMPONENTS,
    ]),
    systems: RTS_SYSTEMS,
  }),
});
