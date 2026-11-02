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

| Id  | What | Where | Status | Item |
| --- | ---- | ----- | ------ | ---- |

## Glue review

_Filled in at the close-out (T10)._ Every TypeScript file in `games/samples/mini-siege/` is read
against the rule of thumb above, compared with the same file in `games/samples/rts-skirmish/` and
`games/platformer-test/`: each is content, a skin, thin glue or a test, and anything another game
would write the same way is moved into the engine or a kit, or logged above with a named release.
