# Build log

This is the log of the autonomous build of Engine 0.2–0.15 on branch `engine/build-0.15`, for the
owner's review. Nothing in it is merged to `master`, tagged or published.

What each engine release built and the choices made along the way, newest first. The plan for each
release is in [ROADMAP.md](ROADMAP.md); this file records what actually happened, so the owner can
review the choices.

## Engine 0.10

Time and the mission contract. Built on branch `engine/build-0.15`; not tagged (no tags during
the build, owner answer 24). As in 0.9, the decisions came first, before any code (T1); the later
tasks built against them. The rules are in `engine/sim/CLAUDE.md` (Time, Missions, Opportunities),
`engine/core/CLAUDE.md` (the mission contract, the adapter, the campaign) and
`engine/tools/CLAUDE.md` (Missions in world runs); their agent pages are in `docs/modules/`.

**Stacking-test gaps assigned to 0.10:** G16 (item 84), G20 (item 81), G37 and the rest of G2, from
`docs/reports/stacking-test.md`. Their answers are decisions 8 to 11 below, and all four are fixed
(T8, T9, T10; see "Done when").

### What was built

- **Decisions before code** (T1, `c8448d9`): the three kinds of time, the fixed cost, frozen
  events, the contract, effects, delegation weights, opportunities, flashbacks, the four
  stacking-test gaps and missions in run files, settled in writing (items 150-161, below).
- **The mission contract in `engine/core`** (T2, `7429dc2`): `engine/core/missions.ts`, plain JSON
  with Zod schemas: the mission definition (`event`, a fixed `worldTimeCost`, the mini game it is
  played with, `params`, declared outcomes with delegation `weight`s and data-only `effects`,
  `onQuit`, `playable`; no retry field), the kit's report, the result and the committed record,
  the `MissionAdapter` interface and the delegation draw (`pickOutcome`). The `mission` content
  kind (`*.mission.json`) validates in any game. `MiniGameDef` gains an optional `paramsSchema`
  and `MiniGame` an optional `report()`.
- **The time service and frozen events** (T3, `9625316`): `engine/sim/time.ts`: world time (the
  tick), experience-time clocks for open missions that never move the world, append-only
  commitment stamps, read through `timeOf(world)`; `EventMember` tags and
  `freezeEvent`/`unfreezeEvent`. `move`, `attack`, `death`, `patrol` and frozen workers' tasks
  skip frozen entities; `build`, `train` and everyone outside the event run on.
- **The mission lifecycle** (T4, `f1d3934`): `engine/sim/mission.ts`: `openMission` (records the
  def, the fixed commit tick and freezes the event), `delegateMission` (one weighted draw from
  the mission's own generator, seeded from the world seed and its id), `playMission` and `quitMission` (declared, playable outcomes only),
  `commitMission` and `settleMissions` (the effects under `mission:<id>`, the unfreeze, the
  commitment stamp and an append-only `MissionRecord`). Retries, replays and recommits are
  refused (`mission_committed`, `mission_resolved`).
- **Opportunities** (T5, `e2b19aa`): `opportunitySchema` in `engine/core/missions.ts` and
  `engine/sim/opportunity.ts`: windows of world ticks listed in a scenario or opened by an effect
  (`relative` to the commit), offered, taken, or closed by a rival's take (`exclusive`,
  `closesOthers`, cause `mission:<id>`) or by time (cause `time`).
- **Missions in world run files** (T6, `a91f804`): a world run's `missions` steps (`open`,
  `delegate`, `play`, `quit`, with `experienceTicks` reported and never written to the world),
  refused steps listed in `refusedMissions`, missions committing by themselves at their commit
  tick, `dump` and replay files keeping the steps. The siege fixture
  (`engine/sim/__fixtures__/siege.world.json` with `raid`, `convoy`, `rescue` and `scout`
  `.mission.json` files) and seven run files with golden hashes: `raid-partial`, `raid-failure`,
  `opportunity-closing`, `frozen-construction`, `raid-delegated`, `fixed-cost-few`,
  `fixed-cost-many`.
- **The kit adapter** (T7, `9fbb27b`): `engine/core/mission-adapter.ts` (`snapshotEntities`,
  `playMissionRound`: a kit's input built through a `MissionAdapter`, the round played, its end
  mapped to a declared outcome; an unfinished round, an unmappable report or an undeclared outcome
  is refused). The top-down room challenge gets `report()` (`ChallengeReport`).
  `tests/kits/mission-adapter.test.ts` plays the siege's raid through `kits/topdown` with the
  world's real siege engines as knights, commits it, and delegates the same mission. No kit
  imports `engine/sim`; `config/layers.js` keeps its arrows.
- **G16, params checked with the content** (T8, `b0a2d1a`): `engine/core/minigame-params.ts`,
  `KitDef.miniGameUses`, an optional `miniGames(content)` on the headless entry and
  `engine/tools/mini-game-check.ts`, so `validate` checks every level trigger's and mission's mini
  game id (`unknown_mini_game`) and `params` against the def's `paramsSchema`.
  `roomChallenge` and the lab's stop-bar have schemas; both platformer games export their mini
  games.
- **G20 and G37** (T9, `14953b2`): the platformer world keeps the ended round for the tick it ends,
  and the snapshot has `endedRound` on that tick only; `HeadlessGame.miniGame?()` and
  `HostedGame` in `engine/core/headless.ts`, `HostScene` takes `{ stack, game, picture }`, and
  both platformer games' `scene.ts` went away.
- **G2, a campaign file** (T10, `b725997`): the engine's `campaign` content kind
  (`engine/core/campaign.ts`, `*.campaign.json`: `id`, ordered `{ level }` and `{ mission }`
  entries, an optional `start`), checked by `validate`; the platformer kit plays a game's campaign
  order and keeps the id order without one; both platformer games have a campaign file with their
  old order.
- Agent docs: the 0.10 parts of `engine/core`, `engine/core/content`, `engine/core/shell`,
  `engine/sim`, `engine/tools`, `kits/topdown`, `kits/platformer` and both platformer games in
  their `CLAUDE.md` files and module pages, `llms.txt`, the scaffold skill, the generated schema
  and CLI references (with `mission.json` and `campaign.json` examples) and `docs/CHEATSHEET.md`.

### Decisions

The roadmap's "decisions needed first" for 0.10 are how delegated outcomes are weighted and the rules
for flashback missions. The other open questions (what the three kinds of time are in code, how the
fixed cost is applied, what a frozen event is, where the mission types live, what a run file says
about missions, and the four stacking-test gaps) were settled in writing too, before any code. Each
one is a feedback item (150-161) the owner can overrule by number. Three rules were already the
owner's and are restated here as decided, not open: **a mission's world-time cost is fixed when it
starts**, **delegating gives a fair, average result and playing gives choice, not a better one**, and
**committed results never change** (DESIGN.md, "Game decisions so far").

**1. Three kinds of time (item 150; the rules are the owner's).**

- **World time** is the world's integer `tick` (one tick is one world minute, item 100). Only
  `world.step()` moves it, and nothing a mission does moves it any other way.
- **Experience time** is the ticks the player spends inside an open mission (the kit's own round
  ticks). It is counted on the mission's record for reports and never moves the world: ten ticks or
  ten thousand inside a mission leave the world where it was.
- **Commitment time** is the world tick at which a mission's result is committed (decision 2 fixes
  it at open tick plus cost).
- **Committed results never change.** A commit is an append-only record in the world (mission id,
  outcome, how it was resolved, open and commit ticks, experience ticks, the effects applied and
  any skipped). Nothing edits or removes a record; opening, playing, delegating or committing a
  mission that is already committed is refused (`mission_committed`), never an error that changes
  state. A mission definition opens at most once per world; something that happens again is a new
  mission id.

Reasons: these are the DESIGN.md times made concrete with the tick the sim already has, so no second
clock exists to drift; keeping experience time off the world clock is what makes "stalling gains
nothing" true by construction; an append-only record is the simplest way to make "consequences are
not flexible" checkable (a test can compare the log before and after any later action).

