import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validate } from '@engine/core/content/validate';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { presentFrameSchema } from '@engine/core/present';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { MissionHost } from '@engine/core/mission-host';
import type { MissionDef } from '@engine/core/missions';
import {
  missionPort,
  missionsOf,
  rtsWorldPort,
  scenarioKeys,
  worldFromScenario,
  type RtsPort,
} from '@engine/sim/index';
import {
  commandAt,
  enemyPlanSchema,
  launchMission,
  missionButtons,
  presentWorld,
  RtsPresentState,
  rtsGame,
  Selection,
  trainCommand,
  type RtsGame,
  type RtsWorldPort,
} from '@kits/rts';

// The RTS kit driven over a real engine/sim world, as a game's glue will drive it (Engine 0.9 T10).
// Kits may not import the sim, so this check lives here, outside every layer: the glue in a few
// lines, the scripted enemy and the player's commands as orders, presentation each tick, and a
// replay of the player's recorded orders giving the same state hashes.

const SCENARIO = JSON.parse(
  readFileSync(new URL('../../engine/sim/__fixtures__/battle.world.json', import.meta.url), 'utf8'),
) as unknown;

const PLAN = enemyPlanSchema.parse({
  faction: 'blue',
  steps: [
    { id: 'hold', order: { type: 'move', units: {}, area: { x: 11, y: 6, w: 3, h: 3 } } },
    {
      id: 'attack',
      at: 30,
      when: { count: 'units', side: 'enemy', op: 'gte', value: 4 },
      order: { type: 'attack', units: {}, target: 'nearest-enemy' },
    },
  ],
});

/** The glue: a sim world behind the kit's port. */
function game(seed: number): RtsGame {
  const world = worldFromScenario(SCENARIO);
  return rtsGame({
    world: rtsWorldPort(world),
    enemy: PLAN,
    seed,
  });
}

const hash = (g: RtsGame) =>
  createHash('sha256').update(canonicalJson(g.snapshot())).digest('hex').slice(0, 16);

describe("engine/sim's rtsWorldPort (gap M27)", () => {
  it("is the RTS kit's RtsWorldPort by shape, both ways, and carries out orders, refusals and steps", () => {
    const world = worldFromScenario(SCENARIO);
    // The sim may not import the kit (nor the kit the sim): the two types meet only here.
    const port: RtsWorldPort = rtsWorldPort(world);
    const back: RtsPort = port;
    expect(back.snapshot()).toEqual(world.snapshot());
    expect(port.applyOrder({ id: 1, faction: 'red', type: 'stop', units: [5] })).toEqual({ ok: true });
    const refused = port.applyOrder({ id: 2, faction: 'red', type: 'stop', units: [999] });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error).toMatch(/^order 2:/);
    port.step();
    expect(world.tick).toBe(1);
  });
});

describe('kits/rts over an engine/sim world', () => {
  it('plays a battle from commands and the scripted enemy, presents every tick, and replays to the same hashes', () => {
    const live = game(3);
    const sel = new Selection('red');
    const state = new RtsPresentState();
    const hashes: string[] = [hash(live)];
    for (let t = 0; t < 160; t++) {
      const view = live.view();
      if (t === 0) {
        sel.set([5]);
        const gather = commandAt(view, sel, { x: 4 * 16 + 8, y: 8 }, 16)!; // the gold node at (4, 0)
        expect(gather.type).toBe('gather');
        expect(live.issue(gather).error).toBeNull();
      }
      if (t === 2) {
        sel.set([3]);
        expect(live.issue(trainCommand(view, sel, 'worker')!).error).toBeNull();
      }
      if (t === 40) {
        sel.set(view.units.filter((u) => u.faction === 'red').map((u) => u.id));
        live.issue(commandAt(view, sel, { x: 9 * 16, y: 6 * 16 }, 16)!);
      }
      const frame = presentWorld(view, {
        faction: 'red',
        size: { width: 320, height: 240 },
        selection: sel.ids(),
        state,
      });
      expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
      live.step();
      hashes.push(hash(live));
    }
    const sources = new Set(live.log().map((e) => e.source));
    expect(sources).toEqual(new Set(['player', 'enemy']));
    expect(live.log().find((e) => e.source === 'enemy' && e.order.type === 'attack')).toBeDefined();

    const recorded = live.recorded();
    const again = game(3);
    const replayed: string[] = [hash(again)];
    for (let t = 0; t < 160; t++) {
      for (const { tick, ...o } of recorded) if (tick === t) again.order(o as unknown as JsonObject);
      again.step();
      replayed.push(hash(again));
    }
    expect(replayed).toEqual(hashes);
    expect(again.log()).toEqual(live.log());
  });
});

// Missions in the kit (Engine 0.11 T6, item 175) over the siege fixture: the kit reads the offer
// and the open mission from the real sim's snapshot, its launch command goes through a
// `MissionHost` (the sim decides), and its frames tag the frozen event and mark the offer.

const siegeFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../engine/sim/__fixtures__/${name}`, import.meta.url), 'utf8'),
  ) as unknown;
const SIEGE = siegeFixture('siege.world.json');
const RAID = siegeFixture('raid.mission.json') as MissionDef;
const SIZE = { width: 320, height: 240 };
const NO_INPUT = new ScriptedInput({ steps: [] });

/**
 * The siege world (its opportunities: `night-raid` for the raid, ticks 0-60; `supply-run` for the
 * convoy, from tick 10, exclusive with it; `scout-gap`; the dormant `rescue-window`), the kit's game
 * over it and a host for the raid.
 */
function siege() {
  const world = worldFromScenario(SIEGE);
  const rts = rtsGame({
    world: rtsWorldPort(world),
    seed: 7,
  });
  const host = new MissionHost({
    game: rts,
    port: missionPort(world, { refs: scenarioKeys(SIEGE) }),
    missions: [RAID],
    miniGames: [],
    adapters: {},
  });
  return { world, rts, host };
}

describe('kits/rts missions over an engine/sim world', () => {
  it('a world without missions (the battle fixture) reads as none', () => {
    const view = game(3).view();
    expect(view.missions).toEqual({ offered: [], open: [], committed: [], gated: [], frozen: [] });
    expect(missionButtons(view)).toEqual([]);
  });

  it('offers, launches through the host, freezes and marks, and commits at the fixed tick', () => {
    const { world, rts, host } = siege();
    const refs = scenarioKeys(SIEGE);
    host.step(NO_INPUT);
    host.step(NO_INPUT);
    const offered = rts.view();
    expect(offered.tick).toBe(2);
    expect(offered.missions.offered).toEqual([
      { opportunity: 'night-raid', mission: 'raid', closes: 60 },
      { opportunity: 'scout-gap', mission: 'scout', closes: 25 },
    ]);
    expect(missionButtons(offered)).toEqual(['raid', 'scout']);
    // the convoy's window has not opened yet: the kit refuses it without asking the host
    expect(launchMission(offered, 'convoy', host)).toMatchObject({
      ok: false,
      request: null,
      code: 'not_offered',
    });
    // scout is offered, but this game has no such mission: the host's refusal is reported
    expect(launchMission(offered, 'scout', host)).toMatchObject({ ok: false, code: 'unknown_mission' });
    const shown = presentWorld(offered, { faction: 'red', size: SIZE, missions: [RAID] });
    expect(validate('frame.json', shown, presentFrameSchema).errors).toEqual([]);
    const markers = shown.entities.filter((e) => e.kind === 'mission-offer');
    expect(markers.map((e) => e.tags)).toEqual([
      ['mission:raid', 'opportunity:night-raid', `target:${refs['ram']}`],
    ]);
    expect(shown.status).toMatchObject({ offers: 2, offer: RAID.title });

    // the launch: the host opens it in the world
    expect(launchMission(offered, 'raid', host)).toEqual({
      ok: true,
      request: { mission: 'raid', opportunity: 'night-raid' },
    });
    expect(missionsOf(world).status('raid')).toBe('open');
    rts.refresh(); // the host changed the world outside the kit's port
    const open = rts.view();
    expect(open.missions.offered.map((o) => o.opportunity)).toEqual(['scout-gap']);
    expect(open.missions.open).toMatchObject([
      { id: 'raid', openTick: 2, commitTick: 2 + RAID.worldTimeCost, resolved: false },
    ]);
    expect(open.missions.frozen).toEqual(['siege']);
    const members = ['s1', 's2', 'ram', 'tower', 'catapult'].map((k) => refs[k]!).sort((a, b) => a - b);
    expect(open.units.filter((u) => u.frozen).map((u) => u.id)).toEqual(members);
    // a second launch: its opportunity is taken, so the kit refuses it without asking
    expect(launchMission(open, 'raid', host)).toMatchObject({ ok: false, code: 'not_offered' });

    // while open: frozen units are tagged, the site keeps going up, the HUD counts down
    const commit = 2 + RAID.worldTimeCost;
    const site = () => rts.view().buildings.find((b) => b.id === refs['site'])!.construction!.progress;
    const start = site();
    for (let t = 0; t < 10; t++) host.step(NO_INPUT);
    const frame = presentWorld(rts.view(), { faction: 'red', size: SIZE, missions: [RAID] });
    expect(validate('frame.json', frame, presentFrameSchema).errors).toEqual([]);
    expect(frame.entities.filter((e) => e.tags.includes('frozen')).map((e) => e.id)).toEqual(
      members.map((id) => `unit-${id}`),
    );
    expect(frame.entities.some((e) => e.kind === 'mission-offer')).toBe(false);
    expect(frame.status).toMatchObject({
      mission: RAID.title,
      missionCommit: commit,
      missionLeft: commit - 12,
    });
    expect(site()).toBeGreaterThan(start);

    // delegated, it commits at its fixed tick and the event thaws
    expect(host.delegate('raid')).toBeNull();
    while (rts.tick < commit) host.step(NO_INPUT);
    const after = rts.view();
    expect(after.missions.open).toEqual([]);
    expect(after.missions.committed).toEqual(['raid']);
    expect(after.missions.frozen).toEqual([]);
    expect(after.units.some((u) => u.frozen)).toBe(false);
  });
});
