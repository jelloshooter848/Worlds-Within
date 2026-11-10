# engine/core/shell

Folder: `engine/core/shell` (part of `engine/core`). Detailed rules:
[`engine/core/shell/CLAUDE.md`](../../engine/core/shell/CLAUDE.md).

## Purpose

The browser shell every game page shares (Engine 0.7): choosing the backend from the page's
query and the 2D/3D toggle link, the host scene that plays a headless game and pushes its mini
games, and the browser boot (keyboard, gamepad, touch pad, scene stack, fixed loop) over a
display a backend builds, (Engine 0.11) the page's music and sound, and (Engine 0.13) a
campaign as a page plays it (the save kept in browser storage, its save code, a typed code read back), (Engine 0.14) a step hook for stepping a page tick by tick and replaying a run file in it, and (Engine 0.15) the player's stored volumes with a mute and volume control, pointer taps as frame input, a scene's tick rate and `toClient`, and (T10) the mission-launch scene and campaign page flow (launch, play or delegate, the round and its key hint, each entry held at tick 0 until Begin, the result with its save code, Continue and resume) with its DOM, and (Engine 0.16 T9) every game's title screen, pause menu, settings and controls screens from `game.json`'s `menus`, and (part B) a level select, a level-clear banner, an end screen and an event-triggered respawn transition, and (F5) the mission flow in the picture (briefing, mission card with Play or Delegate, results with the world's changes). A game's `main.ts` and scene are then a few lines of glue.

## Public API entry points

Import from `@engine/core/shell` (`index.ts`), or the files below.

- `backend-choice.ts`: `PageBackend` (`canvas2d` | `pixi` | `three`), `Page2dBackend`,
  `THREE_QUERY`, `PIXI_QUERY`, `CANVAS2D_QUERY`, `backendFromQuery(search, fallback?)` (the
  backend the query names exactly, else the game's default 2D backend), `otherBackendLink(backend)`.
  Pure.
- `display.ts`: `BrowserDisplay` (`renderer`, `presenter`, `fit(layout)`, `present()`, optional
  `toScreen(clientX, clientY)` for pointer input) and
  `DisplayResult` (a display or why it cannot start). Built by `canvasDisplay`
  (`@engine/backends/canvas2d`), `pixiDisplay` (`@engine/backends/pixi`) and `threeDisplay`
  (`@engine/backends/three`).
- `host-scene.ts`: `HostScene<W, E>` (`{ stack, game, picture }` with the game itself, a
  `HostedGame` such as the platformer kit's `LevelSequence` (Engine 0.10, gap G37), or
  `{ stack, step, world, events, miniGame, picture }` with accessors): steps the game, keeps events between draws (dropped on a new world), pushes `miniGameScene`
  while the host runs a mini game and pops it on the result. A `MissionHost` (`../mission-host.ts`,
  Engine 0.11) is a `HostedGame` too: its hosted mission round is pushed and popped like any other
  (the host steps it and resolves the mission). Pure.
- `boot.ts`: `bootBrowserGame({ screen, displays: { canvas2d, pixi?, three? }, default2d?, scene })`
  (browser only; display factories may be `async`, so Three.js loads only in 3D and PixiJS only
  with PixiJS), `showBackendToggle`, `showDisplayMessage`. Engine 0.16 T13b-4: `?backend=pixi` and
  `?backend=canvas2d` pick the 2D backend, else `default2d` (default `canvas2d`); a PixiJS display
  that cannot start (no WebGL: its factory returns a reason or throws) falls back to Canvas2D on a
  fresh canvas, and `booted.backend` / `body[data-backend]` say what runs (`pageBackend`,
  `startDisplay`). Wired on the rts-skirmish, tower-defense, dungeon and mini-siege samples, the
  fx lab, the platformer lab and Hopper's Way (opt-in; the rts-skirmish and tower-defense pages
  default to PixiJS from Engine 0.16 T13b-8, `?backend=canvas2d` forcing Canvas2D); the platformer sample gets the option
  when its own track merges. Engine 0.9: `pointer: true` adds a `PointerSource` on the canvas whose
  gestures (tap, box, pan, zoom) are made per game step beside the `InputFrame`; the scene factory
  gets it as `scene(stack, display, page)` with `page.pointer`. `touchPad: false` hides the touch
  pad (an RTS page). Both are off/on as before by default, so existing games are unchanged.
  Engine 0.11 (gap G27): `audio: { sfx?, songs?, music?, volumes? }` makes an `AudioManager`
  (`booted.audio`), unlocks it on every key, tap or click (`AUDIO_UNLOCK_EVENTS`; the first starts
  it), plays `music` once unlocked and hands each display factory `{ onSound }` as its second
  argument (`canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, onSound })`).
  Without it the page is silent and `onSound` does nothing. Engine 0.16 T8: with `audio` the
  boot also makes the page's `Mixer` (`booted.mixer`; `audio.mix`, the skin's `music` section, and
  `audio.seed`): `onSound(id, cue)` is varied, cooled down and ducks through it, `page.uiSound(id)`
  plays on the ui bus, every presented frame's status drives the layered song's mix rules, every
  loop step ticks it, a `UiScene` showing a dialog ducks the music, and `__ww.mix()` reads it.
  Engine 0.16 T4: each display factory also gets `shell.hitPause(ticks)` (pass it as the
  display's `onHitPause`); the loop then holds that many steps (no input, no tick) while the
  picture keeps drawing (`booted.hitPause`, a `HitPause`), with the same per-tick hashes; manual
  mode ignores it. The `FixedLoop` draws only on frames that took a step.
  Engine 0.16 T5: `transitions` (the game's `content.manifest.transitions`) and `reduceMotion`
  (default the browser's `prefers-reduced-motion`) give the page screen transitions
  (`transitions.ts`, `ShellTransitions`; `booted.transitions`): the `level` one on a map id change
  (the presenter the scenes draw through is wrapped to see it), `scene` (or `mission`, a mission
  round's, `Scene.transitionSlot`) on a scene push or pop, and any on demand with
  `booted.transition(slotOrSpec?, covered?)` (`covered` runs once the picture is fully covered).
  While one closes the old picture is held and the loop holds ticks (as a hit-pause, same per-tick
  hashes; manual mode plays it without holding); the display draws it
  (`BrowserDisplay.transition(view)`). Under reduced motion each is a short fade.
  Engine 0.14 (gap G31): `manual: true`, or `?debug=step` in the page's URL (and, T9,
  `?record`, which adds `__ww` with recording on but leaves the loop running)
  (`manualFromQuery`), is manual-loop mode: the `FixedLoop` never runs on `requestAnimationFrame`
  and `window.__ww` (`booted.debug`, a `PageDebug` from `debug.ts`) steps the page. Off by
  default (no `__ww`, the loop as before).
- Engine 0.15 T5 (gaps M1, D1, D2, D12, D13):
  - `volume-control.ts`: `mountVolumeControl({ game?, start?, audio, parent? })`, the shell's
    `#ww-volume` (`#ww-mute`, `#ww-master`), starting at the player's stored volumes
    (`save/settings.ts`, `ww:<game>:volumes`) and storing every change; `bootBrowserGame({ game,
audio })` mounts it (`booted.volume`; `volumeControl: false` leaves it out). Every sample page
    has it.
  - Taps: with `pointer`, each step's taps go onto the frame (`tapsOf`, `InputFrame.taps`,
    `frameTaps`), in game screen pixels; `RoundInput` passes them to hosted rounds and
    `MissionHost` records them; run files carry them as `input.taps`.
  - `Scene.tickRate`: the scene stack steps a slower scene on its ticks with merged input
    (`MergedInput`); `InputManager.press(action)` for page buttons.
  - `BrowserDisplay.toClient(x, y)` (picture to client px) and `window.__ww.toClient`.
- `debug.ts` (Engine 0.14 T8): the step hook, `window.__ww` in manual-loop mode:
  - `tick`: the 60 Hz steps taken;
  - `step(n = 1)`: exactly n steps, then one draw; returns `tick`;
  - `snapshot()`, `hash()`: the page's game's headless snapshot (the topmost scene's
    `Scene.headless()`, which `HostScene` with a `game` gives) and its state hash
    (`engine/core/state-hash.ts`, the hash in a run's `.hashes.json`), or null;
  - `transition(slotOrSpec?)` (Engine 0.16 T5): plays a screen transition now;
  - `replay(runFileJson)`: from tick 0, the run's `input` through a `ScriptedInput` in place of the
    keyboard, and its `orders` and `missions` handed to the game before the step from their tick
    (refusals in `refused`); throws on a run with `world`, `from`, `start` or `disableRules`, or
    with orders or missions for a game that takes none; `replaying`.

  Replaying a run file in a browser test:

      await page.goto(`${url}games/samples/platformer/?debug=step`);
      const hashes = await page.evaluate((run) => {
        const ww = (window as DebugWindow).__ww!;
        ww.replay(run);
        ww.step(60);
        return ww.hash(); // = the run's .hashes.json entry for tick 60
      }, runJson);

  Recording (Engine 0.14 T9, gap M19): `record(on = true)` makes the page's game record the input
  of every hosted round that starts (`HeadlessGame.recordRounds`; `MissionHost` has it),
  `recording` says it is on, and `recordings()` gives `[{ mission, tick, ticks, done, input }]`
  as plain JSON, `input` the round's held keys from its frame 0 as `ScriptedInput` steps and
  `tick` its `play` step's game tick. `?record` in the page's URL puts `__ww` on the page with
  recording on while the loop runs as usual (`?debug=step&record` to step it). Copy the list to a
  file and `pnpm cli record <runFile> --mission <id> --input <file>` writes it into the run file.

- **Title, pause and settings (Engine 0.16 T9)**: `bootBrowserGame({ menus: { spec, fonts,
sheets, canContinue?, onContinue?, colourModes?, onColourMode?, restart? } })` with the game's
  `content.manifest.menus` (`game.json`'s `menus`, `engine/core/ui/menus.ts`) builds the title
  screen, pause menu, settings and controls screens on the UI kit (`game-menus.ts`, `GameMenus`,
  pure; `booted.menus`) and draws them with the display's `uiPainter()` (both backends have one).
  The page opens on the title over the game's first scene, which waits at tick 0 (its picture is
  the background) until Start; Escape, P, gamepad Start or the on-screen `#ww-pause` button pause
  (the game's ticks are held under the menu); settings store under `ww:<game>:settings`
  (`save/settings.ts`: shake, reduced flashing, colour mode, touch pad) beside the volumes, and
  reach the display through `BrowserDisplay.effectSettings`. The title is skipped with
  `?debug=step`, `?record` or `?title=skip` (`titleFromQuery`; `?title=show` shows it in manual
  mode), so run files, replays and older browser tests start straight in play. `__ww.menus()`
  reads the state, the screen on top and its items. `body[data-menu]` is `title`, `pause` or
  `play`, for a page's own CSS.

  ```json
  "menus": {
    "font": "hopper-small", "titleFont": "hopper-title",
    "style": { "focusBack": "#0058f8", "heading": "#fcd800", "sounds": { "move": "ui-move" } },
    "title": { "name": "Hopper's Way", "subtitle": "...", "music": "meadow",
               "art": [{ "sheet": "hopper", "frame": "runner-jump", "scale": 3, "anchor": "left", "x": 30 }],
               "items": ["start", "controls", "settings"] },
    "pause": { "items": ["resume", "controls", "settings", "title"] },
    "controls": [{ "actions": ["jump"], "label": "Jump" }]
  }
  ```

- **Level select, level-clear banner, end screen and the respawn transition (Engine 0.16 part B,
  T3)**: `menus.levels` (`heading?`, `lock?` (true: a level shows once the one before it is
  cleared), `mark?`), `menus.clear` (`heading?`, `lines?`: stat lines `{ label, status, of?,
format? }` read from the frame status) and `menus.end` (`heading?`, `credits?`, `lines?`,
  `items?`: `title`, `levels`), and the title item `levels`. The page passes its levels,
  `BootMenus.levels: [{ id, name }]` (the platformer kit's `stageNames(contentStages(content))`):
  the level select lists them (cleared marks and locks from `ww:<game>:progress`,
  `save/settings.ts`'s `loadProgress`/`storeProgress`, presentation only), a chosen level rebuilds
  the first scene with `page.start = { stage }` (what a run file's `start` gives the game), every
  presented frame's status reaches `GameMenus.frameStatus` (the banner shows while a level that is
  not the last is `cleared`, drawn over the game after the scenes and never on the stack, so the
  kit's pause goes on; the last level's clear opens the end screen, which holds the game, with the
  stats summed over the levels cleared). `game.json`'s `transitions.respawn` plays on the kit's
  `respawn` frame event (`transitions.events` maps any event to a slot), after its frame is shown
  and holding ticks while it closes like any transition, so no hash moves. `__ww.menus().banner`
  says whether the banner shows. Example: `games/fx-lab/game.json`.

  ```json
  "title": { "items": ["start", "levels", "controls", "settings"], ... },
  "levels": { "heading": "Pick a level", "mark": "*" },
  "clear": { "lines": [{ "label": "Coins", "status": "coins" }, { "label": "Time", "status": "time", "format": "time" }] },
  "end": { "heading": "Lab complete!", "credits": "Thanks for playing!", "items": ["title", "levels"] }
  ```

- `campaign-session.ts` (Engine 0.13 T8): `CampaignSession(context, campaign)` (a game's
  `saveCodeContext(content)` and campaign): `end(save)` stores an entry's campaign save in browser
  storage and packs its save code (`{ save, code, codeError, stored, done }`), `resume(text)` reads
  a typed code (`{ ok: true, save, run }` or `{ ok: false, code, error }`: the codec's refusals,
  `code_campaign`, `campaign_done`), `stored()` the save an earlier visit kept with an entry past
  the first left. No DOM; storage never throws.

- `mission-launch.ts` (Engine 0.15 T10, gaps M26, M34, M36, lesson D14):
  `MissionLaunch({ create(save), missions, offers(game), tick(game), stepsPerTick?, control?,
onGame?, status?, campaign?: { session, entryOver, save, summary, hold? } })`: `launchButtons()`,
  `press({ kind: 'launch' | 'play' | 'delegate' | 'begin' | 'continue' | 'code' | 'stored' })`,
  `choice()`, `canPlay`, `playing()`, `held()`, `briefing()`, `ended()` (a `LaunchEntryResult`),
  `storedSave()`, `status(keys)` (the round's key hint while one is played: `MissionHost.roundHint`),
  `message`, `scene(stack, picture)` (a `HostScene`). Pure.
- `mission-bar.ts`: `mountMissionBar({ launch, input })`, its DOM (`#bar` with `#launches`,
  `#play`, `#delegate`, `#status`, `#stored`, `#code`, `#resume`; `#briefing` with `#begin`;
  `#result` with `#result-code` and `#continue`); `update()` after every draw;
  `MISSION_BAR_HEIGHT` (40 px). See `games/samples/mini-siege/main.ts`.

- `mission-screens.ts` (Engine 0.16 F5): the mission flow in the picture with the UI kit, styled
  by `game.json`'s `menus`: `briefingScreen`, `missionCardScreen`, `missionChoiceScreen`,
  `windowBadgeScreen`, `outcomeScreen`, `resultsScreen` (each a `ui` file), and
  `MissionScreens({ launch, menus, screen, fonts, facts?, changes?, ticksPerHour?, pointer?, keys? })`:
  `kind()` (`briefing`, `card`, `outcome`, `results` or null), `update(input)` (keys, gamepad,
  mouse and taps to `launch.press`), `covers(p)`, `uncovered(gestures)`, `draws()`;
  `missionScreensScene(scene, screens, painter)` draws it over the page's scene. The facts and
  changes come from `engine/sim` (`missionCardFacts`, `worldChanges`). Pure. See
  `games/samples/mini-siege/main.ts` (`?ui=picture`).

Example (`games/platformer-lab/main.ts`):

    void bootBrowserGame({
      screen,
      displays: {
        canvas2d: (canvas) => canvasDisplay(canvas, labLook(content)),
        three: async (canvas) => (await import('@engine/backends/three')).threeDisplay(canvas, labLook3d(content)),
      },
      scene: (stack, display) =>
        new HostScene({
          stack,
          game: createGame(content, content.manifest.start.seed),
          picture: () => labPicture(display.presenter, screen),
        }),
    });

## Imports allowed

- `engine/core` only; never backends, the sim, tools, kits or games. Kits may not import it
  (`FORBIDDEN_CORE`). `backend-choice.ts`, `host-scene.ts`, `debug.ts`, `mission-launch.ts`, `mission-screens.ts`, `transitions.ts`, `ui-scene.ts` and `game-menus.ts` are on `PURE_CORE`.

## How to test

`engine/core/shell/shell.test.ts` with `pnpm test` (Node, a fake page for the DOM helpers, and a
full boot with a fake audio context for the `audio` option, and one in manual-loop mode) and
`debug.test.ts` (the step hook and replay, taps, `toClient`), `transitions.test.ts` (slots, reduced
motion, the old picture held on a level change; Engine 0.16 T5), `mission-launch.test.ts` (the launch
flow and the campaign flow over a `MissionHost` with fakes); `mission-screens.test.ts` (Engine 0.16
F5: the in-picture screens and their input) and `games/samples/mini-siege/mission-screens.test.ts`
(the siege's cards and results);
`tests/browser/mini-siege-page.test.ts` plays the flow's DOM (every entry held until Begin, resume
from a code);
`game-menus.test.ts` (Engine 0.16 T9: the title holding the game, Start, Continue, pause and
resume holding the ticks, settings and controls in the pause menu's place, Back to title, the
title query; Engine 0.16 part B: the level select with locks and marks, a level started, the
clear banner off the stack, the end screen with summed stats); `tests/browser/menus.test.ts` opens
every sample's and the fx lab's title, starts, pauses and changes settings by keyboard and by
touch, and reads them back after a reload, and plays the fx lab's level select, clear banner and
end screen by keyboard, gamepad and touch; `tests/runs/stepped-shell-invariance.test.ts` plays
every run file through the shell with the respawn transition, the banner and the end screen on;
`tests/browser/volume-control.test.ts` finds the volume control on every sample page and checks
two pages keep their volumes across a reload;
`tests/browser/lab-3d.test.ts` boots the lab through it in headless Chromium where one exists, and
`tests/browser/platformer.test.ts` replays the stacking test's run files through the page
with `window.__ww` and checks the golden hashes.
