# Feedback log

Whenever Claude needs the owner's feedback or a decision, each item gets a unique number. Numbers
continue across conversations and are never reused, so the owner can answer by number. Every item and
its outcome is recorded here (see `CLAUDE.md`).

**Next unused number: 65.** (Last used: 64.)

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
