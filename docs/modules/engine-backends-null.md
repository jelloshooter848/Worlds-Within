# engine/backends/null

Folder: `engine/backends/null`. Detailed rules:
[`engine/backends/null/CLAUDE.md`](../../engine/backends/null/CLAUDE.md).

## Purpose

The headless backend. It accepts every core `Renderer` call and draws nothing, so tests, the
headless sim and CI runs execute game logic the same way with no screen.

## Public API entry points

`index.ts`, imported as `@engine/backends/null`: `NullRenderer`.

## Imports allowed

- `@engine/core/*` only (types from `gfx/renderer.ts` and `gfx/spritesheet.ts`).
- Never other backends, browser APIs, `engine/sim`, `engine/tools`, kits or games.
- Kit test files (`*.test.ts`) may import it; that is the one exception in `config/layers.js`.

## How to test

`null.test.ts` checks every call is a no-op and the core helpers still run through it. Run with
`pnpm test`.
