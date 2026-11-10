# engine/core/shell

The browser shell every game page shares (Engine 0.7, "The stacking test", gaps G21-G25 in
`docs/reports/stacking-test.md`): what `games/platformer-lab` had hand-written in `main.ts`,
`scene.ts` and `backend.ts`, moved here so a game keeps only content, skins and thin glue. It is
part of `engine/core`: it imports core only, never a backend, kit or game. A backend builds the
display (`canvasDisplay` in `engine/backends/canvas2d`, `threeDisplay` in
`engine/backends/three`) and the game hands the boot one factory per backend.

- `backend-choice.ts` (pure): `PageBackend` (`canvas2d` | `three`), `THREE_QUERY`
  (`?backend=three`), `backendFromQuery(search)` (only `backend=three` picks 3D; anything else is
  Canvas2D) and `otherBackendLink(backend)` (`{ label, href, title }`, relative links: `./` for 2D
  so it works under any base path).
- `display.ts` (types): `BrowserDisplay` `{ renderer, presenter, fit(layout), present() }`, what
  a backend gives the page: the renderer the scene stack draws through (one that draws nothing in
  3D), a `Presenter` with the game's skin on the page's picture, the fit to the screen layout, and
  the copy to the page after the scenes drew, and (Engine 0.9) the optional `toScreen(clientX,
clientY)`, a client point in picture pixels for pointer input (`canvasDisplay` gives
  `Viewport.toScreen`; without one the boot maps the canvas's own box onto the picture, right for
  the 3D canvas, which is sized to the picture). `DisplayResult` is a display or a sentence saying
  why it cannot start (no WebGL 2).
