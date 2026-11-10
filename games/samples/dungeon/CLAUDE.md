# games/samples/dungeon

**The Old Crypt**, the top-down kit's sample game: a short, finished dungeon of five rooms with a
start, a way through, a goal and two end states, all in data files, drawn at 16:9 on 0x72's CC0
DungeonTileset II (Engine 0.16 part C T3), with MML music and sound effects. This file is a worked example: it says how the sample was built,
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
        |
 (0,2) chasm (the dash, Engine 0.16 part C T5)  --open door (beyond the pit)-->  (1,2) warden-hall (boss, T6)
```

1. **courtyard** (start, `@`): four blocks, a heart; doors north, east and (from Engine 0.16 part C
   T5) south. Its `music` is `crypt`.
2. **guard-room**: three bats, a knight and a rock-spitter; a dead end to fight in (or die
   in: the fail case).
3. **store-room**: a chest holding the `bomb` item (`chests: ["bomb"]`: the item itself, which
   gives the bombs with their starting ammo; `bombs` would only add ammo to an item not owned),
   two cold torches, and a cracked east wall (`C` on the border: a doorway that starts shut).
4. **bat-hall**: reached by bombing the cracked wall (a blast opens both sides); three bats, a
   statue block in the middle, a key (`k`) and a locked east door (`L`).
5. **crypt**: the goal room (`goal: true`), its chest holding the relic (kit item `relic`, drawn as the pack's red-gem sword; kept in the
   world's `found`), and two exit tiles (`E`) on its north border: stepping on one sets the world's
   `exited`, the run's win.
6. **chasm** (Engine 0.16 part C T5): south of the courtyard; a chest holding the kit's `dash`
   item (`chests: ["dash"]`), a two-tile pit (`^`) from wall to wall, and a heart beyond it that
   only the dash reaches. The dash's tuning is the kit's default (`kitOptions.topdown.dash` would
   change it; `headless.ts` passes `topdownItems(content.manifest)`). A first room for the new
   wing T8 builds. From Engine 0.16 part C T6 an open east door beyond the pit leads on.
7. **warden-hall** (Engine 0.16 part C T6, a minimal boss room until T9's): east of the chasm,
   only reached with the dash. Its `boss` field declares the Bone Warden in data (the kit's boss
   form, `kits/topdown/CLAUDE.md`, Bosses: 3 hp, a charge and a ring of 8 shots, then at 1 hp a
   phase that summons bats and slams) and `shutters: "boss"` shuts its west shutter door once the
   hero is in until the boss is down; its defeat sets the world flag `bossDefeated`. The skin draws
   it as the pack's big demon (`boss:warden`, blinking on a hit), its shots as skulls, a HUD bar
   (`bossName`, `bossHp` over `bossMaxHp`, shown `when` `bossHp`) and the boss events' sounds,
   shakes, flashes, hit-pauses and particles.

A run ends **escaped** (the hero reached an exit: `exited`) or **fallen** (the hero died after his
death spin: `hero.dead`). `dungeonEnd(world)` (`picture.ts`) reads both; the end banner says which
and the scene starts a new run on Z or X (below). Both are world state, so run files assert them.

**Dialogs and the end screen** (Engine 0.16 part C T7): `game.json`'s `menus.dialogs` holds
`intro` (the knight's portrait, `crypt-actors`' `knight-idle-0`, two pages), `escaped` and
`fallen`, and `menus.triggers` shows `intro` after Start and, on the first presented frame whose
status says `exited` or `dead` (the kit's status, `kits/topdown/CLAUDE.md`), that end's dialog and
then `menus.end` ("You escaped!" or "You fell", the credits line, Time and Rooms seen from the
frame's `time` and `roomsSeen`, Back to title). The menus style's `sounds.type` (`ui-move`) and
`page` (`ui-select`) blip as the text types and turns. The text is a placeholder until T9. Where
the shell shows the end (`page.endings`: dialogs on), the scene gets `shellEnds`: no end banner
and no Z-to-restart (the end screen's Back to title starts a new run); with `?debug=step` or
`?record` the dialogs are skipped and the banner shows as before. `view.ts` draws no banner (as
the page) and gives `status()`, so `pnpm -s cli screenshot games/samples/dungeon/runs/escape.run.json
--tick 1060 --overlay end` shows the end screen with its stats and heading, and `--overlay
dialog:intro` (or `escaped`, `fallen`) a dialog.

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
5. **Art.** Until Engine 0.16 it was original NES-style text art; from part C T3 it is the CC0
   pack in `assets/` (below, "16:9 on the CC0 art"): the skin's `images` name rectangles of its
   `sheet.png`, and two text sheets (`content/sprites/crypt-art.txt`, `crypt-floor.txt`, format at
   the top of `engine/core/gfx/sprite-schema.ts`) hold the pieces cut, turned and pasted from it.
6. **The skin** (`content/skins/canvas2d.json`, format: `engine/core/present/skin.ts`) maps what
   the kit presents to the art: `images` (the pack's PNG), `kinds` (each presented kind and
   animation state to frames, with cycles, frame events and `flipFacing` for left; the table in
   `kits/topdown/CLAUDE.md` lists every kind and state), `tiles` (every `PRESENT_TILES` character,
   walls and doors joined by their neighbours), `events` (sounds, particles, shakes, flashes and
   hit-pauses per kit event), `emitters`, `hud` (framed panels, hearts, keys, the item),
   `background` and `sheets.fallbackColor` (a magenta no frame should ever show: the kinds and
   tiles carry no fallback colour of their own, and `dungeon.test.ts` fails if a run draws one).
7. **Music and sound as MML.** `content/songs/crypt.json` (the looping dungeon theme, D minor,
   four channels; every channel the same length so the loop stays in step: the test checks it)
   and `daylight.json` (the short tune for the way out); `content/sfx/*.json`, one per skin sound.
8. **Glue only in TypeScript** (below), then the browser test and the agent docs.

## Files

- `game.json`: the manifest (schema: `engine/core/content/manifest.ts`): kit `topdown`, content
  globs (`room`, `song`, `palette`, `sprite`, `sfx`, `skin`, `font`), seed 1, **320x180**, `headless.ts`,
  `view.ts`. Its `title` and `index.html`'s `<title>` are the games index's line.
- `content/rooms/`: `courtyard`, `guard-room`, `store-room`, `bat-hall`, `crypt`, `chasm`,
  `warden-hall` (above).
- `content/songs/`: `crypt`, `daylight`. `content/sfx/`: `blast`, `chest`, `door`, `fall`,
  `fanfare`, `fuse`, `hit`, `hurt`, `kill`, `pickup`, `spit`, `sword`, `unlock`.
- `content/palettes/`: `crypt-art`, `crypt-floor`. `content/sprites/`: `crypt-art.txt`,
  `crypt-floor.txt` (pieces cut from the CC0 pack, and a few original ones in its colours).
- `content/skins/canvas2d.json`: the skin (above).
- `content.ts`: `loadDungeon(files)` (the kit hook's kinds, `kitContentKinds([topdown],
manifestOptions(files))`), `mustLoad`, and `dungeonRooms`, `dungeonSkin` (the engine's
  `mustSkinSet`) over the loaded bundle; `DUNGEON_MUSIC` and `ESCAPE_MUSIC` (song ids). The
  songs and sfx are the engine's `contentSongs` and `contentSfx` (Engine 0.15 T15, the API review
  removed the sample's own `dungeonKinds`, `dungeonSongs` and `dungeonSfx` copies).
- `headless.ts`: `createWorld(content, seed?, disabledRules?)` (the kit's items from
  `topdownItems(content.manifest)`, so `kitOptions.topdown.dash` tunes the dash) and `createGame(content, seed,
opts?)`, the engine's headless contract (`pnpm cli run`, `dump`, `mutants`).
- `picture.ts`: `dungeonLook(content)` (skin, sheets, fonts, picture size), `HUD_TOP` (0),
  `DungeonPicture` (`draw(world, events)`: the kit's `presentWorld` with `idle`, frozen, to the
  backend's `SkinnedCanvasPresenter` or the `presenter` it is given, plus the end banner unless
  `banner: false`; `showHud(shown)`), `dungeonEnd(world)`, `endLines` and `endBanner` (a framed panel in the menus'
  font once the run has ended).
- `view.ts`: `createView(content, seed, opts?)`, the view entry for `pnpm cli screenshot` (with
  `showHud`, so the title overlay hides the HUD).
- `scene.ts`: `DungeonScene`: the world stepped once per loop step, its events drawn through
  `DungeonPicture` with the shell's `onSound`, the `crypt` song on enter and `daylight` on the
  way out; once the run has ended (`dungeonEnd`), Z or X at least `END_HOLD` (60) steps later
  starts a new run seeded from the step count (not with `shellEnds`, Engine 0.16 part C T7: the
  shell's end screen ends the run). The world keeps stepping after the end, so until a
  restart the scene is exactly the headless game: `headless()` gives the page's step hook its
  snapshot and hash.
- `main.ts`: awaits `withContentImages` (the PNG decoded before the first frame), then
  `bootBrowserGame` (keyboard, gamepad, touch pad, loop, `?debug=step` step hook, audio with the
  songs and sfx and the `crypt` song once unlocked, the shell's volume control stored under
  `ww:dungeon:volumes`, gap M1, hit-pauses) with `canvasDisplay`; the scene draws through the
  display's presenter (`DungeonSceneOptions.presenter`), so the settings and the title's hidden HUD
  reach it.
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
  `inventory.ammo.bomb` 3 after the blast, `keys` 1 then 0, `found` has `relic`, `exited` and
  the four rooms `visited`) and full hearts throughout; `guards: ["doors-change-room",
"keys-open-locked-doors"]`.
- `lost-in-the-guard-room` (1521 ticks, the fail case): left into the courtyard's west wall
  (`hero.x` 15 at tick 120), then into the guard room to stand among its monsters until the hero
  is down to one heart, dying (tick 1430) and dead with 0 hp at 1521; `guards:
["walls-block-movement", "damage-reduces-hp"]`.
- `cross-the-chasm` (400 ticks, Engine 0.16 part C T5): down into the chasm, into its chest (the
  dash), to the pit's edge (`hero.x` 145), the dash (`hero.dash.t` 8 at tick 365) over it to
  `hero.x` 193 (cooldown 24), and the heart beyond; full hearts throughout; `guards:
["dash-crosses-pits"]`. Adding the courtyard's south door moved no other run's hashes.
- `beat-the-warden` (960 ticks, Engine 0.16 part C T6): cross-the-chasm's input, then east into
  the warden hall (tick 410), leaning on the shut shutter (still there at 510), the fight (the
  charge step at 546, hp 2 with hit invulnerability at 570, phase 1 at 694, the defeat sequence
  from 726), `flags` `["bossDefeated"]` at 786 and out west through the opened shutter (the chasm
  at 960); `guards: ["boss-patterns", "boss-phases", "boss-hit-invuln", "boss-seals-room"]`.
  Adding the chasm's east door moved no other run's hashes.

`pnpm -s cli mutants games/samples/dungeon --json`: every `TOPDOWN_RULES` rule is guarded by some
run, and no run is weak on its own `guards` (`tests/runs/dungeon-mutants.test.ts` holds it to that,
though the top-down kit is not strict). After a change meant to move the game's state, regenerate
the golden files with `WW_UPDATE_GOLDEN=1 pnpm test tests/runs` and say why in the commit.

## Tests

- `dungeon.test.ts` (Node; the PNG "decoded" from its header, as the platformer's test does): the
  content loads (every file by kind), the rooms build, walk-east is drawn through the skin from the
  pack's sheets, the songs compile with channels of
  equal length, every skin sound is an sfx, walk-east's frames and golden hashes, walk-east's
  `door` and `spit` sounds, no placeholder file names and no per-kind fallback colours, **every
  tick of every run file drawn with no fallback box**, the end states of `escape` (escaped, with
  the relic) and `lost-in-the-guard-room` (fallen), `DungeonScene` playing `escape` with the
  headless game's snapshots, its music, the end held and Z starting over, broken fields naming
  their file and field, and (T3) the 16:9 screen with the room centred, every sheet the pack's
  PNG or a text sheet cut from it, the wall and door joins and the floor variety, the hero's
  states and the monsters' white flash, no HUD with `showHud(false)` and the end banner.
- `tests/browser/dungeon.test.ts` (headless Chromium, skipped without it): opens the built games
  index, follows its `games/samples/dungeon/` link, plays walk-east on the keyboard with
  `?debug=step` (the golden hash at every tick of `walk-east.hashes.json`, the guard room, the
  dark side margin and the west wall's ledge colour, the volume control), and replays `escape` and
  `lost-in-the-guard-room` through `window.__ww.replay` with their golden hashes and end states.
- `tests/browser/volume-control.test.ts` checks the volume control and stored volumes here too.

## Picture size

`screen` in `game.json` is the only value to change for another picture size: the canvas, the
scaling, the touch layout, the kit's frames and screenshots follow it. It is 320x180 (16:9; 6x is
1920x1080). The kit's camera hint (`cameraHint`, `kits/topdown/present.ts`) with `top` 0
(`HUD_TOP`) centres the room in the picture; the skin's HUD panels are placed for 320x180.
`tests/build/two-resolutions.test.ts` copies this folder at 256x240 (its old size) and checks
`validate`, `run` (the same hashes), `screenshot` and a build.

## How to run

- `pnpm dev` opens the games index; pick `games/samples/dungeon/` (or open it directly).
  Arrows move, X (or Z) the sword, C the item; `?debug=step` for the step hook.
- `pnpm build` builds it into `dist/games/samples/dungeon/`.
- `pnpm -s cli screenshot games/samples/dungeon/runs/escape.run.json --tick 950 --scale 6` shows the
  crypt at 1920x1080 (`--overlay title` the title).

## Title screen, pause menu and settings (Engine 0.16 T9)

`game.json`'s `menus` block (the shell's menus, `engine/core/shell/CLAUDE.md`; schema in
`engine/core/ui/menus.ts`): the title "The Old Crypt" in `crypt-title` over the game's own
picture at its start (dimmed 0.72 from T3), the subtitle "Torches, keys and a relic in the dark", art (from T3 the pack's knight and orc, `crypt-actors` `knight-idle-0` and `orc-idle-0`, x3),
the song `crypt`, a footer and the items start, controls, settings; the pause menu
(resume, controls, settings, title); settings (master, music, sfx, mute, shake, flashing, touch); and the controls screen's
rows (Walk; Sword; Use item; Next item), shown with the player's keys. Colours (T3): the pack's
stone and gold, the focus bar `#62232f`, headings `#f6c445`, every panel the skin's stone frame
(`crypt-art` `panel`, slice 5) with a `>` cursor. Fonts: `content/fonts/crypt-small.txt` (the menu font: the fx lab's small font, original 5 px glyphs with A-Z, a-z, 0-9, punctuation and, for key names, the four arrows) and `crypt-title.txt` (its title font: the small glyphs doubled with Scale2x, cell 10x18), made by a small generator; edit them by hand now. Claimed as `font` in `game.json`. The `ui-move`, `ui-select` and `ui-back` sfx are the menus' sounds.

`main.ts` passes `menus: { spec: content.manifest.menus, fonts, sheets }` to `bootBrowserGame`
and the fonts to the display. Back to title builds the game again from its first scene. The page opens on the title (the game waits
at tick 0 under it); Escape, P, gamepad Start or the `II` button pause (the ticks are held).
`?debug=step` and `?record` skip the title, so run files, replays and the older browser tests
are unchanged; `?debug=step&title=show` shows it. Tested in `tests/browser/menus.test.ts` (title,
start, pause, settings and controls by keyboard and touch, settings kept across a reload;
`WW_SHOTS_DIR=<folder>` keeps `menus-<game>-*.png`), tuned from those screenshots at page scale.

## Assets (Engine 0.16 part C, T2)

`assets/dungeon-tileset-ii/` holds 0x72's **DungeonTileset II** (v1.7, CC0, from
https://0x72.itch.io/dungeontileset-ii), credited in `assets/CREDITS.md` (source, author, licence:
`pnpm -s cli validate` checks it, `engine/core/content/assets.ts`): `sheet.png` (512 x 512, every
frame of the pack), `tile-list.txt` (one `<name> <x> <y> <w> <h>` line per frame of the sheet,
e.g. `knight_m_run_anim_f0 192 100 16 28`), the autotile atlases `atlas-floor-16x16.png`,
`atlas-walls-low-16x16.png` and `atlas-walls-high-16x32.png`, and the author's `readme.txt`;
65 KB in all. From T3 the skin's three `images` entries name rectangles of `sheet.png` (from
`tile-list.txt`); the atlases are not used. The pack has no torches, bats or sounds (item 425): the
bat is the pack's imp (item 427), the torch an original brazier, the sound MML. Binary files live only
in `assets/` (`tests/architecture/no-content.test.ts`); `assets.test.ts` checks the credits, the
file list, each PNG's size, every tile-list frame inside the sheet, the frames the art pass needs,
and a 100 KB bound. To add a pack: a new `assets/<pack>/` folder, its `## <pack>` section in
`CREDITS.md` (CC0 only), and its files in `assets.test.ts`.

## 16:9 on the CC0 art (Engine 0.16 part C T3; feedback items 426-433)

Presentation only: no room, rule or run changed, so walk-east, escape and lost-in-the-guard-room
keep their golden hashes (`dungeon.test.ts` draws every tick of every run with no fallback box).
How it was built: the screen first (320x180, item 426), then a scratch Python generator (not
committed, item 428; edit the files by hand now) read the pack's `sheet.png` and wrote the two text
sheets and the skin; screenshots at 6x of the courtyard, a room slide, the store room's bomb and
blast, the bat hall, the guard-room fight, the crypt, the end and the title were read and the
skin tuned from them.

- **The screen.** 320x180, `top` 0: the 256x176 room in the middle, 2 px above and below, 32 px
  of the skin's dark `background` (`#141016`) at each side.
- **Walls** (`#`, `crypt-art`, `join` with every wall and door character): the top wall's brick
  face under its cap (`wall-face`), the side walls' stone ledge beside the room (`wall-west`,
  `wall-east`), the bottom wall's ledge (`wall-south`) and the corners where the ledges turn
  (`corner-sw`, `corner-se`); a wall cell with nothing open is clear (the background shows).
- **Floors** (`.`, `crypt-floor`): `floor-1` with the pack's seven cracked and broken floors now
  and then (`vary`, weights, a 16x11 period so each room keeps its look during a slide), and
  `floor-shade` (the top rows darkened) under the top wall (`join` on `top`).
- **Doors**, each a `join` on the walls round it (its own character left out, so a two-cell door
  knows its halves): `O` the pack's arched doorway with the floor inside on the top wall, a floor
  passage with the ledge capped beside it on a side wall, plain floor elsewhere (and in slides);
  `L` the closed door with a padlock, `X` (and `D`, `d`) the closed door without its ring, both
  turned to face the room in side walls; `C` the cracked face (`wall_hole_1`/`_2`) or a broken
  ledge; `H` the arch or a rubble passage; `E` the arch over brightened stairs (`crypt-floor`).
  `B` a crate on the floor, `S` the pack's column cut to one tile, `~` the hole, `=` the stairs.
- **The hero** (`knight_m`, `crypt-actors`, anchored at the bottom): `idle` (the kit's opt-in
  idle state) breathing, `walk` the run cycle with `footstep` frame events (dust), `attack` a
  lunge (with the sword, `crypt-art` blades turned per facing, and a squash tween on `sword`),
  `throw`, `hold`, `hurt` white, `dying` the hit frame, `poof` the skull. While `flashing` he
  flickers (a look whose cycles alternate his frames with a clear `blank`).
- **Monsters** (item 427): `bat` the imp (`rest` idling, `fly` running), `knight` the orc warrior,
  `spitter` a goblin (`spit` its idle), `rock` short arrows per direction; each flashes white
  (`crypt-art` silhouettes) while hit (`byTag` `flashing`).
- **Things**: chests (closed, opened empty), the bomb with a fuse-spark emitter and a pop-in, the
  explosion and the enemies' poof as particles only (fire, a ring, smoke), pickups and the held
  prize from the pack's hearts, flasks, gem sword, axe and coins with a drop-in tween, the torch an
  original brazier (cold, lit with a flame), the key an original key.
- **Events**: `hurt` sparks, a red flash, shake and a 5-tick hit-pause; `hit` a small shake and a
  3-tick hit-pause; `blast` a big shake, a gold flash and a hit-pause; `kill` a shake; `pickup`,
  `chest`, `unlock` a gold burst; `dying` a red flash; `exit` a warm white flash; `footstep` dust.
- **HUD** (UI kit items): a stone panel over the top-left corner with the hearts (`ui_heart_*`,
  `maxHp` empty then `hp` with `half`) and the keys (a counter, `x{value}`), and a panel in the
  right margin with the item's icon and its count (`when: item`). Hidden under the title.
- **End banner** (`picture.ts`): a framed panel low in the room, in `crypt-small`: "You escaped
  with the relic!" / "You fell in the crypt." and "Press Z to ...".
- **Menus**: restyled in the pack's colours with the stone panel; the title shows the knight and
  the orc.

## Lighting and mood (Engine 0.16 part C T4; feedback items 434-436)

The skin's `lighting` block (the engine's 2D lighting, `engine/core/fx/CLAUDE.md`), drawn by the
Canvas2D presenter after the entities and before the HUD. Presentation only: the bat hall and the
crypt gained the kit's free `dark` flag (it only tags the map), and no run file's hashes moved.

- **Darkness:** every room `ambient` 0.55 (`#0b0710`), the courtyard 0.5 (`maps.courtyard`), and
  the rooms tagged `dark` (the bat hall and the crypt) 0.86 (`tags.dark`, `#05030a`). During a
  slide the darkness blends between the two rooms as the view moves (the kit's slide map lists its
  rooms as `parts`).
- **Torches:** the rooms have no torches in their text, so each room's `maps.<room>.lights` places
  braziers on the top wall (the original `torch-lit-0..3` cycle, 6 frames each, drawn under the
  darkness and before the entities; the light at the bowl, radius 84, warm `#f6a845`, flickering
  12% every 5 frames): two in the courtyard, the guard room, the store room and the crypt, one in
  the bat hall (top right, clear of the HUD panels). The store room's cold torches (`torch`
  `off`) give no light; a lit one (`lit`) would (`kinds.torch`).
- **The hero's small light** (radius 46, `#ffd9a0`, 0.8), a fuse's spark on a bomb (stronger on
  `fuse-short`), the blast (`explosion`, radius 84) and a flash of light on the `blast` event
  (radius 140, 26 frames, lighting the whole room), a red flash on `hurt`, faint lights on sword
  beams, rocks, the key and the relic, and daylight from the crypt's exit tiles (`tiles.E`).
- **Mood:** the falloff in 6 flat bands (`bands`, pixel-art rings), a vignette (0.5 from half
  way), `dust-motes` hanging in every room and `crypt-embers` (additive) rising in the crypt
  (`particles`, prewarmed so a room's air is full as it shows).
- How it was tuned: screenshots at 3x of the courtyard, the store room, the blast, the slide into
  the bat hall, the bat hall with the key, the guard-room fight and the crypt
  (`pnpm -s cli screenshot games/samples/dungeon/runs/escape.run.json --tick 600 --scale 3`), read
  and adjusted (braziers moved clear of the HUD panels, the default darkness eased to keep the
  guard-room fight readable).

## Imports

- Allowed: relative paths inside `games/samples/dungeon`, `@engine/*` (core and backends) and `@kits/*`.
- Never: other games. Nothing in `engine/` or `kits/` may import from here, and no alias points into
  `games/`.
- Game rules belong in data (rooms, songs, skin) wherever possible, not code.
