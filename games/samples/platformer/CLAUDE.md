# games/samples/platformer

**Hopper's Way**, the platformer kit's sample game: five short side-scrolling levels, two of them
with a door that pushes a one-room top-down challenge over the level, played in 2D (Canvas2D) and
3D (Three.js) with original NES-style pixel art, low-poly meshes, an MML song and sound effects,
all as text. This file is a worked example: it says how the sample was built, so an agent can
build the next platformer (or the next game that stacks two kits) the same way. It began as the
stacking test's game (Engine 0.7, its own `platformer-test` folder: built with the engine as it
was, to find what was missing; every gap is in `docs/reports/stacking-test.md`), moved here at
Engine 0.15 T2 with its run files and golden hashes unchanged, got its second challenge room in
T11 and was finished as a sample in T13. It is content, not engine: the kits hold the rules, this
folder holds levels, rooms, art, sound, skins and thin glue.

## The game

```
level-1 -> level-2 -> level-3 -> level-4 --door (!)--> vault round  (top-down: defeat-all, 600 ticks)
                                 level-5 --door (!)--> cellar round (top-down: reach the stairs)
```

1. **level-1**: the basics: a bump block, coins, gaps, a step, one stompable `walker`, the goal.
2. **level-2** ("bricks and shells"): bricks, a one-way platform, a walker in a trench and a
   `shell-walker` whose shell, kicked, defeats it; a long gap that wants a running jump.
3. **level-3** ("spikes, pits and lives"): spikes, pits, two walkers and a `ledge-walker`: the
   level where a learner loses lives.
4. **level-4** ("the door"): a wall with a door; the **vault** round (two knights, `goal:
defeat-all`, 600 ticks, 4 half hearts) opens it on a pass, puts the player back on the door on a
   fail.
5. **level-5** ("the cellar door"): a second wall and door; the **cellar** round (no enemies, a
   flooded strip, `goal: reach` the stairs, 6 half hearts), a separate challenge room.

