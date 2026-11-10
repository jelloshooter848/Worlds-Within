import { z } from 'zod';
import { fxRange, fxRng } from '../fx/rng';

/**
 * The audio mixer's rules as data (docs/ROADMAP.md, Engine 0.16 part A, T8): layered music mixed
 * from a frame's status, sound-effect variation and ducking. Everything here is pure and counted in
 * presentation ticks (one per 60 Hz loop step): the shell's `Mixer` (`mixer.ts`) runs it and hands
 * the numbers to the `AudioManager`. Nothing here reads or writes a world, a frame or a hash, and no
 * headless run makes one.
 *
 * A skin's `music` section names layered songs:
 *
 *   "music": {
 *     "lab": {
 *       "layers": { "calm": "lab-calm", "danger": "lab-danger" },
 *       "fade": 30,
 *       "mix": [
 *         { "when": { "status": "nearestActor", "gte": 0, "lt": 48 }, "layers": { "danger": 1, "calm": 0.3 }, "fade": 12 },
 *         { "layers": { "calm": 1, "danger": 0 } }
 *       ]
 *     }
 *   }
 *
 * Every layer song starts at the same audio time and is kept in step (same tempo, same length);
 * the first rule whose `when` holds (a rule without one always holds) sets the layers' levels,
 * crossfaded over its `fade` (else the entry's, else {@link DEFAULT_MIX_FADE}) ticks. A layer a
 * rule leaves out keeps its level. An event's sound may vary (`pitch`, `volume` ranges, drawn
 * from `fxRng` per seed, frame and sound), rest (`cooldown` ticks) and duck the music
 * (`duck { amount, attack, hold, release }`).
 */

/** Ticks a mix rule's crossfade takes when neither it nor its entry gives a `fade`. */
export const DEFAULT_MIX_FADE = 30;

/** The duck under an open dialog box (`Mixer.dialog`): music at half level, in fast, out slowly. */
export const DIALOG_DUCK: DuckSpec = { amount: 0.5, attack: 6, hold: 0, release: 20 };

/** How far an event's `pitch` may reach, in semitones either way. */
export const SFX_PITCH_LIMIT = 24;

const id = z.string().min(1);
const ticks = (what: string) => z.number().int().min(0).max(600).describe(what);
const level = z.number().min(0).max(1);

/** A `[min, max]` range (min at most max), checked in the refinement so the error sits on the field. */
const range = (lo: number, hi: number, what: string) =>
  z
    .tuple([z.number().min(lo).max(hi), z.number().min(lo).max(hi)])
    .describe(`${what}: [min, max], one value drawn per play`);

/**
 * A duck: the music lowered by `amount` (0..1), reached over `attack` ticks, kept at the deepest
 * `hold` more ticks, back over `release` ticks.
 */
export const duckSpecSchema = z
  .strictObject({
    amount: level.describe('how much of the music level is taken away at the deepest (0..1)'),
    attack: ticks('ticks to go down').default(4),
    hold: ticks('ticks held at the deepest').default(0),
    release: ticks('ticks to come back up').default(20),
  })
  .describe('music ducking under this sound');

export type DuckSpec = z.output<typeof duckSpecSchema>;

const scalar = z.union([z.string(), z.number(), z.boolean()]);

/** A status value compared: every operator given must hold. */
export const statusCompareSchema = z
  .strictObject({
    status: id.describe("the frame's status key"),
    eq: scalar.exactOptional().describe('equal to'),
    ne: scalar.exactOptional().describe('not equal to'),
    lt: z.number().exactOptional().describe('a number below'),
    lte: z.number().exactOptional().describe('a number at most'),
    gt: z.number().exactOptional().describe('a number above'),
    gte: z.number().exactOptional().describe('a number at least'),
  })
  .describe('a test of one status value; a key the frame lacks never matches');

export type StatusCompare = z.output<typeof statusCompareSchema>;

const COMPARE_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;

export const mixRuleSchema = z.strictObject({
  when: statusCompareSchema.exactOptional().describe('when the rule holds (left out: always)'),
  layers: z.record(id, level).describe('layer name -> its level (0..1) while the rule holds'),
  fade: ticks('crossfade ticks to these levels').exactOptional(),
});

export type MixRule = z.output<typeof mixRuleSchema>;

/** One layered song of a skin's `music` section. */
export const musicEntrySchema = z.strictObject({
  layers: z
    .record(id, id)
    .refine((l) => Object.keys(l).length > 0, { message: 'needs at least one layer' })
    .describe('layer name -> the song (MML) it plays; all start together and stay in step'),
  fade: ticks('the default crossfade ticks for its rules').exactOptional(),
  mix: z
    .array(mixRuleSchema)
    .exactOptional()
    .describe("rules tried in order each tick on the frame's status; the first that holds sets the levels"),
});

export type MusicEntry = z.output<typeof musicEntrySchema>;

export const skinMusicSchema = z.record(id, musicEntrySchema);
export type SkinMusic = z.output<typeof skinMusicSchema>;

