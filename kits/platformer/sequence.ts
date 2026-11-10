import { campaignLevels, type CampaignDef } from '@engine/core/campaign';
import { contentOf, type ContentBundle } from '@engine/core/content/bundle';
import { CAMPAIGN_KIND } from '@engine/core/content/engine-kinds';
import type { HeadlessStarts, HostedGame, RunStart } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { MiniGame, MiniGameDef } from '@engine/core/minigame';
import type { LevelDef } from './level';
import { profileKind, type ProfileDef } from './profile';
import { levelKind } from './schema';
import { snapshotWorld, type PlatformerSnapshot } from './snapshot';
import { PlatformerWorld, type EndedRound, type PlatformerEvent } from './world';

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
  /**
   * The stage played first (0-based, default 0; Engine 0.14, gap G9: a run file's `start: { stage
   * }`, see {@link startStage}): the sequence starts at that level, fresh, and goes on from it as
   * from any level. Throws when it is not a stage of the sequence.
   */
  start?: number;
  /**
   * The view's width in px, given to every level's world for scrolling and waking actors (the
   * world's 256 when left out; Engine 0.16 part B: a 16:9 game passes its screen's width).
   */
  viewWidth?: number;
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
 *
 * It is a {@link HostedGame} (Engine 0.10, gap G37): `world`, `events` and `miniGame()` (the round
 * the level is running, or null), so the shell's `HostScene` takes the sequence itself.
 */
export class LevelSequence implements HostedGame<PlatformerWorld, PlatformerEvent> {
  private readonly stages: readonly LevelStage[];
  private readonly pauseTicks: number;
  world: PlatformerWorld;
  stage = 0;
  pause = 0;
  /** The last step's events (the world's own list is emptied every step). */
  events: PlatformerEvent[];
  /** The round that ended on the last step, or null (gap G20; none between levels). */
  private ended: EndedRound | null = null;

  constructor(
    stages: readonly LevelStage[],
    private readonly opts: LevelSequenceOptions,
  ) {
    if (stages.length === 0) throw new Error('a level sequence needs at least one level');
    const pause = opts.pause ?? LEVEL_PAUSE;
    if (!Number.isInteger(pause) || pause < 1)
      throw new Error(`a level pause must be a whole number of ticks >= 1, not ${pause}`);
    const start = opts.start ?? 0;
    if (!Number.isInteger(start) || start < 0 || start >= stages.length)
      throw new Error(
        `a level sequence of ${stages.length} level(s) has no stage ${start} (stages are 0 to ${stages.length - 1})`,
      );
    this.stages = stages;
    this.pauseTicks = pause;
    this.world = this.build(start);
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
      this.ended = this.world.endedRound;
      return;
    }
    this.pause++;
    this.events = [];
    this.ended = null;
    if (this.pause < this.pauseTicks) return;
    const next = this.world.outcome === 'cleared' ? (this.stage + 1) % this.stages.length : this.stage;
    this.world = this.build(next);
    this.events = this.world.events.splice(0);
  }

  snapshot(): SequenceSnapshot {
    return { ...snapshotWorld(this.world, this.events, this.ended), stage: this.stage, pause: this.pause };
  }

  /** The round the level is running now, or null (the hosted round, `HostedGame`). */
  miniGame(): MiniGame | null {
    return this.world.miniGame?.game ?? null;
  }

  private build(stage: number): PlatformerWorld {
    const { level, profile } = this.stages[stage]!;
    this.stage = stage;
    this.pause = 0;
    const { seed, disabledRules = [], miniGames, viewWidth } = this.opts;
    return new PlatformerWorld(level, profile, {
      seed,
      disabledRules,
      ...(miniGames ? { miniGames } : {}),
      ...(viewWidth === undefined ? {} : { viewWidth }),
    });
  }
}

/**
 * The starts a level sequence over `stages` can honour (`HeadlessEntry.starts`, Engine 0.14, gap
 * G9): one per stage, the level ids in play order. A game exports
 * `starts(content) => stageStarts(itsStages(content))` so a run file's `start: { stage }` is checked.
 */
export function stageStarts(stages: readonly LevelStage[]): HeadlessStarts {
  return { stages: stages.map((s) => s.level.id) };
}

/**
 * The stage a run's start (`HeadlessOptions.start`) names, for {@link LevelSequenceOptions.start}:
 * undefined without one. Throws on a campaign entry start (a level sequence starts at stages; the
 * tools refuse it first when the game lists no entries).
 */
