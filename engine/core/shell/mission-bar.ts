import type { InputManager } from '../input/input-manager';
import { keyHintMap } from '../input/key-hints';
import type { LaunchGame, LaunchEntryResult, MissionLaunch } from './mission-launch';

/**
 * The mission-launch scene's DOM (Engine 0.15 T10, gaps M26, M34, M36; docs/BUILD-LOG.md, Engine
 * 0.15, decision 11, item 288): the shell's own, as the touch pad and the volume control are, so a
 * page that launches missions and plays a campaign writes none. Browser only (DOM): not on
 * `PURE_CORE`. `mountMissionBar({ launch, input })` puts on the page:
 *
 * - **the bar** `#bar`, fixed along the bottom, `MISSION_BAR_HEIGHT` px high (the page leaves that
 *   much under its canvas): `#launches` (one `#launch-<mission>` button per offered mission,
 *   "Launch: <title>"), `#play` and `#delegate` (Decide for a choice without a round), `#status`
 *   (`MissionLaunch.status`, with the player's key names from `input`'s bindings: the round's key
 *   hint, lesson D14), and with a campaign `#stored` (Carry on: <entry>, at tick 0 when a save is
 *   kept), `#code` and `#resume` (Enter in the box resumes too; its keys never reach the game);
 * - **the briefing** `#briefing` (`#briefing-title`, `#briefing-text`, `#begin`) while the entry is
 *   held at tick 0 (M34);
 * - **the result panel** `#result` (`#result-title`, `#result-lines`: the outcomes then the people,
 *   `#result-code-label`, `#result-code`, `#continue`) once the entry has ended (M36).
 *
 * `update()` brings it up to date (cheap when nothing changed); the page calls it after every draw.
 * Its buttons press through `launch.press`, on the next loop step, and never keep the focus.
 */

/** The bar's height in CSS px: the page's canvas leaves this much below it. */
export const MISSION_BAR_HEIGHT = 40;

export interface MissionBarOptions<G extends LaunchGame> {
  launch: MissionLaunch<G>;
  /** The shell's input (`booted.input`): the player's key names for the round's hint. */
  input?: InputManager | null;
  /** Where the bar and panels go (default `document.body`). */
  parent?: HTMLElement;
}

export interface MissionBar {
  readonly element: HTMLElement;
  /** Shows the launch's state now. */
  update(): void;
}

const STYLE = `
#bar { position: fixed; left: 0; right: 0; bottom: 0; height: ${MISSION_BAR_HEIGHT}px; box-sizing: border-box;
  display: flex; align-items: center; gap: 6px; padding: 0 6px; overflow-x: auto; background: #181818;
  color: #eee; font: 14px/1.2 system-ui, sans-serif; }
#bar button { flex: none; min-height: 30px; padding: 0 10px; border: 1px solid #666; border-radius: 4px;
  background: #333; color: #fff; font: inherit; }
#bar button.launch { background: #a80020; border-color: #f83800; }
#launches { flex: none; display: flex; gap: 6px; }
#launches:empty { display: none; }
#bar [hidden] { display: none; }
#status { flex: 1; min-width: 8em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#code { flex: none; width: 15em; min-height: 28px; box-sizing: border-box; padding: 0 6px; border: 1px solid #666;
  border-radius: 4px; background: #000; color: #fff; font: 13px/1.2 ui-monospace, monospace;
  text-transform: uppercase; user-select: text; }
.ww-panel { position: fixed; left: 50%; top: calc((100vh - ${MISSION_BAR_HEIGHT}px) / 2); transform: translate(-50%, -50%);
  width: min(26em, calc(100vw - 32px)); box-sizing: border-box; padding: 12px 16px; border: 2px solid #f8b800;
  border-radius: 6px; background: rgba(0, 0, 0, 0.88); color: #eee; font: 14px/1.4 system-ui, sans-serif; z-index: 10; }
.ww-panel[hidden] { display: none; }
.ww-panel h2 { margin: 0 0 6px; font-size: 18px; color: #f8b800; }
.ww-panel ul { margin: 4px 0; padding-left: 1.2em; }
.ww-panel p { margin: 4px 0 8px; }
#result-code { display: block; margin: 6px 0; font: 18px/1.3 ui-monospace, monospace; letter-spacing: 1px;
  color: #fff; user-select: all; }
#result-code[hidden] { display: none; }
.ww-panel button { min-height: 30px; padding: 0 12px; border: 1px solid #f8b800; border-radius: 4px;
  background: #a80020; color: #fff; font: inherit; }
`;

/** An element with an id (and optional text). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, id: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (id !== '') e.id = id;
  if (text !== '') e.textContent = text;
  return e;
}

/** A button that never keeps the focus (so Space and Enter stay the game's) and calls `onClick`. */
function button(id: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', id, text);
  b.type = 'button';
  if (title !== '') b.title = title;
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', () => {
    onClick();
    b.blur();
  });
  return b;
}

