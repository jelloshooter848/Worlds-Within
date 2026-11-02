# games/demo

The current demo: a proof-of-life game built on the top-down kit. It is content, not engine: three
rooms (`rooms.ts`), one MML song (`music.ts`) and a thin scene (`scene.ts`) that runs the kit's
world and restarts it when the hero dies. It grows into `games/samples/dungeon` at Engine 0.15.

## Entry point

- `index.html` is the page (a full-screen `#screen` canvas); its script is `./main.ts`.
- `main.ts` boots the game: the Canvas2D backend and viewport, keyboard and gamepad input, audio
  with the demo song, and a `SceneStack` with `DemoScene`, driven by the fixed-step loop.

## How to run

- `pnpm dev`, then open the page it prints. The root page forwards to `/games/demo/` (until the dev
  index of games arrives later in 0.2), or open `/games/demo/` directly.
- `pnpm build` builds the demo into `dist/games/demo/`.
- `pnpm test` runs `demo.test.ts`, which checks the song compiles and the rooms run headless through
  the kit with the null backend.

## Imports

- Allowed: relative paths inside `games/demo`, `@engine/*` (core and backends) and `@kits/*`.
- Never: other games. Nothing in `engine/` or `kits/` may import from here, and no alias points into
  `games/`.
- Game rules belong in data (rooms, songs) wherever possible, not code.
