import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullPresenter } from '@engine/backends/null';
import { mustLoad } from '@engine/core/content/game-content';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import type { Renderer } from '@engine/core/gfx/renderer';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import type { PointerGesture } from '@engine/core/input/pointer-logic';
import { readGameFiles } from '@engine/core/node/game-files';
import type { PresentFrame } from '@engine/core/present';
import { TD_TILE_SIZE } from '@kits/towerdefense';
import { loadTowerDefense } from './content';
import { tdPicture } from './picture';
import { STEPS_PER_TICK, TdPlay } from './play';

// The page's glue played headless (Engine 0.12 T5): `TdPlay` stepped as the page's loop steps it
// (two loop steps a game tick), drawing every step into the null backend. The `won` run file's
// input, typed one loop step at a time, wins the same round with the same state hash as the run's
// last golden one; a key pressed for a single loop step between ticks still counts; taps move the
// cursor, place and sell; page buttons press their action on the next tick.

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

/** The page's scene with a scripted pointer, drawing into the null backend. */
function page() {
  const taps: PointerGesture[] = [];
  const presenter = new NullPresenter({ validate: true, freeze: true });
  const play = new TdPlay({
    content,
    seed: content.manifest.start.seed,
    pointer: { gestures: () => taps.splice(0) },
    picture: (_r, game) => tdPicture(presenter, content.manifest.screen, () => game.controls.view()),
  });
  const frames: PresentFrame[] = [];
  /** One loop step with `input` (nothing held by default), then a draw. */
  const step = (input = new ScriptedInput({ steps: [] })) => {
    input.next();
    play.update(input);
    play.render({} as Renderer);
    frames.push(presenter.last as PresentFrame);
  };
  const tap = (col: number, row: number, button: 'primary' | 'secondary' = 'primary') =>
    taps.push({
      type: 'tap',
      button,
      x: (col + 0.5) * TD_TILE_SIZE,
      y: (row + 0.5) * TD_TILE_SIZE,
      kind: 'mouse',
    });
  const kit = () => play.game.snapshot()['kit'] as JsonObject;
  return { play, step, tap, frames, kit };
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

  it('places with a second tap on the cursor cell, sells with a secondary tap', () => {
    const p = page();
    p.tap(5, 4);
    for (let i = 0; i < STEPS_PER_TICK; i++) p.step();
    expect(p.play.game.controls.view()).toMatchObject({ col: 5, row: 4 });
    expect(p.kit()['towers']).toBe(0);
    expect(p.frames.at(-1)!.entities.find((e) => e.id === 'ghost')?.tags).toEqual(['ok']);
    p.tap(5, 4);
    for (let i = 0; i < STEPS_PER_TICK; i++) p.step();
    expect(p.kit()).toMatchObject({ towers: 1, gold: 30 });
    expect(p.frames.at(-1)!.entities.find((e) => e.id === 'ghost')?.tags).toEqual([
      'blocked',
      'why:occupied',
    ]);
    p.tap(5, 4, 'secondary');
    for (let i = 0; i < STEPS_PER_TICK; i++) p.step();
    expect(p.kit()).toMatchObject({ towers: 0, gold: 35 });
  });

  it('presses page buttons on the next tick', () => {
    const p = page();
    p.play.press('attack');
    p.play.press('start');
    for (let i = 0; i < STEPS_PER_TICK; i++) p.step();
    expect(p.play.game.controls.view().tower).toBe('cannon');
    expect(p.kit()['wave']).toBe(1);
    for (let i = 0; i < STEPS_PER_TICK * 4; i++) p.step();
    expect(p.play.tick).toBe(5);
    expect(p.kit()['wave']).toBe(1);
  });
});
