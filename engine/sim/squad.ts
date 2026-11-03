import type { Rng } from '../core/rng';
import { Member, ROLES, Squad, type MemberData, type Role, type SquadData } from './components';
import type { Entity, World } from './world';

/**
 * Squads that are one number for the RTS view and still name the people in them.
 *
 * A squad entity has `Squad` (`strength`, `captain`, `members`); each named person is an entity
 * with `Member` (`name`, `squad`, `role`). `strength` counts everyone; the named members are some
 * of them and the rest are unnamed rank and file. The RTS view reads `squadStrength`; a
 * personal-scale mode reads `squadMembers` or picks people out with `pickMembers`.
 *
 * **Loss order** (`applyLosses`): unnamed rank and file go first. Only when the strength would drop
 * below the number of named members do named people leave, in this order: regulars, then heroes,
 * then the captain last; within a role, the highest entity id (the newest) goes first. The order
 * uses no randomness, so the same losses always take the same people.
 */

/** A named person in a squad. */
export interface SquadMember {
  readonly id: Entity;
  readonly name: string;
  readonly role: Role;
}

function squadOf(world: World, squad: Entity): SquadData {
  const data = world.get(squad, Squad);
  if (!data) throw new Error(`entity ${squad} is not a squad`);
  return data;
}

function memberOf(world: World, person: Entity): MemberData {
  const data = world.get(person, Member);
  if (!data) throw new Error(`entity ${person} is not a named person (no Member)`);
  return data;
}

/** The squad's strength: how many people are in it, named or not. The one number the RTS view shows. */
export function squadStrength(world: World, squad: Entity): number {
  return squadOf(world, squad).strength;
}

/** The squad's named people, ascending by entity id. */
export function squadMembers(world: World, squad: Entity): SquadMember[] {
  return squadOf(world, squad).members.map((id) => {
    const m = memberOf(world, id);
    return { id, name: m.name, role: m.role };
  });
}

/**
 * `n` of the squad's named people, picked with `rng` (pass `world.rng` inside a system): the same
 * RNG state and squad always give the same people. Candidates are taken in ascending id order and
 * drawn one at a time (a partial Fisher-Yates shuffle); the result is ascending by id. If `n` is at
 * least the number of named people, all of them are returned and no numbers are drawn.
 */
export function pickMembers(world: World, squad: Entity, n: number, rng: Rng): SquadMember[] {
  if (!Number.isInteger(n) || n < 0) throw new Error(`pickMembers needs a whole number, got ${n}`);
  const pool = squadMembers(world, squad);
  if (n >= pool.length) return pool;
  for (let i = 0; i < n; i++) {
    const j = i + rng.int(pool.length - i);
    const a = pool[i] as SquadMember;
    pool[i] = pool[j] as SquadMember;
    pool[j] = a;
  }
  return pool.slice(0, n).sort((a, b) => a.id - b.id);
}

/**
 * Put a named person into a squad, raising its strength by one. A `captain` replaces the old
 * captain, who stays in the squad as a hero. Throws if the person is already in a squad.
 */
export function joinSquad(world: World, squad: Entity, person: Entity): void {
  const s = squadOf(world, squad);
  const m = memberOf(world, person);
  if (m.squad !== null) throw new Error(`entity ${person} is already in squad ${m.squad}`);
  const members = [...s.members, person].sort((a, b) => a - b);
  let captain = s.captain;
  if (m.role === 'captain') {
    if (captain !== null) world.add(captain, Member, { ...memberOf(world, captain), role: 'hero' });
    captain = person;
  }
  world.add(squad, Squad, { strength: s.strength + 1, captain, members });
  world.add(person, Member, { ...m, squad });
}

/**
 * Take `n` losses: strength drops by `n` (not below 0) and, if fewer people are left than are
 * named, named members leave in the documented loss order (see the top of this file). They stay
 * in the world with `squad` set to null; whether they died, fled or were captured is for the
 * caller's rules. Returns the ids of the people who left, in the order they left.
 */
export function applyLosses(world: World, squad: Entity, n: number): Entity[] {
  if (!Number.isInteger(n) || n < 0) throw new Error(`applyLosses needs a whole number, got ${n}`);
  const s = squadOf(world, squad);
  const strength = Math.max(0, s.strength - n);
  const leaving = lossOrder(world, squad).slice(0, Math.max(0, s.members.length - strength));
  for (const id of leaving) world.add(id, Member, { ...memberOf(world, id), squad: null });
  const gone = new Set(leaving);
  world.add(squad, Squad, {
    strength,
    captain: s.captain !== null && gone.has(s.captain) ? null : s.captain,
    members: s.members.filter((id) => !gone.has(id)),
  });
  return leaving;
}

/**
 * Take one named person out of their squad: its strength drops by one, they leave `members` (and
 * `captain` when it was them) and their `Member.squad` becomes null. A person in no squad is left
 * as they are; a person whose squad entity is gone only has `squad` cleared. Returns whether a
 * squad lost them. Used when a named person dies or is captured (`fate.ts`).
 */
export function leaveSquad(world: World, person: Entity): boolean {
  const m = memberOf(world, person);
  if (m.squad === null) return false;
  const s = world.alive(m.squad) ? world.get(m.squad, Squad) : undefined;
  if (s && s.members.includes(person)) {
    world.add(m.squad, Squad, {
      strength: Math.max(0, s.strength - 1),
      captain: s.captain === person ? null : s.captain,
      members: s.members.filter((id) => id !== person),
    });
  }
  world.add(person, Member, { ...m, squad: null });
  return s !== undefined && s.members.includes(person);
}

/** The squad's named people in the order losses take them: regulars, heroes, captain; newest first. */
export function lossOrder(world: World, squad: Entity): Entity[] {
  const s = squadOf(world, squad);
  const rank = (id: Entity): number =>
    id === s.captain ? ROLES.length : ROLES.indexOf(memberOf(world, id).role);
  return [...s.members].sort((a, b) => rank(a) - rank(b) || b - a);
}
