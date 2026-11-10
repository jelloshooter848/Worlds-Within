import { Apu } from './apu';
import { compileSong, parseMml, type CompiledSong, type Sfx, type Song, type Track } from './mml';
import { Sequencer, scheduleOnce } from './sequencer';
import type { MusicEntry } from './mix';
import { DEFAULT_MASTER } from '../save/settings';

/**
 * How long the music takes to fade in when sound starts (the first press) or comes back after the
 * browser stopped it (0.4.49): no blast at full volume. Sound effects are not faded.
 */
export const MUSIC_FADE_IN_S = 1.2;

/** The game talks to audio through this so the headless sim can pass a no-op. */
export interface AudioSink {
  /** 'off' until unlocked, then the AudioContext state ('running', 'suspended', 'interrupted'...). */
  readonly state?: string;
  /**
   * Play a looping song. `fadeIn` (seconds, BUG-12): it rises from silence through the music fade
   * (as fadeOutMusic's, so volume and mute are untouched); the same song already playing rises
   * back from where it is, never restarted. Without it the song starts at full level.
   * `fromLoop` (0.4.72): a new song starts at its loop point (`L`), skipping its intro (the REMIX
   * theme's fanfare on the way back from CLASSIC). A song from an asset pack's audio file, or one
   * with no loop point, starts at its beginning.
   */
  playMusic(id: string, fadeIn?: number, fromLoop?: boolean): void;
  stopMusic(): void;
  /**
   * Fade the music out to silence over `seconds` (the world map's page changes). The next
   * playMusic, playJingle or stopMusic puts the level back; volume and mute are untouched.
   */
  fadeOutMusic?(seconds: number): void;
  /**
   * BUG-12: a crossfade to song `id`: the song playing fades out over `out` seconds, then `id`
   * starts and rises over `fadeIn`. The same song already playing just comes back up (never
   * restarted); with nothing playing it starts at once with its fade-in. Any playMusic,
   * playJingle, stopMusic or fadeOutMusic before the switch cancels it, so a fade never leaves
   * the music silent or two songs going. Returns the seconds until `id` starts (0: at once).
   */
  crossfadeMusic?(id: string, out: number, fadeIn: number): number;
  /** BUG-13: start (or resume) sound from a press the browser may not see as a gesture (a pad). */
  unlock?(): void;
  /**
   * BUG-13: the sound that is starting now plays at full level at once, without the 1.2 s
   * sound-start fade (MUSIC_FADE_IN_S): the start gate's rift intro is meant to be heard.
   */
  skipStartFade?(): void;
  /** Play a non-looping jingle; the previous music is not resumed automatically. */
  playJingle(id: string, onEnd?: () => void): void;
  /** Plays a sound effect; `opts` (Engine 0.16 T8) shifts its pitch, scales its volume or puts it on the UI bus. */
  sfx(id: string, opts?: SfxOptions): void;
  setTempoScale(scale: number): void;
  pause(): void;
  resume(): void;
  /**
   * Classic mode's music sets (0.5.0, G-060): every playMusic / playJingle id goes through `map`
   * first (null from it: silence). Null removes the map. Without one every id plays as given.
   */
  setMusicMap?(map: MusicMap | null): void;
}

/** How one play of a sound effect is varied (Engine 0.16 T8; the mixer draws these). */
export interface SfxOptions {
  /** Semitones up (down when negative); a noise channel moves one period step per semitone, rounded. */
  pitch?: number;
  /** A factor on every note's volume (0..1). */
  volume?: number;
  /** The bus it plays on: `sfx` (default) or `ui` (menus and dialogs, its own voices). */
  bus?: 'sfx' | 'ui';
}

/** The music levels the mixer last set (Engine 0.16 T8), for tests and the step hook. */
export interface MixLevels {
  /** The layered song playing, or null. */
  song: string | null;
  /** Each layer's level. */
  layers: Record<string, number>;
  /** The duck's factor on the music (1: none). */
  duck: number;
}

