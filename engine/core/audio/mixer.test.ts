import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Apu } from './apu';
import { AudioManager } from './audio-manager';
import { soundVariation, type MusicEntry } from './mix';
import { midiToHz } from './mml';
import { Mixer } from './mixer';

// The mixer over a real AudioManager on a fake AudioContext (Engine 0.16 T8), the pattern of
// audio-fade.test.ts: the layer gains follow the mix rules, a varied sound plays at its drawn
// pitch and volume, ducking moves the music bus (never the stored volume), the ui bus has its
// own voices, and a dialog ducks.

/** An AudioParam that remembers its automation calls. */
class Param {
  value = 1;
  calls: string[] = [];
  cancelScheduledValues(t: number) {
    this.calls.push(`cancel@${t}`);
  }
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.calls.push(`set ${v}@${t}`);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.value = v; // the fake jumps to a ramp's end
    this.calls.push(`ramp ${v}@${t}`);
  }
}

class Node {
  out: Node[] = [];
  gain = new Param();
  frequency = new Param();
  playbackRate = new Param();
  buffer: unknown = null;
  loop = false;
  type = '';
  connect(n: Node) {
    this.out.push(n);
    return n;
  }
  start() {}
  stop() {}
  setPeriodicWave() {}
  getChannelData() {
    return new Float32Array(8);
  }
}

