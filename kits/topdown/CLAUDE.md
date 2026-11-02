# kits/topdown

The top-down kit: gameplay rules for a room-based action game seen from above. Rooms from text on a
grid (`room.ts`), the world with tile collision, doors, room slides and conditions (`world.ts`), a
sword hero with an item slot (`hero.ts`), enemies and objects (`enemies.ts`, `entity.ts`), items
such as the boomerang and bombs (`items.ts`, `beam.ts`), walking townsfolk (`walker.ts`,
`person.ts`), a scripted test bot (`bot.ts`), its named rules for mutant checks (`rules.ts`), the world's snapshot for the tools (`snapshot.ts`), its presentation frames (`present.ts`), sheet helpers (`view.ts`, `frames.ts`; `sheetLookup` there is a re-export of `@engine/core/assets/sheet-lookup`, kept until 0.4-7) and the room
file schema (`schema.ts`).
`index.ts` re-exports the public surface; games import it as `@kits/topdown`.

## Rules only

- The kit holds gameplay rules, not world rules and not content. It never knows about a particular
  game: a game supplies the rooms, any extra spawn kinds (a boss), its sheets and its own scene.
- It reads what it is given (rooms, a seed, input frames) and reports what happened through
  `world.events`. Rooms, songs and sprites belong in `games/`; tests may hold tiny fixtures
  (inline or in a `__fixtures__/` folder, see `engine/core/CLAUDE.md`).
  `tests/architecture/no-content.test.ts` fails on any content in the kit's other files.
- **Kit code, not content:** the frame helpers in `frames.ts` (`rotateCcw`, `withSideFrames` and
  the `SIDE_FRAMES` / `THICK_SIDE_FRAMES` / `SPLIT_FRAMES` name lists), the sheet ids in
  `DEFAULT_SHEETS` (`view.ts`), `PERSON_SHEET` and `BEAM_PALETTES` are the kit's art contract: the
  names of sheets, frames and palettes it asks for. The pixels behind those names come from the game.
  `LEGEND` (`room.ts`) is the room text format, not a room.
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

## Snapshots (`snapshot.ts`)

