# Worlds Within: Design

**Status: draft for review.** This file is a summary of the design conversation
(`docs/design/conversation.md`) and the review that followed it.

## The idea

One persistent world, played through many genres. The genres are not separate minigames: they are
different views of the same simulation, and what happens in one is carried into the others.

> **Persistent world simulation + multiple playable genres + shared entities + contextual time +
> irreversible consequences.**

The first game is built on a platform designed so that further genre modes can be added later.

## Decisions so far

- **The simulation is the game.** RTS is the main _view_ of it for the first game, not the
  platform's foundation. (This answers the conversation's open question: RTS is one interface over a
  simulation that does not depend on any genre.)
- **Scales:** strategic (RTS economy, territory, armies), tactical (battles, tower defense), personal
  (action, stealth, dungeon), detailed (point-and-click, text, puzzles).
- **Delegate or play:** any mission can be auto-resolved or played. Playing yourself gives _choice_
  over which outcome happens, not just a better result, so players are never forced into genres they
  don't enjoy.
- **Time:**
  - Ordinary processes (construction, production) speed up when nothing is happening.
  - A critical event (a battle) is nearly frozen while a mission that affects it is played.
  - Things outside the frozen event keep going. **The barracks inside the besieged city still gets
    built.**
  - Each mission has a **fixed cost in world time**, set when it starts, so stalling inside a mission
    gains nothing.
- **Narrative time is flexible. Consequences are not.** Events can be played out of order (world time,
  experience time and commitment time are separate), but committed results never change.
- **No do-overs.** Partial success and failure stay. Failure opens new opportunities (a rescue) rather
  than a retry.
- **Opportunities:** windows that close. Taking one mission can cost another. Player attention is the
  scarce resource.
- **Technology:** TypeScript in the browser, building on the SMBC REMIX engine. 3D modes, if any, use
  Three.js or Babylon.js on top of the same simulation.

## Architecture

```
src/engine   loop, scenes, renderer, input, audio (MML synth), save, rng: no game rules
src/sim      the world: entities, components, time, events, missions: no graphics (0.2+)
src/kits     reusable genre kits: topdown (from SMBC); rts, tower defense to come
src/game     Worlds Within itself: scenarios, missions, content
```

- `src/sim` never imports from `engine/gfx`, `kits` or `game`. It runs headless and is deterministic
  from a seed.
- **Mission contract (0.4):** a snapshot of world state goes in, a declared outcome space and
  world-time cost are fixed when the mission starts, and changes to the world come out. A retrospective
  (flashback) mission is one whose outcome space already excludes anything that would contradict
  committed history.
- A kit holds no rules about the world. It reads what it is given and reports what happened.

## Open questions

See the table at the end of `docs/ROADMAP.md`.

## Risks

- **Scope.** Fifteen genres is too many for one game. 1.0 ships with 3–4 polished modes.
- **Each mode gets compared with games that only do that genre.** Depth matters more than breadth.
- **Translating between scales** (a squad as one number in the RTS, individual people in the action
  mode) is the hard engineering problem. It is solved in the simulation core (0.2), not inside each
  mode.
