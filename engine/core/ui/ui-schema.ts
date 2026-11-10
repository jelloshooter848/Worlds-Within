import { z } from 'zod';
import type { ContentKind, ContentLookup, KindIssue } from '../content/kinds';
import type { FieldPath } from '../content/validate';
import { tweensSchema } from '../fx/schema';
import { missingGlyphs, type FontFile } from './font';

/**
 * UI screens as text (Engine 0.16 T7): the `ui` content kind. A screen is a style and a list of
 * widgets placed by anchors, so a title screen, a pause menu or a dialog is a JSON file a game
 * writes, never code:
 *
 *   { "style": { "font": "small", "sounds": { "move": "tick" } }, "focus": "main",
 *     "widgets": [
 *       { "id": "main", "type": "menu", "anchor": "center", "w": 120,
 *         "items": [{ "id": "start", "label": "Start" }, { "id": "talk", "label": "Talk", "opens": "intro" }] },
 *       { "id": "intro", "type": "dialog", "hidden": true, "speaker": "Pip", "pages": ["Hello!"] } ] }
 *
 * `UiScreen` (`screen.ts`) runs one; the kind's cross-file check (`checkUiRefs`) reports a widget,
 * font, sound or sprite frame the screen names that is not there, at its field.
 */

const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is #rgb or #rrggbb',
});

/** Where a widget sits on the picture: one of nine anchors, its offsets measured inward. */
export const UI_ANCHORS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;
export type UiAnchor = (typeof UI_ANCHORS)[number];

/** The widget types a screen may hold. */
export const UI_WIDGET_TYPES = ['panel', 'text', 'button', 'menu', 'dialog'] as const;

/** A sprite frame: a sheet (a sprite file), its frame, and an optional palette. */
const spriteRef = z.strictObject({
  sheet: z.string().min(1).describe('a sprite file of the game'),
  frame: z.string().min(1).describe('a frame of that sheet'),
  palette: z.string().min(1).exactOptional().describe('a palette file to recolour it with'),
});

/** A nine-slice panel frame. */
const panelFrame = spriteRef
  .extend({
    slice: z
      .union([
        z.number().int().min(0),
        z.strictObject({
          left: z.number().int().min(0),
          top: z.number().int().min(0),
          right: z.number().int().min(0),
          bottom: z.number().int().min(0),
        }),
      ])
      .describe('the corner insets in px: one number or `{ left, top, right, bottom }`'),
  })
  .describe('a nine-slice panel: `{ sheet, frame, palette?, slice }`');

const sounds = z
  .strictObject({
    move: z.string().min(1).exactOptional().describe('focus moved or a value changed'),
    select: z.string().min(1).exactOptional().describe('an item or a choice taken'),
    back: z.string().min(1).exactOptional().describe('back out of a widget'),
    type: z.string().min(1).exactOptional().describe('a dialog typing (every `typeEvery` characters)'),
    page: z.string().min(1).exactOptional().describe('a dialog turning to its next page'),
  })
  .describe('sfx ids played by the shell on UI events (each optional)');

/** What a screen looks like when its widgets leave a field out. */
export const UI_STYLE_DEFAULTS = {
  text: '#fcfcfc',
  focusText: '#f8b800',
  disabledText: '#7c7c7c',
  back: '#000000',
  focusBack: '#24188c',
  border: '#fcfcfc',
  track: '#3c3c3c',
  fill: '#00a800',
  padding: 4,
  gap: 2,
  rate: 2,
  typeEvery: 3,
} as const;

