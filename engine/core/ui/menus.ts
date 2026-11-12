import { z } from 'zod';
import type { KindIssue } from '../content/kinds';
import type { FieldPath } from '../content/validate';
import { Actions, type Action } from '../input/actions';
import { mixWhenSchema } from '../audio/mix';
import { missingGlyphs, type FontFile, type FontLookup } from './font';
import { panelExtra, uiLook, type UiFrameSize } from './look';
import { layoutText } from './text';
import { DialogBox } from './dialog';
import { UI_DIALOG_MARGIN } from './screen';
import {
  UI_STYLE_DEFAULTS,
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

/**
 * What a title screen may offer. `continue` shows only when the game says a save or code exists;
 * `levels` (Engine 0.16 part B) opens the level select, shown only when the page gives levels.
 */
export const TITLE_ITEMS = ['start', 'continue', 'levels', 'controls', 'settings'] as const;
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
/** What the end screen may offer (Engine 0.16 part B): back to the title, or the level select. */
export const END_ITEMS = ['title', 'levels'] as const;
export type TitleItem = (typeof TITLE_ITEMS)[number];
export type PauseItem = (typeof PAUSE_ITEMS)[number];
export type SettingsItem = (typeof SETTINGS_ITEMS)[number];
export type EndItem = (typeof END_ITEMS)[number];
export type MenuItemId = TitleItem | PauseItem | SettingsItem | EndItem | 'back';

/** Every item's label when `labels` gives none. */
export const MENU_LABELS: Readonly<Record<MenuItemId, string>> = {
  start: 'Start',
  continue: 'Continue',
  levels: 'Levels',
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
export const MENU_HEADINGS = {
  pause: 'Paused',
  settings: 'Settings',
  controls: 'Controls',
  levels: 'Levels',
  clear: 'Level clear!',
  end: 'The end',
} as const;
/** The mark after a cleared level's name in the level select, when `levels.mark` gives none. */
export const CLEARED_MARK = '*';
/** The touch pad setting's words, in slider order (`TOUCH_MODES` in `save/settings.ts`). */
export const TOUCH_WORDS = ['Auto', 'On', 'Off'] as const;
/** The pause keys as the controls screen shows them. */
export const PAUSE_KEYS = 'ESC / P';
/**
 * Characters a key name may use (the shell's `keyHintMap`: letters, digits, arrows, `/`): a game
 * with a controls screen needs them in its menu font.
 */
export const KEY_NAME_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789←→↑↓/';

const ALL_ITEMS: readonly string[] = [
  ...new Set([...TITLE_ITEMS, ...PAUSE_ITEMS, ...SETTINGS_ITEMS, ...END_ITEMS, 'back']),
];

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

/** How a stat line writes its value: a plain number, or ticks as minutes and seconds (`1:05`). */
export const STAT_FORMATS = ['number', 'time'] as const;

const statLineSchema = z.strictObject({
  label: z.string().min(1).describe('what it shows ("Coins")'),
  status: z
    .string()
    .min(1)
    .describe("the frame's status key it reads (`coins`, `time`, `deaths`, `checkpoints`: the kit's)"),
  of: z
    .string()
    .min(1)
    .exactOptional()
    .describe('a status key written after a slash (`checkpointCount`: "2/3")'),
  format: z
    .enum(STAT_FORMATS)
    .exactOptional()
    .describe('`number` (default) or `time` (ticks at 60 a second, as `m:ss`)'),
});

/**
 * A dialog box the shell shows from `menus.dialogs` (Engine 0.16 part C T7): the UI kit's
 * `DialogBox` over the game, at the bottom of the picture.
 */
const dialogSchema = z.strictObject({
  speaker: z.string().min(1).exactOptional().describe("the speaker's name, on a tab over the box"),
  portrait: z
    .strictObject({
      sheet: z.string().min(1).describe("a sprite file of the game or a skin's PNG image sheet"),
      frame: z.string().min(1).describe('a frame of that sheet'),
      palette: z.string().min(1).exactOptional().describe('a palette file to recolour it with'),
    })
    .exactOptional()
    .describe('a sprite frame shown in a frame at the left of the text'),
  pages: z
    .array(z.string().min(1))
    .min(1)
    .describe('the text, page by page; a page too long for the box breaks into more at whole lines'),
  rate: z
    .number()
    .int()
    .min(0)
    .max(30)
    .exactOptional()
    .describe("display frames per character (the menus style's `rate`, else 2); 0 shows a page at once"),
  lines: z
    .number()
    .int()
    .min(2)
    .max(8)
    .exactOptional()
    .describe('lines of text the box holds (3; taller when the portrait needs it)'),
});

/** The status key an end screen's star row reads when it names none. */
export const STARS_STATUS = 'stars';

/** Stars in an end screen's row when it gives no `count`. */
export const DEFAULT_STAR_COUNT = 3;

/** Px between two stars of an end screen's row when it gives no `gap`. */
export const DEFAULT_STAR_GAP = 4;

/**
 * An end screen's star rating (Engine 0.16 E6, the tower defense's 1-3 stars): a row of `count`
 * stars, the first `status`-many filled. With `sheet`, `filled` and `empty` are its frames (a
 * sprite file or a skin's PNG image sheet); without, texts drawn in the title font, the filled in
 * the heading colour and the empty in the style's `disabledText`.
 */
const starsSchema = z.strictObject({
  status: z
    .string()
    .min(1)
    .exactOptional()
    .describe(
      `the status key with the stars won, a whole number (default \`${STARS_STATUS}\`); no row while the status lacks it`,
    ),
  count: z
    .number()
    .int()
    .min(1)
    .max(5)
    .exactOptional()
    .describe(`stars in the row (default ${DEFAULT_STAR_COUNT})`),
  filled: z
    .string()
    .min(1)
    .describe('a won star: a frame of `sheet`, or without one a text in the title font (`*`)'),
  empty: z.string().min(1).describe('a star not won: a frame of `sheet`, or a text in the title font (`-`)'),
  sheet: z
    .string()
    .min(1)
    .exactOptional()
    .describe("a sprite file of the game (or a skin's PNG image sheet) holding the two frames"),
  palette: z.string().min(1).exactOptional().describe('a palette file to recolour the frames with'),
  scale: z.number().int().min(1).max(8).exactOptional().describe('whole-number scale of the frames (1)'),
  gap: z
    .number()
    .int()
    .min(0)
    .max(32)
    .exactOptional()
    .describe(`px between two stars (default ${DEFAULT_STAR_GAP})`),
});

/** An end trigger: the status test that says the game is over, its dialog and the end screen's heading. */
const endTriggerSchema = z.strictObject({
  when: mixWhenSchema.describe(
    "the test on a presented frame's status (`{ status, eq?, ne?, lt?, lte?, gt?, gte? }` or a list that must all hold), e.g. the top-down kit's `exited`",
  ),
  dialog: z
    .string()
    .min(1)
    .exactOptional()
    .describe('a `dialogs` id shown first (none: straight to the end screen)'),
  heading: z
    .string()
    .min(1)
    .exactOptional()
    .describe("the end screen's heading for this end (else `end.heading`)"),
  credits: z
    .string()
    .min(1)
    .exactOptional()
    .describe("the end screen's credits line for this end (else `end.credits`)"),
  music: z
    .string()
    .min(1)
    .exactOptional()
    .describe(
      'a song (or layered music entry) played when this end opens its dialog or end screen (else `end.music`; Engine 0.16 part C T9)',
    ),
  stars: z
    .boolean()
    .exactOptional()
    .describe("`false` leaves the end screen's star row out for this end (a loss; Engine 0.16 E6)"),
});

/** The lines the level-clear and end screens show when they give none. */
export const DEFAULT_STAT_LINES: readonly StatLine[] = [
  { label: 'Coins', status: 'coins' },
  { label: 'Time', status: 'time', format: 'time' },
  { label: 'Deaths', status: 'deaths' },
];

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

/** The fastest game speed a page may offer (`menus.speeds`, Engine 0.16 E5). */
export const SPEED_MAX = 8;

/**
 * Checks a game speed list (`menus.speeds`, the shell's speed control, Engine 0.16 E5): at least
 * two whole speeds, going up, starting at 1 (normal speed), at most `SPEED_MAX`. Returns the
 * problem as one sentence, or null.
 */
export function speedsProblem(speeds: readonly number[]): string | null {
  if (speeds.length < 2) return 'a speed list needs at least two speeds';
  if (speeds[0] !== 1) return 'a speed list starts at 1 (normal speed)';
  for (let i = 0; i < speeds.length; i++) {
    const s = speeds[i]!;
    if (!Number.isInteger(s) || s < 1 || s > SPEED_MAX)
      return `a speed is a whole number from 1 to ${SPEED_MAX} (got ${s})`;
    if (i > 0 && s <= speeds[i - 1]!) return 'a speed list goes up';
  }
  return null;
}

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
    levels: z
      .strictObject({
        heading: z.string().min(1).exactOptional().describe('the heading (default `Levels`)'),
        lock: z
          .boolean()
          .exactOptional()
          .describe('true (default): a level shows only once the one before it is cleared'),
        mark: z
          .string()
          .min(1)
          .exactOptional()
          .describe(`written after a cleared level's name (default \`${CLEARED_MARK}\`)`),
      })
      .exactOptional()
      .describe(
        "the level select (Engine 0.16 part B), opened by the title's `levels` item: the game's levels by name, cleared and locked",
      ),
    clear: z
      .strictObject({
        heading: z.string().min(1).exactOptional().describe('the banner heading (default `Level clear!`)'),
        lines: z
          .array(statLineSchema)
          .exactOptional()
          .describe('the stats it shows from the frame status (default coins, time, deaths)'),
      })
      .exactOptional()
      .describe(
        'the level-clear banner (Engine 0.16 part B), shown over the game while the kit pauses between levels; it takes no input',
      ),
    end: z
      .strictObject({
        heading: z.string().min(1).exactOptional().describe('the heading (default `The end`)'),
        credits: z.string().min(1).exactOptional().describe('a credits line under the heading'),
        lines: z
          .array(statLineSchema)
          .exactOptional()
          .describe(
            'the stats it shows, summed over the levels cleared this play (default coins, time, deaths)',
          ),
        stars: starsSchema
          .exactOptional()
          .describe(
            'a star rating row under the credits (Engine 0.16 E6): `{ status?, count?, filled, empty, sheet?, palette?, scale?, gap? }`',
          ),
        items: itemList(END_ITEMS, 'end')
          .exactOptional()
          .describe(`its menu: ${END_ITEMS.join(', ')} (default title)`),
        music: z
          .string()
          .min(1)
          .exactOptional()
          .describe(
            "a song (or layered music entry) played when the end screen opens, such as a short jingle; the game's music comes back when a level is chosen",
          ),
      })
      .exactOptional()
      .describe(
        "the end screen (Engine 0.16 part B), shown once the last level is cleared or (part C) an `end` trigger's test holds",
      ),
    speeds: z
      .array(z.number())
      .exactOptional()
      .superRefine((speeds, ctx) => {
        const problem = speeds === undefined ? null : speedsProblem(speeds);
        if (problem !== null)
          ctx.addIssue({ code: 'custom', message: problem, params: { code: 'bad_speeds' } });
      })
      .describe(
        'the speed-up control (Engine 0.16 E5): the game speeds the shell offers, e.g. `[1, 2, 3]`; F, gamepad RT or the on-screen button cycles them; ticks and hashes never change',
      ),
    dialogs: z
      .record(
        z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'a dialog id is lower-case letters, digits and -' }),
        dialogSchema,
      )
      .exactOptional()
      .describe(
        'dialog boxes by id (Engine 0.16 part C): a speaker, a portrait, pages typed out; `triggers` say when they show',
      ),
    triggers: z
      .strictObject({
        intro: z
          .string()
          .min(1)
          .exactOptional()
          .describe('a dialog shown after Start (or Continue), before play: the game is held under it'),
        end: z
          .array(endTriggerSchema)
          .min(1)
          .exactOptional()
          .describe(
            "the game's ends: the first whose `when` holds on a presented frame's status shows its dialog, then the end screen",
          ),
      })
      .exactOptional()
      .describe(
        'when the shell shows `dialogs` (Engine 0.16 part C): the intro after Start and the dialogs at the game end, before `end`',
      ),
  })
  .describe(
    'the title screen, pause menu, settings and controls screens (Engine 0.16 T9), the level select, level-clear banner and end screen (Engine 0.16 part B), and dialogs with their triggers (part C)',
  );

