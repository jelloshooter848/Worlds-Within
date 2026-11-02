# games/platformer-test

The stacking test's game (Engine 0.7, `docs/ROADMAP.md`, "0.7 The stacking test"): a small
original platformer built on `kits/platformer` with the engine as it is, to find out what is
missing. Every gap found while building it goes into `docs/reports/stacking-test.md` at once.
It is also a worked example for LLM users: this file says how it was built, step by step, and
how to add a level or a mini game room. Engine 0.7 is done (T9): every gap is fixed or moved to a
named release, and the glue review (the report's "Glue review") found this folder holds only
content, skins and thin glue.
At Engine 0.15 it grows into the platformer sample, `games/samples/platformer/`, and this folder
goes away (its run files move with it and stay green).

## The rule

This folder holds **only content, skins and thin glue** (DESIGN.md's rule of thumb: if two games
could use it, it is engine; if it is content, it is the game). Game rules go in data files
(levels, profiles), never in code here. Anything this game has to write that another game would
write too is a gap: log it in the report, and move it into the engine or the kit (or name the
release that will).

## Files

- `game.json`: the manifest: kit `platformer`, `uses: ["topdown"]` (for the door level's room),
  256x240, seed 1, `headless.ts`, `view.ts` (0.7 T7), content kinds `level`, `campaign`, `profile`,
  `room`, `palette`, `sprite`, `skin` and `sfx`. `index.html` is the page, so the root launcher lists
  `games/platformer-test/`, and its `ww-alternate` meta tag adds the launcher's `3D` link
  (`?backend=three`, 0.7 T8).
- `content/levels/<id>.json` + `<id>.map.txt`: levels (format: `kits/platformer/CLAUDE.md`,
  Content kinds, and `LEGEND` in `kits/platformer/legend.ts`), played in the campaign file's
  order. Four, all `"scroll": "right"`, each about a few kit rules:
  - `level-1`: a short, easy first level, 48x10 tiles: a bump block with a
    coin over the runway, two floor coins, a 2-tile gap, a 2-high step, a 3-tile gap with an arc
    of three coins over it, one `walker` (woken as the view nears it, stompable), a 2-high wall,
    a 1-tile gap and the goal.
  - `level-2` ("bricks and shells"), 56x11: three bricks overhead (one breaks), a one-way
    platform under three coins, a 4-wide, 1-deep trench with a `walker` pacing in it (it turns at
    the trench walls), a `shell-walker` that a stomp turns into a still `shell`, kicked back into
    the trench where it defeats the walker (and stays, bouncing), a 2-high block, a 5-tile gap
    that wants a running jump, and the goal tucked one tile up in the level's last column, so the
    player runs into the right edge and jumps into it.
  - `level-3` ("spikes, pits and lives"), 60x10: a spike (`^`) on the runway, a 3-tile pit, two
    `walker`s close together (the first hurts, the second is passed while invulnerable), a
    `ledge-walker` pacing a floating platform, a 3-spike pit, a 2-tile island with two coins, one
    more spike and the goal.
  - `level-4` ("the door"), 40x10: two floor coins, then a wall from the top of the level to the
    ground at column 22 with a mini-game trigger (`!`) in front of it at (21,8): the door. Its
    `triggers` entry starts the `vault` mini game with params `goal: defeat-all`, `ticks: 600`,
    `hp: 4`; a `pass` gives 5 coins and opens the wall's three lowest tiles (`open:22:6` to
    `open:22:8`; the trigger itself is emptied), a `fail` puts the player back on the door
    (`respawn`; step off and on again for another round). Past the wall, the goal.
- `content/campaigns/main.campaign.json` (Engine 0.10, gap G2): the play order as data, the
  engine's `campaign` kind (`engine/core/campaign.ts`): `level-1`, `level-2`, `level-3`,
  `level-4`, the order the levels were played in by id before, so no run file or golden hash
  moved. Reorder its `entries` (or set `start`) and the levels play in that order; a level not
  listed is not played, and an entry naming a missing level fails `validate` at
  `entries.<i>.level`.
- `content/rooms/vault.json` + `vault.map.txt`: the door's top-down room (`kits/topdown` room
  format, `kits/topdown/CLAUDE.md`, Room files): 16x11, four statues, a 2x2 pool, two knights
  (`n`), the hero's start at (2,5), `"title": "VAULT"` (the mini game's title, gap G15). It is a
  `RoomDef` like any top-down game's; nothing in it says it is a mini game (the level's trigger
  does).
