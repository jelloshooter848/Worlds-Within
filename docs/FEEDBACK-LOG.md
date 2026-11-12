# Feedback log

Whenever Claude needs the owner's feedback or a decision, each item gets a unique number. Numbers
continue across conversations and are never reused, so the owner can answer by number. Every item and
its outcome is recorded here (see `CLAUDE.md`).

**Next unused number: 618.** (Last used: 617.)

| #   | Item                                                  | Answer                                                                                                                                            |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | Mini siege at Engine 0.11                             | Accepted                                                                                                                                          |
| 9   | 0.15 sample set release                               | Accepted                                                                                                                                          |
| 10  | Tower defense split                                   | Accepted                                                                                                                                          |
| 11  | Civilization/hero split; RTS hero unit decided at 0.9 | Accepted                                                                                                                                          |
| 12  | Mini siege mission                                    | Answered by 23                                                                                                                                    |
| 13  | All four kit samples required for 1.0                 | Yes                                                                                                                                               |
| 14  | Stacking-test game and demo grow into samples         | Yes                                                                                                                                               |
| 15  | Samples' art style                                    | Answered by 22                                                                                                                                    |
| 16  | Engine 1.0 API public or internal                     | Internal                                                                                                                                          |
| 17  | Approve roadmap and merge to master                   | Owner still revising                                                                                                                              |
| 18  | Add numbering rule to CLAUDE.md                       | Yes (done)                                                                                                                                        |
| 19  | Tower-defense prep phase in the mini siege at 0.12    | Accepted                                                                                                                                          |
| 20  | Tag names and PixiJS timing                           | Accepted; tags are always three-part, e.g. engine-v0.5.0, so patch releases fit                                                                   |
| 21  | Branch for the autonomous build                       | One build branch, engine/build-0.15; nothing merged to master                                                                                     |
| 22  | Art, music and 3D style                               | NES-style pixel art as text, MML chiptune, procedural low-poly meshes                                                                             |
| 23  | Mini siege mission (answers 12)                       | Sabotaging siege engines                                                                                                                          |
| 24  | Publishing during the build                           | No publishing and no tags during the build                                                                                                        |
| 316 | Samples' quality bar                                  | (b) Modern pixel-art indie quality: should feel like a game acceptable on the modern market, without the breadth; they are demos                  |
| 317 | A release for presentation before 1.0                 | (a) Add Engine 0.16 "Presentation and feel"; the owner's playtest is its Done when                                                                |
| 318 | 0.16 demo list and quality references                 | Yes, approved                                                                                                                                     |
| 319 | Mini siege overworld style                            | 3D low-poly (target: docs/reports/mockups/mini-siege-3d.png; the 2D mockup was rejected)                                                          |
| 320 | Replace Canvas2D with PixiJS for 2D                   | OK, if a benchmark and feature test show Canvas2D can't reach the bar                                                                             |
| 321 | Where assets come from                                | Free game assets from online                                                                                                                      |
| 322 | Third-party assets as binary files                    | (a) CC0 packs as binary files (PNG, glTF/GLB, OGG/WAV) in each game's assets/ with a CREDITS.md; the rest stays text; our MML music stays primary |

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
  _Answered by 158 (Engine 0.10): keep it; done in Engine 0.10 T9 (gap G20 fixed): the snapshot of
  the tick a round ends holds `endedRound` (`trigger`, `game`, `result`, `state` with the round's
  last events, `report` when it has one), left out on every other tick, so no golden hash moved
  (no hashed tick is a round's last); `level-4.run.json` asserts the final knight's `kill`._
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
  _Answered by 157 (Engine 0.10): yes, in 0.10; done in Engine 0.10 T8 (gap G16 fixed): `validate`
  checks every level trigger's and mission's mini game id and `params` against the defs a game's
  headless entry exports as `miniGames(content)`, so `"goal": "defeat-al"` fails `validate`._
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
  _Engine 0.10 T10 (item 160): the order can now be written in a `campaign` file; both platformer
  games have one reproducing the id order (the lab: `tiny` first), and a game without one keeps
  this id order._
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
  _Since the close-out, `tests/runs/rts-skirmish-mutants.test.ts` holds the sample to the strict
  standard (no rule unguarded, no run weak); opting the kit in would make `mutants` itself enforce
  it for every game on the kit._

**Engine 0.10, decisions before code** (reasoning in `docs/BUILD-LOG.md`, Engine 0.10, Decisions).
Three rules here are the owner's and are decided, not open: a mission's world-time cost is fixed when
it starts (151), delegating gives a fair, average result and playing gives choice, not a better one
(154), and committed results never change (150). What is open to overrule is how each is built.

- **150.** Three kinds of time: world time is the world's integer `tick` (item 100), moved only by
  `step()`; experience time is the ticks spent inside an open mission, recorded but never moving
  the world; commitment time is the tick a mission's result is committed. **Committed results
  never change (decided):** a commit is an append-only record, and reopening, replaying,
  delegating or recommitting a committed mission is refused (`mission_committed`). A mission
  definition opens at most once per world. OK?
- **151.** **The world-time cost is fixed at start (decided):** `worldTimeCost` (whole ticks, at
  least 1) is read from the mission's data when it opens, and the result commits at exactly open
  tick + cost, at the end of that tick's step (before its snapshot), whatever experience time was
  spent and however early it was played or delegated. Live, the world waits while the player is
  inside and then steps through the cost; in a run file it steps as usual. A mission still
  unresolved when its cost runs out is delegated then. OK?
- **152.** Frozen events: an event is the entities with an `EventMember { event }` component; a
  mission names its `event`, which is frozen while the mission is open (one open mission per event,
  else `event_frozen`). `move`, `attack` (by or on a frozen entity), `death` and `patrol` skip frozen
  entities, and frozen workers do not walk, gather, haul or build; construction and training
  progress and every system for entities outside the event keep running, so the city's barracks
  still gets built. OK?
- **153.** The mission contract: the plain JSON types (mission definition as the `mission` content
  kind, outcomes, effects, the kit report `{ outcome, stats }`, the committed record) and a
  `MissionAdapter` interface (`input(snapshot, mission)`, `outcome(report, mission)`) live in
  `engine/core` (`missions.ts`, like `orders.ts`); the lifecycle lives in `engine/sim`; adapters
  are written per game and kit pairing and kits never import the sim (`config/layers.js`
  unchanged). Changes from `MiniGameDef`: declared, structured outcomes instead of pass/fail/quit,
  and no retries (no `attempt`; quitting a played mission commits its required `onQuit` outcome;
  once play starts it cannot be delegated). Effects are data only, applied under
  `mission:<id>`: `damage`, `destroy`, `inventory`, `set` and `opportunity` open/close; an effect
  on an entity that no longer exists is skipped and listed. `MiniGameDef` itself keeps pass, fail
  and quit for hosted rounds. OK?
- **154.** **Delegate = fair average, play = choice not better (decided).** Answering the roadmap's
  "how delegated outcomes are weighted": each outcome has a whole-number `weight` (at least 1,
  default 1); delegating draws `int(totalWeight)` once and picks the outcome by file order (the draw
  comes from the mission's own generator, `Rng.derived(world seed, "mission:<id>")`, not
  `world.rng`, so the tick it happens at, or a timeout, never moves the world's hashes; changed
  after review), so each comes up with its weight's share (the weights are the designer's "how it usually
  goes"). No weight 0, so every outcome a player can reach, delegation can reach too. A played
  result must be a declared outcome (else `unknown_outcome`, the mission stays open) and commits
  that outcome's declared effects, the same as if drawn; a mission may limit play to a `playable`
  subset. OK?
- **155.** Opportunities: `{ id, mission, opens, closes, exclusive?, closesOthers? }` with world
  ticks (`opens <= tick < closes`), listed in the scenario (optional `opportunities`, format stays
  version 1) or opened by an effect. Offered ones are in the snapshot; a mission named by an
  opportunity opens only through it while offered (`opportunity_closed` otherwise); taking one
  closes its `exclusive` group and its `closesOthers` list; an untaken one closes when its window
  ends. OK?
- **156.** Flashback (retrospective) missions are out of scope until after Engine 1.0, as the
  roadmap allows; nothing in 0.10 blocks adding them later as new append-only commits. OK?
- **157.** Answering 84 (G16): yes, in 0.10. `MiniGameDef` and mission definitions get an optional
  `params` Zod schema, run by `validate` over level trigger and mission params; the tools learn a
  game's mini games from an optional `miniGames` list on its headless entry. OK?
  _Done in Engine 0.10 T8: `miniGames(content)` on the headless entry (a function of the content,
  since the stacking test's defs are built from its room files), `MiniGameDef.paramsSchema`,
  `KitDef.miniGameUses` and the `unknown_mini_game` code; see 84._
- **158.** Answering 81 (G20): keep the ended round (final state and result) in the host snapshot
  for its last tick, dropped the next tick. `games/platformer-lab/runs/mini-game.hashes.json` is
  re-recorded once (and `games/platformer-test/runs/level-4.hashes.json` if its recorded ticks
  include a round's last tick), listed in the commit; no other golden hash moves. OK?
  _Done in Engine 0.10 T9: the ended round is an `endedRound` key present only on that tick, and no
  recorded hash tick (every 60th, and the last) is a round's last, so neither hashes file moved._
- **159.** G37: an optional `miniGame()` on `HeadlessGame` (the hosted round now, or null), so the
  shell's `HostScene` takes the game itself instead of five accessors per game. OK?
  _Done in Engine 0.10 T9: `HeadlessGame.miniGame?()` and `HostedGame` (`world`, `events`,
  `miniGame()`); `new HostScene({ stack, game, picture })`; `LevelSequence` implements it, and
  both platformer games' `scene.ts` went away._
- **160.** G2, the rest: a `campaign` engine content kind (`*.campaign.json`, `{ version: 1,
entries: [{ level } | { mission }] }`), checked by `validate`; a platformer game with a campaign
  plays its levels in that order, and without one keeps the 0.7 id order. OK?
  _Done in Engine 0.10 T10: `engine/core/campaign.ts`, with an `id` and an optional `start` (the
  entry played first) beside `version` and `entries`; `missing_level` / `missing_mission` at the
  entry's field. Only the levels a campaign lists are played; its missions are checked only (0.13
  plays them). Both platformer games got `content/campaigns/main.campaign.json` with their old
  order, so no golden hash moved; the lab's order now comes from its file, not `first`. See 89._
- **161.** Missions in run files: an optional `missions` list beside `orders` on world runs,
  `{ tick, mission, action: open | play | delegate, outcome?, experienceTicks? }`, applied between
  ticks after that tick's orders; `play` names the outcome reached; refused entries are listed in
  `refusedMissions` and the run goes on. Mission, frozen-event and opportunity state appear in the
  snapshot only when used, so every existing 0.8 and 0.9 golden hash stays the same. OK?
  _Done in Engine 0.10 T6, with a fourth action, `quit` (see 163)._

**Engine 0.10, builder choices** (details in `docs/BUILD-LOG.md`, Engine 0.10, Choices made)

- **162.** At a commit, an effect that would break a component's schema is skipped and listed in
  the record's `skipped` (like an effect whose entity is gone), not refused as decision 4b (item 153) said, so a mission that is due always commits. OK?
- **163.** World run files also have a `quit` action (the mission's `onQuit`); a `play` or `quit`
  at or after the commit tick its `open` fixed is refused at load (`mission_unresolved`, exit 3);
  a mission's file is `<id>.mission.json` beside the scenario or in a `missions/` folder there. OK?
- **164.** An opportunity opened by an effect is `relative` (its window counted from the commit
  tick that opens it) and `dormant` until then, so a mission that succeeds leaves the rescue
  untakeable; when several opportunities name one mission, opening it takes the lowest-id one
  offered. OK?
- **165.** `MissionAdapter`, `playMissionRound` and `snapshotEntities` are engine code
  (`engine/core`); the one adapter so far (the siege raid as a top-down room) lives in a repo test
  (`tests/kits/mission-adapter.test.ts`), and the first game adapter and live play of a mission
  come with the mini siege (0.11). OK?
- **166.** Experience ticks a kit round records with `addExperience` stay in the world's hashed
  state (one number on the commitment and the record), so a recorded count changes the hash after
  the commit in that number only. Run files keep their `experienceTicks` out of the world (summed in
  the result's `experience`), so their hashes match. Keep it, or move recorded experience out of
  the hashed state?
- **167.** A mission the world stepped past without settling is overdue: it can no longer be
  played, delegated or quit (`mission_overdue`), and the next `settleMissions` or `commitMission`
  commits it then, recorded at its own commit tick. Missions due together commit in commit tick,
  then id order. OK?
- **168.** A mission round that ends in quit resolves to the mission's `onQuit` as a quit (record
  says `quit`), with no adapter and no `playable` check, even when `onQuit` is outside `playable`.
  OK?
- **169.** Two small `engine/sim` additions: `defineComponent({ omitWhenEmpty })` keeps unused time
  state out of snapshots and saves, and `World.registered(c)`. The world-level `WorldTime` entity is
  spawned on the first time write, so in worlds that use time every later spawn's id is one higher.
  OK?
- **170.** Frozen event members also stop hauling, gathering and constructing (their task waits);
  building and training progress keep running. A unit targeting a frozen entity keeps the target
  and holds its hit; units outside the event may still walk toward it. OK?
- **171.** Run files have no `commit` action: commits always happen by themselves at the fixed
  commit tick (`settleMissions` after every step), so a run never steps out of lockstep. OK?

**Engine 0.11, decisions before code** (reasoning in `docs/BUILD-LOG.md`, Engine 0.11, Decisions).
The mission (sabotaging siege engines, answer 23), the fixed cost and append-only records (150-151)
and fair delegation (154) are the owner's rules and are not reopened here.

- **172.** Game run files get the world runs' `missions` list, handed to a new optional
  `HeadlessGame.mission?(step)` (null when taken, a reason when refused); `open`, `delegate` and
  `quit` as in world runs, and `play` carries the round's recorded input (`input.steps`, frame 0
  the round's first tick) instead of an `outcome`, so the played path runs the real kit round,
  report and adapter. On a game run a late step is refused at run time, not at load. OK?
- **173.** Live hosting is engine code: `MissionHost` in `engine/core` wraps a game and works
  through a `MissionWorldPort` (open, delegate, play, quit, settle, snapshot, step) that
  `engine/sim`'s `missionPort(world, { refs })` fills. While a round is hosted a game tick steps
  the round only: the world, the scripted enemy and orders wait (orders and mission steps then are
  refused). The round's seed is derived from the world seed and the mission id. OK?
- **174.** After a played round the world is stepped through the cost **one world tick per game
  tick**, through the game's ordinary step (enemy, world, settle), exactly as on the delegated
  path, so the commit tick and the world's hashes per world tick match it; the page only shows the
  step-through faster (presentation), and the player may give orders during it. Not all at once.
  OK?
- **175.** `kits/rts` reads offered and open missions from the snapshot, shows them as HUD status
  (`offer`, `offers`, `mission`, `missionLeft`) and tags frozen units `frozen`; launching is
  `missionRequest(view, id)` (a request, not an order; kit rule `launch-needs-offer`), a bar
  button, and the interface action `{ "ui": "mission" }`. The host carries the request out. OK?
- **176.** `kits/topdown` gets `missionRoom` and `topdownMissionAdapter`, driven by the mission's
  `params`: `room` (a room file with foe slots), `goal`/`ticks`/`hp`, `foes` (world entities by
  event, faction, type and squad role into slots, hp from `Health.hp` over `hpPer`) and an ordered
  `outcomes` rule list (`destroyed`, `spared`, `minDestroyed`, `result`; the last has no
  condition). No adapter code in the game. OK?
- **177.** G18: `MiniGameDef.inputMap` (host action to round action, or null to drop), and every
  action held on a round's first tick ignored until released, in one engine `RoundInput` every
  host uses. A run file that holds a button into a door may have its golden hashes re-recorded
  (listed in the commit). OK?
- **178.** G19 (the rest): `MiniGameDef.hostStatus` lists host HUD keys copied into the round's
  frame as `host:<key>`; without it a stacked frame shows the round's HUD only, as before. OK?
- **179.** G27: `bootBrowserGame({ audio: { sfx, songs, music? } })` makes the `AudioManager`,
  wires the displays' sounds, unlocks on the first key, tap or click and starts `music`. OK?
- **180.** G28: skin event keys `<type>:<value>` (matching the event's `result`) and
  `<type>:<field>=<value>`; the first match in file order wins, then the bare type. OK?
- **181.** G13 and G30: an optional `look` on a platformer trigger entry, presented as the tag
  `look:<id>`; a skin kind entry's `byTag` list picks frames (or a mesh) by tag, first match wins.
  OK?
- **182.** The mini siege: a 48x32 map; `village` (four soldiers and a captain in event `siege`,
  three workers outside it, a hall and a `watchtower` site) against `raiders` (six raiders and two
  siege engines, `ram` and `catapult`); mission `sabotage` offered ticks 20-200, cost 120 world
  ticks, played as a top-down room; outcomes `both-burnt` (1), `ram-burnt` (2), `catapult-burnt`
  (1) and `driven-off` (2, also `onQuit`), each destroying exactly what the round destroyed (or
  hurting the captain). OK?
- **183.** "Changes the battle the way the design says" is checked in both paths: the event holds
  still while the watchtower finishes, the commit lands at open plus 120, the record and exactly
  its outcome's effects are applied, and with both engines burnt the hall ends at full hp while
  with them alive it loses hp; golden hashes, and the played world matching a world run with the
  same outcome tick for tick. OK?
- **184.** The mini siege's gap report uses ids `M1`, `M2`, ... (never reused), logged by each task
  as found, with the glue review at the close-out. OK?
  _Done in Engine 0.11 T10: 28 gaps (`M1`-`M28`), 11 fixed in 0.11 and 17 moved; the glue review
  is in the report._

**Engine 0.11, close-out** (details in `docs/BUILD-LOG.md`, Engine 0.11, Choices made and
Deviations from the roadmap)

- **185.** Decisions 4 and 11 as built: no kit rule `launch-needs-offer` and no `{ "ui": "mission" }`
  interface action (the sim refuses a mission no opportunity offers, and a game run's `open` step
  drives the kit's `launchMission`); the guards are raiders with squad role `regular` (M16); the
  round's hero is the kit's, not the captain (M13); `driven-off` damages the captain by 30, and
  `ram-burnt` / `catapult-burnt` also damage the other engine by 40. OK?
- **186.** After a played round the page steps the world at the battle's normal 10 ticks a second,
  not fast as decision 3 said, so the player sees the watchtower finish and the result land
  (presentation only; the hashes are the same). OK?
- **187.** M12: the sim's siege fixture keeps its 0.10 `raid.mission.json` (`play: "sabotage"`);
  moving it to `mission-room` re-records seven golden hashes and adds no check, so it moves to
  0.15 with M20, the other hash-moving change. OK?
- **188.** M13 (a world unit as the round's hero) moves to 0.13, heroes and consequences, and M19
  (recording a hosted round's input) to 0.14, the creator tools, instead of 0.15; the other moved
  gaps stay with the sample set. OK?
- **189.** The glue review adds M27 (the sim-to-RTS-kit port bridge, the same in both RTS samples)
  and M28 (the glue reading the sim's mission records and keyed entities), both moved to 0.15. OK?
- **190.** "Played from a link" is checked by `tests/browser/mini-siege-page.test.ts`: the built
  site's launcher, then Launch and Delegate, and Launch and Play with the recorded round typed as
  keys, in headless Chromium (skipped where none is installed). OK?

**Engine 0.11, smaller build choices** (details in `docs/BUILD-LOG.md`, Engine 0.11, Choices made)

- **191.** G18 as built: a button counts as "held into the round" only when it is held but not
  newly pressed on the round's first tick (a press on that tick counts, matching "a play script
  starts with nothing held"). The drop is applied to the host's actions before the input map. Four
  platformer mini-game unit tests that held attack through the trigger now let go for one tick, so
  their pass comes one tick later; no golden hash or run file changed. OK?
- **192.** A skin look's `frames` replace the kind's frames whole (not merged state by state), and
  a look may also set `fallbackColor` (2D) and `color` (3D). In platformer-test a trigger with no
  look is now a new `switch` frame and the door is drawn through `look:door`; a bumped brick
  bounces as a brick (seen only in live play; screenshots unchanged). OK?
- **193.** A destroyed siege engine leaves the sim, so the "burnt" look is the skin's look for a new
  RTS kit tag `damaged` (units and finished buildings below full hp), and the frozen siege is a
  palette swap (`siege-held`) rather than separate frames. OK?
- **194.** Mini siege balance: soldiers 50 hp / attack 6, captain 120 hp / attack 10, defenders on
  the road with the captain behind; both engines burnt keeps the hall at its full 400 hp (112 when
  the round is quit). The delegated run's seed 11 draws `ram-burnt`. OK to keep these numbers?
- **195.** The mini siege page pauses the world while the Play-or-Delegate choice is shown (so a
  slow answer cannot pass the commit tick) and keeps the touch pad on so the round can be played on
  a phone, unlike the RTS skirmish. OK?
- **196.** The shell also calls `AudioManager.wake()` on `pageshow` and `visibilitychange`, and
  the unlock listeners stay on after the first gesture (cheap, and they recover a context the
  browser suspended). Only the player's volumes are applied; storing settings and a mute control
  are M1, moved to 0.15. OK?

**Engine 0.12, decisions before code** (reasoning in `docs/BUILD-LOG.md`, Engine 0.12, Decisions).
The preparation phase staying in the mini siege is the owner's (answer 19), and the 0.10 and 0.11
mission rules (150-151, 154) hold for the new mission; they are not reopened here.

- **197.** The kit's shape: `kits/towerdefense` holds its own deterministic round rules (integer
  maths, the seeded `Rng`, named rules a run can switch off, `strictMutants` opt-in once every rule
  is guarded), no world rules, no `engine/sim` import, no drawing. OK?
- **198.** Its content kinds: a `td-map` (JSON header with legend, starting resource and lives,
  plus a text grid of path, build and blocked cells with one entry and one exit, one unbranched
  path), a tower-type table (cost, range, damage, cooldown) and waves (groups of kind, count,
  spacing, hp, speed, bounty). OK?
- **199.** The input model: a cursor moved with the shared `Actions`, `jump` to place, `attack` to
  cycle the tower type, `start` to start the wave, so run files and a mission's recorded `play`
  input replay it; a pointer tap on the page moves the cursor to that cell (a tap on its cell
  places). OK?
- **200.** The standalone sample: `games/samples/tower-defense/`, `kit: towerdefense` only and no
  sim, one map, two or three tower types, three or four waves, run files `won` and `leaked` (and
  more if the mutant checks need them) with golden hashes. OK?
- **201.** The mini siege's preparation phase: a second mission, `fortify`, offered through a
  second opportunity before the raid and launched through the RTS kit's mission offers; played as
  the kit's `td-defence` with params picking the real walls (new `wall` building types and wall
  entities on the village map) as build cells, the budget from the village's stockpile gold and
  the wave from the real raiders, by selector; ordered outcome rules to declared outcomes whose
  data-only effects (`inventory`, `damage`, `destroy`) write the losses back. Fixed effect amounts
  per outcome are an expected lesson. OK?
- **202.** `td-defence`'s report (`cleared`, `livesLeft`, `spent`, `towers`, `fallen`, `killed`,
  `ticks`, with world keys) is kept in the mission record's `stats`; a quit round goes to `onQuit`.
  OK?
- **203.** The walls go on the one village map, not a second scenario; T7 re-records the golden
  hashes of the 0.11 run files `played`, `delegated` and `quit` once, in its own commit, with the
  reason, and keeps every assertion in them (placing the walls off the raiders' path if needed).
  OK?
- **204.** The new mode's code lives in the kit and its content in the mini siege; the glue only
  adds the new mini game and adapter to `MissionHost`'s lists; any change outside the kit is
  logged as a lesson. OK?
- **205.** The lessons report `docs/reports/tower-defense.md` uses ids `D1`, `D2`, ... with a
  "Sim" column and statuses `fixed in 0.12 Tn`, `moved to <release>` or `lesson for the 1.0
mission API`. OK?
- **206.** "The `engine/sim` diff is empty" is checked at the close-out with `git diff --stat` and
  `git log` of `engine/sim` against `d6a102ab66f62c80e906ac979ece026dd781c415`, the output recorded
  in the build log; each task checks it before committing; no test is added (it would need full
  history in CI and mean nothing after 0.12). OK?

**Engine 0.12, close-out** (details in `docs/BUILD-LOG.md`, Engine 0.12, Choices made, and
`docs/reports/tower-defense.md`)

- **207.** Where the tower-defense lessons land: twelve (D1-D4, D6-D10, D12-D14) move to 0.15, the
  sample set's API review, including D3 and D4 (effect amounts and losses from the round's report),
  which change how the sim's commit applies effects; two (D5, walls lost as the report's reading,
  and D11, one open mission per frozen event) move to Engine 1.0 as rules written down in the v1
  docs, not changed. Each is listed in that release's roadmap section. OK?
- **208.** The glue review adds D14 (the round's key hints are strings in each page's `main.ts`),
  moved to 0.15 with M26. OK?
- **209.** The lessons report's status `lesson for the 1.0 mission API` is replaced at the
  close-out by `moved to 0.15` or `moved to 1.0` with the reason, and each row names the task and
  commit that found it (a change to item 205's format). OK?
- **210.** "Plays from a link" and "the mini siege offers the preparation phase" are checked by
  `tests/browser/tower-defense-page.test.ts` (the launcher, taps, the bar and `won.run.json` typed
  as keys) and `tests/browser/mini-siege-page.test.ts` (Launch: Man the walls, then Delegate, Play
  by recorded keys and Play by taps), in headless Chromium (skipped where none is installed). OK?
- **211.** Selling a tower is on `special` (C, a right click or a long-press), a fourth button
  decision 3 (item 199) did not list. OK?
- **212.** The sample's page plays 30 ticks a second, merging the input of the loop steps between
  two ticks (`TickInput`, lesson D2), while a hosted `td-defence` round in the mini siege plays at
  the loop's 60. OK?
- **213.** The tower-defense run files' sync hashes leave out the ticks where a guarded rule's
  mutant changes the state before a check fails, so `mutants` sees a failed check (a weak rule)
  rather than a hash mismatch. OK?

**Engine 0.12, smaller build choices** (details in `docs/BUILD-LOG.md`, Engine 0.12, Choices made)

- **214.** The tower-defense sample's balance: 40 gold and 5 lives; arrow tower 10 gold (range 2,
  damage 1, cooldown 6); cannon 25 gold (range 3, damage 4, cooldown 20, sells for 15); 400 ticks
  between waves; seed 12. Without a `sell` value a tower sells for half its cost, rounded down, at
  any time in the round. OK to keep these numbers?
- **215.** Map rules: path cells may only touch along the walk (a cell with two unvisited path
  neighbours is the error `path_branch`), so two path lanes side by side need a gap between them;
  a map's optional `legend` may add its own characters, each meaning one of the kit's five cell
  kinds (for example `W` for a build cell). OK?
- **216.** `td-defence`'s report has no `cleared` field (item 202 listed one): `result` (pass or
  fail) takes its place, and the report also gives `placed`, `killed`, `escaped`, `fallen`, `cells`
  and `foes`. Outcome rules accept `result` beside `leaksAtMost`, `spentAtMost` and `killed`. OK?
- **217.** The `fortify` mission as built: offered from world tick 5 to 30 (the runs open it at 10) for 30 ticks; four walls of two types (`wall` 80 hp, `wall-tower` 120 hp) north and south of
  the hall, off the road; the wave is raider-1 to raider-4 (the guards stay with the engines);
  outcomes `held-cheap` (40 gold), `held` and `held-bloodied` (80 gold) and `overrun` (no gold,
  both wall towers damaged), with delegate weights 1/2/2/1. OK to keep this content?
- **218.** Fortifying alone does not save the hall: without the sabotage the engines bring it down
  by world tick 200 on both fortify paths, and the fortify run files assert that. Should holding
  the walls also slow or weaken the siege?
- **219.** The mini siege's bar now shows one launch button per offered mission
  (`#launch-<mission>`) instead of a single `#launch`, since both missions are offered from world
  tick 20 to 30. OK?

**Engine 0.13, decisions before code** (details in `docs/BUILD-LOG.md`, Engine 0.13, Decisions)

- **220.** Fates live in a new `omitWhenEmpty` `Fate` component on `Member` entities only (`state`
  injured, captured, freed or dead; `by`, `at`, `held`, an append-only `history`), no component
  meaning active; states only move forward and dead is final. A captured person leaves the map
  (drops `Position`, `Unit`, the task components and `EventMember`, leaves the squad) and keeps
  `Member` and `Health`; `deathSystem` keeps a named person killed in battle as a dead record
  instead of destroying them. Golden hashes moved by this are re-recorded once in their own commit
  with every run-file assertion unchanged. OK?
- **221.** One data-only `fate` effect (`injured`, `captured`, `freed` with a cell, `dead`) in the
  mission contract; a capture opens follow-ups with the existing `opportunity` effects in one
  exclusive group (rescue, exchange, leave); `play` becomes optional, a mission without it is
  delegate-only (`not_playable`); a failed rescue may open a different opportunity or none, never
  itself again (`reopens_self`). OK?
- **222.** Every mode honours fates through its selectors: the `mission-room` foe and hero
  selectors and the `td-defence` wall and wave selectors skip `captured` and `dead` by the
  snapshot's `Fate`, injured people come in at their reduced hp, and the RTS kit's view already
  shows only units with `Unit` and `Position` (a test proves it). A pure `fateState` helper in
  `engine/core` is shared by the kits. OK?
- **223.** M13: `hero: { select, hpPer }` in a `mission-room` mission's params gives the round's
  hero `ceil(hp / hpPer)` (at least 1) from exactly one selected, living world unit; the report's
  `heroHpLost` (`heroLost * hpPer`, never more than hp - 1) comes back through a `damage` effect
  with `fromReport: "heroHpLost"`, and a delegated, quit or timed-out mission uses the declared
  `amount`. The mini siege's `sabotage` takes the captain as its hero with `hpPer` 20. OK?
- **224.** A second scenario names the first with an optional `from: { scenario, carry: { people,
stockpiles }, when }`; `carriedRecord` (in `engine/sim/carry.ts`) builds a plain JSON carried
  record from the first world's end, and `worldFromScenario(json, { carried })` applies it at tick
  0 under the cause `carry` (Health, Fate, stockpile items, and opportunities opened by a fate).
  The scenario format stays at version 1. OK?
- **225.** The `campaign` kind gains `{ scenario, ticks }` entries; `campaignRun` in
  `engine/core/campaign.ts` plays entries in order, a mission entry after a scenario opening on
  its end world; a campaign save (plain JSON: game, campaign, seed, position, carried record,
  committed results) is kept in browser storage under `ww:<game>:campaign:<id>`. OK?
- **226.** Save codes after SMBC: version, CRC-16/CCITT, campaign, position, seed, the carried
  record in carry-spec order and the committed outcomes, in Crockford Base32 groups of five, at
  most 40 characters for the mini siege; refusals `code_empty`, `code_typo`, `code_newer`,
  `code_layout`, `code_campaign`, `code_position`, `code_record`. "Restores the same world" means
  the follow-up's tick-0 world from the code hashes the same as the one from the carried record;
  a code does not replay the first scenario. OK?
- **227.** The mini siege follow-up "The dawn assault" (`dawn`): a smaller second assault the next
  morning, with the sergeant Mara Venn; `sabotage`'s `driven-off` also captures the captain (so
  only `quit` among the existing runs changes, after its commit); captured, he opens rescue
  (`ridge-camp` room, Mara as hero; a failure opens a dearer `ransom-window`), exchange (80 gold)
  and leave; active, he leads the defence at his carried hp. Run files `dawn-held` (from `played`)
  and `dawn-captured` (from `quit`) differ only in the source run, and their carried records only
  in the captain. OK to keep this content?
- **228.** Game run files gain `from: { run }` or `from: { code }` (one level deep, `from_chain`)
  and `codes: [{ tick, code }]`; `pnpm cli code <run file>` prints a run's save code; a test checks
  `from: { run }` and `from: { code }` give the same tick-0 hash. OK?

**Engine 0.13, close-out** (details in `docs/BUILD-LOG.md`, Engine 0.13, Choices made, and
`docs/reports/mini-siege.md`)

- **229.** M31 (a carried stockpile that is gone at the first scenario's end) is moved to 0.15, not
  fixed: a fallen hall still gives no campaign save, so the fortify runs cannot carry into the
  dawn and the page offers "Play again"; the API review decides the carry rule (zeros or a `lost`
  flag) and a campaign's loss rule as data together. OK, or fix the carry part now?
- **230.** M34 (the dawn's captive choices offered for only 60 world ticks, 6 seconds on the page)
  is moved to 0.15 with M26 and M36 (an entry held at tick 0 until the player begins it); the
  window stays 60 so no dawn hash moves. OK?
- **231.** M35 (two rules for when a scenario entry ends with a mission still open: the page's and
  `campaignSave()`'s) is moved to the 0.15 API review; no run or browser test ends with a mission
  open today. OK?
- **232.** The done-when's "two run files whose only difference is that defender's fate" is
  checked by `dawn-held` and `dawn-captured`, the same run file except `from` (`played` or
  `quit`), with a test that their carried records differ only in the captain's entry; the siege
  runs they start from differ in more than the captain. OK?
- **233.** Three test files that replay a siege before each dawn run (`tests/runs/run-files.test.ts`,
  `tests/runs/backend-parity.test.ts`, `games/samples/mini-siege/mini-siege.test.ts`) set a 60 s
  test timeout (`vi.setConfig`), since on a busy machine they passed their work but went over the
  default 5 s. OK?

**Engine 0.13, smaller build choices** (details in `docs/BUILD-LOG.md`, Engine 0.13, Choices made)

- **234.** A dead fate set from data (`killPerson`, a `fate` effect) also sets the person's hp to
  0, so it matches a death in battle; decision 1 did not say this. OK?
- **235.** A death in battle records `by: null`, since the attack system does not track who
  struck. OK, or should attacks track the striker?
- **236.** The mini siege glue lists `named.<key>.fate` only once a fate is set, so runs where no
  named person dies keep their hashes; listing it always would have moved every hash. OK?
- **237.** Sabotage's three success outcomes declare 10 captain damage for the delegated case
  (`damage.amount` must be at least 1), which changed one assertion in `delegated.run.json`
  (`named.captain.hp` at tick 160: 120 to 110), in the hash re-record commit, which names it. OK?
- **238.** A mission round's `hero`: its `event` is any event when left out (a defender is seldom
  in the battle's event); `hp` beside `hero` is a schema error; a captured, dead, missing or
  ambiguous hero refuses the round as `bad_mission_input` with no fallback to `hp`; the hero is
  never also a foe. OK?
- **239.** An outcome's `damage.fromReport` falls back to the declared `amount` when the played
  round's report lacks the number (or it is not a whole number of at least 0); 0 skips the effect.
  OK?
- **240.** Leaving a captive behind has no fate effect: the capture stands and the committed
  `left` record is the final mark. OK, or should leaving set a fate of its own?
- **241.** The dawn's balance: it reuses the raiders' siege plan (which never attacks buildings,
  so the hall stays at 300 in every dawn run); with the captain home the raiders are beaten but he
  dies by tick 100; ransom costs 120 gold (exchange 80); the freed captain stands at cell 10,15.
  OK to keep this content?
- **242.** `dawn-rescue` is a delegated rescue (seed 11 draws `freed`), not a played one; the
  played rescue is covered by `dawn-rescue-failed`. OK?
- **243.** Save-code layout details decision 7 left open: one "carried present" bit, `max` beside
  `hp`, a committed mission as its index among the game's missions sorted by id, and a CRC over
  every later bit. The mini siege's codes are 25 characters; a synthetic two-scenario campaign's
  is 27, a little over decision 7's estimate of 26 and well under 40. OK?
- **244.** Campaign entries gained an optional `title` (so the page's scenario names live in the
  campaign file) and content lookups gained `'*'` (any kind), so a campaign's scenario entry can
  name any scenario file found by its shape. OK?
- **245.** A run file with `from` plays on the campaign save's seed, as the page does with a save
  code, and a run file whose own `seed` differs is refused as `seed_mismatch` (`80f6774`, after
  the close-out). OK?
- **246.** The sergeant's look comes from the skin's `hero` tag, listed before `frozen`, so a
  frozen sergeant keeps her colours (the known one-look-per-tag gap M2). OK?

**Engine 0.14, decisions before code** (details in `docs/BUILD-LOG.md`, Engine 0.14, Decisions)

- **247.** The debugger is a tools-only page, `engine/tools/debugger/` (like
  `engine/tools/screenshot/`, never in the Pages build), started by a new `pnpm cli debug <file>`
  that serves it and prints its URL, with its own agent docs (`CLAUDE.md`, `AGENTS.md`,
  `docs/modules/engine-tools-debugger.md` linked from `llms.txt`). OK?
- **248.** The debugger reads run files, replay files (`.ww-out/replays/*.run.json`) and dump
  files (`dump --out`, a `format: 'worlds-within/dump'` envelope with the state, event log and
  timeline at one tick); it steps and rewinds by deterministic re-simulation in the page from tick
  0 (rewind to N = replay to N, with optional exact world-save rebuild points), every shown state
  checked against the run's headless hashes and stopped on a mismatch. OK?
- **249.** Game runs give the tools the event log and world time through two optional,
  read-only `HeadlessGame` hooks, `events(sinceTick)` (with the oldest kept tick) and
  `timeline()`, filled by `MissionHost` through its port and by the RTS kit's game; not a hook
  returning the sim's `World` and not `state.world` (which has no event log). The event log is
  never part of the hashed snapshot, so no golden hash moves. OK?
- **250.** The timeline record (`worlds-within/timeline` v1: world tick, a run-length world tick
  per game tick `clock` filled by the tools, frozen spans, experience, opportunity windows with
  status and open/close history, committed missions with open and commit ticks) is read by a pure
  `timelineOf` in `engine/sim/timeline.ts` over a world's plain snapshot and event log; `pnpm cli
timeline` prints it. OK?
- **251.** G8: `trace <run> --paths a,b [--from N] [--to M] [--every K] [--events]`, rows `{ tick,
values, events? }` as a top-level array so the output cap cuts whole rows; a missing path is
  `null`; no `dump --ticks`. OK?
- **252.** G9: a game run file's optional `start` is `{ stage }` (the platformer kit's level
  sequence, 0-based) or `{ entry }` (a campaign entry, fresh, no carried record), handed over as
  `HeadlessOptions.start`; it and `from` are mutually exclusive (a schema error); existing level-2
  and level-3 run files keep replaying the earlier levels, new start-level run files are added
  beside them. OK?
- **253.** G10: `get <grid> rows --ruler` prints a column ruler and row numbers (text form), and a
  new `paste <file> rows.R.C <block>` verb (or `--from-file`) writes a multi-line region, spaces
  written as spaces, refused `out_of_bounds` past the grid and schema-checked like every edit.
  `set` keeps its one-cell meaning. OK?
- **254.** G12: rule ids may be qualified `kit:id` in `disableRules`, `guards`, `--disable-rule`
  and `mutants`' output; unqualified ids keep meaning `kit`'s rules (every run file stays valid);
  `HeadlessOptions.disabledRulesByKit` beside the flat `disabledRules`; `mutants` tries every
  used kit's rules, each judged by its own kit's `strictMutants`. OK?
- **255.** G31: `bootBrowserGame` gains a manual-loop mode (`?debug=step` or the debugger) with a
  `window.__ww` debug API (`step(n)`, `tick`, `hash()`, `snapshot()`), and pages take
  `?replay=<run file>` in dev and the debugger only (ignored in the Pages build); normal play is
  unchanged. OK?
- **256.** M19: a pure input recorder in `engine/core` (held actions per frame to `ScriptedInput`
  steps), the shell recording a hosted round (frame 0 the round's first tick) for copying out, and
  `pnpm cli record <run> --mission <id> [--input <file> | --bot]` writing it into that mission's
  `play.input` and verifying by playing (unchanged file and exit 4 when the asserted outcome is not
  reached). Frame input only; taps stay D1's (0.15). OK?

**Engine 0.14, build choices** (details in `docs/BUILD-LOG.md`, Engine 0.14, What was built)

- **257.** G12 (T5, settling decision 8 for a strict kit a game `uses`): a run without `guards`
  is expected to guard every rule of the game's own kit only, and a `uses` kit's rule is expected
  only where a run file lists it in `guards`. So a strict `uses` kit fails `mutants` only on a
  listed guard a run does not guard; its rules no run file guards are reported per kit
  (`kits[].unguarded`) and recorded in the gap report, never a failure. The mini siege's
  tower-defense rules (strict) are guarded by `fortify-played` for `towerdefense:win-on-clear`
  only: the others change a sync hash before any check notices. OK, or should a strict `uses`
  kit's unguarded rules fail the game (which would need new run files without sync hashes)?
  Note (T5 review, finding 1): this reading is looser than decision 8 as written, so
  `mutants games/samples/mini-siege` exits 0 with 13 of the 14 tower-defense rules unguarded. The
  code keeps it until this item is answered. Following decision 8 literally needs more than new run
  files. A copy of `fortify-played` without sync hashes would guard 7 more (`build-costs-gold`,
  `spawn-spacing`, `enemies-walk`, `towers-fire`, `tower-range`, `tower-cooldown`, `win-on-clear`).
  New rounds could guard `build-on-build-cells`, `sell-refunds`, `leak-costs-life` and
  `lose-at-zero-lives`. But three rules do nothing in the fortify round as its data stands: it has
  no wave `timer` (`wave-timer`), its raiders pay `bounty` 0 (`kill-bounty`), and they are one
  group at one speed with no jitter, so the enemy furthest along is always the lowest id
  (`target-first`). Under the literal rule the game would fail until the fortify mission's data
  changes, and that would move its recorded rounds' hashes.

**Engine 0.14, close-out** (T12; details in `docs/BUILD-LOG.md`, Engine 0.14)

- **258.** The Done when's data-only scenario is the mini siege's third campaign entry, **the
  ridge camp** (`ridge.world.json`, the `stores-raid` mission, `ridge-raid.run.json` started with
  `start: { entry: "ridge" }`), with no `from` (it starts as written) and played on the page after
  the dawn. Its commit touches no `.ts` file; the game's tests that pinned the campaign to two
  entries were loosened in a commit before it (gap M37, a test fix, no glue change). OK, or should
  the ridge camp carry the dawn's results (a `from`) or stay out of the page's campaign?
- **259.** M38 (save codes index missions by sorted id, so a mission file added with an id that
  sorts earlier moves every pinned code and misreads old codes) is moved to 0.15's API review
  rather than fixed in the close-out: a stable index changes the code format (v2) and every pinned
  code. Until then a new mission's id must sort after the existing ones (the ridge camp's is
  `stores-raid`). OK?

**Engine 0.14, smaller build choices** (details in `docs/BUILD-LOG.md`, Engine 0.14, What was
built and Choices made)

- **260.** The event-log hook is `worldEvents(sinceTick)`, not item 249's `events`, because a
  hosted game already has an `events` field (its last step's draw events). Its result also carries
  the world tick now, which the tools use to fill the timeline's clock. OK?
- **261.** A game with no world hooks is `no_world`, exit 3 (a content error), not exit 2 as
  decision 3 said. OK?
- **262.** The RTS skirmish's world hooks are in the game's glue, not the kit's `RtsGame` as
  decision 3 said, because the kit's world port is plain data and cannot reach the sim. OK?
- **263.** The timeline also lists open missions (outcome null until committed) and the oldest
  tick the log keeps (`logFrom`); frozen spans use decision 4's names `{ event, by, from, to }`.
  OK?
- **264.** G5: `virtual:game-files` is one default export (`import files from
'virtual:game-files'`); the per-game names (`DEMO_FILES`, `LAB_FILES`, ...) are gone. The plugin
  in `build/` walks folders with Node built-ins rather than importing the engine's reader (a test
  checks both list the same files), and `config/layers.js` is unchanged: the virtual id counts as
  an outside package no layer owns. OK?
- **265.** G8: `trace` was built without item 251's `--events` (the event log was T7's work; it
  can still be added). A missing path is listed as `{ path, firstTick, ticks }`, so a path that
  disappears mid-run shows when. Rows are only the `--every` grid ticks; `to` is not added as an
  extra row. OK, or add `--events` to `trace` in 0.15?
- **266.** G9: a start the game cannot honour is a content error (exit 3, `no_start` /
  `bad_start`), not a usage error as decision 6 said. Games list what they can start at with a new
  optional `starts(content)` on the headless module. A fresh campaign entry is a save at that
  entry with every earlier entry finished and nothing carried. OK?
- **267.** G10: both `--from-file <path>` and `@path` work, with an optional `--transparent` (off
  by default, so every cell is written as typed). A block starting with a real `@` is written
  `\@`. `ruler` in JSON is the two ruler lines, not `true`. Ranges, rectangles, `--ruler` and
  `paste` work only on `*.map.txt` grids (not sprite frames). OK?
- **268.** `stateHash` moved to `engine/core` as a synchronous SHA-256 written in code (no
  `node:crypto`), so the page and the CLI share one implementation. No hash moved and tests are
  no slower. OK?
- **269.** G31: item 255's `?replay=<run file>` URL parameter was not built (the page fetches no
  files); a caller passes the run file's JSON to `window.__ww.replay(json)` instead. Replay works
  only from tick 0 and refuses run files with `world`, `from`, `start` or disabled rules. OK, or
  add the URL loader?
- **270.** G31: on the RTS pages `__ww.tick` counts loop steps, not world ticks, so RTS run files
  can be stepped through the hook but not replayed tick for tick. Pages whose scene wraps a
  `HostScene` report a hash only where they forward `headless()` (the mini siege does, from M19).
  OK?
- **271.** M19: recording lives in `MissionHost`, so only mission rounds are recorded (rounds
  hosted by the platformer kit's world are not). `record` refuses a recording made at a different
  tick (exit 2), and `?record` also puts `window.__ww` on a normally running page so a person can
  play and copy the recording. OK?
- **272.** M19: `record --bot` takes the bot's plan as JSON (or `@file`) checked against a schema
  the kit gives (new optional `KitDef.roundBots`); the top-down plan allows only plain-data steps
  (fight, goto, pickup, chest, leave). `playRun` gained three optional hooks for it. OK?
- **273.** The debugger does not step world runs (`debug` on one is a usage error pointing to
  `dump --out`; its dump file opens read-only), narrowing decision 1's "a game's or a world's"
  run files. OK, or should world runs be stepped in 0.15?
- **274.** The debugger's job (files, seed, input, expected hashes) is built by the CLI and served
  from memory on a GET-only route, instead of decision 1's file-reading endpoint; the page reads
  no files. Rewind re-simulates from tick 0 and caches every tick's snapshot (memory grows with
  run length). OK?
- **275.** `debug --check` exits 4 when a replay does not reproduce its failure, or when a stored
  hash differs before the failing tick (the page stops at the first mismatch). Passing `--tick`
  other than a dump's own tick is a usage error. OK?
- **276.** The timeline viewer's axis is game ticks (what the debugger steps); a world tick past
  the recorded clock (a later window close, an open mission's commit) is drawn faint as
  `projected`, as if the world moves one tick per game tick. It shows the record at the tick
  shown, not the run's end. OK?
- **277.** Three heavy test files set a 60 s test timeout (`world-data.test.ts`, the debugger's
  `model.test.ts`, `trace.test.ts`), as in item 233: they replay the mini siege several times and
  went over the 5 s default only under a loaded full run. OK?

**Engine 0.15, decisions before code** (details in `docs/BUILD-LOG.md`, Engine 0.15, Decisions)

- **278.** The demo moves to `games/samples/dungeon/` and the stacking-test game to
  `games/samples/platformer/` (`git mv`; ids `dungeon` and `platformer`; module pages
  `games-samples-dungeon.md` and `games-samples-platformer.md`); their run files move byte for byte
  with identical hashes; `games/platformer-lab/` stays where it is. OK?
- **279.** Golden hashes may move only in T9 (M12's fixture and M20's enemy, with the mini siege's
  `named` removal and offer `marker`, so its hashes move once), in T8 where D3/D4 change a record
  (the mini siege's `fortify` runs; save code v2 moves pinned codes), and for new sample content,
  which adds runs rather than moving old ones, with one named exception (M32's rescue room moves
  the rescue-playing `dawn-*` runs); always regenerated with `WW_UPDATE_GOLDEN=1` and logged. OK?
- **280.** G36: an optional skin `background` colour in both skin formats, black when absent. M2:
  a `byTag` look matches by `tag` or by `prefix` with optional `min`/`max` on the rest read as an
  integer, first match wins; a look for two tags at once moves to 1.0. OK?
- **281.** G33: the HUD layout becomes one pure core function both backends draw; the `three` skin
  gains `sheets` and `hud`; Three.js draws the items as an orthographic pass of `DataTexture`
  quads (no 2D canvas, runs in Node); particles are built as pooled low-poly boxes. OK?
- **282.** M1: stored `{ master, music, sfx, muted }` per game, guarded storage, and the shell's
  own mute button and volume slider on every sample page. D2: a per-scene tick rate in the shell
  with merged input (the tower-defense sample's `TickInput` rule). OK?
- **283.** D1: taps become frame input (`InputFrame.taps()`, `InputScript.taps` in game pixels),
  recorded by the M19 recorder. D12: `HostScene` forwards taps with keys (no `MiniGame.tap`).
  D13: the tower-defense kit's `screenAtCell` and a display `toClient`. OK?
- **284.** M21: `MissionHost` emits `mission-open`, `mini-game-end` and `mission-commit` events.
  D9: the core puts `status.miniGame` on a hosted round's frame. M6: one round-picture frame
  source in core/present. M18: `MissionHostOptions.canOpen` and `onChange` with an RTS kit helper.
  M27: `engine/sim`'s `rtsWorldPort(world)`, structurally typed. OK?
- **285.** M10/D6: scenario keys kept with the world outside the hashed snapshot and handed to the
  round (`refs` unchanged). M17/M28: run checks `world.key.<key>.<Comp>.<field>`; records through
  `missionRecords`, the port and `MissionHost.records()`. M25: a mission's optional `marker` key.
  M16: a `squad` selector (roles stay three). D10: a `slot` build cell per selector entry. D7:
  `checkUse` sees the world scenarios. D8: a `td-map`'s `waves` is optional. OK?
- **286.** D3/D4: `fromReport` on `inventory` (with `negate`), a per-entity `each` on `damage` and
  `destroy`, limits `max` and `owner` checked (a round over them is refused late, then delegated),
  not clamped. M4: experience ticks stay out of the hashed record. M5: late refusals in
  `refusedMissions` with `late: true`. M31: a lost stockpile carries as zeros; an entry's `endIf`
  ends a campaign in data. M35: one `entryOver` rule. M38: save code v2 with ids written as short
  id codes (collisions refused by `validate`), v1 still read. OK?
- **287.** M12: `raid.mission.json` becomes a real `mission-room` mission with its params inlined
  (the world-run goldens it touches re-recorded). M20: `ScriptedEnemy` skips units of a frozen
  event (every mini siege hash moves, once). OK?
- **288.** M26/M34/M36: a mission-launch scene and a campaign flow (entries held at tick 0 behind
  a briefing, the result panel, save code, Continue, code box) in `engine/core/shell`. D14: a mini
  game's controls as data on `MiniGameDef`, with an optional mission `hint`. OK?
- **289.** G17: a `game.json` `kitOptions` read by `KitDef.kinds(manifest)`; the top-down kit's
  `rooms: "dungeon" | "separate"`. M32: the dawn rescue gets its own mission room. M11: a
  generated params page per game-defined mini game under `docs/reference/mini-games/`. OK?
- **290.** A finished sample (dungeon, platformer, RTS skirmish, tower defense) has original
  NES-style text art with no fallback looks, MML music and sfx, low-poly meshes where 3D (the
  platformer), a `CLAUDE.md` and module page, run files in CI with a win and a loss and its kit's
  rules guarded, a browser test, the volume control, and a line in the games index. The mini siege
  is not re-finished. OK?
- **291.** The API review is `docs/reports/api-review.md`: every module's exported entry points,
  each kept, changed in 0.15 (with the commit) or listed for 1.0, every 0.15 gap with where it
  landed; D5 and D11 stay 1.0 documentation, listed as rules with no code change. OK?

**Engine 0.15, smaller build choices** (T17; details in `docs/BUILD-LOG.md`, Engine 0.15, What
was built and Choices made)

- **292.** T5: the mini siege keeps its own battle step counter (`STEPS_PER_TICK`) rather than the
  shell's scene `tickRate` (D2), because a scene stepped only on its ticks would drop the pointer
  gestures of the loop steps between; the 3D display's `toClient` is the boot's canvas-box
  fallback rather than a change in `threeDisplay`. OK? (The shared shape is listed for 1.0 as
  `1.0-7`.)
- **293.** T6: the "run file check of an event" (M21) is a test, `tests/runs/mission-events.test.ts`,
  which plays `played` and `delegated` through the tools' run loop and checks the host's events on
  the asserted game ticks, rather than a new run-file path into data that is never in the
  snapshot; `canOpen` is asked before the host's own checks (a direct `open` of a committed rescue
  is now `not_offered`); `onChange` is also called when a round's end resolves its mission. OK?
- **294.** T7: D10's field is `build.cells: [{ entity, cell }]`, not `slot` (`build.slot` already
  names the slot character); `world.id.<n>` and `world.one.<Kind>` were added beside
  `world.key.<key>` for entities with no scenario key (trained units, the world-level
  components); `no_waves` is judged by whether a `td-defence` mission names the map. OK?
- **295.** T8: an `each` effect without a report applies its declared `entities` (none: nothing);
  an `each` name that stands for no entity is left out unless `owner` is given (then it is over
  the limit); limits are checked when the played result resolves, not at the commit; `endIf` is
  on the siege's entry only (the dawn's hall falling still moves on to the ridge); only campaigns
  and missions get stable id codes; save codes grew by about three characters (still under 40);
  `dawn-code` keeps a version 1 code as the proof that v1 codes still read. OK?
- **296.** T9: besides skipping frozen units (M20), the scripted enemy's `train` skips a frozen
  building, so a plan gives no order at all to a held event (no sample trains at a frozen
  building, so no hash depends on it). OK?
- **297.** T10: the hold at tick 0 is on by default for every campaign entry (`hold: false` turns
  it off); while held, a typed code or the stored save may still be used; a round's key hint uses
  each action's first keyboard binding, so "give up" reads RIGHT SHIFT where the old string said
  Backspace; the step hook's `replay` does not press Begin. OK?
- **298.** T12: the dungeon's page boots through the shell's `bootBrowserGame` and its scene
  reports the headless game, so the page's hashes are the run files'; the top-down snapshot's
  type names are written out (`typeNameOf`) because the minified page build renamed
  `constructor.name` (same names, no hash moved). OK?
- **299.** T13: T4's 3D HUD was found uncommitted in a stash and committed with T13 (the stash is
  left as it was, not dropped); for the platformer "replace placeholder art" meant removing every
  fallback colour (the art was already original text pixel art and low-poly meshes from 0.7);
  one song for the whole page (no round music); no new run file (the existing eight cover clears,
  deaths and a failed round). OK?
- **300.** T14: the RTS skirmish's win and loss rule is the sample's (it reads the view), not the
  kit's; the event reader `RtsEventTracker` is a kit helper (two RTS games would write it), and
  the mini siege was not moved onto it (it keeps its host events); the tower-defense sample keeps
  its status-line end rather than a new banner (a shared end flow is `1.0-9`). OK?
- **301.** T15: the review fixed A1-A3, A9 and A10 in its own commit (`mustSkinSet`, the dungeon
  through `kitContentKinds`, the platformer glue's `test*` names renamed `hopper*`, the
  skirmish's recorder on the core `stateHash`, `rtsScenario` in the RTS kit) and listed A4-A8
  for 1.0 (`1.0-5` to `1.0-9`) as too large for the review's commit. OK?
- **302.** T16: the "plays from a link" proof is a browser test over a real Pages-style build
  (`VITE_BASE=/Worlds-Within/`, served as static files), following the games index's own links,
  since nothing may be published during the build (answer 24). OK?
- **303.** T17: the owner's summary at the top of `docs/BUILD-LOG.md` lists every feedback item
  from 25 to 303 as awaiting an answer except those already answered by a later item (48 by 128,
  81 by 158, 84 by 157); the root `package.json` version stays `0.0.0` (no release bump without a
  tag). OK?

**Engine 0.15, more build choices** (the finalize pass; choices from the task entries in
`docs/BUILD-LOG.md`, Engine 0.15, not yet covered by 278-303)

- **304.** The samples' names: "The Old Crypt" (dungeon), "Hopper's Way" (platformer), "The River
  Ford" (RTS skirmish) and "The Winding Road" (tower defense). The mini siege's index line stays
  "The mini siege". Keep these names?
- **305.** The platformer's second challenge room is in a new last level, `level-5`, not behind a
  second door in `level-4`, so no existing run's hashes move. OK?
- **306.** The 3D HUD's pixel art comes from a new core helper, `contentPixelSheets`, in the default
  colour mode only: the 3D HUD does not follow the colour-blind palette modes the 2D one does. Fix
  in 1.0, or accept?
- **307.** The three-vault 3D skin's camera clamp changed from on to off, so the room does not
  overlap the new 3D HUD; 2D and 3D vault cameras now match. Only the picture changed. OK?
- **308.** The dungeon's relic was a gold Triforce (Nintendo's symbol, not original art); it was
  redrawn as an original gold chalice after the release's close-out. The kit's item id `triforce`
  is unchanged so no hash moves. Rename the id too, in 1.0?
  _Resolved by the orchestrator after the 0.15 close-out (trademark): the kit's item id is now
  `relic` everywhere (kit, dungeon content, skin, run file, tests, docs); the `escape` run's hashes
  at ticks 960, 1020 and 1060 moved with it and were re-recorded._
- **309.** A `td-defence` round now counts gold spent net of sales (spent minus refunds, never below
  0), so a fortify round that places and sells within its 100-gold budget keeps its played outcome.
  No run file moved. OK?
- **310.** `missionPort(world)` now always opens missions with the world's key table (a mission's
  `refs` layered on top), so a keyed effect that used to fail as `unknown_ref` now resolves. OK?
- **311.** `MiniSiegeGame` now extends `MissionHost` instead of wrapping it, and its sim world is
  renamed `sim` (the host's `world` must stay the host for the shell). OK?
- **312.** New optional schema parts beyond the decisions: `KitDef.options` (so tools refuse unknown
  kit options), a `text` briefing on campaign entries, and `min > max` refused as `bad_tag_look`.
  `roomKind(..., { oneDungeon: false })` now checks each room alone instead of skipping the check.
  OK?
- **313.** The grass colour of the RTS skirmish, tower defense and mini siege moved into their skins'
  `background` (pixels unchanged); the renderer's own `background` option stays as an override that
  no game uses. OK?
- **314.** The RTS skirmish's barracks shows construction progress with one new original frame,
  `site-2x2-half`, from `progress:50`; the town centre and the mini siege's watchtower are
  unchanged. OK?
- **315.** The 3D platformer browser check ignores console errors that mention a GPU stall or WebGL
  (Chromium software-rendering noise); every other error still fails the test. OK?

**Engine 0.16 part A** (details in `docs/BUILD-LOG.md`, Engine 0.16 part A)

- **323.** The 2D feature benchmark (`pnpm bench:features`, T13, item 320): with every 0.16
  feature on (2000+ particles normal and additive, glow, three parallax layers, tinting, a UI kit
  HUD, shake and zoom) on the RTS map (500 units) and the tower-defense map (300 units), Canvas2D's
  p95 frame time is 143-239 ms (4-8 fps) at zoom 0.5, 1 and 2, against 16.7 ms; the same units on
  the plain skins take 5-13 ms. Glow on additive drawing is the worst cost, but with both off it
  is still 32-35 ms p95. Measured on software rendering only (no GPU in the build container). The
  build therefore adds a follow-up task, T13b: a PixiJS v8 2D backend behind the same `Presenter`
  and skins (`pixi.js` pinned, owned by `engine/backends/pixi` in `config/layers.js`), checked
  with a PixiJS column in this benchmark before it replaces Canvas2D as the default; Canvas2D stays
  for Node tests, screenshots and machines without WebGL. Go ahead with T13b? Or first (a) rerun
  the benchmark on a machine with a GPU, or (b) try the Canvas2D fixes the build log lists
  (pre-rendered glow sprites, culling off-screen particles, batching) before adding PixiJS?

**Engine 0.16 part A, choices made** (T1-T14; details in `docs/BUILD-LOG.md`, Engine 0.16 part
A, Choices made). Each is built and kept unless the owner says otherwise.

- **324.** Presentation randomness is its own RNG, `fxRng(seed, frame, stream)`, never the
  world's; `engine/core/fx`, `engine/core/ui` and the audio mixer are off limits to kits and the
  sim (`FORBIDDEN_CORE`). Presentation invariance is proved by rewriting every game's skins with
  "effects on" switches (`tests/runs/effects.ts`) rather than by new run files. OK?
- **325.** Sprite animation (T2) extends the old cycles instead of a new format: `ticks` one
  number or one per frame, `loop: false` with `then`, frame `events` played as presentation-only
  events through the skin's `events`; a 3D kind's `poses` is the same table with mesh names. The
  part A features are shown in a new lab game, `games/fx-lab` (not a sample). OK?
- **326.** Particles (T3) are the engine's own fixed-step system in `engine/core/fx` (no
  library), shared by both backends; `blend` and `glow` on kinds are 2D only, and a 3D particle
  sprite frame draws as a square in its colour. OK?
- **327.** Camera effects (T4): the shake is trauma squared with `fxRng` noise in whole pixels;
  hit-pause holds the page loop's ticks (never the game's rules), the picture and the presenters'
  clocks go on, and manual-loop mode (`?debug=step`) ignores it; the loop now draws only on a
  frame that took a step. OK?
- **328.** Screen transitions (T5) are the shell's, by slot in `game.json`'s `transitions`
  (`level`, `scene`, `mission`, `default`); the closing half holds ticks like a hit-pause, manual
  mode does not hold, and reduced motion turns every transition into a short fade. OK?
- **329.** The UI kit (T6, T7) is its own module, `engine/core/ui`, with two content kinds,
  `font` (one-bit glyph grids as text) and `ui` (screens of menus, buttons, dialog boxes);
  backends paint its draw items through a small `UiPainter`. The fx lab's own lab menu is 2D only
  (the shell's menus draw in both backends). OK?
- **330.** The audio mixer (T8): layered songs start every layer on one clock, sound variation and
  cooldowns come from `fxRng`, one duck envelope takes events and open dialog boxes, and no
  headless run ever makes a mixer. OK?
- **331.** Title, pause and settings (T9) are built by the shell from `game.json`'s `menus`;
  `?debug=step` and `?record` skip the title so no run file, replay or older browser test moves;
  settings (shake, flashing, colour mode, touch pad) are stored per game under
  `ww:<game>:settings`. OK?
- **332.** Assets (T10, T11): binary files only in a game's `assets/`, carried to the browser as
  data URLs with the game's files; the engine writes PNGs and GLBs deterministically, and the fx
  lab's PNG torch and glTF brazier are original, made by scripts in `games/fx-lab/tools/` (own
  work, CC0, credited). A `.gltf` is packed into a GLB first so it parses in Node. OK?
- **333.** The 3D scene look (T12) is opt-in per skin (`scene3d`, a kind's `light`, shadow flags,
  `labels`): a skin without it draws exactly as before; labels are laid out by the UI kit. OK?
- **334.** `pnpm cli sheet` (T14) draws its tiles on the tools' screenshot page, not on a game's
  own page: menus, `ui` screens and transitions are drawn over a tile by the engine's own code
  (`ui=lab.talk`, `pause`, `level*22`), so any run file (also one with `start`) can be shown. In
  2D an iris closes on the picture's centre (the view's camera is inside the game's picture); in
  3D it closes on the camera's focus. OK?
- **335.** Screenshot review sheets may be committed as PNGs in `docs/reports/*-sheet.png` (beside
  `docs/reports/mockups/`): `tests/architecture/no-content.test.ts` and DESIGN.md say so. The
  first is `docs/reports/0.16a-effects-sheet.png` (656 KB). OK, or keep sheets out of git?
- **336.** The final invariance proof (T14) is a second test, `tests/runs/stepped-shell-invariance.test.ts`: the real `bootBrowserGame` on a fake page, stepped by `requestAnimationFrame`, with
  both presenters, the mixer, hit-pause, transitions (an iris on every level change, a fade every
  90 frames) and the pause menu (every 150 frames) all on, the run's input fed through the scene.
  It does not use `__ww.replay`, which refuses runs with `start` and never holds ticks. OK?
- **337.** The fx lab's title dims the game behind it at 0.95 instead of 0.88 (on the sheet the
  HUD's heading showed through the subtitle). OK?
- **338.** The roadmap's first part A Done when ("each feature above is in the engine...") is
  checked for every feature but the PixiJS backend, T13b, which is not built: it waits for the
  owner's answer to 323. OK to count part A's engine features as done with T13b open?
- **339.** **Owner screenshot review (open).** Please look at
  `docs/reports/0.16a-effects-sheet.png` (24 labelled tiles of the fx lab, 2D and 3D: particles,
  flashes and shake, transitions, the UI kit, the title, pause, settings and controls screens, the
  PNG and glTF assets, 3D lighting and shadows) and say whether it is accepted, or name the tiles
  that are not yet at the bar of item 316.

**Engine 0.16 part A, smaller build choices** (the finalize pass; choices from the T1-T14 task
results, details in `docs/BUILD-LOG.md`, Engine 0.16 part A). Each is built and kept unless the
owner says otherwise.

- **340.** Tweens (`tween`, `spawnTween`) validate on 2D and 3D skins, but only the Canvas2D
  presenter plays them; the 3D backend ignores them for now. Add them to 3D later, or now?
- **341.** A colour tween is a translucent box over the entity, with a new `amount` field (0 to 1,
  default 0.5) and `from` defaulting to white. OK, or should it recolour the sprite's pixels?
- **342.** `spawnTween` starts on any entity the presenter did not see the frame before: every
  entity on the first frame, and one that leaves and comes back. OK?
- **343.** A 3D kind's animation table is a new field, `poses` (mesh names), not `frames`, because
  `frames` is already an error on a 3D skin. Tag looks (`byTag`) cannot set `poses` yet. OK?
- **344.** The new animation checks (`bad_frame_ticks`, `bad_frame_event`, `bad_then`) run in
  `validate`'s reference check, not in the skin's Zod schema, so a bare schema parse does not
  report them. A `then` that leads back to a played state holds the last frame. OK?
- **345.** Particles in a presenter use its own `seed` option (default 0), not the run's seed,
  because a frame does not carry it; the picture is still the same every time. OK?
- **346.** The old `effect.kind: particles` is now a built-in emitter drawn exactly as before.
  Reduced flashing tones down additive particles only, not every burst. When a particle cap is
  full, new particles are skipped rather than replacing old ones. OK?
- **347.** 3D particles are screen-facing points (1024 per buffer, was 256 boxes), 12 px in front
  of the play plane. OK?
- **348.** Camera effects (shake, zoom, flash) run on each presenter's own clock, not the frame
  number, so they keep moving through a hit-pause and the pause after a level; and the page loop
  now draws only after a step (a 120 Hz screen no longer draws each step twice). OK?
- **349.** A zoom punch zooms about the followed entity, not the view's centre; look-ahead follows
  the entity's facing; the existing `deadzone.h` serves as the roadmap's vertical deadzone (no new
  field). OK?
- **350.** The shell finds a level change by watching each frame's map id (games need no glue);
  while the cover closes it shows the last frame from before the change. The platformer sample
  now opts in, so one browser test's sample tick moved from 2900 to 2930. OK?
- **351.** The pause menu opens on the raw keys Escape and P, pad button 9 and an on-screen button,
  not the `start` action (tower defense and the fx lab use Enter for their own things). Esc is
  still bound to `start`, so in menus Esc confirms rather than going back. OK, or make Esc "back"?
- **352.** "Back to title" reloads the page on the RTS skirmish, tower defense and mini siege
  (their DOM bars hold the first scene); the platformer, dungeon and fx lab rebuild the scene. OK?
- **353.** The title's background is the game's own picture at tick 0 under a dim, not a separate
  title skin. OK, or should each game get its own title art?
- **354.** The colour-mode setting is built but hidden, because no sample has colour modes yet. OK?
- **355.** Music ducking scales the music bus gain (no new gain node, so the 0.15 audio tests stay
  unchanged); UI sounds get their own bus that follows the sfx volume (no separate stored volume).
  OK, or add a UI volume setting?
- **356.** For the fx lab's danger music layer the platformer kit's frame status gained
  `nearestActor` (pixels to the nearest actor, -1 when none). Presentation only; no hash moved.
  OK for a kit field added for music?
- **357.** In the 3D HUD every material is now transparent so draw order stacks the quads (the old
  opaque box hid bar and minimap fills). For old skins this can change pixels only where a
  missing-frame box overlaps a sprite. OK?
- **358.** `missing_glyph` checks only the new font files; old sprite fonts are not checked, so no
  existing game starts failing `validate`. OK?
- **359.** glTF models: animation clips always loop (no one-shot or `then`), tag looks cannot set
  a `model`, and a `.gltf` that points at outside files is refused (`bad_model`), since the engine
  never fetches files. An entry with a model still needs its text `mesh` as the stand-in. OK?
- **360.** The 3D look: fog's `near`/`far` are measured behind the play plane (zooming does not
  move the fog); shadows use PCF (not PCF-soft) so `shadow.radius` works; point lights fade with
  decay 1, so their strengths are in the tens. Camera tilts left at 4 (platformer) and 6 (fx lab)
  because more tilt showed sky under the ground. OK?
- **361.** The fx lab gained a third level (`fx-3`) and a harmless still `torch` actor type in its
  profile, so the torch presets have something to sit on; levels 1 and 2 and their hashes did not
  change. OK?
- **362.** T7's finished UI kit work was found uncommitted in the working tree (an interrupted
  agent); all checks passed on it and it was committed unchanged (9bce7d7) before T8. Please
  glance at that commit.
- **363.** The feature benchmark is a new folder, `tests/bench/feature-render/`, using the
  games' real frames and unit kinds; the 0.9 `tests/bench/rts-render/` is unchanged. The Canvas2D
  presenter gained `maxParticles` (default 1024) and `particleCount` for it. OK?

**Engine 0.16 part B, T4: the CC0 asset packs** (details in
`games/samples/platformer/assets/CREDITS.md`)

- **364.** Pixel Frog's "Pixel Adventure 1" (fetched from itch.io; CC0 per its itch.io page, the
  zip has no licence file) has terrain, backgrounds, the player, items, checkpoints, traps and
  effects but **no enemies** (they are in the paid "Pixel Adventure 2"). The nearest CC0
  substitute was added for them: Kenney's "Pixel Platformer" (itch.io mirror), its packed
  character sheet (enemies) and tiles, 10 KB. Its 18 px tiles and 24 px characters are a
  different grid and style from Pixel Frog's 16 px tiles and 32 px characters, so T6 picks one
  look (or draws enemies as original text art). OK?
- **365.** Kenney's "Platformer Kit" (fetched from OpenGameArt, version 1.1, CC0) has terrain
  blocks, props, coins and a flag but **no player or enemy models**. Substitute for those:
  Quaternius's "Ultimate Platformer Pack" (itch.io, CC0): `character.glb` as the player stand-in
  and four animated enemies (1.1 MB). The newer Kit 3.0 on Kenney's itch.io mirror was not used:
  its models name an outside texture file, which the engine's model check refuses. OK?

**Engine 0.16 part B, T5: room for the flagship** (details in `games/samples/platformer/CLAUDE.md`,
Build choices)

- **366.** The old five levels, the vault and cellar rooms, the old `hopper` profile, their art,
  sounds, skins and all eight run files moved (with `git mv`) to a new test game,
  `games/platformer-classic` (id `platformer-classic`, 256x240, its own page, `CLAUDE.md`,
  `AGENTS.md` and module page), with every golden hash unchanged. Its run files each pass
  `mutants`; the whole folder lists the kit's new 0.16 part B rules (`coyote-time`,
  `checkpoints`, `boss-*`) as unguarded, as the old sample folder already did since T1 and T2
  (the lab guards them). The tests that used the old sample as "the game on two kits" point at
  it now. OK?
- **367.** Hopper's Way's screen is 320x180 (16:9; 6x is 1920x1080). The kit's `LevelSequence`
  took a `viewWidth` option so the level scrolls and wakes actors over 320 px (it defaulted to
  the NES 256); left out it is 256, so no existing hash moved. OK?
- **368.** The tuned profile is `hoppers-way` (numbers and reasons in the sample's `CLAUDE.md`):
  coyote 6, jump buffer 6, jump cut 2 px/tick, quicker walk and run acceleration and stops, a
  slightly faster run, three jump tiers, fall cap 4.25 px/tick. The campaign lists `level-1`,
  `level-2`, `level-3` and `boss`; the last three are flat placeholder corridors until T7 and T8
  fill them. OK?
- **369.** The placeholder skin is the old hand-drawn `hopper` art copied in, plus a text-art
  checkpoint (grey pennant, green once touched) and the checkpoint's sound; the shell-walker,
  shell and door looks were left out (no level uses them). T6 replaces it with the CC0 packs. OK?

**Engine 0.16 part B, T6: the 2D art and feel pass** (details in
`games/samples/platformer/CLAUDE.md`, The 2D skin)

- **370.** The player is Pixel Adventure's Ninja Frog: its 32 px frames stand bottom-anchored on
  the kit's 12x16 box, so the frog is about 24x26 px and its head rises some 10 px above the box
  (it overlaps a block for a frame or two when it bumps one from below). The box was not changed
  (that would move every hash). Its states come from the pack's PNGs (one per animation; the
  engine gained a cycle's own `sheet` for it): a landing crouch then the idle breath, the run
  (walk slower) with footstep dust, jump, fall, the hit frames (the two white ones are the hit
  flash) and a dying puff. OK?
- **371.** Enemies are Kenney's 24 px critters (a blue blob for `walker`, a red spike-helmet for
  `ledge-walker`, each with a flattened stomped frame) next to Pixel Adventure's tiles; coins and
  hearts are Kenney's too; the goal is Pixel Adventure's trophy, the checkpoint its flag (raised
  with the pack's 26-frame animation from the touch, then waving). OK?
- **372.** The parallax layers (clouds, snow-capped mountains, hills with crest trees, bushes) are
  original text pixel art from a small generator, not a pack's PNG: the packs' backgrounds are
  opaque tiles or opaque bands with their own sky, which cannot be layered. OK?
- **373.** Engine additions for the pass (presentation only): neighbour-based tile frames (a 2D
  tile's `join`, so `#` draws grass tops, edges, corners and notches), a cycle's own `sheet`, the
  menus' art and panels may use a skin's PNG `images`, and the platformer kit's current
  checkpoint has the state `active` timed from its touch (for the flag raise; skins without it
  fall back to `idle`). OK?
- **374.** A third run file, `level-1-hurt` (walk into the first walker: the hurt at tick 209),
  gives the hurt flash, shake and blink something to screenshot; the four stages got names for
  the level select (Meadow Start, Over the Hills, Treetop Path, The Boss), which T7 and T8 may
  change. OK?

**Engine 0.16 part B, T7: levels 2 and 3** (details in `games/samples/platformer/CLAUDE.md`,
"The game", "The 2D skin" and "Run files")

- **375.** Level 2 is **Autumn Hills** (one-way planks over pits, walkers and ledge-walkers
  pacing a step and a plank, a checkpoint, a high off-path cache of five coins with a bump block
  holding an extra life) and level 3 is **Starlit Ridge** (spikes, a buffered-jump chain over
  narrow pillars, a multi-coin block, a checkpoint, a coyote jump over a spike field, a tunnel
  coin cache under a spiked roof, gold planks over a spike floor). The names replace "Over the
  Hills" and "Treetop Path". OK?
- **376.** Each level's own look is an engine addition: a skin's `themes` (map id ->
  `{ background?, parallax?, tiles? }`, `themedSkin` in `engine/core/present`), drawn by the
  Canvas2D presenter; the 3D backend ignores it until T10. Level 2 is autumn (orange-topped
  ground, steel planks, a warm sky, violet mountains), level 3 night (rose sand, gold planks,
  stars and a moon); their parallax art is the T6 layers recoloured (`hopper-autumn`,
  `hopper-night`) plus a new star field, not new shapes. OK?
- **377.** The hidden collectables are an off-path coin cache (level 2's high planks, level 3's
  tunnel), a life block and a multi-coin block; there are no bricks (the profile still breaks
  none) and no new enemy kinds, so `pnpm -s cli mutants games/samples/platformer` still exits 4
  for the rules no level uses yet (bricks, shells, mini games, the boss, walls, skids and the
  scroll lock); every run file's own `mutants` exits 0. Should a level get breakable bricks or a
  shell enemy to guard those, or is the platformer lab enough?
- **378.** Four run files, each starting at its stage (`start: { stage }`): `level-2` and
  `level-3` (wins, cleared at ticks 959 and 1010) and `level-2-lost` and `level-3-lost` (two
  respawns on the checkpoint, by pits and by spikes, then the level afresh). OK?

**Engine 0.16 part B, T8: the mini-boss's arena, level-clear and end screen** (details in
`games/samples/platformer/CLAUDE.md`, "The game", "Build choices (T8)", "The 2D skin" and "Run
files")

- **379.** The mini-boss is **Burrlock, the bramble beetle** (original text pixel art): four hit
  points; phase 1 a thorn shot and a wall-to-wall charge, phase 2 (at 2 hp, shorter telegraphs)
  the shot, a leap at the frog and an acorn dropped over it; each attack has its own wind-up.
  Four stomps beat it. Is it the right difficulty for a first boss?
- **380.** The arena, **Burrlock's Hollow**: a runway with the checkpoint, then a step down under
  a hanging wall into a one-screen arena; a death puts the frog back on the runway with the boss
  as it was (its hit points kept). OK, or should a death reset the boss's health?
- **381.** The boss's look: a pose per telegraph, a white silhouette as the hit flash, a red
  palette for phase 2 (which gives every phase-2 telegraph the same roaring pose, since a skin
  look matches one tag), a defeat of eight white flashes, a cracked shell, a blast and the beetle
  sinking on its back; a dusk sky for the arena; a name plate and a health bar top right. OK?
- **382.** The end: the level-clear banner (Coins, Time, Deaths) between levels, and after the
  arena the end screen "Hopper's Way cleared!" with a credit line, the summed stats, Back to
  title and Levels; every death plays an iris on the frog (`transitions.respawn`). OK?
- **383.** Three run files: `boss` (win), `boss-lost` (loss) and `full-game` (stage 0 to the arena
  cleared, the four wins' input on their stages' ticks: the headless equivalent of title to end
  screen; the end screen itself is checked by the browser test). The boss runs were found by a
  small reactive bot whose keys were recorded. OK?

**Engine 0.16 part B, T9: layered music and a sound for every action** (details in
`games/samples/platformer/CLAUDE.md`, "Build choices (T9)" and "Music and sound")

- **384.** The music: one layered song, `hoppers-way`, with a calm and a drive layer per level
  (Meadow in C major, Autumn Hills in A minor, Starlit Ridge in E minor) and the boss's fight and
  rage layers (D minor), all 150 bpm and 16 bars so they stay in step; the level's own layers
  play, the drive layer comes up within 96 px of an enemy, the rage layer joins in Burrlock's
  second phase, and everything fades out at a clear, a game over and the boss's defeat. Its own
  title tune and an end fanfare. All original MML; no CC0 sound pack was fetched. OK, or would you
  rather each level start its own song from the top (needs an engine change: music chosen by status)?
- **385.** Two small engine additions: a mix rule's `when` may be a list of status tests that must
  all hold (a level and its danger), and `game.json`'s `menus.end.music` plays a song when the end
  screen opens. OK?
- **386.** The sounds: 39 original sfx, a jump per tier, footsteps on the run cycle's frames, a
  skid, land, bump, block, a 1-up for the life block, break, coin, stomp, kick, hurt, death, the
  puff, respawn, checkpoint, a telegraph and an attack sound per boss attack, the boss's hit,
  defeat, pops, crack and blast, the clear jingle and the UI moves; most vary in pitch and volume,
  steps and landings rest a few frames. OK?
- **387.** Ducking: a hurt (60%), a death (85%), a boss hit (55%), the boss's defeat and its blast
  (90%) and a stomp (a light 25%) duck the music; the level clear mutes it under the jingle. Too
  much or too little?

**Engine 0.16 part B, T10: the 2.5D view of Hopper's Way** (details in
`games/samples/platformer/CLAUDE.md`, "Build choices (T10)" and "The 2.5D view")

- **388.** The 2.5D view is built from the CC0 GLB packs: Kenney's grass and dirt blocks (three
  tiles deep, a grass-topped block wherever a cell's top is open), crates and the gold cube for
  blocks, platforms for the one-way planks, spikes, the gold coin, a jewel for the goal and a flag
  for the checkpoint; Quaternius' character as the player stand-in (a blue character, not a frog:
  no CC0 3D frog was fetched), `enemy` and `skull` for the two walkers and the `crab`, tinted
  violet and red in phase 2, for Burrlock. Thorns and acorns stay text low-poly meshes. OK, or
  should a 3D frog be found or made?
- **389.** The look: a sun with soft shadows, a hemisphere light and ACES tone mapping per level
  (day, autumn afternoon, moonlit night, dusk in the arena), linear fog from just behind the play
  plane, the 2D parallax art as distant fogged planes, and rows of 3D scenery behind (a grass
  ridge, trees, rocks, flowers, a taller far ridge), placed by a seeded jitter. The camera frames
  exactly what 2D frames, tilted 7 degrees down (fov 32). The picture is drawn at 320x180 and
  scaled up, so the 3D view is pixelated like the 2D one. OK?
- **390.** Engine additions: tweens in 3D (item 340 resolved: scale, offsets, turn, alpha, and a
  colour tween as a white emissive hit flash), per-map `themes` in 3D (with a theme's own
  `scene3d` and `scenery`), a 3D tile `join` that picks another tile entry, `scenery` rows, a tag
  look's own `model`, and a model's `tint`, `stretch` and `clipHold`. OK?
- **391.** The runner's "Hopper" name label and health bar over its head (the 3D skin's T12
  labels) were removed in 3D: the HUD shows the hearts and a name over the hero is clutter in a
  side view (it also showed through the respawn iris). The GOAL label stays. OK?
- **392.** No depth of field: the backend has none, and fog on the background does that job. Add
  a depth-of-field pass later (needs a post-processing pass in the 3D backend)?

**Engine 0.16 part B, T11: close-out** (details in `docs/BUILD-LOG.md`, Engine 0.16 part B)

- **393.** Owner playtest (part B's Done when): please play Hopper's Way from the title through
  the three levels and Burrlock's arena with the keyboard and with a gamepad, in 2D and with
  `?backend=three`, and say whether the movement, the levels and the boss feel good. Open.
- **394.** Owner screenshot review (part B's Done when): the ten 1920x1080 screenshots in
  `docs/reports/screenshots/0.16-B/` (2D play in all three levels and the boss's hit, 2.5D play
  in level 1 and the arena, the title, the level select, the level-clear banner and the end
  screen). Accepted, or what should change? Parts C-F wait for this.
- **395.** Review screenshots are kept as binary PNGs in `docs/reports/screenshots/<release>/`
  (one folder per release; `tests/architecture/no-content.test.ts` and DESIGN.md's binary-files
  sentence now allow it, PNG only, no subfolders). OK?
- **396.** Engine fix found in the screenshots: the end screen's heading ("Hopper's Way
  cleared!") ran over its panel's frame. The level select, level-clear banner and end screen now
  widen their panel so the heading fits with 16 px each side (never wider than the picture less
  8 px); no other game's screens change size. OK?
- **397.** Found in the screenshots: the title font's `W` read as an upside-down `M` ("Hopper's
  May"). It is redrawn with its middle stroke (`content/fonts/hopper-title.txt`). OK?
- **398.** Known and left (2.5D): Burrlock is Quaternius' red crab tinted violet, which under the
  arena's dusk light reads dark maroon in phase 1 rather than the 2D violet (phase 2 reads bright
  red, so the phases still differ), and the 3D arena's ground is olive-green grass where the 2D
  arena's is autumn orange. Fix (recolour the crab's material or give the arena an autumn ground
  tint in 3D), or leave?
- **399.** Known and left (2D and 2.5D): the HUD panel (top left, about 136x36 picture px) covers
  the top two rows of the level, so the frog bumping the life block high in Autumn Hills' cache
  (tick 631) is half behind it. Make the HUD smaller or translucent while the frog is under it,
  move it, or leave it?

**Engine 0.16 part B, finalize: smaller build choices** (T1-T3 and the build process; details in
`docs/BUILD-LOG.md`, Engine 0.16 part B, "Smaller build choices")

- **400.** A checkpoint respawn resets only the player: coins taken stay taken, used blocks and
  broken bricks stay, and actors keep moving (as the old respawn at the start did). With no lives
  left the level fails and restarts from scratch, without the checkpoint. OK?
- **401.** The checkpoint touched last becomes the current one, even an earlier one the player
  walked back to; touching the current one again does nothing. OK?
- **402.** To keep every old hash, the new snapshot fields appear only when used: `checkpoint` only
  in levels with a `K`, `player.coyote` only when the profile's `coyote` is over 0 (as
  `endedRound` does). OK?
- **403.** `jumpCut` is guarded by the existing `variable-jump` rule, not a rule of its own (the
  lab's `feel` run checks it). Should it be a separate rule?
- **404.** Coyote time counts from the tick after the player walks off: `coyote: 6` allows a jump
  up to 6 ticks late, not 7 (pinned by unit tests). OK?
- **405.** `checkLevel` accepts a checkpoint only with a solid or one-way tile right under it; a
  breakable brick counts as solid, though it could be broken later. OK?
- **406.** A boss level clears through a header field (`clear: "boss"`, boss on the map, no goal
  needed; a goal still clears it too), and boss phases are a list of hp thresholds, each with its
  own pattern. OK?
- **407.** A stomp on the boss always bounces the player and gives it a short grace (`kickGrace`,
  15 ticks), so the player is not hurt on the way up; during the boss's hit invulnerability a
  stomp only bounces. OK?
- **408.** Boss projectiles are ordinary actor types (flying or falling) and vanish at a wall, on
  landing or on touching the player; there is no separate spawn event (the boss-attack event names
  the projectile). The only randomness is the drop step's optional spread, from the world's seeded
  rng. OK?
- **409.** The sample's `boss` run guards `boss-hit-invuln` through the invulnerability values it
  checks, not a real double stomp (that is in `boss.test.ts`). Enough?
- **410.** The level-clear banner is declared in `game.json` (`menus.clear`), not a `ui` content
  file, and is painted over the game rather than pushed as a scene (a scene would stop the
  between-level pause), so it takes no input and hides under an open menu. OK?
- **411.** The end screen opens when the page's last level is cleared and sums the stats of the
  levels cleared since the game started or a level was picked. OK?
- **412.** The respawn transition plays only when `transitions.respawn` is set or an event maps to
  it (no fallback to `default`), after the frame with the death sound; a respawn that ends a
  mini-game round is covered by the round's own transition instead. OK?
- **413.** Levels unlock one by one (`menus.levels.lock`, default on), and progress is stored with
  the settings helpers under `ww:<game>:progress`. OK?
- **414.** The browser tests hold the run files' `run` action as X (attack, which also runs),
  because `run` has no key of its own. Should `run` get its own key?
- **415.** Vitest's global test timeout was raised from 5 s to 30 s (`vite.config.ts`): under full
  load, unrelated slow tests failed at random. OK, or set it per slow test?
- **416.** Builders found two finished but uncommitted tasks in the tree (T3 and T7) and committed
  them as their own commits after all checks passed (b829e3e, 2a63285). OK as a rule for future
  builds?
- **417.** The art, skin and boss-input generators (scratch Python and a reactive bot) were not
  committed; the text art, skins and run files they made are now the source. OK, or commit them?
- **418.** A HUD text item with a format is drawn even when its status is missing, so Burrlock's
  name is a sprite icon instead. Should the engine hide such text when the status is missing?

**Engine 0.16 part C, T1: Hopper's Way fixes** (the title's HUD, the 2.5D portrait, fuller levels;
details in `docs/BUILD-LOG.md`, Engine 0.16 part B, "Fixes after review"):

- **419.** The game picture under the title, and under a screen opened from it (settings, controls,
  the level select), is drawn without its HUD; the pause menu and the end screen keep it. The
  screenshot tool hides it for its `title` and `levels` overlays only (its `settings` and
  `controls` could be the pause menu's). OK?
- **420.** The 2.5D HUD's lives portrait is original text art of Quaternius' blue long-eared hero
  (24x15, like the frog's face), not a picture rendered from its model. OK?
- **421.** Level decoration is a new optional platformer-kit level field, `decor` (a `.decor.txt`
  grid the map's size, any printable character but the terrain's `#B?u=^`), presented as the map
  layer `decor` and drawn by a skin's `tiles`; the kit gives it no meaning and it is not in the
  snapshot. It is 2D only: the 2.5D view keeps its scenery rows. OK, or should 3D draw it too?
- **422.** The props are mostly original text art (tufts, flowers, rocks, bushes, trees, crystals,
  stones and fossils in the dirt) in meadow, autumn and night sets, plus five Kenney Pixel
  Platformer props from the pack already in `assets/` (sign, fence, tan mushroom, sprout, pine).
  OK?
- **423.** In 2D a map layer's frame with an `anchor` (a PNG sheet's) stands on its cell's bottom
  centre; text sprites have no anchor, so a larger text prop is written at its top-left cell (a
  tree two rows above its ground). OK, or should text sprites get anchors?
- **424.** The seven new enemies were placed where a headless search found the existing run
  inputs still win and lose as before, so no run steps changed (eight run files re-recorded);
  most are stomped on the hero's existing path. Should the levels instead get enemies that need
  new routes (and new run inputs)?

**Engine 0.16 part C, T2: The Old Crypt's CC0 art pack** (0x72's DungeonTileset II v1.7, fetched
from itch.io; credited in `games/samples/dungeon/assets/CREDITS.md`):

- **425.** The pack was fetched as asked (no substitute), but kept as its one 512 x 512 sheet with
  its tile list (`name x y w h` per frame) and three autotile atlases (65 KB), not as the zip's
  750 per-frame PNGs, since a skin's `images` entry names frames as rectangles of one PNG; the
  sheet also holds characters the game will not use (elves, lizards, wizards). The pack has no
  torches, bats or sounds: torches and bats stay original text art (or come from T4's lighting),
  and the sound stays MML (no CC0 SFX pack was added). OK, or should unused characters be cut
  from the sheet, or a CC0 torch and bat set be found?

**Engine 0.16 part C, T3: The Old Crypt at 16:9 on the CC0 art** (the skin, HUD and menus for the
existing five rooms; details in `games/samples/dungeon/CLAUDE.md`, "16:9 on the CC0 art"):

- **426.** The screen is 320x180 (6x is exactly 1920x1080, as Hopper's Way), not 384x216 with a
  40 px HUD band: the 256x176 room fills the height (2 px above and below) with 32 px dark side
  margins, and the HUD is two framed panels laid over the top wall's corner (hearts and keys) and
  the right margin (the item and its count). The kit's `top` is 0. OK, or the 384x216 band?
- **427.** Monsters from the pack: the bat is the `imp` (the pack has no bat; it rests idling and
  flies with its run cycle), the knight the `orc_warrior`, the rock-spitter a `goblin` whose
  rocks are short arrows. The hero is `knight_m`, which faces only sideways: walking up or down
  keeps his last side. OK, or other pack monsters (skeleton, masked orc, chort)?
- **428.** Pieces the pack has no rectangle for are cut, flipped, turned and pasted from it into
  two text sheets (`crypt-art`, `crypt-floor`, by a scratch generator, not committed): the wall
  joins and corners, doors in side walls (the door's middle turned to face the room), the turned
  blades and arrows, the white hit-flash silhouettes, the statue (the column cut to one tile), the
  crate on the floor and the floor in the top wall's shadow. A few pieces are original in the
  pack's colours: the brazier (the torch, cold and lit with a 4-frame flame), the key, the panel
  frame and the padlock. The pack's PNG itself draws the hero, monsters, chests, bombs, hearts,
  flasks, coins and the skull. OK?
- **429.** The relic is the pack's red-gem sword, the heart container and refill its red flasks,
  the map and compass (unused here) its yellow and blue flasks, the boomerang (unused) its
  throwing axe, the stun stars its spinning coin, the hero's last poof its skull; the explosion
  and the enemies' poof are particles only (no pack frames). OK?
- **430.** Three engine additions for this: a tile's `vary` (floor variety: a frame picked per cell
  by a hash of its place, with weights and a repeat period so a room keeps its look in a slide),
  a `hearts` HUD item's `half` (the status counts halves) and any HUD item's `when` (shown only
  while a status is truthy: the bomb count once an item is owned). The top-down kit's
  `presentWorld` gained an opt-in `idle` (a standing hero is `idle`, so a skin can breathe him).
  None moves a hash. OK?
- **431.** The scene now draws through the page display's presenter (so the settings screen's
  shake and flashing and the HUD hidden under the title reach the dungeon), and the old debug-font
  status lines are gone: the HUD shows hearts, keys and the item, and an end banner in a framed
  panel says how the run ended. The room name and the controls hint are no longer on screen
  (the controls are on the title's Controls screen). OK?
- **432.** The old NES-style text sheets (`hero`, `dungeon` and their palettes) were removed, not
  kept as a fallback; the title's art is now the pack's knight and orc at 3x. OK?
- **433.** No lighting yet (torches do not glow, no darkness or vignette): that is T4. The
  footsteps raise dust but make no sound (the sample has no step sfx). OK, or add a step sound?

**Engine 0.16 part C, T4: 2D lighting and mood in skins** (darkness, lights, flicker, vignette,
room-wide dust; details in `engine/core/fx/CLAUDE.md`, "Lighting", and
`games/samples/dungeon/CLAUDE.md`, "Lighting and mood"):

- **434.** The PixiJS backend (`engine/backends/pixi`, a parallel track) does not draw a skin's
  `lighting` yet: it needs the same pass later (the light map from `SkinLighting.layout`, each
  light erased out of the darkness with `lightStops`, the coloured glows added, the vignette, and
  the placed lights' sprites from `SkinLighting.props`). The 3D backend ignores `lighting` too (it
  lights with `scene3d` and kinds' `light`); a 3D skin with `lighting` is `wrong_backend_field`.
  Schedule the PixiJS pass with the backend's next task?
- **435.** The Old Crypt's rooms have no wall torches in their text (adding `T` torches would move
  the run files' hashes), so the skin places them: `lighting.maps.<room>.lights` are lights at
  fixed places with an optional animated sprite (the original brazier) drawn under the darkness.
  They are decoration: the hero walks in front of them. To keep them through a room slide the
  top-down kit's slide map now lists its two rooms as `parts` (`PresentMapPart`, a new optional
  map field: id, place in tiles, tags), so per-room lights and darkness follow each room; nothing
  in the world or a snapshot changed. OK, or should torches become room content later?
- **436.** The bat hall and the crypt are now `dark: true` (the kit's free room flag, which only
  tags the map `dark`; no hash moved) and take the skin's `tags.dark` darkness (0.86); the other
  rooms 0.55 (the courtyard 0.5). The falloff is in 6 flat bands (`bands`) for a pixel-art look
  rather than a smooth gradient; the vignette is 0.5. Judged moody and readable from screenshots
  at 3x (the guard room's fight stays readable at 0.55); a browser playtest is T10. OK?

**Engine 0.16 part C, T8: The Old Crypt's new wing** (eight rooms, the dash and the path to the boss
door; details in `games/samples/dungeon/CLAUDE.md`, "The dungeon" and "Run files"):

- **437.** The final layout is eight rooms: the five old ones unchanged (the courtyard, guard room,
  store room, bat hall and crypt, so walk-east, escape and lost-in-the-guard-room keep their
  hashes and escape still ends on the crypt's exit), the chasm (the dash), a new **ossuary** south
  of it (a pit band, monsters and a key on a ledge only the dash reaches) and the warden hall,
  now behind the chasm's **locked** east door. So the game has two ways: the bombed wall to the
  relic and the exit, and the dash to the key and the boss door. Keys are counted, not named, so
  either key opens either door. OK, or should the old escape wing become the way on (and the
  crypt's exit go)?
- **438.** `beat-the-warden` was re-recorded (`WW_UPDATE_GOLDEN=1`): the locked boss door means
  its path now goes through the ossuary for the key (1502 ticks instead of 960; the fight's input
  is T6's, 542 ticks later, and every boss check holds at the same offsets). No other hash moved.
  OK, or should T9's win run replace it?
- **439.** Decorations (banners, wall fountains, skulls) are placed lights with a sprite and no
  light (`radius` 1, `intensity` 0) in the skin's `lighting.maps`, the only data place for a
  prop the map has no tile for. OK, or should the engine get a proper per-map `props` list?
- **440.** The HUD's item panel always shows the bomb icon and `ammo.bomb` (0 with the dash): the
  skin's `icon` HUD item has one frame and no per-value frames. Left for T10's polish pass (a
  per-value icon in the UI kit, or two items keyed on a status). OK?

**Engine 0.16 part C, T9: the boss room, the win and loss runs, dialogs and the boss music**
(details in `games/samples/dungeon/CLAUDE.md`, "The Bone Warden (T9)"):

- **441.** The Bone Warden keeps T6's name and the pack's big demon, now a three-phase fight in
  data: 6 hit points; phase 1 a charge and a ring of 8 shots; at 4 hp a spread of 5, a faster
  charge and two summoned bats; at 2 hp a slam, an aimed ring of 12 and the fastest charge;
  every attack after a telegraph naming it. The hall gained two columns and two hearts. Its
  telegraph poses (a crouch before the charge, risen before the slam and summon, burning eyes
  before a shot), a white hit flash and a red-hot last phase are text frames cut from the pack's
  demon by a small generator (`crypt-art.txt`, one colour added to its palette). OK, or harder?
- **442.** `beat-the-warden` is gone: `win` (the whole dungeon from tick 0 to the Warden beaten and
  its flag, 1940 ticks) and `boss-lost` (the hero dies in the fight, 2429 ticks) replace it, both
  found by a scratch search bot (greedy over cloned worlds, not committed) whose held keys went
  into the run files as plain data. `to-the-boss-door` was re-recorded (the hall's new hearts
  are in its last ticks' snapshots). OK?
- **443.** The game now has three ends: the Warden beaten (`flag.bossDefeated`: the victory dialog,
  the `warden-falls` tune and the end screen "The Warden is at rest"), the old escape with the
  relic (its dialog now says the Warden still stirs) and a fall. OK, or should the escape go?
- **444.** The hero is named: Sir Edrin, last knight of the hill watch, going down to put the Bone
  Warden to rest because it wakes the dead each night. Intro of three pages. OK?
- **445.** Engine addition: an end trigger may give its own `music` (`menus.triggers.end[].music`,
  played when that ending opens and kept under the end screen; else `menus.end.music`), so the
  victory tune never plays after a fall. OK?
- **446.** Engine addition: a HUD `icon`'s `frames` (a frame per status value, else `frame`), so the
  item panel shows the dash (the pack's green flask, as its pickup) or the bomb; the bomb count
  shows only with bombs. Closes item 440. OK?
- **447.** Room music from data: the scene plays a room's `music` (else `crypt`); the warden
  hall's is the skin's layered `warden` (calm, fight and rage layers, 132 bpm, 8 bars, mixed
  from the frame's `bossHp`/`bossPhase`/`flag.bossDefeated`, ducking under hits, the slam, the
  phase change, the defeat and dialogs). The page now plays music through the shell's mixer. OK?

**Engine 0.16 part C, T10: combat feel and polish pass, browser play test**
(details in `games/samples/dungeon/CLAUDE.md`, "Combat feel and polish (T10)"):

- **448.** Combat feel in the skin: hits throw white-gold sparks and knockback dust and hold the
  game 3 ticks; kills release blue soul wisps and bone bits with a 4-tick hit-pause and a shake;
  the hero's hurt adds dust to its sparks; the sword leaves a short white trail; chests and
  pickups got rays and a ring. The enemies' and the boss's white flashes and the shakes on
  blasts, slams and boss hits are kept from T3 and T9. Strong enough, or more?
- **449.** The dash leaves pale steel afterimages of the knight (two text frames added to
  `crypt-art.txt`, facing right and left, keyed on the dash event's `dir`). OK?
- **450.** Engine addition: a placed light may `emit` (an emitter at its centre while its map
  shows, each slide part at its place), so every brazier, and the warden hall's four torches,
  throw embers. OK?
- **451.** Engine addition: `game.json` `transitions.level: false` (no transition on a map id
  change even with a `default`), so the dungeon keeps the kit's room slide, with a brief dip to
  dark (the skin's `room` flash, skipped with reduced flashing), Start and Back to title fade
  through the dark (`default`) and the fall fades to dark red (`dead` -> `respawn`). Should the
  room change use the part A wipe instead of the slide?
- **452.** A danger layer over the dungeon theme: the skin's layered `crypt` (the old `crypt` song
  plus `crypt-danger`, a tense pedal and drums), the danger in while `enemies` (a new kit status:
  the living enemies in the room, presentation only) is at least 1. OK?
- **453.** Every action has a sound, most with pitch variation: new `shutters`, `secret`, `dead`
  and `push` sfx; stun, block, beam, whirr, switch, torch and item-select reuse others at other
  pitches. OK?
- **454.** The item panel moved from the top-right to the bottom-right corner of the right margin:
  the page's volume control and pause button covered it. OK?

**Engine 0.16 part C, T11: close-out** (details in `docs/BUILD-LOG.md`, Engine 0.16 part C):

- **455.** Owner playtest (part C's Done when): please play The Old Crypt
  (`pnpm dev`, then `/games/samples/dungeon/`) from the title through the intro, the dash, the
  ossuary's key and the locked door to the Bone Warden's defeat and the end screen, with keyboard
  and, if you have one, a gamepad. Does it feel good to play (the dash, the fight, the lighting,
  the sound)? Accepted, or what should change?
- **456.** Owner screenshot review (part C's Done when): the ten 1920x1080 screenshots in
  `docs/reports/screenshots/0.16-C/` (title, intro dialog, the lit crypt, a hurt in the guard
  room, the dash, the key and the locked door, the Warden's telegraph and a hit, the victory
  dialog and the end screen), listed with their commands in the build log. Accepted?
- **457.** The HUD's item panel (bottom right) now shows only once an item is owned (`when:
"item"`): before, it was an empty frame from the start and its edge peeked out past the intro
  dialog's corner. OK?
- **458.** Once an item is owned, the item panel's right edge and bottom still show past a dialog
  box's lower-right corner (the victory dialog, screenshot 09): the box spans the picture less a
  margin and the panel sits in that margin. Options: (a) leave it; (b) hide the HUD while a shell
  dialog shows (an engine change, every game); (c) a narrower dialog box for this game (a new
  `menus.dialogs` field). Which?
- **459.** The dash (T5): default tuning 8 ticks, 48 px, cooldown 24 and 6 ticks of guard after
  it, the hero unhurtable while dashing, the pit tile `^`, and `hero.dash` in the snapshot only
  once the dash is owned, so no older run's hash moved. OK?
- **460.** The boss (T6): declared in a room's `boss` field (pattern steps, phases by hp, a
  defeat flag), with `shutters: "boss"` to seal the room; where hits, kills and boss events
  happened is kept beside the event for presenters (a `WeakMap`), never in the snapshot, so the
  feel events moved no hash. OK?
- **461.** Dialogs (T7) are a shell feature in `game.json` that holds the game's ticks while a box
  shows; with `?debug=step` or `?record` they are skipped (the old end banner shows), so every run
  file replays through the page unchanged. OK, or should the step hook show them too?
- **462.** The end screen's "Rooms seen" shows the rooms entered (4 on the win's route, of 8)
  without the total. OK, or show `4/8`?
- **463.** Pits only block: falling in is not modelled. A dash stopped over a pit puts the hero
  back where the dash started, and `TopDownBot` was not taught to dash (its pathing treats pits as
  walls). OK, or should pits be a fall (a hurt and a respawn)?
- **464.** An end trigger's `when` reuses the music mixer's status test (`mixWhenSchema`,
  `mixWhenHolds` in `engine/core/audio/mix.ts`), so the UI kit now imports that pure audio file
  (noted in its `CLAUDE.md`). OK, or move the test to a shared module?
- **465.** Tests loosened for the darkness: the dungeon page's side-margin pixel has a new expected
  colour and its wall ledge is checked by colour range, the fx-lab torch-pole tolerance went from
  24 to 64, and the walk-east browser test steps 16 ticks so the room dip fades first. OK?
- **466.** The boss takes no boomerang stun and drops no loot, its minions and shots vanish when its
  defeat starts, and it is not pushed by default (`knockResist` 1; a push stops a charge). OK?
- **467.** The hero's death is a dark-red fade, not an iris (he is already gone from the frame), and
  the skin's fallback colour for a missing frame is now `#ff00ff` (was `#f878f8`). OK?

**Engine 0.16 part A2: the PixiJS backend** (T13b-1 to T13b-9, built on the track branch
`engine/0.16-track2` and merged into `engine/build-0.15` in Engine 0.16 part D, D1; details in
`docs/BUILD-LOG.md`, Engine 0.16 part A2 and part A's T13b section). The track's build decisions
had their own labels there and its owner questions were numbered 419-422, which part C had used
meanwhile; the merge renumbered them 468-484 and 485-488.

- **468.** `pixi.js` is pinned at 8.22.0, the newest stable release, published 2026-10-01.
- **469.** Glow is a pre-made soft halo texture, tinted and stretched behind each glowing box,
  sprite or line, instead of a PixiJS filter (one sprite in the same batch, no extra pass). It
  is an oval over the shape's box, not its outline, so it is softer than Canvas2D's glow on
  large sprites.
- **470.** The shared drawing code went into a new folder, `engine/core/draw`, not into
  `engine/core/present`, because kits import `present` and the drawing code must be blocked
  for kits and the sim. It is on `PURE_CORE` and has its own agent docs.
- **471.** In the core the map and glyph surfaces default to none (redrawn every frame);
  Canvas2D's wrappers default them to an offscreen canvas, so Canvas2D behaves exactly as
  before. Canvas2D's exported names are unchanged.
- **472.** A new optional core option, `tintGlyphs`, lets PixiJS draw HUD glyphs once in white
  and tint them. Off, Canvas2D is unchanged.
- **473.** `pixiDisplay` asks for WebGL only (`preference: ['webgl']`, not `'webgl'`, which
  would fall back to WebGPU or canvas) and allows software WebGL (SwiftShader), as the 3D view
  does.
- **474.** When PixiJS cannot start, Canvas2D runs on a fresh copy of the canvas. A page that
  asks for a backend the game does not have runs Canvas2D. `backendFromQuery` gained an
  optional `fallback`.
- **475.** The dungeon page now draws through the display's presenter (so it works on any 2D
  backend) and plays the skin's sounds through the display; its view and tests keep their own
  Canvas2D presenter, so screenshots and hashes are unchanged.
- **476.** PixiJS screenshots always use software WebGL (SwiftShader), even on a machine with a
  GPU, so PNGs and the parity test repeat exactly.
- **477.** Parity tolerance: threshold 8 and at most 0.1% of pixels where nothing glows (RTS,
  TD, the fx lab's top half); threshold 32 and at most 1% for the whole fx lab. The iris is not
  compared, because the screenshot page's Canvas2D tile closes it on the picture's centre.
- **478.** `pixiDisplay` lets the page do the whole-number upscale by default
  (`upscale: 'page'`, `image-rendering: pixelated`), the largest saving on software GL. The
  picture can sit up to s-1 device pixels from where Canvas2D puts it; `upscale: 'gl'` keeps
  the old path.
- **479.** Tuning changed how the display list is built: a top-level opaque `clear` becomes the
  GL clear colour, `alpha` and `blend` scopes are set on each object instead of making
  containers, and the renderer culls off-picture objects (with the glow radius as margin).
- **480.** `engine/core/fx` was made allocation-free (`lerpColor` keeps a cache of up to 1024
  parsed colours; `keyframeAt` reads in place). Output is the same on every backend.
- **481.** To let the bench reach the game's presenter, `PixiDisplayOptions` gained `seed` and
  `maxParticles`, and `pixiDisplay` returns `PixiDisplay` (a `BrowserDisplay` plus `main`).
- **482.** The RTS, tower-defense and menus browser tests now run on the PixiJS default
  instead of being pinned to Canvas2D, so they check pointer input through the PixiJS display.
- **483.** Old map `RenderTexture`s are not destroyed when a new map version arrives (the core
  gives no signal); noted in the backend's `CLAUDE.md`.
- **484.** The BUILD-LOG summary line "the last number used is 363" was already out of date
  and was left for the feedback-numbering owner. The track's owner questions (419-422 on the
  track, which part C had used meanwhile) are 485-488; the orchestrator copied them and these
  decisions (468-484) into FEEDBACK-LOG.md at the merge (Engine 0.16 part D, D1).

Owner questions of the PixiJS close-out (T13b-9; 419-422 on the track):

- **485.** PixiJS is the default 2D backend for the RTS skirmish and the tower defense (Canvas2D
  the fallback without WebGL), although on this container's software GL it does not hold 16.7 ms
  p95 with every feature on; its draw call does, and T13b-7 estimates a GPU makes the rest
  small. Keep it the default until someone measures frame times on a machine with a GPU
  (`pnpm bench:features`), or go back to Canvas2D by default until then?
- **486.** Hopper's Way (`games/samples/platformer`) is not wired to PixiJS (another track owns it
  in part B); every other 2D page is, opt-in by `?backend=pixi`. Wire Hopper's Way after part B,
  and should any other page default to PixiJS?
- **487.** The parity tolerance: threshold 8 and 0.1% of the pixels for pictures without glow or
  additive blending (RTS, tower defense: equal to the bit here), threshold 32 and 1% where glow
  shows (the fx lab), glow drawn as a halo sprite in PixiJS against `shadowBlur` on the canvas
  (the coins' and the door's halo differ a little, as the parity sheet shows), the iris not
  compared. OK?
- **488.** `pnpm cli sheet` tiles may name a run file of another folder by a path relative to the
  positional run file's folder (`../../samples/rts-skirmish/runs/battle/141`), added so the
  parity sheet tiles three games. OK?

**Engine 0.16 part D, D2: the 0.15 skirmish kept as `games/rts-classic`**

- **489.** Before the RTS sample becomes the full ten-minute match (D8), its 0.15 battle (the
  map, the raiders' plan, text art, skin, sounds, title and menus, the page and the five run
  files `battle`, `commands`, `hold`, `economy`, `lost`) was **copied** to a new test game,
  `games/rts-classic` (id `rts-classic`, its own page in the games index, `CLAUDE.md`,
  `AGENTS.md` and module page), with every golden hash unchanged (only each `.hashes.json`'s
  `run` path differs). Unlike part B's `git mv`, the sample folder stays as it was until D8
  replaces it, so both play meanwhile. The tests that guard the 0.15 battle point at the copy:
  `tests/runs/rts-classic-mutants.test.ts` (no unguarded rule, no weak run), backend parity and
  presentation invariance list it, the PixiJS parity test's RTS case and the parity sheet's RTS
  tile path (`../../rts-classic/runs/battle/141`) and `world-data.test.ts`'s events use it. The
  alternative was to keep both maps in one game (the sample with a second map and the old run
  files beside the match's), which keeps one folder but ties the old hashes to every change of
  the match's glue, skin and end rule. OK to keep it as its own test game?

**Engine 0.16 part D, D9: the ten-minute win and loss, balance and feel**

- **490.** Balance, in data only: the AI keeps up to 16 soldiers and 8 archers (6 and 3 before),
  defends with up to 6 (3), and sends three one-shot waves of growing size from 1800, 3000 and
  4200 ticks (5+2, 8+3, 10+4 at most; before: 4+2 every 1500 from 1800) and everything it has
  every 100 ticks from 5400 (4800). The town centre has 1600 hp (800: eight soldiers razed it in
  30 ticks, so a careless rush won) and the gold nodes hold 1000 at home and 2400 on the far node
  (800 and 1200: both sides ran dry by tick 4500). It moved every rts-skirmish hash; the four
  guard runs' assertions held. OK, or tune toward a harder AI?
- **491.** The town centre now costs 300 gold (it cost nothing, so the bar's Build town-centre
  put one up for free). OK?
- **492.** The win and loss were recorded by a throwaway headless bot, not kept: the win is a
  tidy player (nine workers, two barracks, the army held at a rally point and fighting what comes
  within 14 cells, crossing at 5700) whose army grows to about 56 and loses little; the loss is a
  careless one (six workers, a late barracks, eight soldiers thrown at blue's town centre at
  4600, the hero wandering off). A human will have a closer match. Keep the bot as a tool (like
  the kits' round bots) or leave it out as now?
- **493.** The two matches hash every 100 ticks (the guard runs every 20) and open with interface
  actions that fail every kit rule by tick 2 (a drag over the enemy's sentry that selects nothing,
  a command on it with the hero), so `mutants` plays them whole only once each. The win keeps one
  refused order (a barracks it could not yet pay for at tick 110). OK?
- **494.** The presentation tests (drawing every tick, fog on and off, backend parity, the
  stepped shell, presentation invariance) play runs of 5000 ticks or more only for their first
  600 ticks, against their golden hashes up to there; the run-file tests and `mutants` play them
  whole. OK, or draw them whole at the cost of minutes per test?
- **495.** For speed, with no hash moved: `World.peek()` (the snapshot without copies, read by the
  RTS kit's view), the kit's `readWorld` parsing each frozen component value once, the attack
  system reading its candidate targets once a tick, and `pnpm cli run` snapshotting only on the
  ticks it reads. A ten-minute match runs in about 9 s headless (about 35 s before). OK?
- **496.** The skirmish page in manual-loop mode (`?debug=step`) plays one game tick per loop step
  (6 in real time) and reports its game to the step hook, so `__ww.replay` replays a run file tick
  for tick and `__ww.hash()` is the run's. The browser test's opening now steps one tick a step.
  OK?
- **497.** `SkirmishGame.recorded()` puts every interface action handed to `order` back in its
  place, and the page exports that, so a replay of a run with `ui` entries exports as itself (the
  selection is in the snapshot, so the plain orders alone hashed differently). OK?
- **498.** The danger layer: `ford-danger` (an original G minor sixteenth ostinato, pedal bass and
  busier drums, the calm song's tempo and length), up (calm at 0.6) within 20 frames while a
  seen enemy is 8 cells or fewer from one of the player's buildings (`enemyNear`), down over 90
  frames. OK, or another distance or mix?
- **499.** Sounds: every event has one (new `crumble` for a building down on either side, `alarm`
  for the player's building hit, at most every 45 frames, and `clash` pitched down for hitting an
  enemy building); hits and barks vary by -2 to 2 semitones (barks also in volume), coins by 0 to
  2; the music ducks under the ends' jingles and the player's building falling. The enemy's
  training and building stay silent. OK?
- **500.** The HUD: a selected-unit panel at the bottom left (name, health bar and number, a
  building's training and its progress) when one thing is selected; the own-units counter is the
  population (no cap, as the kit has none). OK, or a population cap as a rule?
- **501.** The camera's feel: an 8 px edge band (32 CSS px at 1920x1080) scrolling 6 px a step
  (the map's width in about 3 s), and 400 px of wheel per halving or doubling of the zoom (0.5 to
  2). Tuned from reasoning and the CLI's 4x screenshots, not yet from a playtest. OK?
- **502.** PixiJS parity on match frames: `match-won` at 1920 and 1940 (the first wave on red's
  ground) on both 2D backends, strict bound; it adds about 2-3 minutes to the browser tests here.
  The Canvas2D fallback stays checked by `pixi-pages.test.ts`. OK, or a cheaper earlier frame?
- **503.** The 1920x1080 screenshot tuning of the HUD was done on the CLI's 4x pictures (the view's
  camera on the map's centre, no selection), so the selected-unit panel's place was set by its
  numbers and not yet seen on a page shot; D10's screenshots are where to review it.

**Engine 0.16 part D, D10: close-out** (details in `docs/BUILD-LOG.md`, Engine 0.16 part D):

- **504.** Owner playtest (part D's Done when): please play The River Ford (`pnpm dev`, then
  `/games/samples/rts-skirmish/`) from the title to a win and to a loss, with a mouse (and, if you
  can, touch): gather, build barracks, train soldiers and archers, hold off the AI's three waves
  (from about 3, 5 and 7 minutes) and its push (9), and take blue's town centre across a ford.
  Does a match take about ten minutes and feel good (the fog, the minimap, markers and barks, the
  zoom, the music's danger layer)? Accepted, or what should change?
- **505.** Owner screenshot review (part D's Done when): the ten 1920x1080 screenshots in
  `docs/reports/screenshots/0.16-D/` (title, orders and a bark, a barracks going up, fog and the
  minimap, an attack's marker and path, the AI's wave from the centre ford, the defence at home,
  a fight zoomed out, victory, defeat), listed with their commands in the build log. Accepted?
- **506.** For the screenshots the skirmish's view (`view.ts`, used only by `pnpm cli screenshot`,
  `sheet` and the tests) changed, presentation only and no hash moved: it draws the run's own
  selection (`ui.selection`: rings, path dots, the selected-unit panel), gives an accepted
  interface command its order marker and bark, draws the HUD's text (its fonts were missing, so
  the bark line and the panel's words never showed in a CLI picture) and its camera is a
  director's: it frames the fight (units with a target where one side is red), else the selected
  units, else all red's units, zoomed out to fit (1 down to 0.5). Before, the camera sat on the
  map's centre, which shows neither base. OK, or should a run file name the camera (an engine
  change to the run-file schema)?
- **507.** The victory banner's second line still reads "THE RAIDERS ARE BEATEN" (the 0.15
  battle's words; the banner is a 160x48 text sprite, `banner-won`), though the match is now
  against a base across the river (screenshot 09; the page's end screen says "Victory: the far
  bank is yours"). Options: (a) redraw the line as "THE FAR BANK IS YOURS"; (b) leave it.
  Recommended (a), a small text-art change with no hash moved. Which?
- **508.** Under red's fog the AI's waves are never seen in the river: red has no sight of the
  fords, so a wave first shows on the road west of the centre ford, a few cells from red's base
  (screenshot 06, wave 3 at 4270 in `match-lost`), and the match-won player meets every wave at
  home. Options: (a) leave it (scouting is the player's job); (b) a sight post at each ford on
  red's bank (map data); (c) a longer sight for archers. Which?
- **509.** D3 (engine): fog of war is a frame field (`fog`, string rows of 0 unexplored, 1
  explored, 2 seen, one cell per map tile) drawn by the shared 2D walk over the map, entities and
  lighting and under the HUD, alike on Canvas2D and PixiJS, with the skin's `fog` look (colours,
  alpha, soft edge); the UI kit's minimap shows the fog, team-coloured dots and the camera's box,
  and `minimapPointToWorld` maps a tap back to the world. OK?
- **510.** D4 (engine): readability as three skin kind fields, all off by default: `outline` (a
  colour or "team"), `team` (a tag prefix picks a colour that replaces a hue range or mask colour,
  or tints) and `screenScale` (the drawn scale held in min..max whatever the zoom: the skirmish's
  health, progress and train bars stay the same size at every zoom, markers and path dots never
  shrink below one picture px per sprite px); recoloured sheets are made once per sheet and
  colour. Units themselves scale with the zoom. OK, or should units also keep a minimum size?
- **511.** D5 (kit): fog is presentation and AI knowledge only: a unit's sight from its `sight`,
  else its type's, else 4; a building's from its type's optional `sight`, else its size plus 2;
  explored cells and last-seen buildings kept per frame stream (never hashed); enemy units shown
  only on cells seen now, enemy buildings and gold as last seen. Feedback: an accepted order's
  marker (8 ticks, fading) and bark (an event and a HUD line for 15 ticks), path dots only for
  selected own units, a train bar under a training building. OK?
- **512.** D6 (kit): the AI's memory (explored cells, buildings as last seen) is in the kit's
  snapshot only for a plan that keeps one, so every older hash stayed; the end rule is data
  (`rts-end`), `lost` checked first, so both town centres falling on one tick is a loss. OK?
- **513.** D7: Kenney's Medieval RTS (CC0) fetched from its OpenGameArt mirror; only four files
  kept; the river, banks, roads and plaza pieces made for 16 px cells by
  `tools/ford-tiles.ts` from the pack's sheet (checked byte for byte); blue keeps the pack's own
  blue units, red its red ones, both with team colours and outlines; text sprites only where the
  pack has nothing (rings, bars, markers, banners). OK?
- **514.** D8: the map is 64x40, point-symmetric, with three fords; the sample's 0.15 run files
  were removed (they live, unchanged, in `games/rts-classic`) and four short guard runs
  (`opening`, `ai-barracks`, `fog`, `razed`) guard all six kit rules. OK?
- **515.** Looks found in the screenshots and left: the gold counter is hidden once red's town
  centre (its stockpile) is gone (10); a held army stands in one overlapping blob (07); the
  selected town centre stays in the panel the whole match because the matches' runs select it at
  tick 1 (the page's player changes selection); and the player's finished building flashes the
  whole picture white for 2 ticks (the skin's `building-done:side=own` `flash`, `#fcfcfc`; the
  shell's "flashing" setting reduces flashes): (a) leave all; (b) soften the flash (a lower
  alpha or a warm tint) and leave the rest. Recommended (b).

**Engine 0.16 part D: build decisions of D1-D8 not yet numbered** (recorded at part D's
finalize pass; details in `docs/BUILD-LOG.md`, Engine 0.16 part D and part A2's merge notes):

- **516.** D1, the merge: part C's lighting, `showHud` and anchored layer frames now live in the
  shared core `SkinnedPresenter` (Canvas2D passes its canvas as `lightSurface`, so its pictures
  are unchanged), and PixiJS draws the lighting too (`PixiRenderer.gradient`,
  `PixiSurfaces.makeLive`), which the fx-lab parity and PixiJS screenshot tests needed. This
  delivers item 434's PixiJS lighting pass, outside part D's scope. Item 434 is left open: OK to
  close it as done?
- **517.** D1: one `vary` field serves part C's 2D tile variety (`frames`, `weights`, `period`)
  and part F's 3D model-tile variety (`turn`, `height`, `tint`); the shape not of the skin's
  backend is `wrong_backend_field`. Likewise a HUD `when` may be a status key (part C) or a
  status test (part F). OK, or split them into two named fields?
- **518.** D1: in the 3D scene a skin with both `themes` and a `timeOfDay` uses the time of day
  (no skin has both yet); without a time of day a theme also sets exposure and clear colour. OK?
- **519.** D2: the copied `games/rts-classic` keeps the sample's content ids (`skirmish`, `ford`,
  `raiders`) and glue names (`loadSkirmish`, `SkirmishPlay`, `window.wwSkirmish`) and PixiJS as
  its default backend; it has no browser test of its own (covered by the pages, pixi-pages and
  in-folder play tests). OK, or rename its glue as part B did?
- **520.** D6/D8: `tests/runs/rts-classic-mutants.test.ts` accepts one unguarded rule,
  `enemy-knows-only-what-it-saw`: the 0.15 raiders know everything, so no rts-classic run can
  guard it without changing frozen hashes (the sample's `fog` and `ai-barracks` runs and
  `rts-ai.test.ts` guard it). OK?
- **521.** D3: fog cells are plain string rows (no run-length encoding), about 4 KB per frame on a
  64x64 map; a skin without a `fog` look uses black (opaque unexplored, half explored, no edge);
  the soft edge is one step of plain fills (no gradient) so both backends match; fog is drawn
  after the lighting, so it hides lights too. OK?
- **522.** D3: the minimap's camera box is the box actually framed (clamped, no shake), named
  `view`; `teams` only recolours dots a `dots` entry already matches. OK?
- **523.** D4: team recolours and outlines need pixel access through a `recolor` presenter option
  (default `canvasRecolor`, in `engine/core/assets`); without a DOM (Node, headless sheets)
  sprites draw with neither, plain boxes still get both. Outlines are 4-neighbour, one picture
  pixel at any zoom; mask colours match exact RGB; the hue mode skips greys. OK?
- **524.** D4: the backend parity test is strict at zoom 1 and 2 only; at 0.5 the two backends
  pick different pixels when halving a sprite (Canvas2D from the pixel corner, the GPU from the
  texel centre), so it checks only the zoom-stable bar's size there. Not checked against an older
  commit. OK?
- **525.** D5: sight is `dx*dx + dy*dy < (sight+1)^2` to the nearest footprint cell, a unit's
  default 4 and a building's `max(w, h) + 2`; under fog the HUD's enemy counts and selection read
  only what is seen now, while `keyStatus` and mission markers read the whole view (the game's
  own knowledge). OK?
- **526.** D5/D8: the training queue is a `queue:<n>` tag on the train bar (no new kind, so no
  skin needs new art), the bar only on the player's own buildings; the optional rally or target
  line was not built. Other sides' placed events are heard only on cells seen now
  (`heardEvents`, D8). OK?
- **527.** D6: the AI keeps a memory (and `kit.seen` in the snapshot) for a plan with
  `knowledge: "fog"` or any `scout` step (the task said fog only; scouting needs explored
  cells). Under fog it never attacks a building it only remembers, it walks to it to look;
  resource nodes are never hidden from it; a scout target may be unreachable (the unit idles and
  retries). OK?
- **528.** D6 review (after D10): with a side's knowledge, an "enemy has at most N" end condition
  holds only once that side has seen an enemy thing of that type (`RtsKnowledge.hasSeen`), so an
  unscouted base never reads as a win. No hash moved. OK?
- **529.** D7: map cells stay 16 px and the pack's units (about 16x24) and buildings are drawn at
  the pack's size, a building up to 6 px past its footprint. The cut tile sheet `ford-tiles.png`
  is a derived binary in the pack folder, made by `tools/ford-tiles.ts` and checked byte for
  byte; the atlas is kept as text. OK?
- **530.** D8: two AI plan steps beyond the task text: `defend` (attack seen red units only with
  at least 2 idle soldiers, so the lone scout does not chase) and `rally` (idle soldiers go home
  once red's base is known, so the scout does not camp at red's town centre). Blue builds up to
  two barracks. OK?
- **531.** D8: the minimap is 128x80 at 348,186 so the whole 64x40 map fits at scale 2 and every
  cell is clickable (the old 82x50 box left most of the map unclickable). OK?
- **532.** D10: the roadmap's "expand" is gathering at the far gold node; neither the AI nor the
  bots ever build a second town centre. OK, or should the AI expand with a second town centre?

**Engine 0.16 part F: the mini siege in 3D low-poly** (F1-F10, built on the track branch
`engine/0.16-track2`; F1-F7 merged into `engine/build-0.15` in part D, D1, and F8-F10 with the
review fixes in part E, E1; details in `docs/BUILD-LOG.md`, Engine 0.16 part F). Labelled `F-1`
to `F-22` on the track; the merge numbered them 533-554 (`F-n` is item 532+n).

- **533.** The mini siege's picture is 320x180 (16:9; 256x240 before), so six times is
  1920x1080; the Canvas2D skins and the tests' sizes moved with it (F6).
- **534.** The people and the sheep come from Quaternius Ultimate Animated Character Pack and
  Farm Animals (CC0), not named by the roadmap, with `Defeat` as the death clip (the pack has no
  death) and `Punch` as the attack; the Quaternius village pack is the 2020 OBJ "Medieval Village
  Pack", not the newer textured MegaKit (the model check refuses textures in other files); FBX
  and OBJ converted to GLB, the Castle Kit's colour map baked into vertex colours (F1).
- **535.** The 3D packs are about 8.7 MB of GLB in the game's `assets/`, all 221 files kept
  (F1).
- **536.** The ground view's camera maths is one core function shared by drawing and picking
  (`groundProjection`); side-view skins are unchanged (F2).
- **537.** Decor is presentation: drawn from the presentation RNG, never in the sim, so a decor
  grid can change without moving a hash (F3).
- **538.** The world clock: 60 ticks an hour, the siege from day 2, 14:00, the dawn day 3, 05:30,
  the ridge day 3, 10:00; the sabotage's 120 ticks read as two hours (F4).
- **539.** A mission's `text` (the card's description) is presentation only, never stored, so no
  save code moved (F5).
- **540.** The hosted rounds are drawn in 2D on a layer over the 3D picture (the shell's
  `roundLayerDisplay`, the game's 2D backend) with an iris, not with 3D round skins; F6's 3D
  round skins were removed (F8).
- **541.** Parts C and E are not on this branch: the rounds were brought to their bar with the
  0x72 DungeonTileset II and Kenney Tower Defense packs; re-point them at C and E's skins when
  those merge (F8).
- **542.** The ground camera: pitch 60, yaw -8, fov 35, zoom 0.42 (the whole village, river and
  camp in view), render scale 6 (F6).
- **543.** Health and progress bars are world labels, not 3D meshes (F6).
- **544.** The 3D page is the default; 2D only where WebGL 2 is missing or by the query (F7).
- **545.** The HUD is the UI kit's in a new 3x5 pixel font (`siege-tiny`), not the mockup's
  serif (F7).
- **546.** The 3D page has no text box: a save code goes in the link, `?code=<code>` (gap M42;
  F9).
- **547.** The title hides the HUD and the world labels; labels that would cover a HUD panel
  are left out (gap M40; F9).
- **548.** The page's controls move to the bottom-right corner over a centred screen and the
  title (gap M41; F9), but not over the rounds (outstanding above).
- **549.** A skirt of grass is laid past the map's edges (`scene3d.skirt`), and the night keys
  of the time of day were lightened so the dawn's start reads (gaps M43, M44; F9).
- **550.** M45 (labels cut at the picture's edge) is left open for the owner's review (F9).
- **551.** The F10 screenshots were taken with a scratch script on `tests/browser/serve.ts` and
  the page's hooks, not a committed tool; the page test's `WW_SHOTS_DIR` shoots the same screens
  at 640x520.
- **552.** Review screenshots may be committed as PNGs in `docs/reports/screenshots/<part>/`
  (4.3 MB for these ten); `no-content.test.ts` and DESIGN.md allow that folder. OK, or keep
  them out of git?
- **553 (owner review).** Playtest the mini siege in 3D from the title through the dawn, and
  review the ten screenshots and the mockup comparison above: accept, or list what to change.
- **554.** The page's 3D camera is the skin's pitch 60 (the whole map in view, flatter than the
  mockup); the mockup comparison (`10-siege-mockup-angle.png`) was shot at pitch 42 through a
  scratch override. Keep pitch 60 for play, or lower the page's camera to the mockup's angle
  (`three.json`'s `camera3d.pitch`, with the zoom brought closer)?

**Engine 0.16 part F: smaller build choices of F1-F10** (track 2, after its `T2-17`, item 484).
Labelled `T2-18` to `T2-42` on the track; the merge numbered them 555-579 (`T2-n` is item 537+n).

- **555.** Google Drive refused the pack downloads (quota) and poly.pizza is behind Cloudflare,
  so every pack came from OpenGameArt mirrors; no pack was left out.
- **556.** The OBJ, FBX and colour-map conversions to GLB were done by scratch scripts that are
  not in the repo (a prebuilt FBX2glTF was blocked); `assets/CREDITS.md` describes each change.
  Re-converting a pack needs those scripts rewritten.
- **557.** Characters: `knight-male` soldiers, `knight-golden-male` Captain Hale, `viking-male`
  raiders and guards, `worker-male` workers; `Soldier_Male` dropped (looks modern). Quaternius
  files renamed lower-case with hyphens; Kenney names kept. The windmill's sails are part of its
  one mesh and do not turn.
- **558.** Ground view conventions (engine): zoom is camera distance (straight down shows
  height/zoom world px, as in 2D); yaw 0 looks north; pitch is degrees below the horizon (10 to
  90); a mesh part's `at.z` is the height of its bottom and `d` its height.
- **559.** In ground view the map clamp is done by `RtsCamera` (the picture's four ground
  corners kept inside the map), not by the scene's follower; a game that follows an entity in
  ground view without `RtsCamera` is not clamped.
- **560.** Clicks and box select pick the ground cell under the pointer, not the upright unit
  body drawn above it.
- **561.** 2D particles have no height, so in ground view they sit on the ground 8 px up (a
  burst spreads over the ground, a rising flame drifts north).
- **562.** Decor is a new engine content kind `decor` (text rows) with its legend in the skin.
  The RTS kit gives every map the id `rts`, so a decor entry names its map with `map`.
- **563.** Per-cell tile variation is opt-in (a tile's `vary`), so no existing picture moved;
  its stream is `fxRng(seed, 0, ...)` (frame fixed at 0).
- **564.** Render scale is a whole number 1-8 so pixel fonts stay sharp; the CLI's new
  `--render-scale` is separate from `--scale` (a nearest-neighbour upscale on top). The page's
  render scale is the skin's 6, capped to the window; `?scale=<n>` overrides it.
- **565.** A clock is allowed on scenario entries only; the game puts it on frames through a
  new `hostedSource` `status(world)` option, so no RTS kit rule changed. The day's parts start at
  5, 7, 12, 15, 18 and 21 o'clock.
- **566.** Time of day: the sky is one colour per key, not a gradient; a clock jump of more
  than half an hour eases over 45 display frames (through the night for an overnight gap). The
  optional Canvas2D/PixiJS evening tint was not done: the 2D page does not darken.
- **567.** On the mission card, choosing Play or Delegate on an offer (or picking one of several
  offers) launches it at once; there is no cancel. A small "mission result" card follows each
  mission while the world keeps running.
- **568.** The results' change lists (`worldChanges`) count a named death both as a loss and a
  fate change and leave out scenario, carry and load changes; the card's hero and foes read only
  the rooms' selector params (fortify's card shows none).
- **569.** The scenery (decor) cannot change paths, so it is kept off the roads, every starting
  cell and the battle rows; the castle ring is open to the east. `three.test.ts` checks this.
- **570.** Engine features added that the tasks did not list: model recolour and tint, tag
  looks that swap the model, decor stack, light and emit, `hitFlash`, HUD items shown by a
  `when` test, and a presentation-only RTS status `key.<key>.hp|maxHp|progress|fate|name|alive`.
  All optional.
- **571.** The gem and the red banner are this build's own CC0 models
  (`assets/mini-siege-marks`, text glTF from a script): the packs have no gem and their banners
  are blue. `*.gltf` in games' assets is in `.prettierignore`, so the text stays as written.
- **572.** The results screen's layout changed for every 16:9 picture in the engine (first
  section full width, the code beside its label, two columns); at 320x180 the overflow still
  reads "and N more".
- **573.** No gold income is shown (the RTS kit has none; gold changes only through missions);
  no new world-event sounds (no offer event to hang one on); no line from the offer marker to the
  card (it needs 3D-to-UI projection).
- **574.** Music: a `siege-danger` layer while a mission is open or raiders are within 3 cells
  of a building, and a `siege-round` layer under the rounds (calm 0.35, danger 0.7, round 1). The
  title plays the calm layer.
- **575.** The title drifts by zooming in 1.9 times and circling, because at the start zoom the
  whole map shows and the clamp leaves no room to move. The menus were restyled to the HUD's
  colours and the title's 2D pixel art removed, which also changes the 2D page.
- **576.** Kenney Tower Defense ships only 64/128 px tiles; they were scaled down to 16, 24 and
  32 px with a box filter. The rooms' siege engines and the walls' gate and camp keep the game's
  own text sprites; the old NES-style round art is kept but unused until C and E merge. Both
  rooms use the `knight_m` hero, so Sergeant Mara Venn looks like the sabotage hero.
- **577.** The iris into a round is started by the game's `main.ts` when `launch.playing()`
  changes (the shell's push/pop transition does not fire under the 3D page's screens); an
  engine-level fix could come later.
- **578.** Changes outside part F's modules: `vite.config.ts` sets a global `testTimeout` of
  20 s (CLI-heavy mini-siege tests sat just over 5 s under the full suite);
  `engine/tools/main.test.ts` deletes the fx lab's `ground.json` from its copy;
  `tests/build/game-files.test.ts` leaves `assets/` out of its glob comparison; `clock.ts` and
  `round-layer.ts` joined `PURE_CORE` in `config/layers.js`.
- **579.** 533 to 550 were written from F1-F9's commit messages and module docs, not from
  those tasks' own decision lists; the orchestrator should check them against what F1-F9
  reported.

**Engine 0.16 polish P: parts C and F review notes, P1-P3** (on the track branch, merged in part
E, E1; details in `docs/BUILD-LOG.md`, Engine 0.16 polish P). Labelled `P-1` to `P-5` on the
track; the merge numbered them 580-584 (`P-n` is item 579+n).

- **580.** The dawn skirt's before shot is a page shot, not a CLI one:
  `pnpm cli screenshot dawn-fresh.run.json --tick 30 --backend three` draws the dawn at 06:00 but
  lit and framed nearly as the afternoon (a closer camera than the page's, the map running past the
  picture), so the darkened map and the lighter skirt do not show in it. P9's after shot uses the
  page too.
- **581.** The page shots come from a committed script, `tests/browser/siege-review-shots.ts`
  (run with `pnpm exec tsx`, not a test), not a scratch one as in F10 (551), so P11 retakes the
  after shots with the same steps.
- **582.** The flash shot (F3) is the first loop step of world tick 41 after Delegate at 40: the
  white `mission-open` flash lasts 12 loop steps (ticks 41 and 42), not one frame as part F's
  notes say.
- **583.** C2's shots cover all six rooms other than the crypt and the warden hall (01 and 02
  show those two), more than the four the task asked for.
- **584 (revisits item 436).** C1: The Old Crypt's skin goes from `lighting.bands: 6` (item 436's
  stepped pixel-art falloff, which showed as hard rings round every torch) to `bands: 0` with
  the new `lighting.dither: 8`: each light's falloff is drawn smooth (32 stops) and quantized by
  picture pixel to 64 alpha steps with an 8x8 Bayer matrix (`LIGHT_DITHER_LEVELS`), no RNG, the
  same in Canvas2D and PixiJS. 16 and 32 steps were tried and looked at full size: a strong
  checker in the half-lit floor (16) and a busy one (32); at 64 the dither is a faint pixel
  texture and no ring shows. A skin that wants the stepped look back with soft edges can give
  `bands` with `dither` (it dithers between its bands). The smooth falloff ends darker towards
  the radius than the banded one (a band kept its inner edge's value), so the rooms read a little
  darker at their edges; no radius was changed. The fx lab's night level keeps its smooth,
  undithered falloff (it had no bands and shows no rings).

**Engine 0.16 part E, E2: the 0.15 Winding Road kept as `games/td-classic`**

- **585.** Before the tower-defense sample becomes the ten-wave map of 0.16 (E8), its 0.15 round
  (map, towers, waves, text art, skin, songs, sfx, fonts, title and menus, the page and the five
  run files `build`, `won`, `target`, `leaked`, `tapped`) was **copied** to a new test game,
  `games/td-classic` (id `td-classic`, its own page in the games index, `CLAUDE.md`, `AGENTS.md`
  and module page), with every golden hash unchanged (only each `.hashes.json`'s `run` path
  differs), as D2 did with `games/rts-classic`. The copy keeps the sample's content ids and glue
  names (`loadTowerDefense`, `TdPlay`, `window.wwTd`) and PixiJS as its default backend; its test
  file is renamed `td-classic.test.ts`. New: `tests/runs/td-classic-mutants.test.ts` (strict, no
  weak run, and an `UNGUARDED` list, empty today, for kit rules E3 and E4 add that the classic
  road cannot reach; with any listed the command exits 4, which the test expects), entries in
  presentation invariance, backend parity, `tests/build/pages.test.ts`, the PixiJS pages and lazy
  tests, and the PixiJS parity test's tower-defense case now plays `games/td-classic/runs/won`
  (the sample's `won` will change in E8). The sample's own mutants test stays on the sample. OK?

**Engine 0.16 part E: The Winding Road, owner review (E10)** (details in `docs/BUILD-LOG.md`,
Engine 0.16 part E).

- **586 (owner playtest).** Play The Winding Road from the title through all ten waves to the
  star rating (`pnpm dev`, `/games/samples/tower-defense/`): the balance (three stars take a
  thirteen-tower defence and only just; a thin one falls in wave 6), the feel of placing,
  upgrading and the speed-up, the music. Accept, or list what to change.
- **587 (owner screenshot review).** Review the ten 1920x1080 screenshots in
  `docs/reports/screenshots/0.16-E/` (the build log's table): accept, or list what to change.
- **588.** The mini siege's hosted walls round (`td-defence`, part F) still passes
  (`fortify-played`, `fortify-delegated`) and keeps part F's looks: its towers fire `shot:<type>`
  sprites over the target, with no flying projectiles, no impact emitters and no health bars
  against `maxhp:`. Should the walls' skin (`canvas2d-td-defence.json`) adopt part E's
  projectiles, impacts and health bars (skin only, no hash moves), as the roadmap's "the hosted
  rounds use parts C and E's presentation" suggests, or stay as part F left it?

**Engine 0.16 part E: build choices of E3-E9** (recorded by the close-out, E10).

- **589.** E3, upgrades: the cursor on a tower is that tower selected (no extra state, so no hash
  moves); Z or a second tap on a selected tower upgrades it, a tower of a type without levels
  still refuses `occupied`. No separate upgrade button in the kit; the page's bar gained one (E9).
- **590.** E3: a tower's `level` is in the snapshot only above 1 and sell values count what the
  upgrades cost (half of all paid, the kit's default), so rounds without upgrades hash as before.
- **591.** E3/E4: the mission round `td-defence` plays without the towers' levels unless its
  params say `upgrades: true`, so the mini siege never moves; `games/td-classic` lists the new
  rules as `UNGUARDED` in its mutants test instead of gaining re-recorded runs.
- **592.** E4: `splash` and `slow` sit on a type or a level (a level's replaces the type's); an
  enemy's slow is in the snapshot only while slowed; a splash hurts every other enemy within its
  radius of the target (the target takes only the shot), kills credited to the tower.
- **593.** E4: stars are the map's `{ three, two }` lives-left thresholds (any win is at least one
  star); `stars` is in the status and `kit` only on a rated map, 0 until won.
- **594.** E4: the wave preview is plain status strings (`nextWaveKinds` `runner,brute`,
  `nextWaveGroups` `runner:8,brute:2`), not a structured value, so any HUD can read it.
- **595.** E5, speed-up: the shell steps the scenes n times a loop step, each with a fresh input
  frame, so ticks and hashes equal normal speed; menus, manual-loop mode and replays step at 1x;
  speeds come from `menus.speeds` (whole, from 1, at most 8), F, gamepad RT and a `#ww-speed`
  button cycle them, and the speed is never stored (each page load starts at 1x).
- **596.** E5: sped up, a sound id plays at most once a drawn frame (the ticks between two draws
  present together), so 3x is not three times as loud.
- **597.** E6, projectiles: presentation only, started by events carrying `fromX`/`fromY` and timed
  by frame numbers; a flight that a sped-up frame skips past still lands exactly once; at most
  256 in the air (more land at once); 2D only (`wrong_backend_field` in a 3D skin).
- **598.** E6: a kind's `ring` may take its radius from a tag (`range:` times `per`, default the
  tile size) and a label bar its max from a tag (`maxhp:`); a ring draws only its rows inside
  the picture, so a zoomed ring stays cheap.
- **599.** E6: the end screen's stars are a row of 1-3 from the `stars` status (sheet frames or
  font text), between the credits and the stat lines; an end trigger's `stars: false` (the loss)
  leaves it out.
- **600.** E7: the Kenney pack's sheets were copied from the mini siege's copy (games may not
  import each other; kenney.nl blocks scripted downloads), box-filtered to 16 and 24 px; the cut
  sheet `road-art.png` is made by `tools/road-art.ts` and checked byte for byte.
- **601.** E7: cells stay 16 px (no run moved); towers and enemies are 24 px frames on the cell's
  centre; runners are the pack's green soldier, brutes its green tank, the frost tower the pack's
  turrets tinted ice blue; levels show as base plates and bigger turrets.
- **602.** E7, a kit change (presentation only): with the cursor on a tower the ghost is tagged
  `selected` and carries that tower's range, so the selected tower is ringed.
- **603.** E7: the text art keeps only the cursor and the HUD icons; the hit flash and the blocked
  ghost are silhouettes, so the palette recolours `td-ok`, `td-blocked`, `td-hit` were removed.
- **604.** E8: a 480x270 picture over a 30 x 16 map (480x256), centred, so 7 px of grass lie above
  and below; the HUD sits there and on the map's rows 0 and 15, which hold no path or pad.
- **605.** E8: eighteen pads at the road's ten bends and beside its legs; three towers (arrow 10,
  cannon 25, frost 15 gold) with two upgrades each; ten waves of two enemy kinds (runners and
  brutes, 140 enemies), a 500-tick timer; stars at 18 and 10 lives left of 20.
- **606.** E8: every earlier sample run was replaced (a rule change for all: their map is gone;
  `games/td-classic` keeps them); the new runs were played by the kit's `TdBot`, their sync
  hashes leave out the ticks a guarded mutant changes before a check fails, and all 18 kit rules
  stay guarded (strict).
- **607.** E8: the menus' controls screen gained Upgrade and Speed rows, the title art moved 96 px
  in from the 480 px picture's sides, and `menus.speeds` is `[1, 2, 3]`.
- **608.** E9, balance in data only: waves 9 and 10 toughened so E8's twelve-tower defence wins
  with two stars, `WIN_PLAN` (a thirteenth arrow, upgraded) with exactly 18 lives (three stars, the
  threshold) and `LOST_PLAN` (two arrows) loses in wave 6.
- **609.** E9: `win` replaces E8's `won` (renamed with the new balance), `lost` is re-made as the
  thin defence, and `sped-up` is the win's defence played on the page's scene at 2x and 3x and
  exported by `TdPlay.recording()`: the same input and the same golden hashes as `win`, with no
  `guards` of its own.
- **610.** E9, music: a danger layer at full while an enemy is within 8 path cells of the gate
  (`nearGate`), at 0.6 from wave 8 while enemies are on the road, silent once the round is over;
  jingles `road-won` and `road-lost` on the end screen.
- **611.** E9, a kit change (status only, no hash moved): `killed`, `wavesHeld` and `nearGate`.
- **612.** E9: the end screen shows the stars (a win only), waves held, lives left, gold and
  enemies stopped and the art credit; the page's bar's Build button reads `Upgrade <cost>` or
  `Top level` on a tower and Sell `Sell <value>`.
- **613.** E9: the page records every tick's merged input (`window.wwTd.recording()`), so a round
  played at any speed exports as a run file's input (exact when presses have a released tick
  between them).

**Engine 0.16 part E: the close-out (E10)**

- **614.** HUD fixes found in the screenshots (skin only, no hash moved): the `next` label shows
  only with a next wave and `sell {value}` only with a selected tower (`when`); the `3x` speed
  text moved from x 440 to 400, out from under the page's sound control.
- **615.** The speed-up shot (06) is a page shot by a committed script,
  `tests/browser/td-review-shots.ts` (run with `pnpm exec tsx`, not a test), in manual-loop mode:
  there the scene steps at 1x, so the shot shows the control and the HUD at 3x, not its pace (the
  page test checks the pace on the live loop). Manual-loop mode draws once per `step(n)` call,
  so the script plays the last 60 ticks one call each, letting frame-counted looks (spawn
  fade-in, projectile flights) advance as on the live loop.
- **616.** Looks recorded, not fixed: the lives heart disappears at 0 lives (the engine's HUD
  `icon` draws only on a truthy value; 09); the level-1 towers are grey and look alike (02, 03);
  a hit brute's white flash is a full 24 px silhouette (07); on the page the pause and speed
  buttons sit over the picture's right edge by the gate, as polish P's F2 found for the mini
  siege (06), and the page draws at a non-whole scale at 1920x1080, so pixel fonts vary.
- **617.** 589 to 613 were written by the close-out from E3-E9's commit messages and module docs,
  not from those tasks' own decision lists; the orchestrator should check them against what E3-E9
  reported.
