import { contentPixelSheets, type PixelSheetLookup } from '@engine/core/assets/content-sheets';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { SkinFile } from '@engine/core/present';
import { classicSkins } from './content';

/**
 * What showing the platformer sample in 3D needs from its content: the `three` skin for the levels,
 * one per mini game (`three-vault.json` for the door's round), the sprite sheets as decoded pixels
 * for their HUD (gap G33) and the picture size (the sky is the skin's `background`, gap G36), as
 * the 3D backend's `threeDisplay` (the page) and `threeScenePresenter` (Node tests) take them.
 * The frames are the same `classicFrames` as in 2D. No Three.js here: `picture.ts` and `main.ts`
 * stay free of it, so the 2D page bundles none.
 */
export interface ClassicLook3d {
  skin: SkinFile;
  rounds: Record<string, SkinFile>;
  sheets: PixelSheetLookup;
  screen: ScreenSize;
}

/** The `three` skins (`content/skins/three.json`, `three-<mini game>.json`), HUD sheets, picture size. */
export function classicLook3d(content: ContentBundle): ClassicLook3d {
  const skins = classicSkins(content, 'three');
  return {
    skin: skins.level,
    rounds: skins.rounds,
    sheets: contentPixelSheets(content),
    screen: content.manifest.screen,
  };
}
