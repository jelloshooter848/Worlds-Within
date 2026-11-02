/**
 * The game picture's size and how it fits a display of a given size. Pure maths, no DOM: the
 * canvas2d backend's Viewport and the touch layout both use it. Each game sets its own size in
 * `game.json` (`screen`); a game that names none gets {@link DEFAULT_SCREEN}.
 */

/** A game picture's size in game pixels (whole numbers, see SCREEN_MIN / SCREEN_MAX). */
export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

/** The NES picture, 256x240: the size of a game whose `game.json` names no `screen`. */
export const DEFAULT_SCREEN: ScreenSize = Object.freeze({ width: 256, height: 240 });

/** The smallest and largest picture side a game may ask for (game px). */
export const SCREEN_MIN = 64;
export const SCREEN_MAX = 1920;

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

/**
 * How Viewport fits a picture of `size` into the canvas (also the touch layout's game rect). With
 * `integerScale` the scale is a whole number, at least 1.
 */
export function fitGame(
  size: ScreenSize,
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
  const raw = Math.min(bw / size.width, bh / size.height);
  const scale = integerScale ? Math.max(1, Math.floor(raw)) : raw;
  const dw = Math.round(size.width * scale);
  const dh = Math.round(size.height * scale);
  const ox = Math.floor((W - dw) / 2);
  const oy = fit.top === undefined ? Math.floor((H - dh) / 2) : Math.round(fit.top * dpr);
  return { scale, dw, dh, ox, oy };
}
