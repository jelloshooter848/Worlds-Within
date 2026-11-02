# Feedback log

Whenever Claude needs the owner's feedback or a decision, each item gets a unique number. Numbers
continue across conversations and are never reused, so the owner can answer by number. Every item and
its outcome is recorded here (see `CLAUDE.md`).

**Next unused number: 150.** (Last used: 149.)

| #   | Item                                                  | Answer                                                                          |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| 8   | Mini siege at Engine 0.11                             | Accepted                                                                        |
| 9   | 0.15 sample set release                               | Accepted                                                                        |
| 10  | Tower defense split                                   | Accepted                                                                        |
| 11  | Civilization/hero split; RTS hero unit decided at 0.9 | Accepted                                                                        |
| 12  | Mini siege mission                                    | Answered by 23                                                                  |
| 13  | All four kit samples required for 1.0                 | Yes                                                                             |
| 14  | Stacking-test game and demo grow into samples         | Yes                                                                             |
| 15  | Samples' art style                                    | Answered by 22                                                                  |
| 16  | Engine 1.0 API public or internal                     | Internal                                                                        |
| 17  | Approve roadmap and merge to master                   | Owner still revising                                                            |
| 18  | Add numbering rule to CLAUDE.md                       | Yes (done)                                                                      |
| 19  | Tower-defense prep phase in the mini siege at 0.12    | Accepted                                                                        |
| 20  | Tag names and PixiJS timing                           | Accepted; tags are always three-part, e.g. engine-v0.5.0, so patch releases fit |
| 21  | Branch for the autonomous build                       | One build branch, engine/build-0.15; nothing merged to master                   |
| 22  | Art, music and 3D style                               | NES-style pixel art as text, MML chiptune, procedural low-poly meshes           |
| 23  | Mini siege mission (answers 12)                       | Sabotaging siege engines                                                        |
| 24  | Publishing during the build                           | No publishing and no tags during the build                                      |

Items 1–7 came from an earlier review list (decisions such as the stacking-test scope, the split base
layer, the PixiJS timing and the sim location). All were accepted except item 4, which was a question
about the world simulation that has since been answered.

## Build decisions to review

Choices the autonomous build made that the owner should check. Answer by number.

**Engine 0.2**

- **25.** The root `CLAUDE.md` was changed by the build: the "code is in `src/`" line now describes
  `engine/`, `kits/` and `games/`, and a new line describes the dependency table. Keep this wording?
- **26.** Stricter than the roadmap: a game, kit or backend may not import a sibling in the same layer
  (DESIGN.md already said "never other games/kits"). Keep?
- **27.** One exception to the layer table: any `*.test.ts` may import `engine/backends/null`, so kit
  and game tests run headless. Keep, or should those tests use a local no-op renderer?
- **28.** Only part of `engine/core` is pure (the list `PURE_CORE` in `config/layers.js`); audio output,
  saving, browser input, `touch-logic.ts` and `save/settings.ts` are not. `new Date()` is not banned,
  only `Date.now`. OK?
- **29.** New top-level tooling folders `build/` (page discovery, launcher) and `config/` (layer table,
  checker, ESLint plugin, plain JS with `@ts-check`; `tsconfig.json` gained `allowJs`). OK?
- **30.** The kit still draws (`render.ts`, `hud.ts`, `draw` methods), recorded as debt in
  `kits/topdown/CLAUDE.md`. Which release should remove it?
- **31.** The NES colour-name table stays in `engine/core/gfx/palette.ts` as engine data, though some
  names are themed (`mushroomRed`, `greenPipe`). Rename them later, or keep?

**Engine 0.3**

- **32.** The demo gained an original hero sprite sheet and a palette (with a new `palette` content
  kind), so the sprite kind is used by real content; the roadmap only said to move existing sprites.
  Keep?
- **33.** The CLI keeps the name `pnpm cli` (the roadmap said the name could change). Agents use
  `pnpm -s cli ... --json` so pnpm's banner stays off stdout. Keep the name?
- **34.** Beyond the roadmap's command list, the CLI has `help` and `mutants`, and `game.json` gained
  an optional `view` entry (the module `screenshot` draws with). OK?
- **35.** `.claude/skills/` is committed while the rest of `.claude/` stays git-ignored. OK?
- **36.** The scaffold skill covers only the top-down kit, the only kit so far. Should each new kit
  add its own section to the one skill, or get its own scaffold skill?
- **37.** The hand-check game (`games/hand-check`) was deleted after the check rather than kept as
  a fixture, since the demo covers every file it had. OK, or keep a minimal game as a scaffold
  fixture with its own test?
- **38.** CI installs Chromium (`playwright install --with-deps chromium` in the workflow) and the
  screenshot test is required there; locally it skips without a browser. OK?
