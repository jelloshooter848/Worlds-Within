import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import type { JsonObject } from '@engine/core/headless';
import type { InputManager } from '@engine/core/input/input-manager';
import { keyHintMap } from '@engine/core/input/key-hints';
import {
  bootBrowserGame,
  missionScreensScene,
  mountMissionBar,
  type LaunchEntryResult,
  type MissionBar,
  type MissionScreens,
} from '@engine/core/shell';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { contentFonts } from '@engine/core/ui';
import { loadMiniSiege, PLAYER } from './content';
import { siegeLook, siegePicture } from './picture';
import type { MiniSiegeGame, NamedSummary } from './headless';
import { SiegePlay } from './play';
import gameFiles from 'virtual:game-files';

/**
 * Boots the mini siege in the browser (Engine 0.11 T9) with the engine's `bootBrowserGame`:
 * Canvas2D with both skins (the battle's and the rounds', `siegeLook`), pointer gestures on
 * (select, command, pan, zoom the battle; taps in the walls' round), the touch pad left on for the
 * rounds on a phone, the shell's `audio` option (the song `siege` once the first key, tap or click
 * unlocks sound, and the skins' event sounds) and its volume control (gap M1). The scene is
 * `SiegePlay`'s (`play.ts`), the engine's `MissionLaunch`; since Engine 0.15 T10 (gaps M26, M34,
 * M36, lesson D14) the bar, the briefing and the result panel are the shell's `mountMissionBar`
 * (launch buttons, Play / Delegate or Decide, the status with the round's key hint, Begin, the
 * result with its save code, Continue, the stored save and the code box). Since Engine 0.16 F5,
 * `?ui=picture` shows the flow in the picture instead of the bar: the shell's `MissionScreens`
 * (briefing, mission card, results) drawn with the display's UI painter over the battle, the
 * pointer's taps on them kept from the battle's controls. This file is only the boot and
 * `window.wwSiege` for scripts.
 */

const pictureUi = new URLSearchParams(location.search).get('ui') === 'picture';

/** What the page offers scripts on `window.wwSiege`. */
export interface SiegeHook {
  /** The world tick. */
  tick(): number;
  /** True while the entry played now is held at tick 0, waiting for Begin (gap M34). */
  held(): boolean;
  /** The mission waiting for play or delegate, or null. */
  choice(): string | null;
  /** True while the mission's round is being played. */
  playing(): boolean;
  /** The committed missions' outcomes, in commit order. */
  outcomes(): string[];
  /** The hosted mini game (the open mission's `play`: `mission-room`, `td-defence`), or ''. */
  miniGame(): string;
  /** The hosted round's `kit` summary (the walls' round: `gold`, `towers`, `outcome`, ...), or null. */
  round(): JsonObject | null;
  /** The campaign entry played now (`village`, `dawn`). */
  scenario(): string;
  /** How the entry played now ended, or null while it is played. */
  ended(): LaunchEntryResult | null;
  /** Every keyed scenario entity at a glance (`MiniSiegeGame.named()`). */
  named(): Record<string, NamedSummary>;
  /** The HUD's captive marker: the name of the village's captured person, or ''. */
  captive(): string;
}

const content = mustLoad(loadMiniSiege(gameFiles), 'the mini siege');
const look = siegeLook(content);
const fonts = contentFonts(content);

let play: SiegePlay | null = null;
let bar: MissionBar | null = null;
let screens: MissionScreens<MiniSiegeGame> | null = null;
let input: InputManager | null = null;
const booted = await bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  audio: { sfx: contentSfx(content), songs: contentSongs(content), music: 'siege' },
  // The title, pause and settings screens (Engine 0.16 T9): Continue carries on from the save this
  // browser kept (the bar's "Carry on"); Back to title reloads the page, whose bar holds the scene.
  menus: {
    spec: content.manifest.menus,
    fonts,
    sheets: look.sheet,
    restart: 'reload',
    canContinue: () => (play?.launch.storedSave() ?? null) !== null,
    onContinue: () => play?.launch.press({ kind: 'stored' }),
  },
  displays: {
    canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, fonts, onSound }),
    // `?backend=pixi` (Engine 0.16 T13b-4): PixiJS in its own chunk, Canvas2D without WebGL.
    pixi: async (canvas, { onSound }) =>
      (await import('@engine/backends/pixi')).pixiDisplay(canvas, { ...look, fonts, onSound }),
  },
  pointer: true,
  scene(stack, display, page) {
    const source = page.pointer;
    // With the screens in the picture, a tap on them is theirs, never an order on the battle.
    const pointer = source && { gestures: () => screens?.uncovered(source.gestures()) ?? source.gestures() };
    const scene = new SiegePlay({ content, seed: content.manifest.start.seed, pointer });
    play = scene;
    const host = scene.scene(stack, () => siegePicture(display.presenter, content, scene.ui));
    const painter = display.uiPainter?.bind(display);
    if (pictureUi && painter !== undefined) {
      screens = scene.missionScreens({
        fonts,
        pointer: source,
        keys: () => keyHintMap(input?.bindings[0]?.keyboard),
        onSound: (id) => page.uiSound(id),
      });
      const over = missionScreensScene(host, screens, () => painter());
      return {
        update: (frame, frames) => over.update(frame, frames),
        headless: () => host.headless(),
        render: (r) => over.render(r),
      };
    }
    return {
      update: (input) => host.update(input),
      // The game the page plays now, for the shell's `window.__ww` (`?debug=step`, `?record`).
      headless: () => host.headless(),
      render: (r) => {
        host.render(r);
        bar?.update();
      },
    };
  },
});

if (booted && play) {
  const scene: SiegePlay = play;
  const { launch } = scene;
  input = booted.input;
  if (screens === null) bar = mountMissionBar({ launch, input: booted.input });
  const hook: SiegeHook = {
    tick: () => scene.tick,
    held: () => launch.held(),
    choice: () => launch.choice(),
    playing: () => launch.playing(),
    outcomes: () => launch.records().map((r) => r.outcome),
    miniGame: () => (launch.playing() ? (scene.game.playing?.play ?? '') : ''),
    round: () => (scene.game.miniGame()?.snapshot()['kit'] as JsonObject | undefined) ?? null,
    scenario: () => scene.scenario,
    ended: () => launch.ended(),
    named: () => scene.game.named(),
    captive: () => scene.view().named.find((n) => n.faction === PLAYER && n.fate === 'captured')?.name ?? '',
  };
  (window as unknown as { wwSiege: SiegeHook }).wwSiege = hook;
}
