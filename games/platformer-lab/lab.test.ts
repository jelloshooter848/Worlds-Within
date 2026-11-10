import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullRenderer } from '@engine/backends/null';
import { contentOf } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { canonicalJson } from '@engine/core/headless';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { presentFrameSchema } from '@engine/core/present';
import { validate } from '@engine/core/content/validate';
import {
  ACTOR_ANIMS,
  LEVEL_PAUSE,
  PRESENT_TILES,
  presentStatus,
  profileKind,
  RUNNER_ANIMS,
} from '@kits/platformer';
import { FIRST_LEVEL, labSkin, labSkin3d, labStages, loadLab, mustLoad } from './content';
import { createGame, type LabSnapshot } from './headless';
import { STOP_BAR } from './minigame';
import { threeScenePresenter } from '@engine/backends/three';
import { labCanvasPicture, labLook, labPicture } from './picture';
import { labLook3d } from './picture3d';
import { createView } from './view';
import { HostScene } from '@engine/core/shell/host-scene';
import { SceneStack } from '@engine/core/scene';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const FILES = readGameFiles(ROOT);
const content = mustLoad(loadLab(FILES));
const kitFixture = (name: string) =>
  readFileSync(new URL(`../../kits/platformer/__fixtures__/${name}`, import.meta.url), 'utf8');

/** Every `PlatformerEvent` type (`kits/platformer/world.ts`). */
const EVENT_TYPES = [
  'jump',
  'land',
  'bump',
  'block',
  'break',
  'coin',
  'spawn',
  'stomp',
  'kick',
  'defeat',
  'hurt',
  'died',
  'respawn',
  'cleared',
  'mini-game',
  'mini-game-end',
];

/** The null renderer, counting the sprites (and bitmap text) drawn from each sheet. */
function countingRenderer(): { r: Renderer; sprites: Map<string, number> } {
  const sprites = new Map<string, number>();
  const count = (sheet: SpriteSheet) => sprites.set(sheet.id, (sprites.get(sheet.id) ?? 0) + 1);
  const r: Renderer = Object.assign(new NullRenderer(), { sprite: count, text: count });
  return { r, sprites };
}

describe('platformer lab content', () => {
  it('keeps byte-identical copies of the kit fixture level and profile', () => {
    expect(FILES['content/levels/tiny.json']).toBe(kitFixture('tiny.json'));
    expect(FILES['content/levels/tiny.map.txt']).toBe(kitFixture('tiny.map.txt'));
    expect(FILES['content/profiles/runner.profile.json']).toBe(kitFixture('runner.profile.json'));
  });

  it('plays the levels in a new order when the campaign file changes (Engine 0.10, gap G2)', () => {
    const file = 'content/campaigns/main.campaign.json';
    const campaign = JSON.parse(FILES[file]!) as Record<string, unknown>;
    const reordered = { ...campaign, start: 'lab-4-walkers' };
    const stages = labStages(mustLoad(loadLab({ ...FILES, [file]: JSON.stringify(reordered) })));
    expect(stages.map((s) => s.level.id)).toEqual([
      'lab-4-walkers',
      'lab-5-trigger',
      FIRST_LEVEL,
      'lab-1-moves',
      'lab-2-objects',
      'lab-3-shells',
    ]);
  });

  it("plays its campaign file's order: the fixture level first, then its own levels", () => {
    expect(labStages(content).map((s) => s.level.id)).toEqual([
      FIRST_LEVEL,
      'lab-1-moves',
      'lab-2-objects',
      'lab-3-shells',
      'lab-4-walkers',
      'lab-5-trigger',
    ]);
  });

  it('reports a broken level field with the file and the field', () => {
    const header = JSON.parse(FILES['content/levels/lab-5-trigger.json']!) as Record<string, unknown>;
    header['scroll'] = 'sideways';
    const result = loadLab({ ...FILES, 'content/levels/lab-5-trigger.json': JSON.stringify(header) });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => [e.file, e.path])).toContainEqual([
      'games/platformer-lab/content/levels/lab-5-trigger.json',
      'scroll',
    ]);
  });
});

