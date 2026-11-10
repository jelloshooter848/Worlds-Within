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

## SkinnedCanvasPresenter

`new SkinnedCanvasPresenter(rendererOrCtx, skin, sheets, opts?)` implements `Presenter`.
`sheets` is a `SheetLookup` (`sheetLookup(assets)` from `@engine/core/assets/sheet-lookup`).
`opts`: `size?` (the picture to frame in; else `frame.size`; `resize(size)` changes it),
`onSound?(id)`, `background?` (default the skin's `background`, else `#000`: `skinBackground`,
gap G36), `font?` (HUD font, default `font`), `clamp?` (the
skin's `camera.clamp`, else true),
`reduceFlashing?`, `seed?` (particles, Engine 0.16 T3), `mapSurface?(w, h)` (where the map is cached; the default is an offscreen
canvas, none in Node). Each `present(frame)`, in order:

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
  `fallbackColor` box; unlisted tiles stay empty. Layers draw after `tiles`.
- Entities by `layer`, then list order (no `y`-sort; the kit emits them in draw order): `resolveSkinFrame` picks the frame and flip
  (all eight facings: a diagonal without a frame uses its horizontal one), from the kind's first
  `byTag` look that matches one of the entity's tags (a whole `tag`, or from Engine 0.15 a `prefix`
  with an optional `min`/`max` range, gap M2), else the kind's own frames (Engine 0.11, gap G30);
  a missing sheet or frame draws a `fallbackColor` box of the skin `size`, else the entity's box.
  `fx` squash, stretch and `rotate` go through `transformed()` about the bottom centre; `alpha`
  through `translucent()`.
- Tweens (Engine 0.16 T1, `@engine/core/fx`): one `TweenSet` per entity id, presenter state only.
  An event's skin `tween` starts on its `entity` (with the event's sound and effect, once per frame
  number); a kind's `spawnTween` on an entity the first frame it is shown (again after it leaves
  and returns); ended tweens and those of entities gone from the frame are dropped. Drawing lays
  the tween state on top of `fx`: `x`/`y` added to the position (world px, before the zoom),
  `scaleX`/`scaleY` times the squash, `rotate` added to the turn, `alpha` times the alpha (clamped
  to 0-1), and a `color` tween as a translucent box (`colorAmount`) over the drawn box, inside the
  same transform. Nothing is written back to the frame.
- HUD from `skin.hud` and `frame.status`: `hearts` (one frame per whole point), `icon` (when
  truthy), `number`/`text` (`Renderer.text` with the font). A missing status draws nothing. The
  layout is the core `layoutHud` (`@engine/core/present`, Engine 0.15, gap G33), shared with the
  3D backend's HUD pass: change it there; this presenter only draws its items (`sprite`, `text`,
  a missing frame's `box`).

It never changes the frame or the skin (tested with frozen ones) and knows no game or kit.

## A skin set (`skin-set.ts`, Engine 0.7 T9)

`skinSetCanvasPresenter(r, { skin, rounds?, sheet, screen, background?, onSound?, main? })`: one
`Presenter` for a game that stacks kits: a `SkinnedCanvasPresenter` with the game's skin (or
`main`) and one per mini game skin in `rounds` (each
clearing to its own skin's `background`, black by default; the `background` option overrides the
game's own skin only, gap G36), picked per frame by `status.miniGame`
(`presenterBySkinSet` from `@engine/core/present`). Each skin frames its map as its own `camera`
says (`clamp: false` keeps a top-down room under its HUD band; gaps G29 and G34 in
`docs/reports/stacking-test.md`), so games pass no per-round options.

## The page's display (`display.ts`, Engine 0.7)

`canvasDisplay(canvas, { screen, skin, rounds?, sheet, background?, integerScale?, onSound? })` is the
Canvas2D `BrowserDisplay` (`@engine/core/shell`) a game hands `bootBrowserGame`: a `Viewport` on
the page's canvas at the picture size, a `CanvasRenderer` on its backbuffer (the scene stack's
`renderer`), its `toScreen` (`Viewport.toScreen`, a client point in picture pixels for pointer
input, Engine 0.9) and `toClient` (`Viewport.toClient`, its inverse: a picture point in client
px, Engine 0.15 gap D13, tested in `viewport.test.ts`), and `skinSetCanvasPresenter` with the game's skin (and `rounds`, a skin per mini
game, as `threeDisplay` takes them) on that same renderer (the display's `presenter`). `fit(layout)` sets the viewport's `fit` from the screen layout and
resizes; `present()` copies the backbuffer to the page. Browser only (moved from
`games/platformer-lab/main.ts`).

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
picture size. `Viewport` needs a
real DOM and is checked by running a game. `display.test.ts` builds a `canvasDisplay` on fake
canvases: its presenter clears the backbuffer to the background, and `fit` + `present` copy it
fitted to the page. `rts-camera.test.ts` (Engine 0.9 T5) checks that `RtsCamera`
(`@engine/core/present`) agrees with this presenter: at zoom 0.5, 1 and 2, with a skin deadzone
and lerp, each entity's box is drawn where `worldToScreen` says and maps back within half a picture
pixel, and the map copy sits at the camera's top-left, in the middle of the map and clamped at
its edge.
