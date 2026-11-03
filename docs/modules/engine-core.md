# engine/core

Folder: `engine/core`. Detailed rules: [`engine/core/CLAUDE.md`](../../engine/core/CLAUDE.md).

## Purpose

The engine's core, shared by every backend, kit and game: the fixed-step loop, scenes, input,
chiptune audio and MML, save and settings, the seeded RNG, maths, asset packs, accessibility,
platform detection and graphics data (palettes, sprite sheets, text pixel art, animation, screen
size and fit maths). From Engine 0.10 it also holds the mission contract as plain JSON (mission
definitions, outcomes, effects, opportunities, reports, records and the `MissionAdapter`) and the
`campaign` content kind, shared by the sim, kits and tools; from Engine 0.13 campaigns played in
order, campaign saves and save codes. It holds no game rules and no game
content.

## Public API entry points

There is no `index.ts`; import the file you need as `@engine/core/<path>`.

- `loop.ts`: `FixedLoop`, `Stepper` (the fixed-step loop).
- `scene.ts`: `Scene`, `SceneStack`.
- `rng.ts`: `Rng`, the seeded RNG (`Rng.derived(seed, key)`: its own generator for a key, e.g. a mission's delegation draw). All randomness in kits and the sim goes through it.
- `headless.ts`: the headless game contract (`HeadlessGame`: `step(input)`, `snapshot()`, and the
  optional `order(order)` that takes a run file's recorded orders between steps, returning null
  or why it dropped one, and the optional `miniGame()`, the round the game is hosting now or null,
  Engine 0.10 gap G37; from Engine 0.11 the optional `mission(step)`, a run file's mission step,
  returning null or a `MissionStepRefusal` `{ code, error }`, and `missionExperience()`, the
  played rounds' ticks per mission; `HostedGame<W, E>`: a `HeadlessGame` with `world`, `events` and
  `miniGame()`, what the shell's `HostScene` takes as `game`;
  from Engine 0.13 the optional `campaignSave()`, the campaign save if the entry played now ended
  now;
  `HeadlessEntry`: `createGame(content, seed, opts?)` and the optional `miniGames(content)` (Engine
  0.10, gap G16: the game's mini game defs, for `validate`), `HeadlessOptions` with `disabledRules`
  (the game's own kit's), from Engine 0.14 (gap G12) `disabledRulesByKit` (every kit's, by name;
  `rulesOffFor(opts, kit)` reads one for a `uses` kit's rounds), and, from Engine 0.13, `campaign`, a campaign save to start at, and from Engine 0.14 (gap G9)
  `start`, a `RunStart` (`{ stage }` or `{ entry }`) from a run file's `start`; the optional
  `HeadlessEntry.starts(content)` lists the stages and entries a game can start at),
  `JsonValue` and `canonicalJson` (sorted keys, the text state hashes are made from).
- `view.ts`: the view contract for screenshots (`ViewGame`: a `HeadlessGame` plus `screen`, the
  picture size from the manifest, `render(r)`, and optional `frame()`: the frozen
  `PresentFrame` for the state now with the events since the last call, for any presenter, used
  instead of `render` and never both in one run, and optional `background`, the colour a
  presenter of `frame()` clears to;
  `ViewEntry`: `createView(content, seed, opts?)`), named by `view` in `game.json`.
  `frameView({ game, screen, frames, picture, background? })` (Engine 0.7) builds a `ViewGame`
  from a headless game with `world` and `events`, a frame stream and a drawer per renderer.
- `rules.ts`: named rules for mutant checks (`defineRules`, `RuleSwitch` with `isOn(id)`,
  `unknownRules`). Pure.
- `kit.ts`: the kit hook (`KitDef`: `name`, `kinds()`, `rules`, `strictMutants?`; `defineKit`
  checks it). Each kit exports one as `kit` from `kits/<name>/kit.ts`. Pure.
- `orders.ts`: the RTS order as plain JSON (`orderSchema`: `move`, `attack`, `stop`, `build`,
  `train`, `gather`; `Order`, `ORDER_TYPES`, `parseOrder`), shared by `engine/sim` and kits.
- `rts-types.ts`: the RTS unit and building type table as plain JSON (`rtsTypesSchema`: stats,
  costs, build and training time, what a building trains, drop-offs), shared by `engine/sim` and
  kits. Pure.
- `missions.ts` (Engine 0.10): the mission contract as plain JSON, shared by `engine/sim` and
  kits: `missionSchema` (the `mission` content kind, `*.mission.json`: `id`, `title`, `event?`,
  `worldTimeCost` in ticks, `play?` (from Engine 0.13 optional: a mission without it is a
  choice, only delegated), `params?`, declared `outcomes` with `weight` and data-only `effects`,
  `onQuit`, `playable?`; no retries), `MissionDef`, `MissionEffect` (`damage`, `destroy`,
  `inventory`, `set`, `opportunity`, and from Engine 0.13 `fate` `{ entity, fate, by?, at? }`:
  `injured`, `captured`, `freed` (with the cell `at`, required there) or `dead`; a `damage`
  effect's optional `fromReport` (Engine 0.13, M13) names a played round's report stat its amount
  comes from, the declared `amount` when not played),
  `MISSION_EFFECT_TYPES`, `MISSION_FATES`, `MissionReport` (`{ outcome, stats? }`), `MissionResult`
  (`{ mission, outcome, effects, report? }`), `MissionRecord` (the committed, append-only record),
  `MissionAdapter<KitInput, KitReport>` (`input(snapshot, mission)`, `outcome(report, mission)`),
  `totalWeight`, `pickOutcome(mission, n)` (a delegation draw), `missionResult`, `playedResult`,
  `parseMission`. Pure.
- `campaign.ts` (Engine 0.10 T10, gap G2, item 160; Engine 0.13 T6, decision 6, item 225): the
  order a game plays its levels, missions and world scenarios in, as data, and the campaign run.
  `campaignSchema` is the `campaign` content kind (`*.campaign.json`: `version: 1`, `id`,
  `title?`, `entries` (each exactly one of `{ level }`, `{ mission }` and, from 0.13,
  `{ scenario, ticks }`, none twice; any with an optional `title` for a page, Engine 0.13 T8),
  `start?`); `campaignOrder(campaign)`, `campaignLevels`,
  `entryKind`, `entryId`, `campaignScenarios(entries)` (the content's `worlds-within/scenario`
  files and their `from`), and `checkCampaigns`, the kind's `checkAll`: every named level, mission
  and scenario must be in the game (`missing_level`, `missing_mission`, `missing_scenario`), and a
  scenario that starts from another's results must follow that scenario's entry (`bad_from`).
  **Played in order**: `CampaignSave` (`campaignSaveSchema`: `{ format, version, game, campaign,
seed, position, carried, results }`), `newCampaignSave`, `campaignRun(campaign, save?)` (the entry
  played now, the scenario it is built from, the carried record) and `advanceCampaign(campaign,
save, result)` (position + 1, results appended, `carried` replaced; refusals `wrong_campaign`,
  `campaign_done`, `bad_result` change nothing). Pure.
- `carried.ts` (Engine 0.13 T6): the carried record and carry spec schemas
  (`carriedRecordSchema`, `carryFromSchema`, `carrySpecSchema`, `CARRIED_FATES`), shared by
  `engine/sim/carry.ts` (which re-exports them), the campaign save and save codes. Pure.
- `campaign-code.ts` (Engine 0.13 T6, decision 7, item 226): save codes, "the code is the save".
  `saveCodeContext(content)`, `encodeSaveCode(save, ctx)` and `decodeSaveCode(text, ctx)` (a
  versioned CRC-16 bit layout in Crockford Base32, groups of five; refusals `code_empty`,
  `code_typo`, `code_newer`, `code_layout`, `code_campaign`, `code_position`, `code_record`),
  `normalizeSaveCode`, `carriedMismatch`, `crc16`. Pure.
- `save/campaign-store.ts` (Engine 0.13 T6): `loadCampaignSave`, `storeCampaignSave`,
  `clearCampaignSave` and `campaignSaveKey` (`ww:<game>:campaign:<id>`), through `storage.ts`, so
  blocked storage never throws.
- `mission-adapter.ts` (Engine 0.10 T7; on `PURE_CORE` from 0.11 T7, a kit imports it): playing a mission through a kit's mini game with plain
  data only. `snapshotEntities(snapshot, ...components)` reads a plain world snapshot's entities
  (ascending id, every component); `fateState(entity)` (Engine 0.13) is a snapshot entity's
  `Fate.state` (`active` without one) and `isLost(entity)` whether it is captured or dead, so every
  kit skips the same people; `playMissionRound({ mission, snapshot, adapter, start, input,
maxTicks? })` builds the kit's input with the `MissionAdapter`, steps the round to its result,
  maps its end (`MiniGameEnd`: `result`, the kit's `report()` or null, `ticks`) to a declared
  outcome and returns `{ ok, result }` to commit, or refuses `unfinished`, `unmappable_report`
  (the adapter threw) or `unknown_outcome` (undeclared or unplayable). A round ended by `quit`
  skips the adapter and the `playable` check: it returns `{ ok, quit: true, result }` with the
  mission's `onQuit`, which the caller resolves with `quitMission` before committing, so the record
  says `quit`. The round steps through a `RoundInput` with the optional `inputMap` (Engine 0.11,
  gap G18), so a button already held on tick 0 does nothing until released. `missionRoundEnd(mission,
adapter, end)` (Engine 0.11) is the end-mapping half on its own, for a host that steps the round
  tick by tick (`MissionHost`). Pure in practice, not on `PURE_CORE` yet (no kit or sim file imports
  it at run time).
- `mission-host.ts` (Engine 0.11 T5, items 172-174): live mission hosting. `MissionHost({ game?,
port, missions, miniGames, adapters, hostStatus? })` wraps a game's `HeadlessGame` and is one
  itself, with `mission(step)` (a run file's `missions` steps), `launch(id)`, `play(id, script?)`,
  `delegate(id)`, `quit(id)`, `miniGame()` (the round hosted now, for `HostScene`) and
  `missionExperience()`. The world is behind a `MissionWorldPort` (`open`, `delegate`, `play`,
  `quit`, `settle`, `snapshot`, `step`) the game's glue fills with `missionPort(world, { refs })`
  from `engine/sim`, so core never imports the sim. A step with no round steps the game (or the
  port's world) and settles; while a round is hosted the round steps (through a `RoundInput`, fed
  the `play` step's recorded script or the host's frame) and the world does not, orders and steps
  are refused (`round_hosted`), and the round's end is mapped with `missionRoundEnd` and resolved
  through the port on that tick; the world then steps on one tick per game tick and the result
  commits at the fixed commit tick. The snapshot adds `missions: { round }` only while a round is
  hosted and on the tick it ends.
- `minigame.ts`: the mini game contract (`MiniGameResult` `pass` | `fail` | `quit`,
  `MiniGameContext`, `MiniGame`: `step`, `snapshot`, `result`, `present?`, `report?` (a
  structured JSON report, Engine 0.10); `MiniGameDef`: `id`, `title`, `paramsSchema?` (Zod, Engine
  0.10), `checkUse?` (Engine 0.11: problems beyond the shape, given the params and the content
  entry naming the game, such as a mission's undeclared outcome), `create(ctx, seed)`;
  `miniGameTable`). No scenes, so kits host mini games headless. From
  Engine 0.11 (gaps G18, G19): `MiniGameDef.inputMap?` (host action to round action, null drops
  it) and `RoundInput`, which every host steps its round through (`round.step(roundInput.advance(
frame))`): a button held into the round (held, not pressed, on its first tick) is ignored until
  released, then the map applies; `MiniGameDef.hostStatus?` (the host HUD keys a round shows),
  `MiniGameContext.hostStatus?` (their values, plain JSON) and `hostStatusFor(def, status)`. Pure.
- `minigame-params.ts` (Engine 0.10, gap G16): `MiniGameUse` (a place in the content naming a mini
  game and its params), `missionMiniGameUses(content)` and `miniGameParamErrors(uses, defs, root?)`:
  `unknown_mini_game` at the id, or the def's `paramsSchema` issues at their field
  (`triggers.0.params.goal`), then (Engine 0.11) the def's `checkUse` problems as
  `bad_mini_game_use` (a mission's use carries the mission as `owner`). A kit lists its own uses
  with `KitDef.miniGameUses`, and from Engine 0.11 its fixed-id mini games' params schemas for the
  schema reference with `KitDef.paramsDocs`. Pure.
- `minigame-scene.ts`: `miniGameScene(opts)`, the `Scene` a game's glue pushes over a level to
  drive the same `MiniGame` and pop it on its result; stepping the round itself it uses a
  `RoundInput` (`inputMap?` option), while a host's `step` gets the raw frame. Games only (kits may not import it); `HostScene`
  (`shell/`) pushes it for a game. Pure.
- `gfx/renderer.ts`: the drawing interface (`Renderer`, `Rotation`, `transformed`,
  `translucent`, `clipped`, `OffsetRenderer`). Backends implement it.
- `gfx/`: `palette.ts` (the `NES` colour names), `spritesheet.ts`, `pixelart.ts`, `animation.ts`,
  `screen.ts` (`ScreenSize`, `DEFAULT_SCREEN` 256x240, `SCREEN_MIN` / `SCREEN_MAX`, `fitGame(size, ...)`).
- `input/`: actions, bindings, `input-manager.ts`, `scripted-input.ts` (`ScriptedInput` for repeatable
  runs) and the browser sources (keyboard, gamepad, touch). Pointer input (Engine 0.9):
  `pointer-logic.ts` (`PointerGestures`: samples in, `tap` / `box` / `pan` / `zoom` gestures out,
  for mouse, pen and touch, with long-press, edge scroll, wheel and pinch; pure) and `pointer.ts`
  (`PointerSource`, its DOM side on the canvas, read per game step with `gestures()`).
- `audio/`: `mml.ts` (MML compiler), `sequencer.ts`, `apu.ts`, `audio-manager.ts`.
- `audio/song-schema.ts`, `gfx/sprite-schema.ts`: the song, sound-effect and sprite file schemas.
- `content/`: reading and checking content files; see [engine/core/content](engine-core-content.md).
- `present/`: the presentation contract, the read-only frame a backend draws from; see
  [engine/core/present](engine-core-present.md).
- `shell/`: the browser shell games share (`backendFromQuery`, `otherBackendLink`, `HostScene`,
  `bootBrowserGame`); see [engine/core/shell](engine-core-shell.md).
- `assets/`: the sprite sheet registry (`registry.ts`), asset packs, and `sheet-lookup.ts`
  (`sheetLookup(assets)`, a `SheetLookup` that returns null instead of throwing for a missing sheet
  or palette; backends and games use it) and `content-sheets.ts` (`contentSheets(content)`: a
  game's sprite and palette files as a `SheetLookup`, Engine 0.7 T9).
- `save/`, `a11y/`, `math/`, `platform.ts`.

## Imports allowed

- Other files in `engine/core` (relative paths) and npm packages.
- Never `engine/backends`, `engine/sim`, `engine/tools`, kits or games.
- Files on `PURE_CORE` in `config/layers.js` must stay pure: no `Math.random`, `Date.now`,
  `performance.now` or DOM globals.

## How to test

Tests sit next to the code as `*.test.ts` and run in Node with `pnpm test`, using fakes for canvas,
audio and DOM. `missions.test.ts` covers mission definitions (valid, no outcomes, duplicate outcome ids, a bad
`worldTimeCost`), delegation draws and the adapter; `mission-adapter.test.ts` the snapshot reader and every
`playMissionRound` path. `tests/kits/mission-adapter.test.ts` plays the siege fixture's `raid`
mission through the topdown kit's data-driven `mission-room` adapter (and delegates it), outside
every layer. `mission-host.test.ts`
covers `MissionHost` over a fake port; `tests/kits/mission-host.test.ts` hosts the siege fixture's
`raid` live over the real sim and the RTS kit (played through a scripted topdown round and
delegated, both committing at open + cost, the battle frozen, the barracks going up, the same
hashes every run). `campaign.test.ts` covers
campaign files (good, and each broken field's code), the play order from `start`, and the
loader naming the file and field of a missing level or mission. `input/pointer-logic.test.ts` scripts mouse and two-finger touch sequences (click,
box, pan, wheel, pinch, long-press, edge scroll); `input/pointer.test.ts` drives `PointerSource`
with fake events. `tests/architecture/purity.test.ts` and `no-content.test.ts` guard purity and the
no-content rule.
