import { describe, expect, it } from 'vitest';
import { rasterizeToBuffer } from '@engine/core/gfx/pixelart';
import {
  FACINGS,
  presentFrameSchema,
  resolveSkinFrame,
  skinSchema,
  type Facing,
  type PresentMap,
} from '@engine/core/present';
import {
  BENCH_PALETTE,
  BENCH_SCREEN,
  BenchScene,
  benchSheet,
  benchSkin,
  CROWD_BOX,
  frameStats,
  MAP_CELLS,
  percentile,
} from './scene';

// The benchmark's synthetic scene (Engine 0.9 T3). The benchmark itself (`run.ts`) needs a browser
// and is run by hand; this checks, in Node, that what it draws is a valid skin, sheet and frames,
// the same for every run of a seed.

describe('the RTS benchmark scene', () => {
  it('has a valid skin whose every frame is on the sheet', () => {
    const skin = benchSkin();
    expect(skinSchema.safeParse(skin).success).toBe(true);
    const sheet = rasterizeToBuffer(benchSheet(), BENCH_PALETTE);
    const scene = new BenchScene({ units: 20, zoom: 1 });
    for (let t = 0; t < 40; t++) {
      for (const e of scene.next().entities) {
        const sf = resolveSkinFrame(skin, e);
        expect(sf.frame !== null && sheet.frames.has(sf.frame), `${e.kind} ${e.facing}`).toBe(true);
      }
    }
    for (const tile of Object.values(skin.tiles ?? {})) expect(sheet.frames.has(tile.frame!)).toBe(true);
  });

  it('sends a valid frame with the full map first, then a reference', () => {
    const scene = new BenchScene({ units: 30, zoom: 0.5 });
    const first = scene.next();
    expect(presentFrameSchema.safeParse(first).success).toBe(true);
    expect(first.size).toEqual(BENCH_SCREEN);
    expect(first.entities).toHaveLength(90);
    expect(first.camera?.zoom).toBe(0.5);
    const map = first.map as PresentMap;
    expect([map.cols, map.rows, map.tiles.length]).toEqual([MAP_CELLS, MAP_CELLS, MAP_CELLS]);
    const second = scene.next();
    expect(second.map).toEqual({ id: map.id, version: map.version });
    expect(presentFrameSchema.safeParse(second).success).toBe(true);
  });

  it('draws the same frames for the same seed, and moves the units in all eight directions', () => {
    const a = new BenchScene({ units: 40, zoom: 1, seed: 7 });
    const b = new BenchScene({ units: 40, zoom: 1, seed: 7 });
    const facings = new Set<Facing>();
    for (let t = 0; t < 200; t++) {
      const fa = a.next();
      expect(b.next()).toEqual(fa);
      for (const e of fa.entities) if (e.layer === 1) facings.add(e.facing);
    }
    expect([...facings].sort()).toEqual([...FACINGS].sort());
    expect(new BenchScene({ units: 40, zoom: 1, seed: 8 }).next()).not.toEqual(
      new BenchScene({ units: 40, zoom: 1, seed: 7 }).next(),
    );
  });

  it('keeps a crowd in the box round the camera', () => {
    const scene = new BenchScene({ units: 100, zoom: 0.5, layout: 'crowd' });
    for (let t = 0; t < 300; t++) {
      const frame = scene.next();
      const cam = frame.camera!;
      for (const e of frame.entities.filter((e) => e.layer === 1)) {
        expect(Math.abs(e.x + e.w / 2 - cam.x)).toBeLessThanOrEqual(CROWD_BOX.w / 2);
        expect(Math.abs(e.y + e.h / 2 - cam.y)).toBeLessThanOrEqual(CROWD_BOX.h / 2);
      }
    }
  });
});

describe('frame-time stats', () => {
  it('takes nearest-rank percentiles and fps from the mean', () => {
    const times = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(times, 50)).toBe(50);
    expect(percentile(times, 95)).toBe(95);
    expect(percentile(times, 100)).toBe(100);
    expect(percentile([], 50)).toBeNaN();
    const stats = frameStats([10, 10, 10, 30]);
    expect(stats).toMatchObject({ frames: 4, mean: 15, p50: 10, p95: 30, max: 30 });
    expect(stats.fps).toBeCloseTo(1000 / 15);
  });
});
