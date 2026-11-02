import type { ScreenSize } from '../gfx/screen';
import type { SkinFile } from './skin';
import type { DeepReadonly, PresentEntity, PresentFrame } from './types';

/** The camera's top-left in whole world pixels (shake not included). */
export interface CameraPoint {
  x: number;
  y: number;
}

/** The map the camera is framed on: its id for snapping and its size for clamping. */
export interface CameraMap {
  id: string;
  cols: number;
  rows: number;
  tileSize: number;
}

export interface CameraFollowerOptions {
  /** Keep the view inside the hint's `bounds`, else the map (default true). */
  clamp?: boolean;
}

type Frame = DeepReadonly<PresentFrame>;
type SkinCamera = DeepReadonly<NonNullable<SkinFile['camera']>>;

/**
 * Camera framing shared by every backend, so 2D and 3D frame the same world point. Pure: it
 * keeps only its own last position, map id and frame number, which belong to the presenter that
 * owns this instance (never to a kit, a frame or a hash).
 *
 * - Target: the hint's `follow` entity (by id) when it is in the frame, else the hint's `x`/`y`,
 *   else the skin's `camera.follow` (an entity id, else a kind), else none (the map's top-left).
 *   An entity's target point is its box centre.
 * - `deadzone` and `lerp`: the hint's own, else the skin's, else none (0x0) and 1.
 * - Deadzone: a `w` x `h` box round the picture's centre the target moves in without
 *   scrolling; past its edge the camera moves just enough to put the target back on the edge.
 * - Lerp: the camera closes `lerp` of the gap to that position each frame, in whole pixels and
 *   1/256 fixed point (`Math.trunc`, at least 1 px while there is a gap, so it always arrives);
 *   1 snaps, 0 holds still. The first frame, a new map id and a frame with no target snap.
 * - Clamp (unless `clamp` is false): the view stays inside the hint's `bounds`, else the map;
 *   an area smaller than the picture is centred on that axis.
 * - A frame with the same `frame` number as the last one does not move the camera again.
 */
export class CameraFollower {
  private readonly clamp: boolean;
  private cam: CameraPoint | null = null;
  private camFrame: number | null = null;
  private camMap: string | null = null;

  constructor(opts: CameraFollowerOptions = {}) {
    this.clamp = opts.clamp !== false;
  }

  /**
   * The camera's top-left for `frame`, framed in a picture of `size`. `map` is the map shown
   * this frame (null when none is), `skinCamera` the skin's `camera` defaults.
   */
  update(
    frame: Frame,
    skinCamera: SkinCamera | undefined,
    size: ScreenSize,
    map: DeepReadonly<CameraMap> | null,
  ): CameraPoint {
    if (this.cam === null || this.camFrame !== frame.frame) {
      this.cam = this.frameCamera(frame, skinCamera, size, map);
      this.camFrame = frame.frame;
    }
    return { x: this.cam.x, y: this.cam.y };
  }

  /** Forgets the position, so the next frame snaps. */
  reset(): void {
    this.cam = null;
    this.camFrame = null;
    this.camMap = null;
  }

  private frameCamera(
    frame: Frame,
    skinCam: SkinCamera | undefined,
    size: ScreenSize,
    map: DeepReadonly<CameraMap> | null,
  ): CameraPoint {
    const hint = frame.camera;
    const center = cameraTarget(frame, skinCam);
    const mapId = map?.id ?? null;
    const prev = this.cam;
    const snap = prev === null || center === null || mapId !== this.camMap;
    this.camMap = mapId;

    const deadzone = hint?.deadzone ?? skinCam?.deadzone ?? { w: 0, h: 0 };
    const lerp = lerpStep(hint?.lerp ?? skinCam?.lerp ?? 1);
    const area = this.clampArea(frame, map);
    const axis = (
      target: number | undefined,
      from: number | undefined,
      view: number,
      dz: number,
      start: number,
      extent: number,
    ) => {
      // The camera that would centre the target, then the deadzone's pull on it.
      let want = target === undefined ? 0 : Math.round(target - view / 2);
      if (!snap && from !== undefined && target !== undefined) {
        const offset = target - view / 2 - from;
        const half = dz / 2;
        if (offset > half) want = Math.round(target - view / 2 - half);
        else if (offset < -half) want = Math.round(target - view / 2 + half);
        else want = from;
      }
      if (area) want = clampAxis(want, start, extent, view);
      let at = snap || from === undefined ? want : approach(from, want, lerp);
      if (area) at = clampAxis(at, start, extent, view);
      return at;
    };
    return {
      x: axis(center?.x, prev?.x, size.width, deadzone.w, area?.x ?? 0, area?.w ?? 0),
      y: axis(center?.y, prev?.y, size.height, deadzone.h, area?.y ?? 0, area?.h ?? 0),
    };
  }

  /** The world box the view is kept inside, or null when nothing clamps it. */
  private clampArea(
    frame: Frame,
    map: DeepReadonly<CameraMap> | null,
  ): { x: number; y: number; w: number; h: number } | null {
    if (!this.clamp) return null;
    const bounds = frame.camera?.bounds;
    if (bounds) return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
    return map ? { x: 0, y: 0, w: map.cols * map.tileSize, h: map.rows * map.tileSize } : null;
  }
}

/** The world point to keep in view (see `CameraFollower`), or null when there is none. */
export function cameraTarget(frame: Frame, skinCam: SkinCamera | undefined): CameraPoint | null {
  const centre = (e: DeepReadonly<PresentEntity>) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
  const hint = frame.camera;
  if (hint) {
    const followed = hint.follow === undefined ? undefined : frame.entities.find((e) => e.id === hint.follow);
    return followed ? centre(followed) : { x: hint.x, y: hint.y };
  }
  const follow = skinCam?.follow;
  if (follow === undefined) return null;
  const target = frame.entities.find((e) => e.id === follow) ?? frame.entities.find((e) => e.kind === follow);
  return target ? centre(target) : null;
}

/**
 * The horizontal shake offset for one frame, in whole pixels (never stored in the camera): the
 * hint's `shake` plus each of `extra` (a backend's shake effects), alternating sides each frame.
 */
export function cameraShake(frame: Frame, extra: readonly number[] = []): number {
  let strength = frame.camera?.shake ?? 0;
  for (const s of extra) strength += s;
  if (strength <= 0) return 0;
  return Math.round(strength) * (frame.frame % 2 === 0 ? 1 : -1);
}

/**
 * The whole-pixel top-left on one axis that keeps a `view`-wide picture inside the area from
 * `start`, `extent` wide; an area narrower than the picture is centred.
 */
function clampAxis(at: number, start: number, extent: number, view: number): number {
  if (extent <= view) return Math.round(start + (extent - view) / 2);
  return Math.min(Math.max(at, Math.ceil(start)), Math.floor(start + extent - view));
}

/** Lerp as a fraction of 256 (fixed point): 256 snaps, 0 holds; any positive lerp moves. */
function lerpStep(lerp: number): number {
  if (lerp >= 1) return 256;
  if (lerp <= 0) return 0;
  return Math.max(1, Math.round(lerp * 256));
}

/** One frame of lerp from `from` to `to` (whole pixels): `step`/256 of the gap, at least 1 px. */
function approach(from: number, to: number, step: number): number {
  const gap = to - from;
  if (gap === 0 || step >= 256) return to;
  if (step === 0) return from;
  const move = Math.trunc((gap * step) / 256);
  return from + (move === 0 ? Math.sign(gap) : move);
}
