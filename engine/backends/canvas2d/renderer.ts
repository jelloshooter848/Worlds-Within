import { ditheredRadial, parseHexColor } from '@engine/core/fx';
import type { BlendMode, RadialFill, Renderer, Rotation } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class CanvasRenderer implements Renderer {
  /** The scratch canvas a dithered fill's pixels are put on before they are drawn (made once, grown). */
  private scratch: { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Ctx } | null = null;

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
  blend(mode: BlendMode, draw: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = mode === 'add' ? 'lighter' : 'source-over';
    try {
      draw();
    } finally {
      ctx.restore();
    }
  }
  /**
   * A radial gradient (Engine 0.16 part C T4): `erase` is `destination-out`, `add` is `lighter`.
   * A dithered one (`g.dither`, Engine 0.16 polish P) is `ditheredRadial`'s pixels in `g.color`,
   * put on a scratch canvas and drawn with the same blend (`putImageData` takes no blend).
   */
  gradient(g: RadialFill): void {
    const ctx = this.ctx;
    if (g.dither !== undefined) {
      this.dithered(g);
      return;
    }
    // A context without radial gradients (a test's fake page, whose methods may return nothing) draws none.
    if (!(g.radius > 0) || typeof ctx.createRadialGradient !== 'function') return;
    const rgb = parseHexColor(g.color) ?? [0, 0, 0];
    const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius) as CanvasGradient | undefined;
    if (grad === undefined) return;
    for (const s of g.stops) {
      const a = Math.min(1, Math.max(0, s.alpha));
      grad.addColorStop(Math.min(1, Math.max(0, s.at)), `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
    }
    const box = g.box ?? { x: g.x - g.radius, y: g.y - g.radius, w: g.radius * 2, h: g.radius * 2 };
    ctx.save();
    ctx.globalCompositeOperation =
      g.mode === 'erase' ? 'destination-out' : g.mode === 'add' ? 'lighter' : 'source-over';
    ctx.fillStyle = grad;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }
  /** A dithered radial fill: its alpha bytes in `g.color` as image data, drawn through a scratch canvas. */
  private dithered(g: RadialFill): void {
    const ctx = this.ctx;
    const stamp = ditheredRadial(g, g.dither!, { width: ctx.canvas.width, height: ctx.canvas.height });
    if (stamp === null) return;
    const scratch = this.scratchFor(stamp.w, stamp.h);
    // A context without image data (a test's fake page) draws none.
    if (scratch === null || typeof scratch.ctx.createImageData !== 'function') return;
    const [r, gr, b] = parseHexColor(g.color) ?? [0, 0, 0];
    const img = scratch.ctx.createImageData(stamp.w, stamp.h) as ImageData | undefined;
    // A fake page's context may make no image data: it draws none.
    if (img?.data === undefined) return;
    const px = img.data;
    for (let i = 0; i < stamp.alpha.length; i++) {
      px[i * 4] = r;
      px[i * 4 + 1] = gr;
      px[i * 4 + 2] = b;
      px[i * 4 + 3] = stamp.alpha[i]!;
    }
    scratch.ctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation =
      g.mode === 'erase' ? 'destination-out' : g.mode === 'add' ? 'lighter' : 'source-over';
    ctx.drawImage(scratch.canvas, 0, 0, stamp.w, stamp.h, stamp.x, stamp.y, stamp.w, stamp.h);
    ctx.restore();
  }

  /** The scratch canvas, at least `w` x `h` (cleared where a fill is put), or null where none can be made. */
  private scratchFor(w: number, h: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Ctx } | null {
    const s = this.scratch;
    if (s !== null && s.canvas.width >= w && s.canvas.height >= h) return s;
    const width = Math.max(w, s?.canvas.width ?? 0);
    const height = Math.max(h, s?.canvas.height ?? 0);
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
    else if (typeof document !== 'undefined')
      canvas = Object.assign(document.createElement('canvas'), { width, height });
    else return null;
    const c = canvas.getContext('2d') as Ctx | null;
    if (c === null) return null;
    this.scratch = { canvas, ctx: c };
    return this.scratch;
  }

  glow(color: string, radius: number, draw: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = radius;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
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