- **39.** Each `AGENTS.md` is a one-line pointer to the folder's `CLAUDE.md`, not a copy, so the
  text lives in one place. OK?
- **40.** The demo's screenshot includes debug text in a system font, so PNGs match on one machine
  but may differ between machines; no golden PNG hash is committed (state hashes are still checked).
  OK, or remove the debug text from screenshots?
- **41.** `mutants` reports weak rules but still exits 0 (only a run that fails as it is exits 4).
  The demo's run guards only `doors-change-room`. Make weak rules fail from Engine 0.5?
- **42.** `set` only changes a value that exists; new keys need `add`, so a typo in a path is an
  error instead of a new field. OK?
- **43.** Added an `sfx` content kind (not asked for) so sound effects can move into data files.
  Songs and sfx are JSON only, with no `.txt` form for MML yet. OK?
- **44.** The tools learn each kit's content kinds and rules from a table in `engine/tools/kits.ts`
  that knows only the top-down kit's default room legend. Replace it with a hook each kit provides
  when the next kit arrives (0.5)?

**Engine 0.4**

- **45.** The demo's look changed slightly while its rules did not: the skin adds HUD hearts and
  event sounds, and a hurt hero or monster no longer blinks, stun stars no longer turn and the exit
  no longer glows (a skin cannot express those yet). State hashes are unchanged. Accept, or should a
  skin gain a way to hide or cycle an entity's frames before 0.5?
- **46.** Kits are kept off the core's drawing and output side (`FORBIDDEN_CORE`: the `Renderer`,
  sprite sheets, assets, audio output, scenes, the loop) and a scan rejects drawing calls in kit
  code, which is stricter than the roadmap's "kits can't import a backend". Keep?
- **47.** Skins hold HUD entries and a camera default as well as kinds, tiles and events, and the
  skin schema already has the 3D mesh shape for 0.6. The demo's title and status lines stay as
  debug text drawn by the game. OK?
- **48.** An entity's `facing` is a closed set (`up`, `down`, `left`, `right`), which fits the
  top-down kit. The RTS (0.9) may need more directions or an angle. Widen it then, or now?
  _Answered by 128 (Engine 0.9): widened then, to eight directions (`up-left`, `up-right`,
  `down-left`, `down-right` added); done in Engine 0.9 T2._
- **49.** A room slide is sent as one combined map of both rooms, because a frame holds only one
  map. On a picture wider than 256 the neighbouring room shows in the side strips during a slide.
  OK?
- **50.** The old art-contract constants (`DEFAULT_SHEETS`, `PERSON_SHEET`, `BEAM_PALETTES`) were
  deleted, not moved into the demo skin as the roadmap said, because the skin uses its own
  placeholder sheets. The old names remain only as reference in `kits/topdown/CLAUDE.md`. OK?
- **51.** The Canvas2D presenter ignores the camera's `zoom`, `deadzone` and `lerp` and the `tint`
  fx for now (the contract lets a backend ignore them), and the demo runs it with `clamp: false`.
  Implement them in 0.5 with the platformer, or later?

**Orchestrator defaults taken in Engine 0.5** (items still open; the owner can overrule them)

- **41:** weak rules fail `mutants` (exit 4) only for a kit that opts in with `strictMutants: true`.
  The platformer kit opts in; the top-down kit stays report-only. See item 56.
- **44:** done. Each kit exports a `KitDef` hook from `kits/<name>/kit.ts`, and `pnpm docs:gen`
  generates the tools' kit list (`engine/tools/kit-list.ts`).
