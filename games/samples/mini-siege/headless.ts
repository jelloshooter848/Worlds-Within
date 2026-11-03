import {
  advanceCampaign,
  campaignOrder,
  campaignRun,
  campaignSaveAt,
  entryId,
  newCampaignSave,
  scenarioFrom,
  type CampaignDef,
  type CampaignSave,
} from '@engine/core/campaign';
import type { CarriedRecord, CarryFrom } from '@engine/core/carried';
import type { ContentBundle } from '@engine/core/content/bundle';
import {
  rulesOffFor,
  type HeadlessGame,
  type HeadlessOptions,
  type HeadlessStarts,
  type JsonObject,
  type MissionStepRefusal,
  type RunStart,
} from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { MiniGame, MiniGameDef } from '@engine/core/minigame';
import { MissionHost } from '@engine/core/mission-host';
import type { MissionRecord } from '@engine/core/missions';
import {
  applyOrder,
  carriedRecord,
  fateOf,
  missionPort,
  Missions,
  scenarioKeys,
  stockpileOf,
  worldFromScenario,
  type World,
} from '@engine/sim/index';
import { launchMission, rtsGame, sidesOf, type RtsGame } from '@kits/rts';
import { MISSION_ROOM, missionRoom, topdownMissionAdapter } from '@kits/topdown';
import { TD_DEFENCE, tdDefence, towerdefenseMissionAdapter } from '@kits/towerdefense';
import {
  FIRST_SCENARIO,
  PLAYER,
  siegeCampaign,
  siegeDefenceMaps,
  siegeEnemy,
  siegeMap,
  siegeMissions,
  siegeRooms,
  siegeScenario,
  siegeTowers,
} from './content';

/**
 * The mini siege's headless entry (named by `headless` in `game.json`): thin glue joining an
 * `engine/sim` world built from the map, the RTS kit's `rtsGame` (the raiders' plan), and the
 * engine's `MissionHost` with the sim's `missionPort` and two data-driven mini games with their
 * adapters: the topdown kit's mission room (`mission-room`, the sabotage) and the towerdefense
 * kit's `td-defence` (the fortify mission on the walls). No rules here: the battle is the sim's, the plan and the
 * mission are data, the round and its mapping are the kits'.
 */

/** The world built from the map (the siege's when `name` is left out), the types and `seed`. */
export function createWorld(content: ContentBundle, seed: number, name: string = FIRST_SCENARIO): World {
  return worldFromScenario(siegeScenario(content, seed, name));
}

/**
 * Where the game is in its campaign (Engine 0.13 T7, decisions 6 and 8): the campaign file, the
 * save the game started from (a new one at the siege, or a run file's `from`), and the carry spec
 * of the next scenario entry (`dawn`'s `from`), or null when no later scenario carries anything.
 */
export interface SiegeCampaignPlace {
  def: CampaignDef;
  save: CampaignSave;
  /** The scenario entry played now (`village` or `dawn`). */
  scenario: string;
  next: CarryFrom | null;
}

/**
 * The game's mini games (`HeadlessEntry.miniGames`): the topdown kit's mission room over the rooms
 * and the towerdefense kit's `td-defence` over the walls' maps and towers (its frames at the game's
 * picture size, which the page's taps read through). `validate` checks each
 * mission's params with the one its `play` names. Each round takes its own kit's switched-off
 * rules from `opts.disabledRulesByKit` (a run file's `topdown:<id>` or `towerdefense:<id>`,
 * Engine 0.14 gap G12).
 */
export function miniGames(content: ContentBundle, opts: HeadlessOptions = {}): readonly MiniGameDef[] {
  return [
    missionRoom({ rooms: siegeRooms(content), disabledRules: rulesOffFor(opts, 'topdown') }),
    tdDefence({
      maps: siegeDefenceMaps(content),
      towers: siegeTowers(content),
      size: content.manifest.screen,
      disabledRules: rulesOffFor(opts, 'towerdefense'),
    }),
  ];
}

/** The mission adapters, by the mini game they map (`MissionHost`'s `adapters`). */
export const ADAPTERS = {
  [MISSION_ROOM]: topdownMissionAdapter,
  [TD_DEFENCE]: towerdefenseMissionAdapter,
} as const;

