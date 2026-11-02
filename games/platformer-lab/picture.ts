import { AssetRegistry } from '@engine/core/assets/registry';
import { sheetLookup, type SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import { freezeFrame, type DeepReadonly, type PresentFrame, type SkinFile } from '@engine/core/present';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import {
  PlatformerPresentState,
  presentWorld,
  type PlatformerEvent,
  type PlatformerWorld,
} from '@kits/platformer';
import { labArt, labSkin } from './content';

/**
 * Glue between the platformer kit's presentation frames and the Canvas2D backend: no drawing of
 * its own. Each `draw` asks the kit for a frame (`presentWorld`, which while a mini game runs is
 * the mini game's own frame), freezes it and hands it to `SkinnedCanvasPresenter` with the lab's
 * skin; the backend and the skin decide how everything looks, the skin's camera follows the
 * runner with a deadzone and lerp inside the kit's scroll lock. Shared by the scene (`scene.ts`)
 * and the view (`view.ts`, for `pnpm cli screenshot`), so a screenshot is what a player sees.
 */

/** What drawing the lab needs from its content: the skin, its sheets and the picture size. */
export interface LabLook {
  skin: SkinFile;
  sheet: SheetLookup;
  screen: ScreenSize;
}

/** The lab's skin, its sprite sheets (from the sprite and palette files) and picture size. */
export function labLook(content: ContentBundle): LabLook {
  const art = labArt(content);
  const assets = new AssetRegistry({ default: art.palettes });
  assets.defineAll(art.sprites);
  return { skin: labSkin(content), sheet: sheetLookup(assets), screen: content.manifest.screen };
}

/** The sky behind the levels (the colour of the skin's `.` tile, so the map's edges do not show). */
export const SKY = '#5c94fc';

/** One stream of lab frames onto one renderer. */
export class LabPicture {
  private state = new PlatformerPresentState();
  private world: PlatformerWorld | null = null;
  private readonly presenter: SkinnedCanvasPresenter;

  constructor(
    r: Renderer,
    private readonly look: LabLook,
  ) {
    this.presenter = new SkinnedCanvasPresenter(r, look.skin, look.sheet, {
      size: look.screen,
      background: SKY,
    });
  }

  /**
   * Draws `world` now, with the events since the last draw; returns the frame it drew. A new
   * world (the next level, or the same one again) starts a new stream: its map and ids afresh.
   */
  draw(world: PlatformerWorld, events: readonly PlatformerEvent[]): DeepReadonly<PresentFrame> {
    if (world !== this.world) {
      this.world = world;
      this.state = new PlatformerPresentState();
    }
    const frame = freezeFrame(presentWorld(world, events, { state: this.state, size: this.look.screen }));
    this.presenter.present(frame);
    return frame;
  }
}
