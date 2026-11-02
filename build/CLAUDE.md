# build

Build tooling for the repo: not engine, kit or game code.

- `pages.ts` (Node only) finds every game page: each `games/<name>/index.html` and
  `games/samples/<name>/index.html`. `vite.config.ts` passes these, plus the root `index.html`, as
  `build.rollupOptions.input`, so a new game is built as its own page with no config edit. It also
  writes the list of games into the root `index.html` at the `<!-- games -->` marker (dev and build).
- `launcher.ts` is the root index page's own tiny bundle (it focuses the first game link).
- Links in the index are relative, so every page works under `VITE_BASE` (e.g. `/Worlds-Within/`).
- Tests: `tests/build/pages.test.ts` (discovery finds `games/demo`, sorting, skipping folders without
  an `index.html`, HTML escaping).

## Imports

- `pages.ts` uses only Node built-ins. Nothing in `engine/`, `kits/` or `games/` imports from here.
