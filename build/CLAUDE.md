# build

Build tooling for the repo: not engine, kit or game code.

- `pages.ts` (Node only) finds every game page: each `games/<name>/index.html` and
  `games/samples/<name>/index.html`. `vite.config.ts` passes these, plus the root `index.html`, as
  `build.rollupOptions.input`, so a new game is built as its own page with no config edit. It also
  writes the list of games into the root `index.html` at the `<!-- games -->` marker (dev and build).
  A game page can add extra launcher links to itself with a query (Engine 0.6): each
  `<meta name="ww-alternate" content="<label> <?query>">` in its `index.html` becomes a link
  `<dir>/<?query>` after the game's own (the platformer lab's `3D ?backend=three`).
- `game-files.ts` (Engine 0.14 T2, gap G5) is the Vite plugin for `virtual:game-files`, registered
  in `vite.config.ts`. A game's browser code writes `import files from 'virtual:game-files'` and
  gets its own data files as `{ path: text }` pairs: the plugin walks up from the importer to the
  nearest folder holding a `game.json` and returns its `./game.json` and every `./content/**/*`
  file (hidden ones skipped, sorted: the keys the old per-game `import.meta.glob` gave). Outside a
  game folder the import fails with an error naming the importer. In dev, adding, changing or
  removing a data file reloads the page; `vite build --watch` watches the same files. Games write
  no `files.ts` (they all went away in 0.14 T2). `virtual-game-files.d.ts` types the module for
  `tsc`. Node tools read the same files with `readGameFiles` (`engine/core/node/game-files.ts`).
- `launcher.ts` is the root index page's own tiny bundle (it focuses the first game link).
- Links in the index are relative, so every page works under `VITE_BASE` (e.g. `/Worlds-Within/`).
- Tests: `tests/build/pages.test.ts` (discovery finds `games/samples/dungeon`, sorting, skipping folders without
  an `index.html`, HTML escaping, `ww-alternate` links) and `tests/build/game-files.test.ts` (the
  nearest game folder, the same keys and texts as `import.meta.glob`, a real build, the error
  outside a game folder).

## Imports

- `pages.ts` and `game-files.ts` use only Node built-ins (and Vite's types). Nothing in `engine/`,
  `kits/` or `games/` imports from here; games reach `game-files.ts` only through the virtual id
  `virtual:game-files`, which the dependency rule reads as an external package.
