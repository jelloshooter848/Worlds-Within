# Build log

This is the log of the autonomous build of Engine 0.2–0.15 on branch `engine/build-0.15`, for the
owner's review. Nothing in it is merged to `master`, tagged or published.

What each engine release built and the choices made along the way, newest first. The plan for each
release is in [ROADMAP.md](ROADMAP.md); this file records what actually happened, so the owner can
review the choices.

## Engine 0.6

Basic 3D backend. Built on branch `engine/build-0.15`; not tagged (no tags during the build, owner
answer 24).

### What was built

- **3D skin format.** A skin for the `three` backend describes every kind and every tile type as a
  primitive (`box`, `wedge`, `cylinder`, `cone`, `sphere`, `plane`) or a named compound mesh of
  parts, in world px with `depth` and `z`, plus `camera3d` defaults (field of view, tilt, layer
  depth, lights). All text, in the `skin` content kind. An unknown mesh id is `missing_ref` at the
  field, and a 3D field on a 2D skin is `wrong_backend_field`. `resolveMeshParts` and
  `resolveCamera3d` (`engine/core/present/skin.ts`) give backends and tests one reading.
- **Shared camera framing.** The follow, deadzone, 1/256 fixed-point lerp, clamp, small-area
  centring and shake maths moved from the Canvas2D presenter into `CameraFollower`
  (`engine/core/present/camera.ts`), so 2D and 3D frame the same point. The Canvas2D presenter
  draws byte-identically (the `start-to-goal` tick 120 screenshot's sha256 did not change).
- **`engine/backends/three`.** `ThreeScene.sync(frame)` turns any read-only `PresentFrame` and a
  `three` skin into a Three.js scene graph: instanced tile blocks built once per map id and
  version, entity meshes kept by id (layer depth, facing mirror, squash, rotate, alpha, a fallback
  box for an unlisted kind), a side-on perspective camera at the distance where the z = 0 plane
  shows exactly the 2D picture, one ambient and one directional light, sounds once per event, and
  a flash/tint overlay. It runs and is tested in Node. `ThreePresenter` is the browser `Presenter`
  over a fixed `WebGLRenderer` (no antialias, pixel ratio 1, `preserveDrawingBuffer`, sRGB, a fixed
  clear colour). `webglRendererInfo` / `isSoftwareRenderer` read and judge the WebGL renderer
  string, and `fitCanvas` / `applyCanvasBox` / `canvasToScreen` letterbox the WebGL canvas with the
  same `fitGame` maths as the 2D `Viewport`. `three` and `@types/three` are pinned at `0.187.0`.
- **An external-package table.** `config/layers.js` gained `PACKAGES`: npm packages that belong to
  one unit (`three` only from `engine/backends/three`). `config/deps.js`, ESLint and
  `tests/architecture/dependency-rule.test.ts` enforce it.
- **The view `frame()` hook.** `ViewGame` (`engine/core/view.ts`) has an optional `frame()` (the
  frozen `PresentFrame` for the state now) and an optional `background`, so a tool can show a
  game through any `Presenter` instead of `render(r)`. The platformer lab's view implements it.
- **The lab in 3D.** `games/platformer-lab/content/skins/three.json` gives a low-poly mesh per
  kind, a block per solid tile and a thin slab for one-way platforms, with the 2D skin's camera.
  `LabFrames` is one frozen frame stream every backend shares. In the browser,
  `/games/platformer-lab/?backend=three` boots `main3d.ts` (its own chunk, loaded only in 3D): a
  `ThreePresenter` on the page canvas, with the same input, loop, scenes and mini game as 2D. The
  page has a 2D/3D toggle, shows a message with a link back to 2D when WebGL 2 is missing, and
  the root launcher lists a 3D link (`<meta name="ww-alternate">`).
- **Three-way parity.** `tests/runs/backend-parity.test.ts` plays every lab run file presenting
  each tick through null, Canvas2D and the Three.js scene builder, checks the golden hashes, and
  fails if a kind or tile the runs show has no `three` skin entry.
- **`pnpm cli screenshot --backend three`.** `screenshot` takes `--backend canvas2d|three`
  (canvas2d is the default and gives the same bytes as before) and `--allow-software-gl`. With
  `three` the page shows the view's `frame()` through a `ThreePresenter` and the game's `three`
  skin, syncing every tick and rendering once at the target tick, and reports the WebGL renderer.
  A software renderer (or no WebGL context) is exit 4 with a message naming the renderer and the
  flag; `--allow-software-gl` forces SwiftShader so the PNG is repeatable. A view without
  `frame()` or a game without a `three` skin is exit 3.
- **Browser smoke test.** `tests/browser/lab-3d.test.ts` (skipped where Chromium is missing, never
  in CI) opens the lab in 3D from the Vite dev server and from a build under a sub-path base,
  reads the WebGL renderer, holds right and jumps, and checks that the picture changes far more
  than when idle, with no page errors.
- Agent docs: `engine/backends/three/CLAUDE.md` and `AGENTS.md`, `docs/modules/engine-backends-three.md`
  and its `llms.txt` link, and updated pages for core, present, tools, Canvas2D and the lab.

### Choices made

- **Software GL policy.** Headless Chromium in this container has no GPU and reports
  `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.
  The roadmap wants a silent fall-back to software rendering caught, so `screenshot --backend
three` refuses it (exit 4). `--allow-software-gl` is an explicit opt-in that forces SwiftShader,
  which also makes the PNG repeatable on one machine. The browser smoke test accepts SwiftShader:
  it checks that 3D plays, not that it is hardware-backed. (Item 65.)
- **HUD and effects are minimal in 3D.** The 3D backend draws no HUD (`skin.hud`, `frame.status`)
  and no `particles`; `flash`, `tint` and `shake` work. Lights are one ambient and one directional,
  with no shadows. (Item 66.)
- **`frame()` is an optional view hook** next to `render(r)`, not a replacement for it, so the
  demo and the 2D screenshot path did not change. A run uses one or the other. (Item 67.)
- **The 3D mesh format** is primitives and named compound meshes in the skin JSON, not an external
  model format (glTF, OBJ), keeping content text and in line with owner answer 22. (Item 68.)
- **`?backend=three` picks 3D** in the browser, with Canvas2D the default and a 2D/3D toggle on the
  page. (Item 69.)
- **The external-package table** (`PACKAGES` in `config/layers.js`) is a new kind of rule in the
  dependency table: a package may be imported only by the units listed. (Item 70.)
- **`zoom` works in 3D but not in 2D.** The 3D camera honours `zoom` by distance; the Canvas2D
  presenter still ignores it (as since 0.4). (Item 71.)
- More build decisions for the owner are items 72-75 in `FEEDBACK-LOG.md`.
- The root `package.json` version was left as it was, as in earlier releases of this build (no
  release is tagged or published during the build).

### How to try it

```sh
pnpm dev   # then open /games/platformer-lab/?backend=three (arrows move, Z jumps, X runs)
pnpm -s cli run games/platformer-lab/runs/start-to-goal.run.json --json
pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --backend canvas2d --json
pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --backend three --allow-software-gl --json
pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --backend three   # exit 4 without a GPU
pnpm vitest run tests/runs/backend-parity.test.ts tests/browser/lab-3d.test.ts engine/backends/three
```

### Done when

Each item was checked by running the commands on 2026-11-02 at commit `d7ea822`, the last 0.6
code commit.

- **Met: the 0.5 fixture level plays in the browser in 3D.**
  `pnpm vitest run tests/browser/lab-3d.test.ts --reporter=verbose`: 2 passed ("plays from the Vite
  dev server: WebGL renderer, input moves the picture, no page errors" and "plays from the build
  under a sub-path base"). As a manual check, after `pnpm build` a Playwright script opened
  `vite preview` at `/games/platformer-lab/?backend=three` in Chromium (800x600, launched with
  `--enable-unsafe-swiftshader`). The canvas was 256x240 with a WebGL 2 context whose renderer was
  `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.
  The first screenshot showed the fixture level in 3D: the runner on the left, the ground blocks,
  a `?` block, a gap and a walker. Holding ArrowRight and X, then Z for a jump, the runner crossed
  the gap and the camera scrolled to the coin and the goal flag (canvas screenshot sha256 prefixes:
  start `921951ca969718c9`, after moving `d6edc8840f770f1f`). There were no console errors and no
  page errors.
- **Met: the same run file gives the same state hashes with the null, Canvas2D and Three.js
  backends.** `pnpm vitest run tests/runs/backend-parity.test.ts --reporter=verbose`: 10 passed,
  among them each of the six lab runs (`mini-game`, `moves`, `objects`, `shells`,
  `start-to-goal`, `walkers`) through null, Canvas2D and the Three.js scene builder against the
  golden hashes, and "the three skin has a mesh for every kind and a block for every tile the lab
  runs show". From the CLI, for `games/platformer-lab/runs/start-to-goal.run.json`:
  `pnpm -s cli run ... --json` (headless, null), then `screenshot ... --tick T --backend canvas2d
--json` and `screenshot ... --tick T --backend three --allow-software-gl --json` for each tick
  the run hashes. Every command exited 0, and every screenshot reported `matchesHeadless: true`:

  | Tick | `run` (null)       | `--backend canvas2d` | `--backend three`  |
  | ---- | ------------------ | -------------------- | ------------------ |
  | 0    | `9ed173e616121d27` | `9ed173e616121d27`   | `9ed173e616121d27` |
  | 60   | `522eeb1256650932` | `522eeb1256650932`   | `522eeb1256650932` |
  | 120  | `50397aac3f28ba17` | `50397aac3f28ba17`   | `50397aac3f28ba17` |
  | 180  | `9c9848d8d2b9a2b2` | `9c9848d8d2b9a2b2`   | `9c9848d8d2b9a2b2` |
  | 240  | `7137cbde89f0fd44` | `7137cbde89f0fd44`   | `7137cbde89f0fd44` |

  These are also the golden hashes in `start-to-goal.hashes.json`. The canvas2d tick 120 PNG kept
  its 0.5 sha256 (`2c6cc55462fd9c74d0392e6d2471d2020743b8c1b0abd719a8e094a4b54e9c2d`).

- **Met: `pnpm cli screenshot --backend three` writes a PNG and fails with a clear error if WebGL
  is not hardware-backed.** With `--allow-software-gl` it wrote 256x240 PNGs for each tick above
  (`renderer` reported as the SwiftShader string); tick 120 gave sha256
  `86ede08b4258402e73ca572e835987dc1e16188f5b6da0ea2990ccb54c7d3150` on two separate runs. Without
  the flag, in this container (no GPU),
  `pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --backend three`
  exited 4, wrote no file, and printed: `WebGL is not hardware-backed: the renderer is "ANGLE
(Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", a
software one. Run where a GPU is available, or pass --allow-software-gl to take the picture with
SwiftShader anyway`. With `--json` the result was `"ok": false`, `"exitCode": 4`,
  `"refused": "software_gl"` and the renderer string. The path that writes a PNG on hardware WebGL
  could not be run here (no GPU); `engine/tools/screenshot.test.ts` covers the refusal and the
  software-GL path.
- **Met: the diff for this release changes nothing in `kits/platformer`.**
  `git diff d9da45fbf7a82d0bdc13491aa810e0701fc3a24b -- kits/platformer` (the last 0.5 commit
  against the 0.6 close-out) printed nothing, and `git diff --stat` for that path was empty.
- The four checks pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (81 test files,
  984 tests). Every run file of both games passes `pnpm -s cli run` (exit 0).
- Re-checked at `030da95` (after a fix that keeps the Vite client's websocket off the shared port
  24678): the four checks pass (81 files, 984 tests), all seven run files exit 0, the browser smoke
  and parity tests pass (12 tests), `screenshot --backend three --allow-software-gl` at tick 120
  gave the same sha256 `86ede08b...` and `matchesHeadless: true`, the no-flag run exited 4 with
  `refused: "software_gl"` and wrote no file, and `kits/platformer` is still unchanged since 0.5.

### Deviations from the roadmap

- **Additions not in the roadmap:** the shared `CameraFollower` in core, the `frame()` and
  `background` view hooks, the external-package table, a canvas fit helper for WebGL, and
  `zoom` honoured by the 3D camera.
- **Screenshots on software WebGL** are allowed behind `--allow-software-gl`. The roadmap only asks
  that a software fall-back is caught; the flag lets CI and this container take 3D pictures at all.

### Outstanding issues

- The 3D backend draws no HUD and no particles, and same-layer entities share a depth plane, so
  their list order is not kept.
- `zoom` is honoured in 3D but still ignored in 2D.
- A screenshot on hardware WebGL has not been taken (no GPU in the build container), so PNG
  repeatability across GPUs is untested.
- The browser play check in 3D is a committed smoke test plus a manual Playwright script; the
  smoke test accepts SwiftShader.
- Map `layers` sit behind the tiles in 3D but over them in 2D, and the lab needs a small
  `camera3d.layerDepth` (0.25) because the kit's draw layers go up to 20 (items 72-74).
- Done-when item 3 is met only on software WebGL (item 75).

## Engine 0.5

Platformer kit. Built on branch `engine/build-0.15`; not tagged (tagging is the owner's call).

### What was built

- **A kit hook replaces the tools' kit table (item 44).** Each kit exports `kit` from
  `kits/<name>/kit.ts`, a `KitDef` (`engine/core/kit.ts`, checked by `defineKit`): its name, content
  kinds, named rules and `strictMutants?`. `engine/tools/kits.ts` finds a game's kit by its
  `game.json` kit name through `engine/tools/kit-list.ts`, which `pnpm docs:gen` generates from the
  kit folders and `pnpm docs:check` checks. `KIT_KINDS` and `KIT_RULES` are gone.
- **Strict mutants (item 41).** A run file may list the rules it is meant to guard (`guards`,
  checked against the kit's rules). For a kit that opts in (`strictMutants: true`), `mutants` exits
  4 when a run does not guard a rule it lists. `mutants games/<game>` checks every run file of a game
  and reports which runs guard each rule; for a strict kit an unguarded rule is exit 4 as well. The
  top-down kit does not opt in and still only reports.
- **The Canvas2D camera (item 51).** `SkinnedCanvasPresenter` keeps camera state (never in a kit,
  a frame or a hash) and frames each picture from the frame's camera hint, else the skin's camera:
  follow an entity, a deadzone box round the centre, an integer fixed-point lerp (1 snaps), and a
  clamp to the hint's new optional `bounds` or the map (a smaller area is centred). `CameraHint`
  gained `deadzone`, `lerp` and `bounds`. `zoom` is still ignored. The demo's pictures and hashes
  did not change.
- **`kits/platformer`.** Two content kinds: `level` (a JSON header plus a `.map.txt` grid of a
  generic legend: solid, brick, bump blocks, one-way platforms, coins, hazards, the start, the goal,
  actor spawns and mini-game triggers, with a `scroll` mode of `right`, `free` or `none`) and
  `profile` (the player's movement numbers in whole sub-pixels, 1/256 px, and speeds in 1/4096 px
  per tick, plus actor types such as `walker` and `shell` whose behaviour is set by data). Cross-file
  checks require one start, one goal, a known profile and known actor types. A tiny fixture level
  and the default-runner profile live in `kits/platformer/__fixtures__/`.
- **The platformer world.** `PlatformerWorld` plays a level with SMBC-style whole-number physics:
  walk and run caps, friction, skid, jump tiers by take-off speed, variable jump through hold
  gravity, a fall cap, solid and one-way tiles, ceiling bumps and level bounds. Level objects: coins,
  bump blocks (coin, coins, power-up, life or an actor), breakable bricks, hazards and pits, hit
  points with invulnerability ticks, lives, a goal and the scroll-right lock. Actors wake near the
  view, turn at walls (and at ledges for `turnAt: ledges` types), are stomped into their `stompInto`
  type with a bounce, are kicked as shells, and a moving shell defeats other actors. The level ends
  `cleared` or `failed`. **32 named rules** (`MOVEMENT_RULES` and `OBJECT_RULES` in `rules.ts`),
  each fails a kit test when it is off. `snapshotWorld` gives the JSON-safe, hashed snapshot and
  `platformerGame` the headless contract.
- **Golden traces against SMBC.** `kits/platformer/golden.test.ts` replays six scripted inputs
  (walk, run then skid and let go, a tap jump, a held jump, a running jump over a gap into a wall,
  a jump into a ceiling) and matches SMBC REMIX v0.4.73 (commit `e0eeee7`) tick by tick in the
  body's x, y, vx and vy. The traces were recorded with SMBC's headless `runSim` and its default
  runner on our own 48x15 test map. The generator, the command and the provenance are in
  `kits/platformer/__fixtures__/golden/README.md`. SMBC is not a dependency: the test reads only the
  committed JSON.
- **The mini game hook.** `engine/core/minigame.ts` is a pure contract in the style of SMBC's
  `MiniGameDef` (`MiniGameDef`, `MiniGame`, `MiniGameResult` `pass` | `fail` | `quit`,
  `miniGameTable`). `engine/core/minigame-scene.ts` (`miniGameScene`) is the browser side a game's
  glue pushes over a level. A platformer level's `!` cells are triggers: the world pauses for the
  round (headless too), keeps the round's snapshot in its own, and applies the outcomes listed for
  the result in the level data (`coins:<n>`, `life`, `clear`, `respawn`, `open:<col>:<row>`). The
  kit defines no mini games; the game supplies them. This adds the named rule `mini-games`.
- **Presentation.** `kits/platformer/present.ts` (`presentWorld`) describes each tick as a
  read-only `PresentFrame`: the terrain map through a `MapTracker` (sent again when a block is
  used, a brick breaks or a gate opens), the runner, actors, coins, goals, triggers, block bounces
  and remains with animation states and tags, placed events, HUD status, and a camera hint that
  follows the runner inside the scroll lock. While a mini game runs, its own frame is shown.
  Presentation state lives in `PlatformerPresentState`, outside the world, so hashes do not change.
- **`games/platformer-lab`.** A test game on the kit. It plays a byte-identical copy of the kit's
  fixture level first (`lab.test.ts` fails if the copy drifts), then five small levels that each
  put one group of rules to work. Six run files (`start-to-goal`, `moves`, `objects`, `shells`,
  `walkers`, `mini-game`) together guard all 32 rules, with golden hashes, and backend parity
  covers them. In the browser it plays through `SkinnedCanvasPresenter` and an original
  placeholder skin (flat NES-style frames as text, the camera following with a 32x48 deadzone and
  lerp 0.25), with keyboard, gamepad and touch. It pushes `miniGameScene` for its own tiny "stop the
  bar" mini game. It has agent docs, a module page, an `llms.txt` link and a platformer section in
  the scaffold-game skill.

### Choices made

- **Orchestrator defaults for open feedback items.** The owner had not answered items 41, 44 and
  51 when 0.5 started, so the build took these defaults (the owner can still overrule them):
  - **41 (make weak rules fail):** yes, but per kit. A kit opts in with `strictMutants: true`, the
    platformer kit does, and the top-down kit stays report-only, so the demo's single run file
    still passes.
  - **44 (replace the kit table with a hook):** yes. Each kit exports a `KitDef`, and the tools'
    list of kits is generated by `pnpm docs:gen` (`engine/tools/kit-list.ts`), so adding a kit
    needs no hand edit in `engine/tools`.
  - **51 (camera zoom, deadzone, lerp, tint):** deadzone, lerp and clamping were done in 0.5 for
    the platformer. `zoom` stays ignored (honouring it means scaling the map cache and every
    sprite), and the demo keeps `clamp: false`.
- **The trace approach.** Golden traces were recorded once from SMBC's own headless runner, not
  from a port of its code. A small Vite module runner, using this repo's Vite with SMBC as the
  root, was needed because SMBC's level index uses `import.meta.glob`. Nothing was installed in or
  written to the SMBC checkout. The generator is kept as text in the fixtures' README and the test
  reads only the committed JSON, so CI never needs SMBC. One fix came from the traces: the player
  now starts as SMBC's does, not yet on the ground, so tick 0 is an air tick.
- **SMBC behaviour left out of the kit**, and kept out of the trace scripts: character-specific
  moves (crouch, slides, wall moves, flutter, air jumps, cut jumps), swimming, power states,
  running over one-tile gaps, coyote time and start modes other than standing. Also simplified: a
  power-up is given at once, a bump does not hit actors on the block, actors do not turn at each
  other, a respawn is immediate, and there is no score or timer. The list is in
  `kits/platformer/CLAUDE.md`.
- **The physics profile is data**, a content kind of its own, not constants in the kit. Enemy
  behaviour (speed, stompable, `stompInto`, kickable, harms, `turnAt`) is set per actor type in
  the profile.
- **The browser fixture lives in a lab game.** The roadmap puts the fixture level in
  `kits/platformer`. Browser play needs a skin, an entry page and glue, which are game content, so
  they live in `games/platformer-lab`, which plays a checked copy of the kit's fixture.
- **Two cameras with a set precedence.** The world keeps its own view (`scrollX`), which decides
  the scroll lock and when actors wake. The picture's camera is the presenter's: it follows the
  runner with a deadzone and lerp, inside the hint's `bounds` (the scroll lock). A frame hint's
  values win over the skin's camera defaults.
- **Mini games are a core contract, not a kit part**, so another kit can host them. The trigger
  outcomes are a closed list in level data.

### How to try it

```sh
pnpm -s cli validate games/platformer-lab --json
pnpm -s cli run games/platformer-lab/runs/start-to-goal.run.json --json
pnpm -s cli run games/platformer-lab/runs/start-to-goal.run.json --disable-rule variable-jump --json
pnpm -s cli mutants games/platformer-lab --json
pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --json
pnpm test kits/platformer games/platformer-lab tests/runs tests/architecture
pnpm dev   # then open /games/platformer-lab/ (arrows move, Z jumps, X runs)
```

### Done when

Each item was checked by running the commands on 2026-11-02 at commit `5e8282a`, the last 0.5
code commit.

- **Met: a headless run file plays a fixture level from start to goal, with the same state hashes
  every time.** `pnpm -s cli run games/platformer-lab/runs/start-to-goal.run.json --json` was run
  twice: exit 0, `passed: true`, 17 assertions and 3 invariants each time, and the two outputs were
  byte-identical. The hashes were tick 0 `9ed173e616121d27`, 60 `522eeb1256650932`,
  120 `50397aac3f28ba17`, 180 `9c9848d8d2b9a2b2` and 240 `7137cbde89f0fd44`, the same as
  `start-to-goal.hashes.json`. The run plays `tiny`, the copy of the kit's fixture level, and its
  assertions check the coins, the used block, the position at the goal and the outcome `cleared`
  (at tick 226). `tests/runs/run-files.test.ts` compares every run with its golden hashes.
- **Met: golden traces match SMBC tick by tick.** `pnpm vitest run kits/platformer/golden.test.ts`
  passed (8 tests: one per script, one that every trace has the recorded map, fields and length, and one that a changed profile number is reported at its first differing tick). As a fresh check, the
  traces were regenerated from SMBC at `e0eeee7` (`git -C /home/user/jelloshooter848/smbc rev-parse
--short HEAD`) with the README's `run.mjs` and `generate.ts` in a scratch folder
  (`GOLDEN_OUT=$PWD/out node run.mjs $PWD/generate.ts`, then Prettier). All six outputs were
  byte-for-byte the committed `*.trace.json` files, and the SMBC checkout was left clean
  (`git status --short` empty).
- **Met: for every named rule, at least one run file fails when that rule is off.**
  `pnpm -s cli mutants games/platformer-lab --json`: exit 0, `strict: true`, all 32 rules guarded
  (`unguarded: []`), and no weak rule in any of the six runs. Each rule is guarded by 1 to 6 runs;
  for example, `variable-jump` off fails `start-to-goal` at tick 80 (`player.y is 23168, expected
21320`, exit 4). A planted `games/platformer-lab/runs/planted-weak.run.json` (30 ticks of walking
  right, one assertion on the level id, `"guards": ["skid"]`) made the same command exit 4:
  `planted-weak.run.json: weak: does not guard skid (listed in guards)`. Run alone,
  `pnpm -s cli mutants games/platformer-lab/runs/planted-weak.run.json` also exited 4
  (`weak: does not guard skid`). After the planted file was deleted, the game check exited 0 again.
- **Met: the kit has no imports from any backend and no drawing calls.**
  `tests/architecture/dependency-rule.test.ts` and `tests/architecture/no-drawing.test.ts` pass
  (95 tests). A planted `kits/platformer/planted.ts` that imports `@engine/backends/canvas2d` and
  calls `ctx.fillRect(0, 0, 16, 16)` failed both (2 failed, 93 passed). The dependency test said
  "kits/platformer/planted.ts imports '@engine/backends/canvas2d': kits may not import
  engine/backends (allowed: kits, engine/core)", and the drawing scan said
  `kits/platformer/planted.ts:4: ctx.fillRect(0, 0, 16, 16);`. `eslint` on the file reported the
  same `layers/dependency-rule` error. A second planted file importing `@engine/core/gfx/renderer`
  and calling `r.rect(0, 0, 16, 16, '#000000')` also failed both ("kits never draw or play
  sound"). Both planted files were deleted, and the two tests passed again.
- **Met: a fixture level plays in the browser through Canvas2D and a placeholder skin.** After
  `pnpm build`, `vite preview` served the page and a Playwright script opened it in Chromium at
  `/games/platformer-lab/` (800x600). It drew the fixture level through the placeholder skin
  (canvas 800 wide, 381205 non-black pixels, 10 colours). Holding ArrowRight for a second, then Z
  for a jump, changed the picture. There were no console errors or page errors. Running
  `pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --json`
  twice wrote the same 256x240 PNG both times (sha256
  `2c6cc55462fd9c74d0392e6d2471d2020743b8c1b0abd719a8e094a4b54e9c2d`), with
  `matchesHeadless: true` (hash `50397aac3f28ba17`). `tests/runs/backend-parity.test.ts` plays
  every lab run presenting each tick through the null backend and through `LabPicture` (Canvas2D),
  and both give the golden hashes.
- The four checks pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (76 test files,
  870 tests), and `pnpm docs:check` passes. Every run file of both games passes
  `pnpm -s cli run` (exit 0), and `pnpm -s cli mutants games/demo` exits 0.
- **Re-checked when 0.5 was finalized** (at `4e97131`): the four checks pass again (76 files, 870
  tests), every run file of both games exits 0, `mutants games/platformer-lab` exits 0 with
  `strict: true`, `start-to-goal` gives byte-identical output twice and exits 4 with
  `variable-jump` off, `golden.test.ts` passes (8 tests), and a fresh Playwright check of the built
  page drew an 800-wide canvas that changed after ArrowRight and Z, with no console errors.

### Deviations from the roadmap

- **The browser fixture is a lab game.** The fixture level stays in `kits/platformer` as the
  roadmap says. Playing it in the browser is done by `games/platformer-lab`, which holds a checked
  byte-identical copy of the fixture, five more rule levels, a skin and a test mini game.
- **The camera's deadzone, lerp and clamp were added to the Canvas2D presenter** (item 51). The
  roadmap's 0.5 scope only mentions the camera as part of SMBC's code to extract.
- **Additions not in the roadmap:** the kit hook (item 44), strict mutants with `guards` and a
  game-wide `mutants` check (item 41), and a pure mini game contract in `engine/core` with a
  browser scene helper.
- **SMBC's behaviour is not all there.** The kit keeps the rules the traces cover and the level
  objects a test level needs. Character-specific moves, swimming, power states and the other items
  under "Choices made" were left out.

### Outstanding issues

- `zoom` in camera hints and skins is still ignored by the Canvas2D presenter.
- The browser play check is a manual Playwright script, as in 0.4, not a committed test. The CLI
  screenshot and the backend-parity test cover drawing in Chromium and the Canvas2D path.
- The lab plays its levels in a fixed order, so a run that checks a later level replays every
  earlier level first. Its runs are long (up to 3015 ticks), and a change to an early level moves
  every later tick.
- The lab has no sounds. Its skin maps every event to an effect only.
- The demo's top-down kit is not strict, and its one run file guards only `doors-change-room`.
- Feedback items 52-64 (`docs/FEEDBACK-LOG.md`) ask the owner about these choices.

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
