import { describe, expect, it } from 'vitest';
import { compileSong, midiToHz, parseMml, PPQ } from './mml';

describe('MML parser', () => {
  it('parses notes, octaves, lengths and rests', () => {
    const t = parseMml('o4 l8 c d+ e- r4 >c');
    expect(t.events.map((e) => e.note)).toEqual([60, 63, 63, null, 72]);
    expect(t.events.map((e) => e.len)).toEqual([24, 24, 24, 48, 24]);
    expect(t.length).toBe(144);
  });

  it('handles dotted lengths and ties', () => {
    const t = parseMml('l4 c. d4^8 e16..');
    expect(t.events.map((e) => e.len)).toEqual([72, 72, 21]);
  });

  it('applies volume, duty, gate and decay state', () => {
    const t = parseMml('v12 @1 q4 x1 c8 x0 d8');
    expect(t.events[0]).toMatchObject({ vol: 12, duty: 1, gate: 12, decay: true });
    expect(t.events[1]).toMatchObject({ decay: false });
  });

  it('expands repeats, including nested ones', () => {
    const t = parseMml('l8 [c [d]3 e]2');
    expect(t.events.map((e) => e.note)).toEqual([60, 62, 62, 62, 64, 60, 62, 62, 62, 64]);
  });

  it('records a loop point', () => {
    const t = parseMml('l4 c d L e f');
    expect(t.loopTick).toBe(96);
    expect(t.length).toBe(192);
  });

  it('parses noise periods and drum macros only on the noise channel', () => {
    const t = parseMml('l8 k s h n5', 'noise');
    expect(t.events.map((e) => e.note)).toEqual([11, 7, 1, 5]);
    expect(t.events[0]?.decay).toBe(true);
    expect(() => parseMml('k', 'pulse')).toThrow(/noise channel/);
    expect(() => parseMml('c', 'noise')).toThrow(/pitched note/);
  });

  it('reports errors with positions', () => {
    expect(() => parseMml('c8 z')).toThrow(/unexpected "z" at 3/);
    expect(() => parseMml('[c8')).toThrow(/unclosed/);
  });

  it('converts midi to Hz', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(57)).toBeCloseTo(220);
  });

  it('compiles a song and reports its length', () => {
    const s = compileSong({ id: 't', bpm: 120, loop: true, pulse1: 'l4 c d e f', noise: 'l4 k s k s' });
    expect(s.length).toBe(PPQ * 4);
    expect(s.tracks.pulse1?.events).toHaveLength(4);
    expect(s.tracks.noise?.events).toHaveLength(4);
  });
});
