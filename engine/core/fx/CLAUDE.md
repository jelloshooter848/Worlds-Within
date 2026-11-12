# engine/core/fx

Presentation effects' foundation (docs/ROADMAP.md, Engine 0.16 part A, T1): the deterministic,
presentation-only pieces every later effect (sprite animation, particles, camera effects,
transitions, the UI kit, the audio mixer's variation) builds on. Pure: no DOM, no clock; every
value is a function of the run seed and the presentation frame number, so a screenshot at a tick
is byte-stable and presenting never changes the state.

- `rng.ts`: `fxRng(seed, frame, stream)`, a fresh `Rng` (`../rng.ts`) for one presentation frame
  and one named stream (`Rng.derived(seed, 'fx:<frame>:<stream>')`). It never reads or moves a
  world RNG; streams are independent (drawing from `sparks` never changes `dust`); a frame that is
  not a whole number throws. `fxRange(rng, lo, hi)` is a float in `[lo, hi)`.
- `ease.ts`: `EASE_NAMES` (`linear`; `quad`, `cubic`, `quart`, `sine`, `back`, `elastic` and
  `bounce`, each `In`, `Out` and `InOut`; `step`), `ease(name, t)` (default `linear`; `t` clamped
  to [0, 1]; 0 gives 0 and 1 gives 1 exactly for every curve, `back` and `elastic` overshoot
  between; `step` is 0 until 1) and `isEaseName`.
- `color.ts`: `parseHexColor('#rgb' | '#rrggbb')` (null for anything else) and
  `lerpColor(a, b, t)` (`#rrggbb`, channels rounded and clamped, so an overshooting ease stays a
  colour). It runs per particle per frame, so it keeps the colours it has parsed (up to 1024)
  and builds its text from a byte table (Engine 0.16 T13b-7); same output as before.
- `schema.ts`: tween specs as text, `tweenSpecSchema` (a union on `prop`) and `tweensSchema` (one
  spec or a non-empty list): `{ prop, from?, to, frames, delay?, ease?, yoyo?, repeat?, amount? }`.
  `prop` is `x`/`y` (world px added), `scale`/`scaleX`/`scaleY`/`alpha` (factors multiplied),
  `rotate` (degrees added) or `color` (an overlay colour; `from`/`to` are `#rgb`/`#rrggbb`,
  `amount` 0-1 its strength, default `TWEEN_DEFAULT_AMOUNT` 0.5; `amount` on a numeric prop is an
  error). A numeric `from` defaults to the rest value (`TWEEN_REST`: 0, or 1 for factors), a
  colour's to `#ffffff`. `frames` (>= 1) is one play; `delay` holds `from`; `yoyo` goes to `to`
  and back each play; `repeat` is extra plays or `forever`. A bad ease, prop or colour is an error
  at that field (`events.hit.tween.ease`).
- `tween.ts`: `Tween(spec, start, onDone?)` (`length`, `done(frame)`, `progress(frame)`,
  `value(frame)`, `applyTo(state, frame)`) and `TweenSet` (`add(specs, start, onDone?)`,
  `update(frame)` drops ended tweens and calls each one's `onDone` once, `state(frame)` combines
  the running ones into a `TweenState` `{ x, y, scaleX, scaleY, rotate, alpha, color, colorAmount }`:
  offsets add, factors multiply, the last colour wins; `REST_STATE` changes nothing). A tween that
  ended stops counting, so the thing goes back to its own look. Repeating without `yoyo` starts
  each play from 0.
- `schema.ts` (Engine 0.16 T3) also holds `emitterSchema` (`EmitterDef`, `EMITTER_DEFAULTS`):
  one particle emitter as text, `{ burst?, rate?, duration?, life?, speed?, angle?, even?,
gravity?, drag?, shape?, offset?, anchor?, follow?, size?, color?, alpha?, frame?, sheet?,
blend?, glow?, max? }`. Units are world px and presentation frames. `life`, `speed` and `angle`
  are a number or `[min, max]` (each particle draws its own). `angle` is degrees, 0 right, 90
  down, 270 up (default `[0, 360]`); `even` spreads a burst evenly across it (a ring). `gravity`
  is px/frame added to the downward speed each frame, `drag` (0-1) the share of speed lost each
  frame. `shape` is `point`, `{ circle: r }` or `{ box: { w, h } }`. `size`, `color` and `alpha`
  are keyframes over a particle's life (`Keyframes<T>`): one value, a list spaced evenly from
  birth to death, or `{ at, value }` stops (at 0-1, ascending). `frame`/`sheet` (2D) draw a
  sprite frame scaled by `size` instead of a square; `blend` is `normal` or `add`; `glow` (2D) a
  blur radius. `max` (default 64) caps one running emitter's live particles. `anchor` (`centre`,
  `feet`, `top`) and `offset` place it on an entity; `follow` keeps an event's emitter on its
  entity; `rate` emitters started by an event run `duration` frames (default 20).
