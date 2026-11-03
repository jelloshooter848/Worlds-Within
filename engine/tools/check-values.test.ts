import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonObject } from '@engine/core/headless';
import { failsCheck, unknownKeyAt, valueAt } from './check-values';
import { main } from './main';

// Keyed paths into a world snapshot (Engine 0.15 T7, gap M17; docs/BUILD-LOG.md, Engine 0.15,
// decision 8): `key.<key>`, `id.<n>` and `one.<Kind>` name an entity or a world-level component
// without its place in a component list.

const WORLD: JsonObject = {
  seed: 1,
  tick: 5,
  nextId: 9,
  rng: 1,
  entities: [1, 3, 4, 7],
  components: {
    Position: [
      [3, { x: 2, y: 1, z: 0 }],
      [4, { x: 5, y: 5, z: 0 }],
    ],
    Health: [
      [3, { hp: 40, max: 50 }],
      [4, { hp: 0, max: 30 }],
      [7, { hp: 90, max: 120 }],
    ],
    Fate: [
      [4, { state: 'dead' }],
      [7, { state: 'captured' }],
    ],
    Missions: [[8, { open: [], committed: [{ mission: 'raid', outcome: 'clean' }] }]],
    Target: [],
  },
};
const STATE: JsonObject = { world: WORLD, kit: { gold: 3 } };
const KEYS = { ram: 3, guard: 4, captain: 7, gone: 6 };

describe('keyed paths', () => {
  it('reads an entity by key: its components, null for one it lacks, alive and fate', () => {
    expect(valueAt(STATE, 'world.key.ram.Health.hp', KEYS)).toBe(40);
    expect(valueAt(STATE, 'world.key.ram.alive', KEYS)).toBe(true);
    expect(valueAt(STATE, 'world.key.ram.fate', KEYS)).toBe('active');
    expect(valueAt(STATE, 'world.key.ram.Target', KEYS)).toBeNull();
    expect(valueAt(STATE, 'world.key.captain.Position', KEYS)).toBeNull();
    expect(valueAt(STATE, 'world.key.captain.fate', KEYS)).toBe('captured');
    expect(valueAt(STATE, 'world.key.captain.alive', KEYS)).toBe(true);
    expect(valueAt(STATE, 'world.key.guard.alive', KEYS)).toBe(false);
    // An entity that is gone: not alive, no fate, every kind null.
    expect(valueAt(STATE, 'world.key.gone.alive', KEYS)).toBe(false);
    expect(valueAt(STATE, 'world.key.gone.fate', KEYS)).toBeNull();
    expect(valueAt(STATE, 'world.key.gone.Health', KEYS)).toBeNull();
    // A kind the snapshot does not list, a key the table lacks, no table: no value.
    expect(valueAt(STATE, 'world.key.ram.Helth.hp', KEYS)).toBeUndefined();
    expect(valueAt(STATE, 'world.key.nobody.alive', KEYS)).toBeUndefined();
    expect(valueAt(STATE, 'world.key.ram.alive')).toBeUndefined();
  });

  it('reads an entity by id and a world-level component by kind', () => {
    expect(valueAt(STATE, 'world.id.4.Health.max', KEYS)).toBe(30);
    expect(valueAt(STATE, 'world.id.x.Health')).toBeUndefined();
    expect(valueAt(STATE, 'world.one.Missions.committed.0.outcome')).toBe('clean');
    expect(valueAt(STATE, 'world.one.Target')).toBeNull();
    expect(valueAt(STATE, 'world.one.Nothing')).toBeUndefined();
    // Outside a world snapshot the segments are plain keys.
    expect(valueAt({ key: { a: 1 } }, 'key.a')).toBe(1);
    // A world run's snapshot is the world itself.
    expect(valueAt(WORLD, 'key.ram.Position.x', KEYS)).toBe(2);
  });

  it('checks with the table, and finds a key the table lacks', () => {
    expect(failsCheck(STATE, { path: 'world.key.ram.Health.hp', op: 'eq', value: 40 }, KEYS)).toBeNull();
    expect(failsCheck(STATE, { path: 'world.key.ram.Health.hp', op: 'eq', value: 40 })?.message).toBe(
      'no value at "world.key.ram.Health.hp"',
    );
    expect(unknownKeyAt(STATE, 'world.key.rma.alive', KEYS)).toBe('rma');
    expect(unknownKeyAt(STATE, 'world.key.ram.alive', KEYS)).toBeNull();
    expect(unknownKeyAt(STATE, 'kit.key.ram', KEYS)).toBeNull();
  });
});

describe('keyed paths in a run file', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function run(assertions: unknown[]): Promise<{ code: number; out: Record<string, unknown> }> {
    dir = mkdtempSync(join(tmpdir(), 'ww-keyed-'));
    writeFileSync(
      join(dir, 'siege.world.json'),
      readFileSync(join(ROOT, 'engine/sim/__fixtures__/siege.world.json'), 'utf8'),
    );
    writeFileSync(
      join(dir, 'keyed.run.json'),
      JSON.stringify({ world: 'siege.world.json', ticks: 2, assertions }),
    );
    let stdout = '';
    const io = {
      stdout: (t: string) => void (stdout += t),
      stderr: () => {},
      cwd: dir,
      outDir: join(dir, 'out'),
    };
    const code = await main(['run', 'keyed.run.json', '--json'], io);
    return { code, out: JSON.parse(stdout) as Record<string, unknown> };
  }

  it('passes a world run checked by key, and refuses a key the scenario lacks (no_key, exit 3)', async () => {
    const ok = await run([
      { tick: 0, path: 'key.ram.alive', op: 'eq', value: true },
      { tick: 0, path: 'key.ram.Owner.faction', op: 'eq', value: 'blue' },
    ]);
    expect(ok.out['failure']).toBeNull();
    expect(ok.code).toBe(0);
    const bad = await run([{ tick: 0, path: 'key.rma.alive', op: 'eq', value: true }]);
    expect(bad.code).toBe(3);
    expect(bad.out['errors']).toEqual([
      expect.objectContaining({ path: 'assertions.0.path', code: 'no_key' }),
    ]);
  });
});
