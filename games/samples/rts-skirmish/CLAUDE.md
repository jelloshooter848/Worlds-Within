# games/samples/rts-skirmish

The first RTS sample (Engine 0.9, `docs/ROADMAP.md`, "0.9 RTS kit and view"), on `kits/rts` over
an `engine/sim` world; the first folder under `games/samples/`. Since T11 it is playable and
replayable headless (`pnpm cli run`) and drawn by the Canvas2D backend for screenshots and the
backend parity test; since T12 it is played in the browser (`index.html`, launcher link
`games/samples/rts-skirmish/`), and a match played there exports as a run file that `pnpm -s cli
run` replays to the same state hashes. Since Engine 0.15 T14 it is **finished** as **The River
Ford** (docs/BUILD-LOG.md, Engine 0.15, decision 13): sfx, an MML song (`ford`), an end for a win
and a loss. From Engine 0.16 part D it is the full skirmish (`docs/ROADMAP.md`, "0.16 part D: the
RTS skirmish, The River Ford"): D7 put it on a CC0 pack, Kenney's Medieval RTS, at 16:9 ("The CC0
art pack and the 16:9 skin" below), and **D8 made it a match against an AI base across the
river**: a 64x40 map, red (three workers, a town centre, the hero Wren) against blue (three
workers, a town centre and a sentry soldier) played by the kit's skirmish AI under fog of war, the
end as data, and the page with fog, a clickable minimap, order markers, path dots, barks and build
and train progress (below). The 0.15 battle (the 40x24 map, the raiding party, its five run
files) is kept unchanged as `games/rts-classic` (D2). This file is the worked example of an RTS
game on the kit: "How it was built" below is the order to follow for a new one. **D9 balanced the
ten-minute match** (data only: the AI's waves, the town centre, the gold) and added its win and
loss run files (`match-won`, `match-lost`, about 6000 ticks each at the page's 10 ticks a second),
the layered music with a danger layer, more sounds, the selected-unit panel and the camera's feel
("The ten-minute match (D9)" below).

## How it was built (the worked example)

1. **`game.json`**: kit `rts`, the picture size, a seed, `headless.ts` and `view.ts`, and the
   content kinds it claims (the kit's `rts-map`, `rts-types`, `rts-enemy`, `rts-end`, `rts-names`; the
   engine's `palette`, `sprite`, `skin`, `sfx`, `song`, `font`).
2. **The world as data**: the map as a world scenario (`content/maps/*.world.json`, the sim's
   format with `"systems": "rts"`), the unit and building types (`content/types/`), the AI's plan
   (`content/enemy/`, the kit's `rts-enemy` with `knowledge: "fog"`), the end rule
   (`content/end/`, `rts-end`). `pnpm -s cli validate games/samples/rts-skirmish --json` after
   each. A big map is easiest made by a throwaway script that writes the rows and entities (D8's
   drew one half and mirrored it, so the map is point-symmetric; `skirmish.test.ts` checks it).
3. **Glue**: `content.ts` (the loaded bundle as map, types, plan, end rule, skin), `headless.ts`
   (the sim world behind the kit's `rtsGame` through the sim's `rtsWorldPort`, plus `sides` in the
   snapshot and `skirmishResult`, the kit's `matchResult` under the end rule), `actions.ts`
   (interface actions, so run files can drive the page's selection and commands).
4. **Run files** (`runs/`): orders recorded with a throwaway script (below), assertions read off
   `pnpm -s cli dump`, sync `hashes` from `run`, then `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`;
   `pnpm -s cli mutants games/samples/rts-skirmish --json` until every kit rule is guarded and no
   run is weak. Short guard runs first (D8: `opening`, `ai-barracks`, `fog`, `razed`); one run
   per end (a win and a loss) once the match is balanced (D9). `pnpm -s cli trace <run> --paths
a,b --every n --json` is the quickest way to watch the AI and read assertion values.
5. **Art**: a CC0 pack in `assets/<pack>/` with `assets/CREDITS.md` (from Engine 0.16 part D,
   D7; before it, text sprites only), anything cut or scaled from it made by a script in
   `tools/` and checked against it, and text sprites (`content/sprites/*.txt`) only where the
   pack has nothing; one frame for every kind, state and facing the kit presents
   (`skirmish.test.ts` fails on a missing one and on any fallback box drawn in any tick of any
   run); bigger text pieces such as the end banners were made once by a throwaway script and kept
   as text.
6. **The skin** (`content/skins/canvas2d.json`): kinds to frames (the enemy's kinds their own
   art, `sideKinds`), tiles, the HUD, `events` (the kit's `RtsEventTracker` events and the
   game's `battle-end`, each to an sfx and an effect) and the end banners as HUD icons keyed on
   the frame's `won` / `lost` status. No `fallbackColor` but the sheet's own (`#ff00ff`, so a
   missing frame shows).
7. **Sound**: one line of MML per sfx (`content/sfx/`) and one looping song
   (`content/songs/ford.json`, all four channels the same length; the test checks it).
8. **The picture and the page**: `picture.ts` (the kit's `presentWorld` with fog, the tick's
   events, the page's order feedback, barks and the end status, onto the Canvas2D backend), `view.ts` (for `pnpm cli screenshot`),
   `play.ts` (the page's scene, no DOM) and `main.ts` + `index.html` (the DOM: the shell's boot
   with `audio` and the volume control, the bar, the end screen, the hook for the browser test).
9. **Browser test** (`tests/browser/rts-skirmish.test.ts`): from the games index's link, a whole
   battle by mouse and touch, the end screen, the export replayed headless.

## The rule

Content, skins and thin glue only (DESIGN.md: if two games could use it, it is engine; if it is
content, it is the game). The world's rules (movement, combat, building, training, gathering)
are `engine/sim` systems; the kit turns selection and commands into orders and runs the enemy's
plan. The map, the types, the AI's plan, the end rule, the art and the skin (bark lines included)
are text files (the pack's PNGs aside); never put map rows, stats, plan steps or pixel rows in
`.ts` files (`tests/architecture/no-content.test.ts`). Fog of war is the player's picture and the
AI's knowledge only: no world rule reads it.

## Files

- `game.json`: kit `rts`, 480x270 (16:9 from Engine 0.16 part D, D7: 4x is 1920x1080; 320x240
  from T3 before it), seed 9, `headless.ts`, `view.ts`; content kinds
  `rts-map`, `rts-types`, `rts-enemy`, `palette`, `sprite`, `skin`, and since Engine 0.15 T14
  `sfx` and `song`. `index.html` is its page (title "RTS skirmish: The River Ford, ..."): the
  games index lists it and `pnpm build` emits `games/samples/rts-skirmish/index.html`.
- `content/maps/ford.world.json` (`rts-map`, D8): a world scenario (`engine/sim` format,
  `"systems": "rts"`), 64x40 cells of 16 px (the 480x270 picture shows 30x16.9 of them): grass
  (`.`), dirt roads (`,`), rock and woods (`#`, impassable) and a river (`~`, impassable) down
  columns 31-32 with three fords (rows 6-7, 19-20, 32-33), point-symmetric (cell x, y is cell 63-x,
  39-y), so neither side starts better placed. Terrain types are numbered in sorted character
  order: 0 rock, 1 dirt, 2 grass, 3 water (the skin's `tiles` keys). Roads join each base to all
  three fords. Red's town centre is 3x3 at 4,18 (stockpile, 200 gold), blue's at 57,19 (200);
  gold: each side two home nodes (1000, D9; 800 before; red 10,14 and 10,25) and one far node on
  its own bank (2400, D9; 1200 before; 24,3 and 39,36). Red: three workers (8,16; 9,21; 8,22) and the `guard` squad with one
  named member, the hero Wren (`role: hero`, at 6,22); blue: three workers (the mirror cells) and
  the soldier `sentry` (57,17), its first scout. Every unit and building carries its type's
  numbers (`skirmish.test.ts` fails when they drift from the types file). The map holds no
  `RtsTypes`: the glue adds it.
- `content/types/skirmish.json` (`rts-types`): `worker` (20 hp, gathers 5 a load at one per 3
  ticks, builds at 2 work a tick, 50 gold, 50 ticks), `soldier` (40 hp, hits 4 every 3 ticks,
  sight 5, 60 gold, 60 ticks), `archer` (24 hp, hits 3 every 4 ticks at range 4, sight 6, 70 gold,
  70 ticks; D8, the pack's bowman), `hero` (100 hp, hits 6, sight 7; trained nowhere),
  `town-centre` (3x3, 1600 hp (D9; 800 before, when eight soldiers razed it in 30 ticks), 300
  gold (D9; it cost nothing, so a player could put up town centres for free), 200 work, sight 7,
  drop-off, trains workers) and `barracks` (2x2, 400 hp, sight 5, 120 gold, 80 work, trains
  soldiers and archers).
- `content/enemy/blue.json` (`rts-enemy`, D8): the AI, `knowledge: "fog"` (it targets and counts
  red only as its side has seen it; the kit's rule `enemy-knows-only-what-it-saw`). Steps in
  order: `gold` (every 10 ticks, idle workers gather the nearest gold), `scout` (while it knows no
  red building, every 40 ticks one idle soldier walks to the nearest unexplored cell, first in
  red's home box 0,10 20x20, then anywhere west of the river), `barracks` (once it has 5 workers,
  every 30 ticks two workers build a barracks at 51,22, then a second at 51,15), `workers` (train
  up to 7), `soldiers` (up to 16; 6 before D9), `archers` (up to 8; 3 before), `defend` (once it
  sees a red unit, every 20 ticks two to six idle soldiers attack the nearest it sees: `min: 2`,
  so the lone scout never starts a chase; `max` 6 from D9, 3 before), `rally` (once it knows a red
  building, idle soldiers walk to 48,20 in front of its base, which brings the scout home), three
  waves (D9; each fires once, from its tick, as soon as enough are idle, at red's base, the town
  centre it knows, walked to when only remembered): `wave-1` / `wave-1-archers` from 1800 (4 to 5
  soldiers, 2 archers), `wave-2` / `wave-2-archers` from 3000 (6 to 8, 3) and `wave-3` /
  `wave-3-archers` from 4200 (8 to 10, 4), and `push` and `push-archers` (from tick 5400, every
  100: every idle soldier and archer at red's base). At the page's 10 ticks a second the waves
  come from 3, 5 and 7 minutes and the push from 9. Before D9: `wave` and `wave-archers` every
  1500 ticks from 1800 (four soldiers, two archers) and the push from 4800, which a defended base
  shrugged off while a passive one fell at 3.8 minutes. The AI's memory (explored cells, red buildings as last seen) is
  the kit snapshot's `seen`, so it is in the hashes.
- `content/end/ford.json` (`rts-end`, D8): red wins once blue has no `town-centre`, and loses once
  red has no `town-centre` or no unit (`lost` is checked first).
- `content/names/skirmish.json` (`rts-names`, Engine 0.16 polish Q, D2): the HUD's display names,
  "Worker", "Soldier", "Archer", "Hero", "Town Centre", "Barracks", loaded by `skirmishNames` and
  passed to the kit's `presentWorld` as `names` (`SkirmishFrameOptions.names`, by `view.ts`,
  `main.ts` and `play.test.ts`). Presentation only: kept out of `content/types/skirmish.json`,
  which is copied into the world (it would move every hash). The selected-unit panel's name is
  the status `selectedName` and its training line `trainingName`; `when` conditions keep reading
  the ids (`selectedType`, `training`). A new unit type or building kind needs its name here too
  (`skirmish.test.ts` checks the table covers the types).
- Art (Engine 0.16 part D, D7): the CC0 pack in `assets/kenney-medieval-rts/` (below) for the
  units, buildings, ground and props, and the text sheet `content/sprites/skirmish.txt` (palette
  `content/palettes/skirmish.json`) for what the pack has nothing for: `ring` (selection, white,
  tinted by side), `hp-0`..`hp-8` and `p-0`..`p-8` (bars, 16x2), `box`, `dot` and `dot-goal`
  (path dots, 4x4), `marker-<move|attack|gather|build>-<0|1>` (order markers, 16x16, large then
  small), the HUD icons and the end banners `banner-won` ("VICTORY") and `banner-lost`
  ("DEFEAT"), 160x48. `content/sprites/skirmish-font.txt`: the HUD digits. The 0.15 text units,
  tiles and buildings (and the blue palette) are kept only in `games/rts-classic`.
- `content/skins/canvas2d.json` (rewritten in D7): `images` `rts` (the pack's sheet: `<type>-red`
  and `<type>-blue` for worker (villager), soldier (sword and shield) and hero (the king), each
  with a `-step` copy anchored 1 px higher for walking, attacking, building and gathering;
  `town-centre` (the stone keep) and `barracks` (the green-roofed hall), anchored `bottom`) and
  `ford` (`ford-tiles.png`, `FORD_FRAMES`). Every kind the kit presents: `unit:<type>` (red art)
  and `unit:<type>:enemy` (blue art) in `idle`, `walk`, `attack`, `build`, `gather`, facings
  `down`, `up`, `right` (the pack draws one front view; `flipFacing` mirrors it for the left), with
  `team` (`faction:` red `#e0442c`, blue `#1e8ce1`; the cloth's hue range, 5-22 on the red art,
  190-206 on the blue) and `outline: "team"`; `building:town-centre` and `building:barracks` (and
  `:enemy`, the same art recoloured: the keep's banner, hue 5-22, the hall's roof, hue 135-155)
  in `idle`, `train`, `site` (`site-3x3`, `site-2x2`: the pack's crate and plank floor) and a
  `byTag` look from `progress:50` (`site-3x3-half`, `site-2x2-half`: fresh boards), team outline
  too; `resource:gold` (`gold`, `gold-empty`); `selection-ring` (team-tinted by `own`, `enemy`,
  `neutral`); `health-bar` and `progress-bar` (zoom-stable, `screenScale { min: 1, max: 1 }`,
  D4); `ghost:barracks` (the hall at half alpha); `selection-box`; `path-dot` (`idle`, `goal`)
  and `order-marker` (`move`, `attack`, `gather`, `build`, a one-shot large-to-small cycle), both
  at least one picture px per sprite px (`screenScale { min: 1 }`). Tiles: `0` rock (`vary`:
  boulders and trees), `1` dirt (`join` with `["1", "3"]`: a road for every set of open sides and
  a plaza with notched inner corners; water counts as joined, so the road runs through the river
  as the ford), `2` grass (`vary`), `3` water (`join`: a bank on each side open to land). `fog`:
  unexplored `#0c0c1c` at 1, explored at 0.5, a 6 px edge. HUD: gold, own units and enemy units
  seen (icon and number) at the top left, on a flat panel (polish Q, D3: the hud's first item, so
  it draws over the world and fog and under the counters; 117x14 at 1,1, `#0c0c1c` with no alpha
  so no sprite shows through, a `#fcfcfc` border like the selected-unit panel's; room for 4-digit
  gold at 14 and 2-digit counts at 62 and 98, clear of the banner and minimap); a `minimap` (128x80 at 348,186, the bottom right, 2 px a
  tile, so the whole 64x40 map; `fog`, dots per kind coloured by `teams` own red and enemy blue,
  the view outlined; D8 sized it for the new map, as `minimapPointToWorld` needs every cell inside
  the box); the bark lines (D8: one `text` item per order at 4,256 in `ford-small`, white with a
  black outline, `when: { status: "bark", eq: <order> }`: move "On my way!", attack "To arms!",
  gather "Off to the gold.", build "We will build it.", train "Training begins.", stop "Holding
  here."); and the end banner, `won` / `lost` as `icon` items at 160,111. The grass
  colour `#27ae60` is the skin's `background` (gap G36). No look has a `fallbackColor` of its own
  (only the sheet's `#ff00ff`, so a missing frame shows). The team colours and outlines need the
  backends' recolour (a canvas: the page, `pnpm cli screenshot`); Node tests draw the sprites
  plain, which is why the enemy keeps the pack's blue art and not only a recolour.
  `events` (Engine 0.15 T14), keyed by the event's `side` (`type:side=own`): `unit-down` (`fall`
  for own, `slain` for the enemy, with particles in the side's colour), `unit-hit` (`clash`, a
  spark), `unit-ready:side=own` (`ready`), `site-placed:side=own` (`placed`),
  `building-done:side=own` (`built`, a flash), `building-hit:side=own` (`clash`),
  `stock-up:side=own` (`coin`), `battle-end:won` (`victory`, a gold tint) and `battle-end:lost`
  (`defeat`, a red tint); the enemy's training and building are silent. D9: every event has a
  sound and a varied one: `unit-hit` (pitch -2 to 2, resting 2 frames), `building-hit:side=own`
  (`alarm`, at most every 45 frames, amber sparks), `building-hit:side=enemy` (`clash` pitched
  down), `building-down` (`crumble`, grey dust; the player's ducks the music), `stock-up` (pitch 0
  to 2), the ends' jingles duck the music, and the barks vary by -2 to 2 semitones and in volume.
  The skin's `music` (D9): `ford`, layers `calm` (`ford`) and `danger` (`ford-danger`), the
  danger layer up (calm at 0.6) within 20 frames while the frame's `enemyNear` (the kit's
  `threatStatus`: the fewest cells from an enemy unit the player sees to one of its buildings) is
  8 or less, down over 90 frames once it is not. HUD (D9): the selected-unit panel at the bottom
  left (a flat panel with the selected thing's name, its health bar and number, and a selected
  building's training and its progress bar), shown when one thing is selected; the own-units
  counter at the top left is the population. D8: `bark:unitType=<type>`
  for worker, soldier, archer and hero (`bark-<type>`, a pitch of -1 to 1 semitone, resting 6
  frames). D8 also added the archers: `archer-red` (the pack's `medievalUnit_07`) and
  `archer-blue` (`medievalUnit_01`), each with a `-step` copy, as `unit:archer` and
  `unit:archer:enemy` (the soldier's states and team colours) and their minimap dots.
- Sound (Engine 0.15 T14): `content/sfx/` (`ready`, `fall`, `slain`, `clash`, `placed`,
  `built`, `coin`, `victory`, `defeat`, from D8 the barks `bark-worker`, `bark-soldier`,
  `bark-archer`, `bark-hero`, from D9 `crumble` and `alarm`; one line of MML each) and
  `content/songs/ford.json`, "The River Ford", an original looping march in G (126 bpm, two
  pulses, triangle and noise, every channel 1536 ticks), played by the page from the first click,
  tap or key, with (D9) its danger layer `content/songs/ford-danger.json` (the same tempo and
  length: a driving sixteenth ostinato in G minor, a pedal bass and a busier drum line), mixed by
  the shell's mixer from the skin's `music`.
- TypeScript is glue:
  - `content.ts`: `loadSkirmish(files)`, `skirmishMap`, `skirmishTypes`, `skirmishEnemy`,
    `skirmishEnd` (D8),
    `skirmishScenario(content, seed)` (the map with the run's seed and the types table spawned
    first: entity 1 is the terrain, 2 the types, then the map's entities in file order),
    `skirmishSkin`, `PLAYER` (`red`), `SKIRMISH_MUSIC` (`ford`).
  - `headless.ts`: `createWorld(content, seed)` (`worldFromScenario`), `createGame(content, seed,
opts?)`: the kit's `rtsGame` with the world behind its port (`engine/sim`'s
    `rtsWorldPort(world)`, the one bridge since Engine 0.15 T6, gap M27), the enemy plan and the switched-off rules, wrapped in `SkirmishGame`. Its
    `order` takes a recorded order or an interface action (below); its snapshot is the kit's
    `{ world, kit }` plus `sides` (the kit's `sidesOf`, re-exported here; it moved to the kit in
    Engine 0.11 T8: per faction `units`, `unitTypes`, finished
    `buildings` by kind, `sites`, `stock`; red and blue always listed, a beaten side empty) and
    `ui.selection`. Engine 0.14 T7: `SkirmishGame` keeps its `world` and gives the optional
    `HeadlessGame` hooks `worldEvents(sinceTick)` (`eventsSince`) and `timeline()`
    (`worldTimeline`) for `pnpm cli events` and `timeline`; the log is never in the snapshot.
    Engine 0.15 T7: `worldKeys()` (the sim's `worldKeys`), for `world.key.<key>` run checks.
    Engine 0.15 T14: `skirmishResult`, the game's end, kept out of the snapshot. From D8
    `skirmishResult(view, end)` is the kit's `matchResult` under `content/end/ford.json` (before:
    code, `lost` with no red unit, `won` with no blue unit or building), and `SkirmishGame` has
    `end`, `view()` and `result()`. D9: `recorded()` (`RecordedEntry[]`) is the kit's recorded
    orders with every interface action handed to `order` put back in its place (in place of the
    order it gave): the page's export of a run replayed through the step hook keeps its `ui`
    entries, so the export hashes the same (`ui.selection` is in the snapshot).
  - `actions.ts`: interface actions (`interfaceActionSchema`, `PlayerInterface`): `click`,
    `box` (world px, `additive`), `command` (a world point), `build`, `train`, `stop`, carried
    out by the kit's `Selection`, `commandAt`, `buildCommand`, `trainCommand`, `stopCommand` with
    the game's rule switch. A run file gives them in `orders` as `{ tick, ui, ... }` next to
    recorded orders; the order one gives is stamped with the next id like a page command. They
    exist so a run can drive the game as the page does and the kit's interface rules can be
    mutant-checked headless.
  - `picture.ts` (D8 first): every stream draws the player's fog of war (`SkirmishFrameOptions`
    `{ ui?, fog? (default true), feedback? }`; `skirmishFrames(screen, opts?)`,
    `skirmishPicture(presenter, screen, opts?)`, `skirmishCanvasPicture(r, look, opts?,
onSound?)`); `feedback()` hands the page's accepted orders' `RtsOrderFeedback` (taken once) to
    the stream's `RtsPresentState.accept`, so the frame gets the order marker and the `bark`
    event, and the last bark's order is the status `bark` for `BARK_TICKS` (15) ticks (the HUD's
    line); `heardEvents(frame)` drops another side's events on cells not seen now, so no sound
    gives away what the fog hides; `ShowsWorld` is `{ view(), result() }` (a `SkirmishGame`).
    Before D8: `skirmishLook(content)` (skin, the engine's `contentSheets`, size, and from D10
    `fonts`, `contentFonts`, so the Canvas2D picture of the tools draws the HUD's text; the grass
    colour is the skin's `background`, Engine 0.15 gap G36), `sideKinds(frame)` (enemy units and buildings get the kind `<kind>:enemy`: a
    skin picks frames by kind only, and the kit tells sides apart by tag), `skirmishFrames(screen,
ui?)` (the engine's `FrameStream` over the kit's `presentWorld` for red; `ui` adds the
    the page's selection, box, placing and camera), `skirmishPicture`, `skirmishCanvasPicture`. Since Engine 0.15 T14 each stream's state is a `SkirmishPresentState`
    (the kit's `RtsPresentState`, an `RtsEventTracker` for red and the end seen so far): each frame
    carries the tick's events (none on a second frame of the same tick), a `battle-end` with
    `result` on the tick the battle ends (once per stream), and from then on `won: true` or
    `lost: true` in its status (the banner).
  - `view.ts`: `createView` for `pnpm cli screenshot` and the parity test: `render` (Canvas2D),
    `frame()`, and `order` (the same orders as the headless game). The picture is the player's,
    fogged. D10 (for the review screenshots, presentation only, no hash moved): the view draws the
    run's own interface state (the game's `ui.selection` selected: rings, path dots, the
    selected-unit panel), an interface command the game accepts gives its order marker and bark
    (the kit's `orderMarker` and `barkEvent`, as `RtsControls.feedback`), and the camera is a
    director's, `directorCamera(view, screen, selection)`: it frames the fight (units with a
    target where one side is the player's, and what they fight), else the selected units, else
    all the player's units, with a 48 px margin, zoomed out to fit (1 down to 0.5); before D10 it
    was the map's centre, which showed neither base.
  - `tools/ford-tiles.ts` (D7): `fordTiles(packSheet)` makes `ford-tiles.png` from the pack's
    sheet (`FORD_FRAMES`, `FORD_SIZE`, `SIDE_KEYS`, `CORNER_KEYS`; `pnpm exec tsx
games/samples/rts-skirmish/tools/ford-tiles.ts` writes it); the same bytes every run.
  - no `files.ts`: `main.ts` imports its data files from `virtual:game-files` (the build's plugin, `build/game-files.ts`; no `files.ts` since Engine 0.14 T2).
  - `recording.ts`: `BattleRecorder(seed, hashEvery = 20)`: `reached(tick, snapshot)` (after
    every step, and at tick 0: a hash tick's snapshot is taken before that tick's orders, where
    `run` hashes it), `runFile(recorded, game = '..')` (the battle as a run file `{ game, seed,
ticks, orders, hashEvery, hashes }`, ending at the last hash tick, with the orders applied
    before it; null before tick 20). Each hash is the core's `stateHash`
    (`engine/core/state-hash.ts`, synchronous, the tools' and the step hook's; Engine 0.15 T15 removed
    the sample's own Web Crypto copy, `stateHashOf`), so the page needs no Node.
  - `play.ts`: `SkirmishPlay`, the page's `Scene` (no DOM, no clock): the `SkirmishGame`, an
    `RtsCamera` over the whole map starting on the player's base, the kit's `RtsControls`
    (sharing the game's rule switch) and the recorder. Each loop step it carries out the bar's
    buttons (`press`: `build`, `train`, `stop`, `heroes`, `cancel`) and the pointer's gestures
    (an order goes to `RtsGame.issue`), hovers the placing ghost, and every `STEPS_PER_TICK` (6)
    steps the game one tick (`TICKS_PER_SECOND` 10 on the page; the tools play ticks as fast as
    they can; `stepsPerTick` 1 in manual-loop mode, D9, below). `buttons()` is what the bar shows (`build` for selected builders, `train` from
    the kit's `trainButtons`, `stop`, `placing`); `exportRun(game?)`; `message` is the last
    refusal; `result()` (Engine 0.15 T14) is the game's `result()`. The controls' selection is
    the page's own: the game's `ui.selection` stays `[]`, as in a replay of the recorded orders,
    so the page's hashes are the replay's. D8: the option `minimap` (`MinimapSpec`, the skin's
    `skinMinimap`): a primary tap on it, or a drag that starts on it, centres the camera on that
    map point (`minimapPoint(x, y)`, `minimapPointToWorld`) and gives no order; every accepted
    order's `RtsControls.feedback` goes to the picture; `stats()` (`MatchStats`: `trained`,
    `lost`, `slain`, `built`, `razed`, `gold`) counts the match from the kit's `rtsEvents` each
    tick (presentation: never in the snapshot).
  - `main.ts`: the DOM: the skin's PNG sheets decoded first (`withContentImages`, D7);
    `bootBrowserGame` with Canvas2D (`canvasDisplay` with the shell's
    `onSound`, so the skin's event sounds play), `pointer: true` and `touchPad: false`, `game` and
    `audio` (`contentSongs`, `contentSfx`, music `ford`; Engine 0.15 T14) with the shell's volume
    control and stored volumes (gap M1); Shift for additive selection; the bar under the picture
    (`#bar`: the status line, `#build-<building>`, `#train-<unit>`, `#stop`, `#heroes`,
    `#cancel`, `#export`); the end screen (`#end`, Engine 0.15 T14: `#end-title` "Victory: the far
    bank is yours" or "Defeat: your side has fallen", `#end-text` with the time, the tick and (D8)
    the match's stats, and `#again`,
    Play again, which reloads the page), opened once when `result()` is first set; the game keeps
    stepping under it, so Export still ends on a hash tick; and `window.wwSkirmish`
    (`SkirmishHook`: `tick`, `sides`, `units`, `buildings`, `selection`, `camera`, `clientAt(wx,
wy)` (world px to client px through the camera and the display's `toClient`, Engine 0.15 gap
    D13), `message`, `result`, (D8) `stats` and `minimapClientAt(wx, wy)` (where a world point
    is on the minimap, client px), `exportRun(game?)`) for the browser test. D8: the minimap's
    spec goes to `SkirmishPlay`. D9: `audio` takes the skin's `music` (`mix`) and the start seed
    (sound variation); the scene reports its game (`headless()`), so the step hook's `hash()`,
    `snapshot()` and `replay(run)` work; in manual-loop mode (`?debug=step`) one loop step is one
    game tick (`stepsPerTick: 1`), so a run file replays tick for tick; and the pointer's feel:
    an 8 px edge band (32 CSS px at 1920x1080) scrolling 6 px a step, 400 px of wheel per halving
    or doubling of the zoom.
- `skirmish.test.ts`: content (D8: the 64x40 map, its three fords and point symmetry, four unit
  types, the fog plan and the end rule), the units' numbers against the types, the hero, `sides`,
  determinism, the `fog` run's interface actions recorded as orders that replay to the same world,
  refusals, `sideKinds`, a sprite frame for every kind, state, facing and tile, the barracks' site
  looks, and the view matching the headless game; no look with its own fallback colour, every tick
  of every run drawn through Canvas2D without a fallback box (and with the page's additions: every
  thing selected, fog, the ghost, a box, markers), the song and an sfx for every sound the skin
  names, the `fog` run's sounds (the hero struck and fallen; blue's training heard only once in
  sight), the `razed` run's, `heardEvents`, the jingle and banner once for a forced end, the data
  end rule on views (won, lost by town centre, lost by units, both down is lost), a bark (voice,
  status, the HUD's line, gone after `BARK_TICKS`), and every run's golden hashes with the page's
  fog drawn on and off (D8: fog is presentation and AI knowledge only).
- `assets.test.ts` (D7): the credits (OpenGameArt source, Kenney, CC0, the licence file), only
  the four files kept, `ford-tiles.png` byte for byte what `tools/ford-tiles.ts` makes from the
  pack's sheet, the skin's `ford` frames equal to `FORD_FRAMES` and every `rts` frame one of the
  pack's own sprites in its atlas.

## Entity ids

1 terrain, 2 types, 3 red's town centre, 4 blue's town centre, 5-10 gold (5 `gold-west-north`, 6
`gold-west-south`, 7 `gold-east-north`, 8 `gold-east-south`, 9 `gold-north`, 10 `gold-south`),
11-13 red workers (`worker-1`..`worker-3`), 14-16 blue workers (`blue-worker-1`..`3`), 17 blue's
`sentry`, 18 the `guard` squad, 19 the hero (`hero`). New entities count on from 20 (in `razed`
red's barracks site is 20; in the other runs blue's first new worker is 20 and its barracks 22).
Orders name ids, so moving or adding an entity in the map changes the ids of everything after
it: re-record the run files (below).

## Run files

The 0.15 runs (`battle`, `commands`, `hold`, `economy`, `lost`) were removed in D8; they live on,
unchanged, in `games/rts-classic`. D8's runs are short guards of the AI and the interface; D9 added
the ten-minute win and loss.

| run           | ticks | what happens                                                                                                                                                                                                                                                                                                 | guards                         |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `opening`     | 200   | the opening economy: a box over red's workers sends them to the northern gold (5), a click on the town centre and Train worker; gold 200 to 270, four workers                                                                                                                                                | gathers, the three enemy rules |
| `ai-barracks` | 400   | no orders: blue gathers, its sentry scouts red's home box (19,17; 19,11; 13,11; 7,11; 7,17) and finds the town centre at 209, then rallies home; blue's barracks (22) is placed by 110 and done by 130; three soldiers by 400                                                                                | the three enemy rules          |
| `fog`         | 480   | the hero walks to 40,8, near blue's base but out of its sight: by 420 blue has three idle soldiers and has not attacked him; he steps into sight (46,17), a box there selects only him, he attacks soldier 17, `defend` fires at 439, he falls                                                               | all six but gathers            |
| `razed`       | 160   | a worker places a barracks site (20) on the scout's first cell (18,16) and stops; the sentry finds it at 69 and razes it at 80 (hp 1); blue forgets it and scouts on                                                                                                                                         | the three enemy rules          |
| `match-won`   | 5900  | D9, a reasonable player: the opening through the interface, nine workers, two barracks, soldiers and archers held at a rally point (13,19) that fight what comes within 14 cells, all three waves and the push beaten at home, the army over the centre ford at 5700, blue's town centre down at 5803 (9:40) | all six                        |
| `match-lost`  | 5700  | D9, a careless player: six workers, one barracks late (900), eight soldiers, the hero off to the far gold, the soldiers thrown at blue's town centre at 4600; the push takes red's town centre at 5681 (9:28) with seven units still standing                                                                | all six                        |

- Every run file carries its sync `hashes` (every 20 ticks; every 100 for the two matches, D9) and
  has golden `<name>.hashes.json`; final hashes (D9, after the balance moved every one: the
  types, the map's gold and the plan's steps are in the world and the kit's snapshot):
  `opening` `5f5724b4b03cbf28`, `ai-barracks` `19b073e4e362ab13`, `fog` `606269cfac74a8bb`,
  `razed` `bf1f52ad343cbbe3`, `match-won` `b55be4ea560a4f79`, `match-lost` `02facfba6cc041cc`.
  D8's were `opening` `ba3cccd15c1aa5de`, `ai-barracks` `c5f146d0b4836da5`, `fog`
  `82fc61891e2e80b8`, `razed` `3c8ae6c8450507ff`; every assertion of the four held. Removed with the 0.15 map: `battle`
  `588fe33bb3ecfcfd`, `commands` `9f8fc0dc11549b95`, `hold` `dcf2c02f2cb6d266`, `economy`
  `34bf04d6b067075d`, `lost` `2cc7b6a08b67cdfd` (the same files and hashes are rts-classic's).
- Checks read `sides.<faction>.*`, `kit.enemy.<step>.fired` / `.last` (the plan's progress),
  `kit.seen.buildings` (what the AI remembers), `ui.selection` and keyed world paths
  (`world.key.hero.Target.entity`, `world.key.sentry.Task.goal`, `world.id.20.Health.hp` for one
  made in play); `dump` and `trace` show the rest.
- `pnpm -s cli mutants games/samples/rts-skirmish --json` exits 0 with all six kit rules guarded
  and no run weak; `tests/runs/rts-skirmish-mutants.test.ts` holds the sample to that (the kit is
  not strict). A switched-off rule usually changes a sync hash first, which stops the run without
  counting as a failed check, so every guard has an assertion that fails before tick 20: at tick
  1 `kit.enemy.gold.fired` 1 (`enemy-follows-plan`), `kit.enemy.barracks.fired` 0 (its `when`
  needs 5 workers; `enemy-waits-for-trigger`) and `kit.enemy.scout.fired` 1 (it scouts only while
  it knows no red building, and with the whole view it knows them all:
  `enemy-knows-only-what-it-saw`), `world.key.worker-1.Gatherer.node` 5 in `opening`
  (`command-gathers-resources`), and in `fog` `ui.selection` `[19]` and the hero's `Target` 17 at
  tick 431 (`box-selects-own-units`, `command-attacks-enemies`; nothing changed before 430). The
  two matches (D9) open with interface actions that fail every rule by tick 2: at tick 0 a box
  over the workers, a command on the northern gold, a click on the hero and a command on the
  sentry (17, across the map), then a drag over the sentry (it selects none of blue's: `ui.selection`
  `[]` at tick 1), at tick 1 a click on the town centre and Train worker (`[3]` at tick 2); so a
  switched-off rule stops them within two ticks and only their baselines play the whole match
  (`mutants` on the game takes about 25 s alone).
- **Recording the matches** (D9): a throwaway headless bot (not kept) played the game through
  `SkirmishGame.order` (the opening as interface actions, then recorded orders every 10 ticks:
  idle workers to the nearest gold, workers and barracks while they can be paid for, soldiers and
  archers two to one, the army's defence and attack); its entries are the run's `orders`, its
  assertions read off `trace` at 1800, 2400, 3600 and 4800 (red's buildings and units, the three
  waves' `fired`) and around the end (the town centre's last hp, the side without it), and
  `sides.<own>.buildings.town-centre` 1 every 600 ticks in place of an invariant (an invariant
  takes the snapshot every tick, which doubled the run's time). A passive player (no orders)
  loses at 2025, every unit killed by the first wave.
- Recording a run: write its `orders` as interface actions (world px, as the page gives them),
  read the values off `pnpm -s cli trace <run> --paths ... --every n --json` or `dump`, write the
  assertions, copy the run's `hashes` from `run --json`, then `WW_UPDATE_GOLDEN=1 pnpm test
tests/runs/run-files.test.ts`.

## The ten-minute match (D9)

- **Balance, data only**: the AI's plan (bigger caps, three one-shot waves of growing size, the
  push at 9 minutes), the town centre (1600 hp, 300 gold) and the gold (1000 at home, 2400 on the
  far node, so the far bank's node is worth expanding to); no code. A reasonable player wins in
  about 9.7 minutes (`match-won`), a careless one loses in about 9.5 (`match-lost`), a passive
  one in 3.4.
- **Long runs in the tests**: the two matches play whole in `pnpm cli run`, the run-file tests and
  `mutants`; the presentation tests (`skirmish.test.ts`'s drawing and fog tests, backend parity,
  presentation invariance, the stepped shell, `rts-fog.test.ts`) play their first 600 ticks
  (`tests/runs/view-play.ts`: `presentedRun`, runs of 5000 ticks or more), with the golden hashes
  up to there. `pixi-parity.test.ts` draws `match-won` at 1920 and 1940 (the first wave on red's
  ground) on both 2D backends.
- **The sim got faster for it** (no hash moved): `World.peek()` (the snapshot without copies,
  for the kit's view), `readWorld` parsing each frozen component value once, the attack system
  reading its candidate targets once a tick, and `pnpm cli run` taking a snapshot only on a tick
  something reads it. The win plays in about 9 s headless here.
- **The browser test** (`tests/browser/rts-skirmish.test.ts`) starts from the games index and the
  title (Start), plays the opening by mouse and touch, exports and replays it, then replays
  `match-won` through a fresh page's step hook (its hashes the golden file's every 100 ticks, the
  one refused order the CLI refuses too) to the end screen, and its export replays headless with
  no hash mismatch.

## Playing in the browser

`pnpm dev`, then `games/samples/rts-skirmish/` from the launcher (or `pnpm build && pnpm
preview`). The picture is 480x270 over a 1024x640 map; the bar under it holds the buttons.

- **Mouse**: left click selects one thing (own unit first, else any unit, else a building; empty
  ground clears), a left drag boxes your units, Shift adds to the selection, right click
  commands (an enemy: attack; gold with workers selected: gather; else move). The wheel zooms
  (0.5 to 2, about the cursor), a middle drag pans, and the cursor at the picture's edge scrolls.
  A click on the minimap (bottom right) moves the view there; dragging on it follows.
- **Touch**: a tap selects, a one-finger drag boxes, a long-press (half a second) commands, two
  fingers pan and pinch-zoom; a tap on the minimap moves the view. There is no on-screen pad.
- **Bar**: with workers selected, `Build <building>`, then click (tap) the north-west cell to
  place it (right click or `Cancel` stops placing); with a finished building selected, `Train
<unit>` queues one (the town centre trains workers, the barracks soldiers and archers); `Stop`;
  `Hero` selects Wren alone. The status line shows the tick, the result once the match is over and
  the last refused order's reason (not enough gold, a blocked site).
- **Feedback**: an accepted order shows a marker where it lands (move, attack, gather, build;
  fading over 8 ticks), selected units show their path, the unit barks (a short sound and a line
  at the bottom left), and a training building shows its progress bar under it.
- **Fog**: you see what your units and buildings see now; explored ground stays half dark, and
  blue's buildings stay where you last saw them. Blue's AI knows only what its side has seen too.
- **Sound**: the song starts with the first click, tap or key; a danger layer comes in while an
  enemy you can see is within 8 cells of one of your buildings; the shell's mute button and volume
  slider (top right) keep the player's volumes in this browser.
- **The end**: raze blue's town centre (57,19, across the centre ford) to win; lose your town
  centre or every unit and it is over. The picture shows the banner, the jingle plays and the end
  screen opens with the time, the stats and Play again.
- An opening: box the three workers (just east of the town centre), build a barracks east of
  them, send one to the southern gold and the rest to the northern gold, train soldiers and
  archers; blue's scout comes over the river within half a minute, its waves from about three,
  five and seven minutes, and everything it has from nine. Hold the waves at home, then cross the
  centre ford with the army before the push.

## Exporting and replaying a battle

`Export` downloads the battle so far as `skirmish-t<tick>.run.json` (ending at the last tick that
is a multiple of 20, with the orders before it and the page's sync hashes, every 20 ticks). Save
it in `runs/` (its `game` is `..`) and replay it headless:
`pnpm -s cli run games/samples/rts-skirmish/runs/skirmish-t140.run.json --json` passes with
`hashesChecked` equal to the file's hashes and no `hashMismatch`. Any `hashMismatch` means the
page and the headless game played differently. Add assertions (from `dump`) and a golden
`.hashes.json` before keeping one as a run file of the game. A script reads the same with
`await window.wwSkirmish.exportRun()`.

## How to test

`pnpm test games/samples/rts-skirmish`, `pnpm -s cli validate games/samples/rts-skirmish --json`,
`pnpm -s cli run games/samples/rts-skirmish/runs/fog.run.json --json` (any run file),
`pnpm -s cli mutants games/samples/rts-skirmish --json`, `pnpm test tests/runs` (golden hashes;
backend parity plays every run through the view's `frame()` into the null backend and `render`
into Canvas2D; `rts-fog.test.ts` with the kit's fog off and on), `pnpm -s cli screenshot
games/samples/rts-skirmish/runs/fog.run.json --tick 444 --json` (the map's centre under fog, the
minimap showing what red has explored; `matchesHeadless` true; `--scale 4` gives 1920x1080).
`tests/browser/pixi-parity.test.ts` draws the `fog` run's ticks on Canvas2D and PixiJS and holds
them to the strict bound. `play.test.ts`: the recorder hashes as `run` does and gives
`fog.run.json`'s hashes for its interface actions; the page's picture is fogged; a tap on the
minimap moves the camera and gives no order; `SkirmishPlay` driven by scripted gestures and
buttons builds, trains and moves with markers, barks, the train bar, path dots and stats, and its
export replays to its hashes. The page itself: `pnpm vitest run tests/browser/rts-skirmish.test.ts`
(headless Chromium: the games index lists it as The River Ford and its link opens it, the volume
control, the opening by mouse and touch, a minimap click, the export replayed with `pnpm -s cli
run`; skipped where Chromium is missing). `tests/build/pages.test.ts` checks the launcher and the
build inputs list the page.

## Title screen, pause menu and settings (Engine 0.16 T9)

`game.json`'s `menus` block (the shell's menus, `engine/core/shell/CLAUDE.md`; schema in
`engine/core/ui/menus.ts`): the title "The River Ford" in `ford-title` over the game's own
picture at its start (dimmed 0.6), the subtitle "Take the far bank of the river" (D8), art (from D7 the pack's `hero-red` x3 and `worker-red` x2 on the left, `soldier-blue` x3 and x2 on the right),
the song `ford`, a footer and the items start, controls, settings; the pause menu
(resume, controls, settings, title); settings (master, music, sfx, mute, shake, flashing); and the controls screen's
rows (Select; Select many; Command; Pan; Zoom; from D8 Jump: the minimap), shown with the player's keys. Colours: focus bar `#004058`,
headings `#fcbc3c`. Fonts: `content/fonts/ford-small.txt` (the menu font: the fx lab's small font, original 5 px glyphs with A-Z, a-z, 0-9, punctuation and, for key names, the four arrows) and `ford-title.txt` (its title font: the small glyphs made bold and doubled with Scale2x, cell 12x18), made by a small generator; edit them by hand now. Claimed as `font` in `game.json`. The `ui-move`, `ui-select` and `ui-back` sfx are the menus' sounds.

`main.ts` passes `menus: { spec: content.manifest.menus, fonts, sheets }` to `bootBrowserGame`
and the fonts to the display. Back to title reloads the page (`restart: 'reload'`: its bar and `window` hook hold the first scene). `index.html` hides the page's bar on the title (`body[data-menu='title']`). The page opens on the title (the game waits
at tick 0 under it); Escape, P, gamepad Start or the `II` button pause (the ticks are held).
`?debug=step` and `?record` skip the title, so run files, replays and the older browser tests
are unchanged; `?debug=step&title=show` shows it. Tested in `tests/browser/menus.test.ts` (title,
start, pause, settings and controls by keyboard and touch, settings kept across a reload;
`WW_SHOTS_DIR=<folder>` keeps `menus-<game>-*.png`), tuned from those screenshots at page scale.

## Imports

- Allowed: relative paths inside this folder, `@engine/core/*`, `@engine/sim/*` (the glue
  builds the world), `@engine/backends/*` and `@kits/rts`.
- Never: other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.

## 2D backend choice

The page draws through the PixiJS (WebGL) backend by default (`default2d: 'pixi'` in `main.ts`,
Engine 0.16 T13b-8; `@engine/backends/pixi`, loaded with a dynamic `import()`, its own chunk) and
falls back to Canvas2D where WebGL is missing (`body[data-backend]` says which runs; software
WebGL, such as headless Chromium's SwiftShader, counts as WebGL). `?backend=canvas2d` forces
Canvas2D (exact Canvas2D output, a machine whose WebGL misbehaves); `?backend=pixi` names the
default. `pnpm cli screenshot` and the run files' backend parity still draw through Canvas2D
(`view.ts`). Tested in `tests/browser/pixi-pages.test.ts` (the default, the fallback with WebGL
taken away, `?backend=canvas2d`); the page and menus browser tests play on PixiJS.

## The CC0 art pack and the 16:9 skin (Engine 0.16 part D, D7)

- **The pack**: Kenney's "RTS Pack: Medieval" (CC0), fetched from its OpenGameArt mirror
  (`https://opengameart.org/content/medieval-rts-120`; kenney.nl blocks automated downloads).
  Only the files used are kept in `assets/kenney-medieval-rts/` (the 550x550 sheet, its atlas as
  text, the licence, and the made `ford-tiles.png`); `assets/CREDITS.md` names the source URL,
  the author and the licence, and `validate` checks it.
- **Scale**: the pack's ground tiles are 64 px and its units about 16x24, while the map's cells
  are 16 px (the kit's `RTS_TILE_SIZE`; changing it would move the interface actions' world
  pixels). So units and buildings are the pack's sprites at their own size, standing on their
  cell's or footprint's bottom centre (a unit pokes 8-9 px above its cell, a building up to 6 px
  past its footprint's sides), and the ground is made for 16 px by `tools/ford-tiles.ts`.
- **The picture** is 480x270 (16:9; 4x is 1920x1080), which shows 30x16.9 cells; the HUD banner
  is centred at 160,111, the minimap sits in the bottom-right corner and the title's art was moved
  out to the sides. The page's camera starts on the base (`play.test.ts`: top-left 0,177 on the
  D8 map).
- **Tuning**: from `pnpm -s cli screenshot <run> --tick <n> --scale 4 --out <file>` and the menus browser test's shots (`WW_SHOTS_DIR`), at page scale.
- To change the ground: edit `tools/ford-tiles.ts`, run it, and keep the skin's `images.ford`
  frames equal to `FORD_FRAMES` (`assets.test.ts`).
