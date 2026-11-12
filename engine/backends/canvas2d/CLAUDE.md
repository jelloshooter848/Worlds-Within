# engine/backends/canvas2d

The browser backend for 2D: `CanvasRenderer` (`renderer.ts`) draws the core `Renderer` contract
onto a 2D canvas context, `Viewport` (`viewport.ts`) owns the backbuffer and presents it
on the display canvas, scaled and letterboxed, and `SkinnedCanvasPresenter` (`presenter.ts`)
draws any presentation frame (`@engine/core/present`) through a skin. `index.ts` exports all three, and
`canvasDisplay` (`display.ts`), the page's 2D display for `@engine/core/shell`.
The backbuffer is the game's
picture size: `new Viewport(canvas, { integerScale }, content.manifest.screen)` (`screen` in
`game.json`; `DEFAULT_SCREEN`, 256x240, when left out). The fit maths it uses (`ScreenSize`,
`DEFAULT_SCREEN`, `fitGame(size, ...)`) lives in `engine/core/gfx/screen.ts`, because the touch
layout needs it too. Never hard-code a picture size here: take it from the size given.

Where it runs (Engine 0.16 T13b-8): the RTS skirmish and tower-defense pages default to the
PixiJS backend (`@engine/backends/pixi`); Canvas2D remains for Node tests, screenshots
(`pnpm cli screenshot`, the parity sheet), machines without WebGL (the shell falls back to it)
and `?backend=canvas2d`, and it stays the default of the other 2D pages.

## The shared walk (`@engine/core/draw`, Engine 0.16 T13b)

