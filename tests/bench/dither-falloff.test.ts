import { describe, expect, it } from 'vitest';
import {
  ditheredRadial,
  flickered,
  LIGHT_DITHER_FLICKER_STEPS,
  LIGHT_DITHER_LEVELS,
  lightStops,
  type DitheredStamp,
} from '@engine/core/fx';

// A rough time budget for the dithered light falloff (Engine 0.16 polish P, release review): it
// runs for every light twice a frame, so `ditheredRadial` must stay cheap and reuse its work. It
// lives here, not beside `dither.ts`, because `engine/core/fx` may not read the wall clock.
describe('dithered falloff time budget', () => {
  const bounds = { width: 256, height: 240 };
  const dither = { size: 8, levels: LIGHT_DITHER_LEVELS } as const;
  const torch = { radius: 84, intensity: 0.95, glow: 0.16 };
  const flicker = { amount: 0.12, rate: 5 };

  /**
   * One frame of the Old Crypt's lights as the skinned presenter draws them with the camera at
   * (`cx`, `cy`): 14 flickering radius-84 torches spread over the map (their noise stepped as
   * `SkinLighting.layout` steps it) and steady radius-140 and radius-160 lights, each erased out
   * of the darkness with its intensity and added with its glow. Lights off the picture are
   * dropped, as the layout drops them. The fills drawn.
   */
  function frame(n: number, cx: number, cy: number): (DitheredStamp | null)[] {
    const lights: { x: number; y: number; radius: number; intensity: number; glow: number }[] = [];
    for (let t = 0; t < 14; t++) {
      const raw = Math.sin(n * 0.21 + t * 1.7);
      const noise = Math.round(raw * LIGHT_DITHER_FLICKER_STEPS) / LIGHT_DITHER_FLICKER_STEPS;
      const l = flickered(torch, flicker, noise);
      const x = (t % 7) * 112 + 40 - cx;
      const y = Math.floor(t / 7) * 176 + 12 - cy;
      lights.push({ x, y, radius: Math.round(l.radius), intensity: l.intensity, glow: l.glow });
    }
    lights.push({ x: 300 - cx, y: 200 - cy, radius: 140, intensity: 1, glow: 0.6 });
    lights.push({ x: 520 - cx, y: 150 - cy, radius: 160, intensity: 1, glow: 0.6 });
    const out: (DitheredStamp | null)[] = [];
    for (const l of lights) {
      const { x, y, radius } = l;
      if (x + radius < 0 || y + radius < 0 || x - radius > bounds.width || y - radius > bounds.height)
        continue;
      out.push(ditheredRadial({ x, y, radius, stops: lightStops(l.intensity, 0, 8) }, dither, bounds));
      out.push(ditheredRadial({ x, y, radius, stops: lightStops(l.glow, 0, 8) }, dither, bounds));
    }
    return out;
  }

  it("keeps the Old Crypt's lights within a rough budget while the camera keeps scrolling", () => {
    // Engine 0.16 polish P review: the dithered falloff once took about 12 ms a radius-84 fill and
    // went from 7 s to 40 s on the dungeon's presentation-invariance runs; with stamps cached by
    // place it was still about 18 ms a frame while the camera scrolled. Here the camera never
    // comes back to a place (one pixel right and a third of one down a frame, 600 frames after
    // a warm-up), so only bytes kept by place-free keys (each light's Bayer phases and flicker
    // steps) are reused. Worked out afresh each frame, that takes seconds.
    const at = (n: number) => frame(n, n, Math.floor(n / 3));
    for (let n = 0; n < 64; n++) at(n);
    const start = performance.now();
    const fills: DitheredStamp[] = [];
    for (let n = 64; n < 664; n++) for (const s of at(n)) if (s !== null) fills.push(s);
    const perFrame = (performance.now() - start) / 600;
    expect(fills.length).toBeGreaterThan(600 * 8);
    // Worked out afresh only for a new phase or flicker step: each new array is one worked out
    // (about 7% of the fills; keyed by place, as before, it was nearly all of them).
    const worked = new Set(fills.map((s) => s.alpha)).size;
    expect(worked / fills.length).toBeLessThan(0.15);
    // About 0.35 ms a frame unloaded (keyed by place it was about 3.7 ms); 2 ms is a generous
    // budget on a loaded machine.
    expect(perFrame).toBeLessThan(2);
  });

  it("reuses a scrolled light's very bytes, across the picture's edge too", () => {
    const at = { y: 100, radius: 84, stops: lightStops(0.95, 0, 8) };
    const a = ditheredRadial({ ...at, x: 120 }, dither, bounds)!;
    for (const dx of [8, -64, 120, -120]) {
      const moved = ditheredRadial({ ...at, x: 120 + dx }, dither, bounds)!;
      expect(moved.x - a.x).toBe(dx);
      expect(moved.alpha).toBe(a.alpha);
    }
  });
});
