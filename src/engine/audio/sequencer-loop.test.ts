import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Voice } from './apu';
import { compileSong } from './mml';
import { Sequencer } from './sequencer';

// playMusic can start a song at its loop point, skipping an intro.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function rig() {
  const ctx = { currentTime: 10 } as unknown as BaseAudioContext;
  const notes: { voice: string; pitch: number; at: number }[] = [];
  const voice = (name: string): Voice =>
    ({
      note: (pitch: number, at: number) => void notes.push({ voice: name, pitch, at }),
      stop: () => undefined,
      gain: {} as GainNode,
    }) as unknown as Voice;
  const seq = new Sequencer(ctx, {
    pulse1: voice('pulse1'),
    pulse2: voice('pulse2'),
    triangle: voice('triangle'),
    noise: voice('noise'),
  });
  return { ctx, seq, notes };
}

const song = compileSong({
  id: 't',
  bpm: 120,
  loop: true,
  pulse1: 'o4 c4 d4 L e4 f4',
  triangle: 'o3 g2 L a2',
});
/** MIDI numbers (o4 c = 60 in this MML). */
const C4 = 60;
const E4 = 64;

describe('Sequencer.play from the loop point', () => {
  it('from the start by default: the intro first', () => {
    const r = rig();
    r.seq.play(song, 10);
    const first = r.notes.filter((n) => n.voice === 'pulse1')[0];
    expect(first?.pitch).toBe(C4);
    expect(first?.at).toBe(10);
  });

  it('fromLoop: every track starts at its L, on time, and the loop goes on as usual', () => {
    const r = rig();
    r.seq.play(song, 10, true);
    const p1 = r.notes.filter((n) => n.voice === 'pulse1');
    expect(p1[0]).toMatchObject({ pitch: E4, at: 10 });
    const tri = r.notes.filter((n) => n.voice === 'triangle');
    expect(tri[0]?.at).toBe(10);
    expect(tri[0]?.pitch).toBe(57); // o3 a
    // Half a second a beat at 120 bpm: F one beat after E, then E again (the next pass).
    (r.ctx as { currentTime: number }).currentTime = 11.5;
    vi.advanceTimersByTime(100);
    const later = r.notes.filter((n) => n.voice === 'pulse1');
    expect(later.slice(0, 3).map((n) => [n.pitch, n.at])).toEqual([
      [E4, 10],
      [65, 10.5],
      [E4, 11],
    ]);
    expect(r.notes.some((n) => n.pitch === C4)).toBe(false);
    r.seq.stop();
  });

  it('a song without a loop point (or not looping) plays from its start', () => {
    const r = rig();
    r.seq.play(compileSong({ id: 'j', bpm: 120, loop: false, pulse1: 'o4 c4 L e4' }), 10, true);
    expect(r.notes[0]?.pitch).toBe(C4);
    r.seq.stop();
  });
});
