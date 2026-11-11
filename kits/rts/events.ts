import type { PresentEvent } from '@engine/core/present';
import { RTS_TILE_SIZE } from './present';
import type { OrderDraft } from './commands';
import { isFinished, type RtsView } from './snapshot';

/**
 * What happened between two views, as presentation events (Engine 0.15 T14): the RTS kit's
 * world snapshot carries no events (the sim's rules change components, they do not announce
 * anything), so a skin that wants a sound when a unit falls or a barracks is finished needs the
 * change read off the views. `RtsEventTracker` keeps the last view it saw and, for the next one,
 * lists what changed. It holds no world rule (it reads two views and decides nothing) and draws
 * nothing; one tracker per stream of frames, like `RtsPresentState`.
 *
 * Events (each with `side`, `own` / `enemy` / `neutral` for the player, so a skin can key on
 * `type:side=own`; `entity` the presented id, `x`/`y` the box's centre in world px):
 *
 * - `unit-ready`: a unit that was not in the last view (trained, or spawned); `unitType`.
 * - `unit-down`: a unit gone from the view (killed, or taken off the map); `unitType`.
 * - `unit-hit`: a unit whose hp fell; `damage`.
 * - `site-placed`: a building that was not in the last view, still under construction; `kind`.
 * - `building-done`: a building finished since the last view (a site that is now done); `kind`.
 * - `building-down`: a building gone from the view; `kind`.
 * - `building-hit`: a building whose hp fell; `damage`.
 * - `stock-up`: a faction's stockpile grew (a drop-off); `item`, `amount`.
 *
 * Events come in that order, each group ascending by id (the stock by faction, then item, in
 * sorted order), so the same views give the same events. The first view gives none (there is
 * nothing to compare it with), nor does a view of the same tick as the last (a page draws many
 * frames a tick). `reset()` forgets the last view.
 */
export class RtsEventTracker {
  private last: RtsView | null = null;

  constructor(
    /** The player's faction: `side` is `own` for it. */
    private readonly faction: string,
    /** World px per cell (`RTS_TILE_SIZE` by default), for the events' `x` and `y`. */
    private readonly tileSize = RTS_TILE_SIZE,
  ) {}

  /** The events between the last view and `view`, which becomes the last. */
  next(view: RtsView): PresentEvent[] {
    const last = this.last;
    if (last !== null && last.tick === view.tick) return [];
    this.last = view;
    return last === null ? [] : rtsEvents(last, view, this.faction, this.tileSize);
  }

  /** Forgets the last view: the next one gives no events. */
  reset(): void {
    this.last = null;
  }
}

