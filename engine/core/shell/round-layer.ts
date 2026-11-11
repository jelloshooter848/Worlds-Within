import type { ScreenSize } from '../gfx/screen';
import { MINI_GAME_STATUS } from '../present/skin-set';
import type { DeepReadonly, PresentFrame } from '../present/types';
import type { BrowserDisplay } from './display';

/**
 * Hosted rounds drawn in 2D on a 3D page (Engine 0.16 F8, the mini siege's part F): one
 * `BrowserDisplay` over two, the **world** display (Three.js, on the page's canvas) and a **round**
 * display (Canvas2D or PixiJS, chosen by the shell, on a canvas layered over the first). A frame
 * whose `status.miniGame` names one of `ids` goes to the round display, and the layer shows; any
 * other frame goes to the world display, and the layer hides. So a round keeps its own 2D skins
 * and art (a top-down room, a tower-defense map) while the world stays in 3D. The boot builds it
 * for a 3D page whose game lists such rounds (`BrowserBootOptions.rounds2d`, from the 3D skin's
 * `rounds2d`).
 *
 * - `present()`, `toScreen`, `toClient` and `uiPainter` follow the display shown now (the menus and
 *   mission screens paint over the round on its layer; taps are read through its letterbox, the
 *   same box as the world's: both fit the picture to the window with the same `fitGame`).
 * - `fit`, `transition` and `effectSettings` go to both, so a transition closes over the world on
 *   one canvas and opens over the round on the other.
 * - The scene stack's `renderer` is the world's (scenes draw through `presenter`).
 *
 * Pure apart from `show`, which the boot points at the layer canvas's visibility.
 */
export interface RoundLayerOptions {
  /** The display the world is drawn on (the page's 3D display). */
  world: BrowserDisplay;
  /** The 2D display the rounds are drawn on, on its own canvas over the world's. */
  round: BrowserDisplay;
  /** The mini games (`status.miniGame` values) whose frames the round display draws. */
  ids: readonly string[];
  /** Shows (true) or hides the round display's canvas. */
  show(round: boolean): void;
  /**
   * The world's client-to-picture mapping when its display has none (3D: the canvas box over the
   * picture), and its inverse.
   */
  worldBox?: {
    toScreen(clientX: number, clientY: number): { x: number; y: number };
    toClient(x: number, y: number): { x: number; y: number };
  };
}

/** A {@link RoundLayerOptions} display, and which of the two is shown now. */
export interface RoundLayerDisplay extends BrowserDisplay {
  /** `round` while a listed round's frames are shown, else `world`. */
  readonly showing: 'world' | 'round';
}

export function roundLayerDisplay(opts: RoundLayerOptions): RoundLayerDisplay {
  const { world, round, ids } = opts;
  let showing: 'world' | 'round' = 'world';
  opts.show(false);
  const active = () => (showing === 'round' ? round : world);
  const toScreen = (d: BrowserDisplay) => d.toScreen?.bind(d) ?? opts.worldBox?.toScreen;
  const toClient = (d: BrowserDisplay) => d.toClient?.bind(d) ?? opts.worldBox?.toClient;
  const display: RoundLayerDisplay = {
    get showing() {
      return showing;
    },
    renderer: world.renderer,
    presenter: {
      present(frame: DeepReadonly<PresentFrame>) {
        const wanted = isLayerRound(frame, ids) ? 'round' : 'world';
        if (wanted !== showing) {
          showing = wanted;
          opts.show(wanted === 'round');
        }
        active().presenter.present(frame);
      },
      resize(size: ScreenSize) {
        world.presenter.resize?.(size);
        round.presenter.resize?.(size);
      },
    },
    fit(layout) {
      world.fit(layout);
      round.fit(layout);
    },
    present() {
      active().present();
    },
    toScreen(clientX, clientY) {
      const map = toScreen(active()) ?? toScreen(world);
      return map ? map(clientX, clientY) : { x: clientX, y: clientY };
    },
    toClient(x, y) {
      const map = toClient(active()) ?? toClient(world);
      return map ? map(x, y) : { x, y };
    },
    transition(view) {
      world.transition?.(view);
      round.transition?.(view);
    },
    effectSettings(settings) {
      world.effectSettings?.(settings);
      round.effectSettings?.(settings);
    },
  };
  if (world.uiPainter !== undefined || round.uiPainter !== undefined)
    display.uiPainter = () => {
      const d = active().uiPainter !== undefined ? active() : showing === 'round' ? world : round;
      return d.uiPainter!();
    };
  return display;
}

/** Whether a frame is one of the layer's rounds (its `status.miniGame` is in `ids`). */
export function isLayerRound(frame: DeepReadonly<PresentFrame>, ids: readonly string[]): boolean {
  const id = frame.status[MINI_GAME_STATUS];
  return typeof id === 'string' && id !== '' && ids.includes(id);
}
