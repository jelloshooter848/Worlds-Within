import type { PixelSheetLookup } from '@engine/core/assets/content-sheets';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import { presenterBySkinSet, type DeepReadonly, type Presenter, type SkinFile } from '@engine/core/present';
import type { DisplayResult } from '@engine/core/shell/display';
import { applyCanvasBox, fitCanvas } from './fit';
import { ThreePresenter } from './presenter';
import { ThreeScene } from './scene';

/** What a 3D page needs from a game: its picture size and its `three` skin. */
export interface ThreeDisplayOptions {
  screen: ScreenSize;
  skin: DeepReadonly<SkinFile>;
  /**
   * A skin per mini game, by its id (a `SkinSet`'s `rounds`): frames whose `status.miniGame`
   * names one are drawn through it, on the same canvas, on its own skin's `background` (black by
   * default; Engine 0.7 T8).
   */
  rounds?: Readonly<Record<string, DeepReadonly<SkinFile>>>;
  /** The clear colour behind the game's own frames when it is not its skin's `background` (default that, else `#000`). */
  background?: string;
  /** Whole-number scaling only (default false: stretch to fit, letterboxed). */
  integerScale?: boolean;
  /** Called for each event whose skin entry names a sound. */
  onSound?: (id: string) => void;
  /**
   * The game's sprite sheets as decoded pixels (`contentPixelSheets(content)`), for every skin's
   * HUD (gap G33); without it HUD frames are flat boxes and HUD text draws nothing.
   */
  sheets?: PixelSheetLookup;
}

/** Whether this browser gives a WebGL 2 context (Three.js needs WebGL 2). Browser only. */
export function webgl2Available(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/** The scene stack's renderer in 3D: draws nothing (scenes show frames through the presenter). */
const NO_DRAW: Renderer = {
  clear() {},
  rect() {},
  sprite() {},
  text() {},
  debugText() {},
  line() {},
};

/**
 * The Three.js display for `bootBrowserGame` (`@engine/core/shell`, Engine 0.7, moved from
 * `games/platformer-lab/main3d.ts`), or a sentence saying why it cannot start (no WebGL 2, or the
 * context failed). A `ThreePresenter` with the game's `three` skin draws on the page's canvas: its
 * drawing buffer stays at the picture size and CSS places and scales it (`fitCanvas` with the
 * screen layout's `fit`, the same letterbox the Canvas2D `Viewport` uses). Browser only; a game
 * reaches it with `import('@engine/backends/three')` so its 2D page loads no Three.js.
 */
export function threeDisplay(canvas: HTMLCanvasElement, opts: ThreeDisplayOptions): DisplayResult {
  if (!webgl2Available())
    return 'The 3D view needs WebGL 2, and this browser has none (it may be turned off or unsupported).';
  let presenter: ThreePresenter;
  try {
    presenter = new ThreePresenter(canvas, opts.skin, {
      size: opts.screen,
      ...(opts.background !== undefined && { background: opts.background }),
      ...(opts.onSound !== undefined && { onSound: opts.onSound }),
      ...(opts.sheets !== undefined && { sheets: opts.sheets }),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `The 3D view could not start WebGL: ${why}`;
  }
  const rounds: Record<string, Presenter> = {};
  for (const [id, skin] of Object.entries(opts.rounds ?? {}))
    rounds[id] = presenter.withSkin(skin, {
      ...(opts.onSound !== undefined && { onSound: opts.onSound }),
      ...(opts.sheets !== undefined && { sheets: opts.sheets }),
    });
  return {
    renderer: NO_DRAW,
    presenter: Object.keys(rounds).length > 0 ? presenterBySkinSet(presenter, rounds) : presenter,
    fit(layout) {
      const dpr = window.devicePixelRatio || 1;
      applyCanvasBox(
        canvas,
        fitCanvas(
          opts.screen,
          window.innerWidth,
          window.innerHeight,
          dpr,
          opts.integerScale ?? false,
          layout.fit,
        ),
      );
    },
    present() {},
  };
}

/**
 * A `Presenter` over the Node-side `ThreeScene` (no WebGL): `present` is `scene.sync`. For tests
 * and tools that check what 3D would show (backend parity); `.scene` for read-outs. With
 * `rounds` (as `threeDisplay`'s), frames of a mini game with a skin go to a scene of their own
 * (`.rounds[id]`, on that skin's `background`), as on the page; `.shown` is the scene the last frame went to.
 */
export function threeScenePresenter(
  skin: DeepReadonly<SkinFile>,
  opts: {
    screen: ScreenSize;
    background?: string;
    rounds?: Readonly<Record<string, DeepReadonly<SkinFile>>>;
    sheets?: PixelSheetLookup;
  },
): Presenter & { scene: ThreeScene; rounds: Record<string, ThreeScene>; readonly shown: ThreeScene } {
  const scene = new ThreeScene(skin, {
    size: opts.screen,
    ...(opts.background !== undefined && { background: opts.background }),
    ...(opts.sheets !== undefined && { sheets: opts.sheets }),
  });
  let shown = scene;
  const show = (s: ThreeScene): Presenter => ({ present: (frame) => (shown = s).sync(frame) });
  const rounds: Record<string, ThreeScene> = {};
  const roundPresenters: Record<string, Presenter> = {};
  for (const [id, roundSkin] of Object.entries(opts.rounds ?? {})) {
    rounds[id] = new ThreeScene(roundSkin, {
      size: opts.screen,
      ...(opts.sheets !== undefined && { sheets: opts.sheets }),
    });
    roundPresenters[id] = show(rounds[id]);
  }
  const picked = presenterBySkinSet(show(scene), roundPresenters);
  return {
    scene,
    rounds,
    get shown() {
      return shown;
    },
    present: (frame) => picked.present(frame),
  };
}
