import { z } from 'zod';
import type { KindIssue } from '../content/kinds';
import type { FieldPath } from '../content/validate';
import { Actions, type Action } from '../input/actions';
import { missingGlyphs, type FontFile, type FontLookup } from './font';
import type { UiFrameSize } from './look';
import { layoutText } from './text';
import {
  uiStyleSchema,
  type UiMenuItemSpec,
  type UiScreenFile,
  type UiStyle,
  type UiWidgetSpec,
} from './ui-schema';

/**
 * A game's title screen, pause menu, settings and controls screens as text (Engine 0.16 T9): the
 * `menus` block of `game.json`. The browser shell (`engine/core/shell/game-menus.ts`) builds the
 * four UI screens from it with the functions here and runs them on the UI kit, so a game writes no
 * menu code:
 *
 *   "menus": {
 *     "font": "ui", "titleFont": "title",
 *     "title": { "name": "Hopper's Way", "subtitle": "A meadow platformer", "music": "meadow",
 *                "items": ["start", "controls", "settings"] },
 *     "pause": { "items": ["resume", "controls", "settings", "title"] },
 *     "controls": [{ "actions": ["left", "right"], "label": "Run" }, { "actions": ["jump"], "label": "Jump" }] }
 *
 * The title shows the game's own picture at its start (the skin's background and parallax, the
 * first level) under a dim, the name in the title font (or a `logo` sprite frame), any `art`
 * frames, the menu and a key hint. `validate` (`checkMenus`, run by `loadContent` on `game.json`)
 * reports an unknown item (`unknown_menu_item`), a missing font, sprite, frame, song or sound
 * (`missing_ref`, `missing_frame`), a text a font lacks a glyph for (`missing_glyph`) and a
 * `controls` item without a `controls` list (`missing_field`). Pure.
 */

/** What a title screen may offer. `continue` shows only when the game says a save or code exists. */
export const TITLE_ITEMS = ['start', 'continue', 'controls', 'settings'] as const;
/** What a pause menu may offer. `title` goes back to the title screen (the game starts over). */
export const PAUSE_ITEMS = ['resume', 'controls', 'settings', 'title'] as const;
/**
 * What a settings screen may offer: the stored volumes (`master`, `music`, `sfx`, `mute`; Engine
 * 0.15), the screen shake scale, reduced flashing, the colour mode (only where the game gives its
 * modes) and the touch pad (auto, on, off).
 */
export const SETTINGS_ITEMS = [
  'master',
  'music',
  'sfx',
  'mute',
  'shake',
  'flashing',
  'colour',
  'touch',
] as const;
export type TitleItem = (typeof TITLE_ITEMS)[number];
export type PauseItem = (typeof PAUSE_ITEMS)[number];
export type SettingsItem = (typeof SETTINGS_ITEMS)[number];
export type MenuItemId = TitleItem | PauseItem | SettingsItem | 'back';

/** Every item's label when `labels` gives none. */
export const MENU_LABELS: Readonly<Record<MenuItemId, string>> = {
  start: 'Start',
  continue: 'Continue',
  controls: 'Controls',
  settings: 'Settings',
  resume: 'Resume',
  title: 'Back to title',
  master: 'Volume',
  music: 'Music',
  sfx: 'Sound effects',
  mute: 'Mute',
  shake: 'Screen shake',
  flashing: 'Reduce flashing',
  colour: 'Colours',
  touch: 'Touch pad',
  back: 'Back',
};

/** The headings of the generated screens. */
export const MENU_HEADINGS = { pause: 'Paused', settings: 'Settings', controls: 'Controls' } as const;
/** The touch pad setting's words, in slider order (`TOUCH_MODES` in `save/settings.ts`). */
export const TOUCH_WORDS = ['Auto', 'On', 'Off'] as const;
/** The pause keys as the controls screen shows them. */
export const PAUSE_KEYS = 'ESC / P';
/**
 * Characters a key name may use (the shell's `keyHintMap`: letters, digits, arrows, `/`): a game
 * with a controls screen needs them in its menu font.
 */
export const KEY_NAME_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789←→↑↓/';

const ALL_ITEMS: readonly string[] = [...TITLE_ITEMS, ...PAUSE_ITEMS, ...SETTINGS_ITEMS, 'back'];

const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is #rgb or #rrggbb',
});

