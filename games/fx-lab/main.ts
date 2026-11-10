import { contentSfx } from '@engine/core/content/game-content';
import { canvasDisplay, CanvasUiPainter } from '@engine/backends/canvas2d';
import type { InputFrame } from '@engine/core/input/input-manager';
import type { SceneStack } from '@engine/core/scene';
import { backendFromQuery, bootBrowserGame, HostScene, UiScene } from '@engine/core/shell';
import type { UiEvent, UiScreen } from '@engine/core/ui';
import { mustLoadFxLab } from './content';
import { createGame } from './headless';
import { fxLook, fxPicture } from './picture';
import { fxLook3d } from './picture3d';
import { fxUiScreen } from './ui';
import gameFiles from 'virtual:game-files';

/**
 * Boots the fx lab in the browser with the engine's `bootBrowserGame`: Canvas2D by default, the
 * Three.js backend with `?backend=three` (imported only then). Sounds come from the skins: the
 * kit's events and the frame events of Pip's animation cycles (footsteps on the walk and run
 * frames) both reach the shell's `onSound`, which plays the game's sfx. Every sound id played is
 * also kept in `window.wwFxLab.sounds`, so a browser test can check the frame events' sounds
 * (`tests/browser/fx-lab.test.ts`). Skin events' `hitPause` (a stomp's freeze frames) reach the
 * shell's `hitPause`, which holds the game's ticks while the picture keeps drawing. Arrows (or the
 * touch pad) move, Z jumps, X runs.
 *
 * The UI kit (Engine 0.16 T7): in 2D, Enter (Esc, pad Start) pauses the level under the lab's
 * `content/ui/lab.json` menu, run by the shell's `UiScene` with keyboard, gamepad, mouse and
 * touch (the boot's `pointer` gives taps and hover in picture pixels); "Talk to Pip" opens the
 * dialog. `?ui=menu` or `?ui=dialog` opens one at load, and `window.wwFxLab.ui` opens them and
 * reads the screen and its events (for `tests/browser/fx-lab-ui.test.ts`). The 3D backend does not
 * draw UI screens yet (Engine 0.16 T9), so there the start key does nothing.
 */
const content = mustLoadFxLab(gameFiles);
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
let playSound: (id: string) => void = () => undefined;
const heard = (onSound: (id: string) => void) => {
  playSound = onSound;
  return (id: string) => {
    sounds.push(id);
    onSound(id);
  };
};
const uiEvents: UiEvent[] = [];
const twoD = backendFromQuery(location.search) === 'canvas2d';
let stack: SceneStack | null = null;

/** Pushes the lab's UI over the level (2D only); false when one is open already or in 3D. */
function openUi(which: 'menu' | 'dialog' = 'menu'): boolean {
  if (!twoD || stack === null || stack.top instanceof UiScene) return false;
  const ui = fxUiScreen(content, {
    sheets: look.sheet,
    fonts: look.fonts,
    onSound: (id) => heard(playSound)(id),
    open: which,
  });
  const scenes = stack;
  scenes.push(
    new UiScene({
      ui,
      painter: (r) => new CanvasUiPainter(r, look.sheet, look.fonts),
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

let page: { pointer: { cursor(): { x: number; y: number } | null } | null } | null = null;
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
  audio: { sfx: contentSfx(content) },
  displays: {
    canvas2d: (canvas, { onSound, hitPause }) =>
      canvasDisplay(canvas, { ...look, onSound: heard(onSound), onHitPause: hitPause }),
    three: async (canvas, { onSound, hitPause }) =>
      (await import('@engine/backends/three')).threeDisplay(canvas, {
        ...fxLook3d(content),
        onSound: heard(onSound),
        onHitPause: hitPause,
      }),
  },
  scene: (scenes, display, booted) => {
    stack = scenes;
    page = booted;
    return new FxLabScene({
      stack: scenes,
      game: createGame(content, content.manifest.start.seed),
      picture: () => fxPicture(display.presenter, look.screen),
    });
  },
});
void booted.then(() => {
  const ask = new URLSearchParams(location.search).get('ui');
  if (ask === 'menu' || ask === 'dialog') openUi(ask);
});
