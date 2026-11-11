import { autoDetectRenderer, Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { transitionShape, type TransitionView } from '@engine/core/fx';
import { fitGame, type GameFit, type ScreenSize } from '@engine/core/gfx/screen';
import type { DeepReadonly, SkinFile, SoundCue } from '@engine/core/present';
import type { BrowserDisplay } from '@engine/core/shell/display';
import type { FontLookup, UiPainter } from '@engine/core/ui';
import { PixiPresenter } from './presenter';
import { PixiRenderer } from './renderer';
import { skinSetPixiPresenter } from './skin-set';
import { PixiSurfaces, type SurfaceTarget } from './surface';
import { drawTransition } from './transition';
import { PixiUiPainter } from './ui-painter';

/** What a PixiJS page needs from a game: the same as Canvas2D's `CanvasDisplayOptions`. */
export interface PixiDisplayOptions {
  screen: ScreenSize;
  /** The game's `canvas2d` skin (the PixiJS backend draws the same skins). */
  skin: DeepReadonly<SkinFile>;
  /** A skin per mini game, by its id (a `SkinSet`'s `rounds`), drawn on the same renderer. */
  rounds?: Readonly<Record<string, DeepReadonly<SkinFile>>>;
  sheet: SheetLookup;
  /** The game's `font` content files (`contentFonts`), for the HUD and the shell's menus. */
  fonts?: FontLookup;
  /** The colour behind the game's own frames when it is not its skin's `background`. */
  background?: string;
  /** Whole-number scaling only (default false: stretch to fit, letterboxed). */
  integerScale?: boolean;
  /** Called for each event whose skin entry names a sound. */
  onSound?: (id: string, cue?: SoundCue) => void;
  /** Called with the ticks of each event whose skin entry asks for a `hitPause`. */
  onHitPause?: (ticks: number) => void;
  /**
   * Keep the canvas's drawing buffer after each picture (WebGL's `preserveDrawingBuffer`), so a
   * tool can read the canvas back (`toDataURL`) at any time (`pnpm cli screenshot --backend pixi`,
   * T13b-5). Default false: the page's own display lets the browser drop it, which is faster.
   */
  preserveDrawingBuffer?: boolean;
  /** The seed the main presenter's particles draw from (`SkinnedPresenterOptions.seed`). */
  seed?: number;
  /** The main presenter's particle cap (`SkinnedPresenterOptions.maxParticles`; the 2D feature benchmark sets 6000). */
  maxParticles?: number;
  /**
   * Who scales the picture up to the canvas's size (T13b-7). `'page'` (default): the canvas's
   * drawing buffer is its device size divided by the whole part of the picture's scale, the
   * picture is drawn into it at the rest of the scale (1 with `integerScale`), and the browser
   * stretches the canvas back up with `image-rendering: pixelated`, so WebGL fills a picture-sized
   * buffer instead of the whole window. `'gl'`: the drawing buffer is the canvas's full device
   * size and WebGL scales the picture into it (the T13b-3 path; each frame fills every pixel).
   */
  upscale?: 'page' | 'gl';
}

/**
 * A started PixiJS display: the shell's `BrowserDisplay`, plus the game's own `PixiPresenter`
 * (`main`; `presenter` is the skin set's), so a tool such as the 2D feature benchmark reads its
 * `particleCount`.
 */
export type PixiDisplay = BrowserDisplay & { readonly main: PixiPresenter };

/**
 * The part of a PixiJS renderer the display uses: rendering a container (into a texture, or onto
 * the canvas without a `target`) and resizing the canvas's drawing buffer.
 */
export interface DisplayGpu extends SurfaceTarget {
  render(options: {
    container: Container;
    target?: RenderTexture;
    clear: boolean;
    clearColor?: number;
  }): void;
  resize(width: number, height: number, resolution?: number): void;
}

/**
 * The PixiJS display for `bootBrowserGame` (`@engine/core/shell`; Engine 0.16 T13b-3), or a
 * sentence saying why it cannot start (no WebGL), shown on the page instead (as `threeDisplay`).
 * Async: it starts a PixiJS v8 WebGL renderer on the page's canvas (`autoDetectRenderer` with
 * WebGL only, antialias off, software WebGL allowed), then `pixiDisplayOn` builds the display.
 * Takes the same options as Canvas2D's `canvasDisplay`. Browser only; a page reaches it with
 * `import('@engine/backends/pixi')`, which has no side effects of its own at import.
 */
export async function pixiDisplay(
  canvas: HTMLCanvasElement,
  opts: PixiDisplayOptions,
): Promise<PixiDisplay | string> {
  let gpu: DisplayGpu;
  try {
    gpu = (await autoDetectRenderer({
      canvas,
      preference: ['webgl'],
      antialias: false,
      failIfMajorPerformanceCaveat: false,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
      background: '#000',
      width: opts.screen.width,
      height: opts.screen.height,
      resolution: 1,
      autoDensity: false,
    })) as unknown as DisplayGpu;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `The PixiJS view needs WebGL, and it could not start (${why}).`;
  }
  return pixiDisplayOn(gpu, canvas, opts);
}

/**
 * The display on a started PixiJS renderer (`pixiDisplay`; a test passes a recorder): a
 * `PixiRenderer` whose `stage` the scenes fill, the game's `PixiPresenter` (and one per mini game
 * in `rounds`, `skinSetPixiPresenter`) on it, all sharing one `PixiSurfaces`. `present` renders
 * the waiting surfaces (map, glyph strips) into their textures, then the picture (the stage and
 * the transition over it, `drawTransition` on a `Graphics`, an iris closing on the main
 * presenter's `focus()`) letterboxed like Canvas2D's `Viewport` (`fitGame`: the screen layout's
 * `fit`, `integerScale`). With `upscale: 'page'` (default) the drawing buffer is the canvas's
 * device size over `s`, the whole part of the scale, and the browser scales it up by `s`: at a
 * whole-number scale the picture goes straight onto the canvas at its own size, otherwise (and
 * with `upscale: 'gl'`, `s` = 1) through a backbuffer `RenderTexture` at the game's `screen` size
 * drawn as one nearest-neighbour sprite at the remaining scale. The stage is kept after
 * `present` (the next top-level `clear` starts a new frame), so a frame that draws nothing shows
 * the last picture, as a canvas would. `uiPainter` is one `PixiUiPainter` on the renderer for
 * the shell's menus; `toScreen` and `toClient` are the `Viewport`'s maths.
 */
export function pixiDisplayOn(
  gpu: DisplayGpu,
  canvas: HTMLCanvasElement,
  opts: PixiDisplayOptions,
): PixiDisplay {
  const { screen } = opts;
  // A top-level clear becomes the colour the picture is cleared to (`backdrop`), not a sprite.
  const renderer = new PixiRenderer({ size: screen, backdrop: true });
  const surfaces = new PixiSurfaces(renderer);
  const main = new PixiPresenter(renderer, opts.skin, opts.sheet, {
    size: screen,
    surfaces,
    ...(opts.background !== undefined && { background: opts.background }),
    ...(opts.onSound !== undefined && { onSound: opts.onSound }),
    ...(opts.onHitPause !== undefined && { onHitPause: opts.onHitPause }),
    ...(opts.fonts !== undefined && { fonts: opts.fonts }),
    ...(opts.seed !== undefined && { seed: opts.seed }),
    ...(opts.maxParticles !== undefined && { maxParticles: opts.maxParticles }),
  });
  const presenter = skinSetPixiPresenter(renderer, { ...opts, main }, surfaces);
  // The picture at the game's size: the scenes' stage with the transition over it.
  const cover = new Graphics();
  const picture = new Container();
  picture.addChild(renderer.stage, cover);
  const back = RenderTexture.create({ width: screen.width, height: screen.height, scaleMode: 'nearest' });
  const shown = new Sprite(back);
  const page = new Container();
  page.addChild(shown);
  // Drawn straight onto the canvas: black bars round the picture (it clears to its backdrop).
  const bars = new Graphics();
  const framed = new Container();
  framed.addChild(bars, picture);
  // In drawing-buffer px: the picture's scale and top-left, and buffer px per CSS px (x and y).
  const box = { scale: 1, ox: 0, oy: 0, perCssX: 1, perCssY: 1, direct: true };
  let fit: GameFit = {};
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    const W = Math.floor(cssW * dpr);
    const H = Math.floor(cssH * dpr);
    const b = fitGame(screen, cssW, cssH, dpr, opts.integerScale ?? false, fit);
    // The browser's share of the scale (a whole number), and the buffer it stretches by that much.
    const s = (opts.upscale ?? 'page') === 'page' ? Math.max(1, Math.floor(b.scale)) : 1;
    const bw = Math.ceil(W / s);
    const bh = Math.ceil(H / s);
    gpu.resize(bw, bh, 1);
    if (s > 1 && canvas.style) canvas.style.imageRendering = 'pixelated';
    const scale = b.scale / s;
    const ox = Math.round(b.ox / s);
    const oy = Math.round(b.oy / s);
    Object.assign(box, { scale, ox, oy, perCssX: bw / cssW, perCssY: bh / cssH, direct: scale === 1 });
    // At scale 1 the picture is drawn straight onto the canvas at (ox, oy); otherwise into the
    // backbuffer, shown scaled there.
    picture.position.set(box.direct ? ox : 0, box.direct ? oy : 0);
    bars.clear();
    if (box.direct) {
      const right = ox + screen.width;
      const bottom = oy + screen.height;
      for (const [x, y, w, h] of [
        [0, 0, bw, oy],
        [0, bottom, bw, bh - bottom],
        [0, oy, ox, screen.height],
        [right, oy, bw - right, screen.height],
      ] as const)
        if (w > 0 && h > 0) bars.rect(x, y, w, h);
      bars.fill(0x000000);
    }
    shown.position.set(ox, oy);
    shown.width = Math.round(screen.width * scale);
    shown.height = Math.round(screen.height * scale);
  };
  resize();
  window.addEventListener('resize', resize);
  let transition: TransitionView | null = null;
  let painter: UiPainter | null = null;
  return {
    renderer,
    presenter,
    main,
    fit(layout) {
      fit = layout.fit;
      resize();
    },
    present() {
      surfaces.flush(gpu);
      drawTransition(cover, transition && transitionShape(transition, screen, main.focus()), screen);
      const clearColor = renderer.backdrop ?? 0x000000;
      if (box.direct) gpu.render({ container: framed, clear: true, clearColor });
      else {
        gpu.render({ container: picture, target: back, clear: true, clearColor });
        gpu.render({ container: page, clear: true, clearColor: 0x000000 });
      }
    },
    transition(view) {
      transition = view;
    },
    // The shell's menus draw on the scenes' renderer, over the picture; one painter, so each
    // font's glyph strip is drawn once.
    uiPainter: () => (painter ??= new PixiUiPainter(renderer, opts.sheet, opts.fonts, surfaces)),
    effectSettings: (settings) => presenter.effectSettings(settings),
    showHud: (shown) => presenter.showHud(shown),
    toScreen(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) * box.perCssX - box.ox) / box.scale,
        y: ((clientY - rect.top) * box.perCssY - box.oy) / box.scale,
      };
    },
    toClient(x, y) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + (x * box.scale + box.ox) / box.perCssX,
        y: rect.top + (y * box.scale + box.oy) / box.perCssY,
      };
    },
  };
}
