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

In skins (`engine/core/present`): an event entry's `tween` (on the event's `entity`) and a kind
entry's `spawnTween` (on an entity the first frame it is shown), drawn by the Canvas2D
`SkinnedCanvasPresenter` on top of the frame's `fx`:

    "events": { "hit": { "sound": "hurt", "tween": [
      { "prop": "scale", "from": 1.4, "to": 1, "frames": 8, "ease": "backOut" },
      { "prop": "color", "to": "#d82800", "frames": 6, "amount": 0.6 } ] } }

## Imports allowed

`zod` and pure core files (`../rng`). On `PURE_CORE`. Kits and `engine/sim` may not import it
(`FORBIDDEN_CORE`); backends, the shell and games may.

## How to test

`pnpm test engine/core/fx` (RNG determinism and stream independence, every curve's endpoints,
each property's interpolation including colour, the schema); the skin and presenter hooks in
`engine/core/present/skin.test.ts` and `engine/backends/canvas2d/presenter.test.ts`; the
invariance proof in `tests/runs/presentation-invariance.test.ts`.
