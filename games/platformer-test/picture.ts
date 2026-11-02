import { AssetRegistry } from '@engine/core/assets/registry';
import { sheetLookup, type SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  FramePicture,
  FrameStream,
  presenterByStatus,
  type Presenter,
  type SkinFile,
} from '@engine/core/present';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import {
  platformerFrames,
  type PlatformerEvent,
  type PlatformerPresentState,
  type PlatformerWorld,
} from '@kits/platformer';
import { testArt, testSkins } from './content';

/**
 * Glue between the kits' frames and the Canvas2D backend: no drawing of its own. One stream of
 * frames (the engine's `FrameStream` over the platformer kit's `platformerFrames`; while the
 * door's round runs, the round's own top-down frame with `status.miniGame` set) goes to one
 * presenter per frame source (the engine's `presenterByStatus` on `miniGame`): the level skin for
 * the levels, the round's skin for the round (gap G14). Shared by the page (`main.ts`), the view
 * (`view.ts`, for `pnpm cli screenshot`) and the tests, so a screenshot is what a player sees.
 */

/** What drawing the game needs: the level skin, a skin per mini game, the sheets, size and sky. */
export interface TestLook {
  skin: SkinFile;
  rounds: Record<string, SkinFile>;
  sheet: SheetLookup;
  screen: ScreenSize;
  background: string;
}

/** The sky behind the levels (the colour of the skin's `.` tile). */
export const SKY = '#5c94fc';

/** The `canvas2d` skins, the sprite sheets (from the sprite and palette files), size and sky. */
export function testLook(content: ContentBundle): TestLook {
  const art = testArt(content);
  const assets = new AssetRegistry({ default: art.palettes });
  assets.defineAll(art.sprites);
  const skins = testSkins(content, 'canvas2d');
  return {
    skin: skins.level,
    rounds: skins.rounds,
    sheet: sheetLookup(assets),
    screen: content.manifest.screen,
    background: SKY,
  };
}

/** One stream of frames for any presenter: one per picture (a new level starts afresh). */
export type TestFrames = FrameStream<PlatformerWorld, PlatformerEvent, PlatformerPresentState>;

/** A new stream of frames at the picture size. */
export function testFrames(screen: ScreenSize): TestFrames {
  return new FrameStream(platformerFrames(screen));
}

/** The game drawn onto a presenter: `draw(world, events)` presents one frame and returns it. */
export type TestPicture = FramePicture<PlatformerWorld, PlatformerEvent>;

/** One stream of frames onto any presenter. */
export function testPicture(presenter: Presenter, screen: ScreenSize): TestPicture {
  return new FramePicture(testFrames(screen), presenter);
}

export interface CanvasPresenterOptions {
  /** The levels' presenter when one is made already (the page's display has one). */
  level?: Presenter;
  /** Called with each sound a skin names for this frame's events. */
  onSound?: (id: string) => void;
}

/**
 * The Canvas2D presenters on `r`: the level skin's (or `opts.level`), and one per round skin.
 * A round's map is smaller than the picture and sits under its HUD band where the top-down
 * kit's camera hint puts it, so its presenter does not clamp (the demo's does the same); the
 * round's background is black, the level's the sky.
 */
export function testCanvasPresenter(
  r: Renderer,
  look: TestLook,
  opts: CanvasPresenterOptions = {},
): Presenter {
  const sound = opts.onSound ? { onSound: opts.onSound } : {};
  const level =
    opts.level ??
    new SkinnedCanvasPresenter(r, look.skin, look.sheet, {
      size: look.screen,
      background: look.background,
      ...sound,
    });
  const rounds: Record<string, Presenter> = {};
  for (const [id, skin] of Object.entries(look.rounds))
    rounds[id] = new SkinnedCanvasPresenter(r, skin, look.sheet, {
      size: look.screen,
      clamp: false,
      ...sound,
    });
  return presenterByStatus('miniGame', rounds, level);
}

/** One stream of frames onto `r` through the Canvas2D backend and the game's skins. */
export function testCanvasPicture(r: Renderer, look: TestLook): TestPicture {
  return testPicture(testCanvasPresenter(r, look), look.screen);
}
