import { describe, expect, it } from 'vitest';
import { bayerRank, bayerThreshold, ditheredRadial, ditherValue, stopsAlpha } from './dither';
import { LIGHT_DITHER_STOPS, lightDither, lightStops } from './lighting';
import { LIGHT_DITHER_LEVELS } from './schema';

describe('Bayer matrices', () => {
  it('holds every rank once per tile, the classic 2x2 order in the corner, tiled by picture pixel', () => {
    for (const size of [4, 8] as const) {
      const ranks: number[] = [];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) ranks.push(bayerRank(x, y, size));
      expect([...ranks].sort((a, b) => a - b)).toEqual(Array.from({ length: size * size }, (_, i) => i));
      expect(bayerRank(3 + size, 5 + 2 * size, size)).toBe(bayerRank(3, 5, size));
      expect(bayerRank(-1, -1, size)).toBe(bayerRank(size - 1, size - 1, size));
    }
    expect([0, 1, 2, 3].map((y) => [0, 1, 2, 3].map((x) => bayerRank(x, y, 4)))).toEqual([
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ]);
    expect(bayerThreshold(0, 0, 4)).toBe(0.5 / 16);
    expect(bayerThreshold(0, 1, 4)).toBe(12.5 / 16);
  });
});

describe('ditherValue', () => {
  const d = { size: 8, levels: 4 } as const;

  it('keeps 0, 1 and exact steps, clamps, and gives only multiples of 1 / levels', () => {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        expect(ditherValue(0, x, y, d)).toBe(0);
        expect(ditherValue(1, x, y, d)).toBe(1);
        expect(ditherValue(0.5, x, y, d)).toBe(0.5);
        expect(ditherValue(-3, x, y, d)).toBe(0);
        expect(ditherValue(7, x, y, d)).toBe(1);
        const v = ditherValue(0.4, x, y, d) * 4;
        expect([1, 2]).toContain(v);
      }
  });

  it('averages to the value over a tile (a value between two steps is a mix of both)', () => {
    for (const value of [0.1, 0.33, 0.6, 0.875]) {
      let sum = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += ditherValue(value, x, y, d);
      expect(sum / 64).toBeCloseTo(value, 1);
      expect(Math.abs(sum / 64 - value)).toBeLessThanOrEqual(1 / 4 / 64 + 1e-9);
    }
  });
});

describe('stopsAlpha', () => {
  it('is linear between stops, the first before them and the last past them, clamped', () => {
    const stops = [
      { at: 0.2, alpha: 1 },
      { at: 0.6, alpha: 0.2 },
      { at: 0.6, alpha: 1.5 },
    ];
    expect(stopsAlpha(stops, 0)).toBe(1);
    expect(stopsAlpha(stops, 0.4)).toBeCloseTo(0.6);
    expect(stopsAlpha(stops, 0.9)).toBe(1);
    expect(stopsAlpha([], 0.5)).toBe(0);
  });
});

