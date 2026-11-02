import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from './exit-codes';
import { main } from './main';

// Engine 0.11 T5 (item 172): a game run file's `missions` steps go, without `tick`, to the game's
// `mission` method after the tick's orders; refusals are listed in `refusedMissions` and the
// game's `missionExperience` gives `experience`. The game is a plain-JS headless module written to
// a temp folder (as in orders-run.test.ts), so the tools are tested without any game's code.

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-game-missions-'));
  temps.push(dir);
  return dir;
}

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

/**
 * A game with missions: `open` records the tick, `play` starts a "round" that lasts as many ticks
 * as its script holds attack at frame 0 (3 when the step carries no input), during which the game's
 * tick does not move; a second `play` is refused.
 */
function missionGame(run: Record<string, unknown>, withMission = true): { cwd: string; file: string } {
  const cwd = tempDir();
  const game = join(cwd, 'games/sieged');
  mkdirSync(join(game, 'runs'), { recursive: true });
  const manifest = {
    id: 'sieged',
    kit: 'topdown',
    content: {},
    start: { seed: 1 },
    headless: 'headless.mjs',
  };
  writeFileSync(join(game, 'game.json'), JSON.stringify(manifest));
  const mission = withMission
    ? `mission(step) {
        if (step.action === 'open') { state.log.push([state.tick, 'open', step.mission]); return null; }
        if (step.action === 'play') {
          if (state.played) return { code: 'mission_resolved', error: 'no do-overs' };
          state.played = true;
          state.round = step.input ? step.input.steps.length + 2 : 3;
          state.log.push([state.tick, 'play', step.mission]);
          return null;
        }
        return { code: 'unknown', error: 'not ' + step.action };
      },
      missionExperience: () => (state.played ? [{ mission: 'raid', ticks: state.spent }] : []),`
    : '';
  writeFileSync(
    join(game, 'headless.mjs'),
    `export function createGame() {
  const state = { tick: 0, log: [], played: false, round: 0, spent: 0 };
  return {
    step() {
      if (state.round > 0) { state.round -= 1; state.spent += 1; return; }
      state.tick += 1;
    },
    snapshot: () => JSON.parse(JSON.stringify(state)),
    ${mission}
  };
}
`,
  );
  writeFileSync(join(game, 'runs', 'm.run.json'), JSON.stringify({ game: '..', ticks: 10, ...run }));
  return { cwd, file: 'games/sieged/runs/m.run.json' };
}

const steps = [
  { tick: 1, mission: 'raid', action: 'open' },
  { tick: 1, mission: 'raid', action: 'play', input: { steps: [{ frame: 0, hold: ['attack'] }] } },
  { tick: 6, mission: 'raid', action: 'play' },
];

describe('a game run with missions', () => {
  it('hands each step to the game after its tick, lists refusals and reports experience', async () => {
    const { cwd, file } = missionGame({
      missions: steps,
      assertions: [
        { tick: 1, path: 'log', op: 'eq', value: [] },
        {
          tick: 2,
          path: 'log',
          op: 'eq',
          value: [
            [1, 'open', 'raid'],
            [1, 'play', 'raid'],
          ],
        },
        { tick: 4, path: 'tick', op: 'eq', value: 1 },
        { tick: 10, path: 'tick', op: 'eq', value: 7 },
      ],
    });
    const { code, result } = await cli(['run', file], cwd);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({
      passed: true,
      missions: 3,
      missionsPlayed: 3,
      refusedMissions: [
        { tick: 6, mission: 'raid', action: 'play', code: 'mission_resolved', error: 'no do-overs' },
      ],
      experience: [{ mission: 'raid', ticks: 3 }],
    });
  });

  it('gives the same hashes every run, and keeps the steps in dump and in a replay file', async () => {
    const { cwd, file } = missionGame({ missions: steps, hashEvery: 2 });
    const a = await cli(['run', file], cwd);
    const b = await cli(['run', file], cwd);
    expect(b.result.hashes).toEqual(a.result.hashes);

    const dumped = await cli(['dump', file, '--tick', '3'], cwd);
    expect(dumped.code).toBe(EXIT.ok);
    expect(dumped.result.missions).toEqual(steps.slice(0, 2));

    const failing = missionGame({
      missions: steps,
      assertions: [{ tick: 8, path: 'tick', op: 'eq', value: 99 }],
    });
    const failed = await cli(['run', failing.file], failing.cwd);
    expect(failed.code).toBe(EXIT.failedCheck);
    const replay = JSON.parse(
      readFileSync(join(failing.cwd, failed.result.replayFile as string), 'utf8'),
    ) as {
      missions: unknown[];
    };
    expect(replay.missions).toEqual(steps);
    const again = await cli(['run', failed.result.replayFile as string], failing.cwd);
    expect(again.result.replay).toMatchObject({ reproduced: true, hashMismatch: null });
  });

  it('is a usage error for a game without a mission method', async () => {
    const { cwd, file } = missionGame({ missions: steps }, false);
    const { code, result } = await cli(['run', file], cwd);
    expect(code).toBe(EXIT.usage);
    expect(JSON.stringify(result.error)).toContain('no mission(step) method');
  });
});
