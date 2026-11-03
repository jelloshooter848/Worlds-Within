import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NullRenderer } from '@engine/backends/null';
import { ScriptedInput } from './input/scripted-input';
import type { Action } from './input/actions';
import {
  controlsHint,
  hostStatusFor,
  miniGameTable,
  RoundInput,
  type MiniGame,
  type MiniGameDef,
  type MiniGameResult,
} from './minigame';
import { miniGameScene } from './minigame-scene';
import { SceneStack, type Scene } from './scene';

/** A test-only mini game: passes after `ticks` ticks of holding attack, fails on left. */
const HOLD: MiniGameDef = {
  id: 'hold',
  title: 'HOLD ON',
  create(ctx) {
    const need = typeof ctx.params['ticks'] === 'number' ? ctx.params['ticks'] : 3;
    let held = 0;
    let result: MiniGameResult | null = null;
    return {
      step(input) {
        if (input.held('left')) result = 'fail';
        else if (input.held('attack') && ++held >= need) result = 'pass';
      },
      snapshot: () => ({ held, need }),
      result: () => result,
    };
  },
};

describe('miniGameTable', () => {
  it('maps the defs by id', () => {
    expect([...miniGameTable([HOLD]).keys()]).toEqual(['hold']);
  });

  it('throws on a bad id or an id given twice', () => {
    expect(() => miniGameTable([{ ...HOLD, id: 'Hold' }])).toThrow('lower-case');
    expect(() => miniGameTable([HOLD, HOLD])).toThrow('given twice');
  });

  it('takes an optional params schema and an optional structured report', () => {
    const counted: MiniGameDef = {
      ...HOLD,
      id: 'counted',
      paramsSchema: z.strictObject({ ticks: z.int().min(1) }),
      create(ctx, seed) {
        const round = HOLD.create(ctx, seed);
        return { ...round, report: () => ({ result: round.result(), ...round.snapshot() }) };
      },
    };
    expect(miniGameTable([HOLD, counted]).get('counted')?.paramsSchema?.safeParse({ ticks: 0 }).success).toBe(
      false,
    );
    expect(HOLD.paramsSchema).toBeUndefined();
    const round: MiniGame = counted.create({ params: { ticks: 1 }, attempt: 1 }, 1);
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['attack'] }] });
    input.next();
    round.step(input);
    expect(round.result()).toBe('pass');
    expect(round.report?.()).toEqual({ result: 'pass', held: 1, need: 1 });
    expect(HOLD.create({ params: {}, attempt: 1 }, 1).report).toBeUndefined();
  });
});

describe('controlsHint (Engine 0.15 T10, lesson D14)', () => {
  const keys = { left: '←', right: '→', up: '↑', down: '↓', jump: 'Z', attack: 'X', select: 'RIGHT SHIFT' };

  it('writes each control as its keys and label, the directions together, the pointer after "or"', () => {
    expect(
      controlsHint(
        [
          { actions: ['left', 'right', 'up', 'down'], tap: 'a tap', label: 'move' },
          { actions: ['attack'], label: 'strike' },
          { actions: ['select'], label: 'give up' },
        ],
        keys,
      ),
    ).toBe('←→↑↓ or a tap: move, X: strike, RIGHT SHIFT: give up');
  });

  it("shows the host keys that reach a round action through the def's input map", () => {
    // The host's jump becomes the round's attack; the host's attack is dropped.
    expect(
      controlsHint([{ actions: ['attack'], label: 'strike' }], keys, { jump: 'attack', attack: null }),
    ).toBe('Z: strike');
    // Two host keys reach it: both shown.
    expect(controlsHint([{ actions: ['attack'], label: 'strike' }], keys, { jump: 'attack' })).toBe(
      'Z/X: strike',
    );
  });

  it('follows a remap, and leaves out an action with no key name', () => {
    expect(controlsHint([{ actions: ['attack'], label: 'strike' }], { ...keys, attack: 'J' })).toBe(
      'J: strike',
    );
    expect(controlsHint([{ actions: ['special'], label: 'use' }], keys)).toBe('use');
  });

  it('is checked by miniGameTable: a control needs a label and real actions', () => {
    expect(() => miniGameTable([{ ...HOLD, controls: [{ actions: ['attack'], label: '' }] }])).toThrow(
      'label',
    );
    expect(() =>
      miniGameTable([{ ...HOLD, controls: [{ actions: ['fly' as Action], label: 'fly' }] }]),
    ).toThrow('actions');
  });
});

/** A host's frames: `holds[i]` held on tick i, fed to `round` (a fresh script, nothing held before). */
function feed(
  round: RoundInput,
  holds: Action[][],
): { held: Action[]; pressed: Action[]; released: Action[] }[] {
  const host = new ScriptedInput({ steps: [] });
  const all: Action[] = [
    'left',
    'right',
    'up',
    'down',
    'jump',
    'attack',
    'special',
    'start',
    'select',
    'run',
  ];
  return holds.map((h) => {
    host.setHeld(h);
    host.next();
    round.advance(host);
    return {
      held: all.filter((a) => round.held(a)),
      pressed: all.filter((a) => round.pressed(a)),
      released: all.filter((a) => round.released(a)),
    };
  });
}