class FakeContext {
  static last: FakeContext | null = null;
  state = 'running';
  sampleRate = 48000;
  currentTime = 2;
  destination = new Node();
  constructor() {
    FakeContext.last = this;
  }
  createGain() {
    return new Node();
  }
  createOscillator() {
    return new Node();
  }
  createBufferSource() {
    return new Node();
  }
  createBuffer() {
    return new Node();
  }
  createPeriodicWave() {
    return {};
  }
  resume() {
    return Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener() {},
    createElement: () => ({ setAttribute() {}, play: () => Promise.resolve() }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CALM = { id: 'calm', bpm: 120, loop: true, pulse1: 'l4 c d e f' };
const DANGER = { id: 'danger', bpm: 120, loop: true, noise: 'l4 k h k h' };
const BEEP = { id: 'beep', pulse: 'o4 c' };
const MUSIC: Record<string, MusicEntry> = {
  lab: {
    layers: { calm: 'calm', danger: 'danger' },
    mix: [
      { when: { status: 'near', gte: 0, lt: 50 }, layers: { calm: 0.25, danger: 1 }, fade: 4 },
      { layers: { calm: 1, danger: 0 } },
    ],
  },
};

function setup(seed = 9) {
  const audio = new AudioManager();
  audio.registerSongs([CALM, DANGER]);
  audio.registerSfx([BEEP]);
  audio.registerMusic(MUSIC);
  audio.setVolumes({ master: 0.8, music: 0.5, sfx: 0.7 });
  audio.unlock();
  const apu = (audio as unknown as { apu: Apu }).apu;
  const mixer = new Mixer({ audio, music: MUSIC, seed });
  return { audio, apu, mixer, ctx: FakeContext.last as FakeContext };
}
const gainOf = (n: { gain: unknown }) => (n.gain as Param).value;

describe('the mixer over the AudioManager', () => {
  it('plays every layer at once and sets their gains from the mix rules, with the fade', () => {
    const { apu, mixer, audio } = setup();
    mixer.frameStatus({ near: -1 });
    mixer.play('lab');
    const calm = apu.layer(0).gain;
    const danger = apu.layer(1).gain;
    expect([gainOf(calm), gainOf(danger)]).toEqual([1, 0]);
    // Both layers' songs play on their own voices, and the plain music voices stay silent.
    expect((apu.layer(0).voices.pulse1.gain.gain as unknown as Param).calls.length).toBeGreaterThan(0);
    expect((apu.layer(1).voices.noise.gain.gain as unknown as Param).calls.length).toBeGreaterThan(0);
    expect((apu.voices.pulse1.gain.gain as unknown as Param).calls).toEqual([]);
    mixer.frameStatus({ near: 20 });
    const levels: number[][] = [];
    for (let i = 0; i < 5; i++) {
      mixer.tick();
      levels.push([gainOf(calm), gainOf(danger)]);
    }
    expect(levels).toEqual([
      [0.8125, 0.25],
      [0.625, 0.5],
      [0.4375, 0.75],
      [0.25, 1],
      [0.25, 1],
    ]);
    expect(audio.mixLevels()).toEqual({ song: 'lab', layers: { calm: 0.25, danger: 1 }, duck: 1 });
    expect(mixer.state()).toMatchObject({ song: 'lab', rule: 0, layers: { calm: 0.25, danger: 1 }, tick: 5 });
  });

  it('a layered song played before the first gesture starts at the levels the mixer set', () => {
    const audio = new AudioManager();
    audio.registerSongs([CALM, DANGER]);
    audio.registerMusic(MUSIC);
    const mixer = new Mixer({ audio, music: MUSIC });
    mixer.frameStatus({ near: 3 });
    mixer.play('lab');
    audio.unlock();
    const apu = (audio as unknown as { apu: Apu }).apu;
    expect([gainOf(apu.layer(0).gain), gainOf(apu.layer(1).gain)]).toEqual([0.25, 1]);
  });

  it('an ordinary song plays as before, with no layers', () => {
    const { mixer, apu } = setup();
    mixer.play('calm');
    mixer.tick();
    expect((apu.voices.pulse1.gain.gain as unknown as Param).calls.length).toBeGreaterThan(0);
    expect(mixer.state()).toMatchObject({ song: 'calm', rule: -1, layers: {} });
  });

  it('plays a varied sound at its drawn pitch and volume, the same every run', () => {
    const play = (cue: Parameters<Mixer['sound']>[1]) => {
      const { mixer, apu } = setup(4);
      mixer.sound('beep', cue);
      const v = apu.voices.sfxPulse as unknown as { osc: Node; gain: Node };
      // The first value set after the voice's own stop (0).
      const set = (calls: string[]) => calls.filter((c) => c.startsWith('set') && !c.startsWith('set 0@'))[0];
      return { hz: set(v.osc.frequency.calls), vol: set(v.gain.gain.calls) };
    };
    const cue = { frame: 30, pitch: [-3, 3], volume: [0.4, 0.9] } as const;
    const a = play(cue);
    expect(play(cue)).toEqual(a);
    const plain = play({ frame: 30 });
    const { pitch, volume } = soundVariation(4, 30, 'beep', 0, cue);
    expect(pitch).not.toBe(0);
    expect(plain.hz).toContain(`set ${midiToHz(60)}@`);
    expect(a.hz).toContain(`set ${midiToHz(60 + pitch)}@`);
    const level = (call: string) => Number(call.slice(4, call.indexOf('@')));
    expect(level(a.vol!)).toBeCloseTo(level(plain.vol!) * volume, 9);
  });

  it('drops a sound still cooling down and counts it', () => {
    const { mixer } = setup();
    mixer.sound('beep', { frame: 1, cooldown: 5 });
    mixer.sound('beep', { frame: 3, cooldown: 5 });
    mixer.sound('beep', { frame: 6, cooldown: 5 });
    expect(mixer.state().sounds).toEqual({ played: 2, dropped: 1 });
  });

  it('a sound with a duck lowers the music bus over its envelope; the stored volume stays', () => {
    const { mixer, apu, audio } = setup();
    mixer.sound('beep', { frame: 1, duck: { amount: 0.5, attack: 1, hold: 1, release: 2 } });
    const music: number[] = [];
    for (let i = 0; i < 6; i++) {
      mixer.tick();
      music.push(gainOf(apu.musicGain));
    }
    // Down in one tick, held one more, back over two.
    expect(music).toEqual([0.25, 0.25, 0.375, 0.5, 0.5, 0.5]);
    expect(audio.volumeLevels.music).toBe(0.5);
    // A volume change while ducked keeps the duck.
    mixer.sound('beep', { frame: 9, duck: { amount: 0.5, attack: 0, hold: 3, release: 2 } });
    mixer.tick();
    audio.setVolumes({ music: 1 });
    expect(gainOf(apu.musicGain)).toBe(0.5);
  });

  it('ducks under a dialog box until it closes', () => {
    const { mixer, apu } = setup();
    mixer.dialog(true);
    const down = Array.from({ length: 8 }, () => (mixer.tick(), gainOf(apu.musicGain)));
    expect(down.at(-1)).toBeCloseTo(0.25); // the music volume 0.5 at half
    expect(mixer.state().dialog).toBe(true);
    mixer.dialog(false);
    const up = Array.from({ length: 21 }, () => (mixer.tick(), gainOf(apu.musicGain)));
    expect(up[0]).toBeGreaterThan(0.25);
    expect(up.at(-1)).toBe(0.5);
  });

  it('the ui bus: its own voices and gain, at the sfx volume', () => {
    const { mixer, apu } = setup();
    mixer.uiSound('beep');
    expect((apu.voices.uiPulse.gain.gain as unknown as Param).calls.length).toBeGreaterThan(0);
    expect((apu.voices.sfxPulse.gain.gain as unknown as Param).calls).toEqual([]);
    expect((apu.uiGain as unknown as Node).out).toEqual([apu.master]);
    expect(gainOf(apu.uiGain)).toBe(0.7);
    expect(mixer.state().buses).toEqual({ master: 0.8, music: 0.5, sfx: 0.7, ui: 0.7 });
  });
});
