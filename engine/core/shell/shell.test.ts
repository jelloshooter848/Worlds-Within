import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullRenderer } from '@engine/backends/null';
import type { Renderer } from '../gfx/renderer';
import type { InputFrame } from '../input/input-manager';
import { ScriptedInput } from '../input/scripted-input';
import type { MiniGame, MiniGameResult } from '../minigame';
import { SceneStack } from '../scene';
import { backendFromQuery, otherBackendLink, THREE_QUERY } from './backend-choice';
import { bootBrowserGame, showBackendToggle, showDisplayMessage } from './boot';
import { HostScene } from './host-scene';

describe('backend choice', () => {
  it('opens in 3D only with ?backend=three, Canvas2D otherwise', () => {
    expect(backendFromQuery(THREE_QUERY)).toBe('three');
    expect(backendFromQuery('?x=1&backend=three')).toBe('three');
    for (const search of ['', '?backend=canvas2d', '?backend=Three', '?backend=3d'])
      expect(backendFromQuery(search)).toBe('canvas2d');
  });

  it('links to the other backend with relative links', () => {
    expect(otherBackendLink('canvas2d')).toMatchObject({ label: '3D', href: './?backend=three' });
    expect(otherBackendLink('three')).toMatchObject({ label: '2D', href: './' });
  });
});

/**
 * A test host: a world object per "level" (a new one every `levelTicks` ticks), one event per
 * tick, and a mini game started on tick `roundAt` that the host steps and that passes after
 * two ticks of attack.
 */
function testHost(roundAt = 3, levelTicks = 100) {
  let world = { level: 0, tick: 0 };
  let events: string[] = [];
  let round: (MiniGame & { steps: number }) | null = null;
  const results: MiniGameResult[] = [];
  const step = (input: InputFrame) => {
    if (round) {
      round.step(input);
      events = ['round'];
      const r = round.result();
      if (r) {
        results.push(r);
        round = null;
      }
      return;
    }
    world.tick++;
    if (world.tick % levelTicks === 0) world = { level: world.level + 1, tick: world.tick };
    events = [`t${world.tick}`];
    if (world.tick === roundAt) {
      let held = 0;
      const game = {
        steps: 0,
        step(i: InputFrame) {
          game.steps++;
          if (i.held('attack')) held++;
        },
        snapshot: () => ({ held }),
        result: (): MiniGameResult | null => (held >= 2 ? 'pass' : null),
      };
      round = game;
    }
  };
  return {
    step,
    world: () => world,
    events: () => events,
    miniGame: () => round,
    results,
  };
}

describe('HostScene', () => {
  it('draws through the drawer it is given, made once, with the events since the last draw', () => {
    const host = testHost(1000);
    const stack = new SceneStack();
    const handed: Renderer[] = [];
    const drawn: string[][] = [];
    stack.push(
      new HostScene({
        ...host,
        stack,
        picture: (r) => {
          handed.push(r);
          return { draw: (_w, events) => void drawn.push([...events]) };
        },
      }),
    );
    const r = new NullRenderer();
    const input = new ScriptedInput({ steps: [] });
    stack.update([input]);
    stack.update([input]);
    stack.render(r);
    stack.update([input]);
    stack.render(r);
    expect(handed).toEqual([r]);
    expect(drawn).toEqual([['t1', 't2'], ['t3']]);
  });

  it('drops the events kept for a world that is gone', () => {
    const host = testHost(1000, 2);
    const stack = new SceneStack();
    const drawn: { level: number; events: string[] }[] = [];
    stack.push(
      new HostScene({
        ...host,
        stack,
        picture: () => ({ draw: (w, events) => void drawn.push({ level: w.level, events: [...events] }) }),
      }),
    );
    const input = new ScriptedInput({ steps: [] });
    stack.update([input]);
    stack.update([input]); // tick 2 starts level 1: t1 belonged to level 0
    stack.update([input]);
    stack.render(new NullRenderer());
    expect(drawn).toEqual([{ level: 1, events: ['t2', 't3'] }]);
  });

  it('pushes the mini game when the host starts one, steps the host under it and pops it on the result', () => {
    const host = testHost(2);
    const stack = new SceneStack();
    const scene = new HostScene({ ...host, stack, picture: () => ({ draw: () => undefined }) });
    stack.push(scene);
    const input = new ScriptedInput({ steps: [{ frame: 3, hold: ['attack'] }] });
    const depths: number[] = [];
    for (let i = 0; i < 8; i++) {
      input.next();
      stack.update([input]);
      depths.push(stack.depth);
    }
    // Tick 2 starts the round; attack from frame 3 passes it after two held ticks.
    expect(depths.slice(0, 5)).toEqual([1, 2, 2, 2, 1]);
    expect(host.results).toEqual(['pass']);
    expect(stack.top).toBe(scene);
    expect(host.world().tick).toBe(5);
  });
});

