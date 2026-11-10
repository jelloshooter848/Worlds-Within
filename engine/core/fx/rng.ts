import { Rng } from '../rng';

/**
 * The presentation-only RNG (docs/ROADMAP.md, Engine 0.16 part A): a fresh generator for one
 * presentation frame and one named stream, seeded from the run's seed, the frame number and the
 * stream's name. It never reads or moves the world's RNG (`engine/sim`'s, or a kit's), so an effect
 * may draw as much as it likes without changing the state, and the same seed, frame and stream
 * always draw the same numbers: a screenshot at a tick is byte-stable.
 *
 * Streams are independent: drawing from `fxRng(seed, f, 'sparks')` never changes what
 * `fxRng(seed, f, 'dust')` draws. Use one stream per effect (`particles:<emitter>`,
 * `sfx-pitch`), and derive per-item streams with a suffix (`sparks:3`) when an effect needs one
 * per entity.
 */
export function fxRng(seed: number, frame: number, stream: string): Rng {
  if (!Number.isInteger(frame)) throw new Error(`fxRng: frame must be a whole number, got ${frame}`);
  return Rng.derived(seed, `fx:${frame}:${stream}`);
}

/** A float in [lo, hi) from `rng` (one draw). */
export function fxRange(rng: Rng, lo: number, hi: number): number {
  return lo + rng.float() * (hi - lo);
}
