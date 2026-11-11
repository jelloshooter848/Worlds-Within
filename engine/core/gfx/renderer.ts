import type { RadialDither } from '../fx/dither';
import type { SpriteSheet } from './spritesheet';

/**
 * Everything the game draws goes through this interface so the headless sim can use a
 * NullRenderer and the game logic never touches the DOM. This is the core presentation contract:
 * the backends (engine/backends/canvas2d, engine/backends/null) implement it, and nothing here
 * imports from them.
 * Coordinates are screen pixels, 0..width and 0..height of the game's picture size (`screen` in
 * `game.json`, `gfx/screen.ts`); callers subtract the camera.
 */
export interface Renderer {
  clear(color: string): void;
  rect(x: number, y: number, w: number, h: number, color: string): void;
  /**
   * Draw a named frame from a sprite sheet with its top-left at (x, y). `rotate` turns it a
   * quarter turn clockwise per 90 after the flips; (x, y) is then the turned box's top-left.
   * `scale` (default 1, unrotated frames only) draws it that many times its size, nearest
   * neighbour (the map's half-size trophy statues).
   */
  sprite(
    sheet: SpriteSheet,
    frame: string,
    x: number,
    y: number,
    flipX?: boolean,
    flipY?: boolean,
    rotate?: Rotation,
    scale?: number,
  ): void;
  /** Draw text with the bitmap font; `font` is a sheet whose frames are single characters. */
  text(font: SpriteSheet, str: string, x: number, y: number): void;
  /** Debug-only text using the canvas font (not pixel-perfect). */
  debugText(str: string, x: number, y: number, color?: string): void;
  line(x1: number, y1: number, x2: number, y2: number, color: string): void;
  /**
   * Optional (0.4.54): runs `draw`, clipped to the rectangle (x, y, w, h). A renderer without it
   * (the null and recording ones) draws unclipped: callers use `clipped` below.
   */
  clip?(x: number, y: number, w: number, h: number, draw: () => void): void;
  /**
   * Optional: runs `draw` at opacity `alpha` (0..1). A renderer without it (the null and
   * recording ones) draws opaque: callers use `translucent` below.
   */
  alpha?(alpha: number, draw: () => void): void;
  /**
   * Optional (Engine 0.16 T3): runs `draw` with blend mode `mode`: `add` adds its colours to what
   * is under it (the canvas's `lighter`). A renderer without it draws normally: callers use
   * `blended` below.
   */
  blend?(mode: BlendMode, draw: () => void): void;
  /**
   * Optional (Engine 0.16 T3): runs `draw` with a soft glow of `color`, `radius` picture px round
   * what it draws (the canvas's shadow blur). A renderer without it draws without: callers use
   * `glowing` below.
   */
  glow?(color: string, radius: number, draw: () => void): void;
  /**
   * Optional (Engine 0.16 part C T4): fills `g.box` (default the circle's square) with a radial
   * gradient round (`g.x`, `g.y`): `g.color` at each stop's `alpha`, the last stop's carried on
   * past `g.radius`. `mode` `normal` covers, `add` brightens, `erase` takes the alpha away (a hole
   * in a light map). A renderer without it draws nothing: callers use `radialFilled` below.
   */
  gradient?(g: RadialFill): void;
  /**
   * Optional (0.4.73): runs `draw` with the origin moved to (x, y), turned by `angle` radians
   * (clockwise) and scaled by (sx, sy) in the turned axes, so `draw` works about (0, 0). A
   * renderer without it only moves the origin: callers use `transformed` below.
   */
  transform?(
    x: number,
    y: number,
    angle: number,
    sx: number,
    sy: number,
    draw: (local: Renderer) => void,
  ): void;
}

/**
 * `draw` about (x, y), turned and scaled where `r` can (Renderer.transform); else only moved
 * there (the null and recording renderers, so a test still sees where it is drawn).
 */
export function transformed(
  r: Renderer,
  x: number,
  y: number,
  angle: number,
  sx: number,
  sy: number,
  draw: (local: Renderer) => void,
): void {
  if (r.transform) r.transform(x, y, angle, sx, sy, draw);
  else draw(new OffsetRenderer(r, x, y));
}

/** `draw` through `r` at opacity `alpha` where `r` can (Renderer.alpha), else opaque. */
export function translucent(r: Renderer, alpha: number, draw: () => void): void {
  if (alpha < 1 && r.alpha) r.alpha(alpha, draw);
  else draw();
}

/** How a drawing combines with what is under it: `normal` covers, `add` brightens. */
export type BlendMode = 'normal' | 'add';

/** `draw` through `r` with blend `mode` where `r` can (Renderer.blend), else normally. */
export function blended(r: Renderer, mode: BlendMode, draw: () => void): void {
  if (mode !== 'normal' && r.blend) r.blend(mode, draw);
  else draw();
}

