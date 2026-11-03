# Build log

This is the log of the autonomous build of Engine 0.2–0.15 on branch `engine/build-0.15`, for the
owner's review. Nothing in it is merged to `master`, tagged or published.

What each engine release built and the choices made along the way, newest first. The plan for each
release is in [ROADMAP.md](ROADMAP.md); this file records what actually happened, so the owner can
review the choices.

## Engine 0.15

The sample set. Built on branch `engine/build-0.15`; not tagged (no tags during the build, owner
answer 24). As in 0.9 to 0.14, the open questions were settled in writing before any code (T1);
the later tasks build against them. The release's goal is the roadmap's: **every gameplay kit has
a small, finished sample game, ready for 1.0**: the demo grows into `games/samples/dungeon/`, the
stacking test's game into `games/samples/platformer/`, the RTS skirmish and the tower-defense
sample are finished, and a review of every kit and module API is written up, with each change it
calls for made in 0.15 or listed for 1.0. The base commit for the golden-hash and `engine/sim`
checks is `235899cf27115e6053fba368c143824ea95077ab` (`235899c`), the head when T1 started: every
hash that moves and every `engine/sim` change is measured against it. Unlike 0.14, **some golden
hashes move in 0.15**, but only in the tasks decision 2 names, each for the reason it gives, and
each logged in that task's commit and entry below.

