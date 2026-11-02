# engine/sim

Placeholder: the optional world simulation arrives in Engine 0.8. No code lives here until then.
The rules exist before the code does:

- Headless and deterministic: the same seed and inputs give the same world, every run.
- Imports only `engine/core`. Never backends, `engine/tools`, kits or games.
- All randomness through the world's seeded RNG (`engine/core/rng.ts`). No `Math.random`, no
  `Date.now` or `performance.now`, no DOM. This purity rule is lint-enforced on every file under
  `engine/sim/` (the `purity` block in `eslint.config.js`), and any `engine/core` file the sim
  imports at run time must be on `PURE_CORE` in `config/layers.js`
  (`tests/architecture/purity.test.ts` checks it).
- Tests run in Node with `pnpm test`, with no browser.
