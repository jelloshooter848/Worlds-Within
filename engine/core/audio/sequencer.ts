import type { MusicVoices, Voice } from './apu';
import { PPQ, type CompiledSong, type NoteEvent, type Track } from './mml';

const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;

interface Cursor {
  track: Track;
  voice: Voice;
  index: number;
  /** Audio time of tick `offsetTick` for the current pass. */
  passStart: number;
  offsetTick: number;
  done: boolean;
}

/** One layer of a layered song: its compiled song and the voices it plays on (Engine 0.16 T8). */
export interface SequencerLayer {
  song: CompiledSong;
  voices: MusicVoices;
}

/**
 * Schedules note events ahead of the audio clock ("a tale of two clocks"), independent of the
 * game loop so music stays smooth when frames hitch.
 */
export class Sequencer {
  private cursors: Cursor[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private song: CompiledSong | null = null;
  /** The layers of a layered song playing now (`playLayers`), else null. */
  private layers: readonly SequencerLayer[] | null = null;
  tempoScale = 1;
  onEnd: (() => void) | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly voices: { pulse1: Voice; pulse2: Voice; triangle: Voice; noise: Voice },
  ) {}

  get playing(): CompiledSong | null {
    return this.song;
  }

  private tickSeconds(): number {
    const bpm = (this.song?.bpm ?? 120) * this.tempoScale;
    return 60 / bpm / PPQ;
  }

  /**
   * Play `song` from audio time `at`; `fromLoop` (0.4.72): from its loop point, as its second
   * pass would (a track with nothing from there on starts at its beginning).
   */
  play(song: CompiledSong, at = this.ctx.currentTime + 0.05, fromLoop = false): void {
    this.stop();
    this.song = song;
    this.addCursors(song, this.voices, at, fromLoop);
    this.start();
  }

  /**
   * Plays a layered song (Engine 0.16 T8): every layer's tracks start at the same audio time `at`
   * and are scheduled by this one clock at the first layer's tempo, so a note on tick n of any
   * layer sounds at exactly `at + n * tickSeconds`: the layers stay sample-aligned, loop after
   * loop (`validate` keeps their tempo and length equal). Each layer plays on its own voices, whose
   * gain the mixer sets.
   */
  playLayers(layers: readonly SequencerLayer[], at = this.ctx.currentTime + 0.05): void {
    this.stop();
    const first = layers[0];
    if (first === undefined) return;
    this.song = first.song;
    this.layers = layers;
    for (const l of layers) this.addCursors(l.song, l.voices, at, false);
    this.start();
  }

  private addCursors(song: CompiledSong, voices: Sequencer['voices'], at: number, fromLoop: boolean): void {
    const t = song.tracks;
    const add = (track: Track | undefined, voice: Voice) => {
      if (track && track.events.length) {
        const from = fromLoop && song.loop ? track.events.findIndex((e) => e.tick >= track.loopTick) : -1;
        const index = Math.max(0, from);
        const offsetTick = from >= 0 ? track.loopTick : 0;
        this.cursors.push({ track, voice, index, passStart: at, offsetTick, done: false });
      }
    };
    add(t.pulse1, voices.pulse1);
    add(t.pulse2, voices.pulse2);
    add(t.triangle, voices.triangle);
    add(t.noise, voices.noise);
  }

  private start(): void {
    this.schedule();
    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.cursors) c.voice.stop();
    this.cursors = [];
    this.song = null;
    this.layers = null;
  }

  /** Restart the current song at a new tempo scale (used by the hurry-up music). */
  setTempoScale(scale: number): void {
    if (scale === this.tempoScale) return;
    this.tempoScale = scale;
    const layers = this.layers;
    const s = this.song;
    if (layers) this.playLayers(layers);
    else if (s) this.play(s);
  }

  private schedule(): void {
    const song = this.song;
    if (!song) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD_S;
    const tickS = this.tickSeconds();
    let allDone = true;
    for (const c of this.cursors) {
      if (c.done) continue;
      allDone = false;
      while (true) {
        const ev = c.track.events[c.index];
        if (!ev) {
          // End of the track for this pass.
          if (!song.loop) {
            c.done = true;
            break;
          }
          c.passStart += (c.track.length - c.offsetTick) * tickS;
          c.offsetTick = c.track.loopTick;
          c.index = c.track.events.findIndex((e) => e.tick >= c.track.loopTick);
          if (c.index < 0) {
            c.done = true;
            break;
          }
          continue;
        }
        const at = c.passStart + (ev.tick - c.offsetTick) * tickS;
        if (at > horizon) break;
        this.emit(c.voice, ev, at, tickS);
        c.index++;
      }
    }
    if (allDone && this.cursors.length) {
      const cb = this.onEnd;
      this.stop();
      cb?.();
    }
  }

  private emit(voice: Voice, ev: NoteEvent, at: number, tickS: number): void {
    if (ev.note === null) return;
    const dur = Math.max(0.005, ev.gate * tickS - 0.002);
    voice.note(ev.note, at, dur, {
      vol: ev.vol,
      duty: ev.duty as 0 | 1 | 2 | 3,
      decay: ev.decay,
      slide: ev.slide,
    });
  }
}

/** Fire-and-forget scheduling for a short effect on the SFX voices. */
export function scheduleOnce(
  ctx: BaseAudioContext,
  tracks: { track: Track; voice: Voice }[],
  bpm: number,
  at = ctx.currentTime + 0.01,
): number {
  const tickS = 60 / bpm / PPQ;
  let end = at;
  for (const { track, voice } of tracks) {
    voice.stop(at);
    for (const ev of track.events) {
      if (ev.note === null) continue;
      const t = at + ev.tick * tickS;
      const dur = Math.max(0.005, ev.gate * tickS - 0.002);
      voice.note(ev.note, t, dur, {
        vol: ev.vol,
        duty: ev.duty as 0 | 1 | 2 | 3,
        decay: ev.decay,
        slide: ev.slide,
      });
      end = Math.max(end, t + dur);
    }
  }
  return end;
}
