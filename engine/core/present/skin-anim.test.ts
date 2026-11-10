import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { engineContentKinds } from '../content/engine-kinds';
import { validate } from '../content/validate';
import { FrameEventClock } from './frame-events';
import { freezeFrame } from './freeze';
import {
  cycleFrameTicks,
  cycleLength,
  cyclePosition,
  FRAME_EVENT_LIMIT,
  frameEventsBetween,
  resolveSkinAnimation,
  resolveSkinFrame,
  resolveSkinMesh,
  skinSchema,
  type SkinFile,
} from './skin';
import type { Facing, PresentEntity } from './types';

// Sprite animation states, per-frame timing, one-shots with `then` and frame events (Engine 0.16 T2).

/** A fixture skin with a full animation set on `hero`. */
function fixture(): SkinFile {
  return {
    backend: 'canvas2d',
    sheets: { sheet: 'hero', fallbackColor: '#00a800' },
    kinds: {
      hero: {
        flipFacing: true,
        frames: {
          // Per-frame timing, a footstep on frames 1 and 3, looping.
          run: {
            frames: ['run-0', 'run-1', 'run-2', 'run-3'],
            ticks: [2, 4, 2, 4],
            events: { 1: 'step', 3: 'step' },
          },
          // A one-shot that hands over to `idle` once it has played.
          land: {
            frames: ['land-0', 'land-1'],
            ticks: [3, 2],
            loop: false,
            then: 'idle',
            events: { 0: 'thud' },
          },
          idle: { frames: ['idle-0', 'idle-1'], ticks: 10, events: { 1: 'blink' } },
          // A one-shot that holds its last frame.
          attack: {
            frames: ['atk-0', 'atk-1', 'atk-2'],
            ticks: [2, 2, 6],
            loop: false,
            events: { 2: 'swing' },
          },
          // Per facing, with events in a facing's cycle.
          climb: { up: { frames: ['up-0', 'up-1'], ticks: 3, events: { 0: 'grab' } }, right: 'side' },
        },
      },
      coin: { frames: { idle: { frames: ['c0', 'c1', 'c2'], ticks: [6, 2, 2] } } },
    },
    events: { step: { sound: 'tap' }, thud: { sound: 'thud' } },
  };
}

const entity = (state: string, t: number, facing: Facing = 'right'): PresentEntity => ({
  id: 'hero',
  kind: 'hero',
  x: 10,
  y: 20,
  w: 16,
  h: 24,
  facing,
  anim: { state, t },
  tags: [],
});

describe('cycle timing', () => {
  const c = { frames: ['a', 'b', 'c'], ticks: [2, 5, 1] };

  it('reads one number or a per-frame list of ticks, and adds them up', () => {
    expect([0, 1, 2].map((i) => cycleFrameTicks(c, i))).toEqual([2, 5, 1]);
    expect(cycleFrameTicks({ frames: ['a'], ticks: 3 }, 0)).toBe(3);
    expect(cycleFrameTicks({ frames: ['a'] }, 0)).toBe(8);
    expect(cycleLength(c)).toBe(8);
  });

  it('wraps a loop and holds a one-shot once it is done', () => {
    expect([0, 1, 2, 6, 7, 8, 10].map((t) => cyclePosition(c, t).index)).toEqual([0, 0, 1, 1, 2, 0, 1]);
    const once = { ...c, loop: false };
    expect([0, 7, 8, 100].map((t) => cyclePosition(once, t))).toEqual([
      { index: 0, done: false },
      { index: 2, done: false },
      { index: 2, done: true },
      { index: 2, done: true },
    ]);
  });
});

