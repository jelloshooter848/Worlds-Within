import { fitGame, type GameFit, type ScreenSize } from '@engine/core/gfx/screen';

/** Where the WebGL canvas goes in its container, in CSS px. */
export interface CanvasBox {
  /** Device px per game px (the same as `Viewport.scale` for 2D). */
  scale: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Letterboxes a game picture of `size` in a container of `cssW` × `cssH` CSS px, with the same
 * `fitGame` maths the Canvas2D `Viewport` uses (integer scale or stretch-to-fit, `GameFit`
 * anchors). The WebGL canvas keeps its drawing buffer at the picture size (pixel ratio 1) and is
 * only placed and scaled by CSS, so what is drawn never depends on the window. Pure maths, no DOM.
 */
export function fitCanvas(
  size: ScreenSize,
  cssW: number,
  cssH: number,
  dpr = 1,
  integerScale = false,
  fit: GameFit = {},
): CanvasBox {
  const box = fitGame(size, cssW, cssH, dpr, integerScale, fit);
  return {
    scale: box.scale,
    left: box.ox / dpr,
    top: box.oy / dpr,
    width: box.dw / dpr,
    height: box.dh / dpr,
  };
}

/** Places a canvas at `box` inside a positioned container, kept crisp (browser only). */
export function applyCanvasBox(canvas: HTMLCanvasElement, box: CanvasBox): void {
  const s = canvas.style;
  s.position = 'absolute';
  s.left = `${box.left}px`;
  s.top = `${box.top}px`;
  s.width = `${box.width}px`;
  s.height = `${box.height}px`;
  s.imageRendering = 'pixelated';
}

/**
 * Converts a client (CSS px) point to game px for a canvas placed with {@link applyCanvasBox}
 * (as `Viewport.toScreen` does in 2D); `rect` is the container's bounding rect.
 */
export function canvasToScreen(
  box: CanvasBox,
  rect: { left: number; top: number },
  clientX: number,
  clientY: number,
  dpr = 1,
): { x: number; y: number } {
  const x = ((clientX - rect.left - box.left) * dpr) / box.scale;
  const y = ((clientY - rect.top - box.top) * dpr) / box.scale;
  return { x, y };
}
