import { withContentImages } from '@engine/core/assets/content-images';
import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import { bootBrowserGame, manualFromQuery } from '@engine/core/shell';
import { contentFonts, skinMinimap } from '@engine/core/ui';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { RTS_TILE_SIZE } from '@kits/rts';
import { loadSkirmish, SKIRMISH_MUSIC, skirmishDecor, skirmishNames } from './content';
import { skirmishLook, skirmishPicture } from './picture';
import { SkirmishPlay, TICKS_PER_SECOND, type ButtonState, type MatchStats, type PageButton } from './play';
import type { RecordedRun } from './recording';
import type { SideSummary } from './headless';
import gameFiles from 'virtual:game-files';

/**
 * Boots the skirmish in the browser (Engine 0.9 T12) with the engine's `bootBrowserGame`: PixiJS
 * (WebGL) by default since Engine 0.16 T13b-8, Canvas2D where WebGL is missing or with
 * `?backend=canvas2d`, pointer gestures on (mouse and touch: `PointerSource`), the touch pad off
 * (the RTS plays by pointer), keyboard Shift for additive selection. The scene is `SkirmishPlay`
 * (`play.ts`); this file is only the DOM: the button bar under the picture, the status line, the
 * export (a download of the recorded battle as a run file), the end screen and the
 * `window.wwSkirmish` hook the browser test (`tests/browser/rts-skirmish.test.ts`) reads.
 *
 * Engine 0.15 T14: the shell's `audio` plays the sample's song (`ford`, from the first click, tap
 * or key) and the skin's event sounds through the display's `onSound`; the volume control keeps
 * the player's volumes (gap M1). When the battle ends the picture shows the skin's banner and
 * `#end` (the result, the tick, and Play again) opens over it; the game keeps stepping, so an
 * export still ends on a hash tick.
 *
 * The River Ford (Engine 0.16 part D, D8): the picture is the player's, through fog of war; a
 * click or tap on the skin's minimap (bottom right) moves the camera there (`skinMinimap`, read by
 * `SkirmishPlay`); accepted orders show a marker and bark (a sfx per unit type and a short line in
 * the HUD); and the end screen gives the result and the match's stats (`SkirmishPlay.stats()`).
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
  /** How the match has ended: `won`, `lost`, or null while it goes on. */
  result(): 'won' | 'lost' | null;
  /** The match so far (units trained and lost, enemies slain, buildings, gold). */
  stats(): MatchStats;
  /** Where world point (wx, wy) is drawn on the minimap, in client (CSS) px; null without a minimap. */
  minimapClientAt(wx: number, wy: number): { x: number; y: number } | null;
  /** The battle so far as a run file (null before tick 20). */
  exportRun(game?: string): Promise<RecordedRun | null>;
}

// The skin's PNG sheets (the CC0 pack, Engine 0.16 part D, D7) decoded before the first frame.
const content = await withContentImages(mustLoad(loadSkirmish(gameFiles), 'the RTS skirmish'));
const look = skirmishLook(content);
const minimap = skinMinimap(look.skin);
// The HUD's display names (polish Q, D2): the selection panel says "Town Centre", not the id.
const names = skirmishNames(content);
// The map's scenery (polish Q, Q6): trees, rocks, ground marks and bank reeds, presentation only.
const decor = skirmishDecor(content);
const fonts = contentFonts(content);
let shift = false;
window.addEventListener('keydown', (e) => (shift = e.shiftKey));
window.addEventListener('keyup', (e) => (shift = e.shiftKey));
window.addEventListener('blur', () => (shift = false));

let play: SkirmishPlay | null = null;
const manual = manualFromQuery(location.search);
const bar = document.getElementById('bar') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const end = document.getElementById('end') as HTMLElement;
document.getElementById('again')?.addEventListener('click', () => location.reload());

const booted = await bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  // The song and the skin's event sounds (Engine 0.15 T14); the shell's volume control keeps the
  // player's volumes (gap M1).
  // D9: the music is the skin's layered `ford` (calm, and a danger layer while an enemy the
  // player sees is near one of its buildings, the frame status `enemyNear`), and every event
  // sound is varied by the start seed.
  audio: {
    songs: contentSongs(content),
    sfx: contentSfx(content),
    music: SKIRMISH_MUSIC,
    mix: look.skin.music,
    seed: content.manifest.start.seed,
  },
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
  // D9: the camera's feel at page scale (4x at 1920x1080): the edge band is 8 picture px (32 CSS
  // px), scrolled at 6 px a step (the 64x40 map's width in about 3 seconds), and 400 px of wheel
  // halve or double the zoom (0.5 to 2).
  pointer: { edgeMargin: 8, edgeSpeed: 6, wheelPerDouble: 400 },
  touchPad: false,
  scene(_stack, display, page) {
    const scene = new SkirmishPlay({
      content,
      seed: content.manifest.start.seed,
      pointer: page.pointer,
      picture: (_r, opts) => skirmishPicture(display.presenter, look.screen, { ...opts, names, decor }),
      minimap,
      additive: () => shift,
      // In manual-loop mode (`?debug=step`) one loop step is one game tick, so the step hook's
      // `replay` hands a run file's orders over at its ticks and `__ww.hash()` is the run's (D9).
      ...(manual && { stepsPerTick: 1 }),
    });
    play = scene;
    makeButtons(scene);
    return {
      headless: () => scene.game,
      update: (input) => scene.update(input),
      render: (r) => {
        scene.render(r);
        showButtons(scene.buttons());
        showStatus(scene);
        showEnd(scene);
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
    result: () => scene.result(),
    stats: () => scene.stats(),
    minimapClientAt: (wx, wy) => {
      const terrain = scene.view().terrain;
      if (minimap === null || terrain === null) return null;
      const scale = minimap.scale ?? 1;
      const x = minimap.box.x + (wx / RTS_TILE_SIZE) * scale;
      const y = minimap.box.y + (wy / RTS_TILE_SIZE) * scale;
      return display.toClient!(x, y);
    },
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
  const result = scene.result();
  const text = [
    `tick ${scene.tick}`,
    result === 'won' ? 'the far bank is yours' : result === 'lost' ? 'your side is beaten' : '',
    scene.message,
  ]
    .filter((s) => s !== '')
    .join(' | ');
  if (status.textContent !== text) status.textContent = text;
}

let ended: string | null = null;
/** The end screen: opened once when the match ends, with the result, the time and the match's stats. */
function showEnd(scene: SkirmishPlay): void {
  const result = scene.result();
  if (result === null || ended !== null) return;
  ended = result;
  end.dataset['result'] = result;
  (document.getElementById('end-title') as HTMLElement).textContent =
    result === 'won' ? 'Victory: the far bank is yours' : 'Defeat: your side has fallen';
  const s = scene.stats();
  const seconds = Math.floor(scene.tick / TICKS_PER_SECOND);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  (document.getElementById('end-text') as HTMLElement).textContent =
    (result === 'won'
      ? `The enemy town centre fell at ${time} (tick ${scene.tick}).`
      : `Your side fell at ${time} (tick ${scene.tick}).`) +
    ` Trained ${s.trained}, lost ${s.lost}, slain ${s.slain}, built ${s.built}, razed ${s.razed}, gold ${s.gold}.`;
  end.hidden = false;
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
