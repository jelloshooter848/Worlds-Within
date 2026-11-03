import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mustLoad } from '@engine/core/content/game-content';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { TD_TILE_SIZE, TdBot, TOWERDEFENSE_RULES, type TdBotStep } from '@kits/towerdefense';
import { loadTowerDefense, sampleRound } from './content';
import { createGame } from './headless';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadTowerDefense(readGameFiles(ROOT)));
const SEED = content.manifest.start.seed;

interface Check {
  tick: number;
  path: string;
  op: string;
  value: unknown;
}

interface RunFile {
  ticks: number;
  input: InputScript;
  assertions: Check[];
  guards?: string[];
}

const RUNS = readdirSync(new URL('./runs/', import.meta.url))
  .filter((f) => f.endsWith('.run.json'))
  .map((f) => f.replace(/\.run\.json$/, ''))
  .sort();

function runFile(name: string): RunFile {
  return JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as RunFile;
}

/** A dotted path into a snapshot, as run files read it. */
function at(snap: JsonObject, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], snap);
}

/** Plays a run file's input headless as `pnpm cli run` does; every tick's snapshot (tick 0 first). */
function play(name: string, disabledRules: string[] = []): JsonObject[] {
  const run = runFile(name);
  const game = createGame(content, SEED, { disabledRules });
  const input = new ScriptedInput(run.input);
  const snaps = [game.snapshot()];
  for (let t = 0; t < run.ticks; t++) {
    input.next();
    game.step(input);
    snaps.push(game.snapshot());
  }
  return snaps;
}

/** The checks of a run file that fail on `snaps`. */
function failing(name: string, snaps: JsonObject[]): Check[] {
  return runFile(name).assertions.filter((c) => {
    const v = at(snaps[c.tick]!, c.path);
    const same = (x: unknown) => canonicalJson(x as JsonObject) === canonicalJson(c.value as JsonObject);
    if (c.op === 'contains') return !(v as unknown[]).some(same);
    if (c.op === 'eq') return !same(v);
    throw new Error(`${name}: this test reads only eq and contains assertions, not ${c.op}`);
  });
}

describe('the tower-defense content', () => {
  it('has one map that fills the 256x240 picture, its two tower types and three waves', () => {
    const round = sampleRound(content);
    expect(round.map.id).toBe('road');
    expect(round.map.towers).toEqual(['arrow', 'cannon']);
    expect(round.map.start).toEqual({ gold: 40, lives: 5 });
    expect(round.map.map.length * TD_TILE_SIZE).toBe(content.manifest.screen.height);
    for (const row of round.map.map) expect(row.length * TD_TILE_SIZE).toBe(content.manifest.screen.width);
    expect(Object.keys(round.towers).sort()).toEqual(['arrow', 'cannon']);
    expect(round.waves.id).toBe(round.map.waves);
    expect(round.waves.waves).toHaveLength(3);
  });
});

describe('the tower-defense headless', () => {
  it("starts with the map's gold and lives, no wave and the cursor on the first build cell", () => {
    const snap = createGame(content, SEED).snapshot();
    expect(snap['kit']).toMatchObject({
      outcome: 'playing',
      gold: 40,
      lives: 5,
      wave: 0,
      waves: 3,
      towers: 0,
    });
    expect(snap['controls']).toEqual({ col: 1, row: 2, tower: 'arrow', held: [0, 0, 0, 0] });
  });

  it('finds the four run files', () => {
    expect(RUNS).toEqual(['build', 'leaked', 'target', 'won']);
  });

  it.each(RUNS)('plays %s to the same snapshots twice and passes its assertions', (name) => {
    const a = play(name);
    expect(a.map((s) => canonicalJson(s))).toEqual(play(name).map((s) => canonicalJson(s)));
    expect(failing(name, a)).toEqual([]);
  });

  it('wins with every wave held, and loses to a thin defence', () => {
    const won = play('won').at(-1)!;
    expect(won['kit']).toMatchObject({ outcome: 'won', lives: 5, leaked: 0, wave: 3, towers: 5 });
    const leaked = play('leaked').at(-1)!;
    expect(leaked['kit']).toMatchObject({ outcome: 'lost', lives: 0, leaked: 5, towers: 2 });
  });

  it('passes the rules switched off to the kit: each run fails without a rule it guards', () => {
    for (const name of RUNS)
      for (const rule of runFile(name).guards ?? []) {
        expect(TOWERDEFENSE_RULES.map((r) => r.id)).toContain(rule);
        expect(failing(name, play(name, [rule])), `${name} without ${rule}`).not.toEqual([]);
      }
  });

  it("plays the won run file exactly as the kit's bot plays its plan", () => {
    const plan: TdBotStep[] = [
      { do: 'place', tower: 'arrow', col: 5, row: 4 },
      { do: 'place', tower: 'arrow', col: 3, row: 2 },
      { do: 'wave' },
      { do: 'clear' },
      { do: 'place', tower: 'cannon', col: 11, row: 10 },
      { do: 'wave' },
      { do: 'clear' },
      { do: 'place', tower: 'arrow', col: 8, row: 10 },
      { do: 'place', tower: 'arrow', col: 13, row: 10 },
      { do: 'wave' },
      { do: 'clear' },
    ];
    const run = runFile('won');
    const game = createGame(content, SEED);
    const bot = new TdBot(plan);
    const input = new ScriptedInput({ steps: [] });
    const snaps = [canonicalJson(game.snapshot())];
    for (let t = 0; t < run.ticks; t++) {
      input.setHeld(bot.next(game));
      input.next();
      game.step(input);
      snaps.push(canonicalJson(game.snapshot()));
    }
    expect(snaps).toEqual(play('won').map((s) => canonicalJson(s)));
  });
});
