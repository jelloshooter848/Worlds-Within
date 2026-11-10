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
  colour).
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
  `keyframeAt(keys, t, lerp)` and `anchorPoint(box, anchor)` are the pure helpers.
- `skin-particles.ts` (Engine 0.16 T3): `SkinParticles(skin, { seed?, max? })`, the part both
  backends share. `event(entry, ev, entities, frame)` starts an event entry's `emit` (at the
  event's `x`/`y`, else its entity's centre, or the emitter's `anchor` on the entity when it
  gives one; following the entity when the emitter says `follow`) and an old `effect.kind:
particles` as an implicit emitter (`particlesEffectEmitter`, a ring flying out 1 px a frame, as
  before); `update(frame, entities)` attaches each kind's `emit` to its entities and steps the
  system; `particles({ reduceFlashing? })` gives what to draw, with `reduceFlashing` drawing
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
  `transitionsSchema` is `game.json`'s `transitions` (`level`, `scene`, `mission`, `default`;
  `TRANSITION_SLOTS`), `transitionFor(specs, slot)` the spec a slot plays and `reducedMotion(spec)`
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
  `running`, `closing`) runs one; the shell's `ShellTransitions` uses it.
- `index.ts`: re-exports all of the above; import from `@engine/core/fx`.

## Where it is used

- Skins (`../present/skin.ts`): an event entry's `tween` (started on the event's `entity`; an event
  without one is ignored) and a kind entry's `spawnTween` (started the first frame a presenter
  shows an entity of that kind; again if it leaves and comes back). Both take `tweensSchema`, on
  2D and 3D skins alike.
- `SkinnedCanvasPresenter` (`engine/backends/canvas2d/presenter.ts`) keeps one `TweenSet` per
  entity id and lays its state on top of the frame's `PresentFx` when drawing (position offset,
  squash factors, turn, alpha, the colour overlay as a translucent box over the drawn box). It
  never writes to the frame. The 3D backend ignores tweens for now.
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

## Rules

- Pure: `engine/core/fx/**` is on `PURE_CORE` (`config/layers.js`): no `Math.random` (use
  `fxRng`), no `Date.now`/`performance.now` (time is presentation frames), no DOM. Import only
  `zod` and pure core files (`../rng`; `../present/skin` and `../present/types` for
  `skin-particles.ts`, `camera-fx.ts` and `parallax.ts`; `../gfx/screen` types).
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
`transition.test.ts` (phases and coverage over time with a hold and an ease, slots and fallbacks,
reduced motion, the player's `covered`, each kind's covered share frame by frame, the wipe's
direction and soft edge, the iris closing on its centre, the iris centre in screen space, the
schemas naming the bad field). The skin hook is
tested in `engine/core/present/skin.test.ts` (`skin tweens`) and
`engine/backends/canvas2d/presenter.test.ts` (`tweens`). `tests/runs/presentation-invariance.test.ts`
plays every game's run files with presenters fed every frame and the effects switched on (its
`EFFECTS` table, which each later 0.16 task extends) and checks the golden and final state hashes
match `pnpm cli run`. Run with `pnpm test`.