- `content/profiles/hopper.profile.json`: the game's own physics profile (`hopper`): it started
  from the kit's fixture profile and was changed (a little slower walk and run cap, a slower
  walker, 2 hit points, 3 lives, a 6-tick jump buffer, a softer middle jump tier). Its actor
  types: `walker`, `ledge-walker` (`turnAt: ledges`), `shell-walker` (a stomp turns it into a
  `shell`) and `shell` (still, kickable at 12288). Profiles live in
  their own folder because the `level` glob `content/levels/*.json` would claim them too.
- Assets, all text (0.7 T7; `platformer-test.test.ts` fails on any other kind of file):
  - `content/sprites/hopper.txt` (palette `content/palettes/hopper.json`): original NES-style pixel
    art, one string per row, one character per pixel: the level tiles (`sky`, `ground`, `brick`,
    `bump`, `used`, `one-way`, `hazard`), the runner (12x16: idle, two walk frames, skid, jump,
    fall, hurt, dead), the actors (`walker`, `ledge-walker` in purple, `shell-walker` 16x24,
    `shell`, each with its flat or upside-down remains), `coin` (and its turn), `goal` (a flag),
    `door` (the trigger) and the HUD's `heart`, `hud-coin`, `hud-life` (8x8).
    `content/sprites/hopper-font.txt`: the HUD's 8x8 digits.
  - `content/sprites/vault.txt` (palette `content/palettes/vault.json`): the vault round: room
    tiles (`wall`, `floor`, `statue`, `water`), the hero (`down`/`up`/`side`, two frames each, three
    `attack` frames), his sword (`sword-up`, `sword-down`, `sword-right`), `poof-0..2`, the knight
    (two frames each way) and the HUD's `hp` heart and `hourglass`.
  - `content/sfx/*.json`: MML sound effects: `jump`, `coin`, `stomp` (also a brick, a kick and a
    knight beaten), `door` (the round starts and ends), `pass` (a level cleared), `fail` (a death,
    the hero's spin), `hurt`, `sword`. No song (optional in the task; none needed yet).
  - `content/skins/canvas2d.json`: the levels' skin (format: `engine/core/present/skin.ts`):
    every `PRESENT_TILES` character, `runner` (every `RUNNER_ANIMS` state, mirrored for left),
    every actor type of the profile (every `ACTOR_ANIMS` state), `coin` (`idle`, `pop`), `goal`,
    `trigger` (drawn as the door: the game's one trigger; gap G13), `bump-block`; every
    `PlatformerEvent` with effects and the sounds above; HUD `hp` (hearts), `coins` and `lives`
    (icon and number in `hopper-font`); camera follow `runner`, deadzone 32x48, lerp 0.25.
  - `content/skins/canvas2d-vault.json`: the vault round's skin: the top-down kit's tiles the room
    shows (`#`, `.`, `S`, `~`), `hero` (`walk`, `attack`, `hurt`, `dying`, `poof`), `sword`
    (`stab`), `poof`, `knight` (`walk`); the round's events (`mini-game`, `room`, `sword`, `hit`,
    `kill`, `hurt`, `dying`, `dead`); HUD `hp` (one heart per half heart) and `timeLeft` (an
    hourglass and the ticks left); `camera` `{ "clamp": false }`, so the 16x11 room stays under
    the HUD band where the kit's camera hint puts it (gap G29). The two kits' tiles (`#`, `.`, `B`, `=`) and their camera and HUD
    clash, so a round's frames get their own skin: a skin named `<backend>-<mini game id>` is
    that round's (`testSkins`, over the engine's `skinSet`), and the page and the view hand each
    frame to the presenter its `status.miniGame` names (the backend's `skinSetCanvasPresenter`,
    over the engine's `presenterBySkinSet`; gaps G14 and G34).
  - `content/skins/three.json` (0.7 T8): the levels' 3D skin, low-poly meshes written as text
    (compound meshes of boxes, spheres, cylinders and cones in world px): `runner` (cap, face,
    shirt, overalls, boots), `walker` (shared by `walker` and `ledge-walker` in their own
    colours), `shell-walker`, `shell`, `coin`, `goal` (pole and flag), `door` (the trigger:
    panelled wings and a knob), `bump-block` a plain box; tiles: every `PRESENT_TILES` character
    but `.` (open air is the sky, no block): `#` a block with a lighter top course, `B` a brick
    with mortar lines, `?` a block with a mark on its face, `u` a plain box, `=` a thin slab, `^`
    two rows of cones on a base. `events` are the 2D skin's sounds, flashes, tints and shakes
    (particles are not drawn in 3D); `camera` the 2D skin's; `camera3d` `fov` 40, `tilt` 4,
    `layerDepth` 0.25 (the lab's framing).
  - `content/skins/three-vault.json` (0.7 T8): the vault round's 3D skin. The room is **laid flat
    facing the camera**: a top-down room seen from the front, exactly as the 2D picture shows it,
    so the 3D backend needed no change of axes. Walls (`#`) and statues (`S`, a pillar on a
    plinth) stand forward as blocks; the floor (`.`) is a thin slab sunk 8 px behind them and the
    water (`~`) 2 px deeper, so the hero (tunic, cap and face toward the camera, a shield), the
    knights and the poofs stand out of the floor; the sword is a thin box filling its blade's
    box. `camera3d` `tilt` 8 (a little of the walls' tops shows). `camera` `{ "clamp": true }`:
    the round's frames carry the top-down kit's hint, and the 3D round presenter clamps, so the
    16x11 room is centred in the picture; 2D keeps it under its HUD band (`clamp: false`), but 3D
    draws no HUD (gap G33), so there is no band to keep clear. The difference is skin data.
- TypeScript is glue only (each file a few calls into the engine and kits; the glue review in
  `docs/reports/stacking-test.md` lists what each holds):
  - `content.ts`: `loadTest(files)` (the content kinds of the game's two kits,
    `kitContentKinds([platformer, topdown])` from `@engine/core/content/game-content`, over the
    kits' hooks), `testStages(content)` (the kit's `contentStages`: the levels in the campaign
    file's order, each with its profile), `testRooms(content)`, `testSkins(content,
backend)` (`{ level, rounds }`: the engine's `skinSet`, throwing when the backend has no
    skin). Art (`contentArt`), sounds (`contentSfx`) and `mustLoad` are the engine's (gap G4);
  - `picture.ts`: `testLook(content)` (the `canvas2d` skins, the sheets from the engine's
    `contentSheets`, size and `SKY`, the sky colour: gap G36), `testFrames(screen)` (the engine's
    `FrameStream` over the kit's `platformerFrames`; while the round runs, its own frame),
    `testPicture(presenter, screen)` and `testCanvasPicture(r, look)` (the backend's
    `skinSetCanvasPresenter`: the level skin or the round's, per frame);
  - `picture3d.ts` (0.7 T8): `testLook3d(content)` (`{ skin, rounds, screen, background }`: the
    `three` skins, picture size and `SKY`, as the 3D backend's `threeDisplay` and
    `threeScenePresenter` take them). No Three.js import, so the 2D page bundles none;
  - `view.ts`: `createView` for `pnpm cli screenshot`: the engine's `frameView` with
    `testCanvasPicture` for `render` and `testFrames` for `frame()` (`--backend three` shows
    `frame()` through the `three` skins: the screenshot page reads them with `skinSet` too);
  - `main.ts` + `index.html`: the page: `bootBrowserGame` with a scene that is
    `new HostScene({ stack, game: createGame(content, seed), picture })`, the engine's scene over
    the game itself (it pushes the core `miniGameScene` while the door's round runs and pops it on
    the result; `scene.ts` and its five accessors went away in Engine 0.10, gap G37), with `canvasDisplay(canvas, { ...look,
onSound })` and, only for `?backend=three`, `threeDisplay(canvas, { ...testLook3d(content),
onSound })` from a dynamic `import('@engine/backends/three')` (its own chunk with Three.js).
    Both displays take the round skins (`rounds`) and pick one per frame, so the scene draws
    `testPicture(display.presenter)` either way (gap G34). The `#backend` link toggles 2D and 3D.
    An `AudioManager` with the sfx gets the skins' sounds (`onSound`) and is unlocked on the
    first key, tap or click (the shell has no audio yet: gap G27);
  - `headless.ts`: `createGame(content, seed, opts?)`, the headless contract, a few lines: the
    kit's `LevelSequence` over `testStages(content)` with the run's seed, switched-off rules and
    `testMiniGames(content)` (`TestGame` and `TestSnapshot` are the kit's `LevelSequence` and
    `SequenceSnapshot`); it also exports `testMiniGames` as `miniGames`, so `validate` checks the
    door's `game` and `params` with the content (Engine 0.10, gap G16: `"goal": "defeat-al"`
    fails `validate` at `triggers.0.params.goal`). The level flow is the kit's (`kits/platformer/CLAUDE.md`, Level
    sequences): `LEVEL_PAUSE` (60) ticks after a level ends, then the next level or the failed
    one afresh; the snapshot is the kit's plus `stage` and `pause`;
  - `minigames.ts`: `testMiniGames(content)`: one `roomChallenge` (`kits/topdown/challenge.ts`)
    per room file, its id the room's id and its title the room's `title`, at the manifest's
    `screen` size. What the round asks and what its result does are level data, not code;
  - `files.ts`: `TEST_FILES`, the data files through Vite's `import.meta.glob` (Node reads them
    with `readGameFiles`; a Vite plugin to drop this file is gap G5, 0.14).
