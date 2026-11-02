import { describe, expect, it } from 'vitest';
import { Member, Position, STANDARD_COMPONENTS, Squad, Worker } from './components';
import { SCENARIO_FORMAT, ScenarioError, worldFromScenario } from './scenario';
import { squadMembers } from './squad';
import { Terrain, heightAt, moveCost, terrainOf } from './terrain';

const COMPONENTS = [...STANDARD_COMPONENTS, Terrain];

/** A small valid scenario; `patch` changes parts of it. */
function scenario(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: SCENARIO_FORMAT,
    version: 1,
    seed: 5,
    terrain: {
      legend: {
        '.': { name: 'grass', cost: 1, passable: true },
        '~': { name: 'water', cost: 1, passable: false },
      },
      rows: ['..~', '...'],
      elevation: ['120', '003'],
    },
    entities: [
      { key: 'site', components: { Position: { x: 0, y: 0 } } },
      { components: { Position: { x: 1, y: 1 }, Worker: { job: { $ref: 'site' }, rate: 1 } } },
    ],
    squads: [
      {
        key: 'watch',
        strength: 5,
        components: { Position: { x: 2, y: 1 } },
        members: [
          { name: 'Ana', role: 'regular' },
          { key: 'boss', name: 'Bo', role: 'captain' },
        ],
      },
    ],
    ...patch,
  };
}

function issues(json: unknown): string[] {
  try {
    worldFromScenario(json, { components: COMPONENTS });
  } catch (error) {
    if (error instanceof ScenarioError) return error.issues.map((i) => `${i.path}: ${i.message}`);
    throw error;
  }
  return [];
}

describe('worldFromScenario', () => {
  it('builds the terrain from the text grids, types in sorted legend order', () => {
    const world = worldFromScenario(scenario(), { components: COMPONENTS });
    const t = terrainOf(world);
    expect([t.width, t.height]).toEqual([3, 2]);
    expect(t.types.map((ty) => ty.name)).toEqual(['grass', 'water']);
    expect(heightAt(t, 1, 0)).toBe(2);
    expect(heightAt(t, 2, 1)).toBe(3);
    expect(moveCost(t, 2, 0)).toBeNull();
  });

  it('spawns in file order and resolves $ref to entity ids', () => {
    const world = worldFromScenario(scenario(), { components: COMPONENTS });
    // 1 terrain, 2 site, 3 worker, 4 squad, 5 Ana, 6 Bo
    expect(world.entities()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(world.get(3, Worker)).toEqual({ job: 2, rate: 1 });
    expect(world.get(2, Position)).toEqual({ x: 0, y: 0, z: 0 });
    expect(world.get(4, Squad)).toEqual({ strength: 5, captain: 6, members: [5, 6] });
    expect(world.get(5, Member)).toEqual({ name: 'Ana', squad: 4, role: 'regular' });
    expect(squadMembers(world, 4).map((m) => m.name)).toEqual(['Ana', 'Bo']);
    expect(world.tick).toBe(0);
    expect(new Set(world.events().map((c) => c.cause))).toEqual(new Set(['scenario']));
  });

  it('gives the same world every time', () => {
    const a = worldFromScenario(scenario(), { components: COMPONENTS });
    const b = worldFromScenario(scenario(), { components: COMPONENTS });
    expect(a.canonical()).toBe(b.canonical());
  });

  it('defaults the strength to the named members', () => {
    const json = scenario({ entities: [], squads: [{ members: [{ name: 'Ana', role: 'hero' }] }] });
    const world = worldFromScenario(json, { components: COMPONENTS });
    expect(world.get(2, Squad)).toEqual({ strength: 1, captain: null, members: [3] });
  });

  it('names every bad field', () => {
    expect(issues({ ...scenario(), format: 'x' })[0]).toMatch(/^format: /);
    expect(
      issues(
        scenario({
          terrain: {
            legend: { '.': { name: 'grass', cost: 1, passable: true } },
            rows: ['..', '.x.'],
            elevation: ['00'],
          },
        }),
      ),
    ).toEqual([
      'terrain.rows.1: is 3 wide, the first row is 2',
      'terrain.rows.1: character "x" at x 1 is not in the legend',
      'terrain.elevation: has 1 rows, the grid has 2',
    ]);
    expect(
      issues(
        scenario({
          entities: [
            { key: 'a', components: { Position: { x: 0.5, y: 0 } } },
            { key: 'a', components: { Nope: {}, Worker: { job: { $ref: 'zed' }, rate: 1 } } },
          ],
          squads: [
            {
              strength: 1,
              components: { Squad: {} },
              members: [
                { name: 'A', role: 'captain' },
                { name: 'B', role: 'captain' },
              ],
            },
          ],
        }),
      ),
    ).toEqual([
      'entities.1.key: key "a" is already used',
      'entities.0.components.Position.x: Invalid input: expected int, received number',
      'entities.1.components.Nope: component "Nope" is not in the components given to worldFromScenario',
      'entities.1.components.Worker.job: $ref "zed" names no entity of the scenario',
      'squads.0.components.Squad: Squad is built from the scenario entry: leave it out',
      'squads.0.members: a squad has at most one captain',
      'squads.0.strength: is less than the named members',
    ]);
  });

  it('needs Terrain among the components', () => {
    expect(() => worldFromScenario(scenario(), { components: STANDARD_COMPONENTS })).toThrow(
      /terrain: the components must include Terrain/,
    );
  });
});
