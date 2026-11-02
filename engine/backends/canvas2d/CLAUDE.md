# engine/backends/canvas2d

The browser backend for 2D: `CanvasRenderer` (`renderer.ts`) draws the core `Renderer` contract
onto a 2D canvas context, and `Viewport` (`viewport.ts`) owns the 256x240 backbuffer and presents it
on the display canvas, scaled and letterboxed. `index.ts` exports both. The fit maths it uses
(`fitGame`, `SCREEN_W`, `SCREEN_H`) lives in `engine/core/gfx/screen.ts`, because the touch layout
needs it too.

## Imports

- Allowed: `@engine/core/*`, files in this folder, browser APIs (canvas, `window`).
- Never: other backends, `engine/sim`, `engine/tools`, kits or games.
- Draw only what the caller asks for: no game rules here.

## Testing

`*.test.ts` here run in Node against a fake 2D context that records calls and maps points through
the transform (see `renderer.test.ts`). `Viewport` needs a real DOM and is checked by running a game.