/**
 * One scenario entity at a glance, for run-file checks: alive (it exists and its fate is not
 * `dead`), where (null off the map: gone, captured or dead), how hurt, and `fate` (only for a named
 * person whose fate was set: `injured`, `captured`, `freed` or `dead`; left out while active, so
 * runs where no fate is set hash as before).
 */
export interface NamedSummary {
  alive: boolean;
  x: number | null;
  y: number | null;
  hp: number | null;
  fate?: string;
}

/**
 * The game the tools play: the `MissionHost` over the kit's `RtsGame`. A run file's `open` goes
 * through the kit's launch command (`launchMission`: refused `not_offered` while no opportunity
 * offers it), the other mission steps and orders straight to the host. The snapshot is the host's
 * (`{ world, kit, missions? }`) plus `sides` (the kit's `sidesOf`) and `named`: every keyed
 * scenario entity with `alive`, `x`, `y` and `hp`, so a run file can check `named.ram.alive`.
 */
export class MiniSiegeGame implements HeadlessGame {
  constructor(
    readonly world: World,
    readonly rts: RtsGame,
    readonly host: MissionHost,
    /** The scenario's keys and their entity ids. */
    readonly keys: Readonly<Record<string, number>>,
    /** The factions `sides` always lists: the player's and the raiders'. */
    readonly factions: readonly string[],
    /** Where the game is in its campaign (Engine 0.13 T7). */
    readonly campaign: SiegeCampaignPlace,
  ) {}

  step(input: InputFrame): void {
    this.host.step(input);
  }

  order(order: JsonObject): string | null {
    return this.host.order(order);
  }

  mission(step: JsonObject): MissionStepRefusal | null {
    let refused: MissionStepRefusal | null;
    if (step['action'] === 'open' && typeof step['mission'] === 'string') {
      const launched = launchMission(this.rts.view(), step['mission'], this.host);
      refused = launched.ok ? null : { code: launched.code, error: launched.error };
    } else refused = this.host.mission(step);
    this.rts.refresh();
    return refused;
  }

  missionExperience(): { mission: string; ticks: number }[] {
    return this.host.missionExperience();
  }

  /** The mission round hosted now, or null. */
  miniGame(): MiniGame | null {
    return this.host.miniGame();
  }

  /** The world's committed mission records, in commit order (the page's commit sound reads them). */
  records(): readonly MissionRecord[] {
    const holder = this.world.query(Missions)[0];
    return holder === undefined ? [] : (this.world.get(holder, Missions)?.committed ?? []);
  }

  /**
   * The campaign save if the entry played now ended at this tick (`HeadlessGame.campaignSave`,
   * Engine 0.13 T7): the next position, the missions committed in this world added to the
   * results, and the carried record the next scenario's `from` asks for, built from the world now
   * (null at the dawn, the last entry). Reads only. Null once the campaign is done, and while a
   * stockpile the next scenario carries is gone (the hall fallen: gap M31).
   */
  campaignSave(): CampaignSave | null {
    const { def, save, next } = this.campaign;
    if (campaignRun(def, save).done) return null;
    const missions = this.records().map((r) => ({
      mission: r.mission,
      outcome: r.outcome,
      resolution: r.resolution,
    }));
    let carried: CarriedRecord | null = null;
    if (next !== null) {
      // A carried faction with no stockpile left (the hall fell, as in the fortify runs) cannot
      // be carried: the engine refuses the record, so there is no save here (gap M31).
      if (next.carry.stockpiles.some((s) => stockpileOf(this.world, s.faction) === null)) return null;
      carried = carriedRecord(this.world, next, this.keys);
    }
    const advanced = advanceCampaign(def, save, { missions, carried });
    if (!advanced.ok) throw new Error(`the mini siege's campaign save: ${advanced.error}`);
    return advanced.save;
  }

  /** Every keyed scenario entity at a glance (the snapshot's `named`). */
  named(): Record<string, NamedSummary> {
    const named: Record<string, NamedSummary> = {};
    for (const [key, id] of Object.entries(this.keys)) {
      const exists = this.world.alive(id);
      const fate = exists ? fateOf(this.world, id) : null;
      const at = exists
        ? (this.world.get(id, 'Position') as { x: number; y: number } | undefined)
        : undefined;
      const health = exists ? (this.world.get(id, 'Health') as { hp: number } | undefined) : undefined;
      const summary: NamedSummary = {
        alive: exists && fate?.state !== 'dead',
        x: at?.x ?? null,
        y: at?.y ?? null,
        hp: health?.hp ?? null,
      };
      if (fate && fate.state !== 'active') summary.fate = fate.state;
      named[key] = summary;
    }
    return named;
  }

