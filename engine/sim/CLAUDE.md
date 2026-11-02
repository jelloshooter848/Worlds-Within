# engine/sim

The optional world simulation (from Engine 0.8): the world as data, with no graphics. Games that
need a living world use it; simple games never touch it. The ECS is our own small one (decision in
`docs/BUILD-LOG.md`, Engine 0.8, item 99); one tick is one world minute (item 100).

## Files

- `component.ts`: `defineComponent(name, schema)` -> `ComponentDef<T>`, a component kind with the
  Zod schema its data must match.
- `world.ts`: `createWorld(seed, { components?, systems? })` -> `World`.
- `math.ts`: deterministic integer and fixed-point maths (see "Maths" below).
- `index.ts`: the public entry point; import from here outside this folder.

## The world

- **Entities** are positive integer ids from `spawn()`, handed out in order (`nextId`) and never
  reused. `destroy(id)` removes the entity and all its components.
- **Components** are registered by kind (`registerComponent` or the `components` option) and set
  with `add(id, def | name, data)`, read with `get` (the stored object; systems may change it in
  place), checked with `has` and dropped with `remove`. `add` checks the data against the schema
  and that it is JSON-safe, and stores a copy.
- **Queries** (`query(...components)`, `entities()`, and the component lists in a snapshot) always
  run in ascending entity id order, never in Map/Set insertion order. Code that iterates the world
  must go through them.
- **Systems** are `{ name, run(world) }`, run by `step()` in the order they were added; after the
  last one the tick is committed (`tick` + 1). `tick` is an integer, 0 for a new world. A system may
  not call `step()`.
- **RNG**: `world.rng` is an `Rng` from `engine/core/rng.ts` seeded from the world seed. Its state
  is in every snapshot (`rng`).
- **Snapshots**: `snapshot()` is the whole world as JSON-safe data (`seed`, `tick`, `nextId`,
  `rng`, `entities`, and per component kind a list of `[id, data]` in id order), copied from the
  live state. `canonical()` is that snapshot as canonical JSON (`canonicalJson` from
  `engine/core/headless.ts`). Hashing stays in the tools (`node:crypto`); the sim never hashes.

## Maths

`math.ts` (exported from `index.ts`) holds the replacements, all exact on every machine:

- Integers: `idiv(a, b)` and `imod(a, b)` (floored, `imod(-1, 4)` is 3), `clamp(v, lo, hi)`,
  `ipow(base, exp)` (throws past safe integers), `isqrt(n)` (largest `r` with `r * r <= n`).
- Grid distances: `distSq` (compare it instead of rooting it), `distFloor` (its `isqrt`),
  `manhattan`, `chebyshev`.
- Angles are binary: `ANGLE_STEPS` (256) is a full turn, `QUARTER_TURN` is 64, counted from +x
  toward +y; `wrapAngle` wraps any integer. `sinFixed(a)` and `cosFixed(a)` read a quarter-wave
  table in fixed point, `FIXED_ONE` (65536) = 1.0. `directionAngle(i, n)` and
  `directionVector(i, n, length)` give one of `n` even directions (4, 8, 16 and so on);
  `scaleFixed(f, v)` is `f * v / FIXED_ONE` rounded; `iatan2(y, x)` is the nearest angle step to a
  vector (integers within ±2^31).

## Rules

- Headless and deterministic: the same seed, components and systems give the same snapshots,
  every run.
- Imports only `engine/core` (plus `zod` for schemas). Never backends, `engine/tools`, kits or games.
- All randomness through the world's seeded RNG. No `Math.random`, no `Date.now` or
  `performance.now`, no DOM. This purity rule is lint-enforced on every file under `engine/sim/`
  (the `purity` block in `eslint.config.js`), and any `engine/core` file the sim imports at run time
  must be on `PURE_CORE` in `config/layers.js` (`tests/architecture/purity.test.ts` checks it).
- **No machine-dependent float maths.** `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`,
  `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `exp`, `expm1`, `log`, `log1p`, `log2`,
  `log10`, `pow`, `cbrt` and `hypot` are not required to be correctly rounded, so their last bits
  can differ between engines and CPUs. They and the `**` operator are lint errors in every file
  under `engine/sim/`, tests included (`SIM_FORBIDDEN_MATH` and `SIM_MATH_DIRS` in
  `config/layers.js`, the `sim-math` block in `eslint.config.js`, checked by
  `tests/architecture/purity.test.ts`). Use `math.ts` instead. Exact `Math` functions stay
  allowed: `floor`, `ceil`, `round`, `trunc`, `abs`, `sign`, `min`, `max`, `sqrt` (correctly
  rounded by IEEE 754), `fround`, `imul`. Prefer integers for positions and amounts anyway.
- Component data is plain JSON-safe data: no classes, `Map`, `Set`, functions, `undefined` or
  non-finite numbers. No genre rules here: no game content, only the world's machinery.
- Tests run in Node with `pnpm test`, with no browser (`world.test.ts`, `math.test.ts`).