`snapshotWorld(world, events?)` reads the world into plain JSON-safe data (`TdSnapshot`): `frame`,
`room`, `rng` (the RNG's state), `keys`, `found`, `visited`, `sliding`, `sealed`, `exited`,
`hero` (`room`, `x`, `y`, `facing`, `hp`, `maxHp`, `attacking`, `invuln`, `dying`, `dead`),
`inventory` (`owned`, `current`, `ammo`), `entities` (`{ kind, x, y, key, hp? }`, `kind` being the
enemy or pickup kind or else the class name), `enemies` (living count) and `events`.
`topdownGame(world)` wraps a world as the engine's `HeadlessGame` (`engine/core/headless.ts`):
`step` updates the world and takes its events, so `snapshot().events` is the last step's. Both
only read the world and stay pure. Adding a field to the snapshot changes every state hash: update
the golden files (`WW_UPDATE_GOLDEN=1 pnpm test tests/runs`) in the same commit.

## Presentation frames (`present.ts`)

`presentWorld(world, events?, opts?)` describes the world as a `PresentFrame`
(`@engine/core/present`) without drawing; a backend draws it through a skin. It only reads the world:
no RNG draws, no room memory created, nothing `TdSnapshot` reads, so state hashes are the same with
or without it (tested per tick, and against the demo's walk-east golden hashes). Options: `size` (the
picture, `DEFAULT_SCREEN` when left out), `top` (where the play area starts on the picture, `HUD_H`
by default), `reduceFlashing` and `state` (a `TdPresentState`, one per stream of frames).

- **Map** (`presentMap`): the room on screen as rows of `PRESENT_TILES` characters (how each cell
  looks now: `O`/`L`/`X` open, locked and shut doors, `C` cracked walls, `H` a blasted doorway,
  `D`/`d` boarded and shut building doors), `id` the room id, tags `wall:<n>` and `dark`. `version`
  is a 32-bit hash of the tiles and tags, so it changes when a door opens, shutters shut, a wall is
  blasted. During a room slide the map is both rooms side by side (id `<from>><to>`, 32x11 or
  16x22, tags `slide`, `slide:<side>`, the new room's tags and the old one's with a `from-` prefix);
  the new room sits at its offset in it and the `camera` hint scrolls across. With `state`, the
  `MapTracker` sends the full map only when the id or version changes, else `{ id, version }`.
- **Positions** are world pixels (the room's top-left tile at 0,0). The HUD band is not baked in:
  `camera` `{ x, y }` is the world point at the picture's centre, set so the play area starts
  `top` pixels down.
- **Hero**: id `hero`, kind `hero`, 16x16, `facing`, `anim.state` `walk` (`t` = the walk counter),
  `attack`, `throw`, `hold`, `hurt` (knockback), `dying` (the spin) or `poof`, `t` ticks into the
  state; tags `invuln`, then `flashing` or (reduce flashing) `calm`, and `holding:<frame>`. While
  stabbing there is also `hero/sword` (kind `sword`, the blade's box). A dead hero is not listed.
- **Status**: `hp`, `maxHp` (half hearts), `keys`, `item` ('' for none), `ammo.<id>` for every item
  with ammo, `room`, `mapX`/`mapY`, `mapCols`/`mapRows`, `visited` (`gx,gy` cells, sorted, joined
  by spaces), `hasMap`, `hasCompass`, `goalX`/`goalY` (with the compass) and `top`.
- **Events**: the `TdEvent`s' JSON-safe fields; hero events (`sword`, `hurt`, `pickup`, ...) get
  the hero's centre and `entity: 'hero'`, `unlock` its doorway's middle. Events the world gives no
  place for (`hit`, `kill`, `room`) carry none (adding places to `TdEvent` would change hashes).
- **Ids**: `TdPresentIds` (in `TdPresentState`) names a thing the room text placed
  `<room>/<kind>@<col,row>` and anything else `<kind>#<n>` in the order first seen, kept in a
  `WeakMap`, never in the world. Other entities and room effects are presented from 0.4-6.
- `liveDoorLook` / `pastDoorLook` (how a doorway looks) are shared with the old `render.ts`.

## Named rules (`rules.ts`)

`TOPDOWN_RULES` names a few of the kit's rules for mutant checks (`engine/core/rules.ts`):
`walls-block-movement` (`tileSolid`), `doors-change-room` (`leaving`), `damage-reduces-hp`
(`TdHero.hurt`) and `keys-open-locked-doors` (`tryUnlock`). `TdWorldOptions.disabledRules`
switches rules off (an unknown id throws) and the code guards each with
`world.rules.isOn(id)`. A game's headless `createGame(content, seed, opts)` passes
`opts.disabledRules` on; `pnpm cli mutants <run-file>` then reports the rules a run file does not
guard. This is only the mechanism and a first few rules: **full adoption (naming every rule the kit
has) is Engine 0.5.** When you guard a new rule, add it to `TOPDOWN_RULES` with a one-line
description, keep the guard a single `isOn` check at the place the rule is decided, and test the
world with it on and off (`rules.test.ts`). Switching rules off never changes a normal run: every
rule is on by default.

## Room files (`schema.ts`)

`roomSchema(extraLegend?, wall?)` checks a room file (a `RoomDef` as JSON) and `roomKind(...)` is
the `room` content kind a game registers on top of `engineContentKinds()`. The map is usually a
sibling text grid (`rooms/hall.json` + `rooms/hall.map.txt`, the kind's `gridParts`): 11 rows of 16
characters from `LEGEND` plus the game's `extraLegend`. Beyond the shape, the room must pass
`parseRoom`; its complaints become `invalid_room` errors at the map row they name. Size mistakes
are `wrong_size`. Checks across rooms (one player start, a map cell each, edge doors that lead to
a facing door and line up, building doors that pair up) are `checkDungeon(defs, extraLegend?,
{ wall? })` in `room.ts`, which returns every problem with the room and field it is about;
`buildDungeon` throws the first. The kind's `checkAll` runs `checkDungeon` over every room file,
so `validate`, the editing verbs, `run` and `screenshot` report them as `invalid_dungeon` errors
at the room file (a map row at the `.map.txt` file and line) instead of the game throwing.
`roomKind(extraLegend, wall, { oneDungeon: false })` leaves that out, for a game whose room files
make several dungeons.

## Imports

- Allowed: `@engine/core/*`, `zod` (for `schema.ts`) and relative paths inside the kit.
- Tests (`*.test.ts`) may also use `@engine/backends/null` (the headless `NullRenderer`).
- Never: other backends, `engine/sim`, `engine/tools`, other kits, or anything in `games/`.

## Testing

Tests sit next to the code as `*.test.ts` (`topdown.test.ts`, `town-kit.test.ts`, `items.test.ts`,
`beam.test.ts`, `schema.test.ts`, `snapshot.test.ts`, `rules.test.ts`, `present.test.ts`) and run in Node with `pnpm test`. They drive the world with `ScriptedInput` and a
fixed seed, so every run is repeatable.
