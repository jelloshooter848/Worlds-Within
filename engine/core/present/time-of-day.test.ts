import { describe, expect, it } from 'vitest';
import { clockStatus, worldClock } from '../clock';
import { resolveScene3d, scene3dSchema } from './scene3d';
import {
  baseDayLook,
  DayClockTween,
  statusHours,
  TimeOfDayLook,
  timeOfDaySchema,
  type SkinTimeOfDay,
} from './time-of-day';
import { validate } from '../content/validate';

// Engine 0.16 F4: a 3D skin's look through the day, from the frame's world clock.

const SCENE = {
  sun: { color: '#ffffff', intensity: 1.5, direction: { x: 0, y: 2, z: 1 } },
  ambient: { color: '#ffffff', intensity: 0.4 },
  hemisphere: { sky: '#a0c0ff', ground: '#406020', intensity: 0.5 },
  fog: { kind: 'linear' as const, color: '#a0c0ff', near: 100, far: 900 },
  toneMapping: { kind: 'aces' as const, exposure: 1.2 },
};

const TIME: SkinTimeOfDay = {
  keys: [
    {
      hour: 6,
      sun: { color: '#ff8000', intensity: 0.5, direction: { x: -4, y: 1, z: 0 } },
      background: '#ff8000',
    },
    { hour: 12, sun: { color: '#ffffff', intensity: 2 } },
    { hour: 18, sun: { color: '#ff0000', direction: { x: 4, y: 1, z: 0 } }, fog: { color: '#802000' } },
    {
      hour: 22,
      sun: { color: '#000080', intensity: 0.1 },
      ambient: { intensity: 0.1 },
      hemisphere: { intensity: 0 },
      background: '#000020',
      exposure: 0.6,
    },
  ],
};

const base = baseDayLook(resolveScene3d(SCENE, { ambient: 0, directional: 0 }), '#a0c0ff');
const day = new TimeOfDayLook(TIME, base);

describe('time-of-day keyframes (Engine 0.16 F4)', () => {
  it("shows each key at its hour, the skin's own values where a key gives none", () => {
    const noon = day.at(12);
    expect(noon.sun).toEqual({ color: '#ffffff', intensity: 2, direction: { x: 0, y: 2, z: 1 } });
    expect(noon.background).toBe('#a0c0ff');
    expect(noon.exposure).toBe(1.2);
    expect(noon.fog).toEqual({ color: '#a0c0ff', near: 100, far: 900, density: 0 });
    const six = day.at(6);
    expect([six.sun.color, six.sun.intensity, six.background]).toEqual(['#ff8000', 0.5, '#ff8000']);
    const night = day.at(22);
    expect([night.ambient.intensity, night.hemisphere.intensity, night.exposure]).toEqual([0.1, 0, 0.6]);
  });

  it('interpolates between keys: colours by channel, numbers and the sun direction linearly', () => {
    const nine = day.at(9);
    expect(nine.sun.color).toBe('#ffc080');
    expect(nine.sun.intensity).toBeCloseTo(1.25);
    expect(nine.sun.direction).toEqual({ x: -2, y: 1.5, z: 0.5 });
    expect(nine.background).toBe('#d0a080');
    const fifteen = day.at(15);
    expect(fifteen.fog?.color).toBe('#907080');
  });

  it('runs round midnight from the last key to the first', () => {
    // 22:00 -> 06:00 is 8 hours; 02:00 is half way.
    const two = day.at(2);
    expect(two.sun.intensity).toBeCloseTo(0.3);
    expect(two.sun.color).toBe('#804040');
    expect(day.at(26)).toEqual(two);
    expect(day.at(-22)).toEqual(two);
    expect(day.at(0).sun.intensity).toBeCloseTo(0.1 + (0.4 * 2) / 8);
  });

  it('holds one key all day', () => {
    const one = new TimeOfDayLook({ keys: [{ hour: 10, exposure: 2 }] }, base);
    expect(one.at(3).exposure).toBe(2);
    expect(one.at(23.5)).toEqual(one.at(10));
  });

  it('reads the clock from the frame status, under its prefix', () => {
    const c = worldClock({ day: 2, hour: 15 }, 30);
    expect(statusHours(clockStatus(c))).toBeCloseTo(24 + 15.5);
    expect(statusHours(clockStatus(c, 'sky'), 'sky')).toBeCloseTo(39.5);
    expect(statusHours({ hp: 3 })).toBeNull();
    expect(statusHours({ 'clock.day': '2', 'clock.fraction': 0.5 })).toBeNull();
  });
});

