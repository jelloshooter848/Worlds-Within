import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
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
import { dungeonSkin } from './content';

/**
 * Glue between the kit's presentation frames and the Canvas2D backend: no drawing of its own
 * besides the status lines and the end banner. Each `draw` asks the kit for a frame
 * (`presentWorld`), freezes it and hands it to `SkinnedCanvasPresenter` with the sample's skin;
 * the backend decides how everything looks. Shared by the scene (`scene.ts`) and the view
 * (`view.ts`, for `pnpm cli screenshot`), so a screenshot is what a player sees.
 */

/** What drawing the dungeon needs from its content: the skin and its sheets. */
export interface DungeonLook {
  skin: SkinFile;
  sheet: SheetLookup;
  screen: ScreenSize;
}

/** The sample's skin, its sprite sheets (from the sprite and palette files) and picture size. */
export function dungeonLook(content: ContentBundle): DungeonLook {
  return { skin: dungeonSkin(content), sheet: contentSheets(content), screen: content.manifest.screen };
}

export interface DungeonPictureOptions {
  /** Called with each sound the skin attaches to this frame's events (wire it to the audio). */
  onSound?: (id: string) => void;
}

/** How a run has ended, for the banner: out through the exit, fallen, or not yet. */
export type DungeonEnd = 'escaped' | 'fallen' | null;

/** The world's end state: the exit reached (`exited`) or the hero dead after his spin. */
export function dungeonEnd(world: TopDownWorld): DungeonEnd {
  if (world.exited) return 'escaped';
  if (world.hero.dead) return 'fallen';
  return null;
}

/** One stream of dungeon frames onto one renderer. */
export class DungeonPicture {
  private state = new TdPresentState();
  private readonly presenter: SkinnedCanvasPresenter;

  constructor(
    private readonly r: Renderer,
    private readonly look: DungeonLook,
    opts: DungeonPictureOptions = {},
  ) {
    // The kit's camera hint puts the room under the HUD band; the skin turns clamping off
    // (`camera.clamp`), so a map shorter than the picture is not re-centred.
    this.presenter = new SkinnedCanvasPresenter(r, look.skin, look.sheet, {
      size: look.screen,
      ...(opts.onSound ? { onSound: opts.onSound } : {}),
    });
  }

  /** A new world (the run starts over): ids and the map are sent afresh. */
  reset(): void {
    this.state = new TdPresentState();
  }

  /** Draws the world now, with the events since the last draw; returns the frame it drew. */
  draw(world: TopDownWorld, events: readonly object[]): DeepReadonly<PresentFrame> {
    const frame = freezeFrame(presentWorld(world, events, { state: this.state, size: this.look.screen }));
    this.presenter.present(frame);
    drawStatusLines(this.r, frame.status, dungeonEnd(world), world.found.has('relic'));
    return frame;
  }
}

/**
 * The title and status lines over the HUD band, read from the frame's status values, and once the
 * run has ended what happened and how to play again.
 */
export function drawStatusLines(
  r: Renderer,
  status: DeepReadonly<Record<string, PresentStatusValue>>,
  end: DungeonEnd = null,
  relic = false,
): void {
  const hp = typeof status['hp'] === 'number' ? status['hp'] : 0;
  const bombs =
    status['item'] && typeof status['ammo.bomb'] === 'number' ? `   bombs: ${status['ammo.bomb']}` : '';
  r.debugText('THE OLD CRYPT - a dungeon sample', 8, 14, '#fcfcfc');
  r.debugText(`room: ${String(status['room'])}   hearts: ${hp / 2}${bombs}`, 8, 30, '#bcbcbc');
  if (end === 'escaped') {
    r.debugText(
      relic ? 'You escaped with the relic!  Z: again' : 'You escaped!  Z: play again',
      8,
      46,
      '#f8d878',
    );
  } else if (end === 'fallen') {
    r.debugText('You fell in the crypt.  Z: try again', 8, 46, '#f83800');
  } else {
    r.debugText('arrows move, Z/X sword, C item', 8, 46, '#bcbcbc');
  }
}
