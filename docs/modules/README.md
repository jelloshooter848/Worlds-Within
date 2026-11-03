# Module pages

One page per module (each engine part, backend, kit and game), linked from the root `llms.txt`.
The page name is the module's folder path with `/` replaced by `-`: `engine/backends/null` is
`engine-backends-null.md`, and a sample at `games/samples/dungeon` will be `games-samples-dungeon.md`.

Every page has the same four sections: **Purpose**, **Public API entry points**, **Imports allowed**
and **How to test**. The module's own `CLAUDE.md` holds the detailed rules for working inside it;
the page is the short version an agent reads first.

`tests/architecture/agent-docs.test.ts` fails when a module folder has no `CLAUDE.md`, `AGENTS.md`
or page here, or when a link in `llms.txt` points at a file that does not exist. When you add a
module, add all three and a link in `llms.txt`.

Pages today: `engine-core.md`, `engine-core-content.md`, `engine-core-present.md` (the presentation
contract and skins, from Engine 0.4), `engine-core-shell.md` (the browser shell games share, from Engine 0.7), `engine-backends-canvas2d.md`, `engine-backends-three.md` (the 3D backend, from Engine 0.6), `engine-backends-null.md`,
`engine-sim.md`, `engine-tools.md`, `kits-topdown.md`, `kits-platformer.md`, `kits-rts.md` (from Engine 0.9), `games-demo.md`, `games-platformer-lab.md`, `games-platformer-test.md`, `games-samples-rts-skirmish.md` (the first sample, Engine 0.9), `games-samples-mini-siege.md` (the multi-genre sample, Engine 0.11), and `skills.md` for the agent
skills. A kit's page says what it presents, never how it is drawn: drawing belongs to a backend's
page and the game's skin.
