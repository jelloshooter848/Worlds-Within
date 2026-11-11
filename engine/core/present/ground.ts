import type { ScreenSize } from '../gfx/screen';
import type { CameraPoint } from './camera';
import type { PresentBox } from './types';

/**
 * The ground view's camera maths (Engine 0.16 F2), shared by the 3D backend's camera
 * (`ThreeScene` in `engine/backends/three`) and the RTS camera's picking (`RtsCamera`), so what
 * is drawn and what a click picks can never drift apart. Pure numbers, no Three.js.
 *
 * Space: world px on the ground, `x` right (east) and `y` down the map (south), and `h`, the
 * height above the ground. (The 3D backend's axes are `(x, h, y)`: Three's y is up.)
 *
 * The camera looks at `centre` on the ground from `distance` away, `pitch` degrees down from the
 * horizon (90: straight down) and turned `yaw` degrees about the vertical (0: from the south,
 * looking north, so the map's up is the picture's up; 90: from the east, looking west). The
 * distance is the zoom: at `zoom` z the picture's height `size.height` shows `size.height / z`
 * world px of ground at the centre when looking straight down (the side view's rule, so 2D, the
 * side view and a top-down ground view frame the same box), whatever the pitch.
 */

/** A ground view's camera angles and lens, in degrees. */
export interface GroundCamera {
  /** Degrees down from the horizon, 10 to 90 (90: straight down). */
  pitch: number;
  /** Degrees about the vertical: 0 looks north (from the south), 90 looks west (from the east). */
  yaw: number;
  /** The vertical field of view. */
  fov: number;
}

/** A point or direction in ground space: world px `x`, `y` and height `h`. */
export interface GroundPoint {
  x: number;
  y: number;
  h: number;
}

/** A picture point (px, y down) and how far in front of the camera it is (world px along the view). */
export interface GroundScreenPoint {
  x: number;
  y: number;
  depth: number;
}

/** How far past the centre (in camera distances, along the ground) a ray that misses is taken to land. */
export const GROUND_REACH = 6;

/** One frame's ground camera: where it is, how it is turned, and the two conversions. */
export interface GroundProjection {
  readonly size: ScreenSize;
  readonly zoom: number;
  /** The ground point at the picture's centre. */
  readonly centre: CameraPoint;
  /** World px from the camera to the centre. */
  readonly distance: number;
  /** Picture px per world px at one world px in front of the camera (`height / (2 tan(fov / 2))`). */
  readonly focal: number;
  /** The camera's position. */
  readonly eye: GroundPoint;
  /** Unit directions: the view, the picture's right and the picture's up. */
  readonly forward: GroundPoint;
  readonly right: GroundPoint;
  readonly up: GroundPoint;
  /** The picture point (px, unrounded) of a world point at height `h`, or null when it is behind the camera. */
  worldToScreen(x: number, y: number, h?: number): GroundScreenPoint | null;
  /** Where the ray through picture point (sx, sy) meets the plane at height `h`, or null when it never does. */
  screenToGround(sx: number, sy: number, h?: number): CameraPoint | null;
  /**
   * {@link screenToGround} on the ground, or for a ray at or above the horizon (or one landing
   * further) the point {@link GROUND_REACH} camera distances out along its direction on the ground.
   */
  groundAt(sx: number, sy: number): CameraPoint;
  /** The ground points under the picture's four corners (top-left, top-right, bottom-right, bottom-left), via `groundAt`. */
  footprint(): CameraPoint[];
}

const DEG = Math.PI / 180;

/**
 * The ground camera for a picture of `size` at `zoom`, looking at `centre` (see the file
 * comment). Pure: the same inputs give the same numbers.
 */
