import { AssetRegistry } from '@engine/core/assets/registry';
import { sheetLookup, type SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  freezeFrame,
  type DeepReadonly,
  type PresentFrame,
  type PresentStatusValue,
  type SkinFile,
} from '@engine/core/present';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import { presentWorld, TdPresentState, type TopDownWorld } from '@kits/topdown';
import { demoArt, demoSkin } from './content';

/**
 * Glue between the kit's presentation frames and the Canvas2D backend: no drawing of its own
 * besides the three status lines. Each `draw` asks the kit for a frame (`presentWorld`), freezes
 * it and hands it to `SkinnedCanvasPresenter` with the demo's skin; the backend decides how
 * everything looks. Shared by the scene (`scene.ts`) and the view (`view.ts`, for
 * `pnpm cli screenshot`), so a screenshot is what a player sees.
 */

/** What drawing the demo needs from its content: the skin and its sheets. */
export interface DemoLook {
  skin: SkinFile;
  sheet: SheetLookup;
  screen: ScreenSize;
}

/** The demo's skin, its sprite sheets (from the sprite and palette files) and picture size. */
export function demoLook(content: ContentBundle): DemoLook {
  const art = demoArt(content);
  const assets = new AssetRegistry({ default: art.palettes });
  assets.defineAll(art.sprites);
  return { skin: demoSkin(content), sheet: sheetLookup(assets), screen: content.manifest.screen };
}

export interface DemoPictureOptions {
  /** Called with each sound the skin attaches to this frame's events (wire it to the audio). */
  onSound?: (id: string) => void;
}

/** One stream of demo frames onto one renderer. */
export class DemoPicture {
  private state = new TdPresentState();
  private readonly presenter: SkinnedCanvasPresenter;

  constructor(
    private readonly r: Renderer,
    private readonly look: DemoLook,
    opts: DemoPictureOptions = {},
  ) {
    // The kit's camera hint puts the room under the HUD band; a map shorter than the picture
    // must not be re-centred, so clamping is off.
    this.presenter = new SkinnedCanvasPresenter(r, look.skin, look.sheet, {
      size: look.screen,
      clamp: false,
      ...(opts.onSound ? { onSound: opts.onSound } : {}),
    });
  }

  /** A new world (the hero died): ids and the map are sent afresh. */
  reset(): void {
    this.state = new TdPresentState();
  }

  /** Draws the world now, with the events since the last draw; returns the frame it drew. */
  draw(world: TopDownWorld, events: readonly object[]): DeepReadonly<PresentFrame> {
    const frame = freezeFrame(presentWorld(world, events, { state: this.state, size: this.look.screen }));
    this.presenter.present(frame);
    drawStatusLines(this.r, frame.status);
    return frame;
  }
}

/** The title and status lines over the HUD band, read from the frame's status values. */
export function drawStatusLines(r: Renderer, status: DeepReadonly<Record<string, PresentStatusValue>>): void {
  const hp = typeof status['hp'] === 'number' ? status['hp'] : 0;
  r.debugText('WORLDS WITHIN - engine demo', 8, 14, '#fff');
  r.debugText(`room: ${String(status['room'])}   hearts: ${hp / 2}`, 8, 30, '#aaa');
  r.debugText('arrows move, Z/X sword, C item', 8, 46, '#aaa');
}
