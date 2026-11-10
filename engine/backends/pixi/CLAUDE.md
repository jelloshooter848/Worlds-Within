# engine/backends/pixi

The PixiJS v8 (WebGL) 2D backend (Engine 0.16 T13b, item 323): the same 2D picture as
`engine/backends/canvas2d`, drawn through PixiJS so the GPU batches it. The 2D feature benchmark
(`pnpm bench:features`, Engine 0.16 T13) found Canvas2D far short of the 16.7 ms p95 bar with
particles, additive blending and glow on; this backend is the answer. `pixi.js` is pinned to an
exact version in `package.json` and only this folder may import it (`PACKAGES` in
`config/layers.js`).

So far (T13b-1) it holds `PixiRenderer` (`renderer.ts`); `index.ts` exports it. The presenter, the
page's display and the shell's backend choice come in later tasks (T13b-2 to T13b-4).

## PixiRenderer

`new PixiRenderer({ size, sheetSource? })` implements every method of the core `Renderer`
(`@engine/core/gfx/renderer`), optional ones included. The API stays immediate mode, but each call
adds a display object to `stage` (a PixiJS `Container`, the frame's display list) instead of
painting; a PixiJS renderer then renders `stage` (the display, T13b-3).

- Frames: `beginFrame()` empties `stage` and returns every object to its pool; a `clear(color)`
  outside any scope does the same first (what was drawn is covered anyway), then adds a
  picture-sized box. A `clear` inside a scope only adds the box there.
- Pools: sprites, containers, mask `Graphics` and debug `Text`s come from free lists and are
  reused frame after frame (`pools()` reports used and made counts), so a steady scene allocates
  nothing. Every object is reset when taken; never keep a reference across frames.
- Boxes (`rect`, `clear`) and lines are sprites of `Texture.WHITE` (1x1) tinted the colour (a
  colour's own alpha becomes the sprite's alpha), so they batch with sprites. `rect` and sprite
  positions are whole pixels (`| 0`) as on the canvas; a line runs from pixel centre to pixel
  centre, 1 px wide (anchor `(0, 0.5)`, turned by `atan2`).
- Sprites: each frame is a cached `Texture` sub-rectangle of one `TextureSource` per sheet
  (`WeakMap` by sheet). The default source (`sheetSource`) wraps `sheet.image` in an
  `ImageSource` with nearest-neighbour scaling, or, for a headless sheet (no image), an empty
  source the size of its frames. Flips, quarter turns and `scale` match `CanvasRenderer`
  exactly: the sprite's anchor is its centre, placed at the centre of the (turned) box, with the
  flip as a negative scale, which is the canvas's translate-rotate-flip matrix. Frame `anchor`s
  (PNG sheets) are applied by the presenter (`anchorOffset`), not here, as on the canvas.
- `text` is one sprite per glyph, 8 px apart (as the canvas). `debugText` is a pooled PixiJS
  `Text` (8 px monospace) whose top sits 7 px above `y` (the canvas's baseline); debug only.
- Scopes are pooled containers that hold what `draw` adds: `alpha` sets the container's alpha
  (nested scopes multiply), `blend('add')` sets `blendMode = 'add'` (its children keep
  `inherit`), `clip` masks the container with a pooled `Graphics` rectangle (axis aligned, so
  PixiJS uses a scissor), `transform` sets position, rotation and scale and calls `draw(this)`.
- Glow: a pre-made soft halo texture (`glowHalo()`, `HALO_SIZE` texels, made once from bytes:
  no canvas) tinted the glow colour and stretched over each glowing box, sprite or line grown by
  `radius` on every side, added just behind it. It is cheaper than a PixiJS filter (a filter
  renders its scope to a texture and blurs it; the halo is one more sprite in the batch). The
  halo is an ellipse over the box, not the shape's outline: close to the canvas's `shadowBlur`
  on small particles and boxes, softer on large sprites.

## Imports

- Allowed: `@engine/core/*`, files in this folder, `pixi.js`, browser APIs.
- Never: other backends (`canvas2d`, `three`, `null`), `engine/sim`, `engine/tools`, kits or games.
- Draw only what the caller asks for: no game rules here.

## Testing

`*.test.ts` here run in Node. `pixi.js` imports and builds display objects (containers, sprites,
graphics, text, textures) in Node with no DOM adapter and no fake: nothing renders, so no
`DOMAdapter` is set. If a later test needs one (a renderer, text measuring), set PixiJS's
`DOMAdapter` in that test and say so here. `renderer.test.ts` checks the display list a recorded
set of calls builds: object counts, positions, sizes, tints, alpha, blend modes, the halo sprites
of a glow, the mask of a clip and the nesting of transforms and scopes; quarter turns and flips
against the same texel table as `canvas2d/renderer.test.ts`; and that the pools hand back the same
objects frame after frame, reset.
