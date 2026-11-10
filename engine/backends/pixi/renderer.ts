import {
  BufferImageSource,
  Color,
  Container,
  Graphics,
  ImageSource,
  type ImageResource,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TextureSource,
} from 'pixi.js';
import type { BlendMode, Renderer, Rotation } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';

/** Makes the texture source a sheet's frames are cut from (its image on the GPU). */
export type SheetSourceFactory = (sheet: SpriteSheet) => TextureSource;

export interface PixiRendererOptions {
  /** The picture size: what `clear` fills. */
  readonly size: ScreenSize;
  /** Where a sheet's pixels come from; the default wraps `sheet.image` (see `sheetSource`). */
  readonly sheetSource?: SheetSourceFactory;
}

/** How many of each pooled display object the renderer has made, and how many the frame uses. */
export interface PoolCounts {
  readonly sprites: number;
  readonly containers: number;
  readonly masks: number;
  readonly texts: number;
}

/**
 * A sheet's default texture source: its image (`ImageSource`, nearest neighbour), or, for a
 * headless sheet with no image (Node, tests), an empty source as large as its frames, so the
 * display list is still built and checked.
 */
export function sheetSource(sheet: SpriteSheet): TextureSource {
  if (sheet.image) {
    return new ImageSource({
      resource: sheet.image as ImageResource,
      scaleMode: 'nearest',
    });
  }
  let width = 1;
  let height = 1;
  for (const f of sheet.frames.values()) {
    width = Math.max(width, f.x + f.w);
    height = Math.max(height, f.y + f.h);
  }
  return new TextureSource({ width, height, scaleMode: 'nearest' });
}

/** A free list of one kind of display object: `take` reuses one made in an earlier frame. */
class Pool<T> {
  private readonly items: T[] = [];
  used = 0;
  constructor(private readonly make: () => T) {}
  take(): T {
    let item = this.items[this.used];
    if (!item) {
      item = this.make();
      this.items.push(item);
    }
    this.used++;
    return item;
  }
  get made(): number {
    return this.items.length;
  }
}

/** Side of the glow halo texture, in texels (stretched to each glowing box). */
export const HALO_SIZE = 32;

let haloTexture: Texture | undefined;

/**
 * The glow's soft halo: a white ellipse whose alpha falls from 1 at the centre to 0 at the edge
 * (squared falloff, premultiplied), made once from bytes so it needs no canvas.
 */
export function glowHalo(): Texture {
  if (haloTexture) return haloTexture;
  const n = HALO_SIZE;
  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) / n) * 2 - 1;
      const v = ((y + 0.5) / n) * 2 - 1;
      const t = Math.max(0, 1 - Math.hypot(u, v));
      const a = Math.round(t * t * 255);
      const i = (y * n + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = px[i + 3] = a;
    }
  }
  const source = new BufferImageSource({
    resource: px,
    width: n,
    height: n,
    alphaMode: 'premultiplied-alpha',
    scaleMode: 'linear',
  });
  haloTexture = new Texture({ source });
  return haloTexture;
}

interface Tint {
  readonly rgb: number;
  readonly alpha: number;
}

interface Glow {
  readonly tint: Tint;
  readonly radius: number;
}

interface SheetTextures {
  readonly source: TextureSource;
  readonly frames: Map<string, Texture>;
}

/** Rotation in radians per quarter turn (Renderer.sprite's `rotate`). */
const QUARTER = Math.PI / 2;

/**
 * The core `Renderer` contract over a PixiJS v8 display list (Engine 0.16 T13b). The API stays
 * immediate mode: each call adds a display object to `stage`, and `beginFrame` (or a top-level
 * `clear`) empties it again. The objects come from pools and are reused frame after frame, so a
 * steady scene allocates nothing and PixiJS batches its sprites: rectangles and lines are the
 * white texture tinted, sprites are cached sub-rectangle textures of their sheet, a glow is a
 * pre-made soft halo sprite behind each glowing shape. Scopes (`clip`, `alpha`, `blend`,
 * `transform`) are pooled containers that nest what `draw` adds. It never draws on its own: a
 * PixiJS renderer renders `stage` (the display, a later task).
 */
