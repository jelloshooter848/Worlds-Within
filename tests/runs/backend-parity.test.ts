import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullPresenter } from '@engine/backends/null';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { freezeFrame, isFullMap, MINI_GAME_STATUS, skinSet } from '@engine/core/present';
import type { ViewEntry, ViewGame } from '@engine/core/view';
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
// whichever backend presents it. From Engine 0.7 every other game with a view is found by itself and
// checked through its view (`frame()` to the null backend, `render` to Canvas2D; the last block).
// From Engine 0.5 the platformer lab's runs are checked the same way
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

/**
 * Every other game with a view (`view` in `game.json`) and run files: checked through the view
 * contract alone (gap G6, fixed in Engine 0.7 T7), so a new game is picked up with no edit here.
 * The demo and the lab keep their own blocks below (the lab's also checks the 3D skin).
 */
const OWN_BLOCKS = new Set(['games/demo', 'games/platformer-lab']);
const viewGames = readdirSync(join(ROOT, 'games'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `games/${e.name}`)
  .filter((dir) => !OWN_BLOCKS.has(dir) && existsSync(join(ROOT, dir, 'game.json')))
  .filter(
    (dir) =>
      typeof (JSON.parse(readFileSync(join(ROOT, dir, 'game.json'), 'utf8')) as { view?: unknown }).view ===
      'string',
  )
  .filter((dir) => existsSync(join(ROOT, dir, 'runs')))
  .sort();
const viewRuns = viewGames.flatMap((dir) => runsIn(`${dir}/runs`));

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

/** Plays `run` through a game's view as `pnpm cli run` plays its headless game, calling `show` each tick. */
function playView(view: ViewGame, run: RunFile, show: (view: ViewGame) => void): TickHash[] {
  const input = new ScriptedInput(run.input);
  const hashes: TickHash[] = [];
  for (let tick = 0; tick <= run.ticks; tick++) {
    if (tick > 0) {
      input.next();
      view.step(input);
    }
    show(view);
    if (tick % run.hashEvery === 0 || tick === run.ticks)
      hashes.push({ tick, hash: stateHash(view.snapshot()) });
  }
  return hashes;
}

describe('backend parity: every other game with a view, through null, canvas2d and three', () => {
  it('finds the platformer test runs', () => {
    expect(viewRuns).toContain('games/platformer-test/runs/level-4.run.json');
  });

  it.each(viewRuns)('%s', async (file) => {
    const { content, run, golden } = load(file);
    const dir = file.slice(0, file.indexOf('/runs/'));
    const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'game.json'), 'utf8')) as { view: string };
    const entry = (await import(join(ROOT, dir, manifest.view))) as ViewEntry;
    const make = () =>
      entry.createView(content, run.seed ?? content.manifest.start.seed, { disabledRules: run.disableRules });

    const nullPresenter = new NullPresenter({ validate: true, freeze: true });
    const viaNull = playView(make(), run, (view) => nullPresenter.present(view.frame!()));

    const { r, calls } = recordingRenderer();
    const drawnPerTick: number[] = [];
    const viaCanvas = playView(make(), run, (view) => {
      const before = calls.get('clear') ?? 0;
      view.render(r);
      drawnPerTick.push((calls.get('clear') ?? 0) - before);
    });

    expect(nullPresenter.frames).toBe(run.ticks + 1);
    expect(drawnPerTick).toEqual(Array.from({ length: run.ticks + 1 }, () => 1));
    expect(calls.get('sprite') ?? 0).toBeGreaterThan(run.ticks);
    expect(viaNull).toEqual(golden);
    expect(viaCanvas).toEqual(golden);

    // 3D (Engine 0.7 T8), for a game with a `three` skin: `frame()` into the Three.js scene
    // builder (no WebGL), a mini game's frames into the scene of its `three-<id>` skin as on the
    // page (`skinSet`). No entity may be a fallback box (a kind without a mesh), and every map
    // tile shown needs a block in the skin that showed it, but open air (the platformer kit's
    // `.`, the sky) on the game's own skin.
    const skins3d = skinSet(content, 'three');
    if (skins3d.main === null) return;
    const background = make().background;
    const presenter3d = threeScenePresenter(skins3d.main, {
      screen: content.manifest.screen,
      rounds: skins3d.rounds,
      ...(background !== undefined && { background }),
    });
    const fallbacks: string[] = [];
    const noBlock = new Set<string>();
    const sources = new Set<string>();
    let synced = 0;
    const viaThree = playView(make(), run, (view) => {
      const frame = view.frame!();
      presenter3d.present(frame);
      synced++;
      const id = String(frame.status[MINI_GAME_STATUS] ?? '');
      const round = Object.hasOwn(skins3d.rounds, id);
      const skin = round ? skins3d.rounds[id]! : skins3d.main!;
      sources.add(round ? id : 'main');
      if (frame.map && isFullMap(frame.map))
        for (const row of frame.map.tiles)
          for (const t of row) {
            const tile = String(t);
            if (!round && tile === PRESENT_TILES.empty) continue;
            if (skin.tiles?.[tile]?.mesh === undefined) noBlock.add(`${round ? id : 'main'} ${tile}`);
          }
      const scene = presenter3d.shown;
      for (const eid of scene.entityIds()) {
        const root = scene.entity(eid)!;
        if (root.userData['fallback'] === true)
          fallbacks.push(`frame ${frame.frame}: ${eid} (${String(root.userData['kind'])})`);
      }
    });
    presenter3d.scene.dispose();
    for (const scene of Object.values(presenter3d.rounds)) scene.dispose();

    expect(synced).toBe(run.ticks + 1);
    expect(fallbacks.slice(0, 5), 'entities drawn as fallback boxes (kinds without a mesh)').toEqual([]);
    expect([...noBlock].sort(), 'tiles without a three skin entry').toEqual([]);
    if (file.endsWith('platformer-test/runs/level-4.run.json'))
      expect([...sources].sort()).toEqual(['main', 'vault']);
    expect(viaThree).toEqual(golden);
  });
});