export const uiStyleSchema = z
  .strictObject({
    font: z.string().min(1).describe('the font file text is drawn in'),
    text: hex.exactOptional().describe(`text colour (default \`${UI_STYLE_DEFAULTS.text}\`)`),
    shadow: hex.exactOptional().describe('a one-px drop shadow under text'),
    focusText: hex
      .exactOptional()
      .describe(`the focused item's text (default \`${UI_STYLE_DEFAULTS.focusText}\`)`),
    disabledText: hex
      .exactOptional()
      .describe(`a disabled item's text (default \`${UI_STYLE_DEFAULTS.disabledText}\`)`),
    back: hex
      .exactOptional()
      .describe(`a panel's fill without a frame (default \`${UI_STYLE_DEFAULTS.back}\`)`),
    focusBack: hex
      .exactOptional()
      .describe(`the bar behind the focused item (default \`${UI_STYLE_DEFAULTS.focusBack}\`)`),
    border: hex
      .exactOptional()
      .describe(`a frameless panel's one-px border (default \`${UI_STYLE_DEFAULTS.border}\`)`),
    track: hex.exactOptional().describe(`a slider's empty track (default \`${UI_STYLE_DEFAULTS.track}\`)`),
    fill: hex
      .exactOptional()
      .describe(`a slider's fill and a toggle's on box (default \`${UI_STYLE_DEFAULTS.fill}\`)`),
    panel: panelFrame.exactOptional().describe('the nine-slice frame panels, menus and dialogs are drawn in'),
    cursor: z.string().length(1).exactOptional().describe('a character drawn left of the focused item (`>`)'),
    padding: z.number().int().min(0).exactOptional().describe('px inside a panel (default 4)'),
    gap: z.number().int().min(0).exactOptional().describe('px between menu items (default 2)'),
    rate: z
      .number()
      .min(0)
      .exactOptional()
      .describe('display frames per character a dialog types (default 2; 0 shows a page at once)'),
    typeEvery: z.number().int().min(1).exactOptional().describe('characters per `type` sound (default 3)'),
    sounds: sounds.exactOptional(),
    focusTween: tweensSchema
      .exactOptional()
      .describe('played on an item when it takes the focus (T1 tween specs)'),
    pressTween: tweensSchema.exactOptional().describe('played on an item when it is pressed'),
  })
  .describe('how a screen looks and sounds');

const placement = {
  id: z
    .string()
    .min(1)
    .exactOptional()
    .describe('the widget id other fields name (`focus`, `opens`, `next`)'),
  anchor: z
    .enum(UI_ANCHORS)
    .exactOptional()
    .describe(`where it sits (default \`top-left\`): ${UI_ANCHORS.join(', ')}`),
  x: z.number().int().exactOptional().describe('px inward from the anchor, horizontally (0)'),
  y: z.number().int().exactOptional().describe('px inward from the anchor, vertically (0)'),
  w: z.number().int().min(1).exactOptional().describe('width in px (each type has its own default)'),
  h: z.number().int().min(1).exactOptional().describe('height in px (each type has its own default)'),
  hidden: z.boolean().exactOptional().describe('starts hidden; shown when an item `opens` it'),
};

const itemBase = {
  id: z.string().min(1).describe('the item id events carry'),
  label: z.string().describe('its text'),
  disabled: z.boolean().exactOptional().describe('shown greyed, skipped by focus, never taken'),
};

const menuItem = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('button').exactOptional().describe('a button (the default)'),
    ...itemBase,
    opens: z.string().min(1).exactOptional().describe('a widget id shown and focused when it is taken'),
  }),
  z.strictObject({
    type: z.literal('slider'),
    ...itemBase,
    min: z.number().exactOptional().describe('lowest value (0)'),
    max: z.number().exactOptional().describe('highest value (10)'),
    step: z.number().positive().exactOptional().describe('change per press (1)'),
    value: z.number().exactOptional().describe('the start value (min)'),
  }),
  z.strictObject({
    type: z.literal('toggle'),
    ...itemBase,
    value: z.boolean().exactOptional().describe('the start value (false)'),
  }),
]);

const choice = z.strictObject({
  id: z.string().min(1).describe('the choice id the `choice` event carries'),
  label: z.string().describe('its text'),
  next: z.string().min(1).exactOptional().describe('a widget id shown and focused after it'),
});

const widget = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('panel'),
    ...placement,
    color: hex.exactOptional().describe('a flat fill instead of the style panel'),
    alpha: z.number().min(0).max(1).exactOptional().describe("the fill's opacity (1)"),
  }),
  z.strictObject({
    type: z.literal('text'),
    ...placement,
    text: z.string().describe('the text (`\\n` breaks lines; wraps at `w`)'),
    font: z.string().min(1).exactOptional().describe("a font file (the style's)"),
    color: hex.exactOptional(),
    shadow: hex.exactOptional(),
    outline: hex.exactOptional(),
    align: z.enum(['left', 'center', 'right']).exactOptional().describe('inside `w` (left)'),
  }),
  z.strictObject({
    type: z.literal('button'),
    ...placement,
    label: z.string(),
    disabled: z.boolean().exactOptional(),
    opens: z.string().min(1).exactOptional().describe('a widget id shown and focused when it is pressed'),
  }),
  z.strictObject({
    type: z.literal('menu'),
    ...placement,
    direction: z
      .enum(['vertical', 'horizontal'])
      .exactOptional()
      .describe('how items are laid out (vertical)'),
    wrap: z.boolean().exactOptional().describe('focus wraps from the last item to the first (true)'),
    panel: z.boolean().exactOptional().describe('drawn on a panel (true)'),
    items: z.array(menuItem).min(1).describe('buttons, sliders and toggles'),
  }),
  z.strictObject({
    type: z.literal('dialog'),
    ...placement,
    speaker: z.string().exactOptional().describe("the speaker's name, on a tab over the box"),
    portrait: spriteRef.exactOptional().describe('a sprite frame shown in a frame at the left'),
    pages: z
      .array(z.string())
      .min(1)
      .describe('the text, page by page; a page too long for the box breaks into more pages'),
    rate: z.number().min(0).exactOptional().describe("frames per character (the style's)"),
    choices: z.array(choice).min(1).exactOptional().describe('a choice list after the last page'),
    next: z.string().min(1).exactOptional().describe('a widget id focused once it is done (no choices)'),
  }),
]);