/** Puts the bar, the briefing and the result panel on the page; returns the bar. */
export function mountMissionBar<G extends LaunchGame>(opts: MissionBarOptions<G>): MissionBar {
  const { launch } = opts;
  const parent = opts.parent ?? document.body;
  const campaign = launch.entry() !== null;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const bar = el('div', 'bar');
  const launches = el('span', 'launches');
  launches.addEventListener('pointerdown', (e) => e.preventDefault());
  launches.addEventListener('click', (e) => {
    const mission = (e.target as HTMLElement).closest<HTMLElement>('button[data-mission]')?.dataset.mission;
    if (mission !== undefined) launch.press({ kind: 'launch', mission });
  });
  const play = button('play', 'Play', 'Play the mission yourself', () => launch.press({ kind: 'play' }));
  const delegate = button('delegate', 'Delegate', 'Let your people do it', () =>
    launch.press({ kind: 'delegate' }),
  );
  const status = el('span', 'status');
  bar.append(launches, play, delegate, status);
  const stored = button('stored', '', 'Carry on from the campaign this browser saved', () =>
    launch.press({ kind: 'stored' }),
  );
  const code = el('input', 'code');
  code.type = 'text';
  code.placeholder = 'save code';
  code.autocomplete = 'off';
  code.spellcheck = false;
  code.setAttribute('aria-label', 'Save code');
  const resumeFromCode = () => launch.press({ kind: 'code', text: code.value });
  const resume = button('resume', 'Resume', 'Resume the campaign from a save code', resumeFromCode);
  // Typing a code drives no game action (the shell's keyboard listens on window).
  for (const type of ['keydown', 'keyup'] as const)
    code.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'keydown' && e.key === 'Enter') resumeFromCode();
    });
  if (campaign) bar.append(stored, code, resume);

  const briefing = el('div', 'briefing');
  briefing.className = 'ww-panel';
  briefing.setAttribute('role', 'dialog');
  briefing.setAttribute('aria-labelledby', 'briefing-title');
  const briefingTitle = el('h2', 'briefing-title');
  const briefingText = el('p', 'briefing-text');
  const begin = button('begin', 'Begin', 'Start the clock', () => launch.press({ kind: 'begin' }));
  briefing.append(briefingTitle, briefingText, begin);

  const result = el('div', 'result');
  result.className = 'ww-panel';
  result.setAttribute('role', 'dialog');
  result.setAttribute('aria-labelledby', 'result-title');
  const resultTitle = el('h2', 'result-title');
  const resultLines = el('ul', 'result-lines');
  const resultCodeLabel = el('span', 'result-code-label');
  const resultCode = el('code', 'result-code');
  const continueButton = button('continue', '', '', () => launch.press({ kind: 'continue' }));
  result.append(resultTitle, resultLines, resultCodeLabel, resultCode, continueButton);
  parent.append(briefing, result, bar);

  let shown = '';
  const update = () => {
    const keyboard = opts.input?.bindings[0]?.keyboard;
    const offered = launch.launchButtons();
    const waiting = launch.choice();
    const text = launch.status(keyHintMap(keyboard));
    const ended = launch.ended();
    const held = launch.briefing();
    const saved = campaign ? launch.storedSave() : null;
    const key = JSON.stringify([offered, waiting, text, ended, held, saved?.position ?? null]);
    if (key === shown) return;
    shown = key;
    showResult(ended);
    briefing.hidden = held === null;
    if (held !== null) {
      briefingTitle.textContent = held.title;
      briefingText.textContent = held.text;
      briefingText.hidden = held.text === '';
    }
    stored.hidden = saved === null;
    if (saved !== null) stored.textContent = `Carry on: ${launch.entryTitle(saved)}`;
    launches.replaceChildren(
      ...offered.map((mission) => {
        const b = el('button', `launch-${mission}`, `Launch: ${launch.title(mission)}`);
        b.type = 'button';
        b.className = 'launch';
        b.dataset.mission = mission;
        return b;
      }),
    );
    delegate.hidden = waiting === null;
    play.hidden = waiting === null || !launch.canPlay(waiting);
    delegate.textContent = waiting !== null && !launch.canPlay(waiting) ? 'Decide' : 'Delegate';
    bar.dataset.choice = waiting ?? '';
    bar.dataset.entry = launch.entry()?.scenario ?? '';
    status.textContent = text;
  };

  /** The result panel: the entry's title and verdict, outcomes, people, its save code, the way on. */
  function showResult(ended: LaunchEntryResult | null): void {
    result.hidden = ended === null;
    if (ended === null) return;
    resultTitle.textContent = ended.verdict === '' ? ended.title : `${ended.title}: ${ended.verdict}`;
    resultLines.replaceChildren(...[...ended.outcomes, ...ended.people].map((line) => el('li', '', line)));
    const saveCode = ended.next !== null ? ended.code : null;
    resultCodeLabel.textContent =
      saveCode !== null
        ? `Save code${ended.stored ? ' (also kept in this browser)' : ''}:`
        : ended.done
          ? 'The campaign is over.'
          : 'No save: nothing carries on from here.';
    resultCode.textContent = saveCode ?? '';
    resultCode.hidden = saveCode === null;
    continueButton.textContent = ended.next !== null ? `Continue: ${ended.next}` : 'Play again';
  }

  update();
  return { element: bar, update };
}
