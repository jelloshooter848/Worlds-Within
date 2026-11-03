# The tower-defense kit: lessons report

Engine 0.12 ([ROADMAP, 0.12 Tower-defense kit](../ROADMAP.md#012-tower-defense-kit-the-platform-test))
adds a new genre, `kits/towerdefense`, a standalone sample, `games/samples/tower-defense/`, and a
small tower-defense preparation phase in the mini siege: towers placed on the real walls with real
gold, fighting a wave of the real raiders, with the losses written back to the world.

## Purpose

This is **the platform test**: a new mode added to an existing game with **no change to
`engine/sim`**. Every change the new mode does need (in `engine/core`, `engine/tools`, a backend, the
mission contract, another kit or the mini siege's glue) is written down here as it is found, as a
lesson for the mission API before that API is fixed at 1.0. A change `engine/sim` would need is
not made in 0.12 unless there is no other way, and then it is justified here and in the release
notes. The close-out records the empty `git diff` of `engine/sim` against the release's base
commit, `d6a102ab66f62c80e906ac979ece026dd781c415` (item 206).

The decisions this release is built against (items 197-206) are in
[BUILD-LOG.md, Engine 0.12, Decisions](../BUILD-LOG.md#decisions).

**No earlier gap is assigned to 0.12.** Neither the [stacking-test report](stacking-test.md) nor
the [mini-siege report](mini-siege.md) moves any gap to 0.12: every `G` and `M` gap is fixed or
moved to 0.13, 0.14 or 0.15, and the only "0.12" in `mini-siege.md` is its format's line listing
the releases a status may name. So this report starts empty, and the close-out (T9) confirms that
is still so.

**A lesson expected from the start:** a mission outcome's effects carry fixed amounts, so the gold
a round spent can only be written back as the amount the matching outcome declares (bucketed
outcomes), not the amount the round reports (item 201). If the build hits it, it gets a row here.

## Format

Each lesson has one row, in the order found; ids are `D1`, `D2`, ... (D for defence) and are never
reused or renumbered (item 205), so they do not mix with task ids (`T1`, ...) or the stacking test's
`G` and the mini siege's `M` ids.

- **Id:** `D1`, `D2`, ...
- **What:** what the new mode needed, or what was awkward, in a sentence or two.
- **Where:** the file or module it was found in (and the one that should own it).
- **Sim:** whether `engine/sim` needed it (`no`, or `yes` with why it could not go elsewhere).
- **Status:** `fixed in 0.12 Tn (<commit>)`; `moved to <release>` (0.13, 0.14, 0.15, ...) with the
  reason; or `lesson for the 1.0 mission API` (recorded for the API review, not changed now).

## Lessons

| Id  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Where                                                                                                         | Sim | Status                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --- | ------------------------------ |
| D1  | A pointer tap on the page is not frame input, so decision 3's "replays stay frame input only" holds for keys and pads but not for taps: a round played by tapping cannot be written as a `ScriptedInput` run file, nor recorded as a mission's `play` input. The kit turns a tap into the same cursor move, place and sell commands (`TdControls.tap`), so the round's rules see one kind of command; only the recording is missing. A recorded command (`order(json)`) or a pointer track in `ScriptedInput` would close it.                                                                                                                                                | `kits/towerdefense/controls.ts`, `engine/core/input/scripted-input.ts`, `engine/core/headless.ts`             | no  | lesson for the 1.0 mission API |
| D2  | The shell steps a scene once per loop step (60 a second) and hands it that step's input, so a page that plays its game slower (the sample plays 30 ticks a second, so its fast runners can be followed) merges the input of the steps between two ticks itself, or a press on a step without a tick is lost. The sample's `TickInput` (`play.ts`) counts an action pressed on any step since the last tick as pressed and held on the tick. A tick rate in the shell (or a merging `InputFrame` in core, as the RTS pages would also use) would make this a setting; a hosted round (T6) plays at the loop's rate today.                                                     | `games/samples/tower-defense/play.ts`, `engine/core/shell/boot.ts`, `engine/core/input/input-manager.ts`      | no  | lesson for the 1.0 mission API |
| D3  | **The gold a round spent is written back only as the declared step** (the lesson expected from the start, item 201). An outcome's `inventory` effect carries a fixed `add`, so the `td-defence` mission buckets the spending with `spentAtMost` rules (`held-cheap` at most 25 gold takes 25, `held` takes 40): a round that spent 35 maps to `held` and the world loses 40 (`tests/kits/td-mission.test.ts`). The real amount reaches the record's `stats` (`spent`) but never the world. An effect amount taken from the report (`"add": { "stat": "spent", "negate": true }`), checked against a declared limit, would close it.                                          | `kits/towerdefense/mission-defence.ts`, `engine/core/missions.ts` (effects), `engine/sim/mission.ts` (commit) | no  | lesson for the 1.0 mission API |
| D4  | **Losses are fixed per outcome too.** Which walls fell (`fallen`), which raiders were killed (`killed`) and how many leaked are in the report, but an outcome's `damage` and `destroy` effects name fixed entities and amounts, so the world can only take the losses a declared outcome lists. Covering each subset of fallen walls or killed raiders needs one outcome per subset (combinatorial: two walls and three raiders is already 32), so the fixture's `breached` damages both walls by fixed amounts whatever fell. A per-entity effect driven by a report list (`destroy` each of `stats.killed`, checked against the round's selected entities) would close it. | `kits/towerdefense/mission-defence.ts`, `engine/core/missions.ts`                                             | no  | lesson for the 1.0 mission API |
| D5  | **The round has no wall damage, so "walls lost" is the report's reading of the round:** each leak brings down the build cell nearest the exit not already fallen. It is not a `TOWERDEFENSE_RULES` rule (the kit is strict, so a new rule needs a sample run file guarding it, and the standalone sample has no walls), so mutants cannot switch it off and a mission cannot choose another reading. If the mini siege needs walls that take damage in the round, it is a kit rule with its own run file.                                                                                                                                                                    | `kits/towerdefense/mission-defence.ts`                                                                        | no  | lesson for the 1.0 mission API |
| D6  | **World names are only the keys an outcome's effects name.** The open mission's `refs` (in the snapshot's `Missions`) hold just the scenario keys its effects use, so a `keys` selector or a `killed` rule can name an entity by key only if some effect names it too, else by its id (as `mission-room` found in 0.11). Opening a mission with the keys its params name as well (or the whole key table) would let params name any entity by key.                                                                                                                                                                                                                           | `kits/towerdefense/mission-defence.ts`, `engine/sim/mission.ts` (`openMission` refs)                          | no  | lesson for the 1.0 mission API |
| D7  | **`validate` cannot check selectors against the world.** `checkUse` sees the params and the mission, not the scenario, so a `build` or `wave` selector that picks nothing, a budget faction with no `Stockpile` or more walls than build cells is found only when the round opens (`bad_mission_input`), not by `pnpm cli validate`. A `checkUse` given the game's world scenarios (or a `validate` pass that opens each mission on each scenario) would catch them.                                                                                                                                                                                                         | `kits/towerdefense/mission-defence.ts`, `engine/core/minigame-params.ts`, `engine/tools/mini-game-check.ts`   | no  | lesson for the 1.0 mission API |
| D8  | **A mission's `td-map` still names a `td-waves` file** (the kind's `checkAll`, `unknown_waves`), though the `td-defence` round builds its one wave from the world's units: a game needs a wave list that only a standalone round of that map would play. A kit matter (an optional `waves` on maps used only by missions), not the mission API's; recorded so T7 knows.                                                                                                                                                                                                                                                                                                      | `kits/towerdefense/schema.ts`                                                                                 | no  | lesson for the 1.0 mission API |

T6 (the `td-defence` mini game and `towerdefenseMissionAdapter`) needed **no change to `engine/core`,
`engine/tools`, a backend or `engine/sim`**: the mini game contract (`paramsSchema`, `checkUse`,
`inputMap`, `hostStatus`, `report()`), `snapshotEntities`, `playMissionRound`, `MissionHost` and
`KitDef.paramsDocs` from 0.10 and 0.11 were enough. D3 to D8 are what the mission API made awkward.
