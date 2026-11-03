# engine/core

The engine's core: the fixed-step loop (`loop.ts`; from Engine 0.14 T8 `{ manual: true }` makes it
step only through `advance(n)`, never on `requestAnimationFrame`: the shell's step hook), scenes (`scene.ts`), input (`input/`), chiptune
audio and MML (`audio/`), save and settings (`save/`), the seeded RNG (`rng.ts`), maths (`math/`),
asset packs (`assets/`), accessibility (`a11y/`), platform detection (`platform.ts`), graphics
data: palettes, sprite sheets, text pixel art, animation and the screen size and fit maths
(`gfx/`), and the content core (`content/`: Zod schemas, text grids and content errors; see
[content/CLAUDE.md](content/CLAUDE.md)), the presentation contract (`present/`: the read-only
per-frame snapshot a backend draws from; see [present/CLAUDE.md](present/CLAUDE.md)), the browser shell
games share (`shell/`: the `?backend=` choice, `HostScene` and `bootBrowserGame`; see
[shell/CLAUDE.md](shell/CLAUDE.md)), with `node/game-files.ts` reading a game's content
files from disk for Node tools and tests.

`headless.ts` is the headless game contract: `HeadlessGame` (`step(input)`, `snapshot()` as plain
JSON-safe data, the optional `order(order)`, and from Engine 0.10 the optional `miniGame()`, the
round the game is hosting now or null: gap G37, item 159) and `HeadlessEntry` (`createGame(content, seed)`, and from Engine
0.10 the optional `miniGames(content)`, the `MiniGameDef`s the game's content may name, which
`validate` checks trigger and mission params against: gap G16), which a game's headless module
(named by `headless` in `game.json`) exports for `pnpm cli run`, `dump` and `validate`. `order(order)` (Engine 0.9, items 124-125) takes one recorded order between steps: a run
file's `orders` entry `{ tick, ...order }` goes in, without `tick`, after the snapshot of its tick
and before the step from it, and the game returns null (applied) or a one-line reason (dropped, not
an error). Games without orders leave it out and are unchanged; a run file with `orders` for a game
without it is a usage error (`engine/tools/CLAUDE.md`, Recorded orders). From Engine 0.11 (item 172) the optional `mission(step)` takes one run file `missions` step the same way (`{ mission,
action, input? }`, after the tick's orders) and returns null or a `MissionStepRefusal` `{ code,
error }`; the optional `missionExperience()` gives the ticks its played rounds took per mission,
for the run's `experience` (`MissionHost` has both). From Engine 0.13 (decision 9, item 228) the optional `campaignSave()` gives the campaign save (`campaign.ts`) the game's campaign would have if the entry played now ended at this tick (null when it plays no campaign), for a run file's `codes`, `pnpm cli code` and a later run's `from`; `HeadlessOptions.campaign` hands `createGame` a campaign save to start at (its `position`'s entry, from tick 0, with its carried record). From Engine 0.14 (gap G9, decision 6, item 252) `HeadlessOptions.start` (`RunStart`: `{ stage }`, a level of the game's level sequence, 0-based, or `{ entry }`, a campaign entry by id, played fresh with no carried record) is a run file's `start`, and the optional `HeadlessEntry.starts(content)` (`HeadlessStarts`: `stages`, the level ids in play order, and `entries`, the campaign's entry ids) lists what a game can honour; the tools refuse a `start` it does not list (`no_start`, `bad_start`). From Engine 0.14 T7 (decisions 3 and 4, items 249-250) two optional read-only hooks give the tools a game's world: `worldEvents(sinceTick)` -> `WorldEvents` `{ from, tick, changes }` (the world's kept event log from that world tick, `from` the oldest tick kept, `tick` the world tick now; named `worldEvents` because a `HostedGame`'s `events` is its last step's draw events) and `timeline()` (the world's timeline record, `engine/sim/timeline.ts`, `clock` null: the tools fill it). Neither is part of `snapshot()`, so no hash moves; a game with no world leaves both out and `pnpm cli events` and `timeline` say `no_world`. `HostedGame<W, E>`
(Engine 0.10, gap G37) is a `HeadlessGame` the browser shell's `HostScene` can play by itself:
`world` (the world now; a new object on a new level), `events` (the last step's) and a required
`miniGame()`; the platformer kit's `LevelSequence` is one (and so is `MissionHost`), so a game's page passes the game to
`new HostScene({ stack, game, picture })` instead of writing accessors. `canonicalJson(value)`
writes a snapshot with sorted keys and throws on anything not JSON-safe (`undefined`, `NaN`,
`Map`...), naming the path; the tools hash that text. It is pure (on `PURE_CORE`).

**Recording rounds** (Engine 0.14 T9, gap M19; docs/BUILD-LOG.md, Engine 0.14, decision 10, item
256): two more optional `HeadlessGame` hooks, `recordRounds(on)` (from now on record the input of
every hosted round that starts) and `roundRecordings()` (`RoundRecording { mission, tick, ticks,
done, input }`: the mission, the game tick of its `play` step, the round's ticks so far, whether it
ended, and its input from frame 0 as `ScriptedInput` steps, what a run file's `play` step takes).
`MissionHost` has both; never in `snapshot()`, so no hash moves. `input/input-recorder.ts`
(pure, on `PURE_CORE`) is `InputRecorder`: `record(held)` (or `recordFrame(frame)`) once per frame,
`script()` the shortest `InputScript` that replays it (one step per change of the held set, holds
in `Actions` order, no step before the first held frame), and `heldActions(frame)`; tested in
`input/input-recorder.test.ts` (recorded then replayed through `ScriptedInput`: the same held
actions at every frame, on seeded random holds). From Engine 0.15 T5 (gap D1) it records the
frame's taps too (`record(held, taps?)`; the script's `taps`, left out when none).

**Input and settings** (Engine 0.15 T5, gaps M1, D1, D2, D12; docs/BUILD-LOG.md, Engine 0.15,
decisions 5 and 6, items 282-283). A pointer tap is frame input: `FrameTap { x, y, button }` in
the game's screen pixels, the optional `InputFrame.taps()` (`frameTaps(frame)` reads it, none when
left out; `TAP_BUTTONS`), on `ActionState` (the shell's `addTaps` from the pointer), on
`ScriptedInput` (an `InputScript`'s optional `taps: [{ frame, x, y, button? }]`, a run file's
`input.taps`) and passed through by `RoundInput` (`taps()`, so a hosted round reads them; D12)
and recorded by `MissionHost`. `input/merged-input.ts` (pure, on `PURE_CORE`): `MergedInput`, the
input of the loop steps since a slower scene's last tick as one frame (pressed on any counts as
pressed and held, every step's taps); `Scene.tickRate` (`scene.ts`) makes `SceneStack` step that
scene only on its ticks (`LOOP_HZ` 60, an accumulator, so any rate up to the loop's) with it (D2).
`InputManager.press(action)` is a page button: held on player 1's next frame only.
`save/settings.ts` holds the player's stored volumes (`StoredVolumes`, `DEFAULT_VOLUMES`,
`volumesKey(game)` = `ww:<game>:volumes`, `readVolumes` checking every field, `loadVolumes(game,
start?)`, `storeVolumes`; never throws, never read by a headless run) for the shell's volume
control (M1, `shell/volume-control.ts`). Tested in `input/merged-input.test.ts`,
`input/input-recorder.test.ts`, `minigame.test.ts` and `shell/shell.test.ts`.

**Mission data by scenario key** (Engine 0.15 T7, gaps M10, D6, M17, M28, M25, D7;
docs/BUILD-LOG.md, Engine 0.15, decision 8, item 285). The optional `HeadlessGame.worldKeys()` is
the game's world key table (scenario key to entity id; `engine/sim`'s `worldKeys`), never in
`snapshot()`, for the tools' `world.key.<key>` run checks; `MissionHost.worldKeys()` gives the
port's optional `keys()` (`{}` without it) and `MissionHost.records()` the port's committed
records (gap M28: a page reads the host, not the sim's components). `MissionWorldPort.open` may
return `keys` beside the snapshot, and `MissionAdapter.input(snapshot, mission, keys?)` (and
`playMissionRound`'s `keys` option) hands that whole table to the kit's adapter, so a mission's
params and rules may name any keyed entity, not only the ones its effects name. A mission file's
optional `marker` (`missionSchema`) is the scenario key the RTS kit's offer marker stands over (gap
M25). `MiniGameUseCheck.scenarios` (`MiniGameWorldScenario { file, snapshot, keys }`) is the
game's world scenarios that offer the mission, built at tick 0 by the tools, so a kit's `checkUse`
checks its selectors against them (lesson D7); `miniGameParamErrors(uses, defs, root?,
scenarios?)` takes them as `GameWorldScenario` (the same plus `offers`, the mission ids its
opportunities name) and hands each mission's use the ones that offer it. Tested in
`mission-host.test.ts`, `kits/topdown/mission-room.test.ts`, `kits/towerdefense/mission-defence.test.ts`
and `engine/tools/mini-game-check.test.ts`.

`state-hash.ts` (Engine 0.14 T8, gap G31) is the state hash, `stateHash(snapshot)`: the first 16
hex digits of the SHA-256 (`sha256Hex`, written out, synchronous) of `canonicalJson(snapshot)`.
The tools re-export it (`engine/tools/headless-run.ts`) and the browser shell's step hook
(`shell/debug.ts`) uses it, so a page and `pnpm cli run` hash a state the same way. A `Scene` may
report the headless game it plays (`Scene.headless()`, `scene.ts`; `HostScene` does), which the hook
snapshots and hashes. Pure (on `PURE_CORE`); tested in `state-hash.test.ts` against Node's crypto.

`view.ts` is the view contract: `ViewGame` (a `HeadlessGame` plus `screen`, the picture size it
draws, taken from `content.manifest.screen`, `render(r)`, and the optional `frame()`) and
`ViewEntry` (`createView(content, seed, opts?)`), which a game's view module (named by `view` in
`game.json`) exports for `pnpm cli screenshot`. `frame()` (Engine 0.6) returns the frozen
`PresentFrame` for the state now, with the events since the last call, so a tool can show the game
through any `Presenter` (the Three.js backend) instead of drawing it with `render(r)`; a run uses
one or the other, never both (each keeps its own stream of frames). Like `render`, it must not
change the game. The optional `background` (a CSS hex colour) is the colour a presenter of
`frame()` clears to (`screenshot --backend three`) when it is not the skin's: left out, the skin's
`background` is used, else black (Engine 0.15, gap G36; no game sets it now). `frameView({ game,
screen, frames, picture, background? })` (Engine 0.7, gap G26) is the one helper there: a
`ViewGame` over a headless game that shows `world` and its last step's `events` (a kit's level
sequence), keeping the events between draws in a `PendingEvents` (dropped on a new world), with
`render(r)` drawing through `picture(r)` (made once per renderer) and `frame()` from `frames.next`
(`view.test.ts`).

`rules.ts` is the named-rule mechanism behind mutant checks: a kit declares its rules with
`defineRules([{ id, description }])` and builds a `RuleSwitch(rules, disabled)` from the ids a run
switches off (`HeadlessOptions.disabledRules`, passed by `createGame(content, seed, opts)`); its
code guards each rule with `isOn(id)`. Unknown ids throw. It is pure (on `PURE_CORE`). A game on
several kits (Engine 0.14, gap G12) gets every kit's ids in `HeadlessOptions.disabledRulesByKit`
(by kit name; `disabledRules` stays the main kit's) and hands each kit its own list with
`rulesOffFor(opts, kit)` (`headless.ts`), so each `RuleSwitch` only sees its kit's ids.

`kit.ts` is the kit hook: `KitDef { name, kinds(), rules, strictMutants?, miniGameUses?,
paramsDocs?, roundBots? }` (`roundBots()`, Engine 0.14 T9: `KitRoundBotDef { game, description,
plan, create(plan) }`, a bot for one of the kit's mini games, its plan's Zod schema, and
`KitRoundBot.next(round)`, the actions to hold on the coming tick, for `pnpm cli record --bot`), what a kit tells the tools about itself (`miniGameUses(content)`, Engine 0.10: where
the kit's content names a mini game and its params, such as a platformer level's triggers, for
`validate`; `paramsDocs()`, Engine 0.11: `KitParamsDoc { game, description, schema }` for the
params of its own fixed-id mini games, listed by `pnpm docs:gen` in `docs/reference/schemas.md`), and `defineKit(def)`, which checks the name (lower-case letters, digits and
"-") and the rule list (`defineRules`) and throws on a bad one. Each kit exports one as `kit` from
`kits/<name>/kit.ts`. Pure (on `PURE_CORE`).

`minigame.ts` is the mini game contract, in the style of SMBC's `MiniGameDef`: `MiniGameResult`
(`pass` | `fail` | `quit`), `MiniGameContext` (`params`, the host's JSON data for the round, and
`attempt`), `MiniGame` (`step(input)`, `snapshot()` as JSON-safe data, `result()` null until it
ends, `present?()` a `PresentFrame`, and from Engine 0.10 the optional `report?()`, a structured
JSON-safe report read once the round has ended, which a mission's adapter turns into an outcome),
`MiniGameDef` (`id`, `title`, the optional `paramsSchema` (Zod, Engine 0.10: the shape of the
round's `params`, for `validate`, gap G16), the optional `checkUse({ params, owner })` (Engine
0.11, item 176: what the schema cannot see, such as a rule naming an outcome the mission, `owner`,
does not declare; it returns `MiniGameUseProblem { path, message }`s), the optional `inputMap` and `hostStatus` (Engine 0.11,
below), `create(ctx, seed)`: everything random from `seed`) and `miniGameTable(defs)` (the defs by id; throws on a bad id or one given
twice). A host (a kit's world) steps the round headless while it pauses itself and puts the
round's snapshot in its own, so hashes cover it. **Round input and host HUD (Engine 0.11, gaps G18
and G19, items 177-178).** `MiniGameDef.inputMap?` (`MiniGameInputMap`, host action to round
action, null to drop it; unnamed actions pass as they are; `miniGameTable` throws on a name that is
not an `Action`) is the round's own controls. `RoundInput(inputMap?)` is the one wrapper every host
steps its round through, `round.step(roundInput.advance(hostFrame))`, one per round: on the round's
first tick every host action held but not pressed there (it was down before the round started) is
masked until a frame without it, then the map applies; `pressed`, `released`, `dirX` and the jump
buffer are the round's own (a jump before the round never counts). A script whose first frame
holds a button (a run file's `play` script) counts it as pressed, so it plays as written. The hosts
are the platformer kit's world, `miniGameScene` when it steps the game itself, `playMissionRound`
and `MissionHost`; `HostScene` steps the host, which does it, so no game writes it.
`RoundInput.source()` (Engine 0.14 T9) is the host actions the last `advance` let through (held,
not masked, before the map): what `MissionHost` records, so the recording fed back as the host
frame (its first frame pressed, nothing masked) steps the round exactly the same.
`MiniGameDef.hostStatus?` lists the host HUD status keys a round shows; the host passes their
values as `MiniGameContext.hostStatus?` (plain JSON, `HostStatus`), picked with
`hostStatusFor(def, status)` (undefined when none, so the context leaves it out and the round is
unchanged); a round that presents adds each as status `host:<key>` for its skin (the topdown
kit's room challenge does). Tested in `minigame.test.ts`. It imports no scene, so kits may use it; pure (on
`PURE_CORE`). `minigame-params.ts` (Engine 0.10 T8, gap G16, item 157) checks mini game params with the content:
a `MiniGameUse` `{ file, game, gameAt, params, paramsAt }` is one place in a game's content that
names a mini game (a level trigger, a mission's `play`) and hands it params;
`missionMiniGameUses(content)` lists the missions' (`play`, `params`, `{}` when none), a kit's hook
gives its own (`KitDef.miniGameUses`); `miniGameParamErrors(uses, defs, root?)` returns a
`ContentError` per problem, in the uses' order: `unknown_mini_game` at the id (naming the ids
there are) when no def has it, else each issue of the def's `paramsSchema` (when it has one) at its
field under the params (`triggers.0.params.goal`), with Zod's codes, and once they pass, each
problem of the def's `checkUse` as `bad_mini_game_use` at its field (`params.outcomes.0.outcome`;
a mission's use carries the mission as its `owner`, a level trigger's none). It builds no round. Pure (on
`PURE_CORE`); tested in `minigame-params.test.ts`; `engine/tools/mini-game-check.ts` runs it.
`minigame-scene.ts` is the browser side for games' glue: `miniGameScene({ game,
step?, render, done, translucent? })`, a `Scene` to push over the level that steps the same
`MiniGame` (through a `RoundInput` with the option `inputMap?`, Engine 0.11) or the host's `step`
(given the raw frame, so the host still applies the outcome and its own `RoundInput`) and calls `done(result)`
once, for the glue to pop it; it is on `FORBIDDEN_CORE`, so kits never import it, and pure (on
`PURE_CORE`: `shell/host-scene.ts` imports it). Games rarely push it themselves: `shell/host-scene.ts`
(`HostScene`) does it for any host that reports a running mini game.

`orders.ts` (Engine 0.9 T7-T8, item 122) is the RTS order as plain JSON data, defined here so both
`engine/sim` (which carries orders out with `applyOrder`) and kits (which make them) can use it:
`orderSchema` (a Zod union on `type`: `move` with a `target` cell, `attack` with a `target`
entity id, `stop`, `build` with a `target` cell (the north-west cell) and a `building` type,
`train` with a `target` unit type (its `units` are the buildings that train it), `gather` with a
`target` resource node; each with `id` >= 1, `faction` and unique `units`), the `Order` type,
`ORDER_TYPES` and `parseOrder(json)` -> `{ ok, order }` or `{ ok: false, error }` with one line per
bad field (`units: units must not repeat`). Pure (on `PURE_CORE`); tested in `orders.test.ts`.

`missions.ts` (Engine 0.10 T2, items 153-154) is the mission contract as plain JSON data, here
for the same reason: `engine/sim` runs the lifecycle (open, play or delegate, commit, frozen
events) and kits play missions, and neither imports the other. `missionSchema` is a mission
definition and the `mission` content kind (`*.mission.json`, `content/engine-kinds.ts`): `id`,
`title`, `event?` (the event frozen while it is open), `worldTimeCost` (whole ticks, at least 1,
fixed when it opens), `play?` (the mini game or kit round a player plays it with; from Engine 0.13
optional: a mission without it is a choice with a record, such as paying a ransom, only delegated,
and `missionMiniGameUses` and `MissionHost` skip it, a host `play` step refused `not_playable`), `params?` (JSON,
checked by that mini game's `paramsSchema` when `validate` runs: `minigame-params.ts`), `outcomes` (at least one, unique ids, each
`{ id, title, weight (whole, >= 1, default 1), effects }`), `onQuit` (a declared outcome) and
`playable?` (a subset). Effects are data only, told apart by `type`: `damage`, `destroy`,
`inventory`, `set`, `opportunity` and, from Engine 0.13 (decision 2, item 221), `fate`
(`MISSION_EFFECT_TYPES`): `fateEffectSchema` `{ entity, fate, by?, at? }`, `fate` one of
`MISSION_FATES` (`injured`, `captured`, `freed`, `dead`), `by` a faction id, `at` a cell
`{ x, y }` given exactly on `freed` (`bad_effect` at `at` otherwise). The sim applies it with
`setFate` and skips (never errors on) one that cannot move the fate there. A `damage` effect's
optional `fromReport` (Engine 0.13, decision 4, item 223, M13) names a stat of the played round's
report (`heroHpLost` from the topdown kit's mission room) whose whole number is the amount (0 skips
it); delegated, quit and timed-out missions have no report and take the declared `amount`. There is no retry: no `attempt`, a
mission ends in one declared outcome. The types: `MissionReport` (`{ outcome, stats? }`, what a kit
reports through its adapter), `MissionResult` (`{ mission, outcome, effects, report? }`),
`MissionRecord` (the committed, append-only record the sim keeps: `resolution`, `openTick`,
`commitTick`, `experienceTicks`, `skipped`) and `MissionAdapter<KitInput, KitReport>`
(`input(snapshot, mission)` from the plain world snapshot, `outcome(report, mission)` to a
`MissionReport`). Helpers: `totalWeight`, `pickOutcome(mission, n)` (the outcome a delegation draw
`n < totalWeight` falls in, walking file order), `missionResult(mission, id, report?)` (refuses an
undeclared, or for a played one unplayable, id as `unknown_outcome`), `playedResult(adapter,
mission, kitReport)` and `parseMission(json)`. From T5, `opportunitySchema` (`OpportunityDef`, a
window `{ id, mission, opens, closes, exclusive?, closesOthers?, relative? }` with `opens <
closes`; `engine/sim/opportunity.ts` runs it) and `parseOpportunity(json)`. Pure (on `PURE_CORE`); tested in
`missions.test.ts`; in `docs/reference/schemas.md`.

`campaign.ts` (Engine 0.10 T10, gap G2, item 160; Engine 0.13 T6, decision 6, item 225) is the
order a game plays its levels, missions and world scenarios in, written in data, and the campaign
run: `campaignSchema` is the `campaign` content kind (`*.campaign.json`, `content/engine-kinds.ts`):
`version` (1), `id`, `title?`, `entries` (at least one; each exactly one of `{ "level": id }`,
`{ "mission": id }` and, from Engine 0.13, `{ "scenario": id, "ticks": n }` (a world scenario,
any content file in the `worlds-within/scenario` format such as an `rts-map`, and the world ticks
it is played; from Engine 0.13 T8 any entry may have a `title`, one line a page shows; `ticks` on another entry or missing on a scenario is `bad_entry` at `ticks`),
`bad_entry`; none twice, `duplicate_entry`) and `start?` (the id of the entry played first,
`unknown_entry` when there is none, `ambiguous_start` when entries of two kinds share it). Its
`checkAll`, `checkCampaigns`, fails each entry naming a level, mission or scenario the game's
content lacks (`missing_level`, `missing_mission`, `missing_scenario`, at `entries.<i>.level`,
`.mission` or `.scenario`; scenarios are found by shape through `others(ANY_KIND)`,
`campaignScenarios`), and a scenario entry whose scenario has a `from` naming anything but the
scenario entry just before it in play order (`bad_from`; the first scenario entry may have a `from`
and then starts as written), so `pnpm cli validate` names the file and field.
`campaignOrder(campaign)` is the entries from `start` and then round to the ones before it;
`campaignLevels(campaign)` the level ids in that order; `entryKind`, `entryId`. The platformer
kit's `contentStages` plays the level entries.

**Played in order** (Engine 0.13, closing the 0.10 leftover): a campaign run's state is its
**campaign save**, plain JSON (`campaignSaveSchema`, `CampaignSave`; in
`docs/reference/schemas.md`): `{ format: "worlds-within/campaign-save", version: 1, game,
campaign, seed, position, carried, results: [{ entry, missions: [{ mission, outcome, resolution
}] }] }`, `position` the entry played now (its index in play order), `carried` the carried record
(`carried.ts`) the next scenario entry starts from, or null, and one `results` entry per finished
entry, in play order. `newCampaignSave({ game, campaign, seed })` starts one;
`campaignSaveAt(campaign, { game, seed }, entry)` (Engine 0.14, gap G9) is a save at the entry with
that id, fresh (no carried record, every earlier entry finished with nothing committed), or null;
`campaignRun(campaign, save?)` reads it (`{ order, position, entry, done, scenario,
nextScenario, carried }`: `scenario` the scenario entry the world is built from, the entry itself
or for a mission entry the scenario before it, whose end world it is opened on); and
`advanceCampaign(campaign, save, { missions?, carried? })` finishes the entry played now: position

- 1, its results appended and `carried` replaced when given (a mission entry commits exactly its
  own mission; a level entry commits nothing and carries nothing; a scenario entry commits whatever
  its world offered). Refusals (`wrong_campaign`, `campaign_done`, `bad_result`) change nothing.
  Pure and deterministic: the same save and result give the same next save. A game's glue builds
  the worlds (`worldFromScenario(json, { carried })` in `engine/sim`) and reports what was
  committed. Pure (on `PURE_CORE`); tested in `campaign.test.ts`; in `docs/reference/schemas.md`.

`carried.ts` (Engine 0.13 T6) holds the carried record and carry spec schemas
(`carriedRecordSchema`, `carryFromSchema`, `carrySpecSchema`, `CARRIED_FATES`, `CARRIED_FORMAT`,
`CARRIED_VERSION`), moved here from `engine/sim/carry.ts` (which re-exports them and builds and
applies records) so the campaign save and save codes share them without importing the sim; the
RTS kit's `rts-map` checks its `from` with `carryFromSchema`. Pure (on `PURE_CORE`).

`campaign-code.ts` (Engine 0.13 T6, decision 7, item 226) is **save codes**: SMBC's "the code is
the save". `saveCodeContext(content)` reads a game's campaigns, missions and scenarios (any
`worlds-within/scenario` file, with its `from` and the factions its `Owner` and `Stockpile`
components name); `encodeSaveCode(save, ctx)` packs a campaign save and `decodeSaveCode(text, ctx)`
reads it back, the same save on every machine. Layout: version (4 bits), CRC-16/CCITT (0x1021,
start 0xFFFF) over every later bit, then the campaign's index (campaigns by id), the position, the
seed (zig-zag), the carried record (a present bit, the tick, per person of the next scenario
entry's carry spec the fate in 3 bits and `by` (an index into the two scenarios' factions), `at`,
`hp`, `max`, then the stockpile items; key names never written) and the results (per finished
entry the mission count, per mission its index (missions by id), the outcome's index in its file
and the resolution in 2 bits), zero-padded; numbers are 4-bit groups with a "more" bit, a nullable
one written plus one. Text: Crockford Base32, groups of five joined by dashes;
`normalizeSaveCode` ignores case, dashes and spaces and reads O as 0, I and L as 1. Refusals
`{ ok: false, code, error }`: `code_empty`, `code_typo` (a bad character or checksum: any tampered
character), `code_newer`, `code_layout` (too short, leftover bits, a field out of range),
`code_campaign`, `code_position` (past the end), `code_record` (the carried part does not fit the
next scenario's carry spec, `carriedMismatch`); encoding a save that does not fit the game is
refused with the same codes. A code does not replay the first scenario: a code taken at its end
restores what carries, so the follow-up's start world built from it has the same hash as one built
from the end world's carried record (`engine/tools/save-code.test.ts`). Pure (on `PURE_CORE`);
tested in `campaign-code.test.ts` (round trips at every position, every tampered character refused,
each refusal, CRC check value, the 40-character budget).

`save/campaign-store.ts` (Engine 0.13 T6) keeps a campaign save in browser storage through
`save/storage.ts` under `campaignSaveKey(game, campaign)` = `ww:<game>:campaign:<id>`:
`loadCampaignSave` (null when there is none, storage is blocked or the stored data is not a save of
that game and campaign), `storeCampaignSave` (false when storage refused) and `clearCampaignSave`;
none throws, so a game stays playable without storage (`campaign-store.test.ts`).

`mission-adapter.ts` (Engine 0.10 T7) is the reusable half of a `MissionAdapter`: playing a
mission through a kit's mini game with plain data only, so the kit never imports `engine/sim`.
`snapshotEntities(snapshot, ...components)` lists a plain world snapshot's entities (`{ id,
components }`, ascending id, with every component) that have all the named components; it throws
on a snapshot not of the world's shape. `fateState(entity)` (Engine 0.13, decision 3, item 222) is
a snapshot entity's `Fate.state` (`SnapshotFate`: `active` when it has no `Fate`; an unknown state
throws) and `isLost(entity)` whether it is `captured` or `dead`: the topdown, tower-defense and RTS
kits read fates through them, so no mode picks or shows someone the world has lost. `playMissionRound({ mission, snapshot, adapter, start,
input, inputMap?, maxTicks? })` calls `adapter.input(snapshot, mission)`, starts the round with `start`
(usually a `MiniGameDef`'s `create`), steps it with `input(tick, round)` through a `RoundInput`
(Engine 0.11, gap G18: a button already held, not pressed, on tick 0 is ignored until released;
`inputMap` applied) until `result()` is
non-null, then maps its end, `MiniGameEnd` `{ result, report (the round's `report()`, or null),
ticks }`, through `adapter.outcome` and checks it with `playedResult`. It returns `{ ok: true,
result, end, round }` (the `MissionResult` the caller commits, e.g. `commitMission(world, id,
result)`) or refuses with `code`: `unfinished` (no result within `maxTicks`, default
`MISSION_ROUND_MAX_TICKS` = 100,000), `unmappable_report` (the adapter threw: the report fits no
outcome) or `unknown_outcome` (an undeclared outcome, or one outside `playable`). A refusal commits
nothing. A round that ends in `quit` is not a played result: it skips the adapter and the
`playable` check and returns `{ ok: true, quit: true, result }` with the mission's `onQuit` (no
report); the caller resolves it with `quitMission(world, id)` and then commits, so the record's
resolution is `quit`. Every other success has `quit: false`. The adapter itself (which entities become what, which report means which outcome) belongs
to the kit, driven by the mission's data: the topdown kit's `topdownMissionAdapter` and
`mission-room` mini game (`kits/topdown/mission-room.ts`, Engine 0.11 T7), played over the siege
fixture in `tests/kits/mission-adapter.test.ts`. `missionRoundEnd(mission, adapter, end)` (Engine 0.11, item 173)
is the end-mapping half of `playMissionRound` on its own (quit to `onQuit`, else the adapter and
`playedResult`, refused as `unmappable_report` or `unknown_outcome`), for a host that steps the
round tick by tick. Pure, and on `PURE_CORE` since Engine 0.11 T7 (the topdown kit's mission
room imports `snapshotEntities`). Tested in `mission-adapter.test.ts`.

`mission-host.ts` (Engine 0.11 T5; docs/BUILD-LOG.md, Engine 0.11, decisions 1-3, items 172-174)
is live mission hosting. `MissionHost({ game?, port, missions, miniGames, adapters, hostStatus? })`
wraps a game's `HeadlessGame` (the RTS kit's `RtsGame` in the mini siege) and is itself a
`HeadlessGame` and a `HostedGame` (`world` is the host itself, `events` the game's), so the tools
run it and the shell's `HostScene` plays it.

- **The port.** It never imports `engine/sim`: the world is behind a `MissionWorldPort` with
  `open(def)` (`{ ok, snapshot, commitTick, seed }`: the plain snapshot the mission opened with and
  the round's seed), `delegate(id)`, `play(id, result)`, `quit(id)`, `settle()` (the ids
  committed), `snapshot()` and `step()`, and optionally (Engine 0.15 T7) `keys` on `open`'s answer
  and `keys()`, the world's key table. `missionPort(world)` in `engine/sim` fills it, so the
  game's glue is one call. With no `game`, the host steps the port's world itself.
- **Adapters** are keyed by mini game id (a mission's `play`): `MissionAdapter<JsonObject,
MiniGameEnd>`, whose `input(snapshot, mission, keys)` gives the round's `params` (`keys`: the
  world's key table the port's `open` gave, `{}` without one); `outcome` maps its end.
- **Steps.** `mission(step)` (`{ mission, action, input? }`), or the live calls `launch(id)`
  (open), `play(id, script?)`, `delegate(id)`, `quit(id)`, each null or a refusal: the port's
  (the sim's codes), `unknown_mission`, `mission_not_open` / `mission_committed` /
  `mission_resolved` for a play, `no_mini_game`, `no_adapter`, `bad_mission_input` (the adapter or
  `create` threw; no round starts), and `round_hosted` for anything while a round is hosted.
- **A step with no round** steps the game (the enemy thinks, the world steps), then the port's
  `settle()`, so a due mission commits at its fixed tick exactly as in a world run.
- **A step while a round is hosted** steps the round once, through a `RoundInput` with the def's
  `inputMap`, fed the `play` step's recorded script (a `ScriptedInput`, frame 0 the round's first
  tick) or else the host's frame; the game is not stepped, so the world tick stays and orders are
  refused. On the tick the round ends, its end (`MiniGameEnd`) is mapped with `missionRoundEnd` and
  resolved through the port's `play` (or `quit` for a quit round); a refused mapping resolves
  nothing (the mission is delegated at its commit tick, `timeout`) and is shown in the snapshot.
  From the next step the world steps one tick per game tick and the result commits by itself at
  open tick + `worldTimeCost`, as the delegated path's does (decision 3).
- **Snapshot**: the game's (or `{ world }`) plus `missions: { round: { mission, game, ticks,
state, result, outcome, refused } }` only while a round is hosted and on the tick it ends.
- **World data** (Engine 0.14 T7): the port's optional `events(sinceTick)` and
  `timeline(experience)` (`missionPort` fills both) give the host the `HeadlessGame` hooks
  `worldEvents` and `timeline` (the latter with the host's own experience count); a port without
  them leaves the host without them.
- **Recording** (Engine 0.14 T9, gap M19): `recordRounds(on)` makes every round started from
  then on keep an `InputRecorder` of its `RoundInput.source()` per tick, from frame 0 (a played
  round's script or the host's frames, whichever drives it); `roundRecordings()` lists them in
  play order with the host's step count at the `play` (the run file's tick). The page's
  `?record` (`shell/`) and `pnpm cli record --bot` turn it on.
- **Experience** (the round's ticks) is counted per mission (`missionExperience()`) and never
  written to the world, as in world runs, so the world after a played round is the world a run
  that resolved the same result at the open tick has (tested).
- The round's `hostStatus` gets `mission` (the mission's title) and the option's values.
- **Events** (Engine 0.15 T6, gap M21; docs/BUILD-LOG.md, Engine 0.15, decision 7, item 284):
  `events` is the hosted game's last step's events, then the host's own for that step
  (`MissionHostEvent`, plain objects): `mission-open` `{ mission, play }` (`play` null for a
  choice), `mini-game-end` `{ mission, game, result }` and `mission-commit` `{ mission, outcome,
resolution }` (read from the port's optional `records()`, which `missionPort` fills; both null
  without it), matched by skins like a kit's (`mini-game-end:pass`,
  `mission-commit:outcome=both-burnt`). A mission opened between steps (a run file's step, a
  page button) is in the next step's events. `missionHostEvents(events)` picks them out as present
  events. Never in the snapshot, so no hash moves.
- **The round's frame** (gap D9): `roundFrame()` is the hosted round's `present()` with
  `status.miniGame` (`MINI_GAME_STATUS`) set to the mission's `play`, or null; the core's
  `present/hosted.ts` `hostedSource` (gap M6) shows it in place of the game's own frame, so no
  page reads `playing` for the picture (the getter stays, for tools and key hints).
- **The kit's game in one** (gap M18): the options `canOpen(id)` (asked first when a mission is
  opened; its refusal is the step's) and `onChange()` (after every mission step, taken or
  refused, after a round's end resolves and after every step that commits). The RTS kit's
  `rtsMissionHooks(game)` gives both for an `RtsGame` (`not_offered`, `refresh()`), so a game
  extends or builds a `MissionHost` without a wrapper class (the mini siege's `MiniSiegeGame`
  extends it).

Tested in `mission-host.test.ts` (a fake port) and, over the siege fixture with the real sim, the
RTS kit and the topdown kit's mission room (Engine 0.11 T7), `tests/kits/mission-host.test.ts` (outside the
layers, like `mission-adapter.test.ts`); Engine 0.15 T6's events, round frame, `canOpen` and
`onChange` in `mission-host.test.ts`, and the mini siege's events played through the tools' run
loop in `tests/runs/mission-events.test.ts`. Pure in practice; not on `PURE_CORE` (no kit or sim file
imports it at run time; `engine/sim` imports only its types).

`rts-types.ts` (Engine 0.9 T8, item 131) is the RTS unit and building type table as plain JSON
data, for the same reason: `rtsTypesSchema` `{ units, buildings }` (a unit type: `health`,
`speed`, `attack`, `range`, `cooldown`, `sight`, `cost`, `trainTicks`, and `work` for builders and
`gather` `{ capacity, ticks }` for gatherers, null when left out; a building type: `health`,
`size` `{ w, h }`, `work`, `cost`, `trains` (unit type ids, checked) and `dropoff`),
`rtsUnitTypeSchema`, `rtsBuildingTypeSchema`, `rtsCostSchema` and the types. The sim keeps the
table in the world (`RtsTypes`); a kit can read the same file as content. Pure (on `PURE_CORE`);
tested in `rts-types.test.ts`; in `docs/reference/schemas.md`.

`gfx/screen.ts` is the picture size and its fit: `ScreenSize`, `DEFAULT_SCREEN` (256x240, the size of
a game whose `game.json` has no `screen`), `SCREEN_MIN` / `SCREEN_MAX` (64..1920, the manifest's
limits) and `fitGame(size, cssW, cssH, dpr, integerScale, fit?)`, used by the canvas2d `Viewport`
and the touch layout (`layoutScreen` takes `screen` in its input). Nothing else hard-codes a
picture size. Pure.

`input/pointer-logic.ts` (Engine 0.9 T5, the RTS view) is pointer input without the DOM:
`PointerGestures({ screen, slop?, longPressMs?, edgeMargin?, edgeSpeed?, wheelPerDouble? })`
turns `PointerSample`s (`down` / `move` / `up` / `cancel` / `leave` / `wheel`, in picture pixels
with a time in ms) into `PointerGesture`s: `feed(sample)` returns what a sample completes and
`tick(t)`, once per game step, what time makes. Mouse and pen: a left click is a primary `tap`, a
right click a secondary one, a left drag past the slop (4 px) a `box` (`move` while held, then
`end`, or `cancel`), a middle drag a `pan`, the wheel a `zoom` about the cursor (500 px of
`deltaY` halve or double it), and the hovering cursor within `edgeMargin` (4 px) of an edge an
edge-scroll `pan` each tick (not while a button is down, not after `leave`). Touch: a tap is
primary, a hold of `longPressMs` (500) without moving secondary, a one-finger drag a box, and two
fingers `pan` (their midpoint) and `zoom` (`source: 'pinch'`, their distance, about the midpoint);
a second finger cancels the first's box and fingers left after a pinch do nothing until they
lift. A `pan`'s `dx`/`dy` is how far the content moves (drag right: dx > 0); `boxRect(g)` gives a
box's corners as a box. Pure (on `PURE_CORE`). `input/pointer.ts` is its DOM side:
`PointerSource(canvas, toScreen, opts)` listens for pointer events and the wheel on the canvas
(`touch-action: none`, pointer capture, no context menu or page scroll there) and, like
`InputManager`, makes this step's `gestures()` in `beginFrame(now)`; `cursor()` is the hovering
cursor. `bootBrowserGame` makes one when a game asks (`shell/CLAUDE.md`). Pan and zoom gestures
drive `RtsCamera` (`present/rts-camera.ts`).

`gfx/renderer.ts` is the drawing interface: the `Renderer` interface, `Rotation`, and the
helpers `transformed`, `translucent`, `clipped` and `OffsetRenderer`. Backends implement it; core
never knows which one is drawing.

## Imports

- Allowed: other files in `engine/core` (relative paths) and npm packages.
- Never: `engine/backends`, `engine/sim`, `engine/tools`, kits or games.
- No game rules or game content here (see Fixtures below).
- Randomness goes through `Rng` (`rng.ts`), never `Math.random`, in anything a kit or the sim uses.
- Kits may import core, but not its drawing and output side (`FORBIDDEN_CORE` in
  `config/layers.js`: `gfx/renderer`, `gfx/spritesheet`, `gfx/pixelart`, `gfx/animation`,
  `assets/**`, audio output, `view.ts`, `scene.ts`, `minigame-scene.ts`, `loop.ts`, `shell/**`). A kit describes frames through
  `present/`; backends draw them. Keep anything a kit needs out of those files.

## The pure core

Kits and the sim must run the same in Node and in any browser, so the core files they use are
**pure**: no `Math.random`, `Date.now`, `performance.now` or DOM globals (`document`, `window`,
`localStorage`, `requestAnimationFrame`, ...). The list is `PURE_CORE` in `config/layers.js`, next to
the layer table (today: `rng.ts`, `headless.ts`, `rules.ts`, `kit.ts`, `orders.ts`, `missions.ts`, `campaign.ts`, `campaign-code.ts`, `carried.ts`, `rts-types.ts`, `minigame.ts`, `minigame-params.ts`, `minigame-scene.ts`, `mission-adapter.ts`, `shell/backend-choice.ts`, `shell/host-scene.ts`, `shell/debug.ts`, `state-hash.ts`, `math/**`, `scene.ts`, the input actions, bindings, input manager,
scripted input, input recorder and merged input, `input/pointer-logic.ts`, the renderer contract, palette, animation, screen and sprite sheet data,
`audio/mml.ts`, the song, sprite and palette schemas, `content/**`, `present/**` and `assets/sheet-lookup.ts`). ESLint enforces the rule on those
files; `tests/architecture/purity.test.ts` follows every run-time import (not `import type`) from
kits, the sim and the pure core itself into core and fails if a file it reaches is not on the list. When a kit or the sim starts importing another core file, make
that file pure and add it to `PURE_CORE`. Wall-clock time and the DOM belong in `loop.ts`, `shell/boot.ts`, the
browser input sources, `save/`, `assets/` (except `sheet-lookup.ts`, `sheetLookup(assets)`: a sheet getter that
returns null, never throws, for a missing sheet or palette) and the backends.
`assets/content-sheets.ts` (`contentSheets(content)`, Engine 0.7 T9) is a game's sprite and palette
files as a `SheetLookup`, for the glue that hands a backend its sheets.

## Fixtures

All game content (rooms, songs, sprites, palettes made for a game's art) lives in `games/`. The
engine and kits keep only **tiny test fixtures**, in one of two places:

- inline in a `*.test.ts` file (a three-row room, a one-line song, a two-pixel frame), or
- in a `__fixtures__/` folder next to the tests that use it, when several tests share it or it is
  too long to read inline. Only tests import from `__fixtures__/`.

Keep fixtures as small as the test allows; anything that looks like a level or a tune belongs in a
game. `tests/architecture/no-content.test.ts` scans every other file under `engine/` and `kits/`
and fails on content markers: `Song` and `Sfx` objects, MML source strings, `.mml` files, room literals
(`map: [...]`), sprite definitions (`palette` plus `frames` with pixel rows) and any bare text grid
of equal-length rows.

Generic data the engine needs is not content and may stay: the `NES` colour names in
`gfx/palette.ts` (the shared colour vocabulary every game picks from), the colour-blind mode list,
and the MML noise macros.

## Testing

Tests sit next to the code as `*.test.ts` and run in Node (`pnpm test`). They must not need a
browser: use fakes for canvas, audio and DOM, as the existing tests do. Pointer input:
`input/pointer-logic.test.ts` feeds scripted mouse and two-finger touch samples (click, right
click, box, cancelled box, middle-drag pan, wheel, edge scroll, tap, long-press, touch box,
two-finger pan, pinch, a box cancelled by a second finger); `input/pointer.test.ts` drives
`PointerSource` with fake DOM events.
