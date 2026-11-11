import { describe, expect, it } from 'vitest';
import {
  clockAt,
  clockMinutes,
  clockStatus,
  clockTimeSchema,
  DAY_PHASES,
  dayPhase,
  worldClock,
} from './clock';

describe('the world clock (Engine 0.16 F4)', () => {
  it('moves on a minute a tick at the default 60 ticks an hour', () => {
    const c = worldClock({ day: 2, hour: 14, minute: 0 }, 64);
    expect(c).toEqual({
      day: 2,
      hour: 15,
      minute: 4,
      time: '15:04',
      text: 'Day 2 15:04',
      phase: 'late afternoon',
      fraction: (15 * 60 + 4) / 1440,
    });
    // A 120-tick mission is two hours.
    expect(worldClock({ day: 2, hour: 14 }, 64 + 120).time).toBe('17:04');
  });

  it('rolls over midnight into the next day', () => {
    const c = worldClock({ day: 1, hour: 23, minute: 30 }, 45);
    expect([c.day, c.time, c.phase]).toEqual([2, '00:15', 'night']);
    expect(worldClock({ day: 1, hour: 0 }, 60 * 24 * 3).text).toBe('Day 4 00:00');
  });

  it("takes the campaign's ticks an hour, in whole minutes rounded down", () => {
    expect(worldClock({ day: 1, hour: 6 }, 10, 20).time).toBe('06:30');
    expect(worldClock({ day: 1, hour: 6 }, 1, 120).time).toBe('06:00');
    expect(worldClock({ day: 1, hour: 6 }, 3, 120).time).toBe('06:01');
    expect(worldClock({ day: 1, hour: 6 }, -5).time).toBe('06:00');
  });

  it('names the part of the day', () => {
    const at = (h: number) => dayPhase(h);
    expect([
      at(0),
      at(4.99),
      at(5),
      at(6.5),
      at(7),
      at(11.9),
      at(12),
      at(15),
      at(18),
      at(20.99),
      at(21),
      at(23.9),
    ]).toEqual([
      'night',
      'night',
      'dawn',
      'dawn',
      'morning',
      'morning',
      'afternoon',
      'late afternoon',
      'evening',
      'evening',
      'night',
      'night',
    ]);
    expect(DAY_PHASES).toHaveLength(6);
  });

  it('counts minutes from day 1 and back', () => {
    expect(clockMinutes({ day: 3, hour: 5, minute: 30 })).toBe(2 * 1440 + 330);
    expect(clockAt(2 * 1440 + 330).text).toBe('Day 3 05:30');
    expect(clockAt(12 * 60).fraction).toBe(0.5);
  });

  it('gives the frame status a skin reads, under a prefix', () => {
    const c = worldClock({ day: 2, hour: 18 }, 0);
    expect(clockStatus(c)).toEqual({
      'clock.day': 2,
      'clock.time': '18:00',
      'clock.text': 'Day 2 18:00',
      'clock.phase': 'evening',
      'clock.fraction': 0.75,
    });
    expect(Object.keys(clockStatus(c, 'sky'))).toEqual([
      'sky.day',
      'sky.time',
      'sky.text',
      'sky.phase',
      'sky.fraction',
    ]);
  });

  it('checks a clock reading', () => {
    expect(clockTimeSchema.safeParse({ day: 1, hour: 6 }).success).toBe(true);
    expect(clockTimeSchema.safeParse({ day: 0, hour: 6 }).success).toBe(false);
    expect(clockTimeSchema.safeParse({ day: 1, hour: 24 }).success).toBe(false);
    expect(clockTimeSchema.safeParse({ day: 1, hour: 6, minute: 60 }).success).toBe(false);
    expect(clockTimeSchema.safeParse({ day: 1, hour: 6, second: 1 }).success).toBe(false);
  });
});
