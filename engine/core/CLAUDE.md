# engine/core

The engine's core: the fixed-step loop (`loop.ts`), scenes (`scene.ts`), input (`input/`), chiptune
audio and MML (`audio/`), save and settings (`save/`), the seeded RNG (`rng.ts`), maths (`math/`),
asset packs (`assets/`), accessibility (`a11y/`), platform detection (`platform.ts`), graphics
data: palettes, sprite sheets, text pixel art, animation and the screen size and fit maths
(`gfx/`), and the content core (`content/`: Zod schemas, text grids and content errors; see
[content/CLAUDE.md](content/CLAUDE.md)), the presentation contract (`present/`: the read-only
per-frame snapshot a backend draws from; see [present/CLAUDE.md](present/CLAUDE.md)), the browser shell
games share (`shell/`: the `?backend=` choice, `HostScene` and `bootBrowserGame`; see
[shell/CLAUDE.md](shell/CLAUDE.md)), with `node/game-files.ts` reading a game's content
files from disk for Node tools and tests.

`headless.ts` is the headless game contract: `HeadlessGame` (`step(input)`, `snapshot()` as plain
JSON-safe data) and `HeadlessEntry` (`createGame(content, seed)`), which a game's headless module
(named by `headless` in `game.json`) exports for `pnpm cli run` and `dump`. `canonicalJson(value)`
writes a snapshot with sorted keys and throws on anything not JSON-safe (`undefined`, `NaN`,
`Map`...), naming the path; the tools hash that text. It is pure (on `PURE_CORE`).

`view.ts` is the view contract: `ViewGame` (a `HeadlessGame` plus `screen`, the picture size it
draws, taken from `content.manifest.screen`, `render(r)`, and the optional `frame()`) and
`ViewEntry` (`createView(content, seed, opts?)`), which a game's view module (named by `view` in
`game.json`) exports for `pnpm cli screenshot`. `frame()` (Engine 0.6) returns the frozen
`PresentFrame` for the state now, with the events since the last call, so a tool can show the game
through any `Presenter` (the Three.js backend) instead of drawing it with `render(r)`; a run uses
one or the other, never both (each keeps its own stream of frames). Like `render`, it must not
change the game. The optional `background` (a CSS hex colour) is the colour a presenter of
`frame()` clears to (`screenshot --backend three`; black when left out). `frameView({ game,
screen, frames, picture, background? })` (Engine 0.7, gap G26) is the one helper there: a
`ViewGame` over a headless game that shows `world` and its last step's `events` (a kit's level
sequence), keeping the events between draws in a `PendingEvents` (dropped on a new world), with
`render(r)` drawing through `picture(r)` (made once per renderer) and `frame()` from `frames.next`
(`view.test.ts`).

`rules.ts` is the named-rule mechanism behind mutant checks: a kit declares its rules with
`defineRules([{ id, description }])` and builds a `RuleSwitch(rules, disabled)` from the ids a run
switches off (`HeadlessOptions.disabledRules`, passed by `createGame(content, seed, opts)`); its
code guards each rule with `isOn(id)`. Unknown ids throw. It is pure (on `PURE_CORE`).

`kit.ts` is the kit hook: `KitDef { name, kinds(), rules, strictMutants? }`, what a kit tells the
tools about itself, and `defineKit(def)`, which checks the name (lower-case letters, digits and
"-") and the rule list (`defineRules`) and throws on a bad one. Each kit exports one as `kit` from
`kits/<name>/kit.ts`. Pure (on `PURE_CORE`).

