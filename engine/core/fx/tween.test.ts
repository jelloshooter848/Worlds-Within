import { describe, expect, it, vi } from 'vitest';
import { lerpColor, parseHexColor } from './color';
import { tweenSpecSchema, tweensSchema, type TweenSpec } from './schema';
import { REST_STATE, Tween, TweenSet } from './tween';

describe('colours', () => {
  it('reads #rgb and #rrggbb', () => {
    expect(parseHexColor('#f80')).toEqual([255, 136, 0]);
    expect(parseHexColor('#0A1b2C')).toEqual([10, 27, 44]);
    expect(parseHexColor('red')).toBeNull();
  });

  it('lerps each channel, clamped', () => {
    expect(lerpColor('#000', '#ffffff', 0)).toBe('#000000');
    expect(lerpColor('#000', '#ffffff', 1)).toBe('#ffffff');
    expect(lerpColor('#000000', '#ff8040', 0.5)).toBe('#804020');
    expect(lerpColor('#000000', '#ffffff', 1.5)).toBe('#ffffff');
    expect(lerpColor('#ffffff', '#000000', 1.5)).toBe('#000000');
    expect(() => lerpColor('nope', '#fff', 0)).toThrow(/not a colour/);
  });
});

describe('Tween', () => {
  it.each([
    ['x', 0, 8, 4],
    ['y', -4, 4, 0],
    ['scale', 1, 3, 2],
    ['scaleX', 2, 1, 1.5],
    ['scaleY', 0, 1, 0.5],
    ['rotate', 0, 90, 45],
    ['alpha', 1, 0, 0.5],
  ] as const)('interpolates %s from %d to %d (%d halfway)', (prop, from, to, mid) => {
    const t = new Tween({ prop, from, to, frames: 10 }, 100);
    expect(t.value(100)).toBe(from);
    expect(t.value(105)).toBe(mid);
    expect(t.value(110)).toBe(to);
    expect(t.done(109)).toBe(false);
    expect(t.done(110)).toBe(true);
  });

  it('interpolates colour', () => {
    const t = new Tween({ prop: 'color', from: '#000000', to: '#ff0000', frames: 4 }, 0);
    expect([0, 1, 2, 3, 4].map((f) => t.value(f))).toEqual([
      '#000000',
      '#400000',
      '#800000',
      '#bf0000',
      '#ff0000',
    ]);
    expect(new Tween({ prop: 'color', to: '#000', frames: 2 }, 0).value(0)).toBe('#ffffff');
  });

  it('starts numeric tweens at the rest value when there is no from', () => {
    expect(new Tween({ prop: 'scale', to: 2, frames: 2 }, 0).value(0)).toBe(1);
    expect(new Tween({ prop: 'x', to: 2, frames: 2 }, 0).value(0)).toBe(0);
  });

  it('holds from through the delay', () => {
    const t = new Tween({ prop: 'x', from: 5, to: 10, frames: 5, delay: 3 }, 0);
    expect([0, 2, 3, 4, 8].map((f) => t.value(f))).toEqual([5, 5, 5, 6, 10]);
    expect(t.length).toBe(8);
  });

  it('eases', () => {
    const t = new Tween({ prop: 'x', to: 1, frames: 2, ease: 'quadIn' }, 0);
    expect(t.value(1)).toBe(0.25);
  });

  it('goes there and back under yoyo, repeating', () => {
    const t = new Tween({ prop: 'x', to: 4, frames: 4, yoyo: true, repeat: 1 }, 0);
    expect(t.length).toBe(16);
    expect(Array.from({ length: 17 }, (_, f) => t.value(f))).toEqual([
      0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0,
    ]);
  });

  it('restarts each play without yoyo, and never ends when forever', () => {
    const t = new Tween({ prop: 'x', to: 2, frames: 2, repeat: 'forever' }, 0);
    expect([0, 1, 2, 3, 4, 1001].map((f) => t.value(f))).toEqual([0, 1, 0, 1, 0, 1]);
    expect(t.done(1e9)).toBe(false);
  });
});

