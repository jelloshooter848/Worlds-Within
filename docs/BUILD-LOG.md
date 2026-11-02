# Build log

This is the log of the autonomous build of Engine 0.2–0.15 on branch `engine/build-0.15`, for the
owner's review. Nothing in it is merged to `master`, tagged or published.

What each engine release built and the choices made along the way, newest first. The plan for each
release is in [ROADMAP.md](ROADMAP.md); this file records what actually happened, so the owner can
review the choices.

## Engine 0.4

Renderer and presentation contract. Built on branch `engine/build-0.15`; not tagged (tagging is the
owner's call).

### What was built

- **Configurable picture size.** `game.json` has an optional `screen` `{ width, height }` (whole
  numbers 64..1920, default 256x240). `fitGame`, the canvas2d `Viewport`, the touch layout, the view
  contract and `pnpm cli screenshot` all take the size from it; nothing else hard-codes 256x240. The
  demo states its size explicitly.
- **The presentation contract** (`engine/core/present`, pure). `PresentFrame`
  `{ frame, size, entities, map?, events, status, camera? }`: each entity's id, kind, box, facing,
  animation state and tags; the map (full on load or change, else an `{ id, version }` reference,
  via `MapTracker`); this frame's events; HUD status values; and the extension points `camera`,
  `layer` (depth) and `fx` (squash, stretch, rotate, alpha, tint), all of which a backend may
  ignore. `freezeFrame` deep-freezes a frame so a backend that writes to it throws;
  `presentFrameSchema` checks one in tests and tools; backends implement `Presenter`.
- **Skins.** The engine's `skin` content kind: one JSON file per backend mapping each kind to sprite
  frames (2D: sheet, palette, per-state and per-facing frames or cycles) or to a mesh (3D, for a
  later `three` backend), each tile to a frame, each event to a sound and an effect (`flash`,
  `particles`, `shake`, `tint`), plus HUD entries and a camera default. Cross-file checks report a
  missing sheet, palette, sound or frame at the skin file and field. `resolveSkinFrame` is the pure
  lookup backends share.
- **Presenters.** `SkinnedCanvasPresenter` (Canvas2D) draws any frame through a skin: the map cached
  per id and version, entities by layer then list order (a stable sort), facing flips, fallback boxes for anything the skin
  lacks, `fx` through `transformed()`/`translucent()`, camera framing, the HUD from status values,
  event effects and skin sounds through `onSound`. `NullPresenter` (null backend) takes frames and
  draws nothing, with `freeze` and `validate` options for tests.
- **The top-down kit is split.** `kits/topdown/present.ts`: `presentWorld(world, events, opts)`
  describes the room map, the hero and every other entity in the old draw order (with `TD_DEPTH`
  depths and tags such as `invuln`, `stunned`, `dark`, `flashing`), HUD status and events with
  positions, plus a camera hint, without changing any state (`TdPresentState` keeps the map tracker
  and stable ids outside the world, so state hashes are untouched). `render.ts`, `hud.ts`, the
  kit's `view.ts` and every `render` method are gone; the kit's `CLAUDE.md` maps each old frame name
  to its presented kind and animation.
- **The demo draws through its skin.** `games/demo/content/skins/canvas2d.json` maps every kind,
  tile, event and HUD value the kit presents to the hero sheet and a new placeholder sheet
  (`demo-placeholders.txt`, which reproduces the kit's old flat colours). `picture.ts`
  (`DemoPicture`) runs `presentWorld` -> `freezeFrame` -> `SkinnedCanvasPresenter`; three new sfx
  (`door`, `spit`, `hurt`) play on events.
- **Kits can't draw, enforced twice.** `FORBIDDEN_CORE` in `config/layers.js` keeps kits off the
  core's drawing and output side (`Renderer`, sprite sheets, pixel art, animation, `assets/`, audio
  output, `view.ts`, `scene.ts`, `loop.ts`), checked by ESLint and
  `tests/architecture/dependency-rule.test.ts`; backends were already forbidden by the layer table.
  `tests/architecture/no-drawing.test.ts` also scans every non-test kit file for drawing calls
  (`.sprite(`, `.rect(`, `.text(`, `fillRect`, `drawImage`, `getContext`, ...).
- **Parity and two-resolution tests.** `tests/runs/backend-parity.test.ts` plays every demo run file
  presenting every tick through the null and the Canvas2D presenters and requires both hash lists to
  equal the golden file. `tests/build/two-resolutions.test.ts` copies the demo with only `screen`
  changed to 320x240, then validates, runs (same hashes), screenshots (320x240, same bytes twice)
  and builds the copy. The screenshot page now draws every tick and reports the hashes it saw.

### Choices made

- **Kits are kept off the core's output side, not just off backends.** The roadmap's check is "kits
  can't import a backend"; that alone would still let a kit draw through the core `Renderer`, so the
  layer table gained `FORBIDDEN_CORE` and a scan for drawing calls.
- **Map versions are hashed from the tiles and tags**, so a backend redraws its cached map only when
  something changed; during a room slide both rooms are sent as one map.
- **Presentation state lives outside the world** (`TdPresentState`), so presenting cannot change a
  state hash; a test checks the hashes per tick with and without presenting.
- **The camera hint** keeps the 64 px HUD band at the top and centres the room in the rest of the
  picture at any size; a smaller picture cuts the room's edges.
- **The skin schema already has the 3D shape** (`mesh`, `color`, `scale`), chosen by the skin's
  `backend`, so 0.6 adds a backend, not a new file format.
- **Skins are content**, registered as an engine content kind, so `validate`, the editing verbs and
  the schema reference cover them like any other file.
- **The demo's placeholder art is a sprite sheet** that reproduces the old flat colours exactly, so
  the change of who draws is visible only where the skin adds something new (the HUD hearts).

### How to try it

```sh
pnpm -s cli validate games/demo --json
pnpm -s cli run games/demo/runs/walk-east.run.json --json
pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 120 --json
# another picture size: change only "screen" in games/demo/game.json, e.g. to 320x240, then
pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 120 --json
pnpm test tests/runs tests/build/two-resolutions.test.ts tests/architecture/no-drawing.test.ts
pnpm dev   # then open /games/demo/
```

### Done when

Each item was checked by running the commands on 2026-11-02 at commit `a3183f9`, and re-checked at
`6cb4e75` (the draw-order fix, the last 0.4 code commit): the four checks, the run file, the
screenshot (same sha256 and hashes) and the focused tests all passed again.

- **Met: `kits/` contains no drawing calls.** `tests/architecture/no-drawing.test.ts` and
  `tests/architecture/dependency-rule.test.ts` pass. A planted `kits/topdown/planted.ts` that imports
  `@engine/core/gfx/renderer` and calls `r.rect(0, 0, 16, 16, '#000000')` failed both (2 failed,
  93 passed): the dependency test with "kits may not import engine/core/gfx/renderer.ts: kits never
  draw or play sound", the drawing scan with `kits/topdown/planted.ts:3: r.rect(...)`; `eslint` on
  the file reported the same `layers/dependency-rule` error. A planted import of
  `@engine/backends/canvas2d` failed the dependency test ("kits may not import engine/backends").
  The planted files were deleted.
- **Met: the demo plays as before with the same state hashes as at the end of 0.3.**
  `pnpm -s cli run games/demo/runs/walk-east.run.json --json` twice: exit 0, `passed: true`,
  byte-identical output, hashes tick 0 `d29e6b40530102ce`, 40 `307b25d5cf0508b9`,
  80 `6f0c9999c28588f2`, 120 `ba89383037a8499e`, 160 `ebbbdd0bbe2fe046`, 200 `08a5abeb7379f953`,
  240 `257c816edd617516`, the values recorded at the end of 0.3. `walk-east.hashes.json` is
  unchanged since `c72d1d7` (the 0.3 close-out; `git diff` is empty). In a browser (`pnpm build`,
  `vite preview`, Playwright with Chromium) the demo page drew the courtyard (canvas 800x600,
  285002 non-black pixels), the hero moved when ArrowRight was held for a second (the canvas
  changed), and there were no console errors or page errors. The tick-120 screenshot differs from
  0.3's only by the new HUD hearts (see `games/demo/CLAUDE.md`, "Screenshot against Engine 0.3").
- **Met: two resolutions by changing one value, a CLI screenshot of each.** With
  `games/demo/game.json` as committed (256x240),
  `pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 120` wrote a 256x240 PNG,
  sha256 `385b61d4a1ff684c27a8d497775c05949d935fd387e19be34a3fbbd632ba7cdd`,
  `matchesHeadless: true`. With only `"screen"` changed to `{ "width": 320, "height": 240 }` the same
  command wrote a 320x240 PNG, sha256
  `5ccb69e10a269f7dedb0c94d4513d54553a450f6cf672bb926b1bb0d0ced004f`, `matchesHeadless: true`, the
  room centred and the HUD at the top; `run` at that size gave the same seven hashes. The value was
  restored. `tests/build/two-resolutions.test.ts` does the same in a copy, takes each screenshot
  twice (same bytes) and builds the copy with Vite (6 tests pass).
- **Met: the same hashes with the Canvas2D and the null backend.**
  `tests/runs/backend-parity.test.ts` passes: walk-east presented every tick through `NullPresenter`
  and through `SkinnedCanvasPresenter` gives the golden hashes both times. The screenshot command,
  which draws every tick with the Canvas2D backend in Chromium, reported the headless hashes for
  ticks 0..120 at both sizes.
- The four checks pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (64 test files,
  708 tests at `6cb4e75`), and `pnpm docs:check` passes.

### Deviations from the roadmap

- **A stricter check than the roadmap names.** Besides "kits can't import a backend", kits may not
  import the core's drawing and output side (`FORBIDDEN_CORE`), and a scan rejects drawing calls in
  kit code.
- **The demo looks slightly different** although its rules did not change: the skin adds HUD
  hearts, and events now play sounds (new `door`, `spit` and `hurt` sfx). A few visual details a
  skin cannot express yet were dropped (listed below). The state hashes are unchanged.
- **Skins also hold HUD entries and a camera default**, beyond the roadmap's kinds, sprites, meshes,
  sounds and effects; the HUD had to move out of the kit somewhere.
- **The status lines** at the top of the demo (title, room, hearts, controls) stay as debug text in
  `DemoPicture`, drawn by the game, not the skin.

### Outstanding issues

- Visual-only differences from 0.3 that skins cannot express yet: a hurt hero or monster no longer
  blinks; stun stars do not turn; the exit's glow and dark-room palettes are one flat frame each.
- `SkinnedCanvasPresenter` ignores the camera's `zoom`, `deadzone` and `lerp` and the `tint` fx for
  now (`shake` is honoured).
- Screenshot PNGs still include the demo's debug text in a system font, so they are byte-stable on
  one machine but may differ between machines; no golden PNG hash is committed.
- The scaffold skill still covers only the top-down kit (now through `presentWorld`, a skin and
  `SkinnedCanvasPresenter`).
- The tools' kit table (`engine/tools/kits.ts`) is unchanged; the kit-level hook is still planned
  for 0.5.
- Feedback items 45-51 (`docs/FEEDBACK-LOG.md`) ask the owner about these choices.

## Engine 0.3

LLM tooling. Built on branch `engine/build-0.15`; not tagged (tagging is the owner's call).

### What was built

- **Agent docs.** `llms.txt` at the root links the root `CLAUDE.md`, the design and roadmap, one
  page per module in `docs/modules/`, the cheat sheet, the generated references and the skills.
  Every module folder has a `CLAUDE.md` and an `AGENTS.md` pointer;
  `tests/architecture/agent-docs.test.ts` fails if a module has no page, `llms.txt` does not link it,
  or any link is broken.
- **Content core.** `engine/core/content`: Zod schemas (Zod 4.6.7, pinned), text grids that reject
  ragged rows and unknown characters with row and column, a registry of content kinds (song, sfx,
  sprite, palette from the engine; room from the top-down kit), and errors that always name the file
  and the field (`{ file, path, pointer, code, message, row?, col?, line? }`). All of it is pure.
- **Demo content as data.** `games/demo/game.json` (the manifest) names the rooms (`.json` plus
  `.map.txt` grids), the song, a palette and a hero sprite sheet under `games/demo/content/`. The
  TypeScript left in the demo is glue. The browser gets the files through `import.meta.glob` with
  `?raw`, Node through `readGameFiles`.
- **The CLI** (`pnpm cli`, `engine/tools`). A command registry with Zod schemas for arguments and
  flags, `--json` with exactly one result object on stdout, grouped exit codes (0 ok, 2 usage,
  3 invalid content, 4 failed check, 5 crash), and an output cap (32 KiB) that writes the full
  result to `.ww-out/` and returns `truncated`, `fullOutput` and `omitted`. Commands: `help`,
  `validate`, `run`, `dump`, `screenshot`, `mutants`, `get`, `set`, `add`, `remove`.
- **Headless runs.** The headless contract (`engine/core/headless.ts`: `createGame`, `step`,
  `snapshot`, `canonicalJson`), the kit's world snapshot, and run files with a seed, scripted input,
  tick assertions, invariants and state hashes every N ticks. `tests/runs/run-files.test.ts` plays
  every run file in `games/` twice and compares with its committed golden `.hashes.json`.
- **Replay files.** A failing run writes `.ww-out/replays/<run>-t<tick>-<hash>.run.json`; running it
  fails at the same tick and checks the stored hashes, naming the first mismatching tick.
- **Editing verbs.** `get`, `set`, `add` and `remove` on game manifests, content files, text-grid
  parts and run files, by dotted path or JSON pointer. Every write is schema-checked (refused with
  exit 3, file untouched), written Prettier-clean, read back and reported as `verified`.
- **Checks across files.** A content kind can have a `checkAll` hook that runs over all its files.
  The top-down room kind uses it (`checkDungeon`), so `validate`, `run` and `screenshot` report two
  player starts or a door that leads nowhere as `invalid_dungeon` errors at the room file and map
  line, instead of crashing. The editing verbs do not refuse a write for such errors (joining two
  rooms takes one edit per room); they list them in `crossErrors`.
- **Mutant checks.** `engine/core/rules.ts` names rules; the top-down kit names four
  (`walls-block-movement`, `doors-change-room`, `damage-reduces-hp`, `keys-open-locked-doors`).
  `mutants` plays a run once per rule switched off and lists the rules the run does not guard.
- **Screenshots.** `screenshot <run> --tick N` plays the run in headless Chromium (Playwright 1.63.0,
  pinned) through the game's view module (`view` in `game.json`, `engine/core/view.ts`) and writes a
  256x240 PNG with its sha256; the page's state hash is checked against the headless run.
- **Generated docs.** `pnpm docs:gen` writes `docs/reference/cli.md`, `docs/reference/schemas.md`
  and the generated tables of `docs/CHEATSHEET.md` from the same schemas as the CLI help;
  `pnpm docs:check` (in `pnpm test` and in CI) fails when they are out of date.
- **Skills.** `.claude/skills/scaffold-game/SKILL.md` (a one-room top-down game: manifest, room,
  headless and view entries, browser page, run file with golden hashes, agent docs, then validate,
  run and the four checks) and `.claude/skills/debug-failing-run/SKILL.md` (run, first failing tick,
  dump at that tick and the one before, screenshot, replay, mutants, fix and rerun). Both are linked
  from `llms.txt`, `docs/modules/skills.md` and the cheat sheet.

### Choices made

- **The CLI name** stays `pnpm cli` (run through `tsx`). Agents should use `pnpm -s cli`, since
  without `-s` pnpm prints a banner on stdout before the JSON.
- **The CLI never imports a game.** It reads `game.json` and content with the file system and
  imports the `headless` and `view` modules by path at run time; a test keeps tools free of game
  imports.
- **Exit code 1 is never used**, so a 1 means Node died before the CLI could report.
- **Run-file ticks.** Tick 0 is the starting state and tick `t` the state after `t` steps; a failing
  run stops at the first failing tick and reports every check failing at that tick (`failures`).
- **State hash** is the first 16 hex digits of SHA-256 over canonical JSON (sorted keys);
  `canonicalJson` throws on anything not JSON-safe, naming the path.
- **Screenshots** are served by Vite in middleware mode on a free local port from a tools-only page
  that is not part of the Pages build. Where no browser is installed the command and its tests skip
  cleanly; CI installs Chromium.
- **`.claude/skills/` is committed**, while the rest of `.claude/` stays git-ignored (`.gitignore`
  gained `!.claude/skills/`).
- **The scaffold skill targets the top-down kit** (the only kit so far); its `main.ts` draws through
  the view module, so the browser page, the screenshot and the headless run share one game.

### How to try it

```sh
pnpm -s cli help
pnpm -s cli validate games/demo --json
pnpm -s cli run games/demo/runs/walk-east.run.json --json
pnpm -s cli dump games/demo/runs/walk-east.run.json --tick 100 --json
pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 60 --json
pnpm -s cli mutants games/demo/runs/walk-east.run.json --json
pnpm -s cli get games/demo/content/rooms/courtyard.json music --json
```

### Done when

Each item was checked by running the commands on 2026-11-02 at the commit that closes 0.3.

- **Met.** `pnpm -s cli validate games/demo --json` printed one line (one JSON object, 10 files,
  0 errors) and exited 0. In a copy of the demo with `"at": "x"` in `content/rooms/courtyard.json`
  it exited 3 with one error: `file` `.../content/rooms/courtyard.json`, `path` `at`, `code`
  `invalid_type`.
- **Met.** `pnpm -s cli run games/demo/runs/walk-east.run.json --json` twice in a row: exit 0,
  `passed: true`, the same seven hashes both times (tick 0 `d29e6b40530102ce` ... tick 240
  `257c816edd617516`), equal to the committed `walk-east.hashes.json`, which
  `tests/runs/run-files.test.ts` checks on CI (`pnpm test` in `.github/workflows/ci.yml`).
- **Met.** A copy of the demo run with a wrong assertion (`hero.x` `lt` 150 at tick 60) exited 4
  with `failure.tick` 60 (`hero.x is 202, expected lt 150`) and wrote
  `.ww-out/replays/wrong-t60-7ee52033ce06.run.json`. Running that replay exited 4 at tick 60, with
  `replay.reproduced: true`, `hashesChecked: 3`, `hashMismatch: null`.
- **Met.** `pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 120` twice: both exit 0,
  sha256 `303b20d7559004e80f01d68e53a54efdb060985419c1825070cfa617ee2a0579`, `cmp` found the two PNGs
  byte-identical, and `matchesHeadless: true`.
- **Met.** `set .../content/rooms/courtyard.json music quiet` (in the copy) returned
  `verified: true`, `before` `demo`, `after` `quiet`; the `get` that followed returned `quiet`.
- **Met.** `pnpm -s cli dump games/demo/runs/walk-east.run.json --tick 10 --max-output 300 --json`
  printed `{"truncated":true,"fullOutput":".ww-out/dump-0b2801361285.json",...}`.
- **Met.** Changing one cell of a generated table in `docs/CHEATSHEET.md` made `pnpm docs:check`
  exit 4 naming the file and line; restoring it made it pass. CI runs `pnpm docs:check` and
  `pnpm test` (whose `engine/tools/docs.test.ts` does the same check).
- **Met.** The hand check (below): a fresh agent given only `llms.txt`, the cheat sheet and the
  scaffold skill made a one-room game in `games/` that passed `validate` and `run`.
- The four checks pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (55 test files,
  595 tests).
- **Re-checked** after the last two 0.3 commits (checks across files): the four checks pass (55 test
  files, 601 tests), `pnpm docs:check` passes, the demo run file passes with the same hashes as its
  golden file, and the validate, wrong-assertion and replay, screenshot (same sha256 `303b20d7...`),
  set/get and output-cap checks above gave the same results.

### Hand check (scaffold skill)

- **Who:** a fresh Claude Code agent (`claude -p`, Opus 5.5, no earlier context), told to use only
  `llms.txt`, `docs/CHEATSHEET.md` and `.claude/skills/scaffold-game/SKILL.md`, plus files those
  name, and to report every gap.
- **Game made:** `games/hand-check/`: `game.json` (kit `topdown`, `room` only, seed 1, `headless.ts`,
  `view.ts`), `content/rooms/hall.json` (`{ "id": "hall", "at": [0, 0] }`) with an 11x16
  `hall.map.txt` walled room and the player start, `headless.ts`, `view.ts`, `main.ts`, `index.html`,
  `runs/walk-east.run.json` (60 ticks holding right; `hero.room` is `hall` at tick 0, `hero.x` > 112
  at tick 60; `hero.hp` >= 0 and not dead on every tick) with its golden `walk-east.hashes.json`,
  `CLAUDE.md`, `AGENTS.md`, `docs/modules/games-hand-check.md` and its `llms.txt` line.
- **Commands it ran:** `pnpm -s cli validate games/hand-check --json` (exit 0, 3 files, 0 errors);
  `pnpm -s cli run games/hand-check/runs/walk-east.run.json --json` twice (exit 0, `passed: true`,
  the same hashes: tick 0 `a4bfc190c431cd03`, 20 `78ec03124b24edb4`, 40 `67f5db8238a5a094`,
  60 `c13939f08b904962`); `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`; then `pnpm lint`,
  `pnpm typecheck`, `pnpm test` (55 files, 596 tests) and `pnpm build`, all passing. It did not need
  to open any engine or kit source; every snippet worked as written. The orchestrator re-ran
  `validate` (exit 0) and `run` (exit 0, final hash `c13939f08b904962`) on its game.
- **Gaps it reported, and the fixes:** (1) the golden-hash command rewrites every game's hashes, not
  just the new one: the skill now says so and says to check `git status`; (2) `validate` passes
  before the entry modules exist: the skill now says `validate` never opens them and `run` proves
  them; (3) piping through `tail` hides exit codes: the skill now says to read `echo $?` or
  `exitCode`; (4) `.ww-out/` was not explained: the skill now says it is the git-ignored output
  folder. Before the hand check the orchestrator also corrected the hero's walking speed in the
  skill (about 1.5 pixels a tick, found while checking the Done-when items).
- **Afterwards:** the scratch game, its docs page and its `llms.txt` line were deleted; it is not
  kept as a fixture (the demo already covers every file it had).

### Deviations from the roadmap

- **An original demo sprite.** The roadmap moves the demo's rooms, sprites and song into data files;
  the demo had no sprite of its own, so 0.3 added an original hero sprite sheet
  (`games/demo/content/sprites/demo-hero.txt`) and a palette, drawn by the demo, so the sprite kind
  is used by real content.
- **A `palette` content kind and a `view` module.** Neither is named in the roadmap: palettes are
  needed for the sprite, and the view module (`view` in `game.json`) is how `screenshot` draws a game
  without the CLI importing it.
- **A `mutants` command and a `help` command** beyond the commands the roadmap lists; the roadmap
  asks for the mutant mechanism, and `help` is where the generated help is printed.
- **Playwright is a dev dependency** (1.63.0, pinned), and CI installs Chromium for the screenshot
  test.

### Outstanding issues

- The scaffold skill covers only the top-down kit; each new kit (0.5 on) needs its own variant or a
  kit-specific section.
- The kit still draws (`kits/topdown/render.ts`, `hud.ts`), recorded as debt since 0.2; the view
  modules lean on it.
- Mutant checks show the demo's run guards only `doors-change-room`; full adoption is planned for
  Engine 0.5.
- The screenshot test needs Chromium. Locally, a machine without one skips it with a message (CI
  sets `CI` and so requires it), so such a machine does not check screenshot determinism.
- The hand check was run once, by one agent, as the roadmap asks; it is not automated.
- Kit content kinds and rule lists come from a small table in `engine/tools/kits.ts` that only knows
  the top-down kit's default room legend. A game with its own legend will need a kit-level hook.
- Screenshot PNGs are byte-stable on one machine but may differ between machines (the demo's debug
  text uses a system font), so no golden PNG hash is committed.
- MML songs and sfx are JSON only; there is no `.txt` form for them yet.

## Engine 0.2

Restructure and the dependency rule. Built on branch `engine/build-0.15`; not tagged (tagging is the
owner's call).

### What was built

- **Target layout.** `src/` is gone. The engine is in `engine/core`; the renderer split into the
  contract in `engine/core/gfx` and two backends, `engine/backends/canvas2d` (canvas renderer and
  viewport) and `engine/backends/null` (headless renderer). `engine/sim` and `engine/tools` hold only
  their `CLAUDE.md` for now. The kit is in `kits/topdown`, the demo in `games/demo` with its own
  `index.html` and `main.ts`.
- **Multi-page build.** `build/pages.ts` finds every `games/*/index.html` and
  `games/samples/*/index.html`; Vite builds each as its own page plus a root launcher that links to
  every game. `pnpm dev` opens the launcher. Links are relative, so the pages work under `VITE_BASE`.
- **The dependency rule, enforced twice.** `config/layers.js` is the one table of allowed arrows.
  `config/deps.js` checks one arrow; `tests/architecture/dependency-rule.test.ts` scans every import
  in the repo with it, and a local ESLint plugin (`config/eslint-plugin-layers.js`) runs the same
  checker per folder. `tests/architecture/eslint-deps.test.ts` feeds deliberate bad imports
  (`kits/topdown` importing `games/demo`, `engine/sim` importing a backend, and more) to both and
  checks both reject them.
- **The purity rule.** ESLint bans `Math.random`, `Date.now`, `performance.now` and DOM globals in
  `engine/sim`, `kits/` and the pure part of `engine/core`. `tests/architecture/purity.test.ts`
  checks that a `Math.random()` in `kits/` fails lint, and that every core file kits or the sim reach
  at run time is on the pure list.
- **Content audit.** No game content was found in `engine/` or `kits/`.
  `tests/architecture/no-content.test.ts` scans non-test, non-fixture files for songs, MML strings,
  room literals, sprite definitions and text grids, so the rule cannot drift.
- **Pages workflow.** `.github/workflows/pages.yml` runs CI's checks and publishes `dist/` to GitHub
  Pages on a three-part `engine-v*` or `ww-v*` tag (or by hand). Nothing was published during this
  build.
- **Agent docs.** Every new module folder has a `CLAUDE.md`: `engine/core`,
  `engine/backends/canvas2d`, `engine/backends/null`, `engine/sim`, `engine/tools`, `kits/topdown`,
  `games/demo`, plus `build/`.

### Choices made

- **Test files may import `engine/backends/null`.** The one exception to the layer table
  (`EXCEPTIONS` in `config/layers.js`): any `*.test.ts` may run headless through the null backend,
  even in a layer (such as `kits/`) that may not import backends in its own code.
- **The pure-core list.** Rather than make all of `engine/core` pure (it holds the audio output,
  saving and browser input, which need the DOM), `PURE_CORE` in `config/layers.js` lists the core
  files that must stay pure: `rng.ts`, `math/**`, `scene.ts`, the input actions, bindings, manager
  and scripted input, the renderer contract, palette, animation, screen and spritesheet maths, and the
  MML parser. The purity test fails if kits or the sim start reaching a core file not on the list.
- **Aliases.** `@engine/*` points at `engine/*` and `@kits/*` at `kits/*`. The old `@sim` and `@game`
  aliases were dropped, and no alias points into `games/`.
- **Fit maths moved into core.** The pure viewport fit maths moved to `engine/core/gfx/screen.ts`, so
  the touch layout in core does not reach into a backend.
- **Fixtures.** Engine and kit test content lives in `*.test.ts` files or `__fixtures__/` folders;
  anything else under `engine/` or `kits/` that looks like content fails the no-content test.

### How to try it

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm dev                 # opens the launcher at /, which links to games/demo/
pnpm build && pnpm preview   # the production build: / is the launcher, /games/demo/ the demo
```

The architecture tests on their own: `pnpm vitest run tests/architecture`.

### Done when

- **Met.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass (31 test files, 354
  tests). `games/demo` plays as before: the headless demo test passes, and in a browser (`vite
preview` with Playwright) the launcher lists `games/demo/`, the demo draws its room with no console
  errors, and the picture changes when the hero is moved with the arrow keys.
- **Met.** A deliberate bad import fails both ESLint and the dependency test.
  `tests/architecture/eslint-deps.test.ts` feeds `kits/topdown` importing `games/demo` (relative,
  through an alias, and as a bare repo path; as import, re-export and `import()`) and `engine/sim`
  importing a backend to both the shared checker and ESLint, and both reject every one.
- **Met.** A deliberate `Math.random()` in `kits/` fails lint (`tests/architecture/purity.test.ts`,
  which also covers `Date.now`, `performance.now` and DOM globals in `engine/sim`).
- **Met.** `git grep` finds no game content under `engine/` or `kits/` outside test fixtures; the
  only hits for song or MML words are the audio engine's own type names and doc comments.
  `tests/architecture/no-content.test.ts` keeps it that way.

### Deviations from the roadmap

- **Stricter sibling rule.** The roadmap lists arrows between layers only. The build also forbids a
  game, kit or backend from importing a sibling in the same layer (for example one backend importing
  another), because `docs/DESIGN.md` and the folder `CLAUDE.md` files already say "never other games"
  and "never other kits".
- **One exception to the table.** `*.test.ts` files in any layer may import `engine/backends/null`,
  so kit and game tests can run headless. The roadmap's "kits → core" does not mention it.
- **Pure core is a list, not all of core.** Only the parts of `engine/core` that kits and the sim use
  are pure (see Choices made); audio output, saving and browser input stay DOM-based.
- **Extra folders.** `build/` (page discovery and the launcher script) and `config/` (the layer
  table, checker and ESLint plugin) are new top-level tooling folders the roadmap does not name.

### Outstanding issues

- The Pages workflow has never run: no tag was pushed and nothing was published, as the owner asked.
  It will first run on the first release tag.
- The kit still draws (`kits/topdown` `render.ts`, `hud.ts` and the `draw` methods on entities),
  against the "kits never draw" rule. This is known debt, recorded in `kits/topdown/CLAUDE.md`, for a
  later release.
- Some NES colour names in `engine/core/gfx/palette.ts` are themed (`mushroomRed`, `greenPipe`); kept
  as engine data for now.
- The root `CLAUDE.md` was edited by the build (new layout and dependency-table lines); the owner
  should approve that wording.

### Verified (Done when), as first recorded

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass (31 test files, 347 tests).
- `games/demo` plays as before: the headless demo test passes, and in a browser (`vite preview` with
  Playwright) the launcher lists `games/demo/`, the demo draws the courtyard room with no console
  errors, and the hero moves with the arrow keys.
- Deliberate bad imports fail both ESLint and the dependency test; `Math.random()` in `kits/` fails
  lint.
- A `git grep` for content (MML strings, song channels, room or sprite grids) under `engine/` and
  `kits/` finds only the audio engine's own type and channel names, no content.
