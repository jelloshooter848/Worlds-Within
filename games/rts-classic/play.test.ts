import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullPresenter, NullRenderer } from '@engine/backends/null';
import { mustLoad } from '@engine/core/content/game-content';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { PointerGesture } from '@engine/core/input/pointer-logic';
import { readGameFiles } from '@engine/core/node/game-files';
import { RTS_TILE_SIZE } from '@kits/rts';
import { loadSkirmish } from './content';
import { createGame } from './headless';
import { skirmishPicture } from './picture';
import { SkirmishPlay, STEPS_PER_TICK, TICKS_PER_SECOND } from './play';
import { stateHash } from '@engine/core/state-hash';
import { BattleRecorder, type RecordedRun } from './recording';

// The page's side of the skirmish without a browser (Engine 0.9 T12): the recorder hashes as `run`
// does, and `SkirmishPlay` driven by scripted pointer gestures and buttons records orders whose
// run file replays headless to the same hashes. The real page is played by
// tests/browser/rts-skirmish.test.ts (for the sample this game was copied from).

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadSkirmish(readGameFiles(ROOT)));
const NO_INPUT = {} as InputFrame;

/** The tools' state hash (`stateHash` in engine/tools/headless-run.ts), written out here. */
const toolsHash = (json: string) => createHash('sha256').update(json).digest('hex').slice(0, 16);

/** Replays a recorded run headless as `pnpm cli run` does and returns its hashes at `hashes`' ticks. */
async function replay(run: RecordedRun): Promise<{ tick: number; hash: string }[]> {
  const game = createGame(content, run.seed);
  const out: { tick: number; hash: string }[] = [];
  for (let t = 0; t <= run.ticks; t++) {
    if (run.hashes.some((h) => h.tick === t))
      out.push({ tick: t, hash: toolsHash(canonicalJson(game.snapshot())) });
    if (t === run.ticks) break;
    for (const { tick, ...o } of run.orders) if (tick === t) game.order(o as unknown as JsonObject);
    game.step(NO_INPUT);
  }
  return out;
}

/** A pointer that hands over a script of gestures, one step's worth at a time. */
class ScriptedPointer {
  next: PointerGesture[] = [];
  private now: PointerGesture[] = [];
  hover: { x: number; y: number } | null = null;
  gestures(): readonly PointerGesture[] {
    this.now = this.next;
    this.next = [];
    return this.now;
  }
  cursor() {
    return this.hover;
  }
}

function newPlay(pointer: ScriptedPointer, stepsPerTick = 1) {
  const presenter = new NullPresenter();
  const play = new SkirmishPlay({
    content,
    seed: 9,
    pointer,
    picture: (_r, ui) => skirmishPicture(presenter, content.manifest.screen, ui),
    stepsPerTick,
  });
  return { play, presenter };
}

/** The picture point of the centre of cell (x, y). */
function at(play: SkirmishPlay, x: number, y: number) {
  return play.camera.worldToScreen((x + 0.5) * RTS_TILE_SIZE, (y + 0.5) * RTS_TILE_SIZE);
}

function tap(
  play: SkirmishPlay,
  x: number,
  y: number,
  button: 'primary' | 'secondary' = 'primary',
): PointerGesture {
  return { type: 'tap', button, kind: 'mouse', ...at(play, x, y) };
}

function box(play: SkirmishPlay, x0: number, y0: number, x1: number, y1: number): PointerGesture {
  const a = play.camera.worldToScreen(x0 * RTS_TILE_SIZE + 2, y0 * RTS_TILE_SIZE + 2);
  const b = play.camera.worldToScreen((x1 + 1) * RTS_TILE_SIZE - 2, (y1 + 1) * RTS_TILE_SIZE - 2);
  return { type: 'box', phase: 'end', x0: a.x, y0: a.y, x1: b.x, y1: b.y, kind: 'mouse' };
}

