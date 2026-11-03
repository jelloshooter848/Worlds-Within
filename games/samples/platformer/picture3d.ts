import type { ContentBundle } from '@engine/core/content/bundle';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { SkinFile } from '@engine/core/present';
import { testSkins } from './content';

/**
 * What showing the stacking test in 3D needs from its content: the `three` skin for the levels,
 * one per mini game (`three-vault.json` for the door's round) and the picture size (the sky is the
 * skin's `background`, gap G36), as
 * the 3D backend's `threeDisplay` (the page) and `threeScenePresenter` (Node tests) take them.
 * The frames are the same `testFrames` as in 2D. No Three.js here: `picture.ts` and `main.ts`
 * stay free of it, so the 2D page bundles none.
 */
export interface TestLook3d {
  skin: SkinFile;
  rounds: Record<string, SkinFile>;
  screen: ScreenSize;
}

/** The `three` skins (`content/skins/three.json`, `three-<mini game>.json`), picture size. */
export function testLook3d(content: ContentBundle): TestLook3d {
  const skins = testSkins(content, 'three');
  return { skin: skins.level, rounds: skins.rounds, screen: content.manifest.screen };
}
