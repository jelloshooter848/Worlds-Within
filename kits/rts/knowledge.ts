import type { JsonObject } from '@engine/core/headless';
import { isVisible, seesBox, visibility, type RtsVisibility } from './fog';
import type { RtsBuildingView, RtsView } from './snapshot';

/**
 * What one side knows of the world (Engine 0.16 part D, D6): the scripted enemy's knowledge
 * under fog (`knowledge: "fog"` in its plan) and a game's end rule read through it. Pure; the
 * sight rules are `fog.ts`'s (`visibility`).
 *
 * - **Explored**: every cell the side has ever seen (for the plan's `scout` order).
 * - **Remembered buildings**: every other side's building as it was when last seen, with the tick
 *   it was last seen. One whose cells are seen again is updated, or forgotten when it is gone.
 * - **`known(view)`**: the view as the side knows it: its own units and buildings, the other
 *   units on cells it sees now, the other buildings it sees now and the ones it remembers (as last
 *   seen; one whose cells are seen now and is not there is gone). Resource nodes, stockpiles and everything else are the view's (the map's gold is common
 *   knowledge; decision D6).
 * - **`snapshot()`**: the memory as plain JSON for the kit's snapshot, so hashes cover what the
 *   enemy knows: `{ explored: [rows of "0"/"1"], buildings: [{ id, kind, faction, x, y, w, h, seen }] }`.
 *
 * Unlike `RtsFogMemory` (presentation state, never hashed), this is kit state: the same views in
 * the same order give the same memory, every run.
 */
export class RtsKnowledge {
  private width = 0;
  private height = 0;
  private explored = new Uint8Array(0);
  private readonly buildings = new Map<number, { building: RtsBuildingView; seen: number }>();
  private readonly everSeen = new Set<string>();

  constructor(readonly faction: string) {}

  /** Takes in what the side sees of `view` now and returns that visibility. */
  update(view: RtsView): RtsVisibility {
    const vis = visibility(view, this.faction);
    if (vis.width !== this.width || vis.height !== this.height) {
      this.width = vis.width;
      this.height = vis.height;
      this.explored = new Uint8Array(vis.width * vis.height);
      this.buildings.clear();
      this.everSeen.clear();
    }
    for (let i = 0; i < vis.cells.length; i++) if (vis.cells[i] === 1) this.explored[i] = 1;
    const seen = new Set<number>();
    for (const b of view.buildings) {
      if (b.faction === this.faction || !seesBox(vis, b.x, b.y, b.w, b.h)) continue;
      this.buildings.set(b.id, { building: b, seen: view.tick });
      if (b.faction !== null) this.everSeen.add(`buildings:${b.kind}`);
      seen.add(b.id);
    }
    for (const u of view.units) {
      if (u.faction !== null && u.faction !== this.faction && isVisible(vis, u.x, u.y)) {
        this.everSeen.add(`units:${u.type}`);
      }
    }
    for (const [id, r] of [...this.buildings]) {
      const b = r.building;
      if (!seen.has(id) && seesBox(vis, b.x, b.y, b.w, b.h)) this.buildings.delete(id);
    }
    return vis;
  }

  /** Whether cell (x, y) was ever seen (off the grid: not). */
  isExplored(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.explored[y * this.width + x] === 1;
  }

  /**
   * Whether the side has ever seen another side's unit (`units`) or building (`buildings`) of
   * `type` (any type when undefined). Kept so an end rule read through knowledge never counts
   * "the enemy has none" before the side has seen any (`end.ts`). Not in `snapshot()`: it only
   * steers `matchResult`, never the plan's orders.
   */
  hasSeen(count: 'units' | 'buildings', type?: string): boolean {
    if (type !== undefined) return this.everSeen.has(`${count}:${type}`);
    for (const k of this.everSeen) if (k.startsWith(`${count}:`)) return true;
    return false;
  }

  /** The tick another side's building was last seen at, or null when it is not remembered. */
  lastSeen(id: number): number | null {
    return this.buildings.get(id)?.seen ?? null;
  }

  /** Whether another side's building is remembered but not on a cell seen now. */
  outOfSight(id: number, vis: RtsVisibility): boolean {
    const r = this.buildings.get(id);
    return r !== undefined && !seesBox(vis, r.building.x, r.building.y, r.building.w, r.building.h);
  }

  /** The view as the side knows it (see the file comment); `vis` defaults to what it sees now. */
  known(view: RtsView, vis: RtsVisibility = visibility(view, this.faction)): RtsView {
    const units = view.units.filter((u) => u.faction === this.faction || isVisible(vis, u.x, u.y));
    const buildings: RtsBuildingView[] = [];
    const current = new Set<number>();
    for (const b of view.buildings) {
      if (b.faction !== this.faction && !seesBox(vis, b.x, b.y, b.w, b.h)) continue;
      buildings.push(b);
      current.add(b.id);
    }
    // A remembered building on a cell seen now that is not in the view is gone (`update` forgets it).
    for (const [id, r] of this.buildings) {
      const b = r.building;
      if (!current.has(id) && !seesBox(vis, b.x, b.y, b.w, b.h)) buildings.push(b);
    }
    buildings.sort((a, b) => a.id - b.id);
    return { ...view, units, buildings };
  }

  /** The memory as plain JSON (see the file comment). */
  snapshot(): JsonObject {
    const explored: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let row = '';
      for (let x = 0; x < this.width; x++) row += this.explored[y * this.width + x] === 1 ? '1' : '0';
      explored.push(row);
    }
    const buildings = [...this.buildings.values()]
      .sort((a, b) => a.building.id - b.building.id)
      .map(({ building: b, seen }) => ({
        id: b.id,
        kind: b.kind,
        faction: b.faction,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        seen,
      }));
    return { explored, buildings };
  }
}
