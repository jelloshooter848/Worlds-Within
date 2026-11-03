# The API review (Engine 0.15)

Engine 0.15 ([ROADMAP, 0.15 The sample set](../ROADMAP.md#015-the-sample-set)) ends with a review of
every kit and module API against what the five samples needed, **the last chance to change them
before they are written down as v1** (internal, owner answer 16). Its form is decision 14 of
[BUILD-LOG.md, Engine 0.15, Decisions](../BUILD-LOG.md#decisions) (item 291): one section per module,
the entry points the samples use, what each sample had to copy or work around, and a verdict for
each change: **kept**, **changed in 0.15** (with the commit) or **listed for 1.0** (with what the v1
docs must say, or what change waits and why). The roadmap's Done when ("the API review is written
up with every change it calls for either made or listed for 1.0") is checked against this page.

The five samples, all in `games/samples/`:

| Sample          | Kits                                             | Over `engine/sim` | Glue (`.ts`, not tests) | Its report                                     |
| --------------- | ------------------------------------------------ | ----------------- | ----------------------- | ---------------------------------------------- |
| `dungeon`       | topdown                                          | no                | 353 lines               | none (this review holds its findings)          |
| `platformer`    | platformer, topdown (its doors' rounds)          | no                | 295 lines               | [stacking-test.md](stacking-test.md) (`G` ids) |
| `rts-skirmish`  | rts                                              | yes               | 959 lines               | none (this review holds its findings)          |
| `tower-defense` | towerdefense                                     | no                | 333 lines               | [tower-defense.md](tower-defense.md) (`D` ids) |
| `mini-siege`    | rts, topdown and towerdefense (its two missions) | yes               | 861 lines               | [mini-siege.md](mini-siege.md) (`M` ids)       |

**How it was made.** Every `import { ... } from '@engine/...'` and `'@kits/...'` in the samples'
`.ts` files (and the one dynamic `import('@engine/backends/three')`) was listed against each
module's exports (a throwaway script over the TypeScript compiler's export lists: a module's
`index.ts`, or for an `engine/core` folder without one, every file in it). The appendix holds the
result for every module: each export a sample imports, by sample, and every export none imports.
Then each sample's glue was read against the others' for code written twice (the grep is in
"Duplicated sample glue" below), and the 38 gaps assigned to 0.15 and the three reports' rows
were checked again.

## Summary

- **Every 0.15 gap is fixed, with its commit**: G17, G33, G36 (stacking test), M1, M2, M4, M5,
  M6 (the rest), M10, M11 (the rest), M12, M16, M17, M18, M20, M21, M25-M28, M31, M32, M34-M36,
  M38 (mini siege), D1-D4, D6-D10, D12-D14 (tower defense); the table "Where each 0.15 gap
  landed" below. **No gap row in the three reports is left assigned to 0.15** (cross-checked in
  T15; G33's row gained its commit, `867c454`).
- **The review found ten more** (`A1`-`A10`, below), each seen in more than one sample or in an
  API name a v1 document would fix in place. **Five were fixed in T15's commit** (A1, A2, A3, A9,
  A10: small, no hash moved) and **five are listed for 1.0** (A4-A8: each touches many files or
  wants a new shared piece shaped with care), in the ROADMAP's Engine 1.0 section.
- **Listed for 1.0** in all: the five findings above, D5 and D11 as v1 documentation rules
  (decision 14), M2's two-tag look (decision 3), M4's `experienceTicks` meaning in the v1 docs
  (decision 9), and the v1 docs' public surface per module (the appendix shows most exports are
  used by no sample; the v1 docs say which are the API). Eleven items, `1.0-1` to `1.0-11` in
  "Listed for 1.0" below and in the roadmap.
- **Kept as they are**: every other entry point the samples use. The contracts held across five
  games and four kits: the headless contract and run files, the presentation contract and skins,
  the shell's boot, the mission contract and `MissionHost`, campaigns and save codes, and each
  kit's content kinds and named rules needed no reshaping beyond the 0.15 gaps.

## New findings (A1-A10)

Ids `A1`, `A2`, ... are this review's and are never reused. A finding is code two samples wrote
the same way, or an API shape a sample had to work around, that is not already a `G`, `M` or `D`
row.

| Id  | What                                                                                                                                                                                                                                                                                                                                                                                                                         | Where                                                                                                                         | Status                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Every sample (and the platformer lab) wrote "this backend's skin, or throw naming the file": `skinSet(content, backend)` and an `if (!main) throw ...` in five places.                                                                                                                                                                                                                                                       | `games/samples/*/content.ts`, `picture.ts`; owner `engine/core/present/skin-set.ts`                                           | **fixed in 0.15 T15** (this review's commit): `mustSkinSet(content, backend, who?)` (`FoundSkinSet`, `main` required) in `engine/core/present`; all five samples and the lab use it                                                                                                                          |
| A2  | The dungeon loaded its content kinds by hand (`engineContentKinds().register(roomKind())`, not the kit hook's `kitContentKinds([topdown], manifestOptions(files))` every other sample uses since G4 and G17) and kept its own copies of `contentSongs` and `contentSfx` (`dungeonSongs`, `dungeonSfx`).                                                                                                                      | `games/samples/dungeon/content.ts`                                                                                            | **fixed in 0.15 T15**: the dungeon loads through `kitContentKinds` and uses the engine's `contentSongs` / `contentSfx`; `dungeonKinds`, `dungeonSongs`, `dungeonSfx` are gone                                                                                                                                |
| A3  | The platformer sample's glue kept the stacking test's names (`loadTest`, `testStages`, `testLook`, `TestGame`, ...), so the worked example of a platformer game reads as a test.                                                                                                                                                                                                                                             | `games/samples/platformer/*.ts`                                                                                               | **fixed in 0.15 T15**: renamed to `loadHopper`, `hopperStages`, `hopperRooms`, `hopperSkins`, `hopperLook`, `hopperLook3d`, `hopperFrames`, `hopperPicture`, `hopperCanvasPicture`, `hopperMiniGames`, `HopperGame`, `HopperSnapshot` (the sample is Hopper's Way); its docs follow                          |
| A4  | The topdown kit's `Td*` prefix (top-down) collides with the towerdefense kit's (tower defense): both export `TdEvent` and `TdPresentState`, with different meanings; the mini siege imports both kits and avoids it only by importing neither name.                                                                                                                                                                          | `kits/topdown` (`TdPresentState`, `TdEvent`, `TdEntity`, `TdHero`, `TdSnapshot`, ...), `kits/towerdefense`                    | **moved to 1.0** (`1.0-5`): rename the topdown kit's exports to `TopDown*` before the v1 docs name them. It touches every topdown file and test, the dungeon, the platformer and mini siege glue, the backend parity test and the scaffold skill: more than this review's commit should carry                |
| A5  | Three views hand-write what `frameView` gives (a picture made once per renderer, the events kept between draws): the dungeon (`DungeonPicture` over its world), the RTS skirmish (`game.rts`, no events) and the mini siege (the host's events, `siegeFrames(content)`). `frameView` takes a `HostedGame` (`world`, `events`), and these games' frame source is not their `world`.                                           | `games/samples/{dungeon,rts-skirmish,mini-siege}/view.ts`; owner `engine/core/view.ts`                                        | **moved to 1.0** (`1.0-6`): `frameView` takes the source to draw (`source(game)` and the events to keep) as an option, and the three views become one call, as the platformer's and tower defense's are                                                                                                      |
| A6  | The two RTS pages carry the same page scene: an `RtsCamera` over the whole map started on the player's base (`homeOf` in the skirmish, the hall in the siege), the kit's `RtsControls`, pointer gestures read every loop step and the world stepped every `STEPS_PER_TICK` loop steps by a counter of their own (not the shell's `Scene.tickRate` of D2, because the pointer is read every loop step).                       | `games/samples/rts-skirmish/play.ts`, `games/samples/mini-siege/play.ts`; owner `kits/rts` (controls) and `engine/core/shell` | **moved to 1.0** (`1.0-7`): a scene that reads input every loop step and steps its game at a rate (a `Scene.tickRate` with a per-step `pointer` hook) and an RTS page helper in the kit (camera over the map from a home point, controls, buttons); with the two pages to compare it is a design, not a move |
| A7  | Each page gives browser tests its own hook (`window.wwSkirmish`, `wwTd`, `wwSiege`) beside the shell's `window.__ww` (tick, `snapshot()`, `hash()`, `toClient`), with the tick and the snapshot in both.                                                                                                                                                                                                                     | `games/samples/{rts-skirmish,tower-defense,mini-siege}/main.ts`                                                               | **moved to 1.0** (`1.0-8`): the v1 docs name `window.__ww` as the page's hook for scripts; a page's own hook keeps only what the shell cannot know (the bar, the selection, exports), and the browser tests read the rest from `__ww`                                                                        |
| A8  | A standalone game's end has no shared shape: the dungeon's own `DungeonScene` (an end held for `END_HOLD` steps, Z for a new run with a new seed, the escape song) with its status lines drawn by `debugText` in glue; the skirmish's end screen is DOM in `main.ts` and its banner a HUD icon; the tower defense shows its end in the status line. The mini siege's is the shell's `MissionLaunch` result panel (M26, M36). | `games/samples/{dungeon,rts-skirmish,tower-defense}`; owner `engine/core/shell`, skins                                        | **moved to 1.0** (`1.0-9`): a game-end flow in the shell (a `HostScene` option: the end read from the game, the banner, Play again with a new seed) and text items in a skin's HUD, so no glue draws text; three samples to compare, so it is shaped with them                                               |
| A9  | The RTS skirmish's recorder hashed snapshots with its own Web Crypto copy of the state hash (`stateHashOf`, asynchronous), though the core's `stateHash` (`engine/core/state-hash.ts`, 0.14 T8) is the same hash, synchronous, in plain TypeScript, and is what the tools and the page's step hook use.                                                                                                                      | `games/samples/rts-skirmish/recording.ts`                                                                                     | **fixed in 0.15 T15**: `BattleRecorder` uses `stateHash`; `stateHashOf` is gone (its test now checks `stateHash` against Node's crypto). No hash moved                                                                                                                                                       |
| A10 | Both RTS samples built their world scenario the same way: the map with the run's seed and the types table spawned first as the entity keyed `types` (`skirmishScenario`, `siegeScenario`).                                                                                                                                                                                                                                   | `games/samples/{rts-skirmish,mini-siege}/content.ts`; owner `kits/rts/schema.ts`                                              | **fixed in 0.15 T15**: the RTS kit's `rtsScenario(map, types, seed)`; both samples call it. Same entities in the same order, so no hash moved                                                                                                                                                                |

## Module by module

Each section: what the samples use (the full export lists are in the appendix), what they had to
copy or work around, what changed in 0.15 and the verdict. Sample names are shortened to dungeon,
platformer, skirmish, tower defense and siege.

### `engine/core` (the root files)

- **Used:** the headless contract (`HeadlessGame`, `HeadlessOptions`, `HeadlessStarts`,
  `RunStart`, `JsonObject`, `rulesOffFor`, `canonicalJson`, `WorldEvents`; all five), the view
  contract (`ViewGame` by all five, `frameView` by platformer and tower defense), `Scene` and
  `SceneStack`, `RuleSwitch` (skirmish's interface actions), `MiniGameDef` and `controlsHint`,
  the mission contract (`MissionDef`, `MissionHost`, `MissionHostOptions`, `missionHostEvents`),
  campaigns (`CampaignDef`, `CampaignSave`, `advanceCampaign`, `campaignOrder`, `campaignRun`,
  `campaignSaveAt`, `entryId`, `entryOver`, `newCampaignSave`, `scenarioFrom`), the carried
  record's types, save codes (`saveCodeContext`; `encodeSaveCode` / `decodeSaveCode` in the
  siege's tests), `RtsTypes` and, since A9, `stateHash`. The campaign and mission parts are the
  siege's alone: it is the only sample with missions, as planned (the 1.0 multi-genre sample).
- **Copied or worked around:** the views (A5, listed for 1.0); the dungeon's own scene (A8,
  listed for 1.0); the skirmish's state hash (A9, fixed).
- **Changed in 0.15:** `Scene.tickRate` and `MergedInput` (D2), taps through `RoundInput` (D12)
  and the recorder (D1) in T5 (`12d38ae`); `MissionHost` events, `roundFrame()`, `canOpen` /
  `onChange` (M21, D9, M18) in T6 (`685f09e`); the key table through the port and adapters,
  `worldKeys()`, `records()`, the mission file's `marker` and `checkUse` scenarios (M10, D6, M17,
  M28, M25, D7) in T7 (`6d891a1`); report-driven effects and limits, `lateRefusals`, `endIf`,
  `entryOver`, save code v2 (D3, D4, M5, M31, M35, M38) in T8 (`77700b6`); `MiniGameDef.controls`,
  `controlsHint`, the mission file's `hint` and the entry's `text` (D14, M34) in T10 (`b490bfc`);
  `KitDef.kinds(manifest)` and `options`, `kitOptionsOf` (G17) in T11 (`4ba96c5`).
- **Verdict:** kept. The v1 docs state M4's rule (`1.0-4`): a played round's experience ticks are
  never in the world (`experienceTicks` 0 through `missionPort`); `missionExperience()`, the run's
  `experience` and the timeline carry them.

### `engine/core/content`

- **Used:** `loadContent`, `contentOf`, `ContentBundle`, `ContentResult`, `kitContentKinds`,
  `manifestOptions`, `mustLoad`, `contentSfx`, `contentSongs` (all five, the dungeon since A2),
  `CAMPAIGN_KIND`, `MISSION_KIND` (siege).
- **Copied or worked around:** the dungeon's kinds and sound lists (A2, fixed).
- **Changed in 0.15:** `kitContentKinds(kits, manifest?)` and `manifestOptions(files)` (G17,
  `4ba96c5`); the manifest's `kitOptions`.
- **Verdict:** kept.

### `engine/core/present`

- **Used:** `SkinFile`, `skinSet` and now `mustSkinSet`, `FrameStream`, `FramePicture`,
  `FrameSource`, `PendingEvents`, `Presenter`, `PresentFrame`, `freezeFrame`, `RtsCamera`, and
  `hostedSource` / `HostedPresentState` (siege, `present/hosted.ts`).
- **Copied or worked around:** the skin check (A1, fixed); the dungeon freezes and presents its
  own frames rather than a `FrameStream` (A5 and A8 cover it).
- **Changed in 0.15:** a skin's `background` (G36) and `byTag` `prefix` / `min` / `max` (M2) in
  T3 (`ae9c4f1`); `hostedSource`, the one round picture (M6) in T6 (`685f09e`); `layoutHud`, the
  HUD both backends draw (G33) in T13 (`867c454`); `mustSkinSet` (A1) in T15.
- **Verdict:** kept; M2's two-tag look waits for a game that needs it (`1.0-3`, decision 3).

### `engine/core/shell`

- **Used:** `bootBrowserGame` (all five), `HostScene` (platformer, siege), and the siege's
  mission and campaign page (`MissionLaunch`, `mountMissionBar`, `MissionBar`, `EntrySummary`,
  `LaunchEntryResult`, `CampaignSession`, `HostDrawer`).
- **Copied or worked around:** the RTS pages' own step counter and camera (A6), the per-page
  test hooks (A7) and the end of a standalone game (A8), all listed for 1.0.
- **Changed in 0.15:** stored volumes and the shell's volume control, the tick rate and frame
  taps (M1, D1, D2, D12, D13's `toClient`) in T5 (`12d38ae`); `MissionLaunch`, the campaign page
  flow and `mountMissionBar` (M26, M34, M36, D14) in T10 (`b490bfc`).
- **Verdict:** kept, with A6-A8 listed for 1.0 (`1.0-7` to `1.0-9`).

### `engine/core/save`

- **Used:** nothing directly: the shell uses `settings.ts` (the volume control) and
  `CampaignSession` uses `campaign-store.ts` for the siege's page.
- **Changed in 0.15:** `settings.ts`, the stored volumes (M1, `12d38ae`).
- **Verdict:** kept; reached through the shell, which is how a game should use it.

### `engine/core/input`

- **Used:** `InputFrame`, `PointerGesture` (the RTS pages), `InputManager`, `Action`,
  `DEFAULT_KEYBOARD_P1` and `keyHintMap` (tower defense's bar and key hint), `ScriptedInput` and
  `InputScript` (four samples' tests).
- **Changed in 0.15:** frame taps (`FrameTap`, `frameTaps`, `ScriptedInput` `taps`),
  `MergedInput`, `InputManager.press` (D1, D2) in T5 (`12d38ae`).
- **Verdict:** kept.

### `engine/core/audio`, `gfx`, `assets`, `math`, `a11y`, `node`

- **Used:** `AudioManager` (the dungeon's music switch; every other page lets the shell's `audio`
  option own it), `Renderer`, `ScreenSize`, `contentSheets` and `SheetLookup` (all five),
  `contentPixelSheets` (platformer's 3D HUD), `readGameFiles` (every sample's tests). `math` and
  `a11y` are used by the engine and kits, not by sample glue.
- **Changed in 0.15:** `contentPixelSheets` (G33, `867c454`).
- **Verdict:** kept. The dungeon's direct `AudioManager` use (to switch songs) goes with A8's end
  flow (`1.0-9`).

### `engine/backends/canvas2d`

- **Used:** `canvasDisplay` (all five), `SkinnedCanvasPresenter` (dungeon, skirmish, tower
  defense), `skinSetCanvasPresenter` (platformer, siege).
- **Changed in 0.15:** the skin's `background` (G36, `ae9c4f1`), the display's `toClient` (D13,
  `12d38ae`).
- **Verdict:** kept.

### `engine/backends/three`

- **Used:** `threeDisplay` (platformer's `?backend=three`, imported only then);
  `threeScenePresenter` by the backend parity test.
- **Changed in 0.15:** the skin's `background` (G36, `ae9c4f1`); the HUD as an orthographic pass of
  pixel-art quads and the particles (G33, `867c454`).
- **Verdict:** kept.

### `engine/backends/null`

- **Used:** `NullRenderer`, `NullPresenter` in tests (the one exception in `config/layers.js`).
- **Verdict:** kept, unchanged in 0.15.

### `engine/sim`

- **Used (the two samples over a world):** `worldFromScenario`, `World`, `rtsWorldPort`,
  `worldKeys`, `eventsSince` and `worldTimeline` (skirmish), `missionPort`, `missionsOf`,
  `carriedRecord`, `fateOf`, `keyAlive` (siege). Eleven of 347 exports: the rest are what the
  sim's own systems, the tools and the kits' tests use (appendix).
- **Copied or worked around:** the scenario with its types table (A10, fixed in the RTS kit,
  which reads the map; the sim is unchanged).
- **Changed in 0.15:** `rtsWorldPort` (M27) in T6 (`685f09e`); the key table `worldKeys` and
  `missionRecords` (M10, M28) in T7 (`6d891a1`); report-driven effects with limits, a gone
  stockpile carried as zeros, `experienceTicks` 0 (D3, D4, M31, M4) in T8 (`77700b6`); the siege
  fixture as a real `mission-room` mission (M12) in T9 (`be063b2`). **D11** stays a rule the v1
  docs write down (`1.0-2`): two missions on one event exclude each other for the whole of the
  first one's cost.
- **Verdict:** kept; its public surface for games is small and the v1 docs say which (`1.0-11`).

### `engine/tools` (the CLI)

- **Used:** by the samples' docs and run files, not imported: `validate`, `run`, `screenshot`,
  `mutants` (all five), `dump` (four), `trace` (dungeon, platformer), `events` (skirmish,
  siege), `timeline`, `code`, `record` (siege), `set` and `add` (platformer); `pnpm docs:gen`
  writes the params pages (M11). No sample imports `engine/tools` (games may not).
- **Changed in 0.15:** `world.key.<key>` run checks and `checkUse` against the world scenarios
  (M17, D7) in T7 (`6d891a1`); late refusals in `refusedMissions` (M5) in T8 (`77700b6`); the
  params page per mini game a game defines (M11, `engine/tools/mini-game-docs.ts`) in T11
  (`4ba96c5`).
- **Verdict:** kept.

### `kits/platformer`

- **Used:** `LevelSequence`, `LevelStage`, `contentStages`, `stageStarts`, `startStage`,
  `SequenceSnapshot`, `platformerFrames`, `PlatformerWorld`, `PlatformerEvent`,
  `PlatformerPresentState`, the hook `kit` (platformer).
- **Copied or worked around:** the sample's `test*` names (A3, fixed); nothing else.
- **Changed in 0.15:** none in the kit; the sample's HUD in both backends is G33's.
- **Verdict:** kept.

### `kits/topdown`

- **Used:** the dungeon's world (`TopDownWorld`, `topdownGame`, `buildDungeon`, `Dungeon`,
  `snapshotWorld`, `presentWorld`, `TdPresentState`), the rooms (`roomKind`, `RoomDef`), the
  platformer's challenge rooms (`roomChallenge`), the siege's mission room (`MISSION_ROOM`,
  `missionRoom`, `topdownMissionAdapter`), the hook `kit`.
- **Copied or worked around:** the `Td*` names that clash with the towerdefense kit (A4).
- **Changed in 0.15:** squads in selectors and keyed params (M16, D6) in T7 (`6d891a1`);
  `rooms: "separate"` and the second mission room (G17, M32) in T11 (`4ba96c5`).
- **Verdict:** kept, with A4's rename listed for 1.0 (`1.0-5`).

### `kits/rts`

- **Used:** `rtsGame`, `RtsGame`, `RtsView`, `presentWorld`, `RtsPresentState`,
  `RtsPresentOptions`, `RtsControls`, `RTS_TILE_SIZE`, `sidesOf`, `SideSummary`, the three kinds
  and their types, `RtsEventTracker` (skirmish), the commands and `Selection` (skirmish's
  interface actions), `missionButtons`, `rtsMissionHooks`, `rtsMissionInfo` (siege), the hook
  `kit`, and now `rtsScenario`.
- **Copied or worked around:** the scenario (A10, fixed), the page scene (A6, listed).
- **Changed in 0.15:** `rtsMissionHooks` (M18) in T6 (`685f09e`); the offer marker by key (M25) in
  T7 (`6d891a1`); the scripted enemy skipping frozen units (M20) in T9 (`be063b2`);
  `RtsEventTracker` in T14 (`d59e842`); `rtsScenario` (A10) in T15.
- **Verdict:** kept.

### `kits/towerdefense`

- **Used:** the standalone round (`tdRound`, `TdRoundDef`, `tdGame`, `TdGame`, `TdWorld`,
  `tdFrames`, `TdPresentState`, `TdCursorView`, `TdEvent`, `TD_CONTROLS`; `TdBot`,
  `screenAtCell`, `TOWERDEFENSE_RULES` in tests), the siege's preparation phase (`TD_DEFENCE`,
  `tdDefence`, `towerdefenseMissionAdapter`, `tdMapKind`, `tdTowersKind`, `towerTable`, `TdMap`,
  `TowerTable`), the hook `kit`.
- **Changed in 0.15:** `screenAtCell` (D13) in T5 (`12d38ae`); `build.cells` slots and a `td-map`
  without waves (D10, D8) in T7 (`6d891a1`); gold spent and walls lost from the report (D3, D4) in
  T8 (`77700b6`); `TD_CONTROLS` (D14) in T10 (`b490bfc`). **D5** stays a rule the v1 docs write
  down (`1.0-1`): in a `td-defence` round "walls lost" is the report's reading of the leaks (the
  build cell nearest the exit for each leak), not a kit rule.
- **Verdict:** kept.

## Where each 0.15 gap landed

| Gap                | Module                                                                                         | Commit    |
| ------------------ | ---------------------------------------------------------------------------------------------- | --------- |
| G36, M2            | `engine/core/present` (skins), both backends                                                   | `ae9c4f1` |
| M1, D1, D2, D12    | `engine/core/save`, `input`, `scene.ts`, `shell`                                               | `12d38ae` |
| D13                | `kits/towerdefense` (`screenAtCell`), the displays' `toClient`                                 | `12d38ae` |
| M6, D9, M18, M21   | `engine/core` (`MissionHost`, `present/hosted.ts`), `kits/rts`                                 | `685f09e` |
| M27                | `engine/sim` (`rtsWorldPort`)                                                                  | `685f09e` |
| M10, D6, M17, M28  | `engine/sim` (key table, records), `engine/core`, `engine/tools`                               | `6d891a1` |
| M25, M16, D10      | `engine/core/missions.ts`, `kits/rts`, `kits/topdown`, `kits/towerdefense`                     | `6d891a1` |
| D7, D8             | `engine/tools` (`validate`), `kits/towerdefense`                                               | `6d891a1` |
| D3, D4, M4         | `engine/core/missions.ts`, `engine/sim` (commit)                                               | `77700b6` |
| M5, M31, M35, M38  | `engine/core` (`MissionHost`, `campaign.ts`, `campaign-code.ts`), `engine/sim`, `engine/tools` | `77700b6` |
| M12, M20           | `engine/sim` fixture, `kits/rts` (enemy)                                                       | `be063b2` |
| M26, M34, M36, D14 | `engine/core/shell` (`MissionLaunch`), `engine/core/minigame.ts`                               | `b490bfc` |
| G17, M32, M11      | `engine/core/kit.ts`, `kits/topdown`, `engine/tools`                                           | `4ba96c5` |
| G33                | `engine/core/present/hud.ts`, `engine/backends/three`                                          | `867c454` |

**Cross-check (T15).** Every gap row of [stacking-test.md](stacking-test.md) (G17, G33, G36),
[mini-siege.md](mini-siege.md) (M1-M38) and [tower-defense.md](tower-defense.md) (D1-D14) was
read again: each 0.15 row reads **fixed in 0.15** with its commit, D5 and D11 read **moved to
1.0** with their reason, and no row names 0.15 as where it is going. G33's row named its task but
not its commit; it now reads `867c454`. The reports' older summary paragraphs and glue reviews
(written at 0.7, 0.11 and 0.12) say "moved to 0.15" as history, followed by their 0.15 entries.
No new gap was found for those three games' own glue beyond A1, A3, A5-A7 and A10 above, which
are logged here because each spans more than one sample.

## Duplicated sample glue

Searched with `grep` over `games/samples/*/*.ts` (not tests) for the shapes every game writes:
`skinSet(`, `has no .* skin`, `contentOf(content, SONG_KIND`, `key: 'types'`, `crypto.subtle`,
`picture?.r !== r`, `STEPS_PER_TICK`, `new RtsCamera`, `window.ww`, `debugText`, and by reading
each sample's `content.ts`, `picture.ts`, `view.ts`, `play.ts` and `main.ts` side by side.

| Found                                                                             | In                                  | Done                                                                |
| --------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| the skin-or-throw check                                                           | five samples and the platformer lab | fixed (A1, `mustSkinSet`)                                           |
| hand-made kinds and sound lists                                                   | dungeon                             | fixed (A2)                                                          |
| the stacking test's names                                                         | platformer                          | fixed (A3)                                                          |
| a state hash of its own                                                           | skirmish                            | fixed (A9, `stateHash`)                                             |
| the scenario with its types table                                                 | skirmish, siege                     | fixed (A10, `rtsScenario`)                                          |
| the picture cache and event buffer of a view                                      | dungeon, skirmish, siege            | listed for 1.0 (A5, `1.0-6`)                                        |
| the RTS page scene: camera, controls, step counter                                | skirmish, siege                     | listed for 1.0 (A6, `1.0-7`)                                        |
| a page hook beside `window.__ww`                                                  | skirmish, tower defense, siege      | listed for 1.0 (A7, `1.0-8`)                                        |
| the end of a standalone game, status text drawn in glue                           | dungeon, skirmish, tower defense    | listed for 1.0 (A8, `1.0-9`)                                        |
| `only(...)` "exactly one entry of a kind" and one getter per kind in `content.ts` | skirmish, siege                     | kept: one line each, and which entries a game expects is the game's |
| `TICKS_PER_SECOND` per page                                                       | skirmish, tower defense, siege      | kept: a page's pace is the game's choice (content, not glue)        |

## Listed for 1.0

Each is also in the ROADMAP's Engine 1.0 section ("From the API review").

1. **`1.0-1` D5** (v1 docs, tower-defense kit): "walls lost" is the report's reading of the leaks,
   not a kit rule; a wall-damage rule comes with a run file only when a game needs one.
2. **`1.0-2` D11** (v1 docs, mission API and `engine/sim`): two missions on one event exclude each
   other for the whole of the first one's cost; a preparation phase beside a mission on the same
   battle needs a second event.
3. **`1.0-3` M2's two-tag look** (decision 3): a skin look matching two tags at once (the burnt
   and frozen engine) when a game needs it; the list's order picks one today.
4. **`1.0-4` M4's rule** (decision 9, v1 docs): `experienceTicks` is 0 for a played mission
   through `missionPort`; the round's ticks are `missionExperience()`, the run's `experience` and
   the timeline's.
5. **`1.0-5` A4:** the topdown kit's `Td*` exports renamed `TopDown*` (no name shared with the
   towerdefense kit), with the dungeon, platformer, siege, tests and the scaffold skill.
6. **`1.0-6` A5:** `frameView` takes the frame source and events as options; the dungeon,
   skirmish and siege views become one call.
7. **`1.0-7` A6:** a scene that reads input every loop step and steps its game at a rate, and
   an RTS page helper in the kit (camera over the map from a home point, controls, buttons),
   used by both RTS samples.
8. **`1.0-8` A7:** `window.__ww` documented as a page's hook for scripts; per-page hooks keep only
   page state, and the browser tests read tick and snapshot from `__ww`.
9. **`1.0-9` A8:** a standalone game's end in the shell (the end read from the game, a banner,
   Play again with a new seed, a song switch) and text items in a skin's HUD, used by the
   dungeon, the skirmish and the tower defense.
10. **`1.0-10`** The v1 docs are the module pages' "Public API entry points", one per module,
    checked against this review's appendix: what a game uses is documented as v1; what only
    the engine, kits and tools use is marked internal.
11. **`1.0-11`** `engine/sim`'s index (347 exports, 11 used by games) is split in the v1 docs into
    what a game's glue calls (building a world from a scenario, the ports, keys, records, fates,
    carry, events and the timeline) and what the systems and tools use.

## Appendix: every export, and which samples import it

Generated at T15 from the samples' imports (see "How it was made"); a later change to a sample
does not update it.

### `engine/core`

204 exports, 39 imported by a sample.

| Export                | Sample glue                                                  | Sample tests only                                            |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `advanceCampaign`     | mini-siege                                                   | -                                                            |
| `CampaignDef`         | mini-siege                                                   | -                                                            |
| `campaignOrder`       | mini-siege                                                   | -                                                            |
| `campaignRun`         | mini-siege                                                   | -                                                            |
| `CampaignSave`        | mini-siege                                                   | -                                                            |
| `campaignSaveAt`      | mini-siege                                                   | -                                                            |
| `canonicalJson`       | -                                                            | dungeon, platformer, rts-skirmish, tower-defense, mini-siege |
| `CarriedRecord`       | mini-siege                                                   | -                                                            |
| `CarryFrom`           | mini-siege                                                   | -                                                            |
| `controlsHint`        | tower-defense                                                | -                                                            |
| `decodeSaveCode`      | -                                                            | mini-siege                                                   |
| `encodeSaveCode`      | -                                                            | mini-siege                                                   |
| `entryId`             | mini-siege                                                   | -                                                            |
| `entryOver`           | mini-siege                                                   | -                                                            |
| `frameView`           | platformer, tower-defense                                    | -                                                            |
| `HeadlessGame`        | dungeon, rts-skirmish                                        | -                                                            |
| `HeadlessOptions`     | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                                                            |
| `HeadlessStarts`      | platformer, mini-siege                                       | -                                                            |
| `JsonObject`          | rts-skirmish, tower-defense, mini-siege                      | -                                                            |
| `MiniGameDef`         | platformer, mini-siege                                       | -                                                            |
| `miniGameParamErrors` | -                                                            | mini-siege                                                   |
| `MissionDef`          | mini-siege                                                   | -                                                            |
| `MissionHost`         | mini-siege                                                   | -                                                            |
| `missionHostEvents`   | mini-siege                                                   | -                                                            |
| `MissionHostOptions`  | mini-siege                                                   | -                                                            |
| `missionMiniGameUses` | -                                                            | mini-siege                                                   |
| `MissionStepRefusal`  | -                                                            | mini-siege                                                   |
| `newCampaignSave`     | mini-siege                                                   | -                                                            |
| `RtsTypes`            | rts-skirmish, mini-siege                                     | -                                                            |
| `rulesOffFor`         | platformer, mini-siege                                       | -                                                            |
| `RuleSwitch`          | rts-skirmish                                                 | -                                                            |
| `RunStart`            | mini-siege                                                   | -                                                            |
| `saveCodeContext`     | mini-siege                                                   | -                                                            |
| `scenarioFrom`        | mini-siege                                                   | -                                                            |
| `Scene`               | dungeon, rts-skirmish, tower-defense                         | -                                                            |
| `SceneStack`          | mini-siege                                                   | -                                                            |
| `stateHash`           | rts-skirmish                                                 | -                                                            |
| `ViewGame`            | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                                                            |
| `WorldEvents`         | rts-skirmish                                                 | -                                                            |

Not imported by any sample: `CAMPAIGN_ENTRY_KINDS`, `CAMPAIGN_RESOLUTIONS`, `CAMPAIGN_SAVE_FORMAT`, `CAMPAIGN_SAVE_VERSION`, `CARRIED_FATES`, `CARRIED_FORMAT`, `CARRIED_VERSION`, `CampaignAdvance`, `CampaignEndIf`, `CampaignEntry`, `CampaignEntryKind`, `CampaignEntryResult`, `CampaignMissionResult`, `CampaignRefusalCode`, `CampaignRunState`, `CampaignScenario`, `CarriedFate`, `CarriedPerson`, `ControlKeyNames`, `FixedLoop`, `FixedLoopOptions`, `FrameViewOptions`, `GameWorldScenario`, `HeadlessEntry`, `HostStatus`, `HostedGame`, `InstallPrompt`, `InstallVariant`, `JsonValue`, `KitDef`, `KitManifest`, `KitParamsDoc`, `KitRoundBot`, `KitRoundBotDef`, `LOOP_HZ`, `LateMissionRefusal`, `MINI_GAME_END`, `MINI_GAME_RESULTS`, `MISSION_COMMIT`, `MISSION_EFFECT_TYPES`, `MISSION_FATES`, `MISSION_OPEN`, `MISSION_ROUND_MAX_TICKS`, `MiniGame`, `MiniGameContext`, `MiniGameControl`, `MiniGameEnd`, `MiniGameInputMap`, `MiniGameResult`, `MiniGameSceneOptions`, `MiniGameUse`, `MiniGameUseCheck`, `MiniGameUseProblem`, `MiniGameWorldScenario`, `MissionAdapter`, `MissionEffect`, `MissionEffectType`, `MissionFate`, `MissionHostEvent`, `MissionOutcome`, `MissionRecord`, `MissionReport`, `MissionResolution`, `MissionResult`, `MissionRoundEndResult`, `MissionRoundOptions`, `MissionRoundRefusal`, `MissionRoundResult`, `MissionWorldPort`, `ORDER_TYPES`, `OpportunityDef`, `Order`, `OrderCell`, `OrderType`, `PlatformEnv`, `PortRefusal`, `ROUND_HOSTED`, `Rng`, `RoundInput`, `RoundRecording`, `RtsBuildingType`, `RtsUnitType`, `RuleDef`, `RuleList`, `SAVE_CODE_ALPHABET`, `SAVE_CODE_GROUP`, `SAVE_CODE_ID_BITS`, `SAVE_CODE_VERSION`, `SAVE_CODE_VERSIONS`, `SCENARIO_FORMAT`, `SaveCodeContext`, `SaveCodeRefusal`, `SaveCodeRefusalCode`, `SaveCodeScenario`, `SaveCodeVersion`, `SnapshotEntity`, `SnapshotFate`, `Stepper`, `ViewEntry`, `attackOrderSchema`, `buildOrderSchema`, `campaignEndIfSchema`, `campaignEntrySchema`, `campaignLevels`, `campaignMissionResultSchema`, `campaignSaveSchema`, `campaignScenarios`, `campaignSchema`, `captureInstallPrompt`, `carriedMismatch`, `carriedRecordSchema`, `carryFromSchema`, `carrySpecSchema`, `checkCampaigns`, `checkMissionCodes`, `crc16`, `currentEnv`, `damageEffectSchema`, `defineKit`, `defineRules`, `destroyEffectSchema`, `entryKind`, `fateEffectSchema`, `fateState`, `gatherOrderSchema`, `hostStatusFor`, `installVariant`, `inventoryEffectSchema`, `isIOS`, `isIOSSafari`, `isLost`, `isPhone`, `isStandalone`, `kitOptionsOf`, `miniGameScene`, `miniGameTable`, `missionEffectSchema`, `missionOutcomeSchema`, `missionResult`, `missionRoundEnd`, `missionSchema`, `moveOrderSchema`, `normalizeSaveCode`, `opportunityEffectSchema`, `opportunitySchema`, `orderCellSchema`, `orderSchema`, `parseMission`, `parseOpportunity`, `parseOrder`, `pickOutcome`, `playMissionRound`, `playedResult`, `rtsBuildingTypeSchema`, `rtsCostSchema`, `rtsTypesSchema`, `rtsUnitTypeSchema`, `saveCodeId`, `setEffectSchema`, `sha256Hex`, `snapshotEntities`, `stopOrderSchema`, `totalWeight`, `trainOrderSchema`, `unknownRules`.

### `engine/core/content`

59 exports, 12 imported by a sample.

| Export            | Sample glue                                                  | Sample tests only |
| ----------------- | ------------------------------------------------------------ | ----------------- |
| `CAMPAIGN_KIND`   | mini-siege                                                   | -                 |
| `ContentBundle`   | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `contentOf`       | dungeon, platformer, rts-skirmish, mini-siege                | -                 |
| `ContentResult`   | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `contentSfx`      | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `contentSongs`    | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `kitContentKinds` | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `loadContent`     | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `manifestOptions` | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `MISSION_KIND`    | mini-siege                                                   | -                 |
| `mustLoad`        | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `validate`        | -                                                            | dungeon           |

Not imported by any sample: `ANY_KIND`, `ContentEntry`, `ContentError`, `ContentKind`, `ContentKinds`, `ContentLookup`, `ContentPart`, `Extension`, `FieldPath`, `GameManifest`, `GridProblem`, `GridProblemCode`, `GridResult`, `IssueParams`, `KindIssue`, `Legend`, `LegendKeys`, `LineMap`, `LoadOptions`, `MANIFEST_FILE`, `PALETTE_KIND`, `SFX_KIND`, `SKIN_KIND`, `SONG_KIND`, `SPRITE_KIND`, `TextGrid`, `TextReadResult`, `TextWriteResult`, `addGridIssues`, `contentArt`, `contentError`, `contentNamed`, `dottedPath`, `engineContentKinds`, `entryName`, `extensionOf`, `formatErrors`, `gameManifestSchema`, `globToRegExp`, `gridProblems`, `gridRows`, `inPart`, `issuesToErrors`, `jsonPointer`, `parseContent`, `parseTextGrid`, `partFileName`.

### `engine/core/save`

23 exports, 0 imported by a sample.

Not imported by any sample: `DEFAULT_MASTER`, `DEFAULT_VOLUMES`, `DPAD_STYLES`, `DpadStyle`, `StoredVolumes`, `TOUCH_MODES`, `TOUCH_SCALE_MAX`, `TOUCH_SCALE_MIN`, `TouchMode`, `campaignSaveKey`, `clearCampaignSave`, `hasKey`, `keyAbsent`, `loadCampaignSave`, `loadJson`, `loadVolumes`, `readVolumes`, `removeKey`, `saveJson`, `storageReadable`, `storeCampaignSave`, `storeVolumes`, `volumesKey`.

### `engine/core/input`

130 exports, 8 imported by a sample.

| Export                | Sample glue                          | Sample tests only                              |
| --------------------- | ------------------------------------ | ---------------------------------------------- |
| `Action`              | tower-defense                        | -                                              |
| `DEFAULT_KEYBOARD_P1` | tower-defense                        | -                                              |
| `InputFrame`          | dungeon, rts-skirmish, tower-defense | -                                              |
| `InputManager`        | tower-defense                        | -                                              |
| `InputScript`         | -                                    | dungeon, platformer, tower-defense, mini-siege |
| `keyHintMap`          | tower-defense                        | -                                              |
| `PointerGesture`      | rts-skirmish, mini-siege             | -                                              |
| `ScriptedInput`       | -                                    | dungeon, platformer, tower-defense, mini-siege |

Not imported by any sample: `ActionLabels`, `ActionState`, `Actions`, `BUTTON_BORDER`, `BUTTON_FONT`, `BUTTON_HIT_SLACK`, `BUTTON_PLACES`, `BindingClash`, `BindingMap`, `ButtonLabeler`, `ButtonPlace`, `ButtonShape`, `ButtonTarget`, `CONFIRM_ACTIONS`, `CONTROL_IDS`, `CaptureResult`, `ClientToScreen`, `Code`, `ControlId`, `DEFAULT_DPAD_ZONES`, `DEFAULT_GAMEPAD`, `DEFAULT_KEYBOARD_P2`, `DPAD_DEAD`, `DPAD_DOWN_MIN_DEG`, `DPAD_DOWN_MIN_R`, `DPAD_FOLLOW_R`, `DPAD_HIT_SCALE`, `DPAD_HORIZONTAL_MAX_DEG`, `DPAD_PLACE`, `DPAD_RUN_R`, `DPAD_SIZE`, `DPAD_UP_MIN_DEG`, `DPAD_ZONES`, `DpadDirs`, `DpadZoneId`, `DpadZones`, `EIGHT_WAY_DPAD_ZONES`, `FACE_BUTTON`, `FLOAT_EDGE_R`, `FLOAT_ZONE_FRACTION`, `FrameTap`, `GAME_FRAME`, `GUTTER_GAP`, `GamepadSource`, `GestureAction`, `GestureGate`, `HINT_BUTTONS`, `HeldButton`, `HintButton`, `InputRecorder`, `InputSource`, `Insets`, `KeyHintItem`, `KeyHints`, `KeyHintsOverlay`, `KeyboardSource`, `LABEL_LONG_WORD_MIN_PX`, `LABEL_MARGIN`, `LABEL_MIN_PX`, `LABEL_ONE_LINE_SCALE`, `LABEL_WRAP_SCALE`, `LANDSCAPE_SELECT`, `LabelFit`, `LabelSlot`, `LabelTarget`, `LastInput`, `LayoutMode`, `MIN_CONTROL_SCALE`, `MeasureEm`, `MergedInput`, `NO_DIRS`, `NO_INPUT`, `PHONE_MAX_SHORT_SIDE`, `POINTER_DEFAULTS`, `PORTRAIT_ABOVE_SHARE`, `PORTRAIT_MAX_GAP`, `PORTRAIT_MENU`, `PORTRAIT_MIN_GAP`, `Place`, `PlayerBindings`, `PointerButton`, `PointerGestures`, `PointerKind`, `PointerOptions`, `PointerSample`, `PointerSource`, `Rect`, `SMALL_BUTTON`, `ScreenInput`, `ScreenLayout`, `ScriptedTap`, `TAP_BUTTONS`, `TouchFacts`, `TouchLabels`, `TouchSource`, `bindGestureKeys`, `bindingClashes`, `boxRect`, `buttonShape`, `clampCentre`, `clearOfGame`, `defaultBindings`, `describeCode`, `describePad`, `dpadDirs`, `fitLabel`, `followCentre`, `frameTaps`, `heldActions`, `hitButton`, `inside`, `keyHintItems`, `keyName`, `layoutScreen`, `nextTouchMode`, `overlaps`, `portraitBalance`, `readTouchFacts`, `releaseHidden`, `slideHeld`, `touchPadVisible`, `wideEm`.

### `engine/core/audio`

25 exports, 3 imported by a sample.

| Export         | Sample glue | Sample tests only                                |
| -------------- | ----------- | ------------------------------------------------ |
| `AudioManager` | dungeon     | -                                                |
| `compileSong`  | -           | dungeon, platformer, rts-skirmish, tower-defense |
| `parseMml`     | -           | dungeon, platformer, rts-skirmish, tower-defense |

Not imported by any sample: `Apu`, `ApuVoices`, `AudioSink`, `CompiledSong`, `Duty`, `MUSIC_FADE_IN_S`, `MmlError`, `MusicMap`, `NULL_AUDIO`, `NoteEvent`, `NoteOptions`, `PPQ`, `Sequencer`, `Sfx`, `Song`, `Track`, `Voice`, `Volumes`, `midiToHz`, `scheduleOnce`, `sfxSchema`, `songSchema`.

### `engine/core/gfx`

46 exports, 3 imported by a sample.

| Export        | Sample glue                                                  | Sample tests only   |
| ------------- | ------------------------------------------------------------ | ------------------- |
| `Renderer`    | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                   |
| `ScreenSize`  | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                   |
| `SpriteSheet` | -                                                            | dungeon, platformer |

Not imported by any sample: `AnimDef`, `Animator`, `DEFAULT_LEGEND`, `DEFAULT_SCREEN`, `FrameRect`, `GameBox`, `GameFit`, `LegendValue`, `MAX_PALETTE_INDEX`, `NES`, `OffsetRenderer`, `PALETTE_MODES`, `Palette`, `PaletteBook`, `PaletteFile`, `PaletteFx`, `PaletteMode`, `PaletteTable`, `Rasterized`, `Rotation`, `SCREEN_MAX`, `SCREEN_MIN`, `SpriteDef`, `SpriteFile`, `charIndex`, `clipped`, `fitGame`, `flipH`, `frameSize`, `hexToRgb`, `paletteSchema`, `rasterize`, `rasterizeToBuffer`, `readSpriteText`, `resolvePalette`, `spriteChar`, `spriteSchema`, `stack`, `swapColors`, `transformed`, `translucent`, `validateDef`, `writeSpriteText`.

### `engine/core/assets`

21 exports, 4 imported by a sample.

| Export               | Sample glue                                                  | Sample tests only |
| -------------------- | ------------------------------------------------------------ | ----------------- |
| `contentPixelSheets` | platformer                                                   | -                 |
| `contentSheets`      | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `PixelSheetLookup`   | platformer                                                   | -                 |
| `SheetLookup`        | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |

Not imported by any sample: `AssetRegistry`, `LoadedPack`, `PackManifest`, `PackPickerFacts`, `StoredPack`, `applyPack`, `buildPack`, `exportTemplate`, `folderPickerSupported`, `importDevPacks`, `importPackFiles`, `loadEnabledPacks`, `packStore`, `packsNeedComputer`, `readPackFiles`, `sheetLookup`, `validateManifest`.

### `engine/core/math`

23 exports, 0 imported by a sample.

Not imported by any sample: `AABB`, `Overlap`, `SUB`, `SUB_SHIFT`, `TILE`, `TILE_SHIFT`, `TILE_SUB`, `TILE_SUB_SHIFT`, `VEL`, `VEL_SHIFT`, `absMin`, `clamp`, `containsPoint`, `overlap`, `overlaps`, `px`, `sign`, `tileAt`, `tileToSub`, `toPx`, `vel`, `velToPxf`, `velToSub`.

### `engine/core/a11y`

2 exports, 0 imported by a sample.

Not imported by any sample: `Announcer`, `NULL_ANNOUNCER`.

### `engine/core/node`

1 exports, 1 imported by a sample.

| Export          | Sample glue | Sample tests only                                            |
| --------------- | ----------- | ------------------------------------------------------------ |
| `readGameFiles` | -           | dungeon, platformer, rts-skirmish, tower-defense, mini-siege |

### `engine/core/present`

94 exports, 21 imported by a sample.

| Export               | Sample glue                                                  | Sample tests only                             |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| `DeepReadonly`       | dungeon                                                      | -                                             |
| `FramePicture`       | platformer, rts-skirmish, tower-defense, mini-siege          | -                                             |
| `FrameSource`        | rts-skirmish, mini-siege                                     | -                                             |
| `FrameStream`        | platformer, rts-skirmish, tower-defense, mini-siege          | -                                             |
| `freezeFrame`        | dungeon                                                      | -                                             |
| `HostedPresentState` | mini-siege                                                   | -                                             |
| `hostedSource`       | mini-siege                                                   | -                                             |
| `isFullMap`          | -                                                            | dungeon, platformer, rts-skirmish, mini-siege |
| `MINI_GAME_STATUS`   | -                                                            | mini-siege                                    |
| `mustSkinSet`        | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                                             |
| `parseEventKey`      | -                                                            | platformer                                    |
| `PendingEvents`      | tower-defense                                                | -                                             |
| `Presenter`          | platformer, rts-skirmish, tower-defense, mini-siege          | -                                             |
| `PresentFrame`       | dungeon, rts-skirmish                                        | -                                             |
| `presentFrameSchema` | -                                                            | dungeon                                       |
| `PresentStatusValue` | dungeon                                                      | -                                             |
| `resolveSkinEvent`   | -                                                            | platformer, rts-skirmish                      |
| `resolveSkinFrame`   | -                                                            | rts-skirmish                                  |
| `RtsCamera`          | rts-skirmish, mini-siege                                     | -                                             |
| `SkinFile`           | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                                             |
| `skinSet`            | -                                                            | mini-siege                                    |

Not imported by any sample: `CameraFollower`, `CameraFollowerOptions`, `CameraHint`, `CameraMap`, `CameraPoint`, `DEFAULT_BACKGROUND`, `DEFAULT_CAMERA3D`, `DEFAULT_FALLBACK_COLOR`, `DEFAULT_FRAME_TICKS`, `DEFAULT_HUD_FONT`, `EVENT_KEY_FIELD`, `EventKey`, `FACINGS`, `Facing`, `FoundSkinSet`, `HUD_FALLBACK_COLOR`, `HUD_FALLBACK_SIZE`, `HUD_GLYPH_ADVANCE`, `HostedSourceOptions`, `HudDraw`, `HudFrameSize`, `HudSprite`, `HudText`, `LOW_POLY_SEGMENTS`, `MESH_BACKENDS`, `MESH_PRIMITIVES`, `MapTracker`, `MeshPart`, `MeshPrimitive`, `PresentAnim`, `PresentBox`, `PresentEntity`, `PresentEvent`, `PresentFx`, `PresentMap`, `PresentMapLayer`, `PresentMapRef`, `PresentTilesGrid`, `PresentTilesText`, `RTS_MAX_ZOOM`, `RTS_MIN_ZOOM`, `RtsCameraOptions`, `SKIN_KIND`, `SkinCamera3d`, `SkinCycle`, `SkinEntityInput`, `SkinFrame`, `SkinKindEntry`, `SkinMeshPart`, `SkinSet`, `SkinStateFrames`, `SkinTagEntry`, `SkinTileEntry`, `cameraShake`, `cameraTarget`, `cameraView`, `cameraZoom`, `cardinalFacing`, `checkSkinRefs`, `clampCameraAxis`, `facesLeft`, `hudGlyphs`, `layoutHud`, `mirrorFacing`, `presenterBySkinSet`, `presenterByStatus`, `resolveCamera3d`, `resolveMeshParts`, `resolveSkinKind`, `skinBackground`, `skinSchema`, `skinTagIndex`, `skinTagMatches`.

### `engine/core/shell`

54 exports, 9 imported by a sample.

| Export              | Sample glue                                                  | Sample tests only |
| ------------------- | ------------------------------------------------------------ | ----------------- |
| `bootBrowserGame`   | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `CampaignSession`   | mini-siege                                                   | -                 |
| `EntrySummary`      | mini-siege                                                   | -                 |
| `HostDrawer`        | mini-siege                                                   | -                 |
| `HostScene`         | platformer, mini-siege                                       | -                 |
| `LaunchEntryResult` | mini-siege                                                   | -                 |
| `MissionBar`        | mini-siege                                                   | -                 |
| `MissionLaunch`     | mini-siege                                                   | -                 |
| `mountMissionBar`   | mini-siege                                                   | -                 |

Not imported by any sample: `AUDIO_UNLOCK_EVENTS`, `BackendLink`, `BootAudio`, `BootPage`, `BootedGame`, `BrowserBootOptions`, `BrowserDisplay`, `CampaignEntryEnd`, `CampaignResume`, `CampaignResumeRefusalCode`, `DEBUG_STEP_QUERY`, `DebugWindow`, `DisplayFactory`, `DisplayResult`, `DisplayShell`, `HostSceneAccessorOptions`, `HostSceneGameOptions`, `HostSceneOptions`, `LaunchButton`, `LaunchCampaign`, `LaunchCampaignSession`, `LaunchGame`, `MISSION_BAR_HEIGHT`, `MissionBarOptions`, `MissionLaunchOptions`, `PageBackend`, `PageDebug`, `PageDebugHook`, `PageDebugTarget`, `RECORD_QUERY`, `ReplayRefusal`, `RoundRecording`, `THREE_QUERY`, `VOLUME_CONTROL_ID`, `VolumeControl`, `VolumeControlOptions`, `VolumeTarget`, `backendFromQuery`, `manualFromQuery`, `mountVolumeControl`, `otherBackendLink`, `recordFromQuery`, `showBackendToggle`, `showDisplayMessage`, `tapsOf`.

### `engine/backends/canvas2d`

10 exports, 3 imported by a sample.

| Export                   | Sample glue                                                  | Sample tests only |
| ------------------------ | ------------------------------------------------------------ | ----------------- |
| `canvasDisplay`          | dungeon, platformer, rts-skirmish, tower-defense, mini-siege | -                 |
| `SkinnedCanvasPresenter` | dungeon, rts-skirmish, tower-defense                         | -                 |
| `skinSetCanvasPresenter` | platformer, mini-siege                                       | -                 |

Not imported by any sample: `CanvasDisplayOptions`, `CanvasRenderer`, `CanvasSkinSetOptions`, `MapSurface`, `SkinnedPresenterOptions`, `Viewport`, `ViewportOptions`.

### `engine/backends/three`

22 exports, 1 imported by a sample.

| Export         | Sample glue | Sample tests only |
| -------------- | ----------- | ----------------- |
| `threeDisplay` | platformer  | -                 |

Not imported by any sample: `CanvasBox`, `GeometryCache`, `GlInfoSource`, `HudLayer`, `HudQuad`, `PARTICLE_POOL`, `PartSize`, `ThreeDisplayOptions`, `ThreePresenter`, `ThreePresenterOptions`, `ThreeScene`, `ThreeSceneOptions`, `WebglRendererInfo`, `applyCanvasBox`, `canvasToScreen`, `fitCanvas`, `isSoftwareRenderer`, `primitiveGeometry`, `threeScenePresenter`, `webgl2Available`, `webglRendererInfo`.

### `engine/backends/null`

3 exports, 2 imported by a sample.

| Export          | Sample glue | Sample tests only                                |
| --------------- | ----------- | ------------------------------------------------ |
| `NullPresenter` | -           | rts-skirmish, tower-defense, mini-siege          |
| `NullRenderer`  | -           | dungeon, platformer, rts-skirmish, tower-defense |

Not imported by any sample: `NullPresenterOptions`.

### `engine/sim`

347 exports, 11 imported by a sample.

| Export              | Sample glue              | Sample tests only |
| ------------------- | ------------------------ | ----------------- |
| `carriedRecord`     | mini-siege               | -                 |
| `eventsSince`       | rts-skirmish             | -                 |
| `fateOf`            | mini-siege               | -                 |
| `keyAlive`          | mini-siege               | -                 |
| `missionPort`       | mini-siege               | -                 |
| `missionsOf`        | mini-siege               | -                 |
| `rtsWorldPort`      | rts-skirmish, mini-siege | -                 |
| `World`             | rts-skirmish, mini-siege | -                 |
| `worldFromScenario` | rts-skirmish, mini-siege | -                 |
| `worldKeys`         | rts-skirmish, mini-siege | -                 |
| `worldTimeline`     | rts-skirmish             | -                 |

Not imported by any sample: `ANGLE_STEPS`, `ASTAR_MAX_EXPANDED`, `AnyComponent`, `Building`, `BuildingData`, `CARRIED_FORMAT`, `CARRIED_VERSION`, `CARRY_CAUSE`, `CarriedPerson`, `CarriedRecord`, `CarryFrom`, `Cause`, `Cell`, `Change`, `ChangeOp`, `ClockEntry`, `CommitResult`, `Commitment`, `ComponentDef`, `ComponentOptions`, `Construction`, `ConstructionData`, `Cooldown`, `CooldownData`, `DEFAULT_SYSTEM_SET`, `DIAGONAL_COST`, `ECONOMY_COMPONENTS`, `EXTERNAL_CAUSE`, `EconomyOrder`, `Entity`, `EventMember`, `EventMemberData`, `Experience`, `ExperienceEntry`, `FATE_COMPONENTS`, `FATE_STATES`, `FIXED_ONE`, `FLOW_GROUP_SIZE`, `Facing8`, `Facing8Data`, `Fate`, `FateData`, `FateOptions`, `FateReading`, `FateRefusal`, `FateResult`, `FateState`, `FateStep`, `FateView`, `FateWriteOptions`, `FlowField`, `FlowOptions`, `Frozen`, `FrozenSpan`, `GROUND`, `Gatherer`, `GathererData`, `Hauler`, `HaulerData`, `Health`, `HealthData`, `Inventory`, `InventoryData`, `LoadOptions`, `LogOptions`, `MAP_COMPONENTS`, `MISSION_COMPONENTS`, `MISSION_EFFECT_TYPES`, `Member`, `MemberData`, `MissionDef`, `MissionEffect`, `MissionOutcome`, `MissionRecord`, `MissionRefusal`, `MissionRefused`, `MissionReport`, `MissionResolution`, `MissionResult`, `Missions`, `MissionsData`, `MissionsView`, `NamedPerson`, `Neighbourhood`, `OPPORTUNITY_COMPONENTS`, `OPPORTUNITY_STATUSES`, `ORDER_TYPES`, `OpenMission`, `OpenOptions`, `OpenResult`, `Opportunities`, `OpportunitiesData`, `OpportunitiesView`, `OpportunityChange`, `OpportunityDef`, `OpportunityRefusal`, `OpportunityRefused`, `OpportunityState`, `OpportunityStatus`, `OpportunityStep`, `OpportunityWindow`, `Order`, `OrderCell`, `OrderResult`, `OrderType`, `Owner`, `OwnerData`, `Path`, `PathOptions`, `Patrol`, `PatrolData`, `Position`, `PositionData`, `Producer`, `ProducerData`, `QUARTER_TURN`, `ROLES`, `RTS_COMPONENTS`, `RTS_SYSTEMS`, `Rect`, `ResolveResult`, `Resource`, `ResourceData`, `Role`, `RtsBuildingType`, `RtsPort`, `RtsTypes`, `RtsTypesData`, `RtsUnitType`, `SAVE_FORMAT`, `SAVE_VERSION`, `SCENARIO_FORMAT`, `SCENARIO_VERSION`, `STANDARD_COMPONENTS`, `STEPS`, `STEPS_8`, `STRAIGHT_COST`, `SYSTEM_COMPONENTS`, `SYSTEM_SETS`, `SYSTEM_SET_NAMES`, `SaveError`, `SaveIssue`, `Scenario`, `ScenarioError`, `ScenarioIssue`, `ScenarioOptions`, `Squad`, `SquadData`, `SquadMember`, `StartFateOptions`, `Stockpile`, `StockpileData`, `System`, `SystemSet`, `SystemSetName`, `TIMELINE_FORMAT`, `TIMELINE_VERSION`, `TIME_CAUSE`, `TIME_COMPONENTS`, `Target`, `TargetData`, `Task`, `TaskData`, `Terrain`, `TerrainData`, `TerrainType`, `TimeRefusal`, `TimeResult`, `TimeService`, `Timeline`, `TimelineEntry`, `TimelineEntryKind`, `TimelineMission`, `TimelineSource`, `UNIT_COMPONENTS`, `UNREACHABLE`, `Unit`, `UnitData`, `Walk`, `WalkData`, `Worker`, `WorkerData`, `WorldOptions`, `WorldSave`, `WorldSnapshot`, `WorldTime`, `WorldTimeData`, `addExperience`, `addOpportunities`, `addWork`, `applyLosses`, `applyOpportunityEffect`, `applyOrder`, `attackSystem`, `buildOrderSchema`, `buildSystem`, `capturePerson`, `carriedRecordSchema`, `carryFromSchema`, `carrySpecSchema`, `cellAt`, `cellIndex`, `changeSchema`, `chebyshev`, `clamp`, `clockEntrySchema`, `commitMission`, `commitmentSchema`, `compressClock`, `constructSystem`, `cosFixed`, `createWorld`, `deathSystem`, `defineComponent`, `delegateMission`, `directionAngle`, `directionVector`, `distFloor`, `distSq`, `distanceField`, `economyOrderRefusal`, `eventMembers`, `experienceEntrySchema`, `experienceSchema`, `facingOf`, `fateStepSchema`, `findPath`, `finished`, `flatTerrain`, `flowField`, `flowStep`, `footprintOf`, `freePerson`, `freezeEvent`, `frozenCheck`, `frozenSchema`, `frozenSpanSchema`, `gameTickOf`, `gatherOrderSchema`, `gatherSystem`, `haulSystem`, `heightAt`, `iatan2`, `idiv`, `imod`, `inBounds`, `inRange`, `inReach`, `inRect`, `injurePerson`, `inventoryAdd`, `ipow`, `isqrt`, `joinEvent`, `joinSquad`, `killPerson`, `knowsOpportunity`, `leaveEvent`, `leaveSquad`, `loadWorld`, `logFrom`, `lossOrder`, `manhattan`, `missionCause`, `missionEffectSchema`, `missionOutcomeSchema`, `missionRecordSchema`, `missionRecords`, `missionSchema`, `missionSnapshot`, `moveCost`, `moveSystem`, `namedPeople`, `nextStep`, `openMission`, `openMissionSchema`, `opportunitiesOf`, `opportunityGate`, `opportunitySchema`, `opportunityStateSchema`, `opportunityStepSchema`, `opportunityWindowSchema`, `orderSchema`, `parseMission`, `parseOpportunity`, `parseOrder`, `passable`, `patrolSystem`, `pickMembers`, `pickOutcome`, `placeBuilding`, `placementRefusal`, `playMission`, `quitMission`, `rectsOverlap`, `ringAround`, `roundSeed`, `rtsBuildingTypeSchema`, `rtsCostSchema`, `rtsTypesOf`, `rtsTypesSchema`, `rtsUnitTypeSchema`, `saveWorld`, `scaleFixed`, `scenarioKeys`, `scenarioSchema`, `setFate`, `settleMissions`, `settleOpportunities`, `sinFixed`, `spawnUnit`, `squadMembers`, `squadStrength`, `stampCommitment`, `startExperience`, `startFate`, `stepCost`, `stepsOf`, `stockpileOf`, `takeOpportunity`, `terrainEntity`, `terrainOf`, `timeOf`, `timelineEntries`, `timelineMissionSchema`, `timelineOf`, `timelineSchema`, `totalWeight`, `trainOrderSchema`, `trainSystem`, `typeAt`, `unfreezeEvent`, `walkToward`, `worldSaveSchema`, `worldTimeEntity`, `wrapAngle`.

### `kits/platformer`

89 exports, 15 imported by a sample.

| Export                   | Sample glue | Sample tests only |
| ------------------------ | ----------- | ----------------- |
| `ACTOR_ANIMS`            | -           | platformer        |
| `contentStages`          | platformer  | -                 |
| `kit`                    | platformer  | -                 |
| `LEVEL_PAUSE`            | -           | platformer        |
| `LevelSequence`          | platformer  | -                 |
| `LevelStage`             | platformer  | -                 |
| `PlatformerEvent`        | platformer  | -                 |
| `platformerFrames`       | platformer  | -                 |
| `PlatformerPresentState` | platformer  | -                 |
| `PlatformerWorld`        | platformer  | -                 |
| `PRESENT_TILES`          | -           | platformer        |
| `RUNNER_ANIMS`           | -           | platformer        |
| `SequenceSnapshot`       | platformer  | -                 |
| `stageStarts`            | platformer  | -                 |
| `startStage`             | platformer  | -                 |

Not imported by any sample: `Actor`, `ActorType`, `BLOCK_CONTENTS`, `BUMP_RISE`, `Body`, `CELL_COLLISION`, `COIN_POP_TICKS`, `CellKind`, `ChangedCell`, `Collision`, `ContentStagesOptions`, `DEFAULT_ACTOR_BOX`, `DEFAULT_KICK_GRACE`, `DEFAULT_VIEW_WIDTH`, `DeathCause`, `EndedRound`, `EndedRoundSnapshot`, `HURT_TICKS`, `JumpTier`, `LEGEND`, `LegendEntry`, `LevelCell`, `LevelDef`, `LevelProblem`, `LevelSequenceOptions`, `LevelTrigger`, `MINI_GAME_RULES`, `MOVEMENT_RULES`, `MULTI_COIN_HITS`, `MiniGameRun`, `OBJECT_RULES`, `Outcome`, `PF_DEPTH`, `PLATFORMER_RULES`, `PlatformerPresentOptions`, `PlatformerSnapshot`, `PlatformerWorldOptions`, `Player`, `PlayerPhysics`, `PlayerProfile`, `PlayerStepEvents`, `ProfileDef`, `REMAINS_TICKS`, `RUNNER_DEAD_TICKS`, `SUB`, `TRIGGER_OUTCOMES`, `TileGrid`, `TriggerState`, `VEL`, `WAKE_MARGIN`, `actorId`, `actorState`, `cameraHint`, `checkLevel`, `legendEntry`, `levelCells`, `levelKind`, `levelMiniGameUses`, `levelSchema`, `levelSize`, `levelStages`, `levelsInPlayOrder`, `makeBody`, `moveX`, `moveY`, `platformerGame`, `presentMap`, `presentStatus`, `presentWorld`, `profileKind`, `profileSchema`, `runnerState`, `snapshotEndedRound`, `snapshotWorld`.

### `kits/rts`

78 exports, 30 imported by a sample.

| Export              | Sample glue              | Sample tests only |
| ------------------- | ------------------------ | ----------------- |
| `buildCommand`      | rts-skirmish             | -                 |
| `commandAt`         | rts-skirmish             | -                 |
| `EnemyPlan`         | rts-skirmish, mini-siege | -                 |
| `kit`               | rts-skirmish, mini-siege | -                 |
| `missionButtons`    | mini-siege               | -                 |
| `OrderDraft`        | rts-skirmish             | -                 |
| `presentWorld`      | rts-skirmish, mini-siege | -                 |
| `RecordedOrder`     | rts-skirmish             | -                 |
| `RTS_TILE_SIZE`     | rts-skirmish, mini-siege | -                 |
| `RtsControls`       | rts-skirmish, mini-siege | -                 |
| `rtsEnemyKind`      | rts-skirmish, mini-siege | -                 |
| `RtsEventTracker`   | rts-skirmish             | -                 |
| `rtsGame`           | rts-skirmish, mini-siege | -                 |
| `RtsGame`           | rts-skirmish, mini-siege | -                 |
| `RtsMap`            | rts-skirmish, mini-siege | -                 |
| `rtsMapKind`        | rts-skirmish, mini-siege | -                 |
| `rtsMissionHooks`   | mini-siege               | -                 |
| `rtsMissionInfo`    | mini-siege               | -                 |
| `RtsMissionInfo`    | mini-siege               | -                 |
| `RtsPresentOptions` | rts-skirmish, mini-siege | -                 |
| `RtsPresentState`   | rts-skirmish, mini-siege | -                 |
| `rtsScenario`       | rts-skirmish, mini-siege | -                 |
| `rtsTypesKind`      | rts-skirmish, mini-siege | -                 |
| `RtsView`           | rts-skirmish, mini-siege | -                 |
| `Selection`         | rts-skirmish             | -                 |
| `sidesOf`           | rts-skirmish, mini-siege | -                 |
| `SideSummary`       | rts-skirmish, mini-siege | -                 |
| `stopCommand`       | rts-skirmish             | -                 |
| `trainButtons`      | rts-skirmish             | -                 |
| `trainCommand`      | rts-skirmish             | -                 |

Not imported by any sample: `DIR_FACINGS`, `LaunchResult`, `MissionLauncher`, `MissionRequest`, `OrderLogEntry`, `PlanCondition`, `PlanOrder`, `PlanStep`, `RTS_DEPTH`, `RTS_RULES`, `RtsBuildingView`, `RtsGameOptions`, `RtsMissionHooks`, `RtsMissionsView`, `RtsNamedView`, `RtsOffer`, `RtsOpenMission`, `RtsPlacing`, `RtsResourceView`, `RtsRuleId`, `RtsTerrain`, `RtsTerrainType`, `RtsThing`, `RtsUnitView`, `RtsWorldPort`, `ScriptedEnemy`, `WorldBox`, `WorldPoint`, `cellOf`, `enemyPlanSchema`, `facingOfDir`, `isFinished`, `launchMission`, `missionRequest`, `missionStatus`, `offerTarget`, `planConditionSchema`, `planStepSchema`, `planTypeIssues`, `presentMap`, `presentStatus`, `readWorld`, `rtsEvents`, `rtsMapSchema`, `stampOrder`, `thingAt`, `unitAnim`, `unitSelectorSchema`.

### `kits/topdown`

183 exports, 16 imported by a sample.

| Export                  | Sample glue                     | Sample tests only |
| ----------------------- | ------------------------------- | ----------------- |
| `buildDungeon`          | dungeon                         | -                 |
| `Dungeon`               | dungeon                         | -                 |
| `kit`                   | dungeon, platformer, mini-siege | -                 |
| `MISSION_ROOM`          | mini-siege                      | -                 |
| `missionRoom`           | mini-siege                      | -                 |
| `PRESENT_TILES`         | -                               | dungeon           |
| `presentWorld`          | dungeon                         | -                 |
| `roomChallenge`         | platformer                      | -                 |
| `RoomChallenge`         | -                               | platformer        |
| `RoomDef`               | platformer, mini-siege          | -                 |
| `roomKind`              | dungeon, platformer, mini-siege | -                 |
| `snapshotWorld`         | dungeon                         | -                 |
| `TdPresentState`        | dungeon                         | -                 |
| `topdownGame`           | dungeon                         | -                 |
| `topdownMissionAdapter` | mini-siege                      | -                 |
| `TopDownWorld`          | dungeon                         | -                 |

Not imported by any sample: `ALIGN`, `AMMO_DROP`, `ATTACK_FRAMES`, `BLAST_DAMAGE`, `BLAST_FRAMES`, `BLAST_RADIUS`, `BLAST_SELF_DAMAGE`, `BOMBS`, `BOMB_FUSE`, `BOOMERANG`, `BOOMERANG_RANGE`, `BOOMERANG_SPEED`, `Bat`, `Bomb`, `Boomerang`, `Box`, `CHALLENGE_GOALS`, `CHALLENGE_TICKS`, `CORNER_SLIDE`, `ChallengeFoe`, `ChallengeGoal`, `ChallengeParams`, `ChallengeReport`, `ChallengeSnapshot`, `Chest`, `Cond`, `DEATH_FRAMES`, `DEFAULT_ITEMS`, `DEFAULT_SPAWNERS`, `DIRS`, `DIR_SIDE`, `DIR_VEC`, `Dir`, `DoorKind`, `DoorLook`, `DungeonOptions`, `DungeonProblem`, `ENEMY_INVULN`, `ENEMY_KNOCK_FRAMES`, `Explosion`, `FUSE_EVERY`, `FloorSwitch`, `HERO_INVULN`, `HOLD_FRAMES`, `HUD_H`, `IDLE_FRAMES`, `Inventory`, `KNOCK_FRAMES`, `KNOCK_PX`, `KNOCK_SPEED`, `Knight`, `LEGEND`, `LegendEntry`, `MISSION_ROOM_CONTROLS`, `MissionRoomFoe`, `MissionRoomHero`, `MissionRoomInput`, `MissionRoomOptions`, `MissionRoomParams`, `MissionRoomPlaced`, `MissionRoomReport`, `MissionRoomRound`, `MissionRoomRule`, `Mover`, `OPPOSITE`, `OPPOSITE_SIDE`, `PUSH_DELAY`, `PersonOptions`, `Pickup`, `PickupKind`, `Poof`, `Projectile`, `PushBlock`, `ROCK_SPEED`, `ROOM_COLS`, `ROOM_H`, `ROOM_MODES`, `ROOM_ROWS`, `ROOM_W`, `RUN_STEPS`, `Rock`, `Room`, `RoomChallengeOptions`, `RoomKindOptions`, `RoomMode`, `RoomState`, `SIDE_DIR`, `SIDE_FRAMES`, `SLIDE_SPEED`, `SPIN_FRAMES`, `SPIT_HOLD`, `SPIT_WINDUP`, `SPLIT_FRAMES`, `STUN_FRAMES`, `SWORD_FIRST`, `SWORD_LAST`, `SWORD_SPREAD`, `Side`, `Spawn`, `Spawner`, `Spitter`, `TALK_REACH`, `TD_DEPTH`, `THICK_SIDE_FRAMES`, `TILE`, `TOPDOWN_RULES`, `TdEnemy`, `TdEntity`, `TdEntrance`, `TdEvent`, `TdFrameRows`, `TdHero`, `TdItem`, `TdPerson`, `TdPresentIds`, `TdPresentOptions`, `TdPresentedMap`, `TdSnapshot`, `TdWalker`, `TdWorldOptions`, `TileKind`, `TopdownRule`, `Torch`, `Transition`, `USE_FRAMES`, `WALK_STEPS`, `WHIRR_EVERY`, `Walker`, `boxesOverlap`, `cameraHint`, `centre`, `challengeParams`, `challengeParamsSchema`, `checkDungeon`, `circleHits`, `dirFrom`, `dirToward`, `heroHpLost`, `isBorder`, `isHorizontal`, `liveDoorLook`, `missionRoomInput`, `missionRoomOutcome`, `missionRoomParams`, `missionRoomParamsSchema`, `missionRoomProblems`, `mod`, `neighbourCell`, `parseRoom`, `pastDoorLook`, `pickupFrame`, `pickupSize`, `presentKind`, `presentMap`, `reachBox`, `roomMode`, `roomSchema`, `rotateCcw`, `sideOf`, `swordAt`, `swordReach`, `talkTarget`, `tileAt`, `topdownBotPlanSchema`, `topdownOptionsSchema`, `wallDepth`, `withSideFrames`.

### `kits/towerdefense`

89 exports, 24 imported by a sample.

| Export                       | Sample glue               | Sample tests only         |
| ---------------------------- | ------------------------- | ------------------------- |
| `kit`                        | tower-defense, mini-siege | -                         |
| `screenAtCell`               | -                         | tower-defense, mini-siege |
| `TD_CONTROLS`                | tower-defense             | -                         |
| `TD_DEFENCE`                 | mini-siege                | -                         |
| `TD_TILE_SIZE`               | -                         | tower-defense             |
| `TdBot`                      | -                         | tower-defense             |
| `TdBotStep`                  | -                         | tower-defense             |
| `TdCursorView`               | tower-defense             | -                         |
| `tdDefence`                  | mini-siege                | -                         |
| `TdEvent`                    | tower-defense             | -                         |
| `tdFrames`                   | tower-defense             | -                         |
| `tdGame`                     | tower-defense             | -                         |
| `TdGame`                     | tower-defense             | -                         |
| `TdMap`                      | mini-siege                | -                         |
| `tdMapKind`                  | mini-siege                | -                         |
| `TdPresentState`             | tower-defense             | -                         |
| `tdRound`                    | tower-defense             | -                         |
| `TdRoundDef`                 | tower-defense             | -                         |
| `tdTowersKind`               | mini-siege                | -                         |
| `TdWorld`                    | tower-defense             | -                         |
| `TOWERDEFENSE_RULES`         | -                         | tower-defense             |
| `towerdefenseMissionAdapter` | mini-siege                | -                         |
| `towerTable`                 | mini-siege                | -                         |
| `TowerTable`                 | mini-siege                | -                         |

Not imported by any sample: `CELL_KINDS`, `CELL_SUB`, `Cell`, `CellKind`, `EnemyGroup`, `EnemyState`, `LEGEND`, `LegendEntry`, `MapProblem`, `REPEAT_DELAY`, `REPEAT_EVERY`, `TD_DEFENCE_CONTROLS`, `TD_DEPTH`, `TD_EVENT_TYPES`, `TD_TILES`, `TdCommand`, `TdControls`, `TdControlsSnapshot`, `TdDefenceCell`, `TdDefenceFoe`, `TdDefenceInput`, `TdDefenceOptions`, `TdDefenceParams`, `TdDefenceReport`, `TdDefenceRound`, `TdDefenceRule`, `TdGameOptions`, `TdGrid`, `TdOutcome`, `TdPresentOptions`, `TdRefusal`, `TdSnapshot`, `TdTowers`, `TdWall`, `TdWaves`, `TdWorldOptions`, `TdWorldRef`, `TowerState`, `TowerType`, `cameraHint`, `cellAtScreen`, `cellKinds`, `describeWorld`, `enemyGroupSchema`, `enemyPlace`, `facingToward`, `gridOf`, `isPathKind`, `mapReferenceIssues`, `presentMap`, `presentStatus`, `presentWorld`, `sellValue`, `tdBotPlanSchema`, `tdDefenceInput`, `tdDefenceOutcome`, `tdDefenceParams`, `tdDefenceParamsSchema`, `tdDefenceProblems`, `tdMapSchema`, `tdTowersSchema`, `tdWavesKind`, `tdWavesSchema`, `towerTypeSchema`, `tracePath`.
