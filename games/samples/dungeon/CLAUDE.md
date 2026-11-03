# games/samples/dungeon

**The Old Crypt**, the top-down kit's sample game: a short, finished dungeon of five rooms with a
start, a way through, a goal and two end states, all in data files, with original NES-style pixel
art, MML music and sound effects. This file is a worked example: it says how the sample was built,
step by step, so an agent can build the next top-down game the same way. It began as the engine
demo (a proof-of-life game in its own `demo` folder, Engine 0.2-0.14), moved here at Engine 0.15
T2 with its run file and golden hashes unchanged, and was finished as a sample in Engine 0.15 T12.
It is content, not engine: the kit holds the rules, this folder holds rooms, art, sound and thin
glue.

## The dungeon

```
 (0,0) store-room  --cracked wall-->  (1,0) bat-hall  --locked door-->  (2,0) crypt  --exit (north)-->
        |                                                                  goal room
 (0,1) courtyard (start)  --open door-->  (1,1) guard-room (a side room full of monsters)
```

1. **courtyard** (start, `@`): four blocks, a heart; doors north and east. Its `music` is `crypt`.
2. **guard-room**: three bats, a knight and a rock-spitter; a dead end to fight in (or die
   in: the fail case).
3. **store-room**: a chest holding the `bomb` item (`chests: ["bomb"]`: the item itself, which
   gives the bombs with their starting ammo; `bombs` would only add ammo to an item not owned),
   two cold torches, and a cracked east wall (`C` on the border: a doorway that starts shut).
4. **bat-hall**: reached by bombing the cracked wall (a blast opens both sides); three bats, a
   statue block in the middle, a key (`k`) and a locked east door (`L`).
