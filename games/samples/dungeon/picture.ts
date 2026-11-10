import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  freezeFrame,
  type DeepReadonly,
  type PresentFrame,
  type Presenter,
  type SkinFile,
} from '@engine/core/present';
import { CanvasUiPainter, SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import {
  contentFonts,
  layoutText,
  paintUi,
  panelDraws,
  sliceInsets,
  textDraws,
  type FontLookup,
  type UiDraw,
} from '@engine/core/ui';
import { presentWorld, TdPresentState, type TopDownWorld } from '@kits/topdown';
import { dungeonSkin } from './content';

/**
 * Glue between the kit's presentation frames and the Canvas2D backend: no drawing of its own
 * besides the end banner. Each `draw` asks the kit for a frame (`presentWorld`, with the hero's
 * `idle` state on), freezes it and hands it to a presenter with the sample's skin (its own
 * `SkinnedCanvasPresenter`, or the page display's, which also takes the shell's settings and HUD
 * switch); the backend decides how everything looks. Shared by the scene (`scene.ts`) and the view
 * (`view.ts`, for `pnpm cli screenshot`), so a screenshot is what a player sees.
 */

/**
 * Where the play area starts on the picture (the kit's `top`): 0, so the 176 px room sits in the
 * middle of the 180 px picture and the skin's HUD panels lie over the top wall and the dark side
 * margins (Engine 0.16 part C T3, the 16:9 screen).
 */
export const HUD_TOP = 0;

/** The font the end banner is written in (`content/fonts/`, the menus' font). */
export const BANNER_FONT = 'crypt-small';

/** What drawing the dungeon needs from its content: the skin, its sheets, the fonts and the picture size. */
export interface DungeonLook {
  skin: SkinFile;
  sheet: SheetLookup;
  screen: ScreenSize;
  fonts: FontLookup;
}

/**
 * The sample's skin, its sheets (the sprite and palette files and, once the bundle went through
 * `withContentImages`, the skin's PNG sheets), the fonts and the picture size.
 */
export function dungeonLook(content: ContentBundle): DungeonLook {
  return {
    skin: dungeonSkin(content),
    sheet: contentSheets(content),
    screen: content.manifest.screen,
    fonts: contentFonts(content),
  };
}

export interface DungeonPictureOptions {
  /** Called with each sound the skin attaches to this frame's events (wire it to the audio). */
  onSound?: (id: string) => void;
  /** Draw through this presenter (the page display's) instead of one of the picture's own. */
  presenter?: Presenter;
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
  private readonly presenter: Presenter;
  private readonly painter: CanvasUiPainter;
  private hud = true;

  constructor(
    r: Renderer,
    private readonly look: DungeonLook,
    opts: DungeonPictureOptions = {},
  ) {
    // The kit's camera hint centres the room; the skin turns clamping off (`camera.clamp`), so a
    // map shorter than the picture is not re-centred.
    this.presenter =
      opts.presenter ??
      new SkinnedCanvasPresenter(r, look.skin, look.sheet, {
        size: look.screen,
        fonts: look.fonts,
        ...(opts.onSound ? { onSound: opts.onSound } : {}),
      });
    this.painter = new CanvasUiPainter(r, look.sheet, look.fonts);
  }

  /** A new world (the run starts over): ids and the map are sent afresh. */
  reset(): void {
    this.state = new TdPresentState();
  }

  /** Whether the skin's HUD and the end banner are drawn from the next frame (off under the title). */
  showHud(shown: boolean): void {
    this.hud = shown;
    this.presenter.showHud?.(shown);
  }

  /** Draws the world now, with the events since the last draw; returns the frame it drew. */
  draw(world: TopDownWorld, events: readonly object[]): DeepReadonly<PresentFrame> {
    const frame = freezeFrame(
      presentWorld(world, events, { state: this.state, size: this.look.screen, top: HUD_TOP, idle: true }),
    );
    this.presenter.present(frame);
    if (this.hud) paintUi(endBanner(this.look, dungeonEnd(world), world.found.has('relic')), this.painter);
    return frame;
  }
}

/** The end banner's two lines: what happened, and how to play again. */
export function endLines(end: DungeonEnd, relic: boolean): [string, string] | null {
  if (end === 'escaped')
    return [relic ? 'You escaped with the relic!' : 'You escaped!', 'Press Z to play again'];
  if (end === 'fallen') return ['You fell in the crypt.', 'Press Z to try again'];
  return null;
}

/**
 * Once a run has ended, a framed panel low in the room (the skin's `panel` frame) with what
 * happened and how to play again, in the menus' font; nothing while it plays.
 */
export function endBanner(look: DungeonLook, end: DungeonEnd, relic: boolean): UiDraw[] {
  const lines = endLines(end, relic);
  const font = look.fonts(BANNER_FONT);
  if (lines === null || font === null) return [];
  const width = Math.max(...lines.map((l) => layoutText(font, l).width)) + 24;
  const height = font.line * 2 + 14;
  const box = {
    x: Math.round((look.screen.width - width) / 2),
    y: look.screen.height - height - 22,
    w: width,
    h: height,
  };
  const panel = look.sheet('crypt-art')?.frames.get('panel');
  const out: UiDraw[] = panel
    ? panelDraws({ sheet: 'crypt-art', frame: 'panel' }, panel, sliceInsets(5), box)
    : [];
  const colors = end === 'escaped' ? '#f6c445' : '#ff8a6a';
  lines.forEach((line, i) => {
    const w = layoutText(font, line).width;
    const x = box.x + Math.round((box.w - w) / 2);
    const y = box.y + 7 + i * font.line;
    out.push(...textDraws(font, line, x, y, { color: i === 0 ? colors : '#d3bfa9', shadow: '#222222' }));
  });
  return out;
}
