import type { ScreenSize } from '../gfx/screen';
import { CAMERA_LOOK_AHEAD_LERP, type SkinFile } from './skin';
import { facesLeft, type DeepReadonly, type Facing, type PresentEntity, type PresentFrame } from './types';

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
 * - Look-ahead (Engine 0.16 T4, the skin's `camera.lookAhead`): when the target is a followed
 *   entity, the target point moves `x` world px ahead of it in its facing's horizontal direction
 *   and `y` in its vertical one ({@link facingVector}). The offset glides to a new facing at the
 *   look-ahead's `lerp` (default `CAMERA_LOOK_AHEAD_LERP`, whole px, 1/256 fixed point as above)
 *   and snaps with the camera. The deadzone (its `h` is the vertical deadzone) then applies to
 *   the point ahead.
 * - A frame with the same `frame` number as the last one does not move the camera again.
 */
export class CameraFollower {
  private readonly clamp: boolean;
  private cam: CameraPoint | null = null;
  private camFrame: number | null = null;
  private camMap: string | null = null;
  /** The look-ahead offset (world px) last frame. */
  private ahead: CameraPoint = { x: 0, y: 0 };

  constructor(opts: CameraFollowerOptions = {}) {
    this.clamp = opts.clamp !== false;
  }

  /**
   * The camera's top-left for `frame`, framed in a view of `size` world pixels: the picture size
   * at zoom 1, else `cameraView(picture, zoom)`. `map` is the map shown this frame (null when
   * none is), `skinCamera` the skin's `camera` defaults. The deadzone is in world pixels too.
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
    this.ahead = { x: 0, y: 0 };
  }

  /** The look-ahead offset (world px) the last frame used. */
  get lookAhead(): CameraPoint {
    return { ...this.ahead };
  }

  private frameCamera(
    frame: Frame,
    skinCam: SkinCamera | undefined,
    size: ScreenSize,
    map: DeepReadonly<CameraMap> | null,
  ): CameraPoint {
    const hint = frame.camera;
    const target = cameraTarget(frame, skinCam);
    const mapId = map?.id ?? null;
    const prev = this.cam;
    const snap = prev === null || target === null || mapId !== this.camMap;
    this.camMap = mapId;
    const ahead = this.lookAheadFor(frame, skinCam, snap);
    const center = target === null ? null : { x: target.x + ahead.x, y: target.y + ahead.y };

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
      if (area) want = clampCameraAxis(want, start, extent, view);
      let at = snap || from === undefined ? want : approach(from, want, lerp);
      if (area) at = clampCameraAxis(at, start, extent, view);
      return at;
    };
    return {
      x: axis(center?.x, prev?.x, size.width, deadzone.w, area?.x ?? 0, area?.w ?? 0),
      y: axis(center?.y, prev?.y, size.height, deadzone.h, area?.y ?? 0, area?.h ?? 0),
    };
  }

  /** The world box the view is kept inside, or null when nothing clamps it. */
  private clampArea(frame: Frame, map: DeepReadonly<CameraMap> | null): CameraArea | null {
    return cameraArea(frame, map, this.clamp);
  }

  /** This frame's look-ahead offset, moved toward the followed entity's facing (and kept). */
  private lookAheadFor(frame: Frame, skinCam: SkinCamera | undefined, snap: boolean): CameraPoint {
    const la = skinCam?.lookAhead;
    const followed = la === undefined ? null : cameraFollowed(frame, skinCam);
    if (la === undefined || followed === null) {
      this.ahead = { x: 0, y: 0 };
      return this.ahead;
    }
    const dir = facingVector(followed.facing);
    const want = { x: dir.x * Math.round(la.x ?? 0), y: dir.y * Math.round(la.y ?? 0) };
    const step = lerpStep(la.lerp ?? CAMERA_LOOK_AHEAD_LERP);
    this.ahead = snap
      ? want
      : { x: approach(this.ahead.x, want.x, step), y: approach(this.ahead.y, want.y, step) };
    return this.ahead;
  }
}

/** A world box: what the camera is kept inside. */
export interface CameraArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The world box a camera is kept inside for `frame`: the hint's `bounds`, else the map's, else
 * null (nothing clamps it); always null when `clamp` is false.
 */