A level is **cleared** at its goal (the kit's `cleared` event); the next starts `LEVEL_PAUSE` (60)
ticks later. A death costs a life and restarts the level (the failure state `level-3.run.json`
plays three times); a round's `fail` puts the player back on the door. All of it is world state,
so run files assert it.

## How it was built (the worked example)

The shape of it: **two kits** (`kits/platformer` plays the levels, `kits/topdown` the rooms behind
the doors, through the engine's mini game contract), **two skins per frame source** (`canvas2d`
and `three`, so the same frames play in 2D and 3D), and **two challenge rooms** (`vault` and
`cellar`, each its own room file, checked alone). Each step names the files it made; the
engine's history behind each one is in "Build history" below.

1. **The manifest.** `game.json`: `kit: "platformer"`, `uses: ["topdown"]` (the second kit, for
   the doors' rooms), `kitOptions: { "topdown": { "rooms": "separate" } }` (each room file its own
   challenge room, gap G17; the default would check every room file as one dungeon), the content
   globs by kind (`level`, `campaign`, `profile`, `room`, `palette`, `sprite`, `skin`, `sfx`,
   `song`), seed, screen and the `headless` and `view` entries. Start from the scaffold skill's
   platformer section (`.claude/skills/scaffold-game/SKILL.md`).
2. **A physics profile as data.** `content/profiles/hopper.profile.json`: the kit's fixture
   numbers changed to the game's own (walk and run caps, lives, hit points, jump buffer), and its
   actor types (`walker`, `ledge-walker`, `shell-walker`, `shell`), added with `pnpm -s cli add`.
3. **Levels as text.** `content/levels/<id>.json` (`id`, `profile`, `scroll`, `triggers`) plus
   `<id>.map.txt` in the kit's `LEGEND` (`kits/platformer/legend.ts`), each around a few kit rules;
   `content/campaigns/main.campaign.json` says the play order. `pnpm -s cli validate
games/samples/platformer --json` names any file, field, row and column that is wrong.
4. **The second kit: rooms behind doors.** `content/rooms/<id>.json` + `<id>.map.txt` (the
   top-down kit's room format, 16x11, one hero start, a `title`); `minigames.ts` makes one
   `roomChallenge` per room file; a level's `!` cell and its `triggers` entry name the room as
   `game`, with `params` (`goal`, `ticks`, `hp`) and what `pass` and `fail` do (`coins`,
   `open:<col>:<row>`, `respawn`, `look: "door"`). The second room (`cellar`) is a second file and
   a second door: no code. `validate` checks the params (`headless.ts` exports `miniGames`).
5. **Run files, one level at a time.** Play the level headless and add input a jump or hold at a
   time (`pnpm -s cli trace <run> --paths player.x,player.y`, `pnpm -s cli dump <run> --tick N`),
   assert what the rules decide, list the rules the run guards and check them with `pnpm -s cli
mutants`; a round's input can be found with the top-down kit's `TopDownBot` in a throwaway
   script and written into the run file as plain steps. A level after the first gets a
   `level-<n>-start` run (`start: { "stage": n }`). Golden hashes with `WW_UPDATE_GOLDEN=1 pnpm
test tests/runs` (never by hand).
6. **Art as text.** Palettes (`content/palettes/<id>.json`, NES colours) and sprite sheets
   (`content/sprites/<sheet>.txt`: a palette line, a legend, then `frame <name>` and its rows, one
   character per pixel): `hopper` (the levels: tiles, the runner, the actors, coin, goal, door and
   the HUD icons), `hopper-font` (the HUD digits) and `vault` (the rounds: room tiles, the hero,
   his sword, the knight, poofs, stairs and the round's HUD icons). All original; the SMBC REMIX
   source was read for technique only.
7. **Sound as text.** MML sound effects (`content/sfx/*.json`) for the main events and one MML
   song, `meadow` (`content/songs/meadow.json`: four channels of the same length, looping),
   which the page plays from the first key, tap or click (`PLATFORMER_MUSIC` in `content.ts`,
   handed to the shell's `audio.music`). The shell draws the mute button and volume slider
   (`#ww-volume`) and keeps the player's volumes.
8. **Two skins per frame source.** The levels' frames and each round's frames clash (both kits
   use `#` and `.`), so each source gets its own skin, picked by file name: `canvas2d.json` and
   `three.json` for the levels, `<backend>-<room id>.json` for each round (`canvas2d-vault.json`,
   `three-vault.json`, `canvas2d-cellar.json`, `three-cellar.json`). A 2D skin maps every kind,
   state, tile and event to frames of the sheets, with no per-kind fallback colour (the sheets'
   `fallbackColor` is a loud `#ff00ff` that no run ever draws: `platformer.test.ts` checks every
   tick); a 3D skin maps the same kinds and tiles to low-poly meshes written as text (boxes,
   spheres, cylinders and cones), with the 2D skin's events, particles, camera and **HUD**
   (`hud`, drawn by the 3D backend from the same sheets: `sheets.sheet` in the skin, the decoded
   pixels from `picture3d.ts`). Both level skins clear to the sky (`background`).
9. **Thin glue.** `content.ts` (load, play order, rooms, skin sets), `headless.ts` (the kit's
   `LevelSequence` with the mini games), `minigames.ts`, `picture.ts` and `picture3d.ts` (the
   looks), `view.ts` (the engine's `frameView`, for `screenshot`) and `main.ts` + `index.html` (the
   shell's `bootBrowserGame`, the engine's `HostScene` over the headless game, a display per
   backend). Each is a few calls into the engine and kits; anything another game would write the
   same way belongs in the engine.
10. **Check it.** `pnpm test games/samples/platformer` (content, skins covering every frame of
    every run in both backends, no fallback drawn, the song, text-only assets), `pnpm test
tests/runs` (golden hashes, the same through null, Canvas2D and the Three.js scene builder, with
    a 3D HUD wherever the skin has one), `pnpm -s cli screenshot <run> --tick N [--backend three
--allow-software-gl] --json`, and `pnpm test tests/browser` (the games index's 2D and 3D links,
    played in headless Chromium).

## The rule

This folder holds **only content, skins and thin glue** (DESIGN.md's rule of thumb: if two games
could use it, it is engine; if it is content, it is the game). Game rules go in data files
(levels, profiles, rooms, triggers), never in code here. Anything this game has to write that
another game would write too is a gap: log it in `docs/reports/stacking-test.md` (from G37), and
move it into the engine or the kit (or name the release that will).

## Files

- `game.json`: the manifest: kit `platformer`, `uses: ["topdown"]` (for the doors' rooms),
  `kitOptions: { "topdown": { "rooms": "separate" } }` (Engine 0.15, gap G17: each room file is
  its own challenge room, checked alone),
  256x240, seed 1, `headless.ts`, `view.ts` (0.7 T7), `transitions` (Engine 0.16 T5: `level` a
  fade with a short hold between levels, `scene` an iris closing on Hopper when a door starts its
  room's round and opening when the round ends; `main.ts` passes them to `bootBrowserGame`), content kinds `level`, `campaign`, `profile`,
  `room`, `palette`, `sprite`, `skin` and `sfx`. `index.html` is the page, so the root launcher lists
  `games/samples/platformer/`, and its `ww-alternate` meta tag adds the launcher's `3D` link
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
    (`respawn`; step off and on again for another round), and `"look": "door"` draws it as a door
    (Engine 0.11, gap G13: presented as the tag `look:door`, picked by the skins' `byTag`; not in
    the snapshot, so no hash moved). Past the wall, the goal.
  - `level-5` ("the cellar door", Engine 0.15 T11, gap G17), 32x10: one floor coin, then a wall
    from the top to the ground at column 11 with the second door (`!` at (10,8)): its trigger
    starts the `cellar` mini game, a second, separate challenge room, with `goal: reach`,
    `ticks: 600`, `hp: 6`; a `pass` gives 3 coins and opens `open:11:6` to `open:11:8`, a `fail`
    `respawn`s, `"look": "door"`. Past the wall, the goal. It is played last, after `level-4`
    (the campaign's fifth entry), so no earlier run moved: `level-4` ends its runs before the
    pause after it is over.
- `content/campaigns/main.campaign.json` (Engine 0.10, gap G2): the play order as data, the
  engine's `campaign` kind (`engine/core/campaign.ts`): `level-1`, `level-2`, `level-3`,
  `level-4`, the order the levels were played in by id before, so no run file or golden hash
  moved; `level-5` was added last in Engine 0.15 T11. Reorder its `entries` (or set `start`) and the levels play in that order; a level not
  listed is not played, and an entry naming a missing level fails `validate` at
  `entries.<i>.level`.
- `content/rooms/vault.json` + `vault.map.txt`: the door's top-down room (`kits/topdown` room
  format, `kits/topdown/CLAUDE.md`, Room files): 16x11, four statues, a 2x2 pool, two knights
  (`n`), the hero's start at (2,5), `"title": "VAULT"` (the mini game's title, gap G15). It is a
  `RoomDef` like any top-down game's; nothing in it says it is a mini game (the level's trigger
  does).
- `content/rooms/cellar.json` + `cellar.map.txt` (Engine 0.15 T11, gap G17): the second door's
  room, a separate challenge room: 16x11, two statues, a flooded strip (`~`, columns 11-12, rows
  2-6) between the hero's start at (2,4) and the stairs out (`E` at (13,4)), no enemies,
  `"title": "CELLAR"`; its round's goal is `reach` (walk round the water to the stairs). It shares
  cell (0,0) with `vault` and has its own `@`: `game.json`'s `kitOptions: { "topdown": { "rooms":
"separate" } }` makes the top-down kind check each room file alone (`kits/topdown/CLAUDE.md`,
  Room files), where the default would check both as one dungeon (`invalid_dungeon`: two starts,
  one cell). Its skins `canvas2d-cellar.json` and `three-cellar.json` are the vault round's with
  the stairs tile (`E`: frame `stairs` in `content/sprites/vault.txt`, mesh `stairs`) added.
- `content/profiles/hopper.profile.json`: the game's own physics profile (`hopper`): it started
  from the kit's fixture profile and was changed (a little slower walk and run cap, a slower
  walker, 2 hit points, 3 lives, a 6-tick jump buffer, a softer middle jump tier). Its actor
  types: `walker`, `ledge-walker` (`turnAt: ledges`), `shell-walker` (a stomp turns it into a
  `shell`) and `shell` (still, kickable at 12288). Profiles live in
  their own folder because the `level` glob `content/levels/*.json` would claim them too.
- Assets, all text (0.7 T7; `platformer.test.ts` fails on any other kind of file):
  - `content/sprites/hopper.txt` (palette `content/palettes/hopper.json`): original NES-style pixel
    art, one string per row, one character per pixel: the level tiles (`sky`, `ground`, `brick`,
    `bump`, `used`, `one-way`, `hazard`), the runner (12x16: idle, two walk frames, skid, jump,
    fall, hurt, dead), the actors (`walker`, `ledge-walker` in purple, `shell-walker` 16x24,
    `shell`, each with its flat or upside-down remains), `coin` (and its turn), `goal` (a flag),
    `door` (the door trigger), `switch` (a trigger with no `look`) and the HUD's `heart`, `hud-coin`, `hud-life` (8x8).
    `content/sprites/hopper-font.txt`: the HUD's 8x8 digits.
  - `content/sprites/vault.txt` (palette `content/palettes/vault.json`): the vault round: room
    tiles (`wall`, `floor`, `statue`, `water`), the hero (`down`/`up`/`side`, two frames each, three
    `attack` frames), his sword (`sword-up`, `sword-down`, `sword-right`), `poof-0..2`, the knight
    (two frames each way) and the HUD's `hp` heart and `hourglass`.
  - `content/sfx/*.json`: MML sound effects: `jump`, `coin`, `stomp` (also a brick, a kick and a
    knight beaten), `door` (the round starts and ends), `pass` (a level cleared), `fail` (a death,
    the hero's spin), `hurt`, `sword`.
  - `content/songs/meadow.json` (Engine 0.15 T13): the page's MML song, four channels (two
    pulses, triangle bass, noise drums) of 1536 ticks each, looping from the start (`L`).
  - `content/skins/canvas2d.json`: the levels' skin (format: `engine/core/present/skin.ts`):
    every `PRESENT_TILES` character, `runner` (every `RUNNER_ANIMS` state, mirrored for left),
    every actor type of the profile (every `ACTOR_ANIMS` state), `coin` (`idle`, `pop`), `goal`,
    `trigger` (a `switch` block, and the door for the tag `look:door` through `byTag`: gaps G13
    and G30), `bump-block` (`used`, and `brick` for the tag `brick`: a bumped brick that does not
    break bounces as a brick); every
    `PlatformerEvent` with effects and the sounds above (`mini-game-end:pass` plays `pass` and
    `mini-game-end:fail` plays `fail`, the bare `mini-game-end` the `door` for a quit: gap G28); HUD `hp` (hearts), `coins` and `lives`
    (icon and number in `hopper-font`); camera follow `runner`, deadzone 32x48, lerp 0.25.
  - `content/skins/canvas2d-vault.json`: the vault round's skin: the top-down kit's tiles the room
    shows (`#`, `.`, `S`, `~`), `hero` (`walk`, `attack`, `hurt`, `dying`, `poof`), `sword`
    (`stab`), `poof`, `knight` (`walk`); the round's events (`mini-game`, `room`, `sword`, `hit`,
    `kill`, `hurt`, `dying`, `dead`); HUD `hp` (one heart per half heart) and `timeLeft` (an
    hourglass and the ticks left); `camera` `{ "clamp": false }`, so the 16x11 room stays under
    the HUD band where the kit's camera hint puts it (gap G29). The two kits' tiles (`#`, `.`, `B`, `=`) and their camera and HUD
    clash, so a round's frames get their own skin: a skin named `<backend>-<mini game id>` is
    that round's (`hopperSkins`, over the engine's `skinSet`), and the page and the view hand each
    frame to the presenter its `status.miniGame` names (the backend's `skinSetCanvasPresenter`,
    over the engine's `presenterBySkinSet`; gaps G14 and G34).
  - `content/skins/three.json` (0.7 T8): the levels' 3D skin, low-poly meshes written as text
    (compound meshes of boxes, spheres, cylinders and cones in world px): `runner` (cap, face,
    shirt, overalls, boots), `walker` (shared by `walker` and `ledge-walker` in their own
    colours), `shell-walker`, `shell`, `coin`, `goal` (pole and flag), `door` (the trigger with
    `look:door`, through `byTag`: panelled wings and a knob; a trigger with no look is a purple
    box), `bump-block` a plain box (a `brick` mesh for the tag `brick`); tiles: every `PRESENT_TILES` character
    but `.` (open air is the sky, no block): `#` a block with a lighter top course, `B` a brick
    with mortar lines, `?` a block with a mark on its face, `u` a plain box, `=` a thin slab, `^`
    two rows of cones on a base. `events` are the 2D skin's sounds, flashes, tints, shakes and
    (Engine 0.15, gap G33) particles; `hud` is the 2D skin's (hearts, coins and lives), drawn from
    `sheets.sheet` `hopper` and `hopper-font` by the 3D backend's HUD pass; `camera` the 2D skin's;
    `camera3d` `fov` 40, `tilt` 4, `layerDepth` 0.25 (the lab's framing).
  - `content/skins/three-vault.json` (0.7 T8): the vault round's 3D skin. The room is **laid flat
    facing the camera**: a top-down room seen from the front, exactly as the 2D picture shows it,
    so the 3D backend needed no change of axes. Walls (`#`) and statues (`S`, a pillar on a
    plinth) stand forward as blocks; the floor (`.`) is a thin slab sunk 8 px behind them and the
    water (`~`) 2 px deeper, so the hero (tunic, cap and face toward the camera, a shield), the
    knights and the poofs stand out of the floor; the sword is a thin box filling its blade's
    box. `camera3d` `tilt` 8 (a little of the walls' tops shows). `hud` is the 2D round skin's
    (hearts and the time left, from `sheets.sheet` `vault` and `hopper-font`) and `camera`
    `{ "clamp": false }` as in 2D, so the room stays under the HUD band (Engine 0.15, gap G33;
    before it the 3D round drew no HUD and clamped, centring the room).
- TypeScript is glue only (each file a few calls into the engine and kits; the glue review in
  `docs/reports/stacking-test.md` lists what each holds):
  - `content.ts`: `loadHopper(files)` (the content kinds of the game's two kits,
    `kitContentKinds([platformer, topdown])` from `@engine/core/content/game-content`, over the
    kits' hooks), `hopperStages(content)` (the kit's `contentStages`: the levels in the campaign
    file's order, each with its profile), `hopperRooms(content)`, `hopperSkins(content,
backend)` (`{ level, rounds }`: the engine's `skinSet`, throwing when the backend has no
    skin). Art (`contentArt`), sounds (`contentSfx`) and `mustLoad` are the engine's (gap G4);
  - `picture.ts`: `hopperLook(content)` (the `canvas2d` skins, the sheets from the engine's
    `contentSheets` and size; the sky, `#5c94fc`, is each level skin's `background`,
    gap G36, fixed in 0.15, so no colour lives in the glue), `hopperFrames(screen)` (the engine's
    `FrameStream` over the kit's `platformerFrames`; while the round runs, its own frame),
    `hopperPicture(presenter, screen)` and `hopperCanvasPicture(r, look)` (the backend's
    `skinSetCanvasPresenter`: the level skin or the round's, per frame);
  - `picture3d.ts` (0.7 T8): `hopperLook3d(content)` (`{ skin, rounds, sheets, screen }`: the
    `three` skins, whose level skin's `background` is the sky, the sprite sheets as decoded pixels
    for their HUD (`contentPixelSheets`, gap G33) and picture size, as the 3D backend's `threeDisplay` and
    `threeScenePresenter` take them). No Three.js import, so the 2D page bundles none;
  - `view.ts`: `createView` for `pnpm cli screenshot`: the engine's `frameView` with
    `hopperCanvasPicture` for `render` and `hopperFrames` for `frame()` (`--backend three` shows
    `frame()` through the `three` skins: the screenshot page reads them with `skinSet` too);
  - `main.ts` + `index.html`: the page: `bootBrowserGame` with a scene that is
    `new HostScene({ stack, game: createGame(content, seed), picture })`, the engine's scene over
    the game itself (it pushes the core `miniGameScene` while the door's round runs and pops it on
    the result; `scene.ts` and its five accessors went away in Engine 0.10, gap G37), with `canvasDisplay(canvas, { ...look,
onSound })` (the `onSound` the shell hands the factory) and, only for `?backend=three`, `threeDisplay(canvas, { ...hopperLook3d(content),
onSound })` from a dynamic `import('@engine/backends/three')` (its own chunk with Three.js).
    Both displays take the round skins (`rounds`) and pick one per frame, so the scene draws
    `hopperPicture(display.presenter)` either way (gap G34). The `#backend` link toggles 2D and 3D.
    Sound is the shell's: `audio: { sfx: contentSfx(content) }` makes the `AudioManager`, unlocks
    it on the first key, tap or click and hands each display factory its `onSound` (gap G27,
    fixed in Engine 0.11); the page has no audio code of its own;
  - `headless.ts`: `createGame(content, seed, opts?)`, the headless contract, a few lines: the
    kit's `LevelSequence` over `hopperStages(content)` with the run's seed, switched-off rules and
    `hopperMiniGames(content)` (`HopperGame` and `HopperSnapshot` are the kit's `LevelSequence` and
    `SequenceSnapshot`); it also exports `hopperMiniGames` as `miniGames`, so `validate` checks the
    door's `game` and `params` with the content (Engine 0.10, gap G16: `"goal": "defeat-al"`
    fails `validate` at `triggers.0.params.goal`). The level flow is the kit's (`kits/platformer/CLAUDE.md`, Level
    sequences): `LEVEL_PAUSE` (60) ticks after a level ends, then the next level or the failed
    one afresh; the snapshot is the kit's plus `stage` and `pause`;
  - `minigames.ts`: `hopperMiniGames(content, disabledRules?)`: one `roomChallenge`
    (`kits/topdown/challenge.ts`) per room file, its id the room's id and its title the room's
    `title`, at the manifest's `screen` size, with the top-down rules a run switches off
    (`topdown:<id>`, Engine 0.14 gap G12). What the round asks and what its result does are level data, not code;
  - no `files.ts`: `main.ts` imports its data files from `virtual:game-files` (the build's plugin, `build/game-files.ts`; no `files.ts` since Engine 0.14 T2); Node reads the same files with `readGameFiles`.
- `platformer.test.ts` (0.7 T7 part): every run file played through the view's `frame()`,
  each frame sorted by source (`status.miniGame`: the level or the vault round), and the right
  skin must map every kind and state, tile, event and HUD value shown; the level skin maps every
  tile, runner and actor state and event the kit has; the vault skin the hero's `hurt` and
  `dying`; every sound is an sfx file; the folder holds only text assets; the view draws a level
  with `hopper` and the round with `vault`; the page's `HostScene` over `createGame` pushes the
  round and pops it.
- `platformer.test.ts` (0.7 T8 part): the `three` skins: a level skin and a vault one, each
  with a mesh for every kind and tile its 2D skin maps (but the level's `.`), the 2D skin's
  events, sounds, camera, HUD and particle effects (Engine 0.15, gap G33), and a mesh for every
  kind and tile the runs show in its frames.
- `platformer.test.ts` (Engine 0.15 T13 part): one song, the page's, compiling with four
  channels of one length; no kind, tag look or tile of a 2D skin with its own fallback colour;
  every tick of every run file drawn in 2D through the view with sprites and never a `#ff00ff`
  fallback box; the 2D and 3D skin checks cover the cellar round too.
- `platformer.test.ts` (earlier parts): content loads, a broken field is named by file and field, the level
  order (the campaign's; a reversed campaign file plays `level-4` first; a campaign entry naming a
  missing level names the file and field; without a campaign, `level-10` after `level-9`), the start state, the first three levels cleared in
  order with `level-3.run.json`'s input, the door's round failed then passed and all four levels
  cleared with `level-4.run.json`'s, equal snapshots on two runs, a failed level starting afresh
  after `LEVEL_PAUSE`, and the mini games built from the room files (a vault round from the
  door's params).

## Run files

The `level-<n>` run files start at the first level, so `level-2.run.json` holds `level-1`'s input
and then its own, and `level-3.run.json` both before its own. Each level starts `LEVEL_PAUSE` (60)
ticks after the one before it is cleared: `level-2` at tick 553, `level-3` at tick 1161, `level-4`
at tick 2059. They stay as they are, with their hashes.

From Engine 0.14 (gap G9) a run file can start at a later level: `start: { "stage": n }`
(0-based, `level-1` is stage 0; `headless.ts` exports `starts(content)`, one stage per level, and
`createGame` passes `opts.start` to the kit's `LevelSequence`). `level-2-start`, `level-3-start`
and `level-4-start` are `level-<n>`'s own part from that level's tick 0 (`start` stages 1, 2 and
3): the same input, assertions and guards shifted back by 553, 1161 and 2059 ticks, the `stage`
invariant an `eq`, and the same hashes as the full runs at those ticks. A change to `level-1`
moves none of them.

| run             | ticks | ends at                        | guards                                                                                                                                                                                                                                                                                                         |
| --------------- | ----- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level-1`       | 520   | `level-1` cleared at tick 493  | gravity, walk, air-control, jump, jump-by-speed, variable-jump, solid-tiles, coins-collect, bump-blocks, goal-clears-level, actors-wake, stomping, stomp-bounce                                                                                                                                                |
| `level-2`       | 1130  | `level-2` cleared at tick 1101 | gravity, fall-cap, walk, run-speed, run-hold, skid, air-control, jump, jump-by-speed, variable-jump, solid-tiles, one-way-platforms, ceiling-bump, level-bounds, coins-collect, brick-break, goal-clears-level, scroll-lock, actors-wake, walkers-turn, stomping, stomp-bounce, shell-kick, shell-hits-enemies |
| `level-3`       | 2030  | `level-3` cleared at tick 1999 | gravity, fall-cap, walk, skid, friction, air-control, jump, solid-tiles, hazards-kill, pits-kill, goal-clears-level, actors-wake, ledge-turn, enemy-touch-hurts, invulnerability                                                                                                                               |
| `level-4`       | 3300  | `level-4` cleared at tick 3283 | solid-tiles, goal-clears-level, mini-games, topdown:walls-block-movement                                                                                                                                                                                                                                       |
| `level-2-start` | 577   | `level-2` cleared at tick 548  | as `level-2`                                                                                                                                                                                                                                                                                                   |
| `level-3-start` | 869   | `level-3` cleared at tick 838  | as `level-3`                                                                                                                                                                                                                                                                                                   |
| `level-4-start` | 1241  | `level-4` cleared at tick 1224 | as `level-4`                                                                                                                                                                                                                                                                                                   |
| `level-5-start` | 510   | `level-5` cleared at tick 485  | gravity, walk, friction, air-control, solid-tiles, coins-collect, goal-clears-level, mini-games, topdown:walls-block-movement                                                                                                                                                                                  |

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
- `level-5-start.run.json` (Engine 0.15 T11, gap G17; `start: { "stage": 4 }`, level-5 from its
  own tick 0): walks right onto the second door (one coin on the way) and the `cellar` round
  starts (`mini-game`, attempt 1, tick 105: room `cellar`, goal `reach`, 6 half hearts, no
  enemies); the player lets go, then walks the hero down until the room's bottom wall stops it
  (`miniGame.state.hero.y` 144 at tick 200: with `topdown:walls-block-movement` off it walks on
  to 160 and the round no longer passes), right under the flooded strip and up onto the stairs:
  the round passes at tick 341 (`mini-game-end` `pass`, `endedRound.state.exited`, 4 coins, the
  wall's bottom tile empty), and the player walks to the goal (`cleared`, 485). Invariants: at
  least 1 life, stage 4. Its input was found with `pnpm cli trace` a hold at a time.
- Run one: `pnpm -s cli run games/samples/platformer/runs/level-2.run.json --json`. Its rules:
  `pnpm -s cli mutants games/samples/platformer/runs/level-2.run.json --json` (exit 0 for each run
  file).
- The whole folder, `pnpm -s cli mutants games/samples/platformer --json`, guards all 32 of the
  kit's rules (`level-4.run.json` guards `mini-games`) and must exit 0 (gap G7). Since Engine 0.14
  (gap G12) it also tries the top-down kit's 4 rules inside the vault round, as
  `topdown:<id>`: `level-4`, `level-4-start` and `level-5-start` guard
  `topdown:walls-block-movement` (with the walls gone the recorded rounds no longer pass); no check reads a hit the hero takes, and the
  vault is one room with no locked door, so `topdown:damage-reduces-hp`,
  `topdown:doors-change-room` and `topdown:keys-open-locked-doors` stay unguarded (reported, not a
  failure: the top-down kit is not strict; recorded in `docs/reports/stacking-test.md`, G12).
  `pnpm -s cli run games/samples/platformer/runs/level-4-start.run.json --disable-rule
topdown:walls-block-movement` switches it off in the round only (`headless.ts` hands
  `rulesOffFor(opts, 'topdown')` to `hopperMiniGames`; the levels' worlds get `opts.disabledRules`).
- `runs/level-<n>.hashes.json` are the golden hashes (`tests/runs/run-files.test.ts`). After a
  change meant to change the state: `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`, and commit them.
- Changing a level or the profile moves every later tick, in this level's run file and in every
  later level's: re-find them with `pnpm -s cli dump <run> --tick N --json` and keep the
  assertions on what the rules decide.

## Build history (step by step)

1. (0.7 T1) `game.json` copied in shape from the lab (kit, screen, seed, `headless`), with only
   the `level` and `profile` content globs.
2. The profile: the kit's fixture numbers as a start, then the game's own values.
3. `level-1.map.txt` drawn as text, then checked with `pnpm -s cli validate games/samples/platformer
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
   `mutants <run file>` until its `guards` were all guarded. Then `mutants games/samples/platformer`
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
    in headless Chromium (`tests/browser/platformer.test.ts`).

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

20. (0.15 T4, gap G33; committed with T13) The 3D HUD: the engine got one HUD layout both backends draw
    (`layoutHud`) and a HUD pass and particles in the 3D backend first; then `three.json` and
    `three-vault.json` took their 2D skins' `hud`, a `sheets.sheet` and the particle effects, the
    vault's `camera.clamp` became `false` as in 2D, and `picture3d.ts` hands the display the
    sheets as decoded pixels. Checked with `screenshot --backend three` at a level tick and a
    round tick and by the browser test's HUD check; no hash moved.

21. (0.15 T13) Finished as a sample, Hopper's Way: the `meadow` MML song (`content/songs/`, the
    `song` glob, `PLATFORMER_MUSIC` handed to the shell's `audio`), the 2D skins' per-kind and
    per-tile fallback colours removed (the sheets' `fallbackColor` a loud `#ff00ff` no run draws:
    a test renders every tick of every run), the cellar round's 3D skin given the HUD (`clamp:
false`, as the vault's in T4), the page titled for the games index and the browser test
    following the index's 2D and 3D links. The glue keeps its `test*` names (they are in the gap
    report and the docs). No snapshot changed, so no golden hash moved, and no run file was added
    (no new level or room).

## Files to run

| File                            | Ends at                                                     | Command                                                                       |
| ------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `runs/level-1.run.json`         | `level-1` cleared, tick 493                                 | `pnpm -s cli run games/samples/platformer/runs/level-1.run.json --json`       |
| `runs/level-2.run.json`         | `level-2` cleared, tick 1101                                | `pnpm -s cli run games/samples/platformer/runs/level-2.run.json --json`       |
| `runs/level-3.run.json`         | `level-3` cleared, tick 1999                                | `pnpm -s cli run games/samples/platformer/runs/level-3.run.json --json`       |
| `runs/level-4.run.json`         | the round failed, then passed; `level-4` cleared, tick 3283 | `pnpm -s cli run games/samples/platformer/runs/level-4.run.json --json`       |
| `runs/level-5-start.run.json`   | the cellar round passed; `level-5` cleared, tick 485        | `pnpm -s cli run games/samples/platformer/runs/level-5-start.run.json --json` |
| `runs/level-<n>-start.run.json` | as `level-<n>`, from that level's tick 0                    | `pnpm -s cli run games/samples/platformer/runs/level-2-start.run.json --json` |
| the whole folder                | every kit rule guarded                                      | `pnpm -s cli mutants games/samples/platformer --json`                         |

Each run's final state hash (`finalHash`): `level-1` `2e94bc209e1a168d`, `level-2`
`26456b7489d5bd3d`, `level-3` `3d737aadfabe54b6`, `level-4` `06201f9a779cc2fc` (each `-start`
run ends on its full run's hash), `level-5-start` `baff0936d93cd71f`; every hash is the
same through the null backend, Canvas2D and the Three.js scene builder (`tests/runs`).

## How to add a level

1. Draw `content/levels/level-6.map.txt` in the kit's `LEGEND` (`kits/platformer/legend.ts`) and
   write `content/levels/level-6.json` (`id` = the file name, `profile: "hopper"`, `scroll`,
   any `triggers`), and add `{ "level": "level-6" }` to `content/campaigns/main.campaign.json`
   where it should be played (the campaign decides the order: the kit's `contentStages`; a level
   the campaign does not list is not played). No code changes.
2. `pnpm -s cli validate games/samples/platformer --json` (exit 0; every error names the file and
   the field or map row). Fix single cells with `pnpm -s cli set <map> rows.<row>.<col> '#'`.
3. New actor types go in the profile with `pnpm -s cli add
games/samples/platformer/content/profiles/hopper.profile.json actors.<type> '{...}'`; a new kind or
   state the level shows needs entries in both skins (`canvas2d.json`, `three.json`) and frames
   in `content/sprites/hopper.txt`: `platformer.test.ts` and the backend parity test fail
   on a missing one.
4. A run file `runs/level-6-start.run.json` with `"start": { "stage": 5 }` (the new level's
   place in the campaign, 0-based), so it plays the new level alone from its tick 0 (gap G9). Find the input a jump at a time with `pnpm -s cli dump
<run> --tick N --json`, assert what the rules decide, list the rules it means to guard in
   `guards` and check them with `pnpm -s cli mutants <run> --json`.
5. Golden hashes: `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`, then `pnpm test` and commit.

## How to add a mini game room

1. Draw the room as `content/rooms/<id>.json` + `<id>.map.txt` (16x11, the top-down kit's
   `LEGEND`, one hero start, `at: [0, 0]`, a `title`). `minigames.ts` makes a `roomChallenge` per
   room file by itself. `game.json`'s `kitOptions.topdown.rooms` is `"separate"` (Engine 0.15,
   gap G17), so each room is checked alone: every room keeps its own start and may share cell
   (0,0) with the others (`vault` and `cellar` do).
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

`pnpm test games/samples/platformer`, `pnpm -s cli validate games/samples/platformer --json`,
`pnpm -s cli run games/samples/platformer/runs/level-<n>.run.json --json`,
`pnpm -s cli mutants games/samples/platformer --json`, `pnpm test tests/runs` (golden hashes; backend
parity plays every run through the view into the null backend, into Canvas2D and into the
Three.js scene builder with the `three` skins, all giving the golden hashes, with no fallback box
and a block for every tile shown), `pnpm -s cli screenshot games/samples/platformer/runs/level-4.run.json --tick 3050
--json` (a tick inside the round; `matchesHeadless` true; add `--backend three
--allow-software-gl` for 3D where there is no GPU), `pnpm test tests/browser` (the built page
plays `level-4.run.json` in 2D and in 3D: the launcher lists the game and its `3D` link, both
rounds show the vault and the level comes back, the HUD is drawn on the level and in the round in
both backends, no page errors; skipped without Chromium).

## How to play (2D and 3D)

`pnpm dev` and open `/games/samples/platformer/` (or `pnpm build && pnpm preview` and the root
launcher's `games/samples/platformer/` link); in 3D, `/games/samples/platformer/?backend=three` (the
launcher's `3D` link, or the `3D` link at the page's top left; without WebGL 2 the page says so
and links to 2D; the 3D picture shows the same HUD as 2D since Engine 0.15, gap G33): arrows (or the touch pad) move, Z jumps, X runs; in
the rounds arrows walk the hero and X stabs. The levels come in order; the doors are in
`level-4` and `level-5`. The `meadow` song starts on the first key, tap or click; the volume
control is at the page's top right.

## Imports

- Allowed: relative paths inside `games/samples/platformer`, `@engine/*` (core and backends),
  `@kits/platformer` and `@kits/topdown` (the door level's room challenge).
- Never: other games (not even `games/platformer-lab`: copy and log a gap instead) or kits it does
  not use. Nothing in `engine/` or `kits/` imports from here.
