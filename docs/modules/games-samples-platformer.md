# games/samples/platformer

Folder: `games/samples/platformer`. Detailed rules: [`games/samples/platformer/CLAUDE.md`](../../games/samples/platformer/CLAUDE.md).

## Purpose

The platformer kit's sample and the engine's flagship, **Hopper's Way** (Engine 0.16 part B): a
short side-scroller of three levels and a mini-boss on `kits/platformer`, in 2D (Canvas2D) and
2.5D (Three.js, `?backend=three`), at a 16:9 screen (320x180: 6x is 1920x1080). Built a task at a
time: T5 gave it a tuned profile (coyote time, jump buffering, a jump cut, run acceleration and
fall speeds, as data), its screen, its campaign (`level-1`, `level-2`, `level-3`, `boss`) and its
first level, with run files for a win and a loss; the art pass (T6, the CC0 packs in `assets/`),
levels 2 and 3 (T7: an autumn level of one-way planks and pacing threats, a night level of
spikes, buffered and coyote jumps, each with its own sky and ground), the mini-boss (T8:
Burrlock, the bramble beetle, in an arena at dusk, with telegraphed attacks, a faster second
phase, white hit flashes, hit-pauses, a boss bar and a defeat sequence, then the end screen),
music (T9) and the 2.5D view (T10) follow. T6 drew it
from the CC0 PNG packs: ground joined by its neighbours, the Ninja Frog with every state (a
landing crouch, a dying puff), Kenney's critters, a raised checkpoint flag, a trophy goal, four
parallax layers of original text art, squash and stretch, dust and run particles, hit flashes,
shakes and hit-pauses, a wood-panel HUD and menus, all presentation (no hash moved). The old content of this folder (the Engine 0.7 stacking test's
five levels and two doors) is the test game [`games/platformer-classic`](games-platformer-classic.md)
since T5. It holds only content, skins and thin glue.

## Public API entry points

- `game.json`: the manifest (kit `platformer`, 320x180, seed 1, `transitions.level` and (T8)
  `transitions.respawn` (an iris on the frog), `menus` with (T8) the level-clear banner (`clear`)
  and the end screen (`end`: stats, Back to title, Levels), `headless.ts`, `view.ts`).
