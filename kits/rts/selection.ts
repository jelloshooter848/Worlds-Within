import type { RuleSwitch } from '@engine/core/rules';
import { thingAt, type RtsView } from './snapshot';

/**
 * The selection model (Engine 0.9, the RTS view): which entities the player has selected, by world
 * entity id. Pure data in, pure data out; no drawing (the selection is presented as rings by
 * `present.ts`). Positions here are world pixels, turned into cells by `tileSize`: the glue turns
 * a pointer gesture into world pixels with `RtsCamera.screenToWorld` first.
 *
 * - A **click** selects one thing: the player's own unit on that cell (else any unit, to look at
 *   it), else a building, else nothing (and clears). A hero is a unit like any other, so a click
 *   on a hero selects the hero alone (item 121).
 * - A **box** selects every one of the player's own units inside it (rule
 *   `box-selects-own-units`), buildings never. An empty box clears.
 * - `additive` (shift) adds to the selection instead of replacing it.
 * - `heroes(view, faction)` selects the faction's heroes alone.
 *
 * Selections are kept in ascending id order and pruned of the dead each frame (`prune`).
 */

/** A world-pixel point. */
export interface WorldPoint {
  x: number;
  y: number;
}

/** A world-pixel box (any corners; negative sizes are allowed). */
export interface WorldBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The cell a world-pixel point is on. */
export function cellOf(p: WorldPoint, tileSize: number): { x: number; y: number } {
  return { x: Math.floor(p.x / tileSize), y: Math.floor(p.y / tileSize) };
}

/** Sorted, unique ids. */
function sortedIds(ids: Iterable<number>): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

export class Selection {
  private list: number[] = [];

  constructor(
    /** The player's faction: whose units a box takes and commands go to. */
    readonly faction: string,
    private readonly rules: RuleSwitch | null = null,
  ) {}

  /** The selected ids, ascending. */
  ids(): number[] {
    return [...this.list];
  }

  has(id: number): boolean {
    return this.list.includes(id);
  }

  /** Replaces the selection (`additive`: adds to it). */
  set(ids: Iterable<number>, additive = false): void {
    this.list = sortedIds(additive ? [...this.list, ...ids] : ids);
  }

  clear(): void {
    this.list = [];
  }

  /** Selects the thing under the world point `p` (see the file comment). Returns the selection. */
  click(view: RtsView, p: WorldPoint, tileSize: number, additive = false): number[] {
    const c = cellOf(p, tileSize);
    const thing = thingAt(view, c.x, c.y, this.faction);
    if (thing === null || thing.what === 'resource') {
      if (!additive) this.clear();
    } else {
      const id = thing.what === 'unit' ? thing.unit.id : thing.building.id;
      this.set([id], additive);
    }
    return this.ids();
  }

  /** Selects the units inside the world box `box` (whole cells their centres fall in). */
  box(view: RtsView, box: WorldBox, tileSize: number, additive = false): number[] {
    const x0 = Math.min(box.x, box.x + box.w);
    const x1 = Math.max(box.x, box.x + box.w);
    const y0 = Math.min(box.y, box.y + box.h);
    const y1 = Math.max(box.y, box.y + box.h);
    return this.boxWhere(view, (cx, cy) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1, tileSize, additive);
  }

  /**
   * A box selection by any test (Engine 0.16 F2): selects the units whose cell centre (world px)
   * passes `inside`, by the same rules as `box` (own units only unless `box-selects-own-units` is
   * off). A ground view tests whether the centre projects inside the dragged picture rectangle.
   */
  boxWhere(
    view: RtsView,
    inside: (cx: number, cy: number) => boolean,
    tileSize: number,
    additive = false,
  ): number[] {
    const ownOnly = this.rules === null || this.rules.isOn('box-selects-own-units');
    const picked = view.units.filter((u) => {
      if (ownOnly && u.faction !== this.faction) return false;
      return inside((u.x + 0.5) * tileSize, (u.y + 0.5) * tileSize);
    });
    this.set(
      picked.map((u) => u.id),
      additive,
    );
    return this.ids();
  }

  /** Selects the faction's heroes (units with squad role `hero`) and nothing else. */
  heroes(view: RtsView): number[] {
    this.set(view.units.filter((u) => u.faction === this.faction && u.role === 'hero').map((u) => u.id));
    return this.ids();
  }

  /** Drops ids that are no longer a unit or building in the view (the dead, the spent). */
  prune(view: RtsView): number[] {
    const alive = new Set([...view.units.map((u) => u.id), ...view.buildings.map((b) => b.id)]);
    this.list = this.list.filter((id) => alive.has(id));
    return this.ids();
  }

  /** The selected units of the player's own faction, ascending. */
  ownUnits(view: RtsView): RtsView['units'] {
    return view.units.filter((u) => this.has(u.id) && u.faction === this.faction);
  }

  /** The selected buildings of the player's own faction, ascending. */
  ownBuildings(view: RtsView): RtsView['buildings'] {
    return view.buildings.filter((b) => this.has(b.id) && b.faction === this.faction);
  }
}