- `particles.ts` (Engine 0.16 T3): `ParticleSystem({ seed?, max? })`, pure and fixed-step.
  `emit(name, def, at, frame, follow?)` starts an emitter at a world point (its `burst` on that
  frame, its `rate` for `duration`), `attach(id, name, def, box, frame)` keeps one running on
  an entity (idempotent per id and name; stops spawning the first frame `locate` no longer finds
  the entity, its particles finish), `update(frame, locate?)` steps every frame since the last
  one (at most `PARTICLE_CATCH_UP`, 240; a repeated frame does nothing, an earlier one clears the
  system: a new level), and `particles()` gives `ParticleView`s `{ emitter, x, y (centre), size,
color, alpha, blend, glow, frame?, sheet?, age, life }`. Draws come from
  `fxRng(seed, frame, 'particles:<emitter key>')`, one stream per running emitter per frame, five
  numbers per particle whatever the def, so the same seed and calls give the same particles.
  Positions are a closed form of age (start point and velocity, `drag`, `gravity`), so stepping
  frame by frame or skipping lands in the same place. Caps: each emitter's `max` and the
  system's `max` (`PARTICLE_SYSTEM_MAX`, 1024); a spawn over a cap is skipped (never replaces).
  `keyframeAt(keys, t, lerp)` and `anchorPoint(box, anchor)` are the pure helpers; `keyframeAt`
  reads the keyframes in place (no array per call: it runs three times per particle per frame).
- `skin-particles.ts` (Engine 0.16 T3): `SkinParticles(skin, { seed?, max? })`, the part both
  backends share. `event(entry, ev, entities, frame)` starts an event entry's `emit` (at the
  event's `x`/`y`, else its entity's centre, or the emitter's `anchor` on the entity when it
  gives one; following the entity when the emitter says `follow`) and an old `effect.kind:
particles` as an implicit emitter (`particlesEffectEmitter`, a ring flying out 1 px a frame, as
  before); `update(frame, entities, fixed?)` attaches each kind's `emit` to its entities (and,
  Engine 0.16 F6, each `FixedEmitters` `{ id, box, emit }`'s emitters where it stands: a 3D
  skin's decor campfire) and steps the system; `particles({ reduceFlashing? })` gives what to draw, with `reduceFlashing` drawing
  additive particles with normal blending at `REDUCED_FLASH_ALPHA` (0.5) and no glow.