/** A list of item ids, each one of `known` (else `unknown_menu_item` at it). */
const itemList = (known: readonly string[], what: string) =>
  z
    .array(z.string())
    .min(1)
    .superRefine((items, ctx) => {
      items.forEach((item, i) => {
        if (!known.includes(item))
          ctx.addIssue({
            code: 'custom',
            path: [i],
            message: `unknown ${what} item "${item}"; one of ${known.join(', ')}`,
            params: { code: 'unknown_menu_item' },
          });
        else if (items.indexOf(item) !== i)
          ctx.addIssue({
            code: 'custom',
            path: [i],
            message: `"${item}" is listed twice`,
            params: { code: 'unknown_menu_item' },
          });
      });
    });

const frameRef = {
  sheet: z.string().min(1).describe('a sprite file of the game'),
  frame: z.string().min(1).describe('a frame of that sheet'),
  palette: z.string().min(1).exactOptional().describe('a palette file to recolour it with'),
  scale: z.number().int().min(1).max(8).exactOptional().describe('whole-number scale (1)'),
};

const artSchema = z.strictObject({
  ...frameRef,
  anchor: z
    .enum([
      'top-left',
      'top',
      'top-right',
      'left',
      'center',
      'right',
      'bottom-left',
      'bottom',
      'bottom-right',
    ])
    .exactOptional()
    .describe('where it sits (default `center`)'),
  x: z.number().int().exactOptional().describe('px inward from the anchor (0)'),
  y: z.number().int().exactOptional().describe('px inward from the anchor (0)'),
});

const controlSchema = z
  .strictObject({
    actions: z
      .array(z.enum(Actions))
      .min(1)
      .exactOptional()
      .describe("the engine actions it uses (`left`, `jump`, ...); shown with the player's keys"),
    label: z.string().min(1).describe('what they do ("Jump")'),
    tap: z.string().min(1).exactOptional().describe('the touch or mouse part ("tap a cell", "drag")'),
  })
  .superRefine((c, ctx) => {
    if (c.actions === undefined && c.tap === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'a control needs `actions`, a `tap`, or both',
        params: { code: 'missing_field' },
      });
  });

/** The menus' look: the UI style without its font, plus the heading colour and the dim. */
export const menusStyleSchema = uiStyleSchema
  .omit({ font: true })
  .extend({
    heading: hex.exactOptional().describe('headings and the title name (default `focusText`)'),
    outline: hex.exactOptional().describe('the outline round headings and the name (default `#000000`)'),
    dim: z.number().min(0).max(1).exactOptional().describe('how dark the dim over the game is (0.55)'),
    dimColor: hex.exactOptional().describe("the dim's colour (`#000000`)"),
  })
  .describe(
    'the menus look: UI style fields (colours, panel, cursor, sounds, tweens) and `heading`, `outline`, `dim`',
  );

export const menusSchema = z
  .strictObject({
    font: z.string().min(1).describe('the font file menu text is drawn in'),
    titleFont: z
      .string()
      .min(1)
      .exactOptional()
      .describe('the font of the title name and headings (default `font`)'),
    style: menusStyleSchema.exactOptional(),
    labels: z
      .record(z.string(), z.string().min(1))
      .exactOptional()
      .superRefine((labels, ctx) => {
        for (const key of Object.keys(labels ?? {}))
          if (!ALL_ITEMS.includes(key))
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message: `no menu item "${key}"; one of ${ALL_ITEMS.join(', ')}`,
              params: { code: 'unknown_menu_item' },
            });
      })
      .describe('item id -> its label, replacing the default (`{ "start": "New game" }`)'),
    title: z
      .strictObject({
        name: z.string().min(1).exactOptional().describe("the game's name, drawn in the title font"),
        logo: z.strictObject(frameRef).exactOptional().describe('a sprite frame drawn instead of the name'),
        subtitle: z.string().min(1).exactOptional().describe('one line under the name'),
        art: z.array(artSchema).exactOptional().describe('more sprite frames drawn on the title'),
        dim: z
          .number()
          .min(0)
          .max(1)
          .exactOptional()
          .describe("how dark the dim over the game's start picture is (default the style's)"),
        music: z
          .string()
          .min(1)
          .exactOptional()
          .describe('a song (or layered music entry) played on the title'),
        footer: z.string().min(1).exactOptional().describe('a small line at the bottom (credits, a version)'),
        items: itemList(TITLE_ITEMS, 'title').describe(`the title menu: ${TITLE_ITEMS.join(', ')}`),
      })
      .superRefine((t, ctx) => {
        if (t.name === undefined && t.logo === undefined)
          ctx.addIssue({
            code: 'custom',
            path: ['name'],
            message: 'a title needs a `name` or a `logo`',
            params: { code: 'missing_field' },
          });
      })
      .describe('the title screen'),
    pause: z
      .strictObject({
        items: itemList(PAUSE_ITEMS, 'pause').describe(`the pause menu: ${PAUSE_ITEMS.join(', ')}`),
      })
      .describe('the pause menu (Escape, P, gamepad Start or the on-screen button)'),
    settings: z
      .strictObject({
        items: itemList(SETTINGS_ITEMS, 'settings').describe(
          `the settings screen: ${SETTINGS_ITEMS.join(', ')} (default all but colour)`,
        ),
      })
      .exactOptional()
      .describe('the settings screen'),
    controls: z
      .array(controlSchema)
      .min(1)
      .exactOptional()
      .describe("the controls screen's rows: actions with what they do, shown with the player's keys"),
  })
  .describe('the title screen, pause menu, settings and controls screens (Engine 0.16 T9)');

