import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '@engine/core/headless';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { px } from '@engine/core/math/units';
import type { MiniGameDef, MiniGameResult } from '@engine/core/minigame';
import { validate } from '@engine/core/content/validate';
import {
  freezeFrame,
  isFullMap,
  presentFrameSchema,
  type PresentEntity,
  type PresentFrame,
  type PresentMap,
} from '@engine/core/present';
import { levelSchema } from './level';
import { profileSchema } from './profile';
import { BUMP_RISE, PlatformerPresentState, presentMap, presentWorld, REMAINS_TICKS } from './present';
import { snapshotWorld } from './snapshot';
import { PlatformerWorld, type PlatformerEvent } from './world';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const PROFILE = profileSchema.parse(JSON.parse(fixture('runner.profile.json')));

const tiny = () => {
  const header = JSON.parse(fixture('tiny.json'));
  return levelSchema.parse({ ...header, map: fixture('tiny.map.txt').trim().split('\n') });
};

/** The fixture playthrough of `objects.test.ts`: start to goal, through the bump block and both coins. */
const SCRIPT: { frame: number; hold: Action[] }[] = [
  { frame: 0, hold: ['right'] },
  { frame: 72, hold: ['right', 'jump'] },
  { frame: 90, hold: ['right'] },
  { frame: 96, hold: ['right', 'jump'] },
  { frame: 125, hold: ['right'] },
  { frame: 160, hold: ['right', 'jump'] },
  { frame: 175, hold: ['right'] },
];

/** Plays the fixture level to the goal; `present` sees the world and each step's events. */
function playTiny(present?: (w: PlatformerWorld, ev: PlatformerEvent[]) => void): string[] {
  const world = new PlatformerWorld(tiny(), PROFILE, { seed: 1 });
  const input = new ScriptedInput({ steps: SCRIPT });
  const hashes: string[] = [];
  present?.(world, world.events.splice(0));
  for (let i = 0; i < 400 && world.outcome !== 'cleared'; i++) {
    input.next();
    world.update(input);
    const ev = world.events.splice(0);
    present?.(world, ev);
    hashes.push(canonicalJson(snapshotWorld(world, ev)));
  }
  return hashes;
}

function valid(frame: PresentFrame): void {
  const r = validate('frame.json', frame, presentFrameSchema);
  expect(r.errors).toEqual([]);
  expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
}

/** A small world from map rows, stepped with held actions. */
function setup(map: string[], header: Record<string, unknown> = {}, miniGames: MiniGameDef[] = []) {
  const level = levelSchema.parse({ id: 'test', profile: 'runner', ...header, map });
  const world = new PlatformerWorld(level, PROFILE, { seed: 3, miniGames });
  const input = new ScriptedInput({ steps: [] });
  const state = new PlatformerPresentState();
  const frames: PresentFrame[] = [presentWorld(world, world.events.splice(0), { state })];
  const step = (held: Action[] = [], n = 1): PresentFrame => {
    for (let i = 0; i < n; i++) {
      input.setHeld(held);
      input.next();
      world.update(input);
      frames.push(presentWorld(world, world.events.splice(0), { state }));
    }
    return frames.at(-1) as PresentFrame;
  };
  return { world, step, frames };
}

const byId = (f: PresentFrame, id: string): PresentEntity | undefined => f.entities.find((e) => e.id === id);
const runner = (f: PresentFrame) => byId(f, 'runner') as PresentEntity;
const W = { w: { actor: 'walker' } };
const allEvents = (frames: PresentFrame[], type: string) =>
  frames.flatMap((f) => f.events).filter((e) => e.type === type);

