import type { ContentBundle } from '../content/bundle';
import { contentArt } from '../content/game-content';
import { AssetRegistry } from './registry';
import { sheetLookup, type SheetLookup } from './sheet-lookup';

/**
 * A game's sprite sheets as a `SheetLookup` for a backend's presenter: every sprite file of the
 * bundle defined in an `AssetRegistry` over its palette files (`contentArt`). The three lines
 * each game's `picture.ts` wrote for itself (Engine 0.7 T9, gap G35 in
 * docs/reports/stacking-test.md). Sheets are drawn when first asked for (a canvas in the
 * browser), so this is not pure; Node tests that only need ids may still call it.
 */
export function contentSheets(content: ContentBundle): SheetLookup {
  const art = contentArt(content);
  const assets = new AssetRegistry({ default: art.palettes });
  assets.defineAll(art.sprites);
  return sheetLookup(assets);
}
