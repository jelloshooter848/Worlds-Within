# Worlds Within

- Design and plan: `docs/DESIGN.md`, `docs/ROADMAP.md`. Check them before adding features. The order is
  engine first, game second.
- **The repo is LLM-first.** Content is text, every run is repeatable from a seed, and tools let an
  agent check its own work. Every new module (engine part, kit or game) gets agent docs: its own
  `CLAUDE.md` and a page linked from `llms.txt` (from 0.3).
- **Engine vs. game.** If two games could use it, it's engine. If it's content, it's the game. Game rules
  go in data files (scenarios, missions) wherever possible, not code.
- **Dependencies point one way.** Games depend on the engine; the engine and kits never import from
  games. The target layout (`engine/`, `kits/`, `games/`) arrives in 0.2; until then code is in `src/`.
- The world simulation (`engine/sim`, from 0.8) must stay headless and deterministic: no imports from
  backends, kits or games, and all randomness through the world's seeded RNG.
- Kits hold no world rules and never draw: they read what a mission gives them and report what happened,
  and backends draw them from a read-only snapshot.
- **How work is done:** Claude acts as orchestrator and delegates building and reviewing to agents.
- Before pushing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
