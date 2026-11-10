import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import type { Action } from '@engine/core/input/actions';
import { DEFAULT_KEYBOARD_P1 } from '@engine/core/input/bindings';
import type { InputManager } from '@engine/core/input/input-manager';
import { keyHintMap } from '@engine/core/input/key-hints';
import { controlsHint } from '@engine/core/minigame';
import type { JsonObject } from '@engine/core/headless';
import { bootBrowserGame } from '@engine/core/shell';
import { contentFonts } from '@engine/core/ui';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { TD_CONTROLS } from '@kits/towerdefense';
import { loadTowerDefense } from './content';
import { tdLook, tdPicture } from './picture';
import { TdPlay } from './play';
import gameFiles from 'virtual:game-files';

/**
 * Boots the tower-defense sample in the browser (Engine 0.12 T5) with the engine's
 * `bootBrowserGame`: PixiJS (WebGL) with the sample's skin (Engine 0.16 T13b-8; Canvas2D where
 * WebGL is missing or with `?backend=canvas2d`), the keyboard and gamepad, the touch pad (on
 * a phone), pointer taps (place towers by tapping: frame input, gap D1), the shell's `audio`
 * option (the song `road` once the first key, tap or click unlocks sound, and the skin's event
 * sounds) and its volume control (the player's volumes stored per game, gap M1). The scene is
 * `TdPlay` (`play.ts`, stepped at its own `tickRate` by the shell, gap D2); this file is only the
 * DOM: the bar under the picture (Wave, Tower and Sell buttons, pressing through the shell's
 * `InputManager.press`, and the status line, whose hint before the first wave is the kit's
 * `TD_CONTROLS` written with the player's key names, lesson D14) and `window.wwTd` for scripts
 * (the browser test).
 */

/** What the page offers scripts (the browser test) on `window.wwTd`. */
export interface TdHook {
  /** The game tick. */
  tick(): number;
  /** The game's `kit` summary (`outcome`, `gold`, `lives`, `wave`, `towers`, `killed`, ...). */
  kit(): JsonObject;
  /** The cursor's cell and the chosen tower type. */
  cursor(): { col: number; row: number; tower: string };
}

const content = mustLoad(loadTowerDefense(gameFiles), 'the tower-defense sample');
const look = tdLook(content);
const fonts = contentFonts(content);
const status = document.getElementById('status') as HTMLElement;
/** The shell's input once booted: the player's key names for the hint (the defaults until then). */
let input: InputManager | null = null;

let play: TdPlay | null = null;
const booted = await bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  audio: { sfx: contentSfx(content), songs: contentSongs(content), music: 'road' },
  // The title, pause and settings screens (Engine 0.16 T9); Back to title reloads the page, whose
  // bar and hook hold on to the first scene.
  menus: { spec: content.manifest.menus, fonts, sheets: look.sheet, restart: 'reload' },
  displays: {
    canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, fonts, onSound }),
    // PixiJS (Engine 0.16 T13b-4) in its own chunk; Canvas2D without WebGL.
    pixi: async (canvas, { onSound }) =>
      (await import('@engine/backends/pixi')).pixiDisplay(canvas, { ...look, fonts, onSound }),
  },
  // PixiJS by default (Engine 0.16 T13b-8), Canvas2D where WebGL is missing or with
  // `?backend=canvas2d`.
  default2d: 'pixi',
  pointer: true,
  scene(_stack, display) {
    const scene = new TdPlay({
      content,
      seed: content.manifest.start.seed,
      picture: (_r, game) => tdPicture(display.presenter, look.screen, () => game.controls.view()),
    });
    play = scene;
    return {
      tickRate: scene.tickRate,
      update: (input) => scene.update(input),
      headless: () => scene.headless(),
      render: (r) => {
        scene.render(r);
        showStatus(scene);
      },
    };
  },
});

if (booted && play) {
  const scene: TdPlay = play;
  input = booted.input;
  const pressed = booted.input;
  button('wave', 'start');
  button('tower', 'attack');
  button('sell', 'special');
  const hook: TdHook = {
    tick: () => scene.tick,
    kit: () => scene.game.snapshot()['kit'] as JsonObject,
    cursor: () => scene.game.controls.view(),
  };
  (window as unknown as { wwTd: TdHook }).wwTd = hook;

  /** A bar button that presses `action` on the next tick (never focused, so keys stay the game's). */
  function button(id: string, action: Action): void {
    const el = document.getElementById(id) as HTMLButtonElement;
    el.addEventListener('pointerdown', (e) => e.preventDefault());
    el.addEventListener('click', () => pressed.press(action));
  }
}

function showStatus(scene: TdPlay): void {
  const w = scene.game.world;
  const note =
    w.outcome === 'won'
      ? 'the road is held!'
      : w.outcome === 'lost'
        ? 'the road is lost'
        : w.wavesStarted === 0
          ? hint()
          : '';
  const text = [`tick ${w.tick}`, note].filter((s) => s !== '').join(' | ');
  if (status.textContent !== text) status.textContent = text;
}

/** The kit's controls (`TD_CONTROLS`, lesson D14) with the player's key names: no page strings. */
function hint(): string {
  return controlsHint(TD_CONTROLS, keyHintMap(input?.bindings[0]?.keyboard ?? DEFAULT_KEYBOARD_P1));
}