export type MenusSpec = z.output<typeof menusSchema>;
export type MenusStyle = z.output<typeof menusStyleSchema>;
export type MenuControl = z.output<typeof controlSchema>;
export type StatLine = z.output<typeof statLineSchema>;
export type MenuDialog = z.output<typeof dialogSchema>;
export type EndTrigger = z.output<typeof endTriggerSchema>;
export type EndStars = z.output<typeof starsSchema>;

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

/**
 * A framed screen's width: `width`, widened (up to the picture less 8 px) so the heading in the
 * title font fits inside the panel with 16 px each side (Engine 0.16 part B, T11: a long end
 * heading ran over the panel's frame).
 */
function headedWidth(menus: MenusSpec, ctx: MenuBuildContext, title: string, width: number): number {
  const f = ctx.fonts(heading(menus).font);
  const headW = f === null ? 0 : layoutText(f, title).width + 32;
  return Math.min(ctx.screen.width - 8, Math.max(width, headW));
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
  opts: { canContinue: boolean; hasLevels?: boolean },
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
  const items = (t.items as TitleItem[]).filter(
    (i) => (i !== 'continue' || opts.canContinue) && (i !== 'levels' || opts.hasLevels !== false),
  );
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

/** A frame status value as the stat screens show it. */
export type StatValues = Readonly<Record<string, string | number | boolean>>;

/** Ticks (60 a second) as minutes and whole seconds, `m:ss`. */
export function formatTicks(ticks: number): string {
  const seconds = Math.max(0, Math.floor(ticks / 60));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** One stat line's value text from the status (`-` for a key the status lacks). */
export function statText(line: StatLine, status: StatValues): string {
  const raw = status[line.status];
  if (raw === undefined) return '-';
  const value = line.format === 'time' && typeof raw === 'number' ? formatTicks(raw) : String(raw);
  if (line.of === undefined) return value;
  const of = status[line.of];
  return of === undefined ? value : `${value}/${String(of)}`;
}

/** Rows of `label ... value` text in a box `width` wide from `top`. */
function statRows(
  menus: MenusSpec,
  ctx: MenuBuildContext,
  lines: readonly StatLine[],
  status: StatValues,
  top: number,
  width: number,
): UiWidgetSpec[] {
  const rh = rowHeight(ctx.fonts, menus.font) + 1;
  const left = Math.floor((ctx.screen.width - width) / 2) + 12;
  const value = menus.style?.focusText ?? DEFAULT_HEADING;
  return lines.flatMap((line, i): UiWidgetSpec[] => [
    { type: 'text', x: left, y: top + i * rh, text: line.label },
    {
      type: 'text',
      x: left,
      y: top + i * rh,
      w: width - 24,
      align: 'right',
      text: statText(line, status),
      color: value,
    },
  ]);
}

/** One level as the level select shows it. */
export interface LevelChoice {
  id: string;
  name: string;
  cleared: boolean;
  locked: boolean;
}

/** The level select's item id for stage `i` (0-based, in play order). */
export function levelItemId(i: number): string {
  return `level-${i}`;
}

/** The stage a level select item id names, or null. */
export function levelItemStage(id: string | number | null | undefined): number | null {
  const m = typeof id === 'string' ? /^level-(\d+)$/.exec(id) : null;
  return m === null ? null : Number(m[1]);
}

/** A level's label in the level select: its name, then the cleared mark. */
export function levelLabel(menus: MenusSpec, level: LevelChoice): string {
  return level.cleared ? `${level.name} ${menus.levels?.mark ?? CLEARED_MARK}` : level.name;
}

/**
 * Which of the game's levels the level select offers (`levels.lock`, default true): the first,
 * and every one whose level before it is cleared; all with `lock: false`.
 */
export function levelChoices(
  menus: MenusSpec,
  levels: readonly { id: string; name: string }[],
  cleared: ReadonlySet<string>,
): LevelChoice[] {
  const lock = menus.levels?.lock ?? true;
  return levels.map((l, i) => ({
    id: l.id,
    name: l.name,
    cleared: cleared.has(l.id),
    locked: lock && i > 0 && !cleared.has(levels[i - 1]!.id),
  }));
}

/** The level select: a framed list of the levels (locked ones greyed out), then Back. */
export function levelsScreen(
  menus: MenusSpec,
  ctx: MenuBuildContext,
  levels: readonly LevelChoice[],
): UiScreenFile {
  const items: UiMenuItemSpec[] = levels.map((l, i) => ({
    id: levelItemId(i),
    label: levelLabel(menus, l),
    ...(l.locked && { disabled: true }),
  }));
  items.push({ id: 'back', label: menuLabel(menus, 'back') });
  const font = ctx.fonts(menus.font);
  const widest = font === null ? 0 : Math.max(...items.map((i) => layoutText(font, i.label).width));
  const title = menus.levels?.heading ?? MENU_HEADINGS.levels;
  const width = headedWidth(menus, ctx, title, Math.min(ctx.screen.width - 8, Math.max(140, widest + 48)));
  const widgets = framedScreen(
    menus,
    ctx,
    title,
    menuHeight(ctx, menus, items.length),
    width,
    (top) => [{ id: 'main', type: 'menu', anchor: 'top', y: top, w: width - 20, panel: false, items }],
    Math.max(menus.style?.dim ?? DEFAULT_DIM, 0.7),
  );
  const hint = menuHint(ctx.keys);
  if (hint !== '') widgets.push(hintStrip(menus, ctx, 1), hintWidget(menus, hint));
  return { style: menusUiStyle(menus), focus: 'main', widgets };
}

/**
 * The level-clear banner: the heading and the stat lines from the frame status, in a panel over
 * the game (no dim, no menu: it takes no input and the game's pause goes on under it).
 */
export function clearScreen(menus: MenusSpec, ctx: MenuBuildContext, status: StatValues): UiScreenFile {
  const lines = menus.clear?.lines ?? DEFAULT_STAT_LINES;
  const rh = rowHeight(ctx.fonts, menus.font) + 1;
  const title = menus.clear?.heading ?? MENU_HEADINGS.clear;
  const width = headedWidth(menus, ctx, title, Math.min(ctx.screen.width - 8, 160));
  const widgets = framedScreen(
    menus,
    ctx,
    title,
    Math.max(0, lines.length * rh - 1),
    width,
    (top) => statRows(menus, ctx, lines, status, top, width),
    0,
  );
  return { style: menusUiStyle(menus), widgets };
}

/**
 * The end screen: the heading, the credits line, the stat lines (the page sums them over the
 * levels cleared) and its menu (default Back to title), over the game dimmed.
 */
export function endScreen(
  menus: MenusSpec,
  ctx: MenuBuildContext,
  status: StatValues,
  ending?: Pick<EndTrigger, 'heading' | 'credits' | 'stars'>,
): UiScreenFile {
  const end = {
    ...menus.end,
    ...(ending?.heading !== undefined && { heading: ending.heading }),
    ...(ending?.credits !== undefined && { credits: ending.credits }),
  };
  const stars =
    ending?.stars === false || end.stars === undefined ? null : starRow(menus, ctx, end.stars, status);
  const lines = end.lines ?? DEFAULT_STAT_LINES;
  const items = (end.items ?? ['title']) as EndItem[];
  const rh = rowHeight(ctx.fonts, menus.font) + 1;
  const title = end.heading ?? MENU_HEADINGS.end;
  const width = headedWidth(menus, ctx, title, Math.min(ctx.screen.width - 8, 200));
  const creditsH =
    end.credits === undefined ? 0 : textHeight(ctx.fonts, menus.font, end.credits, width - 24) + 8;
  const starsH = stars === null ? 0 : stars.h + 8;
  const statsH = lines.length * rh;
  const bodyH = creditsH + starsH + statsH + 8 + menuHeight(ctx, menus, items.length);
  const widgets = framedScreen(
    menus,
    ctx,
    title,
    bodyH,
    width,
    (top) => [
      ...(end.credits === undefined
        ? []
        : [
            {
              type: 'text',
              anchor: 'top',
              y: top,
              w: width - 24,
              align: 'center',
              text: end.credits,
            } as UiWidgetSpec,
          ]),
      ...(stars === null ? [] : stars.widgets(top + creditsH)),
      ...statRows(menus, ctx, lines, status, top + creditsH + starsH, width),
      {
        id: 'main',
        type: 'menu',
        anchor: 'top',
        y: top + creditsH + starsH + statsH + 8,
        w: menuWidth(menus, ctx, items, 96),
        panel: false,
        items: buttons(menus, items),
      },
    ],
    Math.max(menus.style?.dim ?? DEFAULT_DIM, 0.7),
  );
  const hint = menuHint(ctx.keys, false, false);
  if (hint !== '') widgets.push(hintStrip(menus, ctx, 1), hintWidget(menus, hint));
  return { style: menusUiStyle(menus), focus: 'main', widgets };
}

/**
 * The stars won (Engine 0.16 E6): the status value as a whole number held to `0..count`, or null
 * when the status lacks it or it is no number (no row is shown).
 */
export function starsWon(stars: Pick<EndStars, 'status' | 'count'>, status: StatValues): number | null {
  const raw = status[stars.status ?? STARS_STATUS];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(stars.count ?? DEFAULT_STAR_COUNT, Math.max(0, Math.round(n)));
}

/**
 * An end screen's star row, centred on the picture: its height and its widgets from a top (image
 * widgets with `sheet`, else texts in the title font; ids `star-0`, ...); null when the status gives no stars.
 */
function starRow(
  menus: MenusSpec,
  ctx: MenuBuildContext,
  stars: EndStars,
  status: StatValues,
): { h: number; widgets: (top: number) => UiWidgetSpec[] } | null {
  const won = starsWon(stars, status);
  if (won === null) return null;
  const count = stars.count ?? DEFAULT_STAR_COUNT;
  const gap = stars.gap ?? DEFAULT_STAR_GAP;
  const scale = stars.scale ?? 1;
  const head = heading(menus);
  const font = ctx.fonts(head.font);
  const size = (star: string): { w: number; h: number } => {
    if (stars.sheet !== undefined) {
      const s = ctx.frameSize(stars.sheet, stars.palette, star);
      return s === null ? { w: 0, h: 0 } : { w: s.w * scale, h: s.h * scale };
    }
    if (font === null) return { w: 0, h: 0 };
    const t = layoutText(font, star);
    return { w: t.width, h: t.height };
  };
  const looks = Array.from({ length: count }, (_, i) => (i < won ? stars.filled : stars.empty));
  const sizes = looks.map(size);
  const h = Math.max(0, ...sizes.map((s) => s.h));
  const total = sizes.reduce((sum, s) => sum + s.w, 0) + gap * (count - 1);
  const W = ctx.screen.width;
  const disabled = menus.style?.disabledText ?? UI_STYLE_DEFAULTS.disabledText;
  return {
    h,
    widgets: (top) => {
      let left = Math.floor(W / 2) - Math.floor(total / 2);
      return looks.map((star, i): UiWidgetSpec => {
        const { w, h: sh } = sizes[i]!;
        // An `anchor: top` widget's `x` is from the centre: its box sits at (W - w) / 2 + x.
        const x = left - Math.floor((W - w) / 2);
        const y = top + Math.floor((h - sh) / 2);
        left += w + gap;
        if (stars.sheet !== undefined)
          return {
            id: `star-${i}`,
            type: 'image',
            anchor: 'top',
            x,
            y,
            sheet: stars.sheet,
            frame: star,
            ...(stars.palette !== undefined && { palette: stars.palette }),
            ...(scale !== 1 && { scale }),
          };
        return {
          id: `star-${i}`,
          type: 'text',
          anchor: 'top',
          x,
          y,
          text: star,
          font: head.font,
          color: i < won ? head.color : disabled,
          outline: head.outline,
        };
      });
    },
  };
}

/** Px between a shell dialog box and the bottom of the picture. */
export const DIALOG_BOTTOM = 6;

/**
 * A shell dialog as a UI screen (Engine 0.16 part C T7): `menus.dialogs.<id>` as the UI kit's
 * dialog widget (id `dialog`) across the bottom of the picture in the menus' style, `lines` of
 * text high (3), or taller so the portrait's frame fits it at 1x. No dim: the game shows above it.
 * Throws on an unknown id (validate reports it first).
 */
export function dialogScreen(menus: MenusSpec, ctx: MenuBuildContext, id: string): UiScreenFile {
  const d = menus.dialogs?.[id];
  if (d === undefined) throw new Error(`menus: no dialog "${id}"`);
  const style = menusUiStyle(menus);
  const look = uiLook(style, ctx.fonts, ctx.frameSize);
  let h = DialogBox.defaultHeight(look, d.lines ?? 3);
  if (d.portrait !== undefined) {
    const size = ctx.frameSize(d.portrait.sheet, d.portrait.palette, d.portrait.frame);
    // The portrait's frame is a square the inner box's height; the sprite needs 4 px of it spare.
    if (size !== null) h = Math.max(h, Math.max(size.w, size.h) + 4 + panelExtra(look).h);
  }
  return {
    style,
    focus: DIALOG_WIDGET,
    widgets: [
      {
        id: DIALOG_WIDGET,
        type: 'dialog',
        anchor: 'bottom',
        y: DIALOG_BOTTOM,
        w: ctx.screen.width - 2 * UI_DIALOG_MARGIN,
        h,
        pages: d.pages,
        ...(d.speaker !== undefined && { speaker: d.speaker }),
        ...(d.portrait !== undefined && { portrait: d.portrait }),
        ...(d.rate !== undefined && { rate: d.rate }),
      },
    ],
  };
}

/** The widget id of a shell dialog's box in `dialogScreen`. */
export const DIALOG_WIDGET = 'dialog';

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
  if (used.has('levels')) {
    add(['levels'], menus.levels?.heading ?? MENU_HEADINGS.levels, head);
    add(['levels'], menus.levels?.mark ?? CLEARED_MARK);
    label(['levels'], 'back');
  }
  const statTexts = (at: FieldPath, lines: readonly StatLine[] | undefined) => {
    (lines ?? DEFAULT_STAT_LINES).forEach((l, i) =>
      add(lines === undefined ? at : [...at, 'lines', i, 'label'], l.label),
    );
    add(at, '0123456789:/-');
  };
  if (menus.clear !== undefined) {
    add(['clear'], menus.clear.heading ?? MENU_HEADINGS.clear, head);
    statTexts(['clear'], menus.clear.lines);
  }
  if (menus.end !== undefined) {
    add(['end'], menus.end.heading ?? MENU_HEADINGS.end, head);
    if (menus.end.credits !== undefined) add(['end', 'credits'], menus.end.credits);
    statTexts(['end'], menus.end.lines);
    const stars = menus.end.stars;
    if (stars !== undefined && stars.sheet === undefined) {
      add(['end', 'stars', 'filled'], stars.filled, head);
      add(['end', 'stars', 'empty'], stars.empty, head);
    }
    (menus.end.items ?? ['title']).forEach((id, i) =>
      label(menus.end?.items ? ['end', 'items', i] : ['end'], id),
    );
  }
  for (const [id, d] of Object.entries(menus.dialogs ?? {})) {
    if (d.speaker !== undefined) add(['dialogs', id, 'speaker'], d.speaker);
    d.pages.forEach((page, i) => add(['dialogs', id, 'pages', i], page));
  }
  (menus.triggers?.end ?? []).forEach((t, i) => {
    if (t.heading !== undefined) add(['triggers', 'end', i, 'heading'], t.heading, head);
    if (t.credits !== undefined) add(['triggers', 'end', i, 'credits'], t.credits);
  });
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
  const stars = menus.end?.stars;
  if (stars?.sheet !== undefined) {
    const at = (field: 'filled' | 'empty') => {
      const sprite = refs.sprites.get(stars.sheet!);
      if (sprite?.frames && !Object.hasOwn(sprite.frames, stars[field]))
        out.push({
          path: ['end', 'stars', field],
          code: 'missing_frame',
          message: `sprite "${stars.sheet}" has no frame "${stars[field]}"`,
        });
    };
    if (!refs.sprites.has(stars.sheet)) missing(['end', 'stars', 'sheet'], 'sprite', stars.sheet);
    else (['filled', 'empty'] as const).forEach(at);
    if (stars.palette !== undefined && !refs.palettes.has(stars.palette))
      missing(['end', 'stars', 'palette'], 'palette', stars.palette);
  }
  if (menus.end?.music !== undefined && !refs.sounds.has(menus.end.music))
    missing(['end', 'music'], 'song', menus.end.music);
  (menus.triggers?.end ?? []).forEach((t, i) => {
    if (t.music !== undefined && !refs.sounds.has(t.music))
      missing(['triggers', 'end', i, 'music'], 'song', t.music);
  });
  for (const [key, id] of Object.entries(menus.style?.sounds ?? {}))
    if (id !== undefined && !refs.sounds.has(id)) missing(['style', 'sounds', key], 'sfx or song', id);
  for (const [id, d] of Object.entries(menus.dialogs ?? {}))
    if (d.portrait !== undefined) frameAt(['dialogs', id, 'portrait'], d.portrait);
  const dialogAt = (path: FieldPath, id: string) => {
    if (menus.dialogs?.[id] === undefined)
      out.push({
        path,
        code: 'missing_ref',
        message: `no dialog "${id}" in menus.dialogs${
          menus.dialogs === undefined ? '' : ` (there are: ${Object.keys(menus.dialogs).join(', ')})`
        }`,
      });
  };
  if (menus.triggers?.intro !== undefined) dialogAt(['triggers', 'intro'], menus.triggers.intro);
  (menus.triggers?.end ?? []).forEach((t, i) => {
    if (t.dialog !== undefined) dialogAt(['triggers', 'end', i, 'dialog'], t.dialog);
    if (menus.end === undefined && (t.heading !== undefined || t.credits !== undefined))
      out.push({
        path: ['triggers', 'end', i],
        code: 'missing_field',
        message: 'an end trigger with a `heading` or `credits` needs the `end` screen',
      });
    else if (menus.end === undefined && t.dialog === undefined)
      out.push({
        path: ['triggers', 'end', i],
        code: 'missing_field',
        message: 'an end trigger shows its `dialog`, the `end` screen or both: give one',
      });
  });
  const wantsControls = [...menus.title.items, ...menus.pause.items].includes('controls');
  if (wantsControls && menus.controls === undefined)
    out.push({
      path: ['controls'],
      code: 'missing_field',
      message: 'a `controls` item needs the `controls` list (actions and what they do)',
    });
  return out;
}
