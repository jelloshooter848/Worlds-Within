import type { BlendMode, Renderer, Rotation } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';

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
