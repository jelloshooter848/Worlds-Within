# engine/core/shell

Folder: `engine/core/shell` (part of `engine/core`). Detailed rules:
[`engine/core/shell/CLAUDE.md`](../../engine/core/shell/CLAUDE.md).

## Purpose

The browser shell every game page shares (Engine 0.7): choosing the backend from the page's
query and the 2D/3D toggle link, the host scene that plays a headless game and pushes its mini
games, and the browser boot (keyboard, gamepad, touch pad, scene stack, fixed loop) over a
display a backend builds, (Engine 0.11) the page's music and sound, and (Engine 0.13) a
campaign as a page plays it (the save kept in browser storage, its save code, a typed code read back), (Engine 0.14) a step hook for stepping a page tick by tick and replaying a run file in it, and (Engine 0.15) the player's stored volumes with a mute and volume control, pointer taps as frame input, a scene's tick rate and `toClient`, and (T10) the mission-launch scene and campaign page flow (launch, play or delegate, the round and its key hint, each entry held at tick 0 until Begin, the result with its save code, Continue and resume) with its DOM. A game's `main.ts` and scene are then a few lines of glue.

## Public API entry points

Import from `@engine/core/shell` (`index.ts`), or the files below.

- `backend-choice.ts`: `PageBackend`, `THREE_QUERY`, `backendFromQuery(search)`,
  `otherBackendLink(backend)`. Pure.
- `display.ts`: `BrowserDisplay` (`renderer`, `presenter`, `fit(layout)`, `present()`, optional
  `toScreen(clientX, clientY)` for pointer input) and
  `DisplayResult` (a display or why it cannot start). Built by `canvasDisplay`
  (`@engine/backends/canvas2d`) and `threeDisplay` (`@engine/backends/three`).
- `host-scene.ts`: `HostScene<W, E>` (`{ stack, game, picture }` with the game itself, a
  `HostedGame` such as the platformer kit's `LevelSequence` (Engine 0.10, gap G37), or
  `{ stack, step, world, events, miniGame, picture }` with accessors): steps the game, keeps events between draws (dropped on a new world), pushes `miniGameScene`
  while the host runs a mini game and pops it on the result. A `MissionHost` (`../mission-host.ts`,
  Engine 0.11) is a `HostedGame` too: its hosted mission round is pushed and popped like any other
  (the host steps it and resolves the mission). Pure.
- `boot.ts`: `bootBrowserGame({ screen, displays: { canvas2d, three? }, scene })` (browser
  only; display factories may be `async`, so Three.js loads only in 3D), `showBackendToggle`,
  `showDisplayMessage`. Engine 0.9: `pointer: true` adds a `PointerSource` on the canvas whose
  gestures (tap, box, pan, zoom) are made per game step beside the `InputFrame`; the scene factory
  gets it as `scene(stack, display, page)` with `page.pointer`. `touchPad: false` hides the touch
  pad (an RTS page). Both are off/on as before by default, so existing games are unchanged.
  Engine 0.11 (gap G27): `audio: { sfx?, songs?, music?, volumes? }` makes an `AudioManager`
  (`booted.audio`), unlocks it on every key, tap or click (`AUDIO_UNLOCK_EVENTS`; the first starts
  it), plays `music` once unlocked and hands each display factory `{ onSound }` as its second
  argument (`canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, onSound })`).
  Without it the page is silent and `onSound` does nothing.
  Engine 0.16 T4: each display factory also gets `shell.hitPause(ticks)` (pass it as the
  display's `onHitPause`); the loop then holds that many steps (no input, no tick) while the
  picture keeps drawing (`booted.hitPause`, a `HitPause`), with the same per-tick hashes; manual
  mode ignores it. The `FixedLoop` draws only on frames that took a step.
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
  (`FORBIDDEN_CORE`). `backend-choice.ts`, `host-scene.ts`, `debug.ts` and `mission-launch.ts` are on `PURE_CORE`.

## How to test

`engine/core/shell/shell.test.ts` with `pnpm test` (Node, a fake page for the DOM helpers, and a
full boot with a fake audio context for the `audio` option, and one in manual-loop mode) and
`debug.test.ts` (the step hook and replay, taps, `toClient`), `mission-launch.test.ts` (the launch
flow and the campaign flow over a `MissionHost` with fakes);
`tests/browser/mini-siege-page.test.ts` plays the flow's DOM (every entry held until Begin, resume
from a code);
`tests/browser/volume-control.test.ts` finds the volume control on every sample page and checks
two pages keep their volumes across a reload;
`tests/browser/lab-3d.test.ts` boots the lab through it in headless Chromium where one exists, and
`tests/browser/platformer.test.ts` replays the stacking test's run files through the page
with `window.__ww` and checks the golden hashes.
