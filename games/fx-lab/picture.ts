import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import { FramePicture, FrameStream, type Presenter, type SkinFile } from '@engine/core/present';
import { contentFonts, type FontLookup } from '@engine/core/ui';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import {
  platformerFrames,
  type PlatformerEvent,
  type PlatformerPresentState,
  type PlatformerWorld,
} from '@kits/platformer';
import { fxSkin } from './content';

/**
 * Glue between the platformer kit's frames and the Canvas2D backend: no drawing of its own. One
 * stream of frames (the engine's `FrameStream` over the kit's `platformerFrames`) goes to a
 * presenter; the skin (`content/skins/canvas2d.json`) decides every look, animation, frame event,
 * sound and effect. Shared by the page (`main.ts`), the view (`view.ts`, for `pnpm cli
 * screenshot`) and the tests, so a screenshot is what a player sees.
 */

/** What drawing the lab needs: the skin, its sheets and the picture size. */
export interface FxLook {
  skin: SkinFile;
  sheet: SheetLookup;
  /** The font files (`content/fonts/`, Engine 0.16 T6) the HUD's text and counters use. */
  fonts: FontLookup;
  screen: ScreenSize;
}

/** The `canvas2d` skin, the sprite sheets (from the sprite and palette files), the fonts and the picture size. */
export function fxLook(content: ContentBundle): FxLook {
  return {
    skin: fxSkin(content, 'canvas2d'),
    sheet: contentSheets(content),
    fonts: contentFonts(content),
    screen: content.manifest.screen,
  };
}

/** One stream of frames for any presenter (a new level starts afresh). */
export type FxFrames = FrameStream<PlatformerWorld, PlatformerEvent, PlatformerPresentState>;

/** A new stream of frames at the picture size. */
export function fxFrames(screen: ScreenSize): FxFrames {
  return new FrameStream(platformerFrames(screen));
}

/** The lab drawn onto a presenter: `draw(world, events)` presents one frame and returns it. */
export type FxPicture = FramePicture<PlatformerWorld, PlatformerEvent>;

/** One stream of frames onto any presenter (the display's, a 3D scene's). */
export function fxPicture(presenter: Presenter, screen: ScreenSize): FxPicture {
  return new FramePicture(fxFrames(screen), presenter);
}

/** One stream of frames onto `r` through the Canvas2D backend and the lab's skin. */
export function fxCanvasPicture(r: Renderer, look: FxLook, onSound?: (id: string) => void): FxPicture {
  const presenter = new SkinnedCanvasPresenter(r, look.skin, look.sheet, {
    size: look.screen,
    fonts: look.fonts,
    ...(onSound !== undefined && { onSound }),
  });
  return fxPicture(presenter, look.screen);
}
