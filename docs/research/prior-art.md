# Prior art: engines and tools built for LLM coding assistants

**Status: research notes.** These findings come from a prior-art research agent. They have not been
re-checked for this page. Anything marked _not verified_ or _unverified_ must be checked before we rely
on it (in particular, before copying any code). No URLs or version numbers are given here on purpose:
look them up fresh when the time comes.

The question was: has anyone already built a game engine designed first for use with an LLM coding
assistant, and what can we borrow?

## The short answer

- **No mature open-source engine has been designed first for LLMs.**
- The mature tools are **bridges**: they let an AI assistant drive an existing engine (Godot, Bevy,
  Unity, Phaser). The engine underneath was designed for people.
- What would set Worlds Within apart is **determinism and text-first design all the way down**, not
  an MCP server. (MCP, the Model Context Protocol, is a standard way to expose tools to an AI
  assistant.)

## The closest projects

| Project       | What it is                                                                                                                                                                                                                           | License                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Summer Engine | An engine with an MCP/CLI connector layer for AI assistants.                                                                                                                                                                         | Only the connector layer is open (MIT). The engine itself is closed. |
| OpenGame      | An agent (released April 2026) that generates games, mostly with Phaser. It uses a scaffold "Template Skill" to start a project and a "Debug Skill" that keeps a growing list of known fixes. It is a game generator, not an engine. | Apache-2.0                                                           |

## AI bridges onto existing engines

| Tool                        | Engine | Notes                      | License        |
| --------------------------- | ------ | -------------------------- | -------------- |
| Coding-Solo/godot-mcp       | Godot  | MCP server                 | MIT            |
| aigengame/godot-agent (gda) | Godot  | Agent-friendly CLI         | MIT            |
| natepiano/bevy_brp          | Bevy   | Bridge for Bevy            | _not verified_ |
| Unity's MCP server          | Unity  | Beta; needs a subscription | _not stated_   |
| Phaser Editor MCP server    | Phaser | Under development          | MIT            |

## What the benchmark says: GameLogicBench

GameLogicBench (arXiv 2609.21562) tested 20 agent setups on game-logic tasks. The best one solved
**52.78%** of them. Most failed submissions **ran fine but got the rules wrong**.

**Lesson for us:** "it runs" proves little. Checks must be about the rules, tick by tick, from a fixed
seed. And the checks themselves must be tested: run them against **mutants**, which are copies of the
game with one rule removed. If a check still passes with the rule gone, the check is too weak.

Its code license is _not verified_.

## Ideas to borrow

### From gda (the Godot agent CLI)

- `--json` on every command, printing **exactly one** result object, so a script or an agent can read
  it without guessing.
- **Exit codes grouped by kind of failure** (bad input, validation error, failed check, crash), so the
  agent knows what went wrong before reading any text.
- A cheap **`validate`** step (check the files, start nothing), separate from a **boot-and-run** step.
- **Writes are read back** and reported as `verified`, so the agent knows a change really landed.
- **Output is capped**, and anything over the cap goes to a file, so one command can't flood the
  agent's context.
- One small verb set: **get / set / add / remove**.
- The CLI, the MCP tools and the docs are all **generated from one typed schema** (for example Zod),
  so they can't drift apart.

### From the Bevy Remote Protocol

- The protocol belongs to **the engine**. MCP is a thin wrapper that can be added later.
- A good `--json` CLI covers most of the value on its own.

### Agent-shaped documentation

- An **`llms.txt`** file (a plain index of the docs, written for LLMs) plus **one Markdown page per
  module**.
- An **AGENTS.md / CLAUDE.md per module**, in the style of the skill that Koota ships.
- A **one-page API cheat sheet**, in the style of LittleJS.
- **Two shipped skills** (packaged instructions an assistant can load): one to scaffold a new game,
  one to debug a failing run.
- **Keep the API small.** LLMs already know Phaser and Three.js from training, but they don't know
  our API, so every extra function is something they must look up. KAPLAY is said to be very
  token-efficient (_unverified_). Phaser 4's API is so large that a whole third-party industry of
  "skills" has grown up to cover it.

## Libraries

| Library           | Use                   | Verdict                | Notes                                                                                             |
| ----------------- | --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| PixiJS v8         | 2D drawing with WebGL | ADOPT                  | MIT. Publishes an llms.txt.                                                                       |
| Three.js          | 2.5D and 3D           | ADOPT                  | MIT. Publishes an llms.txt. No headless renderer, but our NullRenderer covers headless runs.      |
| Babylon.js        | 3D (alternative)      | Not chosen             | Has a NullEngine, but forum reports say screenshots fail under it. Pick one 3D library, not both. |
| Playwright        | Browser screenshots   | ADOPT                  | Apache-2.0.                                                                                       |
| Rapier            | Physics               | Only if a kit needs it | Use its deterministic builds. Kits keep their own tile collision.                                 |
| Koota             | ECS                   | Candidate              | ISC. Active. Ships agent docs.                                                                    |
| bitECS            | ECS                   | Candidate              | MPL-2.0, which is a caveat if we copy its code.                                                   |
| miniplex          | ECS                   | Candidate              | MIT. Current activity _unconfirmed_.                                                              |
| Our own small ECS | ECS                   | Candidate              |                                                                                                   |
| (none found)      | 2D pathfinding        | Write our own          | No maintained TypeScript library was found. Write grid A\* and flow fields ourselves.             |
| navcat            | 3D navigation meshes  | WATCH                  | License _unverified_.                                                                             |
| OpenRA            | RTS reference         | Ideas only             | GPL-3, so no code. Study its lockstep orders, sync hashes and replays.                            |

An ECS (entity-component-system) stores the world as plain data: entities are ids, components are
fields attached to them, and systems are functions that update them each tick.

## What it means for Worlds Within

- **Hash the state every N ticks.** A hash is a short fingerprint of the whole state. Two runs that
  should be identical can be compared by their hashes, and the first tick where they differ shows where
  things went wrong.
- **The runner checks invariants every tick** (rules that must always hold, like "health is never
  negative"). On failure it reports **the first failing tick** and writes a **replay file** that
  reproduces it.
- **Screenshots are evidence, not tests.** They help an agent (or a person) see what happened, but a
  pass or fail comes from the rule checks.
  - Playwright must **assert the WebGL renderer string**, because headless Chromium can silently fall
    back to SwiftShader (a software renderer) and produce different pictures.
  - Capture only from a **paused, seeded frame**, so the same command gives the same picture.
- **Presentation contract.** Each frame, a backend gets a **read-only snapshot**: for each entity its
  id, kind, position, facing, animation state and tags. It never sees a kit's internals. A per-backend
  **skin** text file maps each kind to a sprite or a mesh. The contract also needs **extension points
  for presentation-only effects** (camera framing, depth, squash and stretch). Without them, 2.5D will
  look like flat 2D placed in 3D.

## Risks

- **The AI-native engine space is crowded and moving fast.** Our edge is determinism and text-first
  design all the way down, not MCP.
- **One RTS kit shared across views can pull rules back into the kit.** Terrain height and line of
  sight are the obvious cases. Decide early whether height is part of the simulation.
- **Determinism is fragile.** WASM physics, floating-point transcendental functions (sin, cos, exp
  and so on can differ between machines) and iteration order can all break it. Enforce simulation
  purity with a lint rule.
