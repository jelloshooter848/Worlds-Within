import type { ContentBundle } from '@engine/core/content/bundle';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { SkinFile } from '@engine/core/present';
import { labSkin3d } from './content';

/**
 * What showing the lab in 3D needs from its content: the `three` skin (whose `background` is the
 * sky, gap G36) and the picture size, as `threeDisplay` (the page) and `threeScenePresenter` (Node tests) from
 * `@engine/backends/three` take them. The frames are the same `labFrames` as in 2D. No Three.js
 * here: `picture.ts` and `main.ts` stay free of it, so the 2D page bundles none.
 */
export interface LabLook3d {
  skin: SkinFile;
  screen: ScreenSize;
}

/** The lab's `three` skin (`content/skins/three.json`), picture size. */
export function labLook3d(content: ContentBundle): LabLook3d {
  return { skin: labSkin3d(content), screen: content.manifest.screen };
}
