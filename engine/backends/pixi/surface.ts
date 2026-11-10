import type { Container } from 'pixi.js';
import { RenderTexture } from 'pixi.js';
import type { DrawSurface, GlyphTint } from '@engine/core/draw';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { PixiRenderer, TintedImage } from './renderer';

/** What renders a surface's display list into its texture: a PixiJS renderer (`render`). */
export interface SurfaceTarget {
  render(options: { container: Container; target: RenderTexture; clear: boolean }): void;
}

/** A surface drawn since the last `flush`: its display list and the texture it goes into. */
export interface PendingSurface {
  readonly renderer: PixiRenderer;
  readonly texture: RenderTexture;
}

/**
 * PixiJS's drawing surfaces for the shared presenter and UI painter (Engine 0.16 T13b-3): the
 * cached map and each font's white glyph strip are `RenderTexture`s. `make(w, h)` is a
 * `SurfaceFactory`: a fresh `PixiRenderer` (drawing from the main renderer's sheet sources, so a
 * sheet's image goes to the GPU once) and its texture, put in the cache sheet as `image`. What it
 * draws is a display list until the display's `flush(gpu)` renders each waiting one into its
 * texture once, before the frame that copies from it (in Node nothing renders, so `waiting` shows
 * what would). `tint` is the UI painter's `tintGlyphs`: a colour's strip is the white one drawn
 * with that sprite tint (`TintedImage`), not another texture.
 */
export class PixiSurfaces {
  private pending: PendingSurface[] = [];

  constructor(private readonly main: PixiRenderer) {}

  readonly make = (width: number, height: number): DrawSurface => {
    const texture = RenderTexture.create({ width, height, scaleMode: 'nearest' });
    const renderer = new PixiRenderer({
      size: { width, height },
      sheetSource: (sheet) => this.main.sourceOf(sheet),
    });
    this.pending.push({ renderer, texture });
    return { renderer, image: texture as unknown as SpriteSheet['image'] };
  };

  readonly tint: GlyphTint = (white, color) =>
    new TintedImage(white as unknown as RenderTexture, color) as unknown as SpriteSheet['image'];

  /** The surfaces drawn but not rendered into their textures yet. */
  get waiting(): readonly PendingSurface[] {
    return this.pending;
  }

  /**
   * Renders each waiting surface's display list into its texture (once: the presenter draws a
   * map version or a glyph strip only when it makes the surface), then lets the list go.
   */
  flush(gpu: SurfaceTarget): void {
    for (const { renderer, texture } of this.pending) {
      gpu.render({ container: renderer.stage, target: texture, clear: true });
      renderer.beginFrame();
    }
    this.pending = [];
  }
}
