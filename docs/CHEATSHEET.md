# API cheat sheet

One page of the engine's public API for agents: how a game boots, its content kinds, the headless
contract, run files and the CLI loop. The tables between `generated` markers come from the same
schemas as `pnpm cli help` and the [schema reference](reference/schemas.md); `pnpm docs:gen` fills
them and `pnpm docs:check` (part of `pnpm test`) fails when they are out of date. Edit the rest by
hand. Full command help: [CLI reference](reference/cli.md).

## A game's folder

```text
games/<game>/
  game.json            the manifest: id, kit, content files by kind, start seed, screen size, entry modules
  content/             data files only (JSON, text grids); every file claimed by one kind
  headless.ts          createGame(content, seed, opts?): HeadlessGame   (for run, dump, mutants)
  view.ts              createView(content, seed, opts?): ViewGame       (for screenshot; optional)
  main.ts, index.html  the browser entry
  runs/<name>.run.json run files, each with <name>.hashes.json (golden state hashes)
  CLAUDE.md, AGENTS.md agent docs, plus docs/modules/games-<game>.md linked from llms.txt
```

Games import from `@engine/...` and `@kits/...`; the engine and kits never import from games. Game
rules belong in data files, not code.

To make a new one step by step, follow the
[scaffold-game skill](../.claude/skills/scaffold-game/SKILL.md).

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
  `new TopDownWorld(buildDungeon(rooms), { seed, disabledRules: opts.disabledRules })`. The
  platformer kit's is `new PlatformerWorld(level, profile, { seed, disabledRules, miniGames })`
  (`level` and `profile` kinds; see `games/platformer-lab/headless.ts`).
- Mini games (`engine/core/minigame.ts`, pure): a `MiniGameDef { id, title, create(ctx, seed) }`
  makes a `MiniGame { step, snapshot, result, present? }` that ends `pass`, `fail` or `quit`. The
  game supplies the defs (a kit defines none); a platformer level's `!` triggers start rounds
  headless. In the browser, `miniGameScene` (`engine/core/minigame-scene.ts`) pushes the round as
  a scene over the level and reports the result.
- View (`view.ts`, `engine/core/view.ts`): the same game plus `screen` (the manifest's picture
  size) and `render(r: Renderer)`, drawing the whole picture. Its `step` and `snapshot` must match
  the headless module's. Kits never draw: `render` asks the kit for a frame
  (`presentWorld(world, events, { state, size })`, a `PresentFrame`) and hands it, frozen
  (`freezeFrame`), to the backend's `SkinnedCanvasPresenter(r, skin, sheetLookup(assets), { size })`
  with the game's skin (`content/skins/canvas2d.json`, the `skin` kind). The presenter keeps the
  camera: it follows the frame's camera hint (else the skin's `camera`), with `deadzone`, `lerp`
  and clamping to the hint's `bounds` or the map; a hint's own values win over the skin's.
- 3D (from 0.6): a view may also give `frame()`, the frozen `PresentFrame` for the state now, so a
  tool can show it through any `Presenter`. `ThreeScene` / `ThreePresenter`
  (`@engine/backends/three`) draw those frames with the game's `three` skin
  (`content/skins/three.json`: a low-poly mesh per kind, a block per tile, `camera3d`). The lab
  picks 3D in the browser with `?backend=three` (see `games/platformer-lab/main3d.ts`), and
  `screenshot --backend three` uses `frame()`; it refuses software WebGL (exit 4) unless
  `--allow-software-gl`. Only `engine/backends/three` may import `three` (`PACKAGES` in
  `config/layers.js`).
- Browser (`main.ts`): an `AssetRegistry` for palettes and sprites, a `CanvasRenderer` on a
  `Viewport`, an `InputManager` with keyboard and gamepad sources, an `AudioManager` with the
  songs, a `SceneStack`, and a `FixedLoop({ step, render }).start()` (see `games/demo/main.ts`).

## Content kinds

