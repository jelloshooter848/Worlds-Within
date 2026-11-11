# engine/core/draw

The drawing side of the core the 2D backends share (Engine 0.16 T13b, item 323): the skinned
presenter walk, moved out of Canvas2D's `SkinnedCanvasPresenter` so the PixiJS presenter draws
every 0.16 part A feature through exactly the same code as Canvas2D. Everything here draws only
through the core `Renderer` (`../gfx/renderer`) and its scoped helpers (`translucent`, `blended`,
`glowing`, `transformed`): no canvas, no DOM, no WebGL, no backend import. A backend supplies its
renderer and its surfaces.

## Why a folder of its own

It is not `present/`: kits import `@engine/core/present` (they describe frames with it), and the
walk draws, so it must sit where kits and the sim cannot reach it. A separate folder lets
`config/layers.js` forbid it whole (`engine/core/draw/**` in `FORBIDDEN_CORE` for kits and
`engine/sim`) and keep it on `PURE_CORE` (no `Math.random`, `Date.now`, `performance.now` or DOM),
so two backends drawing the same frame get the same calls.

## Files

- `surface.ts`: `DrawSurface` `{ renderer, image }` (alias `MapSurface`, `GlyphSurface`), a surface
  drawn once and copied from each frame; `image` is the opaque handle put in a `SpriteSheet` the
  main renderer draws (an offscreen canvas for Canvas2D; null in tests). `SurfaceFactory`
  `(w, h) => DrawSurface | null`.
- `skinned-presenter.ts`: `SkinnedPresenter(renderer, skin, sheets, opts?)`, the `Presenter` every
  2D backend draws through: events and frame events (sounds, hit-pause, tweens, effects),
  particles, tweens, camera follow and zoom, camera effects (shake, zoom punch, flash), parallax,
  per-map looks, the map (cached on `opts.mapSurface`, or tiles every frame without one; a
  layer's anchored frame placed on its cell, part C T1), the skin's `lighting` (Engine 0.16 part C
  T4, merged into the walk in part D, D1: placed lights' sprites under the entities, then the
  darkness on `opts.lightSurface` with the lights erased by `radialFilled`, or a flat translucent
  box without one, the glows and the vignette; a renderer without `gradient` draws no radial
  fills), entities by layer, the HUD (skipped while `showHud(false)`, part C T1; `layoutHud`, or
  the UI kit's `SkinHud` painted by `RendererUiPainter` with
  `opts.glyphSurface`). `SkinnedPresenterOptions` holds every option (`size`, `onSound`,
  `background`, `font`, `fonts`, `glyphSurface`, `tintGlyphs`, `clamp`, `reduceFlashing`, `shakeScale`,
  `subPixelShake`, `onHitPause`, `seed`, `maxParticles`, `mapSurface`, `lightSurface`); `resize`,
  `effectSettings`, `showHud`, `focus()` and `particleCount`. The defaults here are no surfaces; a backend's
  wrapper passes its own (Canvas2D: offscreen canvases). The full behaviour is described in
  `engine/backends/canvas2d/CLAUDE.md` ("SkinnedCanvasPresenter"), which is this class on a canvas.
  Top-down looks (Engine 0.16 F8, for the mini siege's hosted rounds after parts C and E): a
  kind's `turnToFacing` turns its frame about the box's centre to the facing (`FACING_TURN`,
  degrees clockwise from right; `true` for art drawn facing right, or the way it is drawn facing),
  `ring` draws a flat disc of rows under the sprite (`discRows`, `DEFAULT_RING_ALPHA` 0.25, an
  opaque one-pixel rim with `edge`: a tower's range while it is placed), `hitFlash` draws the frame
  through the sheet lookup with the colour as its palette while the entity has the tag (a
  silhouette: `contentSheets` makes it; blinking every `blink` frames by the frame number), and
  the skin's `labels` (the 3D backend's world-anchored labels, `layoutLabels`) are drawn on a 2D
  skin too, after the entities and particles and before the HUD, anchored on the box's top
  centre, centre or bottom centre on the picture (an anchor off the picture hides the label);
  from Engine 0.16 polish P6 (gap M45) `layoutLabels` gets the picture size, so a label whose
  anchor is in the picture but whose box runs past an edge is moved inside it (with its bar, as
  one box), as in 3D.
- `ui-painter.ts`: `RendererUiPainter(renderer, sheets, fonts, { glyphSurface?, tintGlyphs? })`,
  the `UiPainter` on a `Renderer` (fills, whole and part frames scaled with `transformed`, glyphs
  from a strip of the font drawn once per colour on a glyph surface, else their ink runs as
  boxes). With `tintGlyphs(whiteImage, color)` (`GlyphTint`; Engine 0.16 T13b-3, PixiJS's sprite
  tint) each font's strip is drawn once in white and a colour's strip is its frames with the
  tinted image the backend returns.
- `skin-set.ts`: `skinSetPresenter(opts, make)`: one presenter over a game's skin and one per mini
  game skin, picked by `status.miniGame`, each made by the backend's `make(skin, sheets, opts)`;
  `effectSettings` and `showHud` reach every one. `SkinSetPresenterOptions` (`skin`, `rounds?`, `sheet`,
  `fonts?`, `screen`, `background?`, `onSound?`, `onHitPause?`, `main?`).

Change how a feature is drawn here, once, for every 2D backend; a backend wrapper only supplies a
renderer and surfaces. A change must keep Canvas2D's `presenter.test.ts` and the presentation
invariance tests green unchanged.

## Imports

- Allowed: other `engine/core` modules (`gfx`, `fx`, `present`, `ui`, `assets/sheet-lookup`).
- Never: backends, `engine/sim`, `engine/tools`, kits or games; no DOM or canvas APIs.
- Who may import it: backends (and tools and games through them). Kits and `engine/sim` may not
  (`FORBIDDEN_CORE`).

## Testing

`draw.test.ts` checks what the core adds: no map or glyph surface by default (tiles and ink runs
every frame), a cached map and glyph strip with one, `skinSetPresenter`'s factory calls,
routing and `effectSettings`, and the top-down looks (Engine 0.16 F8: the facing turn, the ring's
rows and rim, a hit flash's palette, a 2D health bar label). Everything else is tested through Canvas2D's thin wrapper
(`engine/backends/canvas2d/presenter.test.ts`, `ui-painter.test.ts`, `rts-camera.test.ts`,
`display.test.ts`) and the presentation invariance tests in `tests/runs/`.