/** A song id to the song to play in its place (null: none). */
export type MusicMap = (id: string) => string | null;

export const NULL_AUDIO: AudioSink = {
  playMusic() {},
  stopMusic() {},
  playJingle(_id, onEnd) {
    onEnd?.();
  },
  sfx() {},
  setTempoScale() {},
  pause() {},
  resume() {},
};

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

interface CompiledSfx {
  bpm: number;
  pulse?: Track;
  pulse2?: Track;
  noise?: Track;
  triangle?: Track;
}

/**
 * Lazily creates the AudioContext on the first user gesture (browsers block autoplay) and owns
 * the song/sfx libraries. Everything before unlock() is a silent no-op.
 */
export class AudioManager implements AudioSink {
  private ctx: AudioContext | null = null;
  private apu: Apu | null = null;
  private seq: Sequencer | null = null;
  private readonly songs = new Map<string, Song>();
  private readonly compiled = new Map<string, CompiledSong>();
  private readonly sfxLib = new Map<string, Sfx>();
  private readonly sfxCompiled = new Map<string, CompiledSfx>();
  private pendingMusic: string | null = null;
  private currentMusic: string | null = null;
  private volumes: Volumes = { master: DEFAULT_MASTER, music: 1, sfx: 1, muted: false };
  private tempoScale = 1;
  /** Audio files from asset packs that replace synthesized songs/sfx by id. */
  private readonly overrides = new Map<string, Blob>();
  private readonly decoded = new Map<string, AudioBuffer>();
  private fileMusic: AudioBufferSourceNode | null = null;
  /** AudioSink.setMusicMap's map, or null. */
  private musicMap: MusicMap | null = null;
  /** Layered songs by id (a skin's `music` section, Engine 0.16 T8). */
  private readonly layered = new Map<string, MusicEntry>();
  /** The levels the mixer set; applied to the layer gains as they are made. */
  private levels: MixLevels = { song: null, layers: {}, duck: 1 };

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  get state(): string {
    return this.ctx ? this.ctx.state : 'off';
  }

  private silentElement: HTMLAudioElement | null = null;

