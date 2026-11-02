import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { rasterize } from '@engine/core/gfx/pixelart';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import {
  CameraFollower,
  cameraView,
  resolveSkinFrame,
  type PresentFrame,
  type PresentMap,
} from '@engine/core/present';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d/presenter';
import { Viewport } from '@engine/backends/canvas2d/viewport';
import {
  BENCH_PALETTE,
  BENCH_SCREEN,
  BenchScene,
  benchSheet,
  benchSkin,
  SHEET,
  type BenchCase,
} from './scene';

// The benchmark page (Engine 0.9 T3), driven by `run.ts` through Playwright. `window.bench.run`
// draws one case for `warmup + frames` animation frames and returns, per measured frame, the time
// spent drawing it (present plus the copy to the page) and the time since the previous frame (with
// the frame-rate limit off, as `run.ts` launches Chromium, that is the whole frame: the scene's
// next frame, drawing and the browser's own raster and compositing). Canvas2D is the engine's own
// `SkinnedCanvasPresenter` on a `Viewport`, as a game's page uses it. The PixiJS column exists only
// when `run.ts` loaded a PixiJS v8 build into the page (global `PIXI`); PixiJS is never a
// dependency of the repo (see the build log, Engine 0.9).

export type BenchBackend = 'canvas2d' | 'pixi';

export interface BenchRequest extends BenchCase {
  backend: BenchBackend;
  warmup: number;
  frames: number;
}

export interface BenchTimes {
  /** ms in the draw call per measured frame. */
  draw: number[];
  /** ms between consecutive animation frames. */
  interval: number[];
}

export interface BenchInfo {
  userAgent: string;
  /** The WebGL renderer string (SwiftShader means software rendering), or why there is none. */
  webgl: string;
  pixi: string | null;
  window: { width: number; height: number; dpr: number };
}

// ---- Minimal PixiJS v8 surface (the global build's `PIXI`), typed here so nothing imports it ----

interface PixiPoint {
  set(x: number, y?: number): void;
}
interface PixiTextureSource {
  scaleMode: string;
}
interface PixiTexture {
  source: PixiTextureSource;
}
interface PixiSprite {
  texture: PixiTexture;
  position: PixiPoint;
  scale: PixiPoint;
  visible: boolean;
}
interface PixiContainer {
  addChild(child: PixiSprite): void;
}
interface PixiApp {
  init(opts: Record<string, unknown>): Promise<void>;
  stage: PixiContainer;
  render(): void;
  destroy(removeView?: boolean): void;
}
interface Pixi {
  VERSION: string;
  Application: new () => PixiApp;
  Sprite: new (texture?: PixiTexture) => PixiSprite;
  Texture: {
    from(source: CanvasImageSource): PixiTexture;
    new (opts: { source: PixiTextureSource; frame: unknown }): PixiTexture;
  };
  Rectangle: new (x: number, y: number, w: number, h: number) => unknown;
}

function pixi(): Pixi | null {
  return ((globalThis as { PIXI?: Pixi }).PIXI ?? null) as Pixi | null;
}

// ---- Shared setup ----

let sheetCache: SpriteSheet | null = null;
function sheet(): SpriteSheet {
  sheetCache ??= rasterize(SHEET, benchSheet(), BENCH_PALETTE);
  return sheetCache;
}

/** The last PixiJS case's app, kept so its picture stays on screen until the next case. */
let lastApp: PixiApp | null = null;

/** A fresh canvas filling the window, replacing the last case's. */
function freshCanvas(): HTMLCanvasElement {
  lastApp?.destroy(true);
  lastApp = null;
  document.querySelector('canvas')?.remove();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;image-rendering:pixelated';
  document.body.append(canvas);
  return canvas;
}

/** Draws `draw` on `warmup + frames` animation frames and times the last `frames`. */
function measure(draw: () => void, warmup: number, frames: number): Promise<BenchTimes> {
  return new Promise((done) => {
    const times: BenchTimes = { draw: [], interval: [] };
    let n = 0;
    let last = 0;
    const tick = (now: number) => {
      if (n > warmup) times.interval.push(now - last);
      last = now;
      const t0 = performance.now();
      draw();
      if (n >= warmup) times.draw.push(performance.now() - t0);
      n++;
      if (times.interval.length < frames) requestAnimationFrame(tick);
      else done(times);
    };
    requestAnimationFrame(tick);
  });
}

// ---- Canvas2D: the engine's presenter, as a game's page uses it ----

function canvas2dCase(req: BenchRequest): Promise<BenchTimes> {
  const viewport = new Viewport(freshCanvas(), { integerScale: true }, BENCH_SCREEN);
  const lookup: SheetLookup = (id) => (id === SHEET ? sheet() : null);
  const presenter = new SkinnedCanvasPresenter(viewport.ctx, benchSkin(), lookup, { size: BENCH_SCREEN });
  const scene = new BenchScene(req);
  return measure(
    () => {
      presenter.present(scene.next());
      viewport.present();
    },
    req.warmup,
    req.frames,
  );
}

