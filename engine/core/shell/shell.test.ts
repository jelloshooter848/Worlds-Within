import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullRenderer } from '@engine/backends/null';
import { AudioManager } from '../audio/audio-manager';
import { Sequencer } from '../audio/sequencer';
import type { Renderer } from '../gfx/renderer';
import type { HostedGame } from '../headless';
import type { InputFrame } from '../input/input-manager';
import { ScriptedInput } from '../input/scripted-input';
import type { MiniGame, MiniGameResult } from '../minigame';
import { SceneStack } from '../scene';
import { backendFromQuery, otherBackendLink, THREE_QUERY } from './backend-choice';
import {
  AUDIO_UNLOCK_EVENTS,
  bootBrowserGame,
  manualFromQuery,
  recordFromQuery,
  showBackendToggle,
  showDisplayMessage,
  tapsOf,
  type DebugWindow,
} from './boot';
import { stateHash } from '../state-hash';
import { MissionHost, type MissionWorldPort } from '../mission-host';
import type { MissionDef } from '../missions';
import { HostScene } from './host-scene';
import { UiScene } from './ui-scene';
import { VOLUME_CONTROL_ID } from './volume-control';
import { DEFAULT_VOLUMES, readVolumes, volumesKey } from '../save/settings';

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
    expect(scene.headless()).toBeNull();
    expect(stack.top).toBe(scene);
    expect(host.world().tick).toBe(5);
  });

  it('takes the game itself (a HostedGame, gap G37) and plays it as the accessors do', () => {
    const host = testHost(2);
    const game: HostedGame<{ level: number; tick: number }, string> = {
      step: host.step,
      snapshot: () => ({ ...host.world() }),
      get world() {
        return host.world();
      },
      get events() {
        return host.events();
      },
      miniGame: host.miniGame,
    };
    const stack = new SceneStack();
    const drawn: string[][] = [];
    const scene = new HostScene({
      stack,
      game,
      picture: () => ({ draw: (_w, events) => void drawn.push([...events]) }),
    });
    stack.push(scene);
    const input = new ScriptedInput({ steps: [{ frame: 3, hold: ['attack'] }] });
    const depths: number[] = [];
    for (let i = 0; i < 8; i++) {
      input.next();
      stack.update([input]);
      depths.push(stack.depth);
    }
    stack.render(new NullRenderer());
    expect(depths.slice(0, 5)).toEqual([1, 2, 2, 2, 1]);
    expect(host.results).toEqual(['pass']);
    expect(drawn).toEqual([['t1', 't2', 'round', 'round', 'round', 't3', 't4', 't5']]);
  });
});