export const uiScreenSchema = z
  .strictObject({
    style: uiStyleSchema,
    focus: z
      .string()
      .min(1)
      .exactOptional()
      .describe('the widget id focused first (the first menu, dialog or button)'),
    back: z.string().min(1).exactOptional().describe('the sfx played when `back` leaves the screen itself'),
    widgets: z.array(widget).min(1).describe('drawn in order, later ones on top'),
  })
  .describe('a UI screen: a style and its widgets');

export type UiScreenFile = z.output<typeof uiScreenSchema>;
export type UiStyle = z.output<typeof uiStyleSchema>;
export type UiWidgetSpec = z.output<typeof widget>;
export type UiMenuSpec = Extract<UiWidgetSpec, { type: 'menu' }>;
export type UiDialogSpec = Extract<UiWidgetSpec, { type: 'dialog' }>;
export type UiButtonSpec = Extract<UiWidgetSpec, { type: 'button' }>;
export type UiMenuItemSpec = z.output<typeof menuItem>;
export type UiChoiceSpec = z.output<typeof choice>;
export type UiSpriteRef = z.output<typeof spriteRef>;
export type UiPanelFrame = z.output<typeof panelFrame>;

/**
 * Inside one screen: widget ids given twice (`duplicate_widget`), and a `focus`, `opens` or
 * `next` naming no widget of the screen (`unknown_widget`), each at its field.
 */
export function checkUiWidgets(screen: UiScreenFile): { path: FieldPath; code: string; message: string }[] {
  const out: { path: FieldPath; code: string; message: string }[] = [];
  const ids = new Set<string>();
  screen.widgets.forEach((w, i) => {
    if (w.id === undefined) return;
    if (ids.has(w.id))
      out.push({
        path: ['widgets', i, 'id'],
        code: 'duplicate_widget',
        message: `widget id "${w.id}" is given twice`,
      });
    ids.add(w.id);
  });
  const ref = (path: FieldPath, id: string | undefined) => {
    if (id !== undefined && !ids.has(id)) {
      const known = [...ids].map((k) => `"${k}"`).join(', ') || 'none';
      out.push({ path, code: 'unknown_widget', message: `no widget "${id}" in this screen (ids: ${known})` });
    }
  };
  ref(['focus'], screen.focus);
  screen.widgets.forEach((w, i) => {
    if (w.type === 'button') ref(['widgets', i, 'opens'], w.opens);
    if (w.type === 'menu')
      w.items.forEach((item, j) => {
        if (item.type === undefined || item.type === 'button')
          ref(['widgets', i, 'items', j, 'opens'], item.opens);
      });
    if (w.type === 'dialog') {
      ref(['widgets', i, 'next'], w.next);
      (w.choices ?? []).forEach((c, j) => ref(['widgets', i, 'choices', j, 'next'], c.next));
    }
  });
  return out;
}

