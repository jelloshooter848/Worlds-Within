import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanvasRenderer } from '@engine/backends/canvas2d';
import { threeScenePresenter, TransitionLayer } from '@engine/backends/three';
import { contentPixelSheets } from '@engine/core/assets/content-sheets';
import { contentFonts } from '@engine/core/ui';
import { transitionShape } from '@engine/core/fx';
import { skinSchema, skinSet, SKIN_KIND } from '@engine/core/present';
import { ShellTransitions } from '@engine/core/shell/transitions';
import { Mixer, type MixerAudio } from '@engine/core/audio/mixer';
import { playRun, stateHash, type TickHash } from '../../engine/tools/headless-run';
import { EFFECTS, SWITCH_SETS, withEffects } from './effects';
import { loadRun, playView, viewMaker } from './view-play';

// Presentation never changes state (docs/ROADMAP.md, 0.16 part A, "Done when"): every game's run
// files (games/samples/* and games/platformer-lab), played with presenters fed every frame and the
// presentation effects switched on, give exactly the golden hashes and the final state hash of
// `pnpm cli run`, which presents nothing. Two presenters: the game's own Canvas2D picture
// (`view.render`, its SkinnedCanvasPresenter) through a real CanvasRenderer on a stub 2D context,
// and for a game with a `three` skin the Three.js scene presenter (`view.frame()`, no WebGL).
//
// The effects are switched on by rewriting the game's skins (`EFFECTS`), so every kind and event
// carries them, whatever the game's own skins use. Each later 0.16 part A task adds its switch
// here (sprite animation, particles, camera, transitions, ...); the invariance must hold with all
// of them on at once. Screen transitions (T5) are the shell's, not a skin's: with the effects on,
// the 3D presenter is wrapped in the shell's `ShellTransitions` (an iris on every level change, a
// fade on demand every 90 ticks), stepped once per tick, and each transition shape is synced into
// a `TransitionLayer`, as the page does; the held frames it shows must not change the state either.
// The audio mixer (T8) is the shell's too: with the effects on, the 3D presenter's sounds go to a
// `Mixer` over a recording sink (every event sound varied, cooled down and ducking, a layered song
// mixed from each frame's status, ticked once per tick); no run reads it, and the hashes hold.
// The 3D scene look (T12: lights, shadows, fog, tone mapping, point lights and world-anchored
// labels) is the `lighting` switch; the 3D presenter gets the game's fonts so labels draw.

vi.setConfig({ testTimeout: 120_000 });

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A mixer sink that only counts: what the page's `AudioManager` would be asked to do. */
function countingAudio() {
  const counts = { music: 0, sfx: 0, layers: 0, duck: 0 };
  const audio: MixerAudio = {
    playMusic: () => void counts.music++,
    sfx: () => void counts.sfx++,
    setLayerGains: () => void counts.layers++,
    setDuck: (factor) => {
      if (factor < 1) counts.duck++;
    },
    volumeLevels: { master: 1, music: 1, sfx: 1, muted: false },
  };
  return { audio, counts };
}

/**
 * A stub 2D context: every method is a no-op that counts its calls, every property keeps what
 * was set (`canvas` gives the picture size). A real CanvasRenderer draws onto it, so the canvas
 * path (transforms, alpha, clips) runs in Node.
 */
function stubContext(width: number, height: number) {
  const calls = new Map<string, number>();
  const props = new Map<PropertyKey, unknown>([['canvas', { width, height }]]);
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (props.has(key)) return props.get(key);
        if (typeof key !== 'string') return undefined;
        return (..._args: unknown[]) => void calls.set(key, (calls.get(key) ?? 0) + 1);
      },
      set: (_t, key, value) => {
        props.set(key, value);
        if (typeof key === 'string') calls.set(`=${key}`, (calls.get(`=${key}`) ?? 0) + 1);
        // Colours are counted by value too (`=fillStyle:#203060`).
        if (key === 'fillStyle' && typeof value === 'string')
          calls.set(`=${key}:${value}`, (calls.get(`=${key}:${value}`) ?? 0) + 1);
        return true;
      },
    },
  );
  return { ctx: ctx as CanvasRenderingContext2D, calls };
}