/** `draw` through `r` with a glow where `r` can (Renderer.glow) and `radius` > 0, else plain. */
export function glowing(r: Renderer, color: string, radius: number, draw: () => void): void {
  if (radius > 0 && r.glow) r.glow(color, radius, draw);
  else draw();
}

/** `draw` through `r`, clipped to (x, y, w, h) where `r` can clip (Renderer.clip), else plain. */
export function clipped(r: Renderer, x: number, y: number, w: number, h: number, draw: () => void): void {
  if (r.clip) r.clip(x, y, w, h, draw);
  else draw();
}

/** How a radial fill combines with what is under it (`Renderer.gradient`). */
export type RadialMode = 'normal' | 'add' | 'erase';

/** A radial gradient fill (`Renderer.gradient`), in the renderer's pixels. */
export interface RadialFill {
  x: number;
  y: number;
  radius: number;
  color: string;
  /** `at` 0 (the centre) to 1 (the radius), ascending; `alpha` 0-1. */
  stops: readonly { at: number; alpha: number }[];
  mode: RadialMode;
  /** The box filled (default the circle's bounding square). */
  box?: { x: number; y: number; w: number; h: number };
  /**
   * Dithered (Engine 0.16 polish P, C1): drawn pixel by pixel as `ditheredRadial` in
   * `@engine/core/fx` gives it (an ordered Bayer dither by picture pixel, no RNG), not as a
   * smooth gradient, so every backend draws the same pixels and a falloff shows no rings.
   */
  dither?: RadialDither;
}

/** Fills `g` through `r` where `r` can (Renderer.gradient), else draws nothing. */
export function radialFilled(r: Renderer, g: RadialFill): void {
  if (r.gradient) r.gradient(g);
}

/** Quarter turns clockwise (Renderer.sprite). */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * Draws through `inner` moved by (dx, dy): a world drawn under a camera that also scrolls
 * vertically (World.render with a `free` camera). `clear` fills the whole target as before.
 */
export class OffsetRenderer implements Renderer {
  /** The target and the offset can be changed between frames (one instance reused). */
  constructor(
    public inner: Renderer,
    public dx: number,
    public dy: number,
  ) {}
  clear(color: string): void {
    this.inner.clear(color);
  }
  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.inner.rect(x + this.dx, y + this.dy, w, h, color);
  }
  sprite(
    sheet: SpriteSheet,
    frame: string,
    x: number,
    y: number,
    flipX?: boolean,
    flipY?: boolean,
    rotate?: Rotation,
    scale?: number,
  ): void {
    if (scale !== undefined && scale !== 1)
      this.inner.sprite(sheet, frame, x + this.dx, y + this.dy, flipX, flipY, rotate ?? 0, scale);
    else if (rotate) this.inner.sprite(sheet, frame, x + this.dx, y + this.dy, flipX, flipY, rotate);
    else this.inner.sprite(sheet, frame, x + this.dx, y + this.dy, flipX, flipY);
  }
  text(font: SpriteSheet, str: string, x: number, y: number): void {
    this.inner.text(font, str, x + this.dx, y + this.dy);
  }
  debugText(str: string, x: number, y: number, color?: string): void {
    this.inner.debugText(str, x + this.dx, y + this.dy, color);
  }
  line(x1: number, y1: number, x2: number, y2: number, color: string): void {
    this.inner.line(x1 + this.dx, y1 + this.dy, x2 + this.dx, y2 + this.dy, color);
  }
  clip(x: number, y: number, w: number, h: number, draw: () => void): void {
    clipped(this.inner, x + this.dx, y + this.dy, w, h, draw);
  }
  alpha(alpha: number, draw: () => void): void {
    translucent(this.inner, alpha, draw);
  }
  blend(mode: BlendMode, draw: () => void): void {
    blended(this.inner, mode, draw);
  }
  glow(color: string, radius: number, draw: () => void): void {
    glowing(this.inner, color, radius, draw);
  }
  gradient(g: RadialFill): void {
    const box = g.box ?? { x: g.x - g.radius, y: g.y - g.radius, w: g.radius * 2, h: g.radius * 2 };
    radialFilled(this.inner, {
      ...g,
      x: g.x + this.dx,
      y: g.y + this.dy,
      box: { ...box, x: box.x + this.dx, y: box.y + this.dy },
    });
  }
  transform(
    x: number,
    y: number,
    angle: number,
    sx: number,
    sy: number,
    draw: (local: Renderer) => void,
  ): void {
    transformed(this.inner, x + this.dx, y + this.dy, angle, sx, sy, draw);
  }
}