export type MenusSpec = z.output<typeof menusSchema>;
export type MenusStyle = z.output<typeof menusStyleSchema>;
export type MenuControl = z.output<typeof controlSchema>;

/** The settings items a game shows: its list, else all but `colour`. */
export function settingsItems(menus: MenusSpec): readonly SettingsItem[] {
  return (
    (menus.settings?.items as SettingsItem[] | undefined) ?? SETTINGS_ITEMS.filter((i) => i !== 'colour')
  );
}

/** An item's label (the game's `labels`, else `MENU_LABELS`). */
export function menuLabel(menus: MenusSpec, id: MenuItemId): string {
  return menus.labels?.[id] ?? MENU_LABELS[id];
}

/** The values a settings screen opens with. */
export interface MenuSettingsValues {
  /** 0..1 each. */
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  /** 0..1. */
  shake: number;
  reduceFlashing: boolean;
  /** An index into `colourModes`. */
  colour: number;
  /** An index into `TOUCH_WORDS`. */
  touch: number;
}

/** What building a screen needs besides the spec. */
export interface MenuBuildContext {
  screen: { width: number; height: number };
  fonts: FontLookup;
  frameSize: UiFrameSize;
  /** The player's key names by action (the shell's `keyHintMap` of player 1's keyboard). */
  keys: Partial<Record<Action, string>>;
}

const DEFAULT_DIM = 0.55;
const DEFAULT_HEADING = '#f8b800';
const DEFAULT_OUTLINE = '#000000';

/** The UI style of a game's menus (the `menus.style` fields over the UI kit's defaults). */
export function menusUiStyle(menus: MenusSpec): UiStyle {
  const { heading: _h, outline: _o, dim: _d, dimColor: _c, ...rest } = menus.style ?? {};
  return { cursor: '>', ...rest, font: menus.font };
}

function heading(menus: MenusSpec): { color: string; outline: string; font: string } {
  const s = menus.style ?? {};
  return {
    color: s.heading ?? s.focusText ?? DEFAULT_HEADING,
    outline: s.outline ?? DEFAULT_OUTLINE,
    font: menus.titleFont ?? menus.font,
  };
}

function dimPanel(menus: MenusSpec, screen: { width: number; height: number }, dim?: number): UiWidgetSpec[] {
  const alpha = dim ?? menus.style?.dim ?? DEFAULT_DIM;
  if (alpha <= 0) return [];
  return [
    {
      type: 'panel',
      anchor: 'center',
      w: screen.width,
      h: screen.height,
      color: menus.style?.dimColor ?? '#000000',
      alpha,
    },
  ];
}

/** Px a text takes in a font (0 for an unknown font). */
function textHeight(fonts: FontLookup, font: string, text: string, width?: number): number {
  const f = fonts(font);
  if (f === null) return 0;
  return layoutText(f, text, width !== undefined ? { width } : {}).height;
}

function rowHeight(fonts: FontLookup, font: string): number {
  return (fonts(font)?.cell.h ?? 8) + 2;
}

