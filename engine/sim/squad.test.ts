import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Member, STANDARD_COMPONENTS, Squad, type Role } from './components';
import { applyLosses, joinSquad, lossOrder, pickMembers, squadMembers, squadStrength } from './squad';
import { createWorld, type Entity, type World } from './world';

/** A squad of `strength` with named people (name, role) added in order. */
function squadWorld(
  strength: number,
  people: [string, Role][],
): { world: World; squad: Entity; ids: Entity[] } {
  const world = createWorld(3, { components: STANDARD_COMPONENTS });
  const squad = world.spawn();
  world.add(squad, Squad, { strength: strength - people.length, captain: null, members: [] });
  const ids = people.map(([name, role]) => {
    const id = world.spawn();
    world.add(id, Member, { name, squad: null, role });
    joinSquad(world, squad, id);
    return id;
  });
  return { world, squad, ids };
}

const PEOPLE: [string, Role][] = [
  ['Bran', 'regular'],
  ['Cara', 'captain'],
  ['Dain', 'hero'],
  ['Edda', 'regular'],
  ['Finn', 'hero'],
];

describe('squads', () => {
  it('reports one strength number and names its members', () => {
    const { world, squad, ids } = squadWorld(20, PEOPLE);
    expect(squadStrength(world, squad)).toBe(20);
    expect(squadMembers(world, squad).map((m) => m.name)).toEqual(['Bran', 'Cara', 'Dain', 'Edda', 'Finn']);
    expect(world.get(squad, Squad)?.captain).toBe(ids[1]);
    expect(world.get(ids[0] as Entity, Member)?.squad).toBe(squad);
  });

  it('joinSquad: a new captain demotes the old one to hero', () => {
    const { world, squad, ids } = squadWorld(5, PEOPLE);
    const cap = world.spawn();
    world.add(cap, Member, { name: 'Gwen', squad: null, role: 'captain' });
    joinSquad(world, squad, cap);
    expect(world.get(squad, Squad)?.captain).toBe(cap);
    expect(world.get(ids[1] as Entity, Member)?.role).toBe('hero');
    expect(squadStrength(world, squad)).toBe(6);
    expect(() => joinSquad(world, squad, cap)).toThrow(/already in squad/);
  });

  it('picks members deterministically for a seed', () => {
    const { world, squad } = squadWorld(20, PEOPLE);
    const pick = (seed: number): string[] => pickMembers(world, squad, 2, new Rng(seed)).map((m) => m.name);
    expect(pick(7)).toEqual(pick(7));
    expect(pick(7)).toHaveLength(2);
    const seen = new Set(Array.from({ length: 40 }, (_, s) => pick(s + 1).join()));
    expect(seen.size).toBeGreaterThan(1);
    expect(pickMembers(world, squad, 9, new Rng(1)).map((m) => m.name)).toHaveLength(5);
    expect(pickMembers(world, squad, 0, new Rng(1))).toEqual([]);
    // The same world RNG state picks the same people.
    const a = createWorld(11).rng;
    const b = createWorld(11).rng;
    expect(pickMembers(world, squad, 3, a)).toEqual(pickMembers(world, squad, 3, b));
  });

  it('loses unnamed people first, then regulars, heroes and the captain last, newest first', () => {
    const { world, squad, ids } = squadWorld(10, PEOPLE);
    const [bran, cara, dain, edda, finn] = ids as [Entity, Entity, Entity, Entity, Entity];
    expect(lossOrder(world, squad)).toEqual([edda, bran, finn, dain, cara]);
    expect(applyLosses(world, squad, 5)).toEqual([]);
    expect(squadStrength(world, squad)).toBe(5);
    expect(squadMembers(world, squad)).toHaveLength(5);
    expect(applyLosses(world, squad, 3)).toEqual([edda, bran, finn]);
    expect(squadStrength(world, squad)).toBe(2);
    expect(squadMembers(world, squad).map((m) => m.name)).toEqual(['Cara', 'Dain']);
    expect(world.get(edda, Member)?.squad).toBeNull();
    expect(world.alive(edda)).toBe(true);
    expect(applyLosses(world, squad, 5)).toEqual([dain, cara]);
    expect(world.get(squad, Squad)).toEqual({ strength: 0, captain: null, members: [] });
  });

  it('rejects bad counts and non-squads', () => {
    const { world, squad, ids } = squadWorld(3, PEOPLE.slice(0, 1));
    expect(() => applyLosses(world, squad, -1)).toThrow(/whole number/);
    expect(() => pickMembers(world, squad, 1.5, new Rng(1))).toThrow(/whole number/);
    expect(() => squadStrength(world, ids[0] as Entity)).toThrow(/not a squad/);
  });
});
