import { contentPixelSheets, type PixelSheetLookup } from '@engine/core/assets/content-sheets';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { SkinFile } from '@engine/core/present';
import { hopperSkins } from './content';

/**
 * What showing Hopper's Way in 3D needs from its content: the `three` skin, the sprite sheets as
 * decoded pixels for its HUD and the picture size (the sky is the skin's `background`), as the 3D
 * backend's `threeDisplay` (the page) and `threeScenePresenter` (Node tests) take them. The
 * frames are the same `hopperFrames` as in 2D. No Three.js here: `picture.ts` and `main.ts` stay
 * free of it, so the 2D page bundles none.
 */
export interface HopperLook3d {
  skin: SkinFile;
  rounds: Record<string, SkinFile>;
  sheets: PixelSheetLookup;
  screen: ScreenSize;
}

/** The `three` skins (`content/skins/three.json`, `three-<mini game>.json`), HUD sheets, picture size. */
export function hopperLook3d(content: ContentBundle): HopperLook3d {
  const skins = hopperSkins(content, 'three');
  return {
    skin: skins.level,
    rounds: skins.rounds,
    sheets: contentPixelSheets(content),
    screen: content.manifest.screen,
  };
}