describe('resolveSkinAnimation and per-frame timing', () => {
  const skin = fixture();
  const frameAt = (state: string, t: number, facing: Facing = 'right') =>
    resolveSkinFrame(skin, entity(state, t, facing)).frame;

  it('shows each frame for its own ticks, looping', () => {
    expect([0, 1, 2, 5, 6, 7, 11, 12].map((t) => frameAt('run', t))).toEqual([
      'run-0',
      'run-0',
      'run-1',
      'run-1',
      'run-2',
      'run-2',
      'run-3',
      'run-0',
    ]);
    expect(
      [0, 5, 6, 7, 8, 9, 10].map((t) => resolveSkinFrame(skin, { ...entity('idle', t), kind: 'coin' }).frame),
    ).toEqual(['c0', 'c0', 'c1', 'c1', 'c2', 'c2', 'c0']);
  });

  it('holds the last frame of a one-shot without then', () => {
    expect([0, 2, 4, 9, 10, 500].map((t) => frameAt('attack', t))).toEqual([
      'atk-0',
      'atk-1',
      'atk-2',
      'atk-2',
      'atk-2',
      'atk-2',
    ]);
  });

  it("plays a one-shot's then state once it has finished, from the tick it finished", () => {
    expect([0, 2, 3, 4, 5, 14, 15, 25].map((t) => frameAt('land', t))).toEqual([
      'land-0',
      'land-0',
      'land-1',
      'land-1',
      'idle-0',
      'idle-0',
      'idle-1',
      'idle-0',
    ]);
    expect(resolveSkinAnimation(skin, entity('land', 16))).toEqual({
      state: 'idle',
      frame: 'idle-1',
      index: 1,
      t: 11,
      flipX: false,
    });
  });

  it('keeps facings, flips and the idle fallback', () => {
    expect(resolveSkinAnimation(skin, entity('run', 2, 'left'))).toMatchObject({
      frame: 'run-1',
      flipX: true,
    });
    expect(resolveSkinAnimation(skin, entity('climb', 3, 'up'))).toMatchObject({ frame: 'up-1', index: 1 });
    expect(resolveSkinAnimation(skin, entity('swim', 10))).toMatchObject({ state: 'idle', frame: 'idle-1' });
    expect(resolveSkinAnimation(skin, { ...entity('idle', 0), kind: 'nobody' })).toBeUndefined();
  });

  it('a then back to a state already played holds instead of looping for ever', () => {
    const s = fixture();
    s.kinds['hero']!.frames!['a'] = { frames: ['a0'], ticks: 2, loop: false, then: 'b' };
    s.kinds['hero']!.frames!['b'] = { frames: ['b0'], ticks: 2, loop: false, then: 'a' };
    expect([0, 2, 4, 1000].map((t) => resolveSkinFrame(s, entity('a', t)).frame)).toEqual([
      'a0',
      'b0',
      'b0',
      'b0',
    ]);
  });

  it('reads the same as before for a cycle with one ticks number', () => {
    const s: SkinFile = {
      backend: 'canvas2d',
      sheets: { sheet: 'x', fallbackColor: '#000' },
      kinds: {
        k: {
          frames: {
            walk: { frames: ['a', 'b', 'c'], ticks: 4 },
            die: { frames: ['a', 'b'], ticks: 2, loop: false },
          },
        },
      },
    };
    const at = (state: string, t: number) =>
      resolveSkinFrame(s, { kind: 'k', facing: 'down', anim: { state, t } }).frame;
    for (let t = 0; t < 40; t++) {
      expect(at('walk', t)).toBe(['a', 'b', 'c'][Math.floor(t / 4) % 3]);
      expect(at('die', t)).toBe(['a', 'b'][Math.min(Math.floor(t / 2), 1)]);
    }
  });
});

describe('frameEventsBetween', () => {
  const skin = fixture();
  const types = (state: string, prevT: number, t: number, facing: Facing = 'right') =>
    frameEventsBetween(skin, entity(state, t, facing), prevT, t).map((e) => `${e.type}@${e.t}`);

  it('gives the events of the frames that started in (prevT, t]', () => {
    // run: frame starts at 0, 2, 6, 8 in each 12-tick lap; steps on frames 1 and 3.
    expect(types('run', -1, 0)).toEqual([]);
    expect(types('run', 1, 2)).toEqual(['step@2']);
    expect(types('run', 2, 7)).toEqual([]);
    expect(types('run', -1, 8)).toEqual(['step@2', 'step@8']);
  });

  it('keeps firing across a wrapped loop', () => {
    expect(types('run', 8, 14)).toEqual(['step@14']);
    expect(types('run', 13, 32)).toEqual(['step@14', 'step@20', 'step@26', 'step@32']);
    expect(frameEventsBetween(skin, entity('run', 30), 29, 30)).toEqual([]);
    expect(frameEventsBetween(skin, entity('run', 26), 25, 26)).toEqual([
      { type: 'step', state: 'run', index: 1, t: 26 },
    ]);
  });

  it("fires a state's first frame when it begins, and a one-shot's only once", () => {
    expect(types('attack', -1, 0)).toEqual([]);
    expect(types('attack', 3, 4)).toEqual(['swing@4']);
    expect(types('attack', 4, 400)).toEqual([]);
    expect(types('land', -1, 0)).toEqual(['thud@0']);
  });

  it("goes on into a finished one-shot's then state", () => {
    // land takes 5 ticks; idle then starts at 5 with a blink on its frame 1 (tick 15, 35, ...).
    expect(types('land', 0, 16)).toEqual(['blink@15']);
    expect(frameEventsBetween(skin, entity('land', 35), 34, 35)).toEqual([
      { type: 'blink', state: 'idle', index: 1, t: 35 },
    ]);
  });

  it("reads a facing's own cycle, and nothing for a frame with no events", () => {
    expect(types('climb', -1, 6, 'up')).toEqual(['grab@0', 'grab@6']);
    expect(types('climb', -1, 6, 'right')).toEqual([]);
    expect(types('run', 5, 5)).toEqual([]);
  });

  it(`gives at most ${FRAME_EVENT_LIMIT} at once`, () => {
    expect(frameEventsBetween(skin, entity('run', 100_000), -1, 100_000)).toHaveLength(FRAME_EVENT_LIMIT);
  });
});

