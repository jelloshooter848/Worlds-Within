# games/samples/tower-defense

The standalone tower-defense sample (Engine 0.12, the platform test): one map, two tower types and
three waves on `kits/towerdefense`, as data files plus a few lines of glue. Every rule of the round
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
kept unchanged as the test game `games/td-classic`. This file is the
worked example of a tower-defense game on the kit ("How it was built", below).

## How to play

`pnpm dev`, then open `games/samples/tower-defense/` from the launcher (or the built page from
`pnpm build && pnpm preview`). Keep the enemies on the road from reaching the gate at the bottom
right: build towers on the grey stone pads, then send each wave.

- Keys (and the touch pad on a phone): arrows move the cursor, Z (jump) builds the chosen tower on
  the cursor's pad, X (attack) picks the next tower type (arrow, cannon), C (special) sells the
  tower under the cursor for its sell value, Enter (start) sends the next wave (otherwise the timer
  does, 400 ticks after the last). Z on a tower upgrades it a level (Engine 0.16 E3; a click on a
  tower selects it, a second click upgrades).
- Pointer: a click or tap moves the cursor to a cell, a second one on the same cell builds there; a
  right click or long-press sells. Taps are frame input (Engine 0.15, gap D1), so a round played by
  tapping is a run file (`runs/tapped.run.json`).
- The shell's sound control at the top right (Engine 0.15, gap M1): mute and the volume, kept in
  this browser for this game.
- The bar under the picture: Wave, Tower and Sell (the same as Enter, X and C), and the status
  line (the tick, then `the road is held!` or `the road is lost`).
- The HUD: gold, lives, the wave (`started/total`) and, with the timer running, the ticks to the
  next wave; at the bottom the chosen tower and its cost. The ghost tower on the cursor is green
  where it can be built and red where not (a path cell, a taken pad, too little gold).

The page plays 30 game ticks a second (`TICKS_PER_SECOND` in `play.ts`, the scene's `tickRate`,
which the shell paces since Engine 0.15, gap D2); the tools play the same ticks, so a run file's
`input` typed one tick at a time plays the same round.

## How it was built (the worked example)

1. `game.json` names the kit (`towerdefense`), claims the three content kinds, the seed (12) and a
   256x240 picture; the map is 16 x 15 cells of 16 px, so it fills the picture.
2. The content was written as data: `content/maps/road.json` + `road.map.txt` (the grid),
   `content/towers/towers.json` and `content/waves/road.json`, and checked with
   `pnpm cli validate games/samples/tower-defense`.
3. `headless.ts` is `createGame` over the kit's `tdGame` and `tdRound` (in `content.ts`).
4. The run files' `input` was made by playing the kit's `TdBot` (the same button presses a person
   makes: one press, then a released frame) and writing down the held actions; the assertions were
   read from the round's snapshot at those ticks.
5. `pnpm cli mutants games/samples/tower-defense` showed which kit rules each run guards; the
   `target` run was added because no other run guarded `target-first`. With every rule guarded,
   the kit turned on strict mutants (`kits/towerdefense/kit.ts`).
6. Sync `hashes` were added last (below), then the golden files
   (`WW_UPDATE_GOLDEN=1 pnpm test tests/runs`).
7. T5: the art (`content/sprites/`, `content/palettes/`), the skin, the sfx and the song were
   written as text and checked with `validate`; then `picture.ts` and `view.ts` (checked with
   `pnpm cli screenshot`), then `play.ts`, `main.ts` and `index.html` over `bootBrowserGame`.