describe('HostScene hosting a mission round (Engine 0.11, item 173)', () => {
  const MISSION: MissionDef = {
    id: 'raid',
    title: 'Raid',
    worldTimeCost: 4,
    play: 'hold',
    onQuit: 'lost',
    outcomes: [
      { id: 'won', title: 'Won', weight: 1, effects: [] },
      { id: 'lost', title: 'Lost', weight: 1, effects: [] },
    ],
  };

  it('pushes the round MissionHost.miniGame() reports, steps the host under it and pops it on the result', () => {
    let worldTick = 0;
    const calls: string[] = [];
    const port: MissionWorldPort = {
      open: () => ({ ok: true, snapshot: {}, commitTick: worldTick + 4, seed: 1 }),
      delegate: () => ({ ok: true }),
      play: (id, result) => (calls.push(`play ${id} ${result.outcome}@${worldTick}`), { ok: true }),
      quit: () => ({ ok: true }),
      settle: () => [],
      snapshot: () => ({ tick: worldTick }),
      step: () => void worldTick++,
    };
    let held = 0;
    const host = new MissionHost({
      port,
      missions: [MISSION],
      miniGames: [
        {
          id: 'hold',
          title: 'HOLD',
          create: (): MiniGame => {
            held = 0;
            return {
              step: (i) => void (i.held('attack') && held++),
              snapshot: () => ({ held }),
              result: () => (held >= 2 ? 'pass' : null),
            };
          },
        },
      ],
      adapters: { hold: { input: () => ({}), outcome: () => ({ outcome: 'won' }) } },
    });
    const stack = new SceneStack();
    const drawn: unknown[] = [];
    const scene = new HostScene({ stack, game: host, picture: () => ({ draw: (w) => void drawn.push(w) }) });
    stack.push(scene);
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['attack'] }] });
    const depths: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (i === 1) {
        expect(host.launch('raid')).toBeNull();
        expect(host.play('raid')).toBeNull();
      }
      input.next();
      stack.update([input]);
      depths.push(stack.depth);
    }
    stack.render(new NullRenderer());
    // Tick 1 starts the round (pushed); attack, held into it, counts only once released and pressed
    // again, so the scripted hold never ends it: give it a fresh press.
    expect(depths[1]).toBe(2);
    // A mission host's round plays the `mission` transition slot (Engine 0.16 T5).
    expect(stack.top?.transitionSlot).toBe('mission');
    expect(host.miniGame()).not.toBeNull();
    expect(worldTick).toBe(1); // the world waits while the round is hosted
    const press = new ScriptedInput({
      steps: [
        { frame: 0, hold: [] },
        { frame: 1, hold: ['attack'] },
      ],
    });
    for (let i = 0; i < 4; i++) {
      press.next();
      stack.update([press]);
    }
    expect(calls).toEqual(['play raid won@1']);
    expect(stack.top).toBe(scene);
    expect(host.miniGame()).toBeNull();
    expect(worldTick).toBe(2);
    expect(drawn).toEqual([host]);
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
      listeners: {} as Record<string, ((e: unknown) => void)[]>,
      append(...kids: unknown[]) {
        el.children.push(...kids);
      },
      setAttribute(k: string, v: string) {
        el.attrs[k] = v;
      },
      addEventListener(type: string, fn: (e: unknown) => void) {
        const all = el['listeners'] as Record<string, ((e: unknown) => void)[]>;
        (all[type] ??= []).push(fn);
      },
      blur() {},
    };
    return el;
  };
  const byId = new Map(ids.map((id) => [id, make(id === 'screen' ? 'canvas' : 'a')]));
  const body = make('body');
  vi.stubGlobal('document', {
    body,
    head: make('head'),
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

/** Absorbs any Web Audio call: every property is itself, every call and `new` returns it. */
const anything: unknown = new Proxy(function () {}, {
  get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : anything),
  set: () => true,
  apply: () => anything,
  construct: () => anything as object,
});

/** A fake `AudioContext`: counts how many were made; everything else is `anything`. */
class FakeAudioContext {
  static made = 0;
  state = 'running';
  sampleRate = 48000;
  currentTime = 0;
  constructor() {
    FakeAudioContext.made++;
    return new Proxy(this, { get: (t, k) => (k in t ? t[k as keyof FakeAudioContext] : anything) });
  }
  resume() {
    return Promise.resolve();
  }
}

/** The fake page for a full boot: window listeners, no touch pad, a loop that never ticks. */
function fakeBootPage() {
  const page = fakePage(['screen']);
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const on = (type: string, fn: (e: unknown) => void) =>
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  vi.stubGlobal('window', {
    location: { search: '' },
    innerWidth: 256,
    innerHeight: 240,
    devicePixelRatio: 1,
    AudioContext: FakeAudioContext,
    addEventListener: on,
  });
  const doc = globalThis.document as unknown as Record<string, unknown>;
  doc['addEventListener'] = () => {};
  const createElement = doc['createElement'] as (tag: string) => Record<string, unknown>;
  doc['createElement'] = (tag: string) =>
    Object.assign(createElement(tag), { play: () => Promise.resolve() });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  const event = { code: 'KeyZ', repeat: false, preventDefault() {} };
  const fire = (type: string) => (listeners.get(type) ?? []).forEach((fn) => fn(event));
  return { ...page, fire, listeners };
}

const display = () => ({
  renderer: new NullRenderer(),
  presenter: { present() {} },
  fit() {},
  present() {},
});

describe('bootBrowserGame with audio (G27)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('unlocks on the first gesture and plays the song, with onSound for the displays', async () => {
    const { fire, listeners } = fakeBootPage();
    FakeAudioContext.made = 0;
    const played: string[] = [];
    vi.spyOn(Sequencer.prototype, 'play').mockImplementation((song) => void played.push(song.id));
    const sfx = vi.spyOn(AudioManager.prototype, 'sfx');
    let onSound: ((id: string) => void) | null = null;
    const booted = await bootBrowserGame({
      screen: { width: 256, height: 240 },
      touchPad: false,
      audio: {
        songs: [{ id: 'tune', bpm: 120, loop: true, pulse1: 'c' }],
        sfx: [{ id: 'beep', pulse: 'c' }],
        music: 'tune',
        volumes: { muted: true },
      },
      displays: {
        canvas2d: (_canvas, shell) => {
          onSound = shell.onSound;
          return display();
        },
      },
      scene: () => ({ update() {}, render() {} }),
    });
    expect(booted?.audio).toBeInstanceOf(AudioManager);
    // The keyboard source listens for keydown too; each gesture has the unlock once.
    for (const ev of AUDIO_UNLOCK_EVENTS)
      expect(listeners.get(ev)?.length, ev).toBe(ev === 'keydown' ? 2 : 1);
    // Nothing plays before a gesture: no context yet, the song waits.
    expect(FakeAudioContext.made).toBe(0);
    expect(played).toEqual([]);
    onSound!('beep');
    expect(sfx).toHaveBeenLastCalledWith('beep');
    fire('keydown');
    expect(booted?.audio?.unlocked).toBe(true);
    expect(FakeAudioContext.made).toBe(1);
    expect(played).toEqual(['tune']);
    // Later gestures reuse the one context and do not restart the song.
    fire('click');
    fire('touchend');
    expect(FakeAudioContext.made).toBe(1);
    expect(played).toEqual(['tune']);
    // Coming back from the background wakes it; the next gesture redoes the unlock, still one context.
    const wake = vi.spyOn(AudioManager.prototype, 'wake');
    fire('pageshow');
    expect(wake).toHaveBeenCalledTimes(1);
    fire('pointerdown');
    expect(FakeAudioContext.made).toBe(1);
  });

  it('is silent without the option: no manager, no listeners, onSound does nothing', async () => {
    const { listeners } = fakeBootPage();
    let onSound: ((id: string) => void) | null = null;
    const booted = await bootBrowserGame({
      screen: { width: 256, height: 240 },
      touchPad: false,
      displays: {
        canvas2d: (_canvas, shell) => {
          onSound = shell.onSound;
          return display();
        },
      },
      scene: () => ({ update() {}, render() {} }),
    });
    expect(booted?.audio).toBeNull();
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click'])
      expect(listeners.has(ev), ev).toBe(false);
    expect(() => onSound!('beep')).not.toThrow();
  });
});

