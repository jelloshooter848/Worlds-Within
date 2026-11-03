import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
import { screenAtCell } from '@kits/towerdefense';
import { loadTowerDefense } from './content';
import { tdPicture } from './picture';
import { STEPS_PER_TICK, TdPlay } from './play';

// The page's glue played headless (Engine 0.12 T5): `TdPlay` stepped as the page's loop steps it
// (two loop steps a game tick), drawing every step into the null backend. The `won` run file's
// input, typed one loop step at a time, wins the same round with the same state hash as the run's
// last golden one; a key pressed for a single loop step between ticks still counts; taps (frame
// input, gap D1) move the cursor, place and sell, and the `tapped` run's taps play to its golden
// hash; page buttons press their action on the next tick. The scene runs on a `SceneStack`, which
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
const wonInput = () =>
  (
    JSON.parse(readFileSync(new URL('./runs/won.run.json', import.meta.url), 'utf8')) as {
      input: InputScript;
    }
  ).input;

/**
 * A frame holding nothing and tapping at `taps`, for one loop step: each cell's centre on the
 * picture by the kit's `screenAtCell` (gap D13; the 16x15 map fills the 256x240 picture).
 */
function tapFrame(...taps: { col: number; row: number; button?: 'primary' | 'secondary' }[]): ScriptedInput {
  const input = new ScriptedInput({
    steps: [],
    taps: taps.map((t) => ({
      frame: 0,
      ...screenAtCell(t, { size: content.manifest.screen }, { cols: 16, rows: 15 }),
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
  it('plays the won run file typed one tick at a time to the same round', () => {
    const p = page();
    const script = wonInput();
    // The page's keys: each tick's held actions are down for that tick's loop steps.
    const input = new ScriptedInput({
      steps: script.steps.map((s) => ({ frame: s.frame * STEPS_PER_TICK, hold: s.hold })),
    });
    while (p.play.tick < 700) p.step(input);
    expect(p.kit()).toMatchObject({ outcome: 'won', lives: 5, killed: 21, gold: 33 });
    expect(hash(p.play.game.snapshot())).toBe(goldenAt('won', 700));
    const events = p.frames.flatMap((f) => f.events.map((e) => e.type));
    for (const type of ['td-place', 'td-wave-start', 'td-shot', 'td-kill', 'td-wave-clear', 'td-end'])
      expect(events, type).toContain(type);
    expect(p.frames.at(-1)!.status).toMatchObject({ outcome: 'won', wave: '3/3' });
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

  it('places with a second tap on the cursor cell, sells with a secondary tap (taps are frame input)', () => {
    const p = page();
    p.step(tapFrame({ col: 5, row: 4 })); // a tap on a tick's first loop step reaches the tick
    p.step();
    expect(p.play.game.controls.view()).toMatchObject({ col: 5, row: 4 });
    expect(p.kit()['towers']).toBe(0);
    expect(p.frames.at(-1)!.entities.find((e) => e.id === 'ghost')?.tags).toEqual(['ok']);
    p.step();
    p.step(tapFrame({ col: 5, row: 4 }));
    expect(p.kit()).toMatchObject({ towers: 1, gold: 30 });
    expect(p.frames.at(-1)!.entities.find((e) => e.id === 'ghost')?.tags).toEqual([
      'blocked',
      'why:occupied',
    ]);
    p.step(tapFrame({ col: 5, row: 4, button: 'secondary' }));
    p.step();
    expect(p.kit()).toMatchObject({ towers: 0, gold: 35 });
  });

  it("plays the tapped run file's input, tapped one tick at a time, to its golden hash", () => {
    const p = page();
    const run = JSON.parse(readFileSync(new URL('./runs/tapped.run.json', import.meta.url), 'utf8')) as {
      ticks: number;
      input: InputScript;
    };
    // Each tick's input on that tick's first loop step.
    const input = new ScriptedInput({
      steps: run.input.steps.map((s) => ({ frame: s.frame * STEPS_PER_TICK, hold: s.hold })),
      taps: (run.input.taps ?? []).map((t) => ({ ...t, frame: t.frame * STEPS_PER_TICK })),
    });
    while (p.play.tick < run.ticks) p.step(input);
    expect(hash(p.play.game.snapshot())).toBe(goldenAt('tapped', run.ticks));
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