describe('RoundInput (gap G18)', () => {
  it("passes the host frame's taps through, each tick its own (gaps D1, D12)", () => {
    const host = new ScriptedInput({ steps: [], taps: [{ frame: 0, x: 4, y: 5, button: 'secondary' }] });
    const round = new RoundInput({ jump: 'attack' });
    host.next();
    round.advance(host);
    expect(round.taps()).toEqual([{ x: 4, y: 5, button: 'secondary' }]);
    host.next();
    round.advance(host);
    expect(round.taps()).toEqual([]);
  });

  it('ignores a button held into the round until it is released', () => {
    const host = new ScriptedInput({ steps: [] });
    host.setHeld(['right', 'attack']);
    host.next(); // the host's tick before the round: both go down
    const round = new RoundInput();
    host.setHeld(['right', 'attack', 'jump']);
    host.next(); // the round's first tick: right and attack held into it, jump pressed now
    round.advance(host);
    expect(round.held('right') || round.held('attack')).toBe(false);
    expect(round.held('jump') && round.pressed('jump')).toBe(true);
    expect(round.dirX).toBe(0);
    host.setHeld(['right']);
    host.next(); // attack let go (no release reaches the round), right still held: still ignored
    round.advance(host);
    expect(round.released('attack') || round.held('right')).toBe(false);
    host.setHeld(['right', 'attack']);
    host.next(); // attack pressed again: it counts
    round.advance(host);
    expect(round.pressed('attack')).toBe(true);
    expect(round.held('right')).toBe(false);
    host.setHeld([]);
    host.next();
    round.advance(host);
    host.setHeld(['right']);
    host.next();
    round.advance(host);
    expect(round.pressed('right') && round.dirX === 1).toBe(true);
  });

  it("takes a script's first frame as pressed, not held into the round", () => {
    expect(feed(new RoundInput(), [['attack'], ['attack'], []])).toEqual([
      { held: ['attack'], pressed: ['attack'], released: [] },
      { held: ['attack'], pressed: [], released: [] },
      { held: [], pressed: [], released: ['attack'] },
    ]);
  });

  it("applies the input map: mapped actions become the round's, null drops one, others pass", () => {
    const round = new RoundInput({ jump: 'attack', select: null });
    expect(feed(round, [['jump', 'select', 'left'], []])).toEqual([
      { held: ['left', 'attack'], pressed: ['left', 'attack'], released: [] },
      { held: [], pressed: [], released: ['left', 'attack'] },
    ]);
  });

  it("keeps the round's own jump buffer: a jump before the round never counts", () => {
    const host = new ScriptedInput({ steps: [] });
    host.setHeld(['jump']);
    host.next();
    host.setHeld([]);
    host.next();
    expect(host.bufferedJump(5)).toBe(true);
    const round = new RoundInput();
    round.advance(host);
    expect(round.bufferedJump(5)).toBe(false);
    host.setHeld(['jump']);
    host.next();
    round.advance(host);
    expect(round.bufferedJump(5)).toBe(true);
    round.consumeJumpBuffer();
    expect(round.bufferedJump(5)).toBe(false);
  });

  it('miniGameTable refuses a map naming an action that is not one', () => {
    const bad = { ...HOLD, inputMap: { jump: 'fire' } } as unknown as MiniGameDef;
    expect(() => miniGameTable([bad])).toThrow(/input map "jump" -> "fire"/);
    expect(() => miniGameTable([{ ...HOLD, inputMap: { jump: 'attack', start: null } }])).not.toThrow();
  });
});

describe('hostStatusFor (gap G19)', () => {
  it("picks the keys the def asks for that the host has, in the def's order", () => {
    const def: MiniGameDef = { ...HOLD, hostStatus: ['mission', 'gone', 'left'] };
    expect(hostStatusFor(def, { left: 40, mission: 'Burn', other: 1, gone: null })).toEqual({
      mission: 'Burn',
      left: 40,
    });
    expect(hostStatusFor(def, { other: 1 })).toBeUndefined();
    expect(hostStatusFor(HOLD, { mission: 'Burn' })).toBeUndefined();
  });
});

describe('miniGameScene', () => {
  const level: Scene = { update: () => undefined, render: () => undefined };

  it('steps the round each frame and calls done once, on the frame it ends; the glue pops it', () => {
    const stack = new SceneStack();
    stack.push(level);
    const game: MiniGame = HOLD.create({ params: { ticks: 2 }, attempt: 1 }, 1);
    const results: MiniGameResult[] = [];
    stack.push(
      miniGameScene({
        game,
        render: () => undefined,
        done: (r) => {
          results.push(r);
          stack.pop();
        },
      }),
    );
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['attack'] }] });
    for (let i = 0; i < 4; i++) {
      input.next();
      stack.update([input]);
      stack.render(new NullRenderer());
    }
    expect(results).toEqual(['pass']);
    expect(stack.top).toBe(level);
    expect(game.snapshot()).toEqual({ held: 2, need: 2 });
  });

  it("uses the host's step when given one, and stops once it has reported", () => {
    const game = HOLD.create({ params: {}, attempt: 1 }, 1);
    let steps = 0;
    const done: MiniGameResult[] = [];
    const scene = miniGameScene({
      game,
      step: (input) => {
        steps++;
        game.step(input);
      },
      render: () => undefined,
      done: (r) => done.push(r),
    });
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['left'] }] });
    for (let i = 0; i < 3; i++) {
      input.next();
      scene.update(input, [input]);
    }
    expect(steps).toBe(1);
    expect(done).toEqual(['fail']);
  });

  it('stepping the round itself, drops a button held into it and applies the input map (gap G18)', () => {
    const game = HOLD.create({ params: { ticks: 2 }, attempt: 1 }, 1);
    const scene = miniGameScene({
      game,
      inputMap: { jump: 'attack' },
      render: () => undefined,
      done: () => undefined,
    });
    const host = new ScriptedInput({ steps: [] });
    host.setHeld(['left']);
    host.next(); // the host's tick before the round: left goes down
    host.setHeld(['left', 'jump']);
    host.next(); // first tick: left held into the round (ignored, else it fails), jump pressed (its attack)
    scene.update(host, [host]);
    expect(game.result()).toBeNull();
    expect(game.snapshot()).toEqual({ held: 1, need: 2 });
  });
});