describe('FrameEventClock', () => {
  it('gives each frame event once, as a presentation event at the entity', () => {
    const skin = fixture();
    const clock = new FrameEventClock();
    const seen: string[] = [];
    for (let t = 0; t <= 14; t++) {
      for (const ev of clock.next(skin, [freezeFrame(entity('run', t))])) seen.push(`${ev.type}@${t}`);
    }
    expect(seen).toEqual(['step@2', 'step@8', 'step@14']);
    expect(clock.next(skin, [entity('land', 0)])).toEqual([
      { type: 'thud', entity: 'hero', x: 18, y: 44, state: 'land', frame: 0, source: 'frame' },
    ]);
  });

  it('starts an entity seen for the first time at its tick now, not from 0', () => {
    const clock = new FrameEventClock();
    // Run frames start at 48, 50, 54 and 56: first seen at 51, nothing before it fires.
    expect(clock.next(fixture(), [entity('run', 51)])).toEqual([]);
    expect(clock.next(fixture(), [entity('run', 53)]).map((e) => e.type)).toEqual([]);
    expect(clock.next(fixture(), [entity('run', 56)]).map((e) => e.type)).toEqual(['step']);
  });

  it('gives nothing for a skin with no frame events', () => {
    const skin = fixture();
    for (const e of Object.values(skin.kinds)) {
      for (const spec of Object.values(e.frames ?? {})) if (typeof spec === 'object') delete spec.events;
      const climb = e.frames?.['climb'];
      if (typeof climb === 'object' && typeof climb.up === 'object') delete climb.up.events;
    }
    const clock = new FrameEventClock();
    for (let t = 0; t < 30; t++) expect(clock.next(skin, [entity('run', t)])).toEqual([]);
  });
});

describe('3D poses', () => {
  const three: SkinFile = {
    backend: 'three',
    meshes: {
      'run-a': [{ shape: 'box', size: { w: 4, h: 4, d: 4 } }],
      'run-b': [{ shape: 'sphere', size: { w: 4, h: 4, d: 4 } }],
    },
    kinds: {
      hero: {
        mesh: 'box',
        color: '#d82800',
        poses: {
          run: { frames: ['run-a', 'run-b'], ticks: [3, 5], events: { 0: 'step' } },
          idle: 'cylinder',
        },
      },
      rock: { mesh: 'sphere', color: '#7c7c7c' },
    },
    events: { step: { sound: 'tap' } },
  };

  it('picks the mesh by state and frame, and the entry mesh without poses', () => {
    expect(skinSchema.safeParse(three).success).toBe(true);
    expect([0, 2, 3, 7, 8].map((t) => resolveSkinMesh(three, entity('run', t)))).toEqual([
      'run-a',
      'run-a',
      'run-b',
      'run-b',
      'run-a',
    ]);
    expect(resolveSkinMesh(three, entity('jump', 0))).toBe('cylinder');
    expect(resolveSkinMesh(three, { ...entity('run', 0), kind: 'rock' })).toBe('sphere');
    expect(resolveSkinMesh(three, { ...entity('run', 0), kind: 'ghost' })).toBeUndefined();
    expect(frameEventsBetween(three, entity('run', 8), -1, 8).map((e) => e.t)).toEqual([0, 8]);
    // A three skin's sprite frames stay empty: meshes are drawn.
    expect(resolveSkinFrame(three, entity('run', 0)).frame).toBeNull();
  });

  it('flags an unknown pose mesh, and poses on a 2D skin', () => {
    const bad = structuredClone(three);
    bad.kinds['hero']!.poses!['run'] = { frames: ['run-a', 'run-z'] };
    expect(validate('three.json', bad, skinSchema).errors.map((e) => [e.path, e.code])).toEqual([
      ['kinds.hero.poses.run.frames.1', 'missing_ref'],
    ]);
    const flat = { ...fixture(), kinds: { hero: { ...fixture().kinds['hero']!, poses: { idle: 'box' } } } };
    expect(validate('canvas2d.json', flat, skinSchema).errors.map((e) => [e.path, e.code])).toEqual([
      ['kinds.hero.poses', 'wrong_backend_field'],
    ]);
  });
});

