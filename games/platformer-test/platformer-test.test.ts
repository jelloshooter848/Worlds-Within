import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { loadTest, mustLoad, testStages } from './content';
import { createGame, LEVEL_PAUSE, type TestSnapshot } from './headless';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const FILES = readGameFiles(ROOT);
const content = mustLoad(loadTest(FILES));

/** Snapshots of `ticks` steps holding right from seed 1, tick 0 included. */
function play(ticks: number): string[] {
  const game = createGame(content, 1);
  const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
  const out = [canonicalJson(game.snapshot())];
  for (let i = 0; i < ticks; i++) {
    input.next();
    game.step(input);
    out.push(canonicalJson(game.snapshot()));
  }
  return out;
}

describe('platformer test content', () => {
  it('loads every file with no errors', () => {
    const result = loadTest(FILES);
    expect(result.errors).toEqual([]);
    expect(Object.keys(FILES)).toContain('content/levels/level-1.map.txt');
  });

  it('plays its levels in id order, numbers compared as numbers, each with its own profile', () => {
    const stages = testStages(content);
    expect(stages.map((s) => s.level.id)).toEqual(['level-1']);
    expect(stages.every((s) => s.profile.id === 'hopper')).toBe(true);
  });

  it('orders level-10 after level-2', () => {
    const extra = (id: string) => ({
      [`content/levels/${id}.json`]: FILES['content/levels/level-1.json']!.replace('"level-1"', `"${id}"`),
      [`content/levels/${id}.map.txt`]: FILES['content/levels/level-1.map.txt']!,
    });
    const more = mustLoad(loadTest({ ...FILES, ...extra('level-10'), ...extra('level-2') }));
    expect(testStages(more).map((s) => s.level.id)).toEqual(['level-1', 'level-2', 'level-10']);
  });

  it('reports a broken level field with the file and the field', () => {
    const header = JSON.parse(FILES['content/levels/level-1.json']!) as Record<string, unknown>;
    header['scroll'] = 'sideways';
    const result = loadTest({ ...FILES, 'content/levels/level-1.json': JSON.stringify(header) });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => [e.file, e.path])).toContainEqual([
      'games/platformer-test/content/levels/level-1.json',
      'scroll',
    ]);
  });
});

describe('platformer test headless game', () => {
  it("starts on level-1, stage 0, with the profile's lives and hit points", () => {
    const s = createGame(content, 1).snapshot() as TestSnapshot;
    expect(s).toMatchObject({ level: 'level-1', stage: 0, pause: 0, outcome: 'playing', lives: 3 });
    expect(s.player.hp).toBe(2);
  });

  it('gives equal snapshots on two runs from the same seed', () => {
    expect(play(300)).toEqual(play(300));
  });

  it('starts the failed level afresh after LEVEL_PAUSE ticks', () => {
    const game = createGame(content, 1);
    game.world.lives = 1;
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    let ticks = 0;
    while (game.world.outcome === 'playing' && ticks++ < 1000) {
      input.next();
      game.step(input);
    }
    expect(game.world.outcome).toBe('failed');
    const failed = game.world;
    for (let i = 0; i < LEVEL_PAUSE; i++) {
      input.next();
      game.step(input);
    }
    expect(game.world).not.toBe(failed);
    expect(game.snapshot()).toMatchObject({ level: 'level-1', stage: 0, pause: 0, outcome: 'playing' });
  });
});