  /**
   * iOS mutes Web Audio while the ring/silent switch is on unless the page has played an HTML5
   * audio element inside a user gesture, which switches the audio session to "playback".
   * Plays a tiny silent WAV once; harmless everywhere else.
   */
  private kickMediaSession(): void {
    if (this.silentElement || typeof document === 'undefined') return;
    try {
      const el = document.createElement('audio');
      el.setAttribute('playsinline', '');
      el.setAttribute('x-webkit-airplay', 'deny');
      el.preload = 'auto';
      el.loop = false;
      el.src = silentWavDataUri();
      el.volume = 0.01;
      this.silentElement = el;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  /** The classic iOS unlock: start an empty buffer inside the gesture. */
  private playSilentBuffer(): void {
    if (!this.ctx) return;
    try {
      const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
  }

  registerSongs(songs: Song[]): void {
    for (const s of songs) this.songs.set(s.id, s);
  }
  registerSfx(list: Sfx[]): void {
    for (const s of list) this.sfxLib.set(s.id, s);
  }

  /**
   * Registers layered songs (a skin's `music` section, Engine 0.16 T8): `playMusic(id)` of one
   * starts all its layer songs together, in step, each on its own voices at the level the mixer
   * last set (`setLayerGains`; 1 before it does).
   */
  registerMusic(music: Readonly<Record<string, MusicEntry>>): void {
    for (const [id, entry] of Object.entries(music)) this.layered.set(id, entry);
  }

  /** The levels the mixer last set (copied). */
  mixLevels(): MixLevels {
    return { song: this.levels.song, layers: { ...this.levels.layers }, duck: this.levels.duck };
  }

  /**
   * Sets the layer levels (0..1, by layer name; the mixer's `LayerMix`) of the layered song
   * playing, each ramped over one 60 Hz frame so a crossfade is smooth; kept for a layered song
   * still to start (it starts at them). Names the song lacks are ignored.
   */
  setLayerGains(gains: Readonly<Record<string, number>>): void {
    this.levels.layers = { ...this.levels.layers, ...gains };
    const entry = this.levels.song === null ? undefined : this.layered.get(this.levels.song);
    if (entry === undefined) return;
    if (!this.ctx || !this.apu) return;
    Object.keys(entry.layers).forEach((layer, i) => {
      const v = this.levels.layers[layer];
      if (v !== undefined) this.rampTo(this.apu!.layer(i).gain.gain, v);
    });
  }

  /**
   * Sets the music's duck factor (1: none; the mixer's `DuckEnvelope`): the music bus plays at
   * the player's music volume times it, ramped over one frame. The stored volume is untouched.
   */
  setDuck(factor: number): void {
    if (factor === this.levels.duck) return;
    this.levels.duck = factor;
    if (this.apu) this.rampTo(this.apu.musicGain.gain, this.volumes.music * factor);
  }

  private rampTo(param: AudioParam, value: number): void {
    const now = this.ctx!.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + 1 / 60);
  }

  /** Replace the set of file overrides (from enabled asset packs). */
  setOverrides(files: Map<string, Blob>): void {
    this.overrides.clear();
    this.decoded.clear();
    for (const [k, v] of files) this.overrides.set(k, v);
  }

  private async buffer(id: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const hit = this.decoded.get(id);
    if (hit) return hit;
    const blob = this.overrides.get(id);
    if (!blob) return null;
    try {
      const buf = await this.ctx.decodeAudioData(await blob.arrayBuffer());
      this.decoded.set(id, buf);
      return buf;
    } catch {
      console.warn(`asset pack audio "${id}" could not be decoded`);
      this.overrides.delete(id);
      return null;
    }
  }

  private stopFileMusic(): void {
    if (this.fileMusic) {
      try {
        this.fileMusic.stop();
      } catch {
        /* already stopped */
      }
      this.fileMusic = null;
    }
  }

  /** Start a file-backed song; returns false when there is no override for it. */
  private playFile(id: string, loop: boolean, onEnd?: () => void): boolean {
    if (!this.ctx || !this.apu || !this.overrides.has(id)) return false;
    const ctx = this.ctx;
    const apu = this.apu;
    const token = (this.fileToken = (this.fileToken ?? 0) + 1);
    void this.buffer(id).then((buf) => {
      if (!buf || token !== this.fileToken) return;
      this.stopFileMusic();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      src.playbackRate.value = this.tempoScale;
      src.connect(apu.musicFade);
      src.onended = () => {
        if (this.fileMusic === src) this.fileMusic = null;
        if (!loop) onEnd?.();
      };
      src.start();
      this.fileMusic = src;
    });
    return true;
  }
  private fileToken = 0;

  /** Call from a user gesture handler. Safe to call repeatedly (also recovers from iOS interruptions). */
  unlock(): void {
    if (this.ctx) {
      // Back from the background (wake): the whole unlock again, inside this gesture.
      const stale = this.stale;
      this.stale = false;
      if (this.ctx.state !== 'running' || stale) {
        if (this.ctx.state !== 'running') {
          void this.ctx.resume().catch(() => undefined);
          if (!this.paused) this.fadeInMusic();
        }
        this.playSilentBuffer();
        if (stale) this.replayMediaSession();
      }
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.kickMediaSession();
    this.ctx = new Ctor();
    this.apu = new Apu(this.ctx);
    this.seq = new Sequencer(this.ctx, this.apu.voices);
    this.applyVolumes();
    this.fadeInMusic();
    this.playSilentBuffer();
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (
          document.visibilityState === 'visible' &&
          this.ctx &&
          this.ctx.state !== 'running' &&
          !this.paused
        ) {
          void this.ctx.resume().catch(() => undefined);
          this.fadeInMusic();
        }
      });
    }
    if (this.pendingMusic) {
      const id = this.pendingMusic;
      this.pendingMusic = null;
      this.playMusic(id);
    }
  }
  private paused = false;
  /** The app has been in the background since the last gesture (wake). */
  private stale = false;

