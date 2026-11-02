/**
 * A tiny MML (Music Macro Language) dialect compiled to note events. Used for both music and
 * sound effects so every sound in the game is text in the repo.
 *
 *   notes     c d e f g a b, with + or # (sharp) and - (flat), optional length: c8 c4. c16
 *   rest      r, r8
 *   tie       ^ or & after a note extends it by the next length: c4^8
 *   o<n>      octave (0-8); < and > step down / up
 *   l<n>      default length (1,2,4,8,16,32,64 with optional dots)
 *   v<n>      volume 0-15
 *   @<n>      duty 0-3 (pulse channels only; ignored elsewhere)
 *   q<n>      gate 1-8: the fraction of each note that sounds (8 = legato)
 *   x<0|1>    decay envelope off/on (linear fade to silence over the gate)
 *   p<n>      pitch slide: next note glides by n semitones (negative allowed), e.g. p-12 c8
 *   n<n>      noise period 0-15 (noise channel); k s h = kick / snare / hat macros
 *   [ ... ]n  repeat n times (default 2); nesting allowed
 *   L         loop point (song loops back here instead of to the start)
 *   | and whitespace are ignored
 */
export const PPQ = 48; // ticks per quarter note

export interface NoteEvent {
  /** Start tick. */
  tick: number;
  /** Ticks until the next event (full note length). */
  len: number;
  /** Ticks the note actually sounds (after gate). */
  gate: number;
  /** MIDI note number, or null for a rest. For noise this is the period index 0-15. */
  note: number | null;
  vol: number;
  duty: number;
  decay: boolean;
  /** Semitone slide over the note (0 = none). */
  slide: number;
}

export interface Track {
  events: NoteEvent[];
  /** Total length in ticks. */
  length: number;
  /** Tick to resume from when looping. */
  loopTick: number;
}

export class MmlError extends Error {
  constructor(
    message: string,
    readonly pos: number,
    readonly src: string,
  ) {
    super(`${message} at ${pos}: "${src.slice(Math.max(0, pos - 10), pos + 10)}"`);
  }
}

const NOTE_OFFSETS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NOISE_MACROS: Record<string, { period: number; gate: number }> = {
  k: { period: 11, gate: 6 }, // kick: low, short
  s: { period: 7, gate: 8 }, // snare: mid
  h: { period: 1, gate: 3 }, // hat: high, very short
};

interface State {
  octave: number;
  len: number; // ticks
  vol: number;
  duty: number;
  gate: number; // 1-8
  decay: boolean;
  slide: number;
}