  snapshot(): JsonObject {
    return {
      ...this.host.snapshot(),
      sides: sidesOf(this.rts.view(), this.factions) as unknown as JsonObject,
      named: this.named() as unknown as JsonObject,
    };
  }
}

/**
 * Where a game starting at `save` is in the campaign (a new save at the siege when left out): the
 * scenario entry to build and the next scenario's carry spec. Throws on a save past the end (the
 * tools refuse such a `from` first).
 */
export function siegeCampaignPlace(
  content: ContentBundle,
  seed: number,
  save?: CampaignSave,
): SiegeCampaignPlace {
  const def = siegeCampaign(content);
  const start = save ?? newCampaignSave({ game: content.manifest.id, campaign: def.id, seed });
  const run = campaignRun(def, start);
  if (run.done || run.scenario === null)
    throw new Error(`campaign "${def.id}" has no scenario to play at position ${start.position}`);
  const nextName = scenarioFrom(run.order, run.position + 1);
  const next = nextName === null ? null : (siegeMap(content, nextName).from ?? null);
  return { def, save: start, scenario: run.scenario, next };
}

/**
 * The starts a run file may name (`HeadlessEntry.starts`, Engine 0.14, gap G9): the campaign's
 * entries by id, in play order (`village`, `dawn`). The mini siege has no level sequence, so a
 * `{ stage }` start is refused by the tools.
 */
export function starts(content: ContentBundle): HeadlessStarts {
  return { entries: campaignOrder(siegeCampaign(content)).map(entryId) };
}

/**
 * The campaign save a run's `start: { entry }` begins at (gap G9, decision 6): that entry fresh,
 * with no carried record (the dawn as its scenario file is written, not as the siege left it).
 * Throws on a stage start or an entry the campaign lacks (the tools refuse both first).
 */
export function siegeStartSave(content: ContentBundle, seed: number, start: RunStart): CampaignSave {
  if (!('entry' in start)) throw new Error('the mini siege starts at a campaign entry, not a stage');
  const def = siegeCampaign(content);
  const save = campaignSaveAt(def, { game: content.manifest.id, seed }, start.entry);
  if (save === null) throw new Error(`campaign "${def.id}" has no entry "${start.entry}"`);
  return save;
}

/**
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: kit rules switched off in `opts` go to the RTS kit (`disabledRules`) and to each
 * round's kit (`disabledRulesByKit`, through `miniGames`). `opts.campaign` (a run file's
 * `from`: another run's end or a save code) picks the campaign entry and its carried record: the
 * dawn built from what the siege left (`worldFromScenario(json, { carried })`); `opts.start` (a
 * run file's `start: { entry }`, Engine 0.14) picks an entry fresh, with nothing carried; left
 * out, the siege from the start.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): MiniSiegeGame {
  const save = opts.campaign ?? (opts.start ? siegeStartSave(content, seed, opts.start) : undefined);
  const place = siegeCampaignPlace(content, seed, save);
  const scenario = siegeScenario(content, seed, place.scenario);
  const carried = place.save.carried;
  const world = worldFromScenario(
    scenario,
    scenario.from !== undefined && carried !== null ? { carried } : {},
  );
  const keys = scenarioKeys(scenario);
  const enemy = siegeEnemy(content);
  const rts = rtsGame({
    world: {
      snapshot: () => world.snapshot(),
      applyOrder: (o) => {
        const r = applyOrder(world, o);
        return r.ok ? { ok: true } : { ok: false, error: r.error };
      },
      step: () => world.step(),
    },
    enemy,
    seed,
    disabledRules: opts.disabledRules,
  });
  const host = new MissionHost({
    game: rts,
    port: missionPort(world, { refs: keys }),
    missions: siegeMissions(content),
    miniGames: miniGames(content, opts),
    adapters: ADAPTERS,
  });
  return new MiniSiegeGame(world, rts, host, keys, [PLAYER, enemy.faction], place);
}
