import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import { FramePicture, FrameStream, type Presenter, type SkinFile } from '@engine/core/present';
import { skinSetCanvasPresenter } from '@engine/backends/canvas2d';
import { contentFonts, type FontLookup } from '@engine/core/ui';
import {
  platformerFrames,
  type PlatformerEvent,
  type PlatformerPresentState,
  type PlatformerWorld,
} from '@kits/platformer';
import { hopperSkins } from './content';

/**
 * Glue between the platformer kit's frames and the Canvas2D backend: no drawing of its own. One
 * stream of frames (the engine's `FrameStream` over the kit's `platformerFrames`) goes to the
 * backend's `skinSetCanvasPresenter` with the level skin, framing the map as the skin's `camera`
 * says. Shared by the page (`main.ts`), the view (`view.ts`, for `pnpm cli screenshot`) and the
 * tests, so a screenshot is what a player sees. The sheets are the engine's `contentSheets`.
 */

/**
 * What drawing the game needs: the level skin, a skin per mini game, the sheets and size (as the
 * backend's `canvasDisplay` and `skinSetCanvasPresenter` take them). The sky is the level skin's
 * `background` (gap G36): the backend clears to it, so no colour lives in the glue.
 */
export interface HopperLook {
  skin: SkinFile;
  rounds: Record<string, SkinFile>;
  sheet: SheetLookup;
  screen: ScreenSize;
  /** The font files (`content/fonts/`) the HUD's counters and the menus draw text with. */
  fonts: FontLookup;
}

/** The `canvas2d` skins, the sprite sheets (sprite and palette files, the skins' PNGs), the fonts and size. */
export function hopperLook(content: ContentBundle): HopperLook {
  const skins = hopperSkins(content, 'canvas2d');
  return {
    skin: skins.level,
    rounds: skins.rounds,
    sheet: contentSheets(content),
    screen: content.manifest.screen,
    fonts: contentFonts(content),
  };
}

/** One stream of frames for any presenter: one per picture (a new level starts afresh). */
export type HopperFrames = FrameStream<PlatformerWorld, PlatformerEvent, PlatformerPresentState>;

/** A new stream of frames at the picture size. */
export function hopperFrames(screen: ScreenSize): HopperFrames {
  return new FrameStream(platformerFrames(screen));
}

/** The game drawn onto a presenter: `draw(world, events)` presents one frame and returns it. */
export type HopperPicture = FramePicture<PlatformerWorld, PlatformerEvent>;

/** One stream of frames onto any presenter. */
export function hopperPicture(presenter: Presenter, screen: ScreenSize): HopperPicture {
  return new FramePicture(hopperFrames(screen), presenter);
}

/** One stream of frames onto `r` through the Canvas2D backend and the game's skins. */
export function hopperCanvasPicture(r: Renderer, look: HopperLook): HopperPicture {
  return hopperPicture(skinSetCanvasPresenter(r, look), look.screen);
}
