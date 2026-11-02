import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import { FramePicture, FrameStream, type Presenter, type SkinFile } from '@engine/core/present';
import { skinSetCanvasPresenter } from '@engine/backends/canvas2d';
import {
  platformerFrames,
  type PlatformerEvent,
  type PlatformerPresentState,
  type PlatformerWorld,
} from '@kits/platformer';
import { testSkins } from './content';

/**
 * Glue between the kits' frames and the Canvas2D backend: no drawing of its own. One stream of
 * frames (the engine's `FrameStream` over the platformer kit's `platformerFrames`; while the
 * door's round runs, the round's own top-down frame with `status.miniGame` set) goes to one
 * presenter per frame source (the backend's `skinSetCanvasPresenter`): the level skin for the
 * levels, the round's skin for the round (gap G14), each framing its map as its skin's `camera`
 * says (the round's `clamp: false` keeps the room under its HUD band; gaps G29 and G34). Shared
 * by the page (`main.ts`), the view (`view.ts`, for `pnpm cli screenshot`) and the tests, so a
 * screenshot is what a player sees. The sheets are the engine's `contentSheets` (gap G35).
 */

/**
 * What drawing the game needs: the level skin, a skin per mini game, the sheets, size and sky (as
 * the backend's `canvasDisplay` and `skinSetCanvasPresenter` take them).
 */
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
  const skins = testSkins(content, 'canvas2d');
  return {
    skin: skins.level,
    rounds: skins.rounds,
    sheet: contentSheets(content),
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

/** One stream of frames onto `r` through the Canvas2D backend and the game's skins. */
export function testCanvasPicture(r: Renderer, look: TestLook): TestPicture {
  return testPicture(skinSetCanvasPresenter(r, look), look.screen);
}
