import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import { bootBrowserGame } from '@engine/core/shell';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { loadMiniSiege, PLAYER } from './content';
import { SIEGE_FILES } from './files';
import { siegeLook, siegePicture } from './picture';
import { SiegePlay } from './play';

/**
 * Boots the mini siege in the browser (Engine 0.11 T9) with the engine's `bootBrowserGame`:
 * Canvas2D with both skins (the battle's and the mission room's, `siegeLook`), pointer gestures on
 * (select, command, pan, zoom the battle), the touch pad left on for the round on a phone, and the
 * shell's `audio` option (the song `siege` once the first key, tap or click unlocks sound, and the
 * skins' event sounds). The scene is `SiegePlay`'s `HostScene` (`play.ts`); this file is only the
 * DOM: the bar under the picture (the status line, the launch button from the kit's mission
 * command, and the Play / Delegate choice) and `window.wwSiege` for scripts.
 */

/** What the page offers scripts on `window.wwSiege`. */
export interface SiegeHook {
  /** The world tick. */
  tick(): number;
  /** The mission waiting for play or delegate, or null. */
  choice(): string | null;
  /** True while the mission's round is being played. */
  playing(): boolean;
  /** The committed missions' outcomes, in commit order. */
  outcomes(): string[];
}

const content = mustLoad(loadMiniSiege(SIEGE_FILES), 'the mini siege');
const look = siegeLook(content);
const bar = document.getElementById('bar') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const launch = document.getElementById('launch') as HTMLButtonElement;
const playButton = document.getElementById('play') as HTMLButtonElement;
const delegate = document.getElementById('delegate') as HTMLButtonElement;

let play: SiegePlay | null = null;
await bootBrowserGame({
  screen: look.screen,
  audio: { sfx: contentSfx(content), songs: contentSongs(content), music: 'siege' },
  displays: { canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, onSound }) },
  pointer: true,
  scene(stack, display, page) {
    const scene = new SiegePlay({ content, seed: content.manifest.start.seed, pointer: page.pointer });
    play = scene;
    const host = scene.scene(stack, () => siegePicture(display.presenter, content, scene.ui));
    return {
      update: (input) => host.update(input),
      render: (r) => {
        host.render(r);
        showBar(scene);
      },
    };
  },
});

if (play) {
  const scene: SiegePlay = play;
  launch.addEventListener('click', () => {
    const mission = scene.launchButtons()[0];
    if (mission !== undefined) scene.press({ kind: 'launch', mission });
  });
  playButton.addEventListener('click', () => scene.press({ kind: 'play' }));
  delegate.addEventListener('click', () => scene.press({ kind: 'delegate' }));
  const hook: SiegeHook = {
    tick: () => scene.tick,
    choice: () => scene.choice(),
    playing: () => scene.game.miniGame() !== null,
    outcomes: () => scene.records().map((r) => r.outcome),
  };
  (window as unknown as { wwSiege: SiegeHook }).wwSiege = hook;
}

/** The bar: the launch button while a mission is offered, the choice while one waits, the status. */
let shown = '';
function showBar(scene: SiegePlay): void {
  const offered = scene.launchButtons()[0];
  const waiting = scene.choice();
  const text = statusText(scene);
  const key = JSON.stringify([offered, waiting, text]);
  if (key === shown) return;
  shown = key;
  launch.hidden = offered === undefined;
  if (offered !== undefined) launch.textContent = `Launch: ${scene.title(offered)}`;
  playButton.hidden = delegate.hidden = waiting === null;
  bar.dataset.choice = waiting ?? '';
  status.textContent = text;
}

function statusText(scene: SiegePlay): string {
  if (scene.game.miniGame() !== null) return 'Arrows move, X strikes, Backspace gives up';
  const sides = scene.sides();
  const record = scene.records().at(-1);
  const hall = scene.game.named()['hall'];
  const raiders = Object.entries(sides).filter(([f]) => f !== PLAYER);
  const beaten = raiders.every(([, s]) => s.units === 0);
  return [
    `tick ${scene.tick}`,
    scene.choice() !== null ? 'play the mission yourself, or delegate it?' : '',
    record ? scene.outcomeTitle(record.mission, record.outcome) : '',
    hall && !hall.alive ? 'the hall has fallen' : beaten ? 'the raiders are beaten' : '',
    scene.message,
  ]
    .filter((s) => s !== '')
    .join(' | ');
}
