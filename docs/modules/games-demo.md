# games/demo

Folder: `games/demo`. Detailed rules: [`games/demo/CLAUDE.md`](../../games/demo/CLAUDE.md).

## Purpose

The proof-of-life demo game built on the top-down kit: three rooms, one MML song and a thin scene
that runs the kit's world and restarts it when the hero dies. It is content, not engine, and grows
into `games/samples/dungeon` at Engine 0.15.

## Public API entry points

- `index.html`: the page (a full-screen `#screen` canvas) that loads `main.ts`.
- `main.ts`: boots the Canvas2D backend, input, audio and a `SceneStack` with `DemoScene`.
- `scene.ts` (`DemoScene`), `rooms.ts`, `music.ts`: the scene and the content.

## Imports allowed

- Relative paths inside `games/demo`, `@engine/*` (core and backends) and `@kits/*`.
- Never other games. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test` runs `demo.test.ts` (the song compiles and the rooms run headless with the null
backend). `pnpm dev` and open `/games/demo/` to play it.
