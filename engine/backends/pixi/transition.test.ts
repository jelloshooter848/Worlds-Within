import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { transitionAlphaAt, transitionAt, transitionShape, type TransitionShape } from '@engine/core/fx';
import { drawTransition } from './transition';

// Screen transitions on a PixiJS Graphics (Engine 0.16 T13b-3), checked through its fill
// instructions (built in Node; nothing renders) against the per-pixel cover every display draws.

const SCREEN = { width: 64, height: 40 };

const shapeAt = (
  spec: Parameters<typeof transitionAt>[0],
  age: number,
  focus = null as { x: number; y: number } | null,
) => transitionShape(transitionAt(spec, age)!, SCREEN, focus)!;

interface Fill {
  rect: [number, number, number, number] | null;
  color: number;
  alpha: number;
  holes: { x: number; y: number; radius: number }[];
}

/** The graphics' fills: each one's rectangle, colour, alpha and circle holes. */
function fills(g: Graphics): Fill[] {
  return g.context.instructions.map((i) => {
    const data = i.data as unknown as {
      path: {
        shapePath: {
          shapePrimitives: { shape: { type: string; x: number; y: number; width: number; height: number } }[];
        };
      };
      style: { color: number; alpha: number };
      hole?: { shapePath: { shapePrimitives: { shape: { x: number; y: number; radius: number } }[] } };
    };
    const shape = data.path.shapePath.shapePrimitives[0]!.shape;
    return {
      rect: shape.type === 'rectangle' ? [shape.x, shape.y, shape.width, shape.height] : null,
      color: data.style.color,
      alpha: data.style.alpha,
      holes: (data.hole?.shapePath.shapePrimitives ?? []).map(({ shape: c }) => ({
        x: c.x,
        y: c.y,
        radius: c.radius,
      })),
    };
  });
}

/** The cover's alpha at a pixel centre, from the fills (normal blending, one colour). */
function alphaAt(list: Fill[], x: number, y: number): number {
  let a = 0;
  for (const f of list) {
    const [rx, ry, rw, rh] = f.rect!;
    const inRect = x + 0.5 >= rx && x + 0.5 < rx + rw && y + 0.5 >= ry && y + 0.5 < ry + rh;
    const inHole = f.holes.some((h) => Math.hypot(x + 0.5 - h.x, y + 0.5 - h.y) < h.radius);
    if (inRect && !inHole) a = a + f.alpha * (1 - a);
  }
  return a;
}

describe('drawTransition on a PixiJS Graphics (Engine 0.16 T13b-3)', () => {
  it('fades: the colour over the whole picture at the coverage', () => {
    const g = new Graphics();
    drawTransition(g, shapeAt({ kind: 'fade', ticks: 4, color: '#102030' }, 1), SCREEN);
    expect(fills(g)).toEqual([{ rect: [0, 0, 64, 40], color: 0x102030, alpha: 0.5, holes: [] }]);
  });

  it('wipes: one opaque box and a band per pixel of the soft edges, matching the per-pixel cover', () => {
    for (const direction of ['right', 'left', 'down', 'up'] as const) {
      for (const [age, phase] of [
        [3, 'out'],
        [11, 'in'],
      ] as const) {
        const g = new Graphics();
        const shape = shapeAt({ kind: 'wipe', ticks: 8, direction, edge: 8 }, age) as Extract<
          TransitionShape,
          { kind: 'wipe' }
        >;
        drawTransition(g, shape, SCREEN);
        const list = fills(g);
        expect(list.filter((f) => f.alpha === 1).length, `${direction} ${phase}`).toBeLessThanOrEqual(1);
        for (let y = 0; y < SCREEN.height; y += 3)
          for (let x = 0; x < SCREEN.width; x++)
            expect(alphaAt(list, x, y), `${direction} ${phase} ${x},${y}`).toBeCloseTo(
              transitionAlphaAt(shape, x, y, SCREEN),
              6,
            );
      }
    }
  });

  it('irises: the picture covered, the circle on the focus cut out as a hole', () => {
    const g = new Graphics();
    const shape = shapeAt({ kind: 'iris', ticks: 4, color: '#fff' }, 2, { x: 20, y: 10 }) as Extract<
      TransitionShape,
      { kind: 'iris' }
    >;
    drawTransition(g, shape, SCREEN);
    expect(fills(g)).toEqual([
      { rect: [0, 0, 64, 40], color: 0xffffff, alpha: 1, holes: [{ x: 20, y: 10, radius: shape.radius }] },
    ]);
  });

  it('clears what it drew when no transition shows', () => {
    const g = new Graphics();
    drawTransition(g, shapeAt({ kind: 'fade', ticks: 4 }, 1), SCREEN);
    drawTransition(g, null, SCREEN);
    expect(fills(g)).toEqual([]);
  });
});
