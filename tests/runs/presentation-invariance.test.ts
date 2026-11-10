import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanvasRenderer } from '@engine/backends/canvas2d';
import { threeScenePresenter } from '@engine/backends/three';
import { contentPixelSheets } from '@engine/core/assets/content-sheets';
import type { ContentBundle } from '@engine/core/content/bundle';
import { skinSchema, skinSet, SKIN_KIND, type SkinFile } from '@engine/core/present';
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
// of them on at once.

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
};

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
      if (switches.includes('tweens')) {
        // The tweens really ran: spawn tweens turn, scale and fade every kind's entities.
        expect(calls.get('rotate') ?? 0, `${label}: tweens turned something`).toBeGreaterThan(0);
        expect(calls.get('=globalAlpha') ?? 0, `${label}: tweens faded something`).toBeGreaterThan(0);
      }

      // Three.js, for a game with a `three` skin: `frame()` into the scene presenter.
      const skins3d = skinSet(shown, 'three');
      if (skins3d.main === null) continue;
      const view3d = make();
      const presenter3d = threeScenePresenter(skins3d.main, {
        screen,
        rounds: skins3d.rounds,
        sheets: contentPixelSheets(shown),
        ...(view3d.background !== undefined && { background: view3d.background }),
      });
      let last3d = '';
      const viaThree = playView(view3d, run, (view) => {
        presenter3d.present(view.frame!());
        last3d = stateHash(view.snapshot());
      });
      presenter3d.scene.dispose();
      for (const scene of Object.values(presenter3d.rounds)) scene.dispose();
      expect(viaThree, `${label}, three`).toEqual(golden);
      expect(last3d, `${label}, three: final state`).toBe(finalHash);
    }
  });
});
