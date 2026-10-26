# Worlds Within: Roadmap

**Status: draft for review.** Nothing here is final until the owner signs off.

The plan is to build one game and pull the engine out of it as we go. Each release adds one layer and
ends with something that can be played or tested. Every release before 1.0 is a 0.x. Every tagged
release from 0.3 on is published to GitHub Pages, so it can be played from a link.

The rule behind the order is that **the simulation core comes first, and every playable mode reads
from it and writes back to it.** A mode that only works because of special code inside the core is a
bug in the platform.

---

## 0.1 Foundation (this setup)

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

**Done when:** CI is green and `pnpm dev` plays the demo. _(Both are true locally now.)_

---

## 0.2 Simulation core

**Goal:** the world exists as data, with no graphics.

- `src/sim`: the world state with entities and components (Position, Health, Owner, Inventory,
  Squad/Members, Construction, and so on), a deterministic tick, and a seeded RNG per world.
- **Squads and individuals:** a squad can be a single number for the RTS view and still name the
  people in it (named heroes, the captain), so a personal-scale mode can pick out who is in the room.
- An event log: every change made after a tick is committed is recorded with its cause.
- Save and load: the whole world serialized to JSON and read back to an identical state, checked by a
  round-trip test.
- A text debug dump of the world (the first piece of the "simulation debugger").

**Done when:** a scripted headless scenario runs for 10,000 ticks with the same result on every run,
and survives a save and load at any tick.

**Out of scope:** graphics, input, any genre.

---

## 0.3 RTS view (minimum)

**Goal:** the first view of the simulation that can be played.

- Engine: a configurable picture size (SMBC hard-codes the NES's 256×240), and a scrolling camera over a
  map larger than the screen, with zoom.
- Mouse and touch: selecting with a click or a box, then move and attack orders.
- Grid pathfinding (A* to start; flow fields later if large groups need them).
- Units, buildings that take time to construct, and one resource.
- The RTS view only reads the simulation and sends orders to it. It holds no game rules of its own.
- Publishing to GitHub Pages on each tag.

**Done when:** you can build a barracks, train units and fight an enemy group in the browser, and the
same battle gives the same result when replayed headless from the recorded orders.

**Decision needed first:** is the player a civilization, a hero, or both? (The proposal is a commander
plus a few named heroes; see DESIGN.md.)

---

## 0.4 Time and the mission contract

**Goal:** the rules that make Worlds Within different, built and tested before any content.

- **World time, experience time and commitment time** (DESIGN.md), handled by a time service in the
  simulation.
- **Mission contract:** a mission takes a snapshot of world state, declares its possible outcomes up
  front, declares its cost in world time, and returns changes to the world. SMBC's `MiniGameDef`
  (pass/fail/quit, retry allowed) is the starting point, with two changes: results are structured, and
  there are no retries.
- **Frozen events:** while a mission is open, the event it belongs to (the battle) is held still, and
  everything else (construction, caravans) moves forward by the mission's fixed world-time cost, never
  by real time spent. This stops the "stall in a mission to finish the barracks" exploit.
- **Opportunities:** windows that open and close (a passing convoy, a prisoner transfer). Taking one
  mission can close another.
- **Auto-resolve:** every mission can be delegated, with an outcome drawn from its declared outcome
  space and weighted by the units sent.

**Done when:** headless tests cover partial success, failure with no retry, an opportunity closing, and
construction finishing during a frozen battle.

---

## 0.5 The Siege (first vertical slice)

**Goal:** the proof of concept from the design conversation, playable from start to finish.

- An RTS village under siege: defenders, four enemy siege engines, and a barracks under construction.
- The **sabotage mission**, played in the top-down kit. It loads the real defenders (and their
  injuries) from the simulation, and its result is how many engines were destroyed and who was hurt or
  captured.
- The same mission can be **auto-resolved**. Playing it yourself gives a choice of _which_ outcome
  (which engine, whether to capture the officer), not just a better number.
- Battle phases advance, opportunities close, and the siege ends in victory, defeat or a partial result.
- Placeholder art is acceptable; one original song for the siege.

**Done when:** someone who has never seen the game can play the Siege from a link in about 15 minutes,
and both paths (playing the mission and delegating it) change the battle the way the design says.

---

## 0.6 Second mode: tower defense (the platform test)

**Goal:** prove that a new genre can be added without editing the core.

- A tower-defense preparation phase for the Siege: placing defences on the real walls with real
  resources, and fighting a wave whose losses are written back.
- **The test:** adding this mode needs _no changes_ to `src/sim`. Every change it does need is
  recorded as a lesson for the mode API before that API is fixed.

**Done when:** the Siege offers both modes and the core diff is empty (or each change is justified in
the release notes).

---

## 0.7 Heroes and consequences

**Goal:** losses that carry forward.

- Named heroes with injuries, death and capture, carried across modes.
- Capture opens follow-up opportunities (a rescue, an exchange, or leaving them behind).
- Save files and save codes for the campaign, using what SMBC learned (a short code is the save).
- A second scenario that starts from the Siege's results.

**Done when:** losing a hero in the Siege changes how the next scenario plays.

---

## 0.8 Creator tools v1

**Goal:** scenarios written as data, and the tools to inspect them.

- Scenarios and missions defined in data files rather than code.
- An in-browser simulation debugger: the world state, the event log, and stepping and rewinding through
  a replay.
- A timeline viewer showing world time, opportunities and when results were committed.

**Done when:** a new scenario can be added with data files only and checked in the debugger.

---

## 0.9 Third mode and the first chapter's content

**Goal:** enough game for 1.0.

- A third mode, picked by cost and by what the chapter needs. The candidates are a text
  interrogation (cheap, and fits the investigation path), a top-down convoy chase (racer), or reusing
  SMBC's side-view platformer code.
- Four to six linked scenarios forming one short chapter.
- Original art in place of the placeholders.

---

## 1.0 Worlds Within: Chapter 1

**Goal:** a short, finished game that can be played from a link.

- 3–4 polished modes, one chapter, saves that last, and running on desktop and phone.
- The mode API documented as v1 (still internal: no third-party promise yet).

---

## After 1.0 (not planned in detail)

- More modes: a shmup, or a 3D rail shooter (via Three.js or Babylon.js, sharing the same simulation).
- A public mode API and package format for third-party genre modules.
- Full editors (world, event, timeline) built on the 0.8 tools.
- Desktop builds (Tauri or Electron) for Steam.
- Multiplayer: possible because the simulation is deterministic, but not designed for yet.

---

## Open questions, by the release that needs them

| Question                                                                  | Needed by                             |
| ------------------------------------------------------------------------- | ------------------------------------- |
| Is the player a civilization, a hero, or both?                            | 0.3                                   |
| What the simulation tick means in world time (minutes? hours?)            | 0.2                                   |
| Exact rules for retrospective (flashback) missions                        | 0.4 (can be left out until after 1.0) |
| How auto-resolve odds are weighted                                        | 0.4                                   |
| Art direction: chiptune and NES-style pixels like SMBC, or something else | 0.5                                   |
| Which third mode                                                          | 0.9                                   |
