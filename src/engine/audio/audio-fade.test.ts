import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Apu } from './apu';
import { AudioManager, MUSIC_FADE_IN_S, NULL_AUDIO } from './audio-manager';

// The music fade (0.4.48, for the world map's page changes): the music voices run through their
// own fade gain before the music volume, so fading a song out never touches the player's
// volume or mute (applyVolumes), and the next song (or jingle, or a stop) puts it back.

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

const SONG = { id: 'tune', bpm: 120, loop: true, pulse1: 'c4 d4 e4 f4' };
const OTHER = { id: 'other', bpm: 120, loop: true, pulse1: 'g4 a4 b4 a4' };

function setup() {
  const audio = new AudioManager();
  audio.registerSongs([SONG, OTHER]);
  audio.unlock();
  const apu = (audio as unknown as { apu: Apu }).apu;
  const fade = apu.musicFade.gain as unknown as Param;
  return { audio, apu, fade, ctx: FakeContext.last as FakeContext };
}

describe('the music fade', () => {
  it('sits between the music voices and the music volume; the effects bypass it', () => {
    const apu = new Apu(new FakeContext() as unknown as BaseAudioContext);
    const outs = (v: { gain: GainNode }) => (v.gain as unknown as Node).out;
    for (const v of [apu.voices.pulse1, apu.voices.pulse2, apu.voices.triangle, apu.voices.noise])
      expect(outs(v)).toEqual([apu.musicFade]);
    expect((apu.musicFade as unknown as Node).out).toEqual([apu.musicGain]);
    for (const v of [apu.voices.sfxPulse, apu.voices.sfxPulse2, apu.voices.sfxNoise, apu.voices.sfxTriangle])
      expect(outs(v)).toEqual([apu.sfxGain]);
  });

  it('fades the song to silence over the given time, leaving volume and mute alone', () => {
    const { audio, apu, fade, ctx } = setup();
    audio.setVolumes({ master: 0.6, music: 0.4 });
    audio.playMusic('tune');
    audio.fadeOutMusic(0.5);
    expect(fade.calls.slice(-1)).toEqual([`ramp 0@${ctx.currentTime + 0.5}`]);
    expect(apu.musicGain.gain.value).toBe(0.4);
    expect(apu.master.gain.value).toBeCloseTo(0.3);
    // Mute and volume still work as before, mid-fade.
    audio.setVolumes({ muted: true });
    expect(apu.master.gain.value).toBe(0);
    audio.setVolumes({ muted: false, music: 0.8 });
    expect(apu.musicGain.gain.value).toBe(0.8);
    expect(apu.master.gain.value).toBeCloseTo(0.3);
  });

  it('the next song starts at full level', () => {
    const { audio, fade } = setup();
    audio.playMusic('tune');
    audio.fadeOutMusic(0.5);
    fade.calls = [];
    audio.playMusic('other');
    expect(fade.value).toBe(1);
    expect(fade.calls.some((c) => c.startsWith('set 1@'))).toBe(true);
  });

  it('the same song asked for again mid-fade comes back up instead of staying silent', () => {
    const { audio, fade } = setup();
    audio.playMusic('tune');
    audio.fadeOutMusic(0.5);
    fade.calls = [];
    audio.playMusic('tune');
    expect(fade.calls.at(-1)).toMatch(/^ramp 1@/);
  });

  it('a jingle or a stop puts the level back too', () => {
    const { audio, fade } = setup();
    audio.playMusic('tune');
    audio.fadeOutMusic(0.5);
    audio.stopMusic();
    expect(fade.value).toBe(1);
    audio.playMusic('tune');
    audio.fadeOutMusic(0.5);
    fade.value = 0;
    audio.playJingle('other');
    expect(fade.value).toBe(1);
  });

  it('is optional on a sink and a no-op before the first unlock', () => {
    expect(NULL_AUDIO.fadeOutMusic).toBeUndefined();
    expect(() => new AudioManager().fadeOutMusic(1)).not.toThrow();
  });
});

// Both fades (0.4.49): the start fade-in (Apu.startFade, audio-start-fade.test.ts) is its own
// stage after the music volume, in series with this page fade, so neither stomps the other.
describe('the page fade with the start fade-in', () => {
  it('the music runs through both, in series: page fade, music volume, start fade-in, master', () => {
    const apu = new Apu(new FakeContext() as unknown as BaseAudioContext);
    expect((apu.musicFade as unknown as Node).out).toEqual([apu.musicGain]);
    expect((apu.musicGain as unknown as Node).out).toEqual([apu.startFade]);
    expect((apu.startFade as unknown as Node).out).toEqual([apu.master]);
    expect((apu.sfxGain as unknown as Node).out).toEqual([apu.master]);
  });

  it('a page-slide fade during the start fade-in still ends at full volume on the new song', () => {
    const { audio, apu, fade, ctx } = setup(); // the first press at t=2: the fade-in starts
    const start = apu.startFade.gain as unknown as Param;
    const fadeIn = ['cancel@2', 'set 0@2', `ramp 1@${2 + MUSIC_FADE_IN_S}`];
    expect(start.calls).toEqual(fadeIn);
    audio.playMusic('tune');
    ctx.currentTime = 2.4; // halfway up, the map slides to the next page
    audio.fadeOutMusic(0.5);
    ctx.currentTime = 2.9;
    audio.playMusic('other'); // the next page's song
    // The page fade is back at full for the new song...
    expect(fade.value).toBe(1);
    expect(fade.calls.at(-1)).toBe('set 1@2.9');
    // ...and the fade-in was never cut short: it still rises to full, where it stays.
    expect(start.calls).toEqual(fadeIn);
    expect(start.calls.at(-1)).toMatch(/^ramp 1@/);
    // Neither fade touched the volume or mute.
    expect(apu.musicGain.gain.value).toBe(1);
    expect(apu.master.gain.value).toBeCloseTo(0.2);
  });

  it('sound coming back from the background mid page fade: the fade-in leaves the page fade alone', () => {
    const { audio, apu, fade, ctx } = setup();
    audio.playMusic('tune');
    audio.fadeOutMusic(0.5);
    const page = [...fade.calls];
    ctx.state = 'interrupted';
    ctx.currentTime = 10;
    audio.wake();
    expect(fade.calls).toEqual(page);
    expect((apu.startFade.gain as unknown as Param).calls.slice(-2)).toEqual([
      'set 0@10',
      `ramp 1@${10 + MUSIC_FADE_IN_S}`,
    ]);
  });
});
