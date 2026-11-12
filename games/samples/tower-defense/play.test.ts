import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullPresenter } from '@engine/backends/null';
import { mustLoad } from '@engine/core/content/game-content';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import type { Renderer } from '@engine/core/gfx/renderer';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { InputManager, type InputFrame } from '@engine/core/input/input-manager';
import { readGameFiles } from '@engine/core/node/game-files';
import type { PresentFrame } from '@engine/core/present';
import { SceneStack } from '@engine/core/scene';
import { screenAtCell, TdBot } from '@kits/towerdefense';
import { loadTowerDefense } from './content';
import { WIN_PLAN } from './plans';
import { tdPicture } from './picture';
import { STEPS_PER_TICK, TdPlay } from './play';

// The page's glue played headless (Engine 0.12 T5): `TdPlay` stepped as the page's loop steps it
// (two loop steps a game tick), drawing every step into the null backend. The `win` run file's
// input, typed one loop step at a time, wins the same round (all ten waves, Engine 0.16 E9) with
// the same state hash as the run's last golden one, at 1x and at 3x (the shell's speed control:
// `SceneStack.speed` and `advance`, every hashed tick the golden one); the win's defence played by
// the kit's bot at 2x and 3x is recorded by the scene as the `sped-up` run file; a key pressed for a single loop step between
// ticks still counts; taps (frame input, gap D1) move the cursor, place, upgrade and sell; page
// buttons press their action on the next tick. The scene runs on a `SceneStack`, which
// paces it at its `tickRate` as the shell does (gap D2).

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadTowerDefense(readGameFiles(ROOT)));
const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 16);
const goldenAt = (name: string, tick: number) =>
  (
    JSON.parse(readFileSync(new URL(`./runs/${name}.hashes.json`, import.meta.url), 'utf8')) as {
      hashes: { tick: number; hash: string }[];
    }
  ).hashes.find((h) => h.tick === tick)!.hash;
const runFile = (name: string) =>
  JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as {
    ticks: number;
    hashEvery: number;
    input: InputScript;
  };
const golden = (name: string) =>
  (
    JSON.parse(readFileSync(new URL(`./runs/${name}.hashes.json`, import.meta.url), 'utf8')) as {
      hashes: { tick: number; hash: string }[];
    }
  ).hashes;

/**
 * A frame holding nothing and tapping at `taps`, for one loop step: each cell's centre on the
 * picture by the kit's `screenAtCell` (gap D13; the 30x16 map across the 480x270 picture, centred
 * 7 px down).
 */
function tapFrame(...taps: { col: number; row: number; button?: 'primary' | 'secondary' }[]): ScriptedInput {
  const input = new ScriptedInput({
    steps: [],
    taps: taps.map((t) => ({
      frame: 0,
      ...screenAtCell(t, { size: content.manifest.screen }, { cols: 30, rows: 16 }),
      ...(t.button && { button: t.button }),
    })),
  });
  return input;
}

/** The page's scene on the shell's `SceneStack` (its `tickRate` paced there), drawing into the null backend. */
function page() {
  const presenter = new NullPresenter({ validate: true, freeze: true });
  const play = new TdPlay({
    content,
    seed: content.manifest.start.seed,
    picture: (_r, game) => tdPicture(presenter, content.manifest.screen, () => game.controls.view()),
  });
  const stack = new SceneStack();
  stack.push(play);
  const frames: PresentFrame[] = [];
  /** One loop step with `input` (nothing held by default), then a draw. */
  const step = (input: InputFrame = new ScriptedInput({ steps: [] })) => {
    if (input instanceof ScriptedInput) input.next();
    stack.update([input]);
    stack.render({} as Renderer);
    frames.push(presenter.last as PresentFrame);
  };
  const kit = () => play.game.snapshot()['kit'] as JsonObject;
  return { play, step, frames, kit };
}

