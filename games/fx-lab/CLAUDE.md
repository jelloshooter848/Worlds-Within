# games/fx-lab

The fx lab (Engine 0.16 part A, T2): a small game on the platformer kit that shows every
presentation feature of 0.16 part A, one task at a time (T2 adds it with sprite animation states,
per-frame timing, one-shots and frame events; T3 adds particle emitters, additive blending and
glow; T4 adds camera effects and parallax; T5 screen transitions; T6 the UI kit's HUD; T7 a menu and a dialog box; later tasks add audio...). It is a lab, **not a sample**:
three short original levels with stomps,
coins and a door so that events happen, Pip (an original courier) with a full animation set, a 2D
skin and a low-poly 3D skin, run files with golden hashes and a browser page. Content and glue
only: nothing in `engine/` or `kits/` depends on it, and every rule is the platformer kit's.

## Files

- `game.json`: the manifest (kit `platformer`, 256x240, seed 1, `headless.ts`, `view.ts`) and,
  from Engine 0.16 T5, its screen `transitions`: `level` an iris (28 frames each way, `cubicIn`, a
  hold of 8) closing on Pip at the door and opening on him in the next level, `scene` a 12-frame
  fade and `default` a 16-frame fade with a hold of 4 (what `__ww.transition()` plays).
- `content/levels/fx-1.json` + `.map.txt` ("first steps": three coins on the ground, a one-way
  platform with two coins above it, a `?` block, two beetles, a pit, the door) and `fx-2`
  ("over the spikes": a floating ledge, coins on a high platform, a spike strip, a brick row with
  a `?` block, three beetles, the door). 15 rows, so the ground is the picture's bottom row. Map
  format: `kits/platformer/CLAUDE.md`. The goal `G` is drawn as a door (`goal` kind, 16x32).
  `fx-3` ("torchlight", Engine 0.16 T3): four torches (`t`, the `torch` actor), a platform
  with three coins, a higher one with three more over a pit, two beetles, the door.
- `content/campaigns/main.campaign.json`: the play order, `fx-1`, `fx-2`, then `fx-3`. The
  levels' headers name them (Engine 0.16 part B): "First steps", "Over the spikes", "Torchlight".
- The level select, level-clear banner, end screen and respawn transition (Engine 0.16 part B,
  T3; the engine's worked example before the flagship uses them): `game.json`'s title has a
  `levels` item, `menus.levels` ("Pick a level", `*` after a cleared one, later levels locked
  until the one before is cleared), `menus.clear` ("Level clear!": coins, time, deaths, shown
  over the door during the kit's pause), `menus.end` ("Lab complete!", a credits line, the summed
  stats, Back to title and Levels, after `fx-3`) and `transitions.respawn` (an 18-frame iris on
  Pip with a hold of 6). `main.ts` passes `levels: stageNames(fxStages(content))` and creates the
  game at `booted.start` (the chosen stage). `tests/browser/menus.test.ts` plays them by
  keyboard, gamepad and touch; `pnpm -s cli screenshot runs/level-1.run.json --tick 360
--overlay clear --scale 6` shoots the banner.
- `content/profiles/pip.profile.json`: SMBC-style runner numbers (a copy of the platformer
  sample's) with two actor types, `beetle` (a slow walker, stompable) and `torch` (Engine 0.16 T3: stands
  still, harmless, not stompable; scenery for the particle presets).
- `content/sprites/fx.txt` (palette `content/palettes/fx.json`): original NES-style text pixel art.
  Pip is 16x16 drawn over the 12x16 body (`size` and `offset` in the skin): `pip-idle-0/1`,
  `pip-blink`, `pip-settle` (a landing squat), `pip-walk-0..3`, `pip-run-0..3`, `pip-skid`,
  `pip-jump-0` (stretch), `pip-jump-1` (tuck), `pip-fall-0/1` (arms up), `pip-hurt-0/1` (the
  second a white flash), `pip-dead-0..2` (a tumble). Also `beetle-0/1/flat/dead`, `coin-0..3`
  (a spin), `door`, `door-glow`, `door-lit` (16x32), `torch` (a brazier on a pole) and `sparkle`
  (5x5, a particle sprite), the tiles and HUD icons, and (Engine 0.16 T6) `hud-panel` (9x9, a
  teal panel with a black rim, sliced 2) and `bar-frame` (5x5, the health bar's grey frame).
- `content/fonts/fx-small.txt` and `fx-title.txt` (Engine 0.16 T6, the `font` kind,
  `engine/core/ui/CLAUDE.md`): original fonts covering A-Z, a-z, 0-9 and punctuation
  (`.,!?:;-+=/'"()[]%*#&_<>$@`). `fx-small` is 5 px wide (I, f, i, j, l, r, t and some
  punctuation narrower), caps 7 px on the baseline, lower case with 2 px descenders, cell 5x9,
  spacing 1, kerning for `LT`, `TA`, `AT`, `Te`, `To`, `Ty`, `Va`, `Yo`; `fx-title` is the same
  glyphs doubled with the Scale2x rule (diagonal steps smoothed), cell 10x18, for headings with
  an outline. Both were written by a small generator (the glyph table, then Scale2x); edit the
  text by hand now. The old `fx-font.txt` sprite digits are gone.
  `content/sprites/fx-sky.txt` (palette `content/palettes/fx-sky.json`, Engine 0.16 T4): the
  parallax sky, 128 px wide frames that repeat without a seam: `clouds` (128x28), `mountains`
  (128x80, snow-capped, lit from the left) and `hills` (128x56, outlined, with bushes). Drawn with
  a small generator (periodic peaks, cloud blobs and domes); edit the text by hand now.
- `content/sfx/*.json`: original MML sfx (`footstep`, `jump`, `land`, `coin`, `stomp`, `bump`,
  `hurt`, `fail`, `door`, `whoosh`, and from T7 the UI's `ui-move`, `ui-select`, `ui-back`,
  `ui-type`). No song yet (the audio mixer is T8).
- `content/ui/lab.json` (Engine 0.16 T7, the `ui` kind, `engine/core/ui/CLAUDE.md`): the UI
  kit's worked example. A style (`fx-small`, a black shadow, gold focus, the `hud-panel` frame
  sliced 2, a `>` cursor, the four UI sounds, a focus tween that slides in with `backOut` and a
  press tween that dips and flashes), a dimming panel (black at 0.5), a framed panel holding
  `Paused` in `fx-title`, and the `main` menu (no panel of its own): Resume, Talk to Pip (opens
  `talk`), a Volume slider (0-10, 7), a Screen shake toggle, a disabled Credits, Back to title.
  `talk` is a hidden dialog at the bottom, 58 px high: the speaker `Pip`, his `pip-idle-0`
  portrait (scaled 2x in its frame), three pages (the first two wrap to two lines) typed at 2
  frames a character, and the choice `Let's go!` / `Not yet` (back to `main`). Tuned by
  screenshots at page scale (the panel covers the HUD's heading).
- `content/skins/canvas2d.json`: the 2D skin, the worked example of Engine 0.16 T2's animation
  format (`engine/core/present/CLAUDE.md`):
  - `runner`: every `RUNNER_ANIMS` state. `idle` is a one-shot (`pip-settle` then `pip-idle-0`,
    `ticks: [5, 1]`, `loop: false`) whose `then` is `breathe`, a state the kit never sends: a
    six-frame loop with per-frame ticks (a breath, a blink). `walk` and `run` are four-frame
    cycles with per-frame ticks and frame events `{ "0": "footstep", "2": "footstep" }`; `skid` a
    frame event `skid-dust`; `jump` a one-shot (stretch, then tuck held); `fall` a loop; `hurt` a
    one-shot flash; `dead` a one-shot tumble with a `tumble` frame event.
  - `beetle` (a `scuttle` frame event with no sound or effect: a silent marker), `coin` (a spin
    with per-frame ticks), `goal` (the door, glowing now and then), `bump-block`.
  - `events`: the frame events (`footstep`: a sound and a puff of dust; `skid-dust`; `tumble`)
    next to the kit's (`jump` and `land` with a squash tween, `coin`, `stomp`, `hurt`, `died`,
    `cleared` the door's sound). A frame event runs through `events` exactly like a kit event.
  - `hud` (Engine 0.16 T6, the UI kit's worked example): a `panel` (`hud-panel`, slice 2) behind
    `Pip` (text in `fx-small`, white with a black shadow), a health `bar` (`hp` of `maxHp`, green,
    red at a third or less, framed by the nine-slice `bar-frame`), a coin `counter` (the
    `hud-coin` icon and two gold digits rolling to a new count over 24 frames, white while
    rolling), a lives `counter` (`hud-life`, `x{value}`); a second panel at the top right holding a
    `minimap` (2 px per tile: ground, platforms, blocks; dots for Pip, coins, beetles and the
    door); the heading `The Fx Lab` in `fx-title` with a black outline and a lower-case line under
    it (`Stomp beetles, grab coins & find the door!`). The same `hud` is in `three.json`. Tuned by
    screenshots at 1x and at page scale in both backends. And `camera` (follow the runner, 32x48 deadzone, lerp 0.25,
    from T4 `lookAhead` 24 px in the facing direction, gliding at 0.08).
  - Camera effects (Engine 0.16 T4): `stomp` shakes (`{ amount: 3, ticks: 14 }`) and asks for a
    4-frame `hitPause`; `hurt` flashes red (`#d82800` at 0.6 over 8 frames; the old flash
    effect is gone); `died` shakes harder; `cleared` (the door) punches the zoom to 1.5 about Pip
    (12 frames in, cubicOut, held 30, 18 back) beside its old gold tint.
  - `parallax` (Engine 0.16 T4), back to front: a 12-band gradient sky (factor 0), `clouds`
    (factor x 0.1, y 24), `mountains` (x 0.25, y 0.05, y 116) and `hills` (x 0.5, y 0.1, y 172)
    from `fx-sky`, with 3D `depth`s 900, 600 and 300. The skin's `background` stays the clear
    colour under it.
  - `emitters` (Engine 0.16 T3), the six presets and their helpers: `land-dust` (the `land`
    event, at the feet: a sideways puff that slows and fades), `run-dust` (the `footstep` frame
    event: two rising puffs; `skid-dust` uses it and `land-dust`), `stomp-sparks` and `stomp-ring`
    (the `stomp` event: gold sparks thrown up under gravity with a glow, and an additive white
    ring), `torch-smoke` and `torch-flame` (the `torch` kind's `emit`: a slow grey column and a
    flickering glowing flame), `coin-burst` and `coin-glint` (the `coin` event: gold sparks and
    additive `sparkle` sprites drifting up) and `magic-aura` (the `goal` kind's `emit`: cyan motes
    rising round the door). `torch`, `goal` and `coin` also take a 2D `glow`. Tuned by screenshots
    in 2D and 3D: on this light sky, `add` is kept for small bright accents (the ring, the
    sparkles); flames and motes use normal blending with a glow so they read.
- `content/skins/three.json`: the 3D skin. Low-poly compound `meshes` for every pose of Pip
  (`pip-stand`, `pip-walk-a/b/c`, `pip-run-a/b`, `pip-crouch`, `pip-rise`, `pip-fall-a/b`,
  `pip-hurt`, `pip-down`, ...), the beetle, the coin and the door; `kinds` with `mesh` (the rest
  pose) and `poses` (Engine 0.16 T2: the same states as the 2D `frames`, with mesh names, the same
  timing, `then` and frame events), so the 3D scene swaps meshes by animation frame and plays the
  same footsteps. The same `emitters` without `glow` and `frame` (the glint is a gold square in
  3D), a low-poly `torch` mesh and the same `emit`s, and the same camera effects, look-ahead and
  `parallax` (3D cuts the frames from the decoded sheets and hangs them on planes behind the blocks). `camera3d` `layerDepth` 0.25 (the kit's layers stay near the blocks' plane).
- TypeScript is glue only:
  - `content.ts`: `loadFxLab(files)`, `mustLoadFxLab(files)`, `fxStages(content)` (the kit's
    `contentStages`), `fxSkin(content, backend)`.
  - `headless.ts`: `createGame(content, seed, opts?)` (the kit's `LevelSequence`), `starts`.
  - `picture.ts`: `fxLook` (from T6 with `fonts`, `contentFonts(content)`), `fxFrames`, `fxPicture`, `fxCanvasPicture(r, look, onSound?)`;
    `picture3d.ts`: `fxLook3d` (no Three.js import; with `fonts` from T6). `view.ts`: `createView` (the engine's
    `frameView`), for `pnpm cli screenshot`.
  - `main.ts`: `bootBrowserGame` with both displays and the sfx, each display given the shell's
    `hitPause` as `onHitPause` (Engine 0.16 T4) and `content.manifest.transitions` as
    `transitions` (T5); every sound id the page plays is
    also pushed to `window.wwFxLab.sounds` (for `tests/browser/fx-lab.test.ts`).
  - The mixer (Engine 0.16 T8): `content/songs/lab-calm.json` and `lab-danger.json` (132 bpm,
    768 ticks, looping: the layers must stay in step) are the layers of the canvas2d skin's
    `music.lab`; its rules play danger at 1 and calm at 0.3 (a 12-tick fade) while the kit's
    `nearestActor` status is 0..71 px, else calm alone (the entry's 30-tick fade). `main.ts` boots
    with `songs`, `mix: look.skin.music`, `music: 'lab'` and the start seed, on both backends (the
    3D skin has no `music` of its own). Both skins: `footstep` varies `pitch [-2, 1.5]`, `volume
[0.6, 1]` with `cooldown` 4, `jump` `pitch [-1, 1]`, `volume [0.8, 1]`; `stomp` and `hurt`
    duck the music. The UI's sounds go to `page.uiSound` (the ui bus) and the dialog ducks the
    music. `tests/browser/fx-lab-mix.test.ts` records `__ww.mix()` over `level-1`.
  - `ui.ts` (Engine 0.16 T7): `fxUiFile(content, name?)`, `sheetFrameSize(sheets)` (a
    `UiFrameSize` from the sheet lookup) and `fxUiScreen(content, { sheets, fonts, onSound?,
open? })`, the `lab` screen with the menu focused, or with `open: 'dialog'` the dialog alone.
  - `main.ts` also (T7) boots with `pointer: true` (taps and hover in picture pixels) and plays
    the level through `FxLabScene` (a `HostScene` whose start key, Enter, pushes
    the lab's `UiScene` over the level in 2D: the game waits under it). Resume, Back to title,
    `back` on the menu and `Let's go!` pop it (the game's title and pause menu are the shell's, T9, below); so does any end that
    leaves no widget focused. `?ui=menu` / `?ui=dialog` opens one at load; `window.wwFxLab.ui`
    is `{ open(which?), screen(), events }` for the browser test. The lab's menu uses `CanvasUiPainter`, so in 3D the start key does nothing (the shell's menus, below, draw in both backends). From T9 Escape and pad Start pause through the shell instead.
  - `index.html`: the page (2D/3D toggle, the launcher's 3D link).
- `runs/level-1.run.json` (fx-1 from the start: three coins, two from the platform, both beetles
  stomped, the pit jumped, the door at tick ~345) and `runs/level-2.run.json` (`start: { stage: 1
}`: a stomp, the spikes jumped, a second stomp, a beetle's hit, the door), each with golden
  `*.hashes.json`. `runs/level-3.run.json` (`start: { stage: 2 }`, Engine 0.16 T3): onto the
  first platform (three coins), down, a running jump to the second (three more) over the pit, a
  hop over the last beetle, the door at tick ~327: lands, dust, coins, torches and the door's aura
  for screenshots.
- `fx-lab.test.ts`: the level order, Pip's states in both skins, the idle one-shot's `then`, and
  each run played through a Canvas2D picture and a 3D scene with `onSound`: footsteps (frame
  events) and the kit's sounds are heard, and drawing never changes the snapshot; the six particle
  presets are in both skins where the lab says, and level-3 played through the 3D scene shows
  them without changing the snapshot; from T4 the camera effects and the four parallax layers are
  in both skins, level-1's two stomps ask the 2D picture's `onHitPause` for 4 frames each and the
  3D scene zooms on the door, never touching the state. From T5 `tests/browser/fx-lab.test.ts` also
  plays level-1 to the level change in each backend with `?debug=step` and shoots the iris
  mid-close, covered and mid-open, then a wipe and the default fade on demand
  (`__ww.transition`), reading the black share and the sides of each picture
  (`WW_SHOTS_DIR=<folder>` keeps the shots to look at). From T6 `fx-lab.test.ts` checks both fonts
  cover A-Z, a-z, 0-9 and the punctuation, both skins have a bar, counter, minimap, panel and
  text, and level-1 played through the 3D scene shows panel pieces, fills and glyphs (never a
  missing frame's box) without changing the snapshot. From T7 `tests/browser/fx-lab-ui.test.ts`
  operates the 2D page's menu and dialog with the keyboard (Enter, arrows, a slider, Z to skip),
  the mouse (a click on the toggle, hover and a click on Talk) and, on a touch page
  (`?ui=dialog`, `hasTouch`), taps that skip, turn pages and take a choice; it shoots the menu,
  the dialog and the choice (`fx-lab-ui-*.png`, kept with `WW_SHOTS_DIR`).

## Making the art

The pixel art was drawn with a small generator (rows composed from shared head, body and leg
parts) and checked with `pnpm cli screenshot` at ticks mid-walk, mid-run, rising, falling, landing,
stomping and hurt. Edit `content/sprites/fx.txt` by hand now: one character per pixel, legend at
the top. Keep each frame's rows the same length.

## The PNG sheet (Engine 0.16 T10)

`assets/fx-lab-png/torch.png` is the lab's worked example of a PNG sprite sheet in a skin (the
only binary file the lab has; `tests/architecture/no-content.test.ts` allows binary files only in
a game's `assets/`). It is original: `tools/torch-sheet.ts` draws it from code (the text sprite
`torch`'s brazier and a swaying, flickering flame from integer tables) and writes it with the
engine's deterministic `encodePng`. Rerun `pnpm exec tsx games/fx-lab/tools/torch-sheet.ts` after
changing the script; `fx-lab.test.ts` fails while the committed file differs. It is 72 x 52: four
16 x 24 flame frames on a grid (margin 1, spacing 2) and the unlit torch at (1, 27). The 2D skin
names it in `images` as `lab-torch` (`names` `torch-0..3`, the named frame `torch-unlit`, anchor
`bottom`, so the 24-px frame stands on the 16-px box and the flame rises 8 px above it); the
`torch` kind cycles `torch-0..3` (ticks 6, 5, 7, 5), keeping its glow and emitters. The 3D skin
keeps its low-poly torch mesh (from T11 the stand-in for its glTF model). `assets/CREDITS.md` credits the pack (own work, CC0); `validate`
checks it, the file and every frame. The page awaits `withContentImages` before it boots, so the
image is there for the first frame. Screenshot: `level-3 --tick 40` (the first torch, by Pip).

## The glTF model (Engine 0.16 T11)

`assets/fx-lab-glb/brazier.glb` is the lab's worked example of a glTF model in a 3D skin. It is
original: `tools/brazier-model.ts` builds it from seven flat-shaded parts with the engine's
`lowPolyModel` (a foot, a pole, a bowl widening upward, a grey rim, glowing coals, a gold flame
diamond and its pale core) and one clip, `flicker` (0.6 s: the flame squashes and stretches and
the core turns), and writes it with `encodeGlb`. About one unit tall, the foot's bottom at y = 0.
Rerun `pnpm exec tsx games/fx-lab/tools/brazier-model.ts` after changing the script;
`fx-lab.test.ts` fails while the committed file differs. The 3D skin's `torch` kind names it
(`model`, `scale` 18 so it stands about 19 px tall on the 16 x 16 box, `anchor` `bottom`,
`rotate` `{ y: 30 }` so the bowl shows its corners, `clip` `{ idle: flicker }`, `castShadow`)
and keeps its low-poly `torch` text mesh as the stand-in while the model loads; the `torch-flame`
and `torch-smoke` emitters sit higher in the 3D skin (offsets -1 and -6 from the box's top) so
they rise from the model's flame. `assets/CREDITS.md` credits the `fx-lab-glb` pack (own work,
CC0). The page (`main.ts`) makes a `ModelLibrary` from `content.assets` and awaits `preload`
before the 3D display starts, as the screenshot page does. Screenshot: `level-3 --tick 40
--backend three --allow-software-gl` (the first torch, by Pip).

## Lighting, shadows, fog and labels (Engine 0.16 T12)

The 3D skin opts in to the 3D backend's scene look (`engine/backends/three/CLAUDE.md`): a warm
`scene3d.sun` from up, left and a little in front (`direction` -1.6, 2.4, 1.2) with soft shadows
(1024 map, radius 2), a cool ambient and a sky/earth `hemisphere`, `linear` fog in the sky's pale
blue from 100 to 1400 px behind the blocks (so the parallax hills, mountains and clouds fade with
distance) and ACES tone mapping at exposure 1.3. Every tile and Pip, the beetles, coins, door and
`?` blocks cast shadows (coins and Pip shade the floating slabs, beetles the ground); tiles, Pip,
the door and bump blocks receive them. Each `torch` carries a warm flickering point `light`
(`#ffa040`, 40 over 96 px, at the flame, flicker 0.3). `labels`: Pip's name in `fx-small` with a
black outline under a health bar (`status.hp` of `maxHp`, bordered), and `EXIT` in gold over the
door, 6 px above their boxes. Screenshots inspected: `level-3 --tick 60, 120, 200, 300 --backend
three --allow-software-gl` (torch glow, coin and Pip shadows on the slab, the beetle's on the
ground, fogged mountains, the labels).

## Run and test

```sh
pnpm -s cli validate games/fx-lab --json
pnpm -s cli run games/fx-lab/runs/level-1.run.json --json     # also level-2, level-3
pnpm -s cli screenshot games/fx-lab/runs/level-1.run.json --tick 242 --json   # Pip mid-run
pnpm -s cli screenshot games/fx-lab/runs/level-1.run.json --tick 242 --backend three --allow-software-gl --json
# particle presets: level-1 --tick 154 (land dust), 247 (run dust), 219 (stomp sparks);
# level-3 --tick 120 (coin burst), 305 (torch, door aura), 40 (the PNG torch, T10; with
# --backend three the glTF brazier, T11)
# camera effects (T4): level-1 --tick 216 (stomp shake), 352 (door zoom); level-2 --tick 279
# (hurt flash); parallax at two camera positions: level-1 --tick 120 and 260
# the HUD (T6): level-1 --tick 300 (counter, minimap), level-2 --tick 300 (half a health bar)
pnpm test games/fx-lab tests/runs tests/browser/fx-lab.test.ts tests/browser/fx-lab-ui.test.ts
pnpm dev   # then open /games/fx-lab/ (arrows move, Z jumps, X runs, Enter pauses; ?ui=dialog; ?backend=three for 3D)
```

The lab's run files are also played by `tests/runs/presentation-invariance.test.ts` with every
effect switched on. The kit is strict, but the lab is not a kit test: `pnpm cli mutants` is not
expected to pass here (`games/platformer-lab` guards the kit's rules).

## Title screen, pause menu and settings (Engine 0.16 T9)

`game.json`'s `menus` block (the shell's menus, `engine/core/shell/CLAUDE.md`; schema in
`engine/core/ui/menus.ts`): the title "The fx lab" in `fx-title` over the game's own
picture at its start (dimmed 0.95, from Engine 0.16 T14: at 0.88 the HUD heading showed through the subtitle on the effects sheet), the subtitle "Every effect on three short levels", art (`pip-run-1` x3, `beetle-0` x3),
the song `lab`, a footer and the items start, controls, settings; the pause menu
(resume, controls, settings, title); settings (master, music, sfx, mute, shake, flashing, touch); and the controls screen's
rows (Walk; Run (hold); Jump; Lab menu), shown with the player's keys. Colours: focus bar `#00406c`,
headings `#f8b800`. Fonts: `content/fonts/fx-small.txt` (from T9 with the four arrows, for key names) and `fx-title.txt`.

`main.ts` passes `menus: { spec: content.manifest.menus, fonts, sheets }` to `bootBrowserGame`
and the fonts to the display. Back to title builds the game again from its first scene. The page opens on the title (the game waits
at tick 0 under it); Escape, P, gamepad Start or the `II` button pause (the ticks are held).
`?debug=step` and `?record` skip the title, so run files, replays and the older browser tests
are unchanged; `?debug=step&title=show` shows it. Tested in `tests/browser/menus.test.ts` (title,
start, pause, settings and controls by keyboard and touch, settings kept across a reload;
`WW_SHOTS_DIR=<folder>` keeps `menus-<game>-*.png`), tuned from those screenshots at page scale.

## The effects sheet (Engine 0.16 T14)

`docs/reports/0.16a-effects-sheet.png` is the owner's screenshot review of 0.16 part A: 24 tiles
of the lab's three run files, made with `pnpm cli sheet` (`engine/tools/CLAUDE.md`, Sheets) at
scale 2, four to a row. 2D: land dust (`level-1/154`), a stomp's sparks, ring, shake and
hit-pause (`level-1/219`), the coin burst (`level-3/120`), torch flame, smoke and the door's aura
(`level-3/305`), the PNG torch (`level-3/40`), the hurt flash (`level-2/279`), the door's zoom
punch and tint (`level-1/352`), parallax (`level-1/260`), the HUD (`level-1/300`,
`level-2/300`), the title, pause, settings and controls screens (`+title` on tick 0, the others
on tick 300), the lab's `ui` menu and dialog (`level-1/120+ui=lab`, `+ui=lab.talk`), a wipe and
the default fade (`level-1/100+wipe*12`, `+default*9`). 3D: the level iris closing on Pip at the
door (`level-1/345+level*22@3d`), the glTF brazier (`level-3/40@3d`), sun shadows and labels
(`level-3/120@3d`), fog, torch light and `EXIT` (`level-3/300@3d`), stomp particles
(`level-1/219@3d`) and the pause menu over the 3D picture (`level-1/300+pause@3d`). The exact
command is in `docs/BUILD-LOG.md` (Engine 0.16 part A); rerun it after a change to the lab's look
and look at the sheet again. While tuning it the title's `dim` went from 0.88 to 0.95 (the HUD
heading showed through the subtitle).

## Imports

- Relative paths inside `games/fx-lab`, `@engine/*` (core and backends) and `@kits/platformer`.
- Never other games. Nothing in `engine/` or `kits/` imports from here.
