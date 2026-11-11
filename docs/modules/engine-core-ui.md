# engine/core/ui

Folder: `engine/core/ui` (part of `engine/core`). Detailed rules:
[`engine/core/ui/CLAUDE.md`](../../engine/core/ui/CLAUDE.md).

## Purpose

The UI kit, part 1 (Engine 0.16 T6): bitmap pixel fonts as text content (the `font` kind: one-bit
glyph grids with a baseline, advance and kerning), text layout (wrapping, alignment, colour,
shadow, outline), nine-slice panels from a sprite frame, and the HUD widgets a skin's `hud`
declares: `bar`, `counter`, `panel`, `minimap`, and `text` / `number` in a font file, beside the
classic `hearts` and `icon`. Layout is pure and shared by both backends; each backend paints the
result through a small `UiPainter`. The engine ships no font: each game draws its own.

Part 2 (Engine 0.16 T7): interactive UI from text. The `ui` content kind is a screen: a style
(font, colours, a nine-slice panel frame, a cursor, sounds, focus and press tweens) and widgets
placed by anchors: panels, text, buttons, menus (vertical or horizontal, with sliders, toggles
and disabled items, focus wrapping) and dialog boxes (a speaker, a portrait, text typed at a set
rate with skip, page breaks, a choice list). `UiScreen` runs one per display frame from
commands (keyboard and gamepad through the engine's actions) and the pointer's hover and taps
(mouse and touch, hit-tested in picture pixels); the shell's `UiScene` puts it on the scene
stack. Its state is presentation only.

Engine 0.16 T9: an `image` widget (a sprite frame at a whole-number `scale`), a slider's
`labels` (a choice shown as `< Auto >` that a tap or confirm steps on), and `menus.ts`: the
`menus` block of `game.json` (`menusSchema`: `font`, `titleFont?`, `style?` (UI style fields plus
`heading`, `outline`, `dim`, `dimColor`), `labels?`, `title { name | logo, subtitle?, art?, dim?,
music?, footer?, items }`, `pause { items }`, `settings? { items }`, `controls?`) and the four
screens built from it as `ui` files (`titleScreen`, `pauseScreen`, `settingsScreen`,
`controlsScreen`), which the shell's `GameMenus` runs. Items: title `start`, `continue`,
`controls`, `settings`; pause `resume`, `controls`, `settings`, `title`; settings `master`,
`music`, `sfx`, `mute`, `shake`, `flashing`, `colour`, `touch`.

## Public API entry points

Import from `@engine/core/ui` (`index.ts`).

- Fonts: `FONT_KIND`, `fontSchema`, `readFontText`, `buildFont`, `Font`, `FontLookup`,
  `contentFonts(content)`, `missingGlyphs`, `glyphRuns`.
- Text: `layoutText(font, text, { width?, align?, line? })`, `measureLine`, `textDraws`.
- Panels: `nineSlice(frame, insets, box, fill?)`, `sliceInsets`, `panelDraws`.
- Drawing contract: `UiDraw` (`UiFill`, `UiImage`, `UiGlyph`), `UiPainter`, `paintUi`.
- Widgets: `barRatio`, `barFill`, `CounterRoll`, `minimapDraws`, `minimapScale`, `SkinHud`
  (`usesUi`, `layout(input)`), `hudValueText`. Engine 0.16 F7: a `panel` item with a `color`
  and no `frame` is a flat box (`alpha`, `border`), and any HUD item's `when` (`{ status, eq?,
ne?, lt?, lte?, gt?, gte? }`, the mixer's status test) draws it only while the test holds
  (`hudItemShown` in `@engine/core/present`, so classic items honour it too).
- World labels (T12): `layoutLabels(labels, entity, status, project, fonts?, picture?)` ->
  `{ draws, views }`, `LabelView`, `LabelProject`, `DEFAULT_LABEL_BAR`, `DEFAULT_LABEL_OFFSET`,
  `LABEL_GAP`; from Engine 0.16 polish P6 (gap M45) a `picture` size moves an entity's labels
  inside the picture as one box (`clampBoxInside` in `@engine/core/present`).

- Menus (T9): `menusSchema`, `TITLE_ITEMS`, `PAUSE_ITEMS`, `SETTINGS_ITEMS`, `MENU_LABELS`,
  `titleScreen`, `pauseScreen`, `settingsScreen`, `controlsScreen`, `controlRows`, `menuHint`,
  `checkMenus` (run by `loadContent` on `game.json`: `unknown_menu_item`, `missing_ref`,
  `missing_frame`, `missing_glyph`, `missing_field`), `sliderText`. Engine 0.16 part B: the
  title item `levels`, `END_ITEMS`, the `levels`, `clear` and `end` blocks, `levelsScreen`,
  `clearScreen`, `endScreen`, `levelChoices`, `levelItemId`, `levelItemStage`, stat lines
  (`statText`, `formatTicks`, `STAT_FORMATS`, `DEFAULT_STAT_LINES`). Engine 0.16 part C T7:
  `dialogs` (by id: `speaker?`, `portrait?`, `pages`, `rate?`, `lines?`) and `triggers`
  (`intro`, `end: [{ when, dialog?, heading?, credits? }]`), `dialogScreen(spec, ctx, id)` (the
  box across the bottom, widget `DIALOG_WIDGET`, `DIALOG_BOTTOM` px up, tall enough for its
  portrait), `endScreen`'s optional end trigger (its heading and credits), `MenuDialog`,
  `EndTrigger`; `checkMenus` checks portraits, page and speaker glyphs and trigger ids.
- UI screens (T7): `UI_KIND`, `uiScreenSchema`, `checkUiWidgets`, `checkUiRefs`, `UiScreen`
  (`update(input)`, `draws()`, `open`, `close`, `focused`, `value`, `itemBox`), `Menu`, `Button`,
  `DialogBox`, `UiNav` (commands from actions with repeat), `UiInput`, `UiEvent`, `uiLook`,
  `tweenDraws`, `anchorBox`; the shell's `UiScene` (`@engine/core/shell`).

A screen (from `games/fx-lab/content/ui/lab.json`, shortened):

    { "style": { "font": "fx-small", "cursor": ">", "panel": { "sheet": "fx", "frame": "hud-panel", "slice": 2 },
        "sounds": { "move": "ui-move", "select": "ui-select" } },
      "focus": "main",
      "widgets": [
        { "id": "main", "type": "menu", "anchor": "center", "items": [
          { "id": "resume", "label": "Resume" },
          { "id": "talk", "label": "Talk to Pip", "opens": "talk" },
          { "type": "slider", "id": "volume", "label": "Volume", "min": 0, "max": 10, "value": 7 },
          { "type": "toggle", "id": "shake", "label": "Screen shake", "value": true } ] },
        { "id": "talk", "type": "dialog", "hidden": true, "speaker": "Pip",
          "portrait": { "sheet": "fx", "frame": "pip-idle-0" }, "pages": ["Hi!", "Shall we go?"],
          "choices": [{ "id": "yes", "label": "Let's go!" }, { "id": "later", "label": "Not yet", "next": "main" }] } ] }

`pnpm cli validate` reports a widget reference that names no widget (`unknown_widget` at
`focus`, `widgets.<i>.items.<j>.opens` or `widgets.<i>.choices.<j>.next`), and missing fonts,
glyphs, sounds and frames at their fields. From T9 both backends draw UI screens: the 3D
display paints them as an overlay pass after the frame (`ThreePresenter.ui(draws)`).

A skin's HUD with widgets (from `games/fx-lab/content/skins/canvas2d.json`):

    { "status": "hp", "as": "bar", "x": 30, "y": 9, "w": 56, "h": 8, "max": "maxHp",
      "color": "#00a800", "back": "#000000", "low": { "below": 0.34, "color": "#d82800" },
      "panel": { "frame": "bar-frame", "slice": 2 } },
    { "status": "coins", "as": "counter", "x": 10, "y": 22, "frame": "hud-coin", "font": "fx-small",
      "digits": 2, "color": "#f8b800", "shadow": "#000000", "tween": { "ticks": 24, "color": "#fcfcfc" } },
    { "as": "minimap", "x": 170, "y": 18, "w": 80, "h": 30, "scale": 2, "back": "#005858",
      "tiles": { "#": "#00a800" }, "dots": [{ "kind": "runner", "color": "#fcfcfc", "size": 3 }] }

From Engine 0.16 F4 the `clock` widget shows the world clock (`clockStatus` on the frame): its
text through a `format` with `{day}`, `{time}`, `{phase}` and `{text}` at the top of its box and a
day bar with coloured bands, tick marks and a marker at the time now along the bottom
(`clockHudText`, `dayBarDraws`):

    { "as": "clock", "x": 63, "y": 4, "w": 130, "h": 15, "font": "fx-small",
      "format": "Day {day} {time} {phase}", "outline": "#000000",
      "dayBar": { "h": 3, "bands": [{ "hour": 5, "color": "#f0a070" }, { "hour": 7, "color": "#88c8f0" },
        { "hour": 19.5, "color": "#a05848" }, { "hour": 21, "color": "#101830" }], "marks": [6, 12, 18] } }

Backends take the fonts as `fonts` (`SkinnedCanvasPresenter`, `canvasDisplay`,
`skinSetCanvasPresenter`, `ThreeScene`, `ThreePresenter`, `threeDisplay`, `threeScenePresenter`);
`pnpm cli validate` reports `missing_glyph` at the skin file and field for HUD text a font lacks.

## Imports allowed

`zod` and pure core files (`engine/core/present`, `engine/core/fx`, `engine/core/content`; types
from `engine/core/input/actions`).
On `PURE_CORE`. Kits and `engine/sim` may not import it (`FORBIDDEN_CORE`): kits never draw.

## How to test

`pnpm test engine/core/ui engine/core/shell/ui-scene.test.ts engine/core/shell/game-menus.test.ts engine/backends/canvas2d/ui-painter.test.ts engine/backends/three/hud.test.ts engine/tools/missing-glyph.test.ts games/fx-lab`;
`pnpm test tests/browser/menus.test.ts` opens every game's title, pause and settings screens by
keyboard and touch (`WW_SHOTS_DIR=<folder>` keeps `menus-<game>-*.png`);
`pnpm test tests/browser/fx-lab-ui.test.ts` drives the fx lab's menu and dialog by keyboard, mouse and
touch (`WW_SHOTS_DIR=<folder>` keeps its screenshots);
look at the fx lab's HUD with `pnpm -s cli screenshot games/fx-lab/runs/level-1.run.json --tick 300 --json`
(add `--backend three --allow-software-gl` for 3D).