describe('bootBrowserGame with the mixer (Engine 0.16 T8)', () => {
  afterEach(() => vi.restoreAllMocks());

  it("mixes the layered song from each presented frame's status, ducks under a dialog, plays UI sounds on the ui bus", async () => {
    fakeBootPage();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 0),
    );
    const win = globalThis.window as unknown as DebugWindow & { location: { search: string } };
    win.location.search = '?debug=step';
    const sfx = vi.spyOn(AudioManager.prototype, 'sfx');
    let near = 999;
    let onSound: ((id: string, cue?: { frame: number; volume?: [number, number] }) => void) | null = null;
    let uiSound: ((id: string) => void) | null = null;
    let frame = 0;
    const booted = await bootBrowserGame({
      screen: { width: 256, height: 240 },
      touchPad: false,
      audio: {
        songs: [
          { id: 'a', bpm: 120, loop: true, pulse1: 'c' },
          { id: 'b', bpm: 120, loop: true, pulse1: 'e' },
        ],
        sfx: [{ id: 'beep', pulse: 'c' }],
        mix: {
          lab: {
            layers: { calm: 'a', danger: 'b' },
            mix: [
              { when: { status: 'near', lt: 50 }, layers: { calm: 0, danger: 1 }, fade: 2 },
              { layers: { calm: 1, danger: 0 } },
            ],
          },
        },
        music: 'lab',
        seed: 5,
      },
      displays: {
        canvas2d: (_canvas, shell) => {
          onSound = shell.onSound;
          return display();
        },
      },
      scene: (_stack, shown, page) => {
        uiSound = page.uiSound;
        return {
          update() {},
          render() {
            shown.presenter.present({
              frame: frame++,
              size: { width: 256, height: 240 },
              entities: [],
              events: [],
              status: { near },
            });
          },
        };
      },
    });
    const mix = () => win.__ww!.mix()!;
    win.__ww!.step(2);
    expect(mix()).toMatchObject({ song: 'lab', layers: { calm: 1, danger: 0 }, duck: 1 });
    near = 10;
    win.__ww!.step(1); // the frame drawn after this step shows it; the next ticks mix it
    win.__ww!.step(1);
    expect(mix().layers).toEqual({ calm: 0.5, danger: 0.5 });
    win.__ww!.step(1);
    expect(mix().layers).toEqual({ calm: 0, danger: 1 });
    // A dialog on the stack ducks the music; closing it releases.
    const dialog = Object.assign(Object.create(UiScene.prototype) as UiScene, {
      dialogShown: () => true,
      update() {},
      render() {},
    });
    booted!.scenes.push(dialog);
    win.__ww!.step(10);
    expect(mix()).toMatchObject({ dialog: true, duck: 0.5 });
    booted!.scenes.pop();
    win.__ww!.step(30);
    expect(mix()).toMatchObject({ dialog: false, duck: 1 });
    // A presenter's cue is varied by the mixer; a UI sound goes to the ui bus.
    onSound!('beep', { frame: 3, volume: [0.5, 0.6] });
    expect(sfx.mock.lastCall?.[0]).toBe('beep');
    expect(sfx.mock.lastCall?.[1]?.volume).toBeGreaterThanOrEqual(0.5);
    uiSound!('beep');
    expect(sfx).toHaveBeenLastCalledWith('beep', { bus: 'ui' });
    expect(booted?.mixer?.state().sounds.played).toBe(2);
  });
});

