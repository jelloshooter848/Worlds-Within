import { contentOf, type ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessGame } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { MiniGameDef } from '@engine/core/minigame';
import type { LevelDef } from './level';
import { profileKind, type ProfileDef } from './profile';
import { levelKind } from './schema';
import { snapshotWorld, type PlatformerSnapshot } from './snapshot';
import { PlatformerWorld, type PlatformerEvent } from './world';

/** One level of a sequence and the physics profile it is played with. */
export interface LevelStage {
  level: LevelDef;
  profile: ProfileDef;
}

/** Ticks between a level's end and the next level's start, when a sequence is not given `pause`. */
export const LEVEL_PAUSE = 60;

/** How a {@link LevelSequence} builds each level's world and waits between levels. */
export interface LevelSequenceOptions {
  /** The run's seed, given to every level's world. */
  seed: number;
  /** Kit rules switched off (ids from `PLATFORMER_RULES`), given to every level's world. */
  disabledRules?: readonly string[];
  /** The mini games the levels' triggers name, given to every level's world. */
  miniGames?: readonly MiniGameDef[];
  /** Ticks between a level's end and the next level's start ({@link LEVEL_PAUSE} when left out). */
  pause?: number;
}

/**
 * A sequence's snapshot: the kit's ({@link snapshotWorld}) plus `stage` (the level's place in the
 * order, 0 for the first) and `pause` (ticks waited since the level ended, 0 while it is played).
 */
export type SequenceSnapshot = PlatformerSnapshot & { stage: number; pause: number };

/**
 * Levels played one after another, as the headless contract (`engine/core/headless.ts`): a
 * gameplay flow rule, no drawing. Once a level's outcome is `cleared` or `failed`, the sequence
 * waits `pause` ticks (the input is ignored and there are no events), then starts the next level
 * (cleared; after the last, the first again) or the same level afresh (failed). Each level is a
 * new world with the options' seed, switched-off rules and mini games.
 */
export class LevelSequence implements HeadlessGame {
  private readonly stages: readonly LevelStage[];
  private readonly pauseTicks: number;
  world: PlatformerWorld;
  stage = 0;
  pause = 0;
  /** The last step's events (the world's own list is emptied every step). */
  events: PlatformerEvent[];

  constructor(
    stages: readonly LevelStage[],
    private readonly opts: LevelSequenceOptions,
  ) {
    if (stages.length === 0) throw new Error('a level sequence needs at least one level');
    const pause = opts.pause ?? LEVEL_PAUSE;
    if (!Number.isInteger(pause) || pause < 1)
      throw new Error(`a level pause must be a whole number of ticks >= 1, not ${pause}`);
    this.stages = stages;
    this.pauseTicks = pause;
    this.world = this.build(0);
    this.events = this.world.events.splice(0);
  }

  /** How many levels the sequence plays in turn. */
  get stageCount(): number {
    return this.stages.length;
  }

  step(input: InputFrame): void {
    if (this.world.outcome === 'playing') {
      this.world.update(input);
      this.events = this.world.events.splice(0);
      return;
    }
    this.pause++;
    this.events = [];
    if (this.pause < this.pauseTicks) return;
    const next = this.world.outcome === 'cleared' ? (this.stage + 1) % this.stages.length : this.stage;
    this.world = this.build(next);
    this.events = this.world.events.splice(0);
  }

  snapshot(): SequenceSnapshot {
    return { ...snapshotWorld(this.world, this.events), stage: this.stage, pause: this.pause };
  }

  private build(stage: number): PlatformerWorld {
    const { level, profile } = this.stages[stage]!;
    this.stage = stage;
    this.pause = 0;
    const { seed, disabledRules = [], miniGames } = this.opts;
    return new PlatformerWorld(level, profile, {
      seed,
      disabledRules,
      ...(miniGames ? { miniGames } : {}),
    });
  }
}

/**
 * Levels in play order: by id, numbers in ids compared as numbers (`level-2` before `level-10`),
 * with the level `first` (when given) ahead of the rest. Throws when `first` is not among them.
 */
export function levelsInPlayOrder(levels: readonly LevelDef[], first?: string): LevelDef[] {
  const sorted = [...levels].sort((a, b) =>
    a.id === first ? -1 : b.id === first ? 1 : a.id.localeCompare(b.id, 'en', { numeric: true }),
  );
  if (first !== undefined && sorted[0]?.id !== first) throw new Error(`there is no level "${first}"`);
  return sorted;
}

/** Options for {@link contentStages}. */
export interface ContentStagesOptions {
  /** The level played first, ahead of the id order (the lab's fixture level). */
  first?: string;
  /** Names the game in error messages (default 'the game'). */
  who?: string;
}

/**
 * A game's levels from its loaded content (`level` and `profile` files), in play order
 * ({@link levelsInPlayOrder}), each with its profile ({@link levelStages}): the content glue every
 * platformer game wrote for itself (Engine 0.7 T9, gap G2 in docs/reports/stacking-test.md).
 * Throws when there is no level, or `first` is missing, or a level's profile is.
 */
export function contentStages(content: ContentBundle, opts: ContentStagesOptions = {}): LevelStage[] {
  const who = opts.who ?? 'the game';
  const levels = contentOf(content, levelKind()).map((e) => e.value);
  if (levels.length === 0) throw new Error(`${who} has no levels`);
  let ordered: LevelDef[];
  try {
    ordered = levelsInPlayOrder(levels, opts.first);
  } catch {
    throw new Error(`${who} has no level "${opts.first}"`);
  }
  return levelStages(
    ordered,
    contentOf(content, profileKind()).map((e) => e.value),
    who,
  );
}

/**
 * Each level in the order given, paired with the profile it names. Throws when a level names a
 * profile that is not in `profiles` (`who` names the game in the message).
 */
export function levelStages(
  levels: readonly LevelDef[],
  profiles: readonly ProfileDef[],
  who = 'the game',
): LevelStage[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return levels.map((level) => {
    const profile = byId.get(level.profile);
    if (!profile) throw new Error(`level "${level.id}" names profile "${level.profile}", which ${who} lacks`);
    return { level, profile };
  });
}