/** The hint line under a menu: how to move and choose, with the player's keys. */
export function menuHint(keys: Partial<Record<Action, string>>, change = false, withBack = true): string {
  const updown = `${keys.up ?? ''}${keys.down ?? ''}`;
  const sides = `${keys.left ?? ''}${keys.right ?? ''}`;
  const choose = keys.jump ?? keys.start ?? '';
  const back = keys.attack ?? '';
  const parts = [
    updown !== '' ? `${updown} choose` : '',
    change && sides !== '' ? `${sides} change` : '',
    choose !== '' ? `${choose} select` : '',
    back !== '' && withBack ? `${back} back` : '',
  ];
  return parts.filter((p) => p !== '').join('   ');
}

/** A dark strip along the bottom behind `lines` hint lines, so they read over any picture. */
function hintStrip(menus: MenusSpec, ctx: MenuBuildContext, lines: number): UiWidgetSpec {
  return {
    type: 'panel',
    anchor: 'bottom',
    w: ctx.screen.width,
    h: lines * rowHeight(ctx.fonts, menus.font) + 8,
    color: menus.style?.dimColor ?? '#000000',
    alpha: 0.6,
  };
}

function hintWidget(menus: MenusSpec, text: string, y = 6): UiWidgetSpec {
  return {
    type: 'text',
    anchor: 'bottom',
    y,
    text,
    color: menus.style?.disabledText ?? '#bcbcbc',
  };
}

function buttons(menus: MenusSpec, ids: readonly MenuItemId[]): UiMenuItemSpec[] {
  return ids.map((id) => ({ id, label: menuLabel(menus, id) }));
}

/** The title screen: dim, name or logo, subtitle, art, the menu, the footer and the key hint. */
export function titleScreen(
  menus: MenusSpec,
  ctx: MenuBuildContext,
  opts: { canContinue: boolean },
): UiScreenFile {
  const { screen, fonts, frameSize } = ctx;
  const t = menus.title;
  const head = heading(menus);
  const widgets: UiWidgetSpec[] = [...dimPanel(menus, screen, t.dim)];
  let y = Math.max(16, Math.round(screen.height * 0.13));
  if (t.logo !== undefined) {
    const size = frameSize(t.logo.sheet, t.logo.palette, t.logo.frame);
    widgets.push({ type: 'image', anchor: 'top', y, ...t.logo });
    y += (size?.h ?? 0) * (t.logo.scale ?? 1);
  } else if (t.name !== undefined) {
    const w = screen.width - 16;
    widgets.push({
      type: 'text',
      anchor: 'top',
      y,
      w,
      align: 'center',
      text: t.name,
      font: head.font,
      color: head.color,
      outline: head.outline,
      shadow: head.outline,
    });
    y += textHeight(fonts, head.font, t.name, w);
  }
  if (t.subtitle !== undefined) {
    y += 6;
    widgets.push({
      type: 'text',
      anchor: 'top',
      y,
      w: screen.width - 16,
      align: 'center',
      text: t.subtitle,
      color: menus.style?.text ?? '#fcfcfc',
      outline: head.outline,
    });
  }
  for (const art of t.art ?? []) {
    const { anchor, x, y: ay, ...frame } = art;
    widgets.push({ type: 'image', anchor: anchor ?? 'center', x: x ?? 0, y: ay ?? 0, ...frame });
  }
  const items = (t.items as TitleItem[]).filter((i) => i !== 'continue' || opts.canContinue);
  const hint = menuHint(ctx.keys, false, false);
  const footerY = 6 + rowHeight(fonts, menus.font);
  widgets.push({
    id: 'main',
    type: 'menu',
    anchor: 'bottom',
    y: footerY + (t.footer !== undefined ? rowHeight(fonts, menus.font) : 0) + 12,
    w: menuWidth(menus, ctx, items, 96),
    items: buttons(menus, items),
  });
  const lines = (t.footer !== undefined ? 1 : 0) + (hint !== '' ? 1 : 0);
  if (lines > 0) widgets.push(hintStrip(menus, ctx, lines));
  if (t.footer !== undefined) widgets.push(hintWidget(menus, t.footer, hint !== '' ? footerY : 6));
  if (hint !== '') widgets.push(hintStrip(menus, ctx, 1), hintWidget(menus, hint));
  return { style: menusUiStyle(menus), focus: 'main', widgets };
}