describe('platformer lab skin', () => {
  const skin = labSkin(content);
  const actorTypes = new Set(contentOf(content, profileKind()).flatMap((e) => Object.keys(e.value.actors)));

  it('maps every tile the kit presents', () => {
    expect(Object.keys(skin.tiles ?? {}).sort()).toEqual(Object.values(PRESENT_TILES).sort());
  });

  it('maps every kind and animation state the kit and the mini game present', () => {
    const states = (kind: string) => Object.keys(skin.kinds[kind]?.frames ?? {}).sort();
    expect(states('runner')).toEqual([...RUNNER_ANIMS].sort());
    for (const type of actorTypes) expect(states(type), type).toEqual([...ACTOR_ANIMS].sort());
    expect(states('coin')).toEqual(['idle', 'pop']);
    for (const kind of ['goal', 'trigger']) expect(states(kind)).toEqual(['idle']);
    expect(states('bump-block')).toEqual(['bump']);
    expect(states('bar-cell')).toEqual(['idle', 'zone']);
    expect(states('bar-marker')).toEqual(['fail', 'idle', 'pass', 'quit']);
  });

  it('maps every event, shows every HUD value it names, and follows the runner with deadzone and lerp', () => {
    expect(Object.keys(skin.events ?? {}).sort()).toEqual([...EVENT_TYPES].sort());
    const game = createGame(content, 1);
    const status = presentStatus(game.world);
    for (const item of skin.hud ?? [])
      if (item.status !== undefined) expect(status, item.status).toHaveProperty(item.status);
    expect(skin.camera).toMatchObject({ follow: 'runner', deadzone: { w: 32, h: 48 }, lerp: 0.25 });
  });

  it('draws the start of the fixture level with the placeholder sheets and the HUD font', () => {
    const { r, sprites } = countingRenderer();
    const view = createView(content, 1);
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    for (let i = 0; i < 30; i++) {
      input.next();
      view.step(input);
      view.render(r);
    }
    expect(sprites.get('lab-placeholders') ?? 0).toBeGreaterThan(30);
    expect(sprites.get('lab-font') ?? 0).toBeGreaterThan(0);
  });
});

describe('platformer lab 3D skin', () => {
  const skin = labSkin3d(content);
  const skin2d = labSkin(content);

  it('is a three skin with a block for every solid tile (open air is the sky)', () => {
    expect(skin.backend).toBe('three');
    const solid = Object.values(PRESENT_TILES).filter((t) => t !== PRESENT_TILES.empty);
    expect(Object.keys(skin.tiles ?? {}).sort()).toEqual(solid.sort());
    for (const t of solid) expect(skin.tiles?.[t]?.mesh, t).toBeDefined();
    // The one-way platform is a thin slab, not a whole block.
    const slab = skin.meshes?.[skin.tiles!['=']!.mesh!];
    expect(slab?.every((p) => p.size.h < 16)).toBe(true);
  });

  it('has a mesh for every kind the 2D skin draws, and the same framing', () => {
    expect(Object.keys(skin.kinds).sort()).toEqual(Object.keys(skin2d.kinds).sort());
    for (const [kind, entry] of Object.entries(skin.kinds)) expect(entry.mesh, kind).toBeDefined();
    expect(skin.camera).toEqual(skin2d.camera);
    expect(skin.camera3d).toMatchObject({ fov: expect.any(Number), tilt: expect.any(Number) });
    expect(skin.camera3d?.layerDepth).toBeGreaterThan(0);
  });
});

describe('the view frame hook', () => {
  it('gives the frames the pictures show, with the events since the last call, and changes nothing', () => {
    const view = createView(content, 1);
    const shadow = createGame(content, 1);
    const look3d = labLook3d(content);
    const presenter = threeScenePresenter(look3d.skin, look3d);
    const picture3d = labPicture(presenter, look3d.screen);
    const script = { steps: [{ frame: 0, hold: ['right', 'jump'] as Action[] }] };
    const input = new ScriptedInput(script);
    const shadowInput = new ScriptedInput(script);
    for (let tick = 0; tick <= 60; tick++) {
      if (tick > 0) {
        input.next();
        view.step(input);
        shadowInput.next();
        shadow.step(shadowInput);
      }
      // Every other tick: two steps' events in one frame.
      if (tick % 2 === 1) continue;
      const frame = view.frame!();
      expect(validate('frame', frame, presentFrameSchema).ok).toBe(true);
      expect(Object.isFrozen(frame)).toBe(true);
      expect(view.snapshot()).toEqual(shadow.snapshot());
      if (tick === 2) expect(frame.events.map((e) => e.type)).toEqual(['land']);
      // The same stream of frames as the pictures' (labFrames), shown here through the 3D one.
      const shown = picture3d.draw(shadow.world, []);
      expect(frame.entities).toEqual(shown.entities);
      expect(frame.map).toEqual(shown.map);
      expect(presenter.scene.entityIds()).toContain('runner');
    }
    presenter.scene.dispose();
  });
});