describe('bootBrowserGame in manual-loop mode (G31)', () => {
  it('with ?debug=step: no requestAnimationFrame, window.__ww steps the scenes and hashes the game', async () => {
    fakeBootPage();
    const raf = vi.fn(() => 0);
    vi.stubGlobal('requestAnimationFrame', raf);
    const win = globalThis.window as unknown as DebugWindow & { location: { search: string } };
    win.location.search = '?debug=step';
    let ticks = 0;
    const game = {
      step: () => void ticks++,
      snapshot: () => ({ ticks }),
      world: {},
      events: [],
      miniGame: () => null,
    };
    const booted = await bootBrowserGame({
      screen: { width: 256, height: 240 },
      touchPad: false,
      displays: { canvas2d: () => display() },
      scene: (stack) => new HostScene({ stack, game, picture: () => ({ draw() {} }) }),
    });
    expect(raf).not.toHaveBeenCalled();
    expect(booted?.loop.manual).toBe(true);
    expect(win.__ww).toBe(booted?.debug);
    expect(win.__ww!.step(3)).toBe(3);
    expect(ticks).toBe(3);
    expect(win.__ww!.hash()).toBe(stateHash({ ticks: 3 }));
  });

  it('is off by default: the loop runs on requestAnimationFrame and there is no window.__ww', async () => {
    fakeBootPage();
    const raf = vi.fn(() => 0);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('performance', { now: () => 0 });
    const booted = await bootBrowserGame({
      screen: { width: 256, height: 240 },
      touchPad: false,
      displays: { canvas2d: () => display() },
      scene: () => ({ update() {}, render() {} }),
    });
    expect(raf).toHaveBeenCalledTimes(1);
    expect(booted?.debug).toBeNull();
    expect((globalThis.window as unknown as DebugWindow).__ww).toBeUndefined();
  });

  it('with ?record (Engine 0.14 T9): the loop runs on requestAnimationFrame, window.__ww records the game', async () => {
    fakeBootPage();
    const raf = vi.fn(() => 0);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('performance', { now: () => 0 });
    const win = globalThis.window as unknown as DebugWindow & { location: { search: string } };
    win.location.search = '?record';
    const asked: boolean[] = [];
    const game = {
      step: () => {},
      snapshot: () => ({}),
      world: {},
      events: [],
      miniGame: () => null,
      recordRounds: (on: boolean) => void asked.push(on),
      roundRecordings: () => [{ mission: 'm', tick: 1, ticks: 2, done: true, input: { steps: [] } }],
    };
    const booted = await bootBrowserGame({
      screen: { width: 256, height: 240 },
      touchPad: false,
      displays: { canvas2d: () => display() },
      scene: (stack) => new HostScene({ stack, game, picture: () => ({ draw() {} }) }),
    });
    expect(raf).toHaveBeenCalledTimes(1);
    expect(booted?.loop.manual).toBe(false);
    expect(win.__ww).toBe(booted?.debug);
    expect(win.__ww!.recording).toBe(true);
    expect(asked).toEqual([true]);
    expect(win.__ww!.recordings()).toEqual([
      { mission: 'm', tick: 1, ticks: 2, done: true, input: { steps: [] } },
    ]);
  });

  it('reads the mode from the query', () => {
    expect(recordFromQuery('?record')).toBe(true);
    expect(recordFromQuery('?debug=step&record=1')).toBe(true);
    expect(recordFromQuery('?record=0')).toBe(false);
    expect(recordFromQuery('')).toBe(false);
    expect(manualFromQuery('?debug=step')).toBe(true);
    expect(manualFromQuery('?backend=three&debug=step')).toBe(true);
    expect(manualFromQuery('')).toBe(false);
    expect(manualFromQuery('?debug=1')).toBe(false);
  });
});

