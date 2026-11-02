import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessGame, HeadlessOptions, JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { PlatformerWorld, snapshotWorld, type PlatformerEvent } from '@kits/platformer';
import { testStages, type TestStage } from './content';

/**
 * The stacking test's headless entry (named by `headless` in `game.json`): the platformer kit's
 * world on the game's levels, played in order (`testStages`). No browser, no drawing.
 *
 * Between levels: once a level's outcome is `cleared` or `failed`, the game waits `LEVEL_PAUSE`
 * ticks (the input is ignored), then starts the next level (cleared; after the last, the first
 * again) or the same level afresh (failed). Each level is a new world with the run's seed and
 * switched-off rules.
 *
 * This is a minimal copy of `games/platformer-lab/headless.ts`'s level flow: level sequencing is
 * game glue that two games now duplicate (gap G1 in `docs/reports/stacking-test.md`; Engine 0.7
 * T2 moves it into `kits/platformer`).
 */

/** Ticks between a level's end and the next level's start. */
export const LEVEL_PAUSE = 60;

/**
 * The snapshot: the kit's (`snapshotWorld`, every path in `kits/platformer/CLAUDE.md`) plus
 * `stage` (the level's place in the order, 0 for `level-1`) and `pause` (ticks waited since the
 * level ended, 0 while it is played).
 */
export type TestSnapshot = ReturnType<typeof snapshotWorld> & { stage: number; pause: number };

/** The game being played: the world of the current level, its last step's events and the pause. */
export class TestGame implements HeadlessGame {
  private readonly stages: TestStage[];
  world: PlatformerWorld;
  stage = 0;
  pause = 0;
  /** The last step's events (the world's own list is emptied every step). */
  events: PlatformerEvent[];

  constructor(
    content: ContentBundle,
    private readonly seed: number,
    private readonly disabledRules: readonly string[] = [],
  ) {
    this.stages = testStages(content);
    this.world = this.build(0);
    this.events = this.world.events.splice(0);
  }

  step(input: InputFrame): void {
    if (this.world.outcome === 'playing') {
      this.world.update(input);
      this.events = this.world.events.splice(0);
      return;
    }
    this.pause++;
    this.events = [];
    if (this.pause < LEVEL_PAUSE) return;
    const next = this.world.outcome === 'cleared' ? (this.stage + 1) % this.stages.length : this.stage;
    this.world = this.build(next);
    this.events = this.world.events.splice(0);
  }

  snapshot(): JsonObject {
    return { ...snapshotWorld(this.world, this.events), stage: this.stage, pause: this.pause };
  }

  private build(stage: number): PlatformerWorld {
    const { level, profile } = this.stages[stage]!;
    this.stage = stage;
    this.pause = 0;
    return new PlatformerWorld(level, profile, { seed: this.seed, disabledRules: this.disabledRules });
  }
}

/**
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: kit rules switched off in `opts` go to every level's world.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): TestGame {
  return new TestGame(content, seed, opts.disabledRules);
}