/** A menu's width: the widest label plus room, at least `min`, within the picture. */
function menuWidth(
  menus: MenusSpec,
  ctx: MenuBuildContext,
  items: readonly MenuItemId[],
  min: number,
): number {
  const font = ctx.fonts(menus.font);
  const widest =
    font === null ? 0 : Math.max(...items.map((i) => layoutText(font, menuLabel(menus, i)).width));
  return Math.min(ctx.screen.width - 16, Math.max(min, widest + 36));
}

/** A heading in the title font over a centred box, then `body` widgets under it. */
function framedScreen(
  menus: MenusSpec,
  ctx: MenuBuildContext,
  title: string,
  bodyHeight: number,
  width: number,
  body: (top: number) => UiWidgetSpec[],
  dim?: number,
): UiWidgetSpec[] {
  const { screen, fonts } = ctx;
  const head = heading(menus);
  const headH = textHeight(fonts, head.font, title);
  const pad = 10;
  const h = pad + headH + 8 + bodyHeight + pad;
  const top = Math.max(4, Math.floor((screen.height - h) / 2) - 6);
  return [
    ...dimPanel(menus, screen, dim),
    { type: 'panel', anchor: 'top', y: top, w: width, h },
    {
      type: 'text',
      anchor: 'top',
      y: top + pad,
      text: title,
      font: head.font,
      color: head.color,
      outline: head.outline,
      shadow: head.outline,
    },
    ...body(top + pad + headH + 8),
  ];
}

function menuHeight(ctx: MenuBuildContext, menus: MenusSpec, n: number): number {
  const gap = menus.style?.gap ?? 2;
  return n * rowHeight(ctx.fonts, menus.font) + (n - 1) * gap;
}

/** The pause menu: the game dimmed under a panel with "Paused" and the menu. */
export function pauseScreen(menus: MenusSpec, ctx: MenuBuildContext): UiScreenFile {
  const items = menus.pause.items as PauseItem[];
  const width = menuWidth(menus, ctx, items, 120) + 24;
  const widgets = framedScreen(
    menus,
    ctx,
    MENU_HEADINGS.pause,
    menuHeight(ctx, menus, items.length),
    width,
    (top) => [
      {
        id: 'main',
        type: 'menu',
        anchor: 'top',
        y: top,
        w: width - 24,
        panel: false,
        items: buttons(menus, items),
      },
    ],
  );
  const hint = menuHint(ctx.keys);
  if (hint !== '') widgets.push(hintStrip(menus, ctx, 1), hintWidget(menus, hint));
  return { style: menusUiStyle(menus), focus: 'main', widgets };
}

/** The settings screen: a slider or toggle per setting, then Back. */
export function settingsScreen(
  menus: MenusSpec,
  ctx: MenuBuildContext,
  values: MenuSettingsValues,
  opts: { colourModes?: readonly string[] } = {},
): UiScreenFile {
  const ids = settingsItems(menus).filter((i) => i !== 'colour' || (opts.colourModes?.length ?? 0) > 1);
  const items: UiMenuItemSpec[] = ids.map((id): UiMenuItemSpec => {
    const label = menuLabel(menus, id);
    const tenth = (v: number) => Math.round(v * 10);
    switch (id) {
      case 'master':
        return { type: 'slider', id, label, min: 0, max: 10, value: tenth(values.master) };
      case 'music':
        return { type: 'slider', id, label, min: 0, max: 10, value: tenth(values.music) };
      case 'sfx':
        return { type: 'slider', id, label, min: 0, max: 10, value: tenth(values.sfx) };
      case 'shake':
        return { type: 'slider', id, label, min: 0, max: 10, value: tenth(values.shake) };
      case 'mute':
        return { type: 'toggle', id, label, value: values.muted };
      case 'flashing':
        return { type: 'toggle', id, label, value: values.reduceFlashing };
      case 'colour':
        return {
          type: 'slider',
          id,
          label,
          min: 0,
          max: (opts.colourModes?.length ?? 1) - 1,
          value: values.colour,
          labels: [...(opts.colourModes ?? ['Default'])],
        };
      case 'touch':
        return { type: 'slider', id, label, min: 0, max: 2, value: values.touch, labels: [...TOUCH_WORDS] };
    }
  });
  items.push({ id: 'back', label: menuLabel(menus, 'back') });
  const width = Math.min(ctx.screen.width - 8, 208);
  const widgets = framedScreen(
    menus,
    ctx,
    MENU_HEADINGS.settings,
    menuHeight(ctx, menus, items.length),
    width,
    (top) => [{ id: 'main', type: 'menu', anchor: 'top', y: top, w: width - 20, panel: false, items }],
    Math.max(menus.style?.dim ?? DEFAULT_DIM, 0.7),
  );
  const hint = menuHint(ctx.keys, true);
  if (hint !== '') widgets.push(hintStrip(menus, ctx, 1), hintWidget(menus, hint));
  return { style: menusUiStyle(menus), focus: 'main', widgets };
}