/** Every text a screen draws in a font, with its field and the font it uses. */
function screenTexts(screen: UiScreenFile): { path: FieldPath; text: string; font: string }[] {
  const font = screen.style.font;
  const out: { path: FieldPath; text: string; font: string }[] = [];
  const add = (path: FieldPath, text: string, f = font) => out.push({ path, text, font: f });
  if (screen.style.cursor !== undefined) add(['style', 'cursor'], screen.style.cursor);
  screen.widgets.forEach((w, i) => {
    const at: FieldPath = ['widgets', i];
    if (w.type === 'text') add([...at, 'text'], w.text, w.font ?? font);
    if (w.type === 'button') add([...at, 'label'], w.label);
    if (w.type === 'menu') {
      w.items.forEach((item, j) => add([...at, 'items', j, 'label'], item.label));
      if (w.items.some((it) => it.type === 'slider')) add([...at, 'items'], '0123456789');
      if (w.items.some((it) => it.type === 'toggle')) add([...at, 'items'], 'OnOf');
    }
    if (w.type === 'dialog') {
      if (w.speaker !== undefined) add([...at, 'speaker'], w.speaker);
      w.pages.forEach((p, j) => add([...at, 'pages', j], p));
      (w.choices ?? []).forEach((c, j) => add([...at, 'choices', j, 'label'], c.label));
    }
  });
  return out;
}

/**
 * The cross-file checks of one screen: the widget references (`checkUiWidgets`), every font a
 * missing font file (`missing_ref`) and every text character it lacks (`missing_glyph`), every
 * sound a missing sfx or song (`missing_ref`), and every sprite frame (`style.panel`, a dialog's
 * `portrait`) a missing sprite or palette (`missing_ref`) or frame (`missing_frame`).
 */
export function checkUiRefs(name: string, screen: UiScreenFile, others: ContentLookup): KindIssue[] {
  const issues: KindIssue[] = checkUiWidgets(screen).map((p) => ({ name, ...p }));
  const fonts = new Map(others('font').map((e) => [e.name, e.value as FontFile]));
  const sprites = new Map(
    others('sprite').map((e) => [e.name, e.value as { frames?: Record<string, unknown> }]),
  );
  const palettes = new Set(others('palette').map((e) => e.name));
  const sfx = new Set([...others('sfx'), ...others('song')].map((e) => e.name));
  const missing = (path: FieldPath, what: string, ref: string) =>
    issues.push({ name, path, code: 'missing_ref', message: `no ${what} "${ref}" in the game` });

  const fontAt = (path: FieldPath, id: string) => {
    if (!fonts.has(id)) missing(path, 'font', id);
  };
  fontAt(['style', 'font'], screen.style.font);
  screen.widgets.forEach((w, i) => {
    if (w.type === 'text' && w.font !== undefined) fontAt(['widgets', i, 'font'], w.font);
  });
  for (const { path, text, font } of screenTexts(screen)) {
    const file = fonts.get(font);
    if (file === undefined) continue;
    const lacks = missingGlyphs(new Set(Object.keys(file.glyphs)), text);
    if (lacks.length > 0)
      issues.push({
        name,
        path,
        code: 'missing_glyph',
        message: `font "${font}" has no glyph for ${lacks.map((c) => JSON.stringify(c)).join(', ')}`,
      });
  }
  for (const [key, id] of Object.entries(screen.style.sounds ?? {}))
    if (id !== undefined && !sfx.has(id)) missing(['style', 'sounds', key], 'sfx or song', id);
  if (screen.back !== undefined && !sfx.has(screen.back)) missing(['back'], 'sfx or song', screen.back);

  const frameAt = (path: FieldPath, ref: UiSpriteRef) => {
    const sprite = sprites.get(ref.sheet);
    if (sprite === undefined) missing([...path, 'sheet'], 'sprite', ref.sheet);
    else if (sprite.frames && !Object.hasOwn(sprite.frames, ref.frame))
      issues.push({
        name,
        path: [...path, 'frame'],
        code: 'missing_frame',
        message: `sprite "${ref.sheet}" has no frame "${ref.frame}"`,
      });
    if (ref.palette !== undefined && !palettes.has(ref.palette))
      missing([...path, 'palette'], 'palette', ref.palette);
  };
  if (screen.style.panel !== undefined) frameAt(['style', 'panel'], screen.style.panel);
  screen.widgets.forEach((w, i) => {
    if (w.type === 'dialog' && w.portrait !== undefined) frameAt(['widgets', i, 'portrait'], w.portrait);
  });
  return issues;
}

/** The `ui` content kind (`content/ui/*.json`), registered in `content/engine-kinds.ts`. */
export const UI_KIND = {
  name: 'ui',
  description:
    'A UI screen: a style (font, colours, panel frame, sounds, focus and press tweens) and widgets placed by anchors: panels, text, buttons, menus with sliders and toggles, and dialog boxes',
  schema: uiScreenSchema,
  checkAll: (entries, others) => entries.flatMap((e) => checkUiRefs(e.name, e.value, others)),
} satisfies ContentKind<typeof uiScreenSchema>;
