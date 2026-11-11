import { contentSheets } from '@engine/core/assets/content-sheets';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import type { ContentBundle } from '@engine/core/content/bundle';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import { campaignRun } from '@engine/core/campaign';
import { clockStatus } from '@engine/core/clock';
import { missionHostEvents } from '@engine/core/mission-host';
import {
  FramePicture,
  FrameStream,
  mustSkinSet,
  type FrameSource,
  type Presenter,
  type SkinFile,
} from '@engine/core/present';
import { hostedSource, type HostedPresentState } from '@engine/core/present/hosted';
import { skinSetCanvasPresenter } from '@engine/backends/canvas2d';
import {
  presentWorld,
  rtsMissionInfo,
  RtsPresentState,
  type RtsMissionInfo,
  type RtsPresentOptions,
} from '@kits/rts';
import { PLAYER, siegeMissions } from './content';
import type { MiniSiegeGame } from './headless';

/**
 * Glue between the kits' frames and the Canvas2D backend: no drawing of its own. One stream of
 * frames over the `MiniSiegeGame`, the core's `hostedSource` (Engine 0.15 T6, gap M6): while no
 * round is hosted, the RTS kit's `presentWorld` for the village (with the game's missions, so the
 * offer marker and the mission HUD show); while a mission's round is hosted, the host's
 * `roundFrame()` (the topdown kit's room for `sabotage`, the towerdefense kit's walls for
 * `fortify`, each with the host's `mission` title and `status.miniGame` set by the host to the
 * mini game the mission plays: `mission-room`, `td-defence`; gap D9). The backend's
 * `skinSetCanvasPresenter` sends each frame to its skin: `canvas2d.json` for the battle,
 * `canvas2d-mission-room.json` for the room and `canvas2d-td-defence.json` for the walls' round.
 *
 * The events the battle's skin plays sounds for are the `MissionHost`'s own (gap M21), handed
 * in with each draw (`draw(game, events)`, the host's `events` of the steps since the last frame)
 * and put on the frame by `missionHostEvents`: `mission-open`, `mini-game-end` with the round's
 * `result` (`mini-game-end:pass` / `fail` / `quit`) and `mission-commit` with the record's
 * `outcome` and `resolution` (`mission-commit:outcome=both-burnt`). Every frame also carries the
 * world clock (Engine 0.16 F4: `clock.day`, `clock.time`, `clock.text`, `clock.phase`,
 * `clock.fraction`, from the campaign entry's `clock` and the world tick). Shared by the page
 * (`main.ts`), the view (`view.ts`, for `pnpm cli screenshot`) and the tests, so a screenshot is
 * what a player sees.
 */

/**
 * What drawing the game needs: the battle's skin, a skin per mini game, the sheets and size. The
 * colour behind the map (the grass) is the battle skin's `background` (gap G36); the rounds' skins
 * give none, so they clear to black.
 */
export interface SiegeLook {
  skin: SkinFile;
  rounds: Record<string, SkinFile>;
  sheet: SheetLookup;
  screen: ScreenSize;
}

/** The `canvas2d` skins, the sprite sheets (from the sprite and palette files), size. */
export function siegeLook(content: ContentBundle): SiegeLook {
  const { main, rounds } = mustSkinSet(content, 'canvas2d', 'the mini siege');
  return {
    skin: main,
    rounds,
    sheet: contentSheets(content),
    screen: content.manifest.screen,
  };
}

/** The page's interface state a battle frame shows (selection, box, camera), when there is one. */
export type InterfaceOptions = () => Partial<
  Omit<RtsPresentOptions, 'faction' | 'size' | 'state' | 'missions'>
>;

/** One stream's state: the core's hosted state over the battle's. */
export type SiegePresentState = HostedPresentState<RtsPresentState>;

/** How the mini siege presents its game: the battle for the village, or the hosted round. */
export function siegeSource(
  screen: ScreenSize,
  missions: readonly RtsMissionInfo[],
  ui: InterfaceOptions = () => ({}),
): FrameSource<MiniSiegeGame, unknown, SiegePresentState> {
  const battle: FrameSource<MiniSiegeGame, unknown, RtsPresentState> = {
    start: () => new RtsPresentState(),
    present: (game, _events, state) =>
      presentWorld(game.rts.view(), {
        ...ui(),
        faction: PLAYER,
        size: screen,
        missions,
        keys: game.worldKeys(),
        // Each scenario's map by its own id (Engine 0.16 F6), so the 3D skin dresses each one.
        mapId: game.campaign.scenario,
        state,
      }),
  };
  return hostedSource(battle, {
    round: (game) => game.roundFrame(),
    events: missionHostEvents,
    // The world clock (Engine 0.16 F4) and the campaign entry's title (F7: the HUD's title bar).
    status: (game) => {
      const clock = game.clock();
      const title = campaignRun(game.campaign.def, game.campaign.save).entry?.title;
      return {
        ...(clock ? clockStatus(clock) : {}),
        ...(title !== undefined && { [ENTRY_TITLE_STATUS]: title }),
      };
    },
  });
}

/** The status key holding the campaign entry's title (`The siege`), for the HUD's title bar. */
export const ENTRY_TITLE_STATUS = 'entryTitle';

/** The game's missions as the RTS presentation reads them (titles, events, `marker` keys: gap M25). */
export function siegeMissionInfo(content: ContentBundle): RtsMissionInfo[] {
  return siegeMissions(content).map(rtsMissionInfo);
}

/** One stream of frames for any presenter. */
export type SiegeFrames = FrameStream<MiniSiegeGame, unknown, SiegePresentState>;

/** A new stream of frames at the picture size. */
export function siegeFrames(content: ContentBundle, ui?: InterfaceOptions): SiegeFrames {
  return new FrameStream(siegeSource(content.manifest.screen, siegeMissionInfo(content), ui));
}

/** The game drawn onto a presenter: `draw(game, events)` presents one frame (with the host's events since the last) and returns it. */
export type SiegePicture = FramePicture<MiniSiegeGame, unknown>;

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
