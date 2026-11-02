import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullPresenter } from '@engine/backends/null';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { freezeFrame, isFullMap } from '@engine/core/present';
import {
  PlatformerPresentState,
  PRESENT_TILES,
  presentWorld as presentPlatformer,
  type PlatformerEvent,
  type PlatformerWorld,
} from '@kits/platformer';
import { presentWorld, snapshotWorld, TdPresentState, type TopDownWorld } from '@kits/topdown';
import { loadGame } from '../../engine/tools/game-loader';
import { stateHash, type TickHash } from '../../engine/tools/headless-run';
import { readRunFile, type RunFile } from '../../engine/tools/run-file';
import { createWorld } from '../../games/demo/headless';
import { DemoPicture, demoLook } from '../../games/demo/picture';
import { createGame as createLab, type LabGame } from '../../games/platformer-lab/headless';
import { threeScenePresenter } from '@engine/backends/three';
import { labCanvasPicture, labLook, labPicture } from '../../games/platformer-lab/picture';
import { labLook3d } from '../../games/platformer-lab/picture3d';

// Backend parity (docs/ROADMAP.md, 0.4 "Done when"): the same demo run gives the same state hashes
// whichever backend presents it. From Engine 0.5 the platformer lab's runs are checked the same way
// (its `LabGame` through the kit's `presentWorld` and the lab's `labCanvasPicture`). Every run file is played twice, presenting every tick: once
// through the null backend's NullPresenter (frames checked against the schema and frozen), once
// through the Canvas2D backend's SkinnedCanvasPresenter (the demo's `DemoPicture` with its skin) onto
// a recording renderer. Both hash sequences must equal the run's committed golden file, which
// `tests/runs/run-files.test.ts` checks against `pnpm cli run` (no presenting at all).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEMO_RUNS = 'games/demo/runs';
const LAB_RUNS = 'games/platformer-lab/runs';

/** Every run file in `dir`, as repo paths. */
const runsIn = (dir: string) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.run.json'))
    .sort()
    .map((f) => `${dir}/${f}`);
const files = runsIn(DEMO_RUNS);
const labFiles = runsIn(LAB_RUNS);

/** A renderer that draws nothing and counts the calls made to it, by method. */
function recordingRenderer(): { r: Renderer; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const count = (name: string) => calls.set(name, (calls.get(name) ?? 0) + 1);
  const r: Renderer = {
    clear: () => count('clear'),
    rect: () => count('rect'),
    sprite: () => count('sprite'),
    text: () => count('text'),
    debugText: () => count('debugText'),
    line: () => count('line'),
    alpha: (_a, draw) => (count('alpha'), draw()),
    transform: (_x, _y, _turn, _sx, _sy, draw) => (count('transform'), draw(r)),
  };
  return { r, calls };
}

/** Called on every tick (tick 0 included) with the world and the events of its last step. */
type Present = (world: TopDownWorld, events: readonly object[], tick: number) => void;

/** Plays `run` as `pnpm cli run` does, presenting every tick, and returns the hashes it reports. */
function play(content: ContentBundle, run: RunFile, present: Present): TickHash[] {
  const world = createWorld(content, run.seed ?? content.manifest.start.seed, run.disableRules);
  const input = new ScriptedInput(run.input);
  // As the headless game (`topdownGame`): each step's events, the ones from building the world first.
  let events: object[] = world.events.splice(0);
  const hashes: TickHash[] = [];
  for (let tick = 0; tick <= run.ticks; tick++) {
    if (tick > 0) {
      input.next();
      world.update(input);
      events = world.events.splice(0);
    }
    present(world, events, tick);
    if (tick % run.hashEvery === 0 || tick === run.ticks)
      hashes.push({ tick, hash: stateHash(snapshotWorld(world, events)) });
  }
  return hashes;
}

/** Called on every tick (tick 0 included) with the lab's current world and its last step's events. */
type PresentLab = (world: PlatformerWorld, events: readonly PlatformerEvent[], tick: number) => void;

/** Plays a lab `run` as `pnpm cli run` does (its `LabGame`), presenting every tick. */
function playLab(content: ContentBundle, run: RunFile, present: PresentLab): TickHash[] {
  const game: LabGame = createLab(content, run.seed ?? content.manifest.start.seed, {
    disabledRules: run.disableRules,
  });
  const input = new ScriptedInput(run.input);
  const hashes: TickHash[] = [];
  for (let tick = 0; tick <= run.ticks; tick++) {
    if (tick > 0) {
      input.next();
      game.step(input);
    }
    present(game.world, game.events, tick);
    if (tick % run.hashEvery === 0 || tick === run.ticks)
      hashes.push({ tick, hash: stateHash(game.snapshot()) });
  }
  return hashes;
}

function load(file: string): { content: ContentBundle; run: RunFile; golden: TickHash[] } {
  const loaded = readRunFile(ROOT, file);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const game = loadGame(ROOT, loaded.value.gameDir);
  if (!game.content.ok) throw new Error(JSON.stringify(game.content.errors));
  const goldenFile = join(ROOT, file.replace(/\.run\.json$/, '.hashes.json'));
  const golden = (JSON.parse(readFileSync(goldenFile, 'utf8')) as { hashes: TickHash[] }).hashes;
  return { content: game.content.value, run: loaded.value.run, golden };
}

