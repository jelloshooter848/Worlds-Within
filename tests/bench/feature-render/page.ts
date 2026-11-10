import { withContentImages } from '@engine/core/assets/content-images';
import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { rasterize } from '@engine/core/gfx/pixelart';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { PresentFrame, SkinFile } from '@engine/core/present';
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
// window), or with `backend: 'pixi'` (T13b-6) by `pixiDisplay` (`@engine/backends/pixi`, imported
// only then; its `PixiPresenter`, whole-number scale) on the same canvas size, as a game's page
// draws, with the game's fonts and sheets plus the bench sheet. Each case gets a fresh canvas; a
// PixiJS case's WebGL context is let go (`WEBGL_lose_context`) when the next case starts.
// `window.featureBench.run` draws warm-up frames, then measures frames for `seconds`: per frame
// the time in the draw call (present plus the copy to the page; for PixiJS, building the display
// list and submitting the GL commands) and the time since the previous animation frame (the
// frame-rate limit is off, so that is the whole frame: the scene's next frame, drawing and
// Chromium's raster or GL work and compositing). `window.featureBench.shot` draws `SHOT_FRAMES`
// frames at once (a blast just started, a zoom punch held) for a screenshot.

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

/** Lets the last case's canvas go: its WebGL context too, so contexts do not pile up. */
let release: () => void = () => {};

/** A fresh canvas filling the window, replacing the last case's. */
function freshCanvas(): HTMLCanvasElement {
  release();
  release = () => {};
  document.querySelector('canvas')?.remove();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;image-rendering:pixelated';
  document.body.append(canvas);
  return canvas;
}

/** A case's scene and a draw function onto a fresh canvas. */
interface CaseSetUp {
  /**
   * The scene's next frame through the presenter, then (unless `toPage` is false) the picture onto
   * the page: the canvas copy, or for PixiJS the GL render.
   */
  draw: (toPage?: boolean) => void;
  /** Live particles in the presenter. */
  particles: () => number;
  /** Entities in the last frame drawn. */
  entities: () => number;
}

interface SetUpOptions {
  /** Keep the WebGL drawing buffer for a screenshot (PixiJS only). */
  shot?: boolean;
}

async function setUp(req: FeatureCase, setUpOpts: SetUpOptions = {}): Promise<CaseSetUp> {
  const g = loaded(req.map);
  const screen = g.game.content.manifest.screen;
  const skin =
    req.features === false
      ? g.game.skin
      : req.without?.length
        ? withoutFeatures(g.featureSkin, req.without)
        : g.featureSkin;
  const scene = new FeatureScene(g.game.base, req);
  let entities = 0;
  const canvas = freshCanvas();
  let present: (frame: PresentFrame) => void;
  let toPage: () => void;
  let particles: () => number;
  if ((req.backend ?? 'canvas2d') === 'pixi') {
    // The PixiJS display a game's page starts (`pixiDisplay`, whole-number scale), on the same
    // canvas, skin, sheets and fonts.
    const { pixiDisplay } = await import('@engine/backends/pixi');
    const display = await pixiDisplay(canvas, {
      screen,
      skin,
      sheet: g.sheets,
      fonts: g.fonts,
      integerScale: true,
      seed: req.seed ?? 1,
      maxParticles: BENCH_MAX_PARTICLES,
      preserveDrawingBuffer: setUpOpts.shot ?? false,
    });
    if (typeof display === 'string') throw new Error(display);
    release = () => {
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
    present = (frame) => display.presenter.present(frame);
    toPage = () => display.present();
    particles = () => display.main.particleCount;
  } else {
    const viewport = new Viewport(canvas, { integerScale: true }, screen);
    const presenter = new SkinnedCanvasPresenter(viewport.ctx, skin, g.sheets, {
      size: screen,
      fonts: g.fonts,
      seed: req.seed ?? 1,
      maxParticles: BENCH_MAX_PARTICLES,
    });
    present = (frame) => presenter.present(frame);
    toPage = () => viewport.present();
    particles = () => presenter.particleCount;
  }
  const draw = (copy = true) => {
    const frame = scene.next();
    entities = frame.entities.length;
    present(frame);
    if (copy) toPage();
  };
  return { draw, particles, entities: () => entities };
}

async function measure(req: FeatureRequest): Promise<FeatureTimes> {
  const { draw, particles, entities } = await setUp(req);
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
        if (times.draw.length % 10 === 0) times.particles.push(particles());
      }
      n++;
      if (n <= req.warmup || now - start < req.seconds * 1000) requestAnimationFrame(tick);
      else {
        times.particles.push(particles());
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
  /** Steps the case's first `frames` frames at once and shows the last; it stays for a screenshot. */
  async shot(req: FeatureCase, frames = SHOT_FRAMES): Promise<{ particles: number; entities: number }> {
    const { draw, particles, entities } = await setUp(req, { shot: true });
    // Only the last frame goes to the page: on software GL, rendering every one queues seconds of
    // GL work for the screenshot to wait on.
    for (let i = 0; i < frames; i++) draw(i === frames - 1);
    return { particles: particles(), entities: entities() };
  },
};

declare global {
  interface Window {
    featureBench?: typeof api;
  }
}
window.featureBench = api;