/** A fake `localStorage`; `blocked` makes every call throw (a private window). */
function fakeStorage(blocked = false) {
  const data = new Map<string, string>();
  const guard = () => {
    if (blocked) throw new Error('storage blocked');
  };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (guard(), data.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void data.set(k, v)),
    removeItem: (k: string) => (guard(), void data.delete(k)),
  });
  return data;
}

type FakeEl = Record<string, unknown> & {
  children: FakeEl[];
  attrs: Record<string, string>;
  listeners: Record<string, ((e: unknown) => void)[]>;
};

describe('the volume control (gap M1)', () => {
  const boot = (game?: string, volumeControl?: boolean) =>
    bootBrowserGame({
      screen: { width: 256, height: 240 },
      touchPad: false,
      ...(game !== undefined && { game }),
      ...(volumeControl !== undefined && { volumeControl }),
      audio: { volumes: { master: 0.7 } },
      displays: { canvas2d: () => display() },
      scene: () => ({ update() {}, render() {} }),
    });
  const control = (body: FakeEl) => {
    const box = body.children.find((c) => c['id'] === VOLUME_CONTROL_ID)!;
    const [mute, slider] = box.children as [FakeEl, FakeEl];
    return { box, mute, slider };
  };

  it('starts at the page volumes, stores every change under the game, and a reload keeps them', async () => {
    const data = fakeStorage();
    const { body } = fakeBootPage();
    const setVolumes = vi.spyOn(AudioManager.prototype, 'setVolumes');
    const booted = await boot('tower-defense');
    const { box, mute, slider } = control(body as unknown as FakeEl);
    expect(box.attrs['aria-label']).toBe('Sound');
    expect(mute.attrs['aria-pressed']).toBe('false');
    expect(slider['value']).toBe('70');
    expect(booted?.volume?.volumes()).toEqual({ master: 0.7, music: 1, sfx: 1, muted: false });
    // Mute, then the slider (which unmutes): each stored at once, each applied to the audio.
    mute.listeners['click']![0]!({});
    expect(mute.attrs['aria-pressed']).toBe('true');
    expect(JSON.parse(data.get(volumesKey('tower-defense'))!)).toMatchObject({ muted: true, master: 0.7 });
    expect(setVolumes).toHaveBeenLastCalledWith(expect.objectContaining({ muted: true }));
    slider['value'] = '30';
    slider.listeners['input']![0]!({});
    expect(JSON.parse(data.get(volumesKey('tower-defense'))!)).toEqual({
      master: 0.3,
      music: 1,
      sfx: 1,
      muted: false,
    });
    // Keys on the slider never reach the game's keyboard.
    const stop = vi.fn();
    slider.listeners['keydown']![0]!({ stopPropagation: stop });
    expect(stop).toHaveBeenCalled();
    // A reload: the stored volumes win over the page's.
    const stored = data.get(volumesKey('tower-defense'))!;
    vi.unstubAllGlobals();
    fakeStorage().set(volumesKey('tower-defense'), stored.replace('"muted":false', '"muted":true'));
    const again = fakeBootPage();
    const reloaded = await boot('tower-defense');
    expect(reloaded?.volume?.volumes()).toEqual({ master: 0.3, music: 1, sfx: 1, muted: true });
    expect(control(again.body as unknown as FakeEl).mute.attrs['aria-pressed']).toBe('true');
    expect(setVolumes).toHaveBeenLastCalledWith({ master: 0.3, music: 1, sfx: 1, muted: true });
  });

  it('plays on with blocked storage, and can be left out', async () => {
    fakeStorage(true);
    const { body } = fakeBootPage();
    const booted = await boot('g');
    expect(booted?.volume?.volumes().master).toBe(0.7);
    control(body as unknown as FakeEl).mute.listeners['click']![0]!({});
    expect(booted?.volume?.volumes().muted).toBe(true);
    vi.unstubAllGlobals();
    fakeStorage();
    const page = fakeBootPage();
    const off = await boot('g', false);
    expect(off?.volume).toBeNull();
    expect((page.body as unknown as FakeEl).children.some((c) => c['id'] === VOLUME_CONTROL_ID)).toBe(false);
  });

  it('reads stored volumes defensively', () => {
    expect(readVolumes(null)).toEqual(DEFAULT_VOLUMES);
    expect(readVolumes({ master: 3, music: -1, sfx: 'x', muted: 'yes' })).toEqual({
      master: 1,
      music: 0,
      sfx: 1,
      muted: false,
    });
  });
});

