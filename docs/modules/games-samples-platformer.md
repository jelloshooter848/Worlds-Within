# games/samples/platformer

Folder: `games/samples/platformer`. Detailed rules: [`games/samples/platformer/CLAUDE.md`](../../games/samples/platformer/CLAUDE.md).

## Purpose

The platformer kit's sample and the engine's flagship, **Hopper's Way** (Engine 0.16 part B): a
short side-scroller of three levels and a mini-boss on `kits/platformer`, in 2D (Canvas2D) and
2.5D (Three.js, `?backend=three`), at a 16:9 screen (320x180: 6x is 1920x1080). Built a task at a
time: T5 gave it a tuned profile (coyote time, jump buffering, a jump cut, run acceleration and
fall speeds, as data), its screen, its campaign (`level-1`, `level-2`, `level-3`, `boss`) and its
first level, with run files for a win and a loss; the art pass (T6, the CC0 packs in `assets/`),
levels 2 and 3 (T7), the mini-boss (T8), music (T9) and the 2.5D view (T10) follow. Until T6 it
draws with placeholder text art. The old content of this folder (the Engine 0.7 stacking test's
five levels and two doors) is the test game [`games/platformer-classic`](games-platformer-classic.md)
since T5. It holds only content, skins and thin glue.

## Public API entry points

- `game.json`: the manifest (kit `platformer`, 320x180, seed 1, `transitions.level`, `menus`,
  `headless.ts`, `view.ts`).
- `content/`: `campaigns/main.campaign.json` (the stage list), `levels/level-1.json` +
  `level-1.map.txt` (80x12: coins, a bump block, two walkers, a checkpoint, a coyote-time pit, a
  running-jump gap) and the placeholders `level-2`, `level-3` and `boss`,
  `profiles/hoppers-way.profile.json` (the tuned profile; its numbers and reasons are a table in
  the `CLAUDE.md`), `sprites/hopper.txt` and `hopper-font.txt` with `palettes/hopper.json`,
  `fonts/`, `sfx/`, `songs/meadow.json` (placeholders copied from the classic game, plus a
  checkpoint), `skins/canvas2d.json` and `skins/three.json`.
- `assets/` (Engine 0.16 part B, T4): four CC0 packs as binary files, each credited in
  `assets/CREDITS.md` (source URL, author, licence, files kept; checked by `validate`), about
  1.8 MB in all: `pixel-adventure-1` (Pixel Frog: terrain, backgrounds, the Ninja Frog player,
  items, checkpoints, traps, effects; PNG), `kenney-pixel-platformer` (Kenney: 2D enemies and a
  second tile set; PNG), `kenney-platformer-kit` (Kenney, version 1.1: 2.5D terrain blocks,
  platforms, props, coins, flag; GLB) and `quaternius-platformer` (Quaternius: the 2.5D player
  stand-in and enemies, animated; GLB). No skin uses them yet (T6 and T10 will);
  `assets.test.ts` checks the credits and that every PNG and GLB reads (feedback items 364, 365).
- `content.ts`: `loadHopper(files)`, `hopperStages(content)` (the kit's `contentStages`: the
  campaign's order), `hopperSkins(content, backend)`, `PLATFORMER_MUSIC`.
- `headless.ts`: `createGame(content, seed, opts?)` (the `HeadlessGame` contract): the kit's
  `LevelSequence` over the stages with `viewWidth` the screen's width (320), `LEVEL_PAUSE` ticks
  between stages; `starts(content)` (one stage per campaign entry).
- `picture.ts`: `hopperLook`, `hopperFrames`, `hopperPicture`, `hopperCanvasPicture`;
  `picture3d.ts`: `hopperLook3d`; `view.ts`: `createView` (the engine's `frameView`), for
  `pnpm cli screenshot`.
- `main.ts` and `index.html`: the page (`bootBrowserGame`, the engine's `HostScene` over
  `createGame`, `canvasDisplay` and, for `?backend=three`, a lazily imported `threeDisplay`; the
  song, sfx and menus through the shell).
- `runs/level-1.run.json` (the win: cleared at tick 707) and `runs/level-1-lost.run.json` (the
  loss: every life lost, two respawns on the checkpoint, the level afresh), with golden
  `.hashes.json` files and `guards` (coyote time, checkpoints, the jump cut, run speed and more).

## Imports allowed

- Relative paths inside `games/samples/platformer`, `@engine/*` (core and backends) and
  `@kits/platformer`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/platformer` (`platformer.test.ts`: content, the stage list, the 16:9
screen, the tuned profile, the start state, the view width, determinism, the skins covering
everything the runs show in 2D and 3D, no fallback box on any tick; `assets.test.ts`: the CC0
packs credited, every PNG and GLB readable). `pnpm -s cli validate games/samples/platformer
--json`, `pnpm -s cli run games/samples/platformer/runs/level-1.run.json --json`, `pnpm -s cli
mutants games/samples/platformer/runs/level-1.run.json --json` (exit 0 for each run file),
`pnpm test tests/runs` (golden hashes, backend parity), `pnpm -s cli screenshot
games/samples/platformer/runs/level-1.run.json --tick 400 --scale 6 --json`, `pnpm test
tests/browser`. Play it: `pnpm dev`, open `/games/samples/platformer/` (arrows, Z jumps, X runs).
