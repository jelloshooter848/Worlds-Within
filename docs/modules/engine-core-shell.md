# engine/core/shell

Folder: `engine/core/shell` (part of `engine/core`). Detailed rules:
[`engine/core/shell/CLAUDE.md`](../../engine/core/shell/CLAUDE.md).

## Purpose

The browser shell every game page shares (Engine 0.7): choosing the backend from the page's
query and the 2D/3D toggle link, the host scene that plays a headless game and pushes its mini
games, and the browser boot (keyboard, gamepad, touch pad, scene stack, fixed loop) over a
display a backend builds, and (Engine 0.11) the page's music and sound. A game's `main.ts` and scene are then a few lines of glue.

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
  while the host runs a mini game and pops it on the result. Pure.
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
  (`FORBIDDEN_CORE`). `backend-choice.ts` and `host-scene.ts` are on `PURE_CORE`.

## How to test

`engine/core/shell/shell.test.ts` with `pnpm test` (Node, a fake page for the DOM helpers, and a
full boot with a fake audio context for the `audio` option);
`tests/browser/lab-3d.test.ts` boots the lab through it in headless Chromium where one exists.
