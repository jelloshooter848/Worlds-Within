import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullPresenter } from '@engine/backends/null';
import { mustLoad } from '@engine/core/content/game-content';
import { canonicalJson } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { MINI_GAME_STATUS, type PresentFrame } from '@engine/core/present';
import { SceneStack } from '@engine/core/scene';
import type { Renderer } from '@engine/core/gfx/renderer';
import { loadMiniSiege } from './content';
import { siegePicture } from './picture';
import { SiegePlay } from './play';

// The page's glue played headless (Engine 0.11 T9): `SiegePlay` and its `HostScene` on a real
// `SceneStack`, as `main.ts` boots them, driven through the launch button, then play (the recorded
// round of `played.run.json` fed as the page's keys) or delegate. Each path reaches a committed
// result, and with the launch at world tick 40, as in the run files, the same state hash at world
// tick 260 as the run file's last one: the page plays the game the tools play. Engine 0.12 T7:
// the same for the preparation phase, `fortify` launched at world tick 10 and played (the recorded
// round of `fortify-played.run.json`) or delegated.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadMiniSiege(readGameFiles(ROOT)));
const NONE: InputFrame = new ScriptedInput({ steps: [] });
const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 16);
const lastHash = (name: string) =>
  (
    JSON.parse(readFileSync(new URL(`./runs/${name}.hashes.json`, import.meta.url), 'utf8')) as {
      hashes: { tick: number; hash: string }[];
    }
  ).hashes.at(-1)!.hash;
const recordedRound = (name = 'played') =>
  (
    JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as {
      missions: { action: string; input?: InputScript }[];
    }
  ).missions.find((m) => m.action === 'play')!.input!;

/** The page: the scene stack with `SiegePlay`'s scene, drawing every step into the null backend. */
function page() {
  const play = new SiegePlay({ content, seed: content.manifest.start.seed, pointer: null, stepsPerTick: 1 });
  const stack = new SceneStack();
  const presenter = new NullPresenter({ validate: true, freeze: true });
  stack.push(play.scene(stack, () => siegePicture(presenter, content, play.ui)));
  const frames: PresentFrame[] = [];
  const step = (input: InputFrame = NONE) => {
    stack.update([input]);
    stack.render({} as Renderer);
    frames.push(presenter.last as PresentFrame);
  };
  return { play, stack, step, frames };
}

/** Steps the battle to world tick 40, where the launch button offers the sabotage. */
function toLaunch(p: ReturnType<typeof page>): void {
  expect(p.play.launchButtons()).toEqual([]);
  while (p.play.tick < 40) p.step();
  expect(p.play.launchButtons()).toEqual(['sabotage']);
  p.play.press({ kind: 'launch', mission: 'sabotage' });
  p.step();
  expect(p.play.choice()).toBe('sabotage');
  expect(p.play.launchButtons()).toEqual([]);
  // Nothing steps while the choice is shown.
  p.step();
  expect(p.play.tick).toBe(40);
}

/** Steps the battle to world tick 10 and launches the fortify mission (the preparation phase). */
function toFortify(p: ReturnType<typeof page>): void {
  while (p.play.tick < 10) p.step();
  expect(p.play.launchButtons()).toEqual(['fortify']);
  p.play.press({ kind: 'launch', mission: 'fortify' });
  p.step();
  expect(p.play.choice()).toBe('fortify');
  p.step();
  expect(p.play.tick).toBe(10);
}

/** Steps on until world tick 260. */
function toEnd(p: ReturnType<typeof page>): void {
  while (p.play.tick < 260) p.step();
}