// ---- PixiJS: the same frames, skin and sheet, drawn as sprites ----

/** The map drawn once onto a canvas, as the Canvas2D presenter caches it. */
function mapCanvas(map: PresentMap, src: SpriteSheet): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.cols * map.tileSize;
  canvas.height = map.rows * map.tileSize;
  const ctx = canvas.getContext('2d')!;
  const tiles = benchSkin().tiles ?? {};
  (map.tiles as string[]).forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      const rect = src.frames.get(tiles[line[col]!]?.frame ?? '');
      if (!rect) continue;
      const { x, y, w, h } = rect;
      ctx.drawImage(src.image!, x, y, w, h, col * map.tileSize, row * map.tileSize, w, h);
    }
  });
  return canvas;
}

async function pixiCase(req: BenchRequest): Promise<BenchTimes> {
  const P = pixi();
  if (!P) throw new Error('PixiJS is not loaded (run.ts --pixi <pixi.min.js>)');
  const canvas = freshCanvas();
  // The picture is drawn at its own size and scaled up by the page (CSS, pixelated), the cheap
  // way a PixiJS backend would fit it, like the Canvas2D viewport's whole-number scale.
  const scale = Math.max(
    1,
    Math.floor(Math.min(innerWidth / BENCH_SCREEN.width, innerHeight / BENCH_SCREEN.height)),
  );
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${BENCH_SCREEN.width * scale}px;height:${BENCH_SCREEN.height * scale}px;image-rendering:pixelated`;
  const app = new P.Application();
  lastApp = app;
  await app.init({
    canvas,
    width: BENCH_SCREEN.width,
    height: BENCH_SCREEN.height,
    background: '#000000',
    antialias: false,
    autoStart: false,
    sharedTicker: false,
    preference: 'webgl',
    resolution: 1,
  });
  const src = sheet();
  const base = P.Texture.from(src.image!);
  base.source.scaleMode = 'nearest';
  const textures = new Map<string, PixiTexture>();
  for (const [name, r] of src.frames) {
    textures.set(name, new P.Texture({ source: base.source, frame: new P.Rectangle(r.x, r.y, r.w, r.h) }));
  }
  const skin = benchSkin();
  const scene = new BenchScene(req);
  const first = scene.next();
  const map = first.map as PresentMap;
  const mapTex = P.Texture.from(mapCanvas(map, src));
  mapTex.source.scaleMode = 'nearest';
  const mapSprite = new P.Sprite(mapTex);
  app.stage.addChild(mapSprite);
  const pool: PixiSprite[] = [];
  const camera = new CameraFollower();
  const mapInfo = { id: map.id, cols: map.cols, rows: map.rows, tileSize: map.tileSize };
  let frame: PresentFrame = first;

  const draw = () => {
    const zoom = frame.camera?.zoom ?? 1;
    const cam = camera.update(frame, skin.camera, cameraView(BENCH_SCREEN, zoom), mapInfo);
    const vx = Math.round(cam.x * zoom);
    const vy = Math.round(cam.y * zoom);
    mapSprite.position.set(-vx, -vy);
    mapSprite.scale.set(zoom);
    const entities = [...frame.entities].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
    entities.forEach((e, i) => {
      let sprite = pool[i];
      if (!sprite) {
        sprite = new P.Sprite();
        pool.push(sprite);
        app.stage.addChild(sprite);
      }
      const sf = resolveSkinFrame(skin, e);
      const tex = sf.frame === null ? undefined : textures.get(sf.frame);
      sprite.visible = tex !== undefined;
      if (!tex) return;
      const w = Math.max(1, Math.round((src.frames.get(sf.frame!)?.w ?? e.w) * zoom));
      const x = Math.round(e.x * zoom) - vx;
      sprite.texture = tex;
      sprite.position.set(sf.flipX ? x + w : x, Math.round(e.y * zoom) - vy);
      sprite.scale.set(sf.flipX ? -zoom : zoom, zoom);
    });
    for (let i = entities.length; i < pool.length; i++) pool[i]!.visible = false;
    app.render();
  };
  return measure(
    () => {
      draw();
      frame = scene.next();
    },
    req.warmup,
    req.frames,
  );
}

// ---- The page's API for run.ts ----

function webglRenderer(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no WebGL 2';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

const api = {
  info(): BenchInfo {
    return {
      userAgent: navigator.userAgent,
      webgl: webglRenderer(),
      pixi: pixi()?.VERSION ?? null,
      window: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    };
  },
  run(req: BenchRequest): Promise<BenchTimes> {
    return req.backend === 'pixi' ? pixiCase(req) : canvas2dCase(req);
  },
};

declare global {
  interface Window {
    bench?: typeof api;
  }
}
window.bench = api;
