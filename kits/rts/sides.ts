import { isFinished, type RtsView } from './snapshot';

/**
 * Every side at a glance, for run-file checks and a page's status line (Engine 0.11 T8, gap M15 in
 * docs/reports/mini-siege.md: it was the RTS skirmish's glue, and the mini siege needed the same).
 * Pure: it only reads the view.
 */

/** One side at a glance: its units, finished buildings, sites and stock. */
export interface SideSummary {
  /** Living units. */
  units: number;
  /** Living units by type. */
  unitTypes: Record<string, number>;
  /** Finished buildings by kind. */
  buildings: Record<string, number>;
  /** Buildings still under construction. */
  sites: number;
  /** The side's stockpile, by item. */
  stock: Record<string, number>;
}

/**
 * Every side by faction: `factions` always (an empty side once beaten), then any other faction
 * with units, buildings or a stockpile.
 */
export function sidesOf(view: RtsView, factions: readonly string[] = []): Record<string, SideSummary> {
  const sides: Record<string, SideSummary> = {};
  const side = (f: string) =>
    (sides[f] ??= { units: 0, unitTypes: {}, buildings: {}, sites: 0, stock: { ...(view.stock[f] ?? {}) } });
  for (const f of [...factions, ...Object.keys(view.stock)]) side(f);
  for (const u of view.units) {
    if (u.faction === null) continue;
    const s = side(u.faction);
    s.units++;
    const type = u.type ?? 'unit';
    s.unitTypes[type] = (s.unitTypes[type] ?? 0) + 1;
  }
  for (const b of view.buildings) {
    if (b.faction === null) continue;
    const s = side(b.faction);
    if (isFinished(b)) s.buildings[b.kind] = (s.buildings[b.kind] ?? 0) + 1;
    else s.sites++;
  }
  return sides;
}