- `schema.ts` (Engine 0.16 T4) also holds the camera effects a skin's event entry writes:
  `shakeSpecSchema` `{ amount, ticks }` (the largest offset in picture px, decaying over
  `ticks`), `zoomSpecSchema` `{ to, ticks, ease?, hold?, back? }` (a punch to the factor `to`
  and back; `back` defaults to `ticks`, 0 snaps back), `flashSpecSchema` `{ color?, alpha?,
ticks }` (default `#fcfcfc` at 1, fading) and `hitPauseSpecSchema` `{ ticks }` (1-60 display
  frames); and `parallaxLayerSchema` (`ParallaxLayer`): `{ frame | gradient, factor, sheet?,
repeat?, bands?, height?, x?, y?, depth? }`, exactly one of `frame` (a sprite frame, from
  `sheet` else `sheets.sheet`; `repeat` `x` (default), `y`, `xy` or `none`) and `gradient`
  (colours top to bottom, `bands` flat steps, default `PARALLAX_DEFAULT_BANDS` 8, `height` px,
  default the picture's); `factor` a number or `{ x, y }` in 0-2 (0 stays put, 1 moves with the
  world); `x`/`y` picture px of its origin when the camera is at the world's top-left; `depth`
  (3D) how far behind the blocks its plane stands. A field of the other kind is an error at it.
