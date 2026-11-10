import { frameEventsBetween, type SkinFile } from './skin';
import type { DeepReadonly, PresentEntity, PresentEvent } from './types';

/** Whether an animation table has a cycle with frame `events`. */
function tableHasEvents(table: unknown): boolean {
  if (table === undefined || table === null || typeof table !== 'object') return false;
  for (const spec of Object.values(table as Record<string, unknown>)) {
    if (typeof spec !== 'object' || spec === null) continue;
    const s = spec as Record<string, unknown>;
    if (s['events'] !== undefined) return true;
    if (Object.values(s).some((v) => typeof v === 'object' && v !== null && 'events' in v)) return true;
  }
  return false;
}

/** The kinds of a skin with frame events (in their `frames`, `poses` or a look's `frames`), by skin. */
const eventKinds = new WeakMap<object, ReadonlySet<string>>();

function kindsWithEvents(skin: DeepReadonly<SkinFile>): ReadonlySet<string> {
  let kinds = eventKinds.get(skin);
  if (kinds === undefined) {
    kinds = new Set(
      Object.entries(skin.kinds)
        .filter(
          ([, e]) =>
            tableHasEvents(e.frames) ||
            tableHasEvents(e.poses) ||
            (e.byTag ?? []).some((look) => tableHasEvents(look.frames)),
        )
        .map(([kind]) => kind),
    );
    eventKinds.set(skin, kinds);
  }
  return kinds;
}

/**
 * A presenter's clock for frame events (Engine 0.16 T2): it remembers each entity's last
 * animation state and tick and, for each new frame, gives the frame events of the frames that
 * started since ({@link frameEventsBetween}) as synthetic `PresentEvent`s `{ type, entity, x, y,
 * state, frame, source: 'frame' }`, at the entity's bottom centre (its feet). An entity seen for the
 * first time, a new state, or a tick that went back counts from just before its tick now, so a
 * state's first frame fires and nothing before it does. A presenter runs them through the skin's
 * `events` (sounds, effects, tweens) with the frame's own events; they never go into the frame,
 * a kit or a hash. Presentation state only: one clock per presenter (and per skin). Pure.
 */
export class FrameEventClock {
  private last = new Map<string, { state: string; t: number }>();

  /** The frame events of `entities` since the last call, in entity then time order. */
  next(skin: DeepReadonly<SkinFile>, entities: readonly DeepReadonly<PresentEntity>[]): PresentEvent[] {
    const kinds = kindsWithEvents(skin);
    const out: PresentEvent[] = [];
    const seen = new Map<string, { state: string; t: number }>();
    if (kinds.size === 0) {
      this.last = seen;
      return out;
    }
    for (const e of entities) {
      if (!kinds.has(e.kind)) continue;
      const before = this.last.get(e.id);
      const { state, t } = e.anim;
      seen.set(e.id, { state, t });
      const prevT = before !== undefined && before.state === state && t >= before.t ? before.t : t - 1;
      for (const ev of frameEventsBetween(skin, e, prevT, t)) {
        out.push({
          type: ev.type,
          entity: e.id,
          x: e.x + e.w / 2,
          y: e.y + e.h,
          state: ev.state,
          frame: ev.index,
          source: 'frame',
        });
      }
    }
    this.last = seen;
    return out;
  }

  /** Forgets every entity (a new stream of frames). */
  reset(): void {
    this.last.clear();
  }
}
