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
import { defaultBindings } from '@engine/core/input/bindings';
import { keyHintMap } from '@engine/core/input/key-hints';
import type { DeepReadonly } from '@engine/core/present';
import { DEFAULT_SETTINGS, DEFAULT_VOLUMES } from '@engine/core/save/settings';
import {
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
/** The half length of a transition named by its kind (`fade`, `wipe`, `iris`), in frames. */
export const SHEET_TRANSITION_TICKS = 20;

/**
 * Reads one overlay as written in a tile (after its `+`): `title`, `pause`, `settings`,
 * `controls`, `ui=<file>` or `ui=<file>.<widget>`, each with an optional `*<frames>`, or a
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
    `"${text}" is not an overlay: use ${SHEET_MENU_SCREENS.join(', ')}, ui=<file>[.<widget>], or a transition (${known.join(', ')}), each with an optional *<n>`,
  );
}

/** An overlay as a tile's label writes it. */
export function overlayLabel(o: SheetOverlay): string {
  switch (o.kind) {
    case 'menu':
      return o.screen;
    case 'ui':
      return `ui ${o.file}${o.widget === null ? '' : `.${o.widget}`}`;
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
    case 'menu':
      return content.manifest.menus === undefined
        ? `the game's game.json has no "menus", so it has no ${overlay.screen} screen`
        : null;
    case 'ui': {
      const file = uiFile(content, overlay.file);
      if (file === undefined) return `the game has no ui file "${overlay.file}"`;
      if (overlay.widget !== null && !file.widgets.some((w, i) => (w.id ?? `#${i}`) === overlay.widget))
        return `the ui file "${overlay.file}" has no widget "${overlay.widget}"`;
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
}

/**
 * The UI kit's draw items of a menu or `ui` overlay after its frames (none for a transition):
 * the screen built from the content, stepped with no input, then `draws()`.
 */
export function overlayUi(content: ContentBundle, overlay: SheetOverlay, opts: OverlayUiOptions): UiDraw[] {
  if (overlay.kind === 'transition') return [];
  const screen = content.manifest.screen;
  let file: UiScreenFile;
  if (overlay.kind === 'menu') {
    const spec = content.manifest.menus;
    if (spec === undefined) throw new Error(`the game has no "menus" for ${overlay.screen}`);
    const ctx: MenuBuildContext = {
      screen,
      fonts: opts.fonts,
      frameSize: opts.frameSize,
      keys: keyHintMap(defaultBindings(0).keyboard),
    };
    file =
      overlay.screen === 'title'
        ? titleScreen(spec, ctx, { canContinue: false })
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