- **51:** deadzone, lerp and clamping (to the map or a hint's `bounds`) were implemented in 0.5.
  `zoom` is still ignored, and the demo keeps `clamp: false`. See item 55.
  _Engine 0.9 T2: the Canvas2D presenter now honours `zoom` too (the hint's, else the skin's);
  see 141._

**Engine 0.5**

- **52.** The roadmap puts the fixture level in `kits/platformer`. It is there, and browser play
  lives in a test game, `games/platformer-lab`, which plays a byte-identical copy (checked by a
  test) plus five rule levels, a placeholder skin and a test mini game. OK, or should the lab
  become the platformer sample in `games/samples/` later?
- **53.** Physics numbers are a content kind of their own (`profile`), separate from levels, and
  enemy behaviour is set per actor type in the profile, not in code. OK?
- **54.** SMBC behaviour left out of the kit: character-specific moves (crouch, slides, wall moves,
  flutter, air jumps, cut jumps), swimming, power states, running over one-tile gaps, coyote time,
  other start modes, moving power-ups, score and timer (the full list is in
  `kits/platformer/CLAUDE.md`). Add any of them before Worlds Within's platformer (0.7)?
- **55.** Camera precedence: the world keeps its own view, which decides the scroll lock and when
  actors wake. The picture's camera is the presenter's: it follows the runner with a deadzone and
  lerp inside the hint's `bounds`, so the picture can lag the world's view by a few pixels. A
  frame hint's values win over the skin's camera defaults. OK?
- **56.** The strict-mutants design: a kit opts in through its hook, each run file names the rules
  it guards (`guards`), and `mutants games/<game>` needs every rule guarded by some run file, not
  every run guarding every rule. Should the top-down kit become strict too? Its demo would need
  run files that guard every rule.
- **57.** Golden traces were recorded once from SMBC's headless runner, through a Vite module
  runner. The generator is kept as text in the fixtures' README and the JSON is committed, so CI
  never needs SMBC and nothing re-checks SMBC automatically. OK?
- **58.** The mini game contract is in `engine/core` (pure), with `miniGameScene` for browser glue,
  rather than in the platformer kit, so other kits can host mini games. Trigger outcomes are a
  closed list in level data (`coins:<n>`, `life`, `clear`, `respawn`, `open:<col>:<row>`). OK?
- **59.** The lab plays its levels in a fixed order, so a run file for a later level replays the
  earlier ones first (runs of up to 3015 ticks, and a change to an early level moves every later
  tick). Should run files be able to start at a chosen level?
- **60.** The browser play check for 0.5 (as in 0.4) was a manual Playwright script recorded in
  the build log, not a committed test. The CLI screenshot and the backend-parity test cover
  Canvas2D drawing. Add a committed browser test that loads each game's page and presses a key
  (skipped where no browser is installed)?
- **61.** Level format: enemy spawns, bump-block contents and mini-game triggers are lists in each
  level's header (`spawns` maps characters the level picks to actor types; `blocks` and `triggers`
  give one entry per `?` and `!` in reading order), not fixed legend characters. OK?
- **62.** The snapshot gives the player's position as the bottom centre of its box, while the world
  (like SMBC) moves a top-left box, and the golden traces compare the top-left. OK, or should the
  snapshot use the top-left too?
- **63.** Mutants defaults: a run file without `guards` is expected to guard every rule it does not
  switch off itself; in `mutants games/<game>` a run is held only to its own `guards`. Listing a
  rule twice, or both guarding and switching it off, is a schema error. OK?
- **64.** To match SMBC's traces the kit was changed, not the profile numbers: the player starts
  in the air (tick 0 is an air tick, the first jump is possible on tick 2), and the profile gained
  an optional `jumpBuffer` (4 ticks, as SMBC remembers a jump press). OK?

**Engine 0.6**

- **65.** Software GL policy: `pnpm cli screenshot --backend three` refuses a software WebGL
  renderer (SwiftShader, llvmpipe and the like) with exit 4, and `--allow-software-gl` is an
  explicit opt-in that forces SwiftShader so the PNG is repeatable on one machine. The build
  container has no GPU, so every 3D screenshot so far was taken with the flag, and the browser
  smoke test accepts SwiftShader. OK, or should CI also take 3D screenshots (with the flag), or
  should the flag go?
- **66.** In 3D the HUD (`skin.hud`, `frame.status`) and `particles` effects are not drawn;
  `flash`, `tint` and `shake` are, with one ambient and one directional light and no shadows.
  Leave them out until a game needs them (0.7 is the first game shown in 3D), or add a HUD
  overlay now?
  (Engine 0.7 T8 default taken: left out and moved to 0.15, gap G33; the stacking test plays in
  3D without them. Overrule to get a HUD sooner.)
- **67.** The 3D path reads a game through an optional `frame()` hook on the view (beside
  `render(r)`, with an optional `background` colour), so the 2D path and the demo did not change.
  Should every view give `frame()` (and `render` become a helper over it), or keep it optional?
- **68.** The 3D mesh format: primitives (`box`, `wedge`, `cylinder`, `cone`, `sphere`, `plane`)
  and named compound meshes of parts, in world px with `depth` and `z`, inside the skin JSON, with
  no external model format (glTF, OBJ). OK?
- **69.** In the browser, 3D is picked with `?backend=three` (Canvas2D stays the default), the page
  has a 2D/3D toggle, and the root launcher lists a 3D link per game that has one. OK, or should a
  game choose its default backend in `game.json`?
- **70.** The dependency table gained `PACKAGES`: npm packages only some units may import (today
  `three`, only from `engine/backends/three`), enforced by ESLint and the dependency-rule test.
  OK? Should other packages (Zod, Playwright) be listed too?
- **71.** The 3D camera honours `zoom` (by distance), while the Canvas2D presenter still ignores it
  (item 51). Make 2D honour `zoom` as well, or leave it?
