import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { MiniGame } from '@engine/core/minigame';
import {
  FramePicture,
  FrameStream,
  isFullMap,
  MapTracker,
  MINI_GAME_STATUS,
  skinSet,
  type FrameSource,
  type PresentEvent,
  type PresentFrame,
  type Presenter,
  type SkinFile,
} from '@engine/core/present';
import { skinSetCanvasPresenter } from '@engine/backends/canvas2d';
import { presentWorld, RtsPresentState, type RtsMissionInfo, type RtsPresentOptions } from '@kits/rts';
import { PLAYER, siegeMissions } from './content';
import type { MiniSiegeGame } from './headless';

/**
 * Glue between the kits' frames and the Canvas2D backend: no drawing of its own. One stream of
 * frames over the `MiniSiegeGame`: while no round is hosted, the RTS kit's `presentWorld` for the
 * village (with the game's missions, so the offer marker and the mission HUD show); while a
 * mission's round is hosted, the round's own frame (`MiniGame.present()`: the topdown kit's room
 * for `sabotage`, the towerdefense kit's walls for `fortify`, each with the host's `mission`
 * title) with `status.miniGame` set to the mini game the mission plays (`mission-room`,
 * `td-defence`). The backend's `skinSetCanvasPresenter` sends each frame to its skin:
 * `canvas2d.json` for the battle, `canvas2d-mission-room.json` for the room (gap M6: the page's
 * picture switches itself); the walls' skin is Engine 0.12 T8's.
 *
 * The sim's snapshot carries no events, so the stream makes the three the battle's skin plays
 * sounds for from what changed between two frames (gap M21): `mission-open` (a mission opened),
 * `mini-game-end` with the round's `result` (`mini-game-end:pass` / `fail`; a quit is `quit`) and
 * `mission-commit` with the record's `outcome` and `resolution` (`mission-commit:outcome=both-burnt`).
 * Shared by the page (`main.ts`), the view (`view.ts`, for `pnpm cli screenshot`) and the tests,
 * so a screenshot is what a player sees.
 */

/** What drawing the game needs: the battle's skin, a skin per mini game, the sheets, size and colour. */
export interface SiegeLook {
  skin: SkinFile;
  rounds: Record<string, SkinFile>;
  sheet: SheetLookup;
  screen: ScreenSize;
  background: string;
}

/** The colour behind the map (the grass). */
export const BACKGROUND = '#00a800';

/** The `canvas2d` skins, the sprite sheets (from the sprite and palette files), size and colour. */
export function siegeLook(content: ContentBundle): SiegeLook {
  const { main, rounds } = skinSet(content, 'canvas2d');
  if (!main) throw new Error('the mini siege has no canvas2d skin (content/skins/canvas2d.json)');
  return {
    skin: main,
    rounds,
    sheet: contentSheets(content),
    screen: content.manifest.screen,
    background: BACKGROUND,
  };
}

/** The page's interface state a battle frame shows (selection, box, camera), when there is one. */
export type InterfaceOptions = () => Partial<
  Omit<RtsPresentOptions, 'faction' | 'size' | 'state' | 'missions'>
>;

/** One stream's state: the battle's, the round's map tracker, and what the last frame saw. */
export class SiegePresentState {
  readonly rts = new RtsPresentState();
  readonly roundMaps = new MapTracker();
  round: MiniGame | null = null;
  /** The mini game the hosted round is (the open mission's `play`), for its end event. */
  roundGame = '';
  open = 0;
  committed = 0;
}

/** The events between two frames (see the file comment), oldest first. */
function changes(game: MiniSiegeGame, state: SiegePresentState): PresentEvent[] {
  const events: PresentEvent[] = [];
  const round = game.miniGame();
  if (state.round !== null && state.round !== round) {
    events.push({ type: 'mini-game-end', game: state.roundGame, result: state.round.result() ?? 'quit' });
    state.roundMaps.reset();
  }
  state.round = round;
  state.roundGame = round === null ? '' : (game.host.playing?.play ?? '');
  const view = game.rts.view();
  const open = view.missions.open.length;
  if (open > state.open) events.push({ type: 'mission-open', mission: view.missions.open[0]?.id ?? '' });
  state.open = open;
  const records = game.records();
  for (const r of records.slice(state.committed))
    events.push({ type: 'mission-commit', mission: r.mission, outcome: r.outcome, resolution: r.resolution });
  state.committed = records.length;
  return events;
}

/** How the mini siege presents its game: the battle for the village, or the hosted round. */
export function siegeSource(
  screen: ScreenSize,
  missions: readonly RtsMissionInfo[],
  ui: InterfaceOptions = () => ({}),
): FrameSource<MiniSiegeGame, never, SiegePresentState> {
  return {
    start: () => new SiegePresentState(),
    present(game, _events, state) {
      const events = changes(game, state);
      const round = game.miniGame();
      let frame: PresentFrame;
      if (round?.present) {
        frame = round.present();
        if (frame.map && isFullMap(frame.map)) frame.map = state.roundMaps.next(frame.map);
        frame.status[MINI_GAME_STATUS] = state.roundGame;
      } else {
        frame = presentWorld(game.rts.view(), {
          ...ui(),
          faction: PLAYER,
          size: screen,
          missions,
          state: state.rts,
        });
        frame.status[MINI_GAME_STATUS] = '';
      }
      frame.events.push(...events);
      return frame;
    },
  };
}

/** The game's missions as the RTS presentation reads them (titles, events). */
export function siegeMissionInfo(content: ContentBundle): RtsMissionInfo[] {
  return siegeMissions(content).map((m) => ({
    id: m.id,
    title: m.title,
    ...(m.event !== undefined && { event: m.event }),
  }));
}

/** One stream of frames for any presenter. */
export type SiegeFrames = FrameStream<MiniSiegeGame, never, SiegePresentState>;

/** A new stream of frames at the picture size. */
export function siegeFrames(content: ContentBundle, ui?: InterfaceOptions): SiegeFrames {
  return new FrameStream(siegeSource(content.manifest.screen, siegeMissionInfo(content), ui));
}

/** The game drawn onto a presenter: `draw(game, [])` presents one frame and returns it. */
export type SiegePicture = FramePicture<MiniSiegeGame, never>;

/** One stream of frames onto any presenter. */
export function siegePicture(
  presenter: Presenter,
  content: ContentBundle,
  ui?: InterfaceOptions,
): SiegePicture {
  return new FramePicture(siegeFrames(content, ui), presenter);
}

/** One stream of frames onto `r` through the Canvas2D backend and the game's skins. */
export function siegeCanvasPicture(
  r: Renderer,
  content: ContentBundle,
  look: SiegeLook,
  ui?: InterfaceOptions,
  onSound?: (id: string) => void,
): SiegePicture {
  const presenter = skinSetCanvasPresenter(r, { ...look, ...(onSound && { onSound }) });
  return siegePicture(presenter, content, ui);
}