/** An event entry's sound fields beyond `sound` (Engine 0.16 T8). */
export const soundVariationFields = {
  pitch: range(-SFX_PITCH_LIMIT, SFX_PITCH_LIMIT, 'pitch in semitones').exactOptional(),
  volume: range(0, 1, 'volume factor').exactOptional(),
  cooldown: ticks('ticks the same sound rests after it played').exactOptional(),
  duck: duckSpecSchema.exactOptional(),
};

/** Adds `bad_range` at `path` for a `[min, max]` with min above max. */
export function checkSoundRange(
  value: readonly [number, number] | undefined,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (value === undefined || value[0] <= value[1]) return;
  ctx.addIssue({
    code: 'custom',
    path,
    message: `min ${value[0]} is above max ${value[1]}`,
    params: { code: 'bad_range' },
  });
}

/** Every mix rule's layer names one of its entry's layers (`missing_ref` otherwise). */
export function checkMusicLayers(music: SkinMusic | undefined, ctx: z.RefinementCtx): void {
  for (const [song, entry] of Object.entries(music ?? {})) {
    (entry.mix ?? []).forEach((rule, i) => {
      for (const layer of Object.keys(rule.layers)) {
        if (Object.hasOwn(entry.layers, layer)) continue;
        ctx.addIssue({
          code: 'custom',
          path: ['music', song, 'mix', i, 'layers', layer],
          message: `no layer "${layer}" in music "${song}" (${Object.keys(entry.layers).join(', ')})`,
          params: { code: 'missing_ref' },
        });
      }
    });
  }
}

// ---- Mix rules ----

/** A status as a mixer reads it. */
export type MixStatus = Readonly<Record<string, string | number | boolean>>;

/** Whether `when` holds on `status`: every operator given holds; a missing key never matches. */
export function statusMatches(when: StatusCompare, status: MixStatus): boolean {
  if (!Object.hasOwn(status, when.status)) return false;
  const v = status[when.status]!;
  for (const op of COMPARE_OPS) {
    const want = when[op];
    if (want === undefined) continue;
    if (op === 'eq' ? v !== want : op === 'ne' ? v === want : typeof v !== 'number') return false;
    if (typeof v !== 'number' || typeof want !== 'number') continue;
    if (op === 'lt' && !(v < want)) return false;
    if (op === 'lte' && !(v <= want)) return false;
    if (op === 'gt' && !(v > want)) return false;
    if (op === 'gte' && !(v >= want)) return false;
  }
  return true;
}

/** The first rule of `entry` that holds on `status` (its index), or -1. */
export function mixRuleIndex(entry: MusicEntry, status: MixStatus): number {
  return (entry.mix ?? []).findIndex((r) => r.when === undefined || statusMatches(r.when, status));
}

/**
 * The layer levels of one layered song, tick by tick: each `update(status)` picks the rule that
 * holds and moves every layer one tick along a straight crossfade to that rule's level. The first
 * update snaps (a song starts at its mix, not from silence); a layer no rule has named yet plays
 * at 1. A new rule mid-fade starts its own fade from where the levels are. Pure and deterministic.
 */
export class LayerMix {
  private readonly levels = new Map<string, number>();
  private fades = new Map<string, { from: number; to: number; ticks: number; age: number }>();
  private rule = -2;
  private started = false;

  constructor(readonly entry: MusicEntry) {
    for (const layer of Object.keys(entry.layers)) this.levels.set(layer, 1);
  }

  /** The layer names, in the entry's order. */
  get layers(): string[] {
    return Object.keys(this.entry.layers);
  }

  /** The index of the rule holding now (-1: none), after the last update. */
  get ruleIndex(): number {
    return this.rule;
  }

  /** Each layer's level now. */
  gains(): Record<string, number> {
    return Object.fromEntries(this.levels);
  }

  /** One tick on `status`: the rule that holds, then one step of every fade. Returns the levels. */
  update(status: MixStatus): Record<string, number> {
    const i = mixRuleIndex(this.entry, status);
    if (i !== this.rule) {
      this.rule = i;
      const rule = this.entry.mix?.[i];
      if (rule !== undefined) {
        const ticks = this.started ? (rule.fade ?? this.entry.fade ?? DEFAULT_MIX_FADE) : 0;
        for (const [layer, to] of Object.entries(rule.layers)) {
          const from = this.levels.get(layer) ?? 1;
          if (ticks === 0) {
            this.levels.set(layer, to);
            this.fades.delete(layer);
          } else this.fades.set(layer, { from, to, ticks, age: 0 });
        }
      }
    }
    this.started = true;
    for (const [layer, f] of this.fades) {
      f.age++;
      const t = Math.min(1, f.age / f.ticks);
      this.levels.set(layer, f.from + (f.to - f.from) * t);
      if (t >= 1) this.fades.delete(layer);
    }
    return this.gains();
  }
}

// ---- Ducking ----

interface Duck {
  spec: DuckSpec;
  level: number;
  /** Ticks left at the deepest (Infinity while a sustained duck is on). */
  held: number;
  phase: 'attack' | 'hold' | 'release';
}

