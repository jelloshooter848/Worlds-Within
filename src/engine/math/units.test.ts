import { describe, expect, it } from 'vitest';
import { px, tileAt, toPx, vel, velToSub, VEL } from './units';

describe('units', () => {
  it('converts px to subpixels and back with floor semantics', () => {
    expect(px(16)).toBe(4096);
    expect(toPx(4095)).toBe(15);
    expect(toPx(-1)).toBe(-1); // floor, like the NES
    expect(toPx(-256)).toBe(-1);
  });
  it('maps velocity units to subpixels per frame', () => {
    expect(velToSub(VEL)).toBe(256); // 1 px/frame
    expect(velToSub(vel(2.5))).toBe(640);
    expect(velToSub(0x130)).toBe(19); // minimum walk ≈ 0.074 px/f
  });
  it('finds tile indices from subpixels', () => {
    expect(tileAt(px(15))).toBe(0);
    expect(tileAt(px(16))).toBe(1);
    expect(tileAt(px(16 * 10 + 15))).toBe(10);
  });
});