/** One row of the controls screen: what it does and the keys. */
export function controlRows(
  controls: readonly MenuControl[],
  keys: Partial<Record<Action, string>>,
): { label: string; keys: string }[] {
  const dirs: readonly Action[] = ['left', 'right', 'up', 'down'];
  const rows = controls.map((c) => {
    const actions = c.actions ?? [];
    // Directions are written together (`←→`, `←→↑↓`), other keys apart (`X / Z`).
    const moves = actions.filter((a) => dirs.includes(a)).map((a) => keys[a] ?? '');
    const others = actions.filter((a) => !dirs.includes(a)).map((a) => keys[a] ?? '');
    const keyText = [...new Set([moves.join(''), ...others])].filter((k) => k !== '').join(' / ');
    const how = [keyText, c.tap ?? ''].filter((k) => k !== '').join(' or ');
    return { label: c.label, keys: how };
  });
  rows.push({ label: 'Pause', keys: PAUSE_KEYS });
  return rows;
}

/** The controls screen: each row's label on the left and its keys on the right, then Back. */
export function controlsScreen(menus: MenusSpec, ctx: MenuBuildContext): UiScreenFile {
  const rows = controlRows(menus.controls ?? [], ctx.keys);
  const rh = rowHeight(ctx.fonts, menus.font) + 1;
  const width = Math.min(ctx.screen.width - 8, 224);
  const back = menuHeight(ctx, menus, 1);
  const bodyH = rows.length * rh + 8 + back;
  const muted = menus.style?.focusText ?? DEFAULT_HEADING;
  const widgets = framedScreen(
    menus,
    ctx,
    MENU_HEADINGS.controls,
    bodyH,
    width,
    (top) => {
      const left = Math.floor((ctx.screen.width - width) / 2) + 12;
      const out: UiWidgetSpec[] = [];
      rows.forEach((row, i) => {
        out.push({ type: 'text', x: left, y: top + i * rh, text: row.label });
        out.push({
          type: 'text',
          x: left,
          y: top + i * rh,
          w: width - 24,
          align: 'right',
          text: row.keys,
          color: muted,
        });
      });
      out.push({
        id: 'main',
        type: 'menu',
        anchor: 'top',
        y: top + rows.length * rh + 8,
        w: 72,
        panel: false,
        items: buttons(menus, ['back']),
      });
      return out;
    },
    Math.max(menus.style?.dim ?? DEFAULT_DIM, 0.7),
  );
  const hint = menuHint({ ...ctx.keys, up: '', down: '' });
  if (hint !== '') widgets.push(hintStrip(menus, ctx, 1), hintWidget(menus, hint));
  return { style: menusUiStyle(menus), focus: 'main', widgets };
}

/** Every text the menus draw in a font, with its `game.json` field (for `missing_glyph`). */
function menuTexts(menus: MenusSpec): { path: FieldPath; text: string; font: string }[] {
  const font = menus.font;
  const head = menus.titleFont ?? font;
  const out: { path: FieldPath; text: string; font: string }[] = [];
  const add = (path: FieldPath, text: string, f = font) => out.push({ path, text, font: f });
  if (menus.title.name !== undefined && menus.title.logo === undefined)
    add(['title', 'name'], menus.title.name, head);
  if (menus.title.subtitle !== undefined) add(['title', 'subtitle'], menus.title.subtitle);
  if (menus.title.footer !== undefined) add(['title', 'footer'], menus.title.footer);
  const cursor = menus.style?.cursor ?? '>';
  add(['style', 'cursor'], cursor);
  const label = (path: FieldPath, id: string) =>
    ALL_ITEMS.includes(id) && add(path, menuLabel(menus, id as MenuItemId));
  menus.title.items.forEach((id, i) => label(['title', 'items', i], id));
  menus.pause.items.forEach((id, i) => label(['pause', 'items', i], id));
  add(['pause'], MENU_HEADINGS.pause, head);
  const used = new Set<string>([...menus.title.items, ...menus.pause.items]);
  if (used.has('settings')) {
    const items = settingsItems(menus);
    items.forEach((id, i) => label(menus.settings ? ['settings', 'items', i] : ['settings'], id));
    label(['settings'], 'back');
    add(['settings'], MENU_HEADINGS.settings, head);
    add(['settings'], '0123456789OnOf');
    if (items.includes('touch')) add(['settings'], `<>${TOUCH_WORDS.join('')}`);
  }
  if (used.has('controls')) {
    add(['controls'], MENU_HEADINGS.controls, head);
    label(['controls'], 'back');
    (menus.controls ?? []).forEach((c, i) => {
      add(['controls', i, 'label'], c.label);
      if (c.tap !== undefined) add(['controls', i, 'tap'], c.tap);
    });
    add(['controls'], `${KEY_NAME_GLYPHS}Pause${PAUSE_KEYS}or`);
  }
  add(['font'], 'chooseselectbackchange');
  return out;
}

