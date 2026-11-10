import { contentPixelSheets, type PixelSheetLookup } from '@engine/core/assets/content-sheets';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { SkinFile } from '@engine/core/present';
import { fxSkin } from './content';

/**
 * What showing the lab in 3D needs: the `three` skin (low-poly meshes with a `poses` set for
 * every animated kind), the sprite sheets as decoded pixels for its HUD and the picture size, as
 * `threeDisplay` (the page) and `threeScenePresenter` (Node tests) take them. No Three.js here, so
 * the 2D page bundles none.
 */
export interface FxLook3d {
  skin: SkinFile;
  sheets: PixelSheetLookup;
  screen: ScreenSize;
}

/** The `three` skin (`content/skins/three.json`), the HUD sheets and the picture size. */
export function fxLook3d(content: ContentBundle): FxLook3d {
  return {
    skin: fxSkin(content, 'three'),
    sheets: contentPixelSheets(content),
    screen: content.manifest.screen,
  };
}