  /**
   * The page is back from the background (main.ts: visibilitychange, pageshow, focus), as when
   * the Home Screen app is reopened (0.4.44). iOS interrupts the context meanwhile, and may hand
   * it back "running" but silent: resume at once if allowed, and redo the whole unlock on the
   * next tap or key. A game paused on purpose stays paused.
   */
  wake(): void {
    if (!this.ctx || this.paused) return;
    this.stale = true;
    if (this.ctx.state !== 'running') {
      void this.ctx.resume().catch(() => undefined);
      this.fadeInMusic();
    }
  }

  /** The music rises from silence over MUSIC_FADE_IN_S (Apu.startFade); sound effects don't. */
  private fadeInMusic(): void {
    if (!this.ctx || !this.apu) return;
    // The start gate's sound is still starting (skipStartFade): the same start's later events
    // (pointerup, touchend, click) must not fade it in after all.
    if (this.fullStart) return;
    const g = this.apu.startFade.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1, t + MUSIC_FADE_IN_S);
  }

  skipStartFade(): void {
    if (!this.ctx || !this.apu) return;
    const g = this.apu.startFade.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    if (this.ctx.state === 'running') return;
    this.fullStart = true;
    const done = () => {
      this.fullStart = false;
    };
    void this.ctx.resume().then(done, done);
  }
  /** skipStartFade's start is still under way (the context not running yet). */
  private fullStart = false;

  /** Plays the silent element again: iOS's audio session back to "playback" (kickMediaSession). */
  private replayMediaSession(): void {
    try {
      const p = this.silentElement?.play();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  setVolumes(v: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.apu) return;
    const v = this.volumes;
    this.apu.master.gain.value = v.muted ? 0 : v.master * 0.5;
    const music = this.apu.musicGain.gain;
    if (this.ctx) music.cancelScheduledValues(this.ctx.currentTime);
    music.value = v.music * this.levels.duck;
    this.apu.sfxGain.gain.value = v.sfx;
    this.apu.uiGain.gain.value = v.sfx;
  }

  /** The volumes now (master, music, sfx, mute), for the mixer's buses. */
  get volumeLevels(): Volumes {
    return { ...this.volumes };
  }

  private song(id: string): CompiledSong | null {
    const c = this.compiled.get(id);
    if (c) return c;
    const s = this.songs.get(id);
    if (!s) {
      console.warn(`unknown song "${id}"`);
      return null;
    }
    const cs = compileSong(s);
    this.compiled.set(id, cs);
    return cs;
  }

  setMusicMap(map: MusicMap | null): void {
    this.musicMap = map;
  }

  playMusic(asked: string, fadeIn = 0, fromLoop = false): void {
    this.cancelCrossfade();
    const id = this.musicMap ? this.musicMap(asked) : asked;
    if (id === null) return this.stopMusic();
    if (!this.seq) {
      this.pendingMusic = id;
      return;
    }
    if (this.currentMusic === id && (this.seq.playing || this.fileMusic)) {
      this.unfade(fadeIn > 0 ? fadeIn : 0.05); // mid-fade: the same song comes back up
      return;
    }
    this.seq.stop();
    this.stopFileMusic();
    this.unfade();
    if (fadeIn > 0) this.riseFromSilence(fadeIn);
    this.currentMusic = id;
    this.levels.song = null;
    if (this.layered.has(id)) return this.playLayered(id);
    if (this.playFile(id, true)) return;
    const s = this.song(id);
    if (!s) return;
    this.seq.onEnd = null;
    this.seq.tempoScale = this.tempoScale;
    this.seq.play(s, undefined, fromLoop);
  }

  /** Starts every layer of a layered song at one audio time, each at its set level. */
  private playLayered(id: string): void {
    const entry = this.layered.get(id)!;
    const apu = this.apu!;
    const layers = Object.entries(entry.layers).flatMap(([layer, songId], i) => {
      const song = this.song(songId);
      if (!song) return [];
      const { voices, gain } = apu.layer(i);
      gain.gain.cancelScheduledValues(this.ctx!.currentTime);
      gain.gain.value = this.levels.layers[layer] ?? 1;
      return [{ song, voices }];
    });
    this.levels = { song: id, layers: this.levels.layers, duck: this.levels.duck };
    this.seq!.onEnd = null;
    this.seq!.tempoScale = this.tempoScale;
    this.seq!.playLayers(layers);
  }

  stopMusic(): void {
    this.cancelCrossfade();
    this.pendingMusic = null;
    this.currentMusic = null;
    this.levels.song = null;
    this.fileToken++;
    this.seq?.stop();
    this.stopFileMusic();
    this.unfade();
  }

  fadeOutMusic(seconds: number): void {
    this.cancelCrossfade();
    if (!this.ctx || !this.apu) return;
    const g = this.apu.musicFade.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + Math.max(0.01, seconds));
  }

  crossfadeMusic(asked: string, out: number, fadeIn: number): number {
    const id = this.musicMap ? this.musicMap(asked) : asked;
    const playing = this.currentMusic !== null && (!!this.seq?.playing || this.fileMusic !== null);
    // Before the first unlock, with nothing playing, or onto the song already playing: no gap.
    if (!this.seq || !playing || id === null || id === this.currentMusic || out <= 0) {
      this.playMusic(asked, fadeIn);
      return 0;
    }
    this.fadeOutMusic(out);
    const token = this.crossToken;
    this.crossTimer = setTimeout(() => {
      this.crossTimer = null;
      if (token === this.crossToken) this.playMusic(asked, fadeIn);
    }, out * 1000);
    return out;
  }

  /** A crossfade's switch still to come (crossfadeMusic) is called off. */
  private cancelCrossfade(): void {
    this.crossToken++;
    if (this.crossTimer !== null) clearTimeout(this.crossTimer);
    this.crossTimer = null;
  }
  private crossToken = 0;
  private crossTimer: ReturnType<typeof setTimeout> | null = null;

  /** The music fade from silence to full over `seconds` (a new song's fade-in, BUG-12). */
  private riseFromSilence(seconds: number): void {
    if (!this.ctx || !this.apu) return;
    const g = this.apu.musicFade.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(1, now + seconds);
  }

  /** The music fade back to full: at once (the voices are silent), or over `ramp` seconds. */
  private unfade(ramp = 0): void {
    if (!this.ctx || !this.apu) return;
    const g = this.apu.musicFade.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    if (ramp > 0) {
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(1, now + ramp);
    } else g.setValueAtTime(1, now);
  }

  playJingle(asked: string, onEnd?: () => void): void {
    this.cancelCrossfade();
    const id = this.musicMap ? this.musicMap(asked) : asked;
    if (id === null) this.stopMusic();
    if (!this.seq || id === null) {
      onEnd?.();
      return;
    }
    this.currentMusic = null;
    this.levels.song = null;
    this.seq.stop();
    this.stopFileMusic();
    this.unfade();
    if (this.playFile(id, false, onEnd)) return;
    const s = this.song(id);
    if (!s) {
      onEnd?.();
      return;
    }
    this.seq.tempoScale = 1;
    this.seq.onEnd = onEnd ?? null;
    this.seq.play({ ...s, loop: false });
  }

  setTempoScale(scale: number): void {
    this.tempoScale = scale;
    this.seq?.setTempoScale(scale);
    if (this.fileMusic) this.fileMusic.playbackRate.value = scale;
  }

  sfx(id: string, opts: SfxOptions = {}): void {
    if (!this.ctx || !this.apu) return;
    const ui = opts.bus === 'ui';
    const pitch = opts.pitch ?? 0;
    const volume = opts.volume ?? 1;
    if (this.overrides.has(id)) {
      const ctx = this.ctx;
      const apu = this.apu;
      void this.buffer(id).then((buf) => {
        if (!buf) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = Math.pow(2, pitch / 12);
        const out = ui ? apu.uiGain : apu.sfxGain;
        if (volume === 1) src.connect(out);
        else {
          const g = ctx.createGain();
          g.gain.value = volume;
          src.connect(g);
          g.connect(out);
        }
        src.start();
      });
      return;
    }
    let c = this.sfxCompiled.get(id);
    if (!c) {
      const def = this.sfxLib.get(id);
      if (!def) {
        console.warn(`unknown sfx "${id}"`);
        return;
      }
      c = { bpm: def.bpm ?? 150 };
      if (def.pulse) c.pulse = parseMml(def.pulse, 'pulse');
      if (def.pulse2) c.pulse2 = parseMml(def.pulse2, 'pulse');
      if (def.noise) c.noise = parseMml(def.noise, 'noise');
      if (def.triangle) c.triangle = parseMml(def.triangle, 'triangle');
      this.sfxCompiled.set(id, c);
    }
    const v = this.apu.voices;
    const tracks: { track: Track; voice: typeof v.sfxPulse }[] = [];
    const tone = (t: Track) => varied(t, pitch, volume);
    const noise = (t: Track) => varied(t, -Math.round(pitch), volume);
    if (c.pulse) tracks.push({ track: tone(c.pulse), voice: ui ? v.uiPulse : v.sfxPulse });
    if (c.pulse2) tracks.push({ track: tone(c.pulse2), voice: ui ? v.uiPulse2 : v.sfxPulse2 });
    if (c.noise) tracks.push({ track: noise(c.noise), voice: ui ? v.uiNoise : v.sfxNoise });
    if (c.triangle) tracks.push({ track: tone(c.triangle), voice: ui ? v.uiTriangle : v.sfxTriangle });
    scheduleOnce(this.ctx, tracks, c.bpm);
  }

  pause(): void {
    this.paused = true;
    void this.ctx?.suspend();
  }
  resume(): void {
    this.paused = false;
    void this.ctx?.resume().catch(() => undefined);
  }
}

