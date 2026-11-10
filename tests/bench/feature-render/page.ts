import { withContentImages } from '@engine/core/assets/content-images';
import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { rasterize } from '@engine/core/gfx/pixelart';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { SkinFile } from '@engine/core/present';
import { contentFonts, type FontLookup } from '@engine/core/ui';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d/presenter';
import { Viewport } from '@engine/backends/canvas2d/viewport';
import { featureGame, type FeatureGame } from './games';
import {
  BENCH_MAX_PARTICLES,
  FeatureScene,
  featureSkin,
  FX_PALETTE,
  FX_SHEET,
  fxSheet,
  SHOT_FRAMES,
  type FeatureCase,
  type FeatureMap,
  withoutFeatures,
} from './scene';

// The feature benchmark's page (Engine 0.16 T13), driven by `run.ts` through Playwright. Each case
// is drawn by the engine's own `SkinnedCanvasPresenter` on a `Viewport` (whole-number scale to the
// window), as a game's page draws, with the game's fonts and sheets plus the bench sheet.
// `window.featureBench.run` draws warm-up frames, then measures frames for `seconds`: per frame the time
// in the draw call (present plus the copy to the page) and the time since the previous animation
// frame (the frame-rate limit is off, so that is the whole frame: the scene's next frame, drawing
// and Chromium's raster and compositing). `window.featureBench.shot` draws `SHOT_FRAMES` frames at once
// (a blast just started, a zoom punch held) for a screenshot.

export interface GameText {
  files: Record<string, string>;
  run: string;
}

export interface FeatureRequest extends FeatureCase {
  warmup: number;
  seconds: number;
}

export interface FeatureTimes {
  draw: number[];
  interval: number[];
  /** Live particles, sampled every 10 measured frames and after the last. */
  particles: number[];
  /** Entities in the last frame. */
  entities: number;
}

export interface FeatureInfo {
  userAgent: string;
  webgl: string;
  window: { width: number; height: number; dpr: number };
  screens: Record<FeatureMap, ScreenSize>;
}

interface Loaded {
  game: FeatureGame;
  sheets: SheetLookup;
  fonts: FontLookup;
  featureSkin: SkinFile;
}

const games = new Map<FeatureMap, Loaded>();
let fx: ReturnType<typeof rasterize> | null = null;

async function load(map: FeatureMap, text: GameText): Promise<void> {
  const game = featureGame(map, text.files, text.run);
  const content = await withContentImages(game.content);
  fx ??= rasterize(FX_SHEET, fxSheet(), FX_PALETTE);
  const own = contentSheets(content);
  const sheets: SheetLookup = (id, palette) => (id === FX_SHEET ? fx : own(id, palette));
  games.set(map, {
    game,
    sheets,
    fonts: contentFonts(content),
    featureSkin: featureSkin(game.skin, game.info, game.base.unitKinds),
  });
}

function loaded(map: FeatureMap): Loaded {
  const g = games.get(map);
  if (!g) throw new Error(`${map} is not loaded (call featureBench.init first)`);
  return g;
}

/** A fresh canvas filling the window, replacing the last case's. */
function freshCanvas(): HTMLCanvasElement {
  document.querySelector('canvas')?.remove();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;image-rendering:pixelated';
  document.body.append(canvas);
  return canvas;
}

/** A case's scene and a draw function onto a fresh canvas. */
interface CaseSetUp {
  draw: () => void;
  presenter: SkinnedCanvasPresenter;
  /** Entities in the last frame drawn. */
  entities: () => number;
}

function setUp(req: FeatureCase): CaseSetUp {
  const g = loaded(req.map);
  const screen = g.game.content.manifest.screen;
  const viewport = new Viewport(freshCanvas(), { integerScale: true }, screen);
  const skin =
    req.features === false
      ? g.game.skin
      : req.without?.length
        ? withoutFeatures(g.featureSkin, req.without)
        : g.featureSkin;
  const presenter = new SkinnedCanvasPresenter(viewport.ctx, skin, g.sheets, {
    size: screen,
    fonts: g.fonts,
    seed: req.seed ?? 1,
    maxParticles: BENCH_MAX_PARTICLES,
  });
  const scene = new FeatureScene(g.game.base, req);
  let entities = 0;
  const draw = () => {
    const frame = scene.next();
    entities = frame.entities.length;
    presenter.present(frame);
    viewport.present();
  };
  return { draw, presenter, entities: () => entities };
}

function measure(req: FeatureRequest): Promise<FeatureTimes> {
  const { draw, presenter, entities } = setUp(req);
  return new Promise((done) => {
    const times: FeatureTimes = { draw: [], interval: [], particles: [], entities: 0 };
    let n = 0;
    let last = 0;
    let start = 0;
    const tick = (now: number) => {
      if (n === req.warmup) start = now;
      if (n > req.warmup) times.interval.push(now - last);
      last = now;
      const t0 = performance.now();
      draw();
      const t1 = performance.now();
      if (n >= req.warmup) {
        times.draw.push(t1 - t0);
        if (times.draw.length % 10 === 0) times.particles.push(presenter.particleCount);
      }
      n++;
      if (n <= req.warmup || now - start < req.seconds * 1000) requestAnimationFrame(tick);
      else {
        times.particles.push(presenter.particleCount);
        times.entities = entities();
        done(times);
      }
    };
    requestAnimationFrame(tick);
  });
}

function webglRenderer(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no WebGL 2';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

const api = {
  async init(text: Record<FeatureMap, GameText>): Promise<FeatureInfo> {
    for (const map of Object.keys(text) as FeatureMap[]) await load(map, text[map]);
    return {
      userAgent: navigator.userAgent,
      webgl: webglRenderer(),
      window: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      screens: Object.fromEntries(
        [...games].map(([map, g]) => [map, g.game.content.manifest.screen]),
      ) as Record<FeatureMap, ScreenSize>,
    };
  },
  run(req: FeatureRequest): Promise<FeatureTimes> {
    return measure(req);
  },
  /** Draws the case's first `frames` frames at once; the picture stays for a screenshot. */
  shot(req: FeatureCase, frames = SHOT_FRAMES): { particles: number; entities: number } {
    const { draw, presenter, entities } = setUp(req);
    for (let i = 0; i < frames; i++) draw();
    return { particles: presenter.particleCount, entities: entities() };
  },
};

declare global {
  interface Window {
    featureBench?: typeof api;
  }
}
window.featureBench = api;
