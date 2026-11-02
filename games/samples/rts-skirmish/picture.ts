import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  FramePicture,
  FrameStream,
  type FrameSource,
  type PresentFrame,
  type Presenter,
  type SkinFile,
} from '@engine/core/present';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import { presentWorld, RtsPresentState, type RtsPresentOptions, type RtsView } from '@kits/rts';
import { PLAYER, skirmishSkin } from './content';

/**
 * Glue between the RTS kit's frames and the Canvas2D backend: no drawing of its own. One stream of
 * frames (the engine's `FrameStream` over the kit's `presentWorld`) goes to the backend's
 * `SkinnedCanvasPresenter` with the game's skin. Shared by the view (`view.ts`, for `pnpm cli
 * screenshot`) and the tests, so a screenshot is what a player sees.
 *
 * The kit names a unit or building by its type alone (`unit:soldier`) and tells the sides apart by
 * tag (`own`, `enemy`). A skin picks frames by kind only, so `sideKinds` gives the enemy's units
 * and buildings their own kind (`unit:soldier:enemy`), which the skin draws with the enemy's
 * palette (`content/palettes/skirmish-blue.json`).
 */

/** What drawing the game needs: the skin, the sheets, the picture size and the colour behind it. */
export interface SkirmishLook {
  skin: SkinFile;
  sheet: SheetLookup;
  screen: ScreenSize;
  background: string;
}

/** The colour behind the map (the grass). */
export const BACKGROUND = '#00a800';

/** The `canvas2d` skin, the sprite sheets (from the sprite and palette files), size and colour. */
export function skirmishLook(content: ContentBundle): SkirmishLook {
  return {
    skin: skirmishSkin(content, 'canvas2d'),
    sheet: contentSheets(content),
    screen: content.manifest.screen,
    background: BACKGROUND,
  };
}

/** `frame` with the enemy side's units and buildings as kinds of their own (`<kind>:enemy`). */
export function sideKinds(frame: PresentFrame): PresentFrame {
  for (const e of frame.entities) {
    if ((e.kind.startsWith('unit:') || e.kind.startsWith('building:')) && e.tags.includes('enemy'))
      e.kind = `${e.kind}:enemy`;
  }
  return frame;
}

/** Something that shows an RTS world: the kit's `RtsGame` (or the skirmish's wrapper of it). */
export interface ShowsWorld {
  view(): RtsView;
}

/** The player's interface state a frame shows (selection, box, placing, camera), when there is one. */
export type InterfaceOptions = () => Partial<Omit<RtsPresentOptions, 'faction' | 'size' | 'state'>>;

/** How the skirmish presents its world: the kit's `presentWorld` for the player's side. */
export function skirmishSource(
  screen: ScreenSize,
  ui: InterfaceOptions = () => ({}),
): FrameSource<ShowsWorld, never, RtsPresentState> {
  return {
    start: () => new RtsPresentState(),
    present: (world, _events, state) =>
      sideKinds(presentWorld(world.view(), { ...ui(), faction: PLAYER, size: screen, state })),
  };
}

/** One stream of frames for any presenter. */
export type SkirmishFrames = FrameStream<ShowsWorld, never, RtsPresentState>;

/** A new stream of frames at the picture size. */
export function skirmishFrames(screen: ScreenSize, ui?: InterfaceOptions): SkirmishFrames {
  return new FrameStream(skirmishSource(screen, ui));
}

/** The game drawn onto a presenter: `draw(world, [])` presents one frame and returns it. */
export type SkirmishPicture = FramePicture<ShowsWorld, never>;

/** One stream of frames onto any presenter. */
export function skirmishPicture(
  presenter: Presenter,
  screen: ScreenSize,
  ui?: InterfaceOptions,
): SkirmishPicture {
  return new FramePicture(skirmishFrames(screen, ui), presenter);
}

/** One stream of frames onto `r` through the Canvas2D backend and the game's skin. */
export function skirmishCanvasPicture(
  r: Renderer,
  look: SkirmishLook,
  ui?: InterfaceOptions,
): SkirmishPicture {
  const presenter = new SkinnedCanvasPresenter(r, look.skin, look.sheet, {
    size: look.screen,
    background: look.background,
  });
  return skirmishPicture(presenter, look.screen, ui);
}
