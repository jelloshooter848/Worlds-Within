import { describe, expect, it } from 'vitest';
import { NullRenderer } from '@engine/backends/null';
import { ScriptedInput } from './input/scripted-input';
import { miniGameTable, type MiniGame, type MiniGameDef, type MiniGameResult } from './minigame';
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
});