describe('the time-of-day tween (Engine 0.16 F4)', () => {
  it('follows a steady clock at once and eases a jump over its frames', () => {
    const tween = new DayClockTween({ ticks: 4, ease: 'linear' });
    expect(tween.shown(14)).toBe(14);
    expect(tween.shown(14 + 1 / 60)).toBeCloseTo(14 + 1 / 60);
    expect(tween.active).toBe(false);
    // A mission's commit: two hours at once.
    const to = 16 + 1 / 60;
    const eased = [1, 2, 3, 4].map(() => tween.shown(to)!);
    expect(eased.map((h) => Math.round(h * 100) / 100)).toEqual([14.52, 15.02, 15.52, 16.02]);
    expect(tween.active).toBe(false);
    expect(tween.shown(to + 1 / 60)).toBeCloseTo(to + 1 / 60);
  });

  it('follows a clock that moves on during the ease, and starts afresh without one', () => {
    const tween = new DayClockTween({ ticks: 2, ease: 'linear' });
    tween.shown(10);
    expect(tween.shown(12)).toBe(11);
    expect(tween.shown(12.5)).toBe(12.5);
    expect(tween.shown(null)).toBeNull();
    expect(tween.shown(20)).toBe(20);
    const snap = new DayClockTween({ ticks: 0 });
    snap.shown(10);
    expect(snap.shown(14)).toBe(14);
  });

  it('is the same every run (no clock, no randomness)', () => {
    const run = () => {
      const t = new DayClockTween();
      return [10, 10.1, 12.1, 12.2, 12.2, 12.3, 30].map((h) => t.shown(h));
    };
    expect(run()).toEqual(run());
  });
});

describe('the timeOfDay schema (Engine 0.16 F4)', () => {
  const codes = (data: unknown, schema: Parameters<typeof validate>[2] = timeOfDaySchema) => {
    const r = validate('three.json', data, schema);
    return r.ok ? [] : r.errors.map((e) => [e.path, e.code]);
  };

  it('takes keys in rising hour order, a tween and an ease', () => {
    expect(codes(TIME)).toEqual([]);
    expect(codes({ ...TIME, tween: 30, ease: 'cubicInOut', status: 'clock' })).toEqual([]);
    expect(codes({ keys: [] })).toEqual([['keys', 'too_small']]);
    expect(codes({ keys: [{ hour: 6 }, { hour: 6 }] })).toEqual([['keys.1.hour', 'bad_time_key']]);
    expect(codes({ keys: [{ hour: 24 }] })).toEqual([['keys.0.hour', 'too_big']]);
    expect(codes({ ease: 'wobble', keys: [{ hour: 1 }] })).toEqual([['ease', 'bad_ease']]);
    expect(codes({ keys: [{ hour: 1, sun: { colour: '#fff' } }] })).toEqual([
      ['keys.0.sun.colour', 'unrecognized_keys'],
    ]);
  });

  it("needs the skin's own fog for a key's fog", () => {
    expect(codes({ fog: SCENE.fog, timeOfDay: TIME }, scene3dSchema)).toEqual([]);
    expect(codes({ timeOfDay: TIME }, scene3dSchema)).toEqual([['timeOfDay.keys.2.fog', 'missing_field']]);
  });
});
