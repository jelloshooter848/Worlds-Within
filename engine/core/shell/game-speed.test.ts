import { describe, expect, it } from 'vitest';
import { NullRenderer } from '@engine/backends/null';
import { Actions } from '../input/actions';
import { frameTaps, type InputFrame } from '../input/input-manager';
import { ScriptedInput, type InputScript } from '../input/scripted-input';
import { SceneStack, type Scene } from '../scene';
import { stateHash } from '../state-hash';
import { menusSchema, speedsProblem } from '../ui/menus';
import { GameSpeed } from './game-speed';
import { HostScene } from './host-scene';

describe('GameSpeed (Engine 0.16 E5)', () => {
  it('starts at 1 and cycles through the speeds, back to 1 after the fastest', () => {
    const speed = new GameSpeed([1, 2, 3]);
    expect(speed.speed).toBe(1);
    expect(speed.label).toBe('1x');
    expect([speed.cycle(), speed.cycle(), speed.cycle(), speed.cycle()]).toEqual([2, 3, 1, 2]);
    expect(speed.label).toBe('2x');
    expect(speed.set(3)).toBe(true);
    expect(speed.speed).toBe(3);
    expect(speed.set(4)).toBe(false);
    expect(speed.speed).toBe(3);
  });

  it('refuses a bad speed list', () => {
    expect(speedsProblem([1, 2, 3])).toBeNull();
    expect(speedsProblem([1, 4])).toBeNull();
    expect(speedsProblem([1])).toMatch(/two speeds/);
    expect(speedsProblem([2, 3])).toMatch(/starts at 1/);
    expect(speedsProblem([1, 1.5])).toMatch(/whole number/);
    expect(speedsProblem([1, 9])).toMatch(/whole number/);
    expect(speedsProblem([1, 3, 2])).toMatch(/goes up/);
    expect(() => new GameSpeed([3, 1])).toThrow(/starts at 1/);
  });

  it('is game.json data: menus.speeds', () => {
    const menus = { font: 'f', title: { name: 'G', items: ['start'] }, pause: { items: ['resume'] } };
    expect(menusSchema.safeParse({ ...menus, speeds: [1, 2, 3] }).success).toBe(true);
    const bad = menusSchema.safeParse({ ...menus, speeds: [1, 0] });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(['speeds']);
  });

  it('rejects a speed below 1 on the stack', () => {
    const stack = new SceneStack();
    expect(() => (stack.speed = 0)).toThrow(/whole number/);
    expect(() => (stack.speed = 1.5)).toThrow(/whole number/);
  });
});

/** A tiny game whose state reads every input a tick gets: held and pressed actions and taps. */
function inputGame() {
  let tick = 0;
  let state = 7;
  const taps: string[] = [];
  const hashes: string[] = [];
  return {
    hashes,
    taps,
    step(input: InputFrame) {
      tick++;
      Actions.forEach((a, i) => {
        if (input.held(a)) state = (state * 31 + i + 1) % 1_000_003;
        if (input.pressed(a)) state = (state * 17 + i + 101) % 1_000_003;
      });
      for (const t of frameTaps(input)) {
        taps.push(`${tick}:${t.x},${t.y}`);
        state = (state * 13 + t.x * 7 + t.y) % 1_000_003;
      }
      hashes.push(stateHash({ tick, state }));
    },
    snapshot: () => ({ tick, state }),
    world: {},
    events: [] as never[],
    miniGame: () => null,
  };
}

const SCRIPT: InputScript = {
  steps: [
    { frame: 3, hold: ['right'] },
    { frame: 20, hold: ['right', 'jump'] },
    { frame: 22, hold: ['right'] },
    { frame: 40, hold: [] },
    { frame: 41, hold: ['attack'] },
    { frame: 42, hold: [] },
    { frame: 70, hold: ['left', 'jump'] },
    { frame: 95, hold: [] },
  ],
  taps: [
    { frame: 5, x: 10, y: 20 },
    { frame: 33, x: 40, y: 50 },
    { frame: 34, x: 41, y: 51 },
    { frame: 88, x: 3, y: 4, button: 'secondary' },
  ],
};

