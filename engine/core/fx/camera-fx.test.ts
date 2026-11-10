import { describe, expect, it } from 'vitest';
import { CameraFx, flashAlpha, shakeStrength, zoomFactor, zoomLength } from './camera-fx';
import { HitPause } from './hit-pause';
import { flashSpecSchema, hitPauseSpecSchema, shakeSpecSchema, zoomSpecSchema } from './schema';

describe('trauma shake (Engine 0.16 T4)', () => {
  it('decays as trauma squared to exactly zero at its ticks', () => {
    const spec = { amount: 8, ticks: 4 };
    expect([0, 1, 2, 3, 4, 9].map((a) => shakeStrength(spec, a))).toEqual([8, 4.5, 2, 0.5, 0, 0]);
    expect(shakeStrength(spec, -1)).toBe(0);
  });

  it('is deterministic per frame: the same seed and frame shake the same way, others differ', () => {
    const a = new CameraFx({ seed: 7 });
    const b = new CameraFx({ seed: 7 });
    a.shake({ amount: 6, ticks: 30 }, 10);
    b.shake({ amount: 6, ticks: 30 }, 10);
    const offsets = (fx: CameraFx) =>
      Array.from({ length: 30 }, (_, i) => {
        const s = fx.state(10 + i);
        return [s.shakeX, s.shakeY];
      });
    expect(offsets(a)).toEqual(offsets(b));
    // Read twice, a frame gives the same offset (no hidden state).
    expect(a.state(12)).toEqual(a.state(12));
    const other = new CameraFx({ seed: 8 });
    other.shake({ amount: 6, ticks: 30 }, 10);
    expect(offsets(other)).not.toEqual(offsets(a));
    // Whole picture px, never more than the strength, and they move about.
    const flat = offsets(a).flat();
    expect(flat.every((v) => Number.isInteger(v) && Math.abs(v) <= 6)).toBe(true);
    expect(new Set(flat).size).toBeGreaterThan(3);
  });

  it('decays to zero, adds up, takes a sub-pixel option, and the shake scale', () => {
    const fx = new CameraFx({ seed: 1 });
    fx.shake({ amount: 4, ticks: 10 }, 0);
    fx.update(10);
    expect(fx.size).toBe(0);
    expect(fx.state(10)).toMatchObject({ shakeX: 0, shakeY: 0, zoom: 1, flashes: [] });

    const sub = new CameraFx({ seed: 1, subPixel: true });
    sub.shake({ amount: 4, ticks: 10 }, 0);
    sub.shake({ amount: 4, ticks: 10 }, 0);
    const full = sub.state(3);
    // Two shakes: twice the strength; fractional offsets, inside 2 * 4 * 0.7².
    expect(Number.isInteger(full.shakeX) && Number.isInteger(full.shakeY)).toBe(false);
    expect(Math.abs(full.shakeX)).toBeLessThanOrEqual(8 * 0.49);
    const half = sub.state(3, { shakeScale: 0.5 });
    expect(half.shakeX).toBeCloseTo(full.shakeX / 2, 10);
    expect(sub.state(3, { shakeScale: 0 })).toMatchObject({ shakeX: 0, shakeY: 0 });
  });
});

describe('zoom punches', () => {
  it('tweens to `to` with the ease, holds, and comes back with the curve reversed', () => {
    const spec = { to: 2, ticks: 4, ease: 'quadOut' as const, hold: 2, back: 4 };
    expect(zoomLength(spec)).toBe(10);
    const values = Array.from({ length: 11 }, (_, a) => zoomFactor(spec, a));
    // quadOut: 0, 0.4375, 0.75, 0.9375, then held at 1, then back.
    expect(values).toEqual([1, 1.4375, 1.75, 1.9375, 2, 2, 2, 1.9375, 1.75, 1.4375, 1]);
    expect(zoomFactor(spec, -1)).toBe(1);
    // `back` defaults to `ticks`; 0 snaps back.
    expect(zoomLength({ to: 1.5, ticks: 6 })).toBe(12);
    expect(zoomFactor({ to: 1.5, ticks: 2, back: 0 }, 2)).toBe(1);
  });

  it('punches running together multiply', () => {
    const fx = new CameraFx();
    fx.zoom({ to: 2, ticks: 1, hold: 5 }, 0);
    fx.zoom({ to: 1.5, ticks: 1, hold: 5 }, 0);
    expect(fx.state(2).zoom).toBe(3);
  });
});