Everything below about how a frame is drawn lives in the core `SkinnedPresenter`
(`engine/core/draw/skinned-presenter.ts`), with `RendererUiPainter` (`ui-painter.ts`) and
`skinSetPresenter` (`skin-set.ts`) beside it, so the PixiJS backend draws every feature through
exactly the same code. This folder keeps thin wrappers with the same names, constructor
signatures and options: `SkinnedCanvasPresenter` (`presenter.ts`) is `SkinnedPresenter` on a
`CanvasRenderer` (or the `Renderer` given) with `canvasSurface` (`surface.ts`: an offscreen canvas,
else a page canvas, none in Node) as its default `mapSurface`, `glyphSurface` and `lightSurface`
(the lighting's light map, part C T4);
`CanvasUiPainter` (`ui-painter.ts`) is `RendererUiPainter` with that default glyph surface;
`skinSetCanvasPresenter` (`skin-set.ts`) is `skinSetPresenter` making a `SkinnedCanvasPresenter`
per skin on `r`. `SkinnedPresenterOptions`, `MapSurface` and `GlyphSurface` are re-exported from
the core, and `CanvasSkinSetOptions` is the core's `SkinSetPresenterOptions`. Change how a feature
is drawn in `engine/core/draw`, not here; this folder only supplies the canvas.

## SkinnedCanvasPresenter

`new SkinnedCanvasPresenter(rendererOrCtx, skin, sheets, opts?)` implements `Presenter` (the core
`SkinnedPresenter` on a canvas; see above).
`sheets` is a `SheetLookup` (`sheetLookup(assets)` from `@engine/core/assets/sheet-lookup`).
`opts`: `size?` (the picture to frame in; else `frame.size`; `resize(size)` changes it),
`onSound?(id)`, `background?` (default the skin's `background`, else `#000`: `skinBackground`,
gap G36), `font?` (HUD font, default `font`), `clamp?` (the
skin's `camera.clamp`, else true),
`reduceFlashing?`, `seed?` (particles and shake noise, Engine 0.16 T3), from Engine 0.16 T4
`shakeScale?` (0..1, the player's shake setting), `subPixelShake?` (default false) and
`onHitPause?(ticks)`, `mapSurface?(w, h)` (where the map is cached; the default is an offscreen
canvas, none in Node) and from Engine 0.16 T13 `maxParticles?` (the particle system's cap, default
`PARTICLE_SYSTEM_MAX`, 1024) and from Engine 0.16 part C T4 `lightSurface?(w, h)` (the light
map's surface, below). `particleCount` is the particles alive after the last `present`
(the feature benchmark reads it). Each `present(frame)`, in order:

- Events: each event with a skin entry (`resolveSkinEvent`: a field key such as
  `mini-game-end:pass` first, then the bare type; gap G28) calls `onSound(sound)` once and starts its
  `effect` (`flash` full-screen, `tint` translucent full-screen, `particles` from the event's
  `x`/`y` or its `entity`'s centre, `shake` a camera wobble), timed by `frame.frame` and lasting
  `ticks`. A frame with the same `frame` number as the last one does not replay its events.
- Frame events (Engine 0.16 T2): after the frame's events, the presenter's `FrameEventClock`
  (`@engine/core/present`) gives the skin's frame events of the frames that started since the
  last frame (a cycle's `events: { "<frame>": "<type>" }`, such as a footstep), each handled
  exactly like a frame event through the skin's `events` (sound, effect at the entity's feet,
  tween); never written into the frame. Per-frame `ticks`, one-shots and `then` come with
  `resolveSkinFrame`.
- Particles (Engine 0.16 T3): a `SkinParticles` (`@engine/core/fx`) seeded by the `seed` option
  (default 0). Each event's skin entry starts its `emit` (and an old `particles` effect, now an
  implicit emitter that draws as before); each kind's `emit` runs on its entities, following
  them; the system steps to `frame.frame` after the events. They are drawn in world space after
  the entities and before flash and tint: squares `size` px on a side (rounded, at least 1, none
  at size 0) centred on each particle, or a sprite `frame` scaled by `size`, at their `alpha`, a
  run of same-blend particles inside one `blended` scope (`add`: the canvas's `lighter`), each
  glowing particle inside `glowing` (shadow blur in its colour). `reduceFlashing` also draws
  additive particles with normal blending, half as strong, without glow.
- A kind's `blend: add` and `glow { color, radius }` (2D, Engine 0.16 T3) wrap its whole drawing
  in `blended` and `glowing` (`@engine/core/gfx/renderer`; `CanvasRenderer.blend` sets
  `globalCompositeOperation`, `CanvasRenderer.glow` `shadowColor` and `shadowBlur`).
- Camera: the framing maths is `CameraFollower` in `@engine/core/present` (`camera.ts`), shared
  with the 3D backend; change it there, not here. The presenter keeps its own instance (state in
  the presenter only: never in a kit, a frame or a hash) and adds `cameraShake` on top. Target: the
  hint's `follow` entity (by id, its box centre) when it is in the frame, else the hint's `x`/`y`,
  else the skin's `camera.follow` (entity id, then kind), else none (the map's top-left).
  `deadzone` and `lerp`: the hint's, else the skin's, else 0x0 and 1. The deadzone is a `w` x `h`
  box round the picture's centre the target moves in without scrolling; past its edge the camera
  moves just enough to put it back on the edge. Lerp closes that fraction of the gap per frame in
  whole pixels with 1/256 fixed point (`Math.trunc`, at least 1 px, so it always arrives); 1
  snaps, 0 holds. The first frame, a new map id and a frame with no target snap; a frame shown
  twice (same `frame` number) does not move it again. Clamp (unless `clamp: false`): inside the
  hint's `bounds` (a kit-side scroll lock or room), else the map; an area smaller than the
  picture is centred on that axis. Offsets are whole pixels; `shake` is added after (in picture pixels), never
  stored.
- Zoom (Engine 0.9 T2): `cameraZoom(frame, skin.camera)` (the hint's `zoom`, else the skin's,
  else 1). The follower frames the zoomed view, `cameraView(size, zoom)` (the picture over the
  zoom, in world pixels), so clamping and centring use the zoomed picture size. A world point
  (wx, wy) is drawn at `round(wx * zoom) - camX` with `camX = round(cam.x * zoom) + shake`, so
  every position is a whole picture pixel and screenshots stay deterministic. The map copy, tiles
  and sprites go through `Renderer.sprite`'s `scale` (nearest neighbour; not passed at zoom 1, so
  zoom-1 draw calls are unchanged); fallback boxes and particles are scaled and rounded; an
  uncached tile spans from its rounded corner to the next one's, so tiles meet without gaps. Squash
  pivots on the zoomed bottom centre. Flash, tint and the HUD are in picture pixels (not zoomed).
  Whole-number zooms (2, 3) and halves (0.5) keep tiles evenly sized.
- Map: a full map is drawn onto the surface once per id and version and copied each frame; a
  `{ id, version }` ref reuses it; no `map` draws none. Tiles the skin lists draw their frame, or a
  `fallbackColor` box; unlisted tiles stay empty. Layers draw after `tiles`. A tile entry with a
  `join` (Engine 0.16 part B, T6) draws the frame its neighbours in the same grid pick
  (`resolveTileFrame` from `@engine/core/present`: grass tops, edges, corners, notches). On a
  layer (not `tiles`; Engine 0.16 part C T1, the platformer kit's `decor` layer) a frame with an
  `anchor` (a PNG sheet's) is placed by it on its cell (`anchorOffset` over the tile's box), so a
  prop taller or wider than a tile stands on the cell's bottom centre; terrain tiles and frames
  without one draw at the cell's corner as before.
- Entities by `layer`, then list order (no `y`-sort; the kit emits them in draw order): `resolveSkinFrame` picks the frame and flip
  (all eight facings: a diagonal without a frame uses its horizontal one), from the kind's first
  `byTag` look that matches one of the entity's tags (a whole `tag`, or from Engine 0.15 a `prefix`
  with an optional `min`/`max` range, gap M2), else the kind's own frames (Engine 0.11, gap G30);
  a missing sheet or frame draws a `fallbackColor` box of the skin `size`, else the entity's box.
  A cycle's own `sheet` (Engine 0.16 part B, T6) is the sheet that state draws from.
  A frame with an `anchor` (a skin's PNG sheet, Engine 0.16 T10: `anchorOffset` from
  `@engine/core/gfx/spritesheet`, mirrored when flipped) is drawn so its anchor sits on the
  entity box (`bottom`: its bottom centre on the box's), before the zoom; text sprites have no
  anchor and draw at the box's top-left as before. PNG sheets reach the presenter through the
  same `SheetLookup` (`contentSheets` of a bundle that went through `withContentImages`).
  `fx` squash, stretch and `rotate` go through `transformed()` about the bottom centre; `alpha`
  through `translucent()`.
- Tweens (Engine 0.16 T1, `@engine/core/fx`): one `TweenSet` per entity id, presenter state only.
  An event's skin `tween` starts on its `entity` (with the event's sound and effect, once per frame
  number); a kind's `spawnTween` on an entity the first frame it is shown (again after it leaves
  and returns); ended tweens and those of entities gone from the frame are dropped, and a frame
  number lower than the last one (a new level) drops them all and forgets the ids seen, so spawn
  tweens play again. Drawing lays
  the tween state on top of `fx`: `x`/`y` added to the position (world px, before the zoom),
  `scaleX`/`scaleY` times the squash, `rotate` added to the turn, `alpha` times the alpha (clamped
  to 0-1), and a `color` tween as a translucent box (`colorAmount`) over the drawn box, inside the
  same transform. Nothing is written back to the frame.
- HUD from `skin.hud` and `frame.status`: `hearts` (one frame per whole point), `icon` (when
  truthy), `number`/`text` (`Renderer.text` with the font). A missing status draws nothing. The
  layout is the core `layoutHud` (`@engine/core/present`, Engine 0.15, gap G33), shared with the
  3D backend's HUD pass: change it there; this presenter only draws its items (`sprite`, `text`,
  a missing frame's `box`).
  From Engine 0.16 T6 a skin whose `hud` has a UI kit item (`bar`, `counter`, `panel`, `minimap`,
  or text in a font file; `SkinHud.usesUi` from `@engine/core/ui`) is laid out whole by `SkinHud`
  (the map the presenter shows for a minimap, its own clock for a counter's roll) and painted by
  `CanvasUiPainter` (`ui-painter.ts`, exported): a fill is `rect` (`translucent` below alpha 1); an
  image is `sprite` of the whole frame, or of a sheet holding only the frame's part (cached per
  part) scaled with `transformed` when its box is another size (a nine-slice piece); a glyph is a
  `sprite` from a strip of the font's glyphs drawn once per colour on a `glyphSurface` (an
  offscreen canvas; option `glyphSurface`), or its ink runs as `rect`s where there is none (Node).
  The presenter's `fonts` option (`contentFonts(content)`) gives the font files; `canvasDisplay`
  and `skinSetCanvasPresenter` pass it on. A skin without UI items draws exactly as before.
- Camera effects and parallax (Engine 0.16 T4, `@engine/core/fx`): an event's skin `shake`,
  `zoom` and `flash` start on a `CameraFx` (seeded by `seed`) timed by the presenter's own clock,
  one tick per `present` call, so they go on while the frame number stands still (a hit-pause,
  the pause between levels); its `hitPause` calls `onHitPause(ticks)` once per event (the shell
  holds the game's ticks). Each frame the follower frames at the base zoom, then a zoom punch
  zooms the view about the camera's target (`zoomAbout`, a punch out clamped like the camera),
  and the trauma shake (`shakeX`, `shakeY`, whole picture px) is added to the camera's top-left
  after the old horizontal `cameraShake` (both scaled by `shakeScale`). Flashes are drawn over
  the picture after flash and tint effects and before the HUD, each a full-picture box at its
  alpha; `reduceFlashing` skips them. `effectSettings({ reduceFlashing?, shakeScale? })` changes
  both settings from the next frame (a settings screen). The skin's `parallax` layers are drawn
  after the clear and before the map (`layoutParallax`, shared with 3D): gradient bands as boxes,
  frames as sprites at scale 1, scrolled against the camera's top-left in picture px (zoom and
  shake included).
- Lighting (Engine 0.16 part C T4, `@engine/core/fx`): a skin's `lighting` through a
  `SkinLighting` (seeded by `seed`). Every event (and frame event) goes to its `event` before the
  skin's entries (an event may have only a light). The placed lights' sprites
  (`lighting.props`) are drawn over the map and under the entities, in world space. After the
  particles and before the old effects, flashes and the HUD, `drawLighting` draws its `layout`:
  the darkness on a picture-sized light map (option `lightSurface(w, h)`, a `MapSurface`; default
  an offscreen canvas, none in Node; made on the first lit frame and again when the picture size
  changes): cleared to the darkness colour, each light erased out of it (`radialFilled` with
  `mode: 'erase'`, stops `lightStops(intensity, bands)`), then copied over the picture as a
  sprite at the darkness level (`translucent`); without a surface the darkness is a flat
  translucent box. Then each light with a `glow` is added in its colour (`mode: 'add'`), then the
  vignette (a radial fill over the whole picture, clear to `inner`, `strength` at the corners).
  `CanvasRenderer.gradient` (the optional `Renderer.gradient`, `RadialFill`) fills a box with a
  `createRadialGradient` at `destination-out`, `lighter` or `source-over`. With the skin's
  `lighting.dither` (Engine 0.16 polish P, C1) each light's erase and glow fill carries
  `dither` (`lightDither(layout)`) and smooth stops (`lightStops(.., bands, dither)`): the
  renderer then draws `ditheredRadial`'s alpha bytes (`@engine/core/fx`, an ordered Bayer dither
  by picture pixel, no RNG) in the fill's colour as image data on a scratch canvas (an
  `OffscreenCanvas`, made once and grown; none in Node), copied with the same blend, since
  `putImageData` takes none; the coloured image data is kept by the stamp's shared `alpha` array
  (a `WeakMap`), so a steady light, or one the camera scrolls, is coloured once. The vignette is never dithered. `reduceFlashing`
  halves event flashes and flicker. Room-wide `lighting.particles` run in `SkinParticles` (the
  presenter passes it the map shown) and are drawn with the other particles. The walk is the
  core's (merged in Engine 0.16 part D, D1), so the PixiJS backend runs it too, with its own
  `gradient` (radial sprites) and a light map surface (feedback item 434's follow-up).
- Per-map looks (Engine 0.16 part B, T7): the clear colour, the parallax layers and the tiles come
  from `themedSkin(skin, mapId)` (`@engine/core/present`) for the map shown (the full map last
  sent, else the frame's map id), made once per map id: a skin's `themes` entry for that map
  replaces its `background` and `parallax` and lays its `tiles` over the skin's. Everything else
  (kinds, events, HUD, camera) stays the skin's. Tested in `presenter.test.ts` (`per-map looks`).

`showHud(shown)` (Engine 0.16 part C T1) turns the HUD off and on from the next frame (the
shell hides it while its title shows); `skinSetCanvasPresenter`'s presenter hands it to every
skin's presenter and `canvasDisplay` gives it as `BrowserDisplay.showHud`.

It never changes the frame or the skin (tested with frozen ones) and knows no game or kit.

## A skin set (`skin-set.ts`, Engine 0.7 T9)

`skinSetCanvasPresenter(r, { skin, rounds?, sheet, screen, background?, onSound?, onHitPause?, main? })`: one
`Presenter` for a game that stacks kits: a `SkinnedCanvasPresenter` with the game's skin (or
`main`) and one per mini game skin in `rounds` (each
clearing to its own skin's `background`, black by default; the `background` option overrides the
game's own skin only, gap G36), picked per frame by `status.miniGame`
(`presenterBySkinSet` from `@engine/core/present`). Each skin frames its map as its own `camera`
says (`clamp: false` keeps a top-down room under its HUD band; gaps G29 and G34 in
`docs/reports/stacking-test.md`), so games pass no per-round options.

## The page's display (`display.ts`, Engine 0.7)

`canvasDisplay(canvas, { screen, skin, rounds?, sheet, background?, integerScale?, onSound?, onHitPause? })` is the
Canvas2D `BrowserDisplay` (`@engine/core/shell`) a game hands `bootBrowserGame`: a `Viewport` on
the page's canvas at the picture size, a `CanvasRenderer` on its backbuffer (the scene stack's
`renderer`), its `toScreen` (`Viewport.toScreen`, a client point in picture pixels for pointer
input, Engine 0.9) and `toClient` (`Viewport.toClient`, its inverse: a picture point in client
px, Engine 0.15 gap D13, tested in `viewport.test.ts`), and `skinSetCanvasPresenter` with the game's skin (and `rounds`, a skin per mini
game, as `threeDisplay` takes them) on that same renderer (the display's `presenter`). `fit(layout)` sets the viewport's `fit` from the screen layout and
resizes; `present()` copies the backbuffer to the page. Browser only (moved from
`games/platformer-lab/main.ts`).

Menus (Engine 0.16 T9): the display's `uiPainter()` is a `CanvasUiPainter` on its renderer (with
its `sheet` and `fonts`), what the shell's title, pause and settings screens draw with, and
`effectSettings(settings)` hands the player's shake and flashing settings to every presenter of
the skin set (`skinSetCanvasPresenter` now returns a presenter with `effectSettings`, which
reaches the main and every round presenter).