/** What `checkMenus` reads from the game's other content. */
export interface MenusRefs {
  fonts: ReadonlyMap<string, FontFile>;
  sprites: ReadonlyMap<string, { frames?: Record<string, unknown> }>;
  palettes: ReadonlySet<string>;
  /** Song and sfx ids, and the skins' layered music entry ids. */
  sounds: ReadonlySet<string>;
}

/**
 * The problems with a game's `menus` against its content, each at its field under `menus`:
 * a missing font, sprite, palette, song or sound (`missing_ref`), a missing frame
 * (`missing_frame`), a text a font lacks glyphs for (`missing_glyph`) and a `controls` item
 * without the `controls` list (`missing_field`).
 */
export function checkMenus(menus: MenusSpec, refs: MenusRefs): Omit<KindIssue, 'name'>[] {
  const out: Omit<KindIssue, 'name'>[] = [];
  const missing = (path: FieldPath, what: string, ref: string) =>
    out.push({ path, code: 'missing_ref', message: `no ${what} "${ref}" in the game` });
  if (!refs.fonts.has(menus.font)) missing(['font'], 'font', menus.font);
  if (menus.titleFont !== undefined && !refs.fonts.has(menus.titleFont))
    missing(['titleFont'], 'font', menus.titleFont);
  for (const { path, text, font } of menuTexts(menus)) {
    const file = refs.fonts.get(font);
    if (file === undefined) continue;
    const lacks = missingGlyphs(new Set(Object.keys(file.glyphs)), text);
    if (lacks.length > 0)
      out.push({
        path,
        code: 'missing_glyph',
        message: `font "${font}" has no glyph for ${lacks.map((c) => JSON.stringify(c)).join(', ')}`,
      });
  }
  const frameAt = (path: FieldPath, ref: { sheet: string; frame: string; palette?: string | undefined }) => {
    const sprite = refs.sprites.get(ref.sheet);
    if (sprite === undefined) missing([...path, 'sheet'], 'sprite', ref.sheet);
    else if (sprite.frames && !Object.hasOwn(sprite.frames, ref.frame))
      out.push({
        path: [...path, 'frame'],
        code: 'missing_frame',
        message: `sprite "${ref.sheet}" has no frame "${ref.frame}"`,
      });
    if (ref.palette !== undefined && !refs.palettes.has(ref.palette))
      missing([...path, 'palette'], 'palette', ref.palette);
  };
  if (menus.title.logo !== undefined) frameAt(['title', 'logo'], menus.title.logo);
  (menus.title.art ?? []).forEach((a, i) => frameAt(['title', 'art', i], a));
  if (menus.style?.panel !== undefined) frameAt(['style', 'panel'], menus.style.panel);
  if (menus.title.music !== undefined && !refs.sounds.has(menus.title.music))
    missing(['title', 'music'], 'song', menus.title.music);
  for (const [key, id] of Object.entries(menus.style?.sounds ?? {}))
    if (id !== undefined && !refs.sounds.has(id)) missing(['style', 'sounds', key], 'sfx or song', id);
  const wantsControls = [...menus.title.items, ...menus.pause.items].includes('controls');
  if (wantsControls && menus.controls === undefined)
    out.push({
      path: ['controls'],
      code: 'missing_field',
      message: 'a `controls` item needs the `controls` list (actions and what they do)',
    });
  return out;
}
