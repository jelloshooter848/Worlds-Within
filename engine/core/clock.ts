import { z } from 'zod';

/**
 * The world clock (Engine 0.16 F4): what time of day it is in a campaign entry's world, for the
 * picture only. A campaign entry may say what the clock reads at its world tick 0
 * (`clock: { day, hour, minute }`) and the campaign how many world ticks make an hour
 * (`ticksPerHour`, default {@link DEFAULT_TICKS_PER_HOUR}); the clock at any later tick is
 * {@link worldClock} of the two. It is derived from the entry and the world tick, never stored: no
 * world state, no state hash and no save code holds it, so adding a clock to a campaign moves no
 * golden hash. A mission's commit cost (its `worldTimeCost` ticks) moves the world tick, so the
 * clock jumps with it.
 *
 *   worldClock({ day: 2, hour: 14, minute: 0 }, 64)
 *   // { day: 2, hour: 15, minute: 4, time: '15:04', text: 'Day 2 15:04',
 *   //   phase: 'late afternoon', fraction: 0.6278 }
 *
 * {@link clockStatus} gives the frame status a skin reads (`clock.day`, `clock.time`,
 * `clock.text`, `clock.phase`, `clock.fraction`): a 3D skin's `scene3d.timeOfDay` and the UI kit's
 * `clock` HUD widget. Pure.
 */

/** World ticks per hour when a campaign gives none: one tick a minute (a 120-tick mission is 2 hours). */
export const DEFAULT_TICKS_PER_HOUR = 60;

/** Minutes in a day. */
export const MINUTES_PER_DAY = 24 * 60;

/** The parts of the day, in order from dawn. */
export const DAY_PHASES = ['dawn', 'morning', 'afternoon', 'late afternoon', 'evening', 'night'] as const;
export type DayPhase = (typeof DAY_PHASES)[number];

/** The hour each part of the day starts at (night runs on past midnight to dawn). */
export const DAY_PHASE_STARTS: Readonly<Record<DayPhase, number>> = {
  dawn: 5,
  morning: 7,
  afternoon: 12,
  'late afternoon': 15,
  evening: 18,
  night: 21,
};

/** What a clock reads: the `clock` of a campaign entry, at its world tick 0. */
export const clockTimeSchema = z.strictObject({
  day: z.int().min(1).max(9999).describe('the day, counted from 1'),
  hour: z.int().min(0).max(23).describe('the hour, 0-23'),
  minute: z.int().min(0).max(59).exactOptional().describe('the minute, 0-59 (default 0)'),
});
export type ClockTime = z.infer<typeof clockTimeSchema>;

/** The clock at one world tick. */
export interface WorldClock {
  /** The day, counted from 1. */
  day: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
  /** `hh:mm`, e.g. `15:04`. */
  time: string;
  /** `Day <day> <time>`, e.g. `Day 2 15:04`. */
  text: string;
  /** The part of the day ({@link DAY_PHASES}). */
  phase: DayPhase;
  /** How far through the day, 0 (midnight) up to 1. */
  fraction: number;
}

/** The part of the day at `hour` (0-24, fractions allowed). */
export function dayPhase(hour: number): DayPhase {
  let phase: DayPhase = 'night';
  for (const p of DAY_PHASES) if (hour >= DAY_PHASE_STARTS[p]) phase = p;
  return phase;
}

/** Minutes since day 1, 00:00, of a clock reading. */
export function clockMinutes(time: ClockTime): number {
  return (time.day - 1) * MINUTES_PER_DAY + time.hour * 60 + (time.minute ?? 0);
}

/** The clock `minutes` after day 1, 00:00 (negative counts as 0). */
export function clockAt(minutes: number): WorldClock {
  const total = Math.max(0, Math.floor(minutes));
  const ofDay = total % MINUTES_PER_DAY;
  const day = Math.floor(total / MINUTES_PER_DAY) + 1;
  const hour = Math.floor(ofDay / 60);
  const minute = ofDay % 60;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return {
    day,
    hour,
    minute,
    time,
    text: `Day ${day} ${time}`,
    phase: dayPhase(hour + minute / 60),
    fraction: ofDay / MINUTES_PER_DAY,
  };
}

/**
 * The clock at `worldTick` of an entry whose clock reads `start` at tick 0, with `ticksPerHour`
 * world ticks an hour: whole minutes, rounded down (a tick before 0 reads as 0).
 */
export function worldClock(
  start: ClockTime,
  worldTick: number,
  ticksPerHour: number = DEFAULT_TICKS_PER_HOUR,
): WorldClock {
  const ticks = Math.max(0, worldTick);
  return clockAt(clockMinutes(start) + Math.floor((ticks * 60) / ticksPerHour));
}

/** The frame status prefix a clock is put under when a caller names none. */
export const CLOCK_STATUS = 'clock';

/** The fields {@link clockStatus} writes, after `<prefix>.`. */
export const CLOCK_STATUS_FIELDS = ['day', 'time', 'text', 'phase', 'fraction'] as const;

/**
 * A clock as frame status: `<prefix>.day` (a number), `.time` (`hh:mm`), `.text`
 * (`Day 2 15:04`), `.phase` (`late afternoon`) and `.fraction` (0 up to 1). The prefix is
 * {@link CLOCK_STATUS} when left out.
 */
export function clockStatus(
  clock: WorldClock,
  prefix: string = CLOCK_STATUS,
): Record<string, string | number> {
  return {
    [`${prefix}.day`]: clock.day,
    [`${prefix}.time`]: clock.time,
    [`${prefix}.text`]: clock.text,
    [`${prefix}.phase`]: clock.phase,
    [`${prefix}.fraction`]: clock.fraction,
  };
}
