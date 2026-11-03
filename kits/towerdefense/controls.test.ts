import { describe, expect, it } from 'vitest';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { fixtureRound } from './__fixtures__/game';
import { cellAtScreen, gridOf, REPEAT_DELAY, REPEAT_EVERY, TdControls } from './controls';
import { tdGame } from './game';
import { presentWorld } from './present';
import { TdWorld, type TdCommand } from './world';

const SIZE = { width: 256, height: 240 };
const round = () => new TdWorld(fixtureRound(), { seed: 1 });

/** Feeds the controls `frames` frames of a script, returning each frame's commands. */
function drive(c: TdControls, script: InputScript, frames: number): TdCommand[][] {
  const input = new ScriptedInput(script);
  const out: TdCommand[][] = [];
  for (let i = 0; i < frames; i++) {
    input.next();
    out.push(c.input(input));
  }
  return out;
}

const hold = (...pairs: [number, Action[]][]): InputScript => ({
  steps: pairs.map(([frame, h]) => ({ frame, hold: h })),
});

describe('the cursor and buttons', () => {
  it('starts on the first build cell with the first tower type', () => {
    const c = new TdControls(gridOf(round()));
    expect(c.view()).toEqual({ col: 1, row: 1, tower: 'arrow' });
    expect(gridOf(round())).toMatchObject({ cols: 6, rows: 4, towers: ['arrow', 'cannon'] });
  });

  it('moves one cell a press, repeats while held, and stays on the map', () => {
    const c = new TdControls(gridOf(round()));
    drive(c, hold([0, ['right']], [1, []], [2, ['right']], [3, []]), 4);
    expect([c.col, c.row]).toEqual([3, 1]);
    const d = new TdControls(gridOf(round()));
    const n = REPEAT_DELAY + REPEAT_EVERY + 1;
    drive(d, hold([0, ['right']]), n);
    // The press, then one repeat at REPEAT_DELAY and one REPEAT_EVERY later: three cells, capped at 5.
    expect(d.col).toBe(4);
    drive(d, hold([0, ['right']]), 40);
    expect(d.col).toBe(5);
    drive(d, hold([0, ['up']]), 40);
    expect(d.row).toBe(0);
    drive(d, hold([0, ['left', 'down']]), 1);
    expect([d.col, d.row]).toEqual([4, 1]);
  });

  it('cycles the tower type with attack, places with jump, sells with special, starts waves with start', () => {
    const c = new TdControls(gridOf(round()));
    const cmds = drive(
      c,
      hold(
        [0, ['attack']],
        [1, []],
        [2, ['jump']],
        [3, []],
        [4, ['attack']],
        [5, ['special']],
        [6, ['start']],
      ),
      7,
    );
    expect(cmds).toEqual([
      [],
      [],
      [{ type: 'place', tower: 'cannon', col: 1, row: 1 }],
      [],
      [],
      [{ type: 'sell', col: 1, row: 1 }],
      [{ type: 'start-wave' }],
    ]);
    expect(c.tower).toBe('arrow');
    expect(c.choose('cannon')).toBe(true);
    expect(c.choose('nope')).toBe(false);
    expect(c.tower).toBe('cannon');
  });

  it('places and starts the wave in a round played from ScriptedInput', () => {
    const g = tdGame({ ...fixtureRound(), seed: 1 });
    const input = new ScriptedInput(
      hold([0, ['jump']], [1, ['right']], [2, []], [3, ['right']], [4, ['jump']], [5, ['start']], [6, []]),
    );
    for (let i = 0; i < 8; i++) {
      input.next();
      g.step(input);
    }
    expect(g.world.towers.map((t) => [t.type, t.col, t.row])).toEqual([
      ['arrow', 1, 1],
      ['arrow', 3, 1],
    ]);
    expect(g.world.wavesStarted).toBe(1);
    expect(g.world.gold).toBe(10);
  });
});

describe('pointer taps', () => {
  it('maps picture points to cells through the frame camera (a small map centred, zoomed)', () => {
    const w = round();
    const grid = gridOf(w);
    const frame = presentWorld(w, { size: SIZE });
    // 96 x 64 map in a 256 x 240 picture: its top-left is at picture (80, 88).
    expect(cellAtScreen(80, 88, frame, grid)).toEqual({ col: 0, row: 0 });
    expect(cellAtScreen(80 + 16 + 1, 88 + 16 + 1, frame, grid)).toEqual({ col: 1, row: 1 });
    expect(cellAtScreen(79, 88, frame, grid)).toBeNull();
    expect(cellAtScreen(80 + 96, 88, frame, grid)).toBeNull();
    const zoomed = presentWorld(w, { size: SIZE, zoom: 2 });
    // 128 x 120 world px shown: the map's top-left at world (-16, -28), picture (32, 56).
    expect(cellAtScreen(32 + 3 * 32 + 1, 56 + 32 + 1, zoomed, grid)).toEqual({ col: 3, row: 1 });
    const big = presentWorld(w, { size: { width: 64, height: 48 } });
    // A map larger than the picture: the hint's centre (48, 32) puts world (16, 8) at picture (0, 0).
    expect(cellAtScreen(0, 0, big, grid)).toEqual({ col: 1, row: 0 });
  });

  it('moves the cursor on a tap, places on a tap on the cursor, sells on a secondary tap', () => {
    const w = round();
    const c = new TdControls(gridOf(w));
    const frame = presentWorld(w, { size: SIZE });
    const at = (col: number, row: number): [number, number] => [80 + col * 16 + 8, 88 + row * 16 + 8];
    expect(c.tap(...at(3, 1), frame)).toEqual([]);
    expect([c.col, c.row]).toEqual([3, 1]);
    expect(c.tap(...at(3, 1), frame)).toEqual([{ type: 'place', tower: 'arrow', col: 3, row: 1 }]);
    expect(c.tap(...at(2, 3), frame, 'secondary')).toEqual([{ type: 'sell', col: 2, row: 3 }]);
    expect([c.col, c.row]).toEqual([2, 3]);
    expect(c.tap(0, 0, frame)).toEqual([]);
    expect([c.col, c.row]).toEqual([2, 3]);
  });

  it('carries a tap into the next step of the headless game', () => {
    const g = tdGame({ ...fixtureRound(), seed: 1 });
    const frame = presentWorld(g.world, { size: SIZE, cursor: g.controls.view() });
    g.tap(80 + 16 + 8, 88 + 16 + 8, frame);
    expect(g.world.towers).toEqual([]);
    const input = new ScriptedInput({ steps: [] });
    input.next();
    g.step(input);
    expect(g.world.towers.map((t) => [t.col, t.row])).toEqual([[1, 1]]);
  });
});
