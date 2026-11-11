# engine/core/ui

The UI kit, part 1 (Engine 0.16 part A, T6): bitmap pixel fonts as text content, text layout,
nine-slice panels and the HUD widgets a skin declares (bars, counters, icons, text, minimaps).
Layout and text maths are pure and shared by every backend; drawing goes through a small
`UiPainter` interface that each backend implements (`CanvasUiPainter` in
`engine/backends/canvas2d`, the quads of `HudLayer` in `engine/backends/three`). Part 2 (T7) adds
buttons, menus, dialog boxes and UI screens written as text (the `ui` content kind), driven by
input from every device: keyboard and gamepad through the engine's actions, mouse hover, clicks
and touch taps through hit-tests in picture pixels.

## Files

- `font.ts`: the `font` content kind (`FONT_KIND`, registered in `content/engine-kinds.ts`).
  `fontSchema`: `{ cell: { w, h }, baseline, spacing? (1), space? (half the cell, rounded up),
line? (cell h + 2), glyphs: { <char>: { rows, advance? } }, kerning?: { <pair>: px } }`; rows are
  one-bit (`#` ink, `.` clear; colour is chosen when drawing), exactly `cell.h` of them, all one
  width, at most `cell.w` (proportional fonts: a glyph's advance is its width + `spacing` unless it
  gives one). The text form (`readFontText`; directives `cell`, `baseline`, `spacing`, `space`,
  `line`, `kern <pair> <n>`, `glyph <char> [advance <n>]`, then the rows; `;` comments) is the
  usual way to write one; errors name the field and line. Codes: `bad_font` (baseline below the
  cell), `bad_glyph` (not one character, wrong row count, wider than the cell), `ragged_row`,
  `bad_kerning` (a key that is not two characters), and the reader's `duplicate_glyph`,
  `row_outside_glyph`, `bad_directive`, `unknown_directive`. `buildFont(id, file)` gives a `Font`
  (defaults filled, each glyph's ink as `GlyphRun`s, `glyphRuns`); `FontLookup` is `(id) => Font |
null`. `textChars`, `missingGlyphs(glyphs, text)` (each character a font lacks, once, spaces and
  line breaks ignored).
- `content-fonts.ts`: `contentFonts(content)`, a game's font files as a `FontLookup` by file name
  (built once each). The glue hands it to presenters as `fonts` next to the sheets.
- `text.ts`: `layoutText(font, text, { width?, align?, line? })` -> `{ glyphs: { ch, x, y }[],
lines, width, height, missing }`: `\n` breaks lines; with `width` words wrap at spaces (a word
  longer than the width breaks between characters) and lines align `left`, `center` or `right`
  inside it (without, inside the widest line); kerning pairs are added between characters; a
  missing glyph places nothing, takes a cell's width and is listed. `measureLine`, `TEXT_ALIGNS`.
- `nine-slice.ts`: `nineSlice(frame, insets, box, fill?)` -> `SlicePiece`s (`sx, sy, sw, sh` in
  the frame, `x, y, w, h` on the picture): corners keep their size, edges and the centre `stretch`
  (default) or `tile` (the last copy cut short); a box smaller than its corners shrinks them (the
  first keeps its start, the last its end); empty pieces are dropped. `sliceInsets(n | insets)`.
- `paint.ts`: the draw items, `UiDraw` = `UiFill { x, y, w, h, color, alpha?, missing? }` |
  `UiImage { sheet, palette?, frame, sx, sy, sw, sh, x, y, w, h }` | `UiGlyph { font, ch, x, y,
color }`, the `UiPainter` interface (`fill`, `image`, `glyph`) and `paintUi(draws, painter)`.
  `textDraws(font, text, x, y, { color, shadow?, outline? }, layoutOptions?)` (the shadow one px
  down-right first, then the outline in eight directions, then the text) and `panelDraws(sprite,
frameSize, insets, box, fill?)`. `DEFAULT_TEXT_COLOR` `#fcfcfc`.
- `widgets.ts`: value mapping. `barRatio(value, max)` (clamped, 0 for max <= 0), `barFill(value,
max, width)` (rounded, at least 1 px above 0 and short of full below max); `CounterRoll({ ticks,
ease? })` (`shown(target, clock)`: the first value at once, a new one rolled to from the number
  shown, `ROLL_DEFAULT_EASE` `cubicOut`; `rolling(clock)`); `minimapDraws(spec, map, entities)`
  (the background, tile colours as merged runs, tile `c` spanning `floor(c * scale)` to
  `floor((c + 1) * scale)`, and a dot per entity a `dots` entry matches by kind or tag, kept in
  the box), `minimapScale` (the largest that fits, at most 4), `MINIMAP_DOT` (2).
- `hud.ts`: `SkinHud(skin, { fonts?, font? })`, one per presenter: `usesUi` (any item is the UI
  kit's: a widget type, a text style field, or a `number` / `text` whose font is a font file) and
  `layout({ status, frameSize, map, entities, clock })` -> `UiDraw[]`, in the skin's order.
  Classic items (`hearts`, `icon`, sprite-font `number` / `text`) come from the core `layoutHud`
  unchanged (a missing frame's box is a fill with `missing: true`); `text` / `number` in a font
  file (`format` with `{value}`, `digits`, `color`, `shadow`, `outline`, `w` + `align`); `bar`
  (`max` a number or status key, `color` (default `DEFAULT_BAR_COLOR`), `back`, `low { below,
color }`, a nine-slice `panel` frame whose insets are the inset, else a one-px `border`);
  `counter` (its `frame` icon, `gap` px, then the number in its `font` with its caps centred on the
  icon, rolling over `tween { ticks, ease?, color? }` on the presenter's clock); `panel` (a
  nine-slice of `frame` by `slice`, `fill`); `minimap` (`tiles`, `back`, `dots`, `scale`,
  `border`, from the map the presenter shows). `hudValueText(item, value)`, `borderDraws`.
  From Engine 0.16 part C T3 an item with `when` (a status key) is left out while that value is
  falsy (`hudItemShown`, `@engine/core/present`), and `hearts` with `half` count halves.

Part 2 (Engine 0.16 T7):

- `ui-schema.ts`: the `ui` content kind (`UI_KIND`, registered in `content/engine-kinds.ts`;
  `content/ui/*.json`, claimed under `content.ui`). `uiScreenSchema`: `{ style, focus?, back?,
widgets }`. `style` (`uiStyleSchema`; defaults `UI_STYLE_DEFAULTS`): `font`, colours `text`,
  `shadow?`, `focusText`, `disabledText`, `back`, `focusBack`, `border`, `track`, `fill`, a
  nine-slice `panel { sheet, frame, palette?, slice }` (else a filled box with a one-px border),
  `cursor?` (one character), `padding` (4), `gap` (2), `rate` (display frames per character, 2;
  0 shows a page at once), `typeEvery` (3), `sounds { move?, select?, back?, type?, page? }` (sfx
  ids) and `focusTween` / `pressTween` (T1 tween specs). Widgets (`UI_WIDGET_TYPES`), each with
  `id?`, `anchor?` (`UI_ANCHORS`, nine; default `top-left`; a dialog's `bottom`), `x`/`y`
  (inward from the anchor's sides; from the centre when centred), `w?`/`h?` and `hidden?`:
  `panel` (`color` + `alpha`, else the style panel), `text` (`text`, `font?`, `color?`,
  `shadow?`, `outline?`, `align?` inside `w`), `button` (`label`, `disabled?`, `opens?`),
  `menu` (`direction` vertical/horizontal, `wrap` (true), `panel` (true), `items`: a `button`
  (default type; `opens?`), a `slider` (`min` 0, `max` 10, `step` 1, `value`) or a `toggle`
  (`value`), each with `id`, `label`, `disabled?`) and `dialog` (`speaker?`, `portrait?` a
  sprite frame, `pages`, `rate?`, `choices?` `[{ id, label, next? }]`, `next?`). Checks:
  `checkUiWidgets` (in the schema's cross-file pass and in `UiScreen`'s constructor):
  `duplicate_widget` at `widgets.<i>.id`, `unknown_widget` for a `focus`, `opens` or `next` naming
  no widget of the screen, at its field (`widgets.0.items.1.opens`), naming the ids there are;
  `checkUiRefs` adds `missing_ref` (a font, an sfx or song, a sprite or palette), `missing_frame`
  and `missing_glyph` (any label, page, speaker or text a font lacks; slider digits, `On`/`Off`).
- `ui-input.ts`: `UI_COMMANDS` (`up`, `down`, `left`, `right`, `confirm`, `back`),
  `DEFAULT_UI_KEYS` (arrows; `jump` and `start` confirm; `attack` backs out), `UiNav(keys?)`
  (`commands(frame)`: a press once, a held direction repeating after `UI_REPEAT_DELAY` (18)
  frames every `UI_REPEAT_EVERY` (5); never `confirm` or `back`), `UiInput { commands?, pointer?,
taps? }` (the hover point and taps in picture pixels), `inBox`, and `UiEvent` (`focus`,
  `activate`, `change`, `choice`, `page`, `type`, `skip`, `done`, `open`, `close`, `back`).
- `look.ts`: `uiLook(style, fonts, frameSize)` -> `UiLook` (defaults filled, the font; throws on
  a missing font), `UiFrameSize`, `lookText`, `lookPanel`, `panelContent`, `panelExtra`,
  `panelInset`; `ItemTweens` (a `TweenSet` per item, run on the screen's frames) and
  `tweenDraws(draws, state)` (x/y offsets in whole px, the colour overlay lerped by its amount,
  fills' alpha; scale and turn do not apply). `DEFAULT_FOCUS_TWEEN` (a 3 px slide in),
  `DEFAULT_PRESS_TWEEN` (a 1 px dip and a white flash).
- `menu.ts`: `Menu({ id, items, direction?, wrap?, panel? }, look)`: `size()` (items, gaps,
  panel), `place(box)`, `itemBoxes()`, `itemBox(id)`, `itemAt(p)`, `focused`, `focus(id)`,
  `value(id)` / `setValue(id, v)` (`sliderValue` clamps and snaps to the step),
  `update(input, frame)` -> `UiEvent[]` (the hover first when it moved, then taps, then
  commands), `draws(frame, active?)`. Rows are the font's cell + 2 px; a vertical menu moves with
  up/down and changes with left/right, a horizontal one the other way round; focus skips disabled
  items and wraps unless `wrap: false`; confirm activates a button and flips a toggle; a tap on a
  slider's track (`SLIDER_TRACK`, 32 px, left of its value) sets it from the x. `Button(id, label,
look, disabled?)` is a one-item menu on a panel.
- `dialog.ts`: `DialogBox({ id, speaker?, portrait?, pages, rate?, choices? }, look)`:
  `place(box)` wraps each page to the text box and breaks it into pages of whole lines;
  `restart()`, `page`, `pageCount`, `pageText()`, `shown` (glyphs typed: frames stepped / rate),
  `typed`, `choosing`, `choiceMenu` (a `Menu` over the box's top-right), `done`, `portraitBox()`,
  `textBox()`, `advance()`, `update(input, frame)` (types on; confirm or a tap on the box skips,
  turns or ends; while choosing the list takes the input), `draws(frame)` (the speaker's tab, the
  box, the portrait scaled by whole steps in its frame, the typed glyphs, a blinking more mark).
- `screen.ts`: `UiScreen(file, { screen, fonts, frameSize?, onSound? })`: places every widget
  (`anchorBox`; `UI_PANEL_DEFAULT`, `UI_DIALOG_MARGIN`), focuses `focus` (else the first shown
  menu, button or dialog), and `update(input)` once per display frame: taps go to the topmost
  shown widget under them and focus it (a focused dialog is modal), the hover to menus (one the
  mouse moves onto takes the focus) unless a dialog has it, the commands to the focused widget;
  then the links: `opens` shows and focuses a widget (the one before is kept), `back` there
  closes it and gives the focus back, a choice's or a finished dialog's `next` opens that widget,
  a dialog that ends closes; sounds from the style through `onSound` (each id once per frame).
  `draws()` (shown widgets in file order), `frame`, `focused`, `visible`, `box`, `itemBox`,
  `menu`, `dialog`, `value`, `open`, `close`, `focus`.

Engine 0.16 T9:

- `ui-schema.ts`: an `image` widget (`sheet`, `frame`, `palette?`, `scale?` whole 1-8; its box is
  the frame times the scale; `missing_ref` / `missing_frame` at `widgets.<i>.sheet` / `.frame`)
  and a slider's `labels` (a word per step from `min`: `menu.ts` shows it as a choice, `< Auto >`,
  with no track, `sliderText`; a tap or confirm steps it on, wrapping; sideways stops at the ends).
- `menus.ts`: the `menus` block of `game.json` (`menusSchema`, on the manifest:
  `content/manifest.ts`): `font`, `titleFont?`, `style?` (`menusStyleSchema`: the UI style's
  fields but `font`, plus `heading`, `outline`, `dim` (0.55), `dimColor`), `labels?` (item id to
  label; `MENU_LABELS` otherwise), `title { name | logo, subtitle?, art?: [{ sheet, frame,
palette?, scale?, anchor?, x?, y? }], dim?, music?, footer?, items }`, `pause { items }`,
  `settings? { items }` (default all but `colour`) and `controls?: [{ actions?, label, tap? }]`.
  Items: `TITLE_ITEMS` (`start`, `continue`, `controls`, `settings`), `PAUSE_ITEMS` (`resume`,
  `controls`, `settings`, `title`), `SETTINGS_ITEMS` (`master`, `music`, `sfx`, `mute`, `shake`,
  `flashing`, `colour`, `touch`); an unknown or repeated item (or label key) is
  `unknown_menu_item`, a title without `name` or `logo` and a control without `actions` or `tap`
  `missing_field`. `titleScreen(spec, ctx, { canContinue })`, `pauseScreen`, `settingsScreen(spec,
ctx, values, { colourModes? })` and `controlsScreen` build `ui` files (`UiScreenFile`) laid out
  from the fonts (`MenuBuildContext`: `screen`, `fonts`, `frameSize`, `keys`, the player's key
  names): a dim over the game, headings in the title font with an outline, the `main` menu, a key
  hint (`menuHint`) on a dark strip along the bottom. `controlRows(controls, keys)` writes each
  row's keys (directions together, `←→`; others `Z / X`; `or` the tap) and adds Pause (`ESC /
P`). `checkMenus(spec, refs)` is what `loadContent` runs on `game.json` (`content/bundle.ts`):
  missing fonts, sprites, palettes, songs (or a skin's layered music) and sounds (`missing_ref`),
  frames (`missing_frame`), glyphs of every text the screens draw (`missing_glyph`; with
  `controls`, the key-name characters `KEY_NAME_GLYPHS`, arrows included) and `missing_field` for
  a `controls` item without `controls`. Errors are at `game.json`, `menus.<field>`.

Engine 0.16 part B (T3), in `menus.ts`:

- The title item `levels` (shown only when the page gives levels: `titleScreen`'s `hasLevels`),
  `END_ITEMS` (`title`, `levels`) and three blocks: `levels { heading?, lock?, mark? }`,
  `clear { heading?, lines? }` and `end { heading?, credits?, lines?, items?, music? }` (`music`
  from T9 of part B: a song played when the end screen opens; `missing_ref` like the title's). A stat line is
  `{ label, status, of?, format? }` (`STAT_FORMATS`: `number`, `time`: ticks as `m:ss`,
  `formatTicks`); `statText(line, status)` (`-` for a key the status lacks, `a/b` with `of`);
  `DEFAULT_STAT_LINES` (coins, time, deaths). `levelChoices(spec, levels, cleared)` (locks),
  `levelItemId(i)` / `levelItemStage(id)`, `levelLabel`, `CLEARED_MARK` (`*`).
- `levelsScreen(spec, ctx, choices)` (a framed list, locked levels disabled, then Back),
  `clearScreen(spec, ctx, status)` (a panel with the heading and stat rows, no dim, no menu) and
  `endScreen(spec, ctx, status)` (heading, credits, stats, its menu). From T11 each of the three
  widens its panel (`headedWidth`, up to the picture less 8 px) so its heading in the title font
  fits with 16 px each side: Hopper's Way's end heading ran over the panel's frame. `checkMenus` checks their
  texts' glyphs (headings in the title font; the mark; labels; the digits and `:`, `/`, `-`).
- Tested in `menus.test.ts`; the shell side in `../shell/game-menus.test.ts`.

Engine 0.16 part C (T7), in `menus.ts`:

- `dialogs` (`dialogSchema`, `MenuDialog`; ids lower-case letters, digits and `-`): `{ speaker?,
portrait?: { sheet, frame, palette? } (a sprite file or a skin's PNG image sheet), pages (at
least one), rate? (frames per character, 0-30), lines? (2-8, default 3) }`, and `triggers`:
  `intro?` (a dialog id) and `end?: [{ when, dialog?, heading?, credits?, music? }]` (`music`
  from Engine 0.16 part C T9: that ending's song, played as it opens; `missing_ref` at
  `triggers.end.<i>.music` when it names no song) (`endTriggerSchema`,
  `EndTrigger`; `when` is the audio mixer's `mixWhenSchema`, one status test or a list, read with
  `mixWhenHolds`, the one runtime import from `../audio/mix.ts`, pure). The shell
  (`../shell/game-menus.ts`) shows them; nothing here decides when.
- `dialogScreen(spec, ctx, id)`: a `ui` file with one `dialog` widget (`DIALOG_WIDGET`, `dialog`)
  across the bottom (`DIALOG_BOTTOM`, 6 px up; `UI_DIALOG_MARGIN` each side) in the menus' style
  (`style.sounds.type` / `page` are the typing and page sounds), `lines` lines high or taller so
  the portrait's frame holds the frame at 1x (`uiLook`, `panelExtra`); no dim. Throws on an unknown
  id. `endScreen(spec, ctx, status, ending?)` takes an end trigger's `heading` and `credits` over
  `end`'s.
- `checkMenus`: each portrait (`missing_ref` / `missing_frame` at `dialogs.<id>.portrait.*`), the
  glyphs of every page and speaker (`dialogs.<id>.pages.<i>`, `.speaker`) and of a trigger's
  heading (title font) and credits, a trigger naming no dialog (`missing_ref` at
  `triggers.intro`, `triggers.end.<i>.dialog`), and an end trigger with nothing to show (no
  `dialog` and no `end` screen, or `heading`/`credits` without `end`: `missing_field`).
- Tested in `menus.test.ts` (the dialog screen's box and height, the end trigger's heading, the
  checks through `loadContent`); `../shell/game-menus.test.ts`, `../shell/shell.test.ts`.

Engine 0.16 T12:

- `labels.ts`: world-anchored labels. `layoutLabels(labels, entity, status, project, fonts?)` ->
  `{ draws, views }`: each label of a skin's `labels` entry (`@engine/core/present`'s
  `labelSchema`) with something to show (a `text` label's value or `format`, a `bar`'s number
  through `labelBar`, a `timer`'s ticks through `timerText`) is centred on its anchor's picture
  point (`project(anchor)`, null to hide it: off screen or behind the camera) plus its `offset`
  (default `DEFAULT_LABEL_OFFSET`, 2 px up); labels on one anchor stack in list order away from
  the box (`top` up, `bottom` down, `center` up from the centre) `LABEL_GAP` (1) px apart. Text
  is `textDraws` in the label's font (none without a font) with its caps (`baseline`) as its
  height; a bar is `DEFAULT_LABEL_BAR` (16x3) unless `w`/`h`, with `border`, `back` and the fill
  (`barFill`, `DEFAULT_BAR_COLOR`). Whole picture px. `LabelView { entity, kind, as, text?, bar?,
box }`. The 3D backend paints the draws on its labels layer. Tested in `labels.test.ts`.

The shell's side is `engine/core/shell/ui-scene.ts` (`UiScene`): a screen as a scene, its input
from the frame's actions and taps and the pointer's hover, drawn with the backend's `UiPainter`.

The skin side (the `hud` item schema, `HUD_CLASSIC_TYPES`, `HUD_WIDGET_TYPES`, the `missing_glyph`
check) is in `engine/core/present/skin.ts`: a `format`'s characters must all be in its font file
(`missing_glyph` at `hud.<i>.format`), a number or counter's font must have every digit
(`missing_glyph` at `hud.<i>.font`), and a counter's or styled text's font must be a font or a
sprite file (`missing_ref`). Sprite fonts (the classic 8x8 digits) are not checked for glyphs.

## Rules

- Pure: `engine/core/ui/**` is on `PURE_CORE` (`config/layers.js`). No DOM, clock or
  `Math.random`; import only `zod` and pure core files (`../present`, `../fx` (ease, tweens,
  colours, tween specs), `../content`, `../input/actions`, and from Engine 0.16 part C the status
  tests of `../audio/mix.ts`).
- Presenters only: kits and the sim may not import it (`FORBIDDEN_CORE`); kits report status and
  a skin decides how it shows. Its state (a counter's roll, a menu's focus and values, a dialog's
  page and typing) lives in a presenter or the shell's scene, never in a kit, a frame or a hash.
- Timing is display frames: a screen's clock is the number of `update` calls, so the same input
  gives the same picture (no clock).
- The engine ships no font (content rule): fonts are game content (`games/fx-lab/content/fonts/`).
  Test fonts are tiny and inline in the tests.
- A skin whose `hud` has no UI item draws exactly as before: backends keep their `layoutHud` path
  for it (`SkinHud.usesUi` false).

## Testing

`font.test.ts` (the text form, defaults, ink runs, errors with codes, fields and lines,
`missingGlyphs`), `text.test.ts` (advance, kerning, measuring, line breaks, wrapping, a long word
broken, alignment, missing glyphs, shadow and outline order), `nine-slice.test.ts` (stretch, four
insets, tile, a box smaller than its corners, `panelDraws`), `hud.test.ts` (bar fills, the counter
roll, value text, the minimap's runs and dots, `SkinHud` for classic, mixed, text, bar, counter,
panel and minimap items), `validate.test.ts` (the skin's `missing_glyph` and `missing_ref` checks
and the widgets' field errors through `loadContent`); `engine/tools/missing-glyph.test.ts` runs
`validate` on a copy of the fx lab. Backends: `engine/backends/canvas2d/ui-painter.test.ts`,
`engine/backends/three/hud.test.ts`.

Part 2 (T7): `menu.test.ts` (focus by actions, skipping disabled items and wrapping or not,
sliders and toggles by actions, activate and back, a horizontal menu, slider snapping, hover and
tap hit-tests, a slider set by a tap on its track, `UiNav`'s repeat, the focus bar and slide
tween, the press tween, disabled colour, `Button`), `dialog.test.ts` (the typewriter rate and
`type` events, skip and done, rate 0, pages broken at whole lines, taps on and off the box, the
speaker tab, portrait and more mark, choices by actions and by a tap, restart), `screen.test.ts`
(anchors, focus, `opens` and `back`, a dialog to its choice and `next`, a dialog's end giving the
focus back, taps and hover routed, a modal dialog, draw order, the same picture for the same
input, and the `ui` kind through `loadContent`: a good screen, `unknown_widget` with its path,
duplicate ids, missing fonts, glyphs, sounds and frames, bad fields);
`engine/core/shell/ui-scene.test.ts`; in the browser `tests/browser/fx-lab-ui.test.ts`.

T9: `menus.test.ts` (the four screens from a spec, labels, Continue only with a save, the colour
item only with modes, control rows and hints, the schema's refusals, and `validate`'s errors on
`game.json` through `loadContent`); `menu.test.ts` (a slider with words);
`engine/core/shell/game-menus.test.ts`; in the browser `tests/browser/menus.test.ts`.
