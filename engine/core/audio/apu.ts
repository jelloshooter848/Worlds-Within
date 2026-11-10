import { midiToHz } from './mml';

export type Duty = 0 | 1 | 2 | 3;
const DUTY_FRACTION: Record<Duty, number> = { 0: 0.125, 1: 0.25, 2: 0.5, 3: 0.75 };
const HARMONICS = 48;
/** NES noise periods in CPU cycles (NTSC); index 0 is the highest pitch. */
const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const CPU_HZ = 1789773;

export interface NoteOptions {
  vol: number; // 0-15
  duty?: Duty;
  decay?: boolean;
  slide?: number; // semitones
}

export interface Voice {
  /** Schedule a note starting at `at` (AudioContext time) lasting `dur` seconds. `pitch` is MIDI for
   * pulse/triangle and a 0-15 period index for noise. */
  note(pitch: number, at: number, dur: number, opts: NoteOptions): void;
  /** Silence immediately (or at `at`). */
  stop(at?: number): void;
  readonly gain: GainNode;
}

function makePulseWave(ctx: BaseAudioContext, duty: Duty): PeriodicWave {
  const f = DUTY_FRACTION[duty];
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  for (let k = 1; k <= HARMONICS; k++) {
    // Fourier series of a pulse with duty f (DC removed)
    real[k] = Math.sin(2 * Math.PI * k * f) / (k * Math.PI);
    imag[k] = (1 - Math.cos(2 * Math.PI * k * f)) / (k * Math.PI);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

class OscVoice implements Voice {
  readonly gain: GainNode;
  private readonly osc: OscillatorNode;
  private currentDuty: Duty | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly waves: Record<Duty, PeriodicWave> | null,
    out: AudioNode,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.osc = ctx.createOscillator();
    if (waves) this.osc.setPeriodicWave(waves[2]);
    else this.osc.type = 'triangle';
    this.osc.connect(this.gain);
    this.gain.connect(out);
    this.osc.start();
  }

  note(pitch: number, at: number, dur: number, opts: NoteOptions): void {
    const g = this.gain.gain;
    const f = this.osc.frequency;
    const vol = Math.max(0, Math.min(15, opts.vol)) / 15;
    if (this.waves && opts.duty !== undefined && opts.duty !== this.currentDuty) {
      // Duty changes are rare; switching the wave is not sample-accurate but close enough.
      this.osc.setPeriodicWave(this.waves[opts.duty]);
      this.currentDuty = opts.duty;
    }
    g.cancelScheduledValues(at);
    f.cancelScheduledValues(at);
    f.setValueAtTime(midiToHz(pitch), at);
    if (opts.slide) f.linearRampToValueAtTime(midiToHz(pitch + opts.slide), at + dur);
    g.setValueAtTime(vol, at);
    if (opts.decay) g.linearRampToValueAtTime(0, at + dur);
    else g.setValueAtTime(0, at + dur);
  }

  stop(at = this.ctx.currentTime): void {
    this.gain.gain.cancelScheduledValues(at);
    this.gain.gain.setValueAtTime(0, at);
  }
}

class NoiseVoice implements Voice {
  readonly gain: GainNode;
  private readonly src: AudioBufferSourceNode;
  private readonly baseRate: number;

  constructor(
    private readonly ctx: BaseAudioContext,
    buffer: AudioBuffer,
    out: AudioNode,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    this.src.connect(this.gain);
    this.gain.connect(out);
    this.baseRate = ctx.sampleRate;
    this.src.start();
  }

  note(period: number, at: number, dur: number, opts: NoteOptions): void {
    const idx = Math.max(0, Math.min(15, Math.round(period)));
    const stepHz = CPU_HZ / (NOISE_PERIODS[idx] as number);
    const rate = Math.min(16, stepHz / this.baseRate);
    const g = this.gain.gain;
    g.cancelScheduledValues(at);
    this.src.playbackRate.setValueAtTime(rate, at);
    g.setValueAtTime(Math.max(0, Math.min(15, opts.vol)) / 15, at);
    if (opts.decay) g.linearRampToValueAtTime(0, at + dur);
    else g.setValueAtTime(0, at + dur);
  }

  stop(at = this.ctx.currentTime): void {
    this.gain.gain.cancelScheduledValues(at);
    this.gain.gain.setValueAtTime(0, at);
  }
}

/** 15-bit LFSR noise, one step per sample; playbackRate selects the NES period. */
function makeNoiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let lfsr = 1;
  for (let i = 0; i < len; i++) {
    const bit = (lfsr ^ (lfsr >> 1)) & 1;
    lfsr = (lfsr >> 1) | (bit << 14);
    data[i] = lfsr & 1 ? 0.5 : -0.5;
  }
  return buf;
}

