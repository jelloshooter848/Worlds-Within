import type { BossDef, BossStep } from './profile';

/** Where a boss stands: fighting, or in its defeat sequence (then it is gone). */
export type BossMode = 'fight' | 'defeated';

/**
 * A boss's state (Engine 0.16 T2): an actor whose type has a `boss` form (`profile.ts`) carries
 * one. Every number is a whole number, and all of it is in the snapshot (`actors[].boss`).
 *
 * - `hp` (hit points left), `phase` (0: the base `pattern`, n: the form's `phases[n - 1]`),
 *   `step` (the step of the phase's pattern it is on) and `tick` (ticks into that step; on its
 *   defeat, ticks into the defeat sequence), `invuln` (ticks left in which a stomp only bounces).
 *
 * What a step does is the world's (`world.ts`, the boss's turn); this class only keeps the place
 * in the pattern and says when a step is over.
 */
export class BossState {
  mode: BossMode = 'fight';
  hp: number;
  phase = 0;
  step = 0;
  tick = 0;
  invuln = 0;

  constructor(readonly def: BossDef) {
    this.hp = def.hp;
  }

  /** The pattern of the phase it is in. */
  get pattern(): readonly BossStep[] {
    return this.phase === 0 ? this.def.pattern : this.def.phases![this.phase - 1]!.pattern;
  }

  /** The step it is on. */
  get current(): BossStep {
    return this.pattern[this.step]!;
  }

  /** The attack it is announcing now (a `telegraph` step's `attack`), or ''. */
  get telegraph(): string {
    const s = this.current;
    return this.mode === 'fight' && s.do === 'telegraph' ? s.attack : '';
  }

  /** On to the next step of the pattern (after the last, the first again). */
  next(): void {
    this.step = (this.step + 1) % this.pattern.length;
    this.tick = 0;
  }

  /**
   * The phase its hit points call for: the number of phases whose `hp` is at or over the hp left
   * (they are in falling order, which the profile checks).
   */
  phaseFor(hp: number): number {
    return (this.def.phases ?? []).filter((ph) => hp <= ph.hp).length;
  }

  /** Starts a later phase's pattern from its first step. */
  enterPhase(phase: number): void {
    this.phase = phase;
    this.step = 0;
    this.tick = 0;
  }
}

/**
 * Whether a step is over after this tick (`tick` ticks into it): `idle` and `telegraph` after
 * their `ticks`, `shoot` and `drop` after theirs (1 when left out), `charge` at a wall (or after
 * its `ticks`), `leap` on landing.
 */
export function stepOver(step: BossStep, tick: number, hitWall: number, onGround: boolean): boolean {
  switch (step.do) {
    case 'idle':
    case 'telegraph':
      return tick + 1 >= step.ticks;
    case 'shoot':
    case 'drop':
      return tick + 1 >= (step.ticks ?? 1);
    case 'charge':
      return hitWall !== 0 || (step.ticks !== undefined && tick + 1 >= step.ticks);
    case 'leap':
      return tick > 0 && onGround;
  }
}

/** The boss's horizontal speed on a step: a charge's `speed`, a leap's `run`, else 0. */
export function stepSpeed(step: BossStep): number {
  if (step.do === 'charge') return step.speed;
  if (step.do === 'leap') return step.run;
  return 0;
}
