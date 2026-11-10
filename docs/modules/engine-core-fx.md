# engine/core/fx

Folder: `engine/core/fx` (part of `engine/core`). Detailed rules:
[`engine/core/fx/CLAUDE.md`](../../engine/core/fx/CLAUDE.md).

## Purpose

The deterministic, presentation-only foundation of the Engine 0.16 effects: a presentation RNG
that never touches the world's, easing curves by name, and tweens of position, scale, rotation,
alpha and colour driven by presentation frames, with their text form for skins. Every value is a
function of the run seed and the frame number, so pictures are repeatable and presenting never
changes the state (proved by `tests/runs/presentation-invariance.test.ts`).

## Public API entry points

Import from `@engine/core/fx` (`index.ts`).

- `fxRng(seed, frame, stream)`: a fresh `Rng` for one frame and one named stream; streams are
  independent; `fxRange(rng, lo, hi)`.
- `ease(name, t)`, `EASE_NAMES` (`linear`, `quad*`, `cubic*`, `quart*`, `sine*`, `back*`,
  `elastic*`, `bounce*` with `In`/`Out`/`InOut`, `step`), `isEaseName`.
- `lerpColor(a, b, t)`, `parseHexColor(text)`.
- `tweenSpecSchema`, `tweensSchema` (Zod): `{ prop, from?, to, frames, delay?, ease?, yoyo?,
repeat?, amount? }`, `prop` one of `TWEEN_PROPS` (`x`, `y`, `scale`, `scaleX`, `scaleY`,
  `rotate`, `alpha`, `color`); `TWEEN_REST`.
- `Tween`, `TweenSet` (`add`, `update`, `state`), `TweenState`, `REST_STATE`, `tweenList`.
- Particles (Engine 0.16 T3): `emitterSchema`, `EmitterDef`, `EMITTER_DEFAULTS`, `Keyframes`;
  `ParticleSystem` (`emit`, `attach`, `update(frame, locate?)`, `particles()`, `count`, `clear`),
  `ParticleView`, `keyframeAt`, `anchorPoint`, `PARTICLE_CATCH_UP`, `PARTICLE_SYSTEM_MAX`;
  `SkinParticles` (a skin's event `emit`s, kind `emit`s and old `particles` effects for one
  presenter; `particles({ reduceFlashing })`), `REDUCED_FLASH_ALPHA`.
- Camera effects (Engine 0.16 T4): `shakeSpecSchema`, `zoomSpecSchema`, `flashSpecSchema`,
  `hitPauseSpecSchema`; `CameraFx` (`event`, `shake`, `zoom`, `flash`, `update`,
  `state(frame, { reduceFlashing?, shakeScale? })` -> `{ shakeX, shakeY, zoom, flashes }`; trauma
  shake from `fxRng`, whole px unless `subPixel`), `shakeStrength`, `zoomFactor`, `zoomLength`,
  `flashAlpha`; `HitPause` (`request`, `hold`, `remaining`), the shell's freeze-frame counter.
- Parallax (Engine 0.16 T4): `parallaxLayerSchema`, `layoutParallax(skin, cam, size, frameSize)`
  (`ParallaxDraw`s for both backends), `parallaxFactor`, `parallaxOrigin`, `gradientBands`.
- Screen transitions (Engine 0.16 T5, `transition.ts`): `transitionSpecSchema` (`fade`, `wipe`
  with `direction` and a soft `edge`, `iris` with `at`: `follow`, `center` or a point; each
  `{ ticks, hold?, color?, ease? }`), `transitionsSchema` (`game.json`'s `transitions`: `level`,
  `scene`, `mission`, `respawn` (Engine 0.16 part B, played on a frame event), `default`, and
  `events`, an event type to a slot), `transitionFor`, `eventTransitionSlot`, `reducedMotion` (a short fade,
  `REDUCED_MOTION_TICKS`), `transitionAt(spec, age)` -> `{ phase: out | hold | in, coverage }`,
  `transitionShape(view, screen, focus)` (what a display draws), `transitionAlphaAt` (the cover at
  a pixel), `irisCentre`, `wipeTravel`, `wipeAlpha`, `TransitionPlayer`. The shell runs them
  (`engine/core/shell/transitions.ts`).

In skins (`engine/core/present`): an event entry's `tween` (on the event's `entity`) and a kind
entry's `spawnTween` (on an entity the first frame it is shown), drawn by the Canvas2D
`SkinnedCanvasPresenter` on top of the frame's `fx`:

    "events": { "hit": { "sound": "hurt", "tween": [
      { "prop": "scale", "from": 1.4, "to": 1, "frames": 8, "ease": "backOut" },
      { "prop": "color", "to": "#d82800", "frames": 6, "amount": 0.6 } ] } }

Particle emitters are named in the skin's `emitters` and started by an event's `emit` or run by a
kind's `emit`; an old `effect: { kind: "particles" }` still draws (an implicit emitter):

    "emitters": { "dust": { "burst": 8, "life": [12, 20], "speed": [0.4, 1.2], "angle": [185, 355],
      "anchor": "feet", "drag": 0.1, "size": [2, 4, 1], "color": ["#fce0a8", "#bcbcbc"], "alpha": [1, 0] } },
    "events": { "land": { "sound": "land", "emit": "dust" } },
    "kinds": { "torch": { "frames": { "idle": "torch" }, "emit": ["torch-smoke", "torch-flame"] } }

Camera effects ride on event entries, and parallax layers sit at the skin's top level:

    "events": { "stomp": { "sound": "stomp", "shake": { "amount": 3, "ticks": 14 }, "hitPause": { "ticks": 4 } },
                "hurt": { "flash": { "color": "#d82800", "alpha": 0.6, "ticks": 8 } },
                "cleared": { "zoom": { "to": 1.5, "ticks": 12, "ease": "cubicOut", "hold": 30 } } },
    "camera": { "follow": "runner", "lookAhead": { "x": 24, "lerp": 0.08 } },
    "parallax": [ { "gradient": ["#3058e8", "#3cbcfc", "#a4e4fc"], "bands": 12, "factor": 0 },
                  { "frame": "hills", "sheet": "fx-sky", "factor": { "x": 0.5, "y": 0.1 }, "y": 172, "depth": 300 } ]

## Imports allowed

`zod` and pure core files (`../rng`, `../present/skin` and `../present/types`). On `PURE_CORE`. Kits and `engine/sim` may not import it
(`FORBIDDEN_CORE`); backends, the shell and games may.

## How to test

`pnpm test engine/core/fx` (RNG determinism and stream independence, every curve's endpoints,
each property's interpolation including colour, the schema; particles: determinism by seed and
frame, the count caps, emitters following entities, keyframe interpolation; camera effects: shake
decay and determinism, zoom and flash values, hit-pause counting; parallax layouts); the skin and presenter hooks in
`engine/core/present/skin.test.ts` and `engine/backends/canvas2d/presenter.test.ts`; the
invariance proof in `tests/runs/presentation-invariance.test.ts` and, through the shell's own
loop with every effect on, `tests/runs/stepped-shell-invariance.test.ts` (Engine 0.16 T14).
