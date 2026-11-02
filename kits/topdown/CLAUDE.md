# kits/topdown

The top-down kit: gameplay rules for a room-based action game seen from above. Rooms from text on a
grid (`room.ts`), the world with tile collision, doors, room slides and conditions (`world.ts`), a
sword hero with an item slot (`hero.ts`), enemies and objects (`enemies.ts`, `entity.ts`), items
such as the boomerang and bombs (`items.ts`, `beam.ts`), walking townsfolk (`walker.ts`,
`person.ts`), a scripted test bot (`bot.ts`), and sheet helpers (`view.ts`, `frames.ts`).
`index.ts` re-exports the public surface; games import it as `@kits/topdown`.

## Rules only

- The kit holds gameplay rules, not world rules and not content. It never knows about a particular
  game: a game supplies the rooms, any extra spawn kinds (a boss), its sheets and its own scene.
- It reads what it is given (rooms, a seed, input frames) and reports what happened through
  `world.events`. Rooms, songs and sprites belong in `games/`; tests may hold tiny fixtures.
- **Purity rule (lint-enforced):** randomness goes through the seeded `Rng` from
  `@engine/core/rng`, never `Math.random`; no `Date.now`, `performance.now` or DOM globals
  (`document`, `window`, `localStorage`, `requestAnimationFrame`, ...). ESLint fails on them in every
  file under `kits/` (the `purity` block in `eslint.config.js`). Pass an `Rng` or a frame count in
  instead. Any `engine/core` file the kit imports at run time must be on `PURE_CORE` in
  `config/layers.js`; `tests/architecture/purity.test.ts` checks that.
- **Known debt:** drawing still lives here. `render.ts` and `hud.ts` (and the `draw` methods on
  entities, enemies, items and the hero) call the core `Renderer`. Kits should never draw; moving
  this to a backend that draws from a read-only snapshot is planned for a later release. Do not add
  more drawing code.

## Imports

- Allowed: `@engine/core/*` and relative paths inside the kit.
- Tests (`*.test.ts`) may also use `@engine/backends/null` (the headless `NullRenderer`).
- Never: other backends, `engine/sim`, `engine/tools`, other kits, or anything in `games/`.

## Testing

Tests sit next to the code as `*.test.ts` (`topdown.test.ts`, `town-kit.test.ts`, `items.test.ts`,
`beam.test.ts`) and run in Node with `pnpm test`. They drive the world with `ScriptedInput` and a
fixed seed, so every run is repeatable.