export function parseMml(src: string, channel: 'pulse' | 'triangle' | 'noise' = 'pulse'): Track {
  const events: NoteEvent[] = [];
  const st: State = { octave: 4, len: PPQ, vol: 10, duty: 2, gate: 8, decay: false, slide: 0 };
  let tick = 0;
  let loopTick = 0;
  let i = 0;
  const n = src.length;

  const fail = (m: string): never => {
    throw new MmlError(m, i, src);
  };
  const readInt = (): number | null => {
    const m = /^-?\d+/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  /** Reads an optional length like 8, 4., 16.. and returns ticks (or the default). */
  const readLen = (): number => {
    const m = /^(\d+)?(\.*)/.exec(src.slice(i)) as RegExpExecArray;
    i += m[0].length;
    let ticks = m[1] ? (PPQ * 4) / Number(m[1]) : st.len;
    if (m[1] && (PPQ * 4) % Number(m[1]) !== 0) fail(`unsupported length ${m[1]}`);
    let dot = ticks / 2;
    for (let d = 0; d < (m[2] ?? '').length; d++) {
      ticks += dot;
      dot /= 2;
    }
    return ticks;
  };
  const emit = (note: number | null, len: number, gateOverride?: number): void => {
    const gateFrac = (gateOverride ?? st.gate) / 8;
    events.push({
      tick,
      len,
      gate: note === null ? 0 : Math.max(1, Math.round(len * gateFrac)),
      note,
      vol: st.vol,
      duty: st.duty,
      decay: st.decay,
      slide: st.slide,
    });
    st.slide = 0;
    tick += len;
  };
  const extendLast = (len: number): void => {
    const last = events[events.length - 1];
    if (!last) return fail('tie without a note');
    last.len += len;
    last.gate = last.note === null ? 0 : Math.max(1, Math.round(last.len * (st.gate / 8)));
    tick += len;
  };

  // Repeat handling: stack of { start index in src, remaining count }
  const repeats: { pos: number; remaining: number }[] = [];

  while (i < n) {
    const ch = src[i] as string;
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '|' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === ';') {
      // comment to end of line
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch in NOTE_OFFSETS) {
      if (channel === 'noise') fail(`pitched note on the noise channel`);
      i++;
      let semis = NOTE_OFFSETS[ch] as number;
      while (src[i] === '+' || src[i] === '#' || src[i] === '-') {
        semis += src[i] === '-' ? -1 : 1;
        i++;
      }
      const len = readLen();
      emit((st.octave + 1) * 12 + semis, len);
      continue;
    }
    switch (ch) {
      case 'r': {
        i++;
        emit(null, readLen());
        break;
      }
      case '^':
      case '&': {
        i++;
        extendLast(readLen());
        break;
      }
      case 'o': {
        i++;
        const v = readInt();
        if (v === null || v < 0 || v > 8) fail('octave 0-8 expected');
        st.octave = v as number;
        break;
      }
      case '<':
        i++;
        st.octave = Math.max(0, st.octave - 1);
        break;
      case '>':
        i++;
        st.octave = Math.min(8, st.octave + 1);
        break;
      case 'l': {
        i++;
        if (!/^\d/.test(src.slice(i))) fail('length expected after l');
        st.len = readLen();
        break;
      }
      case 'v': {
        i++;
        const v = readInt();
        if (v === null || v < 0 || v > 15) fail('volume 0-15 expected');
        st.vol = v as number;
        break;
      }
      case '@': {
        i++;
        const v = readInt();
        if (v === null || v < 0 || v > 3) fail('duty 0-3 expected');
        st.duty = v as number;
        break;
      }
      case 'q': {
        i++;
        const v = readInt();
        if (v === null || v < 1 || v > 8) fail('gate 1-8 expected');
        st.gate = v as number;
        break;
      }
      case 'x': {
        i++;
        const v = readInt();
        if (v !== 0 && v !== 1) fail('x0 or x1 expected');
        st.decay = v === 1;
        break;
      }
      case 'p': {
        i++;
        const v = readInt();
        if (v === null) fail('slide amount expected');
        st.slide = v as number;
        break;
      }
      case 'n': {
        if (channel !== 'noise') fail('n<period> is only valid on the noise channel');
        i++;
        const v = readInt();
        if (v === null || v < 0 || v > 15) fail('noise period 0-15 expected');
        const len = readLen();
        emit(v as number, len);
        break;
      }
      case 'k':
      case 's':
      case 'h': {
        if (channel !== 'noise') fail(`drum macro "${ch}" is only valid on the noise channel`);
        i++;
        const m = NOISE_MACROS[ch] as { period: number; gate: number };
        const len = readLen();
        const saveDecay = st.decay;
        st.decay = true;
        emit(m.period, len, m.gate);
        st.decay = saveDecay;
        break;
      }
      case '[': {
        i++;
        repeats.push({ pos: i, remaining: -1 });
        break;
      }
      case ']': {
        i++;
        const rep = repeats[repeats.length - 1];
        if (!rep) return fail('] without [');
        const count = readInt() ?? 2; // always consumed, so jumping back re-reads it harmlessly
        if (rep.remaining === -1) rep.remaining = count - 1;
        else rep.remaining--;
        if (rep.remaining > 0) i = rep.pos;
        else repeats.pop();
        break;
      }
      case 'L':
        i++;
        loopTick = tick;
        break;
      case 't': {
        // tempo markers are allowed but ignored (tempo lives on the Song)
        i++;
        readInt();
        break;
      }
      default:
        fail(`unexpected "${ch}"`);
    }
  }
  if (repeats.length) fail('unclosed [');
  return { events, length: tick, loopTick };
}

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** A song is four channel strings plus a tempo. All channels should have the same length. */
export interface Song {
  id: string;
  bpm: number;
  loop: boolean;
  pulse1?: string;
  pulse2?: string;
  triangle?: string;
  noise?: string;
}

export interface CompiledSong {
  id: string;
  bpm: number;
  loop: boolean;
  tracks: { pulse1?: Track; pulse2?: Track; triangle?: Track; noise?: Track };
  length: number;
}

export function compileSong(song: Song): CompiledSong {
  const tracks: CompiledSong['tracks'] = {};
  if (song.pulse1) tracks.pulse1 = parseMml(song.pulse1, 'pulse');
  if (song.pulse2) tracks.pulse2 = parseMml(song.pulse2, 'pulse');
  if (song.triangle) tracks.triangle = parseMml(song.triangle, 'triangle');
  if (song.noise) tracks.noise = parseMml(song.noise, 'noise');
  const length = Math.max(0, ...Object.values(tracks).map((t) => t.length));
  return { id: song.id, bpm: song.bpm, loop: song.loop, tracks, length };
}

/** Sound effects use the same syntax on dedicated voices. */
export interface Sfx {
  id: string;
  bpm?: number;
  pulse?: string;
  pulse2?: string;
  noise?: string;
  triangle?: string;
}