export function startStage(start: RunStart | undefined): number | undefined {
  if (start === undefined) return undefined;
  if ('stage' in start) return start.stage;
  throw new Error(`a level sequence starts at a stage, not at campaign entry "${start.entry}"`);
}

/**
 * Levels in play order. Without a campaign: by id, numbers in ids compared as numbers (`level-2`
 * before `level-10`). With one (Engine 0.10, gap G2): its `level` entries in its order, from its
 * `start` ({@link campaignLevels}); levels it does not name are not played, and its missions are
 * skipped (a platformer sequence plays levels only). Either way the level `first` (when given)
 * leads, and with a campaign the rest follow round from it. Throws when `first`, or a level the
 * campaign names, is not among `levels`, or the campaign names no level.
 */
export function levelsInPlayOrder(
  levels: readonly LevelDef[],
  first?: string,
  campaign?: CampaignDef,
): LevelDef[] {
  if (campaign) {
    const byId = new Map(levels.map((l) => [l.id, l]));
    const ids = campaignLevels(campaign);
    if (ids.length === 0) throw new Error(`campaign "${campaign.id}" names no level`);
    const ordered = ids.map((id) => {
      const level = byId.get(id);
      if (!level) throw new Error(`campaign "${campaign.id}" names level "${id}", which is not there`);
      return level;
    });
    if (first === undefined) return ordered;
    const at = ordered.findIndex((l) => l.id === first);
    if (at < 0) throw new Error(`there is no level "${first}" in campaign "${campaign.id}"`);
    return [...ordered.slice(at), ...ordered.slice(0, at)];
  }
  const sorted = [...levels].sort((a, b) =>
    a.id === first ? -1 : b.id === first ? 1 : a.id.localeCompare(b.id, 'en', { numeric: true }),
  );
  if (first !== undefined && sorted[0]?.id !== first) throw new Error(`there is no level "${first}"`);
  return sorted;
}

/** Options for {@link contentStages}. */
export interface ContentStagesOptions {
  /** The level played first, ahead of the rest (the lab's fixture level). */
  first?: string;
  /**
   * The campaign (by id) whose order is played, when the game has more than one `campaign` file;
   * with exactly one, that one is used, and with none, the id order.
   */
  campaign?: string;
  /** Names the game in error messages (default 'the game'). */
  who?: string;
}

/**
 * A game's levels from its loaded content (`level`, `profile` and `campaign` files), in play order
 * ({@link levelsInPlayOrder}: the campaign's order when the game has one, else by id), each with
 * its profile ({@link levelStages}): the content glue every platformer game wrote for itself
 * (Engine 0.7 T9 and 0.10, gap G2 in docs/reports/stacking-test.md). Throws when there is no level,
 * or `first` is missing, or a level's profile is, or the campaign cannot be chosen or played.
 */
export function contentStages(content: ContentBundle, opts: ContentStagesOptions = {}): LevelStage[] {
  const who = opts.who ?? 'the game';
  const levels = contentOf(content, levelKind()).map((e) => e.value);
  if (levels.length === 0) throw new Error(`${who} has no levels`);
  const campaign = chooseCampaign(content, opts.campaign, who);
  let ordered: LevelDef[];
  try {
    ordered = levelsInPlayOrder(levels, opts.first, campaign);
  } catch (e) {
    if (opts.first !== undefined && !levels.some((l) => l.id === opts.first))
      throw new Error(`${who} has no level "${opts.first}"`, { cause: e });
    throw new Error(`${who}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  return levelStages(
    ordered,
    contentOf(content, profileKind()).map((e) => e.value),
    who,
  );
}

/** The campaign `id` names, the only campaign when `id` is not given, or none. */
function chooseCampaign(
  content: ContentBundle,
  id: string | undefined,
  who: string,
): CampaignDef | undefined {
  const campaigns = contentOf(content, CAMPAIGN_KIND).map((e) => e.value);
  if (id !== undefined) {
    const named = campaigns.find((c) => c.id === id);
    if (!named) throw new Error(`${who} has no campaign "${id}"`);
    return named;
  }
  if (campaigns.length > 1) {
    const ids = campaigns.map((c) => `"${c.id}"`).join(', ');
    throw new Error(`${who} has ${campaigns.length} campaigns (${ids}); name the one to play`);
  }
  return campaigns[0];
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
