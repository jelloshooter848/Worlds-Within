import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import { FramePicture, FrameStream, type Presenter, type SkinFile } from '@engine/core/present';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import {
  platformerFrames,
  type PlatformerEvent,
  type PlatformerPresentState,
  type PlatformerWorld,
} from '@kits/platformer';
import { labSkin } from './content';

/**
 * Glue between the platformer kit's frames and the Canvas2D backend: no drawing of its own. The
 * lab's one stream of frames is the engine's `FrameStream` over the kit's `platformerFrames` (a
 * fresh present state per world, each frame frozen; while a mini game runs, its own frame); a
 * `FramePicture` hands each frame to a presenter. The backend and the skin decide how everything
 * looks. Shared by the page (`main.ts`), the view (`view.ts`, for `pnpm cli screenshot`) and the
 * tests, so a screenshot is what a player sees.
 */

/**
 * What drawing the lab needs from its content: the skin, its sheets and the picture size. The sky
 * is the skin's `background` (gap G36), which the backend clears to.
 */
export interface LabLook {
  skin: SkinFile;
  sheet: SheetLookup;
  screen: ScreenSize;
}

/** The lab's skin, its sprite sheets (from the sprite and palette files) and picture size. */
export function labLook(content: ContentBundle): LabLook {
  return {
    skin: labSkin(content),
    sheet: contentSheets(content),
    screen: content.manifest.screen,
  };
}

/** One stream of lab frames for any presenter: one per picture (a new level starts afresh). */
export type LabFrames = FrameStream<PlatformerWorld, PlatformerEvent, PlatformerPresentState>;

/** A new stream of lab frames at the picture size. */
export function labFrames(screen: ScreenSize): LabFrames {
  return new FrameStream(platformerFrames(screen));
}

/** The lab drawn onto a presenter: `draw(world, events)` presents one frame and returns it. */
export type LabPicture = FramePicture<PlatformerWorld, PlatformerEvent>;

/** One stream of lab frames onto any presenter (the display's, a 3D scene's, the null one). */
export function labPicture(presenter: Presenter, screen: ScreenSize): LabPicture {
  return new FramePicture(labFrames(screen), presenter);
}

/** One stream of lab frames onto `r` through the Canvas2D backend and the lab's skin. */
export function labCanvasPicture(r: Renderer, look: LabLook): LabPicture {
  const presenter = new SkinnedCanvasPresenter(r, look.skin, look.sheet, { size: look.screen });
  return labPicture(presenter, look.screen);
}
