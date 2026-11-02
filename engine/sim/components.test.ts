import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../core/headless';
import {
  Construction,
  Health,
  Inventory,
  Member,
  Owner,
  Patrol,
  Position,
  STANDARD_COMPONENTS,
  Squad,
  Worker,
  inventoryAdd,
} from './components';
import { createWorld } from './world';

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown): boolean =>
  schema.safeParse(v).success;

describe('standard components', () => {
  it('Position: integer x, y and z, z defaulting to 0', () => {
    expect(Position.schema.parse({ x: 1, y: -2 })).toEqual({ x: 1, y: -2, z: 0 });
    expect(Position.schema.parse({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
    expect(ok(Position.schema, { x: 1.5, y: 0 })).toBe(false);
    expect(ok(Position.schema, { x: 1, y: 0, z: 0.5 })).toBe(false);
    expect(ok(Position.schema, { x: 1, y: 0, w: 2 })).toBe(false);
  });

  it('Health: hp from 0 to max', () => {
    expect(ok(Health.schema, { hp: 0, max: 5 })).toBe(true);
    expect(ok(Health.schema, { hp: 6, max: 5 })).toBe(false);
    expect(ok(Health.schema, { hp: -1, max: 5 })).toBe(false);
    expect(ok(Health.schema, { hp: 0, max: 0 })).toBe(false);
  });

  it('Owner: a faction id', () => {
    expect(ok(Owner.schema, { faction: 'red' })).toBe(true);
    expect(ok(Owner.schema, { faction: '' })).toBe(false);
    expect(ok(Owner.schema, { faction: 3 })).toBe(false);
  });

  it('Inventory: integer counts, stored in sorted key order', () => {
    expect(Object.keys(Inventory.schema.parse({ wood: 2, bread: 1, axe: 0 }))).toEqual([
      'axe',
      'bread',
      'wood',
    ]);
    expect(ok(Inventory.schema, { wood: 1.5 })).toBe(false);
    expect(ok(Inventory.schema, { wood: -1 })).toBe(false);
    const world = createWorld(0, { components: [Inventory] });
    const id = world.spawn();
    inventoryAdd(world, id, 'wood', 3);
    inventoryAdd(world, id, 'bread', 2);
    inventoryAdd(world, id, 'axe', 1);
    inventoryAdd(world, id, 'axe', -1);
    expect(JSON.stringify(world.snapshot().components['Inventory'])).toBe('[[1,{"bread":2,"wood":3}]]');
    expect(() => inventoryAdd(world, id, 'wood', -4)).toThrow(/cannot take 4/);
  });

  it('Construction: progress up to work, done exactly at the end', () => {
    expect(ok(Construction.schema, { kind: 'house', progress: 3, work: 10, done: false })).toBe(true);
    expect(ok(Construction.schema, { kind: 'house', progress: 10, work: 10, done: true })).toBe(true);
    expect(ok(Construction.schema, { kind: 'house', progress: 10, work: 10, done: false })).toBe(false);
    expect(ok(Construction.schema, { kind: 'house', progress: 3, work: 10, done: true })).toBe(false);
    expect(ok(Construction.schema, { kind: 'house', progress: 11, work: 10, done: true })).toBe(false);
  });

  it('Worker: a job entity or null, and a rate', () => {
    expect(ok(Worker.schema, { job: null, rate: 1 })).toBe(true);
    expect(ok(Worker.schema, { job: 4, rate: 2 })).toBe(true);
    expect(ok(Worker.schema, { job: 0, rate: 1 })).toBe(false);
    expect(ok(Worker.schema, { job: null, rate: 0 })).toBe(false);
  });

  it('Patrol: waypoints and an index into them', () => {
    expect(
      Patrol.schema.parse({
        waypoints: [
          { x: 0, y: 0 },
          { x: 3, y: 0, z: 1 },
        ],
        index: 1,
      }),
    ).toEqual({
      waypoints: [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 1 },
      ],
      index: 1,
    });
    expect(ok(Patrol.schema, { waypoints: [{ x: 0, y: 0 }], index: 1 })).toBe(false);
    expect(ok(Patrol.schema, { waypoints: [], index: 0 })).toBe(false);
  });

  it('Squad and Member: named members within strength, captain among them', () => {
    expect(ok(Squad.schema, { strength: 12, captain: 3, members: [2, 3] })).toBe(true);
    expect(ok(Squad.schema, { strength: 0, captain: null, members: [] })).toBe(true);
    expect(ok(Squad.schema, { strength: 1, captain: null, members: [2, 3] })).toBe(false);
    expect(ok(Squad.schema, { strength: 5, captain: 4, members: [2, 3] })).toBe(false);
    expect(ok(Squad.schema, { strength: 5, captain: null, members: [3, 2] })).toBe(false);
    expect(ok(Member.schema, { name: 'Ada', squad: 1, role: 'hero' })).toBe(true);
    expect(ok(Member.schema, { name: 'Ada', squad: null, role: 'regular' })).toBe(true);
    expect(ok(Member.schema, { name: 'Ada', squad: 1, role: 'king' })).toBe(false);
    expect(ok(Member.schema, { name: '', squad: 1, role: 'hero' })).toBe(false);
  });

  it('registers together and stores JSON-safe data', () => {
    const world = createWorld(1, { components: STANDARD_COMPONENTS });
    const id = world.spawn();
    world.add(id, Position, { x: 1, y: 2, z: 0 });
    world.add(id, Health, { hp: 3, max: 3 });
    world.add(id, Owner, { faction: 'village' });
    world.add(id, Construction, { kind: 'mill', progress: 0, work: 30, done: false });
    world.add(id, Worker, { job: null, rate: 1 });
    world.add(id, Patrol, { waypoints: [{ x: 0, y: 0, z: 0 }], index: 0 });
    expect(() => canonicalJson(world.snapshot())).not.toThrow();
    expect(Object.keys(world.snapshot().components)).toEqual(STANDARD_COMPONENTS.map((c) => c.name).sort());
  });
});
