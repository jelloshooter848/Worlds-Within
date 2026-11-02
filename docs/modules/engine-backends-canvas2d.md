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

- `CanvasRenderer` (`renderer.ts`): the `Renderer` implementation for a 2D context.
- `Viewport`, `ViewportOptions` (`viewport.ts`): owns the backbuffer and presents it.
- `SkinnedCanvasPresenter`, `SkinnedPresenterOptions`, `MapSurface` (`presenter.ts`):
  `new SkinnedCanvasPresenter(rendererOrCtx, skin, sheetLookup(assets), { onSound, size, ... })`
  is a `Presenter`. It caches the map per id and version, draws entities by layer then list order with
  skin frames (flipped by facing, a fallback box when art is missing, squash through
  `transformed()`), frames the camera through its own `CameraFollower` from
  `@engine/core/present` (the shared framing maths: hint or skin follow with a deadzone and
  integer lerp, clamped to the map or the hint's `bounds`, small maps centred; the follower
  instance lives in the presenter only), honours `zoom` (the hint's, else the skin's; the map
  copy, tiles, sprites and boxes are scaled, positions rounded to whole picture pixels, and the
  follower frames and clamps the zoomed view `cameraView(size, zoom)`), draws
  event effects and the HUD from `status`, and reports skin sounds through `onSound(id)` once per
  event. Details in the folder's CLAUDE.md.

- `canvasDisplay`, `CanvasDisplayOptions` (`display.ts`, Engine 0.7): the page's 2D
  `BrowserDisplay` for `bootBrowserGame` (`@engine/core/shell`): viewport, renderer and a
  `SkinnedCanvasPresenter` with the game's skin (and one per mini game in `rounds`), fitted to
  the screen layout.
- `skinSetCanvasPresenter`, `CanvasSkinSetOptions` (`skin-set.ts`, Engine 0.7 T9): one presenter
  over a game's skin and a skin per mini game, picked per frame by `status.miniGame`; each skin's
  `camera.clamp` says how it frames its map.

## Imports allowed

- `@engine/core/*`, files in this folder, and browser APIs (canvas, `window`).
- Never other backends, `engine/sim`, `engine/tools`, kits or games.

## How to test

`*.test.ts` here run in Node with `pnpm test` against a fake 2D context that records calls;
`presenter.test.ts` uses a recording `Renderer` with inline fixture frames and skin.
`Viewport` needs a real DOM and is checked by running a game (`pnpm dev`); `display.test.ts`
checks `canvasDisplay` on fake canvases.
