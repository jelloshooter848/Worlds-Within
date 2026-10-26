import type { SpriteSheet } from './spritesheet';

/**
 * Everything the game draws goes through this interface so the headless sim can use a
 * NullRenderer and the game logic never touches the DOM.
 * Coordinates are screen pixels (0..256, 0..240); callers subtract the camera.
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

/** `draw` through `r`, clipped to (x, y, w, h) where `r` can clip (Renderer.clip), else plain. */
export function clipped(r: Renderer, x: number, y: number, w: number, h: number, draw: () => void): void {
  if (r.clip) r.clip(x, y, w, h, draw);
  else draw();
}

/** Quarter turns clockwise (Renderer.sprite). */
export type Rotation = 0 | 90 | 180 | 270;

export class NullRenderer implements Renderer {
  clear(): void {}
  rect(): void {}
  sprite(): void {}
  text(): void {}
  debugText(): void {}
  line(): void {}
}

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

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class CanvasRenderer implements Renderer {
  constructor(private readonly ctx: Ctx) {
    ctx.imageSmoothingEnabled = false;
  }
  clear(color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }
  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }
  sprite(
    sheet: SpriteSheet,
    frame: string,
    x: number,
    y: number,
    flipX = false,
    flipY = false,
    rotate: Rotation = 0,
    scale = 1,
  ): void {
    const f = sheet.frames.get(frame);
    if (!f) return;
    const ctx = this.ctx;
    if (scale !== 1 && !rotate) {
      // Nearest neighbour (imageSmoothingEnabled is off), whole pixels.
      const w = Math.max(1, Math.round(f.w * scale));
      const h = Math.max(1, Math.round(f.h * scale));
      ctx.save();
      ctx.translate((x | 0) + (flipX ? w : 0), (y | 0) + (flipY ? h : 0));
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(sheet.image as CanvasImageSource, f.x, f.y, f.w, f.h, 0, 0, w, h);
      ctx.restore();
      return;
    }
    if (rotate) {
      // Move the origin to where the frame's top-left lands once turned, turn, then flip inside.
      const x0 = x | 0;
      const y0 = y | 0;
      ctx.save();
      if (rotate === 90) ctx.translate(x0 + f.h, y0);
      else if (rotate === 180) ctx.translate(x0 + f.w, y0 + f.h);
      else ctx.translate(x0, y0 + f.w);
      ctx.rotate((rotate * Math.PI) / 180);
      if (flipX || flipY) {
        ctx.translate(flipX ? f.w : 0, flipY ? f.h : 0);
        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      }
      ctx.drawImage(sheet.image as CanvasImageSource, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      ctx.restore();
    } else if (flipX || flipY) {
      ctx.save();
      ctx.translate((x | 0) + (flipX ? f.w : 0), (y | 0) + (flipY ? f.h : 0));
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(sheet.image as CanvasImageSource, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      ctx.restore();
    } else {
      ctx.drawImage(sheet.image as CanvasImageSource, f.x, f.y, f.w, f.h, x | 0, y | 0, f.w, f.h);
    }
  }
  text(font: SpriteSheet, str: string, x: number, y: number): void {
    let cx = x | 0;
    for (const ch of str) {
      if (ch !== ' ') this.sprite(font, ch, cx, y);
      cx += 8;
    }
  }
  debugText(str: string, x: number, y: number, color = '#fff'): void {
    this.ctx.font = '8px monospace';
    this.ctx.fillStyle = color;
    this.ctx.fillText(str, x, y);
  }
  clip(x: number, y: number, w: number, h: number, draw: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x | 0, y | 0, w | 0, h | 0);
    ctx.clip();
    try {
      draw();
    } finally {
      ctx.restore();
    }
  }
  alpha(alpha: number, draw: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha *= alpha;
    try {
      draw();
    } finally {
      ctx.restore();
    }
  }
  transform(
    x: number,
    y: number,
    angle: number,
    sx: number,
    sy: number,
    draw: (local: Renderer) => void,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.scale(sx, sy);
    try {
      draw(this);
    } finally {
      ctx.restore();
    }
  }
  line(x1: number, y1: number, x2: number, y2: number, color: string): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(x1 + 0.5, y1 + 0.5);
    this.ctx.lineTo(x2 + 0.5, y2 + 0.5);
    this.ctx.stroke();
  }
}
