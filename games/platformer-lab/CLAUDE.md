# games/platformer-lab

The platformer kit's test lab (Engine 0.5): the kit's fixture level played start to goal, six
small levels that each put one group of the kit's named rules to work, and run files that guard
every rule (`pnpm cli mutants` passes, the kit is strict). It plays in the browser through the
Canvas2D backend and a placeholder skin, and (Engine 0.6) through the Three.js backend with a
low-poly `three` skin. It is a test game, not Worlds Within: content, not
engine, and nothing in `engine/` or `kits/` depends on it.

## Files

- `game.json`: the manifest (kit `platformer`, 256x240, seed 1, `headless.ts`, `view.ts`).
- `content/levels/<id>.json` + `<id>.map.txt`: levels (format: `kits/platformer/CLAUDE.md`,
  Content kinds). `tiny.json`/`tiny.map.txt` are **byte-identical copies** of the kit's fixture
  level (`kits/platformer/__fixtures__/`); `lab.test.ts` fails if they drift, so change the kit's
  fixture and copy it, never edit the copy. The lab's own levels, one group of rules each:
  - `lab-1-moves`: a plateau to fall from (`fall-cap`), a runway for running, letting go and
    skidding (`run-speed`, `run-hold`, `friction`, `skid`), a block row to bump (`ceiling-bump`),
    one-way platforms (`one-way-platforms`) and a walk back against the view's edge (`scroll-lock`);
  - `lab-2-objects`: a brick over the start (`brick-break`), a walk against the level's left edge
    (`level-bounds`, `"scroll": "free"`), a hazard and a pit to die in once each (`hazards-kill`,
    `pits-kill`), a coin, the goal past the pit;
  - `lab-3-shells`: a still shell kicked into a walker (`shell-kick`, `shell-hits-enemies`), a pit,
    a shell-walker stomped into a shell (`stomping`, `stomp-bounce`), woken late (`actors-wake`);
  - `lab-4-walkers`: a walker in a pen (`walkers-turn`), a ledge-walker on an island (`ledge-turn`),
    a walker that walks through the player (`enemy-touch-hurts`, `invulnerability`) and one asleep
    on a far shelf (`actors-wake`);
  - `lab-5-trigger`: a mini-game trigger (`mini-games`) whose pass gives 5 coins and opens the
    wall to the goal (`open:9:8`) and whose fail puts the player back on it;
  - `lab-6-feel` (Engine 0.16 T1, profile `lab-feel`): a ledge to walk off and jump from late
    (`coyote-time`) over a three-tile pit, the jump let go early (`variable-jump`'s `jumpCut`), a
    checkpoint `K` and a hazard to die on once (`checkpoints`: the respawn is on the
    checkpoint), then a jump over the hazard to the goal;
  - `lab-7-boss` (Engine 0.16 T2, profile `lab-boss`, `"clear": "boss"`, no goal): a walled
    16x15 arena with the `mini-boss` (`b`) at the right; beating it clears the level.
- `content/profiles/<id>.profile.json`: physics profiles. `runner.profile.json` is the kit's
  fixture profile, byte for byte (tiny uses it); `lab-runner` is the same runner with 3 lives and a
  `ledge-walker` type (the lab's own levels use it); `lab-feel` (Engine 0.16 T1, `lab-6-feel`
  only) is `lab-runner`'s player with `coyote` 6 and `jumpCut` 8192 and no actor types;
  `lab-boss` (Engine 0.16 T2, `lab-7-boss` only) is `lab-feel`'s player with 3 hit points and
  90 ticks of invulnerability, and three actor types: `mini-boss` (24x24, a `boss` form: 4 hp,
  `hitInvuln` 40, `defeatTicks` 60; its pattern idles, telegraphs `shoot`, fires a `bolt`, idles,
  telegraphs `charge` and charges to the wall; at 2 hp its phase idles 15, telegraphs `drop`,
  drops a `rock` (spread 2), telegraphs `leap` and leaps), `bolt` (8x8, `projectile: flies` at 12288) and `rock` (12x12, `projectile: falls`). The
  older levels keep `lab-runner`, so their runs and hashes did not move. Profiles are in their own folder, not in
  `content/levels/`, because the `level` glob `content/levels/*.json` would claim them too.
- `content/sprites/lab-placeholders.txt` (palette `content/palettes/lab-placeholders.json`):
  original flat NES-style placeholder frames for every tile, kind and HUD icon, and the mini
  game's bar. `content/sprites/lab-font.txt`: the HUD's 8x8 digits.
- `content/skins/canvas2d.json`: the skin (format: `engine/core/present/skin.ts`). `kinds` maps
  `runner` (every `RUNNER_ANIMS` state), each actor type of both profiles (every `ACTOR_ANIMS`
  state), `coin`, `goal`, `trigger`, `checkpoint` (a grey pole and flag, `byTag` `active`: the
  `checkpoint-on` frame, a red flag), `bump-block` and the mini game's `bar-cell` and `bar-marker`,
  and (Engine 0.16 T2) `mini-boss` (every `BOSS_ANIMS` state: `mini-boss`, `mini-boss-tele` (yellow
  angry eyes, blinking while it telegraphs), `mini-boss-hurt` (white, flashing), `mini-boss-dead`),
  `bolt` and `rock` (every `ACTOR_ANIMS` state, one frame each); the `boss-*` events: a yellow
  tint on a telegraph, a small shake on an attack, a white flash, a shake and a 4-frame
  `hitPause` on a hit, a long shake, a flash and an 8-frame `hitPause` on the defeat (the same in
  `three.json`, which has low-poly `mini-boss`, `bolt` and `rock` meshes);
  `tiles` every `PRESENT_TILES` character; `events` every `PlatformerEvent` type (effects only:
  the lab has no sounds); `hud` `hp` (hearts), `coins` and `lives` (icon and number in
  `lab-font`); `camera` follows the runner with a 32x48 deadzone and lerp 0.25 (the kit's hint
  adds the scroll lock as `bounds`).
- `content/skins/three.json` (Engine 0.6): the 3D skin, low-poly meshes written as text. `meshes`
  holds compound meshes (`runner`, `walker`, shared by `walker` and `ledge-walker` in their own
  colours, `shell-walker`, `shell`, `coin`, `goal`, `trigger`, `checkpoint` (grey, red when
  `active`, by `byTag`), `brick`, `bump`, `slab`, `spikes`,
  `bar-marker`); `kinds` maps every kind the 2D skin maps (`bump-block` and `bar-cell` are plain
  boxes); `tiles` every `PRESENT_TILES` character but `.` (open air is the sky: no block): `#`
  and `u` boxes, `B` a brick with a dark mortar course, `?` a block with a mark on its face, `=`
  a thin 4 px slab, `^` a row of cones on a base. `events` keeps the 2D skin's flashes, tints and
  shakes (particles are not drawn in 3D); `camera` is the 2D skin's (follow `runner`, deadzone
  32x48, lerp 0.25); `camera3d` `fov` 40, `tilt` 4, `layerDepth` 0.25 (so the kit's `PF_DEPTH`
  layers 0..20 sit within 5 px of the blocks' plane and do not drift in perspective). A 3D entry
  has one mesh per kind, not per state: remains, `hurt`, and the bar's `zone` cells look like the
  kind's other states (a known gap of the 0.6 skin format).
- TypeScript is glue only:
  - `content.ts`: `labKinds`, `loadLab(files)`, `labStages(content)` (the levels in play order:
    the order of `content/campaigns/main.campaign.json` (Engine 0.10, gap G2): `FIRST_LEVEL`
    (`tiny`) first, then `lab-1-moves` to `lab-5-trigger`, the order the lab played before, so no
    run file or golden hash moved, and (Engine 0.16 T1) `lab-6-feel`, then (T2) `lab-7-boss`
    last, after every older run's end; each paired with its profile by the kit's `contentStages`),
    `labSkin`,
    `labSkin3d` (the `three` skin), `mustLoad` (the engine's, naming the lab);
  - `minigame.ts`: `STOP_BAR` (`stop-bar`, "STOP THE BAR"), the lab's one original test mini
    game: a marker sweeps along a bar of `cells` cells, one cell every `every` ticks; attack on
    the `zone` cells (placed by the round's seed) passes, anywhere else fails, select quits, and
    `ticks` ticks without a press fail. Its numbers come from the trigger's `params`, whose shape
    is `stopBarParamsSchema` (its `paramsSchema`: each a whole number of at least 1, all
    optional, nothing else), checked by `validate`. Its
    `present()` lays the bar out as `bar-cell` entities (`idle`/`zone`) and a `bar-marker`
    (`idle`, then its result). `LAB_MINI_GAMES` is what the worlds are given;
  - `headless.ts`: `createGame(content, seed, opts?)`, the headless contract, a few lines: the
    kit's `LevelSequence` over `labStages(content)` with the run's seed, switched-off rules and
    `LAB_MINI_GAMES` (`LabGame` and `LabSnapshot` are the kit's `LevelSequence` and
    `SequenceSnapshot`), and `miniGames(content)` (`LAB_MINI_GAMES`, for `validate`, Engine 0.10
    gap G16). The level flow is the kit's (`kits/platformer/CLAUDE.md`, Level
    sequences): once a level is `cleared` or `failed` it waits `LEVEL_PAUSE` (60) ticks, ignoring
    input, then starts the next level (after the last, `tiny` again) or the failed one afresh,
    each a new `PlatformerWorld`. The snapshot is the kit's (`snapshotWorld`) plus `stage` (the
    level's place in the order) and `pause`;
  - `picture.ts`: `labLook(content)` (the skin, its sheets and the picture size: what
    `canvasDisplay` takes; the sky is the skin's `background`, `#5c94fc`, Engine 0.15 gap G36), `labFrames(screen)` (the engine's `FrameStream` over
    the kit's `platformerFrames`: frozen frames, a fresh present state per world: the one stream
    of frames every backend gets), `labPicture(presenter, screen)` (a `FramePicture`:
    `draw(world, events)` presents a `labFrames` frame on any presenter and returns it) and
    `labCanvasPicture(r, look)` (the same onto a `SkinnedCanvasPresenter` on `r`);
  - `picture3d.ts`: `labLook3d(content)` (the `three` skin, whose `background` is the sky, and picture size, as the 3D
    backend's `threeDisplay` and `threeScenePresenter` take them). No Three.js import: the 2D page
    bundles none;
  - `view.ts`: `createView` for `pnpm cli screenshot`, the engine's `frameView`
    (`@engine/core/view`, Engine 0.7 T7, gap G26): `render(r)` draws through
    `labCanvasPicture`, `frame()` (the view contract's frame hook) returns the `labFrames` frame,
    both with the events since the last draw (the engine's `PendingEvents`: dropped when the level
    changes, as the scene does);
    `pnpm cli screenshot --backend three` clears to the `three` skin's `background`;
  - `main.ts`: the page, a dozen lines: the engine's `bootBrowserGame` (keyboard, gamepad, the
    touch pad, the scene stack, the fixed loop, the `?backend=` choice and the 2D/3D toggle) with
    `canvasDisplay(canvas, labLook(content))` (`@engine/backends/canvas2d`) and, only for
    `?backend=three`, `threeDisplay(canvas, labLook3d(content))` from a dynamic
    `import('@engine/backends/three')` (its own chunk with Three.js; without WebGL 2 the page says
    so and links to 2D); the scene is `new HostScene({ stack, game: createGame(content, seed),
picture })` (`@engine/core/shell`) over the game itself (the kit's `LevelSequence` is a
    `HostedGame`; `scene.ts` went away in Engine 0.10, gap G37): it pushes the engine's
    `miniGameScene` when a trigger starts a round (stepping the lab, so the world applies the
    outcome as headless), pops it on the result, and draws `labPicture(display.presenter, screen)`
    either way.
    (Engine 0.7 T6 moved `backend.ts`, `main3d.ts` and the hand-written boot, scene and frame
    stream into the engine: gaps G21-G25 in `docs/reports/stacking-test.md`);
  - no `files.ts`: `main.ts` imports its data files from `virtual:game-files` (the build's plugin, `build/game-files.ts`; no `files.ts` since Engine 0.14 T2).

## Run files

Every run starts on `tiny` with seed 1, so a run that checks a later level plays the earlier ones
with the same script first (the scripts are the same up to the level each run checks). Each
lists the rules it is meant to guard in `guards`; together they guard every kit rule.

| run             | ticks | ends at                        | guards                                                                                                                                   |
| --------------- | ----- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `start-to-goal` | 240   | `tiny` cleared at tick 226     | gravity, walk, air-control, jump, jump-by-speed, variable-jump, solid-tiles, ceiling-bump, coins-collect, bump-blocks, goal-clears-level |
| `moves`         | 975   | `lab-1-moves` cleared (964)    | fall-cap, run-speed, run-hold, friction, skid, one-way-platforms, ceiling-bump, scroll-lock                                              |
| `objects`       | 1657  | `lab-2-objects` cleared (1647) | level-bounds, brick-break, hazards-kill, pits-kill, coins-collect                                                                        |
| `shells`        | 2107  | `lab-3-shells` cleared (2097)  | actors-wake, stomping, stomp-bounce, shell-kick, shell-hits-enemies                                                                      |
| `walkers`       | 2688  | `lab-4-walkers` cleared (2678) | actors-wake, walkers-turn, ledge-turn, enemy-touch-hurts, invulnerability                                                                |
| `mini-game`     | 3015  | `lab-5-trigger` cleared (3005) | mini-games (a failed round, then a passed one; each round's last tick read from `endedRound`)                                            |
| `feel`          | 207   | `lab-6-feel` cleared (198)     | coyote-time, checkpoints, variable-jump (`start: { "stage": 6 }`)                                                                        |
| `boss`          | 850   | `lab-7-boss` cleared (844)     | boss-pattern, boss-phases, boss-stomp-hits, boss-hit-invuln, boss-defeat-clears, boss-projectiles (`start: { "stage": 7 }`)              |

- `start-to-goal.run.json` checks the coins (1 from the bump block at tick 82, 2 at 193), the
  changed tiles, the position at the goal and `outcome` `cleared`; its invariants hold one life,
  two hit points and stage 0 all along.
- `feel.run.json` (Engine 0.16 T1) starts on `lab-6-feel` (`start: { "stage": 6 }`, so it does
  not replay the earlier levels): it walks off the ledge (tick 60, `player.coyote` 6), presses
  jump 3 ticks later (a `jump` at tick 63, only with coyote time), lets go at tick 71
  (`player.vy` -6656: capped at -8192 by `jumpCut`, then one tick of gravity, 1536), touches the checkpoint
  (tick 103, `checkpoint` `{ col: 10, row: 8 }`), dies on the hazard and respawns on the
  checkpoint (tick 134, `player.x` 43008), then jumps the hazard to the goal (tick 198, 2 lives).
- `boss.run.json` (Engine 0.16 T2) starts on `lab-7-boss` (`start: { "stage": 7 }`). Its input
  was found by a throwaway reactive bot (walk at the boss, jump when near, back off while it is
  invulnerable, jump an incoming bolt) and written in as plain steps. The boss telegraphs `shoot`
  (tick 31), fires bolt 2 (61), which flies level (`actors.1.y` 55296 at 62 and 90: with
  `boss-projectiles` off it falls) and is gone at the left wall (116); the first stomp (117,
  `boss-hit` hp 3, `invuln` 40; 36 left at 121, when the charge starts); the second (298, hp 2)
  starts phase 1 (`phase` 1; a `drop` telegraph at 314, rock 4 dropped at 329 and gone on landing
  by 331); the third (343, hp 1) and, after leaps, the last (784: `boss-defeat` `ticks` 60, mode
  `defeated`); the level is still playing at 843 and `cleared` at 844 with no actor left.
  Invariants: stage 7 and 3 lives (two hurts on the way, never a death).
- `mini-game-start.run.json` (Engine 0.14, gap G9) is `mini-game`'s own part from the trigger
  level's tick 0 (`start: { "stage": 5 }`; the full run reaches it at tick 2738), with the same
  hashes as the full run from there. `headless.ts` exports `starts(content)` (one stage per level,
  `tiny` first) and `createGame` passes `opts.start` to the kit's `LevelSequence`.
- Run one: `pnpm -s cli run games/platformer-lab/runs/start-to-goal.run.json --json`. All of them
  and the rules: `pnpm -s cli mutants games/platformer-lab --json` (exit 0: no weak or unguarded
  rule). See one rule fail: `pnpm -s cli run <run> --disable-rule <id> --json`.
- `runs/<name>.hashes.json` are the golden state hashes (`tests/runs/run-files.test.ts`), and
  `tests/runs/backend-parity.test.ts` plays every lab run presenting each tick through the null
  backend, through `labCanvasPicture` (Canvas2D) onto a recording renderer and through
  `labPicture` onto `threeScenePresenter` (the Three.js scene builder, no WebGL): all three give the golden
  hashes. The 3D pass also collects every kind and tile shown, and a test fails if the `three`
  skin lacks one (or any entity is drawn as a fallback box): add the entry when a level or the
  kit shows something new. After a change meant to change the state: `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`, and
  commit the hashes.
- Changing a level or the script moves every later tick: re-find the ticks with `pnpm -s cli dump
<run> --tick N --json`, keep each run's assertions on what its rules decide (a position, a
  speed, an event, a count), and check `mutants` again.

## How to run

- `pnpm dev` and open `/games/platformer-lab/`: arrows (or the touch pad) move, Z jumps, X runs
  (and stops the bar in the mini game). `pnpm build` builds it into `dist/games/platformer-lab/`.
- In 3D (Engine 0.6): open `/games/platformer-lab/?backend=three` (the `3D` link at the top left
  of the page, or the root launcher's `3D` link from the `ww-alternate` meta tag in `index.html`).
  The same input, loop, scenes and frames as 2D; only the picture is the Three.js backend with
  the `three` skin (the mini game's bar too). Without WebGL 2 the page says so and links to 2D.
  `tests/browser/lab-3d.test.ts` is the smoke test: headless Chromium opens it from the Vite dev
  server and from a build under a sub-path base, checks the WebGL 2 context and logs its renderer
  string (SwiftShader here: it checks that 3D works, not hardware; `pnpm cli screenshot --backend
three` is the one that refuses software rendering), holds right and jumps and checks the picture
  changes far more than when idle, with no page errors. It skips where Chromium is missing.
- `pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --json`
  (needs Chromium; `matchesHeadless` must be true).
- `pnpm test games/platformer-lab` runs `lab.test.ts`: the fixture copies are byte-identical, the
  level order, a broken field named by file and field, the skin covers every tile, kind, state,
  event and HUD value, the `three` skin has a block for every solid tile (a thin slab for `=`), a
  mesh for every kind and the 2D skin's framing, the view's `frame()` gives valid frozen frames
  with the events since the last call and changes nothing, the view draws with the placeholder sheet and font, the level change after
  `LEVEL_PAUSE` (cleared: next level; failed: the same again), equal snapshots on two runs, the
  mini game's pass, fail, quit and time-out, its frame against the schema, and the picture showing
  it while a trigger runs it, and a `HostScene` over `createGame` drawing through the drawer it is given (the
  `?backend=` choice and toggle link are tested in `engine/core/shell/shell.test.ts`).

## Imports

- Allowed: relative paths inside `games/platformer-lab`, `@engine/*` (core and backends) and
  `@kits/platformer`.
- Never: other games or other kits. Nothing in `engine/` or `kits/` imports from here.
- Game rules belong in data (levels, profiles, trigger params), not code. The level order and the
  pause between levels are glue in `headless.ts`.

## 2D backend choice

`?backend=pixi` draws the page through the PixiJS (WebGL) backend (`@engine/backends/pixi`, loaded
with a dynamic `import()`, its own chunk) and falls back to Canvas2D where WebGL is missing;
`?backend=canvas2d` or no query keeps Canvas2D, the default (Engine 0.16 T13b-4).
