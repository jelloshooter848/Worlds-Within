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
import {
  presentWorld,
  RtsEventTracker,
  RtsPresentState,
  type RtsPresentOptions,
  type RtsView,
} from '@kits/rts';
import { PLAYER, skirmishSkin } from './content';
import { skirmishResult, type SkirmishResult } from './headless';

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
 *
 * Sounds (Engine 0.15 T14): the world snapshot carries no events, so each frame carries the kit's
 * `RtsEventTracker` reading of what changed since the last tick (`unit-down`, `unit-hit`,
 * `unit-ready`, `site-placed`, `building-done`, `stock-up`, each with its `side`), plus the
 * sample's own `battle-end` (`result` `won` or `lost`, once, on the tick `skirmishResult` first
 * gives it). The skin's `events` turn them into sfx and effects. Once the battle is over the frame's
 * status also has `won` or `lost` (true), which the skin's HUD shows as the end banner.
 */

/**
 * What drawing the game needs: the skin, the sheets and the picture size. The colour behind the
 * map (the grass) is the skin's `background` (gap G36), which the backend clears to.
 */
export interface SkirmishLook {
  skin: SkinFile;
  sheet: SheetLookup;
  screen: ScreenSize;
}

/** The `canvas2d` skin, the sprite sheets (from the sprite and palette files) and size. */
export function skirmishLook(content: ContentBundle): SkirmishLook {
  return {
    skin: skirmishSkin(content, 'canvas2d'),
    sheet: contentSheets(content),
    screen: content.manifest.screen,
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

/** One stream's state: the kit's presentation state, its event tracker and the end seen so far. */
export class SkirmishPresentState {
  readonly present = new RtsPresentState();
  readonly events = new RtsEventTracker(PLAYER);
  result: SkirmishResult = null;
}

/**
 * How the skirmish presents its world: the kit's `presentWorld` for the player's side, with the
 * tick's events and, once it is over, the end (see the file comment).
 */
export function skirmishSource(
  screen: ScreenSize,
  ui: InterfaceOptions = () => ({}),
): FrameSource<ShowsWorld, never, SkirmishPresentState> {
  return {
    start: () => new SkirmishPresentState(),
    present: (world, _events, state) => {
      const view = world.view();
      const events = state.events.next(view);
      const result = skirmishResult(view);
      if (result !== null && state.result === null) events.push({ type: 'battle-end', result });
      state.result = result;
      const frame = presentWorld(view, {
        ...ui(),
        faction: PLAYER,
        size: screen,
        events,
        state: state.present,
      });
      if (result !== null) frame.status[result] = true;
      return sideKinds(frame);
    },
  };
}

/** One stream of frames for any presenter. */
export type SkirmishFrames = FrameStream<ShowsWorld, never, SkirmishPresentState>;

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

/** One stream of frames onto `r` through the Canvas2D backend and the game's skin (`onSound` for its event sounds). */
export function skirmishCanvasPicture(
  r: Renderer,
  look: SkirmishLook,
  ui?: InterfaceOptions,
  onSound?: (id: string) => void,
): SkirmishPicture {
  const presenter = new SkinnedCanvasPresenter(r, look.skin, look.sheet, {
    size: look.screen,
    ...(onSound && { onSound }),
  });
  return skirmishPicture(presenter, look.screen, ui);
}