Screen transitions (Engine 0.16 T5): the display keeps the game's own `SkinnedCanvasPresenter`
(passed to `skinSetCanvasPresenter` as `main`) and takes the shell's `transition(view)`; on
`present()` it draws `transitionShape(view, screen, main.focus())` (`@engine/core/fx`) over the
backbuffer before the copy, with `drawTransition(ctx, shape, screen)` (`transition.ts`, exported):
a fade fills the picture at its alpha, a wipe fills it with a linear gradient from the trail to
the lead (stops at the soft edges, alphas from the core `wipeAlpha`), an iris fills the picture
but for its circle (`rect` + `arc`, `fill('evenodd')`); the context is saved and restored.
`SkinnedCanvasPresenter.focus()` is the camera's target (`cameraTarget`: the followed entity's
centre, else the hint's point) on the picture as the last frame drew it (zoom and shake
included), or null.

## Performance: the RTS benchmark (Engine 0.9 T3)

`tests/bench/rts-render/` measures this presenter in headless Chromium (Playwright): a synthetic
RTS scene (128 x 128 map, 500 and 1000 eight-way units with rings and health bars, 320 x 240
picture, zoom 0.5, 1 and 2, panning). It is not part of `pnpm test`. Rerun it with

    pnpm exec tsx tests/bench/rts-render/run.ts

