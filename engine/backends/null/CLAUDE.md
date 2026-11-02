# engine/backends/null

The headless backend: `NullRenderer` (`index.ts`) takes every core `Renderer` call and draws
nothing. Tests, the headless sim and CI runs use it, so game logic runs the same with no screen. It
has none of the optional calls (`clip`, `alpha`, `transform`), so the core helpers fall back to
plain drawing through it.

## Imports

- Allowed: `@engine/core/*` only (types from `gfx/renderer.ts` and `gfx/spritesheet.ts`).
- Never: other backends, browser APIs, `engine/sim`, `engine/tools`, kits or games.

## Testing

`null.test.ts` checks every call is a no-op and the core helpers still run their drawing through it.
`pnpm test` runs it in Node.