describe('TweenSet', () => {
  it('combines properties: offsets add, factors multiply, colour replaces', () => {
    const set = new TweenSet();
    set.add(
      [
        { prop: 'x', to: 4, frames: 4 },
        { prop: 'x', to: 2, frames: 4 },
        { prop: 'scale', to: 2, frames: 4 },
        { prop: 'scaleY', from: 3, to: 3, frames: 4 },
        { prop: 'rotate', to: 180, frames: 4 },
        { prop: 'alpha', to: 0.5, frames: 4 },
        { prop: 'color', from: '#000000', to: '#000000', frames: 4, amount: 0.25 },
      ],
      0,
    );
    expect(set.state(4 - 1)).toEqual({
      x: 3 + 1.5,
      y: 0,
      scaleX: 1.75,
      scaleY: 1.75 * 3,
      rotate: 135,
      alpha: 0.625,
      color: '#000000',
      colorAmount: 0.25,
    });
  });

  it('is at rest once its tweens end, calling onDone once each', () => {
    const done = vi.fn();
    const set = new TweenSet();
    set.add({ prop: 'y', from: -8, to: 0, frames: 3 }, 10, done);
    set.add({ prop: 'alpha', to: 0, frames: 6 }, 10, done);
    expect(set.state(10).y).toBe(-8);
    set.update(12);
    expect(done).not.toHaveBeenCalled();
    expect(set.state(13)).toEqual({ ...REST_STATE, alpha: 0.5 });
    set.update(13);
    expect(done).toHaveBeenCalledTimes(1);
    expect(set.size).toBe(1);
    set.update(16);
    set.update(20);
    expect(done).toHaveBeenCalledTimes(2);
    expect(set.size).toBe(0);
    expect(set.state(20)).toEqual(REST_STATE);
  });

  it('gives the same state for the same frame whatever was asked before', () => {
    const make = () => {
      const s = new TweenSet();
      s.add({ prop: 'x', to: 10, frames: 7, ease: 'elasticOut', yoyo: true, repeat: 2 }, 3);
      return s;
    };
    const a = make();
    const b = make();
    for (let f = 0; f < 40; f++) a.state(f);
    expect(a.state(17)).toEqual(b.state(17));
  });
});

describe('tween spec schema', () => {
  it('takes a spec of each property and a list', () => {
    const specs: TweenSpec[] = [
      { prop: 'x', to: 1, frames: 1 },
      { prop: 'scale', from: 0, to: 1, frames: 8, delay: 2, ease: 'backOut', yoyo: true, repeat: 'forever' },
      { prop: 'color', from: '#fff', to: '#d82800', frames: 6, amount: 0.6 },
    ];
    for (const s of specs) expect(tweenSpecSchema.safeParse(s).success).toBe(true);
    expect(tweensSchema.safeParse(specs).success).toBe(true);
  });

  const pathOf = (value: unknown) => {
    const r = tweenSpecSchema.safeParse(value);
    return r.success ? null : r.error.issues.map((i) => i.path.join('.'));
  };

  it('names the field of a bad ease, property, colour or timing', () => {
    expect(pathOf({ prop: 'x', to: 1, frames: 2, ease: 'wobble' })).toEqual(['ease']);
    expect(pathOf({ prop: 'size', to: 1, frames: 2 })).toEqual(['prop']);
    expect(pathOf({ prop: 'color', to: 'red', frames: 2 })).toEqual(['to']);
    expect(pathOf({ prop: 'x', to: '#fff', frames: 2 })).toEqual(['to']);
    expect(pathOf({ prop: 'x', to: 1, frames: 0 })).toEqual(['frames']);
    expect(pathOf({ prop: 'x', to: 1, frames: 2, amount: 0.5 })).toEqual(['']);
  });
});
