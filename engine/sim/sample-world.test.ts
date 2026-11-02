import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../core/headless';
import { Rng } from '../core/rng';
import {
  Construction,
  Health,
  Inventory,
  Member,
  Patrol,
  Position,
  STANDARD_COMPONENTS,
  Squad,
  Worker,
} from './components';
import { loadWorld, saveWorld } from './save';
import { worldFromScenario } from './scenario';
import { squadMembers } from './squad';
import { SYSTEM_COMPONENTS, buildSystem, haulSystem, patrolSystem } from './systems';
import { Terrain, moveCost, terrainOf } from './terrain';
import type { World } from './world';

// The Engine 0.8 proof (docs/ROADMAP.md, "0.8 World simulation"): the village scenario in
// __fixtures__/village.world.json runs 10,000 ticks with the same state hashes on every run and
// on CI (the committed golden file __fixtures__/village.hashes.json), and survives a save and
// load at any tick. After a change that is meant to change the sample's state, regenerate the
// golden file with `WW_UPDATE_GOLDEN=1 pnpm test engine/sim/sample-world` and commit it.
// Timing: about 6 to 8 seconds for the whole file (one tick steps in about 0.04 ms, hashing a
// snapshot takes about 0.3 ms and a save and load about 10 ms), so the long tests get 60 s each.
// The exhaustive check (a save and load at every one of the 10,001 ticks, about 2.5 minutes) is
// opt-in: `WW_SAVE_EVERY_TICK=1 pnpm test engine/sim/sample-world`.
const SLOW = 60_000;

const FIXTURE = fileURLToPath(new URL('./__fixtures__/village.world.json', import.meta.url));
const GOLDEN = fileURLToPath(new URL('./__fixtures__/village.hashes.json', import.meta.url));
const UPDATE = process.env.WW_UPDATE_GOLDEN === '1';

const TICKS = 10_000;
/** Golden hashes are kept every this many ticks. */
const HASH_EVERY = 100;
/** Runs are compared every this many ticks (hashing a tick costs about 7 times stepping it). */
const CHECK_EVERY = 10;
/** After a load mid-run, the world runs on this many ticks, compared every CHECK_EVERY. */
const FOLLOW = 250;

const COMPONENTS = [...STANDARD_COMPONENTS, Terrain, ...SYSTEM_COMPONENTS];
const SYSTEMS = [haulSystem, buildSystem, patrolSystem];
/** Keep the changes of the last 100 ticks, so saves carry a log and stay small. */
const LOG = { ticks: 100 };

const scenario = JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown;

function village(): World {
  return worldFromScenario(scenario, { components: COMPONENTS, systems: SYSTEMS, log: LOG });
}

const hash = (world: World): string =>
  createHash('sha256').update(world.canonical()).digest('hex').slice(0, 16);

/** Save as text and load it back, as a game would. */
function reload(world: World): World {
  return loadWorld(JSON.parse(canonicalJson(saveWorld(world))), { components: COMPONENTS, systems: SYSTEMS });
}

interface Run {
  /** The state hash at every CHECK_EVERY-th tick, at TICKS and at every tick in `keep`. */
  hashes: Map<number, string>;
  /** The save text at every tick in `keep`. */
  saves: Map<number, string>;
}

/** One run of the village from tick 0 to TICKS with no save or load. */
function uninterrupted(keep: ReadonlySet<number>): Run {
  const world = village();
  const run: Run = { hashes: new Map(), saves: new Map() };
  for (;;) {
    const tick = world.tick;
    if (tick % CHECK_EVERY === 0 || tick === TICKS || keep.has(tick)) run.hashes.set(tick, hash(world));
    if (keep.has(tick)) run.saves.set(tick, canonicalJson(saveWorld(world)));
    if (tick === TICKS) break;
    world.step();
  }
  return run;
}