describe('ditheredRadial', () => {
  const fill = { x: 20.5, y: 12, radius: 9.3, stops: lightStops(0.9, 0, 8) };
  const dither = { size: 8, levels: 16 } as const;

  it('covers the circle square in whole pixels, cut to the bounds only when huge, with no rings of equal steps', () => {
    const s = ditheredRadial(fill, dither)!;
    expect([s.x, s.y, s.w, s.h]).toEqual([11, 2, 19, 20]);
    // Across the bounds' edge: kept whole (the backend's drawing cuts it), the same bytes.
    const across = ditheredRadial(fill, dither, { width: 24, height: 10 })!;
    expect([across.x, across.y, across.w, across.h]).toEqual([11, 2, 19, 20]);
    expect(across.alpha).toBe(s.alpha);
    // A light far bigger than the picture is cut to it; the same pixel has the same byte
    // wherever the stamp starts: dithered by picture position.
    const huge = { x: 20, y: 12, radius: 300, stops: lightStops(0.9, 0, 8) };
    const big = ditheredRadial({ ...huge, box: { x: -40, y: -40, w: 80, h: 80 } }, dither)!;
    const cut = ditheredRadial(huge, dither, { width: 24, height: 10 })!;
    expect([cut.x, cut.y, cut.w, cut.h]).toEqual([0, 0, 24, 10]);
    expect(cut.alpha[3 * cut.w + 4]).toBe(big.alpha[(3 + 40) * big.w + 4 + 40]);
    // Bytes are steps of 255 / 16; the centre is lit, the corners are not.
    for (const a of s.alpha) expect(Math.abs(a / (255 / 16) - Math.round(a / (255 / 16)))).toBeLessThan(0.05);
    expect(s.alpha[10 * s.w + 9]).toBeGreaterThan(200);
    expect(s.alpha[0]).toBe(0);
    // A ring at one distance mixes two neighbouring steps, never one hard step.
    const ring = new Set<number>();
    for (let j = 0; j < s.h; j++)
      for (let i = 0; i < s.w; i++) {
        const d = Math.hypot(s.x + i + 0.5 - fill.x, s.y + j + 0.5 - fill.y) / fill.radius;
        if (Math.abs(d - 0.5) < 0.08) ring.add(s.alpha[j * s.w + i]!);
      }
    expect(ring.size).toBeGreaterThan(1);
  });

  it('gives byte-identical pixels for the same frame drawn twice, and none for no radius or an empty box', () => {
    const a = ditheredRadial(fill, dither, { width: 64, height: 32 })!;
    const b = ditheredRadial(
      { ...fill, stops: fill.stops.map((s) => ({ ...s })) },
      { ...dither },
      { width: 64, height: 32 },
    )!;
    expect(Buffer.from(b.alpha).equals(Buffer.from(a.alpha))).toBe(true);
    expect([b.x, b.y, b.w, b.h]).toEqual([a.x, a.y, a.w, a.h]);
    expect(ditheredRadial({ ...fill, radius: 0 }, dither)).toBeNull();
    expect(ditheredRadial(fill, dither, { width: 5, height: 5 })).toBeNull();
  });

  it('matches the per-pixel ditherValue of stopsAlpha, but for a rare pixel one step off at a threshold', () => {
    for (const f of [fill, { x: 40, y: 30, radius: 84, stops: lightStops(0.95, 0, 8) }]) {
      const s = ditheredRadial(f, dither)!;
      let off = 0;
      for (let j = 0; j < s.h; j++)
        for (let i = 0; i < s.w; i++) {
          const px = s.x + i;
          const py = s.y + j;
          const d = Math.hypot(px + 0.5 - f.x, py + 0.5 - f.y) / f.radius;
          const want = Math.round(ditherValue(stopsAlpha(f.stops, d), px, py, dither) * 255);
          const got = s.alpha[j * s.w + i]!;
          if (got !== want) {
            off++;
            expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.ceil(255 / dither.levels));
          }
        }
      expect(off / s.alpha.length).toBeLessThan(0.01);
    }
  });

  it("shares a steady or scrolled fill's bytes, and gives a moved or changed one its bytes worked out afresh", () => {
    const at = { x: 60, y: 50, radius: 30, stops: lightStops(0.9, 0, 8) };
    const bounds = { width: 128, height: 96 };
    const a = ditheredRadial(at, dither, bounds)!;
    expect(ditheredRadial({ ...at, stops: lightStops(0.9, 0, 8) }, dither, bounds)!.alpha).toBe(a.alpha);
    // Moved by a whole Bayer tile, inside the picture (the camera scrolling): the very same bytes
    // one tile over, so a backend reuses what it made from them.
    const moved = ditheredRadial({ ...at, x: 68, y: 42 }, dither, bounds)!;
    expect([moved.x - a.x, moved.y - a.y]).toEqual([8, -8]);
    expect(moved.alpha).toBe(a.alpha);
    // Moved by one pixel: another Bayer phase, its own bytes (as worked out afresh), shared in turn.
    const nudged = ditheredRadial({ ...at, x: 61 }, dither, bounds)!;
    expect(nudged.alpha).not.toBe(a.alpha);
    let off = 0;
    for (let k = 0; k < nudged.alpha.length; k++) {
      const px = nudged.x + (k % nudged.w);
      const py = nudged.y + Math.floor(k / nudged.w);
      const d = Math.hypot(px + 0.5 - 61, py + 0.5 - 50) / 30;
      if (nudged.alpha[k] !== Math.round(ditherValue(stopsAlpha(at.stops, d), px, py, dither) * 255)) off++;
    }
    expect(off / nudged.alpha.length).toBeLessThan(0.01);
    expect(ditheredRadial({ ...at, x: 61 + 16 }, dither, bounds)!.alpha).toBe(nudged.alpha);
    // Scrolled half off the picture: still whole, so still the same bytes.
    const edge = ditheredRadial({ ...at, x: 108, y: 2 }, dither, bounds)!;
    expect([edge.x, edge.y, edge.w, edge.h]).toEqual([78, -28, 60, 60]);
    expect(edge.alpha).toBe(a.alpha);
    // Wholly off it: nothing.
    expect(ditheredRadial({ ...at, x: 200 }, dither, bounds)).toBeNull();
    // A changed falloff in place: new bytes, dimmer everywhere.
    const dim = ditheredRadial({ ...at, stops: lightStops(0.5, 0, 8) }, dither, bounds)!;
    expect(dim.alpha).not.toBe(a.alpha);
    for (let i = 0; i < a.alpha.length; i++) expect(dim.alpha[i]).toBeLessThanOrEqual(a.alpha[i]!);
  });
});

describe('dithered light falloff', () => {
  it('is the smooth ease in finer stops whatever the bands, and dithers between bands or the default steps', () => {
    const smooth = lightStops(0.8, 0, 4);
    expect(smooth).toHaveLength(LIGHT_DITHER_STOPS + 1);
    expect(lightStops(0.8, 6, 8)).toEqual(smooth);
    expect(smooth[0]).toEqual({ at: 0, alpha: 0.8 });
    expect(smooth.at(-1)).toEqual({ at: 1, alpha: 0 });
    for (let i = 1; i < smooth.length; i++) expect(smooth[i]!.at).toBeGreaterThan(smooth[i - 1]!.at);
    // No dither: as before.
    expect(lightStops(0.8, 6, 0)).toEqual(lightStops(0.8, 6));
    expect(lightDither({ bands: 6, dither: 0 })).toBeUndefined();
    expect(lightDither({ bands: 6, dither: 4 })).toEqual({ size: 4, levels: 6 });
    expect(lightDither({ bands: 0, dither: 8 })).toEqual({ size: 8, levels: LIGHT_DITHER_LEVELS });
  });
});
