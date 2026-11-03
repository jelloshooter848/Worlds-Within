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
  (`HostSceneGameOptions` | `HostSceneAccessorOptions`). After a step that starts a round it pushes the core `miniGameScene` over itself
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
- `campaign-session.ts` (Engine 0.13 T8): `CampaignSession(context, campaign)`, a campaign as a
  page plays it, with no DOM: `end(save)` keeps an entry's save in browser storage
  (`../save/campaign-store.ts`) and packs its save code (`../campaign-code.ts`), giving
  `CampaignEntryEnd { save, code, codeError, stored, done }` (a null save stores nothing);
  `resume(text)` reads a typed code into `{ ok, save, run }` or refuses it with the codec's code
  and sentence, or `code_campaign` (another campaign's) and `campaign_done` (a finished
  campaign's: nothing left to play); `stored()` is the save an earlier visit kept when it has an
  entry past the first left to play, else null; `run(save?)` is `campaignRun`. Storage never
  throws (`save/storage.ts`), so a page without it plays on. The mini siege's page uses it.
- `index.ts`: re-exports all of the above (`@engine/core/shell`).

A game's `main.ts` is then: load its content, then `bootBrowserGame` with `audio` (its sfx and
songs, if it has sound) and `canvasDisplay(canvas, { screen, skin, sheet, background, onSound })` for 2D, the lazy `threeDisplay` for 3D, and a `scene` that
is `new HostScene({ stack, game: createGame(content, seed), picture })` drawing a `FramePicture`
onto `display.presenter` (see `games/platformer-lab/main.ts`; no `scene.ts` since Engine 0.10).

## Rules

- Imports: `engine/core` only. Never a backend (the displays come in as factories), the sim,
  tools, kits or games. Kits may not import this folder (`engine/core/shell/**` is on
  `FORBIDDEN_CORE` in `config/layers.js`): scenes and pages are the game's.
- `backend-choice.ts`, `host-scene.ts` and `debug.ts` are on `PURE_CORE` (and so is
  `../minigame-scene.ts`, which `host-scene.ts` imports); keep the DOM and the clock in `boot.ts`
  (it alone touches `window.__ww`). `campaign-session.ts`
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
without it the loop starts on `requestAnimationFrame` and there is no `__ww`. `debug.test.ts`:
`FixedLoop.advance` (n steps, one render, no rAF), the hook's step, snapshot and hash, a replay's
input in place of the live frame (frame 0 first), a tick's orders then missions before its step
with refusals kept, and each refused run file. In the browser, `tests/browser/platformer-test.test.ts`
replays `level-1` to `level-4.run.json` through the built page with `window.__ww.replay` and
compares the page's hash at every golden tick with `runs/<name>.hashes.json`, refuses a `start`
run, and finds no `__ww` without `?debug=step`; every browser test that steps a page uses the hook
(none replaces `requestAnimationFrame`).
`campaign-session.test.ts` (Engine 0.13 T8): an entry's save stored and its code packed and read
back (in lower case), a bad code (`code_empty`, `code_typo`) and a finished campaign's
(`campaign_done`) refused, a null save storing nothing, and blocked storage throwing nothing. The full boot
(input sources, loop) is browser-only: `tests/browser/lab-3d.test.ts` plays the lab through it in
headless Chromium (skipped where none is installed).
