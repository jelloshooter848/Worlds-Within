# Worlds Within: Design

**Status: draft for review.** This file sums up the design conversation
(`docs/design/conversation.md`), the review that followed it, and the owner's later decisions about the
engine. Background research is in [research/prior-art.md](research/prior-art.md).

There are two things here: **the engine**, a reusable set of systems built to be used with an LLM coding
assistant, and **Worlds Within**, the multi-genre game that will be built on it. The engine comes first
and reaches its own 1.0, proved by small sample games, before Worlds Within begins. The two have
separate version lines (Engine 0.x to 1.0, then Worlds Within 0.1 onwards; see
[ROADMAP.md](ROADMAP.md#two-version-lines)).

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
  (data files checked by a schema, text grids, MML), not binary files or code. The one exception
  (from Engine 0.16, item 322): third-party CC0 art and sound packs may be kept as binary files (PNG,
  glTF/GLB, OGG/WAV) in a game's own `assets/` folder, with a `CREDITS.md` giving each pack's source
  URL, author and licence. CC0 is required (CC-BY only with an owner decision; never non-commercial,
  no-redistribution or ripped assets). Code, levels, missions, skins and data stay text, and our own
  MML music stays the main music. Review pictures for the owner (`docs/reports/mockups/` and the
  screenshot review sheets `docs/reports/*-sheet.png`) are the only other binary files.
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
after Engine 1.0.

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
- Each test game and sample game is also a worked example for LLM users and an integration test.
  Engine 1.0 requires a small sample game for every kit, plus a multi-genre sample (the mini siege),
  in `games/samples/`. Since Engine 0.15 all five are there and finished: `dungeon` (top-down),
  `platformer` (platformer, in 2D and 3D; from 0.16 part B the flagship, Hopper's Way, at 16:9), `rts-skirmish`, `tower-defense` and `mini-siege`. The 1.0 API is documented as v1 for our own games only; a public API with a
  promise to outside developers comes later. Samples are games like any other: the engine never imports from them.

### 5. The dependency rule

Dependencies point one way only: **games depend on the engine; the engine never imports from games.**
Inside the engine:

- core imports nothing else;
- backends and kits import only core, and kits not even all of it: never the core's drawing or
  output side (the renderer, sprite sheets, asset loading, audio output, scenes, the loop);
- the simulation imports only core (never a backend or a kit);
- tools (the CLI) may use any engine part, and load a game by its folder path at run time.
- some npm packages belong to one unit: `three` may be imported only by the 3D backend
  (`engine/backends/three`); the table lists each such package and its owners (`PACKAGES`).

This is enforced by an ESLint import-restriction rule **and** a test, both reading one table
(`config/layers.js`), so an LLM can't blur the boundary by accident. A third test scans kit code for
drawing calls, so a kit can't draw through a renderer handed to it either. A second lint rule keeps the simulation and kits pure: no unseeded randomness, no
clock, no DOM.

### 6. The presentation contract

How a kit and a backend talk:

- Each frame, the backend gets a **read-only snapshot**. For each entity: id, kind, position, facing
  (eight directions from 0.9: the four sides and the diagonals; a skin with no diagonal frame falls
  back to the diagonal's horizontal side), animation state and tags. Also the level map, this frame's events (for sounds and effects) and HUD
  values.
- The backend **never sees kit internals** and can't change anything.
- A per-backend **skin** text file maps each kind to a sprite or a mesh, and each event to a sound or
  effect. A `canvas2d` skin names sprite frames; a `three` skin (from 0.6) describes each kind as a
  low-poly mesh made of primitives (box, wedge, cylinder, cone, sphere, plane) in text, each tile
  type as a block, and the 3D camera's defaults (`camera3d`).
- Both backends frame the same point: the camera's follow, deadzone, lerp and clamp maths live in
  core (`CameraFollower`, `engine/core/present/camera.ts`), and the 3D backend places its perspective
  camera so the depth-0 plane shows exactly the 2D picture.
- **Zoom and pointer input** (from 0.9): the Canvas2D backend honours a frame's camera `zoom`, and
  `RtsCamera` in core scrolls and zooms a map larger than the screen with screen-to-world maths
  that match the presenter, so pointer gestures (mouse and touch: tap, box, pan, zoom) from core's
  input land on world points. A kit reads those points; it never sees the canvas.
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

The layout (in place since 0.2; folders marked with a release arrive then). Release numbers without
a name are engine releases.

```
engine/
  core/        loop, scenes, input, audio (MML synth), save, RNG, maths, presentation contract,
               the mission contract and campaign files as plain JSON (0.10), campaign saves
               and save codes (0.13)
  backends/    canvas2d (2D sprites), three (2.5D/3D, from 0.6), null (headless)
  sim/         the world: entities, time, events, missions, auto-resolve, opportunities (from 0.8),
               fates of named people and carry-over between scenarios (0.13)
  tools/       the CLI: validate, run, dump, screenshot, get/set/add/remove; docs generation
kits/          gameplay rules: topdown, platformer (0.5), rts (0.9), towerdefense (0.12), all built
games/
  samples/           engine sample games, all finished in 0.15: rts-skirmish (0.9), mini-siege
                     (0.11), tower-defense (0.12), dungeon (the old demo) and platformer (the 0.7
                     stacking test), both moved here in 0.15; platformer became the flagship in
                     0.16 part B
  platformer-lab/    the platformer kit's test lab (not a sample)
  platformer-classic/ the old platformer sample's five levels and two doors (a test game, 0.16)
  worlds-within/     the game itself (from Worlds Within 0.1, after Engine 1.0)
docs/
```

- **The simulation lives in `engine/sim/`** (from Engine 0.8), because it is a reusable engine system. It stays headless
  and deterministic from a seed, and never imports from backends or kits (enforced by lint and a test).
- **Mission contract (0.10):** a snapshot of world state goes in, a declared outcome space is fixed
  when the mission starts, and changes to the world come out. A retrospective (flashback) mission is
  one whose outcome space already excludes anything that would contradict committed history
  (deferred until after Engine 1.0). As built, the contract is split by layer: the plain JSON types
  (the `mission` content kind, outcomes with delegation weights and data-only effects, reports,
  committed records, opportunity windows and the `MissionAdapter` interface) are in `engine/core`,
  so the sim, kits and tools share them; the lifecycle (open, delegate or play, commit), the time
  service, frozen events and opportunities run in `engine/sim`; each adapter is written where its
  kit and world meet (a game, or a test). A mission's world-time cost is fixed when it opens, and
  committed records are append-only.
- A kit holds no rules about the world. It reads what it is given and reports what happened. Kits
  don't import the simulation: a small adapter turns a mission's snapshot into kit input and the kit's
  report into a mission result. The RTS kit (0.9) is the first: it reads the world's plain snapshot
  and gives orders (plain JSON defined in core); movement, combat, building, training and gathering
  are `engine/sim` systems, and the game's glue applies the orders and steps the world. Recorded
  orders and the seed replay any battle headless to the same state hashes.
- **A new mode needs no change to the simulation** (the platform test, 0.12, built). The
  tower-defense kit (`kits/towerdefense`) plays its rounds by its own deterministic rules, and over
  a world it is one more data-driven mini game with its adapter (`td-defence`,
  `towerdefenseMissionAdapter`): the mission's params pick the world's walls for the build cells,
  the gold from a stockpile and the wave from the world's units, and the outcome's data-only
  effects write the losses back through the sim's existing commit. The standalone sample
  (`games/samples/tower-defense`, no sim) and the mini siege's preparation phase (`fortify`) were
  added with an empty `engine/sim` diff; what the mission API made awkward (fixed effect amounts per
  outcome, world names only for keys the effects name, glue each hosting page copies) is recorded
  in `docs/reports/tower-defense.md` for the API review before 1.0.
- **Heroes and consequences (0.13, built).** A named person (an entity with a squad `Member`) can
  be **injured, captured, freed or killed**, held in an `engine/sim` `Fate` component: states only
  move forward, the history is append-only and dead is final, so a loss is never undone. A
  captured or dead person leaves the map and their squad but stays in the world as a record (a
  captive keeps what is needed to be freed); one killed in battle is kept the same way. Missions
  set fates with one data-only `fate` effect, and a capture's follow-ups (a rescue, an exchange,
  leaving them behind) are ordinary opportunities in one exclusive group; a choice with no round
  is a mission without `play`, only delegated. A failed rescue may open a different follow-up,
  never itself again. Every mode honours fates: the kits' selectors skip the captured and the
  dead and bring the injured in at their hp, and a `mission-room` round's hero can be a world
  unit (`hero: { select, hpPer }`), its hp going into the round and coming back through a
  `damage` effect's `fromReport`.
- **Carry-over, campaigns and save codes (0.13, built).** A scenario names the one it follows in
  `from`, with a carry spec (named people by key, stockpile items by faction, and `when` rules
  opening opportunities for a carried fate). The first world's end gives a small plain JSON
  carried record; the second world is built from its own file and the record, applied at tick 0.
  Nothing else carries (not buildings, positions or the RNG). A `campaign` file lists scenario
  entries with the ticks each is played, beside levels and missions, and is played in order; a
  campaign save holds the position, the seed, the carried record and the committed results, never
  a whole world. A **save code** is that save packed, after SMBC: versioned, CRC-16 checked,
  Crockford Base32 in groups of five, forgiving to type, under 40 characters for the mini siege;
  a code restores the next scenario's start world with the same hash as the run it came from.
  The mini siege proves it with "The dawn assault", which plays differently when its captain was
  taken in the siege.
- **The sample set and the API review (0.15, built).** A finished sample per kit, each the
  worked example an agent copies: original text art, MML music, run files in CI covering a win
  and a loss, a browser test and a line in the games index. What the samples had copied moved
  into the engine and kits: hosting a mission from a page (`MissionHost` events, one round
  picture, the shell's `MissionLaunch` and mission bar for launch, play or delegate, the
  campaign's briefing, result and save code), scenario keys kept beside the world (outside the
  hashed snapshot) for mission params and keyed run checks, effects driven by a played round's
  report within declared limits (refused, never clamped, when over), save codes by stable id,
  frame taps as recorded input, a scene tick rate, stored volumes with the shell's volume
  control, a skin's `background`, the HUD in 3D and `game.json` kit options. The review
  (`docs/reports/api-review.md`) lists every module's entry points as kept, changed in 0.15 or
  listed for 1.0, which is where the v1 API docs start.
- **Presentation and feel (0.16, part A built; parts B-F planned).** Before 1.0, every sample is
  brought to the level of a modern pixel-art indie game (short demos, not full games). Part A
  (built, awaiting the owner's screenshot review) put the shared features in the engine, all
  driven by skins and other text and none of them able to change a run's state: sprite animation
  states with frame events, tweens, particle emitters with additive blending and glow, camera
  effects (shake, look-ahead, zoom, hit-pause, flashes) and parallax, screen transitions, a UI kit
  (bitmap fonts, panels, HUD widgets, buttons, menus, dialog boxes, input from every device), an
  audio mixer (layered music, varied sounds, ducking), a title screen, pause menu and settings
  for every game, PNG sprite sheets and glTF/GLB models in skins, and a 3D backend with lights,
  shadows, fog, tone mapping and world-anchored labels; `games/fx-lab` shows them all and `pnpm
cli sheet` makes the review sheet (`docs/reports/0.16a-effects-sheet.png`). Canvas2D missed the
  frame-time bar with every feature on, so a PixiJS 2D backend is the follow-up task T13b (item
  323). Parts B-F bring each sample to the bar; the mini siege moves to 3D low-poly. The owner's
  playtest decides when it is done. See `docs/ROADMAP.md`.

## Open questions

See the table at the end of `docs/ROADMAP.md`.

## Risks

- **Scope.** Fifteen genres is too many for one game. Worlds Within 1.0 ships with 3–4 polished modes.
- **Each mode gets compared with games that only do that genre.** Depth matters more than breadth.
- **Translating between scales** (a squad as one number in the RTS, individual people in the action
  mode) is the hard engineering problem. It is solved in the simulation (0.8), not inside each mode.
- **Engine before game delays the game.** Nothing of Worlds Within is playable until after Engine 1.0.
  The stacking test (0.7) and the sample games, above all the mini siege (0.11), are the checks that
  the engine work is paying off.
- **Engine parts designed without a real game can miss what games need.** The mini siege is built at
  0.11, right after the mission contract, so the multi-genre layer meets a real (small) game well
  before its API is written down at 1.0.
- **The AI-native engine space is crowded and moving fast.** What sets us apart is determinism and
  text-first design all the way down, not MCP.
- **One RTS kit shared across views can pull rules back into the kit** (terrain height, line of sight).
  Decided at 0.8 (feedback item 101, reasoning in `docs/BUILD-LOG.md`): height is part of the
  simulation as data (an integer elevation per terrain cell and an integer `z` on positions), so
  line of sight and height bonuses are computed in `engine/sim`, never in the kit or views.
- **Determinism is fragile.** WASM physics, floating-point functions like sin and cos (which can differ
  between machines), and iteration order can all break it. Simulation purity is enforced with a lint
  rule, and state hashes catch what slips through.
- **"Runs" is not "right."** In the GameLogicBench study, most failed agent submissions ran but got the
  rules wrong. Rule checks are tick-level and seeded, and are themselves tested against mutants (copies
  with one rule removed).
