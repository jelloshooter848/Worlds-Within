# engine/backends/canvas2d

Folder: `engine/backends/canvas2d`. Detailed rules:
[`engine/backends/canvas2d/CLAUDE.md`](../../engine/backends/canvas2d/CLAUDE.md).

## Purpose

The browser backend for 2D. It draws the core `Renderer` contract onto a 2D canvas and presents the
backbuffer, sized to the game's picture (`screen` in `game.json`, 256x240 by default), on the
display canvas, scaled and letterboxed. It also implements the presentation contract: it draws any
`PresentFrame` (`@engine/core/present`) through a skin. It draws only what the caller asks
for and holds no game rules. The RTS skirmish and tower-defense pages default to PixiJS from
Engine 0.16 T13b-8; Canvas2D remains for Node tests, screenshots, machines without WebGL (the
shell's fallback), `?backend=canvas2d` and the other 2D pages' default.

## Public API entry points

`index.ts`, imported as `@engine/backends/canvas2d`:

- `CanvasRenderer` (`renderer.ts`): the `Renderer` implementation for a 2D context (with the
  optional `blend` and `glow` of Engine 0.16 T3).
- `Viewport`, `ViewportOptions` (`viewport.ts`): owns the backbuffer and presents it.
- `SkinnedCanvasPresenter`, `SkinnedPresenterOptions`, `MapSurface` (`presenter.ts`):
  `new SkinnedCanvasPresenter(rendererOrCtx, skin, sheetLookup(assets), { onSound, size, ... })`
  is a `Presenter`. From Engine 0.16 T13b it is a thin wrapper over the core `SkinnedPresenter`
  ([engine/core/draw](engine-core-draw.md), shared with the PixiJS backend): it supplies the
  `CanvasRenderer` and offscreen canvases (`canvasSurface`, `surface.ts`) as the map and glyph
  surfaces; the drawing below is the core's, and the name, constructor and options are unchanged
  (`CanvasUiPainter` and `skinSetCanvasPresenter` wrap `RendererUiPainter` and
  `skinSetPresenter` the same way). It clears each frame to the skin's `background` (Engine 0.15, gap G36; black
  without one; a `background` option overrides it), caches the map per id and version, draws entities by layer then list order with
  skin frames (`resolveSkinFrame`, a kind's tag look first, by whole tag or, from Engine 0.15, tag prefix
  and whole-number range (gap M2); flipped by facing, a fallback box when art is missing, squash through
  `transformed()`; from Engine 0.16 T10 a PNG sheet's frame placed on the box by its `anchor`; from
  Engine 0.16 part B (T6) a state drawn from its cycle's own `sheet`, and map tiles with a `join`
  drawn with the frame their neighbours pick (`resolveTileFrame`), and (T7) the clear colour,
  parallax and tiles of the map shown from the skin's `themes` (`themedSkin`); from Engine 0.16 T2 per-frame timing, one-shots and `then`, and the cycles' frame
  events played through the skin's `events` like the frame's own; from Engine 0.16 T3 a kind's
  `blend: add` and `glow`, and particles from the skin's `emitters`, started by events' `emit` and
  run by kinds' `emit`, drawn in world space after the entities with `lighter` for `add` and
  shadow blur for `glow`; `reduceFlashing` tones additive ones down; a `seed` option; from Engine
  0.16 T4 camera effects from the skin's events, a trauma shake on both axes, a zoom punch about
  the camera's target and full-picture flashes (skipped with `reduceFlashing`), on the presenter's
  own clock, the `shakeScale` and `subPixelShake` options, `effectSettings` for a settings screen,
  `showHud(shown)` (Engine 0.16 part C T1: no HUD while the shell's title shows; the display and
  the skin set forward it), a map layer's anchored frames placed on their cell (decoration props),
  `onHitPause(ticks)` for an event's `hitPause`, and the skin's `parallax` layers drawn behind the
  map with the core `layoutParallax`; from Engine 0.16 part C T4 the skin's `lighting` (a
  `SkinLighting` from `@engine/core/fx`: placed lights' sprites over the map, then after the
  particles a picture-sized light map, option `lightSurface`, filled with the darkness and each
  light erased out of it as a radial gradient, laid over at the darkness level, the lights' glows
  added and the vignette, all before effects and the HUD; `Renderer.gradient`, implemented by
  `CanvasRenderer`; from Engine 0.16 polish P a skin's `lighting.dither` has the lights' fills
  drawn as `ditheredRadial`'s ordered-dither bytes through a scratch canvas, so a falloff shows no
  rings and every frame repeats byte for byte); from Engine 0.16 T5 `focus()`, the camera's target on the
  picture, where an iris transition closes), frames the camera through its own `CameraFollower` from
  `@engine/core/present` (the shared framing maths: hint or skin follow with a deadzone and
  integer lerp, clamped to the map or the hint's `bounds`, small maps centred; the follower
  instance lives in the presenter only), honours `zoom` (the hint's, else the skin's; the map
  copy, tiles, sprites and boxes are scaled, positions rounded to whole picture pixels, and the
  follower frames and clamps the zoomed view `cameraView(size, zoom)`), draws
  event effects and the HUD from `status` (from Engine 0.16 T6 a skin with UI kit items is laid
  out by `@engine/core/ui`'s `SkinHud` and painted by `CanvasUiPainter`, `ui-painter.ts`: fills,
  frame parts scaled for nine-slice panels, and glyphs from a strip of the font drawn once per
  colour; the `fonts` option, also on `canvasDisplay` and `skinSetCanvasPresenter`), and reports skin sounds through `onSound(id)` once per
  event (the skin entry from `resolveSkinEvent`, so `mini-game-end:pass` can have its own sound). Details in the folder's CLAUDE.md. Its speed on an RTS view is measured by
  `pnpm exec tsx tests/bench/rts-render/run.ts` (Engine 0.9 T3; numbers in the build log), and
  with every 0.16 feature on the RTS and tower-defense maps by `pnpm bench:features` (Engine 0.16
  T13, item 320: it missed the 60 fps bar there with glow, additive blending and 2000+ particles,
  so a PixiJS v8 backend follows, item 323). Options `maxParticles` (the particle cap, default 1024) and the `particleCount` getter came with it.