describe('presentWorld: the fixture playthrough', () => {
  it('gives the same state hashes whether or not every tick is presented', () => {
    const state = new PlatformerPresentState();
    const presented = playTiny((w, ev) => presentWorld(w, ev, { state }));
    const plain = playTiny();
    expect(presented.length).toBeGreaterThan(100);
    expect(presented).toEqual(plain);
  });

  it('gives frames that pass presentFrameSchema and survive freezeFrame, the same on two runs', () => {
    const run = () => {
      const state = new PlatformerPresentState();
      const frames: PresentFrame[] = [];
      playTiny((w, ev) => frames.push(presentWorld(w, ev, { state })));
      return frames;
    };
    const frames = run();
    for (const f of frames) {
      valid(f);
      const frozen = freezeFrame(f);
      expect(Object.isFrozen(frozen.entities)).toBe(true);
      valid(frozen as PresentFrame);
      for (const e of f.entities)
        for (const n of [e.x, e.y, e.w, e.h]) expect(Number.isInteger(n)).toBe(true);
    }
    expect(run().map((f) => canonicalJson(f))).toEqual(frames.map((f) => canonicalJson(f)));
  });

  it('sends the map in full on load and after a block change, else as a reference', () => {
    const state = new PlatformerPresentState();
    const frames: { frame: PresentFrame; events: PlatformerEvent[] }[] = [];
    playTiny((w, ev) => frames.push({ frame: presentWorld(w, ev, { state }), events: ev }));
    const full = frames.filter((f) => isFullMap(f.frame.map!));
    const blockAt = frames.findIndex((f) => f.events.some((e) => e.type === 'block'));
    expect(blockAt).toBeGreaterThan(0);
    expect(full.map((f) => frames.indexOf(f))).toEqual([0, blockAt]);
    const [first, after] = full.map((f) => f.frame.map as PresentMap);
    expect(first!.tiles[3]).toBe('.......?................');
    expect(after!.tiles[3]).toBe('.......u................');
    expect(after!.version).not.toBe(first!.version);
    // The coin row is terrain only: coins are entities, so taking one does not resend the map.
    expect(first!.tiles[5]).toBe('........................');
    expect(first!.tiles[6]).toBe('.................##.....');
    expect(first).toMatchObject({ id: 'tiny', tileSize: 16, cols: 24, rows: 8, tags: ['scroll:right'] });
    const coins = frames.filter((f) => f.events.some((e) => e.type === 'coin'));
    expect(coins.length).toBe(2);
    for (const c of coins.slice(1)) expect(isFullMap(c.frame.map!)).toBe(false);
  });

  it('lists the objects, the walker and the runner, and places the events', () => {
    const state = new PlatformerPresentState();
    const frames: PresentFrame[] = [];
    playTiny((w, ev) => frames.push(presentWorld(w, ev, { state })));
    const f0 = frames[0]!;
    expect(f0.entities.map((e) => e.id)).toEqual(['coin@18,5', 'goal@22,6', 'actor#1', 'runner']);
    expect(byId(f0, 'actor#1')).toMatchObject({
      kind: 'walker',
      x: 240,
      y: 96,
      w: 16,
      h: 16,
      facing: 'left',
    });
    expect(runner(f0)).toMatchObject({
      kind: 'runner',
      x: 18,
      y: 96,
      w: 12,
      h: 16,
      facing: 'right',
      layer: 20,
    });
    expect(f0.status).toEqual({
      coins: 0,
      hp: 2,
      maxHp: 2,
      lives: 1,
      outcome: 'playing',
      level: 'tiny',
      miniGame: '',
    });
    const block = allEvents(frames, 'block')[0]!;
    expect(block).toMatchObject({ type: 'block', content: 'coin', x: 7 * 16 + 8, y: 3 * 16 + 8 });
    const jump = allEvents(frames, 'jump')[0]!;
    expect(jump.entity).toBe('runner');
    // The bump block bounces and a coin pops out over it.
    const bumped = frames.find((f) => byId(f, 'bump-block@7,3'))!;
    expect(byId(bumped, 'bump-block@7,3')).toMatchObject({
      kind: 'bump-block',
      y: 48 - BUMP_RISE[0]!,
      tags: ['used'],
    });
    expect(byId(bumped, 'coin-pop@7,3')).toMatchObject({ kind: 'coin', anim: { state: 'pop', t: 0 } });
    expect(frames.filter((f) => byId(f, 'bump-block@7,3')).length).toBe(BUMP_RISE.length);
    // The taken coin is gone; the last frame is cleared.
    const end = frames.at(-1)!;
    expect(byId(end, 'coin@18,5')).toBeUndefined();
    expect(end.status['outcome']).toBe('cleared');
    expect(end.status['coins']).toBe(2);
    // The runner walked, jumped and fell; its clock counts ticks in a state.
    const states = new Set(frames.map((f) => runner(f).anim.state));
    for (const s of ['walk', 'jump', 'fall']) expect(states).toContain(s);
    const walks = frames.map((f) => runner(f).anim).filter((a) => a.state === 'walk');
    expect(walks.slice(0, 3).map((a) => a.t)).toEqual([0, 1, 2]);
  });

  it('gives a camera hint that follows the runner inside the scroll lock', () => {
    const state = new PlatformerPresentState();
    const frames: { f: PresentFrame; scrollX: number }[] = [];
    playTiny((w, ev) => frames.push({ f: presentWorld(w, ev, { state }), scrollX: w.scrollX }));
    for (const { f, scrollX } of frames) {
      expect(f.camera).toMatchObject({
        follow: 'runner',
        bounds: { x: scrollX >> 8, y: 0, w: 384 - (scrollX >> 8), h: 128 },
      });
    }
    expect(frames.at(-1)!.f.camera!.bounds!.x).toBeGreaterThan(0);
  });
});

