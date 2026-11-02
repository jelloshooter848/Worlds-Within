import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager, MUSIC_FADE_IN_S } from './audio-manager';

// The music fades in (0.4.49): when sound starts (the first press) or comes back after the
// browser stopped it (the background, an interruption), the music rises from silence over about
// a second instead of starting at full volume (Apu.startFade). Sound effects, mute, the sliders
// and the map's page fade (Apu.musicFade, audio-fade.test.ts) are untouched.

/** Absorbs any Web Audio call: every property is itself, every call and `new` returns it. */
const anything: unknown = new Proxy(function () {}, {
  get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : anything),
  set: () => true,
  apply: () => anything,
  construct: () => anything as object,
});

type Ev = [string, number, number?];
class FakeParam {
  value = 1;
  events: Ev[] = [];
  cancelScheduledValues(t: number) {
    this.events.push(['cancel', t]);
  }
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['ramp', v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(['exp', v, t]);
  }
  setTargetAtTime(v: number, t: number) {
    this.events.push(['target', v, t]);
  }
}
class FakeGain {
  gain = new FakeParam();
  connect() {}
}

class FakeContext {
  static last: FakeContext | null = null;
  state = 'running';
  sampleRate = 48000;
  currentTime = 5;
  destination = {};
  constructor() {
    FakeContext.last = this;
    return new Proxy(this, { get: (t, k) => (k in t ? t[k as keyof FakeContext] : anything) });
  }
  createGain() {
    return new FakeGain();
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
}

beforeEach(() => {
  FakeContext.last = null;
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: () => {},
    createElement: () => ({ setAttribute() {}, play: () => Promise.resolve() }),
  });
});
afterEach(() => vi.unstubAllGlobals());

interface Gains {
  master: FakeGain;
  musicGain: FakeGain;
  sfxGain: FakeGain;
  musicFade: FakeGain;
  startFade: FakeGain;
}
function unlocked() {
  const audio = new AudioManager();
  audio.unlock();
  const ctx = FakeContext.last as FakeContext;
  const apu = (audio as unknown as { apu: Gains }).apu;
  return { audio, ctx, apu, fade: apu.startFade.gain };
}
const ramps = (p: FakeParam) => p.events.filter((e) => e[0] === 'ramp');

describe('the music fades in when sound starts', () => {
  it('about a second', () => {
    expect(MUSIC_FADE_IN_S).toBeGreaterThanOrEqual(1);
    expect(MUSIC_FADE_IN_S).toBeLessThanOrEqual(1.5);
  });

  it('the first press: from silence up to full over MUSIC_FADE_IN_S; sound effects are not faded', () => {
    const { apu, fade } = unlocked();
    expect(fade.events).toEqual([
      ['cancel', 5],
      ['set', 0, 5],
      ['ramp', 1, 5 + MUSIC_FADE_IN_S],
    ]);
    // Not the effects, the volume stages, or the map's page fade (musicFade).
    for (const g of [apu.master, apu.musicGain, apu.sfxGain, apu.musicFade])
      expect(ramps(g.gain)).toEqual([]);
  });

  it('later presses with sound running do not fade again', () => {
    const { audio, ctx, fade } = unlocked();
    fade.events = [];
    ctx.currentTime = 9;
    audio.unlock();
    audio.unlock();
    expect(fade.events).toEqual([]);
  });

  it('back from the background (the browser stopped the sound): fades in again', () => {
    const { audio, ctx, fade } = unlocked();
    fade.events = [];
    ctx.state = 'interrupted';
    ctx.currentTime = 30;
    audio.wake();
    expect(ramps(fade)).toEqual([['ramp', 1, 30 + MUSIC_FADE_IN_S]]);
    expect(fade.events[1]).toEqual(['set', 0, 30]);
  });

  it('a press that restarts suspended sound fades it in', () => {
    const { audio, ctx, fade } = unlocked();
    fade.events = [];
    ctx.state = 'suspended';
    ctx.currentTime = 12;
    audio.unlock();
    expect(ramps(fade)).toEqual([['ramp', 1, 12 + MUSIC_FADE_IN_S]]);
  });

  it('a window coming back into focus with sound still playing: no dip', () => {
    const { audio, fade } = unlocked();
    fade.events = [];
    audio.wake();
    audio.unlock(); // the next press after wake (stale): the unlock again, but no fade
    expect(fade.events).toEqual([]);
  });

  it("the game's own pause and resume are unchanged (no fade)", () => {
    const { audio, fade } = unlocked();
    fade.events = [];
    audio.pause();
    audio.resume();
    expect(fade.events).toEqual([]);
  });

  it('mute and the sliders still set the master, music and sound gains; the fade-in is its own stage', () => {
    const { audio, apu, fade } = unlocked();
    audio.setVolumes({ master: 0.4, music: 0.5, sfx: 0.3, muted: false });
    expect(apu.master.gain.value).toBeCloseTo(0.2);
    expect(apu.musicGain.gain.value).toBe(0.5);
    expect(apu.sfxGain.gain.value).toBe(0.3);
    audio.setVolumes({ muted: true });
    expect(apu.master.gain.value).toBe(0);
    expect(fade.events.length).toBe(3); // only the first press's fade
  });
});