describe('validation of timing, one-shots and frame events', () => {
  const manifest = {
    id: 'g',
    kit: 'topdown',
    content: {
      skin: ['skins/*.json'],
      sprite: ['sprites/*.json'],
      palette: ['palettes/*.json'],
      sfx: ['sfx/*.json'],
    },
    start: { seed: 1 },
    headless: 'headless.ts',
  };
  const names = [
    'run-0',
    'run-1',
    'run-2',
    'run-3',
    'land-0',
    'land-1',
    'idle-0',
    'idle-1',
    'atk-0',
    'atk-1',
    'atk-2',
    'up-0',
    'up-1',
    'side',
    'c0',
    'c1',
    'c2',
  ];
  const files = (skin: unknown) => ({
    'game.json': JSON.stringify(manifest),
    'skins/canvas2d.json': JSON.stringify(skin),
    'sprites/hero.json': JSON.stringify({
      palette: 'p',
      frames: Object.fromEntries(names.map((f) => [f, ['0']])),
    }),
    'palettes/p.json': JSON.stringify({ id: 'p', colors: ['#000'] }),
    'sfx/tap.json': JSON.stringify({ id: 'tap', pulse: 'c' }),
    'sfx/thud.json': JSON.stringify({ id: 'thud', pulse: 'c' }),
  });
  const errors = (skin: unknown) =>
    loadContent(files(skin), engineContentKinds(), { root: 'games/g/' }).errors.map((e) => [e.path, e.code]);

  it('passes the fixture', () => {
    expect(errors(fixture())).toEqual([]);
  });

  it('reports frame events outside the cycle, a ticks list of the wrong length and a bad then', () => {
    const s = fixture();
    const f = s.kinds['hero']!.frames!;
    f['run'] = {
      frames: ['run-0', 'run-1'],
      ticks: [2, 4, 2],
      events: { 2: 'step', '-1': 'step', '01': 'step', 1: 'step' },
    };
    f['land'] = { frames: ['land-0'], loop: false, then: 'nap' };
    f['idle'] = { frames: ['idle-0'], then: 'run' };
    f['climb'] = { up: { frames: ['up-0'], events: { 1: 'grab' } } };
    expect(errors(s)).toEqual([
      ['kinds.hero.frames.run.ticks', 'bad_frame_ticks'],
      ['kinds.hero.frames.run.events["2"]', 'bad_frame_event'],
      ['kinds.hero.frames.run.events["-1"]', 'bad_frame_event'],
      ['kinds.hero.frames.run.events["01"]', 'bad_frame_event'],
      ['kinds.hero.frames.land.then', 'bad_then'],
      ['kinds.hero.frames.idle.then', 'bad_then'],
      ['kinds.hero.frames.climb.up.events["1"]', 'bad_frame_event'],
    ]);
  });

  it('checks the cycles of byTag looks too, and rejects a zero tick in a list', () => {
    const s = fixture();
    s.kinds['coin']!.byTag = [{ tag: 'gold', frames: { idle: { frames: ['c0'], events: { 3: 'x' } } } }];
    expect(errors(s)).toEqual([['kinds.coin.byTag.0.frames.idle.events["3"]', 'bad_frame_event']]);
    const z = fixture();
    z.kinds['coin']!.frames!['idle'] = { frames: ['c0', 'c1'], ticks: [1, 0] };
    expect(validate('s.json', z, skinSchema).errors.map((e) => e.path)).toEqual([
      'kinds.coin.frames.idle.ticks.1',
    ]);
  });

  it('keeps then and events with frames on a state of facings', () => {
    const s = fixture();
    (s.kinds['hero']!.frames as Record<string, unknown>)['climb'] = {
      then: 'idle',
      events: { 0: 'x' },
      up: 'up-0',
    };
    expect(validate('s.json', s, skinSchema).errors.map((e) => [e.path, e.code])).toEqual([
      ['kinds.hero.frames.climb.then', 'custom'],
      ['kinds.hero.frames.climb.events', 'custom'],
    ]);
  });
});
