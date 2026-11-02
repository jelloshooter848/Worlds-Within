/**
 * The fixed 256x240 game picture and how it fits a display of a given size. Pure maths, no DOM:
 * the canvas2d backend's Viewport and the touch layout both use it.
 */
export const SCREEN_W = 256;
export const SCREEN_H = 240;

/**
 * Where the game picture goes in the canvas (CSS px): `top` anchors it that far below the canvas
 * top (a phone held upright, 0.4.45), else it is centred; `maxW` / `maxH` keep it smaller than the
 * canvas so the touch controls have room beside or below it. Empty: as big as fits, centred.
 */
export interface GameFit {
  top?: number;
  maxW?: number;
  maxH?: number;
}

/** The game picture in device px: its scale, size and offset in a canvas of `cssW` × `cssH` CSS px. */
export interface GameBox {
  scale: number;
  dw: number;
  dh: number;
  ox: number;
  oy: number;
}

/** How Viewport fits the 256x240 picture into the canvas (also the touch layout's game rect). */
export function fitGame(
  cssW: number,
  cssH: number,
  dpr: number,
  integerScale: boolean,
  fit: GameFit = {},
): GameBox {
  const W = Math.floor(cssW * dpr);
  const H = Math.floor(cssH * dpr);
  const bw = fit.maxW === undefined ? W : Math.min(W, Math.floor(fit.maxW * dpr));
  const bh = fit.maxH === undefined ? H : Math.min(H, Math.floor(fit.maxH * dpr));
  const raw = Math.min(bw / SCREEN_W, bh / SCREEN_H);
  const scale = integerScale ? Math.max(1, Math.floor(raw)) : raw;
  const dw = Math.round(SCREEN_W * scale);
  const dh = Math.round(SCREEN_H * scale);
  const ox = Math.floor((W - dw) / 2);
  const oy = fit.top === undefined ? Math.floor((H - dh) / 2) : Math.round(fit.top * dpr);
  return { scale, dw, dh, ox, oy };
}
