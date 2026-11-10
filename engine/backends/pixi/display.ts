import { autoDetectRenderer, Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { transitionShape, type TransitionView } from '@engine/core/fx';
import { fitGame, type GameFit, type ScreenSize } from '@engine/core/gfx/screen';
import type { DeepReadonly, SkinFile, SoundCue } from '@engine/core/present';
import type { BrowserDisplay, DisplayResult } from '@engine/core/shell/display';
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
}

/**
 * The part of a PixiJS renderer the display uses: rendering a container (into a texture, or onto
 * the canvas without a `target`) and resizing the canvas's drawing buffer.
 */
export interface DisplayGpu extends SurfaceTarget {
  render(options: { container: Container; target?: RenderTexture; clear: boolean }): void;
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
): Promise<DisplayResult> {
  let gpu: DisplayGpu;
  try {
    gpu = (await autoDetectRenderer({
      canvas,
      preference: ['webgl'],
      antialias: false,
      failIfMajorPerformanceCaveat: false,
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
 * presenter's `focus()`) into a backbuffer `RenderTexture` at the game's `screen` size, then that
 * backbuffer as one nearest-neighbour sprite on the canvas, scaled and letterboxed like Canvas2D's
 * `Viewport` (`fitGame`: the screen layout's `fit`, `integerScale`). The stage is kept after
 * `present` (the next top-level `clear` starts a new frame), so a frame that draws nothing shows
 * the last picture, as a canvas would. `uiPainter` is one `PixiUiPainter` on the renderer for
 * the shell's menus; `toScreen` and `toClient` are the `Viewport`'s maths.
 */
export function pixiDisplayOn(
  gpu: DisplayGpu,
  canvas: HTMLCanvasElement,
  opts: PixiDisplayOptions,
): BrowserDisplay {
  const { screen } = opts;
  const renderer = new PixiRenderer({ size: screen });
  const surfaces = new PixiSurfaces(renderer);
  const main = new PixiPresenter(renderer, opts.skin, opts.sheet, {
    size: screen,
    surfaces,
    ...(opts.background !== undefined && { background: opts.background }),
    ...(opts.onSound !== undefined && { onSound: opts.onSound }),
    ...(opts.onHitPause !== undefined && { onHitPause: opts.onHitPause }),
    ...(opts.fonts !== undefined && { fonts: opts.fonts }),
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
  const box = { scale: 1, ox: 0, oy: 0 };
  let fit: GameFit = {};
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    gpu.resize(Math.floor(cssW * dpr), Math.floor(cssH * dpr), 1);
    const b = fitGame(screen, cssW, cssH, dpr, opts.integerScale ?? false, fit);
    Object.assign(box, { scale: b.scale, ox: b.ox, oy: b.oy });
    shown.position.set(b.ox, b.oy);
    shown.width = b.dw;
    shown.height = b.dh;
  };
  resize();
  window.addEventListener('resize', resize);
  let transition: TransitionView | null = null;
  let painter: UiPainter | null = null;
  return {
    renderer,
    presenter,
    fit(layout) {
      fit = layout.fit;
      resize();
    },
    present() {
      surfaces.flush(gpu);
      drawTransition(cover, transition && transitionShape(transition, screen, main.focus()), screen);
      gpu.render({ container: picture, target: back, clear: true });
      gpu.render({ container: page, clear: true });
    },
    transition(view) {
      transition = view;
    },
    // The shell's menus draw on the scenes' renderer, over the picture; one painter, so each
    // font's glyph strip is drawn once.
    uiPainter: () => (painter ??= new PixiUiPainter(renderer, opts.sheet, opts.fonts, surfaces)),
    effectSettings: (settings) => presenter.effectSettings(settings),
    toScreen(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return {
        x: ((clientX - rect.left) * dpr - box.ox) / box.scale,
        y: ((clientY - rect.top) * dpr - box.oy) / box.scale,
      };
    },
    toClient(x, y) {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return {
        x: rect.left + (x * box.scale + box.ox) / dpr,
        y: rect.top + (y * box.scale + box.oy) / dpr,
      };
    },
  };
}