export class PixiRenderer implements Renderer {
  /** The root of the frame's display list. */
  readonly stage = new Container();
  private parent: Container = this.stage;
  private depth = 0;
  private readonly glows: Glow[] = [];
  private readonly sprites = new Pool(() => new Sprite());
  private readonly containers = new Pool(() => new Container());
  private readonly masks = new Pool(() => new Graphics());
  private readonly texts = new Pool(
    () => new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 8, fill: 0xffffff } }),
  );
  private readonly sheets = new WeakMap<SpriteSheet, SheetTextures>();
  private readonly tints = new Map<string, Tint>();
  private readonly size: ScreenSize;
  private readonly sheetSource: SheetSourceFactory;

  constructor(opts: PixiRendererOptions) {
    this.size = opts.size;
    this.sheetSource = opts.sheetSource ?? sheetSource;
  }

  /** Empties the display list for a new frame; its objects go back to their pools. */
  beginFrame(): void {
    this.stage.removeChildren();
    this.parent = this.stage;
    this.depth = 0;
    this.glows.length = 0;
    this.sprites.used = 0;
    this.containers.used = 0;
    this.masks.used = 0;
    this.texts.used = 0;
  }

  /** Pooled objects in use this frame (`used`) and made so far (`made`). */
  pools(): { used: PoolCounts; made: PoolCounts } {
    return {
      used: {
        sprites: this.sprites.used,
        containers: this.containers.used,
        masks: this.masks.used,
        texts: this.texts.used,
      },
      made: {
        sprites: this.sprites.made,
        containers: this.containers.made,
        masks: this.masks.made,
        texts: this.texts.made,
      },
    };
  }

  /**
   * Fills the picture with `color`. Outside every scope it starts the frame over first (all that
   * was drawn is covered anyway); inside one it adds a picture-sized box there.
   */
  clear(color: string): void {
    if (this.depth === 0) this.beginFrame();
    this.box(0, 0, this.size.width, this.size.height, this.tint(color));
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    const x0 = x | 0;
    const y0 = y | 0;
    const tint = this.tint(color);
    this.halo(x0, y0, w | 0, h | 0);
    this.box(x0, y0, w | 0, h | 0, tint);
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
    const texture = this.frameTexture(sheet, frame);
    if (!texture) return;
    const fw = texture.frame.width;
    const fh = texture.frame.height;
    // As the canvas renderer: scale only unrotated, whole pixels, at least 1.
    const scaled = scale !== 1 && !rotate;
    const w = scaled ? Math.max(1, Math.round(fw * scale)) : fw;
    const h = scaled ? Math.max(1, Math.round(fh * scale)) : fh;
    const turned = rotate === 90 || rotate === 270;
    const bw = turned ? h : w;
    const bh = turned ? w : h;
    const x0 = x | 0;
    const y0 = y | 0;
    this.halo(x0, y0, bw, bh);
    // Centred anchor: flip (negative scale) and turn about the box's centre, which is the same
    // matrix (translate, rotate, then flip) the canvas renderer builds.
    const s = this.sprites.take();
    s.texture = texture;
    s.anchor.set(0.5, 0.5);
    s.position.set(x0 + bw / 2, y0 + bh / 2);
    s.rotation = (rotate / 90) * QUARTER;
    s.scale.set(((flipX ? -1 : 1) * w) / fw, ((flipY ? -1 : 1) * h) / fh);
    s.tint = 0xffffff;
    s.alpha = 1;
    this.parent.addChild(s);
  }

  text(font: SpriteSheet, str: string, x: number, y: number): void {
    let cx = x | 0;
    for (const ch of str) {
      if (ch !== ' ') this.sprite(font, ch, cx, y);
      cx += 8;
    }
  }

  /** The canvas's `fillText` puts `y` on the baseline; a PixiJS text's top sits about 7 px above. */
  debugText(str: string, x: number, y: number, color = '#fff'): void {
    const t = this.texts.take();
    const tint = this.tint(color);
    t.text = str;
    t.style.fill = tint.rgb;
    t.alpha = tint.alpha;
    t.position.set(x, y - 7);
    this.parent.addChild(t);
  }

  /** A 1 px wide white sprite from pixel centre to pixel centre, as the canvas strokes it. */
  line(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const tint = this.tint(color);
    const dx = x2 - x1;
    const dy = y2 - y1;
    this.halo(Math.min(x1, x2), Math.min(y1, y2), Math.abs(dx) + 1, Math.abs(dy) + 1);
    const s = this.white(tint);
    s.anchor.set(0, 0.5);
    s.position.set(x1 + 0.5, y1 + 0.5);
    s.rotation = Math.atan2(dy, dx);
    s.scale.set(Math.hypot(dx, dy), 1);
    this.parent.addChild(s);
  }

  /** A container masked by a pooled rectangle `Graphics` (an axis-aligned one: a scissor). */
  clip(x: number, y: number, w: number, h: number, draw: () => void): void {
    const c = this.container();
    const m = this.masks.take();
    m.clear()
      .rect(x | 0, y | 0, w | 0, h | 0)
      .fill(0xffffff);
    c.addChild(m);
    c.mask = m;
    this.scope(c, draw);
  }

  alpha(alpha: number, draw: () => void): void {
    const c = this.container();
    c.alpha = alpha;
    this.scope(c, draw);
  }

  /** A container with PixiJS's `blendMode` (`add` for add); its children inherit it. */
  blend(mode: BlendMode, draw: () => void): void {
    const c = this.container();
    c.blendMode = mode === 'add' ? 'add' : 'normal';
    this.scope(c, draw);
  }

  /**
   * While `draw` runs, each box, sprite and line gets a halo sprite behind it: the shared soft
   * halo texture (`glowHalo`) tinted `color`, stretched over its box grown by `radius` on each
   * side. It batches with everything else; a PixiJS filter would render each glowing scope to
   * its own texture. The halo is an ellipse over the box, not the shape's outline.
   */
  glow(color: string, radius: number, draw: () => void): void {
    this.glows.push({ tint: this.tint(color), radius });
    try {
      draw();
    } finally {
      this.glows.pop();
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
    const c = this.container();
    c.position.set(x, y);
    c.rotation = angle;
    c.scale.set(sx, sy);
    this.scope(c, () => draw(this));
  }

  /** The cached texture of a sheet frame: a sub-rectangle of the sheet's one texture source. */
  private frameTexture(sheet: SpriteSheet, frame: string): Texture | undefined {
    let cached = this.sheets.get(sheet);
    if (!cached) {
      cached = { source: this.sheetSource(sheet), frames: new Map() };
      this.sheets.set(sheet, cached);
    }
    let texture = cached.frames.get(frame);
    if (!texture) {
      const f = sheet.frames.get(frame);
      if (!f) return undefined;
      texture = new Texture({ source: cached.source, frame: new Rectangle(f.x, f.y, f.w, f.h) });
      cached.frames.set(frame, texture);
    }
    return texture;
  }

  private tint(color: string): Tint {
    let tint = this.tints.get(color);
    if (!tint) {
      const c = new Color(color);
      tint = { rgb: c.toNumber(), alpha: c.alpha };
      this.tints.set(color, tint);
    }
    return tint;
  }

  /** A pooled sprite of the 1x1 white texture, tinted, unturned, with its anchor at 0. */
  private white(tint: Tint): Sprite {
    const s = this.sprites.take();
    s.texture = Texture.WHITE;
    s.anchor.set(0, 0);
    s.rotation = 0;
    s.tint = tint.rgb;
    s.alpha = tint.alpha;
    return s;
  }

  private box(x: number, y: number, w: number, h: number, tint: Tint): void {
    const s = this.white(tint);
    s.position.set(x, y);
    s.scale.set(w, h);
    this.parent.addChild(s);
  }

  /** The current glow's halo behind the box (x, y, w, h), if a glow is on. */
  private halo(x: number, y: number, w: number, h: number): void {
    const g = this.glows[this.glows.length - 1];
    if (!g) return;
    const s = this.sprites.take();
    s.texture = glowHalo();
    s.anchor.set(0, 0);
    s.rotation = 0;
    s.tint = g.tint.rgb;
    s.alpha = g.tint.alpha;
    s.position.set(x - g.radius, y - g.radius);
    // The halo texture is HALO_SIZE texels; scale it to the grown box.
    s.scale.set((w + 2 * g.radius) / HALO_SIZE, (h + 2 * g.radius) / HALO_SIZE);
    this.parent.addChild(s);
  }

  /** A pooled container reset to identity, opaque, inherited blending and no mask. */
  private container(): Container {
    const c = this.containers.take();
    c.removeChildren();
    c.mask = null;
    c.position.set(0, 0);
    c.rotation = 0;
    c.scale.set(1, 1);
    c.alpha = 1;
    c.blendMode = 'inherit';
    return c;
  }

  private scope(c: Container, draw: () => void): void {
    const prev = this.parent;
    prev.addChild(c);
    this.parent = c;
    this.depth++;
    try {
      draw();
    } finally {
      this.parent = prev;
      this.depth--;
    }
  }
}
