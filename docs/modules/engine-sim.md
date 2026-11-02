# engine/sim

Folder: `engine/sim`. Detailed rules: [`engine/sim/CLAUDE.md`](../../engine/sim/CLAUDE.md).

## Purpose

The optional world simulation, headless and deterministic: entities, components, systems in a fixed
order, a seeded RNG per world and an integer tick (one tick is one world minute). The same seed and
systems give the same world on every run. Games that need a living world use it; simple games never
touch it.

## Public API entry points

From `engine/sim/index.ts`:

- `defineComponent(name, schema)`: a component kind (`ComponentDef<T>`) whose data matches a Zod
  schema and is plain JSON-safe data.
- `createWorld(seed, { components?, systems? })` -> `World`:
  - `spawn()`, `destroy(id)`, `alive(id)`, `entities()`, `nextId`;
  - `registerComponent(def)`, `add(id, def | name, data)`, `get`, `has`, `remove`;
  - `query(...components)`: entities with all of them, always ascending by id;
  - `addSystem({ name, run })`, `systems()`, `step()` (systems in order, then `tick` + 1), `tick`;
  - `rng` (an `engine/core/rng.ts` `Rng`), `seed`;
  - `snapshot()` (the whole world as JSON-safe data) and `canonical()` (it as canonical JSON, for
    the tools to hash).
- Deterministic maths (`math.ts`): `idiv`, `imod`, `clamp`, `ipow`, `isqrt`; `distSq`, `distFloor`,
  `manhattan`, `chebyshev`; binary angles (`ANGLE_STEPS` = 256 per turn) with fixed-point
  `sinFixed`/`cosFixed` (`FIXED_ONE` = 65536), `directionAngle`, `directionVector`, `scaleFixed`
  and `iatan2`.

## Imports allowed

- `engine/core` only, and only `PURE_CORE` files at run time; `zod` for component schemas.
- Never backends, `engine/tools`, kits or games.
- All randomness through the world's seeded RNG; no `Math.random`, wall-clock time or DOM
  (lint-enforced).
- No floating-point maths that can differ between machines: `Math.sin`, `cos`, `tan`, `atan2`,
  `exp`, `log`, `pow`, `hypot` and the rest of `SIM_FORBIDDEN_MATH` (`config/layers.js`), and the
  `**` operator, are lint errors in `engine/sim/` whose message points at `engine/sim/math.ts`.
  Exact functions (`floor`, `trunc`, `abs`, `min`, `max`, `sqrt`, ...) stay allowed.

## How to test

`pnpm test` runs `engine/sim/world.test.ts` in Node, with no browser: same seed gives identical
snapshots, iteration is ascending by id after destroy and spawn, and RNG draws differ by seed. `engine/sim/math.test.ts` checks the maths helpers give exact
integer results and that the sine table is symmetric; `tests/architecture/purity.test.ts` checks
the lint rule fires on sim files.
