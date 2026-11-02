import { describe, expect, it } from 'vitest';
import { CameraFollower, cameraView } from './camera';
import { RtsCamera } from './rts-camera';
import type { PresentFrame } from './types';

const VIEW = { width: 320, height: 240 };
/** A 128 x 128 map of 16 px tiles. */
const AREA = { x: 0, y: 0, w: 2048, h: 2048 };

function cam(over: Partial<ConstructorParameters<typeof RtsCamera>[0]> = {}) {
  return new RtsCamera({ view: VIEW, area: AREA, ...over });
}

/** The top-left `CameraFollower` frames from the camera's hint, as both presenters call it. */
function followed(c: RtsCamera, frame = 0, follower = new CameraFollower()) {
  const hint = c.hint();
  const f: PresentFrame = { frame, size: VIEW, entities: [], events: [], status: {}, camera: hint };
  return follower.update(f, { lerp: 0.25, deadzone: { w: 64, h: 64 } }, cameraView(VIEW, hint.zoom!), {
    id: 'm',
    cols: 128,
    rows: 128,
    tileSize: 16,
  });
}

describe('RtsCamera', () => {
  it('starts centred on the area at zoom 1, or where it is told', () => {
    expect(cam().topLeft()).toEqual({ x: 864, y: 904 });
    expect(cam({ centre: { x: 200, y: 300 } }).centre()).toEqual({ x: 200, y: 300 });
  });

  it('clamps scrolling to the area at every zoom', () => {
    for (const zoom of [0.5, 1, 2]) {
      const c = cam({ zoom });
      const v = c.viewSize();
      c.panBy(1e6, 1e6);
      expect(c.topLeft()).toEqual({ x: 0, y: 0 });
      c.panBy(-1e7, -1e7);
      expect(c.topLeft()).toEqual({ x: 2048 - v.width, y: 2048 - v.height });
      // Back off the edge at once: the overshoot was not stored.
      c.panBy(10 * zoom, 0);
      expect(c.topLeft().x).toBe(2048 - v.width - 10);
    }
  });

  it('centres an area smaller than the view', () => {
    const c = cam({ area: { x: 0, y: 0, w: 100, h: 1000 }, zoom: 1 });
    c.panBy(500, 0);
    expect(c.topLeft().x).toBe(-110);
  });

  it('keeps the zoom inside its limits', () => {
    const c = cam();
    c.zoomBy(100);
    expect(c.zoom).toBe(2);
    c.zoomBy(0.001);
    expect(c.zoom).toBe(0.5);
    c.zoomTo(1);
    c.zoomBy(Number.NaN);
    expect(c.zoom).toBe(1);
    const tight = cam({ minZoom: 1, maxZoom: 1.5, zoom: 4 });
    expect(tight.zoom).toBe(1.5);
    expect(() => cam({ minZoom: 0 })).toThrow(/zoom limits/);
    expect(() => cam({ minZoom: 2, maxZoom: 1 })).toThrow(/zoom limits/);
  });

  it('zooms about a picture point, keeping the world point under it', () => {
    const c = cam({ centre: { x: 1000, y: 1000 } });
    const at = { x: 40, y: 200 };
    const before = c.screenToWorld(at.x, at.y);
    c.zoomBy(2, at);
    const after = c.screenToWorld(at.x, at.y);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  });

  it('adds up slow pans and pinches that are each smaller than a step', () => {
    const c = cam({ zoom: 2, centre: { x: 1000, y: 1000 } });
    const x0 = c.topLeft().x;
    for (let i = 0; i < 10; i++) c.panBy(-0.5, 0);
    expect(c.topLeft().x).toBeGreaterThan(x0);
    const z = cam();
    for (let i = 0; i < 20; i++) z.zoomBy(1.002);
    expect(z.zoom).toBeGreaterThan(1);
  });

  it('applies pan and zoom gestures and leaves taps and boxes alone', () => {
    const c = cam({ centre: { x: 1000, y: 1000 } });
    expect(c.apply({ type: 'pan', dx: 16, dy: -8, source: 'drag' })).toBe(true);
    expect(c.centre()).toEqual({ x: 984, y: 1008 });
    expect(c.apply({ type: 'zoom', factor: 2, x: 160, y: 120, source: 'wheel' })).toBe(true);
    expect(c.zoom).toBe(2);
    expect(c.apply({ type: 'tap', button: 'primary', x: 1, y: 1, kind: 'mouse' })).toBe(false);
  });

  it('round-trips screen -> world -> screen at zooms 0.5, 1, 1.5 and 2', () => {
    for (const zoom of [0.5, 1, 1.5, 2]) {
      for (const centre of [
        { x: 0, y: 0 },
        { x: 777, y: 1234 },
        { x: 5000, y: 5000 },
      ]) {
        const c = cam({ zoom, centre });
        for (const [sx, sy] of [
          [0, 0],
          [1, 1],
          [159, 120],
          [319, 239],
          [77, 3],
        ] as const) {
          const w = c.screenToWorld(sx, sy);
          expect(c.worldToScreen(w.x, w.y)).toEqual({ x: sx, y: sy });
        }
      }
    }
  });

  it('turns a picture box into a world box', () => {
    const c = cam({ zoom: 2, centre: { x: 1000, y: 1000 } });
    const tl = c.topLeft();
    expect(c.screenBoxToWorld({ x: 20, y: 10, w: 40, h: 60 })).toEqual({
      x: tl.x + 10,
      y: tl.y + 5,
      w: 20,
      h: 30,
    });
  });

  it('gives a hint the follower frames to exactly its own top-left, whatever the skin says', () => {
    for (const zoom of [0.5, 1, 1.5, 2]) {
      const c = cam({ zoom, centre: { x: 333, y: 1999 } });
      const follower = new CameraFollower();
      expect(followed(c, 0, follower)).toEqual(c.topLeft());
      // Later frames with a skin deadzone and lerp still land on the camera at once.
      c.panBy(-123, 45);
      expect(followed(c, 1, follower)).toEqual(c.topLeft());
      c.panBy(1e6, 1e6);
      expect(followed(c, 2, follower)).toEqual(c.topLeft());
    }
  });

  it('keeps the centre through a resize', () => {
    const c = cam({ centre: { x: 1000, y: 1000 } });
    c.resize({ width: 640, height: 480 });
    expect(c.centre()).toEqual({ x: 1000, y: 1000 });
    expect(c.viewSize()).toEqual({ width: 640, height: 480 });
  });
});