(`--pixi <pixi.min.js>` adds a PixiJS v8 column from a scratch install outside the repo; the
options, numbers and the decision are in `docs/BUILD-LOG.md`, Engine 0.9, T3). Canvas2D held the
500-unit target (p95 frame time at most 16.7 ms), so PixiJS was not added. The presenter draws
every entity, in view or not; if a view needs more headroom, cull entities outside the view
before reaching for another backend. Rerun the benchmark after changing how entities, the map or
zoom are drawn.

## Performance: the 2D feature benchmark (Engine 0.16 T13, item 320)

`tests/bench/feature-render/` (`pnpm bench:features`, JSON on stdout) draws the RTS skirmish's
and the tower defense's real maps, skins and unit kinds with 500 and 300 walking units and every
0.16 feature added in a skin (2000+ particles, additive blending, glow, three parallax layers,
tints, a UI kit HUD, shake, zoom and flash) at zoom 0.5, 1 and 2, beside the plain skins;
`--ablate` measures each feature off, `--shots <folder>` saves screenshots. On the build
container (no GPU) this presenter missed the 16.7 ms p95 bar by about ten times with the
features on (glow, `shadowBlur`, on additive drawing is the worst; 2000+ particles alone are over
budget), so a PixiJS v8 backend is the follow-up (T13b, item 323; numbers in `docs/BUILD-LOG.md`,
Engine 0.16 part A, T13). Rerun it after changing how particles, glow or blending are drawn.

