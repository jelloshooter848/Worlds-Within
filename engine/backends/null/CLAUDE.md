# engine/backends/null

The headless backend. `NullRenderer` (`index.ts`) takes every core `Renderer` call and draws
nothing. Tests, the headless sim and CI runs use it, so game logic runs the same with no screen. It
has none of the optional calls (`clip`, `alpha`, `transform`), so the core helpers fall back to
plain drawing through it.

`NullPresenter` (`index.ts`) implements the presentation contract's `Presenter`: it takes every
frame and draws nothing, counting them (`frames`) and keeping the `last` one (and the last
`resize` size). For tests, `new NullPresenter({ freeze: true })` deep-freezes each frame so any
later change throws, and `{ validate: true }` checks each against `presentFrameSchema` and throws
with the bad fields.

## Imports

- Allowed: `@engine/core/*` only (`gfx/renderer.ts`, `gfx/spritesheet.ts`, `gfx/screen.ts`,
  `present`, `content/validate.ts`).
- Never: other backends, browser APIs, `engine/sim`, `engine/tools`, kits or games.

## Testing

`null.test.ts` checks every call is a no-op, the core helpers still run their drawing through it,
and `NullPresenter` keeps frames, freezes and validates them. `pnpm test` runs it in Node.
