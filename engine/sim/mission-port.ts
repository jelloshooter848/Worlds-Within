import type { JsonObject } from '../core/headless';
import type { MissionWorldPort } from '../core/mission-host';
import { Rng } from '../core/rng';
import {
  delegateMission,
  missionSnapshot,
  openMission,
  playMission,
  quitMission,
  settleMissions,
  type MissionRefused,
} from './mission';
import { eventsSince, worldTimeline } from './timeline';
import type { Entity, World } from './world';

/**
 * The world side of live mission hosting (Engine 0.11, item 173): a `MissionWorldPort`
 * (`engine/core/mission-host.ts`) over `world`, so a game's glue fills a `MissionHost` with one
 * call. Each method is the lifecycle call of the same name (`mission.ts`): `open` is `openMission`
 * with `refs` (the scenario's keys, `scenarioKeys`) and also gives the round's seed,
 * `Rng.derived(world.seed, "round:<id>").next()`, fixed by the seed and the mission id alone (it
 * never draws from `world.rng`); `play` is `playMission` with the result's report; `settle` is
 * `settleMissions` (the ids committed); `snapshot` and `step` are the world's; `events` and
 * `timeline` (Engine 0.14 T7) are `eventsSince` and `worldTimeline`. Refusals keep the sim's codes.
 */
export function missionPort(
  world: World,
  opts: { refs?: Readonly<Record<string, Entity>> } = {},
): MissionWorldPort {
  const refused = (r: MissionRefused) => ({ ok: false as const, code: r.code, error: r.error });
  const done = (r: { ok: true } | MissionRefused) => (r.ok ? { ok: true as const } : refused(r));
  return {
    open(def) {
      const opened = openMission(world, def, opts.refs ? { refs: opts.refs } : {});
      if (!opened.ok) return refused(opened);
      return {
        ok: true,
        snapshot: opened.snapshot,
        commitTick: opened.commitTick,
        seed: roundSeed(world.seed, opened.mission.id),
      };
    },
    delegate: (id) => done(delegateMission(world, id)),
    play: (id, result) => done(playMission(world, id, result.report ?? result.outcome)),
    quit: (id) => done(quitMission(world, id)),
    settle: () => settleMissions(world).map((r) => r.mission),
    snapshot: () => missionSnapshot(world) as JsonObject,
    step: () => world.step(),
    events: (sinceTick) => eventsSince(world, sinceTick),
    timeline: (experience) => worldTimeline(world, { experience }) as unknown as JsonObject,
  };
}

/** The seed of mission `id`'s round in a world seeded `seed`. */
export function roundSeed(seed: number, id: string): number {
  return Rng.derived(seed, `round:${id}`).next();
}
