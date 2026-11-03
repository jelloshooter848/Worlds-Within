import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullPresenter } from '@engine/backends/null';
import { mustLoad } from '@engine/core/content/game-content';
import { canonicalJson } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { isFullMap, MINI_GAME_STATUS, skinSet, type PresentFrame } from '@engine/core/present';
import { SceneStack } from '@engine/core/scene';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { PointerGesture } from '@engine/core/input/pointer-logic';
import { loadMiniSiege, siegeMissions } from './content';
import { siegePicture } from './picture';
import { SiegePlay } from './play';

// The page's glue played headless (Engine 0.11 T9): `SiegePlay` and its `HostScene` on a real
// `SceneStack`, as `main.ts` boots them, driven through the launch button, then play (the recorded
// round of `played.run.json` fed as the page's keys) or delegate. Each path reaches a committed
// result, and with the launch at world tick 40, as in the run files, the same state hash at world
// tick 260 as the run file's last one: the page plays the game the tools play. Engine 0.12 T7:
// the same for the preparation phase, `fortify` launched at world tick 10 and played (the recorded
// round of `fortify-played.run.json`) or delegated. Engine 0.12 T8: pointer taps in the walls' round
// place and sell towers through the round's camera, and the round's frames go to its own skin.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadMiniSiege(readGameFiles(ROOT)));
const NONE: InputFrame = new ScriptedInput({ steps: [] });
const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 16);
const lastHash = (name: string) =>
  (
    JSON.parse(readFileSync(new URL(`./runs/${name}.hashes.json`, import.meta.url), 'utf8')) as {
      hashes: { tick: number; hash: string }[];
    }
  ).hashes.at(-1)!.hash;
const recordedRound = (name = 'played') =>
  (
    JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as {
      missions: { action: string; input?: InputScript }[];
    }
  ).missions.find((m) => m.action === 'play')!.input!;

/** The page's pointer in tests: the gestures queued since the last step. */
class Taps {
  readonly queued: PointerGesture[] = [];
  tap(x: number, y: number, button: 'primary' | 'secondary' = 'primary'): void {
    this.queued.push({ type: 'tap', button, x, y, kind: 'mouse' });
  }
  gestures(): readonly PointerGesture[] {
    return this.queued.splice(0);
  }
}

/** The page: the scene stack with `SiegePlay`'s scene, drawing every step into the null backend. */
function page(pointer: Taps | null = null) {
  const play = new SiegePlay({ content, seed: content.manifest.start.seed, pointer, stepsPerTick: 1 });
  const stack = new SceneStack();
  const presenter = new NullPresenter({ validate: true, freeze: true });
  stack.push(play.scene(stack, () => siegePicture(presenter, content, play.ui)));
  const frames: PresentFrame[] = [];
  const step = (input: InputFrame = NONE) => {
    stack.update([input]);
    stack.render({} as Renderer);
    frames.push(presenter.last as PresentFrame);
  };
  return { play, stack, step, frames };
}

/** Steps the battle to world tick 40, where the launch button offers the sabotage. */
function toLaunch(p: ReturnType<typeof page>): void {
  expect(p.play.launchButtons()).toEqual([]);
  while (p.play.tick < 40) p.step();
  expect(p.play.launchButtons()).toEqual(['sabotage']);
  p.play.press({ kind: 'launch', mission: 'sabotage' });
  p.step();
  expect(p.play.choice()).toBe('sabotage');
  expect(p.play.launchButtons()).toEqual([]);
  // Nothing steps while the choice is shown.
  p.step();
  expect(p.play.tick).toBe(40);
}

/** Steps the battle to world tick 10 and launches the fortify mission (the preparation phase). */
function toFortify(p: ReturnType<typeof page>): void {
  while (p.play.tick < 10) p.step();
  expect(p.play.launchButtons()).toEqual(['fortify']);
  p.play.press({ kind: 'launch', mission: 'fortify' });
  p.step();
  expect(p.play.choice()).toBe('fortify');
  p.step();
  expect(p.play.tick).toBe(10);
}

/** Steps on until world tick 260. */
function toEnd(p: ReturnType<typeof page>): void {
  while (p.play.tick < 260) p.step();
}

