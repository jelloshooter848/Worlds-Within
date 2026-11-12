# engine/backends/pixi

The PixiJS v8 (WebGL) 2D backend (Engine 0.16 T13b, item 323): the same 2D picture as
`engine/backends/canvas2d`, drawn through PixiJS so the GPU batches it. The 2D feature benchmark
(`pnpm bench:features`, Engine 0.16 T13) found Canvas2D far short of the 16.7 ms p95 bar with
particles, additive blending and glow on; this backend is the answer. `pixi.js` is pinned to an
exact version in `package.json` and only this folder may import it (`PACKAGES` in
`config/layers.js`).

It holds `PixiRenderer` (`renderer.ts`, T13b-1), and from T13b-3 `PixiPresenter` (`presenter.ts`),
`PixiSurfaces` (`surface.ts`), `PixiUiPainter` (`ui-painter.ts`), `skinSetPixiPresenter`
(`skin-set.ts`), `drawTransition` (`transition.ts`) and `pixiDisplay` (`display.ts`); `index.ts`
exports them all and has no side effects of its own, so a page can `import('@engine/backends/pixi')`
only when it draws with PixiJS. The shell's backend choice is T13b-4; screenshots and the parity
test with Canvas2D T13b-5.

## PixiRenderer

`new PixiRenderer({ size, sheetSource?, backdrop? })` implements every method of the core `Renderer`
(`@engine/core/gfx/renderer`), optional ones included. The API stays immediate mode, but each call
adds a display object to `stage` (a PixiJS `Container`, the frame's display list) instead of
painting; a PixiJS renderer then renders `stage` (the display, T13b-3).

- Frames: `beginFrame()` empties `stage` and returns every object to its pool; a `clear(color)`
  outside any scope does the same first (what was drawn is covered anyway), then adds a
  picture-sized box. A `clear` inside a scope only adds the box there. With `backdrop: true`
  (T13b-7; the display's main renderer) a top-level `clear` with an opaque colour adds no box: it
  sets `backdrop` (0xRRGGBB, null after `beginFrame`) and whoever renders `stage` clears to it.
  On software GL a full-picture sprite costs a whole layer of fill; a GL clear costs nothing.
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
- Scopes (T13b-7): `clip` and `transform` are pooled containers that hold what `draw` adds;
  `clip` masks the container with a pooled `Graphics` rectangle (axis aligned, so PixiJS uses a
  scissor), `transform` sets position, rotation and scale and calls `draw(this)`. `alpha` and
  `blend` add no container: they are a running opacity (nested scopes multiply) and blend mode
  that every sprite, halo and text drawn inside takes as its own `alpha` (times its colour's
  alpha) and `blendMode` (`'add'` or `'normal'`). That is what PixiJS v8 does with a container's
  alpha and blend mode anyway (multiplied and inherited down to each renderable, no offscreen
  pass), so the picture is the same, and the core walk's translucent, additive particle is one
  sprite (two with a glow) instead of a container each. A `clear` inside any scope (`alpha` and
  `blend` too) adds a box there and starts no frame.
- Culling (T13b-7): outside every `transform` (where boxes are in local space), a box, sprite or
  line whose box, grown by the current glow's radius, lies wholly outside the picture (`size`) is
  not added. Particles and entities off the view cost nothing; what touches the picture by one
  pixel, or whose halo reaches into it, is kept.
- Glow: a pre-made soft halo texture (`glowHalo()`, `HALO_SIZE` texels, made once from bytes:
  no canvas) tinted the glow colour and stretched over each glowing box, sprite or line grown by
  `radius` on every side, added just behind it (with the scope's alpha and blend mode). Glow
  scopes are reused entries, so a glow per particle allocates nothing. It is cheaper than a PixiJS filter (a filter
  renders its scope to a texture and blurs it; the halo is one more sprite in the batch). The
  halo is an ellipse over the box, not the shape's outline: close to the canvas's `shadowBlur`
  on small particles and boxes, softer on large sprites.
- Radial gradients (Engine 0.16 part D, D1: a skin's `lighting`, part C T4): `gradient(fill)`
  draws one sprite of `radialTexture(stops)` (`GRADIENT_SIZE` texels, made from bytes, linear
  filtering; the stops' alphas clamped and divided by the largest, so one texture serves a
  light's every strength; cached by the rounded stops, at most 64 kept) over the circle's bounds,
  tinted the colour, its alpha the stops' peak times the scope's, blended `add` (`'add'`),
  `erase` (`'erase'`: a hole in the light map) or with the scope's mode. A `box` smaller than the
  circle's bounds that does not cover the picture clips it (a pooled mask); outside the circle
  nothing is drawn (the vignette's circle reaches the picture's corners). Culled like a box.
  A fill with `dither` (Engine 0.16 polish P, C1: a skin's `lighting.dither`) is instead one
  sprite at scale 1 and whole pixels of `ditheredRadial`'s alpha bytes (`@engine/core/fx`, the
  same bytes the Canvas2D backend puts), written as premultiplied white into a pooled
  `DitherStamp` (a `BufferImageSource`, nearest filtering, rounded up to 32 texels a side, its
  frame cut to the fill; one per dithered fill in the frame, reset by `beginFrame`, so a
  flickering light makes no new texture, and rewritten and uploaded only when its stamp changes:
  a steady light, which gets the same stamp each frame, uploads nothing), tinted and blended as above.

- Tinted sheets (T13b-3): a sheet whose `image` is a `TintedImage` (a texture and a colour) draws
  every sprite with that colour as `tint` (and its alpha as alpha); a sheet whose `image` is a
  PixiJS `Texture` (a `RenderTexture` surface) is cut from that texture's source. `sourceOf(sheet)`
  gives a sheet's one texture source, so surface renderers share the main renderer's.

## PixiPresenter, surfaces and the UI painter (T13b-3)

`new PixiPresenter(renderer, skin, sheets, opts?)` is the core `SkinnedPresenter`
(`@engine/core/draw`, the same walk Canvas2D's `SkinnedCanvasPresenter` draws through) on a
`PixiRenderer`: every option and method is the core's (`size`/`resize`, `onSound`, `background`,
`fonts`/`font`, `clamp`, `reduceFlashing`, `seed`, `shakeScale`, `subPixelShake`, `onHitPause`,
`maxParticles`, `particleCount`, `focus()`, `effectSettings`, `showHud`), with the same observable behaviour
(sounds once per frame number, hit-pause requests, particles, camera). Change how a feature draws
in `engine/core/draw`, never here. What it adds is its surfaces (`opts.surfaces`, default a new
`PixiSurfaces` on the renderer; `.surfaces` reads it):

- `PixiSurfaces.make(w, h)` is the `mapSurface` and `glyphSurface`: a `RenderTexture` and a fresh
  `PixiRenderer` drawing from the main renderer's sheet sources. The map is drawn on one once per
  id and version and copied as one sprite each frame. What a surface draws waits (`waiting`) until
  `flush(gpu)` renders its display list into the texture once and lets it go; the display flushes
  before each picture. In Node nothing flushes, and tests read `waiting`. Old map textures are not
  destroyed (one per map version a page shows).
- `PixiSurfaces.makeLive(w, h)` is the `lightSurface` (Engine 0.16 part D, D1): the skin's
  lighting's light map, drawn again every lit frame, so each `flush` renders what it was given
  since the last one (a surface not drawn keeps its picture).
- `PixiSurfaces.tint` is the core UI painter's `tintGlyphs`: each font's glyphs are drawn once in
  white, and a colour's strip is that texture as a `TintedImage` (sprite tint), not another
  texture per colour.
- `PixiUiPainter(renderer, sheets, fonts, surfaces?)` is the core `RendererUiPainter` with those
  surfaces and tint (the shell's menus); `skinSetPixiPresenter(renderer, opts, surfaces?)` is the
  core `skinSetPresenter` with a `PixiPresenter` per skin, sharing the surfaces.

## pixiDisplay (T13b-3)

`await pixiDisplay(canvas, opts)` gives the shell's `BrowserDisplay`, or a sentence (string) when
WebGL cannot start (as `threeDisplay`). `opts` (`PixiDisplayOptions`) are Canvas2D's
`CanvasDisplayOptions`: `screen`, `skin` (the game's `canvas2d` skin), `rounds`, `sheet`, `fonts`,
`background`, `integerScale`, `onSound`, `onHitPause`. It starts PixiJS v8's `autoDetectRenderer`
with WebGL only (`preference: ['webgl']`: a string preference would fall back to WebGPU or
PixiJS's canvas renderer), antialias off, `failIfMajorPerformanceCaveat: false` (software WebGL
such as SwiftShader is allowed, as the 3D view is), resolution 1, then `pixiDisplayOn(gpu, canvas,
opts)` builds the display (a test passes a recording `DisplayGpu`):

- `renderer` is a `PixiRenderer`; `presenter` the game's `PixiPresenter` and one per round, all on
  it and sharing one `PixiSurfaces`.
- `present()`: flush the surfaces; draw the transition (`transitionShape` with the main
  presenter's `focus()`) on a `Graphics` over the stage; then the picture (the stage and the
  cover), cleared to the renderer's `backdrop` (black when the frame has none), placed by `fitGame`
  (the screen layout's `fit`, `integerScale`) on black, as Canvas2D's `Viewport`. The stage is
  kept after `present`: a top-level `clear` (the presenter's first call) starts the next frame, so
  a frame that draws nothing shows the last picture.
- `upscale` (T13b-7): with `'page'` (default) the drawing buffer is the canvas's device size over
  `s`, the whole part of the picture's scale (`ceil`, at least 1), the display sets the canvas's
  `image-rendering: pixelated`, and the browser stretches the canvas back up by `s`. At a
  whole-number scale (`integerScale`, or a window that happens to fit) the picture is rendered
  straight onto the canvas at its own size, with black bars as one `Graphics` round it; otherwise
  it goes into a backbuffer `RenderTexture` at the `screen` size, shown as one nearest-neighbour
  sprite at the remaining scale (`scale / s`). The picture's offset is rounded to whole buffer
  pixels, so it may sit up to `s - 1` device pixels from where Canvas2D puts it. `toScreen` and
  `toClient` map through the buffer (buffer px per CSS px, measured on each `fit`). With `'gl'`
  `s` is 1: a full-size buffer, the backbuffer scaled by WebGL (T13b-3's path). Why: on software
  GL (SwiftShader) every textured pixel WebGL fills costs about 0.1 µs, so a full 1280 x 960 quad
  costs over 100 ms a frame where a 320 x 240 one costs about 10 ms; on a GPU both are cheap, and
  the browser's compositor scales a canvas for free either way. A screenshot canvas at the
  picture's size has `s` = 1 and is drawn directly, so its bytes are as before.
- `drawTransition(graphics, shape, screen)` matches Canvas2D's (`transitionAlphaAt` per pixel):
  fade one box at its alpha; wipe one opaque box and a 1 px band per pixel of each soft edge
  (no gradient texture); iris the picture covered with the circle `cut()` as a hole.
- `preserveDrawingBuffer` (T13b-5, default false) keeps the canvas's drawing buffer after each
  picture, so a tool reads it back with `toDataURL` at any time (the screenshot page sets it).
- `seed` and `maxParticles` (T13b-6) go to the main presenter (the feature benchmark sets 6000
  particles), and the display (`PixiDisplay`) gives that presenter as `main`, so a tool reads its
  `particleCount` (`presenter` is the skin set's, which has none).
- `uiPainter()` is one `PixiUiPainter` (made once, so glyph strips are drawn once);
  `effectSettings` reaches every presenter; `toScreen`/`toClient` are the `Viewport`'s maths;
  `fit(layout)` resizes the drawing buffer to the canvas's CSS size times `devicePixelRatio`.

## Screenshots and visual parity (T13b-5)

- `pnpm -s cli screenshot <run> --tick N --backend pixi --json` draws a run's tick through
  `pixiDisplay` with the game's `canvas2d` skins (the view's `frame()`, presented once per tick)
  and writes the PNG; the result's `backend` is `pixi` and `renderer` the WebGL renderer string.
  Chromium runs on SwiftShader for it (software WebGL is fine for 2D, not refused as for 3D), so
  two runs give the same bytes.
- `pnpm -s cli sheet <run> --ticks "120@canvas2d,120@pixi" --columns 2 --json` puts both 2D
  backends side by side (labels `[2D]` and `[PixiJS]`). Overlays on a PixiJS tile use this
  backend's `PixiUiPainter` and transition pass.
- `tests/browser/pixi-parity.test.ts` compares Canvas2D and PixiJS pictures of the same ticks of
  the fx lab, the RTS skirmish and the tower defense, effects on, with a fade, a wipe and the pause
  menu. Tolerance (a pixel differs when R, G or B differs by more than the threshold): where
  nothing glows (RTS, TD; the fx lab's top half) threshold 8 and at most 0.1% of the pixels; the
  fx lab as a whole threshold 32 and at most 1%, because the glow here is a stretched halo sprite
  and Canvas2D's is `shadowBlur`. The iris is not compared (it closes on the camera's focus here,
  on the picture's centre in the page's Canvas2D tile). A change that moves the picture must keep
  this test green; if a looser bound is needed, say why in this file and in
  `engine/tools/CLAUDE.md` (Visual parity).

## Performance: the 2D feature benchmark (T13b-6)

`pnpm bench:features` (`tests/bench/feature-render/`) draws the RTS and tower-defense feature
scenes through `pixiDisplay` beside Canvas2D: same skin, units, seed, zooms 0.5/1/2, features on
and plain, `--ablate` per backend, `--shots` per-backend PNGs. Each result names its `backend`;
the machine block names the WebGL renderer and `software` when it is a software GL. Rerun with:

    pnpm bench:features                               # both backends
    pnpm bench:features --backends pixi --ablate      # this backend, and what each feature costs

First numbers (`docs/BUILD-LOG.md`, T13, 2026-11-10) are from a container with no GPU, where
WebGL is SwiftShader (software GL on the CPU): the draw call (display list and GL submission) was
17-40 ms p50 with the features on, 5-10 times less than Canvas2D's, but whole frames were 124-204
ms p50 even plain, the cost of software GL filling a 1280 x 960 canvas. The tuning pass (T13b-7,
same log) found that cost was the full-size backbuffer quad and the background sprite, made the
browser do the whole-number upscale (`upscale`), the background a GL clear (`backdrop`), dropped
the container per translucent or additive particle, culled what is off the picture, and made the
core's particle colour keyframes allocation-free: frames with the features on went from 122-210
ms p95 to 34-72 ms, plain from 74-90 to 14-34 ms (TD plain at zoom 0.5 holds the bar), and the
draw call from 11-25 to 5-8 ms p50. What remains on SwiftShader is fill (about 10 ms per
picture-sized layer: map, parallax, glow halos); judge the 16.7 ms p95 bar on a machine with a
GPU. Rerun after changing how sprites, particles, glow, blending or the backbuffer are drawn.

## Imports

- Allowed: `@engine/core/*`, files in this folder, `pixi.js`, browser APIs.
- Never: other backends (`canvas2d`, `three`, `null`), `engine/sim`, `engine/tools`, kits or games.
- Draw only what the caller asks for: no game rules here.

## Testing

`presenter.test.ts` checks the display list `PixiPresenter` leaves on fixture frames and skins
(inline; never a kit or game skin): the map cached on a surface and copied as one sprite,
animation frames by their ticks, additive glowing particles and a kind's blend and glow (halo
behind each), parallax before the map before the entities, a spawn tween's transform container,
flash and tint overlays (and reduced flashing), the UI kit HUD with one white glyph strip tinted
per colour, the skin set, and sounds, hit-pauses, particle counts and focus equal to the core
presenter on another renderer, and (Engine 0.16 polish P6, gap M45) world labels near the
picture's edges moved inside it as on the canvas. `transition.test.ts` checks the transition `Graphics` against
`transitionAlphaAt` per pixel; `display.test.ts` the display's passes, letterbox, pointer maths,
transition and UI painter on a recording `DisplayGpu`, both `upscale` paths and the backdrop
clear colour. `tests/browser/pixi-display.test.ts` builds
a page that imports this backend, starts `pixiDisplay` in headless Chromium (SwiftShader) and reads
the canvas back (skipped without a browser).

`*.test.ts` here run in Node. `pixi.js` imports and builds display objects (containers, sprites,
graphics, text, textures) in Node with no DOM adapter and no fake: nothing renders, so no
`DOMAdapter` is set. If a later test needs one (a renderer, text measuring), set PixiJS's
`DOMAdapter` in that test and say so here. `renderer.test.ts` checks the display list a recorded
set of calls builds: object counts, positions, sizes, tints, alpha, blend modes, the halo sprites
of a glow, the mask of a clip and the nesting of transforms and scopes; quarter turns and flips
against the same texel table as `canvas2d/renderer.test.ts`; and that the pools hand back the same
objects frame after frame, reset. Its dithered block (polish P) checks a dithered fill's sprite
(whole-pixel place and size, blend, tint), its texture holding `ditheredRadial`'s bytes, reused and
resized next frame and byte-identical for the same fill, and not uploaded again for a steady one.
