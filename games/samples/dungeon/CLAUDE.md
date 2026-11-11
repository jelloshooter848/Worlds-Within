# games/samples/dungeon

**The Old Crypt**, the top-down kit's sample game: a short dungeon of eight rooms (its final layout
from Engine 0.16 part C T8) with a start, two ways through (the bombed wall to the relic and the
exit; the dash over the pits to a key and the boss's locked door, the Bone Warden's hall), a goal and three end states, all in data files, drawn at 16:9 on 0x72's CC0
DungeonTileset II (Engine 0.16 part C T3), with MML music and sound effects. This file is a worked example: it says how the sample was built,
step by step, so an agent can build the next top-down game the same way. It began as the engine
demo (a proof-of-life game in its own `demo` folder, Engine 0.2-0.14), moved here at Engine 0.15
T2 with its run file and golden hashes unchanged, and was finished as a sample in Engine 0.15 T12.
It is content, not engine: the kit holds the rules, this folder holds rooms, art, sound and thin
glue.

## The dungeon

```
 (0,0) store-room  --cracked wall-->  (1,0) bat-hall  --locked door-->  (2,0) crypt  --exit (north)-->
        |   (bomb)                          (key)                         goal room (relic)
 (0,1) courtyard (start)  --open door-->  (1,1) guard-room (a side room full of monsters)
        |
 (0,2) chasm (dash chest | pit ^^ |)  --locked door (beyond the pit)-->  (1,2) warden-hall (the Bone Warden)
        |  (the south door is beyond the pit too)
 (0,3) ossuary (pits; the key on a ledge only the dash reaches)
```

The way to the boss (Engine 0.16 part C T8): explore south from the courtyard into the chasm, open
its chest (the dash), dash over its pit; past it the south door leads down into the ossuary, whose
pit band (dash down across it), monsters and a ledge cut off by another pit (dash west to the key,
east back) hold the key; dash back up, return to the chasm and walk into its locked east door, the
warden hall's (boss) door. The old way (bomb, bat hall key, crypt and its exit) is unchanged, and
keys are counted, not named: either key opens either locked door.

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
   change it; `headless.ts` passes `topdownItems(content.manifest)`). Beyond the pit (Engine 0.16
   part C T8) a south door (cols 12-13) down to the ossuary and the locked east door (`L`, an open
   one in T6) into the warden hall: the boss door.
7. **ossuary** (Engine 0.16 part C T8, `dark`): south of the chasm, at (0,3). A ledge under the
   north door with two columns (`S`), a pit band two tiles deep across the room (rows 3-4: only
   the dash crosses it, down and back up), a lower hall with two bats, a knight and a spitter, and
   in its south-west corner a ledge walled off by pits (row 5 and cols 4-5) holding the key: dash
   west over the two-tile pit to it, east back. Three pit rows above the ledge are too wide for
   the dash's 48 px, so it is only reached from the lower hall.
