# Worlds Within: Roadmap

**Status: draft for review.** Nothing here is final until the owner signs off.

The plan is **engine first, game second**. We build a small engine that an LLM coding assistant can
use well, prove it on small sample games, take it to its own 1.0, and only then start Worlds Within on
top of it. The engine principles behind this order are in [DESIGN.md](DESIGN.md#engine-principles).

## Two version lines

There are two products in this repo, and each has its own version numbers:

- **The engine** (core, backends, kits, the world simulation, the tools, and the sample games that
  prove them). It goes from **Engine 0.1** to **Engine 1.0**. This page plans it in detail.
- **Worlds Within**, the game. Its own line (**Worlds Within 0.1**, 0.2, and on to **Worlds Within
  1.0**) starts only after Engine 1.0 has shipped. This page plans it more lightly, because it is
  further out.

Before 1.0, every release is a 0.x, and the numbers count up past 9 (0.10 comes after 0.9). A
release number on its own, like "0.9", always means an engine release on this page. Worlds Within
releases are always written with the game's name: "Worlds Within 0.1".

**How releases are tagged.** Git tags always use a full three-part version, and carry a prefix so the
two lines can never collide:

- engine releases: `engine-v0.5.0`, `engine-v0.5.1`, `engine-v0.10.0`, `engine-v1.0.0`;
- Worlds Within releases: `ww-v0.1.0`, `ww-v1.0.0`.

In prose a release keeps its short name ("Engine 0.5", "Worlds Within 0.1"). Its first tag is `.0`
(`engine-v0.5.0`), and later fixes to it are `.1`, `.2` and so on (`engine-v0.5.1`). A patch release
is bug fixes only, with no new features. A two-part tag like `engine-v0.5` is never used, and neither
is a plain `v*` tag.

Every tag publishes its games, patch releases included. On an `engine-v*` tag, CI publishes every
engine sample game in `games/` to GitHub Pages. On a `ww-v*` tag, it publishes Worlds Within. The root
`package.json` version follows the engine line with all three parts (`0.5.0` at Engine 0.5); Worlds
Within keeps its own version in its own folder.

## The order

**Engine track (0.2 to 1.0):**

1. **The base layer** (0.2 to 0.4): the repo restructure, the LLM tooling, and the presentation
   contract.
2. **The platformer kit** (0.5): SMBC's platformer, with its rules separated from its drawing.
3. **A basic 3D backend** (0.6): Three.js, with just enough to show the platformer kit.
4. **The stacking test** (0.7): a simple original game, shown in 2D and in 3D, with every gap written
   down.
5. **The multi-genre layer** (0.8 to 0.13): the world simulation, the RTS kit, time and the mission
   contract, a mini siege that puts them together, the tower-defense kit, and heroes and consequences.
6. **Tools and samples** (0.14 to 0.15): creator tools, and a finished sample game for every kit. At
   0.15 the demo and the stacking-test game become samples, and their old folders go away.
7. **Engine 1.0**: documented internal APIs (v1), complete agent docs, and every sample playable from
   a link.

**Worlds Within track (after Engine 1.0):** the full Siege, heroes and the campaign, a third mode,
Chapter 1 content and art, then **Worlds Within 1.0: Chapter 1**.

Each release ends with something that can be played or tested. From 0.2 on, every tagged engine
release publishes each game in `games/` to GitHub Pages, so it can be played from a link.

**Every release must keep the old ones working.** The demo, every test game and every sample stay
playable, and their run files stay green, from the release that adds them onwards. When the demo and
the stacking-test game become samples at 0.15, their run files move with them and must stay green.

### Sample games

From 0.9 on, each engine release proves itself with a **sample game**: a small, original game in
`games/samples/<name>/` built only from engine parts and its own content. Samples are not Worlds Within
and never borrow its content. They have three jobs:

- **A home for each kit's assets.** Every kit gets real, original art, sound and levels to be shown
  with, instead of test fixtures only.
- **End-to-end tests.** Each sample's run files run in CI, so a change anywhere in the engine that
  breaks a real game is caught.
- **Worked examples for LLMs.** Each sample has its own `CLAUDE.md` saying how it was built. An agent
  making a new game copies from the nearest sample.

Engine 1.0 requires five samples, all of them: a platformer level, a top-down dungeon, an RTS
skirmish, a tower-defense map, and a **mini siege** that joins several genres through the world
simulation (see 0.11). The platformer sample grows out of the stacking-test game (0.7) and the dungeon
sample out of the demo; both move into `games/samples/` at 0.15.

Samples are games: they live under `games/`, and the dependency rule applies to them like any other
game. The engine never imports from them.

### Words used on this page

- **Kit:** the rules of one kind of gameplay (platformer, top-down, RTS). A kit never draws.
- **Backend:** the code that draws: 2D sprites, or 2.5D/3D. A backend never holds rules.
- **Skin:** a text file that tells a backend what each kind of thing looks like ("`walker` uses this
  sprite" or "this mesh").
- **Run file:** a text file that says how to run a game headless: the seed, the scripted button
  presses, how many ticks, and what must be true along the way.
- **Tick:** one step of the game's fixed 60-per-second update.
- **Headless:** running without a screen, for tests and tools.
- **State hash:** a short fingerprint of the whole game state. Equal hashes mean equal states.
- **Sample game:** a small original game in `games/samples/` that shows one kit (or several) working
  end to end.

---

# Engine track

## 0.1 Foundation (done)

**Goal:** a working TypeScript repo built on the engine from SMBC REMIX.

- `src/engine`: copied from SMBC v0.4.73, which has nothing game-specific in it. It has the fixed 60 Hz
  loop, a stack of scenes, a renderer interface with a null renderer for headless runs, keyboard,
  gamepad and touch input, the chiptune synthesizer (MML), saving and the seeded RNG. SMBC's Classic
  options, save progress, install-to-home-screen and share-link files were left out, and its settings
  file was cut down to what the engine itself reads.
- `src/kits/topdown`: SMBC's top-down kit (rooms from text, doors, sword hero, items, enemies, towns).
- `ScriptedInput`, moved into the engine (`engine/input/scripted-input.ts`) so headless tests, bots and
  delegated missions can share it.
- A demo scene (`src/game/demo`): three top-down rooms and an original song, to prove it all runs.
- Tooling: Vite, Vitest, ESLint and Prettier, plus CI that runs lint, typecheck, tests and build.

**Done when:** CI is green and `pnpm dev` plays the demo. _(Done.)_

---

## 0.2 Restructure and the dependency rule (done)

**Goal:** the repo has the target layout, and the line between engine and game is enforced by tools,
not by memory.

**Scope:**

- Move to the target layout (see [DESIGN.md](DESIGN.md#architecture)):
  - `engine/core`: loop, scenes, input, audio, save, RNG, maths.
  - `engine/backends/canvas2d` (today's renderer) and `engine/backends/null` (the headless renderer).
  - `engine/sim`: an empty, placeholder folder, so the rules for it exist before any code does.
  - `engine/tools`: an empty folder for the CLI (0.3).
  - `kits/topdown`.
  - `games/demo`: the current demo, with its own `index.html` and entry point.
- Vite builds each game as its own page. `pnpm dev` opens a small index that links to every game.
- **The dependency rule**, enforced twice:
  - an ESLint import-restriction rule per folder;
  - a test that reads every import in the repo and fails on any arrow that points the wrong way.
  - The allowed arrows: games → kits, sim, backends, core. Kits → core. Backends → core. Sim → core.
    Tools → anything in the engine and kits, and they load a game by its folder path at run time,
    never by a static import. Nothing in `engine/` or `kits/` imports from `games/`.
- **A purity rule** for `engine/sim`, `kits/` and the parts of `engine/core` they use: no
  `Math.random`, no `Date.now` or `performance.now`, no DOM. (Randomness goes through the seeded RNG.)
- The engine keeps only tiny test fixtures. All game content lives in `games/`.
- CI publishes each game to GitHub Pages on a tag.

**Done when:**

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass, and `games/demo` plays as before.
- A deliberate bad import (for example `kits/topdown` importing `games/demo`, or `engine/sim`
  importing a backend) fails **both** ESLint and the dependency test. (Checked by a test that feeds
  these imports to the checker.)
- A deliberate `Math.random()` in `kits/` fails lint.
- `git grep` finds no game content (rooms, songs, sprites) under `engine/` or `kits/` outside test
  fixtures.

_(Done. What was built and the choices made are in [BUILD-LOG.md](BUILD-LOG.md#engine-02).)_

**Out of scope:** new features, new kits, any change to how the demo plays.

---

## 0.3 LLM tooling (done)

**Goal:** an LLM can build, run and check a game from the command line, and trust what it reads.

**Scope:**

- **Content as data files.** The demo's rooms, sprites and song move from TypeScript into data files
  (JSON, plus text grids for maps and pixel art), each checked by a typed schema (Zod). TypeScript
  stays only for glue code. A later visual editor will edit these same files.
- **The CLI** (`pnpm cli <command>`; the name can change). Every command takes `--json` and then prints
  exactly one result object. Exit codes are grouped by kind of failure (usage error, invalid content,
  failed check, crash). Long output is capped, and the rest goes to a file whose path is in the result.
  - `validate <game>`: checks every content file against its schema. Cheap: it starts nothing.
  - `run <run-file>`: boots the game headless, plays the scripted input from the seed, and checks the
    run file's assertions.
  - `dump <run-file> --tick N`: the whole game state at one tick, as JSON.
  - `screenshot <run-file> --tick N`: a PNG from a paused, seeded frame (Playwright).
  - `get / set / add / remove <file> <path> [value]`: one verb set for editing content. Every write is
    read back and reported as `verified`.
- **Tick-level checks.** A run file can say "at tick 120, the hero is in room 2" and "on every tick,
  health is at least 0" (an _invariant_). On failure, `run` reports the **first failing tick** and
  writes a **replay file** that reproduces it.
- **State hashes** every N ticks, printed by `run` and stored in the replay file.
- **Mutant checks (the mechanism).** A kit can name its rules and let a test switch one off. A run
  file that still passes with a rule switched off is too weak to guard that rule. (Kits adopt this
  fully from 0.5.)
- **Agent docs and skills:**
  - `llms.txt` at the root, plus one Markdown page per module;
  - a `CLAUDE.md` (and `AGENTS.md`) in each engine module and kit;
  - a one-page API cheat sheet;
  - two skills in `.claude/skills/`: **scaffold a game**, and **debug a failing run**.
  - The CLI's help, the schema docs and the cheat sheet's reference parts are generated from the same
    schema, so they can't drift apart.

**Done when:**

- `pnpm cli validate games/demo --json` prints one JSON object and exits 0. Breaking one field in a
  content file makes it exit with the "invalid content" code and name the file and the field.
- `pnpm cli run` on a demo run file gives the same state hashes on two runs in a row and on CI.
- A run file with a wrong assertion reports the first failing tick, and the replay file it writes
  fails at that same tick when run again.
- `pnpm cli screenshot` gives the same PNG on two runs in a row.
- A `set` followed by a `get` returns the new value, and the `set` result says `verified: true`.
- Running a command whose output is larger than the cap prints a capped result plus a file path.
- CI fails if the generated docs are out of date.
- Following only `llms.txt`, the cheat sheet and the scaffold skill, an agent can make a new one-room
  game in `games/` that passes `validate` and `run`. (Checked once by hand and recorded in the release
  notes.)

_(Done. What was built, the choices made and the hand check are in
[BUILD-LOG.md](BUILD-LOG.md#engine-03).)_

**Out of scope:** an MCP server and a visual editor (both after Engine 1.0), new genres.

---

## 0.4 Renderer and presentation contract (done)

**Goal:** kits stop drawing. They describe what is there, and a backend decides how it looks.

**Scope:**

- **Configurable resolution.** SMBC hard-codes the NES picture size, 256×240. Each game now sets its
  own size in its config. Integer scaling and the touch layout follow it.
- **The presentation contract.** Each frame a backend gets a **read-only snapshot**:
  - for each entity: id, kind, position, facing, animation state and tags;
  - the level map (its tiles), sent when it is loaded or changes;
  - events from this frame (jumped, hit, coin), so a skin can attach sounds and effects;
  - status values for the HUD (health, score).
  - **Extension points** for presentation-only effects: camera framing, depth (layers), squash and
    stretch. A backend may ignore any of them.
  - The backend never sees kit internals and can't change anything.
- **Skins.** A per-backend text file maps each kind to a sprite (2D) or a mesh (3D), and each event to
  a sound or an effect.
- **The top-down kit is split.** Its rules stay in `kits/topdown`. Its drawing moves to the Canvas2D
  backend and a skin in `games/demo`. This proves the contract on a real kit before the platformer
  needs it.
- **Canvas2D stays** for now (see "PixiJS: now or later?" below).

**Done when:**

- `kits/` contains no drawing calls (checked by the dependency test: kits can't import a backend).
- The demo plays as before, and its run files give the **same state hashes** as at the end of 0.3. (The
  rules didn't change, only who draws.)
- The demo can be built at two different resolutions by changing one config value, and a screenshot of
  each is taken by the CLI.
- The same demo run gives the same state hashes with the Canvas2D backend and with the null backend.

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-04).)_

**Out of scope:** PixiJS, any 3D, new kits.

### PixiJS: now or later?

**Decided: later.** The Canvas2D renderer stays for now, and the RTS release (0.9) decides by
measuring with a benchmark. _(Measured at 0.9, item 133: Canvas2D holds 60 fps with 500 units at
zoom 0.5, 1 and 2, so PixiJS was not adopted and is listed under "Later".)_

- Canvas2D works, is tested, and draws everything we have at our picture sizes easily.
- Switching renderer in the same releases as the restructure and the contract would mix up the cause
  of any bug.
- The contract makes the swap cheap later: PixiJS becomes one more backend that reads the same
  snapshot and a skin.
- The RTS view is the first thing likely to strain Canvas2D (hundreds of units, zoom). 0.9 includes a
  benchmark, and PixiJS v8 comes in only if it is needed.

---

## 0.5 Platformer kit (done)

**Goal:** SMBC's platformer becomes a kit: its rules, with no drawing and no SMBC content.

**Scope:**

- Extract the platformer's rules from SMBC (mainly `src/game/world/world.ts` and
  `src/game/scenes/game.ts`, about 9,000 lines together, plus its entities, tiles, level format and
  camera). Today those files mix rules and drawing. The kit keeps the rules only. Its drawing goes into
  a Canvas2D skin.
- Generic names and nothing from SMBC's content: no levels, characters, art or music. Enemies become
  generic types ("walker", "shell") whose behaviour is set by data.
- Levels are text files with a schema.
- Whole-number sub-pixel positions, as in SMBC, so results don't depend on floating-point rounding.
- Every named rule (gravity, stomping, variable jump, and so on) can be switched off for mutant checks.
- A **mini game hook** in the style of SMBC's `MiniGameDef`: a scene pushed over a level that reports a
  result. This is how genres stack in a simple game (see DESIGN.md).
- A tiny test level in `kits/platformer` as a fixture only. Real levels belong to games.

**Done when:**

- A headless run file plays a fixture level from start to goal, with the same state hashes every time.
- **Golden traces:** a few scripted inputs give the same player positions, tick by tick, in SMBC and in
  the kit.
- For every named rule, at least one run file fails when that rule is switched off.
- The kit has no imports from any backend, and no drawing calls.
- A fixture level can be played in the browser through the Canvas2D backend and a placeholder skin.

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-05).)_

**Out of scope:** 3D, an original game (that is 0.7), SMBC's campaign, characters and mini games.

---

## 0.6 Basic 3D backend (done)

**Goal:** the platformer kit can be shown in 2.5D, in the style of New Super Mario Bros., without
changing the kit.

**Scope:**

- A Three.js backend that reads the same snapshot as the Canvas2D one.
- A 3D skin: each kind maps to a simple mesh, each tile type to a block.
- Side-on camera with perspective, framing and depth taken from the contract's extension points.
- Screenshots: Playwright asserts the WebGL renderer string (so a silent fall-back to software
  rendering can't slip through) and captures only from a paused, seeded frame.
- Headless runs keep using the null backend. Three.js has no headless renderer of its own.
- Just enough to stack on the platformer kit. Lighting, shadows and effects stay minimal.

**Done when:**

- The 0.5 fixture level plays in the browser in 3D.
- The same run file gives the same state hashes with the null, Canvas2D and Three.js backends.
- `pnpm cli screenshot --backend three` writes a PNG and fails with a clear error if WebGL is not
  hardware-backed.
- The diff for this release changes nothing in `kits/platformer`. (If it must, that is a gap and goes
  in the release notes.)

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-06).)_

**Out of scope:** a 3D kit (true 3D gameplay like Mario 64 is a separate kit, not a backend), PixiJS,
isometric, polished art.

---

## 0.7 The stacking test (done)

**Goal:** find out what is missing, using a simple original game shown two ways.

**Scope:**

- `games/platformer-test/`: a small original platformer (three or four short levels) built on the
  platformer kit, as simple and modular as possible. At 0.15 it grows into the platformer sample
  (`games/samples/platformer/`) and this folder goes away.
- It is presented through **both** backends: 2D sprites and 3D.
- Simple assets for both (see "How test assets are made" below).
- One level has a door that pushes a tiny mini game over the level (a one-room top-down challenge using
  `kits/topdown`), which reports pass or fail back. This tests SMBC-style genre stacking.
- It doubles as a worked example for LLM users (its own `CLAUDE.md` explains how it was built) and as an
  integration test (its run files run in CI).
- **Every gap is written down** as it is found: anything that needed engine code changes, anything
  awkward, anything a game had to do that should have been the engine's job.

**Done when:**

- **A written gap report** is committed at `docs/reports/stacking-test.md`. Each gap says what was
  found, where, and whether it was fixed in this release or moved to a named later release.
- The game is playable from a link in both 2D and 3D, and its run files give the same state hashes
  with both backends.
- `games/platformer-test/` contains only content, skins and thin glue (checked by review against the
  rule of thumb in DESIGN.md).

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-07); every gap is in the
[gap report](reports/stacking-test.md).)_

**Out of scope:** the world simulation, new kits beyond small fixes the gaps call for.

### How test assets are made

- **2D:** pixel art written as text, like SMBC: one string per row, one character per pixel, with a
  named palette. It is easy to diff, easy for an LLM to write, and has no licensing questions.
- **3D:** simple meshes, written as text. Either procedural (boxes, extruded tiles, or the same pixel
  art extruded into blocks) described in the skin file, or small glTF files (glTF is a JSON-based 3D
  format) generated from text by a script.
- Sounds and music stay MML text for the chiptune synthesizer.

---

---

## 0.8 World simulation (done)

**Goal:** the world exists as data, with no graphics. Games that need a living world (Worlds Within
and the mini siege sample, for a start) use it; simple games never touch it.

**Scope:**

- `engine/sim`: the world state with entities and components (Position, Health, Owner, Inventory,
  Squad/Members, Construction, and so on), a deterministic tick, and a seeded RNG per world.
- **ECS choice** made and recorded (Koota, bitECS, miniplex, or a small one of our own; see
  [research](research/prior-art.md#libraries)).
- **Squads and individuals:** a squad can be a single number for the RTS view and still name the
  people in it (named heroes, the captain), so a personal-scale mode can pick out who is in the room.
- An event log: every change made after a tick is committed is recorded with its cause.
- Save and load: the whole world as JSON, read back to an identical state.
- The CLI's `dump`, `run` and hashes work on a world, not just a game scene.
- Purity enforced by lint: no imports from backends or kits, and no unseeded randomness. Floating-point
  maths that can differ between machines (sin, cos and the like) is avoided or wrapped.
- Its proof is a headless sample world: a small scenario written as data (a village with workers, a
  building going up, a squad on patrol), kept as a fixture in the engine's tests. No game content.

**Done when:** the sample world runs for 10,000 ticks with the same state hashes on every run and on
CI, and survives a save and load at any tick (the hashes after loading match).

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-08).)_

**Out of scope:** graphics, input, any genre.

**Decisions needed first:** what a tick means in world time, the ECS choice, and whether height is
part of the simulation. _(Decided: items 99-101, reasoning in
[BUILD-LOG.md](BUILD-LOG.md#decisions-7).)_

---

## 0.9 RTS kit and view (done)

**Goal:** the first view of the simulation that can be played, shown in a sample RTS skirmish.

**Scope:**

- `kits/rts`: units, buildings that take time to construct, one resource, move and attack orders. It
  reads and writes the simulation through orders only, and holds no world rules of its own.
- Grid pathfinding written in-house: A\* first, flow fields if large groups need them.
- Orders are recorded, so any battle can be replayed headless (the OpenRA idea: lockstep orders, sync
  hashes, replays).
- The view: a scrolling camera over a map larger than the screen, with zoom; selecting with a click or
  a box. Mouse and touch.
- **A rendering benchmark that decides whether PixiJS comes in now** (see "PixiJS: now or later?"
  above). If it does, PixiJS v8 arrives as one more backend that reads the same snapshot and a skin.
- `games/samples/rts-skirmish/`: a first version of the RTS sample, with one map as data and its own
  simple original art. One side against a scripted enemy.

**Done when:** you can build a barracks, train units and fight an enemy group in the skirmish sample in
the browser, and the same battle gives the same state hashes when replayed headless from the recorded
orders.

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-09).)_

**Out of scope:** missions, other genres.

**Decided:** Canvas2D stays until this release; the benchmark above decides whether PixiJS comes in
for this view. _(Measured in T3, item 133: Canvas2D holds 60 fps at the 500-unit target at zoom 0.5, 1
and 2, so PixiJS does not come in and stays in "Later". Numbers in
[BUILD-LOG.md](BUILD-LOG.md#t3-the-rendering-benchmark).)_

**Decisions needed first:** Whether the kit needs a "hero" unit type (a named unit the player controls
directly) as well as squads. _(Decided: item 121, yes: a hero is an ordinary unit entity with a
squad `Member` role `hero`. The other 0.9 decisions are items 122-132. Reasoning in
[BUILD-LOG.md](BUILD-LOG.md#decisions-6).)_

---

## 0.10 Time and the mission contract (done)

**Goal:** the rules that let one world be played through many genres, built and tested headless before
any sample uses them.

**Scope:**

- **World time, experience time and commitment time** (DESIGN.md), handled by a time service in the
  simulation.
- **Mission contract:** a mission takes a snapshot of world state, declares its possible outcomes up
  front, and returns changes to the world. SMBC's `MiniGameDef` (pass/fail/quit, retry allowed) is the
  starting point, with two changes: results are structured, and there are no retries.
- Kits don't import the simulation. A small adapter turns a mission's snapshot into what a kit needs
  and the kit's report into a mission result.
- **Frozen events:** while a mission is open, the event it belongs to (the battle) is held still, and
  everything else (construction, caravans) moves forward.
- **A fixed world-time cost per mission (decided).** How far the world moves while a mission is open is
  set when the mission starts, never by the real time spent in it, so stalling inside a mission gains
  nothing (see DESIGN.md).
- **Opportunities:** windows that open and close (a passing convoy, a prisoner transfer). Taking one
  mission can close another.
- **Delegate or play (decided).** Every mission can be delegated: its outcome is drawn from its declared
  outcome space by the world's seeded RNG, and gives a fair, average result. Playing it yourself gives
  _choice_ over which outcome happens, not a better result. The contract must make both paths possible
  for every mission.
- Missions are defined as data files.

**From the stacking test** (gaps moved here; [gap report](reports/stacking-test.md)):

- G16: check a trigger's or mission's params with the content (a params schema the mini game or
  mission gives, run by `validate`), not only when the round starts.
- G20: keep a round's last tick (its final events and state) in the host's snapshot.
- G37: a hosted round as part of the game contract (say `miniGame()` on `HeadlessGame`), so the
  shell's `HostScene` takes the game itself instead of five accessors per game.
- G2 (the rest): a level or mission order written in data (a campaign file), not only by id.

**Done when:** headless tests cover partial success, failure with no retry, an opportunity closing, and
construction finishing during a frozen battle, and each passes with the same hashes on every run. A test
shows that a mission's world-time cost is the same however many ticks are spent inside it.

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-010).)_

**Out of scope:** any playable sample (that is 0.11), flashback missions.

**Decisions needed first:** how delegated outcomes are weighted, and the rules for flashback missions
(these can wait until after Engine 1.0).
_(Decided before code, items 150-161: delegated outcomes use whole-number weights in the mission
data drawn with a generator seeded from the world seed and the mission id (item 154); flashback missions wait until after Engine 1.0 (item 156).
Reasoning in [BUILD-LOG.md](BUILD-LOG.md#decisions-5).)_

---

## 0.11 The mini siege (multi-genre sample) (done)

**Goal:** put the multi-genre layer under real pressure early. Engine parts designed without a real
game driving them tend to miss what games actually need, so the simulation, the RTS kit, the top-down
kit and the mission contract are joined in one small playable scenario well before 1.0.

**Scope:**

- `games/samples/mini-siege/`: a small, original scenario. An RTS map with a village under attack, a
  handful of defenders and attackers, and one building under construction.
- From the RTS map, the player can launch **one top-down mission** (for example, slip out and wreck an
  enemy siege engine). The mission loads the real defenders from the simulation through the adapter.
- The mission can be **delegated or played**. Either way, a structured result (what was destroyed, who
  was hurt) goes back through the mission contract and changes the battle. The battle is frozen while
  the mission is open, the building keeps going up, and the mission's fixed world-time cost is applied.
- All of it is data: the map, the scenario and the mission are files, not code. The game folder holds
  only content, skins and thin glue.
- Simple original art and one short original song.
- **Every gap is written down,** like the stacking test: anything that needed engine changes, or that
  the sample had to do itself but should have been the engine's job. The report is
  `docs/reports/mini-siege.md`.

**From the stacking test** (gaps moved here; [gap report](reports/stacking-test.md)):

- G18: a per-round input map, and a button held into the door ignored on the round's first tick.
- G27, G28: audio in the shell (unlock on the first gesture), and result-specific event sounds
  (`mini-game-end:pass`).
- G13, G30: more than one trigger look (a `look` tag on a trigger entry, a skin frame by tag).
- G19 (the rest): a round's HUD that also shows the host's values, if the mission wants one.

**Done when:**

- The mini siege can be played from a link in a few minutes, by playing the mission and by delegating
  it, and both paths change the battle the way the design says.
- Run files for both paths pass in CI with the same hashes every time.
- The gap report is committed, and each gap is fixed here or moved to a named later release.

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-011); the gap report is [reports/mini-siege.md](reports/mini-siege.md):
28 gaps, 11 fixed in 0.11 and 17 moved to 0.13, 0.14 and 0.15, listed in those sections.)_

**Out of scope:** tower defense, heroes who carry over between scenarios, a campaign. Anything from
Worlds Within (its places, characters, story or art).

_(Decided before code, items 172-184: missions in game run files, live hosting in `engine/core`
with the world stepped one tick per game tick through the cost, the RTS kit's mission offers and
launch request, a data-driven top-down mission adapter, the six stacking-test gaps, and the
scenario's shape with checks for both paths. Reasoning in [BUILD-LOG.md](BUILD-LOG.md#decisions-4).)_

---

## 0.12 Tower-defense kit (the platform test) (done)

**Goal:** prove that a new genre can be added without editing the simulation.

**Scope:**

- `kits/towerdefense`: placing defences on a map, paying for them with a resource, and fighting waves.
- `games/samples/tower-defense/`: a standalone tower-defense map with its own simple original art.
- A small tower-defense preparation phase added to the mini siege: placing defences on the real walls
  with real resources, and fighting a wave whose losses are written back to the world. Its purpose is
  to test that a new mode can be added to an existing game without changing `engine/sim`.
- This is separate from the tower-defense preparation phase of the real Siege, which is not engine
  work: it belongs to Worlds Within 0.1.
- **The test:** adding this mode needs _no changes_ to `engine/sim`. Every change it does need is
  recorded as a lesson for the mission API before that API is fixed at 1.0.

**Done when:** the tower-defense sample plays from a link, the mini siege offers the preparation phase,
and the `engine/sim` diff for this release is empty (or each change is justified in the release notes).

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-012); the lessons report is
[reports/tower-defense.md](reports/tower-defense.md): the `engine/sim` diff against the release's base
is empty, and 14 lessons for the mission API, none needing the sim, are moved to 0.15 (12) and 1.0
(2), listed in those sections.)_

_(Decided before code, items 197-206: the kit's shape and content kinds, the cursor input model,
the standalone sample, the `fortify` mission played as the kit's `td-defence` over the real walls,
gold and raiders, its report, the walls on the one village map with the 0.11 hashes re-recorded
once, where the code lives, the lessons report and the `engine/sim` check. Reasoning in
[BUILD-LOG.md](BUILD-LOG.md#decisions-3).)_

---

## 0.13 Heroes and consequences in the simulation (done)

**Goal:** losses that carry forward, supported by the engine so any game can use them.

**Scope:**

- Named individuals in the simulation can be injured, killed or captured, and that state is carried
  into every mode that loads them.
- Capture opens follow-up opportunities (a rescue, an exchange, or leaving them behind).
- Campaign saves and **save codes**, using what SMBC learned (a short code is the save).
- A way for one scenario to start from another's results.
- Proved on the mini siege: a short second scenario that starts from the first one's results.

**From the mini siege** (gaps moved here; [gap report](reports/mini-siege.md)):

- M13: a mission round's hero taken from a world unit (a `hero: { select, hpPer }` field in a
  `mission-room` mission's params), so a named defender's hp goes into the round and back.

**Done when:** losing a named defender in the mini siege changes how the follow-up scenario plays,
shown by two run files whose only difference is that defender's fate. A save code taken at the end of
the first scenario restores the same world (equal hashes).

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-013): `dawn-held` and `dawn-captured` differ only in the
captain's fate and play differently, and `dawn-code` (from `quit`'s save code) has the same hashes
as `dawn-captured`. M13 is fixed; the mini siege's new gaps M29-M36 are fixed (M29, M30, M33) or
moved to 0.15 (M31, M32, M34, M35, M36), listed there ([gap report](reports/mini-siege.md)).)_

_(Decided before code, items 220-228: fates of named people in `engine/sim`, the `fate` effect and
capture follow-ups as opportunities, fates honoured by every kit, M13's `hero`, a scenario's
`from` and the carried record, campaigns played in order and campaign saves, save codes, the mini
siege's dawn assault, and run files that start from another run or a code. Reasoning in
[BUILD-LOG.md](BUILD-LOG.md#decisions-2); the close-out's choices are items 229-233.)_

---

## 0.14 Creator tools v1 (done)

**Goal:** tools for people (not just the CLI) to inspect a world.

- An in-browser simulation debugger: the world state, the event log, and stepping and rewinding
  through a replay. It reads the same dumps and replay files the CLI writes.
- A timeline viewer showing world time, opportunities and when results were committed.

**From the stacking test** (gaps moved here; [gap report](reports/stacking-test.md)):

- G5: a Vite plugin for a game's files (`virtual:game-files`), so `files.ts` goes away.
- G8: a `trace` command (or `dump --ticks`) for tuning run files.
- G9: a start level in run files (`"start": { "stage": 2 }`).
- G10: region edits and a ruler for text maps.
- G12: per-kit mutants (each kit's rules and strictness in a game that uses two).
- G31: replaying a run file in a browser page.

**From the mini siege** (gaps moved here; [gap report](reports/mini-siege.md)):

- M19: recording a hosted round's input for a run file's `play` step (today a throwaway script
  with the kit's bot).

**Done when:** a new scenario added to the mini siege with data files only can be stepped through in the
debugger, and a failing replay from the CLI opens at its failing tick.

**Out of scope:** editing (the visual editor comes after Engine 1.0).

_(Done. What was built, the choices made and how each item was checked are in
[BUILD-LOG.md](BUILD-LOG.md#engine-014): the mini siege's third scenario, the ridge camp, was added
with data files only (`ridge.world.json`, the `stores-raid` mission, a campaign line and
`ridge-raid.run.json`) and is stepped forward and rewound in the debugger with its golden hashes and
timeline, and a deliberately failing copy's replay from `run --json` opens with `debug --check` at
its failing tick. G5, G8, G9, G10, G12, G31 and M19 are fixed; the new mini siege gaps are M37
(fixed: the game's tests pinned the campaign's length) and M38 (moved to 0.15: save codes index
missions by sorted id) ([gap reports](reports/stacking-test.md), [mini siege](reports/mini-siege.md)).)_

_(Decided before code, items 247-256: where the debugger lives and what it reads, stepping and
rewinding by re-simulation, the event log and timeline hooks, the timeline record, `trace`, a
run file's `start`, map rulers and region writes, per-kit rule ids, the page-side step hook and
the round recorder. Reasoning in [BUILD-LOG.md](BUILD-LOG.md#decisions-1); item 257 settled per-kit
mutants for a strict `uses` kit; the close-out's choices are items 258-259; the smaller build choices are items 260-277.)_

---

## 0.15 The sample set

**Goal:** every gameplay kit has a small, finished sample game, ready for 1.0.

**Scope:**

- `games/samples/platformer/`: a platformer level. It grows out of the 0.7 stacking-test game
  (`games/platformer-test/`), keeping its 2D and 3D skins.
- `games/samples/dungeon/`: a top-down dungeon. It grows out of the demo (`games/demo/`).
- The old folders, `games/platformer-test/` and `games/demo/`, go away in this release. Their run files
  move with them into the samples and stay green.
- `games/samples/rts-skirmish/` and `games/samples/tower-defense/`: finished from their first versions.
- Every sample gets its own original assets (pixel art, meshes and music as text) in place of
  placeholders, a `CLAUDE.md` that explains how it was built, and run files in CI.
- A review of every kit and module API against what the samples needed, as the last chance to change
  them before they are written down as v1.

**From the stacking test** (gaps moved here; [gap report](reports/stacking-test.md)):

- G33: a HUD in the 3D backend (the platformer sample keeps both skins).
- G36: a skin `background` colour, so the sky is not a constant in glue.
- G17: a game with several separate challenge rooms (the top-down kit's kinds without the
  one-dungeon check, chosen by the game).

**From the mini siege** (gaps moved here; [gap report](reports/mini-siege.md)). Most are a second
copy a second mission game would write; the API review decides where each goes:

- M1: stored player volumes and a mute or volume control on every sample page.
- M2: a skin's `byTag` matching a tag prefix or value (`progress:<n>`).
- M4: whether a played round's experience ticks belong in the hashed record (world and game runs).
- M5: a channel for mission refusals that arrive after their step.
- M6 (the rest): one round picture for every hosted mission (the battle-or-round frame switch).
- M10: every scenario key kept in the world, or passed to the adapter.
- M11 (the rest): a params page per mini game a game defines (the room challenge's).
- M12: the sim's siege fixture `raid.mission.json` as a real `mission-room` mission (re-records
  seven golden hashes).
- M16: free-form squad roles, or a squad selector, in mission params.
- M17 and M28: run checks by scenario key (`world.key.ram.Health.hp`), and the committed mission
  records and keyed entities read through the sim or the port, not by the glue.
- M18: `MissionHost` and the kit's game in one (an `onChange` hook or a kit helper).
- M20: the scripted enemy skipping frozen units (moves every mini siege hash).
- M21: `MissionHost` events (`mission-open`, `mini-game-end`, `mission-commit`) for skins.
- M25: an offer marker named by scenario key in the mission file.
- M26: a shared mission-launch scene (launch, play or delegate, the round, the outcome).
- M27: the bridge from a sim world to the RTS kit's `RtsWorldPort`, written once.
- M31: a carried stockpile that is gone at the first scenario's end (carried as zeros or a `lost`
  flag), and a campaign that ends on a loss said in data, not in the glue's `campaignSave`
  (found in 0.13).
- M32: a second `mission-room` round with a room of its own (with G17: rooms that are not one
  dungeon; found in 0.13).
- M34, M35 and M36: a campaign page's flow written once (with M26): an entry held at tick 0 until
  the player begins it, one rule for when a scenario entry is over (an open mission at its
  `ticks`), and the result panel, save code, Continue and resume (found in 0.13).
- M38: save codes that a mission file added later does not move (a stable mission index or a code
  format v2; today missions are indexed by sorted id; found in 0.14).

**From the tower-defense kit** (lessons moved here; [lessons report](reports/tower-defense.md)). None
needed `engine/sim` in 0.12; the API review makes or rejects each before the mission API is v1:

- D1: a recorded pointer tap (a command or a pointer track in `ScriptedInput`), so a round played
  by tapping can be a run file (with M19 in 0.14).
- D2: a tick rate in the shell (or a merging `InputFrame`) for pages that play slower than the loop.
- D3 and D4: effect amounts and losses taken from the round's report (the gold spent, each fallen
  wall or killed raider), checked against declared limits, instead of fixed amounts per outcome.
  This changes how the sim's commit applies effects.
- D6: a mission's params naming any world entity by key, not only the keys its effects name (with
  M10).
- D7: `validate` checking a mission's selectors against the game's world scenarios.
- D8: a `td-map` used only by missions without a `td-waves` list (the tower-defense sample).
- D9: `MissionHost` (or the core) naming the hosted mini game on its frame (with M6 and M21).
- D10: a selector entry put on a named cell (`slot`), not by id order (with M16).
- D12: pointer taps forwarded into a hosted round (`MiniGame.tap`) by `HostScene` (with M26).
- D13: `screenAtCell` in the tower-defense kit and a display `toClient`, for page scripts.
- D14: a round's key hints from the mini game (or the mission file), not strings in each page (with
  M26).

**Done when:** every sample plays from a link and passes its run files in CI, `games/platformer-test/`
and `games/demo/` are gone, and the API review is
written up with every change it calls for either made or listed for 1.0.

**Out of scope:** new kits.

---

## Engine 1.0

**Goal:** an engine we (or an LLM working for us) can make a new game with, using only its docs and
samples.

**Ships with (all required):**

- **A sample game for every gameplay kit,** each with its own original assets: a platformer level, a
  top-down dungeon, an RTS skirmish, and a tower-defense map.
- **The mini siege,** the multi-genre sample: an RTS map that launches a top-down mission, which can be
  delegated or played, and gets structured results back through the world simulation, time and the
  mission contract.
- **Documented kit and module APIs (v1),** including the mission API. The API is **internal**: it is
  written down as v1 for our own games, with no stability promise to outside developers. A public API
  and package come later (see "Later").
- **Agent docs and skills complete:** `llms.txt`, a page and a `CLAUDE.md` for every module, kit and
  sample, the cheat sheet, and skills for the common jobs (scaffold a game, add a level, add a mission,
  debug a failing run).
- **Every sample playable from a link,** published on the `engine-v1.0.0` tag.

**From the tower-defense kit** (lessons moved here; [lessons report](reports/tower-defense.md)),
written down in the v1 docs as the API's rule, not changed:

- D5: in a `td-defence` round, "walls lost" is the report's reading of the leaks (the build cell
  nearest the exit for each leak), not a kit rule; a wall-damage rule comes with a run file only when
  a game needs one.
- D11: two missions on one event exclude each other for the whole of the first one's cost (the sim's
  frozen-event rule from 0.10); a preparation phase beside a mission on the same battle needs a
  second event.

**From the API review** ([api-review.md](reports/api-review.md), Engine 0.15 T15): every change
the review calls for that was not made in 0.15. Ids `1.0-n` are the review's.

- 1.0-1 and 1.0-2: D5 and D11 above, written down in the v1 docs.
- 1.0-3: M2's two-tag look (decision 3 of 0.15): a skin look matching two tags at once, when a game
  needs it.
- 1.0-4: M4's rule in the v1 docs: a played mission's `experienceTicks` is 0 through `missionPort`;
  the round's ticks are `missionExperience()`, the run's `experience` and the timeline's.
- 1.0-5 (A4): the topdown kit's `Td*` exports renamed `TopDown*`, so no name is shared with the
  towerdefense kit (`TdEvent`, `TdPresentState`), with every game, test and skill that names them.
- 1.0-6 (A5): `frameView` takes the frame source and the events as options, so the dungeon,
  RTS skirmish and mini siege views are one call each.
- 1.0-7 (A6): a scene that reads input every loop step and steps its game at a rate, and an RTS
  page helper in the kit (camera over the map from a home point, controls, buttons), used by both
  RTS samples.
- 1.0-8 (A7): `window.__ww` documented as a page's hook for scripts; a page's own hook keeps only
  page state.
- 1.0-9 (A8): a standalone game's end in the shell (end banner, Play again with a new seed, a song
  switch) and text items in a skin's HUD, used by the dungeon, the RTS skirmish and the tower
  defense.
- 1.0-10: the module pages' "Public API entry points" become the v1 API docs, checked against the
  review's appendix: what games use is v1, the rest is marked internal.
- 1.0-11: `engine/sim`'s exports split in the v1 docs into what a game's glue calls and what the
  systems and tools use.

**Done when:**

- All of the above is true, and `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass with every
  sample's run files included.
- Following only `llms.txt`, the cheat sheet, the skills and the samples, an agent can make a new small
  game with one kit (and a new mission for the mini siege) that passes `validate` and `run`. (Checked by
  hand and recorded in the release notes.)

---

# Worlds Within track (after Engine 1.0)

Worlds Within starts here, with its own version numbers. It is built on Engine 1.x and lives in
`games/worlds-within/`. Its releases are tagged `ww-v0.1.0`, `ww-v0.2.0` and so on (see "Two version
lines" for patch releases). These releases are planned more lightly than the engine's, and will be
detailed once Engine 1.0 is close.

If Worlds Within needs an engine change, the change is made in the engine (with an engine sample or
test that proves it) and shipped as an engine release, never as game code.

---

## Worlds Within 0.1: The Siege

**Goal:** the proof of concept from the design conversation, playable from start to finish.

All of it is content in `games/worlds-within`, as data wherever possible. The mini siege sample is the
pattern to follow, but none of its content is reused.

- `games/worlds-within/` is created, with its first map as data.
- An RTS village under siege: defenders, four enemy siege engines, and a barracks under construction.
- The **sabotage mission**, played in the top-down kit. It loads the real defenders (and their
  injuries) from the simulation, and its result is how many engines were destroyed and who was hurt or
  captured.
- The same mission can be **delegated**, which gives a fair, average result. Playing it yourself gives
  a choice of _which_ outcome (which engine, whether to capture the officer), not a better number.
- A **tower-defense preparation phase**: placing defences on the real walls with real resources.
- Battle phases advance, opportunities close, and the siege ends in victory, defeat or a partial result.
- Placeholder art is acceptable; one original song for the siege.

**Done when:** someone who has never seen the game can play the Siege from a link in about 15 minutes,
both paths (playing the mission and delegating it) change the battle the way the design says, the Siege
offers both the RTS and tower-defense modes, and a full Siege replay gives the same hashes every time.

**Decisions needed first:** art direction; whether the player is a civilization, a hero, or both. (The
engine half of that question, whether the RTS kit supports a directly controlled hero unit, was answered
at 0.9: yes, item 121.)

---

## Worlds Within 0.2: Heroes and the campaign

**Goal:** losses that carry forward across scenarios.

- Named heroes with injuries, death and capture, carried across modes.
- Capture opens follow-up opportunities (a rescue, an exchange, or leaving them behind).
- Campaign saves and save codes.
- A second scenario that starts from the Siege's results.

**Done when:** losing a hero in the Siege changes how the next scenario plays, shown by two run files
whose only difference is that hero's fate.

---

## Worlds Within 0.3: A third mode

**Goal:** a third way to play, picked by cost and by what the chapter needs.

- The candidates are a text interrogation (cheap, and fits the investigation path), a top-down convoy
  chase (racer), or the platformer kit. If the mode needs a new kit, that kit is engine work and ships
  as an engine release first, with its own sample.

**Decision needed first:** which third mode.

---

## Worlds Within 0.4: Chapter 1 content and art

**Goal:** enough game for 1.0.

- Four to six linked scenarios forming one short chapter.
- Original art in place of the placeholders, in the chosen art direction.

---

## Worlds Within 1.0: Chapter 1

**Goal:** a short, finished game that can be played from a link.

- 3–4 polished modes, one chapter, saves that last, running on desktop and phone.

---

## Later (not planned in detail)

**Engine (after Engine 1.0):**

- **The visual editor.** It edits the same text files the LLM tools edit, so a person can use an LLM,
  the editor, or both on the same game. It builds on the 0.14 debugger.
- **An MCP server.** A thin wrapper over the CLI, generated from the same schema. The CLI stays the
  real interface.
- More backends: PixiJS (not adopted at 0.9: the T3 benchmark found Canvas2D fast enough), isometric.
- More kits and modes: a true 3D kit (Mario 64-like), a shmup, a rail shooter, a racer. Each new kit
  comes with its own sample game.
- A public API with a stability promise to outside developers, a package format for third-party
  genres, and the engine published as its own package. (The 1.0 API is internal only.)
- Multiplayer: possible because the simulation is deterministic, but not designed for yet.

**Worlds Within (after Worlds Within 1.0):**

- More chapters and more modes, including 3D ones once the engine has them.
- Desktop builds (Tauri or Electron) for Steam. The packaging itself is engine work, so other games can
  use it too.

---

## Open questions, by the release that needs them

"0.x" and "1.0" mean engine releases. Worlds Within releases are written "WW 0.x".

| Question                                                                                               | Needed by                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which ECS: Koota, bitECS, miniplex, or our own?                                                        | 0.8: decided (item 99): our own small ECS with plain-data stores and ascending-id iteration ([build log](BUILD-LOG.md#decisions-7))                                         |
| Is height part of the simulation (terrain height, line of sight)?                                      | 0.8: decided (item 101): yes, as data only (integer elevation per cell, integer `z` on Position); line of sight later, in the sim ([build log](BUILD-LOG.md#decisions-7))   |
| What a simulation tick means in world time (minutes? hours?)                                           | 0.8: decided (item 100): one tick is one world minute, an integer counter independent of the frame loop ([build log](BUILD-LOG.md#decisions-7))                             |
| Does the RTS kit need a directly controlled "hero" unit as well as squads?                             | 0.9: decided (item 121): yes, an ordinary unit entity with a squad `Member` role `hero`, ordered one by one alongside squads ([build log](BUILD-LOG.md#decisions-6))        |
| Does PixiJS come in for the RTS view, or does Canvas2D stay?                                           | 0.9: decided (item 133): Canvas2D stays, holding 60 fps with 500 units at zoom 0.5, 1 and 2; PixiJS moves to "Later" ([build log](BUILD-LOG.md#t3-the-rendering-benchmark)) |
| How delegated outcomes are weighted                                                                    | 0.10: decided (item 154): whole-number weights per outcome in the mission data, one draw with the world's seeded RNG; no weight 0 ([build log](BUILD-LOG.md#decisions-5))   |
| Exact rules for flashback (retrospective) missions                                                     | 0.10: deferred until after Engine 1.0 (item 156)                                                                                                                            |
| What the mini siege's top-down mission is                                                              | 0.11: decided (answer 23, item 182): sabotaging siege engines, with original content ([build log](BUILD-LOG.md#decisions-4))                                                |
| Art style for the samples                                                                              | Decide later, by 0.15 (proposal: simple original pixel art written as text, like the test games)                                                                            |
| Is the player a civilization, a hero, or both? (The engine's RTS hero unit is the 0.9 hero row above.) | WW 0.1 (proposal: a commander plus a few named heroes)                                                                                                                      |
| Art direction: chiptune and NES-style pixels like SMBC, or something else                              | WW 0.1 (engine samples use their own simple art)                                                                                                                            |
| Which third mode                                                                                       | WW 0.3                                                                                                                                                                      |
