import type { ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessGame, HeadlessOptions, JsonObject, MissionStepRefusal } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { MiniGame, MiniGameDef } from '@engine/core/minigame';
import { MissionHost } from '@engine/core/mission-host';
import type { MissionRecord } from '@engine/core/missions';
import {
  applyOrder,
  fateOf,
  missionPort,
  Missions,
  scenarioKeys,
  worldFromScenario,
  type World,
} from '@engine/sim/index';
import { launchMission, rtsGame, sidesOf, type RtsGame } from '@kits/rts';
import { MISSION_ROOM, missionRoom, topdownMissionAdapter } from '@kits/topdown';
import { TD_DEFENCE, tdDefence, towerdefenseMissionAdapter } from '@kits/towerdefense';
import {
  PLAYER,
  siegeDefenceMaps,
  siegeEnemy,
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

/** The world built from the map, the types and `seed`. */
export function createWorld(content: ContentBundle, seed: number): World {
  return worldFromScenario(siegeScenario(content, seed));
}

/**
 * The game's mini games (`HeadlessEntry.miniGames`): the topdown kit's mission room over the rooms
 * and the towerdefense kit's `td-defence` over the walls' maps and towers (its frames at the game's
 * picture size, which the page's taps read through). `validate` checks each
 * mission's params with the one its `play` names.
 */
export function miniGames(content: ContentBundle): readonly MiniGameDef[] {
  return [
    missionRoom({ rooms: siegeRooms(content) }),
    tdDefence({
      maps: siegeDefenceMaps(content),
      towers: siegeTowers(content),
      size: content.manifest.screen,
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
 * The headless game contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and
 * `mutants`: kit rules switched off in `opts` go to the RTS kit.
 */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): MiniSiegeGame {
  const scenario = siegeScenario(content, seed);
  const world = worldFromScenario(scenario);
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
    miniGames: miniGames(content),
    adapters: ADAPTERS,
  });
  return new MiniSiegeGame(world, rts, host, keys, [PLAYER, enemy.faction]);
}
