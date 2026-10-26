# Worlds Within: Design

**Status: draft for review.** This file sums up the design conversation
(`docs/design/conversation.md`), the review that followed it, and the owner's later decisions about the
engine. Background research is in [research/prior-art.md](research/prior-art.md).

There are two things here: **the engine**, a reusable set of systems built to be used with an LLM coding
assistant, and **Worlds Within**, the multi-genre game that will be built on it. The engine comes first
(see [ROADMAP.md](ROADMAP.md)).

## The idea

One persistent world, played through many genres. The genres are not separate minigames: they are
different views of the same simulation, and what happens in one is carried into the others.

> **Persistent world simulation + multiple playable genres + shared entities + contextual time +
> irreversible consequences.**

---

## Engine principles

### 1. Built first for an LLM coding assistant

The engine is designed to be used mainly through an LLM (like Claude Code). That means:

- **All content is text.** Levels, maps, sprites, music, skins, scenarios and missions are text files
  (data files checked by a schema, text grids, MML), not binary files or code.
- **Every run is repeatable.** The same seed and the same inputs always give the same result, down to
  the tick. Nothing reads the clock or unseeded randomness.
- **The LLM can check its own work.** A command-line tool can validate content, run a game headless,
  check rules tick by tick, compare state hashes, dump the state and take screenshots. Every command
  can answer in JSON.
- **Small API, good agent docs.** LLMs already know Phaser and Three.js, but not our API, so we keep it
  small and document it for them: `llms.txt`, one page per module, a cheat sheet, and skills.
- **A visual editor comes much later** and edits the same text files. A person can use an LLM, the
  editor, or both.

Our edge is determinism and text-first design all the way down. An MCP server is a thin extra, added
after 1.0.

### 2. Layers

```
  ┌───────────────────────────────────────────────────────────────┐
  │ Game (games/<name>): content, skins, missions as data, glue   │
  ├───────────────────────────────────────────────────────────────┤
  │ World simulation (optional): entities, time, events,          │
  │ missions, auto-resolve, opportunities. Headless.              │
  ├───────────────────────────────────────────────────────────────┤
  │ Gameplay kits: platformer, top-down, RTS, tower defense, ...  │
  │ Rules only. Never draw.                                       │
  ├───────────────────────────────────────────────────────────────┤
  │ Presentation backends: 2D sprites, 2.5D/3D, isometric later   │
  │ Draw only. Never hold rules.                                  │
  ├───────────────────────────────────────────────────────────────┤
  │ Core: loop, scenes, input, audio, save, RNG                   │
  └───────────────────────────────────────────────────────────────┘
```

- **Kits plug into backends.** One 2D platformer kit can be shown as 2D sprites or as 2.5D in the
  style of New Super Mario Bros., without changing the kit.
- **A truly 3D gameplay style (like Mario 64) is a separate kit**, not a backend swap, because its
  rules are different.
- Kits and backends sit side by side above core: neither imports the other. They meet only through
  the presentation contract (below), wired together by the game.

### 3. Simple games are first-class

A standalone platformer like SMBC REMIX must be buildable from **core + one kit + content**, with no
world simulation. The simulation is optional.

Genres can also be stacked SMBC's way: a mini game is a scene pushed over a level, and it reports a
result when it ends.

### 4. Engine vs. game

- **The engine** holds every reusable system: core, backends, kits, **and** the world simulation
  (entities, time, events, the mission contract, auto-resolve, opportunities). Simple games just don't
  use the simulation.
- **`games/<name>/`** holds only what makes a game that game: sprites, music, levels, maps, scenarios,
  missions defined as data, skins, and the thinnest possible entry point and glue code.
- **Rule of thumb:** if two games could use it, it's engine. If it's content, it's the game.
  Game-specific rules should be data (scenario and mission files) wherever possible, not code.
- The engine ships no game content, only tiny fixtures for its own tests.
- Each test game is also a worked example for LLM users and an integration test.

### 5. The dependency rule

Dependencies point one way only: **games depend on the engine; the engine never imports from games.**
Inside the engine:

- core imports nothing else;
- backends and kits import only core;
- the simulation imports only core (never a backend or a kit);
- tools (the CLI) may use any engine part, and load a game by its folder path at run time.

This is enforced by an ESLint import-restriction rule **and** a test, so an LLM can't blur the
boundary by accident. A second lint rule keeps the simulation and kits pure: no unseeded randomness, no
clock, no DOM.

### 6. The presentation contract

How a kit and a backend talk:

- Each frame, the backend gets a **read-only snapshot**. For each entity: id, kind, position, facing,
  animation state and tags. Also the level map, this frame's events (for sounds and effects) and HUD
  values.
