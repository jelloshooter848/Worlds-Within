import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from './exit-codes';
import { main } from './main';

// Engine 0.13 T6 (decision 9, item 228): a game run file may start from another run's end
// (`from: { run }`) or a save code (`from: { code }`) and assert save codes (`codes`); `pnpm cli
// code` prints a run's save code. The game is a plain-JS headless module in a temp folder (as in
// game-missions-run.test.ts) on two tiny RTS kit maps and a campaign: `first`, then `second`, whose
// `from` carries the captain and the village's gold. An order `{ type: "capture" }` captures the
// captain; the game's campaign save carries his fate and the gold it has gathered (one a tick).

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[], cwd: string) {
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd,
    outDir: join(cwd, 'out'),
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

const map = (from?: unknown) => ({
  format: 'worlds-within/scenario',
  version: 1,
  seed: 1,
  systems: 'rts',
  terrain: { legend: { '.': { name: 'grass', cost: 1, passable: true } }, rows: ['...'], elevation: ['000'] },
  entities: [
    { key: 'hall', components: { Stockpile: { faction: 'village' }, Inventory: { gold: 10 } } },
    { key: 'raider', components: { Owner: { faction: 'raiders' }, Position: { x: 2, y: 0 } } },
  ],
  squads: [{ key: 'guard', components: {}, members: [{ key: 'captain', name: 'Hale', role: 'captain' }] }],
  ...(from === undefined ? {} : { from }),
});

const HEADLESS = `export function createGame(content, seed, opts = {}) {
  const save = opts.campaign;
  const state = {
    seed,
    tick: 0,
    position: save ? save.position : 0,
    carried: save ? save.carried : null,
    captured: false,
    gold: save && save.carried ? save.carried.stockpiles.village.gold : 10,
    results: save ? save.results : [],
  };
  return {
    step() { state.tick += 1; state.gold += 1; },
    snapshot: () => JSON.parse(JSON.stringify(state)),
    order(o) { if (o.type === 'capture') { state.captured = true; state.capturedAt = state.tick; return null; } return 'no'; },
    campaignSave() {
      if (state.position >= 2) return null;
      const captain = state.captured
        ? { fate: 'captured', by: 'raiders', at: state.capturedAt, hp: 20, max: 30 }
        : { fate: 'active', by: null, at: null, hp: 30, max: 30 };
      return {
        format: 'worlds-within/campaign-save', version: 1, game: 'camp', campaign: 'main', seed,
        position: state.position + 1,
        carried: state.position === 0
          ? { format: 'worlds-within/carried', version: 1, from: 'first', tick: state.tick,
              people: { captain }, stockpiles: { village: { gold: state.gold } } }
          : null,
        results: [...state.results, { entry: state.position, missions: [] }],
      };
    },
  };
}
`;

/** The game folder with its runs; returns the working folder. */
function campaignGame(runs: Record<string, object>, headless = HEADLESS): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ww-campaign-run-'));
  temps.push(cwd);
  const game = join(cwd, 'games/camp');
  mkdirSync(join(game, 'runs'), { recursive: true });
  mkdirSync(join(game, 'content/maps'), { recursive: true });
  writeFileSync(
    join(game, 'game.json'),
    JSON.stringify({
      id: 'camp',
      kit: 'rts',
      content: { 'rts-map': ['content/maps/*.world.json'], campaign: ['content/*.campaign.json'] },
      start: { seed: 5 },
      headless: 'headless.mjs',
    }),
  );
  writeFileSync(join(game, 'content/maps/first.world.json'), JSON.stringify(map()));
  const from = {
    scenario: 'first',
    carry: { people: ['captain'], stockpiles: [{ faction: 'village', items: ['gold'] }] },
  };
  writeFileSync(join(game, 'content/maps/second.world.json'), JSON.stringify(map(from)));
  writeFileSync(
    join(game, 'content/main.campaign.json'),
    JSON.stringify({
      version: 1,
      id: 'main',
      entries: [
        { scenario: 'first', ticks: 10 },
        { scenario: 'second', ticks: 10 },
      ],
    }),
  );
  writeFileSync(join(game, 'headless.mjs'), headless);
  for (const [name, run] of Object.entries(runs))
    writeFileSync(join(game, 'runs', `${name}.run.json`), JSON.stringify({ game: '..', ...run }));
  return cwd;
}

