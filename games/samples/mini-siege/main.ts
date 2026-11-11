import { contentPixelSheets } from '@engine/core/assets/content-sheets';
import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import type { JsonObject } from '@engine/core/headless';
import type { InputFrame, InputManager } from '@engine/core/input/input-manager';
import { keyHintMap } from '@engine/core/input/key-hints';
import { contentDecor, skinGroundCamera, skinSet } from '@engine/core/present';
import {
  bootBrowserGame,
  missionScreensScene,
  mountMissionBar,
  type BootedGame,
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
 * Boots the mini siege in the browser (Engine 0.11 T9) with the engine's `bootBrowserGame`. Since
 * Engine 0.16 F7 the page opens **in 3D** (`default3d`): the Three.js backend with the game's
 * `three` skins (the battle's low-poly map with its HUD, and the rounds'), every glTF model they
 * name loaded before the first frame, the decor grids, and the skin's render scale capped to what
 * the window shows (`?scale=<n>` sets it: the browser tests use 1). Without WebGL 2 the page runs
 * in 2D (Canvas2D, or PixiJS with `?backend=pixi`); `?backend=canvas2d` asks for 2D.
 *
 * Pointer gestures are on (select, command, pan, zoom the battle; in 3D through the ground view's
 * projection: the `RtsCamera` picks with the camera the picture is drawn with; taps in the walls'
 * round), the touch pad is left on for the rounds on a phone, and the arrow keys (or WASD) pan the
 * battle while no mission screen takes them. Sound is the shell's `audio`: the layered song
 * `siege` of the `three` skin's `music` (a calm layer, and a danger layer while a mission is open
 * or raiders are at the walls, mixed by the shell's mixer from each frame's status) and the
 * skins' event sounds; menus and mission screens sound on the ui bus. The title screen shows the
 * village behind it, the camera drifting slowly round its start (presentation only).
 *
 * The scene is `SiegePlay`'s (`play.ts`), the engine's `MissionLaunch`. In 3D the mission flow is
 * in the picture (Engine 0.16 F5's `MissionScreens`: the briefing, the mission card with Play or
 * Delegate, the mission result and the entry's results, drawn with the display's UI painter over
 * the battle; the pointer's taps on them kept from the battle's controls) and the DOM bar is not
 * mounted. In 2D the shell's `mountMissionBar` stays (launch buttons, Play / Delegate or Decide,
 * the status, Begin, the result with its save code, Continue, the stored save and the code box),
 * or `?ui=picture` shows the picture's screens there too. This file is only the boot and
 * `window.wwSiege` for scripts.
 */

const query = new URLSearchParams(location.search);

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
  /** `picture` when the mission flow is in the picture (3D, `?ui=picture`), `bar` for the DOM bar. */
  ui(): 'picture' | 'bar';
  /** The mission screen shown in the picture (`briefing`, `card`, `outcome`, `results`), or null. */
  screen(): string | null;
  /** The picture-px box of a mission screen's item (`begin`, `play`, `delegate`, `continue`, `launch:<id>`), or null. */
  itemBox(item: string): { x: number; y: number; w: number; h: number } | null;
  /** The picture point (picture px) the battle camera shows a world point (world px) at. */
  worldToScreen(x: number, y: number): { x: number; y: number };
  /** The battle camera: its centre (world px) and zoom. */
  camera(): { x: number; y: number; zoom: number };
}

const content = mustLoad(loadMiniSiege(gameFiles), 'the mini siege');
const look = siegeLook(content);
const fonts = contentFonts(content);
const skins3d = skinSet(content, 'three');
const skin3d = skins3d.main!;

/** The 3D picture's render scale: `?scale=<n>`, else the skin's, capped to the window's pixels. */
function renderScale(): number {
  const asked = Number(query.get('scale'));
  if (Number.isInteger(asked) && asked >= 1 && asked <= 8) return asked;
  const skin = skin3d.scene3d?.renderScale ?? 1;
  const shown = Math.ceil((window.innerHeight * (window.devicePixelRatio || 1)) / look.screen.height);
  return Math.max(1, Math.min(skin, shown));
}

/** The mission card in 3D: as wide as its chips need in the HUD's font (Engine 0.16 F7). */
const CARD_3D = { width: 124, font: 'siege-tiny' } as const;

