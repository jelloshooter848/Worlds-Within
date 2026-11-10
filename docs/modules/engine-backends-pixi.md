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

The presenter, the page's display and the shell's backend choice come with later tasks (T13b-2
to T13b-4).

## Imports allowed

`@engine/core/*`, files in this folder, `pixi.js` and browser APIs. Never another backend,
`engine/sim`, `engine/tools`, a kit or a game.

## How to test

`pnpm test` runs `engine/backends/pixi/*.test.ts` in Node: `pixi.js` builds display objects there
without a DOM adapter. `renderer.test.ts` checks the display list built for recorded calls (object
counts, positions, tints, alpha, blend modes, glow halos, clip masks, nesting for transforms), the
sprite turns and flips against the canvas renderer's texel table, and that the pools reuse the
same objects frame after frame.
