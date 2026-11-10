import type { SheetLookup } from '../assets/sheet-lookup';
import { transformed, translucent, type Renderer } from '../gfx/renderer';
import type { SpriteSheet } from '../gfx/spritesheet';
import type { FontLookup, UiFill, UiGlyph, UiImage, UiPainter } from '../ui';
import type { SurfaceFactory } from './surface';

export interface RendererUiPainterOptions {
  /**
   * Makes a surface for a font's glyphs in one colour, or null to draw each glyph's ink runs as
   * boxes every frame (default: none, so ink runs). Canvas2D's `CanvasUiPainter` passes an
   * offscreen canvas.
   */
  glyphSurface?: SurfaceFactory;
}

/**
 * A `UiPainter` (`../ui`, Engine 0.16 T6) on any `Renderer`, shared by the 2D backends (moved from
 * Canvas2D's `CanvasUiPainter` in Engine 0.16 T13b): a fill is `rect` (inside `translucent` below
 * alpha 1); an image is `sprite` of the frame's part, scaled with `transformed` when its box is
 * another size; a glyph is a copy from a strip of the font's glyphs in that colour, drawn once on
 * a `glyphSurface`, or, without a surface, its ink runs as boxes.
 */
export class RendererUiPainter implements UiPainter {
  private readonly parts = new Map<string, SpriteSheet | null>();
  private readonly strips = new Map<string, SpriteSheet | null>();

  constructor(
    private readonly r: Renderer,
    private readonly sheets: SheetLookup,
    private readonly fonts: FontLookup | undefined,
    private readonly opts: RendererUiPainterOptions = {},
  ) {}

  fill(d: UiFill): void {
    if (d.w <= 0 || d.h <= 0) return;
    const alpha = d.alpha ?? 1;
    if (alpha >= 1) this.r.rect(d.x, d.y, d.w, d.h, d.color);
    else if (alpha > 0) translucent(this.r, alpha, () => this.r.rect(d.x, d.y, d.w, d.h, d.color));
  }

  image(d: UiImage): void {
    if (d.w <= 0 || d.h <= 0 || d.sw <= 0 || d.sh <= 0) return;
    const sheet = this.sheets(d.sheet, d.palette);
    const rect = sheet?.frames.get(d.frame);
    if (!sheet || !rect) return;
    const whole = d.sx === 0 && d.sy === 0 && d.sw === rect.w && d.sh === rect.h;
    let from: SpriteSheet = sheet;
    let name = d.frame;
    if (!whole) {
      // A sheet holding only the frame's part (same image), cached by part.
      const key = `${d.sheet}@${d.palette ?? ''}#${d.frame}:${d.sx},${d.sy},${d.sw},${d.sh}`;
      let part = this.parts.get(key);
      if (part === undefined) {
        part = {
          id: key,
          image: sheet.image,
          frames: new Map([['part', { x: rect.x + d.sx, y: rect.y + d.sy, w: d.sw, h: d.sh }]]),
        };
        this.parts.set(key, part);
      }
      if (part === null) return;
      from = part;
      name = 'part';
    }
    if (d.w === d.sw && d.h === d.sh) this.r.sprite(from, name, d.x, d.y);
    else transformed(this.r, d.x, d.y, 0, d.w / d.sw, d.h / d.sh, (l) => l.sprite(from, name, 0, 0));
  }

  glyph(d: UiGlyph): void {
    const font = this.fonts?.(d.font);
    const glyph = font?.glyphs.get(d.ch);
    if (!font || !glyph) return;
    const strip = this.strip(d.font, d.color);
    if (strip !== null) {
      this.r.sprite(strip, d.ch, d.x, d.y);
      return;
    }
    for (const run of glyph.runs) this.r.rect(d.x + run.x, d.y + run.y, run.w, 1, d.color);
  }

  /** The font's glyphs side by side in one colour on a surface, or null where there is none. */
  private strip(id: string, color: string): SpriteSheet | null {
    const key = `${id}#${color}`;
    const cached = this.strips.get(key);
    if (cached !== undefined) return cached;
    const font = this.fonts?.(id);
    let strip: SpriteSheet | null = null;
    const make = this.opts.glyphSurface;
    if (font && make) {
      const width = [...font.glyphs.values()].reduce((w, g) => w + g.w + 1, 0);
      const surface = make(Math.max(1, width), font.cell.h);
      if (surface) {
        const frames = new Map<string, { x: number; y: number; w: number; h: number }>();
        let x = 0;
        for (const [ch, g] of font.glyphs) {
          for (const run of g.runs) surface.renderer.rect(x + run.x, run.y, run.w, 1, color);
          frames.set(ch, { x, y: 0, w: g.w, h: g.h });
          x += g.w + 1;
        }
        strip = { id: `font:${key}`, image: surface.image, frames };
      }
    }
    this.strips.set(key, strip);
    return strip;
  }
}