/** A tiny fake page: elements by id, created elements, and a body. */
function fakePage(ids: string[]) {
  const make = (tag: string) => {
    const el: Record<string, unknown> & { children: unknown[]; attrs: Record<string, string> } = {
      tag,
      hidden: false,
      textContent: '',
      href: '',
      title: '',
      dataset: {},
      children: [],
      attrs: {},
      append(...kids: unknown[]) {
        el.children.push(...kids);
      },
      setAttribute(k: string, v: string) {
        el.attrs[k] = v;
      },
    };
    return el;
  };
  const byId = new Map(ids.map((id) => [id, make(id === 'screen' ? 'canvas' : 'a')]));
  const body = make('body');
  vi.stubGlobal('document', {
    body,
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: make,
  });
  vi.stubGlobal('window', { location: { search: '' } });
  return { byId, body };
}

afterEach(() => vi.unstubAllGlobals());

describe('the page helpers', () => {
  it('sets the toggle to the other backend, or hides it', () => {
    const { byId } = fakePage(['backend']);
    showBackendToggle('canvas2d');
    expect(byId.get('backend')).toMatchObject({ textContent: '3D', href: './?backend=three' });
    showBackendToggle('three');
    expect(byId.get('backend')).toMatchObject({ textContent: '2D', href: './' });
    showBackendToggle(null);
    expect(byId.get('backend')).toMatchObject({ hidden: true });
  });

  it('shows why the display cannot start, with a link to 2D', () => {
    const { byId, body } = fakePage(['screen']);
    showDisplayMessage(byId.get('screen') as unknown as HTMLCanvasElement, 'no WebGL 2');
    expect(byId.get('screen')).toMatchObject({ hidden: true });
    const box = body.children[0] as {
      attrs: Record<string, string>;
      children: { textContent: string; href?: string }[];
    };
    expect(box.attrs['role']).toBe('alert');
    expect(box.children.map((c) => c.textContent)).toEqual(['no WebGL 2', 'Play in 2D instead']);
    expect(box.children[1]?.href).toBe('./');
    expect(body.dataset).toEqual({ backend: 'none' });
  });

  it('boots the display the query asks for and stops at its message when it cannot start', async () => {
    const { byId, body } = fakePage(['screen', 'backend']);
    const made: string[] = [];
    const booted = await bootBrowserGame({
      screen: { width: 64, height: 64 },
      search: '?backend=three',
      displays: {
        canvas2d: () => (made.push('2d'), 'unused'),
        three: async () => (made.push('3d'), 'no WebGL 2'),
      },
      scene: () => {
        throw new Error('no scene without a display');
      },
    });
    expect(booted).toBeNull();
    expect(made).toEqual(['3d']);
    expect(byId.get('backend')).toMatchObject({ textContent: '2D' });
    expect(body.dataset).toEqual({ backend: 'none' });
  });

  it('shows Canvas2D and hides the toggle for a game with no 3D display', async () => {
    const { byId } = fakePage(['screen', 'backend']);
    const made: string[] = [];
    await bootBrowserGame({
      screen: { width: 64, height: 64 },
      search: '?backend=three',
      displays: { canvas2d: () => (made.push('2d'), 'stop here') },
      scene: () => {
        throw new Error('unreached');
      },
    });
    expect(made).toEqual(['2d']);
    expect(byId.get('backend')).toMatchObject({ hidden: true });
  });
});
