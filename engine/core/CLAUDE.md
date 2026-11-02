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
JSON-safe data, the optional `order(order)`, and from Engine 0.10 the optional `miniGame()`, the
round the game is hosting now or null: gap G37, item 159) and `HeadlessEntry` (`createGame(content, seed)`, and from Engine
0.10 the optional `miniGames(content)`, the `MiniGameDef`s the game's content may name, which
`validate` checks trigger and mission params against: gap G16), which a game's headless module
(named by `headless` in `game.json`) exports for `pnpm cli run`, `dump` and `validate`. `order(order)` (Engine 0.9, items 124-125) takes one recorded order between steps: a run
file's `orders` entry `{ tick, ...order }` goes in, without `tick`, after the snapshot of its tick
and before the step from it, and the game returns null (applied) or a one-line reason (dropped, not
an error). Games without orders leave it out and are unchanged; a run file with `orders` for a game
without it is a usage error (`engine/tools/CLAUDE.md`, Recorded orders). `HostedGame<W, E>`
(Engine 0.10, gap G37) is a `HeadlessGame` the browser shell's `HostScene` can play by itself:
`world` (the world now; a new object on a new level), `events` (the last step's) and a required
`miniGame()`; the platformer kit's `LevelSequence` is one, so a game's page passes the game to
`new HostScene({ stack, game, picture })` instead of writing accessors. `canonicalJson(value)`
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

`kit.ts` is the kit hook: `KitDef { name, kinds(), rules, strictMutants?, miniGameUses? }`, what a
kit tells the tools about itself (`miniGameUses(content)`, Engine 0.10: where the kit's content
names a mini game and its params, such as a platformer level's triggers, for `validate`), and `defineKit(def)`, which checks the name (lower-case letters, digits and
"-") and the rule list (`defineRules`) and throws on a bad one. Each kit exports one as `kit` from
`kits/<name>/kit.ts`. Pure (on `PURE_CORE`).

`minigame.ts` is the mini game contract, in the style of SMBC's `MiniGameDef`: `MiniGameResult`
(`pass` | `fail` | `quit`), `MiniGameContext` (`params`, the host's JSON data for the round, and
`attempt`), `MiniGame` (`step(input)`, `snapshot()` as JSON-safe data, `result()` null until it
ends, `present?()` a `PresentFrame`, and from Engine 0.10 the optional `report?()`, a structured
JSON-safe report read once the round has ended, which a mission's adapter turns into an outcome),
`MiniGameDef` (`id`, `title`, the optional `paramsSchema` (Zod, Engine 0.10: the shape of the
round's `params`, for `validate`, gap G16), `create(ctx, seed)`: everything random from `seed`) and `miniGameTable(defs)` (the defs by id; throws on a bad id or one given
twice). A host (a kit's world) steps the round headless while it pauses itself and puts the
round's snapshot in its own, so hashes cover it. It imports no scene, so kits may use it; pure (on
`PURE_CORE`). `minigame-params.ts` (Engine 0.10 T8, gap G16, item 157) checks mini game params with the content:
a `MiniGameUse` `{ file, game, gameAt, params, paramsAt }` is one place in a game's content that
names a mini game (a level trigger, a mission's `play`) and hands it params;
`missionMiniGameUses(content)` lists the missions' (`play`, `params`, `{}` when none), a kit's hook
gives its own (`KitDef.miniGameUses`); `miniGameParamErrors(uses, defs, root?)` returns a
`ContentError` per problem, in the uses' order: `unknown_mini_game` at the id (naming the ids
there are) when no def has it, else each issue of the def's `paramsSchema` (when it has one) at its
field under the params (`triggers.0.params.goal`), with Zod's codes. It builds no round. Pure (on
`PURE_CORE`); tested in `minigame-params.test.ts`; `engine/tools/mini-game-check.ts` runs it.
`minigame-scene.ts` is the browser side for games' glue: `miniGameScene({ game,
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

`missions.ts` (Engine 0.10 T2, items 153-154) is the mission contract as plain JSON data, here
for the same reason: `engine/sim` runs the lifecycle (open, play or delegate, commit, frozen
events) and kits play missions, and neither imports the other. `missionSchema` is a mission
definition and the `mission` content kind (`*.mission.json`, `content/engine-kinds.ts`): `id`,
`title`, `event?` (the event frozen while it is open), `worldTimeCost` (whole ticks, at least 1,
fixed when it opens), `play` (the mini game or kit round a player plays it with), `params?` (JSON,
checked by that mini game's `paramsSchema` when `validate` runs: `minigame-params.ts`), `outcomes` (at least one, unique ids, each
`{ id, title, weight (whole, >= 1, default 1), effects }`), `onQuit` (a declared outcome) and
`playable?` (a subset). Effects are data only, told apart by `type`: `damage`, `destroy`,
`inventory`, `set`, `opportunity` (`MISSION_EFFECT_TYPES`). There is no retry: no `attempt`, a
mission ends in one declared outcome. The types: `MissionReport` (`{ outcome, stats? }`, what a kit
reports through its adapter), `MissionResult` (`{ mission, outcome, effects, report? }`),
`MissionRecord` (the committed, append-only record the sim keeps: `resolution`, `openTick`,
`commitTick`, `experienceTicks`, `skipped`) and `MissionAdapter<KitInput, KitReport>`
(`input(snapshot, mission)` from the plain world snapshot, `outcome(report, mission)` to a
`MissionReport`). Helpers: `totalWeight`, `pickOutcome(mission, n)` (the outcome a delegation draw
`n < totalWeight` falls in, walking file order), `missionResult(mission, id, report?)` (refuses an
undeclared, or for a played one unplayable, id as `unknown_outcome`), `playedResult(adapter,
mission, kitReport)` and `parseMission(json)`. From T5, `opportunitySchema` (`OpportunityDef`, a
window `{ id, mission, opens, closes, exclusive?, closesOthers?, relative? }` with `opens <
closes`; `engine/sim/opportunity.ts` runs it) and `parseOpportunity(json)`. Pure (on `PURE_CORE`); tested in
`missions.test.ts`; in `docs/reference/schemas.md`.

`campaign.ts` (Engine 0.10 T10, gap G2, item 160) is the order a game plays its levels or
missions in, written in data: `campaignSchema` is the `campaign` content kind
(`*.campaign.json`, `content/engine-kinds.ts`): `version` (1), `id`, `title?`, `entries` (at least
one; each exactly one of `{ "level": id }` and `{ "mission": id }`, `bad_entry`; none twice,
`duplicate_entry`) and `start?` (the id of the entry played first, `unknown_entry` when there is
none, `ambiguous_start` when a level and a mission share it). Its `checkAll`, `checkCampaigns`,
fails each entry naming a level or mission the game's content lacks (`missing_level`,
`missing_mission`, at `entries.<i>.level` or `.mission`), so `pnpm cli validate` names the file and
field. `campaignOrder(campaign)` is the entries from `start` and then round to the ones before it
(a looping sequence's order); `campaignLevels(campaign)` the level ids in that order; `entryKind`,
`entryId`. A kit reads the entries it can play: the platformer kit's `contentStages` plays the
level entries. Missions listed in a campaign are checked by `validate` only; playing them in order
comes at 0.13. Pure (on `PURE_CORE`); tested in `campaign.test.ts`; in `docs/reference/schemas.md`.

`mission-adapter.ts` (Engine 0.10 T7) is the reusable half of a `MissionAdapter`: playing a
mission through a kit's mini game with plain data only, so the kit never imports `engine/sim`.
`snapshotEntities(snapshot, ...components)` lists a plain world snapshot's entities (`{ id,
components }`, ascending id, with every component) that have all the named components; it throws
on a snapshot not of the world's shape. `playMissionRound({ mission, snapshot, adapter, start,
input, maxTicks? })` calls `adapter.input(snapshot, mission)`, starts the round with `start`
(usually a `MiniGameDef`'s `create`), steps it with `input(tick, round)` until `result()` is
non-null, then maps its end, `MiniGameEnd` `{ result, report (the round's `report()`, or null),
ticks }`, through `adapter.outcome` and checks it with `playedResult`. It returns `{ ok: true,
result, end, round }` (the `MissionResult` the caller commits, e.g. `commitMission(world, id,
result)`) or refuses with `code`: `unfinished` (no result within `maxTicks`, default
`MISSION_ROUND_MAX_TICKS` = 100,000), `unmappable_report` (the adapter threw: the report fits no
outcome) or `unknown_outcome` (an undeclared outcome, or one outside `playable`). A refusal commits
nothing. A round that ends in `quit` is not a played result: it skips the adapter and the
`playable` check and returns `{ ok: true, quit: true, result }` with the mission's `onQuit` (no
report); the caller resolves it with `quitMission(world, id)` and then commits, so the record's
resolution is `quit`. Every other success has `quit: false`. The adapter itself (which entities become what, which report means which outcome) is per
game and kit pairing; `tests/kits/mission-adapter.test.ts` has one for the topdown kit's room
challenge over the siege fixture. Pure in practice; not on `PURE_CORE` yet because no kit or sim
file imports it at run time (add it there when one does). Tested in `mission-adapter.test.ts`.

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
the layer table (today: `rng.ts`, `headless.ts`, `rules.ts`, `kit.ts`, `orders.ts`, `missions.ts`, `campaign.ts`, `rts-types.ts`, `minigame.ts`, `minigame-params.ts`, `minigame-scene.ts`, `shell/backend-choice.ts`, `shell/host-scene.ts`, `math/**`, `scene.ts`, the input actions, bindings, input manager
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
