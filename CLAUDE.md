# Worlds Within

- Design and plan: `docs/DESIGN.md`, `docs/ROADMAP.md`. Check them before adding features.
- `src/sim` (from 0.2) must stay headless and deterministic: no imports from `engine/gfx`, `kits` or
  `game`, and all randomness through the world's seeded RNG.
- Kits (`src/kits`) hold no world rules: they read what a mission gives them and report what happened.
- Before pushing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
