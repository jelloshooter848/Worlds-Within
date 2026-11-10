import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Voice } from './apu';
import {
  DuckEnvelope,
  LayerMix,
  SoundPicker,
  soundVariation,
  statusMatches,
  duckSpecSchema,
  type MusicEntry,
} from './mix';
import { compileSong } from './mml';
import { Sequencer } from './sequencer';

// The mixer's pure half (Engine 0.16 T8): mix rules and their crossfades, the duck envelope, sound
// variation per seed and frame with cooldowns, and layered songs kept sample-aligned.

const ENTRY: MusicEntry = {
  layers: { calm: 'calm-song', danger: 'danger-song' },
  fade: 10,
  mix: [
    { when: { status: 'near', gte: 0, lt: 50 }, layers: { danger: 1, calm: 0.3 }, fade: 4 },
    { layers: { calm: 1, danger: 0 } },
  ],
};

describe('statusMatches', () => {
  it('holds when every operator holds; a missing key or a non-number never matches a number test', () => {
    expect(statusMatches({ status: 'near', gte: 0, lt: 50 }, { near: 20 })).toBe(true);
    expect(statusMatches({ status: 'near', gte: 0, lt: 50 }, { near: 50 })).toBe(false);
    expect(statusMatches({ status: 'near', gte: 0, lt: 50 }, { near: -1 })).toBe(false);
    expect(statusMatches({ status: 'near', gt: 1 }, {})).toBe(false);
    expect(statusMatches({ status: 'near', gt: 1 }, { near: 'far' })).toBe(false);
    expect(statusMatches({ status: 'mode', eq: 'boss' }, { mode: 'boss' })).toBe(true);
    expect(statusMatches({ status: 'mode', ne: 'boss' }, { mode: 'boss' })).toBe(false);
    expect(statusMatches({ status: 'hurt', eq: true }, { hurt: true })).toBe(true);
    expect(statusMatches({ status: 'hp', lte: 1 }, { hp: 1 })).toBe(true);
  });
});

describe('LayerMix', () => {
  it('snaps to the first rule, then crossfades straight over the rule fade, tick by tick', () => {
    const mix = new LayerMix(ENTRY);
    expect(mix.update({ near: -1 })).toEqual({ calm: 1, danger: 0 });
    expect(mix.ruleIndex).toBe(1);
    // An enemy comes near: danger up, calm down, over 4 ticks.
    const seen = [1, 2, 3, 4, 5].map(() => mix.update({ near: 30 }));
    expect(seen.map((g) => g['danger'])).toEqual([0.25, 0.5, 0.75, 1, 1]);
    expect(seen.map((g) => +g['calm']!.toFixed(3))).toEqual([0.825, 0.65, 0.475, 0.3, 0.3]);
    expect(mix.ruleIndex).toBe(0);
    // It goes away: back over the entry's fade (10 ticks; the default rule gives none).
    const back = Array.from({ length: 10 }, () => mix.update({ near: 200 }));
    expect(back[0]!['danger']).toBeCloseTo(0.9);
    expect(back[4]!['danger']).toBeCloseTo(0.5);
    expect(back[9]).toEqual({ calm: 1, danger: 0 });
  });

  it('a new rule mid-fade fades on from where the levels are', () => {
    const mix = new LayerMix(ENTRY);
    mix.update({ near: 999 });
    mix.update({ near: 10 });
    mix.update({ near: 10 }); // danger 0.5
    const turned = mix.update({ near: 999 });
    expect(turned['danger']).toBeCloseTo(0.45); // from 0.5 toward 0 over 10 ticks
  });

  it('a layer no rule names plays at 1; no rule at all keeps the levels', () => {
    const mix = new LayerMix({
      layers: { a: 'x', b: 'y' },
      mix: [{ when: { status: 'k', eq: 1 }, layers: { a: 0 } }],
    });
    expect(mix.update({})).toEqual({ a: 1, b: 1 });
    expect(mix.ruleIndex).toBe(-1);
    expect(mix.update({ k: 1 })['a']).toBeCloseTo(1 - 1 / 30); // the default fade, 30 ticks
  });
});

describe('DuckEnvelope', () => {
  it('goes down over attack, holds, comes back over release', () => {
    const duck = new DuckEnvelope();
    duck.trigger(duckSpecSchema.parse({ amount: 0.6, attack: 2, hold: 2, release: 4 }));
    const values = Array.from({ length: 10 }, () => +duck.tick().toFixed(3));
    expect(values).toEqual([0.7, 0.4, 0.4, 0.4, 0.55, 0.7, 0.85, 1, 1, 1]);
  });

  it('defaults: attack 4, hold 0, release 20', () => {
    expect(duckSpecSchema.parse({ amount: 0.5 })).toEqual({ amount: 0.5, attack: 4, hold: 0, release: 20 });
  });

  it('a sustained duck stays down while on and releases from where it is; the deepest wins', () => {
    const duck = new DuckEnvelope();
    const dialog = { amount: 0.5, attack: 2, hold: 0, release: 2 };
    duck.sustain('dialog', dialog);
    expect([duck.tick(), duck.tick(), duck.tick(), duck.tick()]).toEqual([0.75, 0.5, 0.5, 0.5]);
    duck.trigger({ amount: 0.8, attack: 0, hold: 0, release: 4 });
    expect(duck.tick()).toBeCloseTo(0.2);
    duck.sustain('dialog', dialog); // already on: nothing new
    duck.sustain('dialog', null);
    const after = Array.from({ length: 6 }, () => +duck.tick().toFixed(3));
    expect(after).toEqual([0.4, 0.6, 0.8, 1, 1, 1]);
  });
});

