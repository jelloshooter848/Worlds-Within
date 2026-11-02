import type { ScreenSize } from '../gfx/screen';
import type { PointerGesture } from '../input/pointer-logic';
import { cameraView, clampCameraAxis, type CameraPoint } from './camera';
import type { CameraHint, PresentBox } from './types';

/** The zoom an `RtsCamera` keeps to by default: from half size to double. */
export const RTS_MIN_ZOOM = 0.5;
export const RTS_MAX_ZOOM = 2;
/** Zoom is shown in steps of 1/64 (so 0.5, 1 and 2 are exact); the wanted zoom keeps its fraction. */
const ZOOM_QUANTUM = 64;

export interface RtsCameraOptions {
  /** The picture size (picture pixels). */
  view: ScreenSize;
  /** The world box the view stays inside, usually the whole map (`{ x: 0, y: 0, w: cols * tileSize, h: rows * tileSize }`). */
  area: PresentBox;
  /** The starting zoom (default 1), kept inside the limits. */
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  /** The world point to start centred on (default the area's centre). */
  centre?: CameraPoint;
}

/**
 * A scrolling, zoomable view over a map larger than the screen (Engine 0.9, the RTS view): the
 * camera's position and zoom, moved by pan and zoom gestures (`input/pointer-logic.ts`) or by
 * code, and the conversion between picture and world pixels. Pure, and presentation only: it
 * lives in the game's glue or a kit's presentation state, never in a world or a hash.
 *
 * Its `hint()` is a `CameraHint` that makes `CameraFollower` (and so both presenters) frame
 * exactly the view this camera has: the same whole-pixel top-left, clamped the same way
 * (`clampCameraAxis`) inside the same `bounds`, with no deadzone and no lerp. So
 * `screenToWorld` and `worldToScreen` agree with what the Canvas2D presenter draws: a world point
 * (wx, wy) is drawn at `round(wx * zoom) - round(left * zoom)` (shake aside).
 */
export class RtsCamera {
  private view: ScreenSize;
  private readonly area: PresentBox;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** The zoom asked for (unquantised, so slow pinches add up). */
  private wanted: number;
  /** The top-left in world pixels, unrounded (so slow pans at high zoom add up), kept in range. */
  private x = 0;
  private y = 0;

  constructor(opts: RtsCameraOptions) {
    this.view = { width: opts.view.width, height: opts.view.height };
    this.area = { x: opts.area.x, y: opts.area.y, w: opts.area.w, h: opts.area.h };
    this.minZoom = opts.minZoom ?? RTS_MIN_ZOOM;
    this.maxZoom = opts.maxZoom ?? RTS_MAX_ZOOM;
    if (!(this.minZoom > 0) || !(this.maxZoom >= this.minZoom)) {
      throw new Error(`RtsCamera: bad zoom limits ${this.minZoom}..${this.maxZoom}`);
    }
    this.wanted = this.limit(opts.zoom ?? 1);
    const c = opts.centre ?? { x: this.area.x + this.area.w / 2, y: this.area.y + this.area.h / 2 };
    this.centreOn(c.x, c.y);
  }

  /** The zoom drawn now (1/64 steps, inside the limits). */
  get zoom(): number {
    return Math.round(this.wanted * ZOOM_QUANTUM) / ZOOM_QUANTUM;
  }

  /** The world box the picture shows, in world pixels (the picture over the zoom). */
  viewSize(): ScreenSize {
    return cameraView(this.view, this.zoom);
  }

  /** The view's top-left in whole world pixels: the one `CameraFollower` frames from `hint()`. */
  topLeft(): CameraPoint {
    const v = this.viewSize();
    return {
      x: clampCameraAxis(Math.round(this.x), this.area.x, this.area.w, v.width),
      y: clampCameraAxis(Math.round(this.y), this.area.y, this.area.h, v.height),
    };
  }

  /** The camera hint for this frame's `PresentFrame.camera`. */
  hint(): CameraHint {
    const tl = this.topLeft();
    const v = this.viewSize();
    return {
      x: tl.x + v.width / 2,
      y: tl.y + v.height / 2,
      zoom: this.zoom,
      deadzone: { w: 0, h: 0 },
      lerp: 1,
      bounds: { ...this.area },
    };
  }

