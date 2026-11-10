# engine/core/ui

The UI kit, part 1 (Engine 0.16 part A, T6): bitmap pixel fonts as text content, text layout,
nine-slice panels and the HUD widgets a skin declares (bars, counters, icons, text, minimaps).
Layout and text maths are pure and shared by every backend; drawing goes through a small
`UiPainter` interface that each backend implements (`CanvasUiPainter` in
`engine/backends/canvas2d`, the quads of `HudLayer` in `engine/backends/three`). Part 2 (T7) adds
buttons, menus, dialog boxes and input from every device.

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

The skin side (the `hud` item schema, `HUD_CLASSIC_TYPES`, `HUD_WIDGET_TYPES`, the `missing_glyph`
check) is in `engine/core/present/skin.ts`: a `format`'s characters must all be in its font file
(`missing_glyph` at `hud.<i>.format`), a number or counter's font must have every digit
(`missing_glyph` at `hud.<i>.font`), and a counter's or styled text's font must be a font or a
sprite file (`missing_ref`). Sprite fonts (the classic 8x8 digits) are not checked for glyphs.

## Rules

- Pure: `engine/core/ui/**` is on `PURE_CORE` (`config/layers.js`). No DOM, clock or
  `Math.random`; import only `zod` and pure core files (`../present`, `../fx/ease`, `../content`).
- Presenters only: kits and the sim may not import it (`FORBIDDEN_CORE`); kits report status and
  a skin decides how it shows. Its state (a counter's roll) lives in a presenter, never in a frame
  or a hash.
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