`minigame.ts` is the mini game contract, in the style of SMBC's `MiniGameDef`: `MiniGameResult`
(`pass` | `fail` | `quit`), `MiniGameContext` (`params`, the host's JSON data for the round, and
`attempt`), `MiniGame` (`step(input)`, `snapshot()` as JSON-safe data, `result()` null until it
ends, `present?()` a `PresentFrame`), `MiniGameDef` (`id`, `title`, `create(ctx, seed)`: everything
random from `seed`) and `miniGameTable(defs)` (the defs by id; throws on a bad id or one given
twice). A host (a kit's world) steps the round headless while it pauses itself and puts the
round's snapshot in its own, so hashes cover it. It imports no scene, so kits may use it; pure (on
`PURE_CORE`). `minigame-scene.ts` is the browser side for games' glue: `miniGameScene({ game,
step?, render, done, translucent? })`, a `Scene` to push over the level that steps the same
`MiniGame` (or the host's `step`, so the host still applies the outcome) and calls `done(result)`
once, for the glue to pop it; it is on `FORBIDDEN_CORE`, so kits never import it, and pure (on
`PURE_CORE`: `shell/host-scene.ts` imports it). Games rarely push it themselves: `shell/host-scene.ts`
(`HostScene`) does it for any host that reports a running mini game.

`orders.ts` (Engine 0.9 T7-T8, item 122) is the RTS order as plain JSON data, defined here so both
`engine/sim` (which carries orders out with `applyOrder`) and kits (which make them) can use it:
`orderSchema` (a Zod union on `type`: `move` with a `target` cell, `attack` with a `target`
entity id, `stop`, `build` with a `target` cell (the north-west cell) and a `building` type,
`train` with a `target` unit type (its `units` are the buildings that train it), `gather` with a
`target` resource node; each with `id` >= 1, `faction` and unique `units`), the `Order` type,
`ORDER_TYPES` and `parseOrder(json)` -> `{ ok, order }` or `{ ok: false, error }` with one line per
bad field (`units: units must not repeat`). Pure (on `PURE_CORE`); tested in `orders.test.ts`.

`rts-types.ts` (Engine 0.9 T8, item 131) is the RTS unit and building type table as plain JSON
data, for the same reason: `rtsTypesSchema` `{ units, buildings }` (a unit type: `health`,
`speed`, `attack`, `range`, `cooldown`, `sight`, `cost`, `trainTicks`, and `work` for builders and
`gather` `{ capacity, ticks }` for gatherers, null when left out; a building type: `health`,
`size` `{ w, h }`, `work`, `cost`, `trains` (unit type ids, checked) and `dropoff`),
`rtsUnitTypeSchema`, `rtsBuildingTypeSchema`, `rtsCostSchema` and the types. The sim keeps the
table in the world (`RtsTypes`); a kit can read the same file as content. Pure (on `PURE_CORE`);
tested in `rts-types.test.ts`; in `docs/reference/schemas.md`.

`gfx/screen.ts` is the picture size and its fit: `ScreenSize`, `DEFAULT_SCREEN` (256x240, the size of
a game whose `game.json` has no `screen`), `SCREEN_MIN` / `SCREEN_MAX` (64..1920, the manifest's
limits) and `fitGame(size, cssW, cssH, dpr, integerScale, fit?)`, used by the canvas2d `Viewport`
and the touch layout (`layoutScreen` takes `screen` in its input). Nothing else hard-codes a
picture size. Pure.

`input/pointer-logic.ts` (Engine 0.9 T5, the RTS view) is pointer input without the DOM:
`PointerGestures({ screen, slop?, longPressMs?, edgeMargin?, edgeSpeed?, wheelPerDouble? })`
turns `PointerSample`s (`down` / `move` / `up` / `cancel` / `leave` / `wheel`, in picture pixels
with a time in ms) into `PointerGesture`s: `feed(sample)` returns what a sample completes and
`tick(t)`, once per game step, what time makes. Mouse and pen: a left click is a primary `tap`, a
right click a secondary one, a left drag past the slop (4 px) a `box` (`move` while held, then
`end`, or `cancel`), a middle drag a `pan`, the wheel a `zoom` about the cursor (500 px of
`deltaY` halve or double it), and the hovering cursor within `edgeMargin` (4 px) of an edge an
edge-scroll `pan` each tick (not while a button is down, not after `leave`). Touch: a tap is
primary, a hold of `longPressMs` (500) without moving secondary, a one-finger drag a box, and two
fingers `pan` (their midpoint) and `zoom` (`source: 'pinch'`, their distance, about the midpoint);
a second finger cancels the first's box and fingers left after a pinch do nothing until they
lift. A `pan`'s `dx`/`dy` is how far the content moves (drag right: dx > 0); `boxRect(g)` gives a
box's corners as a box. Pure (on `PURE_CORE`). `input/pointer.ts` is its DOM side:
`PointerSource(canvas, toScreen, opts)` listens for pointer events and the wheel on the canvas
(`touch-action: none`, pointer capture, no context menu or page scroll there) and, like
`InputManager`, makes this step's `gestures()` in `beginFrame(now)`; `cursor()` is the hovering
cursor. `bootBrowserGame` makes one when a game asks (`shell/CLAUDE.md`). Pan and zoom gestures
drive `RtsCamera` (`present/rts-camera.ts`).

`gfx/renderer.ts` is the drawing interface: the `Renderer` interface, `Rotation`, and the
helpers `transformed`, `translucent`, `clipped` and `OffsetRenderer`. Backends implement it; core
never knows which one is drawing.

## Imports

- Allowed: other files in `engine/core` (relative paths) and npm packages.
- Never: `engine/backends`, `engine/sim`, `engine/tools`, kits or games.
- No game rules or game content here (see Fixtures below).
- Randomness goes through `Rng` (`rng.ts`), never `Math.random`, in anything a kit or the sim uses.
- Kits may import core, but not its drawing and output side (`FORBIDDEN_CORE` in
  `config/layers.js`: `gfx/renderer`, `gfx/spritesheet`, `gfx/pixelart`, `gfx/animation`,
  `assets/**`, audio output, `view.ts`, `scene.ts`, `minigame-scene.ts`, `loop.ts`, `shell/**`). A kit describes frames through
  `present/`; backends draw them. Keep anything a kit needs out of those files.

## The pure core

Kits and the sim must run the same in Node and in any browser, so the core files they use are
**pure**: no `Math.random`, `Date.now`, `performance.now` or DOM globals (`document`, `window`,
`localStorage`, `requestAnimationFrame`, ...). The list is `PURE_CORE` in `config/layers.js`, next to
the layer table (today: `rng.ts`, `headless.ts`, `rules.ts`, `kit.ts`, `orders.ts`, `rts-types.ts`, `minigame.ts`, `minigame-scene.ts`, `shell/backend-choice.ts`, `shell/host-scene.ts`, `math/**`, `scene.ts`, the input actions, bindings, input manager
and scripted input, `input/pointer-logic.ts`, the renderer contract, palette, animation, screen and sprite sheet data,
`audio/mml.ts`, the song, sprite and palette schemas, `content/**`, `present/**` and `assets/sheet-lookup.ts`). ESLint enforces the rule on those
files; `tests/architecture/purity.test.ts` follows every run-time import (not `import type`) from
kits, the sim and the pure core itself into core and fails if a file it reaches is not on the list. When a kit or the sim starts importing another core file, make
that file pure and add it to `PURE_CORE`. Wall-clock time and the DOM belong in `loop.ts`, `shell/boot.ts`, the
browser input sources, `save/`, `assets/` (except `sheet-lookup.ts`, `sheetLookup(assets)`: a sheet getter that
returns null, never throws, for a missing sheet or palette) and the backends.
`assets/content-sheets.ts` (`contentSheets(content)`, Engine 0.7 T9) is a game's sprite and palette
files as a `SheetLookup`, for the glue that hands a backend its sheets.

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
browser: use fakes for canvas, audio and DOM, as the existing tests do. Pointer input:
`input/pointer-logic.test.ts` feeds scripted mouse and two-finger touch samples (click, right
click, box, cancelled box, middle-drag pan, wheel, edge scroll, tap, long-press, touch box,
two-finger pan, pinch, a box cancelled by a second finger); `input/pointer.test.ts` drives
`PointerSource` with fake DOM events.
