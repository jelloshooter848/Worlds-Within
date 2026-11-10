# games/samples/platformer

**Hopper's Way**, the platformer kit's sample and the engine's flagship (Engine 0.16 part B): a
short side-scroller of three levels and a mini-boss, in 2D (Canvas2D) and 2.5D (Three.js), at a
16:9 screen. It is built a task at a time (docs/ROADMAP.md, "0.16 part B"): T5 made room for it
(the old five levels and two doors moved to `games/platformer-classic`, a test game, with their
run files and hashes unchanged), gave it a tuned profile, its screen, its campaign and its first
level; T6 is the art and feel pass (the CC0 packs in `assets/`), T7 levels 2 and 3, T8 the
mini-boss's arena and the end, T9 music and sounds, T10 the 2.5D view. It is content, not engine:
the kit holds the rules, this folder holds levels, the profile, art, sound, skins and thin glue.

## The game

```
level-1 -> level-2 -> level-3 -> boss   (campaign main; LEVEL_PAUSE 60 ticks between stages)
```

1. **level-1** (T5, built): a short first level, 80x12 tiles, teaching run, jump, coyote time
   and the checkpoint: three coins to jump for, a bump block with a coin, a 2-tile gap, a
   `walker` to stomp, a 2-high step, the **checkpoint** (`K`, column 36), a 3-high ledge with
   three coins and a 4-wide pit after it (walk off its edge and jump late: coyote time carries
   the jump), a second `walker` below the far ledge, a 6-wide gap that wants a **running** jump
   (a walking jump falls short) under an arc of four coins, and the goal. 13 coins in all.
