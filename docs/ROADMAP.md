# Worlds Within: Roadmap

**Status: draft for review.** Nothing here is final until the owner signs off.

The plan is **engine first, game second**. We build a small engine that an LLM coding assistant can
use well, prove it on simple games, and only then build Worlds Within on top of it. The engine
principles behind this order are in [DESIGN.md](DESIGN.md#engine-principles).

The order is:

1. **The base layer** (0.2 to 0.4): the repo restructure, the LLM tooling, and the presentation
   contract.
2. **The platformer kit** (0.5): SMBC's platformer, with its rules separated from its drawing.
3. **A basic 3D backend** (0.6): Three.js, with just enough to show the platformer kit.
4. **The stacking test** (0.7): a simple original game, shown in 2D and in 3D, with every gap written
   down.
5. **Worlds Within** (0.8 to 1.0): the world simulation, the RTS, time and missions, the Siege, and
   the rest.

Each release ends with something that can be played or tested. Every release before 1.0 is a 0.x
(0.10 comes after 0.9). From 0.2 on, every tagged release publishes each game in `games/` to GitHub
Pages, so it can be played from a link.

**Engine and game tracks.** The repo has one version number. Each release is labelled **Engine** or
**Game** so it is clear which side it builds. The engine gets a version number of its own only if it is
ever published as a separate package (after 1.0).

**Every release must keep the old ones working.** The demo and every test game stay playable, and
their run files stay green, from the release that adds them onwards.

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

---

## 0.1 Foundation (done) · Engine

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

## 0.2 Restructure and the dependency rule · Engine (base layer)

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

**Out of scope:** new features, new kits, any change to how the demo plays.

---

## 0.3 LLM tooling · Engine (base layer)

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

**Out of scope:** an MCP server (after 1.0), a visual editor (after 1.0), new genres.

---

## 0.4 Renderer and presentation contract · Engine (base layer)

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

**Out of scope:** PixiJS, any 3D, new kits.

### PixiJS: now or later?

**Recommendation: later.** Keep the Canvas2D renderer through the stacking test, and decide at the RTS
release (0.9) by measuring.

- Canvas2D works, is tested, and draws everything we have at our picture sizes easily.
- Switching renderer in the same releases as the restructure and the contract would mix up the cause
  of any bug.
- The contract makes the swap cheap later: PixiJS becomes one more backend that reads the same
  snapshot and a skin.
- The RTS view is the first thing likely to strain Canvas2D (hundreds of units, zoom). 0.9 includes a
  benchmark, and PixiJS v8 comes in only if it is needed.

---

## 0.5 Platformer kit · Engine

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

**Out of scope:** 3D, an original game (that is 0.7), SMBC's campaign, characters and mini games.

---

## 0.6 Basic 3D backend · Engine

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

**Out of scope:** a 3D kit (true 3D gameplay like Mario 64 is a separate kit, not a backend), PixiJS,
isometric, polished art.

---

## 0.7 The stacking test · Game (test game)

**Goal:** find out what is missing, using a simple original game shown two ways.

**Scope:**

- `games/platformer-test/`: a small original platformer (three or four short levels) built on the
  platformer kit, as simple and modular as possible.
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

**Out of scope:** the world simulation, new kits beyond small fixes the gaps call for.

### How test assets are made

- **2D:** pixel art written as text, like SMBC: one string per row, one character per pixel, with a
  named palette. It is easy to diff, easy for an LLM to write, and has no licensing questions.
- **3D:** simple meshes, written as text. Either procedural (boxes, extruded tiles, or the same pixel
  art extruded into blocks) described in the skin file, or small glTF files (glTF is a JSON-based 3D
  format) generated from text by a script.
- Sounds and music stay MML text for the chiptune synthesizer.

---

## 0.8 World simulation · Engine (sim)

**Goal:** the world exists as data, with no graphics. This is engine code, but Worlds Within is its
first user.

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

**Done when:** a scripted headless scenario runs for 10,000 ticks with the same state hashes on every
run and on CI, and survives a save and load at any tick (the hashes after loading match).

**Out of scope:** graphics, input, any genre.

**Decisions needed first:** what a tick means in world time, the ECS choice, and whether height is
part of the simulation.

---

## 0.9 RTS kit and view · Engine (kit) + Game

**Goal:** the first view of the simulation that can be played.

**Scope:**

- `kits/rts`: units, buildings that take time to construct, one resource, move and attack orders. It
  reads and writes the simulation through orders only, and holds no world rules of its own.
- Grid pathfinding written in-house: A\* first, flow fields if large groups need them.
- Orders are recorded, so any battle can be replayed headless (the OpenRA idea: lockstep orders, sync
  hashes, replays).
- The view: a scrolling camera over a map larger than the screen, with zoom; selecting with a click or
  a box. Mouse and touch.
- A rendering benchmark that decides whether PixiJS comes in now.
- `games/worlds-within/` is created, with its first map as data.

**Done when:** you can build a barracks, train units and fight an enemy group in the browser, and the
same battle gives the same state hashes when replayed headless from the recorded orders.

**Out of scope:** missions, other genres.

**Decisions needed first:** is the player a civilization, a hero, or both? Canvas2D or PixiJS for this
view?

---

## 0.10 Time and the mission contract · Engine (sim)

**Goal:** the rules that make Worlds Within different, built and tested before any content.

**Scope:**

- **World time, experience time and commitment time** (DESIGN.md), handled by a time service in the
  simulation.
- **Mission contract:** a mission takes a snapshot of world state, declares its possible outcomes up
  front, and returns changes to the world. SMBC's `MiniGameDef` (pass/fail/quit, retry allowed) is the
  starting point, with two changes: results are structured, and there are no retries.
- Kits don't import the simulation. A small adapter turns a mission's snapshot into what a kit needs
  and the kit's report into a mission result.
- **Frozen events:** while a mission is open, the event it belongs to (the battle) is held still, and
  everything else (construction, caravans) moves forward. How far it moves is _proposed_ to be a fixed
  world-time cost per mission, never real time spent (see DESIGN.md; not yet confirmed by the owner).
- **Opportunities:** windows that open and close (a passing convoy, a prisoner transfer). Taking one
  mission can close another.
- **Auto-resolve:** every mission can be delegated, with an outcome drawn from its declared outcome
  space by the world's seeded RNG.
- Missions are defined as data files.

**Done when:** headless tests cover partial success, failure with no retry, an opportunity closing, and
construction finishing during a frozen battle, and each passes with the same hashes on every run.

**Decisions needed first:** how auto-resolve is weighted, and the rules for flashback missions (these
can wait until after 1.0).

---

## 0.11 The Siege · Game

**Goal:** the proof of concept from the design conversation, playable from start to finish.

**Scope:** all of it is content in `games/worlds-within`, as data wherever possible.

- An RTS village under siege: defenders, four enemy siege engines, and a barracks under construction.
- The **sabotage mission**, played in the top-down kit. It loads the real defenders (and their
  injuries) from the simulation, and its result is how many engines were destroyed and who was hurt or
  captured.
- The same mission can be **auto-resolved**. It is _proposed_ that playing it yourself gives a choice of
  _which_ outcome (which engine, whether to capture the officer), not a better number (not yet
  confirmed by the owner).
- Battle phases advance, opportunities close, and the siege ends in victory, defeat or a partial result.
- Placeholder art is acceptable; one original song for the siege.

**Done when:** someone who has never seen the game can play the Siege from a link in about 15 minutes,
both paths (playing the mission and delegating it) change the battle the way the design says, and a
full Siege replay gives the same hashes every time.

**Decision needed first:** art direction.

---

## 0.12 Tower defense (the platform test) · Engine (kit) + Game

**Goal:** prove that a new genre can be added without editing the simulation.

**Scope:**

- `kits/towerdefense`, and a preparation phase for the Siege: placing defences on the real walls with
  real resources, and fighting a wave whose losses are written back.
- **The test:** adding this mode needs _no changes_ to `engine/sim`. Every change it does need is
  recorded as a lesson for the mission API before that API is fixed.

**Done when:** the Siege offers both modes and the `engine/sim` diff is empty (or each change is
justified in the release notes).

---

## 0.13 Heroes and consequences · Game (with sim support)

**Goal:** losses that carry forward.

- Named heroes with injuries, death and capture, carried across modes.
- Capture opens follow-up opportunities (a rescue, an exchange, or leaving them behind).
- Campaign saves and save codes, using what SMBC learned (a short code is the save).
- A second scenario that starts from the Siege's results.

**Done when:** losing a hero in the Siege changes how the next scenario plays, shown by two run files
whose only difference is that hero's fate.

---

## 0.14 Creator tools v1 · Engine

**Goal:** tools for people (not just the CLI) to inspect a world.

- An in-browser simulation debugger: the world state, the event log, and stepping and rewinding
  through a replay. It reads the same dumps and replay files the CLI writes.
- A timeline viewer showing world time, opportunities and when results were committed.

**Done when:** a new scenario added with data files only can be stepped through in the debugger, and a
failing replay from the CLI opens at its failing tick.

**Out of scope:** editing (the visual editor comes after 1.0).

---

## 0.15 Third mode and Chapter 1 content · Game

**Goal:** enough game for 1.0.

- A third mode, picked by cost and by what the chapter needs. The candidates are a text interrogation
  (cheap, and fits the investigation path), a top-down convoy chase (racer), or the platformer kit
  from 0.5.
- Four to six linked scenarios forming one short chapter.
- Original art in place of the placeholders.

**Decision needed first:** which third mode.

---

## 1.0 Worlds Within: Chapter 1 · Game

**Goal:** a short, finished game that can be played from a link.

- 3–4 polished modes, one chapter, saves that last, running on desktop and phone.
- The mission API documented as v1 (still internal: no third-party promise yet).

---

## After 1.0 (not planned in detail)

- **The visual editor.** It edits the same text files the LLM tools edit, so a person can use an LLM,
  the editor, or both on the same game. It builds on the 0.14 debugger.
- **An MCP server.** A thin wrapper over the CLI, generated from the same schema. The CLI stays the
  real interface.
- More backends: PixiJS (if not adopted at 0.9), isometric.
- More kits: a true 3D kit (Mario 64-like), a shmup, a rail shooter.
- A public kit API and package format for third-party genres, and possibly the engine as its own
  package.
- Desktop builds (Tauri or Electron) for Steam.
- Multiplayer: possible because the simulation is deterministic, but not designed for yet.

---

## Open questions, by the release that needs them

| Question                                                                            | Needed by                                                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Canvas2D or PixiJS, and when?                                                       | 0.9 (proposal: keep Canvas2D until then and decide by benchmark) |
| Which ECS: Koota, bitECS, miniplex, or our own?                                     | 0.8                                                              |
| Is height part of the simulation (terrain height, line of sight)?                   | 0.8 (decide early, or rules leak into the views)                 |
| What a simulation tick means in world time (minutes? hours?)                        | 0.8                                                              |
| Is the player a civilization, a hero, or both?                                      | 0.9 (proposal: a commander plus a few named heroes)              |
| How auto-resolve odds are weighted                                                  | 0.10                                                             |
| Exact rules for flashback (retrospective) missions                                  | 0.10 (can be left out until after 1.0)                           |
| Does each mission have a fixed world-time cost? (proposed)                          | 0.10                                                             |
| Does playing yourself give choice over the outcome, not a better result? (proposed) | 0.11                                                             |
| Art direction: chiptune and NES-style pixels like SMBC, or something else           | 0.11 (test games before it use simple placeholder art)           |
| Which third mode                                                                    | 0.15                                                             |
