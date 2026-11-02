import type { DeepReadonly, PresentMap, PresentMapRef } from './types';

/**
 * Decides when a frame must carry the full map: on the first frame, when the map's id changes (a
 * new level) and when its version changes (a tile changed). Otherwise the frame carries only the
 * id and version. One tracker per presentation stream; `reset()` makes the next frame send it again
 * (a backend was swapped or reloaded).
 */
export class MapTracker {
  private sent: PresentMapRef | null = null;

  /** The map to put in this frame: `map` itself when it must be sent, else `{ id, version }`. */
  next(map: PresentMap): PresentMap | PresentMapRef;
  next(map: DeepReadonly<PresentMap>): DeepReadonly<PresentMap> | PresentMapRef;
  next(map: DeepReadonly<PresentMap>): DeepReadonly<PresentMap> | PresentMapRef {
    if (this.sent !== null && this.sent.id === map.id && this.sent.version === map.version) {
      return { id: map.id, version: map.version };
    }
    this.sent = { id: map.id, version: map.version };
    return map;
  }

  reset(): void {
    this.sent = null;
  }
}
