# engine/core/draw

Folder: `engine/core/draw` (part of `engine/core`). Detailed rules:
[`engine/core/draw/CLAUDE.md`](../../engine/core/draw/CLAUDE.md).

## Purpose

The skinned presenter walk the 2D backends share (Engine 0.16 T13b, item 323): one `Presenter`
that draws any `PresentFrame` through a skin onto any core `Renderer` (events, frame events,
tweens, particles, camera follow and zoom, camera effects, parallax, per-map looks, the map,
tiles, entities, from Engine 0.16 F8 top-down looks (frames turned to the facing, range rings,
silhouette hit flashes and world-anchored labels such as health bars, kept inside the picture
from Engine 0.16 polish P6), from Engine 0.16 part D
(D3) a frame's `fog` (after the entities, particles, lighting and labels, under effects and the
HUD; none without it) and the HUD through the UI kit, its minimap given the frame's fog and the
camera's view box; from D4 a kind's `outline` (its sheet's silhouette drawn one picture pixel each
way under it), `team` colour (a recoloured copy of the sheet) and `screenScale` (the drawn scale
held in a range about the box's anchor), the recoloured sheets made once per sheet and colour
through the `recolor` option, an `ImageRecolor`; `recolor.ts` holds the pure pixel maths,
`recolorPixels`, and `RecolorCache`), and from Engine 0.16 E6 the tower defense's looks: an
event's `projectile` (a frame or square flying from the event's `fromX`/`fromY` to its `x`/`y`
over `ticks` frames, on an `arc`, turned to its way with `turn`, after the entities and under the
particles, then its `impact`'s emitters, sound and shake on the frame it lands, each once), a
`ring` from a `range:` tag (`ringRadius`: the tag's number times `per`, else the map's tile size),
and labels' bars against a `{ tag: "maxhp:" }` max. Canvas2D's `SkinnedCanvasPresenter` and the
PixiJS presenter are thin wrappers that supply a renderer and surfaces, so both draw every
feature through exactly the same code. It lives in its own core folder, not in `present/`
(which kits import), so the dependency table can keep kits and the sim off it whole.

## Public API entry points

Import from `@engine/core/draw` (`index.ts`).

- `SkinnedPresenter(renderer, skin, sheets, opts?)`, `SkinnedPresenterOptions`: the shared walk;
  `resize`, `effectSettings`, `focus()`, `particleCount`, `projectileCount` (E6).
- `ringRadius(ring, tags, tileSize?)`, `DEFAULT_RING_PER`, `DEFAULT_RING_ALPHA`: a kind ring's
  radius in world px (E6). Options as Canvas2D's presenter, with
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
and `display.test.ts`, Canvas2D's `fog.test.ts` (the fog's pixels), plus `tests/runs/presentation-invariance.test.ts` and
`tests/runs/stepped-shell-invariance.test.ts`; the fog and minimap on Canvas2D and PixiJS
side by side in `tests/browser/fog-parity.test.ts` (skipped without Chromium); outlines, team colours and zoom-stable bars in `engine/core/draw/recolor.test.ts` (the pixel maths and the cache), Canvas2D's `readability.test.ts` (pixels; a bar's size at zoom 0.5, 1 and 2) and `tests/browser/readability-parity.test.ts` (both backends); the tower defense's looks (E6) in
`draw.test.ts` (projectile flight, landing once on its frame or a later one, a new level dropping
them, a turned frame, a ring from a tag, bars against each enemy's max) and on both backends in
`tests/browser/td-looks-parity.test.ts`.