- **72.** In 3D, map `layers` are background scenery behind the main tiles (layer i at
  z = -(i+1) x `camera3d.layerDepth`), while in 2D they draw over the tiles and under the
  entities. OK?
- **73.** In 3D, entities on the same layer share one depth plane, so their list order does not
  decide which is in front (in 2D it does). Fix now, or leave until a game needs it?
- **74.** The lab's three skin sets `camera3d.layerDepth` to 0.25 instead of the default 16,
  because the kit's draw layers go up to 20 and 16 would put the runner near the camera. Should
  the default change, or should kits keep their layer numbers small?
- **75.** Done-when item 3 (screenshot `--backend three`) was marked met using SwiftShader with
  `--allow-software-gl`; the no-flag path on a real GPU was never run (no GPU in the container).
  Accept, or keep 0.6 open until it is checked on a GPU?

**Engine 0.7** (gaps in `docs/reports/stacking-test.md`)

- **76.** Gap G7: the platformer kit is strict, so `pnpm cli mutants games/platformer-test` fails
  until the game's run files guard every kit rule, even rules its levels never use (shells,
  hazards, mini games...). Should a game list the kit rules it uses (say `rules` in `game.json`)
  so strict mutants check only those, should each game guard every rule anyway, or should strict
  mode apply only to the kit's own lab?
- **77.** Gap G8: tuning a run file needed a throwaway script to print a trace of a few paths over
  a tick range; `dump` shows one tick per call. Add a CLI `trace` command (or `dump --ticks`)
  now, or leave it for the 0.14 creator tools?
