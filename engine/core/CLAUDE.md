# engine/core

The engine's core: the fixed-step loop (`loop.ts`), scenes (`scene.ts`), input (`input/`), chiptune
audio and MML (`audio/`), save and settings (`save/`), the seeded RNG (`rng.ts`), maths (`math/`),
asset packs (`assets/`), accessibility (`a11y/`), platform detection (`platform.ts`) and graphics
data: palettes, sprite sheets, text pixel art, animation and the screen size and fit maths
(`gfx/`).

`gfx/renderer.ts` is the presentation contract: the `Renderer` interface, `Rotation`, and the
helpers `transformed`, `translucent`, `clipped` and `OffsetRenderer`. Backends implement it; core
never knows which one is drawing.

## Imports

- Allowed: other files in `engine/core` (relative paths) and npm packages.
- Never: `engine/backends`, `engine/sim`, `engine/tools`, kits or games.
- No game rules or game content here. Tiny fixtures inside tests only.
- Randomness goes through `Rng` (`rng.ts`), never `Math.random`, in anything a kit or the sim uses.

## The pure core

Kits and the sim must run the same in Node and in any browser, so the core files they use are
**pure**: no `Math.random`, `Date.now`, `performance.now` or DOM globals (`document`, `window`,
`localStorage`, `requestAnimationFrame`, ...). The list is `PURE_CORE` in `config/layers.js`, next to
the layer table (today: `rng.ts`, `math/**`, `scene.ts`, the input actions, bindings, input manager
and scripted input, the renderer contract, palette, animation, screen and sprite sheet data, and
`audio/mml.ts`). ESLint enforces the rule on those files; `tests/architecture/purity.test.ts`
follows every run-time import (not `import type`) from kits and the sim into core and fails if a
file it reaches is not on the list. When a kit or the sim starts importing another core file, make
that file pure and add it to `PURE_CORE`. Wall-clock time and the DOM belong in `loop.ts`, the
browser input sources, `save/`, `assets/` and the backends.

## Testing

Tests sit next to the code as `*.test.ts` and run in Node (`pnpm test`). They must not need a
browser: use fakes for canvas, audio and DOM, as the existing tests do.