/** The ticks to save at: tick 0, every 250th, 40 seeded random ones, the last few and TICKS. */
function saveTicks(): number[] {
  const ticks = new Set<number>([0, 1, TICKS - 1, TICKS]);
  for (let t = 250; t < TICKS; t += 250) ticks.add(t);
  const rng = new Rng(0x5a7e);
  while (ticks.size < 4 + 39 + 40) ticks.add(1 + rng.int(TICKS - 1));
  return [...ticks].sort((a, b) => a - b);
}

const SAVE_AT = saveTicks();
const run = uninterrupted(new Set(SAVE_AT));
const golden = [...run.hashes]
  .filter(([tick]) => tick % HASH_EVERY === 0 || tick === TICKS)
  .sort((a, b) => a[0] - b[0])
  .map(([tick, h]) => ({ tick, hash: h }));

describe('sample world: the village scenario', () => {
  it('builds from data: terrain, workers, two buildings going up and a squad on patrol', () => {
    const world = village();
    const t = terrainOf(world);
    expect([t.width, t.height]).toEqual([24, 14]);
    // Types are numbered in sorted legend character order: # . = ^ f ~
    expect(t.types.map((ty) => ty.name)).toEqual(['rock', 'grass', 'bridge', 'hills', 'forest', 'river']);
    expect(world.query(Worker)).toHaveLength(3);
    expect(world.query(Construction).map((id) => world.get(id, Construction)?.done)).toEqual([false, false]);
    const [squad] = world.query(Squad, Patrol);
    expect(squad).toBeDefined();
    expect(squadMembers(world, squad as number).map((m) => [m.name, m.role])).toEqual([
      ['Aldric', 'captain'],
      ['Brenna', 'hero'],
      ['Cole', 'regular'],
      ['Dara', 'regular'],
    ]);
    expect(world.events().every((c) => c.cause === 'scenario' && c.tick === 0)).toBe(true);
  });

  it(
    'runs 10,000 ticks with the same hashes twice',
    () => {
      const again = uninterrupted(new Set());
      expect(again.hashes.size).toBe(TICKS / CHECK_EVERY + 1);
      for (const [tick, h] of again.hashes) expect(h, `tick ${tick}`).toBe(run.hashes.get(tick));
    },
    SLOW,
  );

  it('matches the committed golden hashes', () => {
    const expected = { scenario: 'engine/sim/__fixtures__/village.world.json', ticks: TICKS, hashes: golden };
    if (UPDATE) writeFileSync(GOLDEN, `${JSON.stringify(expected, null, 2)}\n`);
    expect(existsSync(GOLDEN), 'run WW_UPDATE_GOLDEN=1 pnpm test engine/sim/sample-world').toBe(true);
    expect(JSON.parse(readFileSync(GOLDEN, 'utf8'))).toEqual(expected);
  });

  it(
    'is not static: the buildings complete, workers haul and the squad patrols',
    () => {
      const world = village();
      const squad = world.query(Squad, Patrol)[0] as number;
      const passable = (x: number, y: number) => moveCost(terrainOf(world), x, y) !== null;
      const visited = new Set<number>();
      const cells = new Set<string>();
      while (world.tick < TICKS) {
        world.step();
        const p = world.get(squad, Position);
        const patrol = world.get(squad, Patrol);
        if (!p || !patrol) throw new Error('the squad lost its Position or Patrol');
        expect(passable(p.x, p.y)).toBe(true);
        cells.add(`${p.x},${p.y}`);
        const wp = patrol.waypoints[(patrol.index + patrol.waypoints.length - 1) % patrol.waypoints.length];
        if (wp && wp.x === p.x && wp.y === p.y) visited.add(patrol.index);
      }
      for (const id of world.query(Construction)) {
        const c = world.get(id, Construction);
        expect(c?.done, `${c?.kind} completes`).toBe(true);
        expect(world.get(id, Health)?.hp).toBe(world.get(id, Health)?.max);
      }
      // Every waypoint was reached, and the squad walked many cells (never into water or rock).
      expect(visited.size).toBe(4);
      expect(cells.size).toBeGreaterThan(30);
      // The workers hauled wood out of the woodpile.
      const pile = world.query(Inventory).find((id) => !world.has(id, Worker));
      expect(world.get(pile as number, Inventory)?.wood).toBeLessThan(2000 - 1000);
      // The named members are still in the squad.
      expect(world.query(Member).every((id) => world.get(id, Member)?.squad === squad)).toBe(true);
    },
    SLOW,
  );

  it('exercises the RNG: workers rest at random', () => {
    const world = village();
    let rests = 0;
    const start = world.rng.state();
    for (let i = 0; i < 1000; i++) {
      world.step();
      rests += world
        .events(world.tick - 1)
        .filter(
          (c) =>
            c.component === 'Hauler' &&
            c.op === 'set' &&
            (c.value as { rest: number }).rest > (c.before as { rest: number }).rest,
        ).length;
    }
    expect(rests).toBeGreaterThan(5);
    expect(world.rng.state()).not.toBe(start);
  });

  it(
    `survives a save and load at ${SAVE_AT.length} ticks, spread over the run`,
    () => {
      expect(SAVE_AT).toContain(0);
      expect(SAVE_AT).toContain(TICKS);
      for (const tick of SAVE_AT) {
        const text = run.saves.get(tick) as string;
        const world = loadWorld(JSON.parse(text), { components: COMPONENTS, systems: SYSTEMS });
        expect(world.tick).toBe(tick);
        expect(canonicalJson(saveWorld(world)), `save -> load -> save at ${tick}`).toBe(text);
        expect(hash(world), `hash after loading at ${tick}`).toBe(run.hashes.get(tick));
        const end = Math.min(TICKS, tick + FOLLOW);
        while (world.tick < end) {
          world.step();
          const want = run.hashes.get(world.tick);
          if (want !== undefined && hash(world) !== want) {
            throw new Error(`loaded at ${tick}: hash differs at tick ${world.tick}`);
          }
        }
      }
    },
    SLOW,
  );

  it(
    'matches the uninterrupted run to the end after loading at any of a sample of ticks',
    () => {
      const rng = new Rng(0xbeef);
      const picks = [0, SAVE_AT[rng.int(SAVE_AT.length)] as number, 5000, TICKS - 1];
      for (const tick of picks) {
        const world = loadWorld(JSON.parse(run.saves.get(tick) as string), {
          components: COMPONENTS,
          systems: SYSTEMS,
        });
        while (world.tick < TICKS) world.step();
        expect(hash(world), `loaded at ${tick}, hash at ${TICKS}`).toBe(run.hashes.get(TICKS));
      }
    },
    SLOW,
  );

  it(
    'matches the uninterrupted run when saved and reloaded at every tested tick in one run',
    () => {
      let world = village();
      const reloadAt = new Set(SAVE_AT);
      for (;;) {
        if (reloadAt.has(world.tick)) world = reload(world);
        if (world.tick % HASH_EVERY === 0)
          expect(hash(world), `tick ${world.tick}`).toBe(run.hashes.get(world.tick));
        if (world.tick === TICKS) break;
        world.step();
      }
      expect(hash(world)).toBe(run.hashes.get(TICKS));
    },
    SLOW,
  );

  it.runIf(process.env.WW_SAVE_EVERY_TICK === '1')(
    'matches the uninterrupted run when saved and reloaded at every tick (WW_SAVE_EVERY_TICK=1)',
    () => {
      let world = village();
      for (;;) {
        world = reload(world);
        const want = run.hashes.get(world.tick);
        if (want !== undefined) expect(hash(world), `tick ${world.tick}`).toBe(want);
        if (world.tick === TICKS) break;
        world.step();
      }
    },
    600_000,
  );
});
