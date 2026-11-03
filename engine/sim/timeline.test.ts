import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import type { MissionDef } from '../core/missions';
import { commitMission, delegateMission, openMission, playMission, settleMissions } from './mission';
import { loadWorld, saveWorld, type WorldSave } from './save';
import { scenarioKeys, worldFromScenario } from './scenario';
import { SYSTEM_SETS } from './system-sets';
import {
  compressClock,
  eventsSince,
  gameTickOf,
  logFrom,
  timelineEntries,
  timelineOf,
  timelineSchema,
  worldTimeline,
} from './timeline';
import type { Entity, World } from './world';

// The timeline record (Engine 0.14 T7, decision 4, item 250) over the siege and captive fixtures.

const DIR = new URL('./__fixtures__/', import.meta.url);
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as unknown;
const mission = (id: string): MissionDef => read(`${id}.mission.json`) as MissionDef;

function build(file: string, log?: { ticks: number }): { world: World; refs: Record<string, Entity> } {
  const json = read(file);
  return { world: worldFromScenario(json, log ? { log } : {}), refs: scenarioKeys(json) };
}

function open(world: World, refs: Record<string, Entity>, id: string): void {
  const r = openMission(world, mission(id), { refs });
  if (!r.ok) throw new Error(`${id}: ${r.error}`);
}

function steps(world: World, n: number): void {
  for (let i = 0; i < n; i++) {
    world.step();
    settleMissions(world);
  }
}

/** The siege with `raid` opened at tick 5, played `partial` and committed at 35, then run to 40. */
function raided(log?: { ticks: number }): World {
  const { world, refs } = build('siege.world.json', log);
  steps(world, 5);
  open(world, refs, 'raid');
  expect(playMission(world, 'raid', 'partial').ok).toBe(true);
  steps(world, 35);
  return world;
}

describe('timelineOf on the siege', () => {
  it('records the raid: open, frozen span, commit at its fixed tick with its outcome', () => {
    const record = worldTimeline(raided());
    expect(timelineSchema.parse(record)).toEqual(record);
    expect(record.worldTick).toBe(40);
    expect(record.logFrom).toBe(0);
    expect(record.clock).toBeNull();
    expect(record.frozen).toEqual([{ event: 'siege', by: 'mission:raid', from: 5, to: 35 }]);
    expect(record.missions).toEqual([
      {
        mission: 'raid',
        status: 'committed',
        openTick: 5,
        commitTick: 35,
        resolution: 'played',
        outcome: 'partial',
        experienceTicks: 0,
      },
    ]);
    expect(record.experience).toEqual([{ mission: 'raid', from: 5, ticks: 0 }]);
  });

  it('gives every opportunity its window and status history with causes', () => {
    const record = worldTimeline(raided());
    const byId = Object.fromEntries(record.opportunities.map((o) => [o.id, o]));
    expect(byId['night-raid']).toMatchObject({ mission: 'raid', opens: 0, closes: 60, status: 'taken' });
    expect(byId['night-raid']!.history).toEqual([
      { status: 'waiting', by: 'scenario', at: 0 },
      { status: 'offered', by: 'time', at: 0 },
      { status: 'taken', by: 'mission:raid', at: 5 },
    ]);
    // Taking the raid closed its exclusive rival.
    expect(byId['supply-run']!.status).toBe('closed');
    expect(byId['supply-run']!.history.at(-1)).toEqual({ status: 'closed', by: 'mission:raid', at: 5 });
    // The scout gap closed by time at 25.
    expect(byId['scout-gap']!.history.at(-1)).toMatchObject({ status: 'closed', by: 'time', at: 25 });
  });

  it('shows an open mission and a span still frozen', () => {
    const { world, refs } = build('siege.world.json');
    steps(world, 5);
    open(world, refs, 'raid');
    steps(world, 3);
    const record = worldTimeline(world);
    expect(record.frozen).toEqual([{ event: 'siege', by: 'mission:raid', from: 5, to: null }]);
    expect(record.missions).toEqual([
      {
        mission: 'raid',
        status: 'open',
        openTick: 5,
        commitTick: 35,
        resolution: null,
        outcome: null,
        experienceTicks: 0,
      },
    ]);
  });

  it('reads a save the same as the live world, and is the same every run', () => {
    const world = raided();
    const save = saveWorld(world) as unknown as WorldSave;
    expect(timelineOf({ world: save })).toEqual(worldTimeline(world));
    expect(canonicalJson(worldTimeline(raided()))).toBe(canonicalJson(worldTimeline(world)));
    const loaded = loadWorld(save, {
      components: SYSTEM_SETS.rts.components,
      systems: SYSTEM_SETS.rts.systems,
    });
    expect(worldTimeline(loaded)).toEqual(worldTimeline(world));
  });

  it('never changes the world', () => {
    const world = raided();
    const before = world.canonical();
    const log = world.events().length;
    worldTimeline(world);
    eventsSince(world, 0);
    expect(world.canonical()).toBe(before);
    expect(world.events()).toHaveLength(log);
  });

  it('keeps what a short log still holds, and says where it starts', () => {
    const record = worldTimeline(raided({ ticks: 3 }));
    expect(record.logFrom).toBe(37);
    // The span ended at 35, before the kept log: gone.
    expect(record.frozen).toEqual([]);
    // The taken raid still shows its state now as its one known step.
    const raid = record.opportunities.find((o) => o.id === 'night-raid');
    expect(raid?.history).toEqual([{ status: 'taken', by: 'mission:raid', at: 5 }]);
    // Committed records are world data: still there.
    expect(record.missions.map((m) => m.outcome)).toEqual(['partial']);
  });

  it("takes a game's own experience count", () => {
    const record = worldTimeline(raided(), { experience: [{ mission: 'raid', ticks: 240 }] });
    expect(record.experience).toEqual([{ mission: 'raid', from: 5, ticks: 240 }]);
  });
});

