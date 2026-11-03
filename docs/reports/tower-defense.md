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

| Id  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Where                                                                                             | Sim | Status                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --- | ------------------------------ |
| D1  | A pointer tap on the page is not frame input, so decision 3's "replays stay frame input only" holds for keys and pads but not for taps: a round played by tapping cannot be written as a `ScriptedInput` run file, nor recorded as a mission's `play` input. The kit turns a tap into the same cursor move, place and sell commands (`TdControls.tap`), so the round's rules see one kind of command; only the recording is missing. A recorded command (`order(json)`) or a pointer track in `ScriptedInput` would close it. | `kits/towerdefense/controls.ts`, `engine/core/input/scripted-input.ts`, `engine/core/headless.ts` | no  | lesson for the 1.0 mission API |