/** Game folders with run files: `games/<name>/` and `games/samples/<name>/`. */
function gameDirs(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${dir}/${e.name}`)
    .filter((d) => existsSync(join(ROOT, d, 'game.json')) && existsSync(join(ROOT, d, 'runs')));
}
const runFiles = [...gameDirs('games'), ...gameDirs('games/samples')].sort().flatMap((dir) =>
  readdirSync(join(ROOT, dir, 'runs'))
    .filter((f) => f.endsWith('.run.json'))
    .sort()
    .map((f) => `${dir}/runs/${f}`),
);

describe('presentation invariance: presenters and effects never change the state', () => {
  it('finds every game with run files, the samples and the lab', () => {
    for (const game of [
      'games/fx-lab',
      'games/platformer-classic',
      'games/platformer-lab',
      'games/rts-classic',
      'games/samples/dungeon',
      'games/samples/mini-siege',
      'games/samples/platformer',
      'games/samples/rts-skirmish',
      'games/samples/tower-defense',
    ])
      expect(
        runFiles.some((f) => f.startsWith(`${game}/runs/`)),
        game,
      ).toBe(true);
  });

  it('every effects switch leaves every skin valid', () => {
    const dirs = new Set(runFiles.map((f) => f.slice(0, f.indexOf('/runs/'))));
    for (const dir of dirs) {
      const { content } = loadRun(
        ROOT,
        runFiles.find((f) => f.startsWith(`${dir}/`))!,
      );
      const on = withEffects(content, Object.keys(EFFECTS));
      for (const e of on.entries.filter((x) => x.kind === SKIN_KIND.name)) {
        const parsed = skinSchema.safeParse(e.value);
        expect(parsed.success, `${dir} ${e.file}: ${parsed.error?.message ?? ''}`).toBe(true);
      }
    }
  });

  it.each(runFiles)('%s', async (file) => {
    const { content, run, golden } = loadRun(ROOT, file);
    // `pnpm cli run`: no presenter at all.
    const played = await playRun(ROOT, file);
    if (!played.ok) throw new Error(JSON.stringify(played.errors));
    expect(played.value.failures).toEqual([]);
    expect(played.value.hashes).toEqual(golden);
    const finalHash = stateHash(played.value.snapshot);

    for (const switches of SWITCH_SETS) {
      const label = switches.length === 0 ? 'effects off' : `effects on: ${switches.join(', ')}`;
      const shown = withEffects(content, switches);
      const make = await viewMaker(ROOT, file, shown, run);

      // Canvas2D: the game's own picture, a CanvasRenderer on the stub context.
      const screen = content.manifest.screen;
      const { ctx, calls } = stubContext(screen.width, screen.height);
      const renderer = new CanvasRenderer(ctx);
      let last = '';
      const viaCanvas: TickHash[] = playView(make(), run, (view) => {
        view.render(renderer);
        last = stateHash(view.snapshot());
      });
      expect(viaCanvas, `${label}, canvas2d`).toEqual(golden);
      expect(last, `${label}, canvas2d: final state`).toBe(finalHash);
      expect(calls.get('fillRect') ?? 0, `${label}: the canvas drew`).toBeGreaterThan(run.ticks);
      if (switches.includes('camera')) {
        // The parallax sky really drew: its top band behind every frame.
        expect(calls.get('=fillStyle:#203060') ?? 0, `${label}: parallax drew`).toBeGreaterThanOrEqual(
          run.ticks,
        );
      }
      if (switches.includes('tweens')) {
        // The tweens really ran: spawn tweens turn, scale and fade every kind's entities.
        expect(calls.get('rotate') ?? 0, `${label}: tweens turned something`).toBeGreaterThan(0);
        expect(calls.get('=globalAlpha') ?? 0, `${label}: tweens faded something`).toBeGreaterThan(0);
      }
      if (switches.includes('particles')) {
        // The particles really ran: additive blending and glow were set on the canvas.
        expect(
          calls.get('=globalCompositeOperation') ?? 0,
          `${label}: something drew additively`,
        ).toBeGreaterThan(0);
        expect(calls.get('=shadowBlur') ?? 0, `${label}: something glowed`).toBeGreaterThan(0);
      }

      // Three.js, for a game with a `three` skin: `frame()` into the scene presenter.
      const skins3d = skinSet(shown, 'three');
      if (skins3d.main === null) continue;
      const view3d = make();
      const mixed = countingAudio();
      const mixer = new Mixer({
        audio: mixed.audio,
        music: skins3d.main.music ?? {},
        ...(run.seed !== undefined && { seed: run.seed }),
      });
      if (switches.includes('audio')) mixer.play('fx-mix');
      const presenter3d = threeScenePresenter(skins3d.main, {
        screen,
        onSound: (id, cue) => mixer.sound(id, cue),
        rounds: skins3d.rounds,
        sheets: contentPixelSheets(shown),
        fonts: contentFonts(shown),
        ...(view3d.background !== undefined && { background: view3d.background }),
      });
      let last3d = '';
      let particles3d = 0;
      let labels3d = 0;
      let lights3d = 0;
      let parallax3d = 0;
      // Screen transitions with the effects on (T5): the shell's wrapper over the 3D presenter.
      const transitions = new ShellTransitions({
        specs: { level: { kind: 'iris', ticks: 20, hold: 4 }, default: { kind: 'fade', ticks: 12 } },
      });
      const layer = new TransitionLayer();
      let transitionFrames = 0;
      const shown3d =
        switches.length === 0
          ? presenter3d
          : transitions.presenter(presenter3d, (v) => {
              const shape = v && transitionShape(v, screen, presenter3d.scene.focus());
              layer.sync(shape, screen);
              if (shape) transitionFrames++;
            });
      let tick3d = 0;
      const viaThree = playView(view3d, run, (view) => {
        if (switches.length > 0) {
          transitions.step();
          if (++tick3d % 90 === 0) transitions.start();
        }
        mixer.tick();
        const frame = view.frame!();
        mixer.frameStatus(frame.status);
        shown3d.present(frame);
        last3d = stateHash(view.snapshot());
        particles3d = Math.max(particles3d, presenter3d.scene.particleViews().length);
        parallax3d = Math.max(parallax3d, presenter3d.scene.parallax.meshes().length);
        labels3d = Math.max(labels3d, presenter3d.scene.labelViews().length);
        lights3d = Math.max(lights3d, presenter3d.scene.pointLights().length);
      });
      if (switches.includes('lighting')) {
        expect(labels3d, `${label}, three: world-anchored labels were shown`).toBeGreaterThan(0);
        expect(lights3d, `${label}, three: point lights were shown`).toBeGreaterThan(0);
      }
      if (switches.includes('particles'))
        expect(particles3d, `${label}, three: particles were shown`).toBeGreaterThan(0);
      if (switches.includes('camera'))
        expect(parallax3d, `${label}, three: parallax planes were shown`).toBeGreaterThan(0);
      if (switches.includes('audio')) {
        expect(mixed.counts.layers, `${label}, three: the layered song was mixed`).toBeGreaterThan(run.ticks);
        if (mixed.counts.sfx > 0)
          expect(mixed.counts.duck, `${label}, three: a sound ducked the music`).toBeGreaterThan(0);
      }
      if (switches.length > 0 && run.ticks >= 90)
        expect(transitionFrames, `${label}, three: transitions were shown`).toBeGreaterThan(0);
      layer.dispose();
      presenter3d.scene.dispose();
      for (const scene of Object.values(presenter3d.rounds)) scene.dispose();
      expect(viaThree, `${label}, three`).toEqual(golden);
      expect(last3d, `${label}, three: final state`).toBe(finalHash);
    }
  });
});
