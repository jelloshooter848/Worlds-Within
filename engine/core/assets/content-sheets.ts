import type { ContentBundle } from '../content/bundle';
import { contentArt } from '../content/game-content';
import { resolvePalette } from '../gfx/palette';
import { rasterizeToBuffer, type Rasterized } from '../gfx/pixelart';
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
  return images === undefined || images.size === 0
    ? sprites
    : (id, palette) => images.get(id)?.sheet ?? sprites(id, palette);
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