describe('backend parity: null and canvas2d give the same state hashes', () => {
  it('finds the demo runs', () => {
    expect(files).toContain('games/demo/runs/walk-east.run.json');
  });

  it.each(files)('%s', (file) => {
    const { content, run, golden } = load(file);
    const size = content.manifest.screen;

    const nullPresenter = new NullPresenter({ validate: true, freeze: true });
    const nullState = new TdPresentState();
    const viaNull = play(content, run, (world, events) =>
      nullPresenter.present(freezeFrame(presentWorld(world, events, { state: nullState, size }))),
    );

    const { r, calls } = recordingRenderer();
    const picture = new DemoPicture(r, demoLook(content));
    const drawnPerTick: number[] = [];
    const viaCanvas = play(content, run, (world, events) => {
      const before = calls.get('clear') ?? 0;
      picture.draw(world, events);
      drawnPerTick.push((calls.get('clear') ?? 0) - before);
    });

    expect(nullPresenter.frames).toBe(run.ticks + 1);
    // Every tick was really drawn: cleared once, with tiles and sprites on top.
    expect(drawnPerTick).toEqual(Array.from({ length: run.ticks + 1 }, () => 1));
    expect(calls.get('sprite') ?? 0).toBeGreaterThan(run.ticks);
    expect(viaNull).toEqual(golden);
    expect(viaCanvas).toEqual(golden);
    expect(viaCanvas).toEqual(viaNull);
  });
});

describe('backend parity: the platformer lab through null, canvas2d and three', () => {
  /** Every entity kind and map tile shown in the 3D pass, over all the lab runs. */
  const seenKinds = new Set<string>();
  const seenTiles = new Set<string>();

  it('finds the lab runs', () => {
    expect(labFiles).toContain('games/platformer-lab/runs/start-to-goal.run.json');
  });

  it.each(labFiles)('%s', (file) => {
    const { content, run, golden } = load(file);
    const size = content.manifest.screen;

    const nullPresenter = new NullPresenter({ validate: true, freeze: true });
    // One stream of frames per world, as the lab's `labFrames` keeps it (a new level starts afresh).
    let shown: { world: PlatformerWorld; state: PlatformerPresentState } | null = null;
    const viaNull = playLab(content, run, (world, events) => {
      if (shown?.world !== world) shown = { world, state: new PlatformerPresentState() };
      const frame = presentPlatformer(world, events, { state: shown.state, size });
      nullPresenter.present(freezeFrame(frame));
    });

    const { r, calls } = recordingRenderer();
    const picture = labCanvasPicture(r, labLook(content));
    const drawnPerTick: number[] = [];
    const viaCanvas = playLab(content, run, (world, events) => {
      const before = calls.get('clear') ?? 0;
      picture.draw(world, events);
      drawnPerTick.push((calls.get('clear') ?? 0) - before);
    });

    const look3d = labLook3d(content);
    const presenter3d = threeScenePresenter(look3d.skin, look3d);
    const picture3d = labPicture(presenter3d, look3d.screen);
    const fallbacks: string[] = [];
    let synced = 0;
    const viaThree = playLab(content, run, (world, events, tick) => {
      const frame = picture3d.draw(world, events);
      synced++;
      for (const e of frame.entities) seenKinds.add(e.kind);
      if (frame.map && isFullMap(frame.map))
        for (const row of frame.map.tiles) for (const t of row) seenTiles.add(String(t));
      for (const id of presenter3d.scene.entityIds()) {
        const root = presenter3d.scene.entity(id)!;
        if (root.userData['fallback'] === true)
          fallbacks.push(`tick ${tick}: ${id} (${String(root.userData['kind'])})`);
      }
    });
    presenter3d.scene.dispose();

    expect(nullPresenter.frames).toBe(run.ticks + 1);
    expect(drawnPerTick).toEqual(Array.from({ length: run.ticks + 1 }, () => 1));
    expect(calls.get('sprite') ?? 0).toBeGreaterThan(run.ticks);
    expect(synced).toBe(run.ticks + 1);
    expect(fallbacks.slice(0, 5)).toEqual([]);
    expect(viaNull).toEqual(golden);
    expect(viaCanvas).toEqual(golden);
    expect(viaThree).toEqual(golden);
  });

  it('the three skin has a mesh for every kind and a block for every tile the lab runs show', () => {
    const { content } = load(labFiles[0]!);
    const skin = labLook3d(content).skin;
    // Every lab run has played by now (tests in a file run in order); the mini-game run shows the bar.
    expect(seenKinds).toContain('bar-marker');
    const noMesh = [...seenKinds].filter((k) => skin.kinds[k]?.mesh === undefined).sort();
    expect(noMesh, 'kinds without a three skin entry').toEqual([]);
    // Open air (`.`) is the sky: no block. Every other tile shown needs one.
    const solid = [...seenTiles].filter((t) => t !== PRESENT_TILES.empty);
    const noBlock = solid.filter((t) => skin.tiles?.[t]?.mesh === undefined).sort();
    expect(noBlock, 'tiles without a three skin entry').toEqual([]);
    expect(solid.length).toBeGreaterThan(3);
  });
});
