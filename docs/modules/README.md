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
