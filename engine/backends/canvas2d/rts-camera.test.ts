import { describe, expect, it } from 'vitest';
import type { Renderer } from '@engine/core/gfx/renderer';
import { RtsCamera, type PresentFrame, type PresentMap, type SkinFile } from '@engine/core/present';
import { SkinnedCanvasPresenter } from './presenter';

/*
 * Engine 0.9 T5: the RTS camera's screen <-> world maths agrees with what this presenter draws.
 * A fallback box per entity shows exactly where a world point lands on the picture.
 */

const VIEW = { width: 320, height: 240 };
/** 128 x 128 tiles of 16 px: 2048 x 2048, much larger than the picture. */
const MAP: PresentMap = {
  id: 'big',
  version: 0,
  tileSize: 16,
  cols: 128,
  rows: 128,
  tiles: Array(128).fill('.'.repeat(128)),
};
const SKIN: SkinFile = { backend: 'canvas2d', kinds: {}, camera: { lerp: 0.1, deadzone: { w: 80, h: 80 } } };

function presenter() {
  const rects: string[] = [];
  const maps: string[] = [];
  const r: Renderer = {
    clear: () => {},
    rect: (x, y, w, h) => rects.push(`${x},${y} ${w}x${h}`),
    sprite: (s, _f, x, y) => {
      if (s.id.startsWith('map:')) maps.push(`${x},${y}`);
    },
    text: () => {},
    debugText: () => {},
    line: () => {},
  };
  const p = new SkinnedCanvasPresenter(r, SKIN, () => null, {
    mapSurface: () => ({ renderer: { ...r, rect: () => {} }, image: null }),
  });
  return { p, rects, maps };
}

/** World points to place an entity on: the corners of a tile and odd ones. */
const POINTS: readonly (readonly [number, number])[] = [
  [1000, 1000],
  [1001, 1003],
  [1077, 1111],
  [999.5, 1020.25],
];

describe('RtsCamera and the Canvas2D presenter', () => {
  for (const zoom of [0.5, 1, 2]) {
    it(`draws each world point where worldToScreen says, and back, at zoom ${zoom}`, () => {
      const { p, rects, maps } = presenter();
      const cam = new RtsCamera({
        view: VIEW,
        area: { x: 0, y: 0, w: 2048, h: 2048 },
        zoom,
        centre: { x: 1040, y: 1060 },
      });
      for (let frame = 0; frame < 3; frame++) {
        rects.length = 0;
        maps.length = 0;
        const entities = POINTS.map(([x, y], i) => ({
          id: `e${i}`,
          kind: 'unit',
          x,
          y,
          w: 8,
          h: 8,
          facing: 'down' as const,
          anim: { state: 'idle', t: 0 },
          tags: [],
        }));
        const f: PresentFrame = {
          frame,
          size: VIEW,
          entities,
          map: MAP,
          events: [],
          status: {},
          camera: cam.hint(),
        };
        p.present(f);
        // The map copy sits at minus the camera's top-left in picture pixels.
        const tl = cam.topLeft();
        expect(maps).toEqual([`${-Math.round(tl.x * zoom)},${-Math.round(tl.y * zoom)}`]);
        POINTS.forEach(([x, y], i) => {
          const at = cam.worldToScreen(x, y);
          expect(rects[i]!.split(' ')[0]).toBe(`${at.x},${at.y}`);
          // And the picture pixel maps back to within one picture pixel of the world point.
          const back = cam.screenToWorld(at.x, at.y);
          expect(Math.abs(back.x - x) * zoom).toBeLessThanOrEqual(0.5);
          expect(Math.abs(back.y - y) * zoom).toBeLessThanOrEqual(0.5);
        });
        // Scroll and zoom a little between frames; the skin's lerp and deadzone never lag it.
        cam.panBy(37, -21);
      }
    });
  }

  it('agrees at the clamped edges of the map', () => {
    for (const zoom of [0.5, 1, 2]) {
      const { p, maps } = presenter();
      const cam = new RtsCamera({ view: VIEW, area: { x: 0, y: 0, w: 2048, h: 2048 }, zoom });
      cam.panBy(-1e6, -1e6);
      p.present({ frame: 0, size: VIEW, entities: [], map: MAP, events: [], status: {}, camera: cam.hint() });
      const tl = cam.topLeft();
      expect(tl).toEqual({ x: 2048 - 320 / zoom, y: 2048 - 240 / zoom });
      expect(maps).toEqual([`${-tl.x * zoom},${-tl.y * zoom}`]);
    }
  });
});
