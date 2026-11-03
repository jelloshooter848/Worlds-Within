import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import type { Action } from '@engine/core/input/actions';
import type { JsonObject } from '@engine/core/headless';
import { bootBrowserGame } from '@engine/core/shell';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { TD_TILE_SIZE } from '@kits/towerdefense';
import { loadTowerDefense } from './content';
import { tdLook, tdPicture } from './picture';
import { TdPlay } from './play';
import gameFiles from 'virtual:game-files';

/**
 * Boots the tower-defense sample in the browser (Engine 0.12 T5) with the engine's
 * `bootBrowserGame`: Canvas2D with the sample's skin, the keyboard and gamepad, the touch pad (on
 * a phone), pointer taps (place towers by tapping), and the shell's `audio` option (the song
 * `road` once the first key, tap or click unlocks sound, and the skin's event sounds). The scene
 * is `TdPlay` (`play.ts`); this file is only the DOM: the bar under the picture (Wave, Tower and
 * Sell buttons and the status line) and `window.wwTd` for scripts (the browser test).
 */

/** What the page offers scripts (the browser test) on `window.wwTd`. */
export interface TdHook {
  /** The game tick. */
  tick(): number;
  /** The game's `kit` summary (`outcome`, `gold`, `lives`, `wave`, `towers`, `killed`, ...). */
  kit(): JsonObject;
  /** The cursor's cell and the chosen tower type. */
  cursor(): { col: number; row: number; tower: string };
  /** The centre of cell (col, row) on the page, in client (CSS) px. */
  clientAt(col: number, row: number): { x: number; y: number };
}

const content = mustLoad(loadTowerDefense(gameFiles), 'the tower-defense sample');
const look = tdLook(content);
const status = document.getElementById('status') as HTMLElement;
/** The status line before the first wave. */
const HINT = 'arrows move, Z or a tap builds, X picks the tower, Enter sends a wave';

let play: TdPlay | null = null;
const booted = await bootBrowserGame({
  screen: look.screen,
  audio: { sfx: contentSfx(content), songs: contentSongs(content), music: 'road' },
  displays: { canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, onSound }) },
  pointer: true,
  scene(_stack, display, page) {
    const scene = new TdPlay({
      content,
      seed: content.manifest.start.seed,
      pointer: page.pointer,
      picture: (_r, game) => tdPicture(display.presenter, look.screen, () => game.controls.view()),
    });
    play = scene;
    return {
      update: (input) => scene.update(input),
      render: (r) => {
        scene.render(r);
        showStatus(scene);
      },
    };
  },
});

if (booted && play) {
  const scene: TdPlay = play;
  const display = booted.display;
  button('wave', 'start');
  button('tower', 'attack');
  button('sell', 'special');
  /** Client px from picture px: `toScreen` is affine, so two points invert it. */
  const pictureToClient = (px: number, py: number) => {
    const toScreen = display.toScreen!.bind(display);
    const a = toScreen(0, 0);
    const b = toScreen(1000, 1000);
    return { x: ((px - a.x) * 1000) / (b.x - a.x), y: ((py - a.y) * 1000) / (b.y - a.y) };
  };
  const hook: TdHook = {
    tick: () => scene.tick,
    kit: () => scene.game.snapshot()['kit'] as JsonObject,
    cursor: () => scene.game.controls.view(),
    clientAt: (col, row) => pictureToClient((col + 0.5) * TD_TILE_SIZE, (row + 0.5) * TD_TILE_SIZE),
  };
  (window as unknown as { wwTd: TdHook }).wwTd = hook;

  /** A bar button that presses `action` on the next tick (never focused, so keys stay the game's). */
  function button(id: string, action: Action): void {
    const el = document.getElementById(id) as HTMLButtonElement;
    el.addEventListener('pointerdown', (e) => e.preventDefault());
    el.addEventListener('click', () => scene.press(action));
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
