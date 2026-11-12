import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  fogState,
  FramePicture,
  FrameStream,
  type FrameSource,
  type PresentFrame,
  type Presenter,
  type SkinFile,
} from '@engine/core/present';
import { contentFonts, type FontLookup } from '@engine/core/ui';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import {
  presentWorld,
  RTS_TILE_SIZE,
  RtsEventTracker,
  RtsPresentState,
  type RtsOrderFeedback,
  type RtsNames,
  type RtsPresentOptions,
  type RtsView,
} from '@kits/rts';
import { PLAYER, skirmishSkin } from './content';
import type { SkirmishResult } from './headless';

/**
 * Glue between the RTS kit's frames and the Canvas2D backend: no drawing of its own. One stream of
 * frames (the engine's `FrameStream` over the kit's `presentWorld`) goes to the backend's
 * `SkinnedCanvasPresenter` with the game's skin. Shared by the view (`view.ts`, for `pnpm cli
 * screenshot`) and the tests, so a screenshot is what a player sees.
 *
 * The kit names a unit or building by its type alone (`unit:soldier`) and tells the sides apart by
 * tag (`own`, `enemy`). A skin picks frames by kind only, so `sideKinds` gives the enemy's units
 * and buildings their own kind (`unit:soldier:enemy`), which the skin draws with the pack's blue
 * art.
 *
 * Sounds (Engine 0.15 T14): the world snapshot carries no events, so each frame carries the kit's
 * `RtsEventTracker` reading of what changed since the last tick (`unit-down`, `unit-hit`,
 * `unit-ready`, `site-placed`, `building-done`, `stock-up`, each with its `side`), plus the
 * sample's own `battle-end` (`result` `won` or `lost`, once, on the tick `skirmishResult` first
 * gives it). The skin's `events` turn them into sfx and effects. Once the battle is over the frame's
 * status also has `won` or `lost` (true), which the skin's HUD shows as the end banner.
 *
 * The River Ford (Engine 0.16 part D, D8): the player sees the world through fog of war (the kit's
 * `presentWorld` `fog`, on unless `fog: false`; the player's explored cells and last-seen buildings
 * kept in the stream's `RtsPresentState`); the page's accepted orders (`feedback`) become order
 * markers and `bark` events (the skin plays a voice-like sfx per unit type); and the last bark's
 * order stays in the status as `bark` for `BARK_TICKS` ticks, and the other side's events are
 * heard only where the player sees now (`heardEvents`), which the skin's HUD shows as a short
 * line of text (the lines are the skin's, `when: { status: "bark", eq: <order> }`). All of it is
 * presentation: nothing here reads or writes the world, so no hash depends on it (`fog.test.ts`).
 */

/** Ticks a bark's text stays in the HUD. */
export const BARK_TICKS = 15;

/**
 * What drawing the game needs: the skin, the sheets and the picture size. The colour behind the
 * map (the grass) is the skin's `background` (gap G36), which the backend clears to.
 */
export interface SkirmishLook {
  skin: SkinFile;
  sheet: SheetLookup;
  screen: ScreenSize;
  /** The game's fonts, for the HUD's text (the bark line, the selected-unit panel; D10). */
  fonts: FontLookup;
}