2. **level-2**, **level-3** (T7) and **boss** (T8, the mini-boss's arena, `"clear": "boss"`):
   placeholders now, each a flat 24x12 corridor from the start to a goal, so the campaign, the
   level select and the stage list are the flagship's from the start.

A level is **cleared** at its goal; the next stage starts `LEVEL_PAUSE` (60) ticks later. A death
costs a life and puts the player back at the last checkpoint touched (else the start); with no
life left the level is **failed** and starts afresh, with the profile's lives, 60 ticks later.
All of it is world state, so run files assert it.

## Build choices (T5; feedback items 366-369)

1. **Where the old content went (366).** The stacking test's five levels, the `vault` and
   `cellar` rooms, the old `hopper` profile, their art, sounds, skins and eight run files moved
   with `git mv` to `games/platformer-classic`, a test game like the labs (its own `game.json` at
   256x240, page, `CLAUDE.md`, `AGENTS.md` and `docs/modules/games-platformer-classic.md`). Every
   golden hash is unchanged; only each `.hashes.json`'s `run` path changed. The CC0 packs
   (`assets/`, T4) stayed here.
2. **The screen (367).** 320x180, 16:9: 6x is exactly 1920x1080 (`screenshot --scale 6`), 4x
   1280x720. The kit's `LevelSequence` takes the screen's width as `viewWidth`
   (`headless.ts`), so the level scrolls and wakes actors over the 320 px a player sees.
3. **The profile (368).** `content/profiles/hoppers-way.profile.json`, tuned as data (the table
   below). The `hopper` profile stays the classic game's.
4. **The placeholder skin (369).** The old hand-drawn `hopper` sheet, palette, fonts, sfx and
   `meadow` song were copied in as placeholders (the classic game keeps its own copies), with a
   text-art checkpoint added (`checkpoint`, `checkpoint-on`); T6 replaces the art.

## The tuned profile: `hoppers-way`

JSON has no comments, so the numbers chosen are here. Units are the kit's
(`kits/platformer/profile.ts`): speeds in 1/4096 px per tick (4096 = 1 px/tick, 60 ticks a
second), accelerations in the same unit per tick. "Old" is the classic `hopper` profile.

| Field                   | Value                    | Old                    | Why                                                                    |
| ----------------------- | ------------------------ | ---------------------- | ---------------------------------------------------------------------- |
| `minWalk`               | 384                      | 320                    | a walk from rest starts a touch quicker                                |
| `walkAccel`             | 192                      | 160                    | full walking speed in about 0.5 s, not 0.6 s                           |
| `runAccel`              | 256                      | 224                    | full run in about 0.4 s from walking speed                             |
| `friction`              | 320                      | 224                    | letting go stops in about 20 ticks: less ice                           |
| `skid`, `skidTurn`      | 512, 2560                | 400, 2304              | turning round is snappier                                              |
| `maxWalk`, `maxRun`     | 6400, 10240              | 6144, 9984             | 1.56 and 2.5 px/tick: a 320 px screen crossed in 3.4 s and 2.1 s       |
| `runHold`               | 10                       | 10                     | a run jump still counts as run for 10 ticks after letting go           |
| `jumps` (3 tiers)       | below 4096, below 8192,  | below 4096, below 9216 | the top tier only from a real run; it rises 76 px with jump held       |
|                         | then 19456 at the top    | then 20480             | (a 6-tile gap needs it), the others about 64 px                        |
| `holdGravity`/`gravity` | 512/1920, 512/1920,      | 512/1792, 496/1600,    | a heavier fall than the rise: jumps land quicker and feel less floaty  |
|                         | 608/2176                 | 640/2304               |                                                                        |
| `jumpBuffer`            | 6                        | 6                      | a press up to 0.1 s before landing still jumps                         |
| `coyote`                | 6                        | none                   | a press up to 0.1 s after walking off a ledge still jumps              |
| `jumpCut`               | 8192                     | none                   | letting go of jump while rising caps the rise at 2 px/tick: short hops |
| `maxFall`, `fallReset`  | 17408, 16384             | 17920, 16384           | a 4.25 px/tick fall cap: fast, still readable at 320x180               |
| `stompBounce`           | 16384                    | 16384                  | a stomp bounces about as high as a short jump                          |
| `hp`, `maxHp`, `lives`  | 2, 2, 3                  | 2, 2, 3                | two hits, three tries; the checkpoint makes a death cheap              |
| `invulnTicks`           | 120                      | 120                    | 2 s to get clear after a hit                                           |
| `breakBricksAt`         | left out                 | 2                      | bricks never break (no level has any yet)                              |
| actors                  | `walker`, `ledge-walker` | four types             | speed 1536 (0.375 px/tick): simple enemies to stomp                    |

## Files

- `game.json`: kit `platformer` (no `uses`: no mini games), content kinds `level`, `campaign`,
  `profile`, `palette`, `sprite`, `skin`, `sfx`, `song`, `font`; seed 1; **screen 320x180**;
  `transitions.level` (a fade between stages); `menus` (title "Hopper's Way", start, controls,
  settings; pause; the controls rows Walk, Run (hold), Jump (hold for higher)); `headless.ts`,
  `view.ts`. `index.html` is the page (the games index's 2D and `3D` links).
- `content/campaigns/main.campaign.json`: the stage list, `level-1`, `level-2`, `level-3`, `boss`.
- `content/levels/<id>.json` + `<id>.map.txt` (format: `kits/platformer/CLAUDE.md` and `LEGEND` in
  `kits/platformer/legend.ts`): `level-1` (spawns `w`: a `walker` facing left) and the three
  placeholders, all with `profile: "hoppers-way"` and `scroll: "right"`.
- `content/profiles/hoppers-way.profile.json`: the tuned profile (above).
- `content/sprites/hopper-sky.txt` + `content/palettes/hopper-sky.json` (T6): the parallax
  layers, original text pixel art (below). `content/sprites/hopper.txt` + `palettes/hopper.json`
  and `hopper-font.txt`: the old placeholder art, now used only by the 3D skin (until T10).
  `content/fonts/hopper-small.txt`, `hopper-title.txt` (the HUD's counters and the menus),
  `content/sfx/*.json`, `content/songs/meadow.json`: fonts and the placeholder sound (T9 redoes it).
- `content/skins/canvas2d.json`: the 2D skin, built on the CC0 PNG packs (T6, "The 2D skin"
  below). `three.json`: the 3D skin, still low-poly meshes (T10 makes the 2.5D view), with the 2D
  skin's `images` (for the HUD's frames), `events`, `emitters`, `hud` and `camera`, the 0.16 T12
  scene look and labels.
- `assets/` (Engine 0.16 part B, T4): the one place binary files may live (docs/DESIGN.md,
  item 322): four CC0 packs, each a folder credited in `assets/CREDITS.md` (`## <pack>` with
  `Source:`, `Author:`, `Licence:` and the files kept; `validate` fails on a pack with no section
  or a licence that is not CC0). About 1.8 MB in all; only the files the game will use were kept,
  their names lower-cased with spaces as hyphens. The 2D skin uses the two PNG packs (T6); the
  2.5D view (T10) will use the GLBs as `model` entries.
  - `pixel-adventure-1/` (Pixel Frog, itch.io; 89 PNGs, 84 KB): `terrain/terrain-16x16.png`,
    `background/<colour>.png` (64x64 tiling backgrounds), `characters/ninja-frog/*-32x32.png`
    (the player: idle, run, jump, fall, double jump, wall jump, hit) and the appear/disappear
    puffs, `items/` (fruits, boxes, start, checkpoint flag and end), `traps/` (spikes, saw, fire,
    platforms, trampoline, spike head, rock head and more), `other/` (dust, confetti,
    transition, shadow). The pack has no enemies (item 364).
  - `kenney-pixel-platformer/` (Kenney, itch.io mirror; 10 KB): the packed 18x18 tiles, 24x24
    characters (the 2D enemies) and background sheets, with their `tilesheet-*.txt` grid notes.
  - `kenney-platformer-kit/` (Kenney, version 1.1 from OpenGameArt; 59 GLBs, 572 KB): terrain
    blocks (`block*.glb`), `platform`, bridges, ladders, crates, coins, `flag`, `door`, spikes,
    `saw`, fences, hedges, `tree`, flowers, rocks. Flat material colours, no texture files.
  - `quaternius-platformer/` (Quaternius, itch.io; 1.1 MB): `character.glb` (the 2.5D player
    stand-in, with `Idle`, `Run`, `Jump`, `Death` and more clips) and the enemies `enemy.glb`,
    `crab.glb`, `skull.glb`, `bee.glb` (item 365: the Kenney kit has no characters). Repacked
    from `.gltf` to `.glb`, bytes unchanged.
  - `assets.test.ts` checks the four packs are credited as CC0 with a source URL, that the folder
    holds only PNGs, GLBs and the packs' licence and grid notes, that every PNG reads and every
    GLB is a self-contained glTF 2.0 model, and the player's and an enemy's clips.
- TypeScript, glue only: `content.ts` (`loadHopper`, `hopperStages`, `hopperSkins`,
  `PLATFORMER_MUSIC`), `headless.ts` (`createGame`: the kit's `LevelSequence` with `viewWidth`
  from the screen; `starts`), `picture.ts` (`hopperLook`: the skins, the sheets with the PNGs,
  the fonts and the size; `hopperFrames`, `hopperPicture`, `hopperCanvasPicture`), `picture3d.ts`
  (`hopperLook3d`), `view.ts` (`createView`, for `screenshot`), `main.ts` (awaits
  `withContentImages` so the PNGs are decoded before the first frame, then `bootBrowserGame`
  with the levels by name for the level select, `booted.start` for a chosen level, the shell's
  `hitPause` to both displays, the `HostScene` over the game). Each is a few calls into the
  engine and the kit.
- `platformer.test.ts`: content loads; the stage list; the 16:9 screen; the tuned profile's
  fields; level-1's checkpoint, coins, block and walkers; text-only content outside `assets/`;
  the start state, the view width and equal snapshots on two runs; the skins covering every kind,
  state, tag, tile, event and HUD value every run shows, the 3D skin matching the 2D one, the
  sounds and song; every tick of every run drawn from the art (the PNGs "decoded" in Node from
  their headers), never a fallback box (every 2D entry's `fallbackColor` is `#ff00ff`, so a
  missing frame is caught); from T6 the tile joins on level-1's map, the frog's states and
  sheets, the checkpoint's flag raise, the feel events, and every run drawn through the Canvas2D
  presenter asking for hit-pauses with the same state hash on every tick as an undrawn game.

## The 2D skin (T6; feedback items 370-374)

`content/skins/canvas2d.json`, the art and feel pass. Presentation only: no rule, profile or level
map changed, so every golden hash is the same (the sample's tests draw every tick and compare state
hashes with an undrawn game). Built by a small script and tuned from screenshots; edit the JSON
by hand now. Every 2D entry's `fallbackColor` is `#ff00ff`, so a missing frame shows (and fails
`platformer.test.ts`).

- **`images`** (the CC0 PNGs in `assets/`): `terrain` (Pixel Adventure's 16 px terrain: the grass
  block's nine pieces `grass-top-left` .. `dirt-bottom-right`, the four inner-corner `notch-*`
  pieces, `prize` (gold), `used` (steel), `brick`, `plank-*`, an empty `air` cell and the wood
  frame `hud-panel`), `spikes`, one sheet per frog animation (`frog-idle` 11 frames, `frog-run`
  12, `frog-jump`, `frog-fall` (also the HUD's `frog-face`), `frog-hit` 7 (the first two white),
  `frog-spin`), `puff` (the 96 px disappearing puff, centred, and a 1 px `blank`), `flag` (the
  26-frame flag raise), `flag-wave`, `flag-pole`, `trophy` (the goal), `sparkle` (the fruit
  "collected" ring), `dust`, `pickups` (Kenney's coin and its edge, the three hearts, a 12 px
  `hud-coin`) and `critters` (Kenney's enemies: `blob-*` for `walker`, `spike-*` for
  `ledge-walker`, each with a flattened frame). Frog frames are anchored `bottom` (32 px over the
  12x16 box), the checkpoint's on its pole (`{ x: 23, y: 63 }`).
- **Tiles**: `#` joins its own kind (`join`, the engine's neighbour-based tile frames): grass on
  top, dirt edges at the sides and bottom, outer corners, and notches where the ground meets a
  step (`inner-top-left`, `inner-top-right`); `=` planks with ends (`edge: open`); `?` the gold
  block, `u` steel, `B` brick, `^` spikes, `.` the empty `air` cell.
- **The frog (`runner`)**, each state from its own PNG (a cycle's `sheet`): `idle` is a 5-tick
  landing crouch (`run-4`) that hands over to `breathe` (the 11-frame idle at 4 ticks); `walk`
  (4 ticks a frame) and `run` (2) the 12-frame run with `footstep` frame events on frames 4 and
  10 (the feet down); `skid` the crouch with a `skid-dust` frame event; `jump`, `fall`; `hurt`
  the 7 hit frames (the two white ones are the hit flash); `dead` (the remains after a death, and
  a failed level) the hit frames, then `vanish` (the puff, a `poof` frame event) and `gone`.
- **Others**: `walker`/`ledge-walker` two-frame walks (`run` faster) and a flattened `stomped` /
  `dead`; `coin` Kenney's coin turning to its edge every 62 ticks with a `coin-glint` emitter (a
  rare white mote); `goal` the trophy with `trophy-shine` motes; `bump-block` gold, steel once
  used; `checkpoint` the bare pole, and with the kit's `active` state (from T6, timed from the
  touch) the 26-frame flag raise, then `waving`.
- **Feel** (`events`, `emitters`; all presentation): `jump` stretches (scaleY 1.3, scaleX 0.8,
  9 frames back) with `jump-dust`; `land` squashes (scaleY 0.72, scaleX 1.25, `backOut`) with
  `land-dust`; `footstep` puffs `run-dust`, `skid-dust` a wider puff; `stomp` a 4-frame
  `hitPause`, a 2.5 px shake, stars and an additive ring, and squashes the walker's remains;
  `hurt` a 6-frame `hitPause`, a 3 px shake, a white screen flash (0.35), red-white sparks and,
  after the white frames, an alpha blink through the invulnerability; `died` a hit-pause, shake
  and a softer flash; `coin` gold sparks and the sparkle ring; `bump` gold bits and a small
  shake; `checkpoint` confetti; `respawn` a ring and a pop-in (scale and alpha); `cleared`
  confetti and a 1.25 zoom punch. The emitters' dust is cream and grey, so it reads on grass and
  sky.
- **Parallax** (back to front): a 14-band sky gradient, then `hopper-sky`'s `clouds` (x 0.08),
  `mountains` (x 0.18, snow caps), `hills` (x 0.38, trees on the crests) and `bushes` (x 0.62,
  dark enough to fill a pit's bottom), each 320 px wide and seamless, drawn by a small
  generator (periodic ridges, crest trees, cloud blobs).
- **HUD** (the UI kit): the wood `hud-panel` (slice 16, so its corner ornaments stay in the
  corners) holding empty hearts for `maxHp` under full ones for `hp`, a coin `counter` (two gold
  digits, rolling white for 20 frames) and a lives `counter` with the frog's face (`x{value}`).
- **Camera**: follow the runner, deadzone 24x40, lerp 0.2, `lookAhead` 36 px (lerp 0.05): at
  320x180 the frog sits left of centre running right, with room to see the next gap.
- **Menus** (`game.json`): the wood panel (slice 16) for every menu screen, gold headings with a
  dark outline, a green focus bar, cream text; the title "Hopper's Way" with the subtitle "A
  frog's run through the long meadow", the frog (`idle-0` x3) and a blob (x2) as art over the
  game's own picture (dim 0.78); title items Start, Levels (the T3 level select, "Pick a level",
  `*` after a cleared one), Controls, Settings. The levels have names: Meadow Start, Over the
  Hills, Treetop Path, The Boss (T7 and T8 may rename them).
- **Screenshots** taken and looked at while tuning (`pnpm -s cli screenshot ... --scale 6` and
  `pnpm -s cli sheet`): `level-1` ticks 3, 40, 58-62 (coins, sparkle), 88-94 (landing squash and
  dust), 120-124 (the block), 214-220 (stomp), 355-412 (checkpoint flag raise and wave, the
  ledge), 500, 612-634 (running, run dust, the running jump's stretch), 707 and 720 (the trophy,
  confetti, zoom); `level-1-hurt` 209-240 (hit flash, blink); `level-1-lost` 513-545 (death,
  puff); and the `title`, `levels` and `pause` overlays.

## Run files

| run            | ticks | ends at                                                  | guards                                                                                                                                                                                               |
| -------------- | ----- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level-1`      | 730   | `level-1` cleared at tick 707, 12 coins                  | gravity, walk, run-speed, air-control, jump, jump-by-speed, variable-jump, coyote-time, solid-tiles, coins-collect, bump-blocks, checkpoints, goal-clears-level, actors-wake, stomping, stomp-bounce |
| `level-1-lost` | 910   | every life lost (failed at 843), `level-1` afresh at 903 | gravity, fall-cap, walk, air-control, jump, variable-jump, solid-tiles, pits-kill, checkpoints                                                                                                       |
| `level-1-hurt` | 300   | hurt by the first walker at 209 (hp 1, invulnerable 120) | walk, air-control, jump, variable-jump, solid-tiles, actors-wake, enemy-touch-hurts, invulnerability                                                                                                 |

- `level-1.run.json` (the win): walks right and jumps for the coins (2 at tick 58), bumps the
  block (a coin, 4 at 123), clears the 2-tile gap, stomps the first walker with a short hop
  (jump let go after 4 ticks: the jump cut; stomp and bounce `vy` -16384 at 214), climbs the
  step, touches the checkpoint (`checkpoint` `{ col: 36, row: 9 }` at 355), climbs the ledge
  (three coins), walks off its edge (tick 485: off the ground, `player.coyote` 6) and jumps 5
  ticks later (491: a `jump` event, coyote 0; with `coyote-time` off it falls into the pit),
  drops onto the second walker (stomp at 579), holds run from 604 (`vx` 10240) and takes the
  6-wide gap at the top tier (633: `jump` tier 2; walking it falls short), and clears the level
  at 707 (12 coins, `scrollX` 245760: the view at the level's end). Invariants: 3 lives, 2 hit
  points, stage 0.
- `level-1-lost.run.json` (the loss: all lives lost): the win's input to the ledge, then walks
  off it into the pit without jumping (died, `pit`, 2 lives, back on the checkpoint at
  `player.x` 149504 at 513), climbs the ledge and falls in again (678: 1 life, the checkpoint
  again) and again (843: 0 lives, outcome `failed`); 60 ticks later (903) `level-1` starts
  afresh: `playing`, 3 lives, no checkpoint, no coins. Invariants: stage 0, level `level-1`.
- `level-1-hurt.run.json` (T6, for the hurt screenshots: the hit flash, shake and blink): the
  win's input to the first walker, then walks into it instead of stomping it (`hurt`, hp 1,
  `player.invuln` 120 at 209). Invariants: 3 lives, stage 0. Final hash in its `.hashes.json`.
- Run one: `pnpm -s cli run games/samples/platformer/runs/level-1.run.json --json`; its rules:
  `pnpm -s cli mutants games/samples/platformer/runs/level-1.run.json --json` (exit 0 for both run
  files). The whole folder does not guard every kit rule yet (no bricks, shells or boss): the
  platformer lab does; T7 and T8 add run files here.
- Golden hashes: `runs/<name>.hashes.json`, written with `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`
  (never by hand). Final hashes: `level-1` `3e3c45961fcf7c2e`, `level-1-lost` `a5217ed93bfcb6e0`;
  every hash is the same through the null backend, Canvas2D and the Three.js scene builder.
- Changing level-1 or the profile moves these hashes: re-find the ticks with `pnpm -s cli trace
<run> --paths player.x,player.y,events` and `dump`, keep the assertions on what the rules
  decide, and re-record (list the re-recorded hashes in the commit and the build log).

## How to add a level (T7 and T8)

1. Draw `content/levels/<id>.map.txt` in the kit's `LEGEND` (12 rows suit the 180 px screen:
   the bottom two rows ground) and write `<id>.json` (`id`, `profile: "hoppers-way"`, `scroll`,
   `spawns`; for the boss `"clear": "boss"` and the boss's actor type in the profile). Replacing
   a placeholder keeps its id, so the campaign needs no change.
2. `pnpm -s cli validate games/samples/platformer --json` (exit 0).
3. A new kind or state needs entries in both skins and frames in the sheet: `platformer.test.ts`
   and the backend parity test fail on a missing one.
4. Run files `runs/<id>.run.json` (win) and `<id>-lost.run.json` (loss) with `"start": { "stage":
n }` (0-based place in the campaign), found a jump at a time with `trace` and `dump`, with
   `guards` checked by `mutants`; golden hashes as above.

## How to test

`pnpm test games/samples/platformer` (`platformer.test.ts`, `assets.test.ts`), `pnpm -s cli
validate games/samples/platformer --json`, `pnpm -s cli run games/samples/platformer/runs/level-1.run.json
--json`, `pnpm -s cli mutants games/samples/platformer/runs/level-1.run.json --json`, `pnpm test
tests/runs` (golden hashes and backend parity), `pnpm -s cli screenshot
games/samples/platformer/runs/level-1.run.json --tick 400 --scale 6 --json` (a 1920x1080 PNG;
`--backend three --allow-software-gl` for 3D without a GPU), `pnpm test tests/browser` (the games
index's 2D and 3D links, the title, pause and settings screens, the volume control).

## How to play (2D and 3D)

`pnpm dev` and open `/games/samples/platformer/` (`?backend=three` for 3D): arrows (or the touch
pad) walk, Z jumps (hold for higher), X runs. The page opens on the title screen; Escape, P,
gamepad Start or the `II` button pause.

## Imports

- Allowed: relative paths inside `games/samples/platformer`, `@engine/*` (core and backends) and
  `@kits/platformer`.
- Never: other games (not even `games/platformer-classic` or `games/platformer-lab`: copy and log
  a gap instead) or other kits. Nothing in `engine/` or `kits/` imports from here.
