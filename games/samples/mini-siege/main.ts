import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import type { JsonObject } from '@engine/core/headless';
import { bootBrowserGame } from '@engine/core/shell';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { loadMiniSiege, PLAYER } from './content';
import { siegeLook, siegePicture } from './picture';
import type { NamedSummary } from './headless';
import { SiegePlay, type SiegeEntryResult } from './play';
import gameFiles from 'virtual:game-files';

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
 * place towers (frame input the round reads itself; gaps D1, D12). The shell's volume control
 * keeps the player's volumes (gap M1). Since Engine 0.13 T8 the page plays the campaign: when an
 * entry ends, `#result` shows its outcomes, the village's people and their fates, and the save
 * code, kept in browser storage too, with **Continue** to the dawn assault (its captive choices
 * in the bar when the captain was taken; a choice without a round offers **Decide**); `#code`
 * and **Resume** resume from a typed save code (a refused code shows its reason in the status),
 * and `#stored` carries on from the save this browser kept.
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
  /** The hosted round's `kit` summary (the walls' round: `gold`, `towers`, `outcome`, ...), or null. */
  round(): JsonObject | null;
  /** The campaign entry played now (`village`, `dawn`). */
  scenario(): string;
  /** How the entry played now ended (`SiegePlay.ended()`), or null while it is played. */
  ended(): SiegeEntryResult | null;
  /** Every keyed scenario entity at a glance (the headless snapshot's `named`). */
  named(): Record<string, NamedSummary>;
  /** The HUD's captive marker: the name of the village's captured person, or ''. */
  captive(): string;
}

const content = mustLoad(loadMiniSiege(gameFiles), 'the mini siege');
const look = siegeLook(content);
const bar = document.getElementById('bar') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const launches = document.getElementById('launches') as HTMLElement;
const playButton = document.getElementById('play') as HTMLButtonElement;
const delegate = document.getElementById('delegate') as HTMLButtonElement;
const stored = document.getElementById('stored') as HTMLButtonElement;
const codeInput = document.getElementById('code') as HTMLInputElement;
const resume = document.getElementById('resume') as HTMLButtonElement;
const result = document.getElementById('result') as HTMLElement;
const resultTitle = document.getElementById('result-title') as HTMLElement;
const resultLines = document.getElementById('result-lines') as HTMLElement;
const resultCodeLabel = document.getElementById('result-code-label') as HTMLElement;
const resultCode = document.getElementById('result-code') as HTMLElement;
const continueButton = document.getElementById('continue') as HTMLButtonElement;

let play: SiegePlay | null = null;
const booted = await bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  audio: { sfx: contentSfx(content), songs: contentSongs(content), music: 'siege' },
  displays: { canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, onSound }) },
  pointer: true,
  scene(stack, display, page) {
    const scene = new SiegePlay({ content, seed: content.manifest.start.seed, pointer: page.pointer });
    play = scene;
    const host = scene.scene(stack, () => siegePicture(display.presenter, content, scene.ui));
    return {
      update: (input) => host.update(input),
      // The game the page plays now, for the shell's `window.__ww` (`?debug=step`, `?record`).
      headless: () => host.headless(),
      render: (r) => {
        host.render(r);
        showBar(scene);
      },
    };
  },
});

if (booted && play) {
  const scene: SiegePlay = play;
  launches.addEventListener('click', (e) => {
    const mission = (e.target as HTMLElement).closest<HTMLElement>('button[data-mission]')?.dataset.mission;
    if (mission !== undefined) scene.press({ kind: 'launch', mission });
  });
  playButton.addEventListener('click', () => scene.press({ kind: 'play' }));
  delegate.addEventListener('click', () => scene.press({ kind: 'delegate' }));
  continueButton.addEventListener('click', () => scene.press({ kind: 'continue' }));
  stored.addEventListener('click', () => scene.press({ kind: 'stored' }));
  const resumeFromCode = () => scene.press({ kind: 'code', text: codeInput.value });
  resume.addEventListener('click', resumeFromCode);
  // Typing a code drives no game action (the shell's keyboard listens on window).
  for (const type of ['keydown', 'keyup'] as const)
    codeInput.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'keydown' && e.key === 'Enter') resumeFromCode();
    });
  const hook: SiegeHook = {
    tick: () => scene.tick,
    choice: () => scene.choice(),
    playing: () => scene.game.miniGame() !== null,
    outcomes: () => scene.records().map((r) => r.outcome),
    miniGame: () => (scene.game.miniGame() === null ? '' : (scene.game.host.playing?.play ?? '')),
    round: () => (scene.game.miniGame()?.snapshot()['kit'] as JsonObject | undefined) ?? null,
    scenario: () => scene.scenario,
    ended: () => scene.ended(),
    named: () => scene.game.named(),
    captive: () => scene.view().named.find((n) => n.faction === PLAYER && n.fate === 'captured')?.name ?? '',
  };
  (window as unknown as { wwSiege: SiegeHook }).wwSiege = hook;
}

/**
 * The bar: one launch button per offered mission, the choice while one waits (Play and Delegate,
 * or Decide alone for a choice without a round), the status, the stored campaign; and the result
 * panel once an entry has ended.
 */
let shown = '';
function showBar(scene: SiegePlay): void {
  const offered = scene.launchButtons();
  const waiting = scene.choice();
  const text = statusText(scene);
  const ended = scene.ended();
  const saved = scene.tick === 0 && ended === null ? scene.storedSave() : null;
  const key = JSON.stringify([offered, waiting, text, ended, saved?.position ?? null, scene.scenario]);
  if (key === shown) return;
  shown = key;
  showResult(ended);
  stored.hidden = saved === null;
  if (saved !== null) stored.textContent = `Carry on: ${scene.entryTitle(saved)}`;
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
  delegate.hidden = waiting === null;
  playButton.hidden = waiting === null || !scene.canPlay(waiting);
  delegate.textContent = waiting !== null && !scene.canPlay(waiting) ? 'Decide' : 'Delegate';
  bar.dataset.choice = waiting ?? '';
  bar.dataset.scenario = scene.scenario;
  status.textContent = text;
}

/** The result panel: an entry's title, outcomes, people and verdict, its save code, the way on. */
function showResult(ended: SiegeEntryResult | null): void {
  result.hidden = ended === null;
  if (ended === null) return;
  resultTitle.textContent = `${ended.title}: ${ended.verdict}`;
  resultLines.replaceChildren(
    ...[...ended.outcomes, ...ended.people].map((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }),
  );
  const code = ended.next !== null ? ended.code : null;
  resultCodeLabel.textContent =
    code !== null
      ? `Save code${ended.stored ? ' (also kept in this browser)' : ''}:`
      : ended.done
        ? 'The campaign is over.'
        : 'No save: the hall has fallen, so nothing carries on.';
  resultCode.textContent = code ?? '';
  resultCode.hidden = code === null;
  continueButton.textContent = ended.next !== null ? `Continue: ${ended.next}` : 'Play again';
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
    `${scene.entryTitle()}, tick ${scene.tick}`,
    scene.message,
    scene.choice() === null
      ? ''
      : scene.canPlay(scene.choice()!)
        ? 'play the mission yourself, or delegate it?'
        : 'decide?',
    record ? scene.outcomeTitle(record.mission, record.outcome) : '',
    hall && !hall.alive ? 'the hall has fallen' : beaten ? 'the raiders are beaten' : '',
  ]
    .filter((s) => s !== '')
    .join(' | ');
}
