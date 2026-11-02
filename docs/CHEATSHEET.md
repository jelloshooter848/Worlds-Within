# API cheat sheet

One page of the engine's public API for agents: how a game boots, its content kinds, the headless
contract, run files and the CLI loop. The tables between `generated` markers come from the same
schemas as `pnpm cli help` and the [schema reference](reference/schemas.md); `pnpm docs:gen` fills
them and `pnpm docs:check` (part of `pnpm test`) fails when they are out of date. Edit the rest by
hand. Full command help: [CLI reference](reference/cli.md).

## A game's folder

```text
games/<game>/
  game.json            the manifest: id, kit, content files by kind, start seed, entry modules
  content/             data files only (JSON, text grids); every file claimed by one kind
  headless.ts          createGame(content, seed, opts?): HeadlessGame   (for run, dump, mutants)
  view.ts              createView(content, seed, opts?): ViewGame       (for screenshot; optional)
  main.ts, index.html  the browser entry
  runs/<name>.run.json run files, each with <name>.hashes.json (golden state hashes)
  CLAUDE.md, AGENTS.md agent docs, plus docs/modules/games-<game>.md linked from llms.txt
```

Games import from `@engine/...` and `@kits/...`; the engine and kits never import from games. Game
rules belong in data files, not code.

## Booting a game

Content is loaded the same way everywhere: `{ path: text }` pairs, checked against the kinds.

```ts
import { loadContent, contentOf } from '@engine/core/content/bundle';
import { engineContentKinds, SONG_KIND } from '@engine/core/content/engine-kinds';
import { roomKind, buildDungeon, TopDownWorld, topdownGame } from '@kits/topdown';

const ROOM = roomKind();
const kinds = engineContentKinds().register(ROOM); // engine kinds + the kit's
const result = loadContent(files, kinds, { root: 'games/<game>/' }); // { ok, value, errors }
// files: in the browser `import.meta.glob(['./game.json', './content/**/*'], { query: '?raw', ... })`,
// in Node `readGameFiles(dir)` (engine/core/node/game-files.ts).
const rooms = contentOf(result.value, ROOM).map((e) => e.value); // typed by the kind's schema
```

- Headless (`headless.ts`): build the world from the bundle and a seed, and return a `HeadlessGame`
  (`engine/core/headless.ts`). The top-down kit's `topdownGame(world)` does the wrapping:
  `new TopDownWorld(buildDungeon(rooms), { seed, disabledRules: opts.disabledRules })`.
- View (`view.ts`, `engine/core/view.ts`): the same game plus `render(r: Renderer)`, drawing the
  whole 256x240 picture. Its `step` and `snapshot` must match the headless module's.
- Browser (`main.ts`): an `AssetRegistry` for palettes and sprites, a `CanvasRenderer` on a
  `Viewport`, an `InputManager` with keyboard and gamepad sources, an `AudioManager` with the
  songs, a `SceneStack`, and a `FixedLoop({ step, render }).start()` (see `games/demo/main.ts`).

## Content kinds

A kind is a `ContentKind` (`engine/core/content/kinds.ts`): `{ name, description, schema, readText?,
writeText?, gridParts? }`. The schema is Zod; describe every field with `.describe('...')`, since
that text is the field's line in the schema reference. `readText` / `writeText` give a `.txt` form
(sprites); `gridParts: { map: '.map.txt' }` keeps a field in a sibling text grid (rooms). Errors
always name the file and the field (`{ file, path, pointer, code, message, row?, col?, line? }`).
The engine's kinds come from `engineContentKinds()`; each kit's are listed in
`engine/tools/kits.ts` (`KIT_KINDS`). Every format:

<!-- generated:files -->

