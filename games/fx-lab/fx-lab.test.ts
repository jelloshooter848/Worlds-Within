import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullRenderer } from '@engine/backends/null';
import { ThreeScene } from '@engine/backends/three';
import { canonicalJson } from '@engine/core/headless';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { resolveSkinAnimation, resolveSkinMesh, skinEmitNames } from '@engine/core/present';
import { RUNNER_ANIMS } from '@kits/platformer';
import { fxSkin, fxStages, mustLoadFxLab } from './content';
import { createGame } from './headless';
import { fxCanvasPicture, fxFrames, fxLook } from './picture';
import { fxLook3d } from './picture3d';

// The fx lab (Engine 0.16 T2): its content, the full animation set of Pip in both skins, and
// the frame events' sounds played through both presenters over its run files. The page's own
// sounds are checked in a browser by tests/browser/fx-lab.test.ts.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoadFxLab(readGameFiles(ROOT));

/** A run file's ticks, start and input. */
function runOf(name: string): { ticks: number; start?: { stage: number }; input: InputScript } {
  return JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as {
    ticks: number;
    input: InputScript;
  };
}

/** Plays a run through `draw`, each tick after the step; gives the sounds in order with their tick. */
function play(name: string, draw: (game: ReturnType<typeof createGame>, tick: number) => void): void {
  const run = runOf(name);
  const game = createGame(content, 1, run.start === undefined ? {} : { start: run.start });
  const input = new ScriptedInput(run.input);
  for (let t = 1; t <= run.ticks; t++) {
    input.next();
    game.step(input);
    draw(game, t);
  }
}

describe('fx lab content', () => {
  it('plays its three levels in campaign order', () => {
    expect(fxStages(content).map((s) => s.level.id)).toEqual(['fx-1', 'fx-2', 'fx-3']);
  });

  it('gives Pip a frame or cycle for every runner state, in 2D and in 3D', () => {
    const flat = fxSkin(content, 'canvas2d').kinds['runner']!;
    const solid = fxSkin(content, 'three').kinds['runner']!;
    for (const state of RUNNER_ANIMS) {
      expect(Object.keys(flat.frames ?? {}), state).toContain(state);
      expect(Object.keys(solid.poses ?? {}), state).toContain(state);
    }
  });

  it('times the idle settle as a one-shot that hands over to breathing, in both skins', () => {
    for (const backend of ['canvas2d', 'three'] as const) {
      const skin = fxSkin(content, backend);
      const at = (t: number) =>
        resolveSkinAnimation(skin, { kind: 'runner', facing: 'right', anim: { state: 'idle', t } });
      expect(at(0)?.state, backend).toBe('idle');
      expect(at(6)?.state, backend).toBe('breathe');
    }
    expect(
      resolveSkinMesh(fxSkin(content, 'three'), {
        kind: 'runner',
        facing: 'right',
        anim: { state: 'idle', t: 0 },
      }),
    ).toBe('pip-settle');
  });
});

describe('fx lab frame events', () => {
  it.each(['level-1', 'level-2'])(
    '%s: footsteps from the run cycles reach onSound in 2D, never the state',
    (name) => {
      const look = fxLook(content);
      const sounds: { tick: number; id: string }[] = [];
      let tick = 0;
      const r = new NullRenderer();
      let picture: ReturnType<typeof fxCanvasPicture> | null = null;
      play(name, (game, t) => {
        tick = t;
        picture ??= fxCanvasPicture(r, look, (id) => sounds.push({ tick, id }));
        const before = canonicalJson(game.snapshot());
        picture.draw(game.world, game.events);
        expect(canonicalJson(game.snapshot())).toBe(before);
      });
      const ids = sounds.map((s) => s.id);
      // Kit events (jump, stomp, cleared) and the skin's frame events (footsteps) both sound.
      expect(ids).toContain('jump');
      expect(ids).toContain('stomp');
      expect(ids).toContain('door');
      expect(ids.filter((id) => id === 'footstep').length).toBeGreaterThan(10);
      // Footsteps come on frames, not every tick: never two on one tick for the one runner.
      const steps = sounds.filter((s) => s.id === 'footstep').map((s) => s.tick);
      expect(new Set(steps).size).toBe(steps.length);
    },
  );

  it('the 3D scene plays the same frame events from its poses', () => {
    const look = fxLook3d(content);
    const sounds: string[] = [];
    const scene = new ThreeScene(look.skin, { size: look.screen, onSound: (id) => sounds.push(id) });
    const frames = fxFrames(look.screen);
    play('level-1', (game) => scene.sync(frames.next(game.world, game.events)));
    scene.dispose();
    expect(sounds).toContain('jump');
    expect(sounds.filter((id) => id === 'footstep').length).toBeGreaterThan(10);
  });
});

describe('fx lab particles (Engine 0.16 T3)', () => {
  const PRESETS = ['land-dust', 'run-dust', 'stomp-sparks', 'torch-smoke', 'coin-burst', 'magic-aura'];

  it('has the six preset emitters, started where the lab says, in both skins', () => {
    for (const backend of ['canvas2d', 'three'] as const) {
      const skin = fxSkin(content, backend);
      for (const name of PRESETS) expect(Object.keys(skin.emitters ?? {}), backend).toContain(name);
      expect(skinEmitNames(skin.events?.['land']?.emit)).toContain('land-dust');
      expect(skinEmitNames(skin.events?.['footstep']?.emit)).toContain('run-dust');
      expect(skinEmitNames(skin.events?.['stomp']?.emit)).toContain('stomp-sparks');
      expect(skinEmitNames(skin.events?.['coin']?.emit)).toContain('coin-burst');
      expect(skinEmitNames(skin.kinds['torch']?.emit)).toContain('torch-smoke');
      expect(skinEmitNames(skin.kinds['goal']?.emit)).toContain('magic-aura');
    }
  });

  it('level-3: the torches smoke and the door shimmers in the 3D scene, never touching the state', () => {
    const look = fxLook3d(content);
    const scene = new ThreeScene(look.skin, { size: look.screen });
    const frames = fxFrames(look.screen);
    const seen = new Set<string>();
    play('level-3', (game) => {
      const before = canonicalJson(game.snapshot());
      scene.sync(frames.next(game.world, game.events));
      for (const p of scene.particleViews()) seen.add(p.emitter);
      expect(canonicalJson(game.snapshot())).toBe(before);
    });
    scene.dispose();
    for (const name of ['torch-smoke', 'torch-flame', 'magic-aura', 'coin-burst', 'land-dust', 'run-dust'])
      expect([...seen]).toContain(name);
  });
});