- The backend **never sees kit internals** and can't change anything.
- A per-backend **skin** text file maps each kind to a sprite or a mesh, and each event to a sound or
  effect.
- **Extension points** carry presentation-only effects: camera framing, depth, squash and stretch.
  Without them, 2.5D would look like flat 2D placed in 3D.

---

## Game decisions so far

- **The simulation is the game.** RTS is the main _view_ of it for Worlds Within, not the
  platform's foundation. (This answers the conversation's open question: RTS is one interface over a
  simulation that does not depend on any genre.)
- **Scales:** strategic (RTS economy, territory, armies), tactical (battles, tower defense), personal
  (action, stealth, dungeon), detailed (point-and-click, text, puzzles).
- **Delegate or play:** any mission can be auto-resolved or played, so players are never forced into
  genres they don't enjoy.
  - **Decided:** delegating gives a fair, average result. Playing yourself gives _choice_ over which
    outcome happens, not a better result.
- **Time:**
  - Ordinary processes (construction, production) speed up when nothing is happening.
  - A critical event (a battle) is nearly frozen while a mission that affects it is played.
  - Things outside the frozen event keep going. **The barracks inside the besieged city still gets
    built.**
  - **Decided:** each mission has a **fixed cost in world time**, set when it starts, so stalling
    inside a mission gains nothing.
- **Narrative time is flexible. Consequences are not.** Events can be played out of order (world time,
  experience time and commitment time are separate), but committed results never change.
- **No do-overs.** Partial success and failure stay. Failure opens new opportunities (a rescue) rather
  than a retry.
- **Opportunities:** windows that close. Taking one mission can cost another. Player attention is the
  scarce resource.
- **Technology:** TypeScript in the browser. The engine started from SMBC REMIX's. 2D draws with
  Canvas2D for now (PixiJS later if needed), and 2.5D/3D uses Three.js on top of the same kits and
  simulation.
- **How it is built:** Claude acts as orchestrator and delegates building and reviewing to agents.

## Architecture

The target layout. The move happens in 0.2; until then the code is under `src/` (see README).

```
engine/
  core/        loop, scenes, input, audio (MML synth), save, RNG, maths, presentation contract
  backends/    canvas2d (2D sprites), three (2.5D/3D, from 0.6), null (headless)
  sim/         the world: entities, time, events, missions, auto-resolve, opportunities (0.8+)
  tools/       the CLI: validate, run, dump, screenshot, get/set/add/remove; docs generation
kits/          gameplay rules: topdown, platformer (0.5), rts (0.9), towerdefense (0.12)
games/
  demo/              the current top-down demo
  platformer-test/   the stacking test (0.7)
  worlds-within/     the game itself (0.9+)
docs/
```

- **The simulation lives in `engine/sim/`**, because it is a reusable engine system. It stays headless
  and deterministic from a seed, and never imports from backends or kits (enforced by lint and a test).
- **Mission contract (0.10):** a snapshot of world state goes in, a declared outcome space is fixed
  when the mission starts, and changes to the world come out. A retrospective (flashback) mission is
  one whose outcome space already excludes anything that would contradict committed history.
- A kit holds no rules about the world. It reads what it is given and reports what happened. Kits
  don't import the simulation: a small adapter turns a mission's snapshot into kit input and the kit's
  report into a mission result.

## Open questions

See the table at the end of `docs/ROADMAP.md`.

## Risks

- **Scope.** Fifteen genres is too many for one game. 1.0 ships with 3–4 polished modes.
- **Each mode gets compared with games that only do that genre.** Depth matters more than breadth.
- **Translating between scales** (a squad as one number in the RTS, individual people in the action
  mode) is the hard engineering problem. It is solved in the simulation (0.8), not inside each mode.
- **Engine before game delays the game.** Nothing of Worlds Within is playable until 0.9. The stacking
  test (0.7) is the check that the engine work is paying off.
- **The AI-native engine space is crowded and moving fast.** What sets us apart is determinism and
  text-first design all the way down, not MCP.
- **One RTS kit shared across views can pull rules back into the kit** (terrain height, line of sight).
  Decide early (by 0.8) whether height is part of the simulation.
- **Determinism is fragile.** WASM physics, floating-point functions like sin and cos (which can differ
  between machines), and iteration order can all break it. Simulation purity is enforced with a lint
  rule, and state hashes catch what slips through.
- **"Runs" is not "right."** In the GameLogicBench study, most failed agent submissions ran but got the
  rules wrong. Rule checks are tick-level and seeded, and are themselves tested against mutants (copies
  with one rule removed).