describe('sound variation', () => {
  const cue = { frame: 12, pitch: [-2, 2] as const, volume: [0.5, 1] as const };

  it('is the same for the same seed, frame and sound, and in range', () => {
    const a = soundVariation(7, 12, 'step', 0, cue);
    expect(soundVariation(7, 12, 'step', 0, cue)).toEqual(a);
    expect(a.pitch).toBeGreaterThanOrEqual(-2);
    expect(a.pitch).toBeLessThan(2);
    expect(a.volume).toBeGreaterThanOrEqual(0.5);
    expect(a.volume).toBeLessThan(1);
  });

  it('differs by seed, frame, sound and play in the frame', () => {
    const a = soundVariation(7, 12, 'step', 0, cue);
    expect(soundVariation(8, 12, 'step', 0, cue)).not.toEqual(a);
    expect(soundVariation(7, 13, 'step', 0, cue)).not.toEqual(a);
    expect(soundVariation(7, 12, 'jump', 0, cue)).not.toEqual(a);
    expect(soundVariation(7, 12, 'step', 1, cue)).not.toEqual(a);
  });

  it('no range: unchanged', () => {
    expect(soundVariation(7, 12, 'step', 0, {})).toEqual({ pitch: 0, volume: 1 });
  });

  it('SoundPicker: a play per frame drawn the same on every run; cooldown drops early plays', () => {
    const run = () => {
      const picker = new SoundPicker(3);
      return [10, 11, 12, 14, 14, 20, 2].map((frame) =>
        picker.pick('step', { frame, pitch: [-1, 1], cooldown: 3 }),
      );
    };
    const plays = run();
    expect(plays).toEqual(run());
    // 10 plays, 11 and 12 rest, 14 plays and its second play rests, 20 plays, 2 (a new level) plays.
    expect(plays.map((p) => p !== null)).toEqual([true, false, false, true, false, true, true]);
    expect(plays[0]!.pitch).toBe(soundVariation(3, 10, 'step', 0, { pitch: [-1, 1] }).pitch);
  });

  it('SoundPicker: two plays of one sound in a frame draw apart; the duck comes along', () => {
    const picker = new SoundPicker(3);
    const duck = { amount: 0.5, attack: 1, hold: 0, release: 1 };
    const a = picker.pick('hit', { frame: 5, volume: [0, 1], duck })!;
    const b = picker.pick('hit', { frame: 5, volume: [0, 1] })!;
    expect(a.volume).not.toBe(b.volume);
    expect(a.duck).toEqual(duck);
    expect(b.duck).toBeUndefined();
  });
});

describe('Sequencer.playLayers: layers stay sample-aligned', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('every layer note on tick n sounds at the same sample, loop after loop', () => {
    const ctx = { currentTime: 3 } as { currentTime: number };
    const notes: { layer: string; at: number }[] = [];
    const voices = (layer: string) => {
      const v = (): Voice =>
        ({
          note: (_p: number, at: number) => void notes.push({ layer, at }),
          stop() {},
          gain: {},
        }) as unknown as Voice;
      return { pulse1: v(), pulse2: v(), triangle: v(), noise: v() };
    };
    const seq = new Sequencer(ctx as unknown as BaseAudioContext, voices('main'));
    const calm = compileSong({ id: 'c', bpm: 137, loop: true, pulse1: 'l8 c d e f g a b > c' });
    const danger = compileSong({ id: 'd', bpm: 137, loop: true, noise: 'l8 [k h]4' });
    seq.playLayers(
      [
        { song: calm, voices: voices('calm') },
        { song: danger, voices: voices('danger') },
      ],
      3.05,
    );
    for (let t = 3; t < 20; t += 0.025) {
      ctx.currentTime = t;
      vi.advanceTimersByTime(25);
    }
    const at = (layer: string) => notes.filter((n) => n.layer === layer).map((n) => Math.round(n.at * 48000));
    const a = at('calm');
    const b = at('danger');
    expect(a.length).toBeGreaterThan(60); // several loops of eight notes
    expect(b.slice(0, a.length)).toEqual(a);
    expect(notes.some((n) => n.layer === 'main')).toBe(false);
    // A tempo change restarts every layer together.
    seq.setTempoScale(1.5);
    const restart = notes.slice(-2);
    expect(restart.map((n) => n.layer).sort()).toEqual(['calm', 'danger']);
    expect(restart[0]!.at).toBe(restart[1]!.at);
    seq.stop();
  });
});
