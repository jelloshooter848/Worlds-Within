import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { DeepReadonly, SkinFile } from '@engine/core/present';
import type { BrowserDisplay } from '@engine/core/shell/display';
import { CanvasRenderer } from './renderer';
import { skinSetCanvasPresenter } from './skin-set';
import { Viewport } from './viewport';

/** What a Canvas2D page needs from a game: its picture size, its `canvas2d` skin and sheets. */
export interface CanvasDisplayOptions {
  screen: ScreenSize;
  skin: DeepReadonly<SkinFile>;
  /**
   * A skin per mini game, by its id (a `SkinSet`'s `rounds`): frames whose `status.miniGame`
   * names one are drawn through it on the same renderer, on its own skin's `background` (black by
   * default; Engine 0.7 T9, as `threeDisplay`).
   */
  rounds?: Readonly<Record<string, DeepReadonly<SkinFile>>>;
  sheet: SheetLookup;
  /** The colour behind the game's own frames when it is not its skin's `background` (default that, else `#000`). */
  background?: string;
  /** Whole-number scaling only (default false: stretch to fit, letterboxed). */
  integerScale?: boolean;
  /** Called for each event whose skin entry names a sound. */
  onSound?: (id: string) => void;
}

/**
 * The Canvas2D display for `bootBrowserGame` (`@engine/core/shell`, Engine 0.7, moved from
 * `games/platformer-lab/main.ts`): a `Viewport` on the page's canvas, a `CanvasRenderer` on its
 * backbuffer for the scene stack, and a `SkinnedCanvasPresenter` with the game's skin (and one per
 * mini game in `rounds`, `skinSetCanvasPresenter`) on that same renderer. `fit` follows the
 * screen layout; `present` copies the backbuffer to the page; `toScreen` maps a client point to
 * picture pixels (`Viewport.toScreen`) for pointer input, and `toClient` its inverse
 * (`Viewport.toClient`, Engine 0.15, gap D13) for page scripts. Browser only.
 */
export function canvasDisplay(canvas: HTMLCanvasElement, opts: CanvasDisplayOptions): BrowserDisplay {
  const viewport = new Viewport(canvas, { integerScale: opts.integerScale ?? false }, opts.screen);
  const renderer = new CanvasRenderer(viewport.ctx);
  const presenter = skinSetCanvasPresenter(renderer, opts);
  return {
    renderer,
    presenter,
    fit(layout) {
      viewport.fit = layout.fit;
      viewport.resize();
    },
    present: () => viewport.present(),
    toScreen: (clientX, clientY) => viewport.toScreen(clientX, clientY),
    toClient: (x, y) => viewport.toClient(x, y),
  };
}