- `camera-fx.ts` (Engine 0.16 T4): `CameraFx({ seed?, subPixel? })`, one presenter's camera
  effects. `event(entry, frame)` starts an event entry's `shake`, `zoom` and `flash` (or call
  `shake`/`zoom`/`flash` directly); `update(frame)` drops ended effects (and every effect started
  after `frame`); `state(frame, { reduceFlashing?, shakeScale? })` gives `CameraFxState`
  `{ shakeX, shakeY, zoom, flashes }`. Shake is trauma: each shake's strength is
  `amount * (1 - age / ticks)²` (`shakeStrength`), exactly 0 from `ticks` on, running shakes add
  up, and the offset is that times noise in [-1, 1) per axis from `fxRng(seed, frame,
'camera-shake')`: the same frame always shakes the same way. Whole picture px unless `subPixel`
  (off by default, for pixel art); `shakeScale` (0..1, the player's setting) scales it. A zoom
  punch (`zoomFactor`, `zoomLength`) eases from 1 to `to`, holds, and eases back with the curve
  played backwards; punches multiply. A flash (`flashAlpha`) fades linearly from its alpha;
  `reduceFlashing` drops every flash. `FLASH_DEFAULT_COLOR`, `CameraFxSettings`.
- `hit-pause.ts` (Engine 0.16 T4): `HitPause`, the browser shell's freeze-frame counter:
  `request(ticks)` (only lengthens: requests never add up), `hold()` (true, using one frame, while
  a pause runs), `remaining`, `clear()`. Pure; no clock.
- `parallax.ts` (Engine 0.16 T4): `layoutParallax(skin, cam, size, frameSize)`, a skin's
  `parallax` list laid out once for both backends (as `layoutHud` is): `ParallaxDraw`s in picture
  px, back to front, `{ kind: 'sprite', layer, sheet, palette?, frame, x, y }` (a frame repeated
  over the picture per `repeat`; a frame the lookup lacks draws nothing) or `{ kind: 'box', layer,
x, y, w, h, color }` (a gradient's bands across the picture). A layer's origin is
  `round(x - cam.x * factor.x)`, `round(y - cam.y * factor.y)` with `cam` the camera's top-left in
  picture px (zoom and shake included). Helpers: `parallaxFactor`, `parallaxOrigin`,
  `gradientBands(colors, bands, height)` (no gaps; the first and last bands take the end colours).
- `transition.ts` (Engine 0.16 T5): screen transitions' timing and shapes. `transitionSpecSchema`
  (a union on `kind`; an unknown kind is an error at `kind`): `fade`, `wipe` (`direction` `right`
  (default), `left`, `down`, `up`; `edge`, the soft edge in picture px, default
  `WIPE_DEFAULT_EDGE` 16) and `iris` (`at`: `follow` (default), `center` or `{ x, y }`), each with
  `ticks` (frames each half), `hold?`, `color?` (default `#000000`) and `ease?`.
  `transitionsSchema` is `game.json`'s `transitions` (`level`, `scene`, `mission`, `respawn`
  (Engine 0.16 part B), `default`; `TRANSITION_SLOTS`; and `events`, a frame event type to the
  slot it plays; `eventTransitionSlot(specs, type)`: the map's slot, else `respawn` for a
  `respawn` event when that slot is given), `transitionFor(specs, slot)` the spec a slot plays and `reducedMotion(spec)`
  the short fade in its colour. `transitionAt(spec, age)` is `{ phase, coverage }` or null: `out`
  (coverage `ease((age + 1) / ticks)`, 1 on its last frame), `hold` (1), `in` (the curve played
  backwards, 0 on its last frame); `transitionLength` = `2 * ticks + hold`.
  `transitionShape(view, screen, focus?)` is what a display draws: `fade` `{ color, alpha }`,
  `wipe` `{ direction, length, edge, lead, trail }` (along the travel `s`: opaque between the soft
  edges, the lead coming in on the out half, the trail following it off the far side on the in
  half: `wipeTravel`, `wipeAlpha`), `iris` `{ x, y, radius }` (the uncovered circle; at no
  coverage it reaches the farthest corner; centre `irisCentre(at, focus, screen)`, kept on the
  picture). `transitionAlphaAt(shape, x, y, screen)` is the cover at a pixel's centre, the one
  definition both backends draw. `TransitionPlayer` (`start(spec, covered?)`, `step()`, `view`,
  `running`, `closing`) runs one; the shell's `ShellTransitions` uses it. From Engine 0.16 part C T10 `level` may
  be `false`: no transition on a map id change, not even `default` (`transitionFor` gives null), for
  a kit that slides between rooms itself (the dungeon sample).
- `schema.ts` (Engine 0.16 part C T4) also holds `lightingSchema` (`LightingSpec`), a 2D skin's
  `lighting` block, and its parts (`ambientSchema`, `entityLightSchema`, `eventLightSchema`,
  `placedLightSchema`, `lightSpriteSchema`, `lightFlickerSchema`, `vignetteSchema`,
  `ambientParticlesSchema`, `LIGHT_DEFAULTS`, `LIGHT_MAX_BANDS`): `{ ambient?, tags?, maps?, kinds?,
tiles?, events?, vignette?, bands?, particles? }`. An ambient is `{ color? (default #000000),
level 0-1 }`, the darkness where no light reaches. A light is `{ radius (world px), color?
(#ffffff), intensity? (0-1, how much darkness it clears at its centre, default 1), glow? (0-1,
how strongly its colour is added, default 0.2), flicker?: { amount 0-1, rate? (frames between
values, default 6) } }`; a kind's (`kinds.<kind>`, one or a list) adds `states?` (only in those
  `anim.state`s), `anchor?` (`centre`, `feet`, `top`) and `offset?`; a tile's (`tiles.<key>`, at
  each such tile's centre) `offset?`; an event's (`events.<key>`, keys read like the skin's
  `events`) `ticks` (it fades from full to nothing) and `offset?`; a placed one
  (`maps.<id>.lights`) `x`/`y` (world px in that map) and `sprite?` `{ frames, ticks? (8), sheet?,
x, y }` (an animated frame drawn under the darkness before the entities: a wall torch the map has
  no tile for) and, from Engine 0.16 part C T10, `emit?` (an emitter name or list, run at the
  light's centre on the ambient particle system while its map shows: a torch's embers;
  `missing_ref` at `lighting.maps.<id>.lights.<i>.emit` for an unknown one). `maps.<id>.ambient` beats the first `tags` key (file order) the map has, which
  beats `ambient`. `vignette` `{ color?, strength 0-1, inner? (0.45, where it starts as a share of
the centre-to-corner distance) }`; `bands` (0-16, default 0 smooth) steps each falloff;
  `dither` (0, 4 or 8; Engine 0.16 polish P, C1) dithers each light's falloff with a 4x4 or 8x8
  Bayer matrix: drawn smooth and quantized by picture pixel to `bands` alpha steps, or
  `LIGHT_DITHER_LEVELS` (64) with no `bands`, so it shows no rings;
  `particles` lists room-wide emitters `{ emit, tags?, maps?, prewarm? (120) }`.
