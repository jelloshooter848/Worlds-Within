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
import { skinMinimap } from '@engine/core/ui';
import { RTS_TILE_SIZE } from '@kits/rts';
import { loadSkirmish, skirmishNames } from './content';
import { createGame } from './headless';
import { skirmishLook, skirmishPicture } from './picture';
import { SkirmishPlay, STEPS_PER_TICK, TICKS_PER_SECOND } from './play';
import { stateHash } from '@engine/core/state-hash';
import { BattleRecorder, type RecordedRun } from './recording';

// The page's side of the skirmish without a browser (Engine 0.9 T12): the recorder hashes as `run`
// does, and `SkirmishPlay` driven by scripted pointer gestures and buttons records orders whose
// run file replays headless to the same hashes. Engine 0.16 part D (D8): the picture is fogged,
// accepted orders show a marker and bark, a tap on the minimap moves the camera, and the match's
// stats are counted. The real page is played by tests/browser/rts-skirmish.test.ts.

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
    picture: (_r, opts) =>
      skirmishPicture(presenter, content.manifest.screen, { ...opts, names: skirmishNames(content) }),
    minimap: skinMinimap(skirmishLook(content).skin),
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

describe('the recorder', () => {
  it('hashes the snapshot as `run` does', async () => {
    const snapshot = createGame(content, 9).snapshot();
    expect(stateHash(snapshot)).toBe(toolsHash(canonicalJson(snapshot)));
  });

  it("gives fog.run.json's hashes for its interface actions, and a run file of their orders", async () => {
    const run = JSON.parse(readFileSync(new URL('./runs/fog.run.json', import.meta.url), 'utf8')) as {
      ticks: number;
      orders: ({ tick: number } & JsonObject)[];
      hashes: { tick: number; hash: string }[];
    };
    const game = createGame(content, 9);
    const recorder = new BattleRecorder(9);
    recorder.reached(0, () => game.snapshot());
    for (let t = 0; t < run.ticks; t++) {
      for (const { tick, ...o } of run.orders) if (tick === t) game.order(o);
      game.step(NO_INPUT);
      recorder.reached(game.rts.tick, () => game.snapshot());
    }
    const out = await recorder.runFile(game.rts.recorded());
    expect(out?.hashes).toEqual(run.hashes);
    expect(out?.orders.map((o) => [o.tick, o.type])).toEqual([
      [0, 'move'],
      [420, 'move'],
      [430, 'attack'],
    ]);
    expect(out).toMatchObject({ game: '..', seed: 9, ticks: 480, hashEvery: 20 });
    // D9: the game's own `recorded()` keeps the interface actions in their place, so a run that
    // came in through `ui` entries exports as itself (its `ui.selection` hashes the same).
    expect(game.recorded()).toEqual(run.orders);
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
    game.rts.issue({ faction: 'red', type: 'stop', units: [11] });
    const out = await recorder.runFile(game.rts.recorded());
    expect(out?.ticks).toBe(20);
    expect(out?.orders).toEqual([]);
    expect(out?.hashes.map((h) => h.tick)).toEqual([0, 20]);
  });
});