let play: SiegePlay | null = null;
let bar: MissionBar | null = null;
let screens: MissionScreens<MiniSiegeGame> | null = null;
let input: InputManager | null = null;
let booted: BootedGame | null = null;
/** True once the 3D display runs (the factory gave a display, not a reason). */
let in3d = false;
booted = await bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  default3d: true,
  audio: {
    sfx: contentSfx(content),
    songs: contentSongs(content),
    music: 'siege',
    mix: skin3d.music,
    seed: content.manifest.start.seed,
  },
  // The title, pause and settings screens (Engine 0.16 T9): Continue carries on from the save this
  // browser kept (the bar's "Carry on"); Back to title reloads the page.
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
    // The default (Engine 0.16 F7): Three.js in its own chunk, its models loaded first.
    three: async (canvas, { onSound, hitPause }) => {
      const three = await import('@engine/backends/three');
      if (!three.webgl2Available()) return three.threeDisplay(canvas, { screen: look.screen, skin: skin3d });
      const models = new three.ModelLibrary(content.assets ?? {});
      await models.preload([skin3d, ...Object.values(skins3d.rounds)]);
      const display = three.threeDisplay(canvas, {
        screen: look.screen,
        skin: skin3d,
        rounds: skins3d.rounds,
        sheets: contentPixelSheets(content),
        fonts,
        models,
        decor: contentDecor(content),
        renderScale: renderScale(),
        onSound,
        onHitPause: hitPause,
      });
      in3d = typeof display !== 'string';
      return display;
    },
  },
  pointer: true,
  scene(stack, display, page) {
    const source = page.pointer;
    // With the screens in the picture, a tap on them is theirs, never an order on the battle.
    const pointer = source && { gestures: () => screens?.uncovered(source.gestures()) ?? source.gestures() };
    const scene = new SiegePlay({
      content,
      seed: content.manifest.start.seed,
      pointer,
      ...(in3d && { camera: { ground: skinGroundCamera(skin3d), zoom: skin3d.camera?.zoom ?? 1 } }),
    });
    play = scene;
    const host = scene.scene(stack, () => siegePicture(display.presenter, content, scene.ui));
    const painter = display.uiPainter?.bind(display);
    // The arrow keys pan the battle while no round is played and no mission screen is shown.
    const pan = (frame: InputFrame) => {
      if (!scene.launch.playing() && (screens?.kind() ?? null) === null) scene.keyPan(frame);
    };
    // The title's slow drift over the village (presentation only), put back when play starts.
    let drift = 0;
    const drifting = () => {
      if (booted?.menus?.state === 'title') scene.drift(++drift);
      else if (drift > 0) scene.drift((drift = 0));
    };
    // The mission screens step aside while the title or the pause menu shows.
    const menuShown = () => (booted?.menus?.state ?? 'play') !== 'play';
    if ((in3d || query.get('ui') === 'picture') && painter !== undefined) {
      screens = scene.missionScreens({
        fonts,
        pointer: source,
        keys: () => keyHintMap(input?.bindings[0]?.keyboard),
        onSound: (id) => page.uiSound(id),
        // In 3D the corner cards use the HUD's small font, so they stay clear of the battle.
        ...(in3d && { card: CARD_3D }),
      });
      const over = missionScreensScene(host, screens, () => painter());
      return {
        update: (frame, frames) => {
          pan(frame);
          over.update(frame, frames);
        },
        headless: () => host.headless(),
        render: (r) => {
          drifting();
          if (menuShown()) host.render(r);
          else over.render(r);
        },
      };
    }
    return {
      update: (frame) => {
        pan(frame);
        host.update(frame);
      },
      // The game the page plays now, for the shell's `window.__ww` (`?debug=step`, `?record`).
      headless: () => host.headless(),
      render: (r) => {
        drifting();
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
  document.body.dataset['ui'] = screens === null ? 'bar' : 'picture';
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
    ui: () => (screens === null ? 'bar' : 'picture'),
    screen: () => screens?.kind() ?? null,
    itemBox: (item) => screens?.sync()?.itemBox('main', item) ?? null,
    worldToScreen: (x, y) => scene.camera.worldToScreen(x, y),
    camera: () => ({ ...scene.camera.centre(), zoom: scene.camera.zoom }),
  };
  (window as unknown as { wwSiege: SiegeHook }).wwSiege = hook;
}