export interface ApuVoices {
  pulse1: Voice;
  pulse2: Voice;
  triangle: Voice;
  noise: Voice;
  /** Dedicated effect voices so SFX never fight the music. */
  sfxPulse: Voice;
  sfxPulse2: Voice;
  sfxNoise: Voice;
  sfxTriangle: Voice;
  /** The UI bus's voices (Engine 0.16 T8): menu sounds never cut a game sound off. */
  uiPulse: Voice;
  uiPulse2: Voice;
  uiNoise: Voice;
  uiTriangle: Voice;
}

/** The four music voices of one song (or of one layer of a layered song). */
export interface MusicVoices {
  pulse1: Voice;
  pulse2: Voice;
  triangle: Voice;
  noise: Voice;
}

/** One layer's voices and the gain the mixer sets its level on (Engine 0.16 T8). */
export interface LayerVoices {
  voices: MusicVoices;
  gain: GainNode;
}

/** A small, NES-flavoured synth: two pulse voices, a triangle and LFSR noise, plus SFX voices. */
export class Apu {
  readonly master: GainNode;
  readonly musicGain: GainNode;
  /** The music voices' fade (AudioManager.fadeOutMusic), ahead of the music volume. */
  readonly musicFade: GainNode;
  readonly sfxGain: GainNode;
  /** The UI bus (Engine 0.16 T8): menu and dialog sounds, at the sfx volume. */
  readonly uiGain: GainNode;
  /**
   * The start fade-in (0.4.49, AudioManager.fadeInMusic), after the music volume: the music
   * rises from silence when sound starts or comes back. Its own stage, so it never fights the
   * page fade (musicFade), the volume sliders or mute.
   */
  readonly startFade: GainNode;
  readonly voices: ApuVoices;

  constructor(readonly ctx: BaseAudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.startFade = ctx.createGain();
    this.startFade.gain.value = 1;
    this.startFade.connect(this.master);
    this.musicGain.connect(this.startFade);
    // The music: voices -> musicFade (page fade) -> musicGain (volume, times the mixer's duck)
    // -> startFade -> master.
    this.musicFade = ctx.createGain();
    this.musicFade.gain.value = 1;
    this.musicFade.connect(this.musicGain);
    this.sfxGain.connect(this.master);
    this.uiGain = ctx.createGain();
    this.uiGain.connect(this.master);
    const waves: Record<Duty, PeriodicWave> = {
      0: makePulseWave(ctx, 0),
      1: makePulseWave(ctx, 1),
      2: makePulseWave(ctx, 2),
      3: makePulseWave(ctx, 3),
    };
    const noise = makeNoiseBuffer(ctx);
    this.waves = waves;
    this.noise = noise;
    const tri = (out: AudioNode) => this.triangleVoice(out);
    this.voices = {
      pulse1: new OscVoice(ctx, waves, this.musicFade),
      pulse2: new OscVoice(ctx, waves, this.musicFade),
      triangle: tri(this.musicFade),
      noise: new NoiseVoice(ctx, noise, this.musicFade),
      sfxPulse: new OscVoice(ctx, waves, this.sfxGain),
      sfxPulse2: new OscVoice(ctx, waves, this.sfxGain),
      sfxNoise: new NoiseVoice(ctx, noise, this.sfxGain),
      sfxTriangle: tri(this.sfxGain),
      uiPulse: new OscVoice(ctx, waves, this.uiGain),
      uiPulse2: new OscVoice(ctx, waves, this.uiGain),
      uiNoise: new NoiseVoice(ctx, noise, this.uiGain),
      uiTriangle: tri(this.uiGain),
    };
  }

  private readonly waves: Record<Duty, PeriodicWave>;
  private readonly noise: AudioBuffer;
  private readonly layerSets: LayerVoices[] = [];

  private triangleVoice(out: AudioNode): Voice {
    const v = new OscVoice(this.ctx, null, out);
    v.gain.gain.value = 0;
    return v;
  }

  /**
   * The voices of layer `index` of a layered song (Engine 0.16 T8): four music voices of its own
   * through its own level gain into the page fade, made the first time a song has that many
   * layers and kept (silent) after.
   */
  layer(index: number): LayerVoices {
    while (this.layerSets.length <= index) {
      const gain = this.ctx.createGain();
      gain.gain.value = 1;
      gain.connect(this.musicFade);
      this.layerSets.push({
        gain,
        voices: {
          pulse1: new OscVoice(this.ctx, this.waves, gain),
          pulse2: new OscVoice(this.ctx, this.waves, gain),
          triangle: this.triangleVoice(gain),
          noise: new NoiseVoice(this.ctx, this.noise, gain),
        },
      });
    }
    return this.layerSets[index]!;
  }

  stopAll(): void {
    for (const v of Object.values(this.voices)) v.stop();
    for (const l of this.layerSets) for (const v of Object.values(l.voices)) v.stop();
  }
}