describe('SkirmishPlay (the page without the DOM)', () => {
  it(`plays ${TICKS_PER_SECOND} ticks a second at 60 steps`, () => {
    const { play } = newPlay(new ScriptedPointer(), STEPS_PER_TICK);
    for (let i = 0; i < 60; i++) play.update(NO_INPUT);
    expect(play.tick).toBe(TICKS_PER_SECOND);
  });

  it('starts with the camera on the player’s base and draws through the picture', () => {
    const { play, presenter } = newPlay(new ScriptedPointer());
    // The town centre (4,18, 3x3) centred, held at the map's west edge.
    expect(play.camera.topLeft()).toEqual({ x: 0, y: 177 });
    play.render(new NullRenderer());
    expect(presenter.frames).toBe(1);
    expect(presenter.last?.camera).toMatchObject({ zoom: 1 });
  });

  it('draws the player’s picture through fog of war', () => {
    const { play, presenter } = newPlay(new ScriptedPointer());
    play.render(new NullRenderer());
    const fog = presenter.last?.fog;
    expect(fog?.cols).toBe(64);
    expect(fog?.rows).toBe(40);
    // Red's base is seen, blue's town centre (57,19) is not, nor drawn.
    expect(fog?.cells[19]![5]).toBe('2');
    expect(fog?.cells[20]![58]).toBe('0');
    expect(presenter.last?.entities.some((e) => e.kind.startsWith('building:town-centre:enemy'))).toBe(false);
  });

  it('moves the camera to a tap on the minimap, and gives no order for it', () => {
    const pointer = new ScriptedPointer();
    const { play } = newPlay(pointer);
    const spec = skinMinimap(skirmishLook(content).skin)!;
    const scale = spec.scale!;
    // Blue's town centre (57,19, 3x3) on the minimap.
    const tapAt = { x: spec.box.x + 58.5 * scale, y: spec.box.y + 20.5 * scale };
    pointer.next = [{ type: 'tap', button: 'primary', kind: 'touch', ...tapAt }];
    play.update(NO_INPUT);
    expect(play.camera.centre()).toEqual({ x: 1024 - 240, y: 20.5 * RTS_TILE_SIZE });
    expect(play.minimapPoint(spec.box.x - 1, spec.box.y)).toBeNull();
    // A drag from the minimap follows the pointer; a right tap there is still a command.
    pointer.next = [
      {
        type: 'box',
        phase: 'move',
        kind: 'mouse',
        x0: tapAt.x,
        y0: tapAt.y,
        x1: spec.box.x + 4,
        y1: spec.box.y + 4,
      },
    ];
    play.update(NO_INPUT);
    expect(play.camera.centre().x).toBe(240);
    expect(play.controls.selection.ids()).toEqual([]);
    expect(play.game.rts.recorded()).toEqual([]);
  });

  it('builds, trains and moves from gestures and buttons, with markers, barks and stats, and the export replays', async () => {
    const pointer = new ScriptedPointer();
    const { play, presenter } = newPlay(pointer);
    const step = (gestures: PointerGesture[] = []) => {
      pointer.next = gestures;
      play.update(NO_INPUT);
    };
    // Tick 0: box workers 11-13 (cells 8,16; 9,21; 8,22), place a barracks at 11,17.
    step([box(play, 8, 16, 9, 22)]);
    expect(play.controls.selection.ids()).toEqual([11, 12, 13]);
    expect(play.buttons().build).toEqual(['town-centre', 'barracks']);
    play.press({ kind: 'build', building: 'barracks' });
    pointer.hover = at(play, 11, 17);
    step();
    expect(play.buttons().placing).toBe('barracks');
    play.render(new NullRenderer());
    expect(presenter.last?.entities.some((e) => e.id === 'placing')).toBe(true);
    step([tap(play, 11, 17)]);
    expect(play.buttons().placing).toBeNull();
    // The accepted build shows its marker and barks (a worker's voice, the HUD's line).
    play.render(new NullRenderer());
    expect(presenter.last?.entities.some((e) => e.kind === 'order-marker' && e.anim.state === 'build')).toBe(
      true,
    );
    expect(presenter.last?.events.some((e) => e.type === 'bark' && e['unitType'] === 'worker')).toBe(true);
    expect(presenter.last?.status['bark']).toBe('build');
    // Worker 13 gathers at the southern gold (10,25) with a right click.
    play.controls.selection.set([13]);
    step([tap(play, 10, 25, 'secondary')]);
    while (play.sides().red?.buildings['barracks'] !== 1) step();
    // The barracks trains a soldier; its progress shows under it.
    const barracks = play.view().buildings.find((b) => b.faction === 'red' && b.kind === 'barracks')!;
    step([tap(play, barracks.x, barracks.y)]);
    expect(play.buttons().train).toEqual(['soldier', 'archer']);
    play.press({ kind: 'train', unit: 'soldier' });
    step();
    play.render(new NullRenderer());
    expect(presenter.last?.entities.some((e) => e.id === `building-${barracks.id}/train`)).toBe(true);
    while ((play.sides().red?.unitTypes['soldier'] ?? 0) < 1) step();
    // The hero walks to the centre ford.
    play.press({ kind: 'heroes' });
    step();
    expect(play.controls.selection.ids()).toEqual([19]);
    step([tap(play, 20, 19, 'secondary')]);
    play.render(new NullRenderer());
    expect(presenter.last?.status['bark']).toBe('move');
    expect(presenter.last?.entities.some((e) => e.kind === 'path-dot')).toBe(true);
    expect(play.result()).toBeNull();
    expect(play.stats()).toMatchObject({ trained: 1, built: 1, lost: 0 });
    expect(play.stats().gold).toBeGreaterThan(0);
    while (play.tick % 20 !== 0) step();

    const run = await play.exportRun();
    expect(run).not.toBeNull();
    const types = run!.orders.map((o) => o.type);
    expect(types).toEqual(['build', 'gather', 'train', 'move']);
    expect(await replay(run!)).toEqual(run!.hashes);
    expect(run!.hashes.at(-1)?.tick).toBe(play.tick);
  });
});
