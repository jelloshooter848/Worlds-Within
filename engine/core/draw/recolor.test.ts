import { describe, expect, it } from 'vitest';
import type { SpriteSheet } from '../gfx/spritesheet';
import {
  hexRgb,
  hslToRgb,
  hueInRange,
  RecolorCache,
  recolorKey,
  recolorPixels,
  rgbToHsl,
  type ImageRecolor,
} from './recolor';

// The pure pixel maths of outlines and team colours (Engine 0.16 part D, D4).

const pixels = (...px: number[][]) => new Uint8ClampedArray(px.flat());
const rows = (d: Uint8ClampedArray) =>
  Array.from({ length: d.length / 4 }, (_, i) => Array.from(d.slice(i * 4, i * 4 + 4)));

describe('recolorPixels', () => {
  it('makes a silhouette of every pixel with any alpha, leaving clear ones', () => {
    const d = pixels([10, 20, 30, 255], [0, 0, 0, 0], [200, 0, 0, 40]);
    recolorPixels(d, { kind: 'silhouette', color: '#ffff00' });
    expect(rows(d)).toEqual([
      [255, 255, 0, 255],
      [0, 0, 0, 0],
      [255, 255, 0, 255],
    ]);
  });

  it('replaces exactly the mask colour', () => {
    const d = pixels([255, 0, 255, 255], [254, 0, 255, 255], [255, 0, 255, 0]);
    recolorPixels(d, { kind: 'mask', mask: '#f0f', color: '#0000ff' });
    expect(rows(d)).toEqual([
      [0, 0, 255, 255],
      [254, 0, 255, 255],
      [255, 0, 255, 0],
    ]);
  });

  it("gives a hue range the team colour's hue, keeping lightness, and leaves greys and other hues", () => {
    // A dark red, a light red, a grey and a green.
    const d = pixels([128, 0, 0, 255], [255, 128, 128, 255], [128, 128, 128, 255], [0, 200, 0, 255]);
    recolorPixels(d, { kind: 'hue', min: 330, max: 30, color: '#0000ff' });
    expect(rows(d)).toEqual([
      [0, 0, 128, 255],
      [128, 128, 255, 255],
      [128, 128, 128, 255],
      [0, 200, 0, 255],
    ]);
  });

  it('tints by multiplying', () => {
    const d = pixels([255, 128, 0, 255]);
    recolorPixels(d, { kind: 'tint', color: '#80ff00' });
    expect(rows(d)).toEqual([[128, 128, 0, 255]]);
  });
});

describe('colour helpers', () => {
  it('reads hex and round-trips HSL', () => {
    expect(hexRgb('#0af')).toEqual([0, 170, 255]);
    for (const c of [
      [255, 0, 0],
      [12, 200, 99],
      [128, 128, 128],
      [60, 188, 252],
    ] as const) {
      const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
      expect(hslToRgb(h, s, l)).toEqual([...c]);
    }
  });

  it('wraps a hue range through red', () => {
    expect(hueInRange(350, 330, 30)).toBe(true);
    expect(hueInRange(10, 330, 30)).toBe(true);
    expect(hueInRange(120, 330, 30)).toBe(false);
    expect(hueInRange(120, 90, 150)).toBe(true);
  });

  it('keys each spec apart', () => {
    const keys = [
      recolorKey({ kind: 'silhouette', color: '#000' }),
      recolorKey({ kind: 'tint', color: '#000' }),
      recolorKey({ kind: 'mask', mask: '#f0f', color: '#000' }),
      recolorKey({ kind: 'hue', min: 0, max: 30, color: '#000' }),
    ];
    expect(new Set(keys).size).toBe(4);
  });
});

describe('RecolorCache', () => {
  const sheet: SpriteSheet = {
    id: 's',
    image: {} as CanvasImageSource,
    frames: new Map([['a', { x: 0, y: 0, w: 1, h: 1 }]]),
  };

  it('recolours a sheet once per spec, keeping its frames', () => {
    let made = 0;
    const recolor: ImageRecolor = () => {
      made++;
      return {} as CanvasImageSource;
    };
    const cache = new RecolorCache(recolor);
    const a = cache.get(sheet, { kind: 'tint', color: '#f00' });
    expect(cache.get(sheet, { kind: 'tint', color: '#f00' })).toBe(a);
    expect(a?.frames).toBe(sheet.frames);
    cache.get(sheet, { kind: 'tint', color: '#00f' });
    expect(made).toBe(2);
  });

  it('gives null without a recolour, for a headless sheet, or when the image cannot be read', () => {
    expect(new RecolorCache(undefined).get(sheet, { kind: 'tint', color: '#f00' })).toBeNull();
    expect(
      new RecolorCache(() => ({}) as CanvasImageSource).get(
        { ...sheet, image: null },
        { kind: 'tint', color: '#f00' },
      ),
    ).toBeNull();
    expect(new RecolorCache(() => null).get(sheet, { kind: 'tint', color: '#f00' })).toBeNull();
  });
});
