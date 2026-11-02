---
name: debug-failing-run
description: Go from a failing `pnpm cli run` (exit 4, or a red tests/runs test) to its cause and a fix - read the first failing tick, dump the state there and the tick before, screenshot it, check the replay reproduces, use mutant checks to see what the run guards, then fix and rerun. Use when a run file, replay file or golden-hash test fails.
---

# Debug a failing run

Every run is repeatable from its seed, so a failure always comes back the same way: work from the
tools' output, not from guesses. Run everything from the repo root as `pnpm -s cli ... --json`
(stdout is then exactly one JSON object). Background: the run-file and CLI sections of the
[cheat sheet](../../../docs/CHEATSHEET.md) and `docs/reference/cli.md`.

## 1. Run it and read the first failing tick

```sh
pnpm -s cli run games/<game>/runs/<run>.run.json --json
```

- Exit 0: it passes. If a test still fails, it is the golden hashes (step 7).
- Exit 2: a usage mistake (path, flag). Exit 3: invalid content: fix each `errors[]` entry (it names
  `file` and the field `path`), check with `pnpm -s cli validate games/<game> --json`, then rerun.
- Exit 5: a crash. Read `error.message` and `error.stack`; it is a bug in the game's
  `headless.ts`, the kit or the engine, not in the run file.
- Exit 4: a check failed. The result holds:
  - `failure`: the **first failing tick** and check: `tick`, `kind` (`assertion` or `invariant`),
    `index` (which entry of that list), `path`, `op`, `expected`, `actual`, `message`;
  - `failures`: every check that failed at that same tick (the run stops there);
  - `hashes`: the state hashes up to that tick;
  - `replayFile`: a replay file in `.ww-out/replays/` that reproduces the failure.

Write down `T = failure.tick`. Everything below looks at ticks `T` and `T - 1`.

## 2. Dump the state at the failing tick and the tick before

```sh
pnpm -s cli dump games/<game>/runs/<run>.run.json --tick <T-1> --json
pnpm -s cli dump games/<game>/runs/<run>.run.json --tick <T> --json
```

`state` is the whole snapshot (the same object the checks' dotted paths read). Compare the two:
what changed in the one step between them (`hero`, `room`, `entities`, `events`)? `events` lists
what the last step emitted (a room change, a hit, a pickup). For an assertion at a late tick, also
dump a few earlier ticks to find when the state first went the wrong way; tick 0 is the start, before
any step. A dump is capped like any output: if `truncated` is true, read the file in `fullOutput`.

## 3. Look at it

```sh
pnpm -s cli screenshot games/<game>/runs/<run>.run.json --tick <T> --json
```

Writes a PNG (`path` in the result; default `.ww-out/screenshots/<run>-t<tick>.png`) of the paused,
seeded frame, and checks its state hash against the headless run (`matchesHeadless: true`). Open the PNG to see where the
hero, walls and enemies really are. Needs the game's `view` entry and Chromium; without a browser it
exits with a clear error, and steps 1, 2 and 4 are enough on their own.

## 4. Check the replay reproduces it

```sh
pnpm -s cli run <replayFile> --json
```

The replay is the run file plus the failure and hashes it saw. Its result has
`replay.reproduced: true` and `replay.hashMismatch: null` when the failure comes back at the same
tick with the same state. If `reproduced` is false or `hashMismatch` names a tick, the run is not
deterministic: look for `Math.random`, the clock, `Map`/`Set` iteration in a snapshot, or state kept
between runs (module-level variables) in the game or kit. Fix that first: nothing else can be trusted
until two runs agree.

## 5. Decide what is wrong

- **The check is wrong** (the game does what it should; the run file expected something else): fix
  the assertion's `tick`, `path`, `op` or `value`, using the dumped values. Do not just copy `actual`
  into `value` without being sure the game is right.
- **The input is wrong** (the hero never reached the place): change `input.steps` (`frame`, `hold`)
  or `ticks`; dump to see where the hero is.
- **The content is wrong** (a wall in the way, a missing door): edit the content file with the
  editing verbs, which schema-check and read back every write:
  `pnpm -s cli get <file> <path> --json`, then `pnpm -s cli set <file> <path> <value> --json` and
  check `verified: true`. Then `validate` the game.
- **The code is wrong** (the kit or game breaks a rule): fix it in the kit or game and add or
  extend a unit test there.

## 6. Mutant checks: does the run guard what it should?

```sh
pnpm -s cli mutants games/<game>/runs/<run>.run.json --json
```

Plays the run once per kit rule switched off. `guarded` lists the rules whose loss makes the run
fail; `weak` lists the rules it is expected to guard and does not notice: the run file's `guards`
when it gives them, else every rule. If your fix was to a rule (say `doors-change-room`), it
should be in `guarded`; if it is in `weak`, add an assertion that would catch it. To reproduce one
mutant: `pnpm -s cli run <run-file> --disable-rule <id> --json`.

A kit whose hook says `strictMutants: true` makes a weak rule fail the command (exit 4, `strict:
true` in the result); other kits (topdown) only report it (exit 0). For a strict kit, give each run
file the `guards` it is meant for, and check the game as a whole:

```sh
pnpm -s cli mutants games/<game> --json
```

That plays every run file of the game; `rules[].guardedBy` lists the run files that guard each
rule and `unguarded` the rules none does (exit 4 for a strict kit), and a run whose own `guards`
are not all guarded has them in its `runs[].weak` (also exit 4). Fix an unguarded rule by
strengthening a run file or adding one that the rule decides.

## 7. Fix, rerun, and keep the golden hashes honest

```sh
pnpm -s cli run games/<game>/runs/<run>.run.json --json   # exit 0
pnpm -s cli run games/<game>/runs/<run>.run.json --json   # same hashes again
```

`tests/runs/run-files.test.ts` compares every run file's hashes with its committed
`<run>.hashes.json`. If the fix was meant to change the game's state, regenerate them with
`WW_UPDATE_GOLDEN=1 pnpm test tests/runs` and commit them with the fix. If the state was not meant
to change and the hashes did, the fix changed more than intended: go back to step 2.

Finish with `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Don'ts

- Don't delete or weaken a failing assertion to make a run pass; find out why it fails.
- Don't regenerate golden hashes to hide a change you can't explain.
- Don't edit replay files in `.ww-out/`: they are output, rewritten on every failing run. Copy one
  into `games/<game>/runs/` (removing its `replay` field) only if it should become a permanent run.
