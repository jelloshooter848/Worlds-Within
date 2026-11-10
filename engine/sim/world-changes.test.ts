import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MissionDef } from '../core/missions';
import { changeLines } from '../core/world-changes';
import { Health, Member } from './components';
import { capturePerson, killPerson } from './fate';
import { worldKeys } from './keys';
import { commitMission, delegateMission, openMission } from './mission';
import { worldFromScenario } from './scenario';
import { missionCardFacts, worldChanges } from './world-changes';

// What changed in a world since a tick (Engine 0.16 F5): read from the event log, its causes and
// the key table, never written. The mini siege's delegated, played and quit runs are checked
// through the page's screens in `games/samples/mini-siege/mission-screens.test.ts`.

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`__fixtures__/${name}`, import.meta.url), 'utf8'));
const SIEGE = read('siege.world.json');
const RAID = read('raid.mission.json') as MissionDef;

function world() {
  const w = worldFromScenario(SIEGE);
  return { w, keys: worldKeys(w) };
}

describe('worldChanges', () => {
  it('leaves out the changes that built the world', () => {
    const { w } = world();
    expect(w.events(0).length).toBeGreaterThan(0);
    expect(worldChanges(w, 0)).toEqual({
      since: 0,
      tick: 0,
      losses: [],
      people: [],
      buildings: [],
      records: [],
    });
  });

  it("lists a mission's record and the units its effects destroyed, by faction", () => {
    const { w, keys } = world();
    w.step();
    const open = openMission(w, RAID, { refs: keys });
    expect(open.ok).toBe(true);
    expect(delegateMission(w, 'raid').ok).toBe(true);
    while (w.tick < 31) w.step();
    expect(commitMission(w, 'raid').ok).toBe(true);
    const changes = worldChanges(w, 1);
    expect(changes.records.map((r) => r.mission)).toEqual(['raid']);
    const destroyed = changes.records[0]!.effects.filter((e) => e.type === 'destroy').map((e) => e.entity);
    const blue = changes.losses.find((l) => l.faction === 'blue');
    expect(blue?.units.map((u) => u.key)).toEqual(expect.arrayContaining(destroyed));
    expect(blue?.units.every((u) => u.type === 'engine')).toBe(true);
    // Changes before the tick asked for are left out.
    expect(worldChanges(w, w.tick + 1).records).toEqual([]);
  });

  it('lists buildings damaged and destroyed, with the hit points lost', () => {
    const { w, keys } = world();
    w.withCause('test', (x) => {
      x.add(keys['hall']!, Health, { hp: 300, max: 400 });
      x.add(keys['hall']!, Health, { hp: 280, max: 400 });
      x.destroy(keys['site']!);
    });
    const { buildings } = worldChanges(w, 0);
    expect(buildings).toEqual([
      {
        entity: keys['hall'],
        key: 'hall',
        kind: 'hall',
        faction: 'red',
        destroyed: false,
        hp: 280,
        max: 400,
        lost: 120,
      },
      {
        entity: keys['site'],
        key: 'site',
        kind: 'barracks',
        faction: 'red',
        destroyed: true,
        hp: 0,
        max: 200,
        lost: 1,
      },
    ]);
    expect(changeLines(worldChanges(w, 0))).toEqual(['Hall: 120 hp lost (280/400)', 'Site: destroyed']);
  });

  it('lists captives and the dead among named people, the dead also as losses', () => {
    const { w, keys } = world();
    const s1 = keys['s1']!;
    const s2 = keys['s2']!;
    w.withCause('scenario', (x) => {
      x.add(s1, Member, { name: 'Sergeant Ash', squad: null, role: 'hero' });
      x.add(s2, Member, { name: 'Pike', squad: null, role: 'regular' });
    });
    expect(capturePerson(w, s1, { cause: 'test', by: 'blue' }).ok).toBe(true);
    expect(killPerson(w, s2, { cause: 'test', by: 'blue' }).ok).toBe(true);
    const changes = worldChanges(w, 0);
    expect(changes.people).toEqual([
      {
        entity: s1,
        key: 's1',
        name: 'Sergeant Ash',
        faction: 'red',
        was: 'active',
        fate: 'captured',
        by: 'blue',
      },
      { entity: s2, key: 's2', name: 'Pike', faction: 'red', was: 'active', fate: 'dead', by: 'blue' },
    ]);
    expect(changes.losses).toEqual([
      { faction: 'red', units: [{ entity: s2, key: 's2', name: 'Pike', type: 'soldier' }] },
    ]);
    expect(changeLines(changes)).toEqual([
      'Red: Pike',
      'Sergeant Ash: captured by blue',
      'Pike: dead by blue',
    ]);
  });

  it('reads only: the world is the same text before and after', () => {
    const { w } = world();
    for (let i = 0; i < 5; i++) w.step();
    const before = w.canonical();
    worldChanges(w, 0);
    missionCardFacts(w, RAID);
    expect(w.canonical()).toBe(before);
  });
});

describe('missionCardFacts', () => {
  it("names the foes the params pick in the mission's event, and the window's ticks left", () => {
    const { w } = world();
    w.step();
    w.step();
    expect(missionCardFacts(w, RAID)).toEqual({ hero: null, foes: '3 engine', ticksLeft: 58 });
  });

  it('names the hero the params pick, and none for params of another shape', () => {
    const { w, keys } = world();
    w.withCause('scenario', (x) =>
      x.add(keys['s1']!, Member, { name: 'Sergeant Ash', squad: null, role: 'hero' }),
    );
    const hero: MissionDef = {
      ...RAID,
      params: {
        hero: { select: { faction: 'red', member: 'hero' } },
        foes: [{ select: { types: ['engine'] } }],
      },
    };
    expect(missionCardFacts(w, hero)).toMatchObject({ hero: 'Sergeant Ash', foes: '3 engine' });
    expect(missionCardFacts(w, { ...RAID, id: 'other', params: { waves: 3 } })).toEqual({
      hero: null,
      foes: '',
      ticksLeft: null,
    });
  });
});

describe("a mission's card text (Engine 0.16 F5)", () => {
  it('is never stored in the world: opening a mission with a text gives the same world', () => {
    const plain = world();
    const told = world();
    expect(openMission(plain.w, RAID, { refs: plain.keys }).ok).toBe(true);
    expect(openMission(told.w, { ...RAID, text: 'Burn them all before dawn.' }, { refs: told.keys }).ok).toBe(
      true,
    );
    expect(told.w.canonical()).toBe(plain.w.canonical());
  });
});