/**
 * The music's duck, tick by tick: `trigger(spec)` (a big hit) goes down over `attack` ticks, stays
 * `hold` ticks and comes back over `release`; `sustain(key, spec | null)` (a dialog box) goes down
 * and stays while on, then releases. Several ducks at once: the deepest wins. `tick()` advances
 * one tick and returns the music's factor (1: no duck). Pure and deterministic.
 */
export class DuckEnvelope {
  private readonly ducks: Duck[] = [];
  private readonly sustained = new Map<string, Duck>();
  private factor = 1;

  /** The music's factor after the last tick (1: no duck). */
  get value(): number {
    return this.factor;
  }

  /** Starts a one-shot duck. */
  trigger(spec: DuckSpec): void {
    this.ducks.push({ spec, level: 0, held: spec.hold, phase: 'attack' });
  }

  /** Turns a sustained duck on (with its spec) or off (null: it releases from where it is). */
  sustain(key: string, spec: DuckSpec | null): void {
    const on = this.sustained.get(key);
    if (spec === null) {
      if (on !== undefined) {
        on.phase = 'release';
        this.sustained.delete(key);
      }
      return;
    }
    if (on !== undefined) return;
    const duck: Duck = { spec, level: 0, held: Infinity, phase: 'attack' };
    this.sustained.set(key, duck);
    this.ducks.push(duck);
  }

  /** One tick: every duck moves along its envelope; returns the music's factor. */
  tick(): number {
    let factor = 1;
    for (let i = this.ducks.length - 1; i >= 0; i--) {
      const d = this.ducks[i]!;
      if (d.phase === 'attack') {
        d.level = d.spec.attack === 0 ? 1 : Math.min(1, d.level + 1 / d.spec.attack);
        if (d.level >= 1) d.phase = 'hold';
      } else if (d.phase === 'hold') {
        if (d.held !== Infinity) d.held--;
        if (d.held < 0) d.phase = 'release';
      }
      if (d.phase === 'release') {
        d.level = d.spec.release === 0 ? 0 : Math.max(0, d.level - 1 / d.spec.release);
        if (d.level <= 0) {
          this.ducks.splice(i, 1);
          continue;
        }
      }
      factor = Math.min(factor, 1 - d.spec.amount * d.level);
    }
    this.factor = factor;
    return factor;
  }
}

// ---- Sound variation and cooldown ----

/** What a presenter hands the shell with an event's sound: its frame and the entry's sound fields. */
export interface SoundCue {
  /** The presented frame's number (the variation's draw is fixed per seed, frame and sound). */
  frame: number;
  pitch?: readonly [number, number];
  volume?: readonly [number, number];
  cooldown?: number;
  duck?: DuckSpec;
}

/** One play of a sound: semitones to shift, the volume factor and the duck it starts. */
export interface SoundPlay {
  pitch: number;
  volume: number;
  duck?: DuckSpec;
}

/**
 * The pitch and volume of one play of `sound`, drawn from `fxRng(seed, frame, "sfx:<sound>:<n>")`
 * (`n` counts plays of that sound in the frame): the same seed, frame and sound always give the
 * same numbers, and no world RNG moves. No range: pitch 0, volume 1.
 */
export function soundVariation(
  seed: number,
  frame: number,
  sound: string,
  n: number,
  cue: Pick<SoundCue, 'pitch' | 'volume'>,
): { pitch: number; volume: number } {
  if (cue.pitch === undefined && cue.volume === undefined) return { pitch: 0, volume: 1 };
  const rng = fxRng(seed, frame, `sfx:${sound}:${n}`);
  const pitch = cue.pitch === undefined ? 0 : fxRange(rng, cue.pitch[0], cue.pitch[1]);
  const volume = cue.volume === undefined ? 1 : fxRange(rng, cue.volume[0], cue.volume[1]);
  return { pitch, volume };
}

/**
 * Picks each play of an event sound: drops one still cooling down (`cooldown` frames since the
 * same sound last played; a frame number that went back, as on a new level, starts afresh) and
 * draws its variation. Pure and deterministic per seed.
 */
export class SoundPicker {
  private readonly last = new Map<string, number>();
  private frame = Number.NaN;
  private readonly inFrame = new Map<string, number>();

  constructor(private readonly seed = 0) {}

  /** The play of `sound` for `cue`, or null when it is cooling down. */
  pick(sound: string, cue: SoundCue): SoundPlay | null {
    if (cue.frame !== this.frame) {
      if (cue.frame < this.frame) this.last.clear();
      this.frame = cue.frame;
      this.inFrame.clear();
    }
    const was = this.last.get(sound);
    if (cue.cooldown !== undefined && was !== undefined && cue.frame - was < cue.cooldown) return null;
    this.last.set(sound, cue.frame);
    const n = this.inFrame.get(sound) ?? 0;
    this.inFrame.set(sound, n + 1);
    const play: SoundPlay = soundVariation(this.seed, cue.frame, sound, n, cue);
    if (cue.duck !== undefined) play.duck = cue.duck;
    return play;
  }
}
