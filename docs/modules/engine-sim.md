# engine/sim

Folder: `engine/sim`. Detailed rules: [`engine/sim/CLAUDE.md`](../../engine/sim/CLAUDE.md).

## Purpose

The optional world simulation, headless and deterministic: the same seed and inputs give the same
world on every run. **Placeholder:** the code arrives in Engine 0.8; the folder holds only its rules
until then.

## Public API entry points

None yet. This section is filled in when the sim lands (Engine 0.8).

## Imports allowed

- `engine/core` only, and only `PURE_CORE` files at run time.
- Never backends, `engine/tools`, kits or games.
- All randomness through the world's seeded RNG; no `Math.random`, wall-clock time or DOM
  (lint-enforced).

## How to test

Tests will run in Node with `pnpm test`, with no browser.
