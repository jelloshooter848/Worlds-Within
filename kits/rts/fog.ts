import { FOG_CELLS, type PresentFog } from '@engine/core/present';
import type { RtsBuildingView, RtsResourceView, RtsUnitView, RtsView } from './snapshot';

/**
 * Fog of war for one side (Engine 0.16 part D, D5), as presentation and AI knowledge only: what
 * a side sees is worked out here from the read-only view and changes nothing in a world or a hash
 * (the sim keeps `Unit.sight` as data and no system reads it). Pure.
 *
 * - **Sight.** A unit sees `sight` whole cells (`RtsUnitView.sight`, `Unit.sight` in the snapshot;
 *   else its type's in the world's types table; else `RTS_UNIT_SIGHT`). A building sees from its
 *   whole footprint: its type's optional `sight` (`rtsBuildingTypeSchema`), else
 *   `max(w, h) + RTS_BUILDING_SIGHT_EXTRA`. A building under construction sees too (it is the
 *   side's). A cell is seen when the floor of its straight-line distance to the source (to the
 *   nearest footprint cell) is at most the sight, the sim's `distFloor` rule for ranges, in
 *   integers (`dx * dx + dy * dy < (sight + 1) ** 2`).
 * - **`visibility(view, faction)`**: the cells the side sees now.
 * - **`RtsFogMemory`**: what a side remembers, kept in the presentation state (`RtsPresentState`),
 *   never in a snapshot: the cells it has ever seen (explored), and every other side's building and
 *   every resource node as it last saw them. A remembered building or node whose cells are seen
 *   again is updated, or forgotten when it is gone.
 * - **`fogView(view, faction, memory?)`**: what the side may be shown: its own units and buildings,
 *   other units only on cells seen now, other buildings and resource nodes as they are when seen
 *   now and as last seen otherwise (`remembered`), and the `PresentFog` grid for the frame.
 */

/** A unit's sight when neither the snapshot nor the types table gives one (cells). */
export const RTS_UNIT_SIGHT = 4;

/** A building without a `sight` in its type sees `max(w, h)` plus this many cells. */
export const RTS_BUILDING_SIGHT_EXTRA = 2;

/** The cells one side sees now: `cells[y * width + x]` is 1 when seen. */
export interface RtsVisibility {
  width: number;
  height: number;
  cells: Uint8Array;
}

/** How far a unit sees (see the file comment). */
export function unitSight(view: RtsView, u: RtsUnitView): number {
  if (u.sight !== undefined) return u.sight;
  const typed = u.type === null ? undefined : view.types?.units[u.type]?.sight;
  return typed ?? RTS_UNIT_SIGHT;
}

/** How far a building sees from its footprint (see the file comment). */
export function buildingSight(view: RtsView, b: RtsBuildingView): number {
  return view.types?.buildings[b.kind]?.sight ?? Math.max(b.w, b.h) + RTS_BUILDING_SIGHT_EXTRA;
}

/** Marks the cells within `sight` of the box (x, y, w, h) as seen. */
function see(vis: RtsVisibility, x: number, y: number, w: number, h: number, sight: number): void {
  const r2 = (sight + 1) * (sight + 1);
  const x0 = Math.max(0, x - sight);
  const y0 = Math.max(0, y - sight);
  const x1 = Math.min(vis.width - 1, x + w - 1 + sight);
  const y1 = Math.min(vis.height - 1, y + h - 1 + sight);
  for (let cy = y0; cy <= y1; cy++) {
    const dy = Math.max(y - cy, 0, cy - (y + h - 1));
    for (let cx = x0; cx <= x1; cx++) {
      const dx = Math.max(x - cx, 0, cx - (x + w - 1));
      if (dx * dx + dy * dy < r2) vis.cells[cy * vis.width + cx] = 1;
    }
  }
}

/** The cells `faction` sees now, from its units' and buildings' sight (a world without terrain: none). */
export function visibility(view: RtsView, faction: string): RtsVisibility {
  const width = view.terrain?.width ?? 0;
  const height = view.terrain?.height ?? 0;
  const vis: RtsVisibility = { width, height, cells: new Uint8Array(width * height) };
  for (const u of view.units) if (u.faction === faction) see(vis, u.x, u.y, 1, 1, unitSight(view, u));
  for (const b of view.buildings)
    if (b.faction === faction) see(vis, b.x, b.y, b.w, b.h, buildingSight(view, b));
  return vis;
}

/** Whether cell (x, y) is seen (off the grid: not). */
export function isVisible(vis: RtsVisibility, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= vis.width || y >= vis.height) return false;
  return vis.cells[y * vis.width + x] === 1;
}

/** Whether any cell of the box (x, y, w, h) is seen. */
export function seesBox(vis: RtsVisibility, x: number, y: number, w: number, h: number): boolean {
  for (let cy = y; cy < y + h; cy++)
    for (let cx = x; cx < x + w; cx++) if (isVisible(vis, cx, cy)) return true;
  return false;
}

/**
 * One side's memory of the map (see the file comment): explored cells, and the other sides'
 * buildings and the resource nodes as last seen. Presentation state, one per stream of frames; a
 * view of another faction, another map size or an earlier tick starts it afresh.
 */
export class RtsFogMemory {
  private faction: string | null = null;
  private width = 0;
  private height = 0;
  private tick = -1;
  private explored = new Uint8Array(0);
  private readonly buildings = new Map<number, RtsBuildingView>();
  private readonly resources = new Map<number, RtsResourceView>();

