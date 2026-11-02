# Worlds Within

- Design and plan: `docs/DESIGN.md`, `docs/ROADMAP.md`. Check them before adding features. The order is
  engine first, game second: the engine reaches its own 1.0 (with a sample game per kit in
  `games/samples/`) before Worlds Within starts. The two have separate version lines, tagged
  with full three-part versions: `engine-vX.Y.Z` and `ww-vX.Y.Z` (first tag of a release is `.0`; `.1`,
  `.2` and on are bug-fix-only patches). Two-part and plain `v*` tags are never used.
- **The repo is LLM-first.** Content is text, every run is repeatable from a seed, and tools let an
  agent check its own work. Every new module (engine part, kit or game) gets agent docs: its own
  `CLAUDE.md` and a page linked from `llms.txt` (from Engine 0.3).
- **Engine vs. game.** If two games could use it, it's engine. If it's content, it's the game. Game rules
  go in data files (scenarios, missions) wherever possible, not code.
- **Dependencies point one way.** Games depend on the engine; the engine and kits never import from
  games. Code lives in `engine/` (core, backends, sim, tools), `kits/` and `games/`; each folder's
  `CLAUDE.md` lists what it may import.
- **The dependency rule is a table.** `config/layers.js` lists the layers (games, kits, `engine/sim`,
  `engine/backends`, `engine/core`, `engine/tools`), the arrows each may import, and the one exception
  (`*.test.ts` files may also use `engine/backends/null`). Each game, kit and backend is its own unit
  and may not import a sibling. `config/deps.js` checks one arrow; `tests/architecture/dependency-rule.test.ts`
  checks every import in the repo against it. To change an arrow, change the table, never the test.
- The world simulation (`engine/sim`, from Engine 0.8) must stay headless and deterministic: no imports
  from backends, kits or games, and all randomness through the world's seeded RNG.
- Kits hold no world rules and never draw: they read what a mission gives them and report what happened,
  and backends draw them from a read-only snapshot.
- **How work is done:** Claude acts as orchestrator and delegates building and reviewing to agents.
- **Feedback items are numbered.** Whenever Claude needs the owner's feedback or a decision, each item
  gets a unique number that continues across conversations and is never reused, so the owner can answer
  by number. Record the last number used in `docs/FEEDBACK-LOG.md`.
- Before pushing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
