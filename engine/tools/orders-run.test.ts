import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';

// Engine 0.9 T9: recorded orders, lockstep replay and sync hashes. A run file's `orders` are
// applied before the step from their tick (world runs with `applyOrder`, game runs through the
// game's `order` method), and its `hashes` are checked by `run`, which stops at the first that
// differs. The battle is engine/sim/__fixtures__/battle.run.json (an `rts` world).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BATTLE = 'engine/sim/__fixtures__/battle.run.json';
const BATTLE_WORLD = join(ROOT, 'engine/sim/__fixtures__/battle.world.json');
const VILLAGE = 'engine/sim/__fixtures__/village-build.run.json';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-orders-'));
  temps.push(dir);
  return dir;
}

async function cli(argv: string[], cwd = ROOT, outDir = join(tempDir(), 'out')) {
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd,
    outDir,
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

interface Entry {
  tick: number;
  id?: number;
  [key: string]: unknown;
}

/** The battle run with `edit` applied, in a temp folder (`world` made absolute). */
function battle(edit: (run: Record<string, unknown> & { orders: Entry[] }) => void): string {
  const run = JSON.parse(readFileSync(join(ROOT, BATTLE), 'utf8')) as Record<string, unknown> & {
    orders: Entry[];
  };
  run.world = BATTLE_WORLD;
  edit(run);
  const file = join(tempDir(), 'battle.run.json');
  writeFileSync(file, JSON.stringify(run, null, 2));
  return file;
}

const errorsOf = async (file: string) => {
  const { code, result } = await cli(['run', file]);
  expect(code).toBe(EXIT.invalidContent);
  return (result.errors as { path: string; message: string }[]).map((e) => `${e.path}: ${e.message}`);
};

describe('a recorded battle (world run with orders)', () => {
  it('plays the battle fixture: every order applied, every sync hash matching', async () => {
    const { code, result } = await cli(['run', BATTLE]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      passed: true,
      world: 'engine/sim/__fixtures__/battle.world.json',
      orders: 7,
      ordersPlayed: 7,
      refusedOrders: [],
      hashesChecked: 11,
      hashMismatch: null,
    });
    const stored = (JSON.parse(readFileSync(join(ROOT, BATTLE), 'utf8')) as { hashes: unknown[] }).hashes;
    expect(result.hashes).toEqual(stored);
  });

  it('fails at the first diverging sync hash when an order is changed', async () => {
    // Blue's move goes one cell further south: the state differs after tick 20, by tick 40.
    const file = battle((r) => {
      const move = r.orders.find((o) => o.id === 4)!;
      move.target = { x: 9, y: 7 };
    });
    const { code, result } = await cli(['run', file]);
    expect(code).toBe(EXIT.failedCheck);
    expect(result).toMatchObject({
      passed: false,
      failure: null,
      lastTick: 40,
      hashesChecked: 3,
      hashMismatch: { tick: 40, expected: '48276878e8f02467', lastMatch: 20 },
      replayFile: null,
    });
  });

  it('gives a different battle without its orders, and the sync hashes catch it at tick 20', async () => {
    const { code, result } = await cli(['run', battle((r) => (r.orders = []))]);
    expect(code).toBe(EXIT.failedCheck);
    expect(result.hashMismatch).toMatchObject({ tick: 20, lastMatch: 0 });
  });

  it('reports orders the world refuses without failing the run', async () => {
    const file = battle((r) => {
      delete r.hashes;
      r.assertions = [];
      r.orders.push({ tick: 150, id: 8, faction: 'red', type: 'move', units: [8], target: { x: 1, y: 1 } });
    });
    const { code, result } = await cli(['run', file]);
    expect(code).toBe(EXIT.ok);
    expect(result.refusedOrders).toEqual([
      { tick: 150, id: 8, error: expect.stringMatching(/^order 8: /) as unknown },
    ]);
  });

  it('dump lists the orders applied before the tick, and plays them', async () => {
    const run = await cli(['run', BATTLE]);
    const { code, result } = await cli(['dump', BATTLE, '--tick', '20', '--max-output', '1000000']);
    expect(code).toBe(EXIT.ok);
    expect((result.orders as Entry[]).map((o) => o.id)).toEqual([1, 2, 3]);
    expect(result.hash).toBe((run.result.hashes as { tick: number; hash: string }[])[1]!.hash);
  });

  it('writes a replay that keeps the orders up to the failing tick and reproduces the failure', async () => {
    const out = join(tempDir(), 'out');
    const file = battle((r) => {
      delete r.hashes;
      r.assertions = [{ tick: 100, path: 'components.Unit.length', op: 'eq', value: 99 }];
    });
    const failed = await cli(['run', file], ROOT, out);
    expect(failed.code).toBe(EXIT.failedCheck);
    const replayFile = failed.result.replayFile as string;
    const replay = JSON.parse(readFileSync(resolve(ROOT, replayFile), 'utf8')) as { orders: Entry[] };
    expect(replay.orders.map((o) => o.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(replay).not.toHaveProperty('hashes');
    const replayed = await cli(['run', replayFile]);
    expect(replayed.result.replay).toMatchObject({ reproduced: true, hashMismatch: null });
    expect(replayed.result.hashes).toEqual(failed.result.hashes);
  });
});

describe('run file schema: orders and hashes', () => {
  it('names the field of a malformed order', async () => {
    const errors = await errorsOf(
      battle((r) => {
        r.orders[0]!.units = 'five';
        r.orders[1]!.type = 'dance';
        r.orders[2]!.tick = -1;
        delete r.orders[3]!.id;
      }),
    );
    expect(errors).toEqual([
      expect.stringMatching(/^orders\.2\.tick: /),
      expect.stringMatching(/^orders\.0\.units: .*\(a world run's orders are engine\/core orders\)$/),
      expect.stringMatching(/^orders\.1\.type: /),
      'orders.2.tick: orders must be in tick order: tick -1 comes after tick 0',
      expect.stringMatching(/^orders\.3\.id: /),
    ]);
  });

  it('refuses orders out of tick order, out of id order, repeated, or at the last tick', async () => {
    const errors = await errorsOf(
      battle((r) => {
        r.orders[3]!.tick = 1; // after tick 2
        r.orders[1]!.id = 3; // the same id as the next entry
        r.orders.push({ tick: 200, id: 9, faction: 'red', type: 'stop', units: [5] });
        r.orders.splice(1, 0, { tick: 0, id: 1, faction: 'red', type: 'stop', units: [6] });
      }),
    );
    expect(errors).toEqual([
      'orders.1.id: order id 1 is used twice',
      'orders.3.id: order id 3 is used twice',
      'orders.4.tick: orders must be in tick order: tick 1 comes after tick 2',
      "orders.8.tick: tick 200 is not before the run's last tick (200): an order applies before the step from its tick",
    ]);
    const sameTick = await errorsOf(
      battle((r) => {
        r.orders[0]!.id = 2;
        r.orders[1]!.id = 1;
      }),
    );
    expect(sameTick).toEqual(['orders.1.id: orders of one tick must be in id order: id 1 comes after id 2']);
  });

  it('refuses sync hashes out of order or after the run', async () => {
    const errors = await errorsOf(
      battle((r) => {
        r.hashes = [
          { tick: 20, hash: '0123456789abcdef' },
          { tick: 20, hash: '0123456789abcdef' },
          { tick: 201, hash: '0123456789abcdef' },
          { tick: 30, hash: 'XYZ' },
        ];
      }),
    );
    expect(errors).toEqual([
      'hashes.3.hash: a state hash is 16 lower-case hex digits',
      'hashes.1.tick: hashes must be in tick order, one per tick: tick 20 comes after tick 20',
      "hashes.2.tick: tick 201 is after the run's last tick (200)",
      'hashes.3.tick: hashes must be in tick order, one per tick: tick 30 comes after tick 201',
    ]);
  });

  it('checks a sync hash at a tick that is not a multiple of hashEvery', async () => {
    const run = await cli(['run', battle((r) => delete r.hashes)]);
    const at = (await cli(['dump', BATTLE, '--tick', '33', '--max-output', '1000000'])).result.hash as string;
    const file = battle((r) => (r.hashes = [{ tick: 33, hash: at }]));
    const { code, result } = await cli(['run', file]);
    expect(code).toBe(EXIT.ok);
    expect(result.hashesChecked).toBe(1);
    expect(result.hashes).toContainEqual({ tick: 33, hash: at });
    expect(run.result.hashes).not.toContainEqual({ tick: 33, hash: at });
  });
});

describe('world runs choose their system set', () => {
  it('refuses orders on a world without the rts system set (the village names none)', async () => {
    const run = JSON.parse(readFileSync(join(ROOT, VILLAGE), 'utf8')) as Record<string, unknown>;
    run.world = join(ROOT, 'engine/sim/__fixtures__/village.world.json');
    run.orders = [{ tick: 0, id: 1, faction: 'village', type: 'stop', units: [5] }];
    const file = join(tempDir(), 'village.run.json');
    writeFileSync(file, JSON.stringify(run));
    const { code, result } = await cli(['run', file]);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([
      expect.objectContaining({
        path: 'orders',
        code: 'no_orders',
        message: expect.stringContaining('"village" system set') as unknown,
      }),
    ]);
  });

  it('reports a system set the engine does not have at the scenario field', async () => {
    const dir = tempDir();
    const world = JSON.parse(readFileSync(BATTLE_WORLD, 'utf8')) as Record<string, unknown>;
    world.systems = 'space';
    writeFileSync(join(dir, 'odd.world.json'), JSON.stringify(world));
    const { code, result } = await cli(['run', battle((r) => (r.world = join(dir, 'odd.world.json')))]);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([expect.objectContaining({ path: 'systems', code: 'invalid_scenario' })]);
  });
});

/** A plain-JS game whose headless module takes orders (or not, with `orders: false`). */
function orderGame(orders: boolean, run: Record<string, unknown>): { cwd: string; file: string } {
  const cwd = tempDir();
  const game = join(cwd, 'games/ordered');
  mkdirSync(join(game, 'runs'), { recursive: true });
  const manifest = {
    id: 'ordered',
    kit: 'topdown',
    content: {},
    start: { seed: 1 },
    headless: 'headless.mjs',
  };
  writeFileSync(join(game, 'game.json'), JSON.stringify(manifest));
  const order = orders
    ? `order(o) {
        if (o.type === 'bad') return 'order ' + o.id + ': bad';
        state.log.push([state.tick, o.type]);
        return null;
      },`
    : '';
  writeFileSync(
    join(game, 'headless.mjs'),
    `export function createGame() {
  const state = { tick: 0, log: [] };
  return {
    step() { state.tick += 1; },
    snapshot: () => JSON.parse(JSON.stringify(state)),
    ${order}
  };
}
`,
  );
  writeFileSync(join(game, 'runs', 'o.run.json'), JSON.stringify({ game: '..', ticks: 5, ...run }));
  return { cwd, file: 'games/ordered/runs/o.run.json' };
}

describe('a game run with orders', () => {
  const orders = [
    { tick: 0, id: 1, type: 'go' },
    { tick: 2, id: 2, type: 'bad' },
    { tick: 2, id: 3, type: 'wait' },
  ];

  it("hands each order, without its tick, to the game's order method before the step from its tick", async () => {
    const { cwd, file } = orderGame(true, {
      orders,
      assertions: [
        { tick: 0, path: 'log', op: 'eq', value: [] },
        { tick: 1, path: 'log', op: 'eq', value: [[0, 'go']] },
        {
          tick: 5,
          path: 'log',
          op: 'eq',
          value: [
            [0, 'go'],
            [2, 'wait'],
          ],
        },
      ],
    });
    const { code, result } = await cli(['run', file], cwd);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      ordersPlayed: 3,
      refusedOrders: [{ tick: 2, id: 2, error: 'order 2: bad' }],
    });
  });

  it('is a usage error for a game without an order method', async () => {
    const { cwd, file } = orderGame(false, { orders });
    const { code, result } = await cli(['run', file], cwd);
    expect(code).toBe(EXIT.usage);
    expect(JSON.stringify(result.error)).toContain('no order(order) method');
  });

  it('runs a game without orders unchanged', async () => {
    const { cwd, file } = orderGame(false, { assertions: [{ tick: 5, path: 'tick', op: 'eq', value: 5 }] });
    const { code } = await cli(['run', file], cwd);
    expect(code).toBe(EXIT.ok);
  });
});
