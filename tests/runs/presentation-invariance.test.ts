import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanvasRenderer } from '@engine/backends/canvas2d';
import { threeScenePresenter, TransitionLayer } from '@engine/backends/three';
import { contentPixelSheets } from '@engine/core/assets/content-sheets';
import { contentFonts } from '@engine/core/ui';
import type { ContentBundle } from '@engine/core/content/bundle';
import { transitionShape } from '@engine/core/fx';
import { skinSchema, skinSet, SKIN_KIND, type SkinFile } from '@engine/core/present';
import { ShellTransitions } from '@engine/core/shell/transitions';
import { Mixer, type MixerAudio } from '@engine/core/audio/mixer';
import { playRun, stateHash, type TickHash } from '../../engine/tools/headless-run';
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

/** One 'effects on' switch: rewrites one skin so it uses that effect everywhere it can. */
type EffectSwitch = (skin: SkinFile) => SkinFile;

/**
 * The effects switches, by name. Each must leave a skin that still validates (checked below) and
 * may only add presentation: no change to the content a game's rules read.
 */
const EFFECTS: Readonly<Record<string, EffectSwitch>> = {
  /** Tweens (T1): a pop-in on every kind and a squash, slide and hit flash on every event. */
  tweens: (skin) => ({
    ...skin,
    kinds: Object.fromEntries(
      Object.entries(skin.kinds).map(([kind, entry]) => [
        kind,
        {
          ...entry,
          spawnTween: [
            { prop: 'scale', from: 0.5, to: 1, frames: 8, ease: 'backOut' },
            { prop: 'rotate', from: 30, to: 0, frames: 6, ease: 'elasticOut' },
            { prop: 'alpha', from: 0.25, to: 1, frames: 5, delay: 1 },
          ],
        },
      ]),
    ),
    events: Object.fromEntries(
      Object.entries(skin.events ?? {}).map(([type, entry]) => [
        type,
        {
          ...entry,
          tween: [
            { prop: 'y', from: -6, to: 0, frames: 8, ease: 'bounceOut' },
            { prop: 'scaleX', from: 1.5, to: 1, frames: 4, yoyo: true, repeat: 1, ease: 'quadInOut' },
            { prop: 'color', from: '#ffffff', to: '#d82800', frames: 6, amount: 0.6, ease: 'sineOut' },
          ],
        },
      ]),
    ),
  }),
  /**
   * Sprite animation (T2): every 2D cycle timed per frame with a frame event on its first and
   * last frame, every 3D kind a two-pose `idle` cycle (every state falls back to it) with a frame
   * event, and the frame event's particles in the skin's `events`.
   */
  animation: (skin) => {
    const timed = (c: Record<string, unknown>) => {
      const n = (c['frames'] as unknown[]).length;
      return {
        ...c,
        ticks: Array.from({ length: n }, (_, i) => 2 + (i % 3)),
        events: { 0: 'fx-frame', [n - 1]: 'fx-frame' },
      };
    };
    const table = (frames: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(frames).map(([state, spec]) => {
          if (typeof spec !== 'object' || spec === null) return [state, spec];
          const s = spec as Record<string, unknown>;
          if (s['frames'] !== undefined) return [state, timed(s)];
          return [
            state,
            Object.fromEntries(
              Object.entries(s).map(([f, v]) => [
                f,
                typeof v === 'object' && v !== null ? timed(v as Record<string, unknown>) : v,
              ]),
            ),
          ];
        }),
      );
    const mesh3d = skin.backend === 'three';
    return {
      ...skin,
      kinds: Object.fromEntries(
        Object.entries(skin.kinds).map(([kind, entry]) => {
          if (mesh3d && entry.mesh !== undefined) {
            const idle = { frames: [entry.mesh, entry.mesh], ticks: [3, 5], events: { 1: 'fx-frame' } };
            return [kind, { ...entry, poses: { idle } }];
          }
          if (entry.frames === undefined) return [kind, entry];
          return [kind, { ...entry, frames: table(entry.frames) }];
        }),
      ),
      events: { ...skin.events, 'fx-frame': { effect: { kind: 'particles', count: 2, ticks: 4 } } },
    } as SkinFile;
  },
  /**
   * Particles (T3): two emitters in every skin, a burst (additive, glowing) on every event and a
   * trail on every kind, plus `blend: add` and `glow` on every 2D kind, and an old `particles`
   * effect on every event that has no effect of its own.
   */
  particles: (skin) => {
    const mesh3d = skin.backend === 'three';
    return {
      ...skin,
      emitters: {
        ...skin.emitters,
        'fx-burst': {
          burst: 6,
          life: [4, 9],
          speed: [0.5, 2],
          angle: [180, 360],
          gravity: 0.1,
          drag: 0.05,
          shape: { circle: 2 },
          size: [2, 1],
          color: ['#fcfcfc', '#f8b800'],
          alpha: [1, 0],
          blend: 'add',
          ...(!mesh3d && { glow: 3 }),
          max: 12,
        },
        'fx-trail': { rate: 0.5, life: 6, speed: 0.3, angle: 270, anchor: 'feet', alpha: [0.6, 0], max: 4 },
      },
      kinds: Object.fromEntries(
        Object.entries(skin.kinds).map(([kind, entry]) => [
          kind,
          {
            ...entry,
            emit: 'fx-trail',
            ...(!mesh3d && { blend: 'add', glow: { color: '#f8b800', radius: 2 } }),
          },
        ]),
      ),
      events: Object.fromEntries(
        Object.entries(skin.events ?? {}).map(([type, entry]) => [
          type,
          {
            ...entry,
            emit: 'fx-burst',
            ...(entry.effect === undefined && { effect: { kind: 'particles', count: 3, ticks: 5 } }),
          },
        ]),
      ),
    } as SkinFile;
  },
  /**
   * Camera effects and parallax (T4): a shake, a zoom punch, a flash and a hit-pause on every
   * event, look-ahead on the camera, and a parallax sky (a gradient, and on a 2D skin a tile
   * frame repeated) behind the map.
   */
  camera: (skin) => {
    const tile = Object.values(skin.tiles ?? {}).find((t) => t.frame !== undefined && t.sheet === undefined);
    const frameLayer =
      skin.backend !== 'three' && tile?.frame !== undefined && skin.sheets?.sheet !== undefined
        ? [{ frame: tile.frame, factor: { x: 0.5, y: 0.25 }, y: 40, repeat: 'xy' as const }]
        : [];
    return {
      ...skin,
      camera: { ...skin.camera, lookAhead: { x: 16, y: 8, lerp: 0.2 } },
      parallax: [
        ...(skin.parallax ?? []),
        { gradient: ['#203060', '#a4e4fc'], bands: 4, factor: 0, height: 60 },
        ...frameLayer,
      ],
      events: Object.fromEntries(
        Object.entries(skin.events ?? {}).map(([type, entry]) => [
          type,
          {
            ...entry,
            shake: { amount: 4, ticks: 10 },
            zoom: { to: 1.5, ticks: 3, ease: 'backOut', hold: 2, back: 4 },
            flash: { color: '#fcfcfc', alpha: 0.5, ticks: 3 },
            hitPause: { ticks: 3 },
          },
        ]),
      ),
    } as SkinFile;
  },
  /**
   * The audio mixer (T8): every event sound varies in pitch and volume, rests and ducks the music,
   * and the skin has a layered song mixed from a status value.
   */
  /**
   * The 3D scene look (T12): on a 3D skin, a sun with soft shadows, ambient and hemisphere
   * light, linear fog and ACES tone mapping; every kind and tile casting and receiving shadows,
   * every kind carrying a flickering point light and two world-anchored health bars (from the
   * status and from an `hp:` tag). A 2D skin is left as it is (these are 3D fields).
   */
  lighting: (skin) => {
    if (skin.backend !== 'three') return skin;
    return {
      ...skin,
      scene3d: {
        sun: { intensity: 1.4, direction: { x: -1, y: 2, z: 1 }, shadow: { mapSize: 256, radius: 2 } },
        ambient: { color: '#b8c8ff', intensity: 0.3 },
        hemisphere: { sky: '#a4e4fc', ground: '#503000', intensity: 0.5 },
        fog: { kind: 'linear', color: '#a4e4fc', near: 0, far: 600 },
        toneMapping: { kind: 'aces', exposure: 1.2 },
      },
      kinds: Object.fromEntries(
        Object.entries(skin.kinds).map(([kind, entry]) => [
          kind,
          {
            ...entry,
            castShadow: true,
            receiveShadow: true,
            light: { kind: 'point', color: '#ffa040', intensity: 20, distance: 64, flicker: 0.5 },
          },
        ]),
      ),
      tiles: Object.fromEntries(
        Object.entries(skin.tiles ?? {}).map(([key, entry]) => [
          key,
          { ...entry, castShadow: true, receiveShadow: true },
        ]),
      ),
      labels: Object.fromEntries(
        Object.keys(skin.kinds).map((kind) => [
          kind,
          [
            { from: { status: 'hp' }, as: 'bar', max: 'maxHp', back: '#000000' },
            { from: { tag: 'hp:' }, as: 'bar', max: 'maxHp', anchor: 'bottom' },
          ],
        ]),
      ),
    } as SkinFile;
  },
  audio: (skin) => ({
    ...skin,
    music: {
      ...skin.music,
      'fx-mix': {
        layers: { calm: 'calm', danger: 'danger' },
        mix: [
          { when: { status: 'hp', lt: 2 }, layers: { danger: 1, calm: 0.2 }, fade: 6 },
          { layers: { danger: 0, calm: 1 } },
        ],
      },
    },
    events: Object.fromEntries(
      Object.entries(skin.events ?? {}).map(([type, entry]) => [
        type,
        {
          ...entry,
          pitch: [-3, 3],
          volume: [0.5, 1],
          cooldown: 2,
          duck: { amount: 0.5, attack: 2, hold: 3, release: 6 },
        },
      ]),
    ),
  }),
};

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

/** The switch sets each run is played with: none (the baseline) and all of them at once. */
const SWITCH_SETS: readonly (readonly string[])[] = [[], Object.keys(EFFECTS)];

/** `content` with every skin rewritten by `switches` (the content's other files untouched). */
function withEffects(content: ContentBundle, switches: readonly string[]): ContentBundle {
  if (switches.length === 0) return content;
  return {
    ...content,
    entries: content.entries.map((e) => {
      if (e.kind !== SKIN_KIND.name) return e;
      let skin = structuredClone(e.value as SkinFile);
      for (const name of switches) skin = EFFECTS[name]!(skin);
      return { ...e, value: skin };
    }),
  };
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
      'games/platformer-lab',
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
