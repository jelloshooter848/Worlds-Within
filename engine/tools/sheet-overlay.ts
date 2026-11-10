import type { ContentBundle } from '@engine/core/content/bundle';
import {
  TRANSITION_KINDS,
  TRANSITION_SLOTS,
  transitionAt,
  transitionFor,
  transitionLength,
  type TransitionKind,
  type TransitionSlot,
  type TransitionSpec,
  type TransitionView,
} from '@engine/core/fx';
import { mixWhenHolds } from '@engine/core/audio/mix';
import { defaultBindings } from '@engine/core/input/bindings';
import { keyHintMap } from '@engine/core/input/key-hints';
import type { DeepReadonly } from '@engine/core/present';
import { DEFAULT_SETTINGS, DEFAULT_VOLUMES } from '@engine/core/save/settings';
import { campaignLevels, type CampaignDef } from '@engine/core/campaign';
import { contentOf } from '@engine/core/content/bundle';
import { CAMPAIGN_KIND } from '@engine/core/content/engine-kinds';
import {
  clearScreen,
  DIALOG_WIDGET,
  dialogScreen,
  endScreen,
  levelChoices,
  levelsScreen,
  type StatValues,
  controlsScreen,
  pauseScreen,
  settingsScreen,
  titleScreen,
  UI_KIND,
  UiScreen,
  type FontLookup,
  type MenuBuildContext,
  type UiDraw,
  type UiFrameSize,
  type UiScreenFile,
} from '@engine/core/ui';
import { SHEET_MENU_SCREENS, type SheetMenuScreen, type SheetOverlay } from './screenshot/job';

/**
 * What `pnpm cli sheet` (Engine 0.16 T14) draws over a tile's picture, worked out from the game's
 * content: the shell's menu screens (`game.json`'s `menus`, built as the browser shell's
 * `GameMenus` builds them, with player 1's default keys and default settings), a `ui` content
 * file's screen, or a screen transition at an age. No DOM: the screenshot page paints what this
 * gives (2D through `CanvasUiPainter` and `drawTransition`, 3D through `ThreePresenter.ui` and
 * `.transition`), and the command checks tiles with it before Chromium starts.
 */

/** Display frames a menu screen is stepped before its picture (its focus tween settles). */
export const SHEET_MENU_FRAMES = 30;
/** Display frames a `ui` screen is stepped before its picture (a dialog types its first page). */
export const SHEET_UI_FRAMES = 120;
/** At most this many frames a `dialog:<id>` overlay types its first page for (without `*<n>`). */
export const SHEET_DIALOG_MAX_FRAMES = 2000;
/** The half length of a transition named by its kind (`fade`, `wipe`, `iris`), in frames. */
export const SHEET_TRANSITION_TICKS = 20;

/**
 * Reads one overlay as written in a tile (after its `+`): `title`, `pause`, `settings`,
 * `controls`, `ui=<file>` or `ui=<file>.<widget>`, each with an optional `*<frames>`, a shell
 * dialog `dialog:<id>` (with `*<frames>`, else stepped until its first page is typed out), or a
 * transition slot (`level`, `scene`, `mission`, `default`) or kind (`fade`, `wipe`, `iris`) with
 * an optional `*<age>` (default: the frame it first covers everything). Throws an `Error` naming
 * what is wrong.
 */
export function parseOverlay(text: string): SheetOverlay {
  const star = text.indexOf('*');
  const head = star < 0 ? text : text.slice(0, star);
  let count: number | null = null;
  if (star >= 0) {
    const n = text.slice(star + 1);
    if (!/^\d+$/.test(n)) throw new Error(`"${text}": the number after * must be a whole number >= 0`);
    count = Number(n);
  }
  if ((SHEET_MENU_SCREENS as readonly string[]).includes(head))
    return { kind: 'menu', screen: head as SheetMenuScreen, frames: count ?? SHEET_MENU_FRAMES };
  if (head.startsWith('dialog:')) {
    const id = head.slice('dialog:'.length);
    if (id === '') throw new Error(`"${text}": dialog: needs a dialog id of menus.dialogs`);
    return { kind: 'dialog', id, frames: count };
  }
  if (head.startsWith('ui=')) {
    const [file, ...rest] = head.slice(3).split('.');
    if (file === undefined || file === '') throw new Error(`"${text}": ui= needs a ui file's name`);
    const widget = rest.length > 0 ? rest.join('.') : null;
    if (widget === '') throw new Error(`"${text}": a widget id follows the dot`);
    return { kind: 'ui', file, widget, frames: count ?? SHEET_UI_FRAMES };
  }
  const known = [...TRANSITION_SLOTS, ...TRANSITION_KINDS] as readonly string[];
  if (known.includes(head)) return { kind: 'transition', what: head, age: count ?? -1 };
  throw new Error(
    `"${text}" is not an overlay: use ${SHEET_MENU_SCREENS.join(', ')}, ui=<file>[.<widget>], dialog:<id>, or a transition (${known.join(', ')}), each with an optional *<n>`,
  );
}

