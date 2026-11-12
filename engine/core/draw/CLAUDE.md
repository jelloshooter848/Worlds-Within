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
  fills), entities by layer, the frame's `fog` (Engine 0.16 part D, D3: `drawFog`, after the
  particles and the lighting and before effects, flashes and the HUD; the skin's `fog` look
  through `fogBoxes`, each box from its rounded corner to the next at the zoom so cells meet,
  cut to the picture, off-picture boxes skipped, opaque boxes as plain `rect`s and the rest in
  `translucent`; no `fog` or no map shown draws nothing, so every other frame's calls are as
  before), the HUD (its minimap given the frame's fog and the framed view box, `viewBox`, the
  camera's world box without shake) (skipped while `showHud(false)`, part C T1; `layoutHud`, or
  the UI kit's `SkinHud` painted by `RendererUiPainter` with
  `opts.glyphSurface`). `SkinnedPresenterOptions` holds every option (`size`, `onSound`,
  `background`, `font`, `fonts`, `glyphSurface`, `tintGlyphs`, `clamp`, `reduceFlashing`, `shakeScale`,
  `subPixelShake`, `onHitPause`, `seed`, `maxParticles`, `mapSurface`, `lightSurface`, `recolor`); `resize`,
  `effectSettings`, `showHud`, `focus()` and `particleCount`. The defaults here are no surfaces; a backend's
  wrapper passes its own (Canvas2D: offscreen canvases). The full behaviour is described in
  `engine/backends/canvas2d/CLAUDE.md` ("SkinnedCanvasPresenter"), which is this class on a canvas.
  Top-down looks (Engine 0.16 F8, for the mini siege's hosted rounds after parts C and E): a
  kind's `turnToFacing` turns its frame about the box's centre to the facing (`FACING_TURN`,
  degrees clockwise from right; `true` for art drawn facing right, or the way it is drawn facing),
  `ring` draws a flat disc of rows under the sprite (`discRows`, `DEFAULT_RING_ALPHA` 0.25, an
  opaque one-pixel rim with `edge`: a tower's range while it is placed), `hitFlash` draws the frame
  through the sheet lookup with the colour as its palette while the entity has the tag (a
  silhouette: `contentSheets` makes it; blinking every `blink` frames by the frame number; no
  `team` recolour while it shows), and
  the skin's `labels` (the 3D backend's world-anchored labels, `layoutLabels`) are drawn on a 2D
  skin too, after the entities, particles and lighting and before part D's fog and the HUD, anchored on the box's top
  centre, centre or bottom centre on the picture (an anchor off the picture hides the label);
  from Engine 0.16 polish P6 (gap M45) `layoutLabels` gets the picture size, so a label whose
  anchor is in the picture but whose box runs past an edge is moved inside it (with its bar, as
  one box), as in 3D.
- Readable at every zoom (Engine 0.16 part D, D4), in `drawEntity`: a kind's (or its tag look's)
  `outline` draws the sheet's silhouette (every pixel with alpha, in the outline colour) one
  picture pixel left, right, up and down under the sprite, or a box one pixel larger under a box;
  `team` draws the sprite from a recoloured copy of its sheet (`mask`, `hue` or a tint, by the
  entity's team tag) and a box in the team colour; `screenScale` draws at `screenScaleAt(spec,
zoom)` instead of the zoom, the box's `screenScalePivot` kept where the zoom puts it and the
  sprite laid out round it at its own scale (at a scale equal to the zoom the calls are exactly
  the plain ones). Recoloured sheets come from `RecolorCache` (`recolor.ts`), made once per sheet
  object and spec through `opts.recolor` (`ImageRecolor`: the backend copies the image and hands
  its RGBA pixels to `recolorPixels`); without `recolor`, or where it gives null (no canvas, a
  headless sheet), sprites draw without outline or team colour. A skin without the fields draws
  exactly the calls it did.
- The tower defense's looks (Engine 0.16 E6). **Projectiles**: an event's skin entry with a
  `projectile` (`@engine/core/present`'s `projectile.ts`) starts a flight in `takeEvents` (the
  event's `fromX`/`fromY` to its `x`/`y`, `projectileFlight`; without both points, or with
  `PROJECTILE_MAX` (256) in the air, the impact happens at once at the event's point).
  `landProjectiles` (right after the events, before the particles step) lands every flight whose
  age (`frame.frame` minus its event's frame) reached `ticks`, also on a frame that skipped past
  it (a sped-up page), each exactly once: its `impact`'s `emit` through `SkinParticles.event` at the
  landing point (the presentation RNG, as any emitter), its `sound` through `onSound` and its
  `shake` on the `CameraFx`; a frame number that went back (a new level) drops the flights.
  `drawProjectiles` draws those in flight after the entities and under the particles, at
  `projectilePlace` (the eased share of the way, raised by the `arc`): the frame centred on the
  place at the zoom (through `transformed` turned to the tangent, rounded to whole degrees, with
  `turn`), else a `size` square in `color`. `projectileCount` is how many fly. **Rings from a
  tag**: `ringRadius(ring, tags, tileSize?)`: with `tag` the number after it times `per` (default
  the shown map's tile size, else `DEFAULT_RING_PER` 16), else `radius`, else no ring (an
  upgraded tower's range). A ring draws only its rows on the picture (`discRows` from the
  top to the bottom of the picture), so a zoom punch that makes it huge stays cheap. **Bars against a tag**: a label's `max: { tag: "maxhp:" }` is read per
  entity (`labelBar`'s `entity`). A skin without these fields draws exactly the calls it did.
- `recolor.ts` (D4, pure): `RecolorSpec` (`silhouette`, `mask`, `hue`, `tint`), `recolorPixels`
  (RGBA in place; clear pixels untouched; `hue` leaves greys below `HUE_MIN_SATURATION` and keeps
  lightness), `recolorKey`, `hexRgb`, `rgbToHsl`, `hslToRgb`, `hueInRange` (wraps through 360),
  `ImageRecolor` and `RecolorCache`. The browser side is `canvasRecolor`
  (`engine/core/assets/canvas-recolor.ts`), which both 2D backends pass.
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
`display.test.ts`, and the fog's pixels in `fog.test.ts`) and the presentation invariance tests
in `tests/runs/`; the fog and the minimap on both 2D backends in
`tests/browser/fog-parity.test.ts` (the parity harness's strict bound). D4: `recolor.test.ts` (each
spec's pixels, the colour helpers, the cache once per spec and null without a recolour), Canvas2D's
`readability.test.ts` (outline, mask, tint and box pixels; zoom-stable bars 16x2 at zoom 0.5, 1
and 2) and `tests/browser/readability-parity.test.ts` (both backends; strict bound at zoom 1 and
2, where half-size sprites sample differently at 0.5, and the bar's size at all three). E6: the
`tower-defense looks` block of `draw.test.ts` (a square's places frame by frame, landing on its
frame with its sound once and a burst, a skipped landing frame, a new level dropping flights, an
impact at once without a start, a frame turned to its way on the arc, rings from a tag and the map's
tile size or `per`, bars against each enemy's own max) and `tests/browser/td-looks-parity.test.ts`
(rings, bars, the wave preview and projectiles in flight and landed on both 2D backends within
the strict bound; a frame turned to an arbitrary angle samples differently, so its box is held to
a few edge pixels), and the `towerDefense` switch of `tests/runs/effects.ts` in the invariance
tests.