5. **crypt**: the goal room (`goal: true`), its chest holding the relic (`triforce`, kept in the
   world's `found`), and two exit tiles (`E`) on its north border: stepping on one sets the world's
   `exited`, the run's win.

A run ends **escaped** (the hero reached an exit: `exited`) or **fallen** (the hero died after his
death spin: `hero.dead`). `dungeonEnd(world)` (`picture.ts`) reads both; the status lines say which
and the scene starts a new run on Z or X (below). Both are world state, so run files assert them.

## How it was built (the worked example)

1. **Start from the scaffold** (`.claude/skills/scaffold-game/SKILL.md`): `game.json` (kit
   `topdown`, content globs by kind, seed, screen, headless and view entries), one room, a skin,
   `headless.ts`, `view.ts`, `index.html` + `main.ts`, a run file.
2. **Rooms as data.** Each room is `content/rooms/<id>.json` (its `RoomDef` fields: `id`, `at` its
   map cell, `music`, `chests`, `goal`, `hint`, ...) plus `<id>.map.txt`, 11 rows of 16 characters
   from the kit's `LEGEND` (`kits/topdown/room.ts`: `#` wall, `.` floor, `O` open door, `L` locked
   door, `C` cracked wall, `E` exit, `@` start, `k` key, `c` chest, `b` bat, `n` knight, `r`
   spitter, `S` statue ...). Neighbouring cells need facing doors that line up (east/west doors are
   one cell, north/south two). `pnpm -s cli validate games/samples/dungeon` names any room, row and
   column that is wrong. Keep rooms a run file already plays as they are (here the courtyard and
   guard room: walk-east's hashes must not move) and grow the dungeon beside them.
3. **Plan the path, then script it.** The path to the end needs the kit's rules in order: open a
   chest by walking into it, select-free item use (the first item found goes in the slot), set a
   bomb by a cracked wall (C, `special`), pick up a key, walk into a locked door. A small scratch
   controller (hold a direction until `hero.x`/`hero.y` reaches a target, or until a world
   condition holds) found the input steps; `pnpm -s cli trace <run> --paths hero.x,hero.y,room`
   and `pnpm -s cli dump <run> --tick N` check them. The steps then went into the run file as
   plain data: no bot is needed to replay it.
4. **Run files with golden hashes** (below), then `WW_UPDATE_GOLDEN=1 pnpm test tests/runs` to
   write the new `.hashes.json` files (never by hand), and `pnpm -s cli mutants
games/samples/dungeon --json` to see every kit rule guarded.
5. **Art as text.** `content/palettes/<id>.json` (NES colours) and `content/sprites/<sheet>.txt`
   (a `palette` line, a `legend` per character, then `frame <name>` and its rows; format at the top
   of `engine/core/gfx/sprite-schema.ts`). Two sheets: `hero` (the hero's walk, attack, throw,
   hold and poof frames, side frames facing right) and `dungeon` (every tile, pickup, chest,
   switch, torch, monster, shot, effect and HUD icon). Draw tiles opaque (a tile's clear pixels
   show the background, not the floor), monsters and items with a black outline on clear.
6. **The skin** (`content/skins/canvas2d.json`, format: `engine/core/present/skin.ts`) maps what
   the kit presents to the art: `kinds` (each presented kind and animation state to frames, with
   `{ frames, ticks }` cycles and `flipFacing` for left; the table in `kits/topdown/CLAUDE.md`
   lists every kind and state), `tiles` (every `PRESENT_TILES` character), `events` (sounds and
   effects per kit event: `room` door, `unlock`, `sword`, `hit`, `kill` with particles, `pickup`,
   `chest`, `bomb` fuse, `blast` with a shake, `hurt`, `dying`, `exit` with a gold flash and the
   fanfare), `hud` (half-heart pips, keys, the item icon), `background` (black, Engine 0.15 gap
   G36) and `sheets.fallbackColor` (a pink no frame should ever show: the kinds and tiles carry no
   fallback colour of their own, and `dungeon.test.ts` fails if a run draws one).
7. **Music and sound as MML.** `content/songs/crypt.json` (the looping dungeon theme, D minor,
   four channels; every channel the same length so the loop stays in step: the test checks it)
   and `daylight.json` (the short tune for the way out); `content/sfx/*.json`, one per skin sound.
8. **Glue only in TypeScript** (below), then the browser test and the agent docs.

## Files

- `game.json`: the manifest (schema: `engine/core/content/manifest.ts`): kit `topdown`, content
  globs (`room`, `song`, `palette`, `sprite`, `sfx`, `skin`), seed 1, 256x240, `headless.ts`,
  `view.ts`. Its `title` and `index.html`'s `<title>` are the games index's line.
- `content/rooms/`: `courtyard`, `guard-room`, `store-room`, `bat-hall`, `crypt` (above).
- `content/songs/`: `crypt`, `daylight`. `content/sfx/`: `blast`, `chest`, `door`, `fall`,
  `fanfare`, `fuse`, `hit`, `hurt`, `kill`, `pickup`, `spit`, `sword`, `unlock`.
- `content/palettes/`: `hero`, `dungeon`. `content/sprites/`: `hero.txt`, `dungeon.txt`.
- `content/skins/canvas2d.json`: the skin (above).
- `content.ts`: the content kinds (`dungeonKinds`), `loadDungeon(files)`, `mustLoad`, and
  `dungeonRooms`, `dungeonSongs`, `dungeonSfx`, `dungeonSkin` over the loaded bundle;
  `DUNGEON_MUSIC` and `ESCAPE_MUSIC` (song ids).
- `headless.ts`: `createWorld(content, seed?, disabledRules?)` and `createGame(content, seed,
opts?)`, the engine's headless contract (`pnpm cli run`, `dump`, `mutants`).
- `picture.ts`: `dungeonLook(content)` (skin, sheets, picture size), `DungeonPicture`
  (`draw(world, events)`: the kit's `presentWorld`, frozen, to the backend's
  `SkinnedCanvasPresenter`, plus the status lines), `dungeonEnd(world)` and `drawStatusLines`
  (title, room, hearts, bombs once found, and the end banner).
- `view.ts`: `createView(content, seed, opts?)`, the view entry for `pnpm cli screenshot`.
- `scene.ts`: `DungeonScene`: the world stepped once per loop step, its events drawn through
  `DungeonPicture` with the shell's `onSound`, the `crypt` song on enter and `daylight` on the
  way out; once the run has ended (`dungeonEnd`), Z or X at least `END_HOLD` (60) steps later
  starts a new run seeded from the step count. The world keeps stepping after the end, so until a
  restart the scene is exactly the headless game: `headless()` gives the page's step hook its
  snapshot and hash.
- `main.ts`: `bootBrowserGame` (keyboard, gamepad, touch pad, loop, `?debug=step` step hook, audio
  with the songs and sfx and the `crypt` song once unlocked, the shell's volume control stored
  under `ww:dungeon:volumes`, gap M1) with `canvasDisplay`; the scene draws on its renderer.
- `index.html`: the page (canvas `#screen`); the root launcher lists it.
- The sample never calls a kit drawing function (`renderWorld`, `drawTdHud`, an entity's
  `render`): `dungeon.test.ts` fails if its code names one. No rooms, MML or pixel rows in `.ts`
  files (`tests/architecture/no-content.test.ts`).

## Adding a room

1. Pick a free map cell next to an existing room; add `content/rooms/<id>.json` (`id`, `at`) and
   `<id>.map.txt`; put a door on the facing edges of both rooms (same kind both sides for a locked
   or cracked one: opening one side opens both).
2. A new spawn character the kit lacks is a game's `extraLegend` (and spawner) in `headless.ts`.
3. `pnpm -s cli validate games/samples/dungeon --json` (exit 0, or each error at its file, row and
   column). The skin already covers every kind and tile the kit presents.
4. Add or extend a run file through it (below) and rerun the run files: walk-east, escape and
   lost-in-the-guard-room must keep their hashes unless the room changes a room they play.

## Run files and what each guards

`runs/<name>.run.json` (schema: `engine/tools/run-file.ts`, format in `engine/tools/CLAUDE.md`)
with `runs/<name>.hashes.json`, its golden state hashes; `tests/runs/run-files.test.ts` plays each
twice against them and `tests/runs/backend-parity.test.ts` with every tick presented through the
null backend and through `DungeonPicture`. Run one: `pnpm -s cli run
games/samples/dungeon/runs/escape.run.json --json` (exit 0 passed, 4 a failed check).

- `walk-east` (240 ticks, unchanged since the demo): right held from the courtyard into the guard
  room; asserts the room it ends in (guards `doors-change-room`).
- `escape` (1060 ticks, the path to the end): up into the store room and into the chest (the
  bomb), a bomb by the cracked east wall, into the bat hall, the key, the locked door, the crypt's
  chest (the relic) and out through the exit. Asserts each step (room, `inventory.current`,
  `inventory.ammo.bomb` 3 after the blast, `keys` 1 then 0, `found` has `triforce`, `exited` and
  the four rooms `visited`) and full hearts throughout; `guards: ["doors-change-room",
"keys-open-locked-doors"]`.
- `lost-in-the-guard-room` (1521 ticks, the fail case): left into the courtyard's west wall
  (`hero.x` 15 at tick 120), then into the guard room to stand among its monsters until the hero
  is down to one heart, dying (tick 1430) and dead with 0 hp at 1521; `guards:
["walls-block-movement", "damage-reduces-hp"]`.

`pnpm -s cli mutants games/samples/dungeon --json`: every `TOPDOWN_RULES` rule is guarded by some
run, and no run is weak on its own `guards` (`tests/runs/dungeon-mutants.test.ts` holds it to that,
though the top-down kit is not strict). After a change meant to move the game's state, regenerate
the golden files with `WW_UPDATE_GOLDEN=1 pnpm test tests/runs` and say why in the commit.

## Tests

- `dungeon.test.ts` (Node): the content loads (every file by kind), the rooms build, walk-east is
  drawn through the skin from the `hero` and `dungeon` sheets, the songs compile with channels of
  equal length, every skin sound is an sfx, walk-east's frames and golden hashes, walk-east's
  `door` and `spit` sounds, no placeholder file names and no per-kind fallback colours, **every
  tick of every run file drawn with no fallback box**, the end states of `escape` (escaped, with
  the relic) and `lost-in-the-guard-room` (fallen), `DungeonScene` playing `escape` with the
  headless game's snapshots, its music, the end held and Z starting over, and broken fields naming
  their file and field.
- `tests/browser/dungeon.test.ts` (headless Chromium, skipped without it): opens the built games
  index, follows its `games/samples/dungeon/` link, plays walk-east on the keyboard with
  `?debug=step` (the golden hash at every tick of `walk-east.hashes.json`, the guard room, the
  black HUD band and the wall colour, the volume control), and replays `escape` and
  `lost-in-the-guard-room` through `window.__ww.replay` with their golden hashes and end states.
- `tests/browser/volume-control.test.ts` checks the volume control and stored volumes here too.

## Picture size

`screen` in `game.json` is the only value to change for another picture size: the canvas, the
scaling, the touch layout, the kit's frames and screenshots follow it. The kit's camera hint
(`cameraHint`, `kits/topdown/present.ts`) keeps the HUD band (64 px) on top and centres the room;
the skin's HUD and the status lines stay top-left. `tests/build/two-resolutions.test.ts` copies
this folder at 320x240 and checks `validate`, `run` (the same hashes), `screenshot` and a build.

## How to run

- `pnpm dev` opens the games index; pick `games/samples/dungeon/` (or open it directly).
  Arrows move, X (or Z) the sword, C the item; `?debug=step` for the step hook.
- `pnpm build` builds it into `dist/games/samples/dungeon/`.
- `pnpm -s cli screenshot games/samples/dungeon/runs/escape.run.json --tick 950` shows the crypt.

## Imports

- Allowed: relative paths inside `games/samples/dungeon`, `@engine/*` (core and backends) and `@kits/*`.
- Never: other games. Nothing in `engine/` or `kits/` may import from here, and no alias points into
  `games/`.
- Game rules belong in data (rooms, songs, skin) wherever possible, not code.
