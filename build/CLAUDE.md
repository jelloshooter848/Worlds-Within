# build

Build tooling for the repo: not engine, kit or game code.

- `pages.ts` (Node only) finds every game page: each `games/<name>/index.html` and
  `games/samples/<name>/index.html`. `vite.config.ts` passes these, plus the root `index.html`, as
  `build.rollupOptions.input`, so a new game is built as its own page with no config edit. It also
  writes the list of games into the root `index.html` at the `<!-- games -->` marker (dev and build).
  A game page can add extra launcher links to itself with a query (Engine 0.6): each
  `<meta name="ww-alternate" content="<label> <?query>">` in its `index.html` becomes a link
  `<dir>/<?query>` after the game's own (the platformer lab's `3D ?backend=three`).
- `launcher.ts` is the root index page's own tiny bundle (it focuses the first game link).
- Links in the index are relative, so every page works under `VITE_BASE` (e.g. `/Worlds-Within/`).
- Tests: `tests/build/pages.test.ts` (discovery finds `games/demo`, sorting, skipping folders without
  an `index.html`, HTML escaping, `ww-alternate` links).

## Imports

- `pages.ts` uses only Node built-ins. Nothing in `engine/`, `kits/` or `games/` imports from here.