describe('presentWorld: states, tags and remains', () => {
  it('shows a stomped walker as remains, then nothing', () => {
    const { world, step } = setup(['..........', '.@....w..G', '##########'], { spawns: W });
    step([], 3);
    const w = world.actors[0]!;
    const p = world.player.body;
    p.x = w.body.x + px(2);
    p.y = w.body.y - px(24);
    p.onGround = false;
    let f = step();
    for (let i = 0; i < 30 && !f.events.some((e) => e.type === 'stomp'); i++) f = step();
    const stomp = f.events.find((e) => e.type === 'stomp')!;
    expect(stomp).toMatchObject({ entity: 'actor#1', into: null });
    expect(typeof stomp.x).toBe('number');
    expect(byId(f, 'actor#1')).toMatchObject({ kind: 'walker', anim: { state: 'stomped', t: 0 } });
    f = step([], REMAINS_TICKS - 1);
    expect(byId(f, 'actor#1')!.anim).toEqual({ state: 'stomped', t: REMAINS_TICKS - 1 });
    expect(byId(step(), 'actor#1')).toBeUndefined();
  });

  it('shows a stomped shell walker as a still shell, then a kicked one', () => {
    const { world, step } = setup(['............', '.@....s....G', '############'], {
      spawns: { s: { actor: 'shell-walker' } },
    });
    step([], 3);
    const a = world.actors[0]!;
    const p = world.player.body;
    p.x = a.body.x + px(2);
    p.y = a.body.y - px(24);
    p.onGround = false;
    let f = step();
    for (let i = 0; i < 30 && !f.events.some((e) => e.type === 'stomp'); i++) f = step();
    expect(byId(f, 'actor#1')).toMatchObject({ kind: 'shell', tags: [] });
    // A fresh shell is not yet on the ground; it settles within a few ticks and lies still.
    for (let i = 0; i < 10 && byId(f, 'actor#1')!.anim.state === 'fall'; i++) f = step();
    expect(byId(f, 'actor#1')!.anim.state).toBe('idle');
    // The bounce comes back down on the shell once its grace is over, and kicks it.
    for (let i = 0; i < 120 && !f.events.some((e) => e.type === 'kick'); i++) f = step();
    expect(f.events.find((e) => e.type === 'kick')).toMatchObject({ entity: 'actor#1' });
    f = step();
    expect(byId(f, 'actor#1')).toMatchObject({ kind: 'shell', anim: { state: 'run' }, tags: ['kicked'] });
  });

  it('shows a hurt runner with the invuln tag, and a dead one when the level is failed', () => {
    const { step, frames } = setup(['#........#', '#@...w..G#', '##########'], { spawns: W });
    let f = step();
    for (let i = 0; i < 200 && !f.events.some((e) => e.type === 'hurt'); i++) f = step();
    expect(f.events.find((e) => e.type === 'hurt')).toMatchObject({ entity: 'runner', hp: 1 });
    expect(runner(f)).toMatchObject({ anim: { state: 'hurt', t: 0 }, tags: ['invuln', 'hp:1'] });
    expect(f.status['hp']).toBe(1);
    for (let i = 0; i < 2000 && f.status['outcome'] === 'playing'; i++) f = step();
    expect(f.status['outcome']).toBe('failed');
    expect(runner(f).anim.state).toBe('dead');
    expect(allEvents(frames, 'died')[0]).toMatchObject({ cause: 'hurt', entity: 'runner' });
  });

  it('shows the runner idle, walking, running and skidding', () => {
    const { step } = setup([
      '....................................',
      '.@.................................G',
      '####################################',
    ]);
    expect(runner(step([], 3)).anim.state).toBe('idle');
    expect(runner(step(['right'])).anim.state).toBe('walk');
    expect(runner(step(['right', 'run'], 60)).anim.state).toBe('run');
    expect(runner(step(['left'])).anim.state).toBe('skid');
    expect(runner(step(['left'])).facing).toBe('right');
  });

  it('keeps no-scroll and free levels inside their own bounds', () => {
    expect(setup(['.@G'], { scroll: 'none' }).frames[0]!.camera!.bounds).toEqual({
      x: 0,
      y: 0,
      w: 48,
      h: 16,
    });
    expect(setup(['.@G'], { scroll: 'free' }).frames[0]!.camera!.bounds).toBeUndefined();
  });

  it('describes the same world the same way without a state, but sends the map each time', () => {
    const { world } = setup(['.@G']);
    const a = presentWorld(world);
    const b = presentWorld(world);
    expect(isFullMap(a.map!)).toBe(true);
    expect(b).toEqual(a);
    expect(a.map).toEqual(presentMap(world));
  });
});