describe('the tower-defense page, headless', () => {
  it('plays the win run file typed one tick at a time to the same round', () => {
    const p = page();
    const script = runFile('win').input;
    // The page's keys: each tick's held actions are down for that tick's loop steps.
    const input = new ScriptedInput({
      steps: script.steps.map((s) => ({ frame: s.frame * STEPS_PER_TICK, hold: s.hold })),
    });
    while (p.play.tick < 3150) p.step(input);
    expect(p.kit()).toMatchObject({ outcome: 'won', lives: 18, killed: 138, gold: 120, stars: 3 });
    expect(hash(p.play.game.snapshot())).toBe(goldenAt('win', 3150));
    expect(p.play.recording()).toEqual({ ticks: 3150, input: script });
    const events = p.frames.flatMap((f) => f.events.map((e) => e.type));
    for (const type of ['td-place', 'td-wave-start', 'td-shot', 'td-kill', 'td-wave-clear', 'td-end'])
      expect(events, type).toContain(type);
    expect(p.frames.at(-1)!.status).toMatchObject({
      outcome: 'won',
      wave: '10/10',
      stars: 3,
      wavesHeld: 10,
      killed: 138,
    });
    // The music's danger layer reads `nearGate`: enemies came near the gate (two got through).
    expect(p.frames.some((f) => (f.status.nearGate as number) > 0)).toBe(true);
  });

  it.each([1, 3])(
    "plays the win's input at %ix on the SceneStack (the shell's speed control) with every golden hash",
    (speed) => {
      const presenter = new NullPresenter();
      const play = new TdPlay({
        content,
        seed: content.manifest.start.seed,
        picture: (_r, game) => tdPicture(presenter, content.manifest.screen, () => game.controls.view()),
      });
      const stack = new SceneStack();
      stack.push(play);
      stack.speed = speed;
      const run = runFile('win');
      // The keyboard: each tick's held actions down for that tick's loop steps (samples).
      const keys = new ScriptedInput({
        steps: run.input.steps.map((s) => ({ frame: s.frame * STEPS_PER_TICK, hold: s.hold })),
      });
      const hashes: { tick: number; hash: string }[] = [];
      // Every hashed tick's state, read between the speed-up's updates (`next` is sampled there).
      const seen = () => {
        const t = play.tick;
        if ((t % run.hashEvery === 0 || t === run.ticks) && hashes.at(-1)?.tick !== t)
          hashes.push({ tick: t, hash: hash(play.game.snapshot()) });
      };
      const sample = () => {
        seen();
        keys.next();
        return [keys];
      };
      let loopSteps = 0;
      while (play.tick < run.ticks) {
        stack.advance(sample(), sample);
        loopSteps++;
        seen();
        stack.render({} as Renderer);
      }
      expect(play.tick).toBe(run.ticks);
      expect(hashes).toEqual(golden('win'));
      // 3x: three loop steps' worth of ticks in each, a third of the loop steps.
      expect(loopSteps).toBe((run.ticks * STEPS_PER_TICK) / speed);
    },
  );

  it("records the win's defence played at 2x and 3x as the sped-up run file", () => {
    const presenter = new NullPresenter();
    const play = new TdPlay({
      content,
      seed: content.manifest.start.seed,
      picture: (_r, game) => tdPicture(presenter, content.manifest.screen, () => game.controls.view()),
    });
    const stack = new SceneStack();
    stack.push(play);
    const run = runFile('sped-up');
    // A player at the keys: the kit's bot decides once a tick what to hold (a press, then a
    // released tick), sampled on every loop step and every extra step of the speed-up.
    const bot = new TdBot(WIN_PLAN);
    const keys = new ScriptedInput({ steps: [] });
    let decided = -1;
    let held: ReturnType<TdBot['next']> = [];
    const sample = () => {
      if (play.tick !== decided) {
        decided = play.tick;
        held = bot.next(play.game);
      }
      keys.setHeld(held);
      keys.next();
      return [keys];
    };
    const speeds = new Set<number>();
    while (play.tick < run.ticks) {
      // F pressed between waves (2x) and during them (3x); 1x for the last ticks, to stop on time.
      const w = play.game.world;
      stack.speed = run.ticks - play.tick <= 6 ? 1 : w.enemies.length > 0 ? 3 : 2;
      speeds.add(stack.speed);
      stack.advance(sample(), sample);
      stack.render({} as Renderer);
    }
    expect([...speeds].sort()).toEqual([1, 2, 3]);
    const recording = play.recording();
    if (process.env['WW_UPDATE_GOLDEN'] === '1') {
      const file = new URL('./runs/sped-up.run.json', import.meta.url);
      const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      writeFileSync(file, JSON.stringify({ ...json, ...recording }, null, 2) + '\n');
    }
    expect(recording).toEqual({ ticks: run.ticks, input: run.input });
    expect(play.game.snapshot()['kit']).toMatchObject({ outcome: 'won', stars: 3, lives: 18 });
    expect(hash(play.game.snapshot())).toBe(goldenAt('sped-up', run.ticks));
  });

  it("steps one game tick every STEPS_PER_TICK loop steps (the scene's tickRate)", () => {
    const p = page();
    expect(p.play.tickRate * STEPS_PER_TICK).toBe(60);
    for (let i = 0; i < STEPS_PER_TICK * 5; i++) p.step();
    expect(p.play.tick).toBe(5);
  });

  it('counts a key pressed for one loop step between ticks', () => {
    const p = page();
    p.step(); // a tick's first loop step
    const start = p.play.game.controls.view();
    p.step(new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] })); // pressed, then the tick
    expect(p.play.game.controls.view().col).toBe(start.col + 1);
    // A tick with nothing held, then pressed on the step after a tick and released before the
    // next: still one move.
    p.step();
    p.step();
    p.step(new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] }));
    p.step();
    expect(p.play.game.controls.view().col).toBe(start.col + 2);
  });

  it('places with a second tap on the cursor cell, upgrades with two more, sells with a secondary tap', () => {
    const p = page();
    p.step(tapFrame({ col: 4, row: 4 })); // a tap on a tick's first loop step reaches the tick
    p.step();
    expect(p.play.game.controls.view()).toMatchObject({ col: 4, row: 4 });
    expect(p.kit()['towers']).toBe(0);
    expect(p.frames.at(-1)!.entities.find((e) => e.id === 'ghost')?.tags).toEqual(['ok', 'range:2']);
    p.step();
    p.step(tapFrame({ col: 4, row: 4 }));
    expect(p.kit()).toMatchObject({ towers: 1, gold: 50 });
    expect(p.frames.at(-1)!.entities.find((e) => e.id === 'ghost')?.tags).toEqual([
      'blocked',
      'why:occupied',
      'selected',
      'range:2',
    ]);
    // A tap on the selected tower upgrades it (8 gold for the arrow's level 2).
    p.step(tapFrame({ col: 4, row: 4 }));
    p.step();
    expect(p.kit()).toMatchObject({ towers: 1, gold: 42 });
    p.step(tapFrame({ col: 4, row: 4, button: 'secondary' }));
    p.step();
    expect(p.kit()).toMatchObject({ towers: 0, gold: 51 });
  });

  it("presses page buttons (the shell's InputManager.press) on the next tick", () => {
    const p = page();
    const manager = new InputManager(1);
    manager.press('attack');
    manager.press('start');
    for (let i = 0; i < STEPS_PER_TICK; i++) {
      manager.beginFrame();
      p.step(manager.player(0));
    }
    expect(p.play.game.controls.view().tower).toBe('cannon');
    expect(p.kit()['wave']).toBe(1);
    for (let i = 0; i < STEPS_PER_TICK * 4; i++) {
      manager.beginFrame();
      p.step(manager.player(0));
    }
    expect(p.play.tick).toBe(5);
    expect(p.kit()['wave']).toBe(1);
  });
});
