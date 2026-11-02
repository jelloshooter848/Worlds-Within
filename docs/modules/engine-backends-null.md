# engine/backends/null

Folder: `engine/backends/null`. Detailed rules:
[`engine/backends/null/CLAUDE.md`](../../engine/backends/null/CLAUDE.md).

## Purpose

The headless backend. It accepts every core `Renderer` call and draws nothing, so tests, the
headless sim and CI runs execute game logic the same way with no screen. `NullPresenter` does the
same for presentation frames, and can freeze or schema-check each frame in tests.

## Public API entry points

`index.ts`, imported as `@engine/backends/null`: `NullRenderer`, `NullPresenter`
(`{ freeze?, validate? }`; `frames`, `last`), `NullPresenterOptions`.

## Imports allowed

- `@engine/core/*` only (`gfx/`, `present`, `content/validate.ts`).
- Never other backends, browser APIs, `engine/sim`, `engine/tools`, kits or games.
- Kit test files (`*.test.ts`) may import it; that is the one exception in `config/layers.js`.

## How to test

`null.test.ts` checks every call is a no-op, the core helpers still run through it, and
`NullPresenter` keeps, freezes and validates frames. Run with
`pnpm test`.