From T13b-6 it measures this presenter and the PixiJS backend side by side (each result names its
`backend`; the machine block names the WebGL renderer and whether it is software). Rerun with:

    pnpm bench:features                        # both backends
    pnpm bench:features --backends canvas2d    # this backend only (add --ablate for feature costs)

On the build container (no GPU: Skia on the CPU) this presenter's features-on p95 was 169-363 ms
and plain 11-17 ms (`docs/BUILD-LOG.md`, T13, 2026-11-10).

## Imports

- Allowed: `@engine/core/*`, files in this folder, browser APIs (canvas, `window`).
- Never: other backends, `engine/sim`, `engine/tools`, kits or games.
- Draw only what the caller asks for: no game rules here.

## Testing

`*.test.ts` here run in Node against a fake 2D context that records calls and maps points through
the transform (see `renderer.test.ts`). `presenter.test.ts` uses a recording `Renderer`, fixture
frames and a fixture skin written inline (never import a kit or a game's skin; a `byTag` look is
drawn for an entity with its tag, the kind's frame otherwise; the skin set block checks each skin
clearing to its own `background`, black without one, the option first, G36; the `frame events`
block plays a cycle's frame event through `onSound` once per frame started, a state's first frame
when it begins, and never into the frame); its `camera`
block reads the camera's top-left off the recorded map copy. The `particles, blending and glow
(Engine 0.16 T3)` block records `blend`, `glow` and `alpha` scopes: event emitters drawn after the
entities, additive and glowing; the same seed giving the same calls; a kind's emitter running while
its entity shows and the kind's own blend and glow; the old `particles` ring; reduced flashing. The recorder writes a sprite's
`scale` as ` xN` when it is not 1; the `zoom` block checks the map copy, tiles, sprites, boxes
and squash pivot at zoom 0.5, 1 and 2, the skin's zoom, and that clamping uses the zoomed
picture size. The `camera effects and parallax (Engine 0.16 T4)` block plays a stomp's shake on
both axes decaying to the framed camera (the same each run), the hit-pause request once per
event, the shake scale off and back on through `effectSettings`, a flash's fading alpha box and
reduced flashing, a zoom punch's scales there and back, and the parallax layers behind the map
moving at their own rates between two camera positions. The `neighbour-based tile frames and
per-cycle sheets (Engine 0.16 part B, T6)` block draws a joined block's corner, top, side and
fill frames and a state from its cycle's own sheet. `Viewport` needs a
real DOM and is checked by running a game. `display.test.ts` builds a `canvasDisplay` on fake
canvases: its presenter clears the backbuffer to the background, and `fit` + `present` copy it
fitted to the page. `rts-camera.test.ts` (Engine 0.9 T5) checks that `RtsCamera`
(`@engine/core/present`) agrees with this presenter: at zoom 0.5, 1 and 2, with a skin deadzone
and lerp, each entity's box is drawn where `worldToScreen` says and maps back within half a picture
pixel, and the map copy sits at the camera's top-left, in the middle of the map and clamped at
its edge. `ui-painter.test.ts` (Engine 0.16 T6) checks `CanvasUiPainter`'s fills, whole and
part frames, glyph runs and the coloured strip drawn once, and the presenter painting a UI HUD.
The `world labels inside the picture` block of `presenter.test.ts` (Engine 0.16 polish P6, gap
M45) checks health bars whose anchors are near the left and right edges drawn 2 px inside the
picture (the shared walk's `layoutLabels` with the picture size).
The `lighting (Engine 0.16 part C T4)` block of `presenter.test.ts` records `gradient`
calls on the screen and on a recording light surface: the darkness cleared and each light erased,
the light map laid over at the darkness level after the entities and before the HUD, glows added,
the vignette over the picture, a kind lit only in its states, a placed sprite under the entities,
an event's flash fading (half with reduced flashing), the surface made once and again on a resize,
the flat box without a surface, nothing for a skin without lighting and the same calls per seed,
and (polish P) a skin's `dither` passed to every light's erase and glow fill with the finer smooth
stops, never to the vignette. `renderer.test.ts`'s dithered block puts the fill's dithered bytes
in its colour on the scratch canvas and draws them in its blend, the same bytes each time, the
same fill coloured once and another colour anew.

These tests drive the shared walk in `@engine/core/draw` through the thin wrappers here (Engine
0.16 T13b moved the code, not the tests); `engine/core/draw/draw.test.ts` checks the core's own
defaults (no surfaces) and the skin set's factory.
`transition.test.ts` (Engine 0.16 T5) checks `drawTransition`'s calls for a fade, a
wipe (its gradient line and stops) and an iris (the even-odd hole on the focus) on a recording
context, and `presenter.test.ts` the presenter's `focus()` scrolled and clamped.
