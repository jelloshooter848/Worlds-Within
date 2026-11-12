import type { PresentEvent } from '@engine/core/present';
import type { OrderDraft } from './commands';
import type { RtsView } from './snapshot';

/**
 * Order feedback in the world (Engine 0.16 part D, D5): where the player's command lands, as a
 * short-lived marker the presentation state carries (`RtsPresentState.accept`), never the world.
 * `RtsControls.feedback(draft, view)` gives the marker and the bark (`barkEvent`, `events.ts`) of
 * an order the page issued and the game accepted. Pure.
 */

/** What a marker shows: the order's kind. */
export type RtsMarkerKind = 'move' | 'attack' | 'gather' | 'build';

/** A command's target in the world, in cells: a cell, a building's footprint, or an entity. */
export interface RtsOrderMarker {
  kind: RtsMarkerKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The entity it points at (an attack's target, a gather's node), followed while shown; or null. */
  entity: number | null;
}

/** Ticks a marker stays (it fades in eighths over them). */
export const RTS_MARKER_TICKS = 8;

/** At most this many markers are kept (the oldest go first). */
export const RTS_MARKER_MAX = 8;

/**
 * Where `draft` lands: a `move` on its cell, a `build` on the new building's footprint (sized from
 * the world's types), an `attack` on its target's box, a `gather` on its node; null for `stop`,
 * `train` and a target the view does not have.
 */
export function orderMarker(view: RtsView, draft: OrderDraft): RtsOrderMarker | null {
  switch (draft.type) {
    case 'move':
      return { kind: 'move', x: draft.target.x, y: draft.target.y, w: 1, h: 1, entity: null };
    case 'build': {
      const size = view.types?.buildings[draft.building]?.size ?? { w: 1, h: 1 };
      return { kind: 'build', x: draft.target.x, y: draft.target.y, w: size.w, h: size.h, entity: null };
    }
    case 'attack': {
      const box = entityBox(view, draft.target);
      return box === null ? null : { kind: 'attack', ...box, entity: draft.target };
    }
    case 'gather': {
      const box = entityBox(view, draft.target);
      return box === null ? null : { kind: 'gather', ...box, entity: draft.target };
    }
    default:
      return null;
  }
}

/** The cell box of entity `id` in the view (a unit, a building's footprint, a node), or null. */
export function entityBox(view: RtsView, id: number): { x: number; y: number; w: number; h: number } | null {
  const u = view.units.find((x) => x.id === id);
  if (u) return { x: u.x, y: u.y, w: 1, h: 1 };
  const b = view.buildings.find((x) => x.id === id);
  if (b) return { x: b.x, y: b.y, w: b.w, h: b.h };
  const r = view.resources.find((x) => x.id === id);
  if (r) return { x: r.x, y: r.y, w: 1, h: 1 };
  return null;
}

/** An accepted order's feedback: its marker (or null) and its bark events (none or one). */
export interface RtsOrderFeedback {
  marker: RtsOrderMarker | null;
  events: PresentEvent[];
}
