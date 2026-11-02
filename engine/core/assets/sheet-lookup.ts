import type { SpriteSheet } from '../gfx/spritesheet';
import type { AssetRegistry } from './registry';

/** Finds a sprite sheet by id (optionally recoloured with a palette), or null when there is none. */
export type SheetLookup = (id: string, palette?: string) => SpriteSheet | null;

/**
 * A sheet getter that never throws: a sheet or palette that is not registered (yet) is null, so
 * callers draw a flat placeholder or the plain sheet. Only misses are remembered; hits go to the
 * registry each time, which caches them itself and drops them when the colour mode changes.
 * Backends (`SkinnedCanvasPresenter`) and games use it.
 */
export function sheetLookup(assets: AssetRegistry): SheetLookup {
  const missing = new Set<string>();
  return (id, palette) => {
    const key = palette ? `${id}@${palette}` : id;
    if (missing.has(key) || !assets.has(id)) return null;
    try {
      return assets.sheet(id, palette);
    } catch {
      missing.add(key);
      return null;
    }
  };
}
