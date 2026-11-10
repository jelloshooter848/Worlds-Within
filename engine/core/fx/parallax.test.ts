import { describe, expect, it } from 'vitest';
import { gradientBands, layoutParallax, parallaxFactor, parallaxOrigin } from './parallax';
import { parallaxLayerSchema } from './schema';

const SIZE = { width: 64, height: 48 };
const frames: Record<string, { w: number; h: number }> = { hills: { w: 40, h: 16 }, cloud: { w: 20, h: 10 } };
const frameSize = (_sheet: string, _palette: string | undefined, name: string) => frames[name] ?? null;

describe('parallax layers (Engine 0.16 T4)', () => {
  it('reads factors and places a layer against the camera', () => {
    expect(parallaxFactor({ frame: 'x', factor: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
    expect(parallaxFactor({ frame: 'x', factor: { x: 0.25, y: 0 } })).toEqual({ x: 0.25, y: 0 });
    expect(parallaxOrigin({ frame: 'x', factor: { x: 0.25, y: 0.5 }, y: 20 }, { x: 100, y: 10 })).toEqual({
      x: -25,
      y: 15,
    });
    // Factor 0 stays put (no -0).
    expect(Object.is(parallaxOrigin({ frame: 'x', factor: 0 }, { x: 100, y: 10 }).x, 0)).toBe(true);
  });

  it('cuts a gradient into flat bands with no gaps, first and last colour at the ends', () => {
    const bands = gradientBands(['#000000', '#ffffff'], 4, 10);
    expect(bands.map((b) => [b.y, b.h])).toEqual([
      [0, 3],
      [3, 2],
      [5, 3],
      [8, 2],
    ]);
    expect(bands.map((b) => b.color)).toEqual(['#000000', '#555555', '#aaaaaa', '#ffffff']);
    expect(gradientBands(['#123456'], 2, 4).map((b) => b.color)).toEqual(['#123456', '#123456']);
  });

  it('repeats frames across the picture and moves layers at their own rates', () => {
    const skin = {
      sheets: { sheet: 'bg' },
      parallax: [
        { gradient: ['#3cbcfc', '#a4e4fc'], bands: 2, factor: 0 },
        { frame: 'hills', factor: 0.5, y: 30 },
        { frame: 'cloud', factor: { x: 1, y: 0 }, repeat: 'none' as const, x: 10, y: 4 },
      ],
    };
    const at = (x: number) => layoutParallax(skin, { x, y: 0 }, SIZE, frameSize);
    const first = at(0);
    expect(first.filter((d) => d.layer === 0)).toEqual([
      { kind: 'box', layer: 0, x: 0, y: 0, w: 64, h: 24, color: '#3cbcfc' },
      { kind: 'box', layer: 0, x: 0, y: 24, w: 64, h: 24, color: '#a4e4fc' },
    ]);
    const xs = (draws: ReturnType<typeof at>, layer: number) =>
      draws.filter((d) => d.layer === layer).map((d) => [d.x, d.y]);
    expect(xs(first, 1)).toEqual([
      [0, 30],
      [40, 30],
    ]);
    expect(xs(first, 2)).toEqual([[10, 4]]);
    // 30 px right: the sky stays, the hills move 15 (and wrap), the cloud 30.
    const moved = at(30);
    expect(xs(moved, 0)).toEqual(xs(first, 0));
    expect(xs(moved, 1)).toEqual([
      [-15, 30],
      [25, 30],
    ]);
    expect(xs(moved, 2)).toEqual([[-20, 4]]);
    expect(moved.find((d) => d.kind === 'sprite')).toMatchObject({ sheet: 'bg', frame: 'hills' });
  });

  it('repeats down and both ways, and skips a frame it cannot find', () => {
    const skin = { parallax: [{ frame: 'cloud', sheet: 'bg', factor: 0, repeat: 'xy' as const }] };
    const draws = layoutParallax(skin, { x: 0, y: 0 }, SIZE, frameSize);
    // 64 / 20 -> 4 across, 48 / 10 -> 5 down.
    expect(draws).toHaveLength(20);
    const down = layoutParallax(
      { parallax: [{ frame: 'cloud', sheet: 'bg', factor: 0, repeat: 'y' as const }] },
      { x: 0, y: 0 },
      SIZE,
      frameSize,
    );
    expect(down.map((d) => d.y)).toEqual([0, 10, 20, 30, 40]);
    expect(
      layoutParallax(
        { parallax: [{ frame: 'gone', sheet: 'bg', factor: 1 }] },
        { x: 0, y: 0 },
        SIZE,
        frameSize,
      ),
    ).toEqual([]);
    expect(layoutParallax({}, { x: 0, y: 0 }, SIZE, frameSize)).toEqual([]);
  });

  it('the layer schema wants exactly one of frame and gradient, and fields that go with it', () => {
    expect(parallaxLayerSchema.safeParse({ gradient: ['#000'], factor: 0 }).success).toBe(true);
    expect(
      parallaxLayerSchema.safeParse({ frame: 'a', factor: { x: 0.5, y: 0 }, repeat: 'x', depth: 300 })
        .success,
    ).toBe(true);
    const both = parallaxLayerSchema.safeParse({ frame: 'a', gradient: ['#000'], factor: 0 });
    expect(both.error?.issues[0]?.path).toEqual(['gradient']);
    expect(parallaxLayerSchema.safeParse({ factor: 0 }).error?.issues[0]?.path).toEqual(['frame']);
    expect(parallaxLayerSchema.safeParse({ frame: 'a', bands: 3, factor: 0 }).error?.issues[0]?.path).toEqual(
      ['bands'],
    );
    expect(
      parallaxLayerSchema.safeParse({ gradient: ['#000'], repeat: 'x', factor: 0 }).error?.issues[0]?.path,
    ).toEqual(['repeat']);
    expect(parallaxLayerSchema.safeParse({ gradient: ['#000'], factor: 3 }).success).toBe(false);
  });
});
