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
- Particles (Engine 0.16 T3): a skin's top-level `emitters` (named `emitterSchema` defs), an
  event entry's `emit` (a name or a list) and a kind entry's `emit` (running while an entity of
  the kind shows, following it). Both presenters keep a `SkinParticles`: the Canvas2D one draws
  the particles in world space after the entities (`blended`/`glowing` on the renderer), the 3D
  one as `Points` with an additive material for `add`. `games/fx-lab` has six presets.

## Rules

- Pure: `engine/core/fx/**` is on `PURE_CORE` (`config/layers.js`): no `Math.random` (use
  `fxRng`), no `Date.now`/`performance.now` (time is presentation frames), no DOM. Import only
  `zod` and pure core files (`../rng`, and `../present/skin` and `../present/types` for
  `skin-particles.ts`).
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
`anchorPoint`, the emitter schema naming bad fields). The skin hook is
tested in `engine/core/present/skin.test.ts` (`skin tweens`) and
`engine/backends/canvas2d/presenter.test.ts` (`tweens`). `tests/runs/presentation-invariance.test.ts`
plays every game's run files with presenters fed every frame and the effects switched on (its
`EFFECTS` table, which each later 0.16 task extends) and checks the golden and final state hashes
match `pnpm cli run`. Run with `pnpm test`.
