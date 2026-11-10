# engine/backends/pixi

Folder: `engine/backends/pixi`. Detailed rules:
[`engine/backends/pixi/CLAUDE.md`](../../engine/backends/pixi/CLAUDE.md).

## Purpose

The PixiJS v8 (WebGL) 2D backend (Engine 0.16 T13b, item 323): the same 2D picture as the Canvas2D
backend, drawn through PixiJS so the GPU batches it, because Canvas2D missed the 60 fps bar with
the 0.16 features on (`pnpm bench:features`, Engine 0.16 T13). It is the only folder that may import
`pixi.js` (pinned in `package.json`; `PACKAGES` in `config/layers.js`). It draws only what the caller
asks for and holds no game rules.

## Public API entry points

`index.ts`, imported as `@engine/backends/pixi`:

- `PixiRenderer`, `PixiRendererOptions` (`renderer.ts`): `new PixiRenderer({ size, sheetSource? })`
  implements the core `Renderer` contract (`clear`, `rect`, `sprite` with flips, quarter turns and
  scale, `text`, `debugText`, `line`, `clip`, `alpha`, `blend` with `add` as PixiJS's
  `blendMode = 'add'`, `glow`, `transform`) as an immediate-mode API over a retained display list:
  `stage`, the frame's root `Container`, filled from pools of sprites, containers, mask graphics
  and texts that are reused every frame. `beginFrame()` (or a top-level `clear`) starts a frame;
  `pools()` reports the pool counts.
- `sheetSource`, `SheetSourceFactory`: the default texture source of a sheet (its image, or an
  empty source for a headless sheet); sheet frames are cached `Texture` sub-rectangles of it.
- `glowHalo()`, `HALO_SIZE`: the glow's pre-made soft halo texture, tinted and stretched behind
  each glowing shape (cheaper than a filter).
- `PoolCounts`: the pool counts' shape.

- `TintedImage`: a sheet `image` (a texture and a colour) drawn with that sprite tint; a sheet
  whose `image` is a PixiJS `Texture` is cut from it. `PixiRenderer.sourceOf(sheet)`.
- `PixiPresenter`, `PixiPresenterOptions` (`presenter.ts`, T13b-3): `new PixiPresenter(renderer,
skin, sheets, opts?)`, the core `SkinnedPresenter` (`@engine/core/draw`) on a `PixiRenderer`,
  with Canvas2D's options and behaviour (`size`/`resize`, `onSound`, `background`, `fonts`/`font`,
  `clamp`, `reduceFlashing`, `seed`, `shakeScale`, `subPixelShake`, `onHitPause`, `maxParticles`,
  `particleCount`, `focus()`, `effectSettings`), the map cached on a `RenderTexture` and glyphs
  tinted by sprite tint (`opts.surfaces`).
- `PixiSurfaces` (`surface.ts`): `make(w, h)` (a `RenderTexture` surface), `tint` (the UI
  painter's `tintGlyphs`), `waiting`, `flush(gpu)`; `SurfaceTarget`, `PendingSurface`.
- `PixiUiPainter` (`ui-painter.ts`) and `skinSetPixiPresenter` (`skin-set.ts`): the core UI
  painter and skin-set presenter on the renderer and shared surfaces.
- `drawTransition(graphics, shape, screen)` (`transition.ts`): fade, wipe and iris on a PixiJS
  `Graphics`, matching Canvas2D's per pixel.
- `pixiDisplay(canvas, opts)` (`display.ts`): async; a `BrowserDisplay` (renderer, presenter,
  fit, present, toScreen, toClient, transition, uiPainter, effectSettings) on a WebGL-only PixiJS
  renderer, the picture rendered into a backbuffer at the game's `screen` size and shown scaled and
  letterboxed like Canvas2D's `Viewport`; or a sentence when WebGL cannot start.
  `PixiDisplayOptions` are Canvas2D's `CanvasDisplayOptions`, plus `preserveDrawingBuffer` (T13b-5:
  keep the canvas readable after each picture, for `pnpm cli screenshot --backend pixi`) and
  `seed` and `maxParticles` for the main presenter (T13b-6, the feature benchmark). The result is a
  `PixiDisplay`: the `BrowserDisplay` plus `main`, the game's own `PixiPresenter` (its
  `particleCount`). `pixiDisplayOn(gpu, canvas, opts)` builds it on a started renderer
  (`DisplayGpu`). `index.ts` has no side effects at import.

The shell's backend choice comes with T13b-4.

## Imports allowed

`@engine/core/*`, files in this folder, `pixi.js` and browser APIs. Never another backend,
`engine/sim`, `engine/tools`, a kit or a game.

## How to test

`pnpm test` runs `engine/backends/pixi/*.test.ts` in Node: `pixi.js` builds display objects there
without a DOM adapter. `renderer.test.ts` checks the display list built for recorded calls (object
counts, positions, tints, alpha, blend modes, glow halos, clip masks, nesting for transforms), the
sprite turns and flips against the canvas renderer's texel table, and that the pools reuse the
same objects frame after frame. `presenter.test.ts` checks every 0.16 part A feature through the
display list `PixiPresenter` leaves (animation frames, add blend, glow halos, parallax order,
tweens, flash and tint overlays, the UI HUD's tinted glyphs, the cached map) and that its sounds,
hit-pauses, particle counts and focus equal the core presenter's; `transition.test.ts` and
`display.test.ts` the transitions and the display on a recording renderer.
`tests/browser/pixi-display.test.ts` starts `pixiDisplay` in headless Chromium and reads the
canvas back (skipped without a browser). Screenshots and parity (T13b-5): `pnpm cli screenshot
<run> --tick N --backend pixi` draws a run's tick through `pixiDisplay` (its result names the
WebGL renderer), `pnpm cli sheet` takes `@pixi` tiles (`120@canvas2d,120@pixi` side by side), and
`tests/browser/pixi-parity.test.ts` compares Canvas2D and PixiJS pictures of the fx lab, the RTS
and the tower defense with a stated tolerance: threshold 8 and 0.1% of the pixels where nothing
glows, threshold 32 and 1% for the fx lab's glow and additive particles (see
`engine/tools/CLAUDE.md`, Visual parity).

## Performance

`pnpm bench:features` measures this backend beside Canvas2D on the RTS and tower-defense feature
scenes (`--backends canvas2d,pixi`, default both; T13b-6). First numbers, from a container with no
GPU (WebGL on SwiftShader), are in `docs/BUILD-LOG.md` (Engine 0.16 part A, T13).
