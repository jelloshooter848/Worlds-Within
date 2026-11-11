import {
  advanceCampaign,
  campaignOrder,
  campaignRun,
  campaignSaveAt,
  entryId,
  entryOver,
  entryWorldClock,
  newCampaignSave,
  scenarioFrom,
  type CampaignDef,
  type CampaignSave,
} from '@engine/core/campaign';
import type { WorldClock } from '@engine/core/clock';
import type { CarriedRecord, CarryFrom } from '@engine/core/carried';
import type { ContentBundle } from '@engine/core/content/bundle';
import {
  rulesOffFor,
  type HeadlessOptions,
  type HeadlessStarts,
  type JsonObject,
  type RunStart,
} from '@engine/core/headless';
import type { MiniGameDef } from '@engine/core/minigame';
import { MissionHost, type MissionHostOptions } from '@engine/core/mission-host';
import {
  carriedRecord,
  fateOf,
  keyAlive,
  missionPort,
  missionsOf,
  rtsWorldPort,
  worldFromScenario,
  worldKeys,
  type World,
} from '@engine/sim/index';
import { rtsGame, rtsMissionHooks, sidesOf, type RtsGame } from '@kits/rts';
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
 * `engine/sim` world built from the map, the RTS kit's `rtsGame` (the raiders' plan; its world the
 * sim's `rtsWorldPort`, gap M27), and the engine's `MissionHost` with the sim's `missionPort`, the
 * kit's `rtsMissionHooks` (gap M18) and two data-driven mini games with their adapters: the topdown kit's mission room (`mission-room`, the sabotage) and the towerdefense
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
/** Picture px above the mission room (the topdown kit's `top`; its HUD band is drawn over the top wall). */
export const ROOM_TOP = 2;