describe('rts-classic: the recorder', () => {
  it('hashes the snapshot as `run` does', async () => {
    const snapshot = createGame(content, 9).snapshot();
    expect(stateHash(snapshot)).toBe(toolsHash(canonicalJson(snapshot)));
  });

  it("gives battle.run.json's hashes for its orders, and a run file of them", async () => {
    const run = JSON.parse(
      readFileSync(new URL('./runs/battle.run.json', import.meta.url), 'utf8'),
    ) as RecordedRun;
    const game = createGame(content, 9);
    const recorder = new BattleRecorder(9);
    recorder.reached(0, () => game.snapshot());
    for (let t = 0; t < run.ticks; t++) {
      for (const { tick, ...o } of run.orders) if (tick === t) game.order(o as unknown as JsonObject);
      game.step(NO_INPUT);
      recorder.reached(game.rts.tick, () => game.snapshot());
    }
    const out = await recorder.runFile(game.rts.recorded());
    expect(out?.hashes).toEqual(run.hashes);
    expect(out?.orders).toEqual(run.orders);
    expect(out).toMatchObject({ game: '..', seed: 9, ticks: 240, hashEvery: 20 });
  });

  it('has nothing to export before tick 20, and leaves out orders of the last tick', async () => {
    const game = createGame(content, 9);
    const recorder = new BattleRecorder(9);
    recorder.reached(0, () => game.snapshot());
    expect(await recorder.runFile([])).toBeNull();
    for (let t = 1; t <= 20; t++) {
      game.step(NO_INPUT);
      recorder.reached(t, () => game.snapshot());
    }
    game.rts.issue({ faction: 'red', type: 'stop', units: [7] });
    const out = await recorder.runFile(game.rts.recorded());
    expect(out?.ticks).toBe(20);
    expect(out?.orders).toEqual([]);
    expect(out?.hashes.map((h) => h.tick)).toEqual([0, 20]);
  });
});

describe('rts-classic: SkirmishPlay (the page without the DOM)', () => {
  it(`plays ${TICKS_PER_SECOND} ticks a second at 60 steps`, () => {
    const { play } = newPlay(new ScriptedPointer(), STEPS_PER_TICK);
    for (let i = 0; i < 60; i++) play.update(NO_INPUT);
    expect(play.tick).toBe(TICKS_PER_SECOND);
  });

  it('starts with the camera on the player’s base and draws through the picture', () => {
    const { play, presenter } = newPlay(new ScriptedPointer());
    expect(play.camera.topLeft()).toEqual({ x: 0, y: 48 });
    play.render(new NullRenderer());
    expect(presenter.frames).toBe(1);
    expect(presenter.last?.camera).toMatchObject({ zoom: 1 });
  });

  it('builds, trains and attacks from gestures and buttons, and the export replays to its hashes', async () => {
    const pointer = new ScriptedPointer();
    const { play, presenter } = newPlay(pointer);
    const step = (gestures: PointerGesture[] = []) => {
      pointer.next = gestures;
      play.update(NO_INPUT);
    };
    // Tick 0: box workers 7 and 8 (cells 7,9 and 7,10), place a barracks at 10,9.
    step([box(play, 7, 9, 7, 10)]);
    expect(play.controls.selection.ids()).toEqual([7, 8]);
    expect(play.buttons().build).toEqual(['town-centre', 'barracks']);
    play.press({ kind: 'build', building: 'barracks' });
    pointer.hover = at(play, 10, 9);
    step();
    expect(play.buttons().placing).toBe('barracks');
    play.render(new NullRenderer());
    expect(presenter.last?.entities.some((e) => e.id === 'placing')).toBe(true);
    // Worker 9 gathers at the southern gold (8,15) with a right click.
    step([tap(play, 10, 9), tap(play, 7, 12)]);
    expect(play.buttons().placing).toBeNull();
    step([tap(play, 8, 15, 'secondary')]);
    while (play.sides().red?.buildings['barracks'] !== 1) step();
    // The barracks (16) trains three soldiers.
    step([tap(play, 10, 9)]);
    expect(play.buttons().train).toEqual(['soldier']);
    for (let i = 0; i < 3; i++) play.press({ kind: 'train', unit: 'soldier' });
    step();
    while ((play.sides().red?.unitTypes['soldier'] ?? 0) < 3) step();
    // Soldiers and the hero attack blue's nearest soldier.
    const soldiers = play.view().units.filter((u) => u.faction === 'red' && u.type === 'soldier');
    play.controls.selection.set(soldiers.map((u) => u.id));
    play.press({ kind: 'heroes' });
    step();
    expect(play.controls.selection.ids()).toEqual([15]);
    play.controls.selection.set([...soldiers.map((u) => u.id), 15]);
    const enemy = play.view().units.find((u) => u.faction === 'blue')!;
    step([tap(play, enemy.x, enemy.y, 'secondary')]);
    expect(play.result()).toBeNull();
    while (play.tick < 300 && (play.sides().blue?.units ?? 0) > 0) step();
    expect(play.sides().blue?.units).toBe(0);
    // The end (Engine 0.15 T14): won, and the frame carries the banner's status.
    expect(play.result()).toBe('won');
    play.render(new NullRenderer());
    expect(presenter.last?.status['won']).toBe(true);
    while (play.tick % 20 !== 0) step();

    const run = await play.exportRun();
    expect(run).not.toBeNull();
    const types = run!.orders.map((o) => o.type);
    expect(types).toEqual(['build', 'gather', 'train', 'train', 'train', 'attack']);
    expect(await replay(run!)).toEqual(run!.hashes);
    expect(run!.hashes.at(-1)?.tick).toBe(play.tick);
  });
});
