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
  the copy to the page after the scenes drew. `DisplayResult` is a display or a sentence saying
  why it cannot start (no WebGL 2).
- `host-scene.ts` (pure): `HostScene<W, E>`, the scene that plays a headless game: `new
HostScene({ stack, step, world, events, miniGame, picture, translucentMiniGame? })`. The game
  passes accessors (one tick; the world now; the last step's events; the mini game the world
  runs, or null). After a step that starts a round it pushes the core `miniGameScene` over itself
  with `step` as the round's step (the host steps the round and applies its outcome, as headless)
  and pops it on the result. Events are kept between draws in a `PendingEvents` (dropped when the
  world object changes). `picture(r)` makes the drawer (`draw(world, events)`) on the first
  render; usually a `FramePicture` (`@engine/core/present`) onto the display's presenter.
- `boot.ts` (browser only): `bootBrowserGame({ screen, displays: { canvas2d, three? }, scene,
canvasId?, toggleId?, search? })`: reads the backend from the query, sets the toggle link
  (`#backend`; hidden when the game has no `three` display), builds the display (a factory may be
  `async`, so a game passes `async (c) => (await import('@engine/backends/three')).threeDisplay(c,
...)` and its 2D page loads no Three.js), shows the display's message with a link to 2D instead
  of a blank page when it cannot start (`body[data-backend="none"]`), then keyboard, gamepad and
  the touch pad (laid out with `layoutScreen`, re-laid on resize), `scene(stack, display)` on a
  `SceneStack`, and a `FixedLoop` (step: one input frame and `stack.update`; render:
  `stack.render(display.renderer)` then `display.present()`). Sets `body[data-backend]` once
  running and returns `{ backend, display, scenes, input, loop }` (null when the display could not
  start). `showBackendToggle(backend | null, id?)` and `showDisplayMessage(canvas, text)` are the
  two page helpers it uses.
- `index.ts`: re-exports all of the above (`@engine/core/shell`).

A game's `main.ts` is then: load its content, then `bootBrowserGame` with `canvasDisplay(canvas,
{ screen, skin, sheet, background })` for 2D, the lazy `threeDisplay` for 3D, and a `scene` that
makes a `HostScene` drawing a `FramePicture` onto `display.presenter` (see
`games/platformer-lab/main.ts` and `scene.ts`).

## Rules

- Imports: `engine/core` only. Never a backend (the displays come in as factories), the sim,
  tools, kits or games. Kits may not import this folder (`engine/core/shell/**` is on
  `FORBIDDEN_CORE` in `config/layers.js`): scenes and pages are the game's.
- `backend-choice.ts` and `host-scene.ts` are on `PURE_CORE` (and so is `../minigame-scene.ts`,
  which `host-scene.ts` imports); keep the DOM and the clock in `boot.ts`.
- No game rules or content: the game says what to step, what to draw and with which skin.

## Testing

`shell.test.ts` (Node, `pnpm test`): the query choice and toggle links; `HostScene` making its
drawer once with the renderer it is handed, passing the events of several steps in one draw,
dropping events of a world that is gone, and pushing, stepping and popping a mini game; the page
helpers and `bootBrowserGame`'s display choice and no-WebGL message on a fake page. The full boot
(input sources, loop) is browser-only: `tests/browser/lab-3d.test.ts` plays the lab through it in
headless Chromium (skipped where none is installed).