**2. The fixed world-time cost (item 151; fixed at start is the owner's rule).** A mission's data
gives `worldTimeCost`, a whole number of ticks, at least 1. It is read when the mission opens and
copied onto the open mission's record, so editing the data later never changes a mission already
open. Opening at tick `T` sets the commit tick to `T + worldTimeCost`.

- **The world moves exactly `worldTimeCost` ticks between open and commit,** with the mission's
  event frozen (decision 3) and everything else running. The result is committed at the end of the
  step that brings the world to `T + worldTimeCost`, after that tick's systems and before its
  snapshot, so the snapshot of the commit tick already shows the result. The result can never land
  earlier, even when the mission was played or delegated at once.
- **In live play** the world does not step while the player is inside the mission; when the round
  ends, the shell steps the world through the cost (fast, with the event frozen) and the result
  commits on the last of those ticks. **In a run file** the world steps tick by tick as usual and
  the play or delegate entry can come at any tick between open and commit. Both give the same
  ticks, the same commit tick and the same hashes, which is how the "cost is the same however many
  ticks are spent inside it" test is written (decision 12's `experienceTicks`). This holds because
  resolving a mission changes nothing in the world before its commit and the delegation draw comes
  from the mission's own seeded generator, not `world.rng` (decision 5), so the tick of a play or
  delegate entry never moves a hash.
- **If the cost runs out while the mission is still unresolved** (opened, then neither played nor
  delegated by the commit tick), it is delegated at that moment (decision 5) and committed. Leaving a
  mission open therefore gains nothing and loses nothing over delegating it at once. A mission being
  played when its cost runs out cannot happen live (the world is not stepping); in a run file it is
  refused at load (`mission_unresolved`: a `play` entry after the commit tick).

Reasons: fixing the number at open is the owner's rule; committing at a fixed tick, not "when the
player is done", is what keeps the world's history independent of experience time, so a played and
a delegated run of the same mission reach the commit tick with the same unrelated world state, and
`world.rng` stays on the same stream before and after it (only the outcome, how it was resolved and
its effects differ; decision 5's draw touches no shared randomness). Delegating on time-out reuses the one fair path rather than
adding a "missed" outcome every mission must declare.

**3. Frozen events (item 152).** An **event** is a named group of entities taking part in one
critical happening (a battle): each has an `EventMember` component `{ event: "<id>" }`, written in
the scenario or by an effect. A mission names the event it belongs to (`event`, optional: a mission
with no event freezes nothing). While a mission is open its event is **frozen**: the world keeps the
set of frozen event ids as data (decision 12 keeps it out of snapshots that do not use it), and a
frozen entity is one whose `EventMember.event` is in that set.

- **Skip frozen entities:** `move`, `attack` (a frozen unit does not attack, and no unit attacks or
  damages a frozen one, so the battle cannot be fought from outside), `death` (a frozen entity does
  not die) and `patrol`; and a frozen worker does not walk, gather, haul or build (its task waits).
- **Keep running:** `construct`, `train`, `gather`, `haul` and `build` for every entity outside the
  event, and construction and training progress of buildings, frozen or not. **The barracks still
  gets built:** the city's builders are not members of the battle; only the fighting forces are.
- Two open missions may not freeze the same event: opening a second mission on a frozen event is
  refused (`event_frozen`). Unfreezing happens at the commit, after the effects are applied.

Reasons: a component tag is data, saved and hashed like everything else, and needs no new world
structure; listing which systems skip frozen entities (rather than freezing whole systems) is what
lets the economy run while the battle holds; refusing outside attacks keeps the "nearly frozen"
battle from being decided before the mission returns.

**4. The mission contract (item 153).** A mission takes a snapshot of world state, declares its
outcome space up front (fixed when it opens) and returns structured changes. It starts from SMBC's
`MiniGameDef` (and ours in `engine/core/minigame.ts`) with the roadmap's two changes:

- **Structured results.** Not pass, fail or quit: a mission declares a list of outcomes, each with an
  `id`, a short `title`, a delegation `weight` (decision 5) and the `effects` it makes (decision 4b
  below), so partial success is an outcome of its own ("two of three engines burnt").
- **No retries.** There is no `attempt` and no second round. A played mission ends in one of its
  outcomes; quitting a played mission commits the outcome its data names as `onQuit` (required:
  quitting is a choice like any other, not a way back to the average), and once play has started it
  can no longer be delegated. Failure is an outcome whose effects can open new opportunities (a
  rescue), never a retry.
- **Where the types live.** The plain JSON contract goes in `engine/core` (a `missions.ts` beside
  `orders.ts`, with Zod schemas), so `engine/sim`, kits and tools share it: the mission definition
  (the `mission` content kind, `*.mission.json`), outcomes, effects, the kit's report (`{ outcome,
stats }`) and the committed result record. The **lifecycle** (open, play or delegate, commit,
  freezing) is in `engine/sim`. The **adapter** is an interface in `engine/core`, `MissionAdapter`:
  `input(snapshot, mission)` turns the plain world snapshot into what a kit needs, and
  `outcome(report, mission)` turns the kit's report into one declared outcome id. Adapters are
  written per game and kit pairing in the game (or in a kit, when it reads only the plain snapshot,
  as `kits/rts` does), and a kit never imports `engine/sim`; `config/layers.js` does not change.
- **Existing mini games stay.** `MiniGameDef`, `MiniGameResult` and hosted rounds keep pass, fail and
  quit for the platformer hosts; a mini game can be a mission's played path through an adapter that
  maps its result and snapshot to an outcome id.

**4b. Effects (part of item 153).** An outcome's effects are a small set of data-only world changes,
applied in file order at the commit inside `world.withCause('mission:<id>')`, so each is in the event
log with the mission as its cause:

- `damage` `{ entity, amount }` (lowers `Health.hp`, never below 0; the death system removes it on a
  later tick, after the unfreeze), `destroy` `{ entity }`;
- `inventory` `{ entity, item, add }` (negative removes, never below 0);
- `set` `{ entity, component, values }` (merged into the component and checked against its schema);
- `opportunity` `{ open | close: "<id>" }` (decision 6).

Entities are named by the scenario's `$ref` names or ids. An effect whose entity no longer exists at
the commit is skipped and listed in the record's `skipped`, never an error; an effect that would
break a component schema is a content error caught by `validate` where the data allows, and refused
at commit otherwise. Reasons: data-only effects keep game rules in data (CLAUDE.md), give the
delegated path and the played path exactly the same changes for the same outcome, and keep the list
short enough for 0.11's mini siege; more kinds are added when a sample needs them.

**5. Delegate or play, and how delegated outcomes are weighted (item 154; the rule is the
owner's).** **Delegating draws one outcome from the declared outcome space with a generator seeded
from the world's seed and gives a fair, average result. Playing gives choice over which declared outcome happens, not
a better one.** The roadmap's decision needed first is answered this way:

- **Weights are whole numbers in the mission data**, one per outcome, at least 1 (default 1).
  Delegating draws `int(totalWeight)` once and walks the outcomes in file order to the one that
  number falls in. The draw comes from the mission's own generator,
  `Rng.derived(world.seed, "mission:<id>")` (`engine/core/rng.ts`), never from `world.rng`: a
  mission opens at most once per world, so the draw is fixed by the seed and the mission id alone.
  It is the same whenever the delegation happens (at the open tick, any tick before the commit, or
  at the commit tick on a timeout), and it moves no other randomness, so a system drawing from
  `world.rng` every tick (the hauler) sees the same stream whether the mission was delegated, played
  or left to time out. A delegated run is still repeatable from the seed and saved state. (Fixed
  after review: the first answer drew from `world.rng` at the moment of delegation, which made the
  hashes depend on the delegate entry's tick and broke decision 2's promises.)
- **"Fair, average" means the weights are the designer's statement of how the mission usually goes
  for a competent commander**: delegating gives each outcome with its weight's share, so partial
  outcomes come up as often as the data says, and the delegated result is on average the weighted
  mix of the declared outcomes. No outcome is hidden from delegation: weight 0 is not allowed, so
  anything a player can reach by playing, delegation can also reach.
- **Playing chooses, it does not improve.** A played mission commits the outcome its kit report
  names, through the adapter; its effects are that outcome's declared effects, exactly as if it had
  been drawn. A played result outside the declared space (an outcome id the mission does not list)
  is refused (`unknown_outcome`) and the mission stays open. A mission may restrict which outcomes
  can be played (`playable`, a subset, default all) but never adds any.

Reasons: integer weights drawn with a seeded generator are the smallest rule that is deterministic, needs
no floats, and lets a designer say "usually partial, sometimes clean, sometimes a loss" in data; a
rule like "always the middle outcome" would make delegation predictable and partial outcomes
pointless. A per-mission generator rather than a draw from `world.rng` at the commit tick keeps
`delegateMission` able to name the outcome at once (the shell shows it) and keeps `world.rng`'s
stream the same for played and delegated runs.

**6. Opportunities (item 155).** An opportunity is a window, in data, in which a mission can be
taken: `{ id, mission, opens, closes, exclusive?, closesOthers? }`, with `opens` and `closes` world
ticks (`opens <= tick < closes`). They are listed in the world scenario (`opportunities`, optional;
the scenario format stays version 1, as every version 1 file reads the same) or opened later by an
effect (with ticks relative to the commit tick).

- **Offered** means open and not yet taken or closed; the world's snapshot lists the offered ones
  (when any opportunity data exists), so a kit or page can show them.
- **Taking one** is opening its mission while it is offered. A mission named by an opportunity can
  only be opened through it (opening it outside its window is refused, `opportunity_closed`).
- **Taking one closes others**: every opportunity in the same `exclusive` group, and every id in its
  `closesOthers` list, closes when it is taken. One whose `closes` tick passes untaken closes on its
  own. Each close is logged (cause `mission:<id>` when a take closed it, `time` when it ran out).

Reasons: windows in world ticks fit the one clock; an exclusive group covers "the convoy or the
prisoner transfer" with no list to keep in step, and an explicit list covers one-way costs; both are
data, so a test can show an opportunity closing with no game code.

**7. Flashback missions are out of scope (item 156).** The rules for flashback (retrospective)
missions are deferred until after Engine 1.0, as the roadmap allows. 0.10 keeps nothing that would
block them: commitment time is already separate from world time, so a later release can let a
mission commit "into the past" as a new append-only record without changing this contract.

**8. G16: params checked with the content (item 157, answering item 84).** `MiniGameDef` gets an
optional `params` Zod schema, and so does a mission definition (its `params`, checked against the
schema of the kit or mini game it is played with). `validate` runs them over every level trigger's
`params` and every mission's `params`, so a door with `"goal": "defeat-al"` fails `validate`, not the
run. The tools learn a game's mini games from an optional `miniGames` list on the headless entry
(`HeadlessEntry.miniGames`), beside `createGame`; a game without it is validated as today. Item 84
is answered: yes, in 0.10.

**9. G20: the round's last tick in the snapshot (item 158, answering item 81).** On the tick a
hosted round ends, the host's snapshot keeps the ended round (its final state and its result) for
that one tick, and drops it on the next. This moves the lab's `mini-game` golden hashes once:
`games/platformer-lab/runs/mini-game.hashes.json` is re-recorded, and so is
`games/platformer-test/runs/level-4.hashes.json` if its recorded ticks include a round's last tick.
The commit lists every re-recorded file; no other golden hash may move. Item 81 is answered: keep it.

**10. G37: the hosted round in the game contract (item 159).** `HeadlessGame` gets an optional
`miniGame()` returning the round now hosted (`{ id, title, snapshot, present? }`) or null, so the
shell's `HostScene` takes the game itself instead of the five accessors each game's `scene.ts`
writes. Games without hosted rounds leave it out.

**11. G2, the rest: a campaign file (item 160).** A new engine content kind, `campaign`
(`*.campaign.json`): `{ "version": 1, "entries": [{ "level": "level-1" }, { "mission": "raid" }] }`,
an ordered list of level or mission ids that `validate` checks against the content. A platformer
game with a campaign plays its levels in that order; without one, the 0.7 order (by id, numbers as
numbers) stays, so existing games and hashes do not change. _Built in T10 with two additions the
task asked for: a required `id` (the file name, as every kind with an `id`) and an optional `start`
(the entry played first; a looping sequence goes round from it). Only the levels a campaign lists
are played; its missions are checked only (playing them in order is 0.13). Both platformer games
got a campaign file with their old order, so no run file or golden hash moved._

**12. Missions in run files (item 161).** A world run file gets an optional `missions` list beside
`orders`: `{ "tick": 40, "mission": "raid", "action": "open" | "play" | "delegate", "outcome"?,
"experienceTicks"? }`. Entries apply between ticks like orders (after the snapshot of `tick`, before
the step), after that tick's orders, in file order. `play` needs `outcome` (headless, the played
round's report is stood in for by the outcome it reached; the kit path through an adapter is a game
run, T7) and may give `experienceTicks`, which is recorded and changes nothing else. A refused entry
is listed in the result (`refusedMissions`) and the run goes on, as with orders (item 136).
**Existing 0.8 and 0.9 golden hashes must not move:** the world's snapshot gains mission, frozen
event and opportunity state only when a scenario or run uses them, so `village.hashes.json`, the
battle fixture and every sample run keep their hashes.

### Choices made

The decisions above are items 150-161; T8, T9 and T10 noted how they were built under 157-160 in
`FEEDBACK-LOG.md`. The other builders' choices are items 162-165 ("Engine 0.10, builder choices"):

- **An effect that would break a component schema is skipped, not refused** (T4, item 162): at the
  commit it is listed in the record's `skipped`, like an effect whose entity is gone, so a commit
  never fails part-way. Decision 4b said "refused at commit"; see "Deviations".
- **Run files can `quit`, and know when it is too late** (T6, item 163): decision 12 listed
  `open`, `play` and `delegate`; `quit` (the mission's `onQuit`) was added so the failure fixture
  can show quitting is a choice. A `play` or `quit` at or after the commit tick its `open` fixed
  is refused at load (`mission_unresolved`, exit 3). A mission's file is `<id>.mission.json` beside
  the scenario or in a `missions/` folder there.
- **Opportunities opened by an effect are `relative` and start `dormant`** (T5, item 164): their
  window is counted from the commit tick that opens them, and one never opened stays dormant (a
  success leaves the rescue untakeable). When several opportunities name one mission, opening it
  takes the lowest-id one offered.
- **The adapter helpers are engine code, the adapters are not** (T7, item 165): `MissionAdapter`,
  `playMissionRound` and `snapshotEntities` are in `engine/core`; the one adapter written so far
  (the siege raid as a top-down room) is in a repo test, since no game plays a mission until the
  mini siege (0.11).
- The root `package.json` version was left as it was, as in earlier releases of this build.

### How to try it

```sh
pnpm -s cli run engine/sim/__fixtures__/raid-partial.run.json --json         # partial success, played
pnpm -s cli run engine/sim/__fixtures__/raid-failure.run.json --json         # failure, retries refused
pnpm -s cli run engine/sim/__fixtures__/opportunity-closing.run.json --json  # windows closing
pnpm -s cli run engine/sim/__fixtures__/frozen-construction.run.json --json  # a barracks up during a frozen battle
pnpm -s cli run engine/sim/__fixtures__/raid-delegated.run.json --json       # the same raid delegated
pnpm -s cli run engine/sim/__fixtures__/fixed-cost-few.run.json --json       # played at once, 1 experience tick
pnpm -s cli run engine/sim/__fixtures__/fixed-cost-many.run.json --json      # played late, 100,000 experience ticks
pnpm -s cli dump engine/sim/__fixtures__/raid-failure.run.json --tick 36 --json   # the committed record
pnpm -s cli validate games/platformer-test --json      # trigger params and the campaign checked
pnpm vitest run tests/runs/missions.test.ts tests/kits/mission-adapter.test.ts
```

A refused step shows in the result's `refusedMissions` and the run still passes; the experience
ticks of each played mission are in `experience`.

### Done when

Checked again on 2026-11-02 at `8b1c8c6`, after the fixes below (first checked at `928b1de`): `pnpm lint &&
pnpm docs:check && pnpm typecheck && pnpm test && pnpm build` pass (143 test files, 1560 tests passed and 1 skipped: the opt-in every-tick save check of 0.8), and every one of the
24 run files (9 sim fixtures, 7 of them the new mission runs; 1 demo, 6 lab, 4 stacking-test and
4 skirmish runs) exits 0 with the same final hash on two runs in a row.

- **Met: partial success.** `engine/sim/__fixtures__/raid-partial.run.json`: the raid opens at
  tick 5 and is played to `partial` (240 experience ticks); at tick 35 the record says `partial`,
  `played`, commit tick 35, nothing skipped; the ram is destroyed (5 units left) and the tower
  damaged, the two effects of `partial` and no others. `engine/sim/mission.test.ts` ("applies only a partial success's
  effects").
- **Met: failure with no retry.** `raid-failure.run.json`: the raid is played to `repelled`; a
  second play at tick 10 is refused `mission_resolved`, and reopening and redelegating it at tick 36
  are refused `mission_committed` (`tests/runs/missions.test.ts` checks the three refusals); the
  failure opens the `rescue-window` opportunity, whose mission is then quit (`lost`, `quit`).
  `mission.test.ts` ("commits a failure and refuses any retry, replay or recommit").
- **Met: an opportunity closing.** `opportunity-closing.run.json`: taking the raid at tick 13
  closes its exclusive rival (cause `mission:raid`), so `convoy` is refused `opportunity_closed`;
  another window closes by time at tick 25 (cause `time`), so `scout` is refused at tick 30; the
  untouched raid is delegated on time-out at its commit. `opportunity.test.ts`.
- **Met: construction finishing during a frozen battle.** `frozen-construction.run.json`: the raid
  opens at tick 0 and freezes the `siege` event; at tick 29 the barracks is done while the battle's
  units keep their hp and no cooldown runs; at tick 30 the event is unfrozen and the delegated
  result committed. `engine/sim/time.test.ts` ("finishes a building while the battle's units do
  not move, fight or cool down", and the same after a save and load mid-freeze).
- **Met: each passes with the same hashes on every run.** `tests/runs/missions.test.ts` plays each
  of the seven mission run files twice and compares both with its golden `<name>.hashes.json`;
  `tests/runs/run-files.test.ts` does the same for every run file in the repo; the close-out ran
  all 24 through `pnpm -s cli run` twice (final hashes: `raid-partial`, `fixed-cost-few` and
  `fixed-cost-many` `60557f2e9c5e2245`, `raid-failure` `c219347c68a05f79`,
  `opportunity-closing` `64b81a6c75dcf888`, `frozen-construction` `6fff6d27447601e1`,
  `raid-delegated` `feef2c86380efd95`, the last three re-recorded by the delegation fix below;
  every earlier run file kept its hash).
- **Met: a mission's world-time cost is the same however many ticks are spent inside it.**
  `fixed-cost-few.run.json` (played at tick 5, 1 experience tick) and `fixed-cost-many.run.json`
  (played at tick 34, 100,000 experience ticks) commit at tick 35 and have the same hashes from
  there on (`tests/runs/missions.test.ts`), and `raid-partial` (240 ticks) ends on the same hash;
  `mission.test.ts` ("the same hash after commit whether 0, 1 or 10,000 experience ticks pass
  inside", "played at once or in a run that steps the world tick by tick").
- Scope items, each with its code and tests: the three kinds of time in a time service
  (`engine/sim/time.ts`, `time.test.ts`); the mission contract with structured results and no
  retries (`engine/core/missions.ts`, `missions.test.ts`; `engine/sim/mission.ts`,
  `mission.test.ts`); kits not importing the sim, with an adapter from snapshot to kit input and
  from report to result (`engine/core/mission-adapter.ts`, `mission-adapter.test.ts`,
  `tests/kits/mission-adapter.test.ts`, `kits/topdown/challenge.test.ts`,
  `tests/architecture/dependency-rule.test.ts`); frozen events (`time.test.ts`,
  `frozen-construction.run.json`); the fixed world-time cost (above); opportunities
  (`engine/sim/opportunity.ts`, `opportunity.test.ts`, `opportunity-closing.run.json`); delegate
  or play for every mission (`raid-delegated.run.json`, `mission.test.ts` "delegation": repeatable
  from the seed, in proportion to the weights over 4,000 seeds; the adapter test delegates the
  played mission too); missions as data files (the `mission` content kind,
  `engine/core/content/kinds.test.ts`, `engine/tools/missions-run.test.ts`).
- **Stacking-test gaps, all fixed in 0.10:** G16 (`engine/core/minigame-params.test.ts`,
  `engine/tools/mini-game-check.test.ts`: `"goal": "defeat-al"` fails `validate` at
  `triggers.0.params.goal`), G20 (`kits/platformer/minigame.test.ts`; `level-4.run.json` and the
  lab's `mini-game.run.json` assert the round's last events from `endedRound`), G37
  (`engine/core/shell/shell.test.ts`; both games' `scene.ts` deleted) and the rest of G2
  (`engine/core/campaign.test.ts`, `kits/platformer/sequence.test.ts`, the games' tests showing a
  reordered campaign reorders play). `docs/reports/stacking-test.md` marks all four fixed in 0.10.

### Deviations from the roadmap

- **Effects that break a schema are skipped at commit** (item 162), not refused as decision 4b
  said: a refusal there would leave a due mission uncommittable, and "skipped and listed" was
  already the rule for a missing entity.
- **Run files have a `quit` action** (item 163) beyond decision 12's three.
- **No game plays a mission yet.** The adapter path is proven in a repo test with the top-down kit
  and the sim's siege fixture (T7); the roadmap keeps every playable sample for 0.11, so this is in
  scope, but the first game adapter and live play (stepping the world through the cost after a
  round, decision 2) are the mini siege's.
- **Missions in a campaign are checked, not played** (item 160): playing them in order waits for
  0.13.
- **The stacking-test summary counts were off by one** since 0.7: its lists give 20 gaps fixed in
  0.7 and 17 moved, not 21 and 16 (the 0.9 log above repeats the old numbers). The report now
  says 20 fixed in 0.7, 4 fixed in 0.10 (G16, G20, G37 and the rest of G2, which was already
  counted fixed in 0.7), and 14 still moved to 0.11, 0.14 and 0.15.
- **Feedback numbering:** T1's decisions are 150-161; the close-out added 162-165 and the final
  check 166-171.

### Fixes after the first close-out

A review after the first close-out (`9513ce6`) found three problems, each fixed with tests:

- **Delegation drew from `world.rng`** (`499d3f5`): the draw happened at the delegation tick, so
  the hashes depended on when a run delegated, against decision 2. It now comes from
  `Rng.derived(world.seed, "mission:<id>")`, the same at any tick or on a timeout, and moves no
  other randomness. Decisions 2 and 5 and item 154 were reworded; the golden hashes of
  `frozen-construction`, `opportunity-closing` and `raid-delegated` were re-recorded.
- **Commit order and overdue missions** (`ccded36`): `settleMissions` commits every due mission in
  commit tick, then id order, and `commitMission` goes through it, so a live commit and a
  tick-by-tick run give the same hashes. A mission stepped past unsettled is no longer stuck as
  `mission_overdue`; it cannot be resolved any more and commits on the next settle (item 167).
- **A quit round counted as played** (`8b1c8c6`): `playMissionRound` now takes a round that ends
  in quit straight to `onQuit` and the record says `quit` (item 168).

### Outstanding issues

- **Live play of a mission is not built**: the shell stepping the world through the cost after a
  round (decision 2) and an RTS or platformer game hosting a mission come with the mini siege
  (0.11).
- **Only five effect kinds** (`damage`, `destroy`, `inventory`, `set`, `opportunity`); more come
  when a sample needs them. Effects whose component data `validate` cannot see are checked only at
  the commit (and skipped there).
- **Flashback missions** are deferred until after Engine 1.0 (item 156).
- **Campaign missions are not played in order** until 0.13.
- **Recorded experience ticks are in the hashed state** (item 166): a kit round that records its
  ticks with `addExperience` changes the hash after the commit in that one number.
- Open owner decisions: items 150-171 in `FEEDBACK-LOG.md`.

## Engine 0.9

The RTS kit and view. Built on branch `engine/build-0.15`; not tagged (no tags during the build,
owner answer 24). The kit's rules are in `kits/rts/CLAUDE.md` and the sample's in
`games/samples/rts-skirmish/CLAUDE.md`; their agent pages are `docs/modules/kits-rts.md` and
`docs/modules/games-samples-rts-skirmish.md`. The decisions came first, before any code; notes
from the tasks that needed more than a line (T3, T4, T9, T10, T12) follow the summary.

**Stacking-test gaps: none are assigned to 0.9.** The gap report (`docs/reports/stacking-test.md`)
moved its 16 open gaps to 0.10, 0.11, 0.14 and 0.15, so this release took none over.

### What was built

- **Decisions before code** (T1): the hero unit and the other open 0.9 questions, settled in
  writing (items 121-132, below).
- **Eight-way facing and Canvas2D zoom** (T2): `Facing` in `engine/core/present` gains the four
  diagonals (`FACINGS`, `cardinalFacing`, `mirrorFacing`, `facesLeft`); a skin with no diagonal
  frame falls back to the horizontal part, and `flipFacing` mirrors right-hand frames for the
  left-hand ones (the 3D backend mirrors them too). `SkinnedCanvasPresenter` honours `zoom` (the
  hint's, else the skin's): the map copy, tiles and sprites are scaled, positions rounded to whole
  picture pixels, and `CameraFollower` frames and clamps the zoomed view (`cameraView`,
  `cameraZoom`). Zoom-1 drawing, run files and golden hashes are unchanged.
- **The rendering benchmark** (T3): `tests/bench/rts-render/`, a seeded synthetic RTS scene drawn
  by the engine's Canvas2D presenter in headless Chromium, with an optional PixiJS v8 column from a
  scratch install. Canvas2D holds the 500-unit target, so PixiJS is not added (item 133; numbers
  in "T3: the rendering benchmark" below). T4, the PixiJS backend, was therefore not built.
- **Pointer input and the RTS camera** (T5): `engine/core/input/pointer-logic.ts`
  (`PointerGestures`, pure: tap, long-press, box drag, middle-button and two-finger pan, edge
  scroll, wheel and pinch zoom, for mouse, pen and touch) and `pointer.ts` (`PointerSource` on the
  canvas); `RtsCamera` in `engine/core/present` (scrolling clamped to the map, zoom 0.5 to 2,
  `worldToScreen` / `screenToWorld` that match the Canvas2D presenter); `pointer` and `touchPad`
  options in `bootBrowserGame`, off and on by default, so existing games are unchanged.
- **Pathfinding** (T6): `engine/sim/astar.ts`, in-house and all integer: `findPath` (A\* with a
  fixed tie-break, a cap on expanded cells and a per-terrain cache) and `flowField` / `flowStep`
  for a group sharing a goal, 4-way (the default, identical to `distanceField`) or 8-way (10/14
  costs, no corner cutting). Measured on a 256 x 256 map with 300 units; groups of
  `FLOW_GROUP_SIZE` (4) or more use a flow field.
- **Orders, movement and combat** (T7): the order as plain JSON with a Zod schema in
  `engine/core/orders.ts` (shared by the sim and kits); `applyOrder` in `engine/sim/rts.ts`
  (checked against the world, a refused order changes nothing, every change under
  `order:<id>`); the `Unit`, `Facing8`, `Task`, `Target` and `Cooldown` components; `moveSystem`,
  `attackSystem` and `deathSystem`. Heroes are ordinary units an order can name alone.
- **Construction, training and one resource** (T8): `build`, `train` and `gather` orders; unit and
  building types as data (`engine/core/rts-types.ts`, held in the world by `RtsTypes`);
  `engine/sim/economy.ts` places paid sites with footprints, builds them with workers, trains
  queued units next to finished buildings and gathers gold into the faction's stockpile.
- **Recorded orders, lockstep replay and sync hashes** (T9): run-file `orders`
  (`{ tick, ...order }`) and sync `hashes` that `run` checks, stopping at the first that differs;
  the optional `HeadlessGame.order`; a scenario's system set (`"systems": "village" | "rts"`); the
  recorded battle fixture `engine/sim/__fixtures__/battle.run.json`.
- **`kits/rts`** (T10): a typed reader of the sim's plain world snapshot, click and box selection,
  the command mapper, the scripted enemy as data, `presentWorld`, `RtsControls` and the headless
  adapter `rtsGame`; content kinds `rts-map`, `rts-types`, `rts-enemy`; rules `RTS_RULES` (five;
  mutant checks report-only, not strict). It imports only `engine/core`.
- **`games/samples/rts-skirmish`** (T11, T12): the first sample game, one 40 x 24 map as a world
  scenario, unit and building types, a scripted raiding party, text pixel art and a Canvas2D skin,
  joined to `engine/sim` and `kits/rts` by thin glue; four run files with sync hashes and golden
  hashes (they guard all five kit rules); and its page (`index.html`, `main.ts`, `play.ts`,
  `recording.ts`): mouse and touch play over a scrolling, zooming camera, a button bar, and Export,
  which downloads the battle as a run file the CLI replays.
- Agent docs: `kits/rts/CLAUDE.md`, `games/samples/rts-skirmish/CLAUDE.md` and their pages
  (`docs/modules/kits-rts.md`, `docs/modules/games-samples-rts-skirmish.md`) linked from
  `llms.txt`; the 0.9 parts of `engine/sim`, `engine/core`, `engine/core/present`,
  `engine/core/shell`, `engine/backends/canvas2d` and `engine/tools` in their `CLAUDE.md` files
  and pages; the generated schema, CLI and kit-list references; `docs/CHEATSHEET.md`.

### Decisions

The roadmap's one "decision needed first" for 0.9 is the hero unit. The other questions below were
open too (how a kit that may not import `engine/sim` drives it, how orders are recorded, items 48
and 108, what the benchmark must reach, and what a map is), so they were settled in writing before
any code, and later tasks build against them. Each one is a feedback item (121-132) the owner can
overrule by number.

**1. The hero unit: yes, as an ordinary unit entity (item 121).** A directly controlled hero is an
ordinary unit entity in the world (`Position`, `Health`, `Owner` and the RTS unit components like
any other unit) that also has a `Member` with role `hero` in its squad, reusing the squads of
`engine/sim` (item 116). Orders name the entities they apply to, so the player can select and order
a hero on its own, a whole squad, or a mix of both; nothing in the order format knows the
difference. Reasons:

- It keeps the door open for Worlds Within's commander plus named heroes (item 11, the WW 0.1
  question) without a second kind of unit: a hero is a unit with a name and a role, not a new code
  path in the kit or the sim.
- Squads already name their heroes and captain (0.8), so a personal-scale mode (0.11 onwards) can
  find the same hero the RTS view moved.
- 0.9 adds no hero-only rules (no abilities, no levelling). Those belong to 0.13 (heroes and
  consequences in the simulation). The kit may draw a hero's selection ring differently, read from
  its `Member` role in the snapshot.

**2. The kit/sim boundary (items 122-123).** `kits` may still import only `engine/core`;
`config/layers.js` does not change. So:

- **Every world rule is an `engine/sim` system driven by component data:** movement, combat,
  construction, training and gathering. Numbers (speed, damage, range, build time, cost, carry
  amount) live in components and in unit and building type data, never in code constants of the
  kit.
- **Orders are plain JSON data**, defined once (type and Zod schema) in `engine/core`, the one layer
  both `engine/sim` and `kits` may import:
  `{ "id": 7, "faction": "red", "type": "move" | "attack" | "build" | "train" | "gather" | "stop",
"units": [12, 13], "target": ... }`. `id` counts up from 1 in each battle; `units` are world
  entity ids; `target` depends on the type (a cell for `move` and `build`, an entity id for `attack`
  and `gather`, a unit type for `train`, with a building kind for `build`; `stop` has none). An
  order for units its faction does not own, or that cannot be carried out, is dropped with a log
  entry, never an error.
- **Orders are applied between ticks**, by an `engine/sim` function such as
  `applyOrders(world, orders)`, inside `world.withCause('order:<id>')`, so every change an order
  makes is in the event log with that order as its cause (item 113 recommends naming a cause; this
  does). An order sets intent components (where to go, what to attack, what to build or train);
  the systems carry it out on later ticks.
- **`kits/rts` reads a plain world snapshot** (the JSON `World.snapshot()` gives, read through its
  own small typed reader, with no `engine/sim` import), turns pointer selection and commands into
  orders, presents frames (units, buildings, selection, the camera) and runs the scripted enemy,
  which also only issues orders. It holds no world rules: whether a unit can reach a cell or a
  faction can afford a barracks is the sim's answer, which the kit reads back.
- **Game glue joins the two**, because only `games` may import both `kits` and `engine/sim`. The
  glue loads the scenario, makes the world with the engine's RTS systems, and each tick passes the
  snapshot to the kit, applies the orders the kit returns, and steps the world. It must stay small:
  the sample's `headless.ts` and browser entry should each be a few dozen lines of wiring
  (roughly 60 at most), as the platformer games' `createGame` became after G1. Anything a second RTS
  game would copy (the step loop, applying orders, the hash schedule) belongs in `engine/sim` or
  `kits/rts`, not in the game.

**3. Order recording and replay (items 124-125).** The OpenRA idea, lockstep:

- **Each recorded order is stamped with the tick it applies before**: an order with `"tick": 40`
  is applied after tick 40's state and before the step to tick 41, in ascending `id` order. Two
  orders at the same tick apply in id order. The recorded orders and the seed are the whole input
  of a battle.
- **Sync hashes every N ticks**: a recorded battle stores the state hash (the same hash as today,
  the first 16 hex digits of the SHA-256 of the canonical snapshot, item 109) every N ticks, N = 20
  by default, so a replay that drifts says the first tick it differs within 20 ticks. The existing
  run-file `hashEvery` and replay machinery carry these hashes; no second hash format.
- **The run file gets an `orders` field** (`[{ "tick": 40, "id": 1, "faction": "blue", ... }]`)
  for both world runs (`"world"`) and game runs (`"game"`). On a world run the tools apply the
  orders themselves through `engine/sim`. On a game run they hand each order to the game through
  a new optional method on `HeadlessGame`: `order(order)`, called between `step()`s at its tick.
  A game run with `orders` against a game whose headless module has no `order` method is a usage
  error. Games without orders do not change.
- **Recording**: the browser page (and the headless kit loop) collects every order it applied with
  its tick, and can write them as a run file that a headless `pnpm cli run` replays to the same
  hashes. That is the 0.9 "done when".

**4. Pathfinding (items 126-127).** Written in-house in `engine/sim`, in integers:

- **A\* for single units** on the existing terrain grid, with the same move costs as `path.ts` and
  a fixed tie-break, so the same terrain and goal always give the same path.
- **Flow fields for groups that share a goal**: the existing `distanceField` already is one (the
  cheapest cost from every cell to the goal, cached per terrain and goal), so a group ordered to
  one cell reads `nextStep` from one shared field instead of running A\* per unit. A\* is used for
  a single unit or a small selection; the switch-over size is a builder's choice, recorded when T6
  measures it.
- **Item 108 answered: 8-way for the RTS, with no corner cutting.** A diagonal step costs the cell's
  cost times 14 against 10 for a straight step (integer, so no square roots), and a diagonal step
  is only allowed when both straight cells beside it are passable, so units never squeeze between
  two blocked corners. Ties go north, north-east, east, south-east, south, south-west, west,
  north-west. 8-way is an option (`STEPS` stays the 4-way list; an 8-way list and the cost scale are
  chosen per call or per system), and the 0.8 sample world's systems keep 4-way, so
  `village.hashes.json` and the village run file's hashes do not change.

**5. Facing widened to eight directions (item 128, answering item 48).** `Facing` in
`engine/core/present` becomes `up`, `down`, `left`, `right`, plus `up-left`, `up-right`,
`down-left` and `down-right`. Skins may give frames for the diagonals; a skin without a diagonal's
frame falls back to the nearest cardinal: its horizontal part (`up-right` uses `right`, then the
existing rule, `down`, then the first frame), so `flipFacing` still mirrors side frames. Every
existing kit only ever sets the four cardinal values and every existing skin stays valid with no
edits, so their state hashes and screenshots do not change. The RTS kit derives a unit's facing
from its last step in the snapshot.

**6. The benchmark target (items 129-130).** The roadmap's "hundreds of units, zoom" becomes:

- **500 units** (animated sprites, each with a health bar, plus their selection rings) on a map of
  at least 128 x 128 cells, larger than the screen, at the RTS sample's picture size (decided in T3,
  in the range of the other samples, such as 320 x 240), at zoom 0.5, 1 and 2, panning the camera.
  **1000 units is the stretch target.**
- **60 fps in headless Chromium through Playwright**: measured over at least 600 frames per case,
  the 95th-percentile frame time is at most 16.7 ms. The benchmark skips cleanly where no browser
  is available (CI stays green) and writes its numbers as text.
- **PixiJS comes in only if Canvas2D misses the 500-unit target.** If it does, PixiJS v8 is added
  as one more backend at one exact pinned version, reading the same snapshot and skin. If
  Canvas2D reaches 500 but not 1000, PixiJS stays out and the 1000 result is recorded.

**7. The map format (item 131).** The skirmish map is a sim scenario file (`*.world.json`, the 0.8
format: terrain as text grids, entities with components, `$ref` links) plus RTS unit and building
type data (speed, health, damage, range, cost, build and training time, what a building can train):
new content kinds that `kits/rts` adds, validated by Zod like every other content kind, and read
by the sim's systems as component data copied in when a unit or building is made. The map holds
the starting units, buildings and resource nodes of both sides; the scripted enemy's plan is kit
content of its own.

**8. World runs choose their systems (item 132, following item 118).** A world run with orders
needs the RTS systems, not the village's haul, build and patrol. A scenario may name an engine
system set (for example `"systems": "rts"`), defaulting to today's set, so the village and its
hashes do not change.

### Choices made

The decisions above are items 121-132 and the benchmark decision is item 133 (T3, below). T9 and
T10 recorded their choices as items 134-140 (in "T9" and "T10" below, and in `FEEDBACK-LOG.md`).
The other builders' choices are items 141-149 in `FEEDBACK-LOG.md` ("Engine 0.9, builder
choices"); in short:

- **Canvas2D zoom** (T2, item 141): zoom comes from the frame's camera hint, else the skin;
  positions are rounded to whole picture pixels, so sprites stay crisp at zoom 0.5 and 2. This
  finishes the last open part of item 51 (zoom was still ignored after 0.5).
- **One gesture set for mouse, pen and touch** (T5, item 142): left click or tap selects, a drag
  past 4 px draws a box, right click or a 500 ms long-press commands, middle drag or two fingers
  pan, wheel or pinch zoom (500 wheel px per doubling), the cursor within 4 px of an edge scrolls;
  `RtsCamera` keeps zoom between 0.5 and 2 and the view inside the map. Pointer input and hiding
  the touch pad are opt-in options of `bootBrowserGame`.
- **Pathfinding numbers** (T6, item 143): a group of 4 or more units ordered together shares one
  flow field (`FLOW_GROUP_SIZE`, measured); A\* stops after a cap of expanded cells and reports no
  way.
- **Units do not collide** (T7, item 144): units may share a cell and walk through buildings
  (footprints only decide placement and reach); a unit with no task fights the nearest enemy in
  range (ties to the lowest id); hits land at once, in id order.
- **Paying and making** (T8, item 145): a cost is paid when the order is accepted, with no refund
  and no cancel order; a type's numbers are copied into what is made, so a later change to the
  types table never changes existing units or buildings; a faction's gold is the `Inventory` of
  its `Stockpile` entity.
- **The sample's run files** (T11, item 146): besides recorded orders, a run file may give
  interface actions (`{ tick, ui: "click" | "box" | "command" | "build" | "train" | "stop", ... }`)
  that go through the kit's selection and command mapper, so the kit's interface rules are
  mutant-checked headless; `commands.run.json` gives exactly `battle.run.json`'s orders this way.
  Units are drawn in three facings (down, up, right, mirrored for left; diagonals use their
  horizontal part).
- **The page** (T12, item 147): 10 ticks a second (6 loop steps a tick); the page's selection is
  its own, not game state, so the page's hashes are a replay's; Export downloads the battle as a
  run file (`skirmish-t<ticks>.run.json`) that ends at its last sync hash.
- **Glue size** (T11, T12, item 148): decision 2 asked for each entry to be about 60 lines at
  most; see "Deviations" below.
- **Mutant strictness** (T10, item 149): `kits/rts` does not opt in to strict mutants, though the
  sample's run files guard all five of its rules and `mutants games/samples/rts-skirmish` exits 0;
  a repo test (`tests/runs/rts-skirmish-mutants.test.ts`) holds the sample to the strict standard.
- The root `package.json` version was left as it was, as in earlier releases of this build.

### How to try it

```sh
pnpm dev   # then open /games/samples/rts-skirmish/ (also linked from the launcher at /)
           # mouse: left click or drag a box to select, right click to move, gather or attack,
           # middle drag or the edges to scroll, wheel to zoom, Shift+click to add;
           # touch: tap, one-finger box, long-press to command, two fingers to pan and pinch;
           # the bar: Build barracks (then click a place), Train soldier, Stop, Hero, Export
pnpm -s cli validate games/samples/rts-skirmish --json
pnpm -s cli run games/samples/rts-skirmish/runs/battle.run.json --json    # replay with sync hashes
pnpm -s cli run <exported>.run.json --json                                # replay a battle played in the page
pnpm -s cli mutants games/samples/rts-skirmish --json
pnpm -s cli screenshot games/samples/rts-skirmish/runs/battle.run.json --tick 140 --json
pnpm -s cli run engine/sim/__fixtures__/battle.run.json --json            # the sim's recorded battle
pnpm vitest run tests/browser/rts-skirmish.test.ts                        # the page in headless Chromium
pnpm exec tsx tests/bench/rts-render/run.ts                               # the rendering benchmark
```

An exported run file names its game as `..`, so put it in `games/samples/rts-skirmish/runs/` (or
pass `exportRun(game)` the path) before running it.

### Done when

Checked on 2026-11-02 at `4458b54` (the last 0.9 feature commit) and again at `c965b08`, after
the two fixes that followed the first close-out (see "Fixes after the first close-out" below):
`pnpm lint && pnpm docs:check && pnpm typecheck && pnpm test && pnpm build` pass (132 test files,
1427 tests passed and 1 skipped: the opt-in every-tick save check of 0.8), with the browser tests
running against the container's Chromium; every run file exits 0; `mutants` exits 0 for all four
games.

- **Met: you can build a barracks, train units and fight an enemy group in the skirmish sample in
  the browser.** `pnpm vitest run tests/browser/rts-skirmish.test.ts` builds the repo as `pnpm
build` does, serves it as `pnpm preview` does, checks the launcher links
  `games/samples/rts-skirmish/`, and plays the page in headless Chromium with real mouse and touch
  input: a mouse box selects two workers, Build barracks and a click place the site, a click and
  a right click send the third worker to gather; when the barracks stands, a touch tap selects it
  and three Train soldier clicks queue three soldiers; a touch box and a long-press send the
  builders to gather; a middle drag pans and the wheel zooms out; a box over the soldiers, a
  Shift+click on the hero and a right click on a raider attack, and the test waits until blue has
  no units left, with the barracks and the hero still standing. It passes in this container. It
  skips cleanly where no Chromium is installed, which is the case on CI.
- **Met: the same battle gives the same state hashes when replayed headless from the recorded
  orders.** The same test exports the battle through `window.wwSkirmish.exportRun()` (the orders
  with their ticks and the page's sync hashes, every 20 ticks, made with Web Crypto) and replays
  it with `pnpm -s cli run`: exit 0, every sync hash equal (`hashesChecked` equals the
  recording's hash count, 8 when it was first run in T12) and the same final hash. Headless on its
  own (and on CI): `pnpm -s cli run games/samples/rts-skirmish/runs/battle.run.json --json` exits
  0 with its 13 sync hashes (ticks 0 to 240) equal and final hash `588fe33bb3ecfcfd`, on every
  run; `tests/runs/run-files.test.ts` plays every run file twice against its golden `<name>.hashes.json`; `tests/kits/rts-sim.test.ts`
  replays the kit's recorded player orders over a sim world to the same hashes; and
  `engine/tools/orders-run.test.ts` shows a changed order fails at the first sync hash that
  differs (exit 4, naming that tick and the last that matched).
- **Met: the rendering benchmark decides whether PixiJS comes in.** `pnpm exec tsx
tests/bench/rts-render/run.ts` (numbers in "T3: the rendering benchmark" below): Canvas2D holds
  the 500-unit target at zoom 0.5, 1 and 2 (worst p95 14.3 ms against the 16.7 ms budget), so
  PixiJS is not added (item 133) and stays in the roadmap's "Later"; the 1000-unit stretch misses
  only with all 1000 units in view at zoom 0.5. The scene's own check,
  `tests/bench/rts-render/scene.test.ts`, runs in `pnpm test`.
- Scope items, each with its test: `kits/rts` reads and writes the simulation through orders only
  (`tests/architecture/dependency-rule.test.ts`: kits import only `engine/core`; `kits/rts/*.test.ts`;
  `tests/kits/rts-sim.test.ts`); world rules in `engine/sim` (`engine/sim/rts.test.ts`,
  `economy.test.ts`); in-house A\* and flow fields (`engine/sim/astar.test.ts`); recorded orders,
  lockstep replay and sync hashes (`engine/tools/orders-run.test.ts`,
  `engine/sim/__fixtures__/battle.run.json`); the scrolling camera with zoom and click or box
  selection by mouse and touch (`engine/core/input/pointer-logic.test.ts`, `pointer.test.ts`,
  `engine/core/present/rts-camera.test.ts`, `kits/rts/controls.test.ts`,
  `kits/rts/selection.test.ts`, the browser test); Canvas2D zoom and eight-way facing
  (`engine/backends/canvas2d` and `engine/core/present` tests, `tests/runs/backend-parity.test.ts`);
  the sample with one map as data and its own art (`games/samples/rts-skirmish/skirmish.test.ts`,
  `play.test.ts`, `tests/build/pages.test.ts`).
- Every run file passes `pnpm -s cli run` with exit 0: the 4 skirmish runs, the 11 runs of the
  three earlier games and the 2 sim fixtures (`village-build`, `battle`). The skirmish runs and
  the earlier games keep their final hashes; the sim's `battle` fixture now ends on `6ed34a2079fc3db9`
  (its hashes were regenerated by the cooldown fix below). `pnpm -s cli mutants
games/samples/rts-skirmish --json` exits 0 with all five kit rules guarded and no run weak, and
  `tests/runs/rts-skirmish-mutants.test.ts` now holds the sample to that in `pnpm test`.
- **The stacking-test report assigns no gap to 0.9.** `docs/reports/stacking-test.md` has 37 gaps:
  21 fixed in 0.7 and 16 moved to 0.10 (G16, G20, G37), 0.11 (G13, G18, G27, G28, G30), 0.14 (G5,
  G8, G9, G10, G12, G31) and 0.15 (G17, G33, G36). None names 0.9, so this release had no gap to
  take.

### Deviations from the roadmap

- **No PixiJS backend** (T4 skipped): the roadmap made it conditional, and the benchmark found it
  not needed (item 133).
- **The game glue is larger than decision 2 asked** (item 148). Decision 2 said the sample's
  `headless.ts` and browser entry should each be about 60 lines at most. `headless.ts` is 85 lines
  of code: `createGame` itself is about 25, and the rest is `sidesOf` (a per-side summary run
  files check) and `SkirmishGame` (interface actions for run files, item 146). `main.ts` is 160
  lines of code, almost all page DOM: the button bar, the status line, Export and the
  `window.wwSkirmish` hook the browser test reads. The step loop, order application, recording
  and hash schedule are not in them (they are in `kits/rts`, `play.ts` and `recording.ts`).
  `play.ts` and `recording.ts` are game code a second RTS game would copy; moving them (and
  `sidesOf`) into `kits/rts` or the shell is left for the owner (item 148), at the latest for
  the mini siege (0.11), the second game on the kit.
- **Units art is three-facing**, not eight (item 146): the presentation contract carries eight
  facings and the kit presents them, but the sample's skin gives down, up and right only, using
  the fallback T2 added.
- **Feedback numbering:** T1's decisions are 121-132, T3's is 133, T9's 134-136, T10's 137-140,
  and this close-out adds 141-149.

### Fixes after the first close-out

- **Run files guard every kit rule before the first hash** (`62e6f60`): a switched-off rule changed
  a sync hash at tick 20 before any assertion could fail, so `mutants` showed three kit rules
  unguarded and four runs weak. The skirmish run files gained early assertions and invariants
  (the raid has not fired, the camp step has, gather nodes, the hero's target), and
  `tests/runs/rts-skirmish-mutants.test.ts` fails if a rule becomes unguarded or a run weak. The
  kit itself still does not opt in to strict mutants (item 149).
- **A stale step wait after a stop** (`c965b08`): `moveSystem` counted `Cooldown.move` down only
  for units with a task, so a stop, a finished build or a dropped task mid-step left the wait for
  the next order. It now counts down for every unit, and the view shows `walk` for a step's wait
  only while the unit has a task. Only the sim's `battle` fixture hashes changed.

### Outstanding issues

- **Browser play is not checked on CI**: CI has no Chromium, so `tests/browser/rts-skirmish.test.ts`
  skips there (as the other browser tests do); the headless replays of the same orders run on CI.
- **The benchmark is not in CI** and was measured once on a container with no GPU (software
  rendering); the Canvas2D presenter draws every entity, in view or not. Culling off-screen
  entities is the first step if a later RTS view needs more headroom (T3).
- No line of sight, fog of war or height rules yet (height is still data only, item 101); units
  do not collide (item 144); no cancel order or refund (item 145).
- The glue a second RTS game would copy (`play.ts`, `recording.ts`, `sidesOf`) is in the sample
  (item 148).
- Open owner decisions: items 121-149 in `FEEDBACK-LOG.md`.

### T3: the rendering benchmark

**Decision (item 133): Canvas2D holds 60 fps at the 500-unit target, so PixiJS is not added.** It
stays in the roadmap's "Later", T4 (the PixiJS backend) is skipped, and `package.json` and
`pnpm-lock.yaml` do not change. Against decision 6 (items 129-130): every 500-unit case at zoom
0.5, 1 and 2 has a 95th-percentile frame time of at most 14.3 ms (budget 16.7 ms), including the
worst layout with all 500 units in view. The 1000-unit stretch is missed in one case, all 1000
units in view at zoom 0.5 (p95 about 33 ms, 52-58 fps), and is borderline when the 1000 units are
spread over the map at zoom 0.5 (p95 17.1 and 14.8 ms in the two runs); PixiJS held the stretch
everywhere (p95 at most 15.3 ms). The RTS sample's picture size, left to T3 by decision 6, is
**320 x 240**.

**What was built.** `tests/bench/rts-render/`, outside the CI test run (only its `scene.test.ts`,
a quick Node check of the synthetic scene, runs in `pnpm test`):

- `scene.ts`: a seeded synthetic scene. A 128 x 128 map of 16 px tiles (2048 x 2048 px, larger than
  the screen), N units walking in eight directions (a new direction every 30-89 ticks), each drawn
  as three entities (selection ring, animated unit with a two-frame walk cycle per facing and
  `flipFacing` for the left-hand ones, health bar), from one text-pixel-art sheet and one
  `canvas2d` skin. The camera pans round the map (one lap in 600 frames) at a fixed zoom. Two
  layouts: `spread` scatters the units over the whole map (a few dozen in view), `crowd` keeps them
  all in a 640 x 480 box that travels with the camera (all of them in view at zoom 0.5: a battle on
  screen).
- `page.ts` and `index.html`: the page. Canvas2D is the engine's own `SkinnedCanvasPresenter` on a
  `Viewport` (whole-number scale to the page), as a game's page uses them. The PixiJS column draws
  the same frames with the same skin (`resolveSkinFrame`), sheet and camera (`CameraFollower`), one
  `Sprite` per entity and the map cached as one texture, scaled up by the page (CSS, pixelated). It
  runs only when the runner loads a PixiJS v8 global build (`pixi.min.js`) into the page; nothing
  in the repo imports `pixi.js`.
- `run.ts`: builds the page with Vite into a temp folder, serves it, opens it in headless Chromium
  through Playwright (window 1280 x 960, the picture scaled 4x) with vsync and the frame-rate limit
  off, and per case draws 60 warm-up frames and then 600 measured ones. **Frame time** is the time
  between animation frames, so it covers the whole frame (making the scene's frame, drawing, and
  Chromium's raster and compositing); fps is 1000 over its mean. It also prints the time inside the
  draw call alone. PASS is p95 at most 16.7 ms. `--shots <folder>` saves each case's last picture
  (Canvas2D and PixiJS were checked to draw the same picture). Without a browser it says why and
  exits 0.

**How to rerun.**

```sh
pnpm exec tsx tests/bench/rts-render/run.ts                # Canvas2D, 2 layouts x 500/1000 units x zoom 0.5/1/2
npm install --prefix /tmp/pixi --no-save pixi.js@8.22.0    # PixiJS column: scratch install, outside the repo
pnpm exec tsx tests/bench/rts-render/run.ts --pixi /tmp/pixi/node_modules/pixi.js/dist/pixi.min.js
```

Options: `--frames`, `--warmup`, `--units 500,1000`, `--zooms 0.5,1,2`, `--layouts spread,crowd`,
`--json`, `--shots <folder>`; `WW_BENCH_PIXI` may name the PixiJS file instead of `--pixi`.

**Environment.** The build container: 4 vCPU Intel Xeon @ 2.10 GHz, 15 GB RAM, Linux, no GPU.
Headless Chromium 153.0.8010.12 (Playwright 1.63.0), launched with `--enable-unsafe-swiftshader`,
`--disable-gpu-vsync` and `--disable-frame-rate-limit`. WebGL reports "ANGLE (Google, Vulkan 1.3.0
(SwiftShader Device (Subzero)), SwiftShader driver)": **everything is software rendering**,
Canvas2D rasterised by Skia on the CPU and PixiJS's WebGL by SwiftShader on the CPU. A real GPU
should make both faster, PixiJS more so; the decision only needs Canvas2D to pass, which it does
here without one. PixiJS 8.22.0 (released 2026-10-01), from a scratch install outside the repo.
Timer resolution in the page is 0.1 ms.

**Numbers** (p95 frame time and fps, two full runs, "run 1 / run 2"):

| Layout | Units | Zoom | Canvas2D p95 (ms) | Canvas2D fps | PixiJS p95 (ms) | PixiJS fps |
| ------ | ----- | ---- | ----------------- | ------------ | --------------- | ---------- |
| spread | 500   | 0.5  | 9.8 / 10.3        | 169 / 169    | 7.7 / 7.7       | 169 / 178  |
| spread | 500   | 1    | 5.7 / 7.1         | 213 / 228    | 8.1 / 6.6       | 160 / 197  |
| spread | 500   | 2    | 9.5 / 9.2         | 171 / 175    | 7.7 / 7.1       | 164 / 186  |
| spread | 1000  | 0.5  | 17.1 / 14.8       | 99 / 110     | 10.2 / 9.2      | 126 / 141  |
| spread | 1000  | 1    | 10.0 / 8.8        | 152 / 159    | 9.9 / 9.0       | 128 / 144  |
| spread | 1000  | 2    | 15.2 / 14.5       | 98 / 107     | 9.3 / 8.6       | 139 / 148  |
| crowd  | 500   | 0.5  | 13.0 / 14.3       | 116 / 114    | 10.3 / 10.3     | 124 / 123  |
| crowd  | 500   | 1    | 7.4 / 7.9         | 181 / 191    | 10.0 / 9.4      | 133 / 140  |
| crowd  | 500   | 2    | 11.1 / 9.7        | 149 / 175    | 9.6 / 9.3       | 138 / 143  |
| crowd  | 1000  | 0.5  | 33.6 / 33.3       | 52 / 58      | 15.3 / 15.3     | 81 / 84    |
| crowd  | 1000  | 1    | 14.4 / 15.2       | 110 / 111    | 13.6 / 12.5     | 93 / 101   |
| crowd  | 1000  | 2    | 15.9 / 15.7       | 97 / 103     | 12.4 / 11.9     | 106 / 109  |

What the numbers say:

- Canvas2D's draw call alone is 2-5 ms at 500 units (p50), 12-14 ms with 1000 units in view at
  zoom 0.5; PixiJS's is 1-2 ms throughout, but its software WebGL adds about 4-5 ms a frame after
  the call, so at 500 units the two are close, and at zoom 1 Canvas2D gives more fps.
- Zoom 1 is Canvas2D's cheapest: at 0.5 and 2 every sprite and the map copy are scaled
  (`drawImage` with a scale), and at 0.5 the most is in view.
- The presenter draws every entity, in view or not (no culling); at zoom 2 most of the 1000 units
  are off screen and still cost about 10 ms p95. Skipping entities outside the view is the first
  thing to try if a later RTS view needs more headroom (not done here: the target is met, and the
  presenter's behaviour is out of T3's scope).
- The margin at the target is about 15% in the worst case (p95 14.3 ms, 500 units in view at zoom
  0.5). `kits/rts` (T10) will draw a few more things (buildings, the selection box, a HUD); if the
  sample's own numbers come close to the budget, culling (above) comes before a new backend.

### T4: the PixiJS backend, not needed

**Not built in 0.9.** T3's decision (item 133, numbers in "T3: the rendering benchmark" above):
Canvas2D holds 60 fps at the 500-unit target in every case (worst p95 14.3 ms against the 16.7 ms
budget), so there is no `engine/backends/pixi`, no `pixi.js` dependency (`package.json`,
`pnpm-lock.yaml` and `PACKAGES` in `config/layers.js` are unchanged) and no `?backend=pixi` choice in
the shell. The roadmap's "Later" bullet (more backends: PixiJS, not adopted at 0.9) stands. If the
RTS sample later comes close to the budget, culling off-screen entities in the Canvas2D presenter
is tried before a new backend (see T3).

### T9: recorded orders, lockstep replay and sync hashes

A battle is now its seed plus its recorded orders. A run file's `orders` (`{ tick, ...order }`) are
applied before the step from their tick (a world with `applyOrder`, a game through the new optional
`HeadlessGame.order`), and its `hashes` are sync hashes `run` checks, stopping at the first that
differs. A scenario names its system set (`"systems": "rts"`, items 118 and 132), so a world run can
be an RTS battle. The fixture `engine/sim/__fixtures__/battle.run.json` (seven orders, sync hashes
every 20 ticks) passes with `pnpm -s cli run`; moving blue's order 4 target one cell south makes it
fail at tick 40 (`hashMismatch`, last match tick 20). Choices for the owner: items 134-136.

### T10: the RTS kit

`kits/rts` (unit `kits/rts`, imports only `engine/core`): `readWorld` reads `World.snapshot()`
into a typed view; `Selection` (click, box of own units, heroes alone) and the command mapper
(`commandAt`: move, attack, gather; `buildCommand`, `trainCommand`, `stopCommand`) make order
drafts; `ScriptedEnemy` plays an `rts-enemy` plan (orders at ticks, on triggers, repeated, with
the seeded `Rng`); `presentWorld` describes the map, units (eight-way facing, `walk` / `attack` /
`build` / `gather` / `idle`), buildings with construction progress, selection rings and box, the
placing ghost, HUD values and the `RtsCamera` hint; `RtsControls` joins pointer gestures, the
camera and the selection; `rtsGame` is the headless adapter over an `RtsWorldPort` the game's
glue fills with a sim world. Content kinds `rts-map`, `rts-types`, `rts-enemy`; rules
`RTS_RULES`. `tests/kits/rts-sim.test.ts` drives it over the sim's battle fixture and replays the
recorded player orders to the same hashes. Choices for the owner: items 137-140.

### T12: the skirmish in the browser, replayed headless

`games/samples/rts-skirmish/index.html` boots through `bootBrowserGame` with Canvas2D, pointer
gestures on and the touch pad off. `play.ts` (`SkirmishPlay`, a scene with no DOM) joins the
gestures and a button bar (build, train, stop, hero, cancel, export) to the kit's `RtsControls`
over an `RtsCamera` on the same `SkirmishGame` the tools play, and records every order with its
tick; `recording.ts` hashes the snapshot every 20 ticks with Web Crypto (the tools' state hash)
and writes the battle as a run file. The page plays 10 ticks a second (6 loop steps a tick), a
page-only choice: the tools play ticks as fast as they can, and the same orders at the same ticks
give the same hashes at any speed. `tests/browser/rts-skirmish.test.ts` builds the repo, checks
the launcher link, plays a battle with mouse (box, buttons, placing click, right clicks, middle
drag, wheel, Shift+click) and touch (tap, one-finger box, long-press), beats the raid by tick 140,
exports the recording through `window.wwSkirmish.exportRun()` and replays it with `pnpm -s cli
run`: it passes with all 8 sync hashes equal. This meets the 0.9 "done when".

## Engine 0.8

The world simulation. Built on branch `engine/build-0.15`; not tagged (no tags during the build,
owner answer 24). The module's rules are in `engine/sim/CLAUDE.md`, its agent page in
`docs/modules/engine-sim.md`.

### What was built

- **`engine/sim`, the world core** (T2): `createWorld(seed, ...)` with integer entity ids handed
  out in order and never reused, component kinds with Zod schemas (`defineComponent`), queries
  always in ascending id order, systems run in a fixed order by `step()`, an integer `tick`, a
  seeded `Rng` per world, and `snapshot()` / `canonical()` (the whole world as canonical JSON, for
  the tools to hash).
- **Sim purity and maths** (T3): the existing purity lint (no backends, kits, games, unseeded
  randomness, clocks or DOM) plus a `sim-math` lint rule that forbids machine-dependent float
  maths (`Math.sin`, `cos`, `atan2`, `pow`, `exp`, `log`, `hypot` and the rest of
  `SIM_FORBIDDEN_MATH` in `config/layers.js`, and the `**` operator) in every file under
  `engine/sim/`. `engine/sim/math.ts` holds the exact replacements: integer `idiv`, `imod`,
  `ipow`, `isqrt`, grid distances, and binary angles with fixed-point `sinFixed`/`cosFixed` and
  `iatan2`.
- **Standard components, terrain with height and squads** (T4): `Position {x, y, z}`, `Health`,
  `Owner`, `Inventory`, `Construction`, `Worker`, `Patrol`, `Squad` and `Member`
  (`STANDARD_COMPONENTS`); `Terrain` with an integer elevation and a ground type per cell; squad
  helpers where a squad is one number (`strength`) that still names its people (captain, heroes,
  regulars), with seeded picking and a fixed loss order.
- **The event log** (T5): every spawn, destroy and component add, set or remove made through the
  World API is one JSON-safe `Change` with its tick and cause (the running system's name, or the
  cause given by `withCause`, or `external`). A step's changes join the log only when the tick
  commits. Stored component data is frozen, so nothing can change the world past the log.
  Retention is configurable (all, the last n ticks, or none).
- **Save and load** (T6): `saveWorld` / `loadWorld`, the whole world as JSON (seed, tick, RNG
  state, next id, component kinds, system names, entities, the event log), checked by a Zod
  schema with errors naming each bad field; a loaded world steps on identically. The format is in
  the generated schema reference with an example.
- **The sample world** (T7): world-start scenarios written as data (`worldFromScenario`: terrain as
  text grids of ground types and elevation digits, entities, squads with named members, `$ref`
  keys), integer walking on the terrain (`path.ts`) and the first systems (`haul`, `build`,
  `patrol`, with `Walk` and `Hauler`). The proof is the fixture
  `engine/sim/__fixtures__/village.world.json`: a 24x14 village with a river, hills, three
  workers, a hall and a granary going up and a patrolling squad of 12 with four named members,
  plus its golden hashes. No game content.
- **The CLI on a world** (T8): a run file can name a `world` (a `*.world.json` scenario) instead
  of a `game`; `run`, `dump`, state hashes and replays work on it, and `mutants` and `screenshot`
  refuse it with a usage error. The sample world run is
  `engine/sim/__fixtures__/village-build.run.json` with its golden hashes, played by `tests/runs`.
- **Close-out** (T9): an opt-in exhaustive check that saves and reloads the sample world at every
  one of its 10,001 ticks (`WW_SAVE_EVERY_TICK=1`), this section, the roadmap and the agent docs.
- Agent docs: `engine/sim/CLAUDE.md` (replacing the placeholder), `docs/modules/engine-sim.md`,
  the `llms.txt` links for `engine/sim` and `engine/tools`, and the world rows of
  `docs/CHEATSHEET.md` and the schema and CLI references.

### Decisions

The roadmap lists three "decisions needed first" for 0.8. They were settled before any code in
`engine/sim`, so later tasks build on recorded choices. Each one is a feedback item the owner can
overrule by number.

**1. The ECS: our own small one in `engine/sim` (item 99).** Entities are integer ids handed out in
order; each component is a plain-object store keyed by entity id; systems are plain functions run in
a fixed order each tick; every query iterates entities in ascending id order. No npm dependency.
Reasons:

- **Save and load and hashing come for free.** The roadmap wants the whole world saved as JSON and
  read back to an identical state, with state hashes. With plain data, a save is the stores written
  out with sorted keys, and the canonical hash is the hash of that text. Koota and bitECS keep
  components in typed arrays (structure of arrays) behind a world object and module-level state, so
  a save would need a serialiser for each component and care with every library upgrade.
- **Deterministic iteration order.** Library query order follows archetype tables or swap-remove
  dense arrays, so it depends on the order of adds and removes, not on the ids. Ours is always
  ascending id order, written down and tested, so two runs that reach the same state iterate the
  same way.
- **Licences and upkeep.** bitECS is MPL-2.0 (a caveat if its code is copied or patched);
  miniplex's current activity is unconfirmed (`docs/research/prior-art.md`). Koota is the best
  candidate (ISC, active), but its strengths (performance with very many entities, React
  bindings) are not what a turn-paced village or siege world needs.
- **No new owner in the `PACKAGES` table.** Any library would become an external package that only
  `engine/sim` may import, with a new `PACKAGES` row and lint rule. Our own needs none.
- **It is small.** Entities, stores, queries and a fixed system order are a few hundred lines that
  an agent can read in one go, matching the repo's LLM-first rule.

What it costs: no archetype speed-ups, so a query walks a store. That is fine at the planned sizes
(hundreds to low thousands of entities); if a later release needs more, an index per component can
be added without changing the data model. If a later builder switches to a library, it must show
the same two properties: deterministic iteration order, and a whole-world JSON save that reads
back to equal hashes.

**2. A tick in world time: one tick is one world minute (item 100).** The world keeps an integer
`tick` counter; world time is derived from it (`minute = tick`, hours and days by integer division)
and never stored as a float. A tick is a step of the simulation, not a frame: it is independent of
the 60 Hz frame loop, and each view decides how many ticks to advance per frame or per order (an
RTS view might step one tick every few frames, a mission view none until its fixed world-time cost
is applied). Reasons:

- A minute is fine enough for the RTS view (a unit's move or a training step takes a few minutes)
  and coarse enough that construction (hours) and caravans (days) are counts of ticks a scenario
  can write as plain integers.
- Integer ticks keep world time exact: no drift, nothing that rounds differently between machines,
  and a save stores one number.
- 0.10 (time and the mission contract) adds experience time and commitment time on top of world
  time. It may scale how many ticks a view advances (a mission's fixed world-time cost is N ticks
  applied at once), but it never changes what one tick means. Durations in scenario data are
  written in ticks (world minutes), so changing the unit later would mean rewriting data, which is
  why it is fixed now.

**3. Height is part of the simulation, as data only (item 101).** Each cell of the world's terrain
grid has an integer elevation, and `Position` has an integer `z` (the level an entity stands on)
beside its `x` and `y`. 0.8 adds no rules that use height: no line of sight, no height bonus, no
slopes in movement. Reasons:

- **The DESIGN risk.** One RTS kit shared across a flat 2D view and a 2.5D view pulls terrain
  height and line of sight back into the kit if the world does not know about height: each view
  would invent its own. With height in the world, line of sight and height bonuses can be computed
  later in `engine/sim` (0.9 onwards) from the same data, and the kit and views only read the result.
- **It is cheap.** An integer per cell and one integer per position add little to a save and
  nothing to determinism (no floats). A flat map is just every cell at 0.
- **Deciding late is the expensive path.** Adding `z` after saves, scenarios and the RTS kit exist
  would change every one of them.

What it costs: every terrain and position in scenario data carries one more field (defaulting to
0 keeps flat scenarios short), save files grow a little, and views must decide how to draw height
(a flat 2D view can ignore it). Line-of-sight rules, when they come, must be written in integer
maths so they stay deterministic.

### Choices made

The three decisions above are items 99-101. The builders' further choices are items 102-111 in
`FEEDBACK-LOG.md` ("Engine 0.8, builder choices"); in short:

- **The event log stays out of the state hash** and keeps every change by default; the sample
  world keeps the last 100 ticks (item 102). Stored component data is frozen so every change goes
  through the logged API.
- **Systems keep no state of their own** and are never saved; a load must pass the same system
  list, checked by name (item 103).
- **Float maths:** the non-correctly-rounded `Math` functions and `**` are lint errors in all of
  `engine/sim/` (tests too); `Math.sqrt` stays allowed; angles are binary (256 per turn) in 16.16
  fixed point (item 104).
- **Squad losses take unnamed people first**, then regulars, heroes and the captain last, newest
  first within a role, with no randomness; people who leave stay in the world (item 105).
- **Scenario format:** terrain as text grids with a one-character legend and one elevation digit
  (0-9) per cell, ids in file order, `$ref` keys between entities (item 106).
- **The sample's systems are engine code** (`engine/sim/systems.ts`: haul, build, patrol), as
  machinery whose numbers are all component data, not a fixture-only helper (item 107).
- **Walking is 4-way**, each cell entered costs its type's cost, ties go north, east, south, west,
  and height changes no cost (item 108).
- **World runs in the CLI** use a `world` field instead of `game`, have no input, rules or guards,
  and hash the canonical snapshot the same way game runs do (item 109).
- **"Save and load at any tick" is proved on CI by 83 ticks** (0, 1, every 250th, 40 seeded random
  ones, 9,999 and 10,000), with the every-tick check opt-in because it takes about two minutes
  (item 110).
- **The sample world is an engine test fixture** in `engine/sim/__fixtures__/`, with golden hashes
  every 100 ticks (item 111).
- The root `package.json` version was left as it was, as in earlier releases of this build.
- **Close-out review, items 112-120:** terrain is a component on one entity (112); a change made
  between ticks with no cause is logged as `external` (113); a system that throws leaves the world
  broken, not rolled back (114); ids in data are short strings (115); squad roles and captain
  changes (116); a finished building keeps `Construction` with `done: true` (117); world runs use
  one fixed system set (118), start only from a scenario, and a run file's `seed` wins (119);
  `loadWorld` takes the component definitions and keeps the saved log settings (120).

### How to try it

```sh
pnpm vitest run engine/sim --reporter=verbose        # the sim's tests, the 10,000-tick proof among them
WW_SAVE_EVERY_TICK=1 pnpm vitest run engine/sim/sample-world   # save and reload at every tick (~2 min)
pnpm -s cli run engine/sim/__fixtures__/village-build.run.json --json
pnpm -s cli dump engine/sim/__fixtures__/village-build.run.json --tick 500 --json
pnpm vitest run engine/tools/world-run tests/runs tests/architecture/purity
```

### Done when

Checked on 2026-11-02 at `a8dbb9b` (the last 0.8 code commit), again for the close-out, and once
more at `28d5e25` for the final review: all checks green, every run file exits 0 with the same
final hash, and the village run gives `8e728f67a3bb77e6` on two separate runs.

- **Met: the sample world runs for 10,000 ticks with the same state hashes on every run.**
  `pnpm vitest run engine/sim/sample-world --reporter=verbose`: "runs 10,000 ticks with the same
  hashes twice" passes (two runs in one process, compared every 10 ticks) and "matches the
  committed golden hashes" passes (`engine/sim/__fixtures__/village.hashes.json`, 101 hashes, one
  every 100 ticks: tick 0 `5e095f2b735b6f31`, tick 10,000 `955756733b7c286b`), so every run in any
  process must give the same hashes. From the CLI, `pnpm -s cli run
engine/sim/__fixtures__/village-build.run.json --json` exits 0 with final hash
  `8e728f67a3bb77e6` at tick 1,000 on every run (its golden file is checked by
  `tests/runs/run-files.test.ts`), and its tick 0 hash is the same `5e095f2b735b6f31`.
- **Met: ... and on CI.** CI (`.github/workflows/ci.yml`) runs `pnpm test` on every push, so the
  golden-file test runs there; the CI runs for `630eeac` (the sample world, run 41486858702) and
  `a8dbb9b` (the CLI, run 41487987888) passed on GitHub's Ubuntu runners.
- **Met: the sample world survives a save and load at any tick (the hashes after loading match).**
  In `pnpm vitest run engine/sim/sample-world`: "survives a save and load at 83 ticks, spread over
  the run" (each save written as text, loaded, saved again to the same text, hash equal at once
  and for 250 ticks after), "matches the uninterrupted run to the end after loading at any of a
  sample of ticks" and "matches the uninterrupted run when saved and reloaded at every tested tick
  in one run" all pass. The exhaustive check, `WW_SAVE_EVERY_TICK=1 pnpm vitest run
engine/sim/sample-world`, saves and reloads at every one of the 10,001 ticks in one run and
  matches the uninterrupted hashes: passed in 124 s on 2026-11-02 (opt-in, not on CI; item 110).
- Scope items, each with its test: entities, components, seeded RNG and ascending-id iteration
  (`engine/sim/world.test.ts`); the ECS, tick and height decisions (items 99-101, above);
  squads with named members (`engine/sim/squad.test.ts`); the event log with causes
  (`engine/sim/events.test.ts`); save and load (`engine/sim/save.test.ts`); `dump`, `run` and
  hashes on a world (`engine/tools/world-run.test.ts`, `tests/runs/run-files.test.ts`); purity
  and float maths lint (`tests/architecture/purity.test.ts`, `engine/sim/math.test.ts`); the
  scenario as data (`engine/sim/scenario.test.ts`).
- Every run file of the three games and the sample world passes `pnpm -s cli run` (exit 0, same
  final hashes as in 0.7), and `mutants` exits 0 for all three games.
- The checks pass: `pnpm lint && pnpm docs:check && pnpm typecheck && pnpm test && pnpm build`
  (107 test files, 1222 tests passed and 1 skipped: the opt-in every-tick check).
- **The stacking-test report assigns no gap to 0.8.** `docs/reports/stacking-test.md` has 37 gaps:
  21 fixed in 0.7 and 16 moved to 0.10 (G16, G20, G37), 0.11 (G13, G18, G27, G28, G30), 0.14 (G5,
  G8, G9, G10, G12, G31) and 0.15 (G17, G33, G36). None names 0.8, so this release had no gap to
  take. The report's format note listed 0.8 as an example target; it now lists the releases gaps
  were actually moved to.

### Deviations from the roadmap

- **The sample's systems are in the engine**, not only in the fixture: the roadmap asks for a
  scenario written as data, and the systems that make a village work (haul, build, patrol) had to
  be code, so they are shared machinery in `engine/sim/systems.ts` (item 107).
- **"At any tick" is sampled on CI** (83 ticks, 40 of them seeded random), with every tick checked
  by an opt-in test (item 110).
- **Feedback numbering:** the builder choices continue at 102 (102-111), and the close-out
  review adds 112-120.

### Outstanding issues

- No line of sight or height rules yet (by design, item 101); they come with the RTS view (0.9
  onwards), in integer maths in `engine/sim`.
- A world has no orders or input yet: world runs are pure simulation. Orders (`withCause('order:<id>')`)
  and missions come with 0.9 and 0.10.
- A save and load costs about 10-15 ms on the sample (it re-checks every schema and rebuilds the
  path caches); fine for saves, too slow to reload every tick on CI.
- Open owner decisions: items 99-120 in `FEEDBACK-LOG.md`.

## Engine 0.7

The stacking test. Built on branch `engine/build-0.15`; not tagged (no tags during the build, owner
answer 24). The gap report is [reports/stacking-test.md](reports/stacking-test.md).

### What was built

- **`games/platformer-test/`**, a small original platformer on `kits/platformer`: four short
  levels (`level-1` to `level-4`) and its own `hopper` profile, all text. `level-4` has a door
  (a mini-game trigger) that pushes a one-room top-down challenge (`kits/topdown`) over the
  level; a pass gives coins and opens the wall to the goal, a fail puts the player back on the
  door. Four run files, one per level, guard all 32 of the kit's rules (`mutants` exits 0).
- **A game on two kits** (T4): an optional `uses` list beside `kit` in `game.json`; the tools
  merge every listed kit's content kinds, with `unknown_kit`, `duplicate_kit` and `kind_clash`
  errors at `game.json`.
- **Room challenges as mini games** (T5): `roomChallenge` in `kits/topdown/challenge.ts`, a
  fresh one-room top-down world per round behind the engine's `MiniGameDef`; the trigger's
  `params` say the goal (`defeat-all`, `reach`), the time limit and the hit points. The
  platformer kit needed no change to host it.
- **Shared glue moved into the engine and kits**, as each gap was found: the level sequence
  (`LevelSequence`, T2), the frame stream, host scene, backend choice, browser boot and both
  displays (`engine/core/present/stream.ts`, `engine/core/shell/`, `canvasDisplay`,
  `threeDisplay`; T6), `frameView` (T7), one skin per frame source by file name (`skinSet`,
  `presenterBySkinSet`, `withSkin`, `rounds`; T7, T8), and in the glue review (T9) content
  kinds from kit hooks, art, sounds and `mustLoad` (`engine/core/content/game-content.ts`),
  `contentSheets`, the kit's `contentStages`, a room `title`, a skin `camera.clamp` and the
  Canvas2D `skinSetCanvasPresenter` with `rounds` in `canvasDisplay`. The lab and the demo use
  them too.
- **2D and 3D** (T7, T8): original NES-style pixel art, palettes and MML sfx as text, a
  `canvas2d` skin for the levels and one for the vault round, and low-poly `three` skins for both
  (the room laid flat facing the camera). The page plays in 2D by default and in 3D with
  `?backend=three`; the root launcher lists both links. The backend parity test plays every run
  through null, Canvas2D and the Three.js scene builder; a browser test plays `level-4.run.json`
  through the built page in both backends.
- **The gap report**: 37 gaps, 21 fixed in 0.7 and 16 moved to 0.10, 0.11, 0.14 or 0.15, with a
  glue review and a summary of what stacking showed. Each later release's section in
  `ROADMAP.md` lists the gaps it took.
- Agent docs: `games/platformer-test/CLAUDE.md` (a worked example: how it was built step by step,
  the files, the files to run, how to run 2D and 3D, how to add a level or a mini game room),
  `AGENTS.md`, `docs/modules/games-platformer-test.md` and its `llms.txt` link, and updated pages
  for every module the gaps touched.

### Choices made

- **Gaps were fixed in the engine as they were found**, not saved for the end, so later tasks
  built on the fixes (the lab moved onto each one too, with unchanged golden hashes).
- **The kit stays strict** and this game guards every platformer rule (G7, item 76).
- **One skin per frame source, told apart by file name** (`<backend>-<mini game id>.json`), not
  a namespaced skin format (G14, G32): the two kits' tiles, cameras and HUDs clash.
- **A stacked frame shows the round's HUD only** (G19).
- **The round in 3D is laid flat facing the camera and centred** (item 82); 2D keeps it under its
  HUD band. Since T9 both are skin data (`camera.clamp`).
- **Game glue imports the kits' hooks** to build its kinds (`@kits/<name>/kit`; item 87).
- **Release-sized gaps were moved, not forced in**: run-file start levels, traces, region edits
  and per-kit mutants to the 0.14 creator tools; params checks, a round's last tick and a hosted
  round in the game contract to the 0.10 mission contract; per-round input, shell audio and
  trigger looks to the 0.11 mini siege; the 3D HUD, a skin background and several challenge
  rooms to the 0.15 sample set (items 77-81, 83-86).
- The root `package.json` version was left as it was, as in earlier releases of this build.

### How to try it

```sh
pnpm dev   # then open /games/platformer-test/ (2D) or /games/platformer-test/?backend=three (3D)
           # arrows move, Z jumps, X runs; in the vault round arrows walk and X stabs
pnpm -s cli validate games/platformer-test --json
pnpm -s cli run games/platformer-test/runs/level-4.run.json --json
pnpm -s cli mutants games/platformer-test --json
pnpm -s cli screenshot games/platformer-test/runs/level-4.run.json --tick 3060 --backend canvas2d --json
pnpm -s cli screenshot games/platformer-test/runs/level-4.run.json --tick 3060 --backend three --allow-software-gl --json
pnpm vitest run games/platformer-test tests/runs tests/browser
```

### Done when

Each item was checked by running the commands on 2026-11-02 at commit `6b70bcd`, the last 0.7
code commit.

- **Met: a written gap report is committed at `docs/reports/stacking-test.md`, and each gap says
  what was found, where, and whether it was fixed in this release or moved to a named later
  release.** 37 gaps (G1-G37): 21 `fixed in 0.7 Tn (<commit>)`, 16 `moved to <release>` (0.10:
  G16, G20, G37; 0.11: G13, G18, G27, G28, G30; 0.14: G5, G8, G9, G10, G12, G31; 0.15: G17, G33,
  G36), none left open. The report also has the glue review and a summary of what stacking showed.
- **Met: the game is playable from a link in both 2D and 3D.** `pnpm build` writes a launcher
  (`dist/index.html`) with `href="games/platformer-test/"` and
  `href="games/platformer-test/?backend=three"`.
  `pnpm vitest run tests/browser --reporter=verbose`: 4 passed, among them "is in the launcher and
  plays level-4.run.json in canvas2d, the door round and back" and "... in three, the door round
  and back" (headless Chromium; WebGL is SwiftShader here). In both, the page plays the run's
  input, shows the vault round twice and comes back to the level, with no page errors.
- **Met: its run files give the same state hashes with both backends.**
  `pnpm vitest run tests/runs --reporter=verbose`: every platformer-test run through null,
  Canvas2D and the Three.js scene builder gives its golden hashes (4 runs, all ticks). From the
  CLI, `pnpm -s cli run games/platformer-test/runs/level-<n>.run.json --json` exits 0 for n = 1..4
  (final hashes `2e94bc209e1a168d`, `26456b7489d5bd3d`, `3d737aadfabe54b6`, `06201f9a779cc2fc`),
  and `pnpm -s cli screenshot <run> --tick T --backend canvas2d --json` and `... --backend three
--allow-software-gl --json` at the same ticks all exited 0 with `matchesHeadless: true`:

  | Run       | Tick | golden (null)      | `--backend canvas2d` | `--backend three`  |
  | --------- | ---- | ------------------ | -------------------- | ------------------ |
  | `level-1` | 300  | `0ea6d18b5e241cd1` | `0ea6d18b5e241cd1`   | `0ea6d18b5e241cd1` |
  | `level-1` | 520  | `2e94bc209e1a168d` | `2e94bc209e1a168d`   | `2e94bc209e1a168d` |
  | `level-2` | 780  | `19e70e7aaec0f9cd` | `19e70e7aaec0f9cd`   | `19e70e7aaec0f9cd` |
  | `level-2` | 1130 | `26456b7489d5bd3d` | `26456b7489d5bd3d`   | `26456b7489d5bd3d` |
  | `level-3` | 1500 | `53f49e63490e99f1` | `53f49e63490e99f1`   | `53f49e63490e99f1` |
  | `level-3` | 2030 | `3d737aadfabe54b6` | `3d737aadfabe54b6`   | `3d737aadfabe54b6` |
  | `level-4` | 2700 | `55f4a450e8eb60eb` | `55f4a450e8eb60eb`   | `55f4a450e8eb60eb` |
  | `level-4` | 3060 | `37de7dbb8764a8a0` | `37de7dbb8764a8a0`   | `37de7dbb8764a8a0` |
  | `level-4` | 3300 | `06201f9a779cc2fc` | `06201f9a779cc2fc`   | `06201f9a779cc2fc` |

  Ticks 2700 and 3060 are inside the first and second vault rounds. The T9 refactor changed no
  picture: at `level-4` tick 3050 the canvas2d PNG is
  `80e987a9b8f6fae0de4994ab36545aaa00d4eed447cf63258966ddd643d5793b` and the three PNG
  `8c1302b8da53335387bea4be454c96823aa9590248548a6323fb5443d87729ac`, byte for byte the same as
  at `2ba77dc` (before T9), and the demo's `walk-east` tick 120 PNG kept its sha256 `385b61d4...`.

- **Met: `games/platformer-test/` contains only content, skins and thin glue (checked by review
  against the rule of thumb in DESIGN.md).** The glue review is in the report ("Glue review
  (0.7 T9)"): file by file, what is left and the verdict; what could not move yet is logged with a
  named release (G5, G27, G36, G37).
- Re-checked at `00bdbf4` (the page-test fix) for the release close-out on 2026-11-02: the four
  checks pass (95 test files, 1087 tests, the two browser tests among them, not skipped), every
  run file of the three games exits 0 with the same final hashes as above, `mutants` exits 0 for
  all three games, `pnpm docs:check` is up to date, and the gap report has 37 gaps, each `fixed in
0.7 Tn (<commit>)` or `moved to <release>`.
- `pnpm -s cli mutants games/platformer-test --json`, `... games/platformer-lab` and
  `... games/demo` exit 0; every run file of the three games passes `pnpm -s cli run` (exit 0).
- The four checks pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (95 test files,
  1087 tests), and `pnpm docs:check` reports the generated docs up to date. They did not pass
  reliably at `634320c` (the T9 commit): `tests/browser/platformer-test.test.ts` failed in review
  4 of 6 runs on its own (and 3 of 4 at `2ba77dc`, so it predates T9), until the fix below.

### Deviations from the roadmap

- **Engine changes beyond small kit fixes.** The scope says out of scope is "new kits beyond small
  fixes the gaps call for"; most gaps were shared glue, so the fixes went into `engine/core`, both
  backends and both kits (no new kit). The platformer kit gained `LevelSequence`,
  `contentStages` and frames for a hosted round; the top-down kit gained `challenge.ts` and an
  optional room `title`.
- **The lab and the demo were moved onto each fix** (their golden hashes and screenshots did not
  change), so no game keeps a copy of glue the engine now has.
- **Feedback numbering:** the task asked for new items from 76; 76-82 were already used by
  earlier 0.7 tasks, so the close-out items are 83-87 (numbers are never reused).

### Outstanding issues

- Sixteen gaps are moved to later releases (see the report), among them: run files always start
  at the first level (G9), a trigger's params are checked only when a round starts (G16), the
  3D picture has no HUD (G33), and the top-down rules inside a round are not mutant-checked
  (G12).
- Open owner decisions: items 76-98 in `FEEDBACK-LOG.md` (88-98 are the builders' choices to
  review, listed under "Engine 0.7, builder choices").
- The 3D checks ran on SwiftShader (no GPU in the build container), as in 0.6.
- `files.ts` (12 lines) is still per game until a Vite plugin (G5, 0.14).
- Fixed after review: the platformer-test page test was not deterministic (the T9 notes called
  it a one-off "not reproduced"; review saw it fail 4 of 6 runs, mostly in 3D, with tick 3200
  still in the black vault round). Cause: the test faked `requestAnimationFrame` but not
  `performance.now()`, so `FixedLoop.start()` read the real clock and the first fake frame caught
  up however many steps the page's start-up had taken (more after the async Three.js import),
  shifting the run against its input. The page's clock is now the test's own (it stands still
  between frames); the test passed 9 of 9 runs after the fix, 3 of them in parallel.

## Engine 0.6

Basic 3D backend. Built on branch `engine/build-0.15`; not tagged (no tags during the build, owner
answer 24).

### What was built

- **3D skin format.** A skin for the `three` backend describes every kind and every tile type as a
  primitive (`box`, `wedge`, `cylinder`, `cone`, `sphere`, `plane`) or a named compound mesh of
  parts, in world px with `depth` and `z`, plus `camera3d` defaults (field of view, tilt, layer
  depth, lights). All text, in the `skin` content kind. An unknown mesh id is `missing_ref` at the
  field, and a 3D field on a 2D skin is `wrong_backend_field`. `resolveMeshParts` and
  `resolveCamera3d` (`engine/core/present/skin.ts`) give backends and tests one reading.
- **Shared camera framing.** The follow, deadzone, 1/256 fixed-point lerp, clamp, small-area
  centring and shake maths moved from the Canvas2D presenter into `CameraFollower`
  (`engine/core/present/camera.ts`), so 2D and 3D frame the same point. The Canvas2D presenter
  draws byte-identically (the `start-to-goal` tick 120 screenshot's sha256 did not change).
- **`engine/backends/three`.** `ThreeScene.sync(frame)` turns any read-only `PresentFrame` and a
  `three` skin into a Three.js scene graph: instanced tile blocks built once per map id and
  version, entity meshes kept by id (layer depth, facing mirror, squash, rotate, alpha, a fallback
  box for an unlisted kind), a side-on perspective camera at the distance where the z = 0 plane
  shows exactly the 2D picture, one ambient and one directional light, sounds once per event, and
  a flash/tint overlay. It runs and is tested in Node. `ThreePresenter` is the browser `Presenter`
  over a fixed `WebGLRenderer` (no antialias, pixel ratio 1, `preserveDrawingBuffer`, sRGB, a fixed
  clear colour). `webglRendererInfo` / `isSoftwareRenderer` read and judge the WebGL renderer
  string, and `fitCanvas` / `applyCanvasBox` / `canvasToScreen` letterbox the WebGL canvas with the
  same `fitGame` maths as the 2D `Viewport`. `three` and `@types/three` are pinned at `0.187.0`.
- **An external-package table.** `config/layers.js` gained `PACKAGES`: npm packages that belong to
  one unit (`three` only from `engine/backends/three`). `config/deps.js`, ESLint and
  `tests/architecture/dependency-rule.test.ts` enforce it.
- **The view `frame()` hook.** `ViewGame` (`engine/core/view.ts`) has an optional `frame()` (the
  frozen `PresentFrame` for the state now) and an optional `background`, so a tool can show a
  game through any `Presenter` instead of `render(r)`. The platformer lab's view implements it.
- **The lab in 3D.** `games/platformer-lab/content/skins/three.json` gives a low-poly mesh per
  kind, a block per solid tile and a thin slab for one-way platforms, with the 2D skin's camera.
  `LabFrames` is one frozen frame stream every backend shares. In the browser,
  `/games/platformer-lab/?backend=three` boots `main3d.ts` (its own chunk, loaded only in 3D): a
  `ThreePresenter` on the page canvas, with the same input, loop, scenes and mini game as 2D. The
  page has a 2D/3D toggle, shows a message with a link back to 2D when WebGL 2 is missing, and
  the root launcher lists a 3D link (`<meta name="ww-alternate">`).
- **Three-way parity.** `tests/runs/backend-parity.test.ts` plays every lab run file presenting
  each tick through null, Canvas2D and the Three.js scene builder, checks the golden hashes, and
  fails if a kind or tile the runs show has no `three` skin entry.
- **`pnpm cli screenshot --backend three`.** `screenshot` takes `--backend canvas2d|three`
  (canvas2d is the default and gives the same bytes as before) and `--allow-software-gl`. With
  `three` the page shows the view's `frame()` through a `ThreePresenter` and the game's `three`
  skin, syncing every tick and rendering once at the target tick, and reports the WebGL renderer.
  A software renderer (or no WebGL context) is exit 4 with a message naming the renderer and the
  flag; `--allow-software-gl` forces SwiftShader so the PNG is repeatable. A view without
  `frame()` or a game without a `three` skin is exit 3.
- **Browser smoke test.** `tests/browser/lab-3d.test.ts` (skipped where Chromium is missing, never
  in CI) opens the lab in 3D from the Vite dev server and from a build under a sub-path base,
  reads the WebGL renderer, holds right and jumps, and checks that the picture changes far more
  than when idle, with no page errors.
- Agent docs: `engine/backends/three/CLAUDE.md` and `AGENTS.md`, `docs/modules/engine-backends-three.md`
  and its `llms.txt` link, and updated pages for core, present, tools, Canvas2D and the lab.

### Choices made

- **Software GL policy.** Headless Chromium in this container has no GPU and reports
  `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.
  The roadmap wants a silent fall-back to software rendering caught, so `screenshot --backend
three` refuses it (exit 4). `--allow-software-gl` is an explicit opt-in that forces SwiftShader,
  which also makes the PNG repeatable on one machine. The browser smoke test accepts SwiftShader:
  it checks that 3D plays, not that it is hardware-backed. (Item 65.)
- **HUD and effects are minimal in 3D.** The 3D backend draws no HUD (`skin.hud`, `frame.status`)
  and no `particles`; `flash`, `tint` and `shake` work. Lights are one ambient and one directional,
  with no shadows. (Item 66.)
- **`frame()` is an optional view hook** next to `render(r)`, not a replacement for it, so the
  demo and the 2D screenshot path did not change. A run uses one or the other. (Item 67.)
- **The 3D mesh format** is primitives and named compound meshes in the skin JSON, not an external
  model format (glTF, OBJ), keeping content text and in line with owner answer 22. (Item 68.)
- **`?backend=three` picks 3D** in the browser, with Canvas2D the default and a 2D/3D toggle on the
  page. (Item 69.)
- **The external-package table** (`PACKAGES` in `config/layers.js`) is a new kind of rule in the
  dependency table: a package may be imported only by the units listed. (Item 70.)
- **`zoom` works in 3D but not in 2D.** The 3D camera honours `zoom` by distance; the Canvas2D
  presenter still ignores it (as since 0.4). (Item 71.)
- More build decisions for the owner are items 72-75 in `FEEDBACK-LOG.md`.
- The root `package.json` version was left as it was, as in earlier releases of this build (no
  release is tagged or published during the build).

### How to try it

```sh
pnpm dev   # then open /games/platformer-lab/?backend=three (arrows move, Z jumps, X runs)
pnpm -s cli run games/platformer-lab/runs/start-to-goal.run.json --json
pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --backend canvas2d --json
pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --backend three --allow-software-gl --json
pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --backend three   # exit 4 without a GPU
pnpm vitest run tests/runs/backend-parity.test.ts tests/browser/lab-3d.test.ts engine/backends/three
```

### Done when

Each item was checked by running the commands on 2026-11-02 at commit `d7ea822`, the last 0.6
code commit.

- **Met: the 0.5 fixture level plays in the browser in 3D.**
  `pnpm vitest run tests/browser/lab-3d.test.ts --reporter=verbose`: 2 passed ("plays from the Vite
  dev server: WebGL renderer, input moves the picture, no page errors" and "plays from the build
  under a sub-path base"). As a manual check, after `pnpm build` a Playwright script opened
  `vite preview` at `/games/platformer-lab/?backend=three` in Chromium (800x600, launched with
  `--enable-unsafe-swiftshader`). The canvas was 256x240 with a WebGL 2 context whose renderer was
  `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.
  The first screenshot showed the fixture level in 3D: the runner on the left, the ground blocks,
  a `?` block, a gap and a walker. Holding ArrowRight and X, then Z for a jump, the runner crossed
  the gap and the camera scrolled to the coin and the goal flag (canvas screenshot sha256 prefixes:
  start `921951ca969718c9`, after moving `d6edc8840f770f1f`). There were no console errors and no
  page errors.
- **Met: the same run file gives the same state hashes with the null, Canvas2D and Three.js
  backends.** `pnpm vitest run tests/runs/backend-parity.test.ts --reporter=verbose`: 10 passed,
  among them each of the six lab runs (`mini-game`, `moves`, `objects`, `shells`,
  `start-to-goal`, `walkers`) through null, Canvas2D and the Three.js scene builder against the
  golden hashes, and "the three skin has a mesh for every kind and a block for every tile the lab
  runs show". From the CLI, for `games/platformer-lab/runs/start-to-goal.run.json`:
  `pnpm -s cli run ... --json` (headless, null), then `screenshot ... --tick T --backend canvas2d
--json` and `screenshot ... --tick T --backend three --allow-software-gl --json` for each tick
  the run hashes. Every command exited 0, and every screenshot reported `matchesHeadless: true`:

  | Tick | `run` (null)       | `--backend canvas2d` | `--backend three`  |
  | ---- | ------------------ | -------------------- | ------------------ |
  | 0    | `9ed173e616121d27` | `9ed173e616121d27`   | `9ed173e616121d27` |
  | 60   | `522eeb1256650932` | `522eeb1256650932`   | `522eeb1256650932` |
  | 120  | `50397aac3f28ba17` | `50397aac3f28ba17`   | `50397aac3f28ba17` |
  | 180  | `9c9848d8d2b9a2b2` | `9c9848d8d2b9a2b2`   | `9c9848d8d2b9a2b2` |
  | 240  | `7137cbde89f0fd44` | `7137cbde89f0fd44`   | `7137cbde89f0fd44` |

  These are also the golden hashes in `start-to-goal.hashes.json`. The canvas2d tick 120 PNG kept
  its 0.5 sha256 (`2c6cc55462fd9c74d0392e6d2471d2020743b8c1b0abd719a8e094a4b54e9c2d`).

- **Met: `pnpm cli screenshot --backend three` writes a PNG and fails with a clear error if WebGL
  is not hardware-backed.** With `--allow-software-gl` it wrote 256x240 PNGs for each tick above
  (`renderer` reported as the SwiftShader string); tick 120 gave sha256
  `86ede08b4258402e73ca572e835987dc1e16188f5b6da0ea2990ccb54c7d3150` on two separate runs. Without
  the flag, in this container (no GPU),
  `pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --backend three`
  exited 4, wrote no file, and printed: `WebGL is not hardware-backed: the renderer is "ANGLE
(Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", a
software one. Run where a GPU is available, or pass --allow-software-gl to take the picture with
SwiftShader anyway`. With `--json` the result was `"ok": false`, `"exitCode": 4`,
  `"refused": "software_gl"` and the renderer string. The path that writes a PNG on hardware WebGL
  could not be run here (no GPU); `engine/tools/screenshot.test.ts` covers the refusal and the
  software-GL path.
- **Met: the diff for this release changes nothing in `kits/platformer`.**
  `git diff d9da45fbf7a82d0bdc13491aa810e0701fc3a24b -- kits/platformer` (the last 0.5 commit
  against the 0.6 close-out) printed nothing, and `git diff --stat` for that path was empty.
- The four checks pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (81 test files,
  984 tests). Every run file of both games passes `pnpm -s cli run` (exit 0).
- Re-checked at `030da95` (after a fix that keeps the Vite client's websocket off the shared port
  24678): the four checks pass (81 files, 984 tests), all seven run files exit 0, the browser smoke
  and parity tests pass (12 tests), `screenshot --backend three --allow-software-gl` at tick 120
  gave the same sha256 `86ede08b...` and `matchesHeadless: true`, the no-flag run exited 4 with
  `refused: "software_gl"` and wrote no file, and `kits/platformer` is still unchanged since 0.5.

### Deviations from the roadmap

- **Additions not in the roadmap:** the shared `CameraFollower` in core, the `frame()` and
  `background` view hooks, the external-package table, a canvas fit helper for WebGL, and
  `zoom` honoured by the 3D camera.
- **Screenshots on software WebGL** are allowed behind `--allow-software-gl`. The roadmap only asks
  that a software fall-back is caught; the flag lets CI and this container take 3D pictures at all.

### Outstanding issues

- The 3D backend draws no HUD and no particles, and same-layer entities share a depth plane, so
  their list order is not kept.
- `zoom` is honoured in 3D but still ignored in 2D.
- A screenshot on hardware WebGL has not been taken (no GPU in the build container), so PNG
  repeatability across GPUs is untested.
- The browser play check in 3D is a committed smoke test plus a manual Playwright script; the
  smoke test accepts SwiftShader.
- Map `layers` sit behind the tiles in 3D but over them in 2D, and the lab needs a small
  `camera3d.layerDepth` (0.25) because the kit's draw layers go up to 20 (items 72-74).
- Done-when item 3 is met only on software WebGL (item 75).

## Engine 0.5

Platformer kit. Built on branch `engine/build-0.15`; not tagged (tagging is the owner's call).

### What was built

- **A kit hook replaces the tools' kit table (item 44).** Each kit exports `kit` from
  `kits/<name>/kit.ts`, a `KitDef` (`engine/core/kit.ts`, checked by `defineKit`): its name, content
  kinds, named rules and `strictMutants?`. `engine/tools/kits.ts` finds a game's kit by its
  `game.json` kit name through `engine/tools/kit-list.ts`, which `pnpm docs:gen` generates from the
  kit folders and `pnpm docs:check` checks. `KIT_KINDS` and `KIT_RULES` are gone.
- **Strict mutants (item 41).** A run file may list the rules it is meant to guard (`guards`,
  checked against the kit's rules). For a kit that opts in (`strictMutants: true`), `mutants` exits
  4 when a run does not guard a rule it lists. `mutants games/<game>` checks every run file of a game
  and reports which runs guard each rule; for a strict kit an unguarded rule is exit 4 as well. The
  top-down kit does not opt in and still only reports.
- **The Canvas2D camera (item 51).** `SkinnedCanvasPresenter` keeps camera state (never in a kit,
  a frame or a hash) and frames each picture from the frame's camera hint, else the skin's camera:
  follow an entity, a deadzone box round the centre, an integer fixed-point lerp (1 snaps), and a
  clamp to the hint's new optional `bounds` or the map (a smaller area is centred). `CameraHint`
  gained `deadzone`, `lerp` and `bounds`. `zoom` is still ignored. The demo's pictures and hashes
  did not change.
- **`kits/platformer`.** Two content kinds: `level` (a JSON header plus a `.map.txt` grid of a
  generic legend: solid, brick, bump blocks, one-way platforms, coins, hazards, the start, the goal,
  actor spawns and mini-game triggers, with a `scroll` mode of `right`, `free` or `none`) and
  `profile` (the player's movement numbers in whole sub-pixels, 1/256 px, and speeds in 1/4096 px
  per tick, plus actor types such as `walker` and `shell` whose behaviour is set by data). Cross-file
  checks require one start, one goal, a known profile and known actor types. A tiny fixture level
  and the default-runner profile live in `kits/platformer/__fixtures__/`.
- **The platformer world.** `PlatformerWorld` plays a level with SMBC-style whole-number physics:
  walk and run caps, friction, skid, jump tiers by take-off speed, variable jump through hold
  gravity, a fall cap, solid and one-way tiles, ceiling bumps and level bounds. Level objects: coins,
  bump blocks (coin, coins, power-up, life or an actor), breakable bricks, hazards and pits, hit
  points with invulnerability ticks, lives, a goal and the scroll-right lock. Actors wake near the
  view, turn at walls (and at ledges for `turnAt: ledges` types), are stomped into their `stompInto`
  type with a bounce, are kicked as shells, and a moving shell defeats other actors. The level ends
  `cleared` or `failed`. **32 named rules** (`MOVEMENT_RULES` and `OBJECT_RULES` in `rules.ts`),
  each fails a kit test when it is off. `snapshotWorld` gives the JSON-safe, hashed snapshot and
  `platformerGame` the headless contract.
- **Golden traces against SMBC.** `kits/platformer/golden.test.ts` replays six scripted inputs
  (walk, run then skid and let go, a tap jump, a held jump, a running jump over a gap into a wall,
  a jump into a ceiling) and matches SMBC REMIX v0.4.73 (commit `e0eeee7`) tick by tick in the
  body's x, y, vx and vy. The traces were recorded with SMBC's headless `runSim` and its default
  runner on our own 48x15 test map. The generator, the command and the provenance are in
  `kits/platformer/__fixtures__/golden/README.md`. SMBC is not a dependency: the test reads only the
  committed JSON.
- **The mini game hook.** `engine/core/minigame.ts` is a pure contract in the style of SMBC's
  `MiniGameDef` (`MiniGameDef`, `MiniGame`, `MiniGameResult` `pass` | `fail` | `quit`,
  `miniGameTable`). `engine/core/minigame-scene.ts` (`miniGameScene`) is the browser side a game's
  glue pushes over a level. A platformer level's `!` cells are triggers: the world pauses for the
  round (headless too), keeps the round's snapshot in its own, and applies the outcomes listed for
  the result in the level data (`coins:<n>`, `life`, `clear`, `respawn`, `open:<col>:<row>`). The
  kit defines no mini games; the game supplies them. This adds the named rule `mini-games`.
- **Presentation.** `kits/platformer/present.ts` (`presentWorld`) describes each tick as a
  read-only `PresentFrame`: the terrain map through a `MapTracker` (sent again when a block is
  used, a brick breaks or a gate opens), the runner, actors, coins, goals, triggers, block bounces
  and remains with animation states and tags, placed events, HUD status, and a camera hint that
  follows the runner inside the scroll lock. While a mini game runs, its own frame is shown.
  Presentation state lives in `PlatformerPresentState`, outside the world, so hashes do not change.
- **`games/platformer-lab`.** A test game on the kit. It plays a byte-identical copy of the kit's
  fixture level first (`lab.test.ts` fails if the copy drifts), then five small levels that each
  put one group of rules to work. Six run files (`start-to-goal`, `moves`, `objects`, `shells`,
  `walkers`, `mini-game`) together guard all 32 rules, with golden hashes, and backend parity
  covers them. In the browser it plays through `SkinnedCanvasPresenter` and an original
  placeholder skin (flat NES-style frames as text, the camera following with a 32x48 deadzone and
  lerp 0.25), with keyboard, gamepad and touch. It pushes `miniGameScene` for its own tiny "stop the
  bar" mini game. It has agent docs, a module page, an `llms.txt` link and a platformer section in
  the scaffold-game skill.

### Choices made

- **Orchestrator defaults for open feedback items.** The owner had not answered items 41, 44 and
  51 when 0.5 started, so the build took these defaults (the owner can still overrule them):
  - **41 (make weak rules fail):** yes, but per kit. A kit opts in with `strictMutants: true`, the
    platformer kit does, and the top-down kit stays report-only, so the demo's single run file
    still passes.
  - **44 (replace the kit table with a hook):** yes. Each kit exports a `KitDef`, and the tools'
    list of kits is generated by `pnpm docs:gen` (`engine/tools/kit-list.ts`), so adding a kit
    needs no hand edit in `engine/tools`.
  - **51 (camera zoom, deadzone, lerp, tint):** deadzone, lerp and clamping were done in 0.5 for
    the platformer. `zoom` stays ignored (honouring it means scaling the map cache and every
    sprite), and the demo keeps `clamp: false`.
- **The trace approach.** Golden traces were recorded once from SMBC's own headless runner, not
  from a port of its code. A small Vite module runner, using this repo's Vite with SMBC as the
  root, was needed because SMBC's level index uses `import.meta.glob`. Nothing was installed in or
  written to the SMBC checkout. The generator is kept as text in the fixtures' README and the test
  reads only the committed JSON, so CI never needs SMBC. One fix came from the traces: the player
  now starts as SMBC's does, not yet on the ground, so tick 0 is an air tick.
- **SMBC behaviour left out of the kit**, and kept out of the trace scripts: character-specific
  moves (crouch, slides, wall moves, flutter, air jumps, cut jumps), swimming, power states,
  running over one-tile gaps, coyote time and start modes other than standing. Also simplified: a
  power-up is given at once, a bump does not hit actors on the block, actors do not turn at each
  other, a respawn is immediate, and there is no score or timer. The list is in
  `kits/platformer/CLAUDE.md`.
- **The physics profile is data**, a content kind of its own, not constants in the kit. Enemy
  behaviour (speed, stompable, `stompInto`, kickable, harms, `turnAt`) is set per actor type in
  the profile.
- **The browser fixture lives in a lab game.** The roadmap puts the fixture level in
  `kits/platformer`. Browser play needs a skin, an entry page and glue, which are game content, so
  they live in `games/platformer-lab`, which plays a checked copy of the kit's fixture.
- **Two cameras with a set precedence.** The world keeps its own view (`scrollX`), which decides
  the scroll lock and when actors wake. The picture's camera is the presenter's: it follows the
  runner with a deadzone and lerp, inside the hint's `bounds` (the scroll lock). A frame hint's
  values win over the skin's camera defaults.
- **Mini games are a core contract, not a kit part**, so another kit can host them. The trigger
  outcomes are a closed list in level data.

### How to try it

```sh
pnpm -s cli validate games/platformer-lab --json
pnpm -s cli run games/platformer-lab/runs/start-to-goal.run.json --json
pnpm -s cli run games/platformer-lab/runs/start-to-goal.run.json --disable-rule variable-jump --json
pnpm -s cli mutants games/platformer-lab --json
pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --json
pnpm test kits/platformer games/platformer-lab tests/runs tests/architecture
pnpm dev   # then open /games/platformer-lab/ (arrows move, Z jumps, X runs)
```

### Done when

Each item was checked by running the commands on 2026-11-02 at commit `5e8282a`, the last 0.5
code commit.

- **Met: a headless run file plays a fixture level from start to goal, with the same state hashes
  every time.** `pnpm -s cli run games/platformer-lab/runs/start-to-goal.run.json --json` was run
  twice: exit 0, `passed: true`, 17 assertions and 3 invariants each time, and the two outputs were
  byte-identical. The hashes were tick 0 `9ed173e616121d27`, 60 `522eeb1256650932`,
  120 `50397aac3f28ba17`, 180 `9c9848d8d2b9a2b2` and 240 `7137cbde89f0fd44`, the same as
  `start-to-goal.hashes.json`. The run plays `tiny`, the copy of the kit's fixture level, and its
  assertions check the coins, the used block, the position at the goal and the outcome `cleared`
  (at tick 226). `tests/runs/run-files.test.ts` compares every run with its golden hashes.
- **Met: golden traces match SMBC tick by tick.** `pnpm vitest run kits/platformer/golden.test.ts`
  passed (8 tests: one per script, one that every trace has the recorded map, fields and length, and one that a changed profile number is reported at its first differing tick). As a fresh check, the
  traces were regenerated from SMBC at `e0eeee7` (`git -C /home/user/jelloshooter848/smbc rev-parse
--short HEAD`) with the README's `run.mjs` and `generate.ts` in a scratch folder
  (`GOLDEN_OUT=$PWD/out node run.mjs $PWD/generate.ts`, then Prettier). All six outputs were
  byte-for-byte the committed `*.trace.json` files, and the SMBC checkout was left clean
  (`git status --short` empty).
- **Met: for every named rule, at least one run file fails when that rule is off.**
  `pnpm -s cli mutants games/platformer-lab --json`: exit 0, `strict: true`, all 32 rules guarded
  (`unguarded: []`), and no weak rule in any of the six runs. Each rule is guarded by 1 to 6 runs;
  for example, `variable-jump` off fails `start-to-goal` at tick 80 (`player.y is 23168, expected
21320`, exit 4). A planted `games/platformer-lab/runs/planted-weak.run.json` (30 ticks of walking
  right, one assertion on the level id, `"guards": ["skid"]`) made the same command exit 4:
  `planted-weak.run.json: weak: does not guard skid (listed in guards)`. Run alone,
  `pnpm -s cli mutants games/platformer-lab/runs/planted-weak.run.json` also exited 4
  (`weak: does not guard skid`). After the planted file was deleted, the game check exited 0 again.
- **Met: the kit has no imports from any backend and no drawing calls.**
  `tests/architecture/dependency-rule.test.ts` and `tests/architecture/no-drawing.test.ts` pass
  (95 tests). A planted `kits/platformer/planted.ts` that imports `@engine/backends/canvas2d` and
  calls `ctx.fillRect(0, 0, 16, 16)` failed both (2 failed, 93 passed). The dependency test said
  "kits/platformer/planted.ts imports '@engine/backends/canvas2d': kits may not import
  engine/backends (allowed: kits, engine/core)", and the drawing scan said
  `kits/platformer/planted.ts:4: ctx.fillRect(0, 0, 16, 16);`. `eslint` on the file reported the
  same `layers/dependency-rule` error. A second planted file importing `@engine/core/gfx/renderer`
  and calling `r.rect(0, 0, 16, 16, '#000000')` also failed both ("kits never draw or play
  sound"). Both planted files were deleted, and the two tests passed again.
- **Met: a fixture level plays in the browser through Canvas2D and a placeholder skin.** After
  `pnpm build`, `vite preview` served the page and a Playwright script opened it in Chromium at
  `/games/platformer-lab/` (800x600). It drew the fixture level through the placeholder skin
  (canvas 800 wide, 381205 non-black pixels, 10 colours). Holding ArrowRight for a second, then Z
  for a jump, changed the picture. There were no console errors or page errors. Running
  `pnpm -s cli screenshot games/platformer-lab/runs/start-to-goal.run.json --tick 120 --json`
  twice wrote the same 256x240 PNG both times (sha256
  `2c6cc55462fd9c74d0392e6d2471d2020743b8c1b0abd719a8e094a4b54e9c2d`), with
  `matchesHeadless: true` (hash `50397aac3f28ba17`). `tests/runs/backend-parity.test.ts` plays
  every lab run presenting each tick through the null backend and through `LabPicture` (Canvas2D),
  and both give the golden hashes.
- The four checks pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (76 test files,
  870 tests), and `pnpm docs:check` passes. Every run file of both games passes
  `pnpm -s cli run` (exit 0), and `pnpm -s cli mutants games/demo` exits 0.
- **Re-checked when 0.5 was finalized** (at `4e97131`): the four checks pass again (76 files, 870
  tests), every run file of both games exits 0, `mutants games/platformer-lab` exits 0 with
  `strict: true`, `start-to-goal` gives byte-identical output twice and exits 4 with
  `variable-jump` off, `golden.test.ts` passes (8 tests), and a fresh Playwright check of the built
  page drew an 800-wide canvas that changed after ArrowRight and Z, with no console errors.

### Deviations from the roadmap

- **The browser fixture is a lab game.** The fixture level stays in `kits/platformer` as the
  roadmap says. Playing it in the browser is done by `games/platformer-lab`, which holds a checked
  byte-identical copy of the fixture, five more rule levels, a skin and a test mini game.
- **The camera's deadzone, lerp and clamp were added to the Canvas2D presenter** (item 51). The
  roadmap's 0.5 scope only mentions the camera as part of SMBC's code to extract.
- **Additions not in the roadmap:** the kit hook (item 44), strict mutants with `guards` and a
  game-wide `mutants` check (item 41), and a pure mini game contract in `engine/core` with a
  browser scene helper.
- **SMBC's behaviour is not all there.** The kit keeps the rules the traces cover and the level
  objects a test level needs. Character-specific moves, swimming, power states and the other items
  under "Choices made" were left out.

### Outstanding issues

- `zoom` in camera hints and skins is still ignored by the Canvas2D presenter.
- The browser play check is a manual Playwright script, as in 0.4, not a committed test. The CLI
  screenshot and the backend-parity test cover drawing in Chromium and the Canvas2D path.
- The lab plays its levels in a fixed order, so a run that checks a later level replays every
  earlier level first. Its runs are long (up to 3015 ticks), and a change to an early level moves
  every later tick.
- The lab has no sounds. Its skin maps every event to an effect only.
- The demo's top-down kit is not strict, and its one run file guards only `doors-change-room`.
- Feedback items 52-64 (`docs/FEEDBACK-LOG.md`) ask the owner about these choices.

## Engine 0.4

Renderer and presentation contract. Built on branch `engine/build-0.15`; not tagged (tagging is the
owner's call).

### What was built

- **Configurable picture size.** `game.json` has an optional `screen` `{ width, height }` (whole
  numbers 64..1920, default 256x240). `fitGame`, the canvas2d `Viewport`, the touch layout, the view
  contract and `pnpm cli screenshot` all take the size from it; nothing else hard-codes 256x240. The
  demo states its size explicitly.
- **The presentation contract** (`engine/core/present`, pure). `PresentFrame`
  `{ frame, size, entities, map?, events, status, camera? }`: each entity's id, kind, box, facing,
  animation state and tags; the map (full on load or change, else an `{ id, version }` reference,
  via `MapTracker`); this frame's events; HUD status values; and the extension points `camera`,
  `layer` (depth) and `fx` (squash, stretch, rotate, alpha, tint), all of which a backend may
  ignore. `freezeFrame` deep-freezes a frame so a backend that writes to it throws;
  `presentFrameSchema` checks one in tests and tools; backends implement `Presenter`.
- **Skins.** The engine's `skin` content kind: one JSON file per backend mapping each kind to sprite
  frames (2D: sheet, palette, per-state and per-facing frames or cycles) or to a mesh (3D, for a
  later `three` backend), each tile to a frame, each event to a sound and an effect (`flash`,
  `particles`, `shake`, `tint`), plus HUD entries and a camera default. Cross-file checks report a
  missing sheet, palette, sound or frame at the skin file and field. `resolveSkinFrame` is the pure
  lookup backends share.
- **Presenters.** `SkinnedCanvasPresenter` (Canvas2D) draws any frame through a skin: the map cached
  per id and version, entities by layer then list order (a stable sort), facing flips, fallback boxes for anything the skin
  lacks, `fx` through `transformed()`/`translucent()`, camera framing, the HUD from status values,
  event effects and skin sounds through `onSound`. `NullPresenter` (null backend) takes frames and
  draws nothing, with `freeze` and `validate` options for tests.
- **The top-down kit is split.** `kits/topdown/present.ts`: `presentWorld(world, events, opts)`
  describes the room map, the hero and every other entity in the old draw order (with `TD_DEPTH`
  depths and tags such as `invuln`, `stunned`, `dark`, `flashing`), HUD status and events with
  positions, plus a camera hint, without changing any state (`TdPresentState` keeps the map tracker
  and stable ids outside the world, so state hashes are untouched). `render.ts`, `hud.ts`, the
  kit's `view.ts` and every `render` method are gone; the kit's `CLAUDE.md` maps each old frame name
  to its presented kind and animation.
- **The demo draws through its skin.** `games/demo/content/skins/canvas2d.json` maps every kind,
  tile, event and HUD value the kit presents to the hero sheet and a new placeholder sheet
  (`demo-placeholders.txt`, which reproduces the kit's old flat colours). `picture.ts`
  (`DemoPicture`) runs `presentWorld` -> `freezeFrame` -> `SkinnedCanvasPresenter`; three new sfx
  (`door`, `spit`, `hurt`) play on events.
- **Kits can't draw, enforced twice.** `FORBIDDEN_CORE` in `config/layers.js` keeps kits off the
  core's drawing and output side (`Renderer`, sprite sheets, pixel art, animation, `assets/`, audio
  output, `view.ts`, `scene.ts`, `loop.ts`), checked by ESLint and
  `tests/architecture/dependency-rule.test.ts`; backends were already forbidden by the layer table.
  `tests/architecture/no-drawing.test.ts` also scans every non-test kit file for drawing calls
  (`.sprite(`, `.rect(`, `.text(`, `fillRect`, `drawImage`, `getContext`, ...).
- **Parity and two-resolution tests.** `tests/runs/backend-parity.test.ts` plays every demo run file
  presenting every tick through the null and the Canvas2D presenters and requires both hash lists to
  equal the golden file. `tests/build/two-resolutions.test.ts` copies the demo with only `screen`
  changed to 320x240, then validates, runs (same hashes), screenshots (320x240, same bytes twice)
  and builds the copy. The screenshot page now draws every tick and reports the hashes it saw.

### Choices made

- **Kits are kept off the core's output side, not just off backends.** The roadmap's check is "kits
  can't import a backend"; that alone would still let a kit draw through the core `Renderer`, so the
  layer table gained `FORBIDDEN_CORE` and a scan for drawing calls.
- **Map versions are hashed from the tiles and tags**, so a backend redraws its cached map only when
  something changed; during a room slide both rooms are sent as one map.
- **Presentation state lives outside the world** (`TdPresentState`), so presenting cannot change a
  state hash; a test checks the hashes per tick with and without presenting.
- **The camera hint** keeps the 64 px HUD band at the top and centres the room in the rest of the
  picture at any size; a smaller picture cuts the room's edges.
- **The skin schema already has the 3D shape** (`mesh`, `color`, `scale`), chosen by the skin's
  `backend`, so 0.6 adds a backend, not a new file format.
- **Skins are content**, registered as an engine content kind, so `validate`, the editing verbs and
  the schema reference cover them like any other file.
- **The demo's placeholder art is a sprite sheet** that reproduces the old flat colours exactly, so
  the change of who draws is visible only where the skin adds something new (the HUD hearts).

### How to try it

```sh
pnpm -s cli validate games/demo --json
pnpm -s cli run games/demo/runs/walk-east.run.json --json
pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 120 --json
# another picture size: change only "screen" in games/demo/game.json, e.g. to 320x240, then
pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 120 --json
pnpm test tests/runs tests/build/two-resolutions.test.ts tests/architecture/no-drawing.test.ts
pnpm dev   # then open /games/demo/
```

### Done when

Each item was checked by running the commands on 2026-11-02 at commit `a3183f9`, and re-checked at
`6cb4e75` (the draw-order fix, the last 0.4 code commit): the four checks, the run file, the
screenshot (same sha256 and hashes) and the focused tests all passed again.

- **Met: `kits/` contains no drawing calls.** `tests/architecture/no-drawing.test.ts` and
  `tests/architecture/dependency-rule.test.ts` pass. A planted `kits/topdown/planted.ts` that imports
  `@engine/core/gfx/renderer` and calls `r.rect(0, 0, 16, 16, '#000000')` failed both (2 failed,
  93 passed): the dependency test with "kits may not import engine/core/gfx/renderer.ts: kits never
  draw or play sound", the drawing scan with `kits/topdown/planted.ts:3: r.rect(...)`; `eslint` on
  the file reported the same `layers/dependency-rule` error. A planted import of
  `@engine/backends/canvas2d` failed the dependency test ("kits may not import engine/backends").
  The planted files were deleted.
- **Met: the demo plays as before with the same state hashes as at the end of 0.3.**
  `pnpm -s cli run games/demo/runs/walk-east.run.json --json` twice: exit 0, `passed: true`,
  byte-identical output, hashes tick 0 `d29e6b40530102ce`, 40 `307b25d5cf0508b9`,
  80 `6f0c9999c28588f2`, 120 `ba89383037a8499e`, 160 `ebbbdd0bbe2fe046`, 200 `08a5abeb7379f953`,
  240 `257c816edd617516`, the values recorded at the end of 0.3. `walk-east.hashes.json` is
  unchanged since `c72d1d7` (the 0.3 close-out; `git diff` is empty). In a browser (`pnpm build`,
  `vite preview`, Playwright with Chromium) the demo page drew the courtyard (canvas 800x600,
  285002 non-black pixels), the hero moved when ArrowRight was held for a second (the canvas
  changed), and there were no console errors or page errors. The tick-120 screenshot differs from
  0.3's only by the new HUD hearts (see `games/demo/CLAUDE.md`, "Screenshot against Engine 0.3").
- **Met: two resolutions by changing one value, a CLI screenshot of each.** With
  `games/demo/game.json` as committed (256x240),
  `pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 120` wrote a 256x240 PNG,
  sha256 `385b61d4a1ff684c27a8d497775c05949d935fd387e19be34a3fbbd632ba7cdd`,
  `matchesHeadless: true`. With only `"screen"` changed to `{ "width": 320, "height": 240 }` the same
  command wrote a 320x240 PNG, sha256
  `5ccb69e10a269f7dedb0c94d4513d54553a450f6cf672bb926b1bb0d0ced004f`, `matchesHeadless: true`, the
  room centred and the HUD at the top; `run` at that size gave the same seven hashes. The value was
  restored. `tests/build/two-resolutions.test.ts` does the same in a copy, takes each screenshot
  twice (same bytes) and builds the copy with Vite (6 tests pass).
- **Met: the same hashes with the Canvas2D and the null backend.**
  `tests/runs/backend-parity.test.ts` passes: walk-east presented every tick through `NullPresenter`
  and through `SkinnedCanvasPresenter` gives the golden hashes both times. The screenshot command,
  which draws every tick with the Canvas2D backend in Chromium, reported the headless hashes for
  ticks 0..120 at both sizes.
- The four checks pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (64 test files,
  708 tests at `6cb4e75`), and `pnpm docs:check` passes.

### Deviations from the roadmap

- **A stricter check than the roadmap names.** Besides "kits can't import a backend", kits may not
  import the core's drawing and output side (`FORBIDDEN_CORE`), and a scan rejects drawing calls in
  kit code.
- **The demo looks slightly different** although its rules did not change: the skin adds HUD
  hearts, and events now play sounds (new `door`, `spit` and `hurt` sfx). A few visual details a
  skin cannot express yet were dropped (listed below). The state hashes are unchanged.
- **Skins also hold HUD entries and a camera default**, beyond the roadmap's kinds, sprites, meshes,
  sounds and effects; the HUD had to move out of the kit somewhere.
- **The status lines** at the top of the demo (title, room, hearts, controls) stay as debug text in
  `DemoPicture`, drawn by the game, not the skin.

### Outstanding issues

- Visual-only differences from 0.3 that skins cannot express yet: a hurt hero or monster no longer
  blinks; stun stars do not turn; the exit's glow and dark-room palettes are one flat frame each.
- `SkinnedCanvasPresenter` ignores the camera's `zoom`, `deadzone` and `lerp` and the `tint` fx for
  now (`shake` is honoured).
- Screenshot PNGs still include the demo's debug text in a system font, so they are byte-stable on
  one machine but may differ between machines; no golden PNG hash is committed.
- The scaffold skill still covers only the top-down kit (now through `presentWorld`, a skin and
  `SkinnedCanvasPresenter`).
- The tools' kit table (`engine/tools/kits.ts`) is unchanged; the kit-level hook is still planned
  for 0.5.
- Feedback items 45-51 (`docs/FEEDBACK-LOG.md`) ask the owner about these choices.

## Engine 0.3

LLM tooling. Built on branch `engine/build-0.15`; not tagged (tagging is the owner's call).

### What was built

- **Agent docs.** `llms.txt` at the root links the root `CLAUDE.md`, the design and roadmap, one
  page per module in `docs/modules/`, the cheat sheet, the generated references and the skills.
  Every module folder has a `CLAUDE.md` and an `AGENTS.md` pointer;
  `tests/architecture/agent-docs.test.ts` fails if a module has no page, `llms.txt` does not link it,
  or any link is broken.
- **Content core.** `engine/core/content`: Zod schemas (Zod 4.6.7, pinned), text grids that reject
  ragged rows and unknown characters with row and column, a registry of content kinds (song, sfx,
  sprite, palette from the engine; room from the top-down kit), and errors that always name the file
  and the field (`{ file, path, pointer, code, message, row?, col?, line? }`). All of it is pure.
- **Demo content as data.** `games/demo/game.json` (the manifest) names the rooms (`.json` plus
  `.map.txt` grids), the song, a palette and a hero sprite sheet under `games/demo/content/`. The
  TypeScript left in the demo is glue. The browser gets the files through `import.meta.glob` with
  `?raw`, Node through `readGameFiles`.
- **The CLI** (`pnpm cli`, `engine/tools`). A command registry with Zod schemas for arguments and
  flags, `--json` with exactly one result object on stdout, grouped exit codes (0 ok, 2 usage,
  3 invalid content, 4 failed check, 5 crash), and an output cap (32 KiB) that writes the full
  result to `.ww-out/` and returns `truncated`, `fullOutput` and `omitted`. Commands: `help`,
  `validate`, `run`, `dump`, `screenshot`, `mutants`, `get`, `set`, `add`, `remove`.
- **Headless runs.** The headless contract (`engine/core/headless.ts`: `createGame`, `step`,
  `snapshot`, `canonicalJson`), the kit's world snapshot, and run files with a seed, scripted input,
  tick assertions, invariants and state hashes every N ticks. `tests/runs/run-files.test.ts` plays
  every run file in `games/` twice and compares with its committed golden `.hashes.json`.
- **Replay files.** A failing run writes `.ww-out/replays/<run>-t<tick>-<hash>.run.json`; running it
  fails at the same tick and checks the stored hashes, naming the first mismatching tick.
- **Editing verbs.** `get`, `set`, `add` and `remove` on game manifests, content files, text-grid
  parts and run files, by dotted path or JSON pointer. Every write is schema-checked (refused with
  exit 3, file untouched), written Prettier-clean, read back and reported as `verified`.
- **Checks across files.** A content kind can have a `checkAll` hook that runs over all its files.
  The top-down room kind uses it (`checkDungeon`), so `validate`, `run` and `screenshot` report two
  player starts or a door that leads nowhere as `invalid_dungeon` errors at the room file and map
  line, instead of crashing. The editing verbs do not refuse a write for such errors (joining two
  rooms takes one edit per room); they list them in `crossErrors`.
- **Mutant checks.** `engine/core/rules.ts` names rules; the top-down kit names four
  (`walls-block-movement`, `doors-change-room`, `damage-reduces-hp`, `keys-open-locked-doors`).
  `mutants` plays a run once per rule switched off and lists the rules the run does not guard.
- **Screenshots.** `screenshot <run> --tick N` plays the run in headless Chromium (Playwright 1.63.0,
  pinned) through the game's view module (`view` in `game.json`, `engine/core/view.ts`) and writes a
  256x240 PNG with its sha256; the page's state hash is checked against the headless run.
- **Generated docs.** `pnpm docs:gen` writes `docs/reference/cli.md`, `docs/reference/schemas.md`
  and the generated tables of `docs/CHEATSHEET.md` from the same schemas as the CLI help;
  `pnpm docs:check` (in `pnpm test` and in CI) fails when they are out of date.
- **Skills.** `.claude/skills/scaffold-game/SKILL.md` (a one-room top-down game: manifest, room,
  headless and view entries, browser page, run file with golden hashes, agent docs, then validate,
  run and the four checks) and `.claude/skills/debug-failing-run/SKILL.md` (run, first failing tick,
  dump at that tick and the one before, screenshot, replay, mutants, fix and rerun). Both are linked
  from `llms.txt`, `docs/modules/skills.md` and the cheat sheet.

### Choices made

- **The CLI name** stays `pnpm cli` (run through `tsx`). Agents should use `pnpm -s cli`, since
  without `-s` pnpm prints a banner on stdout before the JSON.
- **The CLI never imports a game.** It reads `game.json` and content with the file system and
  imports the `headless` and `view` modules by path at run time; a test keeps tools free of game
  imports.
- **Exit code 1 is never used**, so a 1 means Node died before the CLI could report.
- **Run-file ticks.** Tick 0 is the starting state and tick `t` the state after `t` steps; a failing
  run stops at the first failing tick and reports every check failing at that tick (`failures`).
- **State hash** is the first 16 hex digits of SHA-256 over canonical JSON (sorted keys);
  `canonicalJson` throws on anything not JSON-safe, naming the path.
- **Screenshots** are served by Vite in middleware mode on a free local port from a tools-only page
  that is not part of the Pages build. Where no browser is installed the command and its tests skip
  cleanly; CI installs Chromium.
- **`.claude/skills/` is committed**, while the rest of `.claude/` stays git-ignored (`.gitignore`
  gained `!.claude/skills/`).
- **The scaffold skill targets the top-down kit** (the only kit so far); its `main.ts` draws through
  the view module, so the browser page, the screenshot and the headless run share one game.

### How to try it

```sh
pnpm -s cli help
pnpm -s cli validate games/demo --json
pnpm -s cli run games/demo/runs/walk-east.run.json --json
pnpm -s cli dump games/demo/runs/walk-east.run.json --tick 100 --json
pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 60 --json
pnpm -s cli mutants games/demo/runs/walk-east.run.json --json
pnpm -s cli get games/demo/content/rooms/courtyard.json music --json
```

### Done when

Each item was checked by running the commands on 2026-11-02 at the commit that closes 0.3.

- **Met.** `pnpm -s cli validate games/demo --json` printed one line (one JSON object, 10 files,
  0 errors) and exited 0. In a copy of the demo with `"at": "x"` in `content/rooms/courtyard.json`
  it exited 3 with one error: `file` `.../content/rooms/courtyard.json`, `path` `at`, `code`
  `invalid_type`.
- **Met.** `pnpm -s cli run games/demo/runs/walk-east.run.json --json` twice in a row: exit 0,
  `passed: true`, the same seven hashes both times (tick 0 `d29e6b40530102ce` ... tick 240
  `257c816edd617516`), equal to the committed `walk-east.hashes.json`, which
  `tests/runs/run-files.test.ts` checks on CI (`pnpm test` in `.github/workflows/ci.yml`).
- **Met.** A copy of the demo run with a wrong assertion (`hero.x` `lt` 150 at tick 60) exited 4
  with `failure.tick` 60 (`hero.x is 202, expected lt 150`) and wrote
  `.ww-out/replays/wrong-t60-7ee52033ce06.run.json`. Running that replay exited 4 at tick 60, with
  `replay.reproduced: true`, `hashesChecked: 3`, `hashMismatch: null`.
- **Met.** `pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 120` twice: both exit 0,
  sha256 `303b20d7559004e80f01d68e53a54efdb060985419c1825070cfa617ee2a0579`, `cmp` found the two PNGs
  byte-identical, and `matchesHeadless: true`.
- **Met.** `set .../content/rooms/courtyard.json music quiet` (in the copy) returned
  `verified: true`, `before` `demo`, `after` `quiet`; the `get` that followed returned `quiet`.
- **Met.** `pnpm -s cli dump games/demo/runs/walk-east.run.json --tick 10 --max-output 300 --json`
  printed `{"truncated":true,"fullOutput":".ww-out/dump-0b2801361285.json",...}`.
- **Met.** Changing one cell of a generated table in `docs/CHEATSHEET.md` made `pnpm docs:check`
  exit 4 naming the file and line; restoring it made it pass. CI runs `pnpm docs:check` and
  `pnpm test` (whose `engine/tools/docs.test.ts` does the same check).
- **Met.** The hand check (below): a fresh agent given only `llms.txt`, the cheat sheet and the
  scaffold skill made a one-room game in `games/` that passed `validate` and `run`.
- The four checks pass: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (55 test files,
  595 tests).
- **Re-checked** after the last two 0.3 commits (checks across files): the four checks pass (55 test
  files, 601 tests), `pnpm docs:check` passes, the demo run file passes with the same hashes as its
  golden file, and the validate, wrong-assertion and replay, screenshot (same sha256 `303b20d7...`),
  set/get and output-cap checks above gave the same results.

### Hand check (scaffold skill)

- **Who:** a fresh Claude Code agent (`claude -p`, Opus 5.5, no earlier context), told to use only
  `llms.txt`, `docs/CHEATSHEET.md` and `.claude/skills/scaffold-game/SKILL.md`, plus files those
  name, and to report every gap.
- **Game made:** `games/hand-check/`: `game.json` (kit `topdown`, `room` only, seed 1, `headless.ts`,
  `view.ts`), `content/rooms/hall.json` (`{ "id": "hall", "at": [0, 0] }`) with an 11x16
  `hall.map.txt` walled room and the player start, `headless.ts`, `view.ts`, `main.ts`, `index.html`,
  `runs/walk-east.run.json` (60 ticks holding right; `hero.room` is `hall` at tick 0, `hero.x` > 112
  at tick 60; `hero.hp` >= 0 and not dead on every tick) with its golden `walk-east.hashes.json`,
  `CLAUDE.md`, `AGENTS.md`, `docs/modules/games-hand-check.md` and its `llms.txt` line.
- **Commands it ran:** `pnpm -s cli validate games/hand-check --json` (exit 0, 3 files, 0 errors);
  `pnpm -s cli run games/hand-check/runs/walk-east.run.json --json` twice (exit 0, `passed: true`,
  the same hashes: tick 0 `a4bfc190c431cd03`, 20 `78ec03124b24edb4`, 40 `67f5db8238a5a094`,
  60 `c13939f08b904962`); `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`; then `pnpm lint`,
  `pnpm typecheck`, `pnpm test` (55 files, 596 tests) and `pnpm build`, all passing. It did not need
  to open any engine or kit source; every snippet worked as written. The orchestrator re-ran
  `validate` (exit 0) and `run` (exit 0, final hash `c13939f08b904962`) on its game.
- **Gaps it reported, and the fixes:** (1) the golden-hash command rewrites every game's hashes, not
  just the new one: the skill now says so and says to check `git status`; (2) `validate` passes
  before the entry modules exist: the skill now says `validate` never opens them and `run` proves
  them; (3) piping through `tail` hides exit codes: the skill now says to read `echo $?` or
  `exitCode`; (4) `.ww-out/` was not explained: the skill now says it is the git-ignored output
  folder. Before the hand check the orchestrator also corrected the hero's walking speed in the
  skill (about 1.5 pixels a tick, found while checking the Done-when items).
- **Afterwards:** the scratch game, its docs page and its `llms.txt` line were deleted; it is not
  kept as a fixture (the demo already covers every file it had).

### Deviations from the roadmap

- **An original demo sprite.** The roadmap moves the demo's rooms, sprites and song into data files;
  the demo had no sprite of its own, so 0.3 added an original hero sprite sheet
  (`games/demo/content/sprites/demo-hero.txt`) and a palette, drawn by the demo, so the sprite kind
  is used by real content.
- **A `palette` content kind and a `view` module.** Neither is named in the roadmap: palettes are
  needed for the sprite, and the view module (`view` in `game.json`) is how `screenshot` draws a game
  without the CLI importing it.
- **A `mutants` command and a `help` command** beyond the commands the roadmap lists; the roadmap
  asks for the mutant mechanism, and `help` is where the generated help is printed.
- **Playwright is a dev dependency** (1.63.0, pinned), and CI installs Chromium for the screenshot
  test.

### Outstanding issues

- The scaffold skill covers only the top-down kit; each new kit (0.5 on) needs its own variant or a
  kit-specific section.
- The kit still draws (`kits/topdown/render.ts`, `hud.ts`), recorded as debt since 0.2; the view
  modules lean on it.
- Mutant checks show the demo's run guards only `doors-change-room`; full adoption is planned for
  Engine 0.5.
- The screenshot test needs Chromium. Locally, a machine without one skips it with a message (CI
  sets `CI` and so requires it), so such a machine does not check screenshot determinism.
- The hand check was run once, by one agent, as the roadmap asks; it is not automated.
- Kit content kinds and rule lists come from a small table in `engine/tools/kits.ts` that only knows
  the top-down kit's default room legend. A game with its own legend will need a kit-level hook.
- Screenshot PNGs are byte-stable on one machine but may differ between machines (the demo's debug
  text uses a system font), so no golden PNG hash is committed.
- MML songs and sfx are JSON only; there is no `.txt` form for them yet.

## Engine 0.2

Restructure and the dependency rule. Built on branch `engine/build-0.15`; not tagged (tagging is the
owner's call).

### What was built

- **Target layout.** `src/` is gone. The engine is in `engine/core`; the renderer split into the
  contract in `engine/core/gfx` and two backends, `engine/backends/canvas2d` (canvas renderer and
  viewport) and `engine/backends/null` (headless renderer). `engine/sim` and `engine/tools` hold only
  their `CLAUDE.md` for now. The kit is in `kits/topdown`, the demo in `games/demo` with its own
  `index.html` and `main.ts`.
- **Multi-page build.** `build/pages.ts` finds every `games/*/index.html` and
  `games/samples/*/index.html`; Vite builds each as its own page plus a root launcher that links to
  every game. `pnpm dev` opens the launcher. Links are relative, so the pages work under `VITE_BASE`.
- **The dependency rule, enforced twice.** `config/layers.js` is the one table of allowed arrows.
  `config/deps.js` checks one arrow; `tests/architecture/dependency-rule.test.ts` scans every import
  in the repo with it, and a local ESLint plugin (`config/eslint-plugin-layers.js`) runs the same
  checker per folder. `tests/architecture/eslint-deps.test.ts` feeds deliberate bad imports
  (`kits/topdown` importing `games/demo`, `engine/sim` importing a backend, and more) to both and
  checks both reject them.
- **The purity rule.** ESLint bans `Math.random`, `Date.now`, `performance.now` and DOM globals in
  `engine/sim`, `kits/` and the pure part of `engine/core`. `tests/architecture/purity.test.ts`
  checks that a `Math.random()` in `kits/` fails lint, and that every core file kits or the sim reach
  at run time is on the pure list.
- **Content audit.** No game content was found in `engine/` or `kits/`.
  `tests/architecture/no-content.test.ts` scans non-test, non-fixture files for songs, MML strings,
  room literals, sprite definitions and text grids, so the rule cannot drift.
- **Pages workflow.** `.github/workflows/pages.yml` runs CI's checks and publishes `dist/` to GitHub
  Pages on a three-part `engine-v*` or `ww-v*` tag (or by hand). Nothing was published during this
  build.
- **Agent docs.** Every new module folder has a `CLAUDE.md`: `engine/core`,
  `engine/backends/canvas2d`, `engine/backends/null`, `engine/sim`, `engine/tools`, `kits/topdown`,
  `games/demo`, plus `build/`.

### Choices made

- **Test files may import `engine/backends/null`.** The one exception to the layer table
  (`EXCEPTIONS` in `config/layers.js`): any `*.test.ts` may run headless through the null backend,
  even in a layer (such as `kits/`) that may not import backends in its own code.
- **The pure-core list.** Rather than make all of `engine/core` pure (it holds the audio output,
  saving and browser input, which need the DOM), `PURE_CORE` in `config/layers.js` lists the core
  files that must stay pure: `rng.ts`, `math/**`, `scene.ts`, the input actions, bindings, manager
  and scripted input, the renderer contract, palette, animation, screen and spritesheet maths, and the
  MML parser. The purity test fails if kits or the sim start reaching a core file not on the list.
- **Aliases.** `@engine/*` points at `engine/*` and `@kits/*` at `kits/*`. The old `@sim` and `@game`
  aliases were dropped, and no alias points into `games/`.
- **Fit maths moved into core.** The pure viewport fit maths moved to `engine/core/gfx/screen.ts`, so
  the touch layout in core does not reach into a backend.
- **Fixtures.** Engine and kit test content lives in `*.test.ts` files or `__fixtures__/` folders;
  anything else under `engine/` or `kits/` that looks like content fails the no-content test.

### How to try it

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm dev                 # opens the launcher at /, which links to games/demo/
pnpm build && pnpm preview   # the production build: / is the launcher, /games/demo/ the demo
```

The architecture tests on their own: `pnpm vitest run tests/architecture`.

### Done when

- **Met.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass (31 test files, 354
  tests). `games/demo` plays as before: the headless demo test passes, and in a browser (`vite
preview` with Playwright) the launcher lists `games/demo/`, the demo draws its room with no console
  errors, and the picture changes when the hero is moved with the arrow keys.
- **Met.** A deliberate bad import fails both ESLint and the dependency test.
  `tests/architecture/eslint-deps.test.ts` feeds `kits/topdown` importing `games/demo` (relative,
  through an alias, and as a bare repo path; as import, re-export and `import()`) and `engine/sim`
  importing a backend to both the shared checker and ESLint, and both reject every one.
- **Met.** A deliberate `Math.random()` in `kits/` fails lint (`tests/architecture/purity.test.ts`,
  which also covers `Date.now`, `performance.now` and DOM globals in `engine/sim`).
- **Met.** `git grep` finds no game content under `engine/` or `kits/` outside test fixtures; the
  only hits for song or MML words are the audio engine's own type names and doc comments.
  `tests/architecture/no-content.test.ts` keeps it that way.

### Deviations from the roadmap

- **Stricter sibling rule.** The roadmap lists arrows between layers only. The build also forbids a
  game, kit or backend from importing a sibling in the same layer (for example one backend importing
  another), because `docs/DESIGN.md` and the folder `CLAUDE.md` files already say "never other games"
  and "never other kits".
- **One exception to the table.** `*.test.ts` files in any layer may import `engine/backends/null`,
  so kit and game tests can run headless. The roadmap's "kits → core" does not mention it.
- **Pure core is a list, not all of core.** Only the parts of `engine/core` that kits and the sim use
  are pure (see Choices made); audio output, saving and browser input stay DOM-based.
- **Extra folders.** `build/` (page discovery and the launcher script) and `config/` (the layer
  table, checker and ESLint plugin) are new top-level tooling folders the roadmap does not name.

### Outstanding issues

- The Pages workflow has never run: no tag was pushed and nothing was published, as the owner asked.
  It will first run on the first release tag.
- The kit still draws (`kits/topdown` `render.ts`, `hud.ts` and the `draw` methods on entities),
  against the "kits never draw" rule. This is known debt, recorded in `kits/topdown/CLAUDE.md`, for a
  later release.
- Some NES colour names in `engine/core/gfx/palette.ts` are themed (`mushroomRed`, `greenPipe`); kept
  as engine data for now.
- The root `CLAUDE.md` was edited by the build (new layout and dependency-table lines); the owner
  should approve that wording.

### Verified (Done when), as first recorded

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass (31 test files, 347 tests).
- `games/demo` plays as before: the headless demo test passes, and in a browser (`vite preview` with
  Playwright) the launcher lists `games/demo/`, the demo draws the courtyard room with no console
  errors, and the hero moves with the arrow keys.
- Deliberate bad imports fail both ESLint and the dependency test; `Math.random()` in `kits/` fails
  lint.
- A `git grep` for content (MML strings, song channels, room or sprite grids) under `engine/` and
  `kits/` finds only the audio engine's own type and channel names, no content.
