import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';

/**
 * `validate` checks a game's mini game ids and params with the content (Engine 0.10, gap G16,
 * item 157): the game's headless module exports `miniGames(content)`, and every level trigger's and
 * mission's `game`/`play` and `params` are checked against those defs' `paramsSchema`. The games
 * here are temp copies of games/samples/platformer (its door level, `level-4`, starts the `vault`
 * room challenge) and games/platformer-lab (`stop-bar`).
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST = 'games/samples/platformer';
const DOOR = `${TEST}/content/levels/level-4.json`;
const LAB = 'games/platformer-lab';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copy(game: string): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ww-mini-games-'));
  temps.push(cwd);
  cpSync(join(ROOT, game), join(cwd, game), { recursive: true });
  return cwd;
}

function editJson(file: string, edit: (data: Record<string, unknown>) => void): void {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  edit(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

type Trigger = { game: string; params: Record<string, unknown> };

async function validate(cwd: string, game: string): Promise<{ code: number; errors: unknown[] }> {
  let stdout = '';
  const io = { stdout: (t: string) => void (stdout += t), stderr: () => {}, cwd, outDir: join(cwd, 'out') };
  const code = await main(['validate', game, '--json'], io);
  return { code, errors: (JSON.parse(stdout) as { errors: unknown[] }).errors };
}

/** A mission for the test game, played with `play` and handed `params`. */
function mission(play: string, params: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'vault-raid',
    title: 'Clear the vault',
    worldTimeCost: 10,
    play,
    params,
    onQuit: 'lost',
    outcomes: [
      { id: 'won', title: 'Cleared', effects: [] },
      { id: 'lost', title: 'Driven out', effects: [] },
    ],
  };
}

/** The test game with a `missions/` folder holding one mission file. */
function withMission(play: string, params: Record<string, unknown>): string {
  const cwd = copy(TEST);
  editJson(join(cwd, TEST, 'game.json'), (m) => {
    (m.content as Record<string, string[]>).mission = ['content/missions/*.mission.json'];
  });
  mkdirSync(join(cwd, TEST, 'content/missions'));
  writeFileSync(
    join(cwd, TEST, 'content/missions/vault-raid.mission.json'),
    JSON.stringify(mission(play, params), null, 2) + '\n',
  );
  return cwd;
}

