import { describe, expect, it } from 'vitest';
import type { Renderer } from './gfx/renderer';
import type { InputFrame } from './input/input-manager';
import type { DeepReadonly, PresentFrame } from './present/types';
import { frameView } from './view';

/** A test game: each step adds one event; every third step is a new world (a new level). */
function testGame() {
  const game = {
    world: { n: 0 },
    events: [] as string[],
    ticks: 0,
    step(_input: InputFrame) {
      game.ticks++;
      if (game.ticks % 3 === 0) game.world = { n: game.ticks };
      game.events = [`e${game.ticks}`];
    },
    snapshot: () => ({ ticks: game.ticks }),
  };
  return game;
}

const frameOf = (world: { n: number }, events: readonly string[]): DeepReadonly<PresentFrame> => ({
  frame: world.n,
  size: { width: 8, height: 8 },
  entities: [],
  events: events.map((type) => ({ type })),
  status: {},
});

const input = {} as InputFrame;

describe('frameView', () => {
  it("steps the game, gives its snapshot, and frame() carries the events since the last call (this world's only)", () => {
    const view = frameView({
      game: testGame(),
      screen: { width: 8, height: 8 },
      frames: { next: frameOf },
      picture: () => ({ draw: () => undefined }),
      background: '#123456',
    });
    view.step(input);
    view.step(input);
    expect(view.frame!().events.map((e) => e.type)).toEqual(['e1', 'e2']);
    expect(view.frame!().events).toEqual([]);
    view.step(input); // a new world: e3 only
    view.step(input);
    expect(view.frame!().events.map((e) => e.type)).toEqual(['e3', 'e4']);
    expect(view.snapshot()).toEqual({ ticks: 4 });
    expect(view.screen).toEqual({ width: 8, height: 8 });
    expect(view.background).toBe('#123456');
  });

  it('makes the drawer once per renderer and draws the world with the kept events', () => {
    const made: Renderer[] = [];
    const draws: string[][] = [];
    const view = frameView({
      game: testGame(),
      screen: { width: 8, height: 8 },
      frames: { next: frameOf },
      picture: (r) => {
        made.push(r);
        return { draw: (_w: { n: number }, events: readonly string[]) => void draws.push([...events]) };
      },
    });
    const a = {} as Renderer;
    const b = {} as Renderer;
    view.step(input);
    view.render(a);
    view.step(input);
    view.render(a);
    view.render(b);
    expect(made).toEqual([a, b]);
    expect(draws).toEqual([['e1'], ['e2'], []]);
    expect(view.background).toBeUndefined();
  });

  it('keeps the status of the last frame drawn or given (Engine 0.16 part B)', () => {
    const withStatus = (world: { n: number }, events: readonly string[]) => ({
      ...frameOf(world, events),
      status: { n: world.n },
    });
    const view = frameView({
      game: testGame(),
      screen: { width: 8, height: 8 },
      frames: { next: withStatus },
      picture: () => ({ draw: (w: { n: number }) => withStatus(w, []) }),
    });
    expect(view.status!()).toBeNull();
    for (let i = 0; i < 3; i++) view.step(input);
    view.render({} as Renderer);
    expect(view.status!()).toEqual({ n: 3 });
    for (let i = 0; i < 3; i++) view.step(input);
    view.frame!();
    expect(view.status!()).toEqual({ n: 6 });
  });

  it("hands showHud to the drawer's presenter before each draw (Engine 0.16 part C T1)", () => {
    const shown: boolean[] = [];
    const view = frameView({
      game: testGame(),
      screen: { width: 8, height: 8 },
      frames: { next: frameOf },
      picture: () => ({ presenter: { present() {}, showHud: (s: boolean) => shown.push(s) }, draw() {} }),
    });
    view.render({} as Renderer);
    view.showHud!(false);
    view.render({} as Renderer);
    view.showHud!(true);
    view.render({} as Renderer);
    expect(shown).toEqual([true, false, true]);
  });
});
