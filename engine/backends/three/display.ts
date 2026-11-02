import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { DeepReadonly, Presenter, SkinFile } from '@engine/core/present';
import type { DisplayResult } from '@engine/core/shell/display';
import { applyCanvasBox, fitCanvas } from './fit';
import { ThreePresenter } from './presenter';
import { ThreeScene } from './scene';

/** What a 3D page needs from a game: its picture size and its `three` skin. */
export interface ThreeDisplayOptions {
  screen: ScreenSize;
  skin: DeepReadonly<SkinFile>;
  /** The clear colour behind the picture (default `#000`). */
  background?: string;
  /** Whole-number scaling only (default false: stretch to fit, letterboxed). */
  integerScale?: boolean;
  /** Called for each event whose skin entry names a sound. */
  onSound?: (id: string) => void;
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
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `The 3D view could not start WebGL: ${why}`;
  }
  return {
    renderer: NO_DRAW,
    presenter,
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
 * and tools that check what 3D would show (backend parity); `.scene` for read-outs.
 */
export function threeScenePresenter(
  skin: DeepReadonly<SkinFile>,
  opts: { screen: ScreenSize; background?: string },
): Presenter & { scene: ThreeScene } {
  const scene = new ThreeScene(skin, {
    size: opts.screen,
    ...(opts.background !== undefined && { background: opts.background }),
  });
  return { scene, present: (frame) => scene.sync(frame) };
}