export function groundProjection(
  size: ScreenSize,
  zoom: number,
  centre: CameraPoint,
  camera: GroundCamera,
): GroundProjection {
  const pitch = camera.pitch * DEG;
  const yaw = camera.yaw * DEG;
  const focal = size.height / (2 * Math.tan((camera.fov * DEG) / 2));
  const distance = focal / zoom;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  // Back (centre to eye), right and up; forward is minus back.
  const back = { x: cp * sy, y: cp * cy, h: sp };
  const forward = { x: -back.x, y: -back.y, h: -back.h };
  const right = { x: cy, y: -sy, h: 0 };
  const up = { x: -sp * sy, y: -sp * cy, h: cp };
  const eye = { x: centre.x + back.x * distance, y: centre.y + back.y * distance, h: back.h * distance };
  const near = Math.max(0.1, distance / 100);
  const dot = (a: GroundPoint, x: number, y: number, h: number) => a.x * x + a.y * y + a.h * h;

  const ray = (sx: number, sy: number): GroundPoint => {
    const a = (sx - size.width / 2) / focal;
    const b = -(sy - size.height / 2) / focal;
    return {
      x: forward.x + right.x * a + up.x * b,
      y: forward.y + right.y * a + up.y * b,
      h: forward.h + right.h * a + up.h * b,
    };
  };

  const proj: GroundProjection = {
    size: { width: size.width, height: size.height },
    zoom,
    centre: { x: centre.x, y: centre.y },
    distance,
    focal,
    eye,
    forward,
    right,
    up,
    worldToScreen(x, y, h = 0) {
      const vx = x - eye.x;
      const vy = y - eye.y;
      const vh = h - eye.h;
      const depth = dot(forward, vx, vy, vh);
      if (depth < near) return null;
      return {
        x: size.width / 2 + (focal * dot(right, vx, vy, vh)) / depth,
        y: size.height / 2 - (focal * dot(up, vx, vy, vh)) / depth,
        depth,
      };
    },
    screenToGround(sx, sy, h = 0) {
      const d = ray(sx, sy);
      if (!(d.h < 0)) return null;
      const t = (h - eye.h) / d.h;
      if (!(t > 0)) return null;
      return { x: eye.x + d.x * t, y: eye.y + d.y * t };
    },
    groundAt(sx, sy) {
      const reach = distance * GROUND_REACH;
      const hit = proj.screenToGround(sx, sy);
      const d = ray(sx, sy);
      const flat = Math.hypot(d.x, d.y);
      if (hit !== null && Math.hypot(hit.x - eye.x, hit.y - eye.y) <= reach) return hit;
      // Straight down never misses, so a miss has a direction along the ground.
      const fx = flat > 0 ? d.x / flat : forward.x;
      const fy = flat > 0 ? d.y / flat : forward.y;
      return { x: eye.x + fx * reach, y: eye.y + fy * reach };
    },
    footprint() {
      const { width: w, height: hh } = size;
      return [proj.groundAt(0, 0), proj.groundAt(w, 0), proj.groundAt(w, hh), proj.groundAt(0, hh)];
    },
  };
  return proj;
}

/** The smallest world box holding `points` (the footprint's bounds, say). */
export function pointsBox(points: readonly CameraPoint[]): PresentBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The centre nearest `centre` whose ground footprint (the bounds of the picture's corners on the
 * ground, `footprint()`) stays inside `area`; on an axis where the footprint is wider than the
 * area, the footprint is centred on it. The footprint's shape does not depend on the centre, so
 * this is exact in one step. Used by `RtsCamera` to keep a ground view over the map.
 */
export function clampGroundCentre(
  size: ScreenSize,
  zoom: number,
  centre: CameraPoint,
  camera: GroundCamera,
  area: PresentBox,
): CameraPoint {
  const box = pointsBox(groundProjection(size, zoom, { x: 0, y: 0 }, camera).footprint());
  const axis = (at: number, lo: number, extent: number, start: number, len: number) => {
    const min = start - lo;
    const max = start + len - (lo + extent);
    if (min > max) return (min + max) / 2;
    return Math.min(Math.max(at, min), max);
  };
  return {
    x: axis(centre.x, box.x, box.w, area.x, area.w),
    y: axis(centre.y, box.y, box.h, area.y, area.h),
  };
}

/** True when picture point `p` is inside the picture box `box` (any corners; edges included). */
export function inScreenBox(box: PresentBox, p: CameraPoint): boolean {
  const x0 = Math.min(box.x, box.x + box.w);
  const x1 = Math.max(box.x, box.x + box.w);
  const y0 = Math.min(box.y, box.y + box.h);
  const y1 = Math.max(box.y, box.y + box.h);
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
}

/**
 * The turn about the vertical (radians, Three's y axis, counter-clockwise seen from above) that
 * points a model's front (+z in Three, the map's south: `down`) toward a facing's direction
 * (`facingVector`): `down` 0, `right` a quarter turn, `up` a half, the diagonals in between.
 */
export function groundFacingTurn(dir: CameraPoint): number {
  if (dir.x === 0 && dir.y === 0) return 0;
  return Math.atan2(dir.x, dir.y);
}