8. Engine 0.15 (T5, T10, T14): the page's own tick counter, `TickInput`, hint string and
   cell-to-client copy went to the engine (the scene's `tickRate`, `MergedInput`, frame taps, the
   kit's `TD_CONTROLS` with `controlsHint`, `screenAtCell` and the display's `toClient`); a round
   played by taps became a run file (`tapped`); the skin's per-look `fallbackColor`s were removed
   (the sheet's `#ff00ff` stays, so a missing frame shows) and the asset tests added.

## Files

- `game.json`: kit `towerdefense`, content `td-map` (`content/maps/*.json`), `td-towers`
  (`content/towers/*.json`), `td-waves` (`content/waves/*.json`), `palette`, `sprite`, `skin`,
  `sfx`, `song`, seed 12, 256x240, `headless.ts`, `view.ts`.
- `content/maps/road.json`: the map's header: 40 gold and 5 lives to start, towers `arrow` and
  `cannon` (in the order `attack` cycles them), the wave list `road`.
- `content/maps/road.map.txt`: the grid (kit legend: `.` ground, `#` path, `B` build cell, `S`
  entry, `X` exit). The road winds from the entry at (0, 1) to the exit at (15, 13), 36 cells; the
  cursor starts on the first build cell, (1, 2).
- `content/towers/towers.json`: `arrow` (10 gold, range 2, 1 damage, cooldown 6, sells for 5) and
  `cannon` (25 gold, range 3, 4 damage, cooldown 20, sells for 15). Engine 0.16 E3 gave them
  `levels` (no earlier run upgrades, so none moved): arrow level 2 (8 gold: 2 damage, sells for 9)
  and 3 (12 gold: range 3, cooldown 4, sells for 15); cannon level 2 (20 gold: range 4, 6 damage,
  sells for 30).
- `content/waves/road.json`: a timer of 400 ticks and three waves: six runners; a slow brute with
  four fast runners behind it (they overtake it near the entry, with jitter); eight runners and two
  brutes.
- `content/sprites/td.txt`: the art, original NES-style pixel art as text (palette `td`): the
  five cells (`ground`, `road`, `pad`, `cave` at the entry, `gate` at the exit), `arrow-idle`,
  `arrow-fire`, `cannon-idle`, `cannon-fire`, `runner-0/1`, `brute-0/1` (drawn facing right),
  `shot-arrow`, `shot-cannon`, `cursor-0/1` (16x16) and the HUD icons `icon-gold`, `icon-lives`,
  `icon-wave`, `icon-timer` (8x8). `content/sprites/td-font.txt`: the HUD font (the mini siege's,
  with a `/` added for the wave), palette `td`.
- `content/palettes/`: `td` (the NES colours the art uses) and three recolours with the same
  letters: `td-ok` (green) and `td-blocked` (red) for the ghost tower, `td-hit` (white) for an enemy
  shot this step.
- `content/skins/canvas2d.json` (no look with a `fallbackColor` of its own since Engine 0.15
  T14; the sheet's `#ff00ff` is the only one): keyed on the kit's kinds: `tower:arrow`, `tower:cannon` (`idle`,
  `fire`), `enemy:runner`, `enemy:brute` (`walk`, mirrored when facing left; `byTag` `hit` draws
  them with `td-hit`), `shot:arrow`, `shot:cannon`, `ghost:arrow`, `ghost:cannon` (the tower's
  frame; `byTag` `ok` with `td-ok`, `blocked` with `td-blocked`) and `cursor` (blinking). Tiles
  `.`, `#`, `B`, `S`, `X` (`TD_TILES`). Events: `td-place`, `td-sell`, `td-refused`,
  `td-wave-start`, `td-shot:tower=cannon` (boom and a shake), `td-shot` (arrow), `td-kill`
  (particles), `td-leak` (a red tint), `td-wave-clear`, `td-end:won`, `td-end:lost`. HUD: `gold`,
  `lives`, `wave`, `nextWave`, `tower`, `towerCost`.
- `content/sfx/`: `place`, `sell`, `refused`, `wave`, `arrow`, `boom`, `kill`, `leak`, `clear`,
  `won`, `lost` (MML, one short phrase each). `content/songs/road.json`: the looping song (four
  channels, MML).
- `picture.ts`: `tdLook(content)` (the skin, sheets, size; the grass colour is the skin's
  `background`, Engine 0.15 gap G36),
  `tdFrameStream(screen, cursor)` (a `FrameStream` over the kit's `tdFrames`), `tdPicture(presenter,
screen, cursor)` and `tdCanvasPicture(r, look, cursor, onSound?)`. No drawing of its own.
- `view.ts`: `createView(content, seed, opts?)`, the engine's `frameView` over `createGame` and the
  pictures above (the cursor and ghost shown), for `pnpm cli screenshot` and the backend parity
  test.
- `play.ts`: `TdPlay`, the page's `Scene` (no DOM, no clock): one game tick per `update`, its
  `tickRate` `TICKS_PER_SECOND` (30): the shell's `SceneStack` steps it every `STEPS_PER_TICK` (2)
  loop steps with the steps' input merged (`MergedInput`: pressed on any step counts on the tick,
  every tap arrives; Engine 0.15, gap D2, which removed the sample's own `TickInput` and counter).
  Keys and taps are frame input the kit's `TdGame` reads (gap D1); `headless()` is the game, for
  `window.__ww`.
- `main.ts` + `index.html` (title "Tower defense: The Winding Road, ...", the name the games index
  shows): the page: `bootBrowserGame` with Canvas2D, `game` (the volume
  control's storage key, gap M1), the touch pad, `pointer: true` and `audio` (the sfx and the song
  `road`), the bar (Wave, Tower, Sell, pressing through the shell's `InputManager.press`, and the
  status; before the first wave its hint is the kit's `TD_CONTROLS` written by `controlsHint` with
  the player's key names, Engine 0.15 T10, lesson D14: the page's `HINT` string is gone) and `window.wwTd` (`tick()`, `kit()`, `cursor()`) for the browser test. No cell-to-client
  copy (gap D13): the test taps through the kit's `screenAtCell` and `window.__ww.toClient`.
- `play.test.ts`: `TdPlay` on a `SceneStack` (paced at its `tickRate`) into the null backend: the
  `won` input typed one tick at a time wins with the run's golden hash at tick 700 and shows every
  kind of event; one tick every two loop steps; a key pressed for one loop step counts; frame taps
  move, place and sell (each tap at a cell's centre from the kit's `screenAtCell`, gap D13); the
  `tapped` run's taps give its golden hash; `InputManager.press` presses on the next tick.
- `content.ts`: `loadTowerDefense(files)` (the checked bundle) and `sampleRound(content)` (the
  kit's `tdRound`).
- No `files.ts`: `main.ts` imports its data files from `virtual:game-files` (the build's plugin, `build/game-files.ts`; no `files.ts` since Engine 0.14 T2).
- `headless.ts`: `createGame(content, seed, opts?)`, the kit's `TdGame` (snapshot
  `{ round, controls, kit }`; see `kits/towerdefense/CLAUDE.md`), rules switched off in `opts`
  passed to the kit.
- `tower-defense.test.ts`: the content (one map filling the picture, two tower types, three waves),
  the start state, every run file played twice to the same snapshots with its assertions passing,
  won and lost, each run failing without each rule in its `guards`, and the `won` input equal to
  the bot's plan. Engine 0.15 T14 (the asset audit): no look, tag look or tile with its own
  fallback colour; every tick of every run drawn through `view.ts`'s Canvas2D picture without a
  fallback box; the one song's channels the same length; the skin's sounds exactly the sfx files.
- `runs/`: six run files, each with sync `hashes` and a golden `<name>.hashes.json`:
  - `build.run.json` (40 ticks): an arrow on the path is refused (`not_build_cell`), a cannon
    bought, a second refused (`too_poor`), the first sold for 15, an arrow bought. Guards
    `build-on-build-cells`, `build-costs-gold`, `sell-refunds`.
  - `won.run.json` (700 ticks): four arrows and a cannon placed with the cursor between waves
    started by the button; every wave held (5 lives, nothing leaked) and the round won at tick 673. Guards `build-costs-gold`, `spawn-spacing`, `enemies-walk`, `towers-fire`, `tower-range`,
    `tower-cooldown`, `kill-bounty`, `win-on-clear`.
  - `target.run.json` (260 ticks): one cannon at the entry; in wave 2 it kills the runner that
    overtook the brute (enemy 8 at tick 229), not the brute. Guards `target-first`.
  - `leaked.run.json` (1340 ticks): a thin defence of two arrows at the entry, every wave started
    by the timer (ticks 401, 801, 1201); wave 1 is held, waves 2 and 3 leak, and the round is lost
    at tick 1320. Guards `wave-timer`, `tower-range`, `tower-cooldown`, `leak-costs-life`,
    `lose-at-zero-lives`.
  - `tapped.run.json` (700 ticks, Engine 0.15 T5, gap D1): `won`'s defence played by pointer
    taps (`input.taps`, game screen pixels: the cell centres `col * 16 + 8`): two taps per tower
    (the first moves the cursor, the second places) and keys only for `attack` and `start`; the
    waves start 20 ticks earlier than `won`'s, the same towers stand and the round is won with all
    5 lives (its tick-700 hash equals `won`'s: the same end state). Guards nothing (it proves taps
    replay; `won` guards the rules).
  - `upgrade.run.json` (160 ticks, Engine 0.16 E3): an arrow on the cursor's first pad (1, 2),
    upgraded twice with Z (8 then 12 gold), a third upgrade refused (`max_level`); the level 3
    arrow holds wave 1 alone (6 killed, nothing leaked) and is sold for 15 (5 + 4 + 6). Guards
    `upgrade-costs-gold`, `upgrade-improves`; its sync hashes are ticks 0 and 160 only.

## Rules

- Content only: maps, towers and waves are data files under `content/`; game rules belong in the
  kit (`kits/towerdefense`), never here. `tests/architecture/no-content.test.ts` keeps content out
  of the engine and kits.
- Imports: relative paths, `@engine/core/*`, `@engine/backends/canvas2d` (the picture and the
  page) and `@kits/towerdefense` (and its `kit.ts`). Never `engine/sim` (the sample needs none),
  other games or other kits. Tests may also use `@engine/backends/null`.
- Art, sound and the skin are text (`content/`): no binary files. A new kind or tag the kit
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
`pnpm -s cli run games/samples/tower-defense/runs/won.run.json` (and `build`, `target`, `leaked`,
`tapped`, `upgrade`);
`pnpm -s cli mutants games/samples/tower-defense` (exit 0, strict, 16 rules guarded);
`pnpm test tests/runs` (golden hashes, the mutants test and backend parity through `view.ts`).

The art and the page: `pnpm -s cli screenshot games/samples/tower-defense/runs/won.run.json --tick
300` (a PNG in `.ww-out/screenshots/`, the same bytes every time; `--json` gives its sha256 and
`matchesHeadless`). In headless Chromium (skipped where none is installed):
`pnpm test tests/browser/tower-defense-page.test.ts` builds the repo, follows the games index's
link to the page (as "The Winding Road"), checks the shell's volume control, places an arrow with two taps and starts a wave with the Wave button (it kills runners),
then types the `won` run's input on the keyboard and wins at tick 673 with 5 lives, with no page
errors; `pnpm test tests/browser/tower-defense-shots.test.ts` takes `build` at tick 40, `won` at
300 and `leaked` at 1330 twice each (byte-identical, matching the headless hashes, all different).
`pnpm test tests/build/pages.test.ts` checks the launcher lists it.

## Title screen, pause menu and settings (Engine 0.16 T9)

`game.json`'s `menus` block (the shell's menus, `engine/core/shell/CLAUDE.md`; schema in
`engine/core/ui/menus.ts`): the title "The Winding Road" in `road-title` over the game's own
picture at its start (dimmed 0.6), the subtitle "Build on the stones, keep the gate shut", art (`arrow-idle` x3, `cannon-idle` x3),
the song `road`, a footer and the items start, controls, settings; the pause menu
(resume, controls, settings, title); settings (master, music, sfx, mute, shake, flashing, touch); and the controls screen's
rows (Move; Build; Next tower; Sell; Send the wave), shown with the player's keys. Colours: focus bar `#00502c`,
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