describe('the page glue, headless', () => {
  it('delegates: the battle freezes, the world draws ram-burnt at the commit tick', () => {
    const p = page();
    toLaunch(p);
    p.play.press({ kind: 'delegate' });
    p.step();
    expect(p.play.choice()).toBeNull();
    expect(p.play.game.miniGame()).toBeNull();
    while (p.play.records().length === 0) p.step();
    expect(p.play.tick).toBe(160);
    expect(p.play.records()[0]).toMatchObject({
      outcome: 'ram-burnt',
      resolution: 'delegated',
      commitTick: 160,
    });
    expect(p.frames.some((f) => f.events.some((e) => e.type === 'mission-open'))).toBe(true);
    expect(p.frames.at(-1)!.events).toEqual([
      { type: 'mission-commit', mission: 'sabotage', outcome: 'ram-burnt', resolution: 'delegated' },
    ]);
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('delegated'));
  });

  it('plays: the round is pushed over the battle, then both engines burn at the commit tick', () => {
    const p = page();
    toLaunch(p);
    const keys = new ScriptedInput(recordedRound());
    p.play.press({ kind: 'play' });
    let roundTicks = 0;
    do {
      keys.next();
      p.step(keys);
      roundTicks++;
      if (roundTicks === 1) {
        expect(p.stack.depth).toBe(2);
        expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('mission-room');
        expect(p.frames.at(-1)!.status['host:mission']).toBe('Burn the siege engines');
      }
    } while (p.play.game.miniGame() !== null);
    expect(roundTicks).toBe(406);
    expect(p.play.tick).toBe(40);
    // The round's scene popped itself on the tick it ended: that frame is the battle's again.
    expect(p.stack.depth).toBe(1);
    expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('');
    expect(p.frames.at(-1)!.events).toContainEqual({
      type: 'mini-game-end',
      game: 'mission-room',
      result: 'pass',
    });
    while (p.play.records().length === 0) p.step();
    expect(p.play.tick).toBe(160);
    expect(p.play.records()[0]).toMatchObject({
      outcome: 'both-burnt',
      resolution: 'played',
      commitTick: 160,
    });
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('played'));
  });

  it('refuses a launch once the window has closed, and keeps the reason', () => {
    const p = page();
    while (p.play.tick < 200) p.step();
    expect(p.play.launchButtons()).toEqual([]);
    p.play.press({ kind: 'launch', mission: 'sabotage' });
    p.step();
    expect(p.play.choice()).toBeNull();
    expect(p.play.message).toMatch(/^not_offered: /);
  });

  it('delegates the preparation phase: overrun lands at the commit tick, 30 after the launch', () => {
    const p = page();
    toFortify(p);
    p.play.press({ kind: 'delegate' });
    p.step();
    while (p.play.records().length === 0) p.step();
    expect(p.play.tick).toBe(40);
    expect(p.play.records()[0]).toMatchObject({ mission: 'fortify', outcome: 'overrun', commitTick: 40 });
    expect(p.frames.at(-1)!.events).toEqual([
      { type: 'mission-commit', mission: 'fortify', outcome: 'overrun', resolution: 'delegated' },
    ]);
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('fortify-delegated'));
  });

  it('plays the preparation phase: the walls round is pushed, then held-cheap lands at the commit', () => {
    const p = page();
    toFortify(p);
    const keys = new ScriptedInput(recordedRound('fortify-played'));
    p.play.press({ kind: 'play' });
    let roundTicks = 0;
    do {
      keys.next();
      p.step(keys);
      roundTicks++;
      if (roundTicks === 1) {
        expect(p.stack.depth).toBe(2);
        expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('td-defence');
        expect(p.frames.at(-1)!.status['host:mission']).toBe('Man the walls');
      }
    } while (p.play.game.miniGame() !== null);
    expect(roundTicks).toBe(116);
    expect(p.play.tick).toBe(10);
    expect(p.stack.depth).toBe(1);
    expect(p.frames.at(-1)!.events).toContainEqual({
      type: 'mini-game-end',
      game: 'td-defence',
      result: 'pass',
    });
    while (p.play.records().length === 0) p.step();
    expect(p.play.tick).toBe(40);
    expect(p.play.records()[0]).toMatchObject({
      outcome: 'held-cheap',
      resolution: 'played',
      commitTick: 40,
    });
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('fortify-played'));
  });
});