export function cameraArea(
  frame: Frame,
  map: DeepReadonly<CameraMap> | null,
  clamp = true,
): CameraArea | null {
  if (!clamp) return null;
  const bounds = frame.camera?.bounds;
  if (bounds) return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
  return map ? { x: 0, y: 0, w: map.cols * map.tileSize, h: map.rows * map.tileSize } : null;
}

/**
 * A facing as a direction: `x` -1 (left-hand), 1 (right-hand) or 0 (`up`, `down`); `y` -1 (up,
 * up-left, up-right), 1 (down...) or 0 (`left`, `right`).
 */
export function facingVector(facing: Facing): CameraPoint {
  const x = facesLeft(facing) ? -1 : facing.endsWith('right') ? 1 : 0;
  const y = facing.startsWith('up') ? -1 : facing.startsWith('down') ? 1 : 0;
  return { x, y };
}

/**
 * A zoom punch (Engine 0.16 T4) on a framed camera: the top-left `cam` and world `view` zoomed by
 * `factor` (2 shows half as much) about `focus`, a world point that keeps its place on the
 * picture (the camera's target, so the player stays where it was; held inside the view), else
 * the view's centre. A punch out (`factor` < 1) is kept inside `area` when there is one
 * (`clampCameraAxis`); a punch in stays inside on its own.
 */
export function zoomAbout(
  cam: CameraPoint,
  view: ScreenSize,
  factor: number,
  area: CameraArea | null,
  focus: CameraPoint | null = null,
): { cam: CameraPoint; view: ScreenSize } {
  if (factor === 1) return { cam: { ...cam }, view: { ...view } };
  const zoomed = { width: view.width / factor, height: view.height / factor };
  // The focus as a share of the view (0 left or top, 1 right or bottom), the centre by default.
  const share = (at: number | undefined, from: number, extent: number) =>
    at === undefined ? 0.5 : Math.min(1, Math.max(0, (at - from) / extent));
  let x = cam.x + (view.width - zoomed.width) * share(focus?.x, cam.x, view.width);
  let y = cam.y + (view.height - zoomed.height) * share(focus?.y, cam.y, view.height);
  if (area && factor < 1) {
    x = clampCameraAxis(x, area.x, area.w, zoomed.width);
    y = clampCameraAxis(y, area.y, area.h, zoomed.height);
  }
  return { cam: { x, y }, view: zoomed };
}

/**
 * The zoom to draw `frame` at: the hint's `zoom`, else the skin's `camera.zoom`, else 1 (1 is one
 * world pixel per picture pixel; 2 draws everything twice as big).
 */
export function cameraZoom(frame: Frame, skinCam: SkinCamera | undefined): number {
  return frame.camera?.zoom ?? skinCam?.zoom ?? 1;
}

/**
 * The world box a picture of `size` shows at `zoom`, in world pixels (the picture size divided
 * by `zoom`). `CameraFollower.update` takes this, so framing, the deadzone and clamping all work in
 * zoomed units: at zoom 2 a 256-wide picture shows 128 world pixels and is clamped as such.
 */
export function cameraView(size: ScreenSize, zoom: number): ScreenSize {
  return { width: size.width / zoom, height: size.height / zoom };
}

/** The world point to keep in view (see `CameraFollower`), or null when there is none. */
export function cameraTarget(frame: Frame, skinCam: SkinCamera | undefined): CameraPoint | null {
  const followed = cameraFollowed(frame, skinCam);
  if (followed) return { x: followed.x + followed.w / 2, y: followed.y + followed.h / 2 };
  const hint = frame.camera;
  return hint ? { x: hint.x, y: hint.y } : null;
}

/**
 * The entity the camera follows on `frame`: the hint's `follow` (by id) when it is in the frame;
 * without a hint, the skin's `camera.follow` (an entity id, else a kind); else null.
 */
export function cameraFollowed(
  frame: Frame,
  skinCam: SkinCamera | undefined,
): DeepReadonly<PresentEntity> | null {
  const hint = frame.camera;
  if (hint) {
    if (hint.follow === undefined) return null;
    return frame.entities.find((e) => e.id === hint.follow) ?? null;
  }
  const follow = skinCam?.follow;
  if (follow === undefined) return null;
  return frame.entities.find((e) => e.id === follow) ?? frame.entities.find((e) => e.kind === follow) ?? null;
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
 * `start`, `extent` wide; an area narrower than the picture is centred. `RtsCamera` clamps with
 * it too, so its view is exactly the one the follower frames.
 */
export function clampCameraAxis(at: number, start: number, extent: number, view: number): number {
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
