import { withContentImages } from '@engine/core/assets/content-images';
import { contentSfx, contentSongs } from '@engine/core/content/game-content';
import { canvasDisplay, CanvasUiPainter } from '@engine/backends/canvas2d';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { SoundCue } from '@engine/core/present';
import type { SceneStack } from '@engine/core/scene';
import {
  backendFromQuery,
  bootBrowserGame,
  HostScene,
  UiScene,
  type BrowserDisplay,
} from '@engine/core/shell';
import type { UiEvent, UiScreen } from '@engine/core/ui';
import { stageNames } from '@kits/platformer';
import { fxStages, mustLoadFxLab } from './content';
import { createGame } from './headless';
import { fxLook, fxPicture } from './picture';
import { fxLook3d } from './picture3d';
import { fxUiScreen } from './ui';
import gameFiles from 'virtual:game-files';

/**
 * Boots the fx lab in the browser with the engine's `bootBrowserGame`: Canvas2D by default, the
 * Three.js backend with `?backend=three` and the PixiJS one with `?backend=pixi` (each imported
 * only then; PixiJS falls back to Canvas2D without WebGL). Sounds come from the skins: the
 * kit's events and the frame events of Pip's animation cycles (footsteps on the walk and run
 * frames) both reach the shell's `onSound`, which plays the game's sfx. Every sound id played is
 * also kept in `window.wwFxLab.sounds`, so a browser test can check the frame events' sounds
 * (`tests/browser/fx-lab.test.ts`). Skin events' `hitPause` (a stomp's freeze frames) reach the
 * shell's `hitPause`, which holds the game's ticks while the picture keeps drawing. Arrows (or the
 * touch pad) move, Z jumps, X runs.
 *
 * The UI kit (Engine 0.16 T7): in 2D, Enter pauses the level under the lab's
 * `content/ui/lab.json` menu, run by the shell's `UiScene` with keyboard, gamepad, mouse and
 * touch (the boot's `pointer` gives taps and hover in picture pixels); "Talk to Pip" opens the
 * dialog. `?ui=menu` or `?ui=dialog` opens one at load, and `window.wwFxLab.ui` opens them and
 * reads the screen and its events (for `tests/browser/fx-lab-ui.test.ts`). The lab's menu is drawn
 * with the 2D display's UI painter (Canvas2D's or PixiJS's), so in 3D the start key does nothing.
 *
 * The menus (Engine 0.16 T9): `game.json`'s `menus` gives the lab a title screen, the shell's
 * pause menu (Escape, P, pad Start, the on-screen button), settings and controls, in both
 * backends; `?debug=step` skips the title. From Engine 0.16 part B the title's Levels item opens the
 * shell's level select (the levels' names from their headers; cleared ones marked, later ones
 * locked until the one before is cleared), a level-clear banner shows during the kit's pause
 * between levels, the end screen follows the last level, and the `respawn` transition (an iris)
 * plays on the kit's respawn event.
 *
 * The mixer (Engine 0.16 T8): the 2D skin's `music` section plays `lab`, a calm and a danger layer
 * (`content/songs/`) mixed by the kit's `nearestActor` status (danger near a beetle), on both
 * backends; footsteps and jumps vary in pitch and volume, stomps and hurts duck the music, and
 * so does the dialog box. UI sounds play on the ui bus (`page.uiSound`). `__ww.mix()` reads it
 * (`tests/browser/fx-lab-mix.test.ts`).
 */
// The 2D skin's PNG sheet (the torch, Engine 0.16 T10) is decoded before the page boots.
const content = await withContentImages(mustLoadFxLab(gameFiles));
const look = fxLook(content);

/** What the page shows tests: the sounds it played and the UI screen (presentation only). */
interface FxLabWindow {
  sounds: string[];
  ui: {
    open(which?: 'menu' | 'dialog'): boolean;
    screen(): UiScreen | null;
    events: UiEvent[];
  };
}

/** Every sound id the page played, in order (for tests; presentation only). */
const sounds: string[] = [];
const heard =
  (onSound: (id: string, cue?: SoundCue) => void) =>
  (id: string, cue?: SoundCue): void => {
    sounds.push(id);
    onSound(id, cue);
  };
