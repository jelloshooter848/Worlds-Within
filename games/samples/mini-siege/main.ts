import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import type { JsonObject } from '@engine/core/headless';
import { clampCameraAxis } from '@engine/core/present';
import { bootBrowserGame } from '@engine/core/shell';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { cameraHint, TD_TILE_SIZE } from '@kits/towerdefense';
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
 * DOM: the bar under the picture (the status line, one launch button per offered mission from the
 * kit's mission command, and the Play / Delegate choice) and `window.wwSiege` for scripts. Since
 * Engine 0.12 T8 the bar also offers the preparation phase (`fortify`, from world tick 5 to 30):
 * from 20 to 30 both missions are offered and each has its button. While the walls' round is
 * hosted the picture is the round (its own skin, `canvas2d-td-defence.json`) and pointer taps
 * place towers (`SiegePlay.roundTap`).
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
  /** The hosted mini game (the open mission's `play`: `mission-room`, `td-defence`), or ''. */
  miniGame(): string;
  /** The walls' round's `kit` summary (`gold`, `towers`, `outcome`, ...), or null when it is not hosted. */
  round(): JsonObject | null;
  /** The centre of the walls' round's cell (col, row) on the page, in client (CSS) px. */
  clientAt(col: number, row: number): { x: number; y: number };
}

const content = mustLoad(loadMiniSiege(SIEGE_FILES), 'the mini siege');
const look = siegeLook(content);
const bar = document.getElementById('bar') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const launches = document.getElementById('launches') as HTMLElement;
const playButton = document.getElementById('play') as HTMLButtonElement;
const delegate = document.getElementById('delegate') as HTMLButtonElement;

let play: SiegePlay | null = null;
const booted = await bootBrowserGame({
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

if (booted && play) {
  const scene: SiegePlay = play;
  const display = booted.display;
  launches.addEventListener('click', (e) => {
    const mission = (e.target as HTMLElement).closest<HTMLElement>('button[data-mission]')?.dataset.mission;
    if (mission !== undefined) scene.press({ kind: 'launch', mission });
  });
  /** Client px from picture px: `toScreen` is affine, so two points invert it. */
  const pictureToClient = (px: number, py: number) => {
    const toScreen = display.toScreen!.bind(display);
    const a = toScreen(0, 0);
    const b = toScreen(1000, 1000);
    return { x: ((px - a.x) * 1000) / (b.x - a.x), y: ((py - a.y) * 1000) / (b.y - a.y) };
  };
  playButton.addEventListener('click', () => scene.press({ kind: 'play' }));
  delegate.addEventListener('click', () => scene.press({ kind: 'delegate' }));
  const hook: SiegeHook = {
    tick: () => scene.tick,
    choice: () => scene.choice(),
    playing: () => scene.game.miniGame() !== null,
    outcomes: () => scene.records().map((r) => r.outcome),
    miniGame: () => (scene.game.miniGame() === null ? '' : (scene.game.host.playing?.play ?? '')),
    round: () => (scene.defenceRound()?.game.snapshot()['kit'] as JsonObject | undefined) ?? null,
    clientAt: (col, row) => {
      const round = scene.defenceRound();
      if (round === null) return { x: -1, y: -1 };
      // The inverse of the kit's `cellAtScreen` at zoom 1 (gap logged as D13 in
      // docs/reports/tower-defense.md): the map's top-left on the picture, then the cell's centre.
      const camera = cameraHint(round.game.world, TD_TILE_SIZE);
      const area = camera.bounds!;
      const { width, height } = look.screen;
      const left = clampCameraAxis(Math.round(camera.x - width / 2), area.x, area.w, width);
      const top = clampCameraAxis(Math.round(camera.y - height / 2), area.y, area.h, height);
      return pictureToClient((col + 0.5) * TD_TILE_SIZE - left, (row + 0.5) * TD_TILE_SIZE - top);
    },
  };
  (window as unknown as { wwSiege: SiegeHook }).wwSiege = hook;
}

/** The bar: one launch button per offered mission, the choice while one waits, the status. */
let shown = '';
function showBar(scene: SiegePlay): void {
  const offered = scene.launchButtons();
  const waiting = scene.choice();
  const text = statusText(scene);
  const key = JSON.stringify([offered, waiting, text]);
  if (key === shown) return;
  shown = key;
  launches.replaceChildren(
    ...offered.map((mission) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `launch-${mission}`;
      b.className = 'launch';
      b.dataset.mission = mission;
      b.textContent = `Launch: ${scene.title(mission)}`;
      return b;
    }),
  );
  playButton.hidden = delegate.hidden = waiting === null;
  bar.dataset.choice = waiting ?? '';
  status.textContent = text;
}

/** What the keys do in each mini game, shown while its round is hosted. */
const ROUND_HINTS: Record<string, string> = {
  'mission-room': 'Arrows move, X strikes, Backspace gives up',
  'td-defence':
    'Arrows or a tap pick a wall, Z or a second tap builds, X picks the tower, Enter sends the raiders, Backspace gives up',
};

function statusText(scene: SiegePlay): string {
  if (scene.game.miniGame() !== null) return ROUND_HINTS[scene.game.host.playing?.play ?? ''] ?? '';
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