  /** The picture changed size: keeps the same world point at the centre. */
  resize(view: ScreenSize): void {
    const c = this.centre();
    this.view = { width: view.width, height: view.height };
    this.centreOn(c.x, c.y);
  }

  /** The world point at the picture's centre. */
  centre(): CameraPoint {
    const tl = this.topLeft();
    const v = this.viewSize();
    return { x: tl.x + v.width / 2, y: tl.y + v.height / 2 };
  }

  /** Puts the world point (wx, wy) at the picture's centre (as near as the area allows). */
  centreOn(wx: number, wy: number): void {
    const v = this.viewSize();
    this.moveTo(wx - v.width / 2, wy - v.height / 2);
  }

  /** Moves the content by (dx, dy) picture pixels, as a `pan` gesture gives them (drag right: dx > 0). */
  panBy(dx: number, dy: number): void {
    const z = this.zoom;
    this.moveTo(this.x - dx / z, this.y - dy / z);
  }

  /** Sets the zoom (kept inside the limits), keeping the world point under picture point `at` (default the centre) where it is. */
  zoomTo(zoom: number, at?: CameraPoint): void {
    const anchor = at ?? { x: this.view.width / 2, y: this.view.height / 2 };
    const world = this.screenToWorld(anchor.x, anchor.y);
    this.wanted = this.limit(zoom);
    const z = this.zoom;
    this.moveTo(world.x - anchor.x / z, world.y - anchor.y / z);
  }

  /** Multiplies the zoom by `factor` about picture point `at`, as a `zoom` gesture gives them. */
  zoomBy(factor: number, at?: CameraPoint): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    this.zoomTo(this.wanted * factor, at);
  }

  /**
   * Applies a pan or zoom gesture (`PointerGesture` from `input/pointer-logic.ts`); true when it
   * was one. Taps and boxes are the game's to read (`screenToWorld`, `screenBoxToWorld`).
   */
  apply(g: PointerGesture): boolean {
    if (g.type === 'pan') this.panBy(g.dx, g.dy);
    else if (g.type === 'zoom') this.zoomBy(g.factor, { x: g.x, y: g.y });
    else return false;
    return true;
  }

  /** The world point (world px, unrounded) shown at picture point (sx, sy). */
  screenToWorld(sx: number, sy: number): CameraPoint {
    const z = this.zoom;
    const tl = this.topLeft();
    return { x: (sx + Math.round(tl.x * z)) / z, y: (sy + Math.round(tl.y * z)) / z };
  }

  /** The picture pixel a world point is drawn at by the Canvas2D presenter (shake aside). */
  worldToScreen(wx: number, wy: number): CameraPoint {
    const z = this.zoom;
    const tl = this.topLeft();
    return { x: Math.round(wx * z) - Math.round(tl.x * z), y: Math.round(wy * z) - Math.round(tl.y * z) };
  }

  /** A picture-pixel box (a box gesture's `boxRect`) as a world box. */
  screenBoxToWorld(box: PresentBox): PresentBox {
    const a = this.screenToWorld(box.x, box.y);
    const b = this.screenToWorld(box.x + box.w, box.y + box.h);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  private limit(zoom: number): number {
    if (!Number.isFinite(zoom)) return this.wanted;
    return Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
  }

  /** Sets the unrounded top-left, kept where the clamp would put it. */
  private moveTo(x: number, y: number): void {
    const v = this.viewSize();
    this.x = keepIn(x, this.area.x, this.area.w, v.width);
    this.y = keepIn(y, this.area.y, this.area.h, v.height);
  }
}

/** One axis of the unrounded top-left kept inside the area (centred when the area is narrower). */
function keepIn(at: number, start: number, extent: number, view: number): number {
  if (extent <= view) return start + (extent - view) / 2;
  return Math.min(Math.max(at, Math.ceil(start)), Math.floor(start + extent - view));
}
