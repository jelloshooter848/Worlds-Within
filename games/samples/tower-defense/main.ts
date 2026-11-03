import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import type { Action } from '@engine/core/input/actions';
import type { JsonObject } from '@engine/core/headless';
import { bootBrowserGame } from '@engine/core/shell';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { loadTowerDefense } from './content';
import { tdLook, tdPicture } from './picture';
import { TdPlay } from './play';
import gameFiles from 'virtual:game-files';

/**
 * Boots the tower-defense sample in the browser (Engine 0.12 T5) with the engine's
 * `bootBrowserGame`: Canvas2D with the sample's skin, the keyboard and gamepad, the touch pad (on
 * a phone), pointer taps (place towers by tapping: frame input, gap D1), the shell's `audio`
 * option (the song `road` once the first key, tap or click unlocks sound, and the skin's event
 * sounds) and its volume control (the player's volumes stored per game, gap M1). The scene is
 * `TdPlay` (`play.ts`, stepped at its own `tickRate` by the shell, gap D2); this file is only the
 * DOM: the bar under the picture (Wave, Tower and Sell buttons, pressing through the shell's
 * `InputManager.press`, and the status line) and `window.wwTd` for scripts (the browser test).
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
const status = document.getElementById('status') as HTMLElement;
/** The status line before the first wave. */
const HINT = 'arrows move, Z or a tap builds, X picks the tower, Enter sends a wave';

let play: TdPlay | null = null;
const booted = await bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  audio: { sfx: contentSfx(content), songs: contentSongs(content), music: 'road' },
  displays: { canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, onSound }) },
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
  const { input } = booted;
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
    el.addEventListener('click', () => input.press(action));
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
          ? HINT
          : '';
  const text = [`tick ${w.tick}`, note].filter((s) => s !== '').join(' | ');
  if (status.textContent !== text) status.textContent = text;
}
