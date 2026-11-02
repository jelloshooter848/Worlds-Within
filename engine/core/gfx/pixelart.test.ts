import { describe, expect, it } from 'vitest';
import { flipH, rasterizeToBuffer, swapColors, validateDef } from './pixelart';

describe('pixel art rasterizer', () => {
  it('packs frames and paints palette colours', () => {
    const r = rasterizeToBuffer({ palette: 'p', frames: { a: ['.1', '1.'], b: ['22', '22', '22'] } }, [
      '#000000',
      '#ff0000',
      '#00ff00',
    ]);
    expect(r.frames.get('a')).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(r.frames.get('b')).toEqual({ x: 2, y: 0, w: 2, h: 3 });
    expect(r.width).toBe(4);
    expect(r.height).toBe(3);
    // pixel (1,0) of a = red, (0,0) transparent
    expect(Array.from(r.data.slice(4, 8))).toEqual([255, 0, 0, 255]);
    expect(r.data[3]).toBe(0);
    // pixel (2,2) = frame b = green
    const o = (2 * 4 + 2) * 4;
    expect(Array.from(r.data.slice(o, o + 4))).toEqual([0, 255, 0, 255]);
  });

  it('throws on missing palette entries', () => {
    expect(() => rasterizeToBuffer({ palette: 'p', frames: { a: ['9'] } }, ['#000'])).toThrow(/no colour 9/);
  });

  it('flips and recolours', () => {
    expect(flipH(['12.', '1..'])).toEqual(['.21', '..1']);
    expect(swapColors(['12'], { '1': '3' })).toEqual(['32']);
  });

  it('validates ragged frames', () => {
    expect(() => validateDef('x', { palette: 'p', frames: { a: ['12', '1'] } })).toThrow(/row 1 is 1 wide/);
    expect(() => validateDef('x', { palette: 'p', frames: { a: ['1#'] } })).toThrow(/illegal char/);
  });
});