- `host-scene.ts` (pure): `HostScene<W, E>`, the scene that plays a headless game: `new
HostScene({ stack, game, picture, translucentMiniGame? })` with the game itself, a `HostedGame`
  (`engine/core/headless.ts`: `step`, `world`, `events`, `miniGame()`; the platformer kit's
  `LevelSequence` is one; Engine 0.10, gap G37), or `new HostScene({ stack, step, world, events,
miniGame, picture, translucentMiniGame? })` with accessors (one tick; the world now; the last
  step's events; the mini game the world runs, or null) for a game that is not one
  (`HostSceneGameOptions` | `HostSceneAccessorOptions`; the accessors' optional `headless()`,
  Engine 0.14 T9, is the headless game the glue steps, which the scene's `headless()` reports to
  the step hook: the mini siege's `SiegePlay`). After a step that starts a round it pushes the core `miniGameScene` over itself
  with `step` as the round's step (the host steps the round and applies its outcome, as headless)
  and pops it on the result. A mission round is pushed the same way (Engine 0.11, item 173): pass a
  `MissionHost` (`../mission-host.ts`, a `HostedGame` whose `miniGame()` is the round it hosts) as
  `game`; the host steps the round and resolves the mission, and the world waits under it. Events are kept between draws in a `PendingEvents` (dropped when the
  world object changes). `picture(r)` makes the drawer (`draw(world, events)`) on the first
  render; usually a `FramePicture` (`@engine/core/present`) onto the display's presenter.
- `boot.ts` (browser only): `bootBrowserGame({ screen, displays: { canvas2d, three? }, scene,
canvasId?, toggleId?, search?, pointer?, touchPad?, audio?, manual? })`: reads the backend from the query, sets the toggle link
  (`#backend`; hidden when the game has no `three` display), builds the display (a factory may be
  `async`, so a game passes `async (c) => (await import('@engine/backends/three')).threeDisplay(c,
...)` and its 2D page loads no Three.js), shows the display's message with a link to 2D instead
  of a blank page when it cannot start (`body[data-backend="none"]`), then keyboard, gamepad and
  the touch pad (laid out with `layoutScreen`, re-laid on resize), `scene(stack, display)` on a
  `SceneStack`, and a `FixedLoop` (step: one input frame and `stack.update`; render:
  `stack.render(display.renderer)` then `display.present()`). Sets `body[data-backend]` once
  running and returns `{ backend, display, scenes, input, loop, pointer, audio, debug }` (null when the display
  could not start). Pointer input (Engine 0.9 T5): `pointer: true` (or the `PointerGestures`
  options but `screen`) makes a `PointerSource` on the canvas (`input/pointer.ts`), stepped by the
  loop with `beginFrame(performance.now())` right after the input frame, so each step's gestures
  sit beside its `InputFrame`. The scene factory gets it as its third argument,
  `scene(stack, display, page)` with `page.pointer` (null when not asked for); a scene reads
  `page.pointer.gestures()` in `update` (gestures it does not read that step are dropped).
  `touchPad: false` leaves out the on-screen touch pad (an RTS page played by pointer); it
  defaults to on. Both default to what games had, so existing games boot and behave as before.
  Audio (Engine 0.11, gap G27, item 179): `audio: BootAudio` `{ sfx?, songs?, music?, volumes? }`
  (the game's `contentSfx(content)` and `contentSongs(content)` from
  `@engine/core/content/game-content`, a song id, and the player's `Volumes`: master, music, sfx,
  muted) makes one `AudioManager` before the display: the songs and sfx registered, the volumes
  set, `music` waiting. Each display factory gets `(canvas, shell)` with `shell.onSound(id)`
  (`DisplayShell`; the manager's `sfx`, a no-op without `audio`) to pass on as the display's
  `onSound`. Once the display runs, every `AUDIO_UNLOCK_EVENTS` event on `window` (`keydown`,
  `pointerdown`, `pointerup`, `touchend`, `click`) calls `unlock()`: the first makes the
  `AudioContext` and starts `music`; later ones are cheap and recover a context the browser
  suspended. `pageshow` and `visibilitychange` (visible) call `wake()`, so a page back from the
  background resumes, or redoes the unlock on the next gesture. The manager is `booted.audio` (null without the option) for volume changes or
  another song. A game writes no audio code. `showBackendToggle(backend | null, id?)` and `showDisplayMessage(canvas, text)` are the
  two page helpers it uses.
- **The audio mixer** (Engine 0.16 T8, `../audio/mixer.ts`): with `audio` the boot makes one
  `Mixer` over the page's `AudioManager` (`booted.mixer`). `BootAudio` takes `mix` (the skin's
  `music` section: layered songs; `music` naming one plays its layers) and `seed` (sound
  variation's `fxRng` seed: the game's start seed). Each display factory's `shell.onSound(id,
cue?)` goes to `mixer.sound` (a presenter's `SoundCue`: varied, cooled down, ducking); the
  scene factory's `page.uiSound(id)` (also `booted.uiSound`) plays on the ui bus (a `UiScreen`'s
  `onSound`). The scenes' presenter (`shown.presenter`) hands every frame's status to
  `mixer.frameStatus` first; every loop step, held ones too, calls `mixer.tick()` first (mix rules,
  fades, the duck), and after the scenes update `mixer.dialog(open)` with whether a `UiScene`
  on the stack shows a dialog (`UiScene.dialogShown()`), so the music ducks under dialog boxes.
  The step hook's `__ww.mix()` is `mixer.state()` (null without audio). Nothing here reaches
  the game or a hash. Tested in `shell.test.ts` (a layered song mixed from the presented status
  in manual mode, a dialog duck, a cue varied, a UI sound on the ui bus).
- **Hit-pause** (Engine 0.16 T4, `../fx/hit-pause.ts`): the boot keeps one `HitPause`
  (`booted.hitPause`) and gives every display factory `shell.hitPause(ticks)` beside `onSound`;
  a game passes it as the display's `onHitPause`, so a presenter playing a skin event's
  `hitPause { ticks }` asks for that many held display frames. Each loop step first asks
  `hitPause.hold()`: while it says true the step does nothing (no input frame, no tick), and the
  render still draws, so the picture freezes while the presenters' own clocks (camera shake,
  flashes) go on. The tick sequence and every state hash are the same as without it (tested);
  headless runs never see it, and in manual-loop mode it does nothing (requests are dropped), so
  the step hook stays tick-exact. `FixedLoop` (`../loop.ts`) draws only on a frame that took a
  step, so a faster display draws each step once and presenter clocks run at 60 Hz everywhere.
- **Screen transitions** (Engine 0.16 T5; `transitions.ts`, pure, on `PURE_CORE`; the timing and
  shapes are `../fx/transition.ts`): `bootBrowserGame({ transitions, reduceMotion? })` with the
  game's `content.manifest.transitions` (`game.json`'s `transitions`, by slot: `level`, `scene`,
  `mission`, `default`; `transitionFor`: `mission` falls back to `scene`, any slot to `default`)
  makes a `ShellTransitions` (`booted.transitions`; made on every page, so on-demand ones work
  without specs). `reduceMotion` defaults to the browser's `prefers-reduced-motion: reduce`; with
  it every transition is a short fade (`reducedMotion`, `REDUCED_MOTION_TICKS` frames a half).
  - **When:** the display the scene factory gets (and `booted.display`) is the factory's with its
    `presenter` wrapped (`ShellTransitions.presenter`): a frame whose map id differs from the last
    one shown starts `level`. After each loop step the boot hands
    `transitions.scenes(before, after)` the stack's top and depth: a push plays the new top's
    `Scene.transitionSlot`, a pop
    the popped scene's (`scene` when it gives none; `HostScene` marks the round scenes it pushes
    `mission` for a mission host, a game with `mission` and `records`, else `scene`, or its
    `roundTransition` option). On demand: `booted.transition(slotOrSpec = 'default', covered?)`
    (T9's title and menus; `covered` runs once the picture is fully covered, on the in half's
    first frame, or at once when nothing could start) and the step hook's `__ww.transition`. One
    at a time: a request while one runs starts nothing.
  - **The picture:** while a transition closes (out half and hold) the wrapped presenter keeps
    presenting the last frame it showed before (presenters' own clocks go on), and keeps the
    frames that came meanwhile with a full map or events; once it opens it presents those, in
    order, then the frame. Before each frame (and before each render) the display gets
    `BrowserDisplay.transition(view)` (the `TransitionView` or null) and draws
    `transitionShape(view, screen, focus)` over everything: `canvasDisplay` on its backbuffer at
    `present` (`drawTransition`), `threeDisplay` as a pass after the HUD (`TransitionLayer`); an
    iris closes on the presenter's `focus()`, the followed entity on screen.
  - **Ticks:** the transition clock is one tick per loop step. While it closes the loop step does
    nothing (no input frame, no tick), as for a hit-pause, so every tick's state hash is the same
    as without it (tested: a level change with a transition gives the headless run's hashes). Its
    first closing frame is drawn right after the step that changed the level. In manual-loop
    mode it plays but never holds, so `__ww.step(n)` stays n ticks (the old picture is held
    while the game steps on).
- **Manual-loop mode and the step hook** (Engine 0.14 T8, gap G31; docs/BUILD-LOG.md, Engine
  0.14, decision 9, item 255). `bootBrowserGame({ manual: true })`, or the page's URL with
  `?debug=step` (`manualFromQuery(search)`, `DEBUG_STEP_QUERY`; `?backend=three&debug=step` for
  3D), makes the `FixedLoop` manual (`new FixedLoop(target, 60, 4, { manual: true })`: `start()`
  does nothing, so it never runs on `requestAnimationFrame`), draws the first picture with no step,
  and puts the step hook on `window.__ww` (`DebugWindow`; also `booted.debug`). Without it nothing
  changes: no `__ww`, the loop runs on `requestAnimationFrame` as before (the Pages build too,
  unless its URL asks). The hook (`debug.ts`, `PageDebugHook`, its `api` a `PageDebug`):
  - `tick`: the 60 Hz steps taken (manual mode's clock: the pointer's `beginFrame` gets
    `tick * stepMs`, so a long press counts steps, not wall time);
  - `step(n = 1)`: exactly n steps (each one input frame and `stack.update`, whatever the assist's
    `stepDivider`), then one draw (`FixedLoop.advance`); returns `tick`;
  - `snapshot()` and `hash()`: the headless snapshot of the game the page plays and its state hash
    (`engine/core/state-hash.ts`, the very hash `pnpm cli run` writes to `.hashes.json`), or null.
    The game is the topmost scene's `Scene.headless()` (`HostScene` given a `game` returns it; a
    page whose scene wraps one can forward it);
  - `replay(runFile)`: the parsed JSON of a run file, from tick 0 only. From the next step the
    scenes get a `ScriptedInput` of its `input` in place of the keyboard (frame 0 on the first
    step), and before the step from tick t the game takes t's `orders` (`HeadlessGame.order`) and
    then its `missions` steps (`HeadlessGame.mission`), as the tools hand them over; refusals
    are kept in `refused` (`ReplayRefusal { tick, kind, error }`), not thrown. So tick N of the
    page is tick N of the run and `hash()` at a golden tick equals the `.hashes.json` entry.
    Refused with an `Error`: a page past tick 0, a run file with `world`, `from`, `start` or a
    non-empty `disableRules` (the page plays its game from its own start, at its own seed, with
    every rule on: replay a run whose `seed` is the page's), no `ticks`, a malformed `input`, and
    `orders` or `missions` for a game that takes none. `replaying` says one is running.
    A page whose game steps the world every few loop steps (the RTS samples' `STEPS_PER_TICK`) is
    stepped the same way (`step(STEPS_PER_TICK)` per game tick); its run files replay in the page
    only when one loop step is one game tick. The page does not load a run file by URL (decision
    9's `?replay=`): the caller hands `replay` the JSON (a browser test reads it from disk).
  - **Recording** (Engine 0.14 T9, gap M19; decision 10, item 256): `record(on = true)` makes the
    game record the input of every hosted round that starts from then on
    (`HeadlessGame.recordRounds`, re-applied before every step, so a campaign's next entry records
    too; it returns whether the game can), `recording` says it is on, and `recordings()` is the
    rounds recorded so far, `RoundRecording { mission, tick, ticks, done, input }` (copied, plain
    JSON: `copy(JSON.stringify(__ww.recordings()))` in the console, then `pnpm cli record
<runFile> --mission <id> --input <file>`, `engine/tools/CLAUDE.md`). `tick` is the game tick
    of the round's `play` step (a run file's `missions[].tick`), `input` the round's held keys
    from its frame 0 (`MissionHost` records them; from Engine 0.15 the round's taps too, as `input.taps`). The
    page's URL with **`?record`** (`recordFromQuery`, `RECORD_QUERY`) puts `__ww` on the page with
    recording on and the loop running as usual, so a person plays and copies the recording; with
    `?debug=step&record` a test steps it. Without either there is no `__ww`.
- **Settings and input from Engine 0.15 T5** (gaps M1, D1, D2, D12, D13; docs/BUILD-LOG.md,
  Engine 0.15, decisions 5 and 6, items 282-283):
  - **Stored volumes and the volume control (M1).** `volume-control.ts` (browser only):
    `mountVolumeControl({ game?, start?, audio, parent? })` draws the shell's own `#ww-volume`
    group (fixed top-right): `#ww-mute` (a button, `aria-pressed` while muted) and `#ww-master`
    (a range 0-100 in 10s, the master volume), starts at the player's stored volumes
    (`save/settings.ts`: `loadVolumes`, `storeVolumes`, `volumesKey(game)` =
    `ww:<game>:volumes`, `readVolumes` checking every field; `start` when nothing is stored),
    applies them to the audio and stores every change at once; the button never keeps focus and
    keys on the slider never reach the game. `bootBrowserGame({ game, volumeControl? })` mounts it
    on every page with `audio` (`booted.volume`; `volumeControl: false` leaves it out but still
    applies the stored volumes). Storage never throws (a blocked one plays at the defaults).
    Headless runs never read it. Every sample page has it (the dungeon boots through the shell since Engine 0.15 T12; the RTS
    skirmish passes `audio: {}` until it has sounds).
  - **Taps as frame input (D1).** With `pointer`, each loop step's tap gestures go onto the live
    frame (`tapsOf(gestures)` to `ActionState.addTaps`), in game screen pixels: `InputFrame.taps?()`
    (`frameTaps(frame)` reads it). `ScriptedInput` plays a script's `taps`, `InputRecorder` records
    them, and the step hook's `replay` takes a run file's `input.taps`. Gestures still reach
    `page.pointer` as before.
  - **Taps into hosted rounds (D12).** `HostScene` and `miniGameScene` forward the frame as they
    always did; the core `RoundInput` passes its taps through (`taps()`) and `MissionHost`
    records them, so a round reads taps like keys (the tower-defense kit's `TdDefenceRound`). No
    `MiniGame.tap`.
  - **A scene's tick rate (D2).** `Scene.tickRate` (ticks a second): `SceneStack` (`../scene.ts`)
    steps such a scene only on its ticks with the steps' input merged (`input/merged-input.ts`,
    `MergedInput`). Page buttons press through `InputManager.press(action)` (held on the next
    frame only), which the merge keeps until the tick.
  - **`toClient` (D13).** `BrowserDisplay.toClient(x, y)`, a picture point in client px: the
    Canvas2D display's `Viewport.toClient`; a display without one (3D: its canvas is the picture)
    gets the canvas box's mapping from the boot. The step hook has it as `window.__ww.toClient`
    for browser tests (with the tower-defense kit's `screenAtCell`).
  - `transition(slotOrSpec = 'default')` (Engine 0.16 T5): plays a screen transition now (false
    when none could start), for browser tests that shoot one mid-way.
- `campaign-session.ts` (Engine 0.13 T8): `CampaignSession(context, campaign)`, a campaign as a
  page plays it, with no DOM: `end(save)` keeps an entry's save in browser storage
  (`../save/campaign-store.ts`) and packs its save code (`../campaign-code.ts`), giving
  `CampaignEntryEnd { save, code, codeError, stored, done }` (a null save stores nothing);
  `resume(text)` reads a typed code into `{ ok, save, run }` or refuses it with the codec's code
  and sentence, or `code_campaign` (another campaign's) and `campaign_done` (a finished
  campaign's: nothing left to play); `stored()` is the save an earlier visit kept when it has an
  entry past the first left to play, else null; `run(save?)` is `campaignRun`. Storage never
  throws (`save/storage.ts`), so a page without it plays on. The mini siege's page uses it.
- **The mission-launch scene and campaign page flow** (Engine 0.15 T10, gaps M26, M34, M36,
  lesson D14; docs/BUILD-LOG.md, Engine 0.15, decision 11, item 288):
  - `mission-launch.ts` (pure, on `PURE_CORE`): `MissionLaunch<G>({ create(save), missions,
offers(game), tick(game), stepsPerTick?, control?(game), onGame?(game), status?(game),
campaign? })` over a `LaunchGame` (a `MissionHost`'s `step`, `events`, `miniGame()`,
    `mission(step)`, `records()`, optional `roundHint(keys)`). `launchButtons()` is `offers` (none
    while a choice waits, a round runs, the entry is held or has ended); `press(LaunchButton)`
    (`launch`, `play`, `delegate`, `begin`, `continue`, `code`, `stored`) acts on the next loop
    step; `choice()`, `canPlay(mission)` (false for a mission without `play`: Decide),
    `playing()`, `title`, `outcomeTitle`, `records()`, `message` (the last refusal: a mission
    step's, an order's from `control`, a save code's, as `<code>: <reason>`), `tick`,
    `headless()`. `update(input)`: buttons first (an entry started by one is not stepped that
    step, so it starts at tick 0), then a hosted round one tick per loop step, else, not held,
    not waiting and not ended, `control(game)` (the kit's own orders, every loop step) and one
    game step every `stepsPerTick` loop steps, then `campaign.entryOver(game)` ends the entry.
    `scene(stack, picture)` is the `HostScene` over it (accessors; its `events` the loop step's
    that stepped the game). `status(keys)`: the round's key hint while one is played
    (`roundHint`, lesson D14), else `<entry title>, tick N`, `press Begin when ready` while
    held, the message, the choice's question, the last outcome's title and `status(game)`.
    **Campaign** (`campaign: { session, entryOver, save, summary, hold? }`, `session` a
    `CampaignSession` or anything with its `run`, `end`, `resume`, `stored`): every entry (the
    first, each Continue, a code, the stored save) is **held at tick 0** until `begin` (`held()`,
    `briefing()`: the entry's `title` and `text` from the campaign file; `hold: false` turns it
    off), M34; at its end `ended()` is a `LaunchEntryResult` (`CampaignEntryEnd` plus `entry`,
    `title`, `outcomes` (titles), `people` and `verdict` from `summary(game)`, `next`: the next
    entry's title or null), M36; `continue` starts the next entry from the save (or the first
    entry fresh when `next` is null), `code` resumes from a typed code, `stored` from
    `storedSave()` (offered at tick 0 only). `entry(save?)` and `entryTitle(save?)` read the
    campaign file.
  - `mission-bar.ts` (browser only): `mountMissionBar({ launch, input?, parent? })`, the flow's
    DOM, the shell's own: `#bar` fixed along the bottom (`MISSION_BAR_HEIGHT`, 40 px: the page's
    canvas leaves that much) with `#launches` (`#launch-<mission>`, "Launch: <title>"), `#play`,
    `#delegate` ("Decide" for a choice), `#status` (`launch.status` with `keyHintMap` of
    `input`'s player 1 keyboard bindings) and, with a campaign, `#stored` ("Carry on: <entry>"),
    `#code` (keys typed there never reach the game; Enter resumes) and `#resume`; `#briefing`
    (`#briefing-title`, `#briefing-text`, `#begin`) while held; `#result` (`#result-title`,
    `#result-lines`, `#result-code-label`, `#result-code`, `#continue`: "Continue: <next>" or
    "Play again"). Its buttons never keep the focus. `update()` (cheap when nothing changed) after
    every draw. The mini siege's page uses both; its `main.ts` has no bar, panel, code or hint
    logic of its own.
- `ui-scene.ts` (pure, on `PURE_CORE`; Engine 0.16 T7): `UiScene({ ui, painter(r), pointer?,
keys?, onEvent?, translucent?, transitionSlot? })`, a `UiScreen` (`../ui`) as a scene. Each
  step: commands from player 1's frame (`UiNav`, so keyboard and gamepad through the bindings,
  held directions repeating), the frame's taps (mouse clicks and touch taps from the boot's
  `pointer`, already in picture pixels through the display's `toScreen`) and the hover
  (`pointer.cursor()`); `onEvent(event, scene)` for each event (`last` keeps the step's).
  `render(r)` paints `ui.draws()` through `painter(r)` (the backend's, e.g. `CanvasUiPainter`;
  made once per renderer); translucent by default, so the scene below still draws and waits.
  The screen's state lives in the page, never in a kit or a hash. The 3D display's renderer draws
  nothing; from T9 a `UiScene` whose `painter` is the display's `uiPainter()` shows in 3D too (the
  shell's menus do; the fx lab's own lab menu still uses `CanvasUiPainter`, so it is 2D only). Tested in `ui-scene.test.ts`; the fx lab
  uses it (`tests/browser/fx-lab-ui.test.ts`).
- **Title screen, pause menu and settings** (Engine 0.16 T9; `game-menus.ts`, pure, on
  `PURE_CORE`; the screens are built by `../ui/menus.ts` from `game.json`'s `menus`):
  - `bootBrowserGame({ menus: BootMenus })`: `{ spec (content.manifest.menus), fonts
(contentFonts), sheets (the 2D sheet lookup, for frame sizes), canContinue?(), onContinue?(),
colourModes?, onColourMode?(i), restart?: 'scene' | 'reload' }`. Nothing shows when `spec` is
    undefined or the display has no `uiPainter` (then the page plays at once, as before).
  - `GameMenus({ spec, stack, screen, fonts, frameSize, painter, pointer?, keys, settings,
transition, music?, restart, ... })` (`booted.menus`) puts each screen on the stack as a
    `UiScene` with `transitionSlot: null` (`Scene.transitionSlot` may be null: no transition on
    push or pop). `showTitle()` pushes the title over the game's first scene, which does not step
    (its picture at tick 0 is the background, dimmed), and plays `title.music`; Start (or
    Continue, after `onContinue`) closes it once the `default` transition covers the picture and
    gives the game's `music` back. `pause()` pushes the pause menu over whatever plays (the
    stack steps only its top scene, so the game's ticks are held); Resume, Back (the attack
    key) or the pause key resume. Settings and Controls take the place of the menu they came from
    and give it back (focused on the item) on Back, Back (attack) or the pause key. Back to title
    plays the `default` transition and calls `restart`: the boot clears the stack and builds the
    first scene again with the `scene` factory (`restart: 'scene'`), or reloads the page
    (`'reload'`, for a page whose DOM and hooks hold its first scene: the RTS, tower-defense and
    mini siege samples). `state` (`title` | `pause` | `play`), `screen`, `ui`, `events`.
  - **Pause keys:** Escape and P (`PAUSE_CODES`, a `keydown` on `window`, not from a text field),
    gamepad Start (button 9, an edge read each step) and the `#ww-pause` button (`PAUSE_BUTTON_ID`,
    "II", fixed at the top right under the volume control, shown only in play). The boot reads a
    pause request after the step's input frame and before the scenes update, calls
    `menus.pauseKey()` and skips the scenes that step, so the press never reaches a menu or the
    game (Escape is also `start`). `body[data-menu]` is `title`, `pause` or `play` (a page's CSS
    hides its bar on the title: the RTS, tower-defense and mini siege pages).
  - **Settings:** master, music and sfx volume and mute go through the volume control
    (`booted.volume.set`, `ww:<game>:volumes`); screen shake (tenths), reduced flashing, the colour
    mode and the touch pad (`TOUCH_MODES`) are `save/settings.ts`'s `StoredSettings` under
    `ww:<game>:settings` (`loadSettings`, `storeSettings`, `readSettings`). At boot and on every
    change they reach `BrowserDisplay.effectSettings` (every presenter's shake and flashing),
    `TouchSource.setMode` (then a re-layout) and `onColourMode`. Nothing reaches a game or a hash.
  - **Touch and mouse:** a page that did not ask for `pointer` gets one for the menus
    (`menuPointer`): its taps reach the frame only while a menu shows, so the game never sees
    them; hover moves the focus.
  - **Skipping the title:** `titleFromQuery(search)`: shown unless `?debug=step` or `?record`
    (so run files, replays, the screenshot tool's pages and every older browser test start
    straight in play, and no hash moves) or `?title=skip`; `?title=show` shows it in manual mode
    (the menus' own browser test). `__ww.menus()` (`MenusView`: `state`, `screen`, `focused`,
    `items` with values and picture boxes) for tests.
  - Drawing: `BrowserDisplay.uiPainter()`: Canvas2D a `CanvasUiPainter` on the scenes' renderer;
    3D a painter that collects the draws, painted on `present()` as an overlay pass over the
    frame (`ThreePresenter.ui`). Fonts must be handed to the display (`fonts`) for glyphs to draw.
- `index.ts`: re-exports all of the above (`@engine/core/shell`), `volume-control.ts` and `tapsOf` included.

A game's `main.ts` is then: load its content, then `bootBrowserGame` with `audio` (its sfx and
songs, if it has sound) and `canvasDisplay(canvas, { screen, skin, sheet, background, onSound, onHitPause })` (the
shell's `onSound` and `hitPause`) for 2D, the lazy `threeDisplay` for 3D, and a `scene` that
is `new HostScene({ stack, game: createGame(content, seed), picture })` drawing a `FramePicture`
onto `display.presenter` (see `games/platformer-lab/main.ts`; no `scene.ts` since Engine 0.10).

## Rules

- Imports: `engine/core` only. Never a backend (the displays come in as factories), the sim,
  tools, kits or games. Kits may not import this folder (`engine/core/shell/**` is on
  `FORBIDDEN_CORE` in `config/layers.js`): scenes and pages are the game's.
- `backend-choice.ts`, `host-scene.ts`, `debug.ts`, `mission-launch.ts`, `transitions.ts`, `ui-scene.ts` and `game-menus.ts` are on `PURE_CORE` (and so is
  `../minigame-scene.ts`, which `host-scene.ts` imports); keep the DOM and the clock in `boot.ts`
  (it alone touches `window.__ww`), `volume-control.ts` (the volume control's DOM and storage) and
  `mission-bar.ts` (the mission-launch scene's DOM). `campaign-session.ts`
  is not pure: it reaches browser storage, through `save/storage.ts`, which never throws.
- No game rules or content: the game says what to step, what to draw and with which skin.

## Testing

`shell.test.ts` (Node, `pnpm test`): the query choice and toggle links; `HostScene` making its
drawer once with the renderer it is handed, passing the events of several steps in one draw,
dropping events of a world that is gone, pushing, stepping and popping a mini game, and the same
when given the game itself (a `HostedGame`), and a `MissionHost`'s mission round pushed, stepped
under the host while the world waits, and popped once the mission is resolved (Engine 0.11);
(`PointerSource` itself is tested with fake events in `../input/pointer.test.ts`) the page
helpers and `bootBrowserGame`'s display choice and no-WebGL message on a fake page; and a full
boot on a fake page with a fake `AudioContext` (Engine 0.11): with `audio`, no context and no song
before a gesture, `onSound` reaching the manager's `sfx`, the first key making one context and
playing the song once, later gestures reusing it; without it, no manager and no listeners.
A boot on a fake page in manual mode (Engine 0.14 T8): `?debug=step` calls no
`requestAnimationFrame`, puts `window.__ww` there, steps the `HostScene`'s game and hashes it;
without it the loop starts on `requestAnimationFrame` and there is no `__ww`; with `?record` the
loop runs on `requestAnimationFrame` and `__ww` records (Engine 0.14 T9). Hit-pause (Engine 0.16
T4): a game whose picture asks for a 4-frame hit-pause on every stomp, stepped by
`requestAnimationFrame` with a fake clock for 150 frames, takes fewer ticks than without but gives
exactly the same state hash at each tick, every frame still draws (the stomp's tick drawn again
through the held frames), and in manual mode `__ww.step(30)` takes 30 ticks with no pause. `debug.test.ts`:
`FixedLoop.advance` (n steps, one render, no rAF), the hook's step, snapshot and hash, a replay's
input in place of the live frame (frame 0 first), a tick's orders then missions before its step
with refusals kept, each refused run file, and recording (on in the game now and before every
step, the recordings copied; false for a game that cannot record). In the browser, `tests/browser/platformer.test.ts`
replays `level-1` to `level-4.run.json` through the built page with `window.__ww.replay` and
compares the page's hash at every golden tick with `runs/<name>.hashes.json`, refuses a `start`
run, and finds no `__ww` without `?debug=step`; every browser test that steps a page uses the hook
(none replaces `requestAnimationFrame`). `tests/browser/mini-siege-page.test.ts` plays the
sabotage round on the keyboard with `?debug=step&record`, reads `__ww.recordings()` (the run
file's committed input, at tick 40) and writes it with `record` into a copy of `played.run.json`
that then passes with the golden hashes.
Engine 0.15 T5: `shell.test.ts` boots a fake page with fake storage: the volume control starts at
the page's volumes, stores mute and the slider under `ww:<game>:volumes`, stops slider keys, and a
reload starts at the stored volumes; blocked storage plays on; `volumeControl: false` leaves it out;
`readVolumes` clamps bad data; `tapsOf` keeps only taps. `debug.test.ts`: a replay's `input.taps`
reach the game on their frame, a malformed tap is refused, `toClient` maps through the target.
`../input/merged-input.test.ts`: `ScriptedInput` taps, `MergedInput`, `SceneStack` pacing (30, 24,
none, a paused scene's clock, 0 refused) and `InputManager.press`. In the browser,
`tests/browser/tower-defense-page.test.ts` and `mini-siege-page.test.ts` tap cells through
`__ww.toClient` and `screenAtCell`, and check the volume control is there and its volumes survive
a reload.
Screen transitions (Engine 0.16 T5): `shell.test.ts` boots a game that changes level at tick 40
with an iris, stepped by `requestAnimationFrame` for 150 frames: every tick's hash is the run's
without it, 7 steps held, the display handed the iris out, hold and in, and the picture held on
the old level until it opens; in manual mode `__ww.step(45)` is 45 ticks and `__ww.transition`
plays a spec; without specs nothing plays on a level change, on demand a spec still does, and
`covered` runs at once when none starts; a mission host's round scene is `mission`.
`transitions.test.ts`: slots on push and pop, reduced motion, the held frames shown in order once
it opens, no transition on the first map or a reference. In the browser,
`tests/browser/fx-lab.test.ts` shoots the lab's iris, a wipe and a fade mid-way in both backends.
`mission-launch.test.ts` (Engine 0.15 T10): `MissionLaunch` over a `MissionHost` with a fake
world and a fake session: an entry held at tick 0 with its briefing until Begin; no hold with
`hold: false`; a refused launch's reason, the offers, the choice pausing the host, the round with
its key hint from the controls, the commit and its outcome title; a choice decided; an entry's end
by the game's rule with its result and code, Continue held again, the campaign's end and Continue
starting over; a refused code's reason, a code and the stored save resumed (held). The DOM is
browser-only: `tests/browser/mini-siege-page.test.ts` plays every entry held at tick 0 until Begin
(nothing stepping or offered before) and the dawn resumed from a code, held too.
`game-menus.test.ts` (Engine 0.16 T9): the title holding the game at its start, Start under the
`default` transition with the music back, Continue only with a save, the pause key pausing and
resuming with the ticks held, settings and controls in the pause menu's place with a change
handed to the page, Back to title restarting, the pause key ignored on the title, and
`titleFromQuery`. In the browser `tests/browser/menus.test.ts` opens every sample's and the fx
lab's title (`?debug=step&title=show`), checks the hash does not move under the title and the
pause menu, starts, pauses, changes screen shake and mute by keyboard and reads them back after
a reload, and does the same by touch (taps on the items, `#ww-pause`), shooting each screen.
`campaign-session.test.ts` (Engine 0.13 T8): an entry's save stored and its code packed and read
back (in lower case), a bad code (`code_empty`, `code_typo`) and a finished campaign's
(`campaign_done`) refused, a null save storing nothing, and blocked storage throwing nothing. The full boot
(input sources, loop) is browser-only: `tests/browser/lab-3d.test.ts` plays the lab through it in
headless Chromium (skipped where none is installed).