- `canvasDisplay`, `CanvasDisplayOptions` (`display.ts`, Engine 0.7): the page's 2D
  `BrowserDisplay` for `bootBrowserGame` (`@engine/core/shell`): viewport, renderer and a
  `SkinnedCanvasPresenter` with the game's skin (and one per mini game in `rounds`), fitted to
  the screen layout. From Engine 0.16 T5 it takes the shell's screen transition
  (`transition(view)`) and draws it over the backbuffer on `present` with `drawTransition`
  (`transition.ts`: a fade, a wipe's linear gradient with soft edges, an iris's even-odd hole on
  the main presenter's `focus()`).
- `skinSetCanvasPresenter`, `CanvasSkinSetOptions` (`skin-set.ts`, Engine 0.7 T9): one presenter
  over a game's skin and a skin per mini game, picked per frame by `status.miniGame`; each skin's
  `camera.clamp` says how it frames its map and its `background` what it clears to.

## Imports allowed

- `@engine/core/*`, files in this folder, and browser APIs (canvas, `window`).
- Never other backends, `engine/sim`, `engine/tools`, kits or games.

## How to test

`*.test.ts` here run in Node with `pnpm test` against a fake 2D context that records calls;
`presenter.test.ts` uses a recording `Renderer` with inline fixture frames and skin. They test the
shared walk in `@engine/core/draw` through this folder's wrappers.
`Viewport` needs a real DOM and is checked by running a game (`pnpm dev`); `display.test.ts`
checks `canvasDisplay` on fake canvases. `rts-camera.test.ts` checks that `RtsCamera`'s
`worldToScreen` / `screenToWorld` agree with this presenter's drawing at zoom 0.5, 1 and 2.
`presenter.test.ts`'s `lighting` block (Engine 0.16 part C T4) checks the light map's holes, its
order after the entities and before the HUD, glows and the vignette, states, placed sprites, event
flashes fading and with reduced flashing, the surface made once and on a resize, the flat box
without one and the same calls per seed. Its `world labels inside the picture` block (Engine
0.16 polish P6, gap M45) checks labels near the picture's edges moved inside it.
`transition.test.ts` (Engine 0.16 T5) checks `drawTransition`'s calls for each kind on a recording
context; `tests/browser/fx-lab.test.ts` shoots an iris, a wipe and a fade mid-transition.
