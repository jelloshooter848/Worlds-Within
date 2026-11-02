# engine/core

The engine's core: the fixed-step loop (`loop.ts`), scenes (`scene.ts`), input (`input/`), chiptune
audio and MML (`audio/`), save and settings (`save/`), the seeded RNG (`rng.ts`), maths (`math/`),
asset packs (`assets/`), accessibility (`a11y/`), platform detection (`platform.ts`), graphics
data: palettes, sprite sheets, text pixel art, animation and the screen size and fit maths
(`gfx/`), and the content core (`content/`: Zod schemas, text grids and content errors; see
[content/CLAUDE.md](content/CLAUDE.md)), the presentation contract (`present/`: the read-only
per-frame snapshot a backend draws from; see [present/CLAUDE.md](present/CLAUDE.md)), with `node/game-files.ts` reading a game's content
files from disk for Node tools and tests.

`headless.ts` is the headless game contract: `HeadlessGame` (`step(input)`, `snapshot()` as plain
JSON-safe data) and `HeadlessEntry` (`createGame(content, seed)`), which a game's headless module
(named by `headless` in `game.json`) exports for `pnpm cli run` and `dump`. `canonicalJson(value)`
writes a snapshot with sorted keys and throws on anything not JSON-safe (`undefined`, `NaN`,
`Map`...), naming the path; the tools hash that text. It is pure (on `PURE_CORE`).

`view.ts` is the view contract: `ViewGame` (a `HeadlessGame` plus `screen`, the picture size it
draws, taken from `content.manifest.screen`, and `render(r)`) and `ViewEntry`
(`createView(content, seed, opts?)`), which a game's view module (named by `view` in `game.json`)
exports for `pnpm cli screenshot`. Types only.

`rules.ts` is the named-rule mechanism behind mutant checks: a kit declares its rules with
`defineRules([{ id, description }])` and builds a `RuleSwitch(rules, disabled)` from the ids a run
switches off (`HeadlessOptions.disabledRules`, passed by `createGame(content, seed, opts)`); its
code guards each rule with `isOn(id)`. Unknown ids throw. It is pure (on `PURE_CORE`).

`gfx/screen.ts` is the picture size and its fit: `ScreenSize`, `DEFAULT_SCREEN` (256x240, the size of
a game whose `game.json` has no `screen`), `SCREEN_MIN` / `SCREEN_MAX` (64..1920, the manifest's
limits) and `fitGame(size, cssW, cssH, dpr, integerScale, fit?)`, used by the canvas2d `Viewport`
and the touch layout (`layoutScreen` takes `screen` in its input). Nothing else hard-codes a
picture size. Pure.

`gfx/renderer.ts` is the drawing interface: the `Renderer` interface, `Rotation`, and the
helpers `transformed`, `translucent`, `clipped` and `OffsetRenderer`. Backends implement it; core
never knows which one is drawing.

## Imports

- Allowed: other files in `engine/core` (relative paths) and npm packages.
- Never: `engine/backends`, `engine/sim`, `engine/tools`, kits or games.
- No game rules or game content here (see Fixtures below).
- Randomness goes through `Rng` (`rng.ts`), never `Math.random`, in anything a kit or the sim uses.

## The pure core

Kits and the sim must run the same in Node and in any browser, so the core files they use are
**pure**: no `Math.random`, `Date.now`, `performance.now` or DOM globals (`document`, `window`,
`localStorage`, `requestAnimationFrame`, ...). The list is `PURE_CORE` in `config/layers.js`, next to
the layer table (today: `rng.ts`, `headless.ts`, `rules.ts`, `math/**`, `scene.ts`, the input actions, bindings, input manager
and scripted input, the renderer contract, palette, animation, screen and sprite sheet data,
`audio/mml.ts`, the song, sprite and palette schemas, `content/**`, `present/**` and `assets/sheet-lookup.ts`). ESLint enforces the rule on those
files; `tests/architecture/purity.test.ts` follows every run-time import (not `import type`) from
kits, the sim and the pure core itself into core and fails if a file it reaches is not on the list. When a kit or the sim starts importing another core file, make
that file pure and add it to `PURE_CORE`. Wall-clock time and the DOM belong in `loop.ts`, the
browser input sources, `save/`, `assets/` (except `sheet-lookup.ts`, `sheetLookup(assets)`: a sheet getter that
returns null, never throws, for a missing sheet or palette) and the backends.

## Fixtures

All game content (rooms, songs, sprites, palettes made for a game's art) lives in `games/`. The
engine and kits keep only **tiny test fixtures**, in one of two places:

- inline in a `*.test.ts` file (a three-row room, a one-line song, a two-pixel frame), or
- in a `__fixtures__/` folder next to the tests that use it, when several tests share it or it is
  too long to read inline. Only tests import from `__fixtures__/`.

Keep fixtures as small as the test allows; anything that looks like a level or a tune belongs in a
game. `tests/architecture/no-content.test.ts` scans every other file under `engine/` and `kits/`
and fails on content markers: `Song` and `Sfx` objects, MML source strings, `.mml` files, room literals
(`map: [...]`), sprite definitions (`palette` plus `frames` with pixel rows) and any bare text grid
of equal-length rows.

Generic data the engine needs is not content and may stay: the `NES` colour names in
`gfx/palette.ts` (the shared colour vocabulary every game picks from), the colour-blind mode list,
and the MML noise macros.

## Testing

Tests sit next to the code as `*.test.ts` and run in Node (`pnpm test`). They must not need a
browser: use fakes for canvas, audio and DOM, as the existing tests do.