const FIRST = { ticks: 10, orders: [{ tick: 3, type: 'capture' }] };
const run = (name: string) => `games/camp/runs/${name}.run.json`;

describe('campaign runs, save codes and run files that start from them', () => {
  it('validates the campaign with its scenario entries', async () => {
    const cwd = campaignGame({});
    const { code, result } = await cli(['validate', 'games/camp'], cwd);
    expect(result.errors).toEqual([]);
    expect(code).toBe(EXIT.ok);
  });

  it("prints a run's save code, the same every time, and one that differs with the captain's fate", async () => {
    const cwd = campaignGame({ first: FIRST, held: { ticks: 10 } });
    const a = await cli(['code', run('first')], cwd);
    expect(a.code).toBe(EXIT.ok);
    expect(a.result).toMatchObject({ tick: 10, save: { position: 1, campaign: 'main' } });
    expect(a.result.code).toMatch(/^[0-9A-Z-]+$/);
    expect((await cli(['code', run('first')], cwd)).result.code).toBe(a.result.code);
    const held = await cli(['code', run('held')], cwd);
    expect(held.result.code).not.toBe(a.result.code);
    const early = await cli(['code', run('first'), '--tick', '2'], cwd);
    expect(early.result.code).not.toBe(a.result.code);
    expect((await cli(['code', run('first'), '--tick', '11'], cwd)).code).toBe(EXIT.usage);
  });

  it('starts from another run and from its save code with the same tick-0 hash', async () => {
    const cwd = campaignGame({ first: FIRST });
    const { result } = await cli(['code', run('first')], cwd);
    const saveCode = result.code as string;
    const runs = {
      'from-run': { ticks: 5, from: { run: 'first.run.json' }, hashEvery: 1 },
      'from-code': { ticks: 5, from: { code: saveCode.toLowerCase() }, hashEvery: 1 },
    };
    for (const [name, r] of Object.entries(runs))
      writeFileSync(join(cwd, 'games/camp/runs', `${name}.run.json`), JSON.stringify({ game: '..', ...r }));
    const byRun = await cli(['run', run('from-run')], cwd);
    const byCode = await cli(['run', run('from-code')], cwd);
    expect(byRun.code).toBe(EXIT.ok);
    expect(byCode.code).toBe(EXIT.ok);
    expect(byRun.result.from).toEqual({
      run: 'games/camp/runs/first.run.json',
      code: null,
      campaign: 'main',
      position: 1,
    });
    expect(byCode.result.from).toMatchObject({ run: null, code: saveCode.toLowerCase(), position: 1 });
    expect(byRun.result.hashes).toEqual(byCode.result.hashes);
    const dump = await cli(['dump', run('from-code'), '--tick', '0'], cwd);
    expect(dump.result.state).toMatchObject({
      position: 1,
      gold: 20,
      carried: { people: { captain: { fate: 'captured', at: 3 } } },
    });
  });

  it("checks a run file's save codes and fails on a different one, naming both", async () => {
    const cwd = campaignGame({ first: FIRST });
    const { result } = await cli(['code', run('first')], cwd);
    const good = result.code as string;
    writeFileSync(
      join(cwd, 'games/camp/runs/coded.run.json'),
      JSON.stringify({ game: '..', ...FIRST, codes: [{ tick: 10, code: good.replace(/-/g, ' ') }] }),
    );
    const passed = await cli(['run', run('coded')], cwd);
    expect(passed.code).toBe(EXIT.ok);
    expect(passed.result).toMatchObject({ codes: 1, codesChecked: 1 });
    const early = (await cli(['code', run('first'), '--tick', '2'], cwd)).result.code as string;
    writeFileSync(
      join(cwd, 'games/camp/runs/wrong.run.json'),
      JSON.stringify({ game: '..', ...FIRST, codes: [{ tick: 10, code: early }] }),
    );
    const failed = await cli(['run', run('wrong')], cwd);
    expect(failed.code).toBe(EXIT.failedCheck);
    expect(failed.result.failure).toMatchObject({
      tick: 10,
      kind: 'code',
      path: 'codes.0',
      expected: early,
      actual: good,
    });
    expect(String((failed.result.failure as { message: string }).message)).toContain(good);
    // The replay keeps the codes and fails the same way.
    const replay = await cli(['run', failed.result.replayFile as string], cwd);
    expect(replay.result.replay).toMatchObject({ reproduced: true });
  });

  it('refuses a bad start, naming the field and the code', async () => {
    const cwd = campaignGame({
      first: FIRST,
      typo: { ticks: 5, from: { code: '2ZZZZ-ZZZZZ' } },
      newer: { ticks: 5, from: { code: 'ZZZZZ-ZZZZZ' } },
      empty: { ticks: 5, from: { code: ' - ' } },
      chain: { ticks: 5, from: { run: 'from-first.run.json' } },
      'from-first': { ticks: 5, from: { run: 'first.run.json' } },
      both: { ticks: 5, from: { run: 'first.run.json', code: 'X' } },
    });
    const errors = async (name: string) => {
      const { code, result } = await cli(['run', run(name)], cwd);
      return [code, (result.errors as { path: string; code: string }[]).map((e) => [e.path, e.code])];
    };
    expect(await errors('typo')).toEqual([EXIT.invalidContent, [['from.code', 'code_typo']]]);
    expect(await errors('newer')).toEqual([EXIT.invalidContent, [['from.code', 'code_newer']]]);
    expect(await errors('empty')).toEqual([EXIT.invalidContent, [['from.code', 'code_empty']]]);
    expect(await errors('chain')).toEqual([EXIT.invalidContent, [['from.run', 'from_chain']]]);
    expect(await errors('both')).toEqual([EXIT.invalidContent, [['from', 'custom']]]);
  });

  it('refuses from and codes on a world run and on a game with no campaign', async () => {
    const plain = `export function createGame() { let t = 0; return { step() { t += 1; }, snapshot: () => ({ t }) }; }\n`;
    const cwd = campaignGame({ first: FIRST, coded: { ticks: 3, codes: [{ tick: 3, code: 'X' }] } }, plain);
    expect((await cli(['run', run('coded')], cwd)).code).toBe(EXIT.usage);
    expect((await cli(['code', run('coded')], cwd)).code).toBe(EXIT.usage);
    writeFileSync(
      join(cwd, 'w.run.json'),
      JSON.stringify({
        world: 'w.world.json',
        ticks: 2,
        from: { code: 'X' },
        codes: [{ tick: 1, code: 'X' }],
      }),
    );
    const world = await cli(['run', 'w.run.json'], cwd);
    expect(world.code).toBe(EXIT.invalidContent);
    expect((world.result.errors as { path: string }[]).map((e) => e.path)).toEqual(['from', 'codes']);
    const late = JSON.stringify({ game: '..', ticks: 3, codes: [{ tick: 4, code: 'X' }] });
    writeFileSync(join(cwd, 'games/camp/runs/late.run.json'), late);
    const lateRun = await cli(['run', run('late')], cwd);
    expect((lateRun.result.errors as { path: string }[]).map((e) => e.path)).toEqual(['codes.0.tick']);
  });

  it('refuses to start from a campaign save past the last entry', async () => {
    const cwd = campaignGame({ first: FIRST });
    const code = (await cli(['code', run('first')], cwd)).result.code as string;
    // A run from the first run's code plays entry 1, the last; its end is the campaign's end.
    writeFileSync(
      join(cwd, 'games/camp/runs/second.run.json'),
      JSON.stringify({ game: '..', ticks: 5, from: { code } }),
    );
    const last = await cli(['code', run('second')], cwd);
    expect(last.code).toBe(EXIT.ok);
    expect(last.result.save).toMatchObject({ position: 2, carried: null });
    writeFileSync(
      join(cwd, 'games/camp/runs/after.run.json'),
      JSON.stringify({ game: '..', ticks: 5, from: { code: last.result.code } }),
    );
    const after = await cli(['run', run('after')], cwd);
    expect(after.code).toBe(EXIT.invalidContent);
    expect((after.result.errors as { path: string; code: string }[]).map((e) => [e.path, e.code])).toEqual([
      ['from', 'campaign_done'],
    ]);
  });
});