| Format                      | From         | Where                                                                   | Read from            | What it is                                                                                              |
| --------------------------- | ------------ | ----------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| Game manifest (`game.json`) | engine       | `games/<game>/game.json`                                                | `.json`              | Names the game and its kit, the files of each content kind, the start seed and the game's entry modules |
| Run file (`*.run.json`)     | engine/tools | `games/<game>/runs/<name>.run.json`; replay files in `.ww-out/replays/` | `.json`              | A seeded, scripted headless run and the checks it must pass (`pnpm cli run`)                            |
| `palette`                   | engine       | `content/`, claimed in `game.json` under `content.palette`              | `.json`              | A named list of colours (#rgb or #rrggbb) that sprite indices pick from                                 |
| `sfx`                       | engine       | `content/`, claimed in `game.json` under `content.sfx`                  | `.json`              | An MML sound effect: id, optional bpm and up to four voices                                             |
| `song`                      | engine       | `content/`, claimed in `game.json` under `content.song`                 | `.json`              | An MML song: id, bpm, loop and up to four channels                                                      |
| `sprite`                    | engine       | `content/`, claimed in `game.json` under `content.sprite`               | `.json` or `.txt`    | Text-grid pixel art: a palette name, an optional legend and named frames                                |
| `room`                      | kit topdown  | `content/`, claimed in `game.json` under `content.room`                 | `.json` + `.map.txt` | A top-down room: id, map cell, music, chests and an 11x16 map grid of the kit legend                    |

<!-- /generated:files -->

## The headless contract

```ts
interface HeadlessGame {
  step(input: InputFrame): void; // one tick
  snapshot(): JsonObject; // the whole state, plain JSON-safe data; must not change the game
}
export function createGame(content: ContentBundle, seed: number, opts?: HeadlessOptions): HeadlessGame;
```

- Same content, seed and input give the same snapshots: all randomness goes through the seeded
  `Rng` (`engine/core/rng.ts`), never `Math.random` or the clock.
- A state hash is the first 16 hex digits of the SHA-256 of `canonicalJson(snapshot)` (sorted
  keys); `canonicalJson` throws on anything not JSON-safe, naming the path.
- Kits name rules a run can switch off (`defineRules`, `RuleSwitch` in `engine/core/rules.ts`);
  `opts.disabledRules` goes to the kit. `mutants` uses this to find weak run files.

## Run files

`games/<game>/runs/<name>.run.json` (`engine/tools/run-file.ts`). Tick 0 is the starting state;
tick `t` is the state after `t` steps. An input step holds its actions from its frame until the
next step. Paths are dotted, into the snapshot (`hero.hp`, `entities.0.kind`, `entities.length`);
`dump` shows them all.

```json
{
  "game": "..",
  "ticks": 240,
  "input": { "steps": [{ "frame": 0, "hold": ["right"] }] },
  "assertions": [{ "tick": 240, "path": "hero.room", "op": "eq", "value": "guard-room" }],
  "invariants": [{ "path": "hero.hp", "op": "gte", "value": 0 }]
}
```

<!-- generated:run-file -->

| Field                 | Type                                                                                                         | Default        | Description                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------- |
| `game`                | `string`                                                                                                     | required       | the game folder, relative to the run file (".." for games/&lt;g>/runs/)           |
| `seed`                | `integer`                                                                                                    |                | the world's seed; the manifest's start.seed if left out                           |
| `ticks`               | `integer`                                                                                                    | required       | how many steps the run plays                                                      |
| `input`               | `object`                                                                                                     | `{"steps":[]}` | the scripted input (ScriptedInput steps)                                          |
| `input.steps`         | `object[]`                                                                                                   | required       | each step holds its actions from its frame until the next step                    |
| `input.steps[].frame` | `integer`                                                                                                    | required       | the input frame the hold starts at                                                |
| `input.steps[].hold`  | `("left" \| "right" \| "up" \| "down" \| "jump" \| "attack" \| "special" \| "start" \| "select" \| "run")[]` | required       | the actions held from that frame on                                               |
| `assertions`          | `object[]`                                                                                                   | `[]`           | checks made at one tick each                                                      |
| `assertions[].tick`   | `integer`                                                                                                    | required       | the tick the check is made at                                                     |
| `assertions[].path`   | `string`                                                                                                     | required       | a dotted path into the snapshot: hero.hp, entities.0.kind, entities.length        |
| `assertions[].op`     | `"eq" \| "ne" \| "lt" \| "lte" \| "gt" \| "gte" \| "in" \| "nin" \| "contains"`                              | required       | the comparison: eq, ne, lt, lte, gt, gte, in, nin, contains                       |
| `assertions[].value`  | `JSON`                                                                                                       | required       | what the value at the path is compared with                                       |
| `invariants`          | `object[]`                                                                                                   | `[]`           | checks made at every tick, 0 included                                             |
| `invariants[].path`   | `string`                                                                                                     | required       | a dotted path into the snapshot: hero.hp, entities.0.kind, entities.length        |
| `invariants[].op`     | `"eq" \| "ne" \| "lt" \| "lte" \| "gt" \| "gte" \| "in" \| "nin" \| "contains"`                              | required       | the comparison: eq, ne, lt, lte, gt, gte, in, nin, contains                       |
| `invariants[].value`  | `JSON`                                                                                                       | required       | what the value at the path is compared with                                       |
| `hashEvery`           | `integer`                                                                                                    | `60`           | a state hash every this many ticks (tick 0 and the last tick always get one)      |
| `disableRules`        | `string[]`                                                                                                   | `[]`           | kit rules switched off for this run (ids from the kit's rule list; see `mutants`) |
| `replay`              | `object`                                                                                                     |                | only in replay files: the source run, its failing check and its hashes            |

<!-- /generated:run-file -->

Check ops:

<!-- generated:check-ops -->

| Op         | Meaning                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| `eq`       | actual equals value (deep, for arrays and objects)                                |
| `ne`       | actual does not equal value                                                       |
| `lt`       | actual &lt; value (numbers)                                                       |
| `lte`      | actual &lt;= value (numbers)                                                      |
| `gt`       | actual > value (numbers)                                                          |
| `gte`      | actual >= value (numbers)                                                         |
| `in`       | actual equals one of value (an array)                                             |
| `nin`      | actual equals none of value (an array)                                            |
| `contains` | actual (an array) has an item equal to value, or actual (a string) contains value |

<!-- /generated:check-ops -->

A failing run stops at the first failing tick and writes a replay file (`.ww-out/replays/`) that
fails at that same tick when run again. Golden hashes: `tests/runs/run-files.test.ts` plays every
run file twice and compares with `<name>.hashes.json`; regenerate with
`WW_UPDATE_GOLDEN=1 pnpm test tests/runs` after a change meant to change the state.

## The CLI loop

Use `pnpm -s cli <command> ... --json`: stdout is then exactly one JSON object
`{ ok, command, exitCode, ... }`. Long results are capped; the rest goes to `.ww-out/` (path in
`fullOutput`).

1. `validate games/<game>`: fix every error it names (file and field), until exit 0.
2. `run games/<game>/runs/<name>.run.json`: read `failure` (first failing tick, check, `expected`,
   `actual`) and `replayFile`.
3. `dump <run-file or replay> --tick N`: look at the whole state at the failing tick.
4. `get` / `set` / `add` / `remove <file> <path> [value]`: change content; every write is
   schema-checked and read back (`verified: true`).
5. `run` again, then `mutants <run-file>` to see which kit rules the run does not guard, and
   `screenshot <run-file> --tick N` to look at a frame.
6. Before pushing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

<!-- generated:commands -->

| Command      | Usage                                   | What it does                                                                              |
| ------------ | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `help`       | `pnpm cli help [command]`               | list the commands, or show one command with its arguments and flags                       |
| `validate`   | `pnpm cli validate <game>`              | check every content file of a game against its schema (starts nothing)                    |
| `run`        | `pnpm cli run <runFile> [flags]`        | play a run file headless from its seed and check its assertions and invariants            |
| `dump`       | `pnpm cli dump <runFile> [flags]`       | the whole game state at one tick of a run file, as JSON                                   |
| `screenshot` | `pnpm cli screenshot <runFile> [flags]` | a PNG of one paused, seeded frame of a run file (headless Chromium)                       |
| `mutants`    | `pnpm cli mutants <runFile>`            | play a run file once per kit rule switched off and report the rules it doesn't guard      |
| `get`        | `pnpm cli get <file> <path>`            | read one value of a content file (path dotted or a JSON pointer)                          |
| `set`        | `pnpm cli set <file> <path> <value>`    | replace one value of a content file; checked, written, read back and verified             |
| `add`        | `pnpm cli add <file> <path> <value>`    | append to an array, insert at an index (- is the end) or add a new key; verified like set |
| `remove`     | `pnpm cli remove <file> <path>`         | delete a key or an array item of a content file; verified like set                        |

<!-- /generated:commands -->

Exit codes:

<!-- generated:exit-codes -->

| Code | Name             | Meaning                                                                              |
| ---- | ---------------- | ------------------------------------------------------------------------------------ |
| 0    | `ok`             | the command did what it was asked and every check passed                             |
| 2    | `usage`          | bad command line: unknown command or flag, a missing or extra argument               |
| 3    | `invalidContent` | a content file (or game.json) breaks its schema; the result names the file and field |
| 4    | `failedCheck`    | the content is valid but a check failed                                              |
| 5    | `crash`          | an exception: a bug in the tools, the engine or the game                             |

<!-- /generated:exit-codes -->