- **78.** Gap G9: a run file always starts at the game's first level, so `level-3.run.json` replays
  levels 1 and 2 first (level-3 starts at tick 1161) and any change to an early level moves the
  ticks of every later run file. Add a start level to run files (say `"start": { "stage": 2 }`,
  passed to `createGame` and the kit's `LevelSequence`) in 0.7, or leave it for the 0.14 creator
  tools?
- **79.** Gap G10: placing things by column in a 56-60 character map row is easy to get wrong
  (the map files have no ruler), and `set <map> rows.R.C` fixes one cell per call. Is that enough
  until the 0.14 creator tools (a region `set`, or a ruler in `get`), or should it come sooner?
- **80.** Gap G12: the top-down kit's rules inside the door level's round are not mutant-checked
  (`mutants` tries only `kit`'s rules, and the headless contract has one flat rule list).
  `roomChallenge` already takes `disabledRules`. Make `mutants` per-kit (rule ids and strictness
  per kit, routed by the game's glue) in 0.14 with the creator tools, or sooner?
- **81.** Gap G20: on the tick a mini-game round ends, the platformer snapshot drops the round, so
  its last events (the final `kill`, `dead`, `exit`) are in no snapshot. Keep the ended round in
  the snapshot for that tick (changes the lab's `mini-game` golden hashes), or leave it?
- **82.** Engine 0.7 T8, the top-down round in 3D: the vault room is laid flat facing the camera
  (the top-down picture seen from the front: walls and statues stand forward as blocks, the floor
  is sunk behind them, the hero and knights stand out of it), with skin data only, and centred in
  the picture (2D keeps it under its HUD band; 3D draws no HUD, G33). OK, or should a top-down
  round in a side-on 3D game be shown another way (the room tilted back like a table, a camera
  override while the round runs)?
- **83.** Engine 0.7 close-out (T9): the glue review found `games/platformer-test/` holds only
  content, skins and thin glue, after moving six more pieces of shared glue into the engine and
  kits (gaps G2, G4, G15, G29, G34, G35). What is left that another game writes too is logged with
  a named release: `files.ts` (G5, 0.14), the audio unlock in `main.ts` (G27, 0.11), the sky colour
  (G36, 0.15) and `scene.ts`'s five accessors (G37, 0.10). Accept 0.7 as done on that basis?
- **84.** Gap G16 (a trigger's `params` are checked only when the round starts, so `validate`
  passes a door with a bad goal) is moved to 0.10, where missions get their data schemas. OK, or
  should `MiniGameDef` get an optional params schema sooner?
- **85.** Gap G18 (a round steps with the host's input as it is: actions mean different things
  across the stack, and a button held into the door acts on the round's first tick) is moved to
  0.11, the first stacked game whose round wants its own controls. OK?
- **86.** Gap G36: the sky colour is a constant in each platformer game's `picture.ts`, not skin
  data. Moved to 0.15 (a skin `background` field, with the samples' look). OK, or add the skin
  field now?
- **87.** Engine 0.7 T9: game glue imports a kit's hook directly (`import { kit } from
'@kits/platformer/kit'`) to build its content kinds with `kitContentKinds([platformer,
topdown])`, because the kits' `index.ts` files do not re-export the hook (so pages do not pull
  in rule lists by accident). Keep that, or re-export the hooks from each kit's index (say
  `platformerKit`)?

**Engine 0.7, builder choices** (taken while building the stacking test; the owner can overrule them)

- **88.** The game's physics profile `hopper` starts from the kit's fixture numbers with its own
  changes: slower walk and run caps, a slower walker enemy, 2 hp, 3 lives, a 6-tick jump buffer
  and a softer middle jump tier. OK, or should the test game use the fixture numbers as they are?
- **89.** Levels play in id order with numbers compared as numbers (`level-10` after `level-2`),
  and the test game has no fixture level first (the lab does). A level order written in data is
  moved to 0.10 (G2). OK?
- **90.** `game.json` names a second kit with an optional `uses` list beside `kit`; `kit` stays
  the main kit, and rules and strict mutants are the main kit's only (the used kit's rules are
  G12, item 80). OK, or should all kits be one list?
- **91.** Two kits' content kinds are never merged or overridden: any name clash (also with an
  engine kind) is a `kind_clash` error, and listing a kit twice is `duplicate_kit`. OK?
- **92.** Room challenge rules: `reach` passes when the hero reaches an exit tile `E` (no target
  cell param); a death fails the round only after the death spin, so the spin is shown; a pass
  and a fail on the same tick count as a pass; Select quits the round (result `quit`) before
  the room's world sees it. OK?
- **93.** A new engine module, `engine/core/shell`, holds the host scene, the backend choice, the
  display type and the browser boot (kits may not import it). The lab's `main3d.ts` was removed
  (Three.js is loaded with a dynamic import, still in its own chunk) and the lab's picture API was
  renamed (`labPicture`, `labCanvasPicture`, `labScene`). OK?
- **94.** Skin sounds can key only on the event type, so the test game plays `door` when a round
  starts and ends, `pass` when a level is cleared and `fail` on a death; a passed and a failed
  round sound the same (G28, moved to 0.11). OK for now?
- **95.** The runner was drawn with a green cap and purple overalls and the ground as grass on
  dirt, so the art does not look like well-known NES sprites. OK?
- **96.** In the 3D skins particle effects are left out (the 3D backend does not draw them), and
  the skin parity check lets one tile have no 3D block: the platformer kit's `.` (open sky). OK?
- **97.** The level-3 run file loses two lives on purpose (a spike and a pit) on its way to the
  goal, because that is the only way a run can guard the `hazards-kill` and `pits-kill` rules. OK?
- **98.** The committed browser test plays `level-4.run.json` in the built page in both backends
  by replacing the page's frame timer and clock, which a test hook in the engine does not offer
  yet (G31, moved to 0.14). This answers item 60 for this game. OK?

**Engine 0.8, decisions needed first** (reasoning in `docs/BUILD-LOG.md`, Engine 0.8, Decisions)

- **99.** ECS: our own small ECS in `engine/sim` (plain-object component stores keyed by entity id,
  iteration always in ascending id order, no npm dependency), not Koota, bitECS or miniplex, so
  the whole world saves as JSON and hashes canonically with no serialiser. OK?
- **100.** A tick is one world minute: an integer `tick` counter with world time derived from it,
  independent of the 60 Hz frame loop (each view steps the sim at its own rate; 0.10 may scale how
  many ticks a view advances, never what a tick means). OK, or should a tick be another unit?
- **101.** Height is part of the simulation as data only: an integer elevation per terrain cell
  and an integer `z` on `Position`, so line of sight and height bonuses can later live in
  `engine/sim` and never in the RTS kit or views. No line-of-sight rules in 0.8. OK?

**Engine 0.8, builder choices** (taken while building the world simulation; the owner can overrule
them; summary in `docs/BUILD-LOG.md`, Engine 0.8, Choices made)

- **102.** The event log is not part of `snapshot()`, so it never changes a state hash; it keeps
  every change by default (`log: { ticks: n }` keeps the last n ticks, the sample world keeps 100),
  and stored component data is deep-frozen so no change can bypass the log. OK, or should the log
  be hashed too?
- **103.** Systems keep no state of their own (anything to remember is component data) and are
  never saved: `loadWorld` takes the same system list and refuses a save whose system names
  differ. OK?
- **104.** Float maths in `engine/sim`: every `Math` function that is not required to be correctly
  rounded (`sin`, `cos`, `atan2`, `pow`, `exp`, `log`, `hypot`, ...) and the `**` operator are lint
  errors in all sim files, tests included; `Math.sqrt` stays allowed (IEEE 754 rounds it
  exactly). Angles are binary (256 steps per turn) with sines in 16.16 fixed point. OK?
- **105.** Squad losses take unnamed people first; named people leave only when the strength drops
  below their number, regulars, then heroes, the captain last, newest first within a role, with
  no randomness. People who leave stay in the world with `squad: null` (their fate is the caller's
  rule). OK, or should losses among named people be seeded-random?
- **106.** World scenarios write terrain as text grids (one character per cell, a legend of ground
  types) with one elevation digit (0-9) per cell, hand out ids in file order and link entities
  with `{ "$ref": "<key>" }`. Ten height levels are enough for now. OK?
- **107.** The sample world's systems (`haul`, `build`, `patrol`, with the `Walk` and `Hauler`
  components) live in `engine/sim/systems.ts` as engine machinery (all their numbers are
  component data), not inside the test fixture. OK, or keep them test-only until the RTS kit
  (0.9) shows what systems the engine should ship?
- **108.** Walking (`path.ts`) is 4-way on the grid: entering a cell costs its type's cost,
  impassable cells are never entered, ties go north, east, south, west, and height changes no
  cost (item 101). OK, or 8-way now?
- **109.** A run file plays a world with `"world": "<name>.world.json"` instead of `game` (exactly
  one of the two); a world run has no input, `disableRules` or guards, and `mutants` and
  `screenshot` refuse it. State hashes are the same as for games (first 16 hex digits of the
  SHA-256 of the canonical snapshot). OK?
- **110.** "Survives a save and load at any tick" is proved on CI with 83 ticks (0, 1, every 250th,
  40 seeded random ones, 9,999 and 10,000). Saving and reloading at every one of the 10,001 ticks
  takes about two minutes, so it is an opt-in test (`WW_SAVE_EVERY_TICK=1`), run once for the
  close-out. OK, or put it on CI?
- **111.** The sample world (`village.world.json`) is an engine test fixture in
  `engine/sim/__fixtures__/`, with golden hashes every 100 ticks (`village.hashes.json`) and a CLI
  run file on it. OK?

**Engine 0.8, close-out review** (further builder choices found while closing out 0.8; details in
`engine/sim/CLAUDE.md`)

- **112.** Terrain is a `Terrain` component on exactly one entity, not a field on the world, so it
  is in every snapshot and save with no special case; `terrainOf(world)` throws unless exactly one
  entity has it. OK?
- **113.** A change made between ticks without `withCause()` is logged with the cause `external`
  instead of being refused. Scenario, order and load code should name a cause. OK, or should a
  missing cause be an error?
- **114.** If a system throws during `step()`, that tick's changes are dropped and the tick is not
  committed, but the world is not rolled back: it must be treated as broken. OK?
- **115.** Ids in data (`Owner.faction`, item ids, building kinds) are short strings such as
  `"village"`, not integers, so scenarios stay readable. OK?
- **116.** Squad members have one of three roles (`regular`, `hero`, `captain`); when a new
  captain joins, the old captain becomes a hero. OK?
- **117.** A finished building keeps its `Construction` component with `done: true`, and its health
  rises with the work done until it is full. There is no separate `Building` component yet. OK?
- **118.** World runs in the CLI always use one fixed set of engine systems (haul, build, patrol, in
  that order); a run file or scenario cannot choose its systems yet. Choosing them can come with the
  RTS kit (0.9). OK?
  _Resolved in Engine 0.9 T9 by item 132: a scenario names its system set._
- **119.** A world run starts only from a scenario, not from a save file, and a `seed` in the run
  file replaces the scenario's seed. OK?
- **120.** `loadWorld(json, { components, systems })` also takes the component definitions, so it
  can check the saved data; the save keeps its log settings and loading cannot change them. OK?

**Engine 0.9, decisions before code** (reasoning in `docs/BUILD-LOG.md`, Engine 0.9, Decisions)

- **121.** The RTS hero (the roadmap's 0.9 question): yes. A directly controlled hero is an
  ordinary unit entity with a squad `Member` role `hero` (reusing `engine/sim` squads), which
  orders can target on its own, alongside squads. No hero-only rules until 0.13. OK?
- **122.** Kits still may not import `engine/sim` (`config/layers.js` unchanged), so every world
  rule (movement, combat, construction, training, gathering) is an `engine/sim` system driven by
  component data; `kits/rts` reads a plain world snapshot, turns selection and commands into
  orders, presents frames and runs the scripted enemy; game glue joins the two and stays a few
  dozen lines (about 60 at most per entry), with anything a second RTS game would copy moved into
  the engine or kit. OK?
- **123.** Orders are plain JSON (`{ id, faction, type: move|attack|build|train|gather|stop,
units, target }`), typed and validated in `engine/core` (the layer both sim and kits may
  import), applied between ticks inside `world.withCause('order:<id>')`; an order that cannot be
  carried out is dropped and logged, not an error. OK?
- **124.** Recorded battles are lockstep: each order is stamped with the tick it applies before
  (same-tick orders in id order), sync hashes every 20 ticks by default through the existing
  `hashEvery` and replay machinery, and a run-file `orders` field for both world and game runs.
  OK, or another default for N?
  _Done in Engine 0.9 T9: run-file `orders` (`{ tick, ...order }`) and sync `hashes`; see 134._
- **125.** Game runs get orders through a new optional `HeadlessGame.order(order)`, called between
  `step()`s at the order's tick; a run file with `orders` for a game without it is a usage error.
  OK?
  _Done in Engine 0.9 T9: `order(order)` returns null, or a reason when the game drops the order._
- **126.** Pathfinding is in-house in `engine/sim`: A\* for single units on the terrain grid, and
  the existing `distanceField` reused as a flow field for a group sharing a goal (the group size
  that switches is measured and recorded in T6). OK?
- **127.** Answering 108: the RTS moves 8-way with no corner cutting (a diagonal costs 14 against
  10 straight, allowed only when both straight neighbours are passable; ties N, NE, E, SE, S, SW,
  W, NW). 8-way is an option; the 0.8 sample world stays 4-way, so its hashes do not change. OK?
- **128.** Answering 48: `Facing` widens to eight directions (`up-left`, `up-right`, `down-left`,
  `down-right` added); a skin with no diagonal frame falls back to the diagonal's horizontal part
  (`up-right` uses `right`), then the existing rule, so existing kits and skins stay valid. OK, or
  fall back to the vertical part?
  _Done in Engine 0.9 T2: `FACINGS` in `engine/core/present`; with `flipFacing`, a left-hand
  diagonal with no frame of its own first uses its right-hand diagonal mirrored, then the
  horizontal part; the 3D backend mirrors the left-hand diagonals like `left`._
- **129.** The benchmark target: 500 units (stretch 1000) with health bars and selection rings on
  a map of at least 128 x 128 cells, at the RTS sample's picture size and zoom 0.5, 1 and 2, with
  a 95th-percentile frame time of at most 16.7 ms over 600 frames in headless Chromium through
  Playwright (skipped where no browser exists). OK?
- **130.** PixiJS v8 (one exact pinned version) comes in only if Canvas2D misses the 500-unit
  target; missing only the 1000 stretch is recorded but brings no PixiJS. OK?
- **131.** The skirmish map is a sim scenario file (`*.world.json`) plus RTS unit and building type
  data, new content kinds added by `kits/rts`; the scripted enemy's plan is separate kit content.
  OK?
- **132.** Following 118: a scenario may name an engine system set (such as `"systems": "rts"`),
  defaulting to the 0.8 set (haul, build, patrol), so world runs can play RTS battles and the
  village's hashes do not change. OK?
  _Done in Engine 0.9 T9: `"systems": "village" | "rts"` (`SYSTEM_SETS` in
  `engine/sim/system-sets.ts`); see 135._

**Engine 0.9 T3, the rendering benchmark** (numbers in `docs/BUILD-LOG.md`, Engine 0.9, T3)

- **133.** Under 129 and 130, Canvas2D holds the 500-unit target at every zoom (worst p95 14.3 ms,
  with all 500 units in view at zoom 0.5), so PixiJS is not added and stays in the roadmap's
  "Later", and T4 (the PixiJS backend) is skipped. The 1000 stretch misses only with all 1000 in
  view at zoom 0.5 (p95 about 33 ms). The RTS sample's picture size is 320 x 240. The measured
  machine renders in software (no GPU in the container), so a real GPU should only do better.
  OK?

**Engine 0.9 T9, recorded orders and sync hashes** (details in `engine/tools/CLAUDE.md`, Recorded
orders)

- **134.** A recorded run keeps its sync hashes in the run file itself, as a top-level `hashes`
  list (`[{ tick, hash }]`, the replay format), and `run` checks them: the first that differs stops
  the run (exit 4) and names that tick and the last tick that still matched. Orders sit in the run
  file as flat `{ tick, ...order }` entries (decision 3's example), in tick order with ids ascending
  within a tick; only inline `orders`, no separate `ordersFile`. OK?
- **135.** The two system sets are named `village` (the 0.8 haul, build, patrol set, the default
  when a scenario names none) and `rts`. Adding the optional `systems` field kept the scenario
  format at version 1, since every version 1 file still reads the same. OK, or other names, or a
  version bump?
- **136.** An order the world or game refuses during a recorded run is listed in the result's
  `refusedOrders` and the run goes on (not a failure, as decision 2 says for live play); `orders` on
  a world whose system set is not `rts` is a content error (`no_orders`). Mutant checks still judge
  a run only by its checks, not by its sync hashes. OK?

**Engine 0.9 T10, the RTS kit** (details in `kits/rts/CLAUDE.md`)

- **137.** The kit adds three content kinds: `rts-map` (the map as a world scenario with
  `"systems": "rts"`; the kit checks its shape and grids, and the sim checks the components when
  the glue builds the world, since a kit may not import the sim), `rts-types` (the engine's
  `rtsTypesSchema`, for a game that keeps its types in their own file) and `rts-enemy` (the
  scripted enemy's plan; a type it names that no types table has is `unknown_type`). OK?
- **138.** The scripted enemy runs inside the kit's headless adapter (`rtsGame`): before each step
  it reads the snapshot and its orders are applied, after any player orders of that tick. Order
  ids count up across both sides in the order applied, so a run file records only the player's
  orders and the enemy's are replayed by its plan with the same ids. The game's snapshot is
  `{ world, kit: { nextOrder, rng, enemy } }`. OK?
- **139.** Selection: a click selects the player's own unit on the cell, else any unit (to look at
  an enemy), else a building; a box takes only own units, never buildings; a command on an own
  unit or building is a move there; a resource command sends only the selected gatherers (the
  rest are left out of the order). OK?
- **140.** The enemy plan is a list of steps tried in file order each tick, each with `at`, an
  optional `when` condition (unit or building counts per side, or a stockpile) and `repeat`
  (`every`, `times`). A step whose order cannot be made yet (no units, no target) waits and is
  tried again, rather than being skipped. Random choices (`area` cells, `random-enemy`) use the
  adapter's RNG seeded from the game seed. OK?

**Engine 0.9, builder choices** (details in `docs/BUILD-LOG.md`, Engine 0.9, Choices made)

- **141.** Canvas2D zoom (T2): zoom comes from the frame's camera hint, else the skin; entity and
  tile positions are rounded to whole picture pixels after scaling, so sprites stay crisp at zoom
  0.5 and 2, and zoom-1 drawing is unchanged. OK?
- **142.** Pointer input (T5): one gesture set for mouse, pen and touch: left click or tap selects,
  a drag past 4 px draws a box, right click or a 500 ms long-press commands, middle drag or two
  fingers pan, wheel or pinch zoom (500 wheel px per doubling), the cursor within 4 px of the
  picture's edge scrolls. `RtsCamera` keeps zoom between 0.5 and 2 and the view inside the map.
  Pointer input is opt-in in `bootBrowserGame` (`pointer: true`), as is hiding the touch pad
  (`touchPad: false`). OK?
- **143.** Pathfinding numbers (T6): an order for 4 or more units shares one flow field
  (`FLOW_GROUP_SIZE`, from the measurement on a 256 x 256 map with 300 units); fewer use A\* each,
  which gives up (no way) after a cap of expanded cells. OK?
- **144.** Units do not collide (T7): units may share a cell and walk through buildings (a
  footprint decides only placement and reach); a unit with no task fights the nearest enemy in
  range (ties to the lowest id); hits land at once, in id order. Add collision or separation
  later, and if so when?
- **145.** Paying and making (T8): a cost is paid when the order is accepted, with no refund and
  no cancel order; a type's numbers are copied into what is made, so changing the types table
  never changes existing units or buildings; a faction's gold is the `Inventory` of its
  `Stockpile` entity. OK?
- **146.** The sample's run files and art (T11): run files may hold interface actions
  (`{ tick, ui, ... }`: click, box, command, build, train, stop) beside recorded orders, so the
  kit's interface rules are mutant-checked headless; units are drawn in three facings (down, up,
  right, mirrored for left; diagonals use their horizontal part) rather than eight. OK, or draw
  the diagonals?
- **147.** The page (T12): 10 ticks a second (6 loop steps a tick); the page's selection is its
  own and not game state, so the page's hashes equal a replay's; Export downloads the battle as a
  run file that ends at its last sync hash. OK?
- **148.** Deviation from decision 2 (about 60 lines of glue per entry): the sample's `headless.ts`
  is 85 lines of code (`createGame` about 25, plus `sidesOf` and the interface actions for run
  files) and `main.ts` 160 (page DOM: the button bar, Export and the test hook); `play.ts` and
  `recording.ts` are game code a second RTS game would copy. Move them (and `sidesOf`) into
  `kits/rts` or the shell now, or when the mini siege (0.11) becomes the kit's second game?
- **149.** `kits/rts` does not opt in to strict mutants, though the sample's run files guard all
  five of its rules and `mutants games/samples/rts-skirmish` exits 0. Opt in?
