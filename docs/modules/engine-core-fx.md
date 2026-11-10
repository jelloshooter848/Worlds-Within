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

## Imports allowed

`zod` and pure core files (`../rng`, `../present/skin` and `../present/types`). On `PURE_CORE`. Kits and `engine/sim` may not import it
(`FORBIDDEN_CORE`); backends, the shell and games may.

## How to test

`pnpm test engine/core/fx` (RNG determinism and stream independence, every curve's endpoints,
each property's interpolation including colour, the schema; particles: determinism by seed and
frame, the count caps, emitters following entities, keyframe interpolation); the skin and presenter hooks in
`engine/core/present/skin.test.ts` and `engine/backends/canvas2d/presenter.test.ts`; the
invariance proof in `tests/runs/presentation-invariance.test.ts`.