**Gaps assigned to 0.15 from earlier reports** (the roadmap's list, 38 in all): from
[docs/reports/stacking-test.md](reports/stacking-test.md), **G17**, **G33** and **G36**; from
[docs/reports/mini-siege.md](reports/mini-siege.md), **M1**, **M2**, **M4**, **M5**, **M6** (the
rest), **M10**, **M11** (the rest), **M12**, **M16**, **M17**, **M18**, **M20**, **M21**, **M25**,
**M26**, **M27**, **M28**, **M31**, **M32**, **M34**, **M35**, **M36** and **M38**; from
[docs/reports/tower-defense.md](reports/tower-defense.md), **D1**, **D2**, **D3**, **D4**, **D6**,
**D7**, **D8**, **D9**, **D10**, **D12**, **D13** and **D14**. **D5** and **D11** are not 0.15
work: the roadmap lists them under Engine 1.0, written down in the v1 docs as the API's rule and
not changed (decision 14). Every one of the 38 is settled by a decision below and built in the
task named there; **none is left unbuilt**. Where a decision builds only one of the shapes a gap
offered, the other is rejected, not deferred, and where a gap names a smaller extra that is not
built, it says so and moves it to 1.0 explicitly (decision 3's two-tag look is the only one). A
new gap found during 0.15 is logged in the report of the game it was seen in, continuing that
report's ids (the stacking test's from G37, the mini siege's from M39, the tower-defense lessons'
from D15), or in a new report for a sample that has none.

### What was built

- **Decisions before code** (T1, this commit): the folder moves, which tasks may move golden
  hashes, and the shapes of all 38 gaps, settled in writing (items 278-291, below), and the
  planned task list. No code changed.
- **Skin background and tag prefix looks** (T3, decision 3): G36 and M2 fixed. Skins gain an
  optional `background` (`skinBackground`, `DEFAULT_BACKGROUND` black); `SkinnedCanvasPresenter`,
  `ThreeScene` and `ThreePresenter` clear to it (a `background` option still overrides, kept for
  callers that need it), so each skin of a skin set clears to its own and hosted rounds stay black.
  The `SKY` constants left the platformer sample and the lab (`#5c94fc` in their `canvas2d` and
  `three` skins), and the same was done for the RTS skirmish, tower-defense and mini siege grass
  (`#00a800` in their main skins; no `BACKGROUND` constant or look `background` field left). A
  `byTag` look matches by `tag` or `prefix` with optional inclusive `min`/`max` (`skinTagMatches`;
  `bad_tag_look` for both, neither, a range without a prefix or `min` above `max`); first match in
  file order wins. The RTS skirmish's barracks draw a new `site-2x2-half` frame from
  `progress:50`. No golden hash moved; no screenshot changed except a barracks site past half
  way, which no committed screenshot shows.
- **Shell input and settings** (T5, decisions 5 and 6): M1, D1, D2, D12 and D13 fixed. The
  player's volumes are stored per game (`save/settings.ts`, `ww:<game>:volumes`) and the shell
  draws its own mute button and volume slider (`shell/volume-control.ts`; `bootBrowserGame`'s
  `game` and `volumeControl`), on all five sample pages (the dungeon calls `mountVolumeControl`
  from its own loop; the RTS skirmish passes `audio: {}` until T14 gives it sounds). Taps are frame
  input (`InputFrame.taps`, `ScriptedInput`'s and run files' `input.taps`, recorded by
  `InputRecorder` and `MissionHost`, passed into hosted rounds by `RoundInput`); the
  tower-defense kit reads them in `TdGame.step` (`size` option), and
  `games/samples/tower-defense/runs/tapped.run.json` wins a round by taps. `Scene.tickRate`
  paces a scene in `SceneStack` with `MergedInput` (the sample's `TickInput` moved into core);
  page buttons press through `InputManager.press`. `screenAtCell` (the kit) and
  `BrowserDisplay.toClient` (Canvas2D's `Viewport.toClient`; the boot's canvas-box mapping for 3D)
  and `window.__ww.toClient` replace the pages' `pictureToClient` and the mini siege's
  `clientAt`, `roundTap` and `defenceRound`. Choices: D12 needed no `MiniGame.tap` (decision 6);
  the mini siege keeps its own battle counter, since a scene stepped only on its ticks would drop
  the pointer gestures of the steps between (its rounds already step every loop step); the 3D
  display's `toClient` is the boot's fallback rather than a change in `threeDisplay`. No golden
  hash moved.
- **The mission hosting API** (T6, decision 7): M6, M18, M21, D9 and M27 fixed. `MissionHost`
  puts its own events after the hosted game's on `events`, per step (`mission-open`,
  `mini-game-end` with `mission`, `game` and `result`, `mission-commit` with `outcome` and
  `resolution` from the port's new optional `records()`, which `missionPort` fills; a step taken
  between steps is in the next step's events; `missionHostEvents` picks them out), and
  `roundFrame()` is the hosted round's frame with `status.miniGame` set (D9).
  `engine/core/present/hosted.ts`'s `hostedSource(main, { round, events? })` is the one round
  picture (M6). `MissionHostOptions` gains `canOpen(id)` and `onChange()`, and the RTS kit's
  `rtsMissionHooks(game)` gives both for an `RtsGame` (M18). `engine/sim`'s `rtsWorldPort(world)`
  (`rts-port.ts`, typed by shape as `RtsPort`; `tests/kits/rts-sim.test.ts` checks it against the
  kit's `RtsWorldPort` both ways) replaces the copies in both samples and the kit tests (M27).
  The mini siege's `MiniSiegeGame` now extends `MissionHost` (its world is `sim`), its frame diff
  and battle-or-round switch are gone (`siegeSource` is `hostedSource` over the kit's
  `presentWorld`), and its page and view hand the host's events to the picture. Choices: the
  "run file check of an event" is `tests/runs/mission-events.test.ts`, which plays `played` and
  `delegated` through the tools' run loop (`playRun` with `prepare` and `onTick`) and checks the
  events' game ticks with the golden hashes, rather than a new run-file path into data that is
  never in the snapshot; `canOpen` is asked before the host's own checks, so every refusal code
  the old wrapper gave stays the same (a direct `open` of a committed rescue is now `not_offered`,
  and the test reads the sim's `mission_committed` through the port); `onChange` is also called
  when a round's end resolves its mission; `MissionHost.playing` stays for the page's key hints
  (D14 is T10's). No layer arrow changed and no golden hash moved.
- **Mission data by scenario key** (T7, decision 8): M10, D6, M17, M28, M25, M16, D10, D7 and D8
  fixed. `engine/sim/keys.ts`: `worldKeys(world)`, every scenario key and its entity id, kept
  beside the world by `worldFromScenario` and `loadWorld` (the save's optional `keys`; an old save
  loads with none), never in the snapshot. `missionPort(world)` opens missions with the table as
  `refs` (the open mission's hashed `refs` stay the keys its effects name) and hands the whole
  table to the round (`open`'s `keys`, `keys()`); `MissionAdapter.input(snapshot, mission, keys?)`
  takes it (M10, D6), and `missionRecords(world)`, `MissionHost.records()` and
  `MissionHost.worldKeys()` read the world through the sim and the port (M28; the mini siege's own
  `records()` is gone). Run checks name entities by key (M17): `world.key.<key>...`,
  `world.id.<n>...` and `world.one.<Kind>...` inside any world snapshot (`check-values.ts`, through
  the optional `HeadlessGame.worldKeys()`, which `MissionHost` and `SkirmishGame` give, or a world
  run's scenario keys), a key the table lacks being `no_key` at the check's path (exit 3); every
  mini siege run file and the RTS skirmish's `commands` were rewritten to them (no `named.` or
  `world.components.<Kind>.<i>` path is left in `games/samples/**/runs`; `engine/sim`'s fixtures
  keep theirs). A mission file's optional `marker` is a scenario key the RTS kit resolves through
  `presentWorld`'s `keys` (`RtsMissionInfo.marker` takes an id or a key; `rtsMissionInfo`), and
  the mini siege's picture passes the host's `worldKeys()` (M25; its `sabotage` adopts `marker` in
  T9). `mission-room` gains `select.squad` (a squad's key or id; M16), and `td-defence`
  `build.cells: [{ entity, cell: { x, y } }]` (D10). `validate` builds the game's world scenarios
  (`worldScenarios`, every `worlds-within/scenario` content file at tick 0) and hands each
  mission's `checkUse` the ones whose opportunities offer it (`MiniGameUseCheck.scenarios`), so
  both kits report a selector that picks nothing, a key, squad or rule name the scenario lacks, a
  budget with no stockpile and more walls than cells at the mission's field (D7). A `td-map`'s
  `waves` is optional for a map only `td-defence` missions play (`no_waves` for one no mission
  names; `tdRound` refuses it), and the mini siege's walls map dropped its unplayed wave list and
  the `td-waves` kind (D8). Choices: the field D10 calls `slot` is `build.cells`, because
  `build.slot` already names the slot character; a record's names stay the open mission's ref or
  the id (a foe's or wall's other table key rides along as `key` in the round's input and report,
  never in a record or snapshot), so the keys widen what params may name without moving a record;
  `world.one` and `world.id` were added beside `world.key` because the world-level `Missions`,
  `WorldTime` and `Opportunities` and the skirmish's trained units have no scenario key; `no_waves`
  is judged by whether a `td-defence` mission names the map, since a kind's `checkAll` cannot see
  the manifest's `kit`; a mission no scenario's opportunities offer gets no world check. **No
  golden hash moved** (every run file passes with its golden hashes; keeping the table moves no
  snapshot), and no layer arrow changed.
- **Commit and campaign rules** (T8, decision 9): D3, D4, M4, M5, M31, M35 and M38 fixed.
  **D3, D4**: the `inventory` effect takes `fromReport` with `negate` and a declared `max`;
  `damage`'s `fromReport` takes `max`; `damage` and `destroy` gain the per-entity form `each` (a
  report stat listing entity names: keys of the open mission's `refs` or the world's key table, or
  ids), with the declared `entities` for a mission that was not played and the limits `owner` and
  `max`. `engine/sim`'s `playMission` checks the limits when a played result resolves
  (`reportOverLimit`): a stat over its `max`, a list longer than its `max` or naming an entity not
  alive and owned by `owner` is refused `report_over_limit`, never clamped, and the mission is
  delegated at its commit (`timeout`) with the declared amounts (`engine/sim/mission-report.test.ts`).
  The mini siege's `fortify` adopted both: its gold is the round's `spent` (max 100, the budget's
  cap), its raiders the round's `killed` (owner `raiders`, max 4) and its walls the round's
  `fallen` (owner `village`). **M4**: experience ticks stay out of the hashed record (the rule
  since item 166, now written in `engine/sim/CLAUDE.md` and tested through `MissionHost`).
  **M5**: `MissionHost.lateRefusals(sinceTick)` and the optional
  `HeadlessGame.lateRefusals?` keep a round's end the world refused after its step
  (`LateMissionRefusal`); the tools list each in `refusedMissions` at the tick it came with
  `late: true`. **M31**: `carriedRecord` carries a gone stockpile as zeros; a campaign entry's
  `endIf: { gone: key }` (checked against the scenario's keys, `unknown_key`) ends the campaign
  when `advanceCampaign`'s new `gone` says so (the sim's `keyAlive`), the save records `ended` and
  carries nothing, and `campaignRun` is `done`; the mini siege's siege entry has
  `endIf: { gone: "hall" }` and its `campaignSave()` lost its own stockpile check. **M35**:
  `entryOver(entry, { worldTick, missionsOpen })` in `engine/core/campaign.ts`;
  `MiniSiegeGame.entryOver()` reads it, and so do its page (`SiegePlay.update`) and its
  `campaignSave()` (null until the entry is over). **M38**: save code version 2 writes the campaign
  and each mission as `saveCodeId(id)` (12 bits of a CRC-16 of the id) and one `ended` bit;
  version 1 codes are still read (`encodeSaveCode(..., { version: 1 })` still writes one), and
  `validate` refuses two missions or campaigns sharing a code (`code_collision`, the mission
  kind's new `checkAll` and `checkCampaigns`); a test adds a mission file with an id sorting first
  and shows every code unchanged (it moved a v1 code). Choices: `each` without a report applies
  the declared `entities` (none: nothing); an `each` name that stands for no entity is left out
  unless `owner` is given (then it is over the limit); limits are checked against the world when
  the result resolves, not at the commit; `endIf` was put on the siege's entry only (as before,
  the dawn's hall falling still moves on to the ridge, which carries nothing); scenarios are not
  written in a code of either version, so only campaigns and missions get id codes; save codes
  grew by about three characters (a two-scenario save fits 31, the 40-character budget holds);
  `dawn-code` keeps `quit`'s version 1 code as the proof that v1 codes still read.
  **Moved (decision 2), regenerated with the repo's tools** (`pnpm cli remove`/`run`/`add` for the
  run files' sync `hashes`, `WW_UPDATE_GOLDEN=1 pnpm test tests/runs` for the golden files, `pnpm
cli code` and `pnpm cli set` for the pinned codes): `fortify-played` (`.run.json` sync hashes
  and `.hashes.json`, final `0b43372f77faea35` to `c758b3283ab59e88`) and `fortify-delegated`
  (final `302436d18dc3917d` to `bd8f76744d63c45e`), both from tick 20, because `fortify`'s def
  (hashed while open, and its effects in the committed record) changed; no assertion changed.
  Pinned codes (save code v2): `played` `2H120-1P1T8-0G01J-FJFCJ-2A00` to
  `5EWCD-P0DGB-90200-69Y9X-J8820-00`, `delegated` `3YEP0-1P1T8-0G01Y-DJFCJ-2A2G` to
  `4BRDD-P0DGB-90200-7SP9X-J8820-2G`, `quit` `2VFP0-1P1T8-0M32N-PBJFC-J2A70` to
  `4DWHD-P0DGB-902GC-APSE9-XJ882-070`, `dawn-fresh` `2PHJ0-2P100-0` to `4WXFD-P0NG8-00`. No other
  golden hash, sim golden or world-run golden moved; no layer arrow changed.
- **Hash-moving fixes** (T9, decisions 2 and 10): M12 and M20 fixed, and the mini siege's two
  snapshot changes decision 8 held for this task made with them, so its hashes moved once.
  **M12:** `engine/sim/__fixtures__/raid.mission.json` is a real `mission-room` mission (`play:
"mission-room"`, the params that were `tests/kits/__fixtures__/raid.params.json` inlined; that
  file is gone), and `tests/kits/mission-adapter.test.ts` and `mission-host.test.ts` read the
  fixture as it is (no spread, no runtime patch; the room stays in `tests/kits/__fixtures__/`).
  **M20:** `ScriptedEnemy`'s unit selector skips a unit whose `frozen` flag is set, and `train`
  skips a frozen building (`kits/rts/enemy.ts`; the view's flag, no sim import); `enemy.test.ts`
  shows no order to a frozen unit, the step not firing (its `{ fired, last }` unchanged) while the
  event is frozen, and a frozen hall training nothing. **Decision 8's held changes:** the mini
  siege's snapshot lost `named` (`MiniSiegeGame.named()` stays for the page and tests, unhashed;
  `tests/browser/debugger-done-when.test.ts` reads `world.key.ram.alive` instead), and
  `sabotage.mission.json` adopted `"marker": "ram"` (M25). Choices: `train` skipping a frozen
  building goes slightly past the decision's "units" so a plan gives no order at all to a held
  event (no sample trains at a frozen building, so no hash depends on it).
  **Moved (decision 2), regenerated with the repo's tools** (`pnpm cli remove`/`run`/`add` for the
  mini siege run files' sync `hashes`, then `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`; `pnpm test
engine/sim/sample-world` needed no update): exactly the files decision 10 predicted.
  - **M12, the seven siege-fixture world runs** (the raid's def is in the snapshot while it is
    open; it commits by tick 40, so every final hash is unchanged): `raid-partial`,
    `raid-failure`, `raid-delegated`, `fixed-cost-few`, `fixed-cost-many` (from tick 10),
    `frozen-construction` (from tick 5) and `opportunity-closing` (from tick 18)
    `.hashes.json` in `engine/sim/__fixtures__/`. The sample-world golden and the other world
    runs (`battle`, `village`, `village-build`, the four `capture-*`) did not move.
  - **Every mini siege run** (`named` gone from tick 0; M20 in the runs that freeze the siege;
    `marker` in the runs that open `sabotage`), each `.hashes.json` and, where it has them, the
    `.run.json`'s sync `hashes` (all but `dawn-fresh` and `ridge-raid`, which have none); no
    assertion, invariant or pinned save code changed. Final hashes: `played` `cf2a262208819d24`
    to `4cb20d9d684a4849`, `delegated` `766ad9dde830f2bc` to `eeba3b08975e07e1`, `quit`
    `f5282bcd8d9c7bdd` to `b3cb42a0c0409b65`, `fortify-played` `c758b3283ab59e88` to
    `2b9327daefddd9a1`, `fortify-delegated` `bd8f76744d63c45e` to `830abca417810eaa`,
    `ridge-raid` `91b8badf8fc51139` to `4670bab2df97d5f4`, `dawn-fresh` and `dawn-held`
    `6e309a2e804edc78` to `c5e88a910dfe2710`, `dawn-captured` and `dawn-code` `beb1611ce699c5a0`
    to `d13258df96b4db81`, `dawn-exchange` `a1516bdf0b2ba853` to `3250cd0dccd5925c`,
    `dawn-leave` `facb7083b39bcf95` to `86ec1de1cef2d19d`, `dawn-rescue` `c4401c51749ac409` to
    `1ebfaa6dae0eb6e5`, `dawn-rescue-failed` `41809d9356d8ed03` to `9d9f5ad86dd28cae`. With
    `named` and `marker` in place and M20 alone undone, `played` and `delegated` (the runs that
    freeze the siege) still differed (first at ticks 460 and 60), so M20 itself moves them.
    The hashes written out elsewhere moved with them: `engine/tools/record.test.ts`'s final
    hashes and the run tables in `games/samples/mini-siege/CLAUDE.md`.
  - **Not moved:** the RTS skirmish (no missions, so no freezes), the tower-defense, dungeon and
    platformer samples and the platformer lab.
  - **Mutants:** `pnpm -s cli mutants games/samples/mini-siege --json` still exits 0: every run
    passes as it is with no weak guard, `enemy-follows-plan` is guarded by 14 runs and
    `towerdefense:win-on-clear` by one, and the rest are the lenient rules no run guards, as
    before. No layer arrow changed.

### Planned tasks

1. **T1** Decisions before code for 0.15 (docs only; this section).
2. **T2** Move the demo and the stacking-test game into `games/samples` (`dungeon`, `platformer`),
   their run files unchanged with identical hashes (decision 1).
3. **T3** A skin `background` colour (G36) and `byTag` prefix and value matching (M2) (decision 3).
4. **T4** A HUD in the 3D backend (G33) (decision 4).
5. **T5** Shell input and settings: stored volumes and a volume control, a tick rate, pointer taps
   as recorded input, taps into hosted rounds, `screenAtCell` and `toClient` (M1, D1, D2, D12,
   D13) (decisions 5 and 6).
6. **T6** The mission hosting API: host events, the hosted mini game named on its frame, one round
   picture, the host and the kit's game in one, the sim-to-RTS port bridge (M6, M18, M21, D9, M27)
   (decision 7).
7. **T7** Mission data by scenario key: keys kept in the world, keyed run checks and records read
   through the port, the offer marker by key, squads in selectors, slots, selector validation,
   `td-map` without waves (M10, D6, M17, M28, M25, M16, D10, D7, D8) (decision 8).
8. **T8** Commit and campaign rules: report-driven effects, experience ticks, late refusals, lost
   stockpiles and a campaign end in data, one entry-end rule, save code v2 (D3, D4, M4, M5, M31,
   M35, M38) (decision 9).
9. **T9** The hash-moving fixes: the siege fixture as a `mission-room` mission (M12) and the
   scripted enemy skipping frozen units (M20) (decision 10).
10. **T10** The shared mission-launch scene and campaign page flow, and round key hints from the
    mini game (M26, M34, M36, D14) (decision 11).
11. **T11** Rooms that are not one dungeon, a second mission room, a params page per mini game
    (G17, M32, M11) (decision 12).
12. **T12** Finish the dungeon sample (decision 13).
13. **T13** Finish the platformer sample (decision 13).
14. **T14** Finish the RTS skirmish and tower-defense samples (decision 13).
15. **T15** The API review write-up, `docs/reports/api-review.md` (decision 14).
16. **T16** The Done when's proof and the games index.
17. **T17** Finalize: roadmap, gap reports, module pages, cheat sheet, this log and the owner's
    summary.

### Decisions

The roadmap's scope for 0.15 leaves open how the two old games move, which changes may move a
golden hash, and the shape of each of the 38 gaps above; it also leaves open what "finished"
means for a sample and what the API review looks like. Each decision is a feedback item
(278-291) the owner can overrule by number. The rules every earlier release kept hold unchanged:
every run is repeatable from a seed, the simulation stays headless and deterministic (all
randomness through the world's seeded RNG, no imports from backends, kits or games), kits hold
no world rules and never draw, backends draw from a read-only snapshot, and the tools only read
and replay. No layer arrow in `config/layers.js` changes in 0.15; a task that finds it needs one
stops and says so. Exact file, field and function names are the later tasks', kept to these
meanings; where a field is named here it is the intended name, which a task may change only with
its reason in its entry.

**1. The folder moves (item 278).** By the owner's answer 14, the demo and the stacking-test
game grow into samples: `games/demo/` moves to **`games/samples/dungeon/`** and
`games/platformer-test/` to **`games/samples/platformer/`**, each with `git mv` so the history
follows the files. Their `game.json` ids become `dungeon` and `platformer` (titles to match),
their `CLAUDE.md` and `AGENTS.md` move with them, and their module pages are renamed
`docs/modules/games-demo.md` to **`games-samples-dungeon.md`** and `games-platformer-test.md` to
**`games-samples-platformer.md`**, with `llms.txt`, `docs/modules/README.md`, `config/deps.js`,
the tools' tests, the browser tests, the skills and the cheat sheet following. **Run files move
unchanged, with identical hashes**: their `"game": ".."` is relative, a game's id is not part of
any hashed snapshot (checked: the demo's and the stacking test's snapshots carry no `id`), so T2
moves each `*.run.json` and `*.hashes.json` byte for byte and proves it by running every one
before and after the move (`pnpm cli run`) with the same final hashes; content ids inside the
games (the demo's song `demo`, room ids) are not renamed by the move (T12 and T13 may replace
content, under decision 2). The old folders are gone at the end of T2, and nothing under `games/`
names them. `games/platformer-lab/` stays where it is: it is the platformer kit's test lab, not a
sample, and the roadmap does not move it. The build log, the feedback log and the gap reports are
history and keep the old paths where they describe the past; T17 adds one line at the top of the
stacking-test report saying where its game now lives.

**2. Which tasks may move golden hashes (item 279).** Measured against `235899c`, a golden hash
(a `runs/*.hashes.json` file, a world run's hashes, or `engine/sim`'s sample-world golden) may
move only in these places, each for the reason given:

- **T9 (M12 and M20).** Moving the siege fixture `raid.mission.json` to `mission-room` changes the
  open mission's def in every world run that opens it (the seven world-run golden files the gap
  names, and the sample-world golden if it opens it); the scripted enemy skipping frozen units
  changes the order log and so every mini siege hash. The mini siege's other snapshot changes
  that move its hashes anyway (decision 8's removal of the glue's `named` and the offer
  `marker` adopted in its mission files) are made in the same task, so its hashes move **once**.
- **T8 (D3, D4, M4) only if a record changes.** Decision 9 is shaped so that no existing record
  changes: new effect fields are optional and M4 keeps experience out of the hashed record. The
  one planned move is the mini siege's `fortify` mission adopting report-driven effects (D3, D4),
  which changes its def (hashed while open) and the world it commits, so the `fortify-*` runs'
  hashes move. Save code v2 (M38) moves every **pinned save code** in run files (codes are
  assertions, not golden hashes) and is logged the same way.
- **New sample content (T11 to T14) adds runs rather than moving old ones.** A finished sample's
  new rooms, levels, waves and art come with new run files; the moved run files keep their hashes
  (art and music are not in any snapshot; a room or level an old run plays is kept as it is, and
  new ones are added beside it). The one exception, named here so the owner can overrule it, is
  M32 (decision 12): the dawn's rescue gets a mission room of its own, which is the gap's point,
  so the `dawn-*` runs that play the rescue round move in T11.

Every other task (T2-T7, T10, T15-T17) moves no golden hash; a task that finds it must is a
deviation, stopped and reported. A move is always regenerated with the documented commands,
**`WW_UPDATE_GOLDEN=1 pnpm test tests/runs`** for run files and
**`WW_UPDATE_GOLDEN=1 pnpm test engine/sim/sample-world`** for the sim's golden, never by hand,
and logged in the task's entry below with the files that moved, the old and new final hash of
each, and the reason; `git diff 235899c -- 'games/**/*.hashes.json' engine/sim` is the audit.

**3. Skin `background` (G36) and `byTag` prefix and value matching (M2) (item 280).** **G36:**
both skin formats (the 2D `canvas2d` skin and the 3D `three` skin, `engine/core/present/skin.ts`)
gain an optional top-level **`background`**, a colour in the skins' existing colour format.
Both backends clear to it before drawing a frame (the Canvas2D fill and the Three.js scene's
clear colour), a skin set clears to the skin it draws with (so a hosted round keeps its own,
black by default as today), and the screenshot page draws through the backends so it follows.
Absent, the clear colour is black, today's behaviour, so every skin without it draws the same.
The platformer games' `SKY` constant (`picture.ts` in the stacking test and the lab) goes away
into their skins with the same value, so no picture changes. **M2:** a `byTag` look matches by
exactly one of **`tag`** (the whole tag, as now), or **`prefix`** (any tag starting with it,
e.g. `"progress:"`) with optional **`min`** and **`max`** (inclusive whole numbers compared with
the rest of the tag read as an integer; a tag whose rest is not one does not match a look with
`min` or `max`). Looks are still tried in order and the first match wins, so a skin lists its
stages from the most specific. The skin schema refuses a look with both `tag` and `prefix`, or
`min`/`max` without `prefix`. Not built, **moved to 1.0** explicitly: a look for **two tags at
once** (the burnt and frozen engine), the extra M2 names; the order of the list already picks
one, and a combined look waits for a game that needs it. No hash moves (pictures are not hashed).

**4. The 3D HUD (G33) (item 281).** The HUD is laid out once and drawn by each backend. A pure
function in `engine/core/present` turns a skin's `hud` list and a frame's `status` into a list of
draw items (a sprite frame or font digit at a screen pixel, in order), the layout the Canvas2D
presenter computes inline today, which moves there so both backends share it. The `three` skin
gains the 2D skin's **`sheets`** and **`hud`** fields, in the same shapes (the palettes and
text sprites the game already has). The Three.js backend draws the items as a second,
orthographic pass over the 3D scene: one textured quad per item, its texture a `DataTexture`
built from the decoded pixel art (`engine/core/gfx`), nearest-neighbour filtered so the pixels
stay crisp. No 2D canvas over the WebGL one and no canvas texture, so it runs in Node as the
scene's tests do, and the screen scale follows the 2D HUD's (game pixels, letterboxed like the
picture). The gap's **particles** are built too, as a small pooled set of low-poly boxes in the
effect's colour, so the 3D platformer shows its coin and stomp bursts; a pool size limit is the
backend's. Tests: the layout in Node against the Canvas2D presenter's old output, the 3D pass's
quads for a frame's status, and the platformer's 3D screenshot in the browser test. No hash moves.

**5. Stored volumes and a volume control (M1), and the shell's tick rate (D2) (item 282).**
**M1:** `engine/core/save/settings.ts` gains the player's audio settings, **`{ master, music,
sfx, muted }`**, stored through `storage.ts` under one key per game (the game's id), read at boot
with every read and write guarded (a private window or blocked storage falls back to the
defaults, `DEFAULT_MASTER`, and the page still plays). `bootBrowserGame` applies them to the
audio and draws a small **mute button and volume slider** of the shell's own (like its touch pad:
the shell's DOM, never a kit's), on by default on every sample page and turned off with an option;
a change is stored at once. **D2:** a scene may declare a **tick rate** (ticks a second, at most
the loop's 60); the shell steps that scene only on its ticks and hands it **merged input**: an
action pressed on any loop step since the scene's last tick counts as pressed and held on the
tick (the tower-defense sample's `TickInput` rule, moved into `engine/core/input`). The rate is
per scene, not per page, so a battle at 10 ticks a second and a round pushed over it at 60 work
in one page (decision 11 uses this). Rejected: a merging `InputFrame` alone (each page would
still count its steps). The tower-defense sample and the mini siege's glue drop their own
counters. Headless runs are unchanged (they step every tick), so no hash moves.

**6. Pointer taps as recorded input (D1), taps into hosted rounds (D12), `screenAtCell` and
`toClient` (D13) (item 283).** **D1:** a tap becomes **frame input**: `InputFrame` gains
`taps()`, this frame's taps as `{ x, y, button }` in the **game's screen pixels** (the manifest's
`screen` size, before the display scales it, so a recording replays the same whatever the window),
and `InputScript` gains an optional **`taps: [{ frame, x, y, button? }]`** beside its `steps`,
so a run file's `input` (and a mission's `play` input) can carry taps. The shell's pointer
gestures feed `taps()` on the live input through the display's inverse mapping, and the M19
recorder records taps with the held actions. Rejected: a recorded `order(json)` command (it
would put kit commands into run files, and a tap is the player's input, not an order). The
tower-defense kit reads taps from its input in `step` (`TdControls.tap` keeps its meaning,
called from there), so a round played by tapping is a run file. **D12:** with taps in the frame
input, `HostScene` and `miniGameScene` forward them as they forward keys, and `RoundInput` passes
them through to the round (in the round's frame: the host maps them with the round's frame size,
which `MiniGame.present()` already gives). This closes D12 without a `MiniGame.tap` method
(rejected: a second path for the same input, and recording would miss it); the mini siege's
`roundTap` and its `instanceof TdDefenceRound` go away. **D13:** the tower-defense kit exports
**`screenAtCell(cell)`** beside `cellAtScreen` (the cell's centre in game pixels, the exact
inverse for the map's camera), and both backends' displays gain **`toClient(x, y)`** (game pixels
to client CSS pixels) beside the inverse they use for gestures; the pages' `pictureToClient` and
the mini siege's `clientAt` go away, and the browser tests tap through them. A script without
`taps` replays as before, so no hash moves.

**7. The mission hosting API (M21, D9, M6, M18, M27) (item 284).** **M21:** `MissionHost` emits
its own events on its `events`, after the hosted game's for that step, as plain objects like a
kit's: **`mission-open`** `{ mission, play }`, **`mini-game-end`** `{ mission, game, result }` and
**`mission-commit`** `{ mission, outcome, resolution }`, matched by skins as the mini siege's
sounds already match them (`mini-game-end:pass`, `mission-commit:outcome=both-burnt`). Events are
draw data, never in the snapshot, so no hash moves; the mini siege's `siegeSource` diff goes
away. **D9:** the core names the hosted mini game on the round's frame: a hosted round's frame
carries **`status.miniGame`** (the open mission's `play`), set by the core's host status
(`hostStatusFor`), so no page reads `MissionHost.playing` for it (the getter stays for tools).
**M6 (the rest):** one round picture for every hosted mission: a frame source in
`engine/core/present` that gives the host's frame, or the round's own frame (with D9's
`status.miniGame`) while a round is hosted, which the existing skin sets already pick a skin by.
A page writes one call instead of the switch. **M18:** `MissionHostOptions` gains two optional
hooks, **`canOpen(id)`** (a refusal or null, the kit's `not_offered` check before `open`) and
**`onChange()`** (called after every mission step and every commit), and the RTS kit exports a
helper giving both for an `RtsGame` (`launchMission`'s check, `refresh()`); the mini siege's
wrapper class goes away. Rejected: the kit's game owning a `MissionHost` (the host is core, used
by any kit). **M27:** the bridge is **`engine/sim`'s `rtsWorldPort(world)`**, beside
`missionPort`, structurally typed to the RTS kit's `RtsWorldPort` (the sim may not import the
kit, and the kit may not import the sim); a test under `tests/` (which may import both) checks
the two types agree. The two samples and the tests use it; it is the same seven lines, so no hash
moves.

**8. Mission data by scenario key (M10, D6, M17, M28, M25, M16, D10, D7, D8) (item 285).**
**M10 and D6:** every scenario key is **kept with the world** as its key table (`scenarioKeys`,
key to entity id, fixed at load and kept in world saves as an optional field, so old saves load),
but **outside the hashed snapshot**, and `MissionWorldPort.open` hands the round the whole table
beside the snapshot. The open mission's `refs` stay what they are (the keys its effects name), so
no snapshot changes and no hash moves; a mission's params and a kit's rules (`destroyed`,
`spared`, `keys` selectors, `killed`) may name any key the table holds. Rejected: widening
`refs` (it is hashed and would move every mission run). **M17:** run checks may name an entity by
key: **`world.key.<key>.<Component>.<field>`** (and `world.key.<key>.alive`), resolved by the
tools through the key table to the entity's entry in `world.components`; a key not in the table
is `no_key` at the check's path, exit 3. **M28:** the committed mission records are read through
the sim (`missionRecords(world)`) and the port (an optional `MissionWorldPort.records()`), and
`MissionHost.records()` gives them to pages, so the mini siege's `records()` and its status line
read the host. The mini siege's run files switch to `world.key` paths in T7 while its `named`
summary stays in the snapshot; T9 removes `named` (decision 2), so its hashes move once.
**M25:** a mission file gains an optional **`marker`**, a scenario key the offer marker stands
over, resolved through the key table for `RtsMissionInfo.marker`; absent, the marker is where it
is today. The mini siege's `sabotage` names its siege engine in T9 (the def is hashed while open).
**M16:** `mission-room`'s selectors gain **`squad`** (a squad id); roles stay the RTS kit's three
(`regular`, `hero`, `captain`), so a guard is "the squad `escort`" and a role typo is still
refused. Rejected: free-form roles (they would lose the kit's checked meaning of each role).
**D10:** a `td-defence` `build` selector entry may carry a **`slot`**, a build cell `{ x, y }` of
the mission's map: a slotted entity is placed there, the rest fill the remaining build cells in
the old order, and a slot that is not a free build cell is a `checkUse` problem. **D7:**
`MiniGameUseCheck` gains the game's **world scenarios** (each one's data and key table), and
`checkUse` checks the mission's selectors against every scenario whose opportunities offer the
mission (a selector that picks nothing, a budget faction with no `Stockpile`, more walls than
build cells, a key or slot that does not exist); `validate` reports them at the mission's path.
**D8:** a `td-map`'s `waves` becomes optional; a map without one is valid for `td-defence`
missions only, and a standalone level naming it is refused by `validate` (`no_waves`). Data that
uses none of the new fields validates and plays as before.

**9. Commit and campaign rules (D3, D4, M4, M5, M31, M35, M38) (item 286).** **D3:** the
`inventory` effect gains the `fromReport` the `damage` effect has had since 0.13 (item 223), with
**`negate`** (take the stat away instead of adding it) and a declared **`max`**, the limit on the
amount; `damage`'s `fromReport` gains the same optional `max`. **D4:** `damage` and `destroy`
gain a per-entity form, **`each`**: a report stat holding a list of entity ids or keys (the fallen
walls, the killed raiders), applied to every one it names, with the declared limits **`owner`**
(every named entity must be alive and owned by that faction) and **`max`** (at most that many).
**Limits are checked, not clamped:** a played round whose report goes over a declared limit is
refused at the round's end (`report_over_limit`, through M5's channel) and the mission is
delegated at its commit, as an unmappable report is today. Delegated, quit and timed-out missions
have no report and use the declared amounts, as `damage` does. The mini siege's `fortify` adopts
both in T8 (its gold spent and walls lost as the round reports them), the one planned hash move
there. **M4:** a played round's experience ticks stay **out of the hashed record**: the world's
`experienceTicks` stays 0 for played missions, so world runs and game runs with the same outcome
keep the same world (item 166, decision 3 of 0.10); the run result's `experience`, the timeline
and `missionExperience()` carry them. The field's meaning is written into the 1.0 docs. **M5:**
refusals after their step get a channel: `MissionHost` keeps them as `{ tick, mission, code,
error }` (an optional `HeadlessGame` hook gives them since a tick), and the tools add them to the
run result's `refusedMissions` with **`late: true`** and the tick, so a run file sees them without
reading the snapshot. **M31:** a carried stockpile that is gone **carries as zeros** of each item
the carry spec names (no throw, no new flag: an empty stockpile is the ordinary reading), and a
campaign entry gains an optional **`endIf`** in data (first shape: `{ "gone": "<scenario key>" }`,
the campaign ends when that keyed entity is not alive at the entry's end); the campaign save
records that it ended (an optional `ended` with the entry and reason), and `campaignSave()` no
longer returns null for a lost stockpile. **M35:** one entry-end rule in `engine/core/campaign.ts`,
**`entryOver`**: a scenario entry is over at the first world tick at or after its `ticks` with no
mission open (an open mission commits at a fixed tick, so this is bounded); the page and
`campaignSave()` both read it, and `campaignSave()` is null until it holds (no run file ends with a
mission open, so no pinned code moves for this). **M38:** **save code v2** writes the campaign,
each mission and each scenario by a **stable id code** (a short CRC of its id), not its index in
a sorted list, and each outcome by its index in the mission file's own order (an outcome appended
later moves nothing); `validate` refuses a game where two ids of one kind share a code
(`code_collision`). Rejected: a game-declared mission order (one more list to keep in step). The
v1 reader stays, so an old code still resumes against the content it was written for; new codes
are v2, so every pinned code in run files moves in T8 (logged, decision 2).

**10. The M12 fixture and the M20 scripted enemy (item 287).** **M12:** the sim's
`engine/sim/__fixtures__/raid.mission.json` becomes a real `mission-room` mission: `play:
"mission-room"` and the params now in `tests/kits/__fixtures__/raid.params.json` inlined, so the
repo tests play the fixture as it is and the params fixture and the spread in
`tests/kits/mission-adapter.test.ts` and `mission-host.test.ts` go away. The open mission's def is
in every world run that opens it, so those golden files (seven at 0.11, recounted in T9) and the
sample-world golden if it opens the raid are re-recorded (decision 2). The fixture stays the record
of the mission contract, now in its real form. **M20:** `ScriptedEnemy.think` (`kits/rts/enemy.ts`)
skips units whose event is frozen when it selects whom to order (the view's `frozen` flag, so
the kit still never imports the sim), so the order log and `kit.nextOrder` stop growing during a
freeze. Every mini siege hash moves, together with decision 8's `named` removal and `marker`, in
one regeneration; the RTS skirmish has no missions and so no freezes, and T9 shows its hashes
unchanged.

**11. The shared mission-launch scene and campaign page flow (M26, M34, M36), and round key
hints (D14) (item 288).** They are written once in **`engine/core/shell`**, where `HostScene` and
`CampaignSession` already are, because hosted missions and campaigns are core concepts any kit's
game can have; anything RTS-only (the offer marker, the RTS controls) stays in the kit and is
handed in. **M26:** a **mission-launch scene** over a `HostScene`: the launch buttons from the
open offers, the host paused while the player chooses to play or delegate, the round pushed and
stepped at its own rate while the host steps at its tick rate (decision 5's per-scene rate), and
the outcome's title in the status line. **M34 and M36:** a **campaign flow** beside
`CampaignSession`: each entry **held at tick 0** until the player begins it (a briefing panel with
the entry's title and text from the campaign data, so the dawn's 60-tick window is the player's
time, not reading time), the entry's end by decision 9's `entryOver`, the result panel (the
outcomes, the named people's fates, the save code), Continue, the code box and the stored save's
button. The shell owns this DOM, as it owns the touch pad; kits never draw it. **D14:** a
`MiniGameDef` gains its **controls** as data (actions with a short label each), and the host's
page shows them as the round's hint, written with the shell's current key names; a mission file
may give its own wording with an optional **`hint`**. The mini siege's `ROUND_HINTS` and the
tower-defense sample's `HINT` go away. The mini siege's page and the tower-defense sample's move
onto these in T10; pages are not hashed, so no hash moves.

**12. Rooms that are not one dungeon (G17), a second mission room (M32) and a params page per
mini game (M11) (item 289).** **G17:** a game chooses how a kit checks its kinds with a
**`game.json` option** read by the kit's hook, `KitDef.kinds(manifest)`: the manifest gains an
optional **`kitOptions`** keyed by kit name, each kit giving the schema for its own (refused
`unknown_option` otherwise), and the top-down kit's first option is **`rooms`**, `"dungeon"`
(the default, today's one-dungeon check) or `"separate"` (each room checked alone: its own start,
doors only within itself). The kit's `roomKind(..., { oneDungeon })` is what the option sets.
Rejected: a different kind name per mode (every tool and skill would learn two names). **M32:** with
`rooms: "separate"`, the mini siege's dawn rescue gets **its own mission room** instead of the
sabotage's `engine-camp`; this moves the `dawn-*` runs that play the rescue (decision 2's named
exception). **M11 (the rest):** `pnpm docs:gen` writes **one page per mini game a game defines**
(`HeadlessEntry.miniGames`, such as the room challenge), `docs/reference/mini-games/<game>-<id>.md`
with its params table from the schema, linked from the "Mini game params" section of
`docs/reference/schemas.md`, and kept fresh by the docs test like the rest.

**13. What "finished" means for a sample (item 290).** A sample (`dungeon`, `platformer`,
`rts-skirmish`, `tower-defense`) is finished when it has all of these, checked in T16:

- **Original NES-style pixel art as text** (owner answer 22) for every tile, sprite and HUD item it
  draws: no placeholder boxes, no look drawn by a `fallbackColor`, and no art copied from another
  game (the SMBC REMIX source is read for technique only). A test fails if any kind a run draws
  falls back.
- **MML music**: at least one original song, played on its page, plus sfx for its main events.
- **Low-poly meshes where it is 3D**: the platformer keeps both skins (G33's HUD and particles in
  3D), meshes procedural or text-defined; the others are 2D only, and that is finished for them.
- **A `CLAUDE.md`** that explains how it was built (its content files, how to add a room, level,
  wave or unit, its run files and what each guards), the one-line `AGENTS.md`, and its module page
  linked from `llms.txt`.
- **Run files in CI** (`tests/runs`) with golden hashes, covering a win and a loss (or a failure
  state), and every rule of its kit guarded where the kit is strict (`mutants` clean).
- **A browser test** that loads its page, plays to a checked state (by keys or the step hook) and
  skips cleanly without Chromium; the page has M1's volume control.
- **Listed in the games index**: the launcher list the Pages build writes from the root
  `index.html` (`build/launcher.ts`), with a one-line description, playable from that link in
  `pnpm build`'s output (nothing is published during the build, owner answer 24).

The mini siege is the 1.0 multi-genre sample, not one of the four; it gets the shared pieces of
decisions 5-12 and keeps its art, and is not re-finished in 0.15.

**14. The API review's form, and D5 and D11 (item 291).** T15 writes
**`docs/reports/api-review.md`**: one section per module (each `engine/core` part, `engine/sim`,
`engine/tools` and its CLI, each backend and each kit), listing **every exported entry point**
(from the module's `index.ts` and the module page) with what the samples needed of it and a
verdict: **keep**, **changed in 0.15** (with the commit), or **listed for 1.0** (with what the v1
docs must say, or what change waits and why). Every 0.15 gap above appears in it with where it
landed, and the roadmap's Done when ("every change it calls for either made or listed for 1.0")
is checked against it in T16. The review is the last chance to rename or reshape an API before it
is written down as v1 (internal, owner answer 16); a change it finds that fits 0.15 is made in
T15's own commit, and anything bigger is listed for 1.0. **D5 and D11 stay 1.0 documentation**,
not 0.15 changes: the review lists both under the tower-defense kit and `engine/sim` as rules
the v1 docs state ("walls lost" is the report's reading of the leaks; two missions on one event
exclude each other for the first one's cost), with no code change.

## Engine 0.14

Creator tools v1. Built on branch `engine/build-0.15`; not tagged (no tags during the build, owner
answer 24). As in 0.9 to 0.13, the open questions were settled in writing before any code (T1);
the later tasks build against them. The release's goal is the roadmap's: **tools for people (not
just the CLI) to inspect a world**: an in-browser simulation debugger (the world state, the event
log, stepping and rewinding through a replay, reading the same dumps and replay files the CLI
writes) and a timeline viewer (world time, opportunities and when results were committed), with
the creator-tool gaps of the earlier reports. Editing stays out of scope (the visual editor comes
after Engine 1.0). The base commit for the golden-hash and `engine/sim` checks is
`b1e21cf6b8987ec45604182fde641daabdbf3b15` (`b1e21cf`), the head when T1 started: every hash that
moves and every `engine/sim` change is measured against it. The plan is that **no golden hash
moves** in 0.14 (decisions 3 and 4); a task that finds it must move one says why in its commit.

**Gaps assigned to 0.14 from earlier reports:** from
[docs/reports/stacking-test.md](reports/stacking-test.md), **G5** (a Vite plugin
`virtual:game-files`, so `files.ts` goes away), **G8** (a `trace` command for tuning run files,
decision 5), **G9** (a start level in run files, decision 6), **G10** (region edits and a ruler
for text maps, decision 7), **G12** (per-kit rules and mutants, decision 8) and **G31** (replaying
a run file in a browser page, decision 9); from [docs/reports/mini-siege.md](reports/mini-siege.md),
**M19** (recording a hosted round's input for a run file's `play` step, decision 10).
`grep -n "0\.14"` over [docs/reports/tower-defense.md](reports/tower-defense.md) finds no gap
moved to 0.14: its hits are the summary line naming the releases the mini siege's gaps moved to,
its format's list of releases a status may name, D1's status and the `files.ts` row's note on G5.
D1 (a tap is not frame input, so a round played by tapping cannot be recorded) only
cross-references M19; its status stays **moved to 0.15** (the API review: a recorded command or a
pointer track in `ScriptedInput`), so 0.14's recorder (decision 10) records frame input (keys and
pads) only. A new gap found during 0.14 is logged in the report of the game it was seen in,
continuing that report's ids (the mini siege's from M37).

### What was built

- **Decisions before code** (T1, this commit): where the debugger lives and what it reads,
  stepping and rewinding, how the event log and world time reach the tools, the timeline record,
  G8, G9, G10, G12, G31 and M19, settled in writing (items 247-256, below), and the planned task
  list. No code changed.
- **G5: `virtual:game-files`** (T2): one Vite plugin, `build/game-files.ts` (registered in
  `vite.config.ts`, typed by `build/virtual-game-files.d.ts`), gives a game page its data files:
  `import files from 'virtual:game-files'` finds the importer's nearest folder with a `game.json`
  and returns its `./game.json` and `./content/**/*` as text, with the same keys and order as the
  old `import.meta.glob`. Every game's `files.ts` is deleted (the demo, the platformer lab and
  test, and the three samples); the pages import the virtual id instead, the scaffold-game skill
  writes no `files.ts`, and a data file added, changed or removed reloads the dev page. Outside a
  game folder the import fails with an error naming the importer. The dependency rule needs no
  change: the virtual id is a bare specifier, read as an external package that no layer owns.
  The screenshot page never used `files.ts` (it receives the files in its job), so it is
  unchanged. Tests: `tests/build/game-files.test.ts` (the folder walk, keys and texts against a
  real `import.meta.glob` for two games, hidden files, a real build and the error).
- **G8: the `trace` command** (T3, decision 5, `85d54d8`): `pnpm cli trace <run> --paths a,b
[--from N] [--to M] [--every K]` plays the run like `dump` and prints one row per traced tick,
  `{ tick, hash, values }`, a missing path as null (and listed in `missing`); `rows` is a top-level
  array the output cap halves, and the text form is a table. It reads each tick through
  `playRun`'s `onTick`, the one playing loop. No golden hash moved. Tests: `trace.test.ts`.
- **G9: a start level or entry in run files** (T4): a game run file's optional `start` is
  `{ "stage": n }` (a level of the game's level sequence, 0-based) or `{ "entry": "<id>" }` (a
  campaign entry, fresh, no carried record), handed to `createGame` as `HeadlessOptions.start`; it
  and `from` are a schema error together, and a world run takes neither. A game lists what it can
  start at with the headless module's optional `starts(content)` (`HeadlessStarts`); the tools
  check `start` against it before playing (`no_start` at `start`, `bad_start` at `start.stage` or
  `start.entry`, exit 3). `run`, `dump`, `trace`, `code`, `screenshot` (`ShotJob.start`) and
  replay files keep it. The platformer kit's `LevelSequence` takes `start` (with `stageStarts`
  and `startStage`), the platformer test and lab pass it, and the mini siege starts an entry fresh
  (`campaignSaveAt` in `engine/core/campaign.ts`). New run files: `level-2-start`,
  `level-3-start`, `level-4-start` (platformer test), `mini-game-start` (lab) and `dawn-fresh`
  (mini siege), each with golden hashes; the start-level files give the same hashes as the full
  runs from that level's tick, and no existing golden hash moved. Tests: `start-run.test.ts`,
  `sequence.test.ts`, `campaign.test.ts`.
- **G12: per-kit rules and mutants** (T5, decision 8): a rule id is bare for the game's own kit
  and `kit:id` for a kit it `uses`, in `disableRules`, `guards`, `--disable-rule` and `mutants`'
  output (`lookupRuleId`, `qualifiedRuleId` and `gameKits` in `engine/tools/kits.ts`); a prefix
  naming a kit the game does not use is `unknown_rule`, naming the game's kits. `HeadlessOptions`
  gains `disabledRulesByKit` beside the main kit's `disabledRules`, read with `rulesOffFor(opts,
kit)`; the platformer test hands the top-down ids to its vault rounds and the mini siege each
  round's ids to its `mission-room` and `td-defence` rounds. `mutants` tries every kit's rules,
  each row with its `kit` and that kit's `strict`, and judges each rule by its own kit's
  strictness. Settled here (item 257): a `uses` kit's rule is expected only where a run file
  lists it in `guards`, so a strict `uses` kit (the mini siege's `towerdefense`) fails only on a
  listed guard a run does not guard, and its unguarded rules are reported per kit. New guards:
  `topdown:walls-block-movement` in the platformer test's `level-4` and `level-4-start`,
  `towerdefense:win-on-clear` in the mini siege's `fortify-played`; no other run file and no
  golden hash changed. Tests: `mutants.test.ts` (a stub game on a lenient and a strict test kit),
  `two-kits.test.ts`, `tests/runs/per-kit-rules.test.ts`, `platformer-test.test.ts`.
- **G10: a ruler and region edits for text maps** (T6, decision 7, `42f3155`): `get <map> rows
--ruler` (or `rows.R1-R2`) prints the rows under a column ruler with row numbers;
  `get <map> rows.R1.C1:R2.C2` copies a rectangle; `paste <map> rows.R.C <block>` (`\n`-split
  lines, `@path` or `--from-file`, optional `--transparent`) writes one in a single call through
  `set`'s schema check and read-back; a ragged or off-grid block is exit 2 with nothing written.
  Works on rooms, platformer levels and tower-defence maps. Tests: `edit.test.ts`.
- **The world event log and timeline as data** (T7, decisions 2-4): `engine/sim/timeline.ts`,
  `timelineOf(source)`, a pure reader over a world's plain data (a snapshot or save and its event
  log) giving the `worlds-within/timeline` record (world tick, `logFrom`, a game run's `clock`,
  frozen spans, experience per mission, opportunity windows with their status history and causes,
  missions opened and committed), with `worldTimeline`, `eventsSince`, `logFrom`, `compressClock`,
  `gameTickOf` and `timelineEntries`; `changeSchema` is now exported from `save.ts`. The
  `HeadlessGame` hooks are **`worldEvents(sinceTick)`** (named so because a `HostedGame`'s `events`
  is already its last step's draw events; its result also carries the world tick now, `tick`, so
  the tools sample the clock per game tick without a hook of their own) and `timeline()`;
  `MissionHost` has them when its `MissionWorldPort` gives the new optional `events` and
  `timeline` (`missionPort` does), the mini siege forwards them and the RTS skirmish reads its own
  world (in the game's glue rather than the kit's `RtsGame`, whose world port is plain data). World
  runs keep their event log when asked (`loadWorldRun(..., { log: true })`). New commands
  `events` (filters `--from`/`--to` in world ticks, `--entity`, `--cause`, `--component`) and
  `timeline` (`--tick`), and `dump --out <file>.json`, a `worlds-within/dump` file
  (`engine/tools/dump-file.ts`, `dumpFileSchema`, `parseDumpFile`, no Node imports) for the
  debugger. A game without the hooks is `no_world` at `headless`, exit 3 (the task's code; decision
  3 had said exit 2). The timeline and dump file schemas are in `docs/reference/schemas.md`. No
  golden hash moved. Tests: `timeline.test.ts` (siege and captive fixtures), `world-data.test.ts`,
  `mission-host.test.ts`.
- **G31: the page-side step hook and `?replay=`** (T8, decision 9, `e1e3315`): `bootBrowserGame`'s
  manual-loop mode (`manual: true` or `?debug=step`) never runs the loop on
  `requestAnimationFrame` and puts the step hook on `window.__ww` (`engine/core/shell/debug.ts`):
  `step(n)`, `tick`, `snapshot()`, `hash()` (core's `stateHash`, `engine/core/state-hash.ts`,
  shared with the tools) and `replay(runFile)` (its input, orders and mission steps through the
  real page). `tests/browser/platformer-test.test.ts` replays `level-1` to `level-4` in the page
  with the golden hashes, without replacing `requestAnimationFrame`. No golden hash moved.
- **M19: recording a hosted round's input** (T9, decision 10): `engine/core/input/input-recorder.ts`
  (`InputRecorder`, pure: held actions per frame in, the shortest `ScriptedInput` script out; the
  decision's `input/recorder.ts`, named after the class). `MissionHost.recordRounds(on)` and
  `roundRecordings()` (optional `HeadlessGame` hooks) record every round started while on, from
  its frame 0, as the host actions its `RoundInput` let through (`RoundInput.source()`), so a
  recording replays as the round played; each is `{ mission, tick, ticks, done, input }`, `tick`
  the `play` step's game tick. The page's step hook gains `record(on)`, `recording` and
  `recordings()`, and `?record` puts `window.__ww` on a page with recording on while its loop runs
  as usual (so a person can play and copy the recording); `HostScene`'s accessors take an
  optional `headless()`, so the mini siege's page reports its game to the hook. New command
  `pnpm cli record <runFile> --mission <id> (--input <file> | --bot <plan>)`: the recording (from
  the page, or from the kit's bot, `KitDef.roundBots`: `TopDownBot` for `mission-room`, `TdBot`
  for `td-defence`) written into the `play` step's `input` through the editing verbs' checked
  write, then the run played; a recording the run fails with is put back (exit 4), one that breaks
  the schema is exit 3 with the file untouched, a mission with no play step exit 2. Re-recording
  the mini siege's `played` and `fortify-played` rounds with their bots writes the committed
  inputs unchanged (final hashes `cf2a262208819d24`, `0b43372f77faea35`), so the 0.11 script is
  gone. Keys only (D1's taps stay 0.15). No golden hash moved. Tests: `input-recorder.test.ts`,
  `mission-host.test.ts`, `debug.test.ts`, `shell.test.ts`, `record.test.ts`, `play.test.ts`,
  `tests/browser/mini-siege-page.test.ts` (a round played on the page with `?record`, written with
  `record`, passing with the golden hashes).
- **The in-browser simulation debugger** (T10, decisions 1 and 2): a new module,
  `engine/tools/debugger/` (its own `CLAUDE.md`, `AGENTS.md` and
  [module page](modules/engine-tools-debugger.md)), a tools-only page never in the Pages build.
  `pnpm cli debug <file> [--tick N] [--port P] [--check]` opens a run file, a replay file (at its
  failing tick) or a dump file (read-only at its tick, with Play from here when its run is a game
  run file), serves the repo with the screenshot command's Vite server (`serveRepo`, now exported
  with a port and a route hook) and the page's job on a GET-only in-memory route, and prints the
  URL; `--check` opens the page in headless Chromium at the tick and compares its hash with the
  headless run's (exit 4 on a mismatch). The page's pure model (`model.ts`, `DebugSession`)
  steps the run as `run` does and rewinds by re-simulating from tick 0 with every tick's record
  cached, and checks every hash against the golden file, the run's sync hashes or a replay's
  (a mismatch stops stepping there); the view game is stepped alongside for the picture and its
  hash compared. Panels: picture, checks per tick, hashes, a state tree with search and the diff
  from the previous tick, and the event log with the `events` filters. `window.__wwDebugger` is
  the hook for tests and agents. The run file's checks (`check-values.ts`) and the event filters
  (`event-filter.ts`) moved to pure files the page shares with the CLI. World runs are not
  stepped in the page (it builds games; a world run's dump file opens read-only). No layer arrow
  and no golden hash changed. Tests: `debugger/model.test.ts`, `debug.test.ts`,
  `tests/browser/debugger.test.ts`, `tests/build/pages.test.ts`.
- **The timeline viewer and failing replays at their failing tick** (T11, decisions 2 and 4): the
  debugger's Timeline panel draws the timeline record at the tick shown (the game's `timeline()`
  hook with its clock filled from every game tick's world tick, `DebugSession.timeline()`, equal
  to `pnpm cli timeline`'s) on one axis of game ticks: the world clock (moving or standing still
  while a round is played), frozen spans, experience time, opportunity windows with each status
  change and its cause, and missions open to commit with the outcome; a world tick past the clock
  is placed as if the world moves one tick per game tick (`projected`). Clicking a marker goes to
  its tick. The layout is a pure model, `engine/tools/debugger/timeline.ts` (`timelineLayout`,
  `timelineText`), tested in Node; `window.__wwDebugger.timeline()` prints it as text and
  `timelineLayout()` gives the rows. A replay opens at `replay.failure.tick` with the failed check
  (path, op, expected against the actual value, `DebugSession.failure()`), buttons for that tick
  and the tick before, and the first stored hash that differs marked in the banner and on the
  timeline. A failing `run` prints `pnpm cli debug <replayFile>` (`debug` in its result, and its
  text); `debug <replay> --check --json` adds `{ failure, reproduced, hashMismatch }` (exit 4 when
  a replay does not reproduce). The debug-failing-run skill opens the replay in the debugger as
  its step 2. No layer arrow and no golden hash changed. Tests: `debugger/timeline.test.ts`,
  `debugger/model.test.ts`, `debug.test.ts`, `run.test.ts`, `tests/browser/debugger.test.ts`.

- **The Done when's proof: a data-only scenario** (T12, `46d5aed`, `909e239`): the mini siege's
  third campaign entry, **the ridge camp** (`content/maps/ridge.world.json`, the
  `stores-raid` mission, the `ridge` entry in `siege.campaign.json` and `runs/ridge-raid.run.json`
  started with `start: { entry: "ridge" }`, with its golden hashes). Its commit (`909e239`)
  changes only `content/`, `runs/` and docs: no `.ts` file. The glue built and played it
  unchanged; what blocked it was the game's own tests, which pinned the campaign to two entries
  (gap M37, fixed in the commit before it, `46d5aed`, by reading every entry after the dawn from
  the campaign file). Adding the mission found M38 (save codes index missions by sorted id, so an
  id sorting earlier moves every pinned code; moved to 0.15, item 259): the mission is named
  `stores-raid`, which sorts last, so no code moved. `tests/browser/debugger-done-when.test.ts`
  opens the ridge run in the debugger, steps it forward over every hashed tick and rewinds back
  over them with the golden hashes, reads the raid's mission events and its timeline (against
  `pnpm cli timeline`), and runs a temp copy with a wrong assertion through `run --json`, then
  opens the `replayFile` it names with `debug --check` and in the page at `replay.failure.tick`.
  The close-out (this commit): this section, the roadmap, both gap reports, `llms.txt` and the
  feedback log.

**Commits** (T1-T12): `2289516` (T1), `9fa1060` and `5a5e7ef` (T2, G5), `85d54d8` and `dcae2e9`
(T3, G8), `6cb80a5` and `d200d0a` (T4, G9), `a2830cd` and `fa75a96` (T5, G12), `42f3155` and
`5ef7718` (T6, G10), `37e4f96` (T7), `e1e3315` and `733884c` (T8, G31), `61f9774` and `90538a5`
(T9, M19), `4eca0a7` (T10), `bcf12cc` (T11), `46d5aed`, `909e239` and the close-out commit
(T12).

### Planned tasks

1. **T1** Decisions before code (docs only; this section).
2. **T2** G5: a Vite plugin `virtual:game-files`; every game's `files.ts` goes away.
3. **T3** G8: the `trace` command for tuning run files (decision 5).
4. **T4** G9: a start level or entry in run files (decision 6).
5. **T5** G12: per-kit rules and mutants for games on several kits (decision 8).
6. **T6** G10: region edits and a ruler for text maps (decision 7).
7. **T7** The world event log and timeline as data: the `events` and `timeline` commands and
   `dump --out` (decisions 2-4).
8. **T8** G31: the page-side step hook and replaying a run file in the real page (decision 9).
9. **T9** M19: recording a hosted round's input for a run file's `play` step (decision 10).
10. **T10** The in-browser simulation debugger: state, event log, stepping and rewinding
    (decisions 1-3).
11. **T11** The timeline viewer, and opening a failing replay at its failing tick (decisions 2
    and 4).
12. **T12** The done-when proof and close-out: a data-only mini siege scenario stepped through in
    the debugger, the gap reports, roadmap, design and cheat sheet.

### Decisions

The roadmap's scope for 0.14 leaves open where the debugger lives and what it reads, how it steps
and rewinds, how a game's event log and world time reach the tools, what the timeline is as data,
and the shapes of the six creator-tool gaps (G8, G9, G10, G12, G31, M19). G5 needs no decision of
its own: the stacking test's row already names the fix (a `virtual:game-files` module per page,
build tooling in `build/`, the page's `files.ts` replaced by one import). Each decision is a
feedback item (247-256) the owner can overrule by number. The rules every earlier release kept
hold unchanged: every run is repeatable from a seed, the simulation stays headless and
deterministic, kits never draw and never import the sim, and the tools only read and replay (they
never change a world by hand). Exact file, field and function names are the later tasks', kept to
these meanings.

**1. Where the debugger lives (item 247).** The debugger is a **tools-only page**,
`engine/tools/debugger/` (an `index.html` and its scripts), built like `engine/tools/screenshot/`:
it is served by the tools and is **never part of the Pages build** (`build/pages.ts` finds pages
only under `games/` and `games/samples/`, which is why the screenshot page never ships either; a
test proves the built site has no debugger page). A new command, **`pnpm cli debug <file> [--port N] [--no-open]`**, starts a Vite dev server
for the page with the file's path and contents handed over (a query parameter naming a file the
server reads back through a small read-only endpoint limited to the repo, never a write), prints
the URL as its result (`{ url, file, kind }`, so an agent can drive the page with Playwright) and
stays up until it is stopped. It is a new engine module, so it gets its own agent docs:
`engine/tools/debugger/CLAUDE.md` (and the one-line `AGENTS.md`) and
`docs/modules/engine-tools-debugger.md`, linked from `llms.txt`. The page imports only what
`engine/tools` may import (core, sim, the backends to draw the picture, and a game's headless and
view modules loaded by path, as `screenshot` does), so no layer arrow changes. Rejected: a debug
panel inside each game's page (it would ship to players and every game would carry it) and a
separate app outside `engine/` (the layer table has no place for it).

**2. What the debugger reads, and how it steps and rewinds (item 248).** It reads three kinds of
file, told apart by their shape: a **run file** (`*.run.json`, a game's or a world's), a **replay
file** (`.ww-out/replays/*.run.json`, which is a run file plus its `replay` block: `source`, the
`failure` and its `tick`, the `hashes`), and a **dump file**: what the new `dump --out <file>`
writes, the dump command's result in an envelope `{ format: 'worlds-within/dump', version: 1, run,
game, world, seed, tick, hash, state, orders, missions, events, timeline }`, `run` the run file
it came from (relative to the dump file), `events` the event log up to `tick` and `timeline` the
timeline record (decision 4). A dump file is a still picture: the page shows it without playing,
and offers **Play from here** only by replaying its `run` to its `tick`. **Stepping and rewinding
are deterministic re-simulation in the page from tick 0**: the page builds the game (or the world)
from the content and seed the file names, applies the same input, orders, missions, `from` and
disabled rules as `pnpm cli run`, one step per tick, and keeps no history of states. **Step**
plays one tick, **step n** plays n, and **rewind to N** (any N, including back) rebuilds from tick
0 and replays to N; to keep long rewinds fast, the page may keep a few rebuild points as world
saves (`engine/sim/save.ts`, a plain JSON save is exact) or replay again, never a snapshot it
cannot rebuild from. **Every state the page shows is checked against the headless run:** the page
hashes its snapshot with the same `canonicalJson` and hash the tools use and compares it with the
run file's golden hashes (and a replay's `hashes`) at every hashed tick; a mismatch is shown at
once (the tick, both hashes) and stops stepping, since the page would be showing a different run.
A browser test (skipping cleanly without Chromium) checks the page's hashes against `pnpm cli run`
for one run file per kit.

**3. How the event log and world time reach the tools for game runs (item 249).** A world run's
tools hold the `World` and read `world.events(sinceTick)` and its `WorldTime` directly. A game
run's tools see only the `HeadlessGame` contract, so it gains two **optional hooks**, both plain
JSON-safe data and both "must not change the game", like `campaignSave()`:

```text
events?(sinceTick: number): { from: number; changes: JsonObject[] }   // the world's committed
                                     // event log entries with tick >= sinceTick, oldest first;
                                     // `from` the oldest tick the world still keeps (log retention)
timeline?(): JsonObject              // the timeline record (decision 4) of the world now
```

`MissionHost` gets both through its `MissionWorldPort` (two new port methods `missionPort` fills
from the world), so the mini siege needs no glue; the RTS kit's `RtsGame` implements them over its
world; a game with no world (the platformer and top-down samples) leaves them out and the tools
say `no_world` (exit 2, a usage error) for `events` and `timeline`, while the debugger simply hides
those panes. Rejected: a `world()` hook returning the sim's `World` (core cannot name the sim's
types without importing it, and the tools would then reach past the contract into a live world they
could change), and reading `state.world` from the snapshot (it has the world's components and
`WorldTime` now, but **not the event log**, which is never in a snapshot, and no past frozen spans).
**The event log is never part of the hashed snapshot**: the hooks are read beside `snapshot()`,
the hash stays the hash of `snapshot()` alone, and a world's log retention (`WorldOptions.log`) is
unchanged, so **no golden hash moves**. A tool asking for ticks the world has dropped gets what is
kept and the `from` it starts at, never an error.

**4. The timeline record and its reader (item 250).** The timeline is plain data. Its world part
comes from a **pure function in `engine/sim`**, a new `engine/sim/timeline.ts`, `timelineOf(save)`,
over a world's plain data only (its `World.snapshot()` and its event log, as in a world save), so
it runs the same in Node and the page and never steps or changes a world; it is on the sim's side
because it reads the sim's components (`WorldTime`, `Opportunity`, `Missions`), and kits never
import it. The record:

```text
Timeline { format: "worlds-within/timeline", version: 1,
  worldTick,                                     // the world tick now
  clock: [{ game, world }] | null,               // world tick per game tick, run-length: one entry
                                                 // per game tick where the rate changed (filled by
                                                 // the tools for a game run; null for a world run)
  frozen: [{ event, by, from, to | null }],      // frozen spans in world ticks, `to` null while frozen
  experience: [{ mission, from, ticks }],        // experience time per played mission (game ticks
                                                 // inside, the world standing still)
  opportunities: [{ id, mission, opens, closes,  // windows in world ticks (null while dormant)
                    status, history: [{ status, by, at }] }],   // open/close changes with their causes
  missions: [{ mission, openTick, commitTick,    // the committed records (`MissionRecord`, `WorldTime`'s
               resolution, outcome, experienceTicks }] }        // `committed`), in commit order
```

Statuses are the sim's own (`dormant`, `waiting`, `offered`, `taken`, `closed`); spans and the
opportunity history are read from the event log (`set` changes of `WorldTime` and `Opportunity`
with their causes), so a world whose log keeps fewer ticks gives shorter history and says so with
the log's `from`. The `clock` is the one part the world cannot know (a game tick is not in the
world): the tools fill it from the `worldTick` of each game tick's snapshot while they play.
`pnpm cli timeline <run> [--tick N]` prints the record; `dump --out` includes it; the viewer
(T11) draws it. Its schema is in `docs/reference/schemas.md`.

**5. G8: the `trace` command (item 251).** `pnpm cli trace <run-file> --paths a,b [--from N]
[--to M] [--every K] [--events]` plays the run (no checks, like `dump`) and prints one row per
traced tick: `{ run, paths, from, to, every, rows: [...] }` where each row is `{ tick, values: {
"<path>": value } }` and, with `--events`, `events` (that tick's event-log changes for a world, or
the game's own snapshot `events` field when it has one). Paths are dotted snapshot paths as `get`
and assertions write them (`player.x`, `world.entities.12.Health.hp`); a path missing at a tick
gives `null`, not an error. `--from` defaults to 0, `--to` to the run's `ticks`, `--every` to 1;
`from > to`, `every < 1` or an unknown flag is a usage error (exit 2). **The rows are a top-level
array in the result**, so the output cap (`--max-output`) cuts whole rows (with `--json`, top-level
arrays are halved until the result fits, with `truncated`, `fullOutput` and `omitted`), never
through one row, and the whole trace is in the full-output file. The text
form is a table (a column per path). `dump --ticks` is not added: `trace` covers it.

**6. G9: a start level or entry in run files (item 252).** A game run file gains an optional
**`start`**, exactly one of **`{ "stage": n }`** (the platformer kit's level sequence: start at
level n, 0-based like the snapshot's `stage`, from tick 0 with a fresh level) and **`{ "entry":
"<id>" }`** (a campaign entry by id: start that entry fresh, at its own start, with no carried
record). It reaches the game as **`HeadlessOptions.start`** (the same union); a game that cannot
honour it refuses it with a usage error before the first step (the tools check it against the game:
the level sequence's length, the campaign's entries). `start` and `from` are **mutually
exclusive** (`from` already names where a run starts; both is a schema error at `start`). The
platformer test's `level-2` and `level-3` run files keep replaying the earlier levels (their
hashes stay); T4 adds short start-level run files beside them, so a change to `level-1` moves no
later level's new run file. A replay file of a run with `start` keeps it.

**7. G10: a ruler and region writes for text maps (item 253).** `get <text-grid file> rows
--ruler` (also on a range `rows.R1-R2`) prints the rows with a column ruler above them (tens and
units lines) and the row number before each row, in the text form only (the JSON result keeps
`rows` as strings plus `ruler: true`). A **region write** is a new verb, **`paste <file> rows.R.C
<block>`**, whose block is several lines (from the argument with `\n` lines, or `--from-file
<path>`); it overwrites the cells from row R, column C, one block line per row, and a space in the
block is written as a space (no transparency, so the result is what was asked). A block that runs
past the grid's width or height is refused (`out_of_bounds`, nothing written), and **the file is
schema-checked after the write like every edit** (the kind's own checks: a level's legend, a
room's tiles), refused with the same errors and left unchanged. `set` keeps its one-cell meaning.

**8. G12: per-kit rule ids (item 254).** A rule id may be **qualified, `kit:id`** (such as
`topdown:enemy-chase`), in a run file's `disableRules` and `guards`, in `--disable-rule`, and in
`mutants`' output; an **unqualified id keeps meaning the rule of the game's `kit`**, so every
existing run file stays valid and its hashes stay. A qualified id must name a kit in the game's
`kit` or `uses` and one of that kit's rules (`unknown_rule` otherwise, naming the kit's ids).
`HeadlessOptions` gains **`disabledRules` per kit**: `disabledRulesByKit?: Record<kit,
readonly string[]>` beside the existing flat `disabledRules` (still the main kit's, so games that
pass it on today are unchanged); a game routes each kit's list to that kit's `RuleSwitch` (the
platformer test's vault round already takes `disabledRules` through `roomChallenge`).
**`mutants` tries every rule of every kit the game uses**, and judges each kit's rules with **that
kit's own strictness** (`strictMutants` of the kit the rule belongs to): a weak rule of a strict
kit fails the command, a weak rule of a lenient kit is reported only.

**9. G31: a page-side step hook and `?replay=` (item 255).** `bootBrowserGame` gains a
**manual-loop mode**, chosen by the page's URL (`?debug=step`) or by the debugger: the fixed loop
does not run on `requestAnimationFrame`; instead the page exposes a small `window.__ww` debug API:
`step(n = 1)` (n fixed steps, then one draw), `tick` (the game ticks played), `hash()` (the
snapshot's hash, the tools' hash) and `snapshot()`; input comes from the replayed script, not the
keyboard, while it is set. A page also takes **`?replay=<run file path>`** (in dev and in the
debugger only; never in the Pages build, where the parameter is ignored): it loads the run file,
plays its input (and missions) through the real page step by step in manual-loop mode, so a
browser test or a person can replay a run file in the page and compare hashes with the headless
run. `tests/browser/platformer-test.test.ts` switches from replacing `requestAnimationFrame` to
the hook. Normal play is unchanged: without the parameter the loop runs as before.

**10. M19: recording a hosted round's input (item 256).** An **input recorder in `engine/core`**
(`input/recorder.ts`, pure): fed each frame's held actions, it writes `ScriptedInput` steps (one
step per change of the held set, `{ frame, hold }`), so playing the recording back gives the same
frames. The browser shell records a **hosted round** (the round `HostScene` pushes): from the
round's first tick to its end, frame 0 the round's first tick, as a `play` step's `input` is
written; the page offers it as text (copied out of the page with `window.__ww`, never stored by
itself). A new **`pnpm cli record <run-file> --mission <id> [--input <file> | --bot]`** writes a
recording into the run file's `missions` `play` step for that mission (its `input`), from a file
the page recorded or, with `--bot`, by stepping the hosted round with the kit's bot (what today's
throwaway script does), and then **verifies it by playing** the run file: the round must end in
the outcome the run file asserts; when it does not, the run file is left unchanged and the command
fails (exit 4). Recordings are frame input only (keys and pads); pointer taps stay D1's (0.15).

### Choices made

The decisions above are items 247-256; item 257 settled decision 8 for a strict `uses` kit (T5).
The builders' smaller choices are items 260-277 ("Engine 0.14, smaller build choices" in
`FEEDBACK-LOG.md`). The close-out's choices are items 258-259 ("Engine 0.14, close-out"):

- **The data-only scenario is the ridge camp** (item 258): a third entry of the mini siege's
  campaign rather than a scenario outside it, because a run file reaches a scenario only through
  the campaign (`start: { entry }` or `from`), so "added with data files only" includes the
  campaign line. It has no `from` (it starts as written, the dawn's save carries nothing into it),
  one delegated-only mission so the timeline has an opportunity, an open and a commit to show, and
  160 world ticks. The page plays it after the dawn (Continue: The ridge camp).
- **M37 fixed as a test change, in its own commit before the scenario** (item 258): the tests
  that pinned two entries now check that the siege and the dawn come first and read the rest from
  the campaign file, so the scenario's commit is data only and every commit passes the checks.
- **M38 moved, not fixed** (item 259): a stable mission index in save codes is a code format
  change (every pinned code moves), which belongs to the 0.15 API review with M31 and M35; the
  ridge camp's mission id sorts after the existing ones meanwhile.
- **A longer timeout for `engine/tools/world-data.test.ts`**: its `events` tests replay the mini
  siege's played run several times each, and one went over vitest's default 5 s while the whole
  suite ran on a busy machine (it passes alone in about 10 s for the file); the file sets
  `vi.setConfig({ testTimeout: 60_000 })` as the run-file tests did in 0.13 (item 233). No test or
  expectation changed.
- **No tag** (owner answer 24), and the root `package.json` version was left as it was.

### How to try it

```sh
pnpm -s cli run games/samples/mini-siege/runs/ridge-raid.run.json --json        # the data-only scenario
pnpm -s cli trace games/samples/mini-siege/runs/ridge-raid.run.json --paths named.ram.alive,sides.raiders.units --every 10
pnpm -s cli timeline games/samples/mini-siege/runs/ridge-raid.run.json         # the raid's window, open and commit
pnpm -s cli events games/samples/mini-siege/runs/ridge-raid.run.json --cause mission
pnpm cli debug games/samples/mini-siege/runs/ridge-raid.run.json                # the debugger page; open the URL it prints
pnpm -s cli debug games/samples/mini-siege/runs/ridge-raid.run.json --tick 160 --check --json
pnpm -s cli get games/samples/mini-siege/content/rooms/engine-camp.map.txt rows --ruler
pnpm vitest run tests/browser/debugger-done-when.test.ts tests/browser/debugger.test.ts engine/tools/debugger
```

A failing run prints its replay file and the line `pnpm cli debug <replayFile>`, which opens the
debugger at the failing tick with the failed check, the tick before and the timeline.

### Done when

Checked on 2026-11-03 on the tree of the close-out commit (on top of `909e239`), and checked
again in the finalize pass on top of `111a0d3` (2127 tests passed after the record fix's new
test; every run file, `validate`, `docs:check` and both Done when proofs below as before):
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass (189 test files, 2126 tests passed and 1 skipped:
the opt-in every-tick save check of 0.8), `pnpm docs:check` says the generated docs are up to
date, `pnpm -s cli validate` passes for all six games, and every one of the **50 run files** in
the repo (13 sim fixtures, 1 demo, 7 lab, 7 platformer-test, 4 skirmish, 14 mini siege and 4
tower-defense runs) exits 0 through `pnpm -s cli run`; `tests/runs/run-files.test.ts` runs each
twice with the same hashes against its golden file. The browser tests (`tests/browser`: 10 files)
ran in headless Chromium, none skipped.

- **Met: a new scenario added to the mini siege with data files only can be stepped through in
  the debugger.** `git show --stat 909e239` lists only
  `games/samples/mini-siege/content/` (the map, the mission, the campaign line),
  `games/samples/mini-siege/runs/` (the run file and its golden hashes) and docs; no `.ts` file in
  the game or anywhere else. `ridge-raid.run.json` passes `pnpm -s cli run ... --json` (final hash
  `91b8badf8fc51139`) and `tests/runs/run-files.test.ts` against its golden file.
  `tests/browser/debugger-done-when.test.ts` opens it in the debugger, steps forward to each
  hashed tick (0, 40, 80, 120, 160) and rewinds back to each, with the page's hash equal to the
  golden one and no mismatch at every stop, reads the state and the mission's events at tick 30
  (the ram burnt) with every check passing, and reads the timeline at 160 (the `stores-window`
  window offered and taken, the open, the commit `ram-burnt (delegated)`, the row
  `mission:stores-raid`), matching `pnpm cli timeline`'s record. `pnpm -s cli debug
.../ridge-raid.run.json --tick 160 --check --json` gives `matchesHeadless: true`,
  `mismatch: null`, 693 events kept.
- **Met: a failing replay from the CLI opens at its failing tick.** The same test copies the run
  to a temp folder with an assertion it cannot pass (the ram alive at tick 30), runs it with
  `run --json` (exit 4), takes `replayFile` from the result (its `start` kept, its
  `replay.failure` at tick 30 on `named.ram.alive`), and `debug <replayFile> --check --json`
  exits 0 with `tick` and `openTick` equal to `replay.failure.tick`, `reproduced: true`,
  `hashMismatch: null` and the failure read with `actual: false`; the page opens at tick 30 with
  `failure()` showing the check and `tickBefore` 29. `tests/browser/debugger.test.ts` (T11) does
  the same on the demo.
- **Scope: an in-browser simulation debugger** (the world state, the event log, stepping and
  rewinding through a replay; the same dumps and replay files the CLI writes): T10,
  `engine/tools/debugger/` (`debugger/model.test.ts`, `debug.test.ts`,
  `tests/browser/debugger.test.ts`: the state tree and diff, the event log with filters, stepping
  and rewinding with golden hashes on `delegated`, dump files opened read-only).
- **Scope: a timeline viewer** (world time, opportunities, when results were committed): T11
  (`debugger/timeline.test.ts`, and the played sabotage's frozen span, open and commit read and
  clicked in `tests/browser/debugger.test.ts`), fed by T7's timeline record
  (`engine/sim/timeline.test.ts`, `world-data.test.ts`).
- **G5, G8, G9, G10, G12 and G31 are fixed** (T2, T3, T4, T5, T6, T8), each row in
  [stacking-test.md](reports/stacking-test.md) with its commit; **M19 is fixed** (T9), its row in
  [mini-siege.md](reports/mini-siege.md) with its commit. The new mini siege gaps: M37 fixed
  (`46d5aed`), M38 moved to 0.15 and listed there. No row is `open`.
- **Out of scope kept out:** no editing in the debugger (it reads files and replays; it never
  changes a world or a file).
- **`engine/sim` stays headless and deterministic.** `pnpm lint` (purity and integer maths),
  `tests/architecture/dependency-rule.test.ts` and `purity.test.ts` are green. The `engine/sim`
  diff against `b1e21cf` is the timeline reader (`timeline.ts`, `timeline.test.ts`), the
  `missionPort`'s `events` and `timeline`, `changeSchema` exported from `save.ts`, the index's
  exports and `CLAUDE.md`: 6 files, no system or rule changed.
- **No golden hash moved in 0.14** (decisions 3 and 4): every hash file changed in the release
  is a new run file's (`level-2-start`, `level-3-start`, `level-4-start`, `mini-game-start`,
  `dawn-fresh`, `ridge-raid`); no pinned save code moved.
- **No tag** (owner answer 24).

### Fixes after the first close-out

- `9172c8b`: item 257 now records why decision 8's literal reading (fail on every unguarded rule
  of a strict `uses` kit) cannot pass yet: three tower-defense rules do nothing in the fortify
  round as its data stands. The code keeps item 257's reading until the owner answers.
- `c569365`: the debugger's `model.test.ts` timeline test and `trace.test.ts` get a 60 s timeout
  (item 277); both replay the mini siege in full and timed out under a loaded full run.
- `111a0d3`: `record --bot` drove the first round hosted in the run, so with an earlier round
  (fortify's walls before sabotage) the plan was checked against the wrong bot. It now starts on
  the first hosted tick after the target `play` step and stops when that round ends; a two-round
  case is in `record.test.ts`.
- The finalize pass: the checks, all 50 run files, `validate` for all six games and both Done when
  proofs rerun green (`debug .../ridge-raid.run.json --tick 160 --check --json`: hash
  `91b8badf8fc51139`, `matchesHeadless: true`); the smaller build choices are items 260-277.

### Deviations from the roadmap

- **None in scope.** Both Done when items and both Scope bullets are met as above.
- **The data-only scenario needed one test-only commit first** (M37): the game's tests pinned the
  campaign's length; no glue or engine code changed for it.
- **Decision 3's exit code for `no_world`** is 3 (T7, as the task asked), not 2.
- **Decision 6's `start: { stage }` is 0-based** as decided; the mini siege takes only
  `{ entry }` (no level sequence), refused `bad_start` otherwise.
- **Feedback numbering:** T1's decisions are 247-256; T5 added 257; the close-out added 258-259;
  the finalize pass added the smaller build choices, 260-277.
- **Smaller departures from the written decisions** (each an item): the hook is `worldEvents`
  (260), the RTS hooks live in the game's glue (262), `trace` has no `--events` yet (265), a bad
  `start` is exit 3 (266), `?replay=` was not built (`__ww.replay(json)` instead, 269), and world
  runs are not stepped in the debugger (273).

### Outstanding issues

- **M38: save codes are not stable under new missions** (moved to 0.15): until the API review a
  new mission's id must sort after the existing ones, or every pinned code moves and old codes
  misread.
- **D1 stays 0.15**: the recorder records keys and pads only; a round played by tapping cannot be
  recorded.
- **The debugger steps game runs only**: a world run opens as a dump file, read-only (decision 2);
  long rewinds re-simulate from tick 0 with every tick's record cached in the page.
- **Mini siege gaps waiting in 0.15**: M31, M32, M34-M36, M38 and the 15 from 0.11, with the
  stacking test's G17, G33, G36 and the tower-defense lessons, for the sample set's API review.
- **`trace --events`** (item 265) and a `?replay=` URL loader (item 269) are not built.
- Open owner decisions: items 247-277 in `FEEDBACK-LOG.md`.

## Engine 0.13

Heroes and consequences in the simulation. Built on branch `engine/build-0.15`; not tagged (no
tags during the build, owner answer 24). As in 0.9 to 0.12, the open questions were settled in
writing before any code (T1); the later tasks build against them. The release's goal is the
roadmap's: **losses that carry forward, supported by the engine so any game can use them**, proved
on the mini siege by a short second scenario that starts from the first one's results. The base
commit for the golden-hash and `engine/sim` checks is `6cf2eea265a46c76ede7144c4e7f0c9f9760d912`,
the head when T1 started: every hash that moves and every `engine/sim` change is measured against
it (decisions 1 and 2, and "Changes to `engine/sim`" below).

**Gaps assigned to 0.13 from earlier reports:** M13 (a mission round's hero taken from a world
unit, [docs/reports/mini-siege.md](reports/mini-siege.md), decision 4) and the 0.10 leftover
**campaign missions are checked, not played in order until 0.13** (Engine 0.10, Outstanding
issues, and the doc comment of `engine/core/campaign.ts`; decision 6). `grep -n "0\.13"` over
[docs/reports/stacking-test.md](reports/stacking-test.md) and
[docs/reports/tower-defense.md](reports/tower-defense.md) finds nothing else for 0.13: the
stacking test's only hit is G2's note that campaign missions are "checked only until 0.13" (the
same leftover), and the tower-defense report's hits are its summary line saying no gap moved to
0.12 and its format's list of releases a status may name. New mini siege gaps found during 0.13
continue the report's ids at M29 (M29 and M30 were found in T1).

### What was built

- **Decisions before code** (T1, `c3f3038`): fates, fate effects and follow-ups, fates in every
  mode, M13, carry-over, campaigns, save codes, the mini siege follow-up and run-file support,
  settled in writing (items 220-228, below); M29 and M30 added to the mini siege's gap report. No
  code changed.
- **Fates of named individuals in `engine/sim`** (T2, `69fe9ae` and `c42dc82`): `engine/sim/fate.ts`
  with the `Fate` component (`omitWhenEmpty`, on `Member` entities only; registered by both system
  sets), `fateOf`, `namedPeople`, `setFate` and the `injurePerson` / `capturePerson` /
  `killPerson` / `freePerson` writes: states only move forward, `history` is append-only, and a
  refusal (`fate_final`, `not_named`, `bad_id`, `bad_cell`, `stepping`) changes nothing. A captured
  or dead person leaves the map and their squad (the new squad helper `leaveSquad`) but stays in
  the world; `held` keeps a captive's `Unit` and `Owner` for `freePerson`. `deathSystem` moved to
  `fate.ts` and, in its own commit, keeps a named person who dies as a dead record (`rts.test.ts`'s
  "leaves its squad when it dies" now expects the record, as decision 1 listed). **Golden hashes
  re-recorded once, every assertion unchanged:** the raiders' named guards (Grell, Vosk) die in
  every mini siege run, so `quit` and `delegated` moved from game tick 180, `played` from 580,
  `fortify-played` from 200 and `fortify-delegated` from 100; no sim fixture and no skirmish run
  moved. The mini siege glue's `named` reads `alive` as "exists and not dead" and gains `fate` (M30).
- **Fate effects and capture follow-ups in the mission contract** (T3, `4e8d6a3`): the `fate`
  effect (`{ entity, fate, by?, at? }`, `at` required exactly on `freed`), applied at the commit
  with `setFate` under `mission:<id>`, an effect that cannot apply listed in `skipped`; `play`
  optional (a mission without it is a choice, only delegated: `not_playable` from `playMission`,
  `quitMission` and `MissionHost`); `openMission` refuses an outcome reopening its own mission's
  opportunity (`reopens_self`). The sim fixture `captive.world.json` (an ambush, then rescue,
  exchange, leave and ransom missions) and four run files with golden hashes (`capture-rescue`,
  `capture-rescue-failed`, `capture-exchange`, `capture-leave`), `mission-fate.test.ts`.
- **M13 and fates in every mode** (T4, `8f740e2`; the gap report's row in `cf5b6e8`):
  `mission-room`'s `hero: { select, hpPer }` (exactly one standing world unit, its round hp
  `ceil(Health.hp / hpPer)`; a captured, dead, missing or doubled hero refuses the round), the
  report's `worldHero` and the stats `hero` and `heroHpLost` (never the unit's last hp), and a
  `damage` effect's `fromReport` (the played report's stat at the commit; 0 skips it; the declared
  `amount` when delegated, quit or timed out). `engine/core` gained `fateState` and `isLost`; the
  topdown foe and hero selectors, the tower-defense wall and wave selectors and the RTS snapshot
  reading skip the captured and the dead by their `Fate`, the injured come in at their hp; the RTS
  view lists named people with their fate (`named`). `tests/kits/hero-mission.test.ts` plays a
  fixture world through `MissionHost` (played, played and lost, delegated, quit). No golden hash
  moved.
- **A scenario that starts from another's results** (T5, `7e13f73`): `engine/sim/carry.ts`, a
  scenario's optional `from` (the scenario it follows, a carry spec of named people by key and
  stockpile items by faction, `when` rules opening dormant opportunities for a carried fate);
  `carriedRecord(world, from, keys)` builds the plain JSON carried record from the first world's
  end, and `worldFromScenario(json, { carried })` applies it at tick 0 under the cause `carry`
  (`startFate`: a captured or dead person starts off the map, an injured one at their hp). Bad
  data fails with `ScenarioError` lines under `from` or `carried`. Fixture
  `captive-after.world.json`, `carry.test.ts`. `SCENARIO_VERSION` stays 1.
- **Campaigns played in order, campaign saves and save codes** (T6, `633cd0c`): campaign entries
  gain `{ scenario, ticks }` (`validate`: `missing_scenario`, `bad_from`); `campaignRun` and
  `advanceCampaign` over a plain JSON campaign save, closing the 0.10 leftover "campaign missions
  are checked, not played in order"; the carried record's schemas moved to
  `engine/core/carried.ts` (re-exported by `engine/sim/carry.ts`) so core can check a save without
  the sim; `save/campaign-store.ts` keeps a save under `ww:<game>:campaign:<id>` without ever
  throwing; `campaign-code.ts` packs a save into a versioned, CRC-16 checked Crockford Base32 code
  with refusals that change nothing. Run files gain `from` (`{ run }` or `{ code }`) and `codes`,
  the CLI gains `code <run-file>`, the headless contract gains `campaignSave()` and
  `HeadlessOptions.campaign`, and `rts-map` accepts `from`.
- **The mini siege: the captain as the round's hero, captured when driven off** (T7, `c2d6d43`):
  `sabotage` takes M13's `hero` (the captain, `hpPer` 20: his 120 hp start the round on the 6 half
  hearts it had), every outcome damages him by `heroHpLost` when played (10 declared for the three
  successes when delegated, 30 for `driven-off`), and `driven-off` also captures him by the
  raiders. The three sabotage runs' golden hashes were re-recorded (the opened mission's def is
  world data, so each moved from world tick 60; the fortify runs did not move); one assertion
  changed as content: `delegated`'s `named.captain.hp` at 160 is 110, was 120.
- **The mini siege's dawn follow-up headless** (T7, `f7e6c45`; the gap report in `a7bf8c5`): the
  campaign file `content/campaigns/siege.campaign.json` (the siege for 260 world ticks, then "The
  dawn assault" for 200), `content/maps/dawn.world.json` (its `from` carries the captain's fate and
  hp and the hall's gold), the sergeant Mara Venn, the rescue (a `mission-room` round with her as
  hero), exchange, ransom and leave missions. Thin glue: `siegeMap` by name, `siegeCampaign`,
  `siegeCampaignPlace`, `createGame`'s `opts.campaign`, `MiniSiegeGame.campaignSave()`. Run files:
  the siege's `played`, `delegated` and `quit` pin their save codes and assert the captain's fate
  (assertions added, none changed, hashes unchanged); `dawn-held` (from `played`) and
  `dawn-captured` (from `quit`); `dawn-code` (from `quit`'s save code); `dawn-rescue`,
  `dawn-rescue-failed`, `dawn-exchange` and `dawn-leave`. M29 and M30 fixed, M31-M33 logged.
- **The mini siege campaign in the browser** (T8, `37c3262`; the gap report in `2cd7560`): the page
  ends the siege at world tick 260 with a result panel (the outcomes, the captain's fate, the save
  code, kept in browser storage); Continue plays the dawn (the captive choices in the bar,
  **Decide** for a choice without a round, the shackle marker in the HUD); a typed save code
  resumes it, a refused code shows its reason. Shared parts: `CampaignSession` in
  `engine/core/shell`, the RTS kit's `captive` status, campaign entry `title`s, and screenshots of
  runs with `from` (M33 fixed). New art and sound: the sergeant, the shackle icon, three outcome
  sfx. Browser, page-glue and screenshot tests cover both captain fates and a save code; M34-M36
  logged.
- **Close-out** (T9, this commit): this log's sections below; the mini siege gap report closed for
  0.13 (M31, M34 and M35 moved to 0.15, a duplicated M36 row removed); 0.13 marked done in
  `docs/ROADMAP.md` and M31, M32 and M34-M36 listed in its 0.15 section; `docs/DESIGN.md` (heroes,
  fates, carry-over and save codes as built); `docs/CHEATSHEET.md` (fate effects, the carry spec,
  campaign scenario entries, save codes); `llms.txt` and `docs/modules/README.md`; a 60 s test
  timeout for the three test files that replay a siege before each dawn run (item 233); items
  229-233.

### Decisions

The roadmap's scope for 0.13 leaves open where a named person's fate lives in the world and what
it does to them, how a mission sets a fate and what a capture opens, how the kits read fates, how
a round's hero comes from a world unit (M13), how one scenario starts from another's results, how
a campaign is played and saved, what a save code holds, what the mini siege's follow-up is, and how
run files and the CLI start from another run. Each is a feedback item (220-228) the owner can
overrule by number. The 0.10 to 0.12 mission rules (a fixed world-time cost, append-only records,
fair delegation and no do-overs; items 150-151 and 154) hold unchanged and are the base the fate
rules build on. Exact file, field and function names are the later tasks', kept to these meanings.

**1. Fates of named individuals in `engine/sim` (item 220).** A new standard component, **`Fate`**,
`omitWhenEmpty`, held only by entities with `Member` (a named person; the unnamed rank and file of
a squad has no fate, it is the squad's `strength`). No `Fate` means **active**, so every world
that never sets one snapshots, saves and hashes exactly as before. Its data, all integers and ids:

```text
Fate { state: "injured" | "captured" | "freed" | "dead",
       by: <faction id> | null,    // who captured or killed them (null when not known)
       at: <world tick>,           // when the state was reached
       held: { Unit, Owner } | null,   // a captured person's map data, kept to free them
       history: [{ state, by, at, cause }] }   // every state reached, oldest first
```

- **States only move forward**: active or freed -> injured; active, freed or injured -> captured;
  captured -> freed; any living state -> dead; dead is final. Every other write (anything from
  dead, captured -> injured, injured -> active, a state to itself) is refused (`fate_final`) and
  changes nothing; from a mission's effect it is skipped and listed in `skipped`, never an error.
  `history` is append-only, so a fate once reached is never rewritten (a freed person captured
  again is a second capture in the history, not the first one undone).
- **Injured** is a label set by data (decision 2), never inferred from hit points: the hp is
  `Health`, which already carries. Battle damage alone does not injure anyone in 0.13.
- **Captured**: the person leaves the map. `Position`, `Unit`, `Task`, `Target`, `Cooldown`,
  `Facing8`, `Worker`, `Gatherer` and `EventMember` are removed; they leave their squad by the
  existing rule (strength - 1, off `members`, `captain` null when it was them; `Member.squad`
  null); `Member` and `Health` stay, and `held` keeps their `Unit` and `Owner` data so a later
  `freed` can put them back on a cell (`Owner` itself stays too, so the view never counts them
  for either side: everything that counts units needs `Unit` and `Position`).
- **Killed in battle**: `deathSystem` changes for `Member` entities only. A named person at 0 hp
  is no longer destroyed: they leave the squad as now, lose the same map components as a capture
  and get `Fate { state: "dead", by: null, at: tick }` (the attack system does not record who
  struck, and adding that is not needed for 0.13), under the cause `death`. Units and buildings
  without `Member` are destroyed exactly as before. A frozen person still does not die until the
  event unfreezes.
- Helpers in a new `engine/sim/fate.ts`: `fateOf(world, id)` (`active` when there is no
  component), `setFate(world, id, state, { by?, at?, cause })` returning `{ ok }` or a refusal
  (`fate_final`, `not_named`, `bad_id`), `freePerson(world, id, cell, cause)`, and
  `namedPeople(world)` (every `Member` with its fate, for carry and the glue's `named`).
- **Golden hashes.** `Fate` is `omitWhenEmpty` and is only written by a death of a named person
  or a fate effect, so a run moves only from the tick a named person dies. Of the base commit's
  golden files: the sim fixtures (`village`, `battle`, `siege` and their run files) have no named
  person who dies (the village squad has no `Unit` and the death system does not run there), so
  they must not move; the RTS skirmish's `battle` and `hold` runs and the mini siege's runs move
  only if their hero, the raiders' named guards (Grell, Vosk) or the captain reach 0 hp. **Any
  moved golden hashes are re-recorded once, in their own commit**, naming each file and the first
  tick it moved, with **every run-file assertion unchanged**. To keep `named.<key>.alive` true to
  its meaning, the mini siege glue's `named` reads `alive` as "exists and not dead" and gains
  `fate` (a captured person is alive with `x` and `y` null); a unit test that expects a dead
  named unit to be gone (`rts.test.ts`, "heroes leaving their squad on death") is changed to
  expect the dead record, and that change is listed in T2's commit.

_Why:_ the state of a named person is world data like everything else, so it is saved, hashed and
carried with no extra machinery; `omitWhenEmpty` keeps every earlier world's hash; dropping the map
components rather than adding a "hidden" flag means no system, kit or view has to learn to skip
anyone (they already only see units with `Unit` and `Position`); and keeping the dead as records is
what lets a later scenario, a save code and the page say who fell.

**2. Fate effects and capture follow-ups (item 221).** One new data-only effect in
`engine/core/missions.ts`, beside the five there are:

```text
{ "type": "fate", "entity": <key | id>, "fate": "injured" | "captured" | "freed" | "dead",
  "by"?: <faction id>, "at"?: { "x": int, "y": int } }   // `at` only (and required) for "freed"
```

It is applied at the commit under `mission:<id>` like the others, in the outcome's order (so
`damage` then `fate` hurts and then captures). An entity that is gone, not a `Member`, or whose
fate cannot move to the one named (decision 1) is skipped and listed in the record's `skipped`.
`freed` needs a free cell (`at`, enterable) and gives back the held `Unit` there; the person joins
no squad (a game that wants them back in one says so with a later effect, not in 0.13).

- **Capture opens follow-ups** with the existing `opportunity` effects, nothing new: an outcome that
  captures someone also opens dormant `relative` opportunities in one `exclusive` group, for
  example `rescue-window`, `exchange-window` and `leave-window`; taking one closes the others by
  the 0.10 rule. A rescue's outcome `freed` holds `fate: freed`; an exchange's single outcome holds
  an `inventory` payment and `fate: freed`; leaving them behind holds no fate effect at all (the
  capture stands for good, and the choice is in the committed records).
- **Missions with no round.** An exchange and a leave are choices, not games: `play` becomes
  optional in the mission schema, and a mission without it is **delegate-only** (`playMission`
  refuses `not_playable`; the page offers only "Decide", which delegates; its one outcome is
  certain). This is the only mission-lifecycle change of the release beside decision 4's.
- **No do-overs**, written into the mission and fate docs: a committed fate never changes back (the
  forward-only rule above and the append-only `history`); a failed rescue is an ordinary outcome
  whose effects may open a **different** opportunity (a `ransom-window` with a higher price) or
  none, never the same rescue again (an `opportunity` effect on one already taken is skipped, as in
  0.10, and `validate` refuses an outcome that opens its own mission's opportunity,
  `reopens_self`).

_Why:_ one `fate` effect with a state is smaller than four effect kinds and keeps the forward-only
rule in one place; follow-ups are already what opportunities are for (0.10 built the failure that
opens a rescue), so a capture needs no new mechanism; and making `play` optional is the smallest way
to let a choice be a mission with a record, a fixed world-time cost and a place in a save code.

**3. Every mode honours fates (item 222).** The kits keep reading only the plain snapshot (they
never import `engine/sim`); the snapshot now carries `Fate`. Rules, checked by each kit's tests over
a hand-written snapshot and by a fixture world:

- **`kits/topdown` (`mission-room`)**: foe and hero selectors skip any entity whose `Fate.state` is
  `captured` or `dead` (by the data, not only because those entities lack `EventMember`, so a
  selector without an event cannot pick them either); an `injured` or `freed` person is selected as
  normal at their current `Health.hp`, so `hpPer` gives them fewer round hit points.
- **`kits/towerdefense` (`td-defence`)**: the wall and wave selectors skip `captured` and `dead`
  the same way; an injured raider joins the wave at its reduced hp.
- **`kits/rts`**: the snapshot reading already counts and draws only entities with `Unit` (or
  `Building`) and `Position`, so the captured and the dead vanish from the view and from `sides`;
  T4 adds a test proving it and lists named people with their fate for the HUD (no drawing rule
  changes).
- A small pure helper for the shared test (`fateState(entity)` over a snapshot entity, `active`
  when there is no `Fate`) goes in `engine/core` (on `PURE_CORE`), so the three kits read it the same
  way without importing the sim.

_Why:_ "carried into every mode that loads them" means a mode can never bring back someone the world
has lost; doing it in the selectors (the one place each adapter turns world entities into round
pieces) is one rule per kit, tested once.

**4. M13: a round's hero taken from a world unit (item 223).** A `mission-room` mission's params gain
an optional **`hero: { select, hpPer }`**, with `select` the same selector schema the foes use:

- **In**: at the round's start the adapter finds exactly one entity the selector picks (none, two
  or more, or one `captured` or `dead`: the round does not start and the open is refused, with
  `checkUse` catching what it can at `validate`); the room's hero gets
  `max(1, ceil(Health.hp / hpPer))` hit points, replacing the `hp` param (still the default when
  there is no `hero`). An injured captain at 90 hp with `hpPer` 20 starts on 5.
- **Back**: the report gains `heroHpLost`, the world hp the round cost: `min(heroLost * hpPer,
Health.hp - 1)`. The round never kills the world person: death and capture are declared
  outcomes, never an accident of arithmetic. An outcome's `damage` effect may say where its amount
  comes from: `{ "type": "damage", "entity": "captain", "amount": 30, "fromReport": "heroHpLost" }`
  takes the record's report stat when the mission was played (0 skips the effect) and the declared
  `amount` otherwise.
- **Delegated** (and quit, and timeout): there is no report, so the commit uses the declared
  `amount`; delegation still draws only a declared outcome by its weight (item 154), and that
  outcome's effects are all declared numbers.
- The mini siege's `sabotage` gets `hero: { select: { faction: "village", member: "captain" },
hpPer: 20 }`, which gives the captain's 120 hp the round's present 6, so the recorded played round
  plays the same; each outcome gains a `fromReport` damage to the captain. If the recorded round's
  hero lost hit points, the `played` run's captain-hp assertions after the commit change: that is
  a content change made in its own commit with the old and new values, not a hash re-record.

_Why:_ of the three ways to bring the hp back (an amount from the report, an effect the adapter adds,
or a fixed effect plus stats), only the first keeps every effect declared in the mission file
(the adapter adding effects would put world rules in the kit) while still sending back what the
round really cost. It is the first, narrow piece of lesson D3 (effect amounts from a round's
report, moved to 0.15); 0.15's API review takes it as the model or replaces it.

**5. A scenario that starts from another's results (item 224).** A second scenario file names the
first with an optional **`from`** (an optional field, so the scenario format stays at version 1,
as `systems` did in 0.9):

```text
"from": { "scenario": "village",                     // the first scenario's content id
          "carry": { "people": ["captain"],         // keys whose Health and Fate carry
                     "stockpiles": [{ "faction": "village", "items": ["gold"] }] },
          "when": [{ "key": "captain", "fate": "captured",
                     "open": ["rescue-window", "exchange-window", "leave-window"] }] }
```

- **The carried record** is plain JSON built from the first world's end state by
  `carriedRecord(world, from)` in a new `engine/sim/carry.ts`:
  `{ format: "worlds-within/carried", version: 1, from, tick, people: { <key>: { fate, by, at,
hp, max } }, stockpiles: { <faction>: { <item>: n } } }`, every key sorted, integers only.
  A key the first world does not have, or a person who is not a `Member`, is an error naming the
  key; a key in `people` must also be a key of the second scenario.
- **Applying it**: `worldFromScenario(json, { carried })` builds the second world as now, then,
  under the cause `carry` at tick 0, sets each carried person's `Health` (capped at the second
  scenario's `max`) and `Fate` (a captured person leaves the map and a dead one is a record, by
  decision 1's rules; `freed` and `injured` stay on the map), replaces each carried stockpile
  item, and opens the `when` rules' dormant opportunities whose fate matches. Without `carried`
  the second scenario starts as written (its own default fates), so it is also playable alone.
- Only what the spec names carries: buildings, positions, the first world's raiders and its RNG
  do not. The seed of the second world is its own scenario's (or the run's).
- It lives in `engine/sim` (a scenario is the sim's format, and building a record reads world
  components); `engine/core` only carries the record as data.

_Why:_ a carry spec in data, in the file that reads it, says exactly what a sequel depends on, so
two first-scenario endings that differ only in the captain give records that differ only in the
captain, which is what the done-when needs; a plain JSON record is small enough to put in a save
code and to diff in a test.

**6. Campaigns played in order, and campaign saves (item 225).** The `campaign` content kind gains a
third entry kind, **`{ "scenario": id, "ticks": n }`** (a world scenario by content id and how many
world ticks it is played; a game may end it sooner by its own win or loss), beside `level` and
`mission`. Every scenario entry after the first whose scenario has `from` must name, in `from`, the
scenario entry just before it (`validate`: `bad_from`).

- **Play in order**: a pure `campaignRun(campaign, save?)` in `engine/core/campaign.ts` tracks the
  position and hands the game glue the next entry; a scenario entry ends at its `ticks`, giving the
  carried record for the next one. A mission entry right after a scenario entry is opened on that
  scenario's end world (played or delegated) and its record joins the results before the next
  scenario is built. A mission entry with no scenario before it keeps its 0.10 meaning (checked by
  `validate`, played by the kit that plays it), so the platformer campaigns are untouched.
- **A campaign save** is plain JSON: `{ format: "worlds-within/campaign-save", version: 1, game,
campaign, seed, position, carried (or null), results: [{ entry, missions: [{ mission, outcome,
resolution }] }] }`. It is written at each entry's end and kept in browser storage through
  `engine/core/save/storage.ts` under `ww:<game>:campaign:<id>` (wrapped so a blocked or private
  storage leaves the game playable without it). Its schema goes in `docs/reference/schemas.md`.

_Why:_ the campaign file already holds the play order as data (0.10, G2), so scenarios join it as a
third entry kind rather than a second order file; ending a scenario by ticks is the one rule that
needs no game code; and a save that holds only the carried record and the committed results, never
a whole world, is what makes a short save code possible.

**7. Save codes (item 226).** SMBC's lesson (`docs/SAVE_CODES.md` in the SMBC REMIX source): **the
code is the save**, no server and no account. A save code is the campaign save of decision 6,
packed:

- **Holds**, in order: the code version (4 bits), a CRC-16/CCITT (polynomial 0x1021, start 0xFFFF)
  over every other bit, the campaign (its index in the game's campaigns sorted by id), the position,
  the seed (a variable-length integer), the carried record in its carry spec's order (each person's
  state in 3 bits, `by` as an index into the scenario's factions, `at`, `hp` and each stockpile
  item as variable-length integers; key names are never written, the spec gives them), and the
  committed results (per committed mission, in commit order, the outcome's index in the mission
  file and the resolution in 2 bits), then zero padding to a whole character.
- **Alphabet**: Crockford Base32 (`0-9 A-Z` without I, L, O, U), groups of five joined by dashes;
  input ignores case, dashes and spaces, and reads O as 0 and I and L as 1.
- **Length budget**: at most 40 characters without dashes for the mini siege campaign at any
  position (about 130 bits at the end of the first scenario: 26 characters), asserted by a test.
- **Refusals** (`{ ok: false, code, error }`, nothing changed): `code_empty`, `code_typo` (a
  character outside the alphabet or a CRC mismatch: a tampered code is a typo), `code_newer` (a
  version above this build's), `code_layout` (bits left over that are not zero, or a field out of
  range), `code_campaign` (no such campaign in the game), `code_position` (past the campaign's
  end), `code_record` (the carried part does not fit the next scenario's carry spec).
- **"Restores the same world (equal hashes)"** means: the follow-up's start world (tick 0) built
  from a code taken at the end of the first scenario has the same state hash as the one built from
  the first world's carried record directly. A code does **not** replay the first scenario (its
  RTS orders are far too many for a short code); the end world of scenario one is the run's, the
  code holds what carries from it.
- The codec is pure and lives in `engine/core/campaign-code.ts` (on `PURE_CORE`), so the CLI, the
  pages and the tests share it.

_Why:_ SMBC shipped this format and found what matters: a checksum over everything so a typo is
never mistaken for a different save, forgiving input, and a version so old codes keep loading;
holding the carried record rather than the world is what keeps the code under a line.

**8. The mini siege follow-up (item 227).** Original content: **"The dawn assault"** (scenario id
`dawn`, `content/maps/dawn.world.json`). The morning after the siege, the raiders who fell back
regroup on the ridge east of the village and come again with a smaller band and no siege engines;
the village has its patched walls, its gold and whoever is left to lead it. A named sergeant,
**Mara Venn**, stands with the defenders in both cases (the rescue's hero, by decision 4).

- **The captain's fate in scenario one**: `sabotage`'s `driven-off` outcome (its quit outcome and
  one of its delegated draws) becomes `damage captain 30` then `fate captured by raiders`, and opens
  nothing in scenario one; every other path (`both-burnt`, `ram-burnt`, `catapult-burnt`, played
  or delegated) keeps him on the map. Of the base commit's run files only `quit` commits
  `driven-off`: its assertions up to the commit hold (the captain's hp is still 90 at 161, kept
  by `Health`); one after it (`named.hall.hp` 112 at 261) may move because the captain is off the
  map. If it does, that is a content change in its own commit, with the old and new value, listed
  as a decision.
- **How the fate changes the follow-up**: `dawn`'s `from` carries the captain (fate and hp) and the
  village's gold. **Active** (or injured): he is on the map at his carried hp and leads the
  defence. **Captured**: he is not on the map, the raiders hold him in their camp, and three
  opportunities open at tick 0 in one exclusive group: **rescue** (`rescue-captain`, a
  `mission-room` round in the camp, `ridge-camp`, with Mara as the hero; `freed` frees him at the
  hall, `failed` injures Mara and opens `ransom-window`, a dearer exchange, never the rescue
  again), **exchange** (`exchange-captain`, delegate-only, 80 gold and `fate freed`) and **leave**
  (`leave-captain`, delegate-only, no effects: he stays captured). **Dead** (if he fell in the
  first battle): he is a record, nothing opens.
- **Run files**: `dawn-held.run.json` (`from: { run: "played.run.json" }`) and
  `dawn-captured.run.json` (`from: { run: "quit.run.json" }`), the same seed, the same orders and no
  captive mission steps, so the only input difference is the carried record, and a test requires
  the two records to differ only in the captain's entry (his fate and the hp that goes with it).
  Their assertions show the follow-up playing differently (the captain fighting or absent, the
  hall's hp at the end). Separate run files cover `dawn-rescue`, `dawn-rescue-failed`,
  `dawn-exchange` and `dawn-leave`, and a save-code run (decision 9).

_Why:_ capturing the captain on the outcome that already says he was hurt is the smallest change
to scenario one and keeps every played success unchanged; a smaller second assault keeps the
follow-up short; and three captive choices (fight, pay, walk away) are the roadmap's rescue,
exchange and leaving behind, each a different kind of mission.

**9. Run files and the CLI (item 228).** A game run file gains an optional **`from`**, exactly one
of `{ "run": "<run file>" }` (the CLI plays that run first and builds the carried record from its
end world through the campaign's next scenario entry) and `{ "code": "<save code>" }` (decoded,
refused with decision 7's codes as a content error, exit 3); with `from` the run plays the
campaign entry after the one the source ended on, from tick 0. And an optional **`codes`**: `[{
"tick", "code" }]`, the save code the run's campaign save gives at that tick (`pnpm cli run` fails
on a different one, naming both). `pnpm cli code <run file>` prints the run's save code at its
last tick. `tests/runs` checks that `from: { run }` and `from: { code }` of the same first run give
the same tick-0 hash, which is the done-when's "equal hashes". A run file's `from` chain is at most
one deep in 0.13 (a `from` run that itself has `from` is refused, `from_chain`).

_Why:_ run files are how every claim in this repo is checked by an agent, so "starts from another's
results" and "a code restores the world" must be checkable from a run file; naming a run (rather
than a pasted record) keeps the record honest, since it is rebuilt from a real end world each time.

**Changes to `engine/sim` beyond fates and carry.** Three, each needed by a decision above:
`deathSystem` keeps a named person as a dead record (decision 1, part of fates but the one change
to an existing system); `playMission` refuses a mission with no `play` (`not_playable`, decision
2), and the commit takes a `damage` amount from the record's report when `fromReport` names a stat
(decision 4). Both mission changes are small and data-driven (no kit or game rule enters the sim),
and both are needed by the roadmap's scope: a capture's exchange and leave are missions without a
round, and M13's "hp back" needs the round's cost in the world. Each later task checks `git diff
--stat 6cf2eea -- engine/sim` before committing and lists any other change as a decision.

### Choices made

The decisions above are items 220-228. The close-out's choices are items 229-233 ("Engine 0.13,
close-out" in `FEEDBACK-LOG.md`):

- **M31 is moved, not fixed** (item 229): a carried faction whose stockpile is gone at the first
  scenario's end (the hall fallen, as in both fortify runs) still has no carried record, so
  `MiniSiegeGame.campaignSave()` gives none and the page offers "Play again". Carrying it as zeros
  is a small change in `carriedRecord`, but whether a lost hall ends the campaign is the game's
  rule, and today it would live in the glue either way; the sample set's API review (0.15) decides
  the carry rule and a campaign's loss rule as data together.
- **M34 is moved** (item 230): the dawn's captive choices stay offered from world tick 0 to 60 (6
  seconds on the page); a longer window would move every dawn run's golden hashes for a page
  concern, and the real fix (an entry held at tick 0 until the player begins it) is page flow that
  goes to 0.15 with M26 and M36.
- **M35 is moved** (item 231): the page ends an entry at its `ticks` or the first tick after with
  no mission open, while `campaignSave()` at a run's last tick leaves an open mission out. No run
  file or browser test ends with a mission open, so the two agree everywhere they are checked; one
  rule in `engine/core/campaign.ts` goes to the 0.15 API review.
- **How "two run files whose only difference is that defender's fate" is checked** (item 232):
  `dawn-held.run.json` and `dawn-captured.run.json` are the same run file except `from` (`played`
  or `quit`), so their only input difference is the carried record, and `mini-siege.test.ts`
  requires the two records to differ only in the captain's entry. The siege runs they start from
  differ in more than the captain (a played round against a quit one), but nothing of the siege
  except the carried record reaches the dawn (decision 5).
- **Longer test timeouts** (item 233): every `dawn-*` run replays its siege first, so on a busy
  machine (another agent's tests running alongside) seven run-file tests, two dawn tests and one
  parity test passed their work but went over vitest's default 5 s. `tests/runs/run-files.test.ts`,
  `tests/runs/backend-parity.test.ts` and `games/samples/mini-siege/mini-siege.test.ts` set
  `vi.setConfig({ testTimeout: 60_000 })`; no test or expectation changed.
- **More build choices for review** (items 234-246, "Engine 0.13, smaller build choices" in
  `FEEDBACK-LOG.md`, added at the finalize step): a dead fate from data also sets hp 0; battle
  deaths record `by: null`; `named.<key>.fate` listed only once set; sabotage's 10 captain damage
  on delegated success (one `delegated.run.json` assertion, 120 to 110); the `hero` rules (any
  event by default, no `hp` beside it, refused rather than a fallback, never a foe); the
  `fromReport` fallback to `amount`; leaving a captive behind has no fate effect; the dawn's
  balance (the raiders' plan reused, the captain dying in `dawn-held`, ransom 120 gold); a delegated
  `dawn-rescue`; the save-code layout details and lengths; campaign entries' `title` and the `'*'`
  content lookup; a `from` run playing on the save's seed (`seed_mismatch`); and the sergeant's
  `hero` look.
- **No tag** (owner answer 24), and the root `package.json` version was left as it was, as in
  earlier releases of this build.

### How to try it

```sh
pnpm dev                       # then games/samples/mini-siege/ from the launcher (or pnpm build && pnpm preview)
pnpm -s cli validate games/samples/mini-siege --json
pnpm -s cli run games/samples/mini-siege/runs/quit.run.json --json            # driven off: the captain captured
pnpm -s cli code games/samples/mini-siege/runs/quit.run.json --json           # its save code: 2VFP0-1P1T8-0M32N-PBJFC-J2A70
pnpm -s cli run games/samples/mini-siege/runs/dawn-held.run.json --json       # the dawn with the captain leading
pnpm -s cli run games/samples/mini-siege/runs/dawn-captured.run.json --json   # the dawn with the captain held
pnpm -s cli run games/samples/mini-siege/runs/dawn-code.run.json --json       # the same dawn from the save code
pnpm -s cli run games/samples/mini-siege/runs/dawn-rescue-failed.run.json --json   # a failed rescue, then the ransom
pnpm -s cli run engine/sim/__fixtures__/capture-rescue.run.json --json        # the sim's capture fixture
pnpm -s cli screenshot games/samples/mini-siege/runs/dawn-captured.run.json --tick 10 --json
pnpm vitest run engine/sim/fate.test.ts engine/sim/carry.test.ts engine/sim/mission-fate.test.ts engine/core/campaign-code.test.ts engine/tools/campaign-run.test.ts tests/kits/hero-mission.test.ts games/samples/mini-siege
```

On the page: play the siege as before; at world tick 260 a panel shows its result, Captain Hale's
fate and the save code. Give up the sabotage (Backspace in the round) to have the captain taken;
**Continue: The dawn assault** then shows the shackle in the HUD and, for 60 world ticks, the
choices **Break the captain out** (Play or Delegate, Sergeant Mara Venn as the hero), **Pay for the
captain** and **Leave the captain behind** (Decide). Type a save code into the box and press Resume
to start the dawn from it, or **Carry on** to continue the campaign this browser saved.

### Done when

Checked on 2026-11-03 on the tree of the close-out commit (T9, on top of `2cd7560`: docs and three
test timeouts): `pnpm lint && pnpm docs:check && pnpm typecheck && pnpm test && pnpm build` pass
(174 test files, 1955 tests passed and 1 skipped: the opt-in every-tick save check of 0.8), and every one of the **44 run files** in the repo (13 sim fixtures, 1 demo, 6 lab, 4
stacking-test, 4 skirmish, 12 mini siege and 4 tower-defense runs) exits 0 with the same final
hash on two `pnpm -s cli run` runs in a row. The browser tests (`tests/browser`: 7 files) ran in
headless Chromium as part of `pnpm test` and again alone (7 files, 21 tests), none skipped.

- **Met: losing a named defender changes how the follow-up plays, shown by two run files whose
  only difference is that defender's fate.** `dawn-held.run.json` and `dawn-captured.run.json`
  differ only in `from` (`played.run.json` or `quit.run.json`); `mini-siege.test.ts` ("carries
  records from the played and the quit siege that differ only in the captain's entry") requires
  their carried records to differ only in `people.captain` (`active` at 120 hp, or `captured` by
  the raiders at world tick 160 with 90 hp), and "plays differently when the only difference is
  the captain's fate" compares the two runs. Held, the captain is on the map at 120 hp, nothing
  opens, and the raiders are beaten by world tick 200 (final hash `6e309a2e804edc78`). Taken, he is
  off the map, the three captive choices are offered from tick 0 and close unused at 60, the
  village falls by 100 and five raiders stand at 200 (`beb1611ce699c5a0`). Their tick-0 hashes
  differ too (`94084ad90c496a17` and `4f59cf3f3a4af4f2`). Item 232 records how this is read.
- **Met: a save code taken at the end of the first scenario restores the same world (equal
  hashes).** `quit.run.json` pins its code at its last tick (`codes`: `2VFP0-1P1T8-0M32N-PBJFC-J2A70`,
  25 characters without dashes, under decision 7's budget of 40; `played` and `delegated` pin
  theirs too); `dawn-code.run.json` starts from that code (`from: { code }`) and has every hash of
  `dawn-captured.run.json` (`from: { run }`), from tick 0 (`4f59cf3f3a4af4f2`) to the final one
  (`beb1611ce699c5a0`), golden files included. `engine/tools/campaign-run.test.ts` ("starts from
  another run and from its save code with the same tick-0 hash") and `mini-siege.test.ts`
  ("restores the same world from the save code taken at the end of the siege (equal hashes)")
  check it directly; `engine/core/campaign-code.test.ts` checks round trips at every position, the
  length budget, forgiving input and every refusal (a tampered character is `code_typo`).
- **Scope: named individuals can be injured, killed or captured, carried into every mode that
  loads them.** `engine/sim/fate.ts` and `fate.test.ts` (forward-only states, append-only
  history, refusals that change nothing, a capture leaving the map and the squad, a named captain
  killed in battle kept as a dead record); the kits' selectors skip the captured and the dead
  (`kits/topdown`, `kits/towerdefense` and `kits/rts` tests over hand-written snapshots, and
  `tests/kits/hero-mission.test.ts` over a fixture world); a carried fate reaches the next
  scenario (`carry.test.ts`, the dawn runs); the page and the RTS view list named people with
  their fate.
- **Scope: capture opens follow-up opportunities (a rescue, an exchange, or leaving them
  behind).** The `fate` effect and choice missions without `play` (`mission-fate.test.ts`); the
  sim fixture's `capture-rescue`, `capture-rescue-failed`, `capture-exchange` and `capture-leave`
  runs; in the mini siege the `when` rule opening `rescue-window`, `exchange-window` and
  `leave-window` in one exclusive group, and `dawn-rescue`, `dawn-rescue-failed` (the dearer
  ransom, the rescue refused `not_offered` after it failed), `dawn-exchange` and `dawn-leave`; the
  page's browser test decides the exchange from the bar.
- **Scope: campaign saves and save codes.** `engine/core/campaign.ts` (`campaignSaveSchema`,
  `advanceCampaign`), `save/campaign-store.ts` (`campaign-store.test.ts`: a blocked storage never
  throws), `campaign-code.ts`, `shell/campaign-session.ts`, the CLI's `code` command and run files'
  `codes` (`campaign-run.test.ts`: a different code fails naming both);
  `tests/browser/mini-siege-page.test.ts` reads the save code off the result panel (equal to
  `delegated`'s and `quit`'s pinned codes), carries on from the stored save in a second page, and
  resumes the dawn from a typed code after refusing a bad one.
- **Scope: a way for one scenario to start from another's results.** A scenario's `from`
  (`engine/sim/carry.ts`, `carry.test.ts`, the fixture `captive-after.world.json`), and run files'
  `from: { run }` / `from: { code }` (`campaign-run.test.ts`, `from_chain` refused).
- **Scope: proved on the mini siege, a short second scenario that starts from the first one's
  results.** "The dawn assault" (`dawn.world.json`, 200 world ticks) after the siege in
  `siege.campaign.json`; the seven `dawn-*` runs and the browser tests above.
- **M13 is fixed** (T4, `8f740e2`): `mission-room`'s `hero: { select, hpPer }` and `fromReport`
  (`kits/topdown` tests, `hero-mission.test.ts`); the mini siege's sabotage plays the captain as
  its hero (T7, `c2d6d43`) and the rescue the sergeant. The gap report's row says so.
- **Campaign missions are played in order** (the 0.10 leftover, decision 6): `campaignRun` and
  `advanceCampaign` (`campaign.test.ts`), the page and the CLI playing the mini siege's campaign
  entry after entry; a mission entry with no scenario before it keeps its 0.10 meaning, so the
  platformer campaigns are untouched (their runs did not move).
- **The mini siege gap report has nothing left for 0.13**: M13 and M29, M30, M33 fixed; M31, M32,
  M34, M35 and M36 moved to 0.15 and listed there; no row is `open`.
- **`engine/sim` stays headless and deterministic.** `pnpm lint` (the layer table's purity rules:
  no `Math.random`, `Date.now` or `performance.now`, and the sim's integer maths rule, on
  `engine/sim` and on the new pure core files `campaign.ts`, `campaign-code.ts` and `carried.ts`),
  `tests/architecture/dependency-rule.test.ts` (no import from backends, kits or games) and
  `tests/architecture/purity.test.ts` are green; a grep finds no such import or call in
  `engine/sim`. Every fate, carry and campaign step is a write between ticks under a named cause
  (`death`, `mission:<id>`, `carry`), and the RNG is the world's own (the dawn's seed is the
  campaign save's, never the first world's RNG state). The `engine/sim` diff against `6cf2eea` is fates (`fate.ts`, the
  `deathSystem` change), carry (`carry.ts`, `scenario.ts`, `scenario-error.ts`), the two mission
  changes listed under "Changes to `engine/sim` beyond fates and carry" (`not_playable`,
  `fromReport`) plus the `fate` effect and `reopens_self` (decision 2), the squad helper
  `leaveSquad`, and their tests and fixtures: 31 files, no other change.
- **Golden hashes moved only where the decisions said**: the mini siege runs in T2 (named guards
  kept as dead records) and the three sabotage runs in T7 (the mission's new def), each in its own
  commit with every assertion unchanged but `delegated`'s captain hp (a content change, named).
  The sim fixtures, the skirmish, the platformer games and the tower-defense sample did not move.
- **No tag** (owner answer 24).

Checked again at the finalize step on `80f6774` (the fix below): the same checks pass (174 test
files, 1956 tests passed and 1 skipped), `pnpm -s cli validate` passes for all six games, and all
44 run files exit 0; `quit.run.json`'s code is unchanged (`2VFP0-1P1T8-0M32N-PBJFC-J2A70`). Every
item above is still met.

### Fixes after the first close-out

- **A run's `from` plays on its save's seed** (`80f6774`): a game run file with `from` now
  creates the follow-up world with the campaign save's seed, as the page does with a save code,
  so one code gives one world on the page and in the CLI. A run file whose own `seed` differs from
  the save's is refused as `seed_mismatch` at `seed` (`campaign-run.test.ts`; item 245). No golden
  hash moved: every `dawn-*` run already used the siege's seed 11.

### Deviations from the roadmap

- **None in scope.** Every Scope bullet and the done-when are met as above.
- **Decision 8's rescue room**: the rescue plays in the sabotage's `engine-camp` room, not a
  `ridge-camp` room of its own: a second `room` file would be a second dungeon to the topdown
  kit's one-dungeon check (M32, moved to 0.15).
- **Decision 5's home for the record's schemas**: the carried record's types and schemas live in
  `engine/core/carried.ts` (re-exported by `engine/sim/carry.ts`) so the save-code codec in core
  can check a record without the sim; building and applying a record stay in `engine/sim`.
- **A fallen hall gives no campaign save** (M31, item 229): the fortify runs, where the hall falls,
  cannot be carried into the dawn; the campaign starts over.
- **Feedback numbering:** T1's decisions are 220-228; the close-out added 229-233.

### Outstanding issues

- **Five mini siege gaps from 0.13 wait in 0.15** (M31, M32, M34, M35, M36), with the earlier 15
  there and the tower-defense lessons: the sample set's API review now has three reports to work
  through, and campaign page flow joins the launch flow (M26) as glue a second game would copy.
- **The captive window is short on the page** (M34): 6 seconds to choose.
- **A save code holds what carries, not the first scenario**: restoring from a code starts the
  next entry; it cannot show the first scenario's end world (decision 7).
- **Tests near the default timeout**: the dawn runs replay a siege each; the three files that run
  them have 60 s (item 233). A cached source run would make them fast if the number of `from`
  runs grows.
- Open owner decisions: items 220-233 in `FEEDBACK-LOG.md`.

## Engine 0.12

The tower-defense kit (the platform test). Built on branch `engine/build-0.15`; not tagged (no
tags during the build, owner answer 24). As in 0.9 to 0.11, the open questions were settled in
writing before any code (T1); the later tasks build against them. The release's test is the
roadmap's: **adding the new mode needs no change to `engine/sim`**, and every change it does need
is recorded as a lesson for the mission API before that API is fixed at 1.0. The lessons report
is [docs/reports/tower-defense.md](reports/tower-defense.md), started in T1 so every task can log
lessons as it finds them. The base commit for the `engine/sim` check is
`d6a102ab66f62c80e906ac979ece026dd781c415`, the head when T1 started (decision 10).

**Gaps assigned to 0.12 from earlier reports: none.** Neither
[docs/reports/stacking-test.md](reports/stacking-test.md) nor
[docs/reports/mini-siege.md](reports/mini-siege.md) moves any gap to 0.12: every `G` and `M` gap is
fixed or moved to 0.13, 0.14 or 0.15, and the only "0.12" in `mini-siege.md` is the line of its
format that lists the releases a status may name. The close-out (T9) confirms this is still so.

### What was built

- **Decisions before code and the lessons report skeleton** (T1, `f5b62d5`): the kit's shape and content
  kinds, the input model, the sample, the mini siege's preparation mission, its round and outcomes,
  the 0.11 hashes, the lessons report's ids and the `engine/sim` check, settled in writing (items
  197-206, below); `docs/reports/tower-defense.md` started and linked from `llms.txt`.
- **`kits/towerdefense`: content kinds and round rules headless** (T2, `6065a22`): the `td-map` (header plus
  `.map.txt` grid, one path walk from entry to exit checked with the cell named), `td-towers` and
  `td-waves` kinds; `TdWorld`, a fixed-order, whole-number round (place and pay, sell, waves by button
  or timer, spacing with seeded jitter, path walking in sub-cell units, first-along targeting with
  ranges and cooldowns, bounties, leaks and lives, won or lost); fourteen named rules, each changing
  a test when off; the kit hook (no strict mutants yet), the generated kit list and schema
  reference, and agent docs. No `engine/core` or `engine/sim` change was needed.
- **`kits/towerdefense`: controls, presentation frames and the headless game** (T3, `72f7ac8`): `TdControls`
  (the shared actions as a cursor with key repeat, place, cycle the tower type, sell and start the
  wave; pointer taps to cells through the frame's camera), `presentWorld` / `tdFrames` (frozen,
  schema-valid frames: the map, towers by type, enemies sliding along the path with facing and hp,
  shots, the cursor and an `ok` or `blocked` ghost, the HUD, and `td-*` events for skin sounds),
  `tdGame` (a `HeadlessGame` on frame input, snapshot `{ round, controls, kit }`), `tdRound` and a
  small deterministic `TdBot`. `TdWorld` gained one read-only helper (`waveLeft`). Lesson D1: taps
  cannot be recorded in a run file. No `engine/core` or `engine/sim` change was needed.
- **`games/samples/tower-defense` headless** (T4, `11131c1`): the standalone sample as data (one 16 x 15
  `td-map` with its `.map.txt` grid, arrow and cannon towers, three waves with a timer) plus
  `content.ts` and a one-call `headless.ts` over `tdGame`; four run files (`build`: refusals,
  buying and selling; `won`: towers placed with the cursor and every wave held; `target`: the
  cannon shoots the runner that overtook the brute; `leaked`: a thin defence, waves by the timer,
  the round lost) with assertions on gold, lives, wave and towers, sync hashes and golden files.
  Together they guard all fourteen kit rules, so the kit now opts in to strict mutants
  (`tests/runs/tower-defense-mutants.test.ts`). Each run's sync hashes leave out the ticks a
  guarded rule's mutant reaches with a changed state before a check fails (a hash mismatch is not
  a failed check). No `view` yet (T5). No `engine/core` or `engine/sim` change was needed.
- **The tower-defense sample's art, sound, skin and page** (T5, `c50a1e1`): original NES-style
  text sprites and palettes (`content/sprites/td.txt`: the cells, arrow and cannon towers idle
  and firing, runners and brutes, shots, the cursor, HUD icons; `td-font.txt`; the ghost's `td-ok`
  and `td-blocked` and a struck enemy's `td-hit` recolours), a Canvas2D skin keyed on the kit's
  kinds and tags, one-line MML sfx for the kit's `td-*` events and the song `road`. `view.ts` (the
  engine's `frameView`) for `pnpm cli screenshot`; `play.ts` (`TdPlay`: keys and the touch pad,
  taps through `TdGame.tap`, the bar's Wave, Tower and Sell buttons, 30 ticks a second with
  `TickInput` merging the loop steps' input), `main.ts` and `index.html` over `bootBrowserGame`
  with the shell's audio; the launcher lists the page (`tests/build/pages.test.ts`).
  `tests/browser/tower-defense-page.test.ts` plays the built page from the launcher's link by taps
  and by keys (`won.run.json` typed tick by tick), and `tower-defense-shots.test.ts` takes three
  deterministic screenshots. Lesson D2 (the page merges the input of the steps between ticks
  itself). No `engine/core` or `engine/sim` change was needed.
- **The `td-defence` mini game and a data-driven mission adapter** (T6, `700800b`):
  `kits/towerdefense/mission-defence.ts`, the `td-defence` `MiniGameDef` (`paramsSchema`,
  `checkUse` for the map, slot and outcome ids, `inputMap`, `hostStatus`, a `report()` of towers by
  type, gold spent, leaks, raiders killed and walls lost by world name) and the stateless
  `towerdefenseMissionAdapter`: walls from the world by selector onto the build cells (or the map's
  own), the gold from a faction's stockpile item (capped), the wave from world units by selector,
  lives from a param, ordered `when` rules (`result`, `leaksAtMost`, `spentAtMost`, `killed`) to a
  declared outcome, enemies tagged `foe:<name>`. `paramsDocs` puts the params in the schema
  reference. Tested over a hand-written snapshot and, in `tests/kits/td-mission.test.ts`, over a
  fixture sim world played, delegated, quit and live through `MissionHost`. Lessons D3-D8 (fixed
  per-outcome gold and losses, walls lost as the report's reading, world names, selectors
  `validate` cannot check, a mission map's wave list). No `engine/core` or `engine/sim` change was
  needed.
- **The mini siege's preparation phase headless** (T7, `2cb384e` for the content, the glue and
  the re-recorded 0.11 hashes, `5a99417` for the run files, tests and docs): the walls (`wall` and `wall-tower`
  building types; `north-wall`, `north-tower`, `south-wall`, `south-tower` in the village map, rows
  9 and 21, off the raiders' road so they are never the engines' nearest building), the walls'
  `td-map` (`content/defence/`, with its towers and the one wave list the kind needs, lesson D8),
  the `fortify` mission ("Man the walls", `td-defence`, cost 30) offered by `fortify-window` (world
  ticks 5-30), and the glue: `headless.ts` gives `MissionHost` the kit's `tdDefence` and
  `towerdefenseMissionAdapter` beside `mission-room`, `game.json` `uses` gains `towerdefense`, and
  `picture.ts` labels a hosted round with the mini game its mission plays. **The golden hashes of
  `played`, `delegated` and `quit` were re-recorded once, in their own commit** (decision 7): the
  village map gained four wall entities and a second opportunity, so every world snapshot moved
  from tick 0 (the squads' and the world-level entity's ids moved up by four). Every assertion of
  those three run files holds unchanged, the recorded sabotage round included, so only `hashes`
  and the `.hashes.json` files changed. Two new run files with golden hashes: `fortify-played`
  (a recorded 116-tick round, the kit's `TdBot` placing two archers, held for 40 gold:
  `held-cheap`, the hall's gold 150 to 110 and the four raiders destroyed at world tick 40) and
  `fortify-delegated` (seed 11 draws `overrun`: two walls destroyed, the towers, a soldier and the
  captain hurt), each asserting the battle frozen from 11 to 39, the commit at 10 + 30 and the
  battle afterwards; `mini-siege.test.ts` and `play.test.ts` cover both paths. Lessons D9 (the
  glue names the hosted mini game itself), D10 (walls joined to cells by order only) and D11 (two
  missions on one event exclude each other); D3, D4, D6 and D8 confirmed in the real game. No
  `engine/sim` change was needed.
- **The mini siege's preparation phase in the browser** (T8, `4aacf9b`): original art for the walls' round
  (`content/sprites/defence.txt`: the wall cell, the gate, the camp's road, archers and a ballista
  on the wall, idle and firing, shots, the cursor; the raiders, grass and road reused from
  `siege.txt`), three palettes (the ghost's `defence-ok` / `defence-blocked`, a struck raider's
  `defence-hit`), the round's skin `canvas2d-td-defence.json` (picked by `skinSet` from the mini
  game id), sounds for the `td-*` events and for each fortify outcome's commit
  (`mission-commit:outcome=...` in the battle's skin), and seven one-line MML sfx. The page's bar
  shows one launch button per offered mission (the RTS kit's `missionButtons`, opened through
  `launchMission`), so `Launch: Man the walls` from world tick 5 to 30; the Play-or-Delegate choice
  and `HostScene` are reused; pointer taps in the walls' round place and sell towers
  (`SiegePlay.roundTap`). `tests/browser/mini-siege-page.test.ts` plays fortify from the link
  delegated, by the recorded keys and by taps (each committing at 40) beside the 0.11 sabotage
  paths; the screenshot test adds the walls' round and the battle after `overrun`. Lessons D12
  (taps into a hosted round are copied page glue) and D13 (the cell-to-client mapping). No
  `engine/core` or `engine/sim` change was needed.
- **Close-out** (T9, this commit): the `engine/sim` check (empty), the lessons report finished
  (summary, every lesson moved to 0.15 or 1.0, the glue review and its D14), the lessons listed in
  `docs/ROADMAP.md`'s 0.15 and Engine 1.0 sections, 0.12 marked done, `docs/DESIGN.md` (the kit and
  both samples built, the platform test's result), `docs/CHEATSHEET.md` (booting a tower-defense
  game, a `td-defence` mission in `MissionHost`'s lists), `llms.txt` (the kit, both samples, the
  report) and `docs/modules/README.md`; this log's sections below; items 207-213.

### Decisions

The roadmap's scope for 0.12 leaves open the kit's shape and content, how a tower-defense round is
controlled and replayed, what the standalone sample holds, how the mini siege offers and plays its
preparation phase and writes its losses back, what happens to the 0.11 mini siege hashes when walls
join the map, how lessons are numbered, and how "the `engine/sim` diff is empty" is checked. Each is
a feedback item (197-206) the owner can overrule by number. Two rules are the owner's and are
restated, not open: **the preparation phase stays in the mini siege** (answer 19), and **the real
Siege's preparation phase is Worlds Within 0.1, not engine work** (the roadmap). The 0.10 and 0.11
mission rules (a fixed world-time cost, append-only records, fair delegation; items 150-151 and 154) hold for the new mission as for `sabotage`.

**1. The kit's shape (item 197).** `kits/towerdefense` (kit name `towerdefense`) holds its own
deterministic round rules, as `kits/topdown` and `kits/platformer` do: integer maths only (cells,
whole sub-cell units and whole ticks, no floats in the rules), every random choice through the
seeded `Rng` from `engine/core`, each gameplay rule a named rule (`TOWERDEFENSE_RULES` through
`defineRules`) that a run can switch off, and `strictMutants` opt-in once every rule is guarded by
a run file (so the kit starts without it and T4 turns it on when the sample's run files guard every
rule, or logs why not). The kit holds **no world rules** and **never imports `engine/sim`**: over a
world it reads only the plain data a mission's params and snapshot give it and reports what
happened (decision 6), and it never draws (it describes frames; backends draw them through a
skin). Its rules, as a start for T2 to name: enemies walk the path from entry to exit one step at
a whole-tick speed; a tower fires at the enemy furthest along the path within its range (squared
cell distance, ties by lowest enemy id) when its cooldown is up; a placement needs a build cell
with no tower and enough resource; a killed enemy pays its bounty; an enemy that reaches the exit
costs a life; the round is won when the last wave is cleared with lives left and lost at 0 lives.

**2. The kit's content kinds (item 198).** Three kinds, each a Zod schema in the kit, in
`docs/reference/schemas.md` through `pnpm docs:gen`, and checked by `pnpm cli validate`:

- **`td-map`**: a JSON header (`id`, `title?`, `legend`, `start` resource and `lives`, the tower
  types and waves it allows) plus a `.map.txt` text grid, as the platformer's `level` is. The grid's
  cells are path, build and blocked, with exactly one entry and one exit on the path; the path must
  be one connected walk from entry to exit (no branches in 0.12; a branching path is a later
  choice), checked at load with the file and the cell named.
- **Tower types** (`td-towers`, one file holding a table, like `rts-types`): per type `cost`,
  `range` (cells), `damage`, `cooldown` (ticks).
- **Waves** (`td-waves`, one file per wave list): each wave a list of groups `{ kind, count,
spacing (ticks), hp, speed, bounty }`, in file order.

The starting resource and lives are the map header's (`start`, `lives`), so one sample map is one
complete round. Exact file suffixes and field names are T2's, kept to these meanings.

**3. The input model (item 199).** A cursor on the grid, moved with the shared `Actions`
(`left`, `right`, `up`, `down`, one cell per press, repeating while held), and three buttons:
`jump` places the selected tower type on the cursor's cell, `attack` cycles the tower type, and
`start` starts the next wave. So `ScriptedInput` run files and a mission's recorded `play` input
(0.11 decision 1) replay a round exactly, with no new input kind. On the page, a pointer tap is
mapped to a cell (through the camera's screen-to-world maths) and moves the cursor there; a tap on
the cursor's own cell places. The tap reaches the kit as the same cursor move and place, so the
round's rules see one kind of input and replays stay frame input only. If `start` turns out to be
taken by the shell (pause), T3 picks another button and logs it.

**4. The standalone sample (item 200).** `games/samples/tower-defense/`, with `kit: towerdefense`
only: no `uses`, no world, no `engine/sim`. One `td-map`, two or three tower types (for example a
cheap short-range one and a dear long-range one) and a few waves (three or four), with original
NES-style text art, a Canvas2D skin and a short MML song (owner answer 22) in T5. Run files with
golden hashes, at least `won` (every wave cleared) and `leaked` (lives lost to a leak, the round
lost), plus any T4 needs to guard every kit rule for mutant checks. Agent docs and a module page
`docs/modules/games-samples-tower-defense.md` as for every sample.

**5. The mini siege's preparation phase (item 201).** It stays in the mini siege (owner answer
19). A second mission, `fortify` ("Man the walls"), is offered through a second opportunity,
`fortify-window`, open before the raid reaches the village (its window before or overlapping the
start of `sabotage-window`; T7 tunes the ticks), and launched through the RTS kit's existing
mission offers and launch command (`missionButtons`, `launchMission`, a `MissionHost` carrying it
out). Its event is the raid (`siege`), so the raiders are held while it is open, as in `sabotage`.
Its `play` is a new mini game from `kits/towerdefense`, `td-defence`, with a data-driven adapter
(`towerdefenseMissionAdapter`) built like the topdown kit's `mission-room` (0.11 decision 5): the
game writes no adapter code. Its params, all in the mission file:

- **The map:** a `td-map` giving the wall-side layout, whose build cells are the real walls: new
  `wall` building types in the mini siege's types and wall entities added to the village map, picked
  by selector (`{ faction?, types?, keys? }`, ascending id) into the map's build slots in reading
  order, as `foes` fill slots in `mission-room`.
- **The budget:** taken from a faction's stockpile item (`{ faction: "village", item: "gold" }`:
  the `Inventory` of the entity with that faction's `Stockpile`, the hall).
- **The wave:** taken from the real raider units by selector (`{ faction: "raiders", types?,
member? }`), each becoming an enemy of a named kind with hp from the world's `Health.hp`
  (divided by `hpPer` if given), in ascending id, spaced by a param.
- **Outcomes:** an ordered list of rules from the round's report (cleared or not, lives left,
  resource spent, which walls fell, which raiders were killed) to declared outcomes, the last with
  no `when`, as in `mission-room`; a rule naming an undeclared outcome is a `validate` error
  (`checkUse`).

The outcomes' effects are data only (0.10): `inventory` for the gold spent, `damage` or `destroy`
for walls, defenders and raiders, so the losses are written back to the world at the commit tick,
through the sim's existing mission commit and no new sim code. **A known likely lesson:** effects
carry fixed per-outcome amounts, so "the gold spent" can only be written back as the amount the
matching outcome declares (bucketed outcomes such as `held-cheap` and `held-dear`), not the amount
the round reports. If T6 or T7 hits it, it is logged as a lesson in the report (decision 9), not
fixed in `engine/sim`.

**6. The `td-defence` round and its report (item 202).** `td-defence` is a `MiniGameDef` with a
`paramsSchema`, `checkUse` and `report()`: `{ cleared, livesLeft, spent, towers: [{ slot, type
}], fallen: [keys], killed: [keys], ticks }`, with world keys mapped back from slots (as
`mission-room`'s `stats`), kept in the record's `stats`. A quit round goes to the mission's
`onQuit` without the rules. The kit lists the params with `paramsDocs()` so they appear in the
schema reference.

**7. The 0.11 mini siege run files once walls join the map (item 203).** The walls are added to the
one village map (`village.world.json`), not a second scenario: the preparation phase is meant to be
played in the same world as the raid, and a second scenario would leave the 0.11 runs testing a map
the game no longer plays. So T7 **re-records the golden hashes of `played`, `delegated` and `quit`
once, in its own commit, with the reason** (the map gained wall entities and a second
opportunity, so every world snapshot moves). Every assertion in those run files must still hold
unchanged (the frozen battle, the watchtower, the fixed commit tick, the outcome's effects, the
hall's hp); where the walls change the battle so an assertion cannot hold, the walls are placed off
the raiders' path rather than the assertion changed, and if that is not possible the change is
logged as a lesson with its reason. The delegated draw does not move (it depends on the seed and
the mission id only, item 154).

**8. Where the new mode's code lives (item 204).** The kit's round, content kinds, adapter and
presentation in `kits/towerdefense`; the wall types, wall entities, the `fortify` mission and its
`td-map` in the mini siege's content; the glue in `games/samples/mini-siege/headless.ts` and
`play.ts` only adds the new mini game and adapter to the lists it already passes to `MissionHost`.
Anything else the mode needs in `engine/core`, `engine/tools` or a backend is allowed but is logged
as a lesson (decision 9); anything it would need in `engine/sim` is not done in 0.12 unless there
is no other way, and then justified in the release notes (the roadmap's "or each change is
justified").

**9. The lessons report (item 205).** `docs/reports/tower-defense.md`, ids **`D1`, `D2`, ...**
(D for defence), never reused or renumbered, so they cannot be confused with task ids (`T1`...) or
the stacking test's `G` and the mini siege's `M` ids. Each row: id, what, where, whether
`engine/sim` needed it, and a status: `fixed in 0.12 Tn (<commit>)`, `moved to <release>` with the
reason, or `lesson for the 1.0 mission API`. Every task logs what it finds as it goes; the
close-out (T9) gives the summary.

**10. Checking that the `engine/sim` diff is empty (item 206).** At the close-out (T9), run
`git diff --stat d6a102ab66f62c80e906ac979ece026dd781c415 -- engine/sim` and `git log --oneline
d6a102ab66f62c80e906ac979ece026dd781c415..HEAD -- engine/sim` and record their (empty) output in
this log and the report. **No test is added for it:** a test pinned to a base commit needs the
full history (CI checkouts may be shallow), would mean nothing after 0.12, and the dependency rule
already stops kits from importing the sim. Each task also checks `git diff --stat -- engine/sim`
is empty before it commits, so a change is caught when it is made, not at the end.

### Choices made

The decisions above are items 197-206. The close-out's choices are items 207-213 ("Engine 0.12,
close-out" in `FEEDBACK-LOG.md`):

- **Where each lesson lands** (item 207): the build gave every lesson the status `lesson for the
1.0 mission API` (decision 9); the close-out names a release for each, as the roadmap asks of
  every report. Twelve go to **0.15**, the sample set's API review, which is where a kit or module
  API is last changed before v1 and where the mini siege's M6, M21 and M26 already wait (D1-D4,
  D6-D10, D12-D14). Two go to **Engine 1.0** as rules written down in the v1 docs, not changes: D5
  (walls lost are the report's reading) and D11 (one open mission per frozen event, the sim's rule
  since 0.10). D3 and D4 change how the sim's commit applies effects, so they wait for 0.15,
  outside the release whose test is an empty sim diff.
- **The glue review logs one more lesson** (item 208): D14, the round's key hints written as
  strings in each page's `main.ts` (`ROUND_HINTS` in the mini siege, `HINT` in the sample), moved to
  0.15 with M26. The rest of both folders is content, skins and thin glue.
- **The report's status format** (item 209): `lesson for the 1.0 mission API` is replaced by
  `moved to 0.15` or `moved to 1.0` with the reason, and each row names the task and commit that
  found it. The ids are unchanged (D1-D13 as logged, D14 new).
- **Played from a link, checked in a real browser** (item 210): the sample by
  `tests/browser/tower-defense-page.test.ts` (the launcher's link, then taps and the bar, and
  `won.run.json` typed on the keyboard tick by tick to `won` at tick 672), the preparation phase by
  `tests/browser/mini-siege-page.test.ts` (Launch: Man the walls, then Delegate, Play with the
  recorded round as keys, and Play by taps), each skipped where Chromium is missing.
- **Smaller build choices for review** (items 211-213): selling is on `special` (C, a right click
  or a long-press), which decision 3 did not list; the sample's page plays 30 ticks a second with
  the loop steps' input merged (D2) while a hosted `td-defence` round plays at the loop's 60; and
  the sample's sync hashes leave out the ticks where a guarded rule's mutant changes the state
  before a check fails, so `mutants` reports a failed check rather than a hash mismatch.
- **More build choices for review** (items 214-219, "Engine 0.12, smaller build choices" in
  `FEEDBACK-LOG.md`, added at the finalize step): the sample's balance numbers and the sell refund;
  `path_branch` and a map's own `legend` characters; the round's report using `result` instead of
  item 202's `cleared`; the `fortify` content (window, walls, wave, outcomes and weights); that
  fortifying alone does not save the hall; and one launch button per offered mission.
- **No tag** (owner answer 24), and the root `package.json` version was left as it was, as in
  earlier releases of this build.

### How to try it

```sh
pnpm dev                       # then games/samples/tower-defense/ or games/samples/mini-siege/ from the launcher (or pnpm build && pnpm preview)
pnpm -s cli validate games/samples/tower-defense --json
pnpm -s cli run games/samples/tower-defense/runs/won.run.json --json        # every wave held
pnpm -s cli run games/samples/tower-defense/runs/leaked.run.json --json     # a thin defence, the round lost
pnpm -s cli mutants games/samples/tower-defense --json                      # strict: every kit rule guarded
pnpm -s cli screenshot games/samples/tower-defense/runs/won.run.json --tick 300 --json
pnpm -s cli run games/samples/mini-siege/runs/fortify-played.run.json --json     # the walls held for 40 gold: held-cheap
pnpm -s cli run games/samples/mini-siege/runs/fortify-delegated.run.json --json  # seed 11 draws overrun
pnpm -s cli screenshot games/samples/mini-siege/runs/fortify-played.run.json --tick 90 --json   # the walls' round
pnpm vitest run kits/towerdefense tests/kits/td-mission.test.ts games/samples/tower-defense games/samples/mini-siege tests/browser
git diff --stat d6a102ab66f62c80e906ac979ece026dd781c415 -- engine/sim       # empty
```

On the sample's page: arrows move the cursor, Z or a second tap builds, X picks the tower, C or a
right click sells, Enter or the Wave button sends a wave; three waves, a minute or two. On the
mini siege's page: from world tick 5 to 30 the bar offers **Launch: Man the walls** (and from 20
the sabotage beside it); the raid freezes and the page asks **Play** or **Delegate**. Played, the
walls' round is a 16 x 7 map with the village's gold: tap or move to a wall, build archers or a
ballista, Enter sends the four raiders. Either way the result lands at the launch tick + 30.

### Done when

Checked on 2026-11-03 on the tree of the close-out commit (T9, on top of `4aacf9b`: docs only):
`pnpm lint && pnpm docs:check && pnpm typecheck && pnpm test && pnpm build` pass (165 test files,
1806 tests passed and 1 skipped: the opt-in every-tick save check of 0.8), `pnpm docs:gen` leaves
the generated references unchanged, and every one of the **33 run files** in the repo (9 sim
fixtures, 1 demo, 6 lab, 4 stacking-test, 4 skirmish, 5 mini siege and the 4 new tower-defense
runs) exits 0 with the same final hash on two `pnpm -s cli run` runs in a row. The browser tests
(`pnpm vitest run tests/browser`: 7 files, 18 tests) passed in headless Chromium, none skipped. Rechecked at the
finalize step (same date, on `256dcf8`): all checks, all 33 run files (twice, equal final hashes),
`pnpm -s cli mutants games/samples/tower-defense` (strict, nothing unguarded), `validate` of both
samples and the 7 browser test files green again, and the `engine/sim` diff and log against
`d6a102ab` still empty.

- **Met: the `engine/sim` diff for this release is empty** (decision 10). On the close-out's tree:

  ```text
  $ git diff --stat d6a102ab66f62c80e906ac979ece026dd781c415 -- engine/sim
  (no output)
  $ git log --oneline d6a102ab66f62c80e906ac979ece026dd781c415..HEAD -- engine/sim
  (no output)
  ```

  So no change needs a justification here. The rest of the engine changed by one line (the kit in
  `KIT_HOOKS`, `engine/tools/kit-list.ts`) and the content kinds' error-code list
  (`engine/core/content/CLAUDE.md`); no other kit and no backend changed. Recorded in the
  [lessons report](reports/tower-defense.md#summary) too.

- **Met: the tower-defense sample plays from a link.** `tests/browser/tower-defense-page.test.ts`
  (headless Chromium, the repo built as `pnpm build` builds it): the launcher links
  `games/samples/tower-defense/`; on one page two taps place an arrow tower (gold 30), the Wave
  button sends wave 1 and the tower kills runners for bounties; on another, `won.run.json`'s input
  typed on the keyboard tick by tick places the towers and holds every wave (`won` at tick 672,
  the status line "the road is held!"); no page errors. `play.test.ts` plays the same glue
  headless and ends on the run file's hashes.
- **Met: the mini siege offers the preparation phase.** `tests/browser/mini-siege-page.test.ts`:
  from the launcher's link, the bar's **Launch: Man the walls** at world tick 10, then Delegate
  (seed 11 draws `overrun` at world tick 40); Play with `fortify-played.run.json`'s recorded round
  typed as keys (116 round ticks while the world stays at 10, `held-cheap` at 40); and Play by
  taps (two taps build archers, gold 100 to 80, a right click sells, gold 90, Backspace quits to
  `overrun` at 40); beside the 0.11 sabotage paths (`ram-burnt` and `both-burnt` at 160); no page
  errors. The phase uses the real walls, gold and raiders and writes its losses back: the run files
  assert the hall's gold 150 to 110 and the four raiders destroyed (`held-cheap`), or both walls
  destroyed and the towers, a soldier and the captain hurt (`overrun`), and the battle frozen from
  world tick 11 to 39 with the commit at 10 + 30.
- **Met: every run file is green twice, with equal final hashes.** The new runs:
  tower-defense `build` (`c0f414299bc01881`), `won` (`9bbdc8413bc8a0e2`), `target`
  (`c007de2189d310be`), `leaked` (`48e726691354fd14`); mini siege `fortify-played`
  (`7ca0d45f21cdbf53`) and `fortify-delegated` (`bbbf38c22b5e249a`); each with sync hashes and a
  golden `<name>.hashes.json` (`tests/runs/run-files.test.ts`). The 0.11 mini siege runs were
  re-recorded once in T7 (`2cb384e`, decision 7) with every assertion unchanged: `played`
  `cf041e302c463035`, `delegated` `bfd7dcff687c580a`, `quit` `9f67b4035d3a86ff`. No other golden
  hash moved (for example `raid-partial` `60557f2e9c5e2245`, `battle` (skirmish)
  `588fe33bb3ecfcfd`, `level-4` `06201f9a779cc2fc`, as in 0.11). `pnpm -s cli mutants
games/samples/tower-defense` exits 0 with `strict: true` and every kit rule guarded.
- **Met: every change the new mode needed is recorded as a lesson for the mission API.**
  `docs/reports/tower-defense.md`: 14 lessons (D1-D14), none needing `engine/sim`, each moved to
  0.15 (12) or Engine 1.0 (2) and listed in that section of `docs/ROADMAP.md`; the glue review
  finds every file of the sample and every new mini siege file content, a skin, thin glue or a
  test.
- Scope items, each with its code and tests: `kits/towerdefense` (placing and paying, waves; the
  kit's tests, `tests/kits/towerdefense-validate.test.ts`, strict mutants); the standalone sample
  with its own original art (`content/sprites/td.txt`, `tests/browser/tower-defense-shots.test.ts`);
  the preparation phase on the real walls with real resources and a wave whose losses are written
  back (`kits/towerdefense/mission-defence.ts`, `tests/kits/td-mission.test.ts`, the fortify run
  files, `mini-siege.test.ts`). The real Siege's preparation phase stays Worlds Within 0.1.
- **No earlier gap was assigned to 0.12**: `docs/reports/stacking-test.md` and
  `docs/reports/mini-siege.md` are unchanged in 0.12.
- **No tag** (owner answer 24).

### Deviations from the roadmap

- **None in scope.** Each lesson is recorded and moved, not fixed, as the roadmap's test asks
  ("recorded as a lesson for the mission API before that API is fixed at 1.0").
- **Decision 3's "replays stay frame input only" holds for keys, not taps** (D1): a round played
  by tapping cannot be written as a run file yet; the browser tests check taps live.
- **Decision 5's losses are bucketed** (D3, D4): the world takes the declared outcome's fixed gold
  and losses, not the round's exact spending and fallen walls, which reach only the record's
  `stats`.
- **Selling** (`special`) was added to decision 3's buttons (item 211).
- **Feedback numbering:** T1's decisions are 197-206; the close-out added 207-213.

### Outstanding issues

- **14 tower-defense lessons are open in later releases**: 12 in 0.15 and 2 written down at 1.0
  (`docs/reports/tower-defense.md`); with the mini siege's 17 and the stacking test's 9 moved gaps,
  0.15's API review now has three reports to work through.
- **Two hosting games' page glue is now copied** (D9, D12, D13, D14, with M6, M21, M26): the
  sample set is where it moves into the engine or the kits.
- **Taps are not recorded** (D1): the browser tests are the only check of a tapped round.
- Open owner decisions: items 197-219 in `FEEDBACK-LOG.md`.

## Engine 0.11

The mini siege (multi-genre sample). Built on branch `engine/build-0.15`; not tagged (no tags
during the build, owner answer 24). As in 0.9 and 0.10, the open questions were settled in writing
before any code (T1); the later tasks built against them. The game's rules are in
`games/samples/mini-siege/CLAUDE.md`, and its agent page is `docs/modules/games-samples-mini-siege.md`.
The gap report is [docs/reports/mini-siege.md](reports/mini-siege.md), started in T1 so every task
could log gaps as it found them: 28 gaps, 11 fixed in 0.11 and 17 moved to 0.13, 0.14 and 0.15.

**Stacking-test gaps assigned to 0.11:** G13, G18, G19 (the rest), G27, G28 and G30, from
`docs/reports/stacking-test.md`. Their answers are decisions 6 to 10 below, and all six are fixed
in 0.11.

### What was built

- **Decisions before code and the gap report skeleton** (T1, `211b65d`): missions in game run
  files, live hosting, the step-through after a round, the RTS kit's missions, the data-driven
  adapter, the six stacking-test gaps and the scenario's shape with its checks, settled in writing
  (items 172-184, below); `docs/reports/mini-siege.md` started.
- **G18 and the rest of G19** (T2, `525d172`; report `5b7ca67`): `MiniGameDef.inputMap` and
  `RoundInput` (`engine/core/minigame.ts`), the one wrapper every host steps its round through, so
  a button held into a round is ignored until released; `MiniGameDef.hostStatus` copies host HUD
  keys into the round's frame as `host:<key>`. No golden hash moved.
- **G27 and G28** (T3, `4345818`; report `ede14c6`): `bootBrowserGame`'s `audio` option (the
  `AudioManager`, unlocked on the first key, tap or click, `onSound` for each display, `music`),
  and skin event keys `<type>:<value>` / `<type>:<field>=<value>` (`resolveSkinEvent`, both
  backends, checked by `validate`). The platformer test drops its own audio unlock.
- **G13 and G30** (T4, `7eebb3d`; report `b9ec82d`): a skin kind entry's `byTag` looks
  (`resolveSkinKind`, both backends; the 3D scene rebuilds an entity whose look changes) and an
  optional `look` on a platformer trigger entry (tag `look:<id>`). No golden hash or screenshot
  moved.
- **Missions in game runs and live hosting** (T5, `39e6161`; report `84289f7`): a game run's
  `missions` go to `HeadlessGame.mission?(step)`, a `play` step carrying the round's recorded
  input; `MissionHost` (`engine/core/mission-host.ts`) over a `MissionWorldPort` that
  `engine/sim`'s `missionPort(world, { refs })` fills: the round steps while the world waits, its
  end maps through `missionRoundEnd`, the world then steps on and the result commits at open tick
  plus `worldTimeCost`. `HostScene` pushes the round like any hosted round. Fixes M3.
- **Missions in the RTS kit** (T6, `e719108`; report `38ca700`): `readWorld` reads offers, open
  and committed missions and frozen events; `missionRequest`, `missionButtons` and
  `launchMission` (a request a `MissionHost` carries out); frames tag frozen units and buildings,
  mark an offer over its target and show the open mission's countdown; `RtsGame.refresh()`.
  Fixes M7 and M8.
- **A data-driven top-down mission adapter** (T7, `7676749`; report `69c14ce`):
  `kits/topdown/mission-room.ts`, the `mission-room` mini game and the stateless
  `topdownMissionAdapter`, configured by the mission's params (room, goal and limits, foes by
  selector into slot cells, ordered outcome rules, stats of what was destroyed and who was hurt);
  `MiniGameDef.checkUse` lets `validate` check the room, slots and outcome ids; `KitDef.paramsDocs`
  lists the params in the schema reference. The repo's siege tests hold no hand-written mapping.
  Fixes M9 and M11.
- **The mini siege headless** (T8, `d131978`; report `a2a7ac9`): `games/samples/mini-siege/`
  with the map, the types, the raiders' plan, the `sabotage-window` opportunity, the `sabotage`
  mission and its room; `headless.ts` joins the sim, the kit's `rtsGame` and a `MissionHost`; run
  files `played`, `delegated` and `quit` with golden hashes. The `rts-map` kind takes
  `opportunities` (M14) and `sidesOf` moves into the RTS kit (M15).
- **Art, music, skins and the playable page** (T9, `a1112b0`; report `35838ea`): original
  NES-style text sprites and palettes, a Canvas2D skin for the battle and one for the mission
  room, seven sfx and one short MML song; `view.ts` for `pnpm cli screenshot` (which now passes a
  run's mission steps, M22); `index.html`, `main.ts` and `play.ts`: pointer input, shell audio, the
  launch button from the kit's mission command and the play or delegate choice over `HostScene`.
  The RTS kit tags hurt units `damaged` (M24) and the mission room tags placed foes
  `foe:<name>` (M23); the page switches its picture itself (M6).
- **The close-out** (T10): the gap report's summary and glue review (M27 and M28 found there),
  every gap fixed or moved to a named release and listed in that release's section of
  `docs/ROADMAP.md`, the stacking test's counts, `tests/browser/mini-siege-page.test.ts` (the page
  played from its link on both paths in headless Chromium), `llms.txt`, `docs/CHEATSHEET.md` and
  this log.
- Agent docs: the 0.11 parts of `engine/core`, `engine/core/content`, `engine/core/present`,
  `engine/core/shell`, `engine/backends/canvas2d`, `engine/backends/three`,
  `engine/sim`, `engine/tools`, `kits/rts`, `kits/topdown`, `kits/platformer` and the new game in
  their `CLAUDE.md` files and module pages, the generated schema and CLI references and
  `docs/CHEATSHEET.md`.

### Decisions

The roadmap's scope for 0.11 leaves open how a mission is played from a game (not a world) run
file, how a mission is hosted live and how the world is stepped through the cost after the round
(0.10 decision 2 left both to the mini siege), how the RTS kit offers a mission, how a mission's
round is built from the world without adapter code in the game, the six stacking-test gaps, and the
scenario's shape. Each is a feedback item (172-184) the owner can overrule by number. Three rules are
the owner's and are restated, not open: **the mission is sabotaging siege engines** (answer 23), **a
mission's world-time cost is fixed when it opens and committed results never change** (0.10, items
150-151), and **delegating gives a fair, average result while playing gives choice, not a better
one** (item 154).

**1. Missions in game run files (item 172).** A game run file (`game`, not `world`) gets the same
optional `missions` list as a world run: `{ "tick": 40, "mission": "sabotage", "action": "open" |
"delegate" | "play" | "quit", "input"? }`, applied after the snapshot of `tick` and after that
tick's orders, in file order. Each entry is handed, without `tick`, to a new optional
`HeadlessGame.mission?(step)`, which returns null when the step was taken or a one-line reason when
it was refused (listed in the result's `refusedMissions`, and the run goes on, as with orders, item
136). A game without `mission` cannot play a run file with `missions` (a usage error, exit 2, as
with `orders`).

- `open`, `delegate` and `quit` mean what they mean in a world run (0.10 decision 12, item 163).
- **`play` carries the round's recorded input** (`input: { steps: [...] }`, the run file's
  `ScriptedInput` steps, frame 0 being the round's first tick) and no `outcome`: the step starts
  the mission's real kit round (the mini game its `play` names, built by the adapter from the
  snapshot the mission opened with), and the game's following ticks step that round with that
  script until it ends (decision 2). The outcome is whatever the round's report maps to through the
  adapter, so the played path goes through the real kit, the real report and the real adapter. A
  run checks it with assertions on the snapshot (the mission's record after the commit).
- On a game run, `outcome` and `experienceTicks` are schema errors (the round gives both); on a
  world run, `input` is. A world run keeps the load-time `mission_unresolved` check; a game run
  cannot (its world ticks are not its game ticks once a round is played), so there a late `play`
  or `quit` is refused at run time (`mission_overdue` or `mission_committed`, the sim's codes).

Reasons: one list in both kinds of run file keeps one vocabulary; a recorded round script relative
to the round's start keeps a run file editable when the open tick moves; handing the step to the
game rather than to the sim keeps the tools from knowing the game's world.

**2. Live hosting: `MissionHost` in `engine/core` (item 173).** A new `engine/core/mission-host.ts`,
`MissionHost`, wraps a game's `HeadlessGame` (the RTS kit's `RtsGame` in the mini siege) and hosts
its missions. It never imports `engine/sim`: it works through a port, `MissionWorldPort`, with
`open(def)` (returns the opened mission's plain snapshot and seed, or a refusal), `delegate(id)`,
`play(id, result)`, `quit(id)`, `settle()` (commit every due mission; `settleMissions`),
`snapshot()` (the plain world snapshot) and `step()` (the world's). `engine/sim` exports
`missionPort(world, { refs })` filling it, so a game's glue is one call; if that cannot be built in
the sim, the glue fills it and the mini siege report logs it as a gap.

- `MissionHost({ game, port, missions, miniGames, adapters })` is itself a `HeadlessGame` with
  `mission(step)` (decision 1), `launch(id)` (the live path: open, then the page asks play or
  delegate), `miniGame()` (the round hosted now, or null, so the shell's `HostScene` pushes the
  round's scene as it does for platformer rounds, G37) and `snapshot()`: the game's snapshot plus
  `missions: { round }` only while a round is hosted or on the tick one ends (as G20's
  `endedRound`), so a game that never hosts one keeps its hashes.
- **What a game tick does while a round is hosted: the round steps, the world does not.** The
  host's `step(input)` steps the round once (with the round's own input, decision 6) and does not
  call the game's `step`, so the scripted enemy does not think, no order is applied (an order or
  mission step at such a tick is refused: "a mission round is being played") and the world tick
  stays where it was. The round's ticks are the mission's experience time. When the round ends,
  the host maps its end through the adapter (`playMissionRound`'s checks, split so the round can
  be stepped tick by tick) and calls the port's `play` or `quit` on that tick.
- **Otherwise** the host calls the game's `step` (the enemy thinks, the world steps) and then the
  port's `settle()`, so a due mission commits at its fixed tick exactly as in a world run.
- The round's seed is `Rng.derived(world seed, "round:<mission id>")` (from the port), fixed by
  the seed and the mission id alone, as delegation's draw is (item 154).

Reasons: the mission lifecycle is the same for any game over the sim (an RTS map today, a
platformer level or a tower-defense map later), so the host is engine code; the port keeps
`engine/core` free of the sim, as `RtsWorldPort` does for the kit (item 122).

**3. Stepping the world through the cost after the round (item 174).** **One world tick per game
tick, through the game's ordinary step.** When a played round ends, nothing special happens to the
world: from the next game tick the host steps the game again (enemy, world, `settle`) one world tick
per game tick, and the result commits by itself at the fixed commit tick (open tick plus
`worldTimeCost`), with the event frozen until then. This is exactly what the delegated path does
from the moment it delegates, so the commit tick is the same and the world's state at every world
tick is the same as the delegated path's for the same outcome. The page shows the step-through
fast (it steps one world tick per loop step, 60 a second, instead of `TICKS_PER_SECOND`), which is
presentation only; the player may give orders during it, recorded at their world ticks as at any
other time. **Not all at once:** stepping the whole remaining cost in one game tick would have to
run the scripted enemy and the player's orders inside one tick (or skip them, giving other hashes
than the delegated path), and would hide the building going up.

- **Checkable:** a played game run's `world` snapshot hashes the same, at every world tick, as a
  world run file of the same scenario with `play` and that outcome at the same world tick (and the
  round's tick count as its `experienceTicks`, item 166); before the commit the battle's units and
  buildings are the same at every world tick as in the delegated run (only the mission's resolution
  differs).

**4. Missions in the RTS kit (item 175).** The kit shows offered missions and asks to launch one;
it holds no world rules and opens nothing itself.

- `readWorld` reads the snapshot's opportunity and mission state loosely (as it reads components):
  `view.missions = { offered: [{ opportunity, mission, closes }], open: [{ id, commitTick }] }`,
  empty when the world has none.
- `presentWorld` takes the mission defs the game hands it (`missions?`, titles only) and adds HUD
  status: `offer` (the first offered mission's title) and `offers` (how many), and while one is
  open `mission` (its title) and `missionLeft` (world ticks to its commit). Members of a frozen
  event get the tag `frozen`, so a skin can draw a held battle (decision 10).
- **The launch command:** `missionRequest(view, missionId)` gives a `MissionRequest { mission,
opportunity }`, or null when the mission is not offered now (kit rule `launch-needs-offer`, so
  a mutant check can switch it off). A request is not an order: the host (decision 2) carries it
  out with `launch`. `RtsControls.launchMission(id)` is the page's bar button. An interface action
  `{ "ui": "mission", "mission": "sabotage" }` drives the same path from a run file.

Reasons: offers are world state the sim already snapshots (0.10 decision 6), so the kit only reads
and shows them; a request object instead of a sim call keeps the kit off the sim.

**5. A data-driven top-down mission adapter in `kits/topdown` (item 176).** The kit exports a
mission mini game, `missionRoom` (id `mission-room`), with a `paramsSchema`, and
`topdownMissionAdapter`, the `MissionAdapter` that reads only the mission's `params` and the plain
world snapshot (`snapshotEntities`). The game writes no adapter code; `validate` checks the fields
through the schema (G16, item 157). The fields, all in the mission file's `params`:

- `room`: the id of a `room` content file giving the layout: walls, floor, the hero's `@` and foe
  slots, each a legend character a `foes` entry names.
- `goal`, `ticks`, `hp`: the round's goal, time limit and the hero's hearts, as `roomChallenge`
  takes them.
- `foes`: a list of `{ slot, kind, select: { event?, faction?, types?, member? }, hpPer? }`. Each
  entry picks world entities (by default members of the mission's `event`; then by `Owner`
  faction, unit type and squad `Member` role) in ascending id and puts them, as enemies of `kind`,
  into the room's `slot` cells in reading order. Room hp is the world's `Health.hp` divided by
  `hpPer`, rounded up (at least 1), or the kind's own hp without `hpPer`. More entities than slots
  refuses the round before it starts (`bad_mission_input`, and the mission stays open); spare
  slots stay empty.
- `outcomes`: an ordered list of rules `{ outcome, when?: { result?, destroyed?, spared?,
minDestroyed? } }`, where `destroyed` and `spared` name scenario keys (or ids) and
  `minDestroyed` counts the destroyed entities of the round. The first rule that holds names the
  outcome; the last must have no `when`, so every report maps. A rule naming an outcome the mission
  does not declare is a content error (`validate`). A quit round goes to `onQuit` (item 168) without
  the rules.
- The report's `defeated` and `hurt` room keys are mapped back to scenario keys and kept in the
  result's `stats` (`destroyed`, `hurt`, `heroLost`, `ticks`), so the record says what was
  destroyed and who was hurt.

Reasons: every top-down mission over an RTS world is "these world entities in this room, this rule
from report to outcome"; written as data it is the game's content, not its code (CLAUDE.md: game
rules in data files). It follows the 0.10 test's adapter (`tests/kits/mission-adapter.test.ts`),
which moves to this one.

**6. G18: a per-round input map (item 177).** `MiniGameDef` gets an optional `inputMap`, a partial
map from the host's actions to the round's (`{ "jump": "attack" }`; an action mapped to null is
dropped), applied to the frame before the round sees it. **A button held into the round is ignored
until released:** on the round's first tick every action already held is masked, and stays masked
until a frame without it. Both are one engine wrapper, `RoundInput` (`engine/core/minigame.ts`),
used by every host (`miniGameScene`, the platformer kit's host, `MissionHost`), so no game writes
it. A round started from a run file's `play` script starts with nothing held. Only a run file that
holds a button into a door can move: T2 re-records any such golden hashes and lists them; no other
hash may move.

**7. G19, the rest: an optional host status in the round's HUD (item 178).** `MiniGameDef` gets an
optional `hostStatus`, a list of the host's HUD status keys the round's frame shows; the host copies
them into the round frame's `status` as `host:<key>`, and the round's skin draws them like any other
status. Without it a stacked frame shows the round's HUD only, as decided in 0.7 (G19). The mini
siege's round shows `host:mission` (the mission's title).

**8. G27: audio in the shell (item 179).** `bootBrowserGame` takes an optional `audio: { sfx,
songs, music? }`: it makes the `AudioManager` with the game's sfx and songs, passes its `onSound` to
the displays, unlocks audio on the first key, tap or click, and plays `music` (a song id) once
unlocked; the settings (mute, volume) are the manager's own. The 8 lines in
`games/platformer-test/main.ts` go; the demo's boot moves when it becomes a sample (0.15, as
before).

**9. G28: result-specific event sounds (item 180).** A skin's `events` key may be `<type>:<value>`,
matching an event of `type` whose `result` field is `value` (`mini-game-end:pass`), or
`<type>:<field>=<value>` for another field (`mission-commit:outcome=both-burnt`). An event takes
the first matching field key in file order and falls back to the bare type, so every skin today
reads the same. `validate` checks the keys' shape.

**10. G13 and G30: trigger looks and frames by tag (item 181).** A platformer level's `triggers`
entry gets an optional `look` (an id), presented as the tag `look:<id>` on the trigger's entity (a
trigger without one gets no new tag, so no frame or hash moves). A skin's kind entry gets an
optional `byTag` list, `[{ tag, frames?, sheet?, palette?, mesh? }]`: the first entry whose tag the
entity has replaces the kind's frames (or mesh), and the state and facing are then picked inside it
as today. The platformer test game uses it for a second trigger look, the lab for its bump blocks
(`used`), and the mini siege for its construction site (the RTS kit's `site` tag) and frozen units
(`frozen`, decision 4).

**11. The mini siege's shape (item 182).** All of it is content in `games/samples/mini-siege/`
(original, no Worlds Within places, characters or art):

- **Map:** a 48 by 32 cell `scenario` (a 16-pixel tile, so the 256 by 240 picture scrolls with
  `RtsCamera`): the village on the west with a hall and a field of gold, open ground, the raiders'
  camp on the east.
- **Factions:** `village` (the player) and `raiders` (the scripted enemy, an `rts-enemy` plan).
- **Defenders:** four soldiers and a captain (a hero, item 121), members of the event `siege`.
  **Builders:** three workers, not members, so they keep working while the battle is frozen.
- **Attackers:** six raiders and two siege engines, a `ram` and a `catapult` (unit types with high
  attack and health, slow), all members of `siege`; the plan sends the engines at the nearest
  building and the raiders at the nearest enemy. They are the only units that attack buildings
  early on, so whether they survive decides what happens to the hall.
- **The building under construction:** a `watchtower` site beside the hall, built by the workers,
  whose work is set so it finishes inside the mission's cost when the mission opens on time.
- **The mission:** `sabotage`, "Burn the siege engines", taken through an opportunity offered from
  tick 20 to tick 200; event `siege`; `worldTimeCost` 120; played as `mission-room` (decision 5)
  with the engines in `E` slots, their guards (raiders with `Member` role `guard`) in `n` slots and
  the captain as the hero. Outcomes, with weights and effects (answer 23):
  - `both-burnt` (weight 1): destroy `ram` and `catapult`;
  - `ram-burnt` (weight 2): destroy `ram`;
  - `catapult-burnt` (weight 1): destroy `catapult`;
  - `driven-off` (weight 2, also `onQuit`): damage `captain` by 10.
    The adapter's rules: both destroyed, the ram, the catapult, otherwise driven off. Every effect
    says what the round did, so a played result never changes more than what happened in it.
- **Art and music:** NES-style pixel art as text, one short MML song, a Canvas2D skin for the map
  and one for the round (answer 22).

**12. What "changes the battle the way the design says" means, as checks (item 183).** Both paths
(played: a game run whose `play` script burns both engines; delegated: a game run that delegates,
with the seed's draw recorded and asserted) assert, in run files and a game test:

- **Frozen while open:** from the open tick to the tick before the commit, every member of `siege`
  keeps its position and hp (`sides`, and the event's units in the world snapshot).
- **The building keeps going up:** the watchtower's progress rises during the cost and it is
  finished by the commit tick (`sides.village.sites` 1 to 0, `buildings.watchtower` 1).
- **The cost is fixed:** the record's commit tick is the open tick plus 120 in both paths, however
  many round ticks the played run took; the event is unfrozen after it.
- **The result is structured and applied:** the record names the outcome and how it was resolved
  (`played` or `delegated`), its `stats` (played: what was destroyed and who was hurt), and exactly
  that outcome's effects are applied (for `both-burnt`, no `ram` and no `catapult` at the commit
  tick).
- **It changes the battle:** with both engines burnt, the hall's hp at the run's last tick is its
  full 400; in a run where the engines live (`driven-off`, by quitting the round), the hall has
  lost hp by that tick. The delegated run asserts whichever of these its drawn outcome implies.
  If T8's tuning cannot hold "full hp" (a raider strays to the hall), the check becomes "the hall
  has more hp than in the driven-off run" and the reason is logged in the gap report.
- **Same hashes every time:** golden hashes for each run file, and decision 3's cross-check with
  world run files.

**13. The gap report (item 184).** `docs/reports/mini-siege.md` follows the stacking test's format
with ids `M1`, `M2`, ... (never reused) so they do not mix with the stacking test's `G` ids; each
task logs what it finds as it goes, and the close-out (T10) fills in the glue review and moves each
open gap to a named release.

### Choices made

The decisions above are items 172-184. The close-out's choices are items 185-190 ("Engine 0.11,
close-out" in `FEEDBACK-LOG.md`):

- **How the decisions were built where they moved** (item 185): decision 4's kit rule
  `launch-needs-offer` and the interface action `{ "ui": "mission" }` were not added (the sim
  already refuses a mission no opportunity offers, M8, and a game run's `missions` `open` step
  drives the same `launchMission` path); decision 11's guards are raiders with squad role
  `regular` (roles are `regular`, `hero`, `captain`; M16) and the round's hero is the kit's, not
  the captain (M13); T8's tuning has `driven-off` damage the captain by 30 (not 10), and
  `ram-burnt` and `catapult-burnt` also damage the other engine by 40, so the delegated run's
  outcome visibly changes the hall's end.
- **The page steps the world at its normal rate after a round** (item 186): decision 3 said the
  page would show the step-through after a played round fast (one world tick per loop step);
  T9's page plays it at the battle's 10 ticks a second, so the player sees the watchtower finish
  and the result land. Presentation only: the hashes per world tick are the same either way.
- **The sim's siege fixture keeps its 0.10 mission file** (item 187, M12): moving
  `raid.mission.json` to `mission-room` re-records seven golden hashes for no new check (the repo
  tests already play it as a real `mission-room` mission); moved to 0.15 with M20, the other
  change that moves hashes.
- **Two gaps go to the release that owns their subject, not the sample set** (item 188): M13 (a
  world unit as the round's hero) to 0.13, heroes and consequences; M19 (recording a hosted round's
  input) to 0.14, the creator tools. The rest of the moved gaps stay with 0.15.
- **The glue review logs two more gaps** (item 189): M27, the sim-to-RTS-kit port bridge written
  in both RTS samples, and M28, the glue reading the sim's mission records and keyed entities;
  both moved to 0.15.
- **Play from a link, checked in a real browser** (item 190): `tests/browser/mini-siege-page.test.ts`
  builds the repo, finds the game in the launcher, and on two fresh pages clicks Launch at world
  tick 40, then Delegate, or Play with the recorded round typed on the keyboard; it skips where
  Chromium is missing, like the other browser tests.
- **Smaller build choices for review** (items 191-196, "Engine 0.11, smaller build choices" in
  `FEEDBACK-LOG.md`): what "held into the round" means and where the drop applies (four platformer
  mini-game unit tests let go for one tick); a look's frames replace the kind's whole, and
  platformer-test's new `switch` frame and brick bounce; the burnt engine drawn through a new RTS
  `damaged` tag and the frozen siege as a palette swap; the mini siege's balance numbers; the page
  pausing during the Play-or-Delegate choice and keeping the touch pad; the shell's `wake()` calls
  and lasting unlock listeners.
- The root `package.json` version was left as it was, as in earlier releases of this build.

### How to try it

```sh
pnpm dev                       # then games/samples/mini-siege/ from the launcher (or pnpm build && pnpm preview)
pnpm -s cli validate games/samples/mini-siege --json
pnpm -s cli run games/samples/mini-siege/runs/played.run.json --json      # played: both engines burnt
pnpm -s cli run games/samples/mini-siege/runs/delegated.run.json --json   # delegated: seed 11 draws ram-burnt
pnpm -s cli run games/samples/mini-siege/runs/quit.run.json --json        # quit at once: driven off
pnpm -s cli dump games/samples/mini-siege/runs/played.run.json --tick 566 --json   # the commit (world tick 160)
pnpm -s cli screenshot games/samples/mini-siege/runs/delegated.run.json --tick 80 --json   # the held battle
pnpm -s cli mutants games/samples/mini-siege --json
pnpm vitest run games/samples/mini-siege tests/browser/mini-siege-page.test.ts
```

On the page: from world tick 20 to 200 the bar offers **Launch: Burn the siege engines**; the
siege freezes (blue) and the page asks **Play** or **Delegate**. Play is the raiders' camp at night
(arrows, X strikes, Backspace gives up); either way the result lands 120 world ticks after the
launch and the status line names it. A whole game takes two or three minutes.

### Done when

Checked on 2026-11-03 on the tree of the close-out commit (T10, on top of `35838ea`: its docs
and the new browser test): `pnpm lint && pnpm docs:check && pnpm typecheck && pnpm test && pnpm build`
pass (152 test files, 1667 tests passed and 1 skipped: the opt-in every-tick save check of 0.8), and every one of the 27 run files in the repo (9 sim fixtures, 1 demo, 6 lab,
4 stacking-test, 4 skirmish and the 3 new mini siege runs) exits 0 with the same final hash on two
`pnpm -s cli run` runs in a row. Rechecked at the finalize step (same date, on `6faa771`): all checks
and all 27 run files green again, and the browser test passed in headless Chromium.

- **Met: the mini siege can be played from a link in a few minutes, by playing the mission and by
  delegating it.** `tests/browser/mini-siege-page.test.ts` (headless Chromium, the repo built as
  `pnpm build` builds it): the launcher links `games/samples/mini-siege/`; on one page the bar's
  Launch at world tick 40, then Delegate, commits `ram-burnt` at world tick 160; on another, Launch
  then Play with `played.run.json`'s recorded round typed as keys plays the 406-tick round while
  the world stays at tick 40, and commits `both-burnt` at 160; no page errors. A whole game is 260
  world ticks at 10 a second plus the round, two or three minutes. `play.test.ts` plays the same
  glue headless on both paths and ends on each run file's last hash.
- **Met: both paths change the battle the way the design says** (decision 12). Each run file and
  `mini-siege.test.ts` assert: the `siege` event frozen and its units keeping cell and hp at every
  world tick of the cost (the same in all three runs before the commit); the watchtower rising and
  finished by world tick 159 while the battle is held; the record at 160 = 40 + 120 however many
  round ticks were played (406 or 1); exactly the outcome's effects (`both-burnt`: no ram, no
  catapult; `ram-burnt`: no ram, the catapult at 60; `driven-off`: the captain down 30); and the
  hall at world tick 260: 400 played, 280 delegated, 112 quit. Decision 3's cross-check is in
  `mini-siege.test.ts` ("steps the world after the round as a world that resolved the same result
  at the open tick"): a fresh game given the played round's result through the world's port at
  the open tick, as a world run's `play` step does, hashes the same as the played game's world at
  the end, rather than a separate world run file.
- **Met: run files for both paths pass with the same hashes every time.** `played`
  (`25d3a40b93c9b076`), `delegated` (`0576a976323b2882`) and `quit` (`28863925b7cb91d1`) each pass
  with sync hashes every 20 ticks and a golden `<name>.hashes.json`, checked by
  `tests/runs/run-files.test.ts` and twice in `mini-siege.test.ts`; the close-out ran them, and
  every other run file, through `pnpm -s cli run` twice with equal final hashes. No earlier
  run file's golden hash moved in 0.11 (for example `raid-partial` `60557f2e9c5e2245`, `battle` (skirmish)
  `588fe33bb3ecfcfd`, `level-4` `06201f9a779cc2fc`).
- **Met: the gap report is committed, and each gap is fixed here or moved to a named later
  release.** `docs/reports/mini-siege.md`: 28 gaps, 11 fixed in 0.11 with their commits and 17
  moved (0.13: M13; 0.14: M19; 0.15: the other 15), each listed in that release's section of
  `docs/ROADMAP.md`; the glue review finds every file content, a skin, thin glue or a test.
- Scope items, each with its code and tests: the scenario as data (`content/`, `validate`, and
  `tests/architecture/no-content.test.ts`); one top-down mission loading the real defenders and
  attackers from the sim through the adapter (`kits/topdown/mission-room.ts`,
  `mission-room.test.ts`, `tests/kits/mission-adapter.test.ts`); played or delegated, with a
  structured result (the record's `report.stats.destroyed`) through the mission contract
  (`engine/core/mission-host.test.ts`, the run files); frozen battle, the building going up and
  the fixed cost (above); original art and one short song (`content/sprites`, `content/songs`,
  `tests/browser/mini-siege-shots.test.ts`).
- **Stacking-test gaps, all fixed in 0.11:** G18 and G19 the rest (`engine/core/minigame.test.ts`,
  `kits/topdown` and `kits/platformer` round tests), G27 and G28 (`engine/core/shell/shell.test.ts`,
  the skin event tests in both backends), G13 and G30 (`resolveSkinKind` tests in both backends,
  the platformer test game's `look:door`). `docs/reports/stacking-test.md` counts 28 fixed and 9
  moved.
- **No tag** (owner answer 24).

### Deviations from the roadmap

- **No `{ "ui": "mission" }` interface action and no `launch-needs-offer` kit rule** (item 185,
  M8): decision 4 named both; the sim's own refusal and the game run's `open` step cover them.
- **The round's hero is not the captain** (items 185 and 188, M13): decision 11 said the captain
  plays the room; that needs a world unit as the round's hero, moved to 0.13.
- **Decision 3's cross-check is in a game test** (above), not against a world run file: the mini
  siege's world is built by its glue (the types table spawned first), so a world run of the same
  scenario would need a second copy of that scenario file.
- **The page does not speed up the step-through** (item 186).
- **Feedback numbering:** T1's decisions are 172-184; the close-out added 185-190.

### Outstanding issues

- **17 mini siege gaps are open in later releases**: M13 (0.13), M19 (0.14) and 15 in 0.15
  (`docs/reports/mini-siege.md`), most of them a second copy a second mission game would write.
- **One mission game so far:** the shared parts of hosting a mission from a page (the battle or
  round picture, the events, the launch flow) are the mini siege's glue until the sample set's
  API review (M6, M21, M26).
- **The sim's siege fixture still plays its raid as `sabotage`** in its own run files (M12, 0.15).
- **Recorded experience ticks** (0.10, item 166) are still not written by a played round (M4).
- Open owner decisions: items 172-190 in `FEEDBACK-LOG.md`.

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
