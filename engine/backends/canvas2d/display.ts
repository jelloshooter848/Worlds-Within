import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { DeepReadonly, SkinFile } from '@engine/core/present';
import type { BrowserDisplay } from '@engine/core/shell/display';
import { SkinnedCanvasPresenter } from './presenter';
import { CanvasRenderer } from './renderer';
import { Viewport } from './viewport';

/** What a Canvas2D page needs from a game: its picture size, its `canvas2d` skin and sheets. */
export interface CanvasDisplayOptions {
  screen: ScreenSize;
  skin: DeepReadonly<SkinFile>;
  sheet: SheetLookup;
  /** The colour behind the picture (default `#000`). */
  background?: string;
  /** Whole-number scaling only (default false: stretch to fit, letterboxed). */
  integerScale?: boolean;
  /** Called for each event whose skin entry names a sound. */
  onSound?: (id: string) => void;
}

/**
 * The Canvas2D display for `bootBrowserGame` (`@engine/core/shell`, Engine 0.7, moved from
 * `games/platformer-lab/main.ts`): a `Viewport` on the page's canvas, a `CanvasRenderer` on its
 * backbuffer for the scene stack, and a `SkinnedCanvasPresenter` with the game's skin on that same
 * renderer. `fit` follows the screen layout; `present` copies the backbuffer to the page. Browser
 * only.
 */
export function canvasDisplay(canvas: HTMLCanvasElement, opts: CanvasDisplayOptions): BrowserDisplay {
  const viewport = new Viewport(canvas, { integerScale: opts.integerScale ?? false }, opts.screen);
  const renderer = new CanvasRenderer(viewport.ctx);
  const presenter = new SkinnedCanvasPresenter(renderer, opts.skin, opts.sheet, {
    size: opts.screen,
    ...(opts.background !== undefined && { background: opts.background }),
    ...(opts.onSound !== undefined && { onSound: opts.onSound }),
  });
  return {
    renderer,
    presenter,
    fit(layout) {
      viewport.fit = layout.fit;
      viewport.resize();
    },
    present: () => viewport.present(),
  };
}