describe('the page glue, headless', () => {
  it('delegates: the battle freezes, the world draws ram-burnt at the commit tick', () => {
    const p = page();
    toLaunch(p);
    p.play.press({ kind: 'delegate' });
    p.step();
    expect(p.play.choice()).toBeNull();
    expect(p.play.game.miniGame()).toBeNull();
    while (p.play.records().length === 0) p.step();
    expect(p.play.tick).toBe(160);
    expect(p.play.records()[0]).toMatchObject({
      outcome: 'ram-burnt',
      resolution: 'delegated',
      commitTick: 160,
    });
    expect(p.frames.some((f) => f.events.some((e) => e.type === 'mission-open'))).toBe(true);
    expect(p.frames.at(-1)!.events).toEqual([
      { type: 'mission-commit', mission: 'sabotage', outcome: 'ram-burnt', resolution: 'delegated' },
    ]);
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('delegated'));
  });

  it('plays: the round is pushed over the battle, then both engines burn at the commit tick', () => {
    const p = page();
    toLaunch(p);
    const keys = new ScriptedInput(recordedRound());
    p.play.press({ kind: 'play' });
    let roundTicks = 0;
    do {
      keys.next();
      p.step(keys);
      roundTicks++;
      if (roundTicks === 1) {
        expect(p.stack.depth).toBe(2);
        expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('mission-room');
        expect(p.frames.at(-1)!.status['host:mission']).toBe('Burn the siege engines');
      }
    } while (p.play.game.miniGame() !== null);
    expect(roundTicks).toBe(406);
    expect(p.play.tick).toBe(40);
    // The round's scene popped itself on the tick it ended: that frame is the battle's again.
    expect(p.stack.depth).toBe(1);
    expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('');
    expect(p.frames.at(-1)!.events).toContainEqual({
      type: 'mini-game-end',
      game: 'mission-room',
      result: 'pass',
    });
    while (p.play.records().length === 0) p.step();
    expect(p.play.tick).toBe(160);
    expect(p.play.records()[0]).toMatchObject({
      outcome: 'both-burnt',
      resolution: 'played',
      commitTick: 160,
    });
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('played'));
  });

  it('refuses a launch once the window has closed, and keeps the reason', () => {
    const p = page();
    while (p.play.tick < 200) p.step();
    expect(p.play.launchButtons()).toEqual([]);
    p.play.press({ kind: 'launch', mission: 'sabotage' });
    p.step();
    expect(p.play.choice()).toBeNull();
    expect(p.play.message).toMatch(/^not_offered: /);
  });

  it('delegates the preparation phase: overrun lands at the commit tick, 30 after the launch', () => {
    const p = page();
    toFortify(p);
    p.play.press({ kind: 'delegate' });
    p.step();
    while (p.play.records().length === 0) p.step();
    expect(p.play.tick).toBe(40);
    expect(p.play.records()[0]).toMatchObject({ mission: 'fortify', outcome: 'overrun', commitTick: 40 });
    expect(p.frames.at(-1)!.events).toEqual([
      { type: 'mission-commit', mission: 'fortify', outcome: 'overrun', resolution: 'delegated' },
    ]);
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('fortify-delegated'));
  });

  it('plays the preparation phase: the walls round is pushed, then held-cheap lands at the commit', () => {
    const p = page();
    toFortify(p);
    const keys = new ScriptedInput(recordedRound('fortify-played'));
    p.play.press({ kind: 'play' });
    let roundTicks = 0;
    do {
      keys.next();
      p.step(keys);
      roundTicks++;
      if (roundTicks === 1) {
        expect(p.stack.depth).toBe(2);
        expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('td-defence');
        expect(p.frames.at(-1)!.status['host:mission']).toBe('Man the walls');
      }
    } while (p.play.game.miniGame() !== null);
    expect(roundTicks).toBe(116);
    expect(p.play.tick).toBe(10);
    expect(p.stack.depth).toBe(1);
    expect(p.frames.at(-1)!.events).toContainEqual({
      type: 'mini-game-end',
      game: 'td-defence',
      result: 'pass',
    });
    while (p.play.records().length === 0) p.step();
    expect(p.play.tick).toBe(40);
    expect(p.play.records()[0]).toMatchObject({
      outcome: 'held-cheap',
      resolution: 'played',
      commitTick: 40,
    });
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('fortify-played'));
  });

  it('places and sells towers in the walls round by pointer taps, then quits to overrun', () => {
    const taps = new Taps();
    const p = page(taps);
    toFortify(p);
    p.play.press({ kind: 'play' });
    p.step();
    const round = p.play.defenceRound()!;
    expect(round).not.toBeNull();
    const kit = () => round.game.snapshot()['kit'] as Record<string, unknown>;
    expect(kit()).toMatchObject({ gold: 100, towers: 0 });
    // The 16x7 map is centred on the 256x240 picture: its top-left at picture (0, 64). The north
    // tower's cell (11, 1) has its centre at picture (184, 88).
    taps.tap(184, 88);
    p.step();
    expect(round.game.controls.view()).toMatchObject({ col: 11, row: 1 });
    expect(kit()['towers']).toBe(0);
    taps.tap(184, 88);
    p.step();
    expect(kit()).toMatchObject({ gold: 80, towers: 1 });
    const tower = p.frames.at(-1)!.entities.find((e) => e.kind === 'tower:archers');
    expect(tower).toMatchObject({ x: 176, y: 16 });
    expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('td-defence');
    // A tap off the map does nothing; a secondary tap sells (half the cost back).
    taps.tap(10, 10);
    p.step();
    expect(kit()['towers']).toBe(1);
    taps.tap(184, 88, 'secondary');
    p.step();
    expect(kit()).toMatchObject({ gold: 90, towers: 0 });
    // Select gives up: the mission's onQuit outcome lands at the commit tick.
    const quit = new ScriptedInput({ steps: [{ frame: 0, hold: ['select'] }] });
    quit.next();
    p.step(quit);
    expect(p.play.game.miniGame()).toBeNull();
    while (p.play.records().length === 0) p.step();
    expect(p.play.tick).toBe(40);
    expect(p.play.records()[0]).toMatchObject({ mission: 'fortify', outcome: 'overrun', resolution: 'quit' });
  });

  it('ignores taps while no walls round is hosted', () => {
    const p = page();
    expect(p.play.roundTap(184, 88)).toBe(false);
  });

  it('draws the walls round with its own skin: every kind, tile and sound the round shows', () => {
    const p = page();
    toFortify(p);
    const keys = new ScriptedInput(recordedRound('fortify-played'));
    p.play.press({ kind: 'play' });
    do {
      keys.next();
      p.step(keys);
    } while (p.play.game.miniGame() !== null);
    const { main, rounds } = skinSet(content, 'canvas2d');
    const skin = rounds['td-defence']!;
    expect(skin).toBeDefined();
    const round = p.frames.filter((f) => f.status[MINI_GAME_STATUS] === 'td-defence');
    // 116 round ticks: the last one ends the round, and its frame is the battle's again.
    expect(round.length).toBe(115);
    const kinds = new Set(round.flatMap((f) => f.entities.map((e) => e.kind)));
    expect([...kinds].sort()).toEqual([
      'cursor',
      'enemy:raider',
      'ghost:archers',
      'shot:archers',
      'tower:archers',
    ]);
    for (const k of kinds) expect(skin.kinds[k], k).toBeDefined();
    const tiles = new Set(round.flatMap((f) => (f.map && isFullMap(f.map) ? f.map.tiles.join('') : '')));
    expect(tiles.size).toBeGreaterThan(0);
    for (const t of [...tiles].join('')) expect(skin.tiles?.[t], `tile ${t}`).toBeDefined();
    const events = new Set(round.flatMap((f) => f.events.map((e) => e.type)));
    for (const e of ['td-place', 'td-wave-start', 'td-shot', 'td-kill']) expect(events.has(e), e).toBe(true);
    // The battle's skin sounds every fortify outcome's commit.
    const fortify = siegeMissions(content).find((m) => m.id === 'fortify')!;
    for (const o of fortify.outcomes)
      expect(main!.events?.[`mission-commit:outcome=${o.id}`], o.id).toBeDefined();
  });
});
