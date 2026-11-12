import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import { FramePicture, FrameStream, mustSkinSet, type Presenter, type SkinFile } from '@engine/core/present';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import { contentFonts, type FontLookup } from '@engine/core/ui';
import {
  tdFrames,
  type TdCursorView,
  type TdEvent,
  type TdPresentState,
  type TdWorld,
} from '@kits/towerdefense';

/**
 * Glue between the tower-defense kit's frames and the Canvas2D backend: no drawing of its own. One
 * stream of frames (the engine's `FrameStream` over the kit's `tdFrames`, with the player's
 * cursor) goes to the backend's `SkinnedCanvasPresenter` with the sample's skin
 * (`content/skins/canvas2d.json`). Shared by the page (`main.ts`), the view (`view.ts`, for `pnpm
 * cli screenshot`) and the tests, so a screenshot is what a player sees.
 *
 * The skin (Engine 0.16 E7: Kenney's CC0 Tower Defense pack, `assets/`) is keyed on the kit's
 * kinds (`tower:arrow`, `enemy:runner`, `ghost:cannon`, `cursor`, ...) and tags: a tower's look by
 * its `level:`, the ghost red by its `blocked` tag and ringed by its `range:` (on a tower, the
 * `selected` tower's), an enemy flashed white by `hit`, ice blue by `slow` and given a health bar
 * by `hp:` against `maxhp:`. The bundle's PNG sheets must be decoded first (`withContentImages`)
 * for the backend to draw them.
 */

/**
 * What drawing the game needs: the skin, the sprite sheets, the font files (the HUD's wave
 * preview, sell value and speed, Engine 0.16 E9) and the picture size. The colour behind the map
 * (the grass) is the skin's `background` (gap G36), which the backend clears to.
 */
export interface TdLook {
  skin: SkinFile;
  sheet: SheetLookup;
  fonts: FontLookup;
  screen: ScreenSize;
}

/** The `canvas2d` skin, the sprite sheets (from the sprite and palette files) and size. */
export function tdLook(content: ContentBundle): TdLook {
  return {
    skin: mustSkinSet(content, 'canvas2d', 'the tower-defense sample').main,
    sheet: contentSheets(content),
    fonts: contentFonts(content),
    screen: content.manifest.screen,
  };
}

/** The player's cursor each frame (`TdControls.view()`), or null for none. */
export type CursorFeed = () => TdCursorView | null;

/** One stream of frames for any presenter. */
export type TdFrames = FrameStream<TdWorld, TdEvent, TdPresentState>;

/** A new stream of frames at the picture size, showing `cursor`. */
export function tdFrameStream(screen: ScreenSize, cursor: CursorFeed): TdFrames {
  return new FrameStream(tdFrames(screen, cursor));
}

/** The round drawn onto a presenter: `draw(world, events)` presents one frame and returns it. */
export type TdPicture = FramePicture<TdWorld, TdEvent>;

/** One stream of frames onto any presenter. */
export function tdPicture(presenter: Presenter, screen: ScreenSize, cursor: CursorFeed): TdPicture {
  return new FramePicture(tdFrameStream(screen, cursor), presenter);
}

/** One stream of frames onto `r` through the Canvas2D backend and the sample's skin. */
export function tdCanvasPicture(
  r: Renderer,
  look: TdLook,
  cursor: CursorFeed,
  onSound?: (id: string) => void,
): TdPicture {
  const presenter = new SkinnedCanvasPresenter(r, look.skin, look.sheet, {
    size: look.screen,
    fonts: look.fonts,
    ...(onSound && { onSound }),
  });
  return tdPicture(presenter, look.screen, cursor);
}
