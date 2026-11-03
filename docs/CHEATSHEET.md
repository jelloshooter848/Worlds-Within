# API cheat sheet

One page of the engine's public API for agents: how a game boots, its content kinds, the headless
contract, run files and the CLI loop. The tables between `generated` markers come from the same
schemas as `pnpm cli help` and the [schema reference](reference/schemas.md); `pnpm docs:gen` fills
them and `pnpm docs:check` (part of `pnpm test`) fails when they are out of date. Edit the rest by
hand. Full command help: [CLI reference](reference/cli.md).

## A game's folder

```text
games/<game>/
  game.json            the manifest: id, kit (and uses: more kits' kinds), content files by kind, start seed, screen size, entry modules
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
- An RTS game (Engine 0.9) is the one kind of game that imports both `engine/sim` and a kit: its
  glue builds a world from the map (`worldFromScenario`, an `rts-map` scenario with
  `"systems": "rts"`) and hands it to the kit's `rtsGame({ world: { snapshot, applyOrder, step },
enemy, seed, disabledRules })` (`@kits/rts`), which takes the player's orders and runs the
  scripted enemy (`rts-enemy`). World rules (movement, combat, building, training, gathering) are
  `engine/sim` systems; the kit only reads the world's snapshot and gives orders (`orderSchema`
  in `engine/core/orders.ts`). See `games/samples/rts-skirmish/headless.ts`.
- A tower-defense game (Engine 0.12, `kit: towerdefense`, no sim): `tdGame({ ...tdRound(content),
seed, disabledRules })` (`@kits/towerdefense`): `tdRound` picks the `td-map`, its tower types
  (`td-towers`) and its wave list (`td-waves`). The game's `controls` is the cursor (`TdControls`:
  arrows move, `jump` places, `attack` cycles the tower type, `special` sells, `start` sends the
  next wave), `tap(x, y, frame, button, TD_TILE_SIZE)` maps a pointer tap to a cell through the
  frame's camera (`cameraHint`), and `tdFrames(size, cursor)` gives the frames. See
  `games/samples/tower-defense/headless.ts` and `play.ts`.
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
  and clamping to the hint's `bounds` or the map; a hint's own values win over the skin's. A game
  on a kit's frame stream builds its view with `frameView` (Engine 0.7); a stacked mini game's
  frames go to their own skin through `presenterByStatus('miniGame', ...)`.
- 3D (from 0.6): a view may also give `frame()`, the frozen `PresentFrame` for the state now, so a
  tool can show it through any `Presenter`. `ThreeScene` / `ThreePresenter`
  (`@engine/backends/three`) draw those frames with the game's `three` skin
  (`content/skins/three.json`: a low-poly mesh per kind, a block per tile, `camera3d`). The lab
  picks 3D in the browser with `?backend=three` (the engine's `bootBrowserGame` with a lazily
  imported `threeDisplay`; see `games/platformer-lab/main.ts`), and
  `screenshot --backend three` uses `frame()`; it refuses software WebGL (exit 4) unless
  `--allow-software-gl`. Only `engine/backends/three` may import `three` (`PACKAGES` in
  `config/layers.js`).
- Browser (`main.ts`), from 0.7 for a game on a kit world: `bootBrowserGame` (`@engine/core/shell`)
  with `canvasDisplay` / `threeDisplay` and a `HostScene` drawing a `FramePicture` (see
  `games/platformer-lab/main.ts`). From 0.9, `pointer: true` adds mouse and touch gestures (tap,
  box, pan, zoom; `page.pointer`) and `touchPad: false` hides the touch pad; an RTS page scrolls and
  zooms with `RtsCamera` (`@engine/core/present`), and the Canvas2D presenter honours the frame's
  `zoom` (see `games/samples/rts-skirmish/main.ts` and `play.ts`). From 0.11, `audio: { sfx:
contentSfx(content), songs: contentSongs(content), music?, volumes? }` gives the page sound: the
  shell unlocks it on the first key, tap or click, starts `music`, and hands each display factory
  `{ onSound }` (`canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, onSound })`;
  see `games/platformer-test/main.ts`). A skin's `events` key may name a result:
  `"mini-game-end:pass"`, `"mini-game-end:fail"` (or `type:field=value`), with the bare type as the
  fallback. By hand (the demo): an `AssetRegistry` for palettes and sprites, a `CanvasRenderer` on a
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
`engine/tools/kit-list.ts`. A game reads its `kit`'s kinds plus those of every kit in `uses`
(`"uses": ["topdown"]` lets a platformer game hold `room` files for a mini game; only the kinds:
run rules and `mutants` stay `kit`'s). Every format:

<!-- generated:files -->

| Format                                         | From             | Where                                                                                                                                                   | Read from            | What it is                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game manifest (`game.json`)                    | engine           | `games/<game>/game.json`                                                                                                                                | `.json`              | Names the game and its kit, the files of each content kind, the start seed and the game's entry modules                                                                                                                                                                                                                                                       |
| Run file (`*.run.json`)                        | engine/tools     | `games/<game>/runs/<name>.run.json`; replay files in `.ww-out/replays/`                                                                                 | `.json`              | A seeded, scripted headless run and the checks it must pass (`pnpm cli run`)                                                                                                                                                                                                                                                                                  |
| World save (`saveWorld`)                       | engine/sim       | wherever a game keeps its saves; `saveWorld(world)` writes it, `loadWorld(json, options)` reads it                                                      | `.json`              | The whole simulated world (Engine 0.8): seed, tick, RNG state, next entity id, every entity's components, the system names and the event log                                                                                                                                                                                                                  |
| World scenario (`worldFromScenario`)           | engine/sim       | wherever a game keeps its world starts (the engine's sample: `engine/sim/__fixtures__/village.world.json`); `worldFromScenario(json, options)` reads it | `.json`              | A world written as data (Engine 0.8): the seed, the terrain as text grids of ground types and elevation digits, entities with their components, and squads with their named members                                                                                                                                                                           |
| RTS unit and building types (`rtsTypesSchema`) | engine/core      | a game's RTS data, held in the world by the `RtsTypes` component (in a world scenario: an entity's `RtsTypes`)                                          | `.json`              | The unit and building types an RTS world makes things from (Engine 0.9): stats, costs, build and training time, what a building trains and whether it takes drop-offs                                                                                                                                                                                         |
| `campaign`                                     | engine           | `content/`, claimed in `game.json` under `content.campaign`                                                                                             | `.json`              | A campaign: the order a game plays its levels or missions in, as a list of level and mission ids, with an optional entry to start at                                                                                                                                                                                                                          |
| `mission`                                      | engine           | `content/`, claimed in `game.json` under `content.mission`                                                                                              | `.json`              | A mission: its event, fixed world-time cost, the mini game it is played with, its params and its declared outcomes with delegation weights and effects                                                                                                                                                                                                        |
| `palette`                                      | engine           | `content/`, claimed in `game.json` under `content.palette`                                                                                              | `.json`              | A named list of colours (#rgb or #rrggbb) that sprite indices pick from                                                                                                                                                                                                                                                                                       |
| `sfx`                                          | engine           | `content/`, claimed in `game.json` under `content.sfx`                                                                                                  | `.json`              | An MML sound effect: id, optional bpm and up to four voices                                                                                                                                                                                                                                                                                                   |
| `skin`                                         | engine           | `content/`, claimed in `game.json` under `content.skin`                                                                                                 | `.json`              | How a backend shows a game: each kind as a sprite or mesh, tiles, event sounds and effects, the HUD                                                                                                                                                                                                                                                           |
| `song`                                         | engine           | `content/`, claimed in `game.json` under `content.song`                                                                                                 | `.json`              | An MML song: id, bpm, loop and up to four channels                                                                                                                                                                                                                                                                                                            |
| `sprite`                                       | engine           | `content/`, claimed in `game.json` under `content.sprite`                                                                                               | `.json` or `.txt`    | Text-grid pixel art: a palette name, an optional legend and named frames                                                                                                                                                                                                                                                                                      |
| `level`                                        | kit platformer   | `content/`, claimed in `game.json` under `content.level`                                                                                                | `.json` + `.map.txt` | A platformer level: id, physics profile, scroll mode, spawns and bump-block contents, with its map in a text grid of the kit legend                                                                                                                                                                                                                           |
| `profile`                                      | kit platformer   | `content/`, claimed in `game.json` under `content.profile`                                                                                              | `.json`              | A platformer physics profile: player movement numbers and actor types in whole sub-pixel and 1/4096 px per tick units                                                                                                                                                                                                                                         |
| `rts-map`                                      | kit rts          | `content/`, claimed in `game.json` under `content.rts-map`                                                                                              | `.json`              | An RTS map: a world scenario with the rts system set (terrain text grids, units, buildings, resource nodes)                                                                                                                                                                                                                                                   |
| `rts-types`                                    | kit rts          | `content/`, claimed in `game.json` under `content.rts-types`                                                                                            | `.json`              | RTS unit and building types: stats, costs, build and training times, what a building trains                                                                                                                                                                                                                                                                   |
| `rts-enemy`                                    | kit rts          | `content/`, claimed in `game.json` under `content.rts-enemy`                                                                                            | `.json`              | A scripted enemy's plan: its faction and the orders it gives, at ticks or on triggers                                                                                                                                                                                                                                                                         |
| `room`                                         | kit topdown      | `content/`, claimed in `game.json` under `content.room`                                                                                                 | `.json` + `.map.txt` | A top-down room: id, map cell, music, chests and an 11x16 map grid of the kit legend                                                                                                                                                                                                                                                                          |
| `mission-room` params                          | kit topdown      | the `params` of a `*.mission.json` whose `play` is `mission-room`                                                                                       | `.json`              | A mission over a world played as one top-down room (Engine 0.11): a `*.mission.json`'s `params` when its `play` is `mission-room`. Which world entities become which foes in the room's slot cells, the round's goal and limits, and ordered rules from the round's report to the mission's declared outcomes                                                 |
| `td-map`                                       | kit towerdefense | `content/`, claimed in `game.json` under `content.td-map`                                                                                               | `.json` + `.map.txt` | A tower-defense map: starting gold and lives, the tower types and wave list it plays, with its grid (path from entry to exit, build cells, blocked ground) in a text grid                                                                                                                                                                                     |
| `td-towers`                                    | kit towerdefense | `content/`, claimed in `game.json` under `content.td-towers`                                                                                            | `.json`              | Tower-defense tower types: cost, range in cells, damage, cooldown in ticks and sell value                                                                                                                                                                                                                                                                     |
| `td-waves`                                     | kit towerdefense | `content/`, claimed in `game.json` under `content.td-waves`                                                                                             | `.json`              | A tower-defense wave list: waves of enemy groups (kind, count, spacing, hp, speed, bounty) and an optional timer                                                                                                                                                                                                                                              |
| `td-defence` params                            | kit towerdefense | the `params` of a `*.mission.json` whose `play` is `td-defence`                                                                                         | `.json`              | A mission over a world played as one tower-defense round (Engine 0.12): a `*.mission.json`'s `params` when its `play` is `td-defence`. The map, which world entities (walls) stand on its build cells, where the gold comes from, the lives, which world units come as the wave, and ordered rules from the round's report to the mission's declared outcomes |

<!-- /generated:files -->

## The headless contract

```ts
interface HeadlessGame {
  step(input: InputFrame): void; // one tick
  snapshot(): JsonObject; // the whole state, plain JSON-safe data; must not change the game
  order?(order: JsonObject): string | null; // optional (Engine 0.9): a recorded order; null, or why it was dropped
  miniGame?(): MiniGame | null; // optional (Engine 0.10): the round hosted now, for HostScene and the tools
  mission?(step: JsonObject): MissionStepRefusal | null; // optional (Engine 0.11): a run file's mission step
  missionExperience?(): readonly { mission: string; ticks: number }[]; // optional (Engine 0.11): played rounds' ticks
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
- Missions in a game (Engine 0.11; see `games/samples/mini-siege/headless.ts`): wrap the kit's
  game in a `MissionHost` (`@engine/core/mission-host`) with `port: missionPort(world, { refs:
scenarioKeys(scenario) })` (`@engine/sim/index`), the game's `missions`, its `miniGames` and
  `adapters: { 'mission-room': topdownMissionAdapter }` (`@kits/topdown`). The host is itself a
  `HeadlessGame` with `mission(step)` and `miniGame()`: while a round is hosted a step steps the
  round only (the world, the enemy and orders wait); otherwise it steps the game and commits due
  missions. An RTS page offers launches with the kit's `missionButtons(view)` and opens one with
  `launchMission(view, id, host)`; the mission's room, foes and outcome rules are its `params`
  (`mission-room`, table above), and `validate` checks them. A tower-defense mission (Engine 0.12)
  is one more entry in both lists: `tdDefence({ maps, towers, size })` in `miniGames` and
  `[TD_DEFENCE]: towerdefenseMissionAdapter` in `adapters` (`@kits/towerdefense`); its `params`
  (`td-defence`, table above) pick the walls, the gold, the wave and the outcome rules. See the
  mini siege's `fortify` mission.
- A round may map the host's actions (`MiniGameDef.inputMap`, `{ "jump": "attack" }`) and show
  host HUD keys (`hostStatus: ['mission']`, drawn as `host:mission`); a button held into a round is
  ignored until released (Engine 0.11). A skin kind entry's `byTag: [{ tag, frames?, palette?,
mesh? }]` picks a look by an entity's tag (`frozen`, `damaged`, `site`, `foe:ram`, `look:<id>`),
  first match wins.

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

A run file can play a world instead of a game (Engine 0.8): `"world": "village.world.json"` (a
`*.world.json` scenario, relative to the run file) in place of `game`, exactly one of the two. A
world run has no `input`, `disableRules` or `guards`; its paths read the world snapshot
(`components.Construction.0.1.done`: entry 0 of that kind in id order, `.1` its data). `run`,
`dump`, hashes and replays work on it; `mutants` and `screenshot` refuse it. Sample:
`engine/sim/__fixtures__/village-build.run.json`.

Recorded orders and sync hashes (Engine 0.9): `"orders": [{ "tick": 40, "id": 1, "faction": "red",
"type": "move", "units": [7], "target": { "x": 9, "y": 6 } }]` are applied after that tick's state
and before the step from it (a world run applies them through `engine/sim`, which needs a scenario
with `"systems": "rts"`; a game run hands them to the game's `order` method), and `"hashes":
[{ "tick": 20, "hash": "..." }]` are sync hashes `run` checks, stopping at the first that differs
(exit 4, naming that tick and the last that matched). A battle played in the RTS sample's page
exports as such a run file. Samples: `engine/sim/__fixtures__/battle.run.json`,
`games/samples/rts-skirmish/runs/battle.run.json`.

Missions (Engine 0.10): a world run's `"missions": [{ "tick": 5, "mission": "raid", "action":
"open" }, { "tick": 5, "mission": "raid", "action": "play", "outcome": "partial",
"experienceTicks": 240 }]` open, `delegate`, `play` or `quit` missions (defined in
`<id>.mission.json` beside the scenario) after that tick's orders; each commits by itself at open
tick + `worldTimeCost`. Refused steps are listed in `refusedMissions`, not failures;
`experienceTicks` are only reported (`experience`) and never move the world. Samples:
`engine/sim/__fixtures__/raid-partial.run.json` and its neighbours.

Missions in game runs (Engine 0.11): a game run's `"missions"` go to the game's `mission` method
(a `MissionHost`, `engine/core/mission-host.ts`), `{ "tick": 3, "mission": "sabotage", "action":
"play", "input": { "steps": [{ "frame": 0, "hold": ["attack"] }] } }`: `play` starts the real kit
round (its `input` the round's own script, frame 0 its first tick) and the run's next ticks play it
while the world waits; the world then steps on and the result commits at open tick +
`worldTimeCost`. No `outcome` or `experienceTicks` on a game run (the round gives both:
`experience` comes from the game); a game without `mission` is a usage error.

<!-- generated:run-file -->

| Field                            | Type                                                                                                         | Default        | Description                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game`                           | `string`                                                                                                     |                | the game folder, relative to the run file (".." for games/&lt;g>/runs/); give this or `world`                                                                                                                                                                                                                         |
| `world`                          | `string`                                                                                                     |                | a world scenario (*.world.json, engine/sim), relative to the run file, played instead of a game; give this or `game`                                                                                                                                                                                                  |
| `seed`                           | `integer`                                                                                                    |                | the world's seed; the manifest's start.seed (or the scenario's seed) if left out                                                                                                                                                                                                                                      |
| `ticks`                          | `integer`                                                                                                    | required       | how many steps the run plays                                                                                                                                                                                                                                                                                          |
| `input`                          | `object`                                                                                                     | `{"steps":[]}` | the scripted input (ScriptedInput steps)                                                                                                                                                                                                                                                                              |
| `input.steps`                    | `object[]`                                                                                                   | required       | each step holds its actions from its frame until the next step                                                                                                                                                                                                                                                        |
| `input.steps[].frame`            | `integer`                                                                                                    | required       | the input frame the hold starts at                                                                                                                                                                                                                                                                                    |
| `input.steps[].hold`             | `("left" \| "right" \| "up" \| "down" \| "jump" \| "attack" \| "special" \| "start" \| "select" \| "run")[]` | required       | the actions held from that frame on                                                                                                                                                                                                                                                                                   |
| `assertions`                     | `object[]`                                                                                                   | `[]`           | checks made at one tick each                                                                                                                                                                                                                                                                                          |
| `assertions[].tick`              | `integer`                                                                                                    | required       | the tick the check is made at                                                                                                                                                                                                                                                                                         |
| `assertions[].path`              | `string`                                                                                                     | required       | a dotted path into the snapshot: hero.hp, entities.0.kind, entities.length                                                                                                                                                                                                                                            |
| `assertions[].op`                | `"eq" \| "ne" \| "lt" \| "lte" \| "gt" \| "gte" \| "in" \| "nin" \| "contains"`                              | required       | the comparison: eq, ne, lt, lte, gt, gte, in, nin, contains                                                                                                                                                                                                                                                           |
| `assertions[].value`             | `JSON`                                                                                                       | required       | what the value at the path is compared with                                                                                                                                                                                                                                                                           |
| `invariants`                     | `object[]`                                                                                                   | `[]`           | checks made at every tick, 0 included                                                                                                                                                                                                                                                                                 |
| `invariants[].path`              | `string`                                                                                                     | required       | a dotted path into the snapshot: hero.hp, entities.0.kind, entities.length                                                                                                                                                                                                                                            |
| `invariants[].op`                | `"eq" \| "ne" \| "lt" \| "lte" \| "gt" \| "gte" \| "in" \| "nin" \| "contains"`                              | required       | the comparison: eq, ne, lt, lte, gt, gte, in, nin, contains                                                                                                                                                                                                                                                           |
| `invariants[].value`             | `JSON`                                                                                                       | required       | what the value at the path is compared with                                                                                                                                                                                                                                                                           |
| `hashEvery`                      | `integer`                                                                                                    | `60`           | a state hash every this many ticks (tick 0 and the last tick always get one)                                                                                                                                                                                                                                          |
| `disableRules`                   | `string[]`                                                                                                   | `[]`           | kit rules switched off for this run (ids from the kit's rule list; see `mutants`)                                                                                                                                                                                                                                     |
| `guards`                         | `string[]`                                                                                                   |                | the kit rules this run is meant to guard (ids from the kit's rule list); `mutants` checks these, or every rule when left out                                                                                                                                                                                          |
| `orders`                         | `object[]`                                                                                                   | `[]`           | recorded orders, `{ tick, ...order }` in tick order, applied before the step from their tick (world runs: engine/core orders; game runs: the game's `order` method)                                                                                                                                                   |
| `orders[].tick`                  | `integer`                                                                                                    | required       | the tick the order applies at: after that tick's state, before the step from it                                                                                                                                                                                                                                       |
| `orders[].id`                    | `integer`                                                                                                    |                | the order number (required on a world run): unique, ascending within a tick                                                                                                                                                                                                                                           |
| `missions`                       | `object[]`                                                                                                   | `[]`           | mission steps, `{ tick, mission, action, ... }` in tick order, applied after the tick's orders, before the step from it (world runs: `outcome?`, `experienceTicks?`; game runs: the game's `mission` method, `input?` on a `play`)                                                                                    |
| `missions[].tick`                | `integer`                                                                                                    | required       | the tick it applies at: after that tick's state and orders, before the step from it                                                                                                                                                                                                                                   |
| `missions[].mission`             | `string`                                                                                                     | required       | the mission id: on a world run its definition is &lt;id>.mission.json beside the world scenario; on a game run one of the game's missions                                                                                                                                                                             |
| `missions[].action`              | `"open" \| "delegate" \| "play" \| "quit"`                                                                   | required       | `open` (freezes its event, fixes its commit tick), `delegate` (an outcome drawn by weight, seeded from the world seed and the mission id), `play` (world run: the outcome chosen; game run: the real kit round, played until it ends) or `quit` (its `onQuit` outcome); the commit comes by itself at the commit tick |
| `missions[].outcome`             | `string`                                                                                                     |                | world runs, `play` only, required there: the outcome the played round reached                                                                                                                                                                                                                                         |
| `missions[].experienceTicks`     | `integer`                                                                                                    |                | world runs, `play` and `quit` only: ticks spent inside the stand-in round; reported in the result, never moving the world                                                                                                                                                                                             |
| `missions[].input`               | `object`                                                                                                     |                | game runs, `play` only: the round's recorded input (ScriptedInput steps, frame 0 the round's first tick); left out, the round reads the run's input                                                                                                                                                                   |
| `missions[].input.steps`         | `object[]`                                                                                                   | required       | each step holds its actions from its frame until the next step                                                                                                                                                                                                                                                        |
| `missions[].input.steps[].frame` | `integer`                                                                                                    | required       | the input frame the hold starts at                                                                                                                                                                                                                                                                                    |
| `missions[].input.steps[].hold`  | `("left" \| "right" \| "up" \| "down" \| "jump" \| "attack" \| "special" \| "start" \| "select" \| "run")[]` | required       | the actions held from that frame on                                                                                                                                                                                                                                                                                   |
| `hashes`                         | `object[]`                                                                                                   |                | sync hashes the run must give, in tick order: `run` fails at the first tick whose state hash differs                                                                                                                                                                                                                  |
| `hashes[].tick`                  | `integer`                                                                                                    | required       | the tick the hash was taken at                                                                                                                                                                                                                                                                                        |
| `hashes[].hash`                  | `string`                                                                                                     | required       | the state hash at that tick                                                                                                                                                                                                                                                                                           |
| `replay`                         | `object`                                                                                                     |                | only in replay files: the source run, its failing check and its hashes                                                                                                                                                                                                                                                |

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
| `dump`       | `pnpm cli dump <runFile> [flags]`       | the whole game or world state at one tick of a run file, as JSON                          |
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