/** An overlay as a tile's label writes it. */
export function overlayLabel(o: SheetOverlay): string {
  switch (o.kind) {
    case 'menu':
      return o.screen;
    case 'ui':
      return `ui ${o.file}${o.widget === null ? '' : `.${o.widget}`}`;
    case 'dialog':
      return `dialog ${o.id}`;
    case 'transition':
      return `${o.what} frame ${o.age}`;
  }
}

/** The transition a slot or kind names for this game, or null (a slot the game gives none for). */
export function sheetTransitionSpec(
  content: ContentBundle,
  what: string,
): DeepReadonly<TransitionSpec> | null {
  if ((TRANSITION_KINDS as readonly string[]).includes(what))
    return { kind: what as TransitionKind, ticks: SHEET_TRANSITION_TICKS };
  return transitionFor(content.manifest.transitions, what as TransitionSlot);
}

/** The game's `ui` file by name, or undefined. */
function uiFile(content: ContentBundle, name: string): UiScreenFile | undefined {
  return content.entries.find((e) => e.kind === UI_KIND.name && e.name === name)?.value as
    UiScreenFile | undefined;
}

/**
 * Why the game cannot show an overlay (one sentence), or null when it can: no `menus` in
 * `game.json`, no such `ui` file or widget, no transition for a slot, or an age outside the
 * transition. A transition's age of -1 (none written) becomes the frame it first covers all.
 */
export function checkOverlay(content: ContentBundle, overlay: SheetOverlay): string | null {
  switch (overlay.kind) {
    case 'menu': {
      const menus = content.manifest.menus;
      if (menus === undefined)
        return `the game's game.json has no "menus", so it has no ${overlay.screen} screen`;
      if (overlay.screen === 'clear' && menus.clear === undefined)
        return `the game's menus have no "clear", so it has no level-clear banner`;
      if (overlay.screen === 'end' && menus.end === undefined)
        return `the game's menus have no "end", so it has no end screen`;
      if (overlay.screen === 'levels' && sheetLevels(content).length === 0)
        return 'the game has no levels for a level select';
      return null;
    }
    case 'ui': {
      const file = uiFile(content, overlay.file);
      if (file === undefined) return `the game has no ui file "${overlay.file}"`;
      if (overlay.widget !== null && !file.widgets.some((w, i) => (w.id ?? `#${i}`) === overlay.widget))
        return `the ui file "${overlay.file}" has no widget "${overlay.widget}"`;
      return null;
    }
    case 'dialog': {
      const dialogs = content.manifest.menus?.dialogs;
      if (dialogs?.[overlay.id] === undefined)
        return dialogs === undefined
          ? `the game's menus have no "dialogs", so it has no dialog "${overlay.id}"`
          : `the game has no dialog "${overlay.id}"; it has ${Object.keys(dialogs).join(', ')}`;
      return null;
    }
    case 'transition': {
      const spec = sheetTransitionSpec(content, overlay.what);
      if (spec === null) return `the game's game.json gives no transition for "${overlay.what}"`;
      if (overlay.age >= transitionLength(spec))
        return `"${overlay.what}" lasts ${transitionLength(spec)} frames, so frame ${overlay.age} shows nothing`;
      return null;
    }
  }
}

/** The transition overlay's view at its age (-1: the frame it first covers everything), or null. */
export function overlayTransition(content: ContentBundle, overlay: SheetOverlay): TransitionView | null {
  if (overlay.kind !== 'transition') return null;
  const spec = sheetTransitionSpec(content, overlay.what);
  if (spec === null) return null;
  return transitionAt(spec, overlay.age < 0 ? spec.ticks - 1 : overlay.age);
}

/** What a UI overlay needs from the page: the game's fonts and its sprite frames' sizes. */
export interface OverlayUiOptions {
  fonts: FontLookup;
  frameSize: UiFrameSize;
  /**
   * The status of the frame the overlay is drawn over (the view's `status()`, or the 3D frame's),
   * which the `clear` and `end` screens show; none: their values show as `-`.
   */
  status?: StatValues | null;
}

