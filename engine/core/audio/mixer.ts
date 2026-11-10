import type { MixLevels, SfxOptions, Volumes } from './audio-manager';
import {
  DIALOG_DUCK,
  DuckEnvelope,
  LayerMix,
  SoundPicker,
  type DuckSpec,
  type MixStatus,
  type MusicEntry,
  type SoundCue,
} from './mix';

/**
 * The audio mixer (Engine 0.16 part A, T8): buses, layered music mixed from game state, varied
 * sound effects and ducking, on top of the `AudioManager` and the player's stored volumes.
 *
 * - **Buses:** master, music, sfx and ui. The manager's gains are the buses (`Apu.master`,
 *   `musicGain`, `sfxGain`, `uiGain`), set from the stored volumes (`setVolumes`; the ui bus
 *   follows the sfx volume); `state().buses` reads them back.
 * - **Layered music:** `play(id)` of a skin `music` entry starts its layers together; each
 *   `tick()` runs its `LayerMix` on the last status `status(frame.status)` gave and sets the layer
 *   levels. Any other id plays as an ordinary song.
 * - **Sound effects:** `sound(id, cue?)` draws the cue's pitch and volume (`SoundPicker`: fxRng per
 *   seed, frame and sound; a sound still cooling down is dropped) and starts its duck;
 *   `uiSound(id)` plays on the ui bus.
 * - **Ducking:** a sound's `duck` and `dialog(open)` (a dialog box on screen, `DIALOG_DUCK`) feed
 *   one `DuckEnvelope`, applied each tick to the music's duck gain.
 *
 * The shell's boot makes one per page with audio and ticks it once per loop step (held steps too,
 * so a duck releases through a hit-pause). Presentation only: no headless run makes one, and
 * nothing here reaches a world, a frame or a hash.
 */

/** What the mixer drives: the `AudioManager`'s side of it. */
export interface MixerAudio {
  playMusic(id: string): void;
  sfx(id: string, opts?: SfxOptions): void;
  setLayerGains(gains: Readonly<Record<string, number>>): void;
  /** The music's duck factor (1: none); called every tick, so it should skip an unchanged one. */
  setDuck(factor: number): void;
  readonly volumeLevels: Volumes;
}

export interface MixerOptions {
  audio: MixerAudio;
  /** The layered songs (a skin's `music` section). */
  music?: Readonly<Record<string, MusicEntry>>;
  /** The seed sound variation draws from (`fxRng`; default 0). */
  seed?: number;
  /** The duck under a dialog box (default `DIALOG_DUCK`). */
  dialogDuck?: DuckSpec;
}

/** The mixer now, for tests and the step hook (`__ww.mix()`). */
export interface MixerState extends MixLevels {
  /** Ticks run. */
  tick: number;
  /** The mix rule holding now (its index; -1 none or no layered song). */
  rule: number;
  /** Whether a dialog box ducks the music. */
  dialog: boolean;
  /** The bus levels: master (0 when muted), music, sfx, ui. */
  buses: { master: number; music: number; sfx: number; ui: number };
  /** Sounds played and dropped (cooling down) so far. */
  sounds: { played: number; dropped: number };
}

export class Mixer {
  private readonly picker: SoundPicker;
  private readonly duck = new DuckEnvelope();
  private mix: LayerMix | null = null;
  private song: string | null = null;
  private status: MixStatus = {};
  private ticks = 0;
  private dialogOpen = false;
  private played = 0;
  private dropped = 0;

  constructor(private readonly opts: MixerOptions) {
    this.picker = new SoundPicker(opts.seed ?? 0);
  }

  /** Plays a song: a layered one (`music`) mixed from now on, else an ordinary song. */
  play(id: string): void {
    const entry = this.opts.music?.[id];
    this.song = id;
    this.mix = entry === undefined ? null : new LayerMix(entry);
    if (this.mix) this.opts.audio.setLayerGains(this.mix.update(this.status));
    this.opts.audio.playMusic(id);
  }

  /** The status of the frame just presented (the mix rules read it on the next tick). */
  frameStatus(status: MixStatus): void {
    this.status = status;
  }

  /** An event's sound with its cue (a presenter's `onSound`): varied, cooled down, ducking. */
  sound(id: string, cue?: SoundCue): void {
    if (cue === undefined) {
      this.played++;
      this.opts.audio.sfx(id);
      return;
    }
    const play = this.picker.pick(id, cue);
    if (play === null) {
      this.dropped++;
      return;
    }
    this.played++;
    if (play.duck !== undefined) this.duck.trigger(play.duck);
    const opts: SfxOptions = {};
    if (play.pitch !== 0) opts.pitch = play.pitch;
    if (play.volume !== 1) opts.volume = play.volume;
    this.opts.audio.sfx(id, opts);
  }

  /** A UI sound (a menu's move or select, a dialog's typing) on the ui bus. */
  uiSound(id: string): void {
    this.played++;
    this.opts.audio.sfx(id, { bus: 'ui' });
  }

  /** Whether a dialog box is on screen: the music ducks while it is. */
  dialog(open: boolean): void {
    if (open === this.dialogOpen) return;
    this.dialogOpen = open;
    this.duck.sustain('dialog', open ? (this.opts.dialogDuck ?? DIALOG_DUCK) : null);
  }

  /** One loop step: the layer mix and the duck move one tick, and the levels go to the audio. */
  tick(): void {
    this.ticks++;
    if (this.mix) this.opts.audio.setLayerGains(this.mix.update(this.status));
    this.opts.audio.setDuck(this.duck.tick());
  }

  state(): MixerState {
    const v = this.opts.audio.volumeLevels;
    return {
      tick: this.ticks,
      song: this.song,
      rule: this.mix?.ruleIndex ?? -1,
      layers: this.mix?.gains() ?? {},
      duck: this.duck.value,
      dialog: this.dialogOpen,
      buses: { master: v.muted ? 0 : v.master, music: v.music, sfx: v.sfx, ui: v.sfx },
      sounds: { played: this.played, dropped: this.dropped },
    };
  }
}
