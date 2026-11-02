# kits/platformer

The platformer kit: gameplay rules for a side-scrolling platformer, extracted from SMBC as rules
only, with generic names and none of its content. Today (Engine 0.5, T4) it holds the content
kinds; the world (integer physics, tile collision, named movement rules), level objects and
enemies, the mini game hook and presentation frames follow in later tasks of the release.

- `legend.ts`: `LEGEND`, the level text format: one character per 16x16 tile (`.` empty, `#`
  solid, `B` breakable brick, `?` bump block, `=` one-way platform, `^` hazard, `o` coin, `@`
  player start, `G` goal, `!` mini-game trigger, reserved for the mini game hook). Enemy spawns
  have no fixed character: the level header's `spawns` maps characters of its own to actor types.
- `level.ts`: `levelSchema` (the level header plus its `map`), `LevelDef`, `levelCells`,
  `levelSize` and `checkLevel(level, profile)`, the checks beyond the shape.
- `profile.ts`: `profileSchema`, `ProfileDef` and `profileKind()`: physics profiles, the player's
  movement numbers and the actor types (`walker`, `shell`, ...) with data-set behaviour.
- `schema.ts`: `levelKind()`, the `level` content kind (header JSON + `.map.txt` grid) whose
  `checkAll` runs `checkLevel` against the profile each level names.
- `rules.ts`: `PLATFORMER_RULES`, the kit's named rules (empty until the world arrives in T5).
- `kit.ts`: `kit`, the kit's hook for the tools (`defineKit` from `engine/core/kit.ts`): name
  `platformer`, kinds `level` and `profile`, `PLATFORMER_RULES` and `strictMutants: true`.
  `index.ts` re-exports the rest (not the hook); games import it as `@kits/platformer`.

## Imports

- Only `kits/platformer` itself (relative paths) and `@engine/core/*`, never the core's drawing
  and output side (`FORBIDDEN_CORE` in `config/layers.js`: the `Renderer`, sprite sheets,
  `assets/`, audio output, scenes, the loop). Tests may also use `@engine/backends/null`.
- Never other backends, `engine/sim`, `engine/tools`, other kits (not even `kits/topdown`) or games.
  `tests/architecture/dependency-rule.test.ts` checks every import.
- Any core file imported at run time must be on `PURE_CORE` (`tests/architecture/purity.test.ts`).

## Rules only

- **Never draws (enforced).** The kit describes what happened; a backend draws its frames from a
  read-only snapshot through a skin. No drawing call in any non-test file
  (`tests/architecture/no-drawing.test.ts`). State, never frame names or colours.
- **No world rules, no content.** The kit reads what a level gives it and reports what happened.
  Levels and profiles for real games live in `games/`; the kit keeps only the tiny fixtures in
  `__fixtures__/` (tests only), and `tests/architecture/no-content.test.ts` fails on content in its
  other files. `LEGEND` is the text format, not a level.
- **No SMBC names.** Actor types and fields have generic names. The fixture profile's numbers match
  SMBC's default runner (values only).
- **Whole numbers.** Positions in sub-pixels (1/256 px, `SUB`), velocities and accelerations in
  1/4096 px per tick (`VEL`), as SMBC, so results never depend on floating-point rounding.
- **Named rules, strict mutants.** Every gameplay rule the kit adds (gravity, variable jump,
  stomping, ...) gets an id in `rules.ts` and its code is guarded by `rules.isOn(id)`. The hook sets
  `strictMutants: true`, so `pnpm cli mutants` fails when a rule is not guarded by a run file.
- **Purity (lint-enforced):** no `Math.random`, `Date.now`, `performance.now` or DOM globals.

## Content kinds

- `level` (`levels/<id>.json` + `levels/<id>.map.txt`): `id`, `profile` (a `profile` id), `scroll`
  (`right` default, `free`, `none`), `size` (optional `[cols, rows]`; the size comes from the grid
  and must match), `spawns` (`{ "<char>": { actor, facing } }`), `blocks` (what each `?` holds in
  reading order: `coin`, `coins`, `powerup`, `life` or `actor:<type>`; all coins when left out)
  and `map`. Schema codes: `bad_spawn_key` (more than one character, a space or a legend
  character), `size_mismatch`, `wrong_block_count`, plus the grid's `ragged_row`, `unknown_char`,
  `empty_grid` at the `.map.txt` line.
- `checkAll` (`checkLevel`), once every file passes its schema: `no_start`, `two_starts` (at each
  extra `@`, row/col), `no_goal`, `missing_profile` (at `profile`) and `unknown_actor` (at each map
  cell using a spawn whose actor the profile lacks, with row/col; at `spawns.<char>.actor` when no
  cell uses it; at `blocks.<n>` for a block's `actor:<type>`).
- `profile` (`<id>.profile.json`): `player` (`box`, `minWalk`, `walkAccel`, `runAccel`,
  `friction`, `skid`, `skidTurn`, `maxWalk`, `maxRun`, `runHold` ticks, `jumps` tiers of
  `{ below?, speed, holdGravity, gravity }` with no `below` on the last, `maxFall`, `fallReset`,
  `stompBounce`), `actorGravity`, `actorMaxFall` and `actors` by name (`box?`, `speed`, `turnAt`
  `walls`/`ledges`, `stompable`, `stompInto?`, `kickable`, `kickSpeed?`, `harms`). Codes:
  `bad_jump_tiers`, `bad_speed_caps`, `unknown_actor` (a `stompInto` that is not an actor type)
  and `missing_field` (a kickable actor with no `kickSpeed`).

## Testing

`pnpm test kits/platformer`: `level.test.ts` and `profile.test.ts` check good and broken inputs
(file, path, code, row and col); `kit.test.ts` loads the fixtures as a game would (with
`loadContent` and the kit's hook) and checks the cross-file problems. After changing a schema or a
description, run `pnpm docs:gen` (the schema reference lists both kinds; their examples are
`docs/reference/examples/level.json`, `level.map.txt` and `profile.json`).