/** The events between `before` and `after` for `faction` (see `RtsEventTracker`). */
export function rtsEvents(
  before: RtsView,
  after: RtsView,
  faction: string,
  tileSize = RTS_TILE_SIZE,
): PresentEvent[] {
  const side = (f: string | null) => (f === null ? 'neutral' : f === faction ? 'own' : 'enemy');
  const centre = (x: number, y: number, w: number, h: number) => ({
    x: (x + w / 2) * tileSize,
    y: (y + h / 2) * tileSize,
  });
  const out: PresentEvent[] = [];
  const unitsBefore = new Map(before.units.map((u) => [u.id, u]));
  const unitsAfter = new Map(after.units.map((u) => [u.id, u]));
  const buildingsBefore = new Map(before.buildings.map((b) => [b.id, b]));
  const buildingsAfter = new Map(after.buildings.map((b) => [b.id, b]));
  const ascending = <T extends { id: number }>(list: Iterable<T>) => [...list].sort((a, b) => a.id - b.id);

  for (const u of ascending(after.units)) {
    if (unitsBefore.has(u.id)) continue;
    out.push({
      type: 'unit-ready',
      side: side(u.faction),
      entity: `unit-${u.id}`,
      unitType: u.type,
      ...centre(u.x, u.y, 1, 1),
    });
  }
  for (const u of ascending(before.units)) {
    if (unitsAfter.has(u.id)) continue;
    out.push({
      type: 'unit-down',
      side: side(u.faction),
      entity: `unit-${u.id}`,
      unitType: u.type,
      ...centre(u.x, u.y, 1, 1),
    });
  }
  for (const u of ascending(after.units)) {
    const was = unitsBefore.get(u.id);
    if (was === undefined || u.hp >= was.hp) continue;
    out.push({
      type: 'unit-hit',
      side: side(u.faction),
      entity: `unit-${u.id}`,
      damage: was.hp - u.hp,
      ...centre(u.x, u.y, 1, 1),
    });
  }
  for (const b of ascending(after.buildings)) {
    const was = buildingsBefore.get(b.id);
    const at = {
      side: side(b.faction),
      entity: `building-${b.id}`,
      kind: b.kind,
      ...centre(b.x, b.y, b.w, b.h),
    };
    if (was === undefined) {
      if (!isFinished(b)) out.push({ type: 'site-placed', ...at });
    } else if (!isFinished(was) && isFinished(b)) out.push({ type: 'building-done', ...at });
  }
  for (const b of ascending(before.buildings)) {
    if (buildingsAfter.has(b.id)) continue;
    out.push({
      type: 'building-down',
      side: side(b.faction),
      entity: `building-${b.id}`,
      kind: b.kind,
      ...centre(b.x, b.y, b.w, b.h),
    });
  }
  for (const b of ascending(after.buildings)) {
    const was = buildingsBefore.get(b.id);
    if (was === undefined || b.hp >= was.hp) continue;
    out.push({
      type: 'building-hit',
      side: side(b.faction),
      entity: `building-${b.id}`,
      damage: was.hp - b.hp,
      ...centre(b.x, b.y, b.w, b.h),
    });
  }
  for (const f of Object.keys(after.stock).sort()) {
    const items = after.stock[f]!;
    for (const item of Object.keys(items).sort()) {
      const gained = items[item]! - (before.stock[f]?.[item] ?? 0);
      if (gained > 0) out.push({ type: 'stock-up', side: side(f), item, amount: gained });
    }
  }
  return out;
}

/**
 * A `bark` (Engine 0.16 part D, D5): the voice-like answer of the units an accepted order went
 * to, for a skin to map to a short sfx and a line of text (`bark:order=attack`,
 * `bark:unitType=worker`). Fields: `side` (`own` for `faction`'s order), `order` (the order's
 * type: `move`, `attack`, `gather`, `build`, `train`, `stop`), `unitType` (the first unit's type,
 * or for `train` the type trained), `entity` and `x`/`y` (the first ordered unit's or building's
 * box centre), and for `train` and `build` `kind` (the building's kind). Null when no ordered unit
 * or building is in the view. It only reads the view and the draft: whether the world carries the
 * order out is the sim's answer, so a page barks for an order the game accepted.
 */
export function barkEvent(
  view: RtsView,
  draft: OrderDraft,
  faction: string,
  tileSize = RTS_TILE_SIZE,
): PresentEvent | null {
  const side = draft.faction === faction ? 'own' : 'enemy';
  const first = draft.units[0];
  if (first === undefined) return null;
  if (draft.type === 'train') {
    const b = view.buildings.find((x) => x.id === first);
    if (b === undefined) return null;
    return {
      type: 'bark',
      side,
      order: 'train',
      unitType: draft.target,
      kind: b.kind,
      entity: `building-${b.id}`,
      x: (b.x + b.w / 2) * tileSize,
      y: (b.y + b.h / 2) * tileSize,
    };
  }
  const u = view.units.find((x) => x.id === first);
  if (u === undefined) return null;
  return {
    type: 'bark',
    side,
    order: draft.type,
    unitType: u.type,
    ...(draft.type === 'build' && { kind: draft.building }),
    entity: `unit-${u.id}`,
    x: (u.x + 0.5) * tileSize,
    y: (u.y + 0.5) * tileSize,
  };
}