describe('presentWorld: mini games', () => {
  const make = (withFrame: boolean): MiniGameDef => ({
    id: 'hold',
    title: 'HOLD ON',
    create() {
      let held = 0;
      let result: MiniGameResult | null = null;
      return {
        step(input) {
          if (input.held('attack') && ++held >= 3) result = 'pass';
        },
        snapshot: () => ({ held }),
        result: () => result,
        ...(withFrame
          ? {
              present: (): PresentFrame => ({
                frame: 0,
                size: { width: 256, height: 240 },
                entities: [],
                map: { id: 'hold-board', version: 1, tileSize: 8, cols: 1, rows: 1, tiles: ['x'] },
                events: [{ type: 'tick' }],
                status: { held },
              }),
            }
          : {}),
      };
    },
  });
  const MAP = ['........', '.@.!...G', '########'];
  const header = { triggers: [{ game: 'hold', pass: ['coins:1'] }] };

  function playRound(withFrame: boolean) {
    const s = setup(MAP, header, [make(withFrame)]);
    let f = s.step(['right']);
    for (let i = 0; i < 100 && !s.world.miniGame; i++) f = s.step(['right']);
    expect(s.world.miniGame).not.toBeNull();
    return { ...s, started: f };
  }

  it("shows the mini game's own frame while it runs, then the level's map again", () => {
    const { step, started, world, frames } = playRound(true);
    expect(started.status).toEqual({ held: 0, miniGame: 'hold' });
    expect(started.frame).toBe(world.frame);
    expect(started.events.map((e) => e.type)).toEqual(['mini-game', 'tick']);
    expect(started.events[0]).toMatchObject({ x: 3 * 16 + 8, y: 16 + 8 });
    expect(isFullMap(started.map!)).toBe(true);
    const next = step(['attack']);
    expect(next.map).toEqual({ id: 'hold-board', version: 1 });
    valid(next);
    step(['attack'], 2);
    expect(world.miniGame).toBeNull();
    const back = frames.find((f) => f.events.some((e) => e.type === 'mini-game-end'))!;
    expect(back.status['miniGame']).toBe('');
    expect(isFullMap(back.map!)).toBe(true);
    expect((back.map as PresentMap).id).toBe('test');
    expect(isFullMap(step().map!)).toBe(false);
  });

  it('flags the paused level while a mini game with no frame of its own runs', () => {
    const { started, step } = playRound(false);
    expect(started.status['miniGame']).toBe('hold');
    expect(byId(started, 'trigger@3,1')!.tags).toEqual(['running']);
    expect(byId(started, 'runner')).toBeDefined();
    const next = step(['attack']);
    expect(next.status['miniGame']).toBe('hold');
    expect(isFullMap(next.map!)).toBe(false);
  });
});
