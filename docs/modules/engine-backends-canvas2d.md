# engine/backends/canvas2d

Folder: `engine/backends/canvas2d`. Detailed rules:
[`engine/backends/canvas2d/CLAUDE.md`](../../engine/backends/canvas2d/CLAUDE.md).

## Purpose

The browser backend for 2D. It draws the core `Renderer` contract onto a 2D canvas and presents the
backbuffer, sized to the game's picture (`screen` in `game.json`, 256x240 by default), on the
display canvas, scaled and letterboxed. It also implements the presentation contract: it draws any
`PresentFrame` (`@engine/core/present`) through a skin. It draws only what the caller asks
for and holds no game rules.

## Public API entry points

`index.ts`, imported as `@engine/backends/canvas2d`:

- `CanvasRenderer` (`renderer.ts`): the `Renderer` implementation for a 2D context (with the
  optional `blend` and `glow` of Engine 0.16 T3).
- `Viewport`, `ViewportOptions` (`viewport.ts`): owns the backbuffer and presents it.
- `SkinnedCanvasPresenter`, `SkinnedPresenterOptions`, `MapSurface` (`presenter.ts`):
  `new SkinnedCanvasPresenter(rendererOrCtx, skin, sheetLookup(assets), { onSound, size, ... })`
  is a `Presenter`. It clears each frame to the skin's `background` (Engine 0.15, gap G36; black
  without one; a `background` option overrides it), caches the map per id and version, draws entities by layer then list order with
  skin frames (`resolveSkinFrame`, a kind's tag look first, by whole tag or, from Engine 0.15, tag prefix
  and whole-number range (gap M2); flipped by facing, a fallback box when art is missing, squash through
  `transformed()`; from Engine 0.16 T2 per-frame timing, one-shots and `then`, and the cycles' frame
  events played through the skin's `events` like the frame's own; from Engine 0.16 T3 a kind's
  `blend: add` and `glow`, and particles from the skin's `emitters`, started by events' `emit` and
  run by kinds' `emit`, drawn in world space after the entities with `lighter` for `add` and
  shadow blur for `glow`; `reduceFlashing` tones additive ones down; a `seed` option; from Engine
  0.16 T4 camera effects from the skin's events, a trauma shake on both axes, a zoom punch about
  the camera's target and full-picture flashes (skipped with `reduceFlashing`), on the presenter's
  own clock, the `shakeScale` and `subPixelShake` options, `effectSettings` for a settings screen,
  `onHitPause(ticks)` for an event's `hitPause`, and the skin's `parallax` layers drawn behind the
  map with the core `layoutParallax`; from Engine 0.16 T5 `focus()`, the camera's target on the
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
  `pnpm exec tsx tests/bench/rts-render/run.ts` (Engine 0.9 T3; numbers in the build log).

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
`presenter.test.ts` uses a recording `Renderer` with inline fixture frames and skin.
`Viewport` needs a real DOM and is checked by running a game (`pnpm dev`); `display.test.ts`
checks `canvasDisplay` on fake canvases. `rts-camera.test.ts` checks that `RtsCamera`'s
`worldToScreen` / `screenToWorld` agree with this presenter's drawing at zoom 0.5, 1 and 2.
`transition.test.ts` (Engine 0.16 T5) checks `drawTransition`'s calls for each kind on a recording
context; `tests/browser/fx-lab.test.ts` shoots an iris, a wipe and a fade mid-transition.
