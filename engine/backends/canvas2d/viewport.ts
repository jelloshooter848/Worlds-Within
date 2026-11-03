import { DEFAULT_SCREEN, fitGame, type GameFit, type ScreenSize } from '@engine/core/gfx/screen';

export interface ViewportOptions {
  integerScale: boolean;
}

/**
 * Owns the backbuffer, the game's picture size (`screen` in `game.json`, 256x240 by default), and
 * presents it on the display canvas with integer scaling (or stretch-to-fit) and letterboxing.
 * Pixel art stays crisp: smoothing is off everywhere.
 */
export class Viewport {
  readonly back: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private readonly displayCtx: CanvasRenderingContext2D;
  scale = 1;
  /** Where the picture goes (set by the screen layout); empty centres it, as big as fits. */
  fit: GameFit = {};
  offsetX = 0;
  offsetY = 0;
  private dw: number;
  private dh: number;

  constructor(
    readonly display: HTMLCanvasElement,
    public opts: ViewportOptions = { integerScale: false },
    /** The game picture's size: the backbuffer's size in game px. */
    readonly size: ScreenSize = DEFAULT_SCREEN,
  ) {
    const { width, height } = size;
    this.dw = width;
    this.dh = height;
    this.back =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = this.back.getContext('2d') as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    const dctx = display.getContext('2d');
    if (!dctx) throw new Error('2D canvas not supported');
    this.displayCtx = dctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.display.clientWidth || window.innerWidth;
    const cssH = this.display.clientHeight || window.innerHeight;
    const W = Math.floor(cssW * dpr);
    const H = Math.floor(cssH * dpr);
    if (this.display.width !== W || this.display.height !== H) {
      this.display.width = W;
      this.display.height = H;
    }
    const box = fitGame(this.size, cssW, cssH, dpr, this.opts.integerScale, this.fit);
    this.scale = box.scale;
    this.dw = box.dw;
    this.dh = box.dh;
    this.offsetX = box.ox;
    this.offsetY = box.oy;
    this.displayCtx.imageSmoothingEnabled = false;
  }

  present(): void {
    const d = this.displayCtx;
    d.imageSmoothingEnabled = false;
    d.fillStyle = '#000';
    d.fillRect(0, 0, this.display.width, this.display.height);
    d.drawImage(this.back as CanvasImageSource, this.offsetX, this.offsetY, this.dw, this.dh);
  }

  /** Convert a client (CSS px) point to backbuffer coordinates. Used by touch controls and the editor. */
  toScreen(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.display.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = ((clientX - rect.left) * dpr - this.offsetX) / this.scale;
    const y = ((clientY - rect.top) * dpr - this.offsetY) / this.scale;
    return { x, y };
  }

  /** The inverse of `toScreen` (Engine 0.15, gap D13): a backbuffer point in client (CSS px) coordinates. */
  toClient(x: number, y: number): { x: number; y: number } {
    const rect = this.display.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: rect.left + (x * this.scale + this.offsetX) / dpr,
      y: rect.top + (y * this.scale + this.offsetY) / dpr,
    };
  }
}