  /** Forgets everything. */
  reset(): void {
    this.faction = null;
    this.tick = -1;
    this.explored = new Uint8Array(0);
    this.buildings.clear();
    this.resources.clear();
  }

  /** Whether cell (x, y) was ever seen. */
  isExplored(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.explored[y * this.width + x] === 1;
  }

  /** The other sides' buildings as last seen, ascending by id. */
  lastSeenBuildings(): RtsBuildingView[] {
    return [...this.buildings.values()].sort((a, b) => a.id - b.id);
  }

  /** The resource nodes as last seen, ascending by id. */
  lastSeenResources(): RtsResourceView[] {
    return [...this.resources.values()].sort((a, b) => a.id - b.id);
  }

  /** Takes in what `faction` sees of `view` now (`vis`). */
  update(view: RtsView, faction: string, vis: RtsVisibility): void {
    if (
      this.faction !== faction ||
      this.width !== vis.width ||
      this.height !== vis.height ||
      view.tick < this.tick
    ) {
      this.reset();
      this.faction = faction;
      this.width = vis.width;
      this.height = vis.height;
      this.explored = new Uint8Array(vis.width * vis.height);
    }
    this.tick = view.tick;
    for (let i = 0; i < vis.cells.length; i++) if (vis.cells[i] === 1) this.explored[i] = 1;
    const seenBuildings = new Set<number>();
    for (const b of view.buildings) {
      if (b.faction === faction || !seesBox(vis, b.x, b.y, b.w, b.h)) continue;
      this.buildings.set(b.id, copyBuilding(b));
      seenBuildings.add(b.id);
    }
    // A remembered building whose cells are seen now but is not there any more is gone.
    for (const [id, b] of [...this.buildings])
      if (!seenBuildings.has(id) && seesBox(vis, b.x, b.y, b.w, b.h)) this.buildings.delete(id);
    const seenResources = new Set<number>();
    for (const r of view.resources) {
      if (!isVisible(vis, r.x, r.y)) continue;
      this.resources.set(r.id, { ...r });
      seenResources.add(r.id);
    }
    for (const [id, r] of [...this.resources])
      if (!seenResources.has(id) && isVisible(vis, r.x, r.y)) this.resources.delete(id);
  }
}

/** A copy of a building view, so a remembered one never changes with the view it came from. */
function copyBuilding(b: RtsBuildingView): RtsBuildingView {
  return {
    ...b,
    construction: b.construction === null ? null : { ...b.construction },
    producer:
      b.producer === null
        ? null
        : {
            trains: [...b.producer.trains],
            queue: b.producer.queue.map((q) => ({ ...q })),
            progress: b.producer.progress,
          },
  };
}

/** A building or resource node to show, and whether it is as last seen (not seen now). */
export interface RtsShown<T> {
  thing: T;
  remembered: boolean;
}

/** What one side may be shown under fog (see the file comment). */
export interface RtsFogView {
  visibility: RtsVisibility;
  /** Its own units, and the others on cells seen now, ascending by id. */
  units: RtsUnitView[];
  /** Its own buildings, the others seen now and the others as last seen, ascending by id. */
  buildings: RtsShown<RtsBuildingView>[];
  /** Resource nodes seen now and as last seen, ascending by id. */
  resources: RtsShown<RtsResourceView>[];
  /** The frame's fog grid (`2` seen now, `1` explored, `0` never seen), or null without terrain. */
  fog: PresentFog | null;
}

/**
 * What `faction` may be shown of `view`. With `memory` (updated here) explored cells and last-seen
 * buildings and nodes are kept between calls; without it, only what is seen now is shown and
 * explored means seen now.
 */
export function fogView(view: RtsView, faction: string, memory: RtsFogMemory | null = null): RtsFogView {
  const vis = visibility(view, faction);
  memory?.update(view, faction, vis);
  const units = view.units.filter((u) => u.faction === faction || isVisible(vis, u.x, u.y));
  const buildings: RtsShown<RtsBuildingView>[] = [];
  const current = new Set<number>();
  for (const b of view.buildings) {
    if (b.faction !== faction && !seesBox(vis, b.x, b.y, b.w, b.h)) continue;
    buildings.push({ thing: b, remembered: false });
    current.add(b.id);
  }
  for (const b of memory?.lastSeenBuildings() ?? [])
    if (!current.has(b.id)) buildings.push({ thing: b, remembered: true });
  buildings.sort((a, b) => a.thing.id - b.thing.id);
  const resources: RtsShown<RtsResourceView>[] = [];
  const nodes = new Set<number>();
  for (const r of view.resources) {
    if (!isVisible(vis, r.x, r.y)) continue;
    resources.push({ thing: r, remembered: false });
    nodes.add(r.id);
  }
  for (const r of memory?.lastSeenResources() ?? [])
    if (!nodes.has(r.id)) resources.push({ thing: r, remembered: true });
  resources.sort((a, b) => a.thing.id - b.thing.id);
  let fog: PresentFog | null = null;
  if (view.terrain !== null) {
    const cells: string[] = [];
    for (let y = 0; y < vis.height; y++) {
      let row = '';
      for (let x = 0; x < vis.width; x++)
        row += isVisible(vis, x, y)
          ? FOG_CELLS.visible
          : memory?.isExplored(x, y)
            ? FOG_CELLS.explored
            : FOG_CELLS.unexplored;
      cells.push(row);
    }
    fog = { cols: vis.width, rows: vis.height, cells };
  }
  return { visibility: vis, units, buildings, resources, fog };
}