/** The `canvas2d` skin, the sprite sheets (from the sprite and palette files), size and fonts. */
export function skirmishLook(content: ContentBundle): SkirmishLook {
  return {
    skin: skirmishSkin(content, 'canvas2d'),
    sheet: contentSheets(content),
    screen: content.manifest.screen,
    fonts: contentFonts(content),
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

/** Something that shows the match: the world as the kit reads it and how the match stands. */
export interface ShowsWorld {
  view(): RtsView;
  result(): SkirmishResult;
}

/** The player's interface state a frame shows (selection, box, placing, camera), when there is one. */
export type InterfaceOptions = () => Partial<Omit<RtsPresentOptions, 'faction' | 'size' | 'state'>>;

/** How a stream presents: the page's interface, fog, and the page's accepted orders. */
export interface SkirmishFrameOptions {
  /** The selection, box, placing and camera the page adds (none: the view's centre, nothing selected). */
  ui?: InterfaceOptions;
  /** Fog of war for the player (default true). Presentation only. */
  fog?: boolean;
  /** The feedback of the orders the page issued and the game accepted since the last frame (taken). */
  feedback?: () => readonly RtsOrderFeedback[];
  /**
   * The HUD's display names (`skirmishNames`, `content/names/`; polish Q, D2): the selection
   * panel's `selectedName` and the training line's `trainingName`. Left out, the kit's ids.
   */
  names?: RtsNames;
}

/** One stream's state: the kit's presentation state, its event tracker, the end seen so far and the last bark. */
export class SkirmishPresentState {
  readonly present = new RtsPresentState();
  readonly events = new RtsEventTracker(PLAYER);
  result: SkirmishResult = null;
  /** The last bark's order type and the tick it was given at, or null. */
  bark: { order: string; tick: number } | null = null;
}

/**
 * How the skirmish presents its world: the kit's `presentWorld` for the player's side, with fog,
 * the tick's events, the page's order feedback and, once it is over, the end (see the file comment).
 */
export function skirmishSource(
  screen: ScreenSize,
  opts: SkirmishFrameOptions = {},
): FrameSource<ShowsWorld, never, SkirmishPresentState> {
  const ui = opts.ui ?? (() => ({}));
  return {
    start: () => new SkirmishPresentState(),
    present: (world, _events, state) => {
      const view = world.view();
      for (const f of opts.feedback?.() ?? []) {
        state.present.accept(f, view.tick);
        const bark = f.events.find((e) => e.type === 'bark');
        if (bark !== undefined) state.bark = { order: String(bark['order']), tick: view.tick };
      }
      const events = state.events.next(view);
      const result = world.result();
      if (result !== null && state.result === null) events.push({ type: 'battle-end', result });
      state.result = result;
      const frame = presentWorld(view, {
        ...ui(),
        faction: PLAYER,
        size: screen,
        events,
        state: state.present,
        fog: opts.fog ?? true,
        ...(opts.names && { names: opts.names }),
      });
      frame.events = heardEvents(frame);
      if (result !== null) frame.status[result] = true;
      if (state.bark !== null && view.tick - state.bark.tick < BARK_TICKS)
        frame.status['bark'] = state.bark.order;
      return sideKinds(frame);
    },
  };
}

/**
 * The frame's events the player may hear: under fog, an event of another side (a hit, a fall, a
 * building done) only on a cell seen now, so no sound gives away what the fog hides. Events with no
 * place (the end, stock) and the player's own always stay.
 */
export function heardEvents(frame: PresentFrame): PresentFrame['events'] {
  const fog = frame.fog;
  if (fog === undefined) return frame.events;
  return frame.events.filter((e) => {
    if (e['side'] === 'own' || typeof e.x !== 'number' || typeof e.y !== 'number') return true;
    const col = Math.floor(e.x / RTS_TILE_SIZE);
    const row = Math.floor(e.y / RTS_TILE_SIZE);
    return fogState(fog, col, row) === 'visible';
  });
}

/** One stream of frames for any presenter. */
export type SkirmishFrames = FrameStream<ShowsWorld, never, SkirmishPresentState>;

/** A new stream of frames at the picture size. */
export function skirmishFrames(screen: ScreenSize, opts?: SkirmishFrameOptions): SkirmishFrames {
  return new FrameStream(skirmishSource(screen, opts));
}

/** The game drawn onto a presenter: `draw(world, [])` presents one frame and returns it. */
export type SkirmishPicture = FramePicture<ShowsWorld, never>;

/** One stream of frames onto any presenter. */
export function skirmishPicture(
  presenter: Presenter,
  screen: ScreenSize,
  opts?: SkirmishFrameOptions,
): SkirmishPicture {
  return new FramePicture(skirmishFrames(screen, opts), presenter);
}

/** One stream of frames onto `r` through the Canvas2D backend and the game's skin (`onSound` for its event sounds). */
export function skirmishCanvasPicture(
  r: Renderer,
  look: SkirmishLook,
  opts?: SkirmishFrameOptions,
  onSound?: (id: string) => void,
): SkirmishPicture {
  const presenter = new SkinnedCanvasPresenter(r, look.skin, look.sheet, {
    size: look.screen,
    fonts: look.fonts,
    ...(onSound && { onSound }),
  });
  return skirmishPicture(presenter, look.screen, opts);
}