8. **warden-hall** (Engine 0.16 part C T6, the full boss room from T9): east of the chasm, only
   reached with the dash and (from T8) the ossuary's key. Two columns (`S`) on its centre line,
   four torches and two hearts (`h`). Its `boss` field declares **the Bone Warden** in data (the
   kit's boss form, `kits/topdown/CLAUDE.md`, Bosses; below, "The Bone Warden (T9)") and
   `shutters: "boss"` shuts its west shutter door once the hero is in until the boss is down; its
   defeat sets the world flag `bossDefeated`, the run's win. Its `music` is `warden`, the skin's
   layered boss song.

A run ends **won** (Engine 0.16 part C T9: a room's boss beaten, its `flag` in `world.flags`:
`bossDefeated`), **escaped** (the hero reached an exit: `exited`) or **fallen** (the hero died
after his death spin: `hero.dead`). `dungeonEnd(world)` (`picture.ts`) reads them (`bossBeaten(world)`
gives the beaten boss's name from the room files); the end banner says which
and the scene starts a new run on Z or X (below). Both are world state, so run files assert them.

**Dialogs and the end screen** (Engine 0.16 part C T7): `game.json`'s `menus.dialogs` holds
`intro` (Sir Edrin's portrait, `crypt-actors`' `knight-idle-0`, three pages from T9: who he is,
why he goes down, how to get on), `victory` (T9), `escaped` and `fallen`, and `menus.triggers`
shows `intro` after Start and, on the first presented frame whose status says
`flag.bossDefeated` (T9), `exited` or `dead` (the kit's status, `kits/topdown/CLAUDE.md`), that
end's dialog and then `menus.end` ("The Warden is at rest", "You escaped!" or "You fell", the
credits line, Time, Rooms seen and Health from the frame's `time`, `roomsSeen` and `hp`/`maxHp`,
Back to title). The victory trigger's `music` (`warden-falls`, the engine's per-trigger end music
from T9) starts with its dialog and plays on under the end screen. The menus style's
`sounds.type` (`ui-move`) and `page` (`ui-select`) blip as the text types and turns. Where
the shell shows the end (`page.endings`: dialogs on), the scene gets `shellEnds`: no end banner
and no Z-to-restart (the end screen's Back to title starts a new run); with `?debug=step` or
`?record` the dialogs are skipped and the banner shows as before. `view.ts` draws no banner (as
the page) and gives `status()`, so `pnpm -s cli screenshot games/samples/dungeon/runs/escape.run.json
--tick 1060 --overlay end` shows the end screen with its stats and heading (`win.run.json --tick 1900
--overlay end` the victory's), and `--overlay dialog:intro` (or `victory`, `escaped`, `fallen`)
a dialog.

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
  `ossuary`, `warden-hall` (above).
- `content/songs/`: `crypt`, (T10) `crypt-danger` (its danger layer), `daylight`, and (T9) `warden-calm`, `warden-fight`, `warden-rage`
  (the boss song's layers) and `warden-falls` (the victory tune). `content/sfx/`: `blast`,
  `chest`, `door`, `fall`, `fanfare`, `fuse`, `hit`, `hurt`, `kill`, `pickup`, `spit`, `sword`,
  `unlock`, the menus' `ui-*`, and (T9) `dash` and `warden-warn`, `-charge`, `-shoot`, `-slam`,
  `-summon`, `-hit`, `-roar`, `-defeat`, and (T10) `shutters`, `secret`, `dead` and `push`.
- `content/palettes/`: `crypt-art`, `crypt-floor`. `content/sprites/`: `crypt-art.txt`,
  `crypt-floor.txt` (pieces cut from the CC0 pack, and a few original ones in its colours).
- `content/skins/canvas2d.json`: the skin (above).
- `content.ts`: `loadDungeon(files)` (the kit hook's kinds, `kitContentKinds([topdown],
manifestOptions(files))`), `mustLoad`, and `dungeonRooms`, `dungeonSkin` (the engine's
  `mustSkinSet`) over the loaded bundle; `DUNGEON_MUSIC`, `ESCAPE_MUSIC` and (T9)
  `VICTORY_MUSIC` (song ids). The
  songs and sfx are the engine's `contentSongs` and `contentSfx` (Engine 0.15 T15, the API review
  removed the sample's own `dungeonKinds`, `dungeonSongs` and `dungeonSfx` copies).
- `headless.ts`: `createWorld(content, seed?, disabledRules?)` (the kit's items from
  `topdownItems(content.manifest)`, so `kitOptions.topdown.dash` tunes the dash) and `createGame(content, seed,
opts?)`, the engine's headless contract (`pnpm cli run`, `dump`, `mutants`).
- `picture.ts`: `dungeonLook(content)` (skin, sheets, fonts, picture size), `HUD_TOP` (0),
  `DungeonPicture` (`draw(world, events)`: the kit's `presentWorld` with `idle`, frozen, to the
  backend's `SkinnedCanvasPresenter` or the `presenter` it is given, plus the end banner unless
  `banner: false`; `showHud(shown)`), `dungeonEnd(world)`, `bossBeaten(world)`, `endLines` and `endBanner` (a framed panel in the menus'
  font once the run has ended).
- `view.ts`: `createView(content, seed, opts?)`, the view entry for `pnpm cli screenshot` (with
  `showHud`, so the title overlay hides the HUD).
- `scene.ts`: `DungeonScene`: the world stepped once per loop step, its events drawn through
  `DungeonPicture` with the shell's `onSound`; the room's song (T9: its `music` field, else
  `crypt`, started when it changes, so the warden hall plays the layered `warden`), `daylight`
  on the way out and `warden-falls` once the Warden is beaten (not with `shellEnds`: the shell's
  ending plays it); once the run has ended (`dungeonEnd`), Z or X at least `END_HOLD` (60) steps later
  starts a new run seeded from the step count (not with `shellEnds`, Engine 0.16 part C T7: the
  shell's end screen ends the run). The world keeps stepping after the end, so until a
  restart the scene is exactly the headless game: `headless()` gives the page's step hook its
  snapshot and hash.
- `main.ts`: awaits `withContentImages` (the PNG decoded before the first frame), then
  `bootBrowserGame` (keyboard, gamepad, touch pad, loop, `?debug=step` step hook, audio with the
  songs and sfx and the `crypt` song once unlocked, from T9 the skin's layered `music` and the
  seed through the shell's mixer, which the scene plays songs through, the shell's volume control stored under
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
   lost-in-the-guard-room must keep their hashes unless the room changes a room they play. A
   snapshot holds the room the hero is in (its entities), never another room's map, so changing a
   room only moves the hashes of runs that walk through it (T8's chasm doors moved only the old
   boss run's, whose path they changed; cross-the-chasm, which never reaches them, kept its; T9's
   hearts in the warden hall moved only to-the-boss-door's last ticks).
5. Light and dress it in the skin (`lighting.maps.<room>`, below).

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
- `to-the-boss-door` (992 ticks, Engine 0.16 part C T8, the path to the boss): cross-the-chasm's
  input, then down through the chasm's south door into the ossuary (tick 481), to the pit band's
  edge (`hero.y` 32), the dash down (`hero.dash.t` 8 at 514, `hero.y` 80 at 522), west to the
  ledge's pit (`hero.x` 95), the dash over it (`hero.x` 47 at 652), the key (`keys` 1 at 656), the
  dash back (`hero.x` 97 at 685) and up over the band (`hero.y` 24 at 748), back into the chasm
  (866), into its locked east door (`keys` 1 at 937, 0 at 938) and into the warden hall (952;
  the boss there with 3 hp at 992). The spitter's rock costs a heart (`hero.hp` at least 4
  throughout, never dead); `guards: ["doors-change-room", "dash-crosses-pits",
"keys-open-locked-doors"]`.
- `win` (1940 ticks, Engine 0.16 part C T9, the whole dungeon: title to the Warden beaten):
  to-the-boss-door's path from tick 0 (the chasm at 120, the dash owned at 180 and dashing at
  365, the ossuary at 481, the key at 656, used at 938, the warden hall at 952 with the boss at
  6 hp), leaning on the shut shutter (`hero.x` 15, `sealed` at 1048), a heart (`hero.hp` 6 at
  1147), the fight with the boss's hp falling 5 (1195, hit invulnerability), 4 (1303, phase 1),
  3 (1411), 2 (1615, phase 2), 1 (1663) and 0 (1759, `dying`), `flags` `["bossDefeated"]` and no
  enemies at 1879, the four rooms `visited`; hp at least 4 and never dead throughout. `guards`:
  `doors-change-room`, `dash-crosses-pits`, `keys-open-locked-doors` and every `boss-*` rule.
  It replaces T6's `beat-the-warden` (removed in T9: the boss changed).
- `boss-lost` (2429 ticks, T9, the loss to the boss): the win's input into the fight until the
  boss is down to 4 hp in phase 1 (1303), then standing still: hurt (5 at 1341, 4 at 1546, 1 at
  2132), dying at 2325 and dead at 2420 in the warden hall with the boss still at 4 hp; `guards`
  every `boss-*` rule and `damage-reduces-hp`.
- How the fight's input was found: a scratch bot (not committed) stepped clones of the world,
  tried 12-tick moves, sword swings and dashes, and kept the one whose state scored best (boss hp
  down, hero hp up and a way out of every attack 40 ticks on); its held keys went into the run
  files as plain data, so no bot is needed to replay them.

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
  `lost-in-the-guard-room` through `window.__ww.replay` with their golden hashes and end states,
  and from T10 `win` (the `bossDefeated` flag) and `boss-lost` (dead) the same way.
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
- **The new wing** (Engine 0.16 part C T8): the chasm has two braziers and three blue banners,
  the ossuary (`dark`, its own ambient 0.74 so its monsters stay readable) two braziers, a blue
  wall fountain with a cold blue glow and two green banners, and the warden hall (lit by its four
  `T` torches) two red wall fountains with a red glow. Skulls lie on the floors of all three.
  **Props** are placed lights with a `sprite` and no light (`radius` 1, `intensity` 0, `glow` 0):
  the skin's only data place for a decoration the map has no tile for; the frames
  (`banner-*`, `fountain-*-0..2`, `basin-*-0..2`, `skull`) are rectangles of the pack's sheet in
  the `crypt-items` image. Kept clear of the HUD panels and the boss bar. Tuned from screenshots
  at 6x (`pnpm -s cli screenshot games/samples/dungeon/runs/to-the-boss-door.run.json --tick 420
--scale 6` the chasm, `--tick 600` the ossuary, `win.run.json --tick 1100` the warden hall).
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

## The Bone Warden (Engine 0.16 part C T9; feedback items 441-447)

The boss room, the end and the boss music. Everything is data: the room file, the skin, the
songs, sfx and `game.json`.

- **The fight** (`content/rooms/warden-hall.json`, the kit's boss form): 6 hit points, touch 1
  half heart, `hitInvuln` 36, `knockResist` 0.75, `defeatTicks` 120, flag `bossDefeated`.

  | phase      | steps, looped                                                                                                                                      |
  | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 0 (6-5 hp) | idle 50, telegraph `charge` 36, charge (2 px/tick, 70), idle 45, telegraph `shoot` 30, a ring of 8, idle 30                                        |
  | 1 (4-3 hp) | telegraph `shoot` 28, a spread of 5 (gap 3), idle 30, telegraph `charge` 30, charge (2.5), idle 40, telegraph `summon` 26, 2 bats (max 2), idle 36 |
  | 2 (2-1 hp) | telegraph `slam` 26, slam (radius 40), idle 34, telegraph `shoot` 24, an aimed ring of 12, idle 20, telegraph `charge` 24, charge (3), idle 44     |

  Every attack follows a telegraph naming it (tested); the idles after a charge are the windows
  to strike.

- **The look** (`kinds["boss:warden"]`, with a red `glow` so its dark body reads on the floor):
  the pack's big demon (`demon-idle-*`, `demon-run-*` in `crypt-actors`) and text frames cut from
  it (`crypt-art.txt`, "The Bone Warden": one colour, `#9f294e`, added to `crypt-art.json` as
  index 31, legend `v`): `demon-crouch` (the charge's wind-up, alternating with burning eyes),
  `demon-rear` (risen: the slam and the summon), `demon-glare-*` (the shot), `demon-white-*` (the
  hit flash), and `demon-rage-*` (the red-hot last phase: a `byTag` look on `phase:` 2 and up,
  after the `flashing` look). `dying` flashes white; the `boss-defeat` event fades it out.
- **Sounds and feel** (`events`; a field key per attack): `boss-telegraph:attack=<a>` the
  `warden-warn` rise (higher for the shot, lower for the summon; `warden-roar` and a rising
  stretch for the slam), a red flash and the boss's red light (`lighting.events`);
  `boss-attack:attack=charge` `warden-charge` with dust and a shake, `shoot` `warden-shoot`,
  `slam` `warden-slam` with a ring, smoke, a big shake, a hit-pause and a squash, `summon`
  `warden-summon` with smoke; `boss-hit` `warden-hit`, sparks, a squash, a warm flash and a
  6-tick hit-pause; `boss-phase` `warden-roar`; `boss-defeat` `warden-defeat`, fire, smoke, a
  zoom punch, a long flash of light and the fade; `boss-defeated` `unlock` (the shutter opens).
  `dash` (the kit's dash event) `dash`, with dust.
- **Ducking**: `hurt` 0.55, `boss-hit` 0.5, the slam 0.6, `boss-phase` 0.6, `boss-defeat` 0.9 (held
  100 ticks), and every dialog box (the shell's `DIALOG_DUCK`).
- **Music** (`music.warden`, the room's `music`): three layers, 132 bpm, 8 bars, looping, every
  channel the same length (`warden-calm`: a low drone, a slow pad and a heartbeat; `warden-fight`:
  an eighth arpeggio, a pumping octave bass and a beat; `warden-rage`: a lead melody, 16th
  shimmer and hats). The mix (first rule that holds): `flag.bossDefeated` -> silent (20 ticks,
  the victory tune takes over); `bossHp` 0 (the defeat sequence) -> calm 0.5 only (45);
  `bossPhase` >= 2 -> calm 0.4, fight 1, rage 1 (10); `bossPhase` >= 1 -> calm 0.5, fight 1, rage
  0.55; `bossHp` >= 6 (untouched) -> calm 1, fight 0.45; any other hp -> calm 0.7, fight 1; no
  boss -> calm only. `warden-falls` (120 bpm, once) is the victory tune.
- **HUD**: hearts and keys top left; the item panel's icon follows the selected item (`frames`:
  `bomb`, or the dash's green flask), its count only with bombs (`when: "ammo.bomb"`); while a
  boss is in the room a stone panel at the top with its name centred over its red bar.
- **Screenshots read and iterated** (`pnpm -s cli screenshot games/samples/dungeon/runs/win.run.json
--tick <n> --scale 3`, and crops of the boss at 4x): 1015 and 1100 (the charge's telegraph:
  the demon's dark body vanished on the dark floor, so it got a red `glow` and a stronger light),
  1196 (a hit: the white flash), 1250, 1404, 1440, 1590, 1625 and 1690 (the rage look in phase
  2), 1765 and 1800 (the defeat), `--tick 0 --overlay dialog:intro`, `--tick 1880 --overlay
dialog:victory` and `--tick 1900 --overlay end` (a Keys line read 0 at the end and was
  dropped). The boss bar first lay bare over the wall's fountains; it got its own panel.
- **Tests** (`dungeon.test.ts`, "the boss room, the win and the loss"): the boss's data and its
  telegraphs, the end states of `win` (`won`) and `boss-lost` (`fallen` in the hall), the shell's
  end triggers firing on the runs' frames (the victory dialog and tune, the fall), the intro's
  text and the portraits, the scene playing `win` with the headless snapshots and its music
  (`crypt`, `warden`, `warden-falls`; the shell's tune with `shellEnds`), the HUD's items and
  their status mid-fight, the warden's states and tags in the run, a sound for every boss
  action and the dash, the layered mix tick by tick and the ducking through a `Mixer`.
  `tests/browser/menus.test.ts` plays the dungeon by keyboard from the title through the intro
  to the Warden beaten, the victory dialog (with `__ww.mix().song` `warden-falls`) and the end
  screen.

## Combat feel and polish (Engine 0.16 part C T10; feedback items 448-454)

Presentation only, in the skin, `game.json`'s `transitions` and two small engine additions: no
run file's hashes moved (`tests/runs` and the presentation-invariance and stepped-shell tests
pass unchanged).

- **Hits and kills** (`events`): `hit` white-gold `hit-sparks` and `knock-dust` at the struck
  enemy (knockback made readable), a small shake and a 3-tick hit-pause; `kill` `soul-wisp`
  (blue, rising, additive) and `bone-bits` (falling), a 4-tick hit-pause and a shake; `hurt` adds
  `knock-dust` to its sparks, red flash, shake and hit-pause; `boss-hit` adds `hit-sparks`. The
  white hit flashes are the kinds' `flashing` looks (enemies, T3; the warden, T9); blasts, slams
  and boss hits shake (T3, T9). `kinds.sword.emit` is `sword-trail`, a short white trail while the
  blade is out; the attack keeps the T3 lunge and squash tween.
- **Pickups and chests:** `pickup` a gold burst and a `pickup-ring`, `chest` a gold burst,
  rising `chest-rays` and a small shake.
- **The dash:** `dash` dust and `dash-ghost` afterimages (`knight-ghost`, the knight's silhouette
  in the palette's pale steel, a text frame in `crypt-art.txt`, fading in after two frames so the
  newest never covers the hero); `dash:dir=left` the mirrored `knight-ghost-left`.
- **Torches:** every lit brazier (`lighting.maps.<room>.lights` with a `torch-lit` sprite) has
  `emit: "torch-embers"` (the engine's new placed-light `emit`), and the warden hall has four
  emitter-only lights over its `T` torches.
- **Transitions** (`game.json` `transitions`): `level: false` (the engine's new switch) keeps the
  kit's room slide, with the skin's `room` flash a brief dip to dark (`#05030a`, 0.55, 14 ticks;
  skipped with reduced flashing); `default` (Start and Back to title) a fade through the dark;
  `respawn` on the `dead` event (`events`) a slow fade to dark red under the `fallen` dialog. With
  reduced motion each is a short fade (the shell's rule).
- **Sounds for every action**, most with `pitch` variation: the run files' events all sound
  (`item`, `dash-end`, `met`, `fuse` and `boss-defeated` aside: another event's sound covers each);
  new `shutters` (the sealed door, with a shake), `secret` (`secret`, `reveal`), `dead` and `push`;
  `stun`, `block`, `beam`, `whirr`, `switch`, `torch` and `item-select` reuse others at other
  pitches.
- **Danger music:** the skin's `music.crypt` layers the old `crypt` song (`calm`) with
  `crypt-danger` (`danger`: a staccato D pedal, a high sting and driving drums, same tempo and
  length) and mixes the danger in while the kit's new `enemies` status is at least 1 (30 ticks in,
  90 out). The title and every room without a `music` field play it.
- **HUD:** the item panel moved to the bottom-right of the right margin (`y` 149): the page's
  volume control and pause button sat over its old place. From T11 the panel has `when: "item"`:
  it shows only once an item is owned (the review screenshots showed an empty frame before, and
  its edge peeking out behind the intro dialog).
- **Accessibility:** shakes follow the player's shake setting and flashes (the screen flashes,
  the room dip) are skipped with reduced flashing, the additive particles halved (the engine's
  rules); the white blink of a hit enemy or hero uses the kit's `calm` tag instead.
- **Screenshots read and iterated** (the built page with `?debug=step`, each run replayed and
  stepped one tick at a time to the shot, `#screen` at 960x540): `escape` 170 (the chest), 420
  (the blast), `win` 369 (the dash's afterimages: first teal like the knight and covering him, now
  pale steel and fading in), 1199 (a boss hit), 1765 (the defeat), `lost-in-the-guard-room` 410
  (a hurt) and 1522 (the fall). Fixed from them: the item panel under the volume control, the
  ghosts' colour and overlap, faint embers and sparks (more and brighter). `pnpm cli screenshot`
  draws only the shot tick, so an effect started earlier shows only as its first frame there.
- **Tests** (`dungeon.test.ts`, "combat feel and polish"): the combat events' emitters,
  hit-pauses, shakes and flashes and the white looks, the dash's ghosts by direction, a sound for
  every event the runs raise and pitch variation, the win drawn through `SkinnedCanvasPresenter`
  (a 6-tick hit-pause per boss hit, the kill's 4, particles, flashes fewer with reduced flashing
  and the same hit-pauses), the braziers' and torches' embers at their place, the transitions and
  the danger layer mixed over `lost-in-the-guard-room`. `tests/browser/dungeon.test.ts` replays
  `win` and `boss-lost` through the built page with their golden hashes and end states (and
  steps walk-east's picture 16 single ticks on before reading its pixels, past the room dip).
  `engine/tools/edit.test.ts` sets `crypt-danger`'s tempo with `crypt`'s: the layers keep one.

## Review screenshots (Engine 0.16 part C T11; feedback items 455-462)

Ten 1920x1080 PNGs in `docs/reports/screenshots/0.16-C/` (title, intro dialog, the lit crypt, a
hurt in the guard room, the dash over the chasm, the key and the locked boss door, the Warden's
telegraph and a hit, the victory dialog and the end screen), each `pnpm -s cli screenshot <run>
--tick N --scale 6` with `matchesHeadless: true`; the exact commands are in `docs/BUILD-LOG.md`
(Engine 0.16 part C, Review screenshots). Retake them with the same commands after a change to
the skin, the menus or the rooms.