describe('pointer taps as frame input (gap D1)', () => {
  it('turns tap gestures into frame taps, dropping the rest', () => {
    expect(
      tapsOf([
        { type: 'tap', button: 'primary', x: 1, y: 2, kind: 'mouse' },
        { type: 'zoom', factor: 2, x: 0, y: 0, source: 'wheel' } as never,
        { type: 'tap', button: 'secondary', x: 3, y: 4, kind: 'touch' },
      ]),
    ).toEqual([
      { x: 1, y: 2, button: 'primary' },
      { x: 3, y: 4, button: 'secondary' },
    ]);
  });
});

describe('hit-pause in the loop (Engine 0.16 T4)', () => {
  /**
   * Boots a game whose every 7th tick has a `stomp` event and steps the page's loop through 150
   * display frames of 17 ms. With `pauses`, the picture asks the shell for a 4-frame hit-pause on
   * each stomp it draws (what a presenter does for a skin's `hitPause`). Gives the state hash of
   * every tick, in order, and the tick each display frame drew.
   */
  async function play(pauses: boolean, search = '') {
    fakeBootPage();
    let onFrame: ((t: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => {
      onFrame = fn;
      return 1;
    });
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    (globalThis.window as unknown as { location: { search: string } }).location.search = search;
    let tick = 0;
    let state = 1;
    const hashes: string[] = [];
    const game = {
      step: () => {
        tick++;
        state = (state * 31 + tick) % 1_000_003;
        hashes.push(stateHash({ tick, state }));
        game.events = tick % 7 === 0 ? [{ type: 'stomp' }] : [];
      },
      snapshot: () => ({ tick, state }),
      world: {},
      events: [] as { type: string }[],
      miniGame: () => null,
    };
    let hitPause: (ticks: number) => void = () => {};
    const drawn: number[] = [];
    const booted = await bootBrowserGame({
      screen: { width: 256, height: 240 },
      touchPad: false,
      displays: {
        canvas2d: (_canvas, shell) => {
          hitPause = shell.hitPause;
          return display();
        },
      },
      scene: (stack) =>
        new HostScene({
          stack,
          game,
          picture: () => ({
            draw: (_world: object, events: readonly { type: string }[]) => {
              drawn.push(tick);
              if (pauses && events.some((e) => e.type === 'stomp')) hitPause(4);
            },
          }),
        }),
    });
    if (!booted?.loop.manual)
      for (let i = 0; i < 150; i++) {
        now += 17;
        onFrame!(now);
      }
    return { hashes, drawn, booted };
  }

  it('holds the ticks while the picture keeps drawing, with the same per-tick hashes as without', async () => {
    const plain = await play(false);
    const paused = await play(true);
    // Fewer ticks in the same display time, but each tick's state is the same.
    expect(paused.hashes.length).toBeLessThan(plain.hashes.length);
    expect(paused.hashes.length).toBeGreaterThan(50);
    expect(paused.hashes).toEqual(plain.hashes.slice(0, paused.hashes.length));
    // Every frame drew; after a stomp the same tick is drawn on through the held frames.
    expect(paused.drawn).toHaveLength(150);
    const runs = paused.drawn.filter((t, i) => t % 7 === 0 && t > 0 && paused.drawn[i - 1] === t);
    expect(runs.length).toBeGreaterThanOrEqual(3);
    expect(paused.booted?.hitPause.remaining).toBeLessThanOrEqual(4);
  });

  it('does nothing in manual-loop mode, so the step hook stays tick-exact', async () => {
    const { booted, hashes } = await play(true, '?debug=step');
    const win = globalThis.window as unknown as DebugWindow;
    expect(win.__ww!.step(30)).toBe(30);
    expect(hashes).toHaveLength(30);
    expect(booted?.hitPause.remaining).toBe(0);
    (globalThis.window as unknown as { location: { search: string } }).location.search = '';
  });
});

describe('screen transitions in the loop (Engine 0.16 T5)', () => {
  /**
   * Boots a game that moves to level `b` at tick 40 (its world and map id change), drawn through
   * a `FramePicture`-like drawer onto the display's presenter, and steps the page's loop through
   * 150 display frames of 17 ms (or, in manual mode, `__ww.step` 100 times). Gives every tick's
   * state hash, the map id and tick each display frame showed, and the transitions the display
   * was handed.
   */
  async function play(transitions: boolean, search = '') {
    fakeBootPage();
    let onFrame: ((t: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => {
      onFrame = fn;
      return 1;
    });
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    (globalThis.window as unknown as { location: { search: string } }).location.search = search;
    let tick = 0;
    let state = 1;
    const hashes: string[] = [];
    const game = {
      step: () => {
        tick++;
        state = (state * 31 + tick) % 1_000_003;
        hashes.push(stateHash({ tick, state }));
        if (tick === 40) game.world = { level: 'b' };
      },
      snapshot: () => ({ tick, state }),
      world: { level: 'a' },
      events: [] as { type: string }[],
      miniGame: () => null,
    };
    const shown: string[] = [];
    const views: (string | null)[] = [];
    const booted = await bootBrowserGame({
      screen: { width: 256, height: 240 },
      touchPad: false,
      reduceMotion: false,
      ...(transitions && { transitions: { level: { kind: 'iris', ticks: 6, hold: 2 } } }),
      displays: {
        canvas2d: () => ({
          ...display(),
          presenter: {
            present: (frame: { frame: number; map?: { id: string } }) =>
              shown.push(`${frame.map?.id}@${frame.frame}`),
          },
          transition: (view) => views.push(view === null ? null : `${view.spec.kind} ${view.phase}`),
        }),
      },
      scene: (stack, shownDisplay) =>
        new HostScene({
          stack,
          game,
          picture: () => {
            // As a map tracker does: the full map on its first frame, a reference after.
            let sent = '';
            return {
              draw: (world: { level: string }) => {
                const full = sent !== world.level;
                sent = world.level;
                shownDisplay.presenter.present({
                  frame: tick,
                  size: { width: 256, height: 240 },
                  entities: [],
                  map: full
                    ? { id: world.level, version: 0, tileSize: 16, tiles: [] }
                    : { id: world.level, version: 0 },
                  events: [],
                  status: {},
                } as never);
              },
            };
          },
        }),
    });
    if (!booted?.loop.manual)
      for (let i = 0; i < 150; i++) {
        now += 17;
        onFrame!(now);
      }
    return { hashes, shown, views, booted };
  }

  it('a level change plays its transition, holding ticks, with every tick the hash of the run without', async () => {
    const plain = await play(false);
    const moved = await play(true);
    // The ticks taken are each the same state as without the transition (the headless run's).
    expect(moved.hashes.length).toBeGreaterThan(100);
    expect(moved.hashes).toEqual(plain.hashes.slice(0, moved.hashes.length));
    // The out half and hold (8 frames) held the ticks: its first frame is drawn right after the
    // step that changed the level, the other 7 held a step each.
    expect(plain.hashes.length - moved.hashes.length).toBe(7);
    // The display was handed the iris: out, hold, then in.
    const seq = moved.views.filter((v) => v !== null);
    expect(seq.filter((v) => v === 'iris out').length).toBeGreaterThanOrEqual(6);
    expect(seq).toContain('iris hold');
    expect(seq.at(-1)).toBe('iris in');
    // While it closed, the picture stayed on level a; then level b showed.
    const first = moved.shown.findIndex((s) => s.startsWith('b@'));
    expect(moved.shown.slice(first - 8, first).every((s) => s === 'a@39')).toBe(true);
    expect(plain.shown.find((s) => s.startsWith('b@'))).toBe('b@40');
    expect(moved.shown[first]).toBe('b@40');
    expect(moved.booted?.transitions.running).toBe(false);
  });

  it('in manual-loop mode it plays without holding ticks, so the step hook stays tick-exact', async () => {
    const { hashes, views } = await play(true, '?debug=step');
    const win = globalThis.window as unknown as DebugWindow;
    expect(win.__ww!.step(45)).toBe(45);
    expect(hashes).toHaveLength(45);
    expect(views.at(-1)).toBe('iris out');
    // On demand, through the step hook: a spec of its own.
    win.__ww!.step(20);
    expect(win.__ww!.transition({ kind: 'wipe', ticks: 4 })).toBe(true);
    win.__ww!.step(2);
    expect(views.at(-1)).toBe('wipe out');
    expect(win.__ww!.transition('level')).toBe(false); // one runs already
    (globalThis.window as unknown as { location: { search: string } }).location.search = '';
  });

  it('without transitions nothing plays on a level change; on demand a spec still does', async () => {
    const { booted, views } = await play(false);
    expect(views.every((v) => v === null)).toBe(true);
    let covered = 0;
    expect(booted!.transition('default', () => covered++)).toBe(false);
    expect(covered).toBe(1);
    expect(booted!.transition({ kind: 'fade', ticks: 3 }, () => covered++)).toBe(true);
    expect(covered).toBe(1);
  });
});
