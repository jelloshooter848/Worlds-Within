---
name: scaffold-game
description: Make a new game in games/<name>/ on the top-down kit, or on the platformer kit (its own section) (game.json, one room, a skin, headless and view entries, a browser page, a run file with golden hashes, agent docs) that passes `pnpm cli validate` and `pnpm cli run`. Use when asked to start a new game, sample game or test game.
---

# Scaffold a game

Makes `games/<name>/`: a one-room game on the `topdown` kit that passes `validate`, `run` and the
repo's four checks. Grow it from there (more rooms, songs, sprites) by adding data files, not code.
Read [`llms.txt`](../../../llms.txt) and the [cheat sheet](../../../docs/CHEATSHEET.md) first;
`games/demo/` is a complete working example of every file below.

Rules that apply throughout:

- `<name>` is lower-case letters, digits and `-` (`a-z0-9-`, starting with a letter or digit), and is
  both the folder name and `id` in `game.json`. It must not be `samples` (that folder groups the
  sample games: put a sample in `games/samples/<name>/` instead, and adjust the paths below).
- The game imports only `@engine/...`, `@kits/...` and its own files. Never another game.
- Content (rooms, songs, sprites, palettes) lives in `content/` as data files, never in `.ts` files.
- Run every CLI command as `pnpm -s cli <command> ... --json` from the repo root (`-s` keeps pnpm's
  banner off stdout, so stdout is exactly one JSON object). Exit codes: 0 ok, 2 usage, 3 invalid
  content (the result's `errors` name the file and field), 4 failed check, 5 crash.

## 1. The manifest: `games/<name>/game.json`

```json
{
  "id": "<name>",
  "title": "One line saying what the game is",
  "kit": "topdown",
  "content": {
    "room": ["content/rooms/*.json"],
    "palette": ["content/palettes/*.json"],
    "sprite": ["content/sprites/*.txt"],
    "skin": ["content/skins/*.json"]
  },
  "start": { "seed": 1 },
  "screen": { "width": 256, "height": 240 },
  "headless": "headless.ts",
  "view": "view.ts"
}
```

Every file under `content/` must be claimed by one kind in `content` (else `unclaimed_file`). Add a
kind's line only when you add its files, for example `"song": ["content/songs/*.json"]`; a glob that
matches no file is an error. `screen` is the picture size in pixels (256x240 when left out; the
top-down kit's HUD band plus one room is 256x240). Field details: `docs/reference/schemas.md` (Game
manifest).

## 2. One room: `content/rooms/<room>.json` + `content/rooms/<room>.map.txt`

`content/rooms/hall.json` (`id` must equal the file name, `at` is the room's `[x, y]` cell on the
map grid):

```json
{ "id": "hall", "at": [0, 0] }
```

`content/rooms/hall.map.txt`: exactly 11 rows of exactly 16 characters, no trailing spaces. One room
in the whole game must hold the player start `@`. With one room, close the border with walls `#`
(a doorway `O` on the border would lead to a room that does not exist).

```text
################
#..............#
#..............#
#..............#
#..............#
#......@.......#
#..............#
#..............#
#..............#
#..............#
################
```

Map characters (the kit's `LEGEND`, `kits/topdown/room.ts`): `#` wall, `.` floor, `:` other floor,
`B` block, `S` statue, `~` water, `O` open door, `L` locked door, `@` player start, `h` heart,
`k` key, `c` chest (contents in the JSON's `chests`), `b` bat, `n` knight, `r` spitter; the full
list is in `kits/topdown/room.ts`. Every room field (`music`, `chests`, `hint`, `dark`...) is in
`docs/reference/schemas.md` (`room`).

## 2b. Art and the skin: `content/palettes/flat.json`, `content/sprites/flat.txt`, `content/skins/canvas2d.json`

Kits never draw: the kit describes each frame (`presentWorld`) and the Canvas2D backend draws it
through a skin, which maps each presented kind (`hero`, `knight`, `pickup:heart`, ...) and each map
tile character to a frame of a sprite file. Start with flat placeholder art and replace the pixels
later (`games/demo/content/` has a full skin; `kits/topdown/CLAUDE.md` lists every kind, animation
state and tile character the kit presents).

`content/palettes/flat.json` (`id` must equal the file name):

```json
{
  "id": "flat",
  "colors": ["#0c2440", "#183c5c", "#00a800", "#bcbcbc", "#f83800", "#ac7c00", "#000000", "#fcfcfc"]
}
```

`content/sprites/flat.txt` (text pixel art: `legend` maps each character to a palette index,
`.` is clear; each frame is its rows under `frame <name>`, frames apart by a blank line):

```text
palette flat
legend . clear
legend w 0
legend f 1
legend g 2
legend s 3
legend r 4
legend l 5
legend k 6
legend y 7

frame wall
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww
wwwwwwwwwwwwwwww

frame floor
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff
ffffffffffffffff

frame door-open
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk
kkkkkkkkkkkkkkkk

frame door-locked
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll
llllllllllllllll

frame hero
................
.....gggggg.....
....gggggggg....
....ggyggygg....
....gggggggg....
.....gggggg.....
...gggggggggg...
..gggggggggggg..
..gggggggggggg..
..gg.gggggg.gg..
....gggggggg....
....gggggggg....
....ggg..ggg....
....ggg..ggg....
...gggg..gggg...
................

frame knight
................
.....ssssss.....
....ssssssss....
....ssksskss....
....ssssssss....
.....ssssss.....
...ssssssssss...
..ssssssssssss..
..ssssssssssss..
..ss.ssssss.ss..
....ssssssss....
....ssssssss....
....sss..sss....
....sss..sss....
...ssss..ssss...
................

frame sword-v
yyy
yyy
yyy
yyy
yyy
yyy
yyy
yyy
yyy
yyy
yyy
yyy
yyy
yyy
yyy
yyy

frame sword-h
yyyyyyyyyyyyyyyy
yyyyyyyyyyyyyyyy
yyyyyyyyyyyyyyyy

frame heart
.rr.rr..
rrrrrrr.
rrrrrrr.
rrrrrrr.
.rrrrr..
..rrr...
...r....
........
```

`content/skins/canvas2d.json` (a state the kit presents but the skin leaves out falls back to
`idle`; a kind or tile the skin leaves out is drawn as a magenta box, so a gap is easy to spot):

```json
{
  "backend": "canvas2d",
  "sheets": { "sheet": "flat", "fallbackColor": "#fcfcfc" },
  "kinds": {
    "hero": { "frames": { "idle": "hero" } },
    "sword": {
      "frames": { "stab": { "up": "sword-v", "down": "sword-v", "left": "sword-h", "right": "sword-h" } }
    },
    "knight": { "frames": { "idle": "knight" } },
    "pickup:heart": { "frames": { "idle": "heart" } }
  },
  "tiles": {
    "#": { "frame": "wall" },
    ".": { "frame": "floor" },
    "O": { "frame": "door-open" },
    "L": { "frame": "door-locked" }
  }
}
```

Check the content now, before writing any code:

```sh
pnpm -s cli validate games/<name> --json
```

Exit 0 means every file passes. On exit 3, fix each entry of `errors` (it names `file` and the field
`path`, with `row`/`col` for a map grid) and validate again. `validate` checks content only: it never
opens the `headless` and `view` modules `game.json` names, so it passes before they exist. `run`
(step 6) is what proves the entry works.

## 3. The headless entry: `headless.ts`

What `run`, `dump` and `mutants` import (the `headless` path in `game.json`). It gets the content
already loaded and checked.

```ts
import { contentOf, type ContentBundle } from '@engine/core/content/bundle';
import type { HeadlessGame, HeadlessOptions } from '@engine/core/headless';
import { buildDungeon, roomKind, TopDownWorld, topdownGame } from '@kits/topdown';

const ROOM = roomKind();

/** The world from the loaded content and a seed (the manifest's `start.seed` when none is given). */
export function createWorld(
  content: ContentBundle,
  seed = content.manifest.start.seed,
  disabledRules: readonly string[] = [],
): TopDownWorld {
  const rooms = contentOf(content, ROOM).map((e) => e.value);
  return new TopDownWorld(buildDungeon(rooms), { seed, disabledRules });
}

/** The engine's headless contract (`engine/core/headless.ts`), for `pnpm cli run`, `dump` and `mutants`. */
export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): HeadlessGame {
  return topdownGame(createWorld(content, seed, opts.disabledRules));
}
```

## 4. The view entry: `view.ts`

What `screenshot` imports, and what the browser page draws. Its `step` and `snapshot` must be the
headless game's. It never draws by itself: each `render` asks the kit for a frame (`presentWorld`)
and hands it to the backend's `SkinnedCanvasPresenter` with the skin.

```ts
import { AssetRegistry } from '@engine/core/assets/registry';
import { sheetLookup } from '@engine/core/assets/sheet-lookup';
import { contentOf, type ContentBundle } from '@engine/core/content/bundle';
import { PALETTE_KIND, SKIN_KIND, SPRITE_KIND } from '@engine/core/content/engine-kinds';
import type { PaletteTable } from '@engine/core/gfx/palette';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { HeadlessOptions } from '@engine/core/headless';
import { freezeFrame } from '@engine/core/present';
import type { ViewGame } from '@engine/core/view';
import { SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import { presentWorld, snapshotWorld, TdPresentState } from '@kits/topdown';
import { createWorld } from './headless';

/** The headless game plus drawing (`engine/core/view.ts`), for `pnpm cli screenshot` and `main.ts`. */
export function createView(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): ViewGame {
  const world = createWorld(content, seed, opts.disabledRules);
  const skin = contentOf(content, SKIN_KIND).find((e) => e.value.backend === 'canvas2d')?.value;
  if (!skin) throw new Error('no canvas2d skin (content/skins/canvas2d.json)');
  // The sprite sheets by id (the file name), drawn with their palettes.
  const palettes: PaletteTable = {};
  for (const e of contentOf(content, PALETTE_KIND)) palettes[e.value.id] = e.value.colors;
  const assets = new AssetRegistry({ default: palettes });
  for (const e of contentOf(content, SPRITE_KIND)) assets.define(e.name, e.value);
  const sheets = sheetLookup(assets);
  const screen = content.manifest.screen;
  const state = new TdPresentState();
  // As `topdownGame` (the headless contract): each step takes the events it emitted.
  let events: object[] = world.events.splice(0);
  let drawing: { r: Renderer; presenter: SkinnedCanvasPresenter } | null = null;
  return {
    step(input) {
      world.update(input);
      events = world.events.splice(0);
    },
    snapshot: () => snapshotWorld(world, events),
    screen,
    render(r) {
      // The kit's camera puts the room under its HUD band, so the map is not re-centred (clamp off).
      if (drawing?.r !== r) {
        drawing = {
          r,
          presenter: new SkinnedCanvasPresenter(r, skin, sheets, { size: screen, clamp: false }),
        };
      }
      drawing.presenter.present(freezeFrame(presentWorld(world, events, { state, size: screen })));
    },
  };
}
```

## 5. The browser page: `index.html` and `main.ts`

`index.html`: copy `games/demo/index.html` as is (a full-window `<canvas id="screen">` and
`<script type="module" src="./main.ts">`), changing only the `<title>`. `pnpm build` finds every
`games/*/index.html` by itself and the launcher links to it.

`main.ts` (the demo's `main.ts` adds audio, sprites and a scene stack). The canvas is the
manifest's `screen` size, and the view draws through the skin:

```ts
import { loadContent } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import { formatErrors } from '@engine/core/content/validate';
import { GamepadSource } from '@engine/core/input/gamepad';
import { InputManager } from '@engine/core/input/input-manager';
import { KeyboardSource } from '@engine/core/input/keyboard';
import { FixedLoop } from '@engine/core/loop';
import { CanvasRenderer, Viewport } from '@engine/backends/canvas2d';
import { roomKind } from '@kits/topdown';
import { createView } from './view';

// The game's data files as { path: text } pairs, bundled by Vite (Node tools use readGameFiles).
const files = import.meta.glob(['./game.json', './content/**/*'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function boot(): void {
  const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#screen canvas missing');
  const loaded = loadContent(files, engineContentKinds().register(roomKind()), {
    root: 'games/<name>/',
  });
  if (!loaded.ok) throw new Error(`content errors:\n${formatErrors(loaded.errors)}`);
  const game = createView(loaded.value, loaded.value.manifest.start.seed);

  const viewport = new Viewport(canvas, { integerScale: false }, loaded.value.manifest.screen);
  const renderer = new CanvasRenderer(viewport.ctx);
  const input = new InputManager(1);
  input.addSource('keyboard', new KeyboardSource());
  if (GamepadSource.available()) input.addSource('gamepad', new GamepadSource());

  new FixedLoop({
    step() {
      input.beginFrame();
      game.step(input.player(0));
    },
    render() {
      game.render(renderer);
      viewport.present();
    },
  }).start();
}

boot();
```

## 6. A run file: `runs/<run>.run.json`

A seeded, scripted headless run with checks. `game` is the game folder relative to the run file.
Tick 0 is the start; tick `t` is the state after `t` steps. Paths are dotted into the snapshot;
`pnpm -s cli dump games/<name>/runs/<run>.run.json --tick 0 --json` shows them all (`room`,
`hero.x`, `hero.y`, `hero.hp`, `hero.room`, `entities`...). A tile is 16 pixels; the hero starts at
the `@` cell's pixel corner (column 7, row 5 is `x` 112, `y` 80) and walks about 1.5 pixels a tick.

`runs/walk-east.run.json`:

```json
{
  "game": "..",
  "ticks": 60,
  "input": { "steps": [{ "frame": 0, "hold": ["right"] }] },
  "assertions": [
    { "tick": 0, "path": "hero.room", "op": "eq", "value": "hall" },
    { "tick": 60, "path": "hero.x", "op": "gt", "value": 112 }
  ],
  "invariants": [
    { "path": "hero.hp", "op": "gte", "value": 0 },
    { "path": "hero.dead", "op": "eq", "value": false }
  ],
  "hashEvery": 20
}
```

Run it:

```sh
pnpm -s cli run games/<name>/runs/walk-east.run.json --json
```

Exit 0 with `"passed": true` is a pass. On exit 4, read `failure` (`tick`, `path`, `expected`,
`actual`) and follow the `debug-failing-run` skill; check values with `dump` at that tick rather than
guessing. On exit 5 read `error.message` and `error.stack` (usually a mistake in `headless.ts`).

Then write the golden state hashes (`runs/walk-east.hashes.json`), which `pnpm test` compares with
every run of every run file:

```sh
WW_UPDATE_GOLDEN=1 pnpm test tests/runs
```

It plays every run file of every game and rewrites each one's `.hashes.json`, so afterwards
`git status` should show only your new file changed; if another game's hashes changed, something
else is wrong (undo that file and investigate). Commit the `.hashes.json` with the run file. Rerun
that command only after a change meant to change the game's state.

## 7. Agent docs

Every game folder needs these, or `pnpm test` fails (`tests/architecture/agent-docs.test.ts`):

- `games/<name>/CLAUDE.md`: what the game is, its files, how to run and test it, and its imports
  (model: `games/demo/CLAUDE.md`).
- `games/<name>/AGENTS.md`: one line pointing at `CLAUDE.md` (copy `games/demo/AGENTS.md`, renaming).
- `docs/modules/games-<name>.md` (for a sample, `docs/modules/games-samples-<name>.md`): purpose,
  public entry points, imports allowed, how to test (model: `docs/modules/games-demo.md`).
- A line in `llms.txt` under `## Modules` linking that page:
  `- [games/<name>](docs/modules/games-<name>.md): one line saying what it is`.

## 8. Check it

From the repo root, in order:

```sh
pnpm -s cli validate games/<name> --json                     # exit 0
pnpm -s cli run games/<name>/runs/walk-east.run.json --json  # exit 0, "passed": true
pnpm -s cli run games/<name>/runs/walk-east.run.json --json  # same "hashes" as the first run
pnpm -s cli screenshot games/<name>/runs/walk-east.run.json --tick 30 --json  # optional, needs Chromium
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Read each command's exit code (`echo $?`, or `exitCode` in a CLI result); piping a command through
`tail` or `head` hides it. If `pnpm lint` fails only on formatting, run `pnpm format` and lint again.
Delete `dist/` after `pnpm build`. `.ww-out/` is the CLI's output folder (capped results, replays,
screenshots); it is git-ignored and safe to leave or delete.

## Platformer games (the `platformer` kit)

The steps above are for the top-down kit. A game on the platformer kit has the same files with
these differences; `games/platformer-lab/` is a complete working example of every one.

- `game.json`: `"kit": "platformer"` and the kinds `"level": ["content/levels/*.json"]` and
  `"profile": ["content/profiles/*.profile.json"]` (keep profiles out of `content/levels/`, or the
  level glob claims them too), plus `palette`, `sprite` and `skin` as above.
- A profile, `content/profiles/<id>.profile.json`: the player's movement numbers and the actor
  types, in whole sub-pixel units. Start from a copy of `kits/platformer/__fixtures__/runner.profile.json`
  (SMBC's default runner) and change its `id`; every field is in `docs/reference/schemas.md`
  (`profile`).
- A level, `content/levels/<id>.json` (`{ "id": "<id>", "profile": "<profile id>", "scroll": "right" }`,
  plus `spawns`, `blocks` and `triggers` when the map uses them) and `content/levels/<id>.map.txt`:
  one character per 16x16 tile, all rows the same length, exactly one `@` and at least one `G`.
  Characters: `.` empty, `#` solid, `B` brick, `?` bump block, `=` one-way platform, `^` hazard,
  `o` coin, `@` start, `G` goal, `!` mini-game trigger; enemy spawns are characters of your own
  named in `spawns` (`"w": { "actor": "walker" }`).

  ```text
  ........................
  ...............o........
  .@..........w......##.G.
  ########....############
  ```

- The skin maps the kit's kinds (`runner`, `coin`, `goal`, `trigger`, `bump-block` and each actor
  type of your profiles), their animation states (`RUNNER_ANIMS`, `ACTOR_ANIMS`), the map
  characters (`PRESENT_TILES`: `. # B ? u = ^`), the events and the HUD values (`coins`, `hp`,
  `lives`, ...); the full table is in `kits/platformer/CLAUDE.md` (Presentation frames). Give it
  `"camera": { "follow": "runner", "deadzone": { "w": 32, "h": 48 }, "lerp": 0.25 }` so the view
  follows the runner smoothly (the kit's camera hint adds the scroll lock).
- `headless.ts`: build the world from the level and its profile and wrap it with the kit's
  `platformerGame`:

  ```ts
  import { contentOf, type ContentBundle } from '@engine/core/content/bundle';
  import type { HeadlessGame, HeadlessOptions } from '@engine/core/headless';
  import { levelKind, platformerGame, PlatformerWorld, profileKind } from '@kits/platformer';

  export function createGame(content: ContentBundle, seed: number, opts: HeadlessOptions = {}): HeadlessGame {
    const level = contentOf(content, levelKind())[0]!.value;
    const profile = contentOf(content, profileKind()).find((e) => e.value.id === level.profile)!.value;
    return platformerGame(new PlatformerWorld(level, profile, { seed, disabledRules: opts.disabledRules }));
  }
  ```

  Pass `miniGames: [...]` (`MiniGameDef`s, `engine/core/minigame.ts`) when a level has triggers.
- `view.ts` and the picture: as above, with the kit's `presentWorld(world, events, { state, size })`
  and a `PlatformerPresentState` per stream of frames (`games/platformer-lab/picture.ts`). No
  `clamp: false`: the kit's camera hint and the map keep the view inside the level.
- `main.ts`: as above; with triggers, push `miniGameScene` (`@engine/core/minigame-scene`) over the
  level scene when `world.miniGame` is set (`games/platformer-lab/scene.ts`).
- Run files: the snapshot paths are in `kits/platformer/CLAUDE.md` (`player.x`, `coins`,
  `outcome`, `events`, ...). The platformer kit is **strict**: `pnpm -s cli mutants games/<name> --json`
  exits 4 until the game's run files together guard every kit rule, so give each run `guards` and
  assertions on what those rules decide (a position at a tick, a count, an event). `pnpm -s cli run`, `validate` and
  the four checks do not need `mutants` to pass, so a first one-level game can add the guarding
  runs later; `games/platformer-lab/CLAUDE.md` (Run files) shows a set that guards every rule.

## Common mistakes

- Map rows not exactly 16 characters, or not 11 rows: `validate` names the file, row and column.
- No `@` anywhere, or more than one: `run` crashes with `no room has a player start (@)`.
- A room's `id` not matching its file name, or a `.json` room without its `.map.txt`.
- A file in `content/` that no kind in `game.json` claims (`unclaimed_file`), such as a skin
  without the `"skin"` line.
- Drawing from the kit: there is no kit drawing function. Present the world (`presentWorld`) and
  let the backend draw it through the skin.
- A `run` file whose `game` is not `".."` when it sits in `games/<name>/runs/`.
- Forgetting the golden `.hashes.json`, or the docs page and `llms.txt` line: `pnpm test` fails
  and its message says which.