const uiEvents: UiEvent[] = [];
const twoD = backendFromQuery(location.search) !== 'three';
let stack: SceneStack | null = null;
/** The page's display, for its UI painter. */
let shown: BrowserDisplay | null = null;

/** Pushes the lab's UI over the level (2D only); false when one is open already or in 3D. */
function openUi(which: 'menu' | 'dialog' = 'menu'): boolean {
  if (!twoD || stack === null || stack.top instanceof UiScene) return false;
  const ui = fxUiScreen(content, {
    sheets: look.sheet,
    fonts: look.fonts,
    onSound: heard((id) => page?.uiSound(id)),
    open: which,
  });
  const scenes = stack;
  scenes.push(
    new UiScene({
      ui,
      // The display's own painter (Canvas2D's or PixiJS's), else Canvas2D's on the renderer.
      painter: (r) => shown?.uiPainter?.() ?? new CanvasUiPainter(r, look.sheet, look.fonts),
      pointer: page?.pointer ?? null,
      onEvent: (e, scene) => {
        uiEvents.push(e);
        const leave =
          (e.type === 'activate' && (e.item === 'resume' || e.item === 'quit')) ||
          (e.type === 'back' && e.widget === 'main') ||
          (e.type === 'choice' && e.item === 'yes');
        if ((leave || scene.ui.focused === null) && scenes.top === scene) scenes.pop();
      },
    }),
  );
  return true;
}

let page: {
  pointer: { cursor(): { x: number; y: number } | null } | null;
  uiSound(id: string): void;
} | null = null;
const lab: FxLabWindow = {
  sounds,
  ui: {
    open: openUi,
    screen: () => (stack?.top instanceof UiScene ? stack.top.ui : null),
    events: uiEvents,
  },
};
(window as { wwFxLab?: FxLabWindow }).wwFxLab = lab;

/** The level, with the start key opening the lab's menu in 2D. */
class FxLabScene<W extends object, E> extends HostScene<W, E> {
  override update(input: InputFrame): void {
    if (input.pressed('start') && openUi('menu')) return;
    super.update(input);
  }
}

const booted = bootBrowserGame({
  screen: look.screen,
  pointer: true,
  game: content.manifest.id,
  transitions: content.manifest.transitions,
  menus: {
    spec: content.manifest.menus,
    fonts: look.fonts,
    sheets: look.sheet,
    // The level select, level-clear banner and end screen (Engine 0.16 part B): the levels by name.
    levels: stageNames(fxStages(content)),
  },
  audio: {
    sfx: contentSfx(content),
    songs: contentSongs(content),
    mix: look.skin.music,
    music: 'lab',
    seed: content.manifest.start.seed,
  },
  displays: {
    canvas2d: (canvas, { onSound, hitPause }) =>
      canvasDisplay(canvas, { ...look, onSound: heard(onSound), onHitPause: hitPause }),
    // `?backend=pixi` (Engine 0.16 T13b-4): PixiJS in its own chunk, Canvas2D without WebGL.
    pixi: async (canvas, { onSound, hitPause }) =>
      (await import('@engine/backends/pixi')).pixiDisplay(canvas, {
        ...look,
        onSound: heard(onSound),
        onHitPause: hitPause,
      }),
    three: async (canvas, { onSound, hitPause }) => {
      const three = await import('@engine/backends/three');
      const look3d = fxLook3d(content);
      // The 3D skin's glTF brazier (Engine 0.16 T11), loaded before the first frame.
      const models = new three.ModelLibrary(content.assets ?? {});
      await models.preload([look3d.skin]);
      return three.threeDisplay(canvas, { ...look3d, models, onSound: heard(onSound), onHitPause: hitPause });
    },
  },
  scene: (scenes, display, booted) => {
    stack = scenes;
    shown = display;
    page = booted;
    return new FxLabScene({
      stack: scenes,
      // A level chosen in the level select starts there, as a run file's `start: { stage }` does.
      game: createGame(content, content.manifest.start.seed, booted.start ? { start: booted.start } : {}),
      picture: () => fxPicture(display.presenter, look.screen),
    });
  },
});
void booted.then(() => {
  const ask = new URLSearchParams(location.search).get('ui');
  if (ask === 'menu' || ask === 'dialog') openUi(ask);
});
