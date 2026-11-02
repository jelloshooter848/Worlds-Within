# games/demo

The current demo: a proof-of-life game built on the top-down kit. It is content, not engine, and its
content lives in data files, not TypeScript. It grows into `games/samples/dungeon` at Engine 0.15.

## Files

- `game.json`: the game manifest (schema: `engine/core/content/manifest.ts`). It names the kit, the
  content files by kind (globs), the start seed and the headless entry (`headless.ts`).
- `content/rooms/<id>.json` + `<id>.map.txt`: a room (schema: `kits/topdown/schema.ts`). The JSON
  holds `id` (must match the file name), `at`, `music`, `chests` and the other `RoomDef` fields;
  the `.map.txt` file is the 11x16 map grid in the kit's `LEGEND` (`kits/topdown/room.ts`).
- `content/songs/<id>.json`: an MML song (schema: `engine/core/audio/song-schema.ts`).
- `content/palettes/<id>.json`: a palette (schema: `engine/core/gfx/palette-schema.ts`).
- `content/sprites/<sheet>.txt`: text-grid pixel art (format: top of
  `engine/core/gfx/sprite-schema.ts`). The file name is the sheet id: `demo-hero.txt` is the hero
  sheet (`DEMO_SHEETS.hero`), with the kit's hero frame names (`down-0`, `side-1`, `attack-up`...).
- TypeScript is glue only: `content.ts` (the content kinds, `loadDemo`, and `demoDungeon`,
  `demoSongs`, `demoArt` over the loaded bundle), `files.ts` (the browser's file pairs through
  Vite's `import.meta.glob` with `?raw`), `headless.ts` (`createWorld(content, seed?)`), `scene.ts`
  (`DemoScene`) and `main.ts` (boots the Canvas2D backend, input, audio and assets).

## Adding or changing content

- Edit the data files; never put rooms, MML or pixel rows in `.ts` files
  (`tests/architecture/no-content.test.ts` fails on them).
- A new file must be claimed by a kind in `game.json` (otherwise it is an `unclaimed_file` error).
- Node code reads the folder with `readGameFiles` (`engine/core/node/game-files.ts`) and checks it
  with `loadDemo`; every error names the file (`games/demo/content/...`) and the field.
- After any content change run `pnpm -s cli validate games/demo --json`: exit 0 means every file
  passes; exit 3 lists each error with its file and field.

## How to run

- `pnpm dev` opens the index of games; pick `games/demo`, or open `/games/demo/` directly.
- `pnpm build` builds the demo (content included) into `dist/games/demo/`.
- `pnpm test` runs `demo.test.ts`: it loads the data files from disk, walks the hero east into the
  guard room with the null backend (drawing the hero sprite), compiles the song, and checks that a
  broken field gives an error naming the file and the field.

## Imports

- Allowed: relative paths inside `games/demo`, `@engine/*` (core and backends) and `@kits/*`.
- Never: other games. Nothing in `engine/` or `kits/` may import from here, and no alias points into
  `games/`.
- Game rules belong in data (rooms, songs) wherever possible, not code.
