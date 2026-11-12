import { describe, expect, it } from 'vitest';
import { ditheredRadial, LIGHT_DITHER_LEVELS, lightStops } from '@engine/core/fx';

// A rough time budget for the dithered light falloff (Engine 0.16 polish P, release review): it
// runs for every light twice a frame, so `ditheredRadial` must stay cheap and reuse its work. It
// lives here, not beside `dither.ts`, because `engine/core/fx` may not read the wall clock.
describe('dithered falloff time budget', () => {
  it("keeps a frame of the Old Crypt's lights within a rough time budget", () => {
    // Engine 0.16 polish P review: the dithered falloff once took about 12 ms a radius-84 fill and
    // went from 7 s to 40 s on the dungeon's presentation-invariance runs. A frame here is four
    // flickering radius-84 torches (each erased and added: a stepped intensity, so they repeat)
    // and two steady radius-140 lights, with the camera scrolling a pixel a frame: 240 frames,
    // 2880 fills. Worked out afresh every time (as P3 did) that took about 10 s; reused, well
    // under a second.
    const bounds = { width: 256, height: 240 };
    const levels = { size: 8, levels: LIGHT_DITHER_LEVELS } as const;
    const start = performance.now();
    for (let frame = 0; frame < 240; frame++) {
      const scroll = frame % 32;
      for (let t = 0; t < 4; t++) {
        const step = Math.round(Math.sin(frame * 0.3 + t) * 4) / 4;
        const x = 40 + t * 60 - scroll;
        const radius = Math.round(84 * (1 + 0.12 * step));
        ditheredRadial(
          { x, y: 12, radius, stops: lightStops(0.95 * (1 + 0.06 * step), 0, 8) },
          levels,
          bounds,
        );
        ditheredRadial(
          { x, y: 12, radius, stops: lightStops(0.16 * (1 + 0.12 * step), 0, 8) },
          levels,
          bounds,
        );
      }
      for (const x of [80, 200]) {
        ditheredRadial({ x, y: 160, radius: 140, stops: lightStops(0.9, 0, 8) }, levels, bounds);
        ditheredRadial({ x, y: 160, radius: 140, stops: lightStops(0.2, 0, 8) }, levels, bounds);
      }
    }
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