- `lighting.ts` (Engine 0.16 part C T4): `SkinLighting(skin, { seed? })`, one presenter's
  lighting, the part every 2D backend shares. `event(ev, entities, frame)` starts an event's
  flash (at its `x`/`y`, else its entity's centre); `layout({ frame, entities, map, view, size,
reduceFlashing? })` gives the `LightingLayout` in picture px `{ darkness: { color, level } | null,
lights: LightDraw[] { key, x, y, radius, color, intensity, glow }, vignette, bands, dither }` (null for a
  skin without `lighting`): placed lights (each map part's at its place), tile lights (found once
  per map version), kind lights by state, then event flashes fading linearly; a light wholly off
  the picture is left out; `reduceFlashing` halves flashes and flicker. `props(map, frame)` gives
  the placed lights' sprites (`LightPropDraw`, world px). The darkness is `blendedDarkness`: each
  map part's ambient (`ambientFor`) weighted by how much of the view it covers (`mapParts`: a
  map's `parts`, else the whole map), so a room slide fades from one room's darkness to the next.
  Flicker is `flickerNoise(seed, key, frame, rate)`: a value in [-1, 1] from `fxRng(seed, k,
'light:<key>')` every `rate` frames, smoothstepped between, applied by `flickered` (radius and
  glow times `1 + amount * n`, intensity half that). `lightStops(intensity, bands)` is the falloff
  a backend draws: smoothstep from the intensity to 0 in `LIGHT_SMOOTH_STOPS` (8) stops, or
  `bands` flat steps with hard edges then 0 past the radius; `lightStops(intensity, bands,
dither)` with a dither is always the smooth ease, in `LIGHT_DITHER_STOPS` (32) stops, and
  `lightDither(layout)` is the `RadialDither` `{ size, levels }` the presenter puts on each
  light's fill (`RadialFill.dither` in `../gfx/renderer.ts`), or undefined.
- `dither.ts` (Engine 0.16 polish P, C1): the threshold maths of ordered dithering, pure and with
  no RNG. `bayerRank(x, y, size)` (the 4x4 or 8x8 Bayer matrix, tiled over the picture),
  `bayerThreshold` (`(rank + 0.5) / size²`), `ditherValue(value, x, y, { size, levels })` (the
  value clamped and quantized to a multiple of `1 / levels`: the step above where its share past
  the step below beats the pixel's threshold; 0 and 1 exact, a tile averages to the value),
  `stopsAlpha(stops, d)` (a canvas radial gradient's linear stops, the PixiJS gradient texture
  uses it too) and `ditheredRadial(fill, dither, bounds?)`, a radial fill's `DitheredStamp`
  `{ x, y, w, h, alpha }`: the whole picture pixels of its box (cut to `bounds`), each alpha byte
  the stops' value at the pixel centre's distance, dithered at the pixel's own picture position
  (so two stamps agree where they overlap and the same frame gives the same bytes). Both 2D
  backends draw these bytes, so they draw the same pixels. It runs for every light twice a frame,
  so it is cheap and cached (polish P review): the stops become a table of `FALLOFF_STEPS` (4096)
  even distances (each pixel one square root and one read, not a scan of the stops; a rare pixel
  may land one step off the exact `ditherValue(stopsAlpha(..))`), each box's table steps are kept
  by radius and the centre's place in the box (`FillGeometry`, so a light moved by whole pixels
  or dimmed in place reuses them), and recent stamps are kept by all their inputs (up to
  `DITHER_CACHE_BYTES`, most recently used kept), so a steady light gets the same stamp object
  every frame and a backend can keep what it made from it. Never write to a stamp's `alpha`.
  With a dither, `SkinLighting.layout` keeps each light's radius whole and steps its flicker's
  noise to `1 / LIGHT_DITHER_FLICKER_STEPS` (4), so a flickering torch repeats a few falloffs.
- `skin-particles.ts` (Engine 0.16 part C T4): `update(frame, entities, map?)` with the full map
  shown also runs the skin's `lighting.particles` on their own `ambient` system: each entry whose
  `tags` (one of the map's) and `maps` (its id or a part's) fit spawns its emitters over the whole
  map's box (`shape` box, `anchor` centre); another map (id or tags) clears them and starts them
  `prewarm` frames ahead (`AMBIENT_PREWARM`, 120) so the air is full at once. From Engine 0.16 part C T10 each placed
  light's `emit` runs there too, at the light's centre in its map part (`light:<map>:<i>`). `particles()` lists
  them first. The 3D backend passes no map, so it has none.
- `index.ts`: re-exports all of the above; import from `@engine/core/fx`.

## Where it is used

- Skins (`../present/skin.ts`): an event entry's `tween` (started on the event's `entity`; an event
  without one is ignored) and a kind entry's `spawnTween` (started the first frame a presenter
  shows an entity of that kind; again if it leaves and comes back). Both take `tweensSchema`, on
  2D and 3D skins alike.
- `SkinnedCanvasPresenter` (`engine/backends/canvas2d/presenter.ts`) keeps one `TweenSet` per
  entity id and lays its state on top of the frame's `PresentFx` when drawing (position offset,
  squash factors, turn, alpha, the colour overlay as a translucent box over the drawn box). It
  never writes to the frame. From Engine 0.16 part B T10 the 3D backend's `ThreeScene` does the
  same on each entity's root (a colour tween as the materials' emissive colour; item 340).
- Camera effects and parallax (Engine 0.16 T4): an event entry's `shake`, `zoom`, `flash` and
  `hitPause`, the skin camera's `lookAhead` (`../present/camera.ts`) and the skin's top-level
  `parallax`. Both presenters keep a `CameraFx` timed by their own clock (one tick per frame they
  present, so effects go on while the frame number stands still: a hit-pause, the pause between
  levels), pass `hitPause` to their `onHitPause` option (the shell's `HitPause`), and draw
  `layoutParallax` behind the map (Canvas2D) or as planes on the camera (3D). `games/fx-lab` has
  a shake and a hit-pause on stomps, a flash on hurt, a zoom on the door and a four-layer sky.
- Particles (Engine 0.16 T3): a skin's top-level `emitters` (named `emitterSchema` defs), an
  event entry's `emit` (a name or a list) and a kind entry's `emit` (running while an entity of
  the kind shows, following it). Both presenters keep a `SkinParticles`: the Canvas2D one draws
  the particles in world space after the entities (`blended`/`glowing` on the renderer), the 3D
  one as `Points` with an additive material for `add`. `games/fx-lab` has six presets.

- Lighting (Engine 0.16 part C T4): a 2D skin's `lighting`. The Canvas2D presenter keeps a
  `SkinLighting` (seeded by its `seed`) and draws its layout after the particles and before
  effects, flashes and the HUD; the PixiJS backend does not draw it yet (feedback item 434) and a
  3D skin may not have it. `games/fx-lab` lights its `fx-3` level; `games/samples/dungeon` every
  room.

## Rules

- Pure: `engine/core/fx/**` is on `PURE_CORE` (`config/layers.js`): no `Math.random` (use
  `fxRng`), no `Date.now`/`performance.now` (time is presentation frames), no DOM. Import only
  `zod` and pure core files (`../rng`; `../present/skin` and `../present/types` for
  `skin-particles.ts`, `camera-fx.ts`, `parallax.ts` and `lighting.ts`; `../gfx/screen` types). `../gfx/renderer.ts` imports the `RadialDither` type from `dither.ts`.
- Presenters only: kits and `engine/sim` may not import it (`FORBIDDEN_CORE` in
  `config/layers.js`; checked by `tests/architecture/eslint-deps.test.ts` and
  `dependency-rule.test.ts`). Nothing here may reach a world, a frame or a hash. `present/skin.ts`
  imports `schema.ts` so skins validate tween text; that is the only route a kit's code reaches it,
  and it only parses.
- Never use `fxRng` for anything a rule reads, and never seed a world RNG from it.

## Testing

`rng.test.ts` (determinism, a different seed, frame or stream draws differently, streams
independent, a world `Rng` from the same seed untouched, `fxRange`), `ease.test.ts` (every
curve's endpoints exact, clamping, continuity near the ends, shapes), `tween.test.ts` (colour
parsing and lerp, each property's interpolation, colour, rest defaults, delay, easing, yoyo and
repeat, forever, `TweenSet` combining and `onDone`, the schema naming bad fields), `particles.test.ts`
(same seed and frames give identical particles, another seed differs, stepping or skipping lands
the same, the closed-form motion with drag and gravity, lifetimes, rates with fractions, both count
caps, an even ring, attached emitters following and stopping, `follow`, clearing on an earlier
frame and the catch-up cap, keyframe interpolation of size, colour and alpha, `keyframeAt`,
`anchorPoint`, the emitter schema naming bad fields), `camera-fx.test.ts` (shake decaying to
exactly zero as trauma squared, deterministic per frame and seed, adding up, sub-pixel and the
shake scale; zoom punch values with an ease, hold and the way back, punches multiplying; flashes
fading and reduced flashing; clearing on an earlier frame; `HitPause` frame counting; the
schemas), `parallax.test.ts` (factors and origins, gradient bands, layers moving at their own
rates between two camera positions, repeats, a missing frame, the layer schema),
`dither.test.ts` (polish P: the Bayer ranks and tiling, quantized values keeping 0, 1 and exact
steps and averaging to the value over a tile, `stopsAlpha`, a stamp's box, steps and picture-pixel
phase, the same fill twice byte-identical, the table lookup against the exact per-pixel value,
a steady fill's same stamp and a moved, cut or dimmed one's bytes, the dithered `lightStops` and
`lightDither`; the rough time budget for frames of the Old Crypt's lights is
`tests/bench/dither-falloff.test.ts`, as this folder may not read the clock),
`lighting.test.ts` (Engine 0.16 part C T4: smooth and banded falloffs, flicker determinism by
seed and light and its scaling, darkness by map, tag and skin and blended over a slide's parts,
the layout of kind lights by state, tile lights and placed lights in picture px, culling, event
flashes fading, the vignette's defaults, placed sprites cycling at each part's place, room-wide
particles prewarmed over the map, by tag and id and restarted on another map, the schema and the
skin's reference checks), `transition.test.ts` (phases and coverage over time with a hold and an ease, slots and fallbacks,
reduced motion, the player's `covered`, each kind's covered share frame by frame, the wipe's
direction and soft edge, the iris closing on its centre, the iris centre in screen space, the
schemas naming the bad field). The skin hook is
tested in `engine/core/present/skin.test.ts` (`skin tweens`) and
`engine/backends/canvas2d/presenter.test.ts` (`tweens`). `tests/runs/presentation-invariance.test.ts`
plays every game's run files with presenters fed every frame and the effects switched on (the
`EFFECTS` table in `tests/runs/effects.ts`, which each later 0.16 task extends) and checks the
golden and final state hashes match `pnpm cli run`; from Engine 0.16 T14
`tests/runs/stepped-shell-invariance.test.ts` does the same through the browser shell's own loop
(`bootBrowserGame` on a fake page) with hit-pause, transitions, the pause menu and the mixer on.
Run with `pnpm test`.
