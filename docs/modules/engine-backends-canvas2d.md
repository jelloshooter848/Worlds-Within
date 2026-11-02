# engine/backends/canvas2d

Folder: `engine/backends/canvas2d`. Detailed rules:
[`engine/backends/canvas2d/CLAUDE.md`](../../engine/backends/canvas2d/CLAUDE.md).

## Purpose

The browser backend for 2D. It draws the core `Renderer` contract onto a 2D canvas and presents the
256x240 backbuffer on the display canvas, scaled and letterboxed. It draws only what the caller asks
for and holds no game rules.

## Public API entry points

`index.ts`, imported as `@engine/backends/canvas2d`:

- `CanvasRenderer` (`renderer.ts`): the `Renderer` implementation for a 2D context.
- `Viewport`, `ViewportOptions` (`viewport.ts`): owns the backbuffer and presents it.

## Imports allowed

- `@engine/core/*`, files in this folder, and browser APIs (canvas, `window`).
- Never other backends, `engine/sim`, `engine/tools`, kits or games.

## How to test

`*.test.ts` here run in Node with `pnpm test` against a fake 2D context that records calls.
`Viewport` needs a real DOM and is checked by running a game (`pnpm dev`).