/**
 * Plays `SCRIPT` through a `SceneStack` at `speed`: each loop step `advance`s the stack with one
 * script frame and pulls one more per extra step, as the shell samples its input; draws through
 * the null backend after every loop step. Gives the game's per-tick hashes and taps.
 */
function play(speed: number, scene: (stack: SceneStack, game: ReturnType<typeof inputGame>) => Scene) {
  const game = inputGame();
  const stack = new SceneStack();
  stack.push(scene(stack, game));
  stack.speed = speed;
  const input = new ScriptedInput(SCRIPT);
  const frame = () => {
    input.next();
    return [input];
  };
  const renderer = new NullRenderer();
  let loopSteps = 0;
  // 120 script frames, whatever the speed.
  for (let pulled = 0; pulled < 120; pulled += speed) {
    stack.advance(frame(), frame);
    stack.render(renderer);
    loopSteps++;
  }
  return { ...game, loopSteps };
}

describe('SceneStack speed (Engine 0.16 E5): sped up, the same input gives the same hash every tick', () => {
  it('a scene stepped every loop step: speed ticks a step, identical per-tick hashes at 1x, 2x and 3x', () => {
    const host = (stack: SceneStack, game: ReturnType<typeof inputGame>) =>
      new HostScene({ stack, game, picture: () => ({ draw() {} }) });
    const [one, two, three] = [1, 2, 3].map((s) => play(s, host));
    expect(one!.hashes).toHaveLength(120);
    expect(two!.hashes).toEqual(one!.hashes);
    expect(three!.hashes).toEqual(one!.hashes);
    // Taps reach exactly one tick each, never repeated.
    expect(one!.taps).toEqual(['6:10,20', '34:40,50', '35:41,51', '89:3,4']);
    expect(two!.taps).toEqual(one!.taps);
    expect(three!.taps).toEqual(one!.taps);
    // Faster: fewer loop steps for the same ticks.
    expect([one!.loopSteps, two!.loopSteps, three!.loopSteps]).toEqual([120, 60, 40]);
  });

  it('a scene with a tickRate: speed ticks a tickRate interval, each with its own merged input', () => {
    const paced = (_stack: SceneStack, game: ReturnType<typeof inputGame>): Scene => ({
      tickRate: 10,
      update: (input) => game.step(input),
      render() {},
    });
    const [one, two, three] = [1, 2, 3].map((s) => play(s, paced));
    // 120 loop-step frames merged six at a time: 20 ticks at every speed.
    expect(one!.hashes).toHaveLength(20);
    expect(two!.hashes).toEqual(one!.hashes);
    expect(three!.hashes).toEqual(one!.hashes);
    expect(one!.taps).toEqual(['1:10,20', '6:40,50', '6:41,51', '15:3,4']);
    expect(two!.taps).toEqual(one!.taps);
    expect(three!.taps).toEqual(one!.taps);
  });

  it('a live frame repeated by the page: the press and its taps count on the first tick only', () => {
    // What the shell's sampling gives a held key: pressed on its first frame, then only held.
    const game = inputGame();
    const stack = new SceneStack();
    stack.push(new HostScene({ stack, game, picture: () => ({ draw() {} }) }));
    stack.speed = 3;
    const input = new ScriptedInput({
      steps: [{ frame: 0, hold: ['jump'] }],
      taps: [{ frame: 0, x: 1, y: 2 }],
    });
    const pressed: boolean[] = [];
    const scene = stack.top!;
    const update = scene.update.bind(scene);
    scene.update = (frame, inputs) => {
      pressed.push(frame.pressed('jump'));
      update(frame, inputs);
    };
    const frame = () => {
      input.next();
      return [input];
    };
    stack.advance(frame(), frame);
    expect(pressed).toEqual([true, false, false]);
    expect(game.taps).toEqual(['1:1,2']);
  });
});