- `content/`: `campaigns/main.campaign.json` (the stage list), `levels/level-1.json` +
  `level-1.map.txt` (80x12: coins, a bump block, two walkers, a checkpoint, a coyote-time pit, a
  running-jump gap), `level-2` (T7, Autumn Hills, 100x12: one-way planks over pits, walkers and
  ledge-walkers pacing steps and planks, a checkpoint, a high off-path coin cache with a life
  block), `level-3` (T7, Starlit Ridge, 104x12: spikes, a buffered-jump chain over narrow pillars,
  a multi-coin block, a checkpoint, a coyote jump over a spike field, a tunnel coin cache under a
  spiked roof, gold planks over a spike floor) and `boss` (T8, Burrlock's Hollow, 40x12: a runway with a
  checkpoint, a step down under a hanging wall into an arena, `"clear": "boss"`),
  `profiles/hoppers-way.profile.json` (the tuned profile; its numbers and reasons are a table in
  the `CLAUDE.md`; from T8 also the boss type `burrlock` on the kit's boss form and its
  projectiles `thorn` and `acorn`), `sprites/burrlock.txt` with `palettes/burrlock.json` and
  `burrlock-angry.json` (T8: the boss's original text pixel art, its poses, white flash, defeat
  frames, shots and HUD name plate; the angry palette is its second phase), `sprites/hopper.txt` and `hopper-font.txt` with `palettes/hopper.json`,
  `fonts/`, `sfx/`, `songs/meadow.json` (placeholders copied from the classic game; `hopper.txt` now only for the 3D skin, until T10), `sprites/hopper-sky.txt` with
  `palettes/hopper-sky.json` (T6: the parallax clouds, mountains, hills and bushes),
  `sprites/hopper-autumn.txt` and `hopper-night.txt` with their palettes (T7: those layers
  recoloured for level-2 and level-3, and a star field with the moon),
  `skins/canvas2d.json` (T6: the 2D skin on the PNG packs; its parts are listed in the
  `CLAUDE.md`, "The 2D skin"; from T7 its `themes` give level-2 an autumn sky and ground and
  level-3 a night sky and rose sand; from T8 the boss's telegraph looks, hit and defeat effects,
  boss bar and the arena's dusk theme) and `skins/three.json`.
- `assets/` (Engine 0.16 part B, T4): four CC0 packs as binary files, each credited in
  `assets/CREDITS.md` (source URL, author, licence, files kept; checked by `validate`), about
  1.8 MB in all: `pixel-adventure-1` (Pixel Frog: terrain, backgrounds, the Ninja Frog player,
  items, checkpoints, traps, effects; PNG), `kenney-pixel-platformer` (Kenney: 2D enemies and a
  second tile set; PNG), `kenney-platformer-kit` (Kenney, version 1.1: 2.5D terrain blocks,
  platforms, props, coins, flag; GLB) and `quaternius-platformer` (Quaternius: the 2.5D player
  stand-in and enemies, animated; GLB). The 2D skin uses the PNG packs (T6), the 2.5D view (T10)
  will use the GLBs;
  `assets.test.ts` checks the credits and that every PNG and GLB reads (feedback items 364, 365).
- `content.ts`: `loadHopper(files)`, `hopperStages(content)` (the kit's `contentStages`: the
  campaign's order), `hopperSkins(content, backend)`, `PLATFORMER_MUSIC`.
- `headless.ts`: `createGame(content, seed, opts?)` (the `HeadlessGame` contract): the kit's
  `LevelSequence` over the stages with `viewWidth` the screen's width (320), `LEVEL_PAUSE` ticks
  between stages; `starts(content)` (one stage per campaign entry).
- `picture.ts`: `hopperLook` (skins, sheets with the PNGs, fonts, size), `hopperFrames`,
  `hopperPicture`, `hopperCanvasPicture`;
  `picture3d.ts`: `hopperLook3d`; `view.ts`: `createView` (the engine's `frameView`), for
  `pnpm cli screenshot`.
- `main.ts` and `index.html`: the page (`bootBrowserGame`, the engine's `HostScene` over
  `createGame`, `canvasDisplay` and, for `?backend=three`, a lazily imported `threeDisplay`; the
  PNGs decoded first with `withContentImages`; the song, sfx, hit-pauses and menus, with the
  level select over the levels' names, through the shell).
- `runs/level-1.run.json` (the win: cleared at tick 707) and `runs/level-1-lost.run.json` (the
  loss: every life lost, two respawns on the checkpoint, the level afresh), with golden
  `.hashes.json` files and `guards` (coyote time, checkpoints, the jump cut, run speed and more);
  `runs/level-1-hurt.run.json` (T6: hurt by the first walker at tick 209, for the hit flash);
  T7's `level-2`, `level-2-lost`, `level-3` and `level-3-lost` (each `start: { stage }`, so a
  change to level 1 moves none of them: wins with one-way platforms, a ledge-walker's turn, a
  life block, buffered and coyote jumps; losses with two respawns on the checkpoint, by pits and
  by spikes); T8's `boss` (Burrlock beaten: cleared at tick 789), `boss-lost` (three lives lost
  to the boss, the arena afresh) and `full-game` (from the title's first stage, level-1, through
  every level and the boss to the end, cleared at 3645: the four wins' input on the stages'
  ticks).

## Imports allowed

- Relative paths inside `games/samples/platformer`, `@engine/*` (core and backends) and
  `@kits/platformer`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/platformer` (`platformer.test.ts`: content, the stage list, the 16:9
screen, the tuned profile, the start state, the view width, determinism, the skins covering
everything the runs show in 2D and 3D, no fallback box on any tick, the tile joins, the frog's
sheets, the feel events, every run drawn with its hit-pauses and the same state hashes, and (T8)
the arena, the boss's telegraphed pattern and phases, its skin and the clear and end menus;
`assets.test.ts`: the CC0
packs credited, every PNG and GLB readable). `pnpm -s cli validate games/samples/platformer
--json`, `pnpm -s cli run games/samples/platformer/runs/level-1.run.json --json`, `pnpm -s cli
mutants games/samples/platformer/runs/level-1.run.json --json` (exit 0 for each run file),
`pnpm test tests/runs` (golden hashes, backend parity), `pnpm -s cli screenshot
games/samples/platformer/runs/level-1.run.json --tick 400 --scale 6 --json` (and `--overlay
title`, `levels`, `pause`; `pnpm -s cli sheet` for many ticks), `pnpm test
tests/browser` (`menus.test.ts`, T8: Hopper's Way's level-clear banner by keyboard and the boss
beaten to the end screen by gamepad). Play it: `pnpm dev`, open `/games/samples/platformer/` (arrows, Z jumps, X runs).