describe('the lab game', () => {
  /** Plays `ticks` steps of `input`, returning the snapshots (tick 0 first). */
  function play(ticks: number, input: ScriptedInput, off: string[] = []): LabSnapshot[] {
    const game = createGame(content, 1, { disabledRules: off });
    const out: LabSnapshot[] = [game.snapshot() as LabSnapshot];
    for (let i = 0; i < ticks; i++) {
      input.next();
      game.step(input);
      out.push(game.snapshot() as LabSnapshot);
    }
    return out;
  }
  const startToGoal = () => {
    const run = JSON.parse(
      readFileSync(new URL('./runs/start-to-goal.run.json', import.meta.url), 'utf8'),
    ) as { input: ConstructorParameters<typeof ScriptedInput>[0] };
    return new ScriptedInput(run.input);
  };

  it('starts the next level LEVEL_PAUSE ticks after a level is cleared', () => {
    const s = play(400, startToGoal());
    const cleared = s.findIndex((x) => x.outcome === 'cleared');
    expect(cleared).toBe(226);
    expect(s[cleared + LEVEL_PAUSE - 1]).toMatchObject({ stage: 0, pause: LEVEL_PAUSE - 1, level: 'tiny' });
    expect(s[cleared + LEVEL_PAUSE]).toMatchObject({
      stage: 1,
      pause: 0,
      level: 'lab-1-moves',
      outcome: 'playing',
    });
  });

  it('starts a failed level again', () => {
    // Walking right into the fixture level's gap with its one life fails it.
    const s = play(300, new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] }));
    const failed = s.findIndex((x) => x.outcome === 'failed');
    expect(failed).toBeGreaterThan(0);
    expect(s[failed + LEVEL_PAUSE]).toMatchObject({ stage: 0, pause: 0, level: 'tiny', outcome: 'playing' });
  });

  it('gives the same snapshots on two runs', () => {
    const run = () => play(400, startToGoal()).map((x) => canonicalJson(x));
    expect(run()).toEqual(run());
  });
});

describe('the stop-bar mini game', () => {
  const PARAMS = { cells: 8, zone: 2, every: 1, ticks: 30 };
  /** One round with `seed`, pressing the actions `press(snapshot)` gives before each tick. */
  function round(seed: number, press: (s: Record<string, unknown>) => Action[]) {
    const game = STOP_BAR.create({ params: PARAMS, attempt: 1 }, seed);
    const input = new ScriptedInput({ steps: [] });
    for (let i = 0; i < 40 && game.result() === null; i++) {
      input.setHeld(press(game.snapshot()));
      input.next();
      game.step(input);
    }
    return game;
  }
  const inZone = (s: Record<string, unknown>) =>
    (s['at'] as number) >= (s['zoneAt'] as number) && (s['at'] as number) < (s['zoneAt'] as number) + 2;

  it('passes on attack in the zone, fails outside it, quits on select and fails when time is up', () => {
    // A press is judged where the marker is before the tick moves it: where the snapshot shows it.
    for (const seed of [1, 5, 9])
      expect(round(seed, (s) => (inZone(s) ? ['attack'] : [])).result()).toBe('pass');
    expect(round(5, (s) => (!inZone(s) ? ['attack'] : [])).result()).toBe('fail');
    expect(round(5, () => ['select']).result()).toBe('quit');
    expect(round(5, () => []).result()).toBe('fail');
    expect(round(5, () => []).snapshot()['ticks']).toBe(PARAMS.ticks);
  });

  it('is the same round for the same seed, describes itself as a valid frame, and draws through the skin', () => {
    const a = STOP_BAR.create({ params: {}, attempt: 1 }, 7);
    const b = STOP_BAR.create({ params: {}, attempt: 1 }, 7);
    expect(a.snapshot()).toEqual(b.snapshot());
    const frame = a.present!();
    expect(validate('frame', frame, presentFrameSchema).ok).toBe(true);
    expect(frame.entities.filter((e) => e.kind === 'bar-cell')).toHaveLength(16);
    expect(frame.entities.filter((e) => e.anim.state === 'zone')).toHaveLength(3);
  });

  it('is drawn by the picture while a trigger runs it', () => {
    const { r } = countingRenderer();
    const picture = labCanvasPicture(r, labLook(content));
    const game = createGame(content, 1);
    // Skip to the trigger level with a fresh world on it.
    while (game.world.level.id !== 'lab-5-trigger') {
      game.world.outcome = 'cleared';
      for (let i = 0; i < LEVEL_PAUSE; i++) game.step(new ScriptedInput({ steps: [] }));
    }
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    for (let i = 0; i < 120 && !game.world.miniGame; i++) {
      input.next();
      game.step(input);
    }
    expect(game.world.miniGame?.def.id).toBe('stop-bar');
    const frame = picture.draw(game.world, game.events);
    expect(frame.entities.some((e) => e.kind === 'bar-marker')).toBe(true);
    expect(frame.status['miniGame']).toBe('stop-bar');
  });
});

describe('the page scene (main.ts)', () => {
  it('HostScene over the game itself draws through the drawer it is given, made once', () => {
    const scenes = new SceneStack();
    const drawn: number[] = [];
    const handed: Renderer[] = [];
    const scene = new HostScene({
      stack: scenes,
      game: createGame(content, content.manifest.start.seed),
      picture: (r) => {
        handed.push(r);
        return { draw: (world) => void drawn.push(world.frame) };
      },
    });
    scenes.push(scene);
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    const r = new NullRenderer();
    for (let i = 0; i < 3; i++) {
      input.next();
      scenes.update([input]);
      scenes.render(r);
    }
    expect(handed).toEqual([r]);
    expect(drawn).toEqual([1, 2, 3]);
  });
});
