import { describe, expect, it } from 'vitest';
import { fitGame } from '@engine/core/gfx/screen';
import { canvasToScreen, fitCanvas } from './fit';

const SIZE = { width: 256, height: 240 };

describe('fitCanvas', () => {
  it('letterboxes the picture centred, as big as fits', () => {
    // 800x480: height-limited, scale 2, 512x480 centred horizontally.
    expect(fitCanvas(SIZE, 800, 480)).toEqual({ scale: 2, left: 144, top: 0, width: 512, height: 480 });
  });

  it('uses whole-number scales when asked', () => {
    const box = fitCanvas(SIZE, 700, 700, 1, true);
    expect(box.scale).toBe(2);
    expect(box).toMatchObject({ width: 512, height: 480, left: 94, top: 110 });
  });

  it('matches fitGame in CSS px at any device pixel ratio', () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      const g = fitGame(SIZE, 390, 844, dpr, false, { top: 40 });
      const box = fitCanvas(SIZE, 390, 844, dpr, false, { top: 40 });
      expect(box.scale).toBe(g.scale);
      expect(box.width * dpr).toBeCloseTo(g.dw);
      expect(box.height * dpr).toBeCloseTo(g.dh);
      expect(box.left * dpr).toBeCloseTo(g.ox);
      expect(box.top).toBe(40);
    }
  });

  it('maps client points back to game px', () => {
    const box = fitCanvas(SIZE, 800, 480);
    const rect = { left: 10, top: 20 };
    expect(canvasToScreen(box, rect, 10 + 144, 20)).toEqual({ x: 0, y: 0 });
    expect(canvasToScreen(box, rect, 10 + 144 + 512, 20 + 480)).toEqual({ x: 256, y: 240 });
    const hi = fitCanvas(SIZE, 800, 480, 2);
    expect(canvasToScreen(hi, rect, 10 + hi.left + hi.width / 2, 20 + hi.top + hi.height / 2, 2)).toEqual({
      x: 128,
      y: 120,
    });
  });
});
