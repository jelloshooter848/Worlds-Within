import type { ContentBundle } from '../content/bundle';
import { contentArt } from '../content/game-content';
import { resolvePalette } from '../gfx/palette';
import { rasterizeToBuffer, type Rasterized } from '../gfx/pixelart';
import type { SpriteSheet } from '../gfx/spritesheet';
import { isSilhouettePalette } from '../present/skin';
import { AssetRegistry } from './registry';
import { sheetLookup, type SheetLookup } from './sheet-lookup';

/**
 * A game's sprite sheets as a `SheetLookup` for a backend's presenter: every sprite file of the
 * bundle defined in an `AssetRegistry` over its palette files (`contentArt`). The three lines
 * each game's `picture.ts` wrote for itself (Engine 0.7 T9, gap G35 in
 * docs/reports/stacking-test.md). Sheets are drawn when first asked for (a canvas in the
 * browser), so this is not pure; Node tests that only need ids may still call it. A bundle that
 * went through `withContentImages` (`content-images.ts`, Engine 0.16 T10) also gives each skin's
 * PNG sheets, by image id.
 */
export function contentSheets(content: ContentBundle): SheetLookup {
  const art = contentArt(content);
  const assets = new AssetRegistry({ default: art.palettes });
  assets.defineAll(art.sprites);
  const sprites = sheetLookup(assets);
  const images = content.images;
  // A skin's PNG sheet (Engine 0.16 T10), once `withContentImages` decoded it, by its image id.
  // A palette does not recolour a PNG: the image is drawn as it is.
  const plain: SheetLookup =
    images === undefined || images.size === 0
      ? sprites
      : (id, palette) => images.get(id)?.sheet ?? sprites(id, palette);
  // A colour as the palette (Engine 0.16 F8) draws the sheet as a silhouette in it: a hit flash.
  const silhouettes = new Map<string, SpriteSheet | null>();
  return (id, palette) => {
    if (palette === undefined || !isSilhouettePalette(palette)) return plain(id, palette);
    const key = `${id}@${palette}`;
    if (!silhouettes.has(key)) {
      const base = plain(id, undefined);
      silhouettes.set(key, base === null ? null : silhouetteSheet(base, palette));
    }
    return silhouettes.get(key)!;
  };
}

/**
 * A copy of `sheet` whose every opaque pixel is `color` (keeping its alpha), drawn once on a
 * canvas: the frames' silhouettes, for a hit flash. Where there is no canvas (Node) or no image,
 * the sheet itself.
 */
export function silhouetteSheet(sheet: SpriteSheet, color: string): SpriteSheet {
  const image = sheet.image as (CanvasImageSource & { width?: unknown; height?: unknown }) | null;
  if (image === null || typeof document === 'undefined') return sheet;
  const width = Number(image.width);
  const height = Number(image.height);
  if (!(width > 0 && height > 0)) return sheet;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return sheet;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return { id: `${sheet.id}@${color}`, image: canvas, frames: sheet.frames };
}

/**
 * Finds a sprite sheet's decoded pixels by id (optionally recoloured with a palette): RGBA rows
 * and each frame's rect, or null when there is no such sheet or palette. For a backend that
 * uploads pixels itself rather than drawing a canvas image (the 3D backend's HUD, gap G33).
 */
export type PixelSheetLookup = (id: string, palette?: string) => Rasterized | null;

/**
 * A game's sprite files as decoded pixels (`rasterizeToBuffer` over its palette files, default
 * colour mode), each sheet decoded once when first asked for. Needs no canvas, so it runs in Node
 * (Engine 0.15, gap G33). Never throws: a missing sheet or palette is null.
 */
export function contentPixelSheets(content: ContentBundle): PixelSheetLookup {
  const art = contentArt(content);
  const decoded = new Map<string, Rasterized | null>();
  const images = content.images;
  return (id, palette) => {
    // A skin's PNG sheet (Engine 0.16 T10) once decoded: its pixels and frames, as they are.
    const image = images?.get(id);
    if (image !== undefined) return image.pixels;
    const key = palette ? `${id}@${palette}` : id;
    if (decoded.has(key)) return decoded.get(key)!;
    let pixels: Rasterized | null = null;
    const def = Object.hasOwn(art.sprites, id) ? art.sprites[id] : undefined;
    if (def) {
      try {
        pixels = rasterizeToBuffer(
          def,
          resolvePalette({ default: art.palettes }, palette ?? def.palette, 'default'),
        );
      } catch {
        pixels = null;
      }
    }
    decoded.set(key, pixels);
    return pixels;
  };
}
