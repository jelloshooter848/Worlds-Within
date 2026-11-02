# The mini siege: gap report

The mini siege ([ROADMAP, 0.11 The mini siege](../ROADMAP.md#011-the-mini-siege-multi-genre-sample))
joins the world simulation, the RTS kit, the top-down kit and the mission contract in one small
playable sample, `games/samples/mini-siege/`: an RTS map with a village under attack, a building
going up, and one top-down mission (sabotaging the raiders' siege engines, owner answer 23) that can
be played or delegated. Its point, like the stacking test's ([report](stacking-test.md)), is to find
out what the engine is missing when a real game drives it: **every gap is written down here as it
is found**, whether it is fixed in Engine 0.11 or moved to a named later release.

A gap is anything that needed engine (or kit) code changes, anything awkward, or anything the game
had to do itself that should have been the engine's or a kit's job. The rule of thumb is
DESIGN.md's: **if two games could use it, it is engine; if it is content, it is the game.** The game
folder should hold only content, skins and thin glue; the scenario, the map and the mission are
data files, not code.

The decisions this release was built against (items 172-184) are in
[BUILD-LOG.md, Engine 0.11, Decisions](../BUILD-LOG.md#decisions). The stacking-test gaps assigned
to 0.11 (G13, G18, G19 the rest, G27, G28, G30) are tracked in the stacking test's report, not here.

## Summary

_Filled in at the close-out (T10)._

## Format

Each gap has one row, in the order found; ids are `M1`, `M2`, ... and are never reused or
renumbered (item 184), so they do not mix with the stacking test's `G` ids.

- **Id:** `M1`, `M2`, ...
- **What:** what was found, in a sentence or two.
- **Where:** the file or module it was found in (and the one that should own it).
- **Status:** `open (0.11 Tn)` while planned for a task of this release; `fixed in 0.11 Tn
(<commit>)` once done; or `moved to <release>` (0.12, 0.13, 0.14, 0.15, ...) with the reason.
- **Item:** when the owner must decide, the feedback item number (`docs/FEEDBACK-LOG.md`).

## Gaps

| Id  | What                                                                                                                                                                                                                                                                                                                                                                                                                            | Where                                                         | Status                                                                                                                                                                        | Item |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| M1  | The shell's audio (G27, T3) takes the player's `volumes` from the game, but nothing in the engine stores them or shows a mute or volume control: `engine/core/save/settings.ts` holds only defaults, so a page that wants a mute button writes it and its storage itself over `booted.audio`.                                                                                                                                   | `engine/core/shell/boot.ts`, `engine/core/save/settings.ts`   | moved to 0.15 (the sample set: every sample page gets the same settings; the mini siege plays at the default volumes)                                                         |      |
| M2  | A skin's `byTag` look (G30, T4) matches one whole tag: no prefix or value match, so the RTS kit's `progress:<n>` tag on a building under construction cannot pick a look per stage (a frame per value, or the `site` state's cycle, is all a skin has), and no look for two tags at once (a burnt and frozen siege engine takes the first look listed).                                                                         | `engine/core/present/skin.ts` (`byTag`, `resolveSkinKind`)    | moved to 0.15 (the sample set: the mini siege shows its site with one `site` look and lists `burnt` before `frozen`; a stage-by-progress look waits for a game that needs it) |      |
| M3  | A game run's tools could not see a played round: the run reports `experience` and refusals, but the round's ticks live in the game. `HeadlessGame` got the optional `mission(step)` returning a structured refusal `{ code, error }` (not a string, so `refusedMissions` keeps the sim's codes) and `missionExperience()` for the run's `experience`.                                                                           | `engine/core/headless.ts`, `engine/tools/headless-run.ts`     | fixed in 0.11 T5 (`39e6161`)                                                                                                                                                  |      |
| M4  | A played round's ticks are not written to the world (`addExperience`), so a played record's `experienceTicks` is 0 and only the run result's `experience` says how long the round took. Writing them would make the played world differ from a world run with the same outcome in that one number (item 166), against decision 3's cross-check, and the 0.10 world runs (which never write them) would disagree with game runs. | `engine/core/mission-host.ts`, `engine/sim/mission-port.ts`   | moved to 0.15 (the sample set: decide once whether experience ticks belong in the hashed record, for world and game runs together)                                            |      |
| M5  | A hosted round whose end the adapter cannot map (`unmappable_report`, `unknown_outcome`) is refused on the tick it ends, after the `play` step was taken: the refusal is in that tick's snapshot (`missions.round.refused`) but not in the run's `refusedMissions`, and the mission is then delegated at its commit tick (`timeout`). A run file has to assert on the snapshot to see it.                                       | `engine/core/mission-host.ts`, `engine/tools/headless-run.ts` | moved to 0.15 (the sample set: a channel for refusals that arrive after their step, if a second game needs it; the mini siege's adapter maps every report)                    |      |
| M6  | `HostScene` draws a hosted mission round through the host's own drawer (the scene's `world` is the `MissionHost`), so the page's picture must switch to the round's frame and skin itself while `miniGame()` is not null; the platformer's rounds are drawn stacked in the level's frame instead.                                                                                                                               | `engine/core/shell/host-scene.ts`, the game's picture         | open (0.11 T9: the mini siege's page shows the round; move a round picture into the shell if the glue repeats what the platformer games do)                                   |      |
| M7  | `RtsGame` caches its view until the next order or step, so a mission opened through the game's `MissionHost` between steps (its opportunity taken, its event frozen) was not seen by `view()` until the next tick: the page would have shown the offer and no frozen units for the rest of that tick. `RtsGame.refresh()` drops the cache; the glue calls it after a launch (the host does not know the kit's game).            | `kits/rts/game.ts`, the game's glue                           | fixed in 0.11 T6 (`e719108`)                                                                                                                                                  |      |
| M8  | Item 175's kit rule `launch-needs-offer` was not added: the sim already refuses opening a mission whose opportunity is not offered (`opportunity_closed`), so with the kit's check switched off only the refusal's code would change, never the world, and no run file could guard the rule. The kit still refuses a not-offered launch itself (`not_offered`, without asking the host) so the page can grey its button.        | `kits/rts/commands.ts` (`missionRequest`, `launchMission`)    | fixed in 0.11 T6 (`e719108`; no rule, revisit if a game launches missions the sim does not gate)                                                                              |      |

## Glue review

_Filled in at the close-out (T10)._ Every TypeScript file in `games/samples/mini-siege/` is read
against the rule of thumb above, compared with the same file in `games/samples/rts-skirmish/` and
`games/platformer-test/`: each is content, a skin, thin glue or a test, and anything another game
would write the same way is moved into the engine or a kit, or logged above with a named release.