- `platformer-test.test.ts` (0.7 T7 part): every run file played through the view's `frame()`,
  each frame sorted by source (`status.miniGame`: the level or the vault round), and the right
  skin must map every kind and state, tile, event and HUD value shown; the level skin maps every
  tile, runner and actor state and event the kit has; the vault skin the hero's `hurt` and
  `dying`; every sound is an sfx file; the folder holds only text assets; the view draws a level
  with `hopper` and the round with `vault`; the page's `HostScene` over `createGame` pushes the
  round and pops it.
- `platformer-test.test.ts` (0.7 T8 part): the `three` skins: a level skin and a vault one, each
  with a mesh for every kind and tile its 2D skin maps (but the level's `.`), the 2D skin's
  events, sounds and camera, and a mesh for every kind and tile the runs show in its frames.
- `platformer-test.test.ts` (earlier parts): content loads, a broken field is named by file and field, the level
  order (the campaign's; a reversed campaign file plays `level-4` first; a campaign entry naming a
  missing level names the file and field; without a campaign, `level-10` after `level-9`), the start state, the first three levels cleared in
  order with `level-3.run.json`'s input, the door's round failed then passed and all four levels
  cleared with `level-4.run.json`'s, equal snapshots on two runs, a failed level starting afresh
  after `LEVEL_PAUSE`, and the mini games built from the room files (a vault round from the
  door's params).

## Run files

Every run file starts at the first level (a run file cannot start at a later one: gap G9), so
`level-2.run.json` holds `level-1`'s input and then its own, and `level-3.run.json` both before
its own. Each level starts `LEVEL_PAUSE` (60) ticks after the one before it is cleared: `level-2`
at tick 553, `level-3` at tick 1161, `level-4` at tick 2059.

| run       | ticks | ends at                        | guards                                                                                                                                                                                                                                                                                                         |
| --------- | ----- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level-1` | 520   | `level-1` cleared at tick 493  | gravity, walk, air-control, jump, jump-by-speed, variable-jump, solid-tiles, coins-collect, bump-blocks, goal-clears-level, actors-wake, stomping, stomp-bounce                                                                                                                                                |
| `level-2` | 1130  | `level-2` cleared at tick 1101 | gravity, fall-cap, walk, run-speed, run-hold, skid, air-control, jump, jump-by-speed, variable-jump, solid-tiles, one-way-platforms, ceiling-bump, level-bounds, coins-collect, brick-break, goal-clears-level, scroll-lock, actors-wake, walkers-turn, stomping, stomp-bounce, shell-kick, shell-hits-enemies |
| `level-3` | 2030  | `level-3` cleared at tick 1999 | gravity, fall-cap, walk, skid, friction, air-control, jump, solid-tiles, hazards-kill, pits-kill, goal-clears-level, actors-wake, ledge-turn, enemy-touch-hurts, invulnerability                                                                                                                               |
| `level-4` | 3300  | `level-4` cleared at tick 3283 | solid-tiles, goal-clears-level, mini-games                                                                                                                                                                                                                                                                     |

- `level-1.run.json` walks right and jumps five times: under the bump block (coin at tick 59),
  over the 2-tile gap, onto the step (standing on it at 210), over the 3-tile gap through the coin
  arc (6 coins at 282; the walker wakes in between), onto the walker (stomp at 368, bounce
  `vy` -16384), onto the wall (441) and over the last gap to the goal (cleared at 493). Its
  invariants hold 3 lives, 2 hit points and stage 0 all along.
- `level-2.run.json` (level-2 from 553): breaks the middle brick (`break` and `vy` 496 at 612:
  the head bump stops the rise), lands on the one-way platform (`y` 24576 at 668), holds run
  from 653 on (`vx` 9952 at 700, a top-tier jump over the trench at 703), stomps the
  shell-walker into a shell (765), steers back and skids on landing (`vx` 4768 at 795) while the
  walker in the trench has turned (`dir` -1 at 800), walks left into the shell and kicks it
  (856; the view stays where it was: `scrollX` 86747), the shell defeats the walker (898), lets
  go of run 7 ticks before the long gap and still takes off at the top tier (1017: `run-hold`),
  is held by the level's right edge (`x` 227840 at 1096) and jumps into the goal (1101).
  Invariants: 3 lives, 2 hit points, stage 0 or 1.
- `level-3.run.json` (level-3 from 1161) plays it as a learner would, with every life it has:
  walks into the spike (died, 2 lives, 1223), jumps it but walks into the pit (falling `vy` 17600
  at 1367 drops back to 16384 at 1368; died, 1 life, 1370), then jumps both, is hurt by the first
  walker (1 hit point, 120 ticks invulnerable, 1546) and passes the second, while the
  ledge-walker turns at its platform's edge (`dir` 1, still at `y` 24576, 1662), jumps onto the
  island, lets go and steps back (a skid, then friction: standing at `x` 171653 at 1840), hops
  the last spike and clears the level (1999) with 1 life, 1 hit point and 2 coins. Invariants:
  at least 1 life, stage 0 to 2.
- `level-4.run.json` (level-4 from 2059; the earlier input is `level-3.run.json`'s): walks
  right onto the door (two coins on the way) and the `vault` round starts (`mini-game`, attempt
  1, tick 2281): the player holds nothing, the knights never reach the hero, and the round times
  out after 600 ticks (`mini-game-end` `fail` and `respawn`, tick 2881; the level stood still
  meanwhile: same `player.x` at 2880). The player steps left off the door (it re-arms by 2930),
  walks back on and round 2 starts (2965) from a new seed; its input was found with the kit's
  `TopDownBot` (`fight`) and written into the run file as plain steps: the hero stabs both knights
  and the round passes (3144: 7 coins, the wall's tiles and the door empty), then the player
  walks through the gap to the goal (3283). Assertions read the round inside the snapshot
  (`miniGame.state.round.ticks`, `miniGame.state.enemies`, `miniGame.state.hero.maxHp`), and
  each round's last tick from `endedRound` (Engine 0.10, gap G20): round 1's `result` `fail` and
  report `ticks` 600 at 2881, round 2's `pass`, the last knight's `kill` in
  `endedRound.state.events`, no enemies left and the report's `defeated` keys at 3144.
  Invariants: at least 1 life, stage 0 to 3.
- Run one: `pnpm -s cli run games/platformer-test/runs/level-2.run.json --json`. Its rules:
  `pnpm -s cli mutants games/platformer-test/runs/level-2.run.json --json` (exit 0 for each run
  file).
- The whole folder, `pnpm -s cli mutants games/platformer-test --json`, guards all 32 of the
  kit's rules (`level-4.run.json` guards `mini-games`) and must exit 0 (gap G7). The top-down
  kit's rules inside a round are not mutant-checked (gap G12).
- `runs/level-<n>.hashes.json` are the golden hashes (`tests/runs/run-files.test.ts`). After a
  change meant to change the state: `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`, and commit them.
- Changing a level or the profile moves every later tick, in this level's run file and in every
  later level's: re-find them with `pnpm -s cli dump <run> --tick N --json` and keep the
  assertions on what the rules decide.

## How it was built, step by step

1. (0.7 T1) `game.json` copied in shape from the lab (kit, screen, seed, `headless`), with only
   the `level` and `profile` content globs.
2. The profile: the kit's fixture numbers as a start, then the game's own values.
3. `level-1.map.txt` drawn as text, then checked with `pnpm -s cli validate games/platformer-test
--json` (exit 0).
4. `content.ts` and `headless.ts`: the lab's glue cut down to what this game needs (no fixture
   level, no mini games, no skins yet). Each copied piece is a gap in the report (G1 to G5).
5. The run script was found by playing the level headless and printing the player's position
   every few ticks, adding one jump at a time where the player fell or stopped (gap G8: the CLI
   has no trace command), then the assertions read off `dump` at the ticks that matter, and the
   `guards` checked with `mutants` on the run file.
6. Golden hashes with `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`.
7. (0.7 T3) The profile got the actor types the next levels use, added with the CLI
   (`pnpm -s cli add <profile> actors.shell '{...}'`, which keeps the file's one-line objects;
   `shell` before `shell-walker`, whose `stompInto` must name a type that is there).
8. `level-2` and `level-3` drawn as text, each around a few kit rules the first level does not
   use, then checked with `validate`. Single cells were fixed with
   `pnpm -s cli set <map> rows.<row>.<col> '#'` (gap G10: placing things by column in a long row).
9. Each run file: the earlier levels' input copied in, then this level's found as for step 5 (one
   jump or hold at a time, traced every few ticks), the assertions read off `dump`, and
   `mutants <run file>` until its `guards` were all guarded. Then `mutants games/platformer-test`
   for the whole game (31 of 32 rules).

10. (0.7 T5) The adapter first: `kits/topdown/challenge.ts` (`roomChallenge`) with its tests,
    using only the engine's mini game contract; the platformer kit needed no change.
11. `game.json` got `uses: ["topdown"]` and the `room` glob; the room drawn as text and checked
    with `validate` (the top-down kind's dungeon checks run on it); `content.ts` registers the
    room kind; `minigames.ts` builds the defs; `headless.ts` hands them to the sequence.
12. `level-4` drawn with the trigger and the gate, its `triggers` entry written (params and
    outcomes), `validate` again.
13. The run file: a throwaway script played `level-3.run.json`'s input, then walked right, held
    nothing through round 1, stepped off and on, and let `TopDownBot` fight round 2, recording
    each tick's held actions and writing them as steps; the assertions read off `dump`, then
    `mutants` on the run file and on the folder (exit 0), then golden hashes.

14. (0.7 T7) Pixel art written as text (a throwaway script checked each frame's width and
    height while drawing), two palettes, MML sfx, then the two skins, checked with `validate`
    (every sheet, frame and sound a skin names must exist).
15. `picture.ts`, `view.ts`, `scene.ts` (gone since Engine 0.10: `main.ts` hands the game to
    `HostScene`, gap G37), `main.ts` from the engine's helpers; `view.ts` would
    have been a copy of the lab's, so `frameView` went into the engine first (gap G26) and the
    lab uses it too. One skin per frame source needed `presenterByStatus` (gap G14).
16. Checked with `pnpm -s cli screenshot <run> --tick N --json` (`matchesHeadless` true, ticks
    in a level and inside the round) and by replaying `level-4.run.json` through the built page
    in headless Chromium (`tests/browser/platformer-test.test.ts`).

17. (0.7 T8) The two `three` skins written as text, starting from the lab's level meshes (own
    colours, a door for the trigger) and a new round skin with the room laid flat facing the
    camera; checked with `validate`, then with the backend parity test (every run through the
    Three.js scene builder: no fallback box, a block for every tile shown) and with
    `pnpm -s cli screenshot <run> --tick N --backend three --allow-software-gl --json` at a level
    tick and a round tick, looking at the PNGs. The 3D page could not show the round with its
    own skin: one `ThreePresenter` has one skin, and the screenshot page took the first `three`
    skin it found; the engine got `skinSet`, `withSkin` and `rounds` (gap G32) first.
18. `picture3d.ts`, the `three` display in `main.ts`, the `ww-alternate` tag and the toggle link
    in `index.html`; the browser test plays `level-4.run.json` in both backends.

19. (0.7 T9) The glue review: each `.ts` file read against the rule of thumb and against the
    lab's and the demo's same file. What all three games wrote the same way moved out: kinds,
    art, sounds and `mustLoad` to `engine/core/content/game-content.ts` (G4), sheets to
    `engine/core/assets/content-sheets.ts` (G35), the level order to the kit's `contentStages`
    (G2), the round's title to the room file (G15), the round's framing to the skin's
    `camera.clamp` and the 2D round presenter to the backend's `skinSetCanvasPresenter`, which
    `canvasDisplay` uses with `rounds` (G29, G34). Checked by the golden hashes (unchanged), the
    screenshot PNGs at the same ticks (byte-identical before and after) and the browser test.
    What could not move is in the report with a named release (G5, G27, G36, G37).

## Files to run

| File                    | Ends at                                                     | Command                                                              |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `runs/level-1.run.json` | `level-1` cleared, tick 493                                 | `pnpm -s cli run games/platformer-test/runs/level-1.run.json --json` |
| `runs/level-2.run.json` | `level-2` cleared, tick 1101                                | `pnpm -s cli run games/platformer-test/runs/level-2.run.json --json` |
| `runs/level-3.run.json` | `level-3` cleared, tick 1999                                | `pnpm -s cli run games/platformer-test/runs/level-3.run.json --json` |
| `runs/level-4.run.json` | the round failed, then passed; `level-4` cleared, tick 3283 | `pnpm -s cli run games/platformer-test/runs/level-4.run.json --json` |
| the whole folder        | every kit rule guarded                                      | `pnpm -s cli mutants games/platformer-test --json`                   |

Each run's final state hash (`finalHash`): `level-1` `2e94bc209e1a168d`, `level-2`
`26456b7489d5bd3d`, `level-3` `3d737aadfabe54b6`, `level-4` `06201f9a779cc2fc`; every hash is the
same through the null backend, Canvas2D and the Three.js scene builder (`tests/runs`).

## How to add a level

1. Draw `content/levels/level-5.map.txt` in the kit's `LEGEND` (`kits/platformer/legend.ts`) and
   write `content/levels/level-5.json` (`id` = the file name, `profile: "hopper"`, `scroll`,
   any `triggers`), and add `{ "level": "level-5" }` to `content/campaigns/main.campaign.json`
   where it should be played (the campaign decides the order: the kit's `contentStages`; a level
   the campaign does not list is not played). No code changes.
2. `pnpm -s cli validate games/platformer-test --json` (exit 0; every error names the file and
   the field or map row). Fix single cells with `pnpm -s cli set <map> rows.<row>.<col> '#'`.
3. New actor types go in the profile with `pnpm -s cli add
games/platformer-test/content/profiles/hopper.profile.json actors.<type> '{...}'`; a new kind or
   state the level shows needs entries in both skins (`canvas2d.json`, `three.json`) and frames
   in `content/sprites/hopper.txt`: `platformer-test.test.ts` and the backend parity test fail
   on a missing one.
4. A run file `runs/level-5.run.json`: `level-4.run.json`'s input, then the new level's (a run
   file starts at the first level, gap G9). Find the input a jump at a time with `pnpm -s cli dump
<run> --tick N --json`, assert what the rules decide, list the rules it means to guard in
   `guards` and check them with `pnpm -s cli mutants <run> --json`.
5. Golden hashes: `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`, then `pnpm test` and commit.

## How to add a mini game room

1. Draw the room as `content/rooms/<id>.json` + `<id>.map.txt` (16x11, the top-down kit's
   `LEGEND`, one hero start, `at: [0, 0]`, a `title`). `minigames.ts` makes a `roomChallenge` per
   room file by itself. Today the top-down kind checks every room file as one dungeon, so a
   second room with its own start fails `validate` (gap G17, moved to 0.15): until then a game
   holds one challenge room.
2. Put a trigger (`!`) in a level and a `triggers` entry naming the room's id in `game`, with its
   `params` (`goal`: `defeat-all` or `reach`, `ticks`, `hp`) and what `pass` and `fail` do
   (`coins`, `open:<col>:<row>`, `respawn`). The params are checked only when a round starts (gap
   G16): play the run to the door to see an error.
3. Skins named after the mini game: `content/skins/canvas2d-<id>.json` and `three-<id>.json` (the
   top-down kit's kinds and tiles the room shows, its HUD, `camera.clamp`); the page, the view,
   the parity test and `screenshot` pick them by file name.
4. A run file that plays the round (`TopDownBot` from `@kits/topdown` can find the input in a
   throwaway script; write it into the run file as plain steps), then validate, mutants and
   golden hashes as for a level.

## How to test

`pnpm test games/platformer-test`, `pnpm -s cli validate games/platformer-test --json`,
`pnpm -s cli run games/platformer-test/runs/level-<n>.run.json --json`,
`pnpm -s cli mutants games/platformer-test --json`, `pnpm test tests/runs` (golden hashes; backend
parity plays every run through the view into the null backend, into Canvas2D and into the
Three.js scene builder with the `three` skins, all giving the golden hashes, with no fallback box
and a block for every tile shown), `pnpm -s cli screenshot games/platformer-test/runs/level-4.run.json --tick 3050
--json` (a tick inside the round; `matchesHeadless` true; add `--backend three
--allow-software-gl` for 3D where there is no GPU), `pnpm test tests/browser` (the built page
plays `level-4.run.json` in 2D and in 3D: the launcher lists the game and its `3D` link, both
rounds show the vault and the level comes back, no page errors; skipped without Chromium).

## How to play (2D and 3D)

`pnpm dev` and open `/games/platformer-test/` (or `pnpm build && pnpm preview` and the root
launcher's `games/platformer-test/` link); in 3D, `/games/platformer-test/?backend=three` (the
launcher's `3D` link, or the `3D` link at the page's top left; without WebGL 2 the page says so
and links to 2D; the 3D picture has no HUD yet, gap G33): arrows (or the touch pad) move, Z jumps, X runs; in
the vault round arrows walk the hero and X stabs. The levels come in order; the door is in
`level-4`.

## Imports

- Allowed: relative paths inside `games/platformer-test`, `@engine/*` (core and backends),
  `@kits/platformer` and `@kits/topdown` (the door level's room challenge).
- Never: other games (not even `games/platformer-lab`: copy and log a gap instead) or kits it does
  not use. Nothing in `engine/` or `kits/` imports from here.
