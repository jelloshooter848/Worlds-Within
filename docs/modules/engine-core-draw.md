# engine/core/draw

Folder: `engine/core/draw` (part of `engine/core`). Detailed rules:
[`engine/core/draw/CLAUDE.md`](../../engine/core/draw/CLAUDE.md).

## Purpose

The skinned presenter walk the 2D backends share (Engine 0.16 T13b, item 323): one `Presenter`
that draws any `PresentFrame` through a skin onto any core `Renderer` (events, frame events,
tweens, particles, camera follow and zoom, camera effects, parallax, per-map looks, the map,
tiles, entities and the HUD through the UI kit; from Engine 0.16 F8 top-down looks: frames turned
to the facing, range rings, silhouette hit flashes and world-anchored labels such as health bars,
kept inside the picture from Engine 0.16 polish P6). Canvas2D's `SkinnedCanvasPresenter` and the
PixiJS presenter are thin wrappers that supply a renderer and surfaces, so both draw every
feature through exactly the same code. It lives in its own core folder, not in `present/`
(which kits import), so the dependency table can keep kits and the sim off it whole.

## Public API entry points

Import from `@engine/core/draw` (`index.ts`).

- `SkinnedPresenter(renderer, skin, sheets, opts?)`, `SkinnedPresenterOptions`: the shared walk;
  `resize`, `effectSettings`, `focus()`, `particleCount`. Options as Canvas2D's presenter, with
  `mapSurface` and `glyphSurface` defaulting to none (tiles and glyph ink runs drawn each frame).
- `DrawSurface`, `MapSurface`, `GlyphSurface`, `SurfaceFactory`: `(w, h) => { renderer, image }`
  or null, where `image` is the opaque handle the main renderer draws as a sheet's `image`.
- `RendererUiPainter(renderer, sheets, fonts, { glyphSurface? })`: the UI kit's `UiPainter` on a
  `Renderer`.
- `skinSetPresenter(opts, make)`, `SkinSetPresenterOptions`, `SkinPresenterFactory`,
  `SkinSetPresenter`: one presenter over a game's skin and a skin per mini game.

## Imports allowed

- Other `engine/core` modules only; never backends, `engine/sim`, tools, kits or games; no DOM.
- Kits and `engine/sim` may not import it (`FORBIDDEN_CORE` in `config/layers.js`); it is on
  `PURE_CORE`.

## How to test

`pnpm test`: `engine/core/draw/draw.test.ts` (surfaces off and on, the skin set's factory) and,
for the whole walk, Canvas2D's `presenter.test.ts`, `ui-painter.test.ts`, `rts-camera.test.ts`
and `display.test.ts`, plus `tests/runs/presentation-invariance.test.ts` and
`tests/runs/stepped-shell-invariance.test.ts`.
