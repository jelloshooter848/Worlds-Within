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

## Public API entry points

Import from `@engine/core/ui` (`index.ts`).

- Fonts: `FONT_KIND`, `fontSchema`, `readFontText`, `buildFont`, `Font`, `FontLookup`,
  `contentFonts(content)`, `missingGlyphs`, `glyphRuns`.
- Text: `layoutText(font, text, { width?, align?, line? })`, `measureLine`, `textDraws`.
- Panels: `nineSlice(frame, insets, box, fill?)`, `sliceInsets`, `panelDraws`.
- Drawing contract: `UiDraw` (`UiFill`, `UiImage`, `UiGlyph`), `UiPainter`, `paintUi`.
- Widgets: `barRatio`, `barFill`, `CounterRoll`, `minimapDraws`, `minimapScale`, `SkinHud`
  (`usesUi`, `layout(input)`), `hudValueText`.

A skin's HUD with widgets (from `games/fx-lab/content/skins/canvas2d.json`):

    { "status": "hp", "as": "bar", "x": 30, "y": 9, "w": 56, "h": 8, "max": "maxHp",
      "color": "#00a800", "back": "#000000", "low": { "below": 0.34, "color": "#d82800" },
      "panel": { "frame": "bar-frame", "slice": 2 } },
    { "status": "coins", "as": "counter", "x": 10, "y": 22, "frame": "hud-coin", "font": "fx-small",
      "digits": 2, "color": "#f8b800", "shadow": "#000000", "tween": { "ticks": 24, "color": "#fcfcfc" } },
    { "as": "minimap", "x": 170, "y": 18, "w": 80, "h": 30, "scale": 2, "back": "#005858",
      "tiles": { "#": "#00a800" }, "dots": [{ "kind": "runner", "color": "#fcfcfc", "size": 3 }] }

Backends take the fonts as `fonts` (`SkinnedCanvasPresenter`, `canvasDisplay`,
`skinSetCanvasPresenter`, `ThreeScene`, `ThreePresenter`, `threeDisplay`, `threeScenePresenter`);
`pnpm cli validate` reports `missing_glyph` at the skin file and field for HUD text a font lacks.

## Imports allowed

`zod` and pure core files (`engine/core/present`, `engine/core/fx/ease`, `engine/core/content`).
On `PURE_CORE`. Kits and `engine/sim` may not import it (`FORBIDDEN_CORE`): kits never draw.

## How to test

`pnpm test engine/core/ui engine/backends/canvas2d/ui-painter.test.ts engine/backends/three/hud.test.ts engine/tools/missing-glyph.test.ts games/fx-lab`;
look at the fx lab's HUD with `pnpm -s cli screenshot games/fx-lab/runs/level-1.run.json --tick 300 --json`
(add `--backend three --allow-software-gl` for 3D).
