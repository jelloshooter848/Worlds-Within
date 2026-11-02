import type { ContentBundle } from '@engine/core/content/bundle';
import { NullRenderer } from '@engine/backends/null';
import { applyCanvasBox, fitCanvas, ThreePresenter } from '@engine/backends/three';
import type { LabDisplay } from './backend';
import { labLook3d, labOptions3d, LabPicture3d } from './picture3d';

/**
 * The lab's 3D display (`?backend=three`), imported by `main.ts` only in 3D so the 2D page loads
 * no Three.js. A `ThreePresenter` with the lab's `three` skin draws on the page's canvas: its
 * drawing buffer stays at the picture size and CSS places and scales it (`fitCanvas` with the
 * screen layout's `fit`, the same letterbox the Canvas2D `Viewport` uses). The scene's drawer is
 * one `LabPicture3d`, so the level and the mini game round over it (`presentWorld`) come through
 * the same frames as in 2D; the scene stack's renderer draws nothing (`NullRenderer`).
 */

/** Whether this browser gives a WebGL 2 context (Three.js needs WebGL 2). */
export function webgl2Available(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/** The 3D display on `canvas`, or a sentence saying why it cannot start. */
export function threeDisplay(canvas: HTMLCanvasElement, content: ContentBundle): LabDisplay | string {
  if (!webgl2Available())
    return 'The 3D view needs WebGL 2, and this browser has none (it may be turned off or unsupported).';
  const look = labLook3d(content);
  let presenter: ThreePresenter;
  try {
    presenter = new ThreePresenter(canvas, look.skin, labOptions3d(look));
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `The 3D view could not start WebGL: ${why}`;
  }
  const picture = new LabPicture3d(presenter, look);
  return {
    renderer: new NullRenderer(),
    picture: () => picture,
    fit(layout) {
      const dpr = window.devicePixelRatio || 1;
      applyCanvasBox(
        canvas,
        fitCanvas(look.screen, window.innerWidth, window.innerHeight, dpr, false, layout.fit),
      );
    },
    present() {},
  };
}
