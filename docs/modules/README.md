# Module pages

One page per module (each engine part, backend, kit and game), linked from the root `llms.txt`.
The page name is the module's folder path with `/` replaced by `-`: `engine/backends/null` is
`engine-backends-null.md`, and a sample at `games/samples/dungeon` is `games-samples-dungeon.md`.

Every page has the same four sections: **Purpose**, **Public API entry points**, **Imports allowed**
and **How to test**. The module's own `CLAUDE.md` holds the detailed rules for working inside it;
the page is the short version an agent reads first.

`tests/architecture/agent-docs.test.ts` fails when a module folder has no `CLAUDE.md`, `AGENTS.md`
or page here, or when a link in `llms.txt` points at a file that does not exist. When you add a
module, add all three and a link in `llms.txt`.

Pages today: `engine-core.md`, `engine-core-content.md`, `engine-core-present.md` (the presentation
contract and skins, from Engine 0.4), `engine-core-shell.md` (the browser shell games share, from Engine 0.7), `engine-core-fx.md` (presentation RNG, easing and tweens, from Engine 0.16), `engine-core-ui.md` (the UI kit: fonts, text, panels and HUD widgets from Engine 0.16 T6; buttons, menus, dialog boxes and UI screens from T7), `engine-backends-canvas2d.md`, `engine-backends-three.md` (the 3D backend, from Engine 0.6), `engine-backends-null.md`,
`engine-sim.md`, `engine-tools.md`, `engine-tools-debugger.md` (the in-browser simulation debugger, a tools-only page inside `engine/tools`, from Engine 0.14), `kits-topdown.md`, `kits-platformer.md`, `kits-rts.md` (from Engine 0.9), `kits-towerdefense.md` (from Engine 0.12), `games-samples-dungeon.md` (the top-down sample, The Old Crypt, the old demo, moved and finished in Engine 0.15), `games-platformer-lab.md` (the platformer kit's test lab, not a sample), `games-fx-lab.md` (the presentation lab of Engine 0.16, not a sample), `games-samples-platformer.md` (the platformer sample, Hopper's Way, the old stacking test, moved and finished in Engine 0.15), `games-samples-rts-skirmish.md` (the first sample, Engine 0.9, finished in 0.15 as The River Ford), `games-samples-mini-siege.md` (the multi-genre sample, Engine 0.11, with its tower-defense preparation phase from Engine 0.12 and its campaign with the dawn follow-up from Engine 0.13, and the shared mission launch and the rescue's own room from Engine 0.15), `games-samples-tower-defense.md` (the tower-defense sample, Engine 0.12, finished in 0.15 as The Winding Road), and `skills.md` for the agent
skills. The release reports (`docs/reports/stacking-test.md`, `mini-siege.md`, from Engine 0.12
`tower-defense.md`, and from Engine 0.15 `api-review.md`, the review of every module page's API
against the samples, whose 1.0 items say what the v1 pages must state) are not module pages (Engine 0.13 added no new module: fates, carry-over, campaigns and save codes live in the `engine/sim`, `engine/core`, `engine/core/shell` and `engine/tools` pages; Engine 0.15 added none either: the mission launch, keys, report-driven effects, taps, volumes and the 3D HUD live in the existing pages); `llms.txt` links them directly. A kit's page says what it presents, never how it is drawn: drawing belongs to a backend's
page and the game's skin.
