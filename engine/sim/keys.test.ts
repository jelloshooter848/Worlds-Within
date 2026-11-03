import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import { keepKeys, worldKeys } from './keys';
import { missionRecords, missionsOf, openMission, delegateMission, commitMission } from './mission';
import { missionPort } from './mission-port';
import { loadWorld, saveWorld } from './save';
import { scenarioKeys, worldFromScenario } from './scenario';
import { SYSTEM_SETS } from './system-sets';
import { createWorld } from './world';

// The world's key table (Engine 0.15 T7, gaps M10, D6, M28; docs/BUILD-LOG.md, Engine 0.15,
// decision 8): kept beside the world, never in its snapshot, saved and loaded, and handed to a
// mission's round by the port.

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`__fixtures__/${name}`, import.meta.url), 'utf8'));
const SIEGE = read('siege.world.json');
const RAID = read('raid.mission.json');
const RTS = SYSTEM_SETS.rts;

describe('the world key table', () => {
  it('is every scenario key with its entity id, the same as scenarioKeys, and outside the snapshot', () => {
    const world = worldFromScenario(SIEGE);
    expect(worldKeys(world)).toEqual(scenarioKeys(SIEGE));
    expect(worldKeys(world)['ram']).toBeGreaterThan(1);
    expect(Object.isFrozen(worldKeys(world))).toBe(true);
    // The snapshot is unchanged by the table: the same text as a world given no keys.
    const bare = worldFromScenario(SIEGE);
    keepKeys(bare, {});
    expect(worldKeys(bare)).toEqual({});
    expect(bare.canonical()).toBe(world.canonical());
    expect(worldKeys(createWorld(1))).toEqual({});
  });

  it('is kept in a save and loaded back; a save without it still loads', () => {
    const world = worldFromScenario(SIEGE);
    world.step();
    const save = saveWorld(world);
    expect(save['keys']).toEqual({ ...worldKeys(world) });
    const back = loadWorld(save, { components: RTS.components, systems: RTS.systems });
    expect(worldKeys(back)).toEqual(worldKeys(world));
    expect(canonicalJson(saveWorld(back))).toBe(canonicalJson(save));
    const { keys: _keys, ...old } = save;
    const oldWorld = loadWorld(old, { components: RTS.components, systems: RTS.systems });
    expect(worldKeys(oldWorld)).toEqual({});
    expect(oldWorld.canonical()).toBe(world.canonical());
    expect(() =>
      loadWorld({ ...save, keys: { ghost: 9999 } }, { components: RTS.components, systems: RTS.systems }),
    ).toThrow(/keys\.ghost: must be below nextId/);
  });

  it('opens a mission with the table as refs, and the port hands the whole table to the round', () => {
    const world = worldFromScenario(SIEGE);
    const port = missionPort(world);
    expect(port.keys?.()).toEqual(worldKeys(world));
    const opened = port.open(RAID as never);
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.keys).toEqual(worldKeys(world));
    // The open mission's refs are still only the keys its effects name.
    const refs = missionsOf(world).open()[0]!.refs;
    expect(Object.keys(refs).length).toBeLessThan(Object.keys(worldKeys(world)).length);
    expect(Object.keys(refs).every((k) => worldKeys(world)[k] === refs[k])).toBe(true);
  });

  it('gives the same open mission and hash as refs passed by hand', () => {
    const a = worldFromScenario(SIEGE);
    const b = worldFromScenario(SIEGE);
    expect(openMission(a, RAID, { refs: scenarioKeys(SIEGE) }).ok).toBe(true);
    const opened = missionPort(b).open(RAID as never);
    expect(opened.ok).toBe(true);
    expect(b.canonical()).toBe(a.canonical());
  });

  it('reads the committed records through the sim (M28)', () => {
    const world = worldFromScenario(SIEGE);
    expect(missionRecords(world)).toEqual([]);
    expect(openMission(world, RAID, { refs: worldKeys(world) }).ok).toBe(true);
    expect(delegateMission(world, 'raid').ok).toBe(true);
    expect(commitMission(world, 'raid').ok).toBe(true);
    expect(missionRecords(world)).toEqual(missionsOf(world).committed());
    expect(missionRecords(world).map((r) => r.mission)).toEqual(['raid']);
  });
});