/**
 * The game's levels in play order for the `levels` overlay: its campaign's level entries (the
 * first campaign file), else its `level` content files by id, each named by its header's `name`
 * (else the campaign entry's `title`, else the id). None for a game without levels.
 */
export function sheetLevels(content: ContentBundle): { id: string; name: string }[] {
  const named = new Map<string, string>();
  for (const e of content.entries)
    if (e.kind === 'level') {
      const v = e.value as { id?: unknown; name?: unknown };
      if (typeof v.id === 'string') named.set(v.id, typeof v.name === 'string' ? v.name : v.id);
    }
  const campaign = contentOf(content, CAMPAIGN_KIND)[0]?.value as CampaignDef | undefined;
  if (campaign !== undefined) {
    const titles = new Map(
      campaign.entries.flatMap((e) => ('level' in e && e.level !== undefined ? [[e.level, e.title]] : [])),
    );
    const ids = campaignLevels(campaign).filter((id) => named.has(id));
    if (ids.length > 0)
      return ids.map((id) => ({ id, name: named.get(id) !== id ? named.get(id)! : (titles.get(id) ?? id) }));
  }
  return [...named.keys()]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((id) => ({ id, name: named.get(id)! }));
}

/**
 * The UI kit's draw items of a menu or `ui` overlay after its frames (none for a transition):
 * the screen built from the content, stepped with no input, then `draws()`.
 */
export function overlayUi(content: ContentBundle, overlay: SheetOverlay, opts: OverlayUiOptions): UiDraw[] {
  if (overlay.kind === 'transition') return [];
  const screen = content.manifest.screen;
  const ctx: MenuBuildContext = {
    screen,
    fonts: opts.fonts,
    frameSize: opts.frameSize,
    keys: keyHintMap(defaultBindings(0).keyboard),
  };
  if (overlay.kind === 'dialog') {
    const spec = content.manifest.menus;
    if (spec === undefined) throw new Error(`the game has no "menus" for dialog ${overlay.id}`);
    const ui = new UiScreen(dialogScreen(spec, ctx, overlay.id), {
      screen,
      fonts: opts.fonts,
      frameSize: opts.frameSize,
    });
    const idle = { commands: [], taps: [], pointer: null };
    if (overlay.frames !== null) for (let i = 0; i < overlay.frames; i++) ui.update(idle);
    else
      for (let i = 0; i < SHEET_DIALOG_MAX_FRAMES && ui.dialog(DIALOG_WIDGET)?.typed !== true; i++)
        ui.update(idle);
    return ui.draws();
  }
  let file: UiScreenFile;
  if (overlay.kind === 'menu') {
    const spec = content.manifest.menus;
    if (spec === undefined) throw new Error(`the game has no "menus" for ${overlay.screen}`);
    const status = opts.status ?? {};
    file =
      overlay.screen === 'title'
        ? titleScreen(spec, ctx, { canContinue: false, hasLevels: sheetLevels(content).length > 0 })
        : overlay.screen === 'levels'
          ? levelsScreen(spec, ctx, levelChoices(spec, sheetLevels(content), new Set()))
          : overlay.screen === 'clear'
            ? clearScreen(spec, ctx, status)
            : overlay.screen === 'end'
              ? endScreen(
                  spec,
                  ctx,
                  status,
                  // The end trigger whose test holds on the frame (its heading), as the shell picks it.
                  spec.triggers?.end?.find((t) => mixWhenHolds(t.when, status)),
                )
              : overlay.screen === 'pause'
                ? pauseScreen(spec, ctx)
                : overlay.screen === 'settings'
                  ? settingsScreen(spec, ctx, {
                      ...DEFAULT_VOLUMES,
                      shake: DEFAULT_SETTINGS.shake,
                      reduceFlashing: DEFAULT_SETTINGS.reduceFlashing,
                      colour: DEFAULT_SETTINGS.colour,
                      touch: 0,
                    })
                  : controlsScreen(spec, ctx);
  } else {
    const found = uiFile(content, overlay.file);
    if (found === undefined) throw new Error(`the game has no ui file "${overlay.file}"`);
    file = found;
  }
  const ui = new UiScreen(file, { screen, fonts: opts.fonts, frameSize: opts.frameSize });
  if (overlay.kind === 'ui' && overlay.widget !== null) {
    file.widgets.forEach((w, i) => ui.close(w.id ?? `#${i}`));
    ui.open(overlay.widget);
  }
  for (let i = 0; i < overlay.frames; i++) ui.update({ commands: [], taps: [], pointer: null });
  return ui.draws();
}
