import { mustLoad } from '@engine/core/content/game-content';
import { bootBrowserGame } from '@engine/core/shell';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { loadSkirmish, PLAYER } from './content';
import { skirmishLook, skirmishPicture } from './picture';
import { SkirmishPlay, type ButtonState, type PageButton } from './play';
import type { RecordedRun } from './recording';
import type { SideSummary } from './headless';
import gameFiles from 'virtual:game-files';

/**
 * Boots the skirmish in the browser (Engine 0.9 T12) with the engine's `bootBrowserGame`: Canvas2D
 * (T3 kept PixiJS out), pointer gestures on (mouse and touch: `PointerSource`), the touch pad off
 * (the RTS plays by pointer), keyboard Shift for additive selection. The scene is `SkirmishPlay`
 * (`play.ts`); this file is only the DOM: the button bar under the picture, the status line, the
 * export (a download of the recorded battle as a run file) and the `window.wwSkirmish` hook the
 * browser test (`tests/browser/rts-skirmish.test.ts`) reads.
 */

/** What the page offers scripts (the browser test) on `window.wwSkirmish`. */
export interface SkirmishHook {
  tick(): number;
  sides(): Record<string, SideSummary>;
  /** Living units: id, faction, type and cell. */
  units(): { id: number; faction: string | null; type: string | null; x: number; y: number }[];
  /** Buildings: id, kind, faction, north-west cell, size and whether finished. */
  buildings(): {
    id: number;
    kind: string;
    faction: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
    done: boolean;
  }[];
  /** The page's selection (ids). */
  selection(): number[];
  /** The camera's zoom and the world point at the picture's centre. */
  camera(): { zoom: number; x: number; y: number };
  /** Where world point (wx, wy) (world px) is on the page, in client (CSS) px. */
  clientAt(wx: number, wy: number): { x: number; y: number };
  /** The last refused order's reason, or ''. */
  message(): string;
  /** The battle so far as a run file (null before tick 20). */
  exportRun(game?: string): Promise<RecordedRun | null>;
}

const content = mustLoad(loadSkirmish(gameFiles), 'the RTS skirmish');
const look = skirmishLook(content);
let shift = false;
window.addEventListener('keydown', (e) => (shift = e.shiftKey));
window.addEventListener('keyup', (e) => (shift = e.shiftKey));
window.addEventListener('blur', () => (shift = false));

let play: SkirmishPlay | null = null;
const bar = document.getElementById('bar') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;

const booted = await bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  // No sounds yet (T14 adds them); the shell's volume control is there and keeps the player's
  // volumes (gap M1).
  audio: {},
  displays: { canvas2d: (canvas) => canvasDisplay(canvas, look) },
  pointer: true,
  touchPad: false,
  scene(_stack, display, page) {
    const scene = new SkirmishPlay({
      content,
      seed: content.manifest.start.seed,
      pointer: page.pointer,
      picture: (_r, ui) => skirmishPicture(display.presenter, look.screen, ui),
      additive: () => shift,
    });
    play = scene;
    makeButtons(scene);
    return {
      update: (input) => scene.update(input),
      render: (r) => {
        scene.render(r);
        showButtons(scene.buttons());
        showStatus(scene);
      },
    };
  },
});

if (booted && play) {
  const scene: SkirmishPlay = play;
  const display = booted.display;
  const hook: SkirmishHook = {
    tick: () => scene.tick,
    sides: () => scene.sides(),
    units: () =>
      scene.view().units.map((u) => ({ id: u.id, faction: u.faction, type: u.type, x: u.x, y: u.y })),
    buildings: () =>
      scene.view().buildings.map((b) => ({
        id: b.id,
        kind: b.kind,
        faction: b.faction,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        done: b.construction === null || b.construction.done,
      })),
    selection: () => scene.controls.selection.ids(),
    camera: () => ({ zoom: scene.camera.zoom, ...scene.camera.centre() }),
    clientAt: (wx, wy) => {
      const p = scene.camera.worldToScreen(wx, wy);
      return display.toClient!(p.x, p.y); // the display's inverse of `toScreen` (gap D13)
    },
    message: () => scene.message,
    exportRun: (game) => scene.exportRun(game),
  };
  (window as unknown as { wwSkirmish: SkirmishHook }).wwSkirmish = hook;
  document.getElementById('export')?.addEventListener('click', () => void download(scene));
}

/** The bar's buttons: build one of each building type, train each unit type, stop, hero, cancel. */
function makeButtons(scene: SkirmishPlay): void {
  const types = scene.view().types;
  const add = (id: string, label: string, button: PageButton) => {
    const el = document.createElement('button');
    el.id = id;
    el.type = 'button';
    el.textContent = label;
    el.hidden = true;
    el.addEventListener('click', () => scene.press(button));
    bar.insertBefore(el, document.getElementById('export'));
  };
  for (const building of Object.keys(types?.buildings ?? {}))
    add(`build-${building}`, `Build ${building}`, { kind: 'build', building });
  const trained = new Set(Object.values(types?.buildings ?? {}).flatMap((b) => b.trains));
  for (const unit of trained) add(`train-${unit}`, `Train ${unit}`, { kind: 'train', unit });
  add('stop', 'Stop', { kind: 'stop' });
  add('heroes', 'Hero', { kind: 'heroes' });
  add('cancel', 'Cancel', { kind: 'cancel' });
  (document.getElementById('heroes') as HTMLButtonElement).hidden = false;
}

let shown = '';
function showButtons(state: ButtonState): void {
  const key = JSON.stringify(state);
  if (key === shown) return;
  shown = key;
  for (const el of bar.querySelectorAll<HTMLButtonElement>('button')) {
    const id = el.id;
    if (id.startsWith('build-')) el.hidden = !state.build.includes(id.slice(6)) || state.placing !== null;
    else if (id.startsWith('train-')) el.hidden = !state.train.includes(id.slice(6));
    else if (id === 'stop') el.hidden = !state.stop;
    else if (id === 'cancel') el.hidden = state.placing === null;
  }
}

function showStatus(scene: SkirmishPlay): void {
  const sides = scene.sides();
  const enemies = Object.entries(sides).filter(([f]) => f !== PLAYER);
  const won = enemies.every(([, s]) => s.units === 0 && Object.keys(s.buildings).length === 0);
  const lost = (sides[PLAYER]?.units ?? 0) === 0;
  const text = [
    `tick ${scene.tick}`,
    won ? 'the raiders are beaten' : lost ? 'your side is beaten' : '',
    scene.message,
  ]
    .filter((s) => s !== '')
    .join(' | ');
  if (status.textContent !== text) status.textContent = text;
}

/** Saves the battle so far as `skirmish-t<tick>.run.json` (put it in `runs/` to keep `"game": ".."`). */
async function download(scene: SkirmishPlay): Promise<void> {
  const run = await scene.exportRun();
  if (run === null) {
    scene.message = 'play at least 20 ticks before exporting';
    return;
  }
  const blob = new Blob([`${JSON.stringify(run, null, 2)}\n`], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `skirmish-t${run.ticks}.run.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