export function miniGames(content: ContentBundle, opts: HeadlessOptions = {}): readonly MiniGameDef[] {
  return [
    missionRoom({
      rooms: siegeRooms(content),
      // Framed on the game's picture with the room 2 px from its top (Engine 0.16 F8): the round's
      // HUD lies over the room's top wall, and the whole room shows (presentation only).
      size: content.manifest.screen,
      top: ROOM_TOP,
      disabledRules: rulesOffFor(opts, 'topdown'),
    }),
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
 * One scenario entity at a glance, for the page and tests (since Engine 0.15 T9 no longer in the
 * snapshot: run files read `world.key.<key>`): alive (it exists and its fate is not
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

/** What the mini siege keeps beside its mission host: the world, the kit's game, keys and campaign. */
export interface MiniSiegeParts {
  /** The `engine/sim` world (the host's `world` is the host itself, for the shell). */
  readonly sim: World;
  readonly rts: RtsGame;
  /** The scenario's keys and their entity ids. */
  readonly keys: Readonly<Record<string, number>>;
  /** The factions `sides` always lists: the player's and the raiders'. */
  readonly factions: readonly string[];
  /** Where the game is in its campaign (Engine 0.13 T7). */
  readonly campaign: SiegeCampaignPlace;
}

/**
 * The game the tools play: the engine's `MissionHost` over the kit's `RtsGame` (Engine 0.15 T6,
 * gap M18: the host itself, no wrapper). Its options carry the RTS kit's `rtsMissionHooks`, so a
 * run file's `open` (and the page's launch) is refused `not_offered` while no opportunity offers
 * the mission, and the kit's view is refreshed after every mission step and commit. The host gives
 * every `HeadlessGame` hook (orders, mission steps, experience, the world's events and timeline,
 * recorded rounds) and its mission events (gap M21); this class adds only what reads the mini
 * siege's world: the snapshot is the host's (`{ world, kit, missions? }`) plus `sides` (the kit's
 * `sidesOf`), `named()` (every keyed scenario entity at a glance, for the page; not in the
 * snapshot since Engine 0.15 T9: run files read `world.key.<key>`) and the campaign save.
 */
export class MiniSiegeGame extends MissionHost {
  readonly sim: World;
  readonly rts: RtsGame;
  readonly keys: Readonly<Record<string, number>>;
  readonly factions: readonly string[];
  readonly campaign: SiegeCampaignPlace;

  constructor(parts: MiniSiegeParts, host: MissionHostOptions) {
    super(host);
    this.sim = parts.sim;
    this.rts = parts.rts;
    this.keys = parts.keys;
    this.factions = parts.factions;
    this.campaign = parts.campaign;
  }

  /**
   * The world clock now (Engine 0.16 F4): the campaign entry's `clock` moved on by the world tick
   * (`entryWorldClock`), or null for an entry without one. Presentation only: read by the picture
   * (`clockStatus` on every frame), never in the snapshot, a hash or the save.
   */
  clock(): WorldClock | null {
    const { def, save } = this.campaign;
    return entryWorldClock(def, campaignRun(def, save).entry, this.sim.tick);
  }

  /**
   * Whether the entry played now is over (Engine 0.15 T8, gap M35): the engine's one rule,
   * `entryOver` (`engine/core/campaign.ts`): its `ticks` reached with no mission open. The page
   * and `campaignSave()` both read it.
   */
  entryOver(): boolean {
    const entry = campaignRun(this.campaign.def, this.campaign.save).entry;
    return (
      entry !== null &&
      entryOver(entry, { worldTick: this.sim.tick, missionsOpen: missionsOf(this.sim).open().length })
    );
  }

  /**
   * The campaign save at the end of the entry played now (`HeadlessGame.campaignSave`, Engine 0.13
   * T7): the next position, the missions committed in this world added to the results, and the
   * carried record the next scenario's `from` asks for, built from the world now (null at the
   * ridge, the last entry). Reads only. Null until the entry is over ({@link entryOver}, gap M35)
   * and once the campaign is done. A stockpile that is gone carries as zeros, and a loss the
   * campaign file declares (`endIf`: the siege ends when the hall falls) is the engine's
   * `advanceCampaign`'s, told which keys are gone (gap M31): no rule of its own here.
   */
  campaignSave(): CampaignSave | null {
    const { def, save, next } = this.campaign;
    if (!this.entryOver()) return null;
    const missions = this.records().map((r) => ({
      mission: r.mission,
      outcome: r.outcome,
      resolution: r.resolution,
    }));
    const carried: CarriedRecord | null = next === null ? null : carriedRecord(this.sim, next, this.keys);
    const advanced = advanceCampaign(def, save, {
      missions,
      carried,
      gone: (key) => !keyAlive(this.sim, key),
    });
    if (!advanced.ok) throw new Error(`the mini siege's campaign save: ${advanced.error}`);
    return advanced.save;
  }

  /** Every keyed scenario entity at a glance, for the page and tests (not hashed). */
  named(): Record<string, NamedSummary> {
    const named: Record<string, NamedSummary> = {};
    for (const [key, id] of Object.entries(this.keys)) {
      const exists = this.sim.alive(id);
      const fate = exists ? fateOf(this.sim, id) : null;
      const at = exists ? (this.sim.get(id, 'Position') as { x: number; y: number } | undefined) : undefined;
      const health = exists ? (this.sim.get(id, 'Health') as { hp: number } | undefined) : undefined;
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

  override snapshot(): JsonObject {
    return {
      ...super.snapshot(),
      sides: sidesOf(this.rts.view(), this.factions) as unknown as JsonObject,
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
  const keys = worldKeys(world);
  const enemy = siegeEnemy(content);
  const rts = rtsGame({ world: rtsWorldPort(world), enemy, seed, disabledRules: opts.disabledRules });
  return new MiniSiegeGame(
    { sim: world, rts, keys, factions: [PLAYER, enemy.faction], campaign: place },
    {
      game: rts,
      port: missionPort(world),
      missions: siegeMissions(content),
      miniGames: miniGames(content, opts),
      adapters: ADAPTERS,
      ...rtsMissionHooks(rts),
    },
  );
}
