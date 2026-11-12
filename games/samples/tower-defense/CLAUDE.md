# games/samples/tower-defense

The standalone tower-defense sample (Engine 0.12, the platform test), since Engine 0.16 E8 the
part E map: one winding road on a 16:9 map, three tower types with two upgrades each, ten waves
and a star rating on `kits/towerdefense`, as data files plus a few lines of glue. Every rule of the round
(placing and paying, selling, waves by button or timer, walking, targeting, cooldowns, bounties,
leaks, won and lost) is the kit's; this folder holds only content and the run files that prove the
kit's rules. It does not use `engine/sim`. Since T5 it has original NES-style art, sound and a
Canvas2D skin as text files, a `view.ts` for `pnpm cli screenshot` and a playable page
(`index.html`, listed by the root launcher). Since Engine 0.15 T14 it is **finished** as **The
Winding Road** (docs/BUILD-LOG.md, Engine 0.15, decision 13): its assets were audited (every
kind, tile, event and HUD item drawn from its own art; no look with a `fallbackColor` of its own;
a test draws every tick of every run without a fallback box; an sfx for every sound the skin
names and the song's channels one length), its page uses the shell's tick rate and frame taps
(gaps D1, D2) and its tests tap through the kit's `screenAtCell` (gap D13), and the browser test
follows the games index's link. Its run files and their hashes did not change. At Engine 0.16
part E (E2), before this sample becomes the ten-wave map of 0.16 (E8), its 0.15 round (content,
art, skin, songs, sfx, fonts, menus, page and the five run files with their golden hashes) is
kept unchanged as the test game `games/td-classic`. **E7** put it on a CC0 art pack, Kenney's
Tower Defense (top-down), with a new 2D skin ("The CC0 art pack and the skin (E7)" below); no run
file or hash moved. **E8** rebuilt the content as the 16:9 map ("The Winding Road map (E8)"
below): every run file was replaced by guard runs on the new map. **E9** made it the full game
("The full game (E9)" below): the waves tuned, the `win`, `lost` and `sped-up` runs, layered
music, the HUD's wave preview and the selected tower's prices, and the end screen with the stars.
This file is the worked example of a tower-defense game on the kit ("How it was built", below).

## How to play

`pnpm dev`, then open `games/samples/tower-defense/` from the launcher (or the built page from
`pnpm build && pnpm preview`). Keep the enemies on the road from reaching the gate on the right:
build towers on the stone pads at the road's bends, upgrade them, then send each of the ten
waves. A win rates one to three stars by the lives left; three stars take a strong defence (the
last two waves are tuned to break through a thin spot).

- Keys (and the touch pad on a phone): arrows move the cursor, Z (jump) builds the chosen tower on
  the cursor's pad, X (attack) picks the next tower type (arrow, cannon, frost), C (special) sells
  the tower under the cursor for its sell value, Enter (start) sends the next wave (otherwise the
  timer does, 500 ticks after the last). F or the speed button cycles the game speed (1x, 2x, 3x;
  `menus.speeds`, Engine 0.16 E5: the same ticks and hashes). Z on a tower upgrades it a level (Engine 0.16 E3; a click on a
  tower selects it, a second click upgrades).
- Pointer: a click or tap moves the cursor to a cell, a second one on the same cell builds there; a
  right click or long-press sells. Taps are frame input (Engine 0.15, gap D1), so a round played by
  tapping is a run file (`games/td-classic/runs/tapped.run.json` on the classic road).
- The shell's sound control at the top right (Engine 0.15, gap M1): mute and the volume, kept in
  this browser for this game.
- The bar under the picture: Wave, Build, Tower and Sell (the same as Enter, Z, X and C; with the
  cursor on a tower Build reads `Upgrade <cost>` or `Top level` and Sell `Sell <value>`, Engine
  0.16 E9), and the status line (the tick, then `the road is held!` or `the road is lost`).
- The HUD: gold, lives, the wave (`started/total`) and, with the timer running, the ticks to the
  next wave; at the bottom left the chosen tower and its cost (the HUD sits on the grass rows
  above and below the road: rows 0 and 15 hold no path or pad). The ghost tower on the cursor is green
  where it can be built and red where not (a path cell, a taken pad, too little gold), its range
  ringed. From E9 also `next` and the next wave's groups (an icon and a count per kind), the
  selected tower's upgrade cost (an up arrow) and `sell <value>`, and the speed (`2x`, `3x`) at
  the top right above 1x.
- The end (E9): once the round is won or lost the end screen opens over it: `The road is held!`
  with one to three stars, or `The gate has fallen`; the waves held, lives left, gold and enemies
  stopped; a jingle (`road-won`, `road-lost`); Back to title.

The page plays 30 game ticks a second (`TICKS_PER_SECOND` in `play.ts`, the scene's `tickRate`,
which the shell paces since Engine 0.15, gap D2); the tools play the same ticks, so a run file's
`input` typed one tick at a time plays the same round.

## How it was built (the worked example)

1. `game.json` names the kit (`towerdefense`), claims the three content kinds, the seed (12) and a
   480x270 picture (16:9, a whole divisor of 1920x1080: 4x). The map is 30 x 16 cells of 16 px:
   it fills the picture's width, and the kit's camera centres its 256 px height, so 7 px of grass
   lie above and below (no whole number of 16 px rows makes 270 px). The HUD sits on that grass
   and on the map's rows 0 and 15, which hold no path or pad.
2. The content was written as data: `content/maps/road.json` + `road.map.txt` (the grid),
   `content/towers/towers.json` and `content/waves/road.json`, and checked with
   `pnpm cli validate games/samples/tower-defense`.
3. `headless.ts` is `createGame` over the kit's `tdGame` and `tdRound` (in `content.ts`).
4. The run files' `input` was made by playing the kit's `TdBot` (the same button presses a person
   makes: one press, then a released frame) and writing down the held actions with the core's
   `InputRecorder`; the assertions were read from the round's snapshot at those ticks.
5. `pnpm cli mutants games/samples/tower-defense` showed which kit rules each run guards; each
   E8 run was written for the rules in its `guards` (with every rule guarded, the kit keeps strict
   mutants, `kits/towerdefense/kit.ts`).
6. Sync `hashes` were added last (below), then the golden files
   (`WW_UPDATE_GOLDEN=1 pnpm test tests/runs`).
7. T5: the art (`content/sprites/`, `content/palettes/`), the skin, the sfx and the song were
   written as text and checked with `validate`; then `picture.ts` and `view.ts` (checked with
   `pnpm cli screenshot`), then `play.ts`, `main.ts` and `index.html` over `bootBrowserGame`.
8. Engine 0.15 (T5, T10, T14): the page's own tick counter, `TickInput`, hint string and
   cell-to-client copy went to the engine (the scene's `tickRate`, `MergedInput`, frame taps, the
   kit's `TD_CONTROLS` with `controlsHint`, `screenAtCell` and the display's `toClient`); a round
   played by taps became a run file (`tapped`, since E8 kept in `games/td-classic`); the skin's per-look `fallbackColor`s were removed
   (the sheet's `#ff00ff` stays, so a missing frame shows) and the asset tests added.

## Files

- `game.json`: kit `towerdefense`, content `td-map` (`content/maps/*.json`), `td-towers`
  (`content/towers/*.json`), `td-waves` (`content/waves/*.json`), `palette`, `sprite`, `skin`,
  `sfx`, `song`, `font`, seed 12, 480x270, `headless.ts`, `view.ts`, the `menus` block (below) with
  `speeds` `[1, 2, 3]`.
- `content/maps/road.json`: the map's header: 60 gold and 20 lives to start, towers `arrow`,
  `cannon` and `frost` (in the order `attack` cycles them), the wave list `road` and `stars`
  `{ three: 18, two: 10 }` (a win with 18 or more lives left is three stars, 10 or more two, any
  other win one; `kit.stars` and the HUD status `stars`).
- `content/maps/road.map.txt`: the grid, 30 x 16 (kit legend: `.` ground, `#` path, `B` build
  cell, `S` entry, `X` exit). The road winds from the entry at (0, 3) through ten bends to the
  exit at (29, 10), 63 cells. Eighteen pads: one on the inside of each bend (where a tower
  reaches both legs) and eight beside the legs; the cursor starts on the first, (3, 2).
- `content/towers/towers.json` (E8): three types, each with two upgrades (`levels`; sell values
  are half of what was paid, the kit's default):
  - `arrow`: 10 gold, range 2, 1 damage, cooldown 6; level 2 (8 gold: 2 damage), level 3 (12
    gold: range 3, cooldown 4). Fast single shots.
  - `cannon`: 25 gold, range 2, 3 damage, cooldown 20, splash radius 1 for 1; level 2 (20 gold:
    5 damage, splash 2), level 3 (30 gold: range 3, 8 damage, splash 4). Slow shots that hurt a
    crowd.
  - `frost`: 15 gold, range 2, 1 damage, cooldown 10, slows to 60% for 20 ticks; level 2 (12
    gold: 50% for 30), level 3 (18 gold: range 3, 2 damage, 40% for 40).
- `content/waves/road.json` (E8): a timer of 500 ticks and ten waves of runners and brutes, each
  bigger or tougher (hp 3 to 62, bounty 2 to 10), the runners with jitter: 1 eight runners; 2 ten
  runners; 3 two brutes with six fast runners behind (they overtake); 4 fourteen runners; 5 four
  brutes and eight fast runners; 6 eighteen runners; 7 six brutes; 8 twelve fast runners and four
  brutes; 9 twenty-four runners (hp 14); 10 eight brutes (hp 62) and sixteen fast runners (hp
  15). 140 enemies in all. E9 tuned waves 9 and 10 (from 12, 55 and 13): E8's twelve-tower
  defence held everything with 158 gold left over; now it wins with 17 lives (two stars) and
  three stars take a thirteenth tower (`WIN_PLAN`).
- `content/sprites/td.txt`: the text art still used (Engine 0.16 E7 moved the cells, towers,
  enemies and shots to the CC0 pack and removed them here): `cursor-0/1` (16x16, palette `td`)
  and the HUD icons `icon-gold`, `icon-lives`, `icon-wave`, `icon-timer` and (E9) `icon-runner`,
  `icon-brute` (the wave preview), `icon-up` (the upgrade cost) (8x8), and the end screen's
  `star-on` and `star-off` (16x16).
  `content/sprites/td-font.txt`: the HUD font (the mini siege's, with a `/` added for the wave),
  palette `td`.
- `content/palettes/td.json`: the NES colours the text art uses (E7 removed the recolours
  `td-ok`, `td-blocked`, `td-hit`: the skin's hit flash and blocked ghost are silhouettes now).
- `content/skins/canvas2d.json`: the pack's art (below, "The CC0 art pack and the skin (E7)");
  no look with a `fallbackColor` of its own (the sheet's `#ff00ff` is the only one).
- `content/sfx/`: `place`, `sell`, `refused`, `wave`, `arrow`, `boom`, `kill`, `leak`, `clear`,
  `won`, `lost` and, from E7, `upgrade`, `spawn`, `launch` (the cannon firing), `frost`,
  `splash`, `chill` (a slow), plus the menus' `ui-move`, `ui-select`, `ui-back` (MML, one short
  phrase each). `content/songs/road.json`: the looping song (four channels, MML); from E9
  `road-danger.json` (its danger layer: the same tempo and length, a staccato sting, a pumping
  bass and driving drums) and the end screen's jingles `road-won.json` and `road-lost.json`
  (played once).
- `assets/kenney-tower-defense/`, `assets/CREDITS.md`, `tools/road-art.ts` and
  `assets.test.ts`: the CC0 pack (below).
- `picture.ts`: `tdLook(content)` (the skin, sheets, size; the grass colour is the skin's
  `background`, Engine 0.15 gap G36),
  `tdFrameStream(screen, cursor)` (a `FrameStream` over the kit's `tdFrames`), `tdPicture(presenter,
screen, cursor)` and `tdCanvasPicture(r, look, cursor, onSound?)`. No drawing of its own.
- `view.ts`: `createView(content, seed, opts?)`, the engine's `frameView` over `createGame` and the
  pictures above (the cursor and ghost shown), for `pnpm cli screenshot` and the backend parity
  test.
- `plans.ts` (E9): `WIN_PLAN` and `LOST_PLAN`, the `TdBot` plans of the `win` and `lost` runs
  (tests only).
- `play.ts`: `TdPlay`, the page's `Scene` (no DOM, no clock): one game tick per `update`, its
  `tickRate` `TICKS_PER_SECOND` (30): the shell's `SceneStack` steps it every `STEPS_PER_TICK` (2)
  loop steps with the steps' input merged (`MergedInput`: pressed on any step counts on the tick,
  every tap arrives; Engine 0.15, gap D2, which removed the sample's own `TickInput` and counter).
  Keys and taps are frame input the kit's `TdGame` reads (gap D1); `headless()` is the game, for
  `window.__ww`. From E9 every tick's merged input goes into an `InputRecorder`: `recording()` is
  `{ ticks, input }`, the round so far as a run file's, at any speed (exact for input with a
  released tick between presses).
- `main.ts` + `index.html` (title "Tower defense: The Winding Road, ...", the name the games index
  shows): the page: `bootBrowserGame` with Canvas2D, `game` (the volume
  control's storage key, gap M1), the touch pad, `pointer: true` and `audio` (the sfx and the song
  `road`), the bar (Wave, Tower, Sell, pressing through the shell's `InputManager.press`, and the
  status; before the first wave its hint is the kit's `TD_CONTROLS` written by `controlsHint` with
  the player's key names, Engine 0.15 T10, lesson D14: the page's `HINT` string is gone) and `window.wwTd` (`tick()`, `kit()`, `cursor()`, from E9 `recording()`) for the browser test.
  From E9 also the skin's layered `music` and the seed to the shell's mixer (`audio.mix`,
  `audio.seed`) and the Build button. No cell-to-client
  copy (gap D13): the test taps through the kit's `screenAtCell` and `window.__ww.toClient`.
- `play.test.ts`: `TdPlay` on a `SceneStack` (paced at its `tickRate`) into the null backend: the
  `win` input typed one tick at a time wins all ten waves with three stars and the run's golden
  hash at tick 3150, shows every kind of event and records itself as the run's input; (E9) the
  same input at 1x and at 3x (`SceneStack.speed`, `advance`) gives every golden hash; `WIN_PLAN`
  played by the bot at 2x and 3x records the `sped-up` run file (`WW_UPDATE_GOLDEN=1` writes it); one tick every two loop steps; a key pressed
  for one loop step counts; frame taps move, place, upgrade and sell (each tap at a cell's centre
  from the kit's `screenAtCell` on the 30 x 16 map, gap D13); `InputManager.press` presses on the
  next tick.
- `content.ts`: `loadTowerDefense(files)` (the checked bundle) and `sampleRound(content)` (the
  kit's `tdRound`).
- No `files.ts`: `main.ts` imports its data files from `virtual:game-files` (the build's plugin, `build/game-files.ts`; no `files.ts` since Engine 0.14 T2).
- `headless.ts`: `createGame(content, seed, opts?)`, the kit's `TdGame` (snapshot
  `{ round, controls, kit }`; see `kits/towerdefense/CLAUDE.md`), rules switched off in `opts`
  passed to the kit.
- `tower-defense.test.ts`: the content (one 30 x 16 map across the 480x270 picture with 14 px for
  the HUD, three tower types with two upgrades each, the cannon's splash and the frost's slow, ten
  waves with the timer, the star thresholds),
  the start state, every run file played twice to the same snapshots with its assertions passing,
  win and lost, each run failing without each rule in its `guards`, the `win` and `lost` inputs
  equal to their bot plans, E8's twelve towers winning with two stars, and the `sped-up` golden
  hashes equal to the win's (E9). Engine 0.15 T14 (the asset audit): no look, tag look or tile with its own
  fallback colour; every tick of every run drawn through `view.ts`'s Canvas2D picture without a
  fallback box (the bundle's PNG sheets decoded size-only for Node); the one song's channels the
  same length; the skin's sounds (events' and projectiles' impacts) exactly the sfx files. E7: the
  three tower types at levels 1-3 idle and firing, shots, ghosts (ring, blocked, selected),
  enemies' steps, slow look, hit flash and health bars, every road frame in the cut sheet and a
  sound for every kit event.
- `runs/` (Engine 0.16 E8, "The Winding Road map (E8)" below, and E9): ten run files, each with
  sync `hashes` and a golden `<name>.hashes.json`, made from `TdBot` plans:
  - `build.run.json` (120 ticks): an arrow on the path is refused (`not_build_cell`), cannons
    bought on (3, 2) and (14, 2), a frost refused (`too_poor`), the second cannon sold for 12 and
    the frost bought on (4, 4). Guards `build-on-build-cells`, `build-costs-gold`, `sell-refunds`.
  - `upgrade.run.json` (120 ticks): an arrow on (3, 2) upgraded twice (8, then 12 gold), a third
    upgrade refused (`max_level`); the level 3 arrow holds wave 1 alone (8 killed) and is sold for 15. Guards `upgrade-costs-gold`, `upgrade-improves`; its sync hashes are ticks 0 and 120.
  - `splash.run.json` (180 ticks): a frost on (4, 4) slows wave 1 so the runners bunch, and a
    cannon on (6, 10) shoots runner 6 with a splash that kills runner 5 beside it (tick 160).
    Guards `splash-damage`.
  - `slow.run.json` (60 ticks): a level 2 frost on (4, 4) slows the first runner to 50% for 30
    ticks (tick 24). Guards `slow-enemies`.
  - `target.run.json` (160 ticks): the frost's slow lets runner 6 overtake runner 5; an arrow on
    (6, 10) shoots 6, the one further along (tick 150). Guards `target-first`.
  - `timer.run.json` (520 ticks): nothing pressed; the timer starts wave 1 at tick 501. Guards
    `wave-timer`.
  - `leak.run.json` (360 ticks): one arrow on (4, 4) against wave 1 kills four runners, four leak
    (20 lives to 16). Guards `tower-range`, `tower-cooldown`, `leak-costs-life`.
  - `lost.run.json` (1500 ticks, E9; E8's was no towers and three waves at once): a thin
    defence (`LOST_PLAN`: two arrows, each upgraded once), every wave sent as the last clears;
    waves 1 to 3 held, leaks from wave 4, the twentieth leak in wave 6 loses the round at tick
    1489 (no stars, 36 killed). Guards `spawn-spacing`, `enemies-walk`, `leak-costs-life`,
    `lose-at-zero-lives`.
  - `win.run.json` (3150 ticks, E9; replaces E8's `won`): the good defence (`WIN_PLAN`): thirteen
    towers built and upgraded between waves, all ten waves sent with Enter; two brutes of wave 10
    get through; won at tick 3141 with 18 lives, three stars, 138 killed. Guards `towers-fire`,
    `kill-bounty`, `win-on-clear`.
  - `sped-up.run.json` (3150 ticks, E9): the win's defence played on the page's scene at 2x
    between waves and 3x during them (the shell's speed control), the bot deciding once a tick,
    and exported by `TdPlay.recording()`: the same input as `win`, and its golden file equals
    `win.hashes.json` at every hashed tick (tested). No `guards` (the win guards them).

## Rules

- Content only: maps, towers and waves are data files under `content/`; game rules belong in the
  kit (`kits/towerdefense`), never here. `tests/architecture/no-content.test.ts` keeps content out
  of the engine and kits.
- Imports: relative paths, `@engine/core/*`, `@engine/backends/canvas2d` (the picture and the
  page) and `@kits/towerdefense` (and its `kit.ts`). Never `engine/sim` (the sample needs none),
  other games or other kits. Tests may also use `@engine/backends/null`.
- Sound, the skin and the text art are text (`content/`). The only binary files are the CC0 pack
  in `assets/kenney-tower-defense/` (credited in `assets/CREDITS.md`); anything cut from it is
  made by `tools/road-art.ts` and checked byte for byte (`assets.test.ts`). A new kind or tag the kit
  presents gets a skin entry (or a `byTag` look); `pnpm cli validate` fails a skin naming a frame,
  palette or sound the game lacks.
- The page is glue only: `play.ts` has no DOM and no rules; the DOM is `main.ts`.
- Every kit rule must stay guarded by some run file: the kit is strict, so
  `pnpm -s cli mutants games/samples/tower-defense` exits 4 otherwise
  (`tests/runs/tower-defense-mutants.test.ts`). A new kit rule needs a run here that fails without
  it; list it in that run's `guards`.
- Sync hashes and mutants: a switched-off rule that changes the state before one of a run's
  checks fails would stop the run at a hash mismatch, which is not a failed check, and the rule
  would look unguarded. So each run's `hashes` are its `hashEvery` ticks minus the ones a mutant of
  a rule the run guards reaches with a changed state before a check fails. The golden
  `<name>.hashes.json` still holds every `hashEvery` tick.
- After a change meant to change the state, replay the bot plans (in the test and above), update
  the assertions, sync hashes and goldens, and rerun `mutants`.

## Testing

`pnpm test games/samples/tower-defense`; `pnpm -s cli validate games/samples/tower-defense`;
`pnpm -s cli run games/samples/tower-defense/runs/win.run.json` (and `build`, `upgrade`,
`splash`, `slow`, `target`, `timer`, `leak`, `lost`, `sped-up`);
`pnpm -s cli mutants games/samples/tower-defense` (exit 0, strict, 18 rules guarded);
`pnpm test tests/runs` (golden hashes, the mutants test and backend parity through `view.ts`).

The art and the page: `pnpm -s cli screenshot games/samples/tower-defense/runs/win.run.json --tick
1300` (`--tick 3150 --overlay end` the end screen with its stars) (a PNG in `.ww-out/screenshots/`, the same bytes every time; `--json` gives its sha256 and
`matchesHeadless`). In headless Chromium (skipped where none is installed):
`pnpm test tests/browser/tower-defense-page.test.ts` builds the repo, follows the games index's
link to the page (as "The Winding Road"), checks the shell's volume control, places an arrow with two taps and starts a wave with the Wave button (it kills runners),
then (E9) follows the link again to the title, starts, and on the live loop cycles the speed with
F and the speed button (3x plays more ticks a second), and from the title with
`?debug=step&title=show` types the `win` run's input on the keyboard to the win at 18 lives and
three stars and the end screen (its jingle playing, the game held, the page's recording the run's
input), with no page errors; `pnpm test tests/browser/tower-defense-shots.test.ts` takes `build` at
tick 120, `win` at 1300, `lost` at 1500 and the end screen over `win` at 3150 and `lost` at 1500
twice each (byte-identical, matching the headless hashes, all different).
`pnpm test tests/build/pages.test.ts` checks the launcher lists it.

## Title screen, pause menu and settings (Engine 0.16 T9)

`game.json`'s `menus` block (the shell's menus, `engine/core/shell/CLAUDE.md`; schema in
`engine/core/ui/menus.ts`): the title "The Winding Road" in `road-title` over the game's own
picture at its start (dimmed 0.6), the subtitle "Build on the stones, keep the gate shut", art (from E7 the pack's `arrow-3` and `cannon-3` x2, sheet `road`; from E8 96 px in from the 480 px picture's sides),
the song `road`, a footer and the items start, controls, settings; the pause menu
(resume, controls, settings, title); settings (master, music, sfx, mute, shake, flashing, touch); and the controls screen's
rows (Move; Build; Upgrade; Next tower; Sell; Send the wave; Speed, from E8: F or the speed
button), shown with the player's keys. Colours: focus bar `#00502c`,
headings `#fcd800`. Fonts: `content/fonts/road-small.txt` (the menu font: the fx lab's small font, original 5 px glyphs with A-Z, a-z, 0-9, punctuation and, for key names, the four arrows) and `road-title.txt` (its title font: the small glyphs doubled with Scale2x, cell 10x18), made by a small generator; edit them by hand now. Claimed as `font` in `game.json`. The `ui-move`, `ui-select` and `ui-back` sfx are the menus' sounds.

`main.ts` passes `menus: { spec: content.manifest.menus, fonts, sheets }` to `bootBrowserGame`
and the fonts to the display. Back to title reloads the page (`restart: 'reload'`: its bar and `window` hook hold the first scene). `index.html` hides the page's bar on the title (`body[data-menu='title']`). The page opens on the title (the game waits
at tick 0 under it); Escape, P, gamepad Start or the `II` button pause (the ticks are held).
`?debug=step` and `?record` skip the title, so run files, replays and the older browser tests
are unchanged; `?debug=step&title=show` shows it. Tested in `tests/browser/menus.test.ts` (title,
start, pause, settings and controls by keyboard and touch, settings kept across a reload;
`WW_SHOTS_DIR=<folder>` keeps `menus-<game>-*.png`), tuned from those screenshots at page scale.

## 2D backend choice

The page draws through the PixiJS (WebGL) backend by default (`default2d: 'pixi'` in `main.ts`,
Engine 0.16 T13b-8; `@engine/backends/pixi`, loaded with a dynamic `import()`, its own chunk) and
falls back to Canvas2D where WebGL is missing (`body[data-backend]` says which runs; software
WebGL, such as headless Chromium's SwiftShader, counts as WebGL). `?backend=canvas2d` forces
Canvas2D (exact Canvas2D output, a machine whose WebGL misbehaves); `?backend=pixi` names the
default. `pnpm cli screenshot` and the run files' backend parity still draw through Canvas2D
(`view.ts`). Tested in `tests/browser/pixi-pages.test.ts` (the default, the fallback with WebGL
taken away, `?backend=canvas2d`); the page and menus browser tests play on PixiJS.

## The CC0 art pack and the skin (Engine 0.16 part E, E7)

- **The pack**: Kenney's "Tower Defense (top-down)" (CC0), the roadmap's pack for part E. Its two
  scaled sheets were copied from the mini siege's copy of the same pack (part F's F8, fetched from
  the OpenGameArt mirror; kenney.nl blocks automated downloads; games may not import each other,
  so the files are copied): `tilesheet-16.png` and `tilesheet-24.png`, the pack's 64 px tiles
  box-filtered to 16 and 24 px, with `license.txt`. `assets/CREDITS.md` names the source URL, the
  author and the licence; `validate` checks it and every frame against its image.
- **The cut sheet** `road-art.png` is made by `tools/road-art.ts` from those two (`pnpm exec tsx
games/samples/tower-defense/tools/road-art.ts`; `ROAD_FRAMES` lays it out and is the skin's
  `images.road.frames`; `assets.test.ts` checks the bytes): towers, 24 px, a base per level (the
  diamond plate, the octagon, the octagon with its plate) under a turret per type and level
  (arrow: gun, rocket, twin rockets; cannon: square cannon, round cannon, heavy twin; frost: the
  shields and the green turret in ice blue), each with a `-fire` copy whose turret recoils 1 px;
  `ghost-<type>` (level 1 at 55% alpha); enemies drawn facing right: `runner-0/1` (the green
  soldier and its mirror across its way, the step), `brute-0/1` (the green tank's hull and turret,
  the second 1 px on), each with an ice-blue `-slow` copy; 16 px ground: `grass-0` to `grass-3`
  (decor: a bush, a rock, a plant), `road` and `road-<open sides>` (a dark kerb on each side open
  to grass), `cave` (entry, the crater), `gate` (exit, the target plate) and `blank`.
- **Scale**: the map's cells stay 16 px (the kit's tile size; at E7 `game.json`'s screen and every run
  file were unchanged), so the ground is 16 px and towers and enemies are 24 px frames anchored on
  their cell's centre.
- **The skin** (`content/skins/canvas2d.json`, background `#2ecc71`, the pack's grass): `images`
  `road` (the cut sheet, the default sheet) and `td16` (the pack's 16 px sheet, grid 23x13, frames
  by tile number). Kinds: `tower:arrow`, `tower:cannon`, `tower:frost` (the third type E8's map
  adds; slow) with `idle` and a one-shot `fire`, `byTag` `level:` 3 and `level:` 2 for the upgraded
  looks, `turnToFacing: "up"` (the turret turns to its target) and a pop-in; `enemy:runner` and
  `enemy:brute` walking in two steps, `turnToFacing: true`, `hitFlash` white on `hit`, `byTag`
  `slow` in ice blue, a fade-in; `shot:<type>` `blank` (the events fly projectiles instead);
  `ghost:<type>` with a `ring` from its `range:` tag, `byTag` `selected` (the pack's wrench plate:
  the cursor is on a tower, whose range the ring shows) and `blocked` (a red silhouette); `cursor`
  (the text cursor). Tiles: `.` grass with `vary` decor, `#` road with `join` (with `S`, `X`), `B`
  the pack's stone plot (`td16` `84`), `S` `cave`, `X` `gate`. `labels`: a health bar on each
  enemy from `hp:` against its `maxhp:`. Emitters `spark`, `blast`, `shrapnel`, `frost`, `smoke`,
  `debris`, `dust`, `coins`, `stars`, `breach`. Events (each with a sound): `td-place`, `td-sell`,
  `td-upgrade` (stars and a pop), `td-refused`, `td-wave-start` (a flash), `td-spawn`,
  `td-shot:tower=cannon` (a shell lobbed on an arc, landing with a blast, smoke, `boom` and a
  shake), `td-shot:tower=frost` (a pellet, frost), `td-shot` (the arrow tower's bullet, sparks),
  `td-splash` (shrapnel flying from the target to each enemy hurt), `td-slow` (frost), `td-kill`
  (debris and smoke), `td-leak` (a breach, a red flash, a shake), `td-wave-clear`, `td-end:won`,
  `td-end:lost`. HUD as before (text icons and font).
- **Kit change** (presentation only): with the cursor on a tower the ghost is tagged `selected`
  and carries that tower's range, so the selected tower is ringed (`kits/towerdefense/CLAUDE.md`).
- **Checks**: `validate` (PNG references, frames inside their images, CREDITS.md), the asset and
  look tests above, every tick of every run without a fallback box, the golden hashes unchanged,
  `pnpm -s cli screenshot games/samples/tower-defense/runs/splash.run.json --tick 160 --scale 3`
  (the pack on Canvas2D) and `tests/browser/pixi-parity.test.ts`'s tower-defense case (from E8
  the `won` run, from E9 `win` and `lost`) (Canvas2D
  against PixiJS within the strict bound). The page decodes the sheets before booting
  (`withContentImages` in `main.ts`).

## The Winding Road map (Engine 0.16 part E, E8)

- **The picture**: `game.json`'s `screen` is 480x270 (16:9; 4x is 1920x1080). The map is 30 x 16
  cells (480x256): the kit's camera centres it, leaving 7 px above and below. The skin's bottom
  HUD row moved from y 228 to y 256 (the grass under the road); the top row stays at y 4.
  `view.ts` and `picture.ts` read the size from the manifest, so no code changed there.
- **The content**: the map (`road.json`, `road.map.txt`), the three tower types with two
  upgrades each (the cannon's splash and the frost's slow on the type and both levels), ten waves
  and the star thresholds, all above in "Files". The skin already had the frost tower (E7).
- **The menus**: the title art 96 px in from the sides, the controls screen with Upgrade and
  Speed, and `speeds` `[1, 2, 3]`.
- **The runs** (a rule change for every run: the map they played is gone; the 0.15 ones live on
  unchanged in `games/td-classic`): removed `leaked`, `shells` and `tapped` (with their golden
  files); `build`, `target`, `upgrade` and `won` re-made on the new map (new input, assertions and
  hashes); new `splash`, `slow`, `timer`, `leak` and `lost`. Each was played by the kit's `TdBot`,
  its sync hashes are the `hashEvery` ticks a guarded mutant does not reach changed before a check
  fails, and its golden file was written by `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`. Every new
  run's tick 0 hash is `d02aa6bb19e82982` (the new map at the start). `pnpm -s cli mutants
games/samples/tower-defense` exits 0, strict, 18 rules guarded. `td-classic` and the mini
  siege's hashes did not move.
- **Tests**: `tower-defense.test.ts` (the content: one map, three towers with upgrades, ten
  waves, the stars; the start state; nine runs; the bot's `won` plan), `play.test.ts` (the 30 x 16
  grid, the `won` input to tick 3100, an upgrade by tap), `engine/tools/edit.test.ts` (the map's
  rows), `tests/browser/tower-defense-page.test.ts`, `tower-defense-shots.test.ts` and
  `pixi-parity.test.ts` (the new runs and ticks).

## The full game (Engine 0.16 part E, E9)

All ten waves from the title to the star rating, in data and glue only (one kit addition, status
only).

- **Balance** (`content/waves/road.json`): waves 9 and 10 toughened (above). Played by the kit's
  bot: E8's twelve-tower defence wins with 17 lives (two stars), `WIN_PLAN` (a thirteenth arrow,
  upgraded, on (24, 4) before wave 10) with 18 (three stars, the threshold), `LOST_PLAN` (two
  arrows) loses in wave 6. Tested in `tower-defense.test.ts`.
- **Runs**: `win`, `lost` and `sped-up` (above, "Files"). `sped-up` is the win's defence played
  on `TdPlay` stepped by a `SceneStack` at 2x and 3x (`play.test.ts`), so its golden file equals
  the win's; `tests/runs/sped-up-shell.test.ts`, `presentation-invariance.test.ts` and
  `stepped-shell-invariance.test.ts` cover all three (each under `LONG_RUN_TICKS`, so presented
  whole), and `backend-parity.test.ts` and this folder's asset test draw every tick of them
  without a fallback box.
- **Music**: the skin's `music.road`, layers `calm` (`road`) and `danger` (`road-danger`), mixed
  by the kit's status: silent danger once the round is over, full while an enemy is within 8
  cells of the gate (`nearGate`), 0.6 from wave 8 while enemies are on the road, calm otherwise.
  The page passes it to the shell's mixer (`audio.mix`) with the seed (sounds varied per event).
  Every kit event already had its sound (E7); the end screen's jingles are the triggers' `music`.
- **HUD**: `next` and the wave preview (`as: preview`, `nextWaveGroups`, the text icons), the
  selected tower's `upgradeCost` (icon and number) and `sellValue` (`sell {value}`), the speed
  (`{value}x`, `when` above 1); texts in `road-small` (the presenter gets the font files:
  `TdLook.fonts`).
- **The end**: `menus.end` (heading, credits, stars from the HUD sheet `td`, `star-on` and
  `star-off` at 2x, the lines Waves held `wavesHeld/waveCount`, Lives left, Gold, Enemies stopped
  `killed`) and `menus.triggers.end` (`outcome` `won`: `The road is held!`, `road-won`; `lost`:
  `The gate has fallen`, `road-lost`, `stars: false`). Tested in `tower-defense.test.ts` (the
  triggers on the runs' frames, the end screen's stars and lines, the mix, the HUD) and the
  browser tests.
- **Kit status** (`kits/towerdefense/present.ts`): `killed`, `wavesHeld`, `nearGate`; no hash
  moved.
- **The page**: the Build/Upgrade button, `window.wwTd.recording()`, the mixer. Upgrade and sell
  work by keys (Z, C), pointer (a click on a selected tower, a right click), touch (a tap, a
  long-press, the bar's buttons) and gamepad (its jump and special buttons, the shell's
  bindings); the range shows while placing (the ghost's ring) and on the selected tower.