describe('timelineOf on the captive world', () => {
  it('records a capture, its follow-ups opening and a rescue taking one, in order', () => {
    const { world, refs } = build('captive.world.json');
    steps(world, 2);
    open(world, refs, 'ambush');
    expect(delegateMission(world, 'ambush').ok).toBe(true);
    const done = commitMission(world, 'ambush');
    expect(done.ok).toBe(true);
    steps(world, 2);
    open(world, refs, 'rescue-captain');
    const record = worldTimeline(world);
    expect(record.missions.map((m) => [m.mission, m.status, m.openTick, m.commitTick, m.outcome])).toEqual([
      ['ambush', 'committed', 2, 12, 'taken'],
      ['rescue-captain', 'open', 14, expect.any(Number), null],
    ]);
    const rescue = record.opportunities.find((o) => o.id === 'rescue-window');
    expect(rescue).toMatchObject({ opens: 12, closes: 52, status: 'taken' });
    expect(rescue?.history.map((h) => [h.status, h.by, h.at])).toEqual([
      ['dormant', 'scenario', 0],
      ['offered', 'mission:ambush', 12],
      ['taken', 'mission:rescue-captain', 14],
    ]);
    const entries = timelineEntries(record).filter((e) => e.kind !== 'opportunity');
    expect(entries.map((e) => [e.tick, e.kind, e.id, e.detail])).toEqual([
      [2, 'open', 'ambush', null],
      [12, 'commit', 'ambush', 'taken'],
      [14, 'open', 'rescue-captain', null],
    ]);
  });
});

describe('eventsSince and logFrom', () => {
  it('gives the kept changes from a tick, the oldest kept tick and the world tick', () => {
    const world = raided({ ticks: 3 });
    expect(logFrom(world)).toBe(37);
    const got = eventsSince(world, 0);
    expect(got.from).toBe(37);
    expect(got.tick).toBe(40);
    expect(got.changes.every((c) => (c['tick'] as number) >= 37)).toBe(true);
    expect(eventsSince(world, 39).changes.every((c) => (c['tick'] as number) >= 39)).toBe(true);
  });

  it('is null (and from the world tick) when the world keeps no log', () => {
    const world = worldFromScenario(read('siege.world.json'), { log: { enabled: false } });
    world.step();
    expect(logFrom(world)).toBeNull();
    expect(eventsSince(world, 0)).toEqual({ from: 1, tick: 1, changes: [] });
  });
});

describe('the clock', () => {
  it('keeps the first, last and every rate change, and maps world ticks to game ticks', () => {
    // The world moves to 40, stands still for 10 game ticks (a played round), then moves on.
    const samples = Array.from({ length: 61 }, (_, g) => ({
      game: g,
      world: g <= 40 ? g : g <= 50 ? 40 : g - 10,
    }));
    const clock = compressClock(samples);
    expect(clock).toEqual([
      { game: 0, world: 0 },
      { game: 40, world: 40 },
      { game: 50, world: 40 },
      { game: 60, world: 50 },
    ]);
    expect(gameTickOf(clock, 0)).toBe(0);
    expect(gameTickOf(clock, 20)).toBe(20);
    expect(gameTickOf(clock, 40)).toBe(40);
    expect(gameTickOf(clock, 41)).toBe(51);
    expect(gameTickOf(clock, 50)).toBe(60);
    expect(gameTickOf(clock, 51)).toBeNull();
  });

  it('puts game ticks on the entries', () => {
    const clock = [
      { game: 0, world: 0 },
      { game: 5, world: 5 },
      { game: 25, world: 5 },
      { game: 60, world: 40 },
    ];
    const entries = timelineEntries(worldTimeline(raided(), { clock }));
    const commit = entries.find((e) => e.kind === 'commit');
    expect(commit).toMatchObject({ tick: 35, game: 55, id: 'raid', detail: 'partial' });
    expect(entries.find((e) => e.kind === 'open')).toMatchObject({ tick: 5, game: 5 });
  });
});