describe('flashes', () => {
  it('fade from their alpha over their ticks, and reduced flashing drops them', () => {
    expect([0, 1, 2, 3, 4].map((a) => flashAlpha({ alpha: 0.5, ticks: 4 }, a))).toEqual([
      0.5, 0.375, 0.25, 0.125, 0,
    ]);
    const fx = new CameraFx();
    fx.event({ flash: { color: '#d82800', ticks: 2 } }, 5);
    expect(fx.state(5).flashes).toEqual([{ color: '#d82800', alpha: 1 }]);
    expect(fx.state(6).flashes).toEqual([{ color: '#d82800', alpha: 0.5 }]);
    expect(fx.state(5, { reduceFlashing: true }).flashes).toEqual([]);
    fx.event({ flash: { ticks: 2 } }, 6);
    expect(fx.state(6).flashes.map((f) => f.color)).toEqual(['#d82800', '#fcfcfc']);
  });

  it('an earlier frame (a new level) drops every effect', () => {
    const fx = new CameraFx();
    fx.event({ shake: { amount: 2, ticks: 50 }, zoom: { to: 2, ticks: 50 }, flash: { ticks: 50 } }, 40);
    fx.update(41);
    expect(fx.size).toBe(3);
    fx.update(3);
    expect(fx.size).toBe(0);
  });
});

describe('hit-pause frame counting', () => {
  it('holds as many display frames as asked, never adding requests up', () => {
    const pause = new HitPause();
    expect(pause.hold()).toBe(false);
    pause.request(3);
    pause.request(2);
    expect(pause.remaining).toBe(3);
    expect([pause.hold(), pause.hold(), pause.hold(), pause.hold()]).toEqual([true, true, true, false]);
    pause.request(2);
    expect(pause.hold()).toBe(true);
    pause.request(4);
    expect(pause.remaining).toBe(4);
    pause.clear();
    expect(pause.hold()).toBe(false);
    pause.request(0);
    pause.request(-2);
    expect(pause.remaining).toBe(0);
  });
});

describe('the camera effect schemas', () => {
  it('take the documented fields and name bad ones', () => {
    expect(shakeSpecSchema.safeParse({ amount: 3, ticks: 10 }).success).toBe(true);
    expect(shakeSpecSchema.safeParse({ amount: 0, ticks: 10 }).success).toBe(false);
    expect(zoomSpecSchema.safeParse({ to: 1.5, ticks: 8, ease: 'cubicOut', hold: 4, back: 12 }).success).toBe(
      true,
    );
    const badEase = zoomSpecSchema.safeParse({ to: 1.5, ticks: 8, ease: 'wobble' });
    expect(badEase.error?.issues[0]?.path).toEqual(['ease']);
    expect(flashSpecSchema.safeParse({ color: '#fff', alpha: 0.5, ticks: 4 }).success).toBe(true);
    expect(flashSpecSchema.safeParse({ color: 'red', ticks: 4 }).error?.issues[0]?.path).toEqual(['color']);
    expect(hitPauseSpecSchema.safeParse({ ticks: 4 }).success).toBe(true);
    expect(hitPauseSpecSchema.safeParse({ ticks: 0 }).success).toBe(false);
    expect(hitPauseSpecSchema.safeParse({ ticks: 4, extra: 1 }).success).toBe(false);
  });
});