describe('validate checks mini game params with the content (G16)', () => {
  it('passes the games as they are', async () => {
    for (const game of [TEST, LAB]) {
      const { code, errors } = await validate(ROOT, game);
      expect(errors).toEqual([]);
      expect(code).toBe(EXIT.ok);
    }
  });

  it('fails a door whose goal is misspelt, naming the level file and field', async () => {
    const cwd = copy(TEST);
    editJson(join(cwd, DOOR), (level) => {
      (level.triggers as Trigger[])[0]!.params.goal = 'defeat-al';
    });
    const { code, errors } = await validate(cwd, TEST);
    expect(code).toBe(EXIT.invalidContent);
    expect(errors).toEqual([
      expect.objectContaining({
        file: DOOR,
        path: 'triggers.0.params.goal',
        pointer: '/triggers/0/params/goal',
        code: 'invalid_value',
      }),
    ]);
  });

  it('fails an unknown param and a bad number at their fields', async () => {
    const cwd = copy(TEST);
    editJson(join(cwd, DOOR), (level) => {
      const params = (level.triggers as Trigger[])[0]!.params;
      params.ticks = 0;
      params.lives = 3;
    });
    const { code, errors } = await validate(cwd, TEST);
    expect(code).toBe(EXIT.invalidContent);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: DOOR, path: 'triggers.0.params.ticks', code: 'too_small' }),
        expect.objectContaining({ file: DOOR, path: 'triggers.0.params.lives', code: 'unrecognized_keys' }),
      ]),
    );
  });

  it('fails a trigger naming a mini game the game does not have, at its id', async () => {
    const cwd = copy(TEST);
    editJson(join(cwd, DOOR), (level) => {
      (level.triggers as Trigger[])[0]!.game = 'vualt';
    });
    const { code, errors } = await validate(cwd, TEST);
    expect(code).toBe(EXIT.invalidContent);
    expect(errors).toEqual([
      expect.objectContaining({
        file: DOOR,
        path: 'triggers.0.game',
        code: 'unknown_mini_game',
        message: 'unknown mini game "vualt" (the game has: "cellar", "vault")',
      }),
    ]);
  });

  it("checks the lab's stop-bar params by its schema", async () => {
    const cwd = copy(LAB);
    const file = `${LAB}/content/levels/lab-5-trigger.json`;
    editJson(join(cwd, file), (level) => {
      (level.triggers as Trigger[])[0]!.params.zone = 'wide';
    });
    const { code, errors } = await validate(cwd, LAB);
    expect(code).toBe(EXIT.invalidContent);
    expect(errors).toEqual([
      expect.objectContaining({ file, path: 'triggers.0.params.zone', code: 'invalid_type' }),
    ]);
  });

  it("checks a mission's params by the schema of the mini game it is played with", async () => {
    const file = `${TEST}/content/missions/vault-raid.mission.json`;
    const good = withMission('vault', { goal: 'reach', ticks: 300 });
    expect(await validate(good, TEST)).toEqual({ code: EXIT.ok, errors: [] });

    const bad = withMission('vault', { goal: 'win', hp: 2 });
    const badRun = await validate(bad, TEST);
    expect(badRun.code).toBe(EXIT.invalidContent);
    expect(badRun.errors).toEqual([
      expect.objectContaining({ file, path: 'params.goal', code: 'invalid_value' }),
    ]);

    const unknown = withMission('sabotage', { engines: 3 });
    const unknownRun = await validate(unknown, TEST);
    expect(unknownRun.code).toBe(EXIT.invalidContent);
    expect(unknownRun.errors).toEqual([
      expect.objectContaining({ file, path: 'play', code: 'unknown_mini_game' }),
    ]);
  });

  it('checks nothing more for a game whose headless module exports no mini games', async () => {
    const cwd = copy(TEST);
    const headless = join(cwd, TEST, 'headless.ts');
    writeFileSync(
      headless,
      readFileSync(headless, 'utf8').replace(/export \{ testMiniGames as miniGames \};/, ''),
    );
    editJson(join(cwd, DOOR), (level) => {
      (level.triggers as Trigger[])[0]!.params.goal = 'defeat-al';
    });
    expect(await validate(cwd, TEST)).toEqual({ code: EXIT.ok, errors: [] });
  });
});

describe("validate checks a mission's selectors against the world scenarios that offer it (D7)", () => {
  const SIEGE = 'games/samples/mini-siege';
  const SABOTAGE = `${SIEGE}/content/missions/sabotage.mission.json`;
  const FORTIFY = `${SIEGE}/content/missions/fortify.mission.json`;
  type Params = { foes: { select: Record<string, unknown> }[]; wave: { select: Record<string, unknown> }[] };

  it('passes the mini siege as it is, and names a selector that picks nothing in the village', async () => {
    const cwd = copy(SIEGE);
    expect(await validate(cwd, SIEGE)).toEqual({ code: EXIT.ok, errors: [] });
    editJson(join(cwd, SABOTAGE), (m) => {
      (m.params as Params).foes[0]!.select = { faction: 'raiders', types: ['dragon'] };
    });
    editJson(join(cwd, FORTIFY), (m) => {
      (m.params as Params).wave[0]!.select = { keys: ['raider-9'] };
    });
    const run = await validate(cwd, SIEGE);
    expect(run.code).toBe(EXIT.invalidContent);
    expect(run.errors).toEqual([
      expect.objectContaining({
        file: FORTIFY,
        path: 'params.wave.0.select.keys.0',
        code: 'bad_mini_game_use',
        message: `"raider-9" is no key of ${SIEGE}/content/maps/village.world.json`,
      }),
      expect.objectContaining({
        file: SABOTAGE,
        path: 'params.foes.0.select',
        code: 'bad_mini_game_use',
        message: `picks no standing world entity in ${SIEGE}/content/maps/village.world.json`,
      }),
    ]);
  });
});