A kind is a `ContentKind` (`engine/core/content/kinds.ts`): `{ name, description, schema, readText?,
writeText?, gridParts?, checkAll? }`. The schema is Zod; describe every field with `.describe('...')`, since
that text is the field's line in the schema reference. `readText` / `writeText` give a `.txt` form
(sprites); `gridParts: { map: '.map.txt' }` keeps a field in a sibling text grid (rooms); `checkAll` checks across all
of a kind's files once each passes (rooms: doors that line up, one player start). Errors
always name the file and the field (`{ file, path, pointer, code, message, row?, col?, line? }`).
The engine's kinds come from `engineContentKinds()`; each kit's come from its hook,
`kits/<name>/kit.ts` (`kinds()`, see `engine/core/kit.ts`), which `pnpm docs:gen` lists in
`engine/tools/kit-list.ts`. Every format:

<!-- generated:files -->

| Format                      | From           | Where                                                                   | Read from            | What it is                                                                                                                          |
| --------------------------- | -------------- | ----------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Game manifest (`game.json`) | engine         | `games/<game>/game.json`                                                | `.json`              | Names the game and its kit, the files of each content kind, the start seed and the game's entry modules                             |
| Run file (`*.run.json`)     | engine/tools   | `games/<game>/runs/<name>.run.json`; replay files in `.ww-out/replays/` | `.json`              | A seeded, scripted headless run and the checks it must pass (`pnpm cli run`)                                                        |
| `palette`                   | engine         | `content/`, claimed in `game.json` under `content.palette`              | `.json`              | A named list of colours (#rgb or #rrggbb) that sprite indices pick from                                                             |
| `sfx`                       | engine         | `content/`, claimed in `game.json` under `content.sfx`                  | `.json`              | An MML sound effect: id, optional bpm and up to four voices                                                                         |
| `skin`                      | engine         | `content/`, claimed in `game.json` under `content.skin`                 | `.json`              | How a backend shows a game: each kind as a sprite or mesh, tiles, event sounds and effects, the HUD                                 |
| `song`                      | engine         | `content/`, claimed in `game.json` under `content.song`                 | `.json`              | An MML song: id, bpm, loop and up to four channels                                                                                  |
| `sprite`                    | engine         | `content/`, claimed in `game.json` under `content.sprite`               | `.json` or `.txt`    | Text-grid pixel art: a palette name, an optional legend and named frames                                                            |
| `level`                     | kit platformer | `content/`, claimed in `game.json` under `content.level`                | `.json` + `.map.txt` | A platformer level: id, physics profile, scroll mode, spawns and bump-block contents, with its map in a text grid of the kit legend |
| `profile`                   | kit platformer | `content/`, claimed in `game.json` under `content.profile`              | `.json`              | A platformer physics profile: player movement numbers and actor types in whole sub-pixel and 1/4096 px per tick units               |
| `room`                      | kit topdown    | `content/`, claimed in `game.json` under `content.room`                 | `.json` + `.map.txt` | A top-down room: id, map cell, music, chests and an 11x16 map grid of the kit legend                                                |

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
  `opts.disabledRules` goes to the kit. `mutants` uses this to find weak run files; a run file's
  `guards` says which rules it is meant to guard, and a kit with `strictMutants: true` fails
  `mutants` (exit 4) on a weak rule. `mutants games/<game>` checks that every rule is guarded by
  some run file of the game.

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

| Field                 | Type                                                                                                         | Default        | Description                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `game`                | `string`                                                                                                     | required       | the game folder, relative to the run file (".." for games/&lt;g>/runs/)                                                      |
| `seed`                | `integer`                                                                                                    |                | the world's seed; the manifest's start.seed if left out                                                                      |
| `ticks`               | `integer`                                                                                                    | required       | how many steps the run plays                                                                                                 |
| `input`               | `object`                                                                                                     | `{"steps":[]}` | the scripted input (ScriptedInput steps)                                                                                     |
| `input.steps`         | `object[]`                                                                                                   | required       | each step holds its actions from its frame until the next step                                                               |
| `input.steps[].frame` | `integer`                                                                                                    | required       | the input frame the hold starts at                                                                                           |
| `input.steps[].hold`  | `("left" \| "right" \| "up" \| "down" \| "jump" \| "attack" \| "special" \| "start" \| "select" \| "run")[]` | required       | the actions held from that frame on                                                                                          |
| `assertions`          | `object[]`                                                                                                   | `[]`           | checks made at one tick each                                                                                                 |
| `assertions[].tick`   | `integer`                                                                                                    | required       | the tick the check is made at                                                                                                |
| `assertions[].path`   | `string`                                                                                                     | required       | a dotted path into the snapshot: hero.hp, entities.0.kind, entities.length                                                   |
| `assertions[].op`     | `"eq" \| "ne" \| "lt" \| "lte" \| "gt" \| "gte" \| "in" \| "nin" \| "contains"`                              | required       | the comparison: eq, ne, lt, lte, gt, gte, in, nin, contains                                                                  |
| `assertions[].value`  | `JSON`                                                                                                       | required       | what the value at the path is compared with                                                                                  |
| `invariants`          | `object[]`                                                                                                   | `[]`           | checks made at every tick, 0 included                                                                                        |
| `invariants[].path`   | `string`                                                                                                     | required       | a dotted path into the snapshot: hero.hp, entities.0.kind, entities.length                                                   |
| `invariants[].op`     | `"eq" \| "ne" \| "lt" \| "lte" \| "gt" \| "gte" \| "in" \| "nin" \| "contains"`                              | required       | the comparison: eq, ne, lt, lte, gt, gte, in, nin, contains                                                                  |
| `invariants[].value`  | `JSON`                                                                                                       | required       | what the value at the path is compared with                                                                                  |
| `hashEvery`           | `integer`                                                                                                    | `60`           | a state hash every this many ticks (tick 0 and the last tick always get one)                                                 |
| `disableRules`        | `string[]`                                                                                                   | `[]`           | kit rules switched off for this run (ids from the kit's rule list; see `mutants`)                                            |
| `guards`              | `string[]`                                                                                                   |                | the kit rules this run is meant to guard (ids from the kit's rule list); `mutants` checks these, or every rule when left out |
| `replay`              | `object`                                                                                                     |                | only in replay files: the source run, its failing check and its hashes                                                       |

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
5. `run` again, then `mutants <run-file>` (or `mutants games/<game>` for every run file) to see
   which kit rules the run does not guard, and
   `screenshot <run-file> --tick N` to look at a frame (`--backend three --allow-software-gl` for
   the 3D picture where there is no GPU).
6. Before pushing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

When a run fails, the [debug-failing-run skill](../.claude/skills/debug-failing-run/SKILL.md) walks
these steps in order.

<!-- generated:commands -->

| Command      | Usage                                   | What it does                                                                              |
| ------------ | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `help`       | `pnpm cli help [command]`               | list the commands, or show one command with its arguments and flags                       |
| `validate`   | `pnpm cli validate <game>`              | check every content file of a game against its schema (starts nothing)                    |
| `run`        | `pnpm cli run <runFile> [flags]`        | play a run file headless from its seed and check its assertions and invariants            |
| `dump`       | `pnpm cli dump <runFile> [flags]`       | the whole game state at one tick of a run file, as JSON                                   |
| `screenshot` | `pnpm cli screenshot <runFile> [flags]` | a PNG of one paused, seeded frame of a run file (headless Chromium)                       |
| `mutants`    | `pnpm cli mutants <target>`             | play run files once per kit rule switched off and report the rules they don't guard       |
| `get`        | `pnpm cli get <file> <path>`            | read one value of a content file (path dotted or a JSON pointer)                          |
| `set`        | `pnpm cli set <file> <path> <value>`    | replace one value of a content file; checked, written, read back and verified             |
| `add`        | `pnpm cli add <file> <path> <value>`    | append to an array, insert at an index (- is the end) or add a new key; verified like set |
| `remove`     | `pnpm cli remove <file> <path>`         | delete a key or an array item of a content file; verified like set                        |

<!-- /generated:commands -->

Exit codes:

<!-- generated:exit-codes -->

| Code | Name             | Meaning                                                                                        |
| ---- | ---------------- | ---------------------------------------------------------------------------------------------- |
| 0    | `ok`             | the command did what it was asked and every check passed                                       |
| 2    | `usage`          | bad command line: unknown command or flag, a missing or extra argument                         |
| 3    | `invalidContent` | a content file (or game.json) breaks its schema; the result names the file and field           |
| 4    | `failedCheck`    | the content is valid but a check failed (a run's assertion, screenshot's WebGL renderer check) |
| 5    | `crash`          | an exception: a bug in the tools, the engine or the game                                       |

<!-- /generated:exit-codes -->