/**
 * A track with every note moved `shift` (semitones; noise period steps) and every volume scaled
 * by `volume`; the track itself when neither changes anything.
 */
function varied(track: Track, shift: number, volume: number): Track {
  if (shift === 0 && volume === 1) return track;
  return {
    ...track,
    events: track.events.map((e) => ({
      ...e,
      note: e.note === null ? null : e.note + shift,
      vol: e.vol * volume,
    })),
  };
}

/** A 50 ms, 8 kHz, 8-bit mono silent WAV as a data URI (built at runtime, so no binary in the repo). */
function silentWavDataUri(): string {
  const samples = 400;
  const bytes = new Uint8Array(44 + samples);
  const str = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) bytes[o + i] = t.charCodeAt(i);
  };
  const u32 = (o: number, v: number) => {
    bytes[o] = v & 255;
    bytes[o + 1] = (v >> 8) & 255;
    bytes[o + 2] = (v >> 16) & 255;
    bytes[o + 3] = (v >>> 24) & 255;
  };
  const u16 = (o: number, v: number) => {
    bytes[o] = v & 255;
    bytes[o + 1] = (v >> 8) & 255;
  };
  str(0, 'RIFF');
  u32(4, 36 + samples);
  str(8, 'WAVE');
  str(12, 'fmt ');
  u32(16, 16);
  u16(20, 1); // PCM
  u16(22, 1); // mono
  u32(24, 8000);
  u32(28, 8000);
  u16(32, 1);
  u16(34, 8);
  str(36, 'data');
  u32(40, samples);
  bytes.fill(128, 44);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'data:audio/wav;base64,' + btoa(bin);
}
