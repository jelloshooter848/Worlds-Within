# games/samples/mini-siege

The mini siege (Engine 0.11, `docs/ROADMAP.md`, "0.11 The mini siege (multi-genre sample)"): an
RTS map with a village under attack and a watchtower going up, and one top-down mission,
**sabotaging the raiders' siege engines** (owner answer 23), that the player can play or delegate.
It joins the world simulation (`engine/sim`), the RTS kit (`kits/rts`), the top-down kit
(`kits/topdown`, its data-driven `mission-room`) and the mission contract (`engine/core`'s
`MissionHost`). Since Engine 0.12 T7 it also has a **preparation phase** before the raid: the
`fortify` mission, a tower-defense round on the village's real walls with the hall's real gold
against the real raiders (`kits/towerdefense`, its data-driven `td-defence`), played or
delegated, whose outcome writes the gold spent and the losses back to the world (docs/BUILD-LOG.md,
Engine 0.12, decisions 5-8). It is **the platform test**: the mode needed no `engine/sim` change;
what it did need is logged in `docs/reports/tower-defense.md` (ids `D1`, ...). Since Engine 0.12
T8 the page offers it as well (its own art, skin and sounds; played by keys or pointer taps, or
delegated). The shape is decision 11 and the checks decision 12 of `docs/BUILD-LOG.md`,
Engine 0.11. Since T8 it plays headless (`pnpm cli run`); since T9 it has original NES-style art,
two skins, sounds and one song, a view for `pnpm cli screenshot`, and a page (`index.html`,
launcher link `games/samples/mini-siege/`) where the mission is launched and then played or
delegated. Every gap found is logged in `docs/reports/mini-siege.md` (ids `M1`, `M2`, ...).
Since Engine 0.13 T7 it is a **campaign of two scenarios**: the siege, then **the dawn assault**,
a short second RTS scenario that starts from the siege's results (the captain's fate and hp, the
hall's gold), where whether the captain was taken changes how it plays ("The dawn assault",
below; docs/BUILD-LOG.md, Engine 0.13, decision 8). Headless in T7; since T8 the page plays the
whole campaign: the siege's result and save code, Continue to the dawn (the captive choices in the
bar when the captain was taken), a save code typed in to resume, and the save kept in browser
storage ("Playing in the browser", below).

## The rule

Content, skins and thin glue only (DESIGN.md: if two games could use it, it is engine; if it is
content, it is the game). The battle is the sim's, the raiders' plan and the mission are data, the
round and the mapping from its report to an outcome are the kits' (`missionRoom` and
`topdownMissionAdapter` for the sabotage, `tdDefence` and `towerdefenseMissionAdapter` for the
fortify mission), the hosting is `MissionHost`. Never put map rows, stats, plan steps,
room rows, outcome rules or pixel rows in `.ts` files (`tests/architecture/no-content.test.ts`).
Anything the glue would write the same way in another game goes to the engine or a kit, or into
the gap report with a named release.

## Files

- `game.json`: kit `rts`, `uses` `topdown` (the sabotage's room) and `towerdefense` (the walls'
  map), seed 11, 256x240, `headless.ts`, `view.ts`; content kinds `rts-map`, `rts-types`,
  `rts-enemy`, `mission`, `campaign` (Engine 0.13), `room`, `td-map`, `td-towers`, `td-waves`, `palette`, `sprite`, `skin`,
  `sfx`, `song`. `index.html` is its page: the launcher lists it and
  `pnpm build` emits `games/samples/mini-siege/index.html`.
- `content/maps/village.world.json` (`rts-map`): 48x32 cells of 16 px: grass (`.`), a road (`,`)
  down rows 15-16 from the village to the raiders' camp, a few rocks (`#`). Terrain types in
  sorted character order: 0 rock, 1 road, 2 grass. The village (faction `village`) on the west:
  the `hall` (3x3 at 6,13, the stockpile, 150 gold), two gold nodes, the `watchtower` site (2x2
  at 2,13, 480 work, outside the event) and three workers building it (2 work a tick each: done
  80 ticks in, during the freeze); four soldiers (13,14-17) and, in the squad `defenders`, the
  `captain` (Captain Hale, role `captain`, 12,15). The raiders on the east: four raiders, the
  `ram` (36,15) and the `catapult` (36,17), and the squad `escort` with the guards `guard-1` and
  `guard-2` (role `regular`). Every defender and attacker is an `EventMember` of `siege`; the
  workers are not. The walls (faction `village`, not in the event, so the freeze does not hold
  them): `north-wall` (`wall`, 6,9), `north-tower` (`wall-tower`, 8,9), `south-wall` (6,21) and
  `south-tower` (8,21), off the road so the engines' "nearest building" is always the hall first
  (decision 7: every assertion of the 0.11 runs holds unchanged; once the hall falls the engines
  go for the walls; `mini-siege.test.ts` checks the rows). Two opportunities: `fortify-window` offers `fortify` from tick 5 to 30 (before the
  raiders reach the village), `sabotage-window` offers `sabotage` from tick 20 to 200. Both
  missions hold the same event, so only one is open at a time.
- `content/types/siege.json` (`rts-types`): `worker`, `soldier` (50 hp, hits 6), `captain`
  (120 hp, hits 10), `raider` (30 hp, hits 4), `ram` (120 hp, hits 12, slow), `catapult` (100 hp,
  hits 10 at range 3, slow); `hall` (400 hp), `watchtower` (200 hp, 480 work), `wall` (80 hp,
  1x1) and `wall-tower` (120 hp, 1x1). Every unit and wall in the map carries its type's numbers
  (`mini-siege.test.ts` checks it).
- `content/enemy/raiders.json` (`rts-enemy`): every 20 ticks from tick 0, `batter` (the ram) and
  `bombard` (the catapult) attack the nearest building, `charge` (the raiders) the nearest
  village unit.
- `content/missions/sabotage.mission.json` (`mission`): "Burn the siege engines", event
  `siege`, `worldTimeCost` 120, `play` `mission-room`, `onQuit` `driven-off`. Outcomes (weight,
  effects): `both-burnt` (1: destroy `ram` and `catapult`), `ram-burnt` (2: destroy `ram`,
  damage `catapult` 40), `catapult-burnt` (1: destroy `catapult`, damage `ram` 40), each also
  damaging `captain` by the round's `heroHpLost` when played (`fromReport`; 10 when delegated),
  and `driven-off` (2: damage `captain` 30, or `heroHpLost` when played, then `fate` captured by
  `raiders`: since Engine 0.13 T7 the captain is taken, which the follow-up `dawn` reads). Its
  `params` (checked by `validate` through the kit's schema and `checkUse`): room `engine-camp`,
  goal `defeat-all`, 1500 ticks; the room's hero is the captain (`hero`: `{ faction: "village",
member: "captain" }`, `hpPer` 20, so his 120 hp start the round on 6 half hearts; Engine 0.13
  T7, gap M13); the engines (raiders of type `ram` or `catapult`) as knights in the `E` cells
  with one room hp per 40 world hp, the guards (raiders with squad role `regular`) as knights in
  the `n` cells; rules in order: both destroyed, the ram, the catapult, else driven off.
- `content/campaigns/siege.campaign.json` (`campaign`, Engine 0.13 T7): `village` for 260 world
  ticks, then `dawn` for 200; since T8 each entry has the `title` the page shows (`The siege`,
  `The dawn assault`). The glue builds the entry a campaign save names (`siegeCampaignPlace`);
  the order is never in code (gap M29).
- `content/maps/dawn.world.json` (`rts-map`, Engine 0.13 T7): "The dawn assault", the morning
  after: the village's terrain, the hall patched to 300 of 400 hp (150 gold, replaced by the
  carried gold), two soldiers (13,14 and 13,17), in the squad `defenders` the `captain` (Captain
  Hale, 12,15) and the `sergeant` (Sergeant Mara Venn, role `hero`, a soldier's numbers, 12,16);
  the raiders' smaller band with no engines: four raiders (39,12-19) and the squad `ridge-band`
  with the jailers `jailer-1` (Dask) and `jailer-2` (Orrin) (role `regular`, 43,15-16). Everyone
  but the hall is an `EventMember` of `dawn`. The same raiders' plan plays it (`batter` and
  `bombard` never fire: there are no engines). Its `from` names `village` and carries the
  `captain` (Health and fate) and the village's gold; its `when` rule opens `rescue-window`,
  `exchange-window` and `leave-window` (all `relative`, offered from the start to world tick 60,
  one `exclusive` group `captive`) when the captain comes in captured; `ransom-window` (also
  `relative`, 0 to 60, not in the group) is opened only by a failed rescue.
- `content/missions/rescue-captain.mission.json`: "Break the captain out", event `dawn`, cost
  40, `play` `mission-room` in the `engine-camp` room (reused: a second room file would be a
  second dungeon, gap M32), `hero` the village's `hero` (the sergeant, `hpPer` 10: 5 half hearts
  at 50 hp), the jailers as knights in the `n` cells, `defeat-all`; `freed` when the round passes
  (damage `sergeant` by `heroHpLost`, 10 delegated; `fate` freed the captain at 10,15 by the
  hall), else and on a quit `failed` (damage `sergeant` 20 or `heroHpLost`, `fate` injured,
  `opportunity` open `ransom-window`: a different follow-up, never the rescue again).
  `exchange-captain` (cost 10, no `play`: a choice, only delegated; `paid`: gold -80, `fate`
  freed), `ransom-captain` (cost 10, no `play`; `paid`: gold -120, `fate` freed) and
  `leave-captain` (cost 1, no `play`; `left`, no effects: the capture stands).
- `content/rooms/engine-camp.json` + `.map.txt` (`room`): the raiders' camp at night, one 16x11
  room with the hero's `@`, two `E` and two `n` slots.
- `content/missions/fortify.mission.json` (`mission`, the preparation phase): "Man the walls",
  event `siege`, `worldTimeCost` 30, `play` `td-defence`, `onQuit` `overrun`. Its `params`
  (checked by `validate` through the towerdefense kit's schema and `checkUse`): map `walls`, 2
  lives; `build` the village's `wall` and `wall-tower` buildings onto the map's `W` cells (ascending
  id into reading order: `north-wall` 4,1, `north-tower` 11,1, `south-wall` 4,5, `south-tower`
  11,5); `budget` the village stockpile's (the hall's) gold, capped at 100; `wave` the four
  `raider-*` units (by key; the guards stay with the engines) as `raider`s with one hp per 10 world
  hp, speed 4, 10 ticks apart; rules in order: no leak and at most 40 spent `held-cheap`, no leak
  `held`, won `held-bloodied`, else `overrun`. Outcomes (weight, effects): `held-cheap` (1: gold
  -40, destroy `raider-1`..`4`), `held` (2: gold -80, the same), `held-bloodied` (2: gold -80,
  destroy `raider-1` and `raider-2`, damage `south-wall` 40 and `soldier-1` 20), `overrun` (1:
  destroy `north-wall` and `south-wall`, damage both towers 60, `soldier-1` 30 and `captain` 30).
  The gold written back is the matching outcome's fixed amount, not what the round spent (lesson
  D3), and the losses are fixed per outcome (D4).
- `content/defence/` (the towerdefense kit's kinds): `maps/walls.json` + `.map.txt` (`td-map`,
  16x7: the road from the raiders' entry `S` on the east, bending down and back up to the hall's
  gate `X` on the west, `W` the four wall cells, legend `W` = build; `start` 0 gold, 2 lives, both
  replaced by the mission's params), `towers.json` (`td-towers`: `archers` 20 gold, range 2,
  damage 1, cooldown 3; `ballista` 40, range 3, damage 2, cooldown 6) and `waves/walls.json`
  (`td-waves`: the one wave list the `td-map` kind makes a map name, never played: the mission's
  wave is the world's raiders; lesson D8).
- Art, all original text (T9; generated once from a throwaway script, then kept as text):
  - `content/sprites/siege.txt` (palette `content/palettes/siege.json`): tiles `grass`, `road`,
    `rock`; `worker`, `soldier`, `captain` (gold helmet and trim) and `raider` in three facings
    (`down`, `up`, `right`; the skin mirrors right for left) with two steps; the `ram` and the
    `catapult` from the side, two frames each, whole (`ram-0`) and burnt (`ram-burnt-0`, charred
    with flames); `hall` (48x48), `watchtower` (32x32) and its scaffold `site-2x2`; `gold`,
    `gold-empty`, `ring`, the bars `hp-0`..`hp-8` and `p-0`..`p-8`, `box`, the offer's torch
    `offer-0`/`offer-1`, HUD icons (`icon-gold`, `icon-units`, `icon-enemy`, `icon-time`,
    `icon-torch`) and `heart`. Since Engine 0.13 T8: the sergeant Mara Venn (`sergeant-<dir>-<0|1>`,
    the soldier with a red sash and a gold plume) and the HUD's captive marker `icon-captive` (a
    shackle, 8x8). `content/palettes/siege-held.json` is the same palette in cold
    blues: the units and buildings of the frozen event while the mission is open.
  - `content/sprites/camp.txt` (palette `content/palettes/camp.json`, night colours, the same
    letters): the room's `wall` (a palisade) and `floor`, the hero (a villager in a blue hood:
    `hero-<down|up|side>-<0|1>`, `hero-attack-<dir>`), `sword-up`/`-down`/`-right`,
    `poof-0`..`2`, the guards (`guard-<dir>-<0|1>`, raiders with axes), the engines (`ram-0/1`,
    `catapult-0/1`), `heart` and `hourglass`.
  - `content/sprites/defence.txt` (Engine 0.12 T8, palette `siege`, the same letters): the walls'
    round: `wall-cell` (a build cell, a stretch of stone wall), `gate` (the hall's gate, `X`),
    `camp` (the road out of the raiders' camp with a war banner, `S`), the towers on the wall,
    each idle and firing (`archers-idle`/`-fire`, a villager in blue with a bow;
    `ballista-idle`/`-fire`, a wooden bolt thrower), `shot-arrow`, `shot-bolt`, `cursor-0`/`-1`
    and the HUD icon `icon-wall`. The round reuses `siege.txt`'s `grass`, `road`, the raiders'
    walking frames, `heart`, `icon-gold` and `icon-enemy`. `content/palettes/defence-ok.json` and
    `defence-blocked.json` (the ghost tower: green where it may be built, red where not) and
    `defence-hit.json` (a struck raider flashes white) are the same letters in other colours.
  - `content/sprites/siege-font.txt`: an 8x8 font (digits, capitals, small letters, `'`, `,`,
    `.`, `-`, `:`), white with a black drop shadow, for the HUD's numbers and the mission title.
- Skins: `content/skins/canvas2d.json` (the battle): every kind the RTS kit presents here
  (`unit:<type>` for the six types with `idle`, `walk`, `attack`, `build`, `gather`;
  `building:hall`, `building:watchtower`, `resource:gold`, `selection-ring`, `health-bar`,
  `progress-bar`, `mission-offer`, `selection-box`), looks by tag (T4): the engines' `damaged`
  (the burnt frames: a catapult or ram the result damaged), the watchtower's `site` (the
  scaffold), and `frozen` on every unit and building (the `siege-held` palette), `damaged` listed
  before `frozen` (gap M2); since Engine 0.13 T8 `unit:soldier`'s look for the tag `hero` (the
  sergeant's frames, listed before `frozen`, so a frozen sergeant keeps her colours: M2 again); tiles `0`-`2`; HUD gold, own and enemy units, the commit countdown
  (`missionLeft`), the captive marker (Engine 0.13 T8: `captive`, the RTS kit's status naming the
  village's captured person, as `icon-captive` and `text` under the gold), and at the bottom the
  offer's or open mission's title (`offer`, `mission`, as `text`); event sounds: `mission-open` (`launch`), `mini-game-end:pass` / `:fail` / bare (quit),
  `mission-commit:outcome=<id>` (`burn` for an outcome that burns an engine; since Engine 0.13 T8
  the dawn's: `freed` (`freed`, a gold tint), `paid` (`coins`), `failed` (`fail`, a red tint) and
  `left` (`toll`, a grey tint)) and bare `mission-commit`. `content/skins/canvas2d-mission-room.json` (the round, mini game
  `mission-room`): `hero`, `sword`, `poof`, `pickup:heart` and `knight` (the guards) with looks by
  tag `foe:ram` and `foe:catapult` (the topdown kit tags each placed foe with its world name);
  tiles `#` and `.`; the camera unclamped (the room under its HUD band); HUD the host's
  `host:mission` title (G19), hearts, the time left; sounds for `sword`, `kill` (`burn`), `hurt`,
  `dying`. `content/skins/canvas2d-td-defence.json` (Engine 0.12 T8, the walls' round, mini game
  `td-defence`, sheet `defence` with `siege` per entry): `tower:archers`, `tower:ballista` (`idle`,
  `fire`), `enemy:raider` (the raiders' `walk` in three facings, mirrored for left; `hit` in
  `defence-hit`), `shot:archers`, `shot:ballista`, `ghost:<type>` (`ok` / `blocked` palettes) and
  `cursor`; tiles `.` grass, `#` road, `B` the wall cell, `S` the camp, `X` the gate (the 16x7 map
  centred on the picture, black above and below); HUD the host's `host:mission` title, `gold`,
  `lives`, `enemies` and at the bottom the chosen `tower` and its `towerCost`; sounds `td-place`
  and `td-sell` (`place`), `td-refused` (`refused`), `td-wave-start` (`launch`),
  `td-shot:tower=ballista` (`bolt`) and `td-shot` (`arrow`), `td-kill` (`hurt`), `td-leak`
  (`leak`); `td-end:won` / `:lost` only tint (the battle's `mini-game-end` sounds the end). The
  battle's skin sounds the fortify commit: `mission-commit:outcome=held-cheap` / `held` /
  `held-bloodied` (`hold`, a gold tint) and `overrun` (`breach`, a shake).
- Sound: `content/sfx/` (`sword`, `hurt`, `burn`, `pass`, `fail`, `launch`, `commit`; since
  Engine 0.12 T8 `place`, `arrow`, `bolt`, `leak`, `refused`, `hold`, `breach`; since Engine 0.13
  T8 `freed`, `coins`, `toll`; one line of MML each) and `content/songs/siege.json`, one short original loop in D minor (six bars at 120
  bpm, two pulses, triangle and noise), played by the page once the first gesture unlocks sound.
- TypeScript is glue:
  - `content.ts`: `loadMiniSiege(files)` (the kinds of `rts`, `topdown` and `towerdefense`),
    `siegeMap(content, name?)` (a map by name, `FIRST_SCENARIO` `village` when left out),
    `siegeCampaign`, `siegeTypes`, `siegeEnemy`, `siegeMissions`, `siegeRooms`, `siegeDefenceMaps`,
    `siegeTowers`, `siegeScenario(content, seed, name?)` (the types table spawned first,
    entity 2), `PLAYER` (`village`).
  - `headless.ts`: `createWorld(content, seed, name?)`, `siegeCampaignPlace(content, seed, save?)`
    (Engine 0.13 T7: the campaign, the save, the scenario entry to build and the next scenario's
    carry spec), `miniGames(content, opts?)` (the topdown kit's `missionRoom` over the
    rooms and the towerdefense kit's `tdDefence` over the walls' maps and towers; `validate`
    checks each mission's params with the one its `play` names; each round gets its own kit's
    switched-off rules, `rulesOffFor(opts, 'topdown')` and `rulesOffFor(opts, 'towerdefense')`, a
    run file's `topdown:<id>` and `towerdefense:<id>`, Engine 0.14 gap G12), `ADAPTERS` (`{ 'mission-room':
topdownMissionAdapter, 'td-defence': towerdefenseMissionAdapter }`), `createGame(content,
seed, opts?)`: the sim world, the kit's `rtsGame` (the plan, the switched-off rules), and a
    `MissionHost` with `missionPort(world, { refs: scenarioKeys })`, the missions, both mini
    games and `ADAPTERS`, wrapped in `MiniSiegeGame`. Its `mission(step)` sends `open`
    through the kit's `launchMission` (refused `not_offered` while no opportunity offers it) and
    the rest to the host, then calls `RtsGame.refresh()` (gap M7); `order`, `step`,
    `miniGame()` and `missionExperience()` are the host's; `records()` (T9) is the world's
    committed mission records, for the page. Its snapshot is the host's (`{ world,
kit, missions? }`) plus `sides` (the kit's `sidesOf`) and `named` (every scenario key:
    `{ alive, x, y, hp, fate? }`; since Engine 0.13 `alive` is "exists and its fate is not
    `dead`", and `fate` is listed only for a named person whose fate was set). Since Engine 0.13
    T7 `createGame`'s `opts.campaign` (a run file's `from`) picks the campaign entry: the dawn is
    built with the save's carried record (`worldFromScenario(json, { carried })`), the siege when
    left out; `MiniSiegeGame.campaignSave()` is the save if the entry played now ended now
    (`advanceCampaign` with the world's committed missions and, in the siege, `carriedRecord`
    for the dawn's `from`), null once the campaign is done or while the hall (the carried
    stockpile) is gone (gap M31). Engine 0.14 (gap G9): `starts(content)` lists the campaign's
    entries (`village`, `dawn`) for a run file's `start: { entry }`, and `createGame`'s
    `opts.start` builds that entry fresh (`siegeStartSave`: the engine's `campaignSaveAt`, no
    carried record, nothing committed before it): the dawn as its scenario file is written.
  - `picture.ts`: `siegeLook(content)` (both `canvas2d` skins by `skinSet`, the sheets, size, the
    grass colour), `siegeSource` / `siegeFrames(content, ui?)`: one stream over the
    `MiniSiegeGame`: the RTS kit's `presentWorld` for `village` with the game's missions (the
    offer marker, the mission HUD) while no round is hosted, else the round's `present()` with
    `status.miniGame` the mini game the hosted mission plays (`MissionHost.playing.play`:
    `mission-room` or `td-defence`; its map through a `MapTracker`); plus the events the sim does
    not give (gap M21), made from what changed between two frames: `mission-open`,
    `mini-game-end` (the round's mini game and `result`), `mission-commit` (`outcome`, `resolution`, read from
    `MiniSiegeGame.records()`). `siegePicture(presenter, content, ui?)`,
    `siegeCanvasPicture(r, content, look, ui?, onSound?)` (the backend's `skinSetCanvasPresenter`:
    each frame to its skin).
  - `view.ts`: `createView` for `pnpm cli screenshot` and the backend parity test: `render`,
    `frame()`, `order` and `mission` (a run file's mission steps), the camera at the map's centre.
  - no `files.ts`: `main.ts` imports its data files from `virtual:game-files` (the build's plugin, `build/game-files.ts`; no `files.ts` since Engine 0.14 T2).
  - `play.ts`: `SiegePlay`, the page's glue without DOM or clock: the `MiniSiegeGame`, an
    `RtsCamera` starting east of the hall, the kit's `RtsControls` (pointer gestures to orders).
    `launchButtons()` (the kit's `missionButtons`, none while a choice waits or a round runs),
    `press({ kind: 'launch', mission })` (the game's `open` step, through the kit's
    `launchMission`), then `choice()` and `press({ kind: 'play' | 'delegate' })`; nothing steps
    while the choice waits. `defenceRound()` (the hosted round when it is the walls'
    `TdDefenceRound`) and `roundTap(x, y, button?)` (Engine 0.12 T8): a pointer tap in the walls'
    round goes to its `TdGame.tap` through the round's frame (the picture size, the kit's
    `cameraHint`): a tap moves the cursor, a second tap on it places, a right click or long-press
    sells (gap D12: the same lines as the sample's `TdPlay.tap`). `update(input)`: the battle one world tick every `STEPS_PER_TICK` (6:
    `TICKS_PER_SECOND` 10), a hosted round one tick per loop step (60 a second, the world
    waiting). `scene(stack, picture)` is the engine's `HostScene` over it (accessors), which
    pushes the core `miniGameScene` when the round starts and pops it on its end. `records()`,
    `title(mission)`, `outcomeTitle(mission, outcome)`, `sides()`, `message` (the last refusal).
    **The campaign** (Engine 0.13 T8): `game` is the entry played now (replaced when the campaign
    moves on; `scenario`, `entryTitle(save?)`, `entryTicks` from the campaign file). An entry ends at
    its `ticks`, or the first world tick after once no mission is open (gap M35), never while a
    choice waits or a round runs; then nothing steps or is offered and `ended()` is a
    `SiegeEntryResult`: the engine's `CampaignSession.end` (the save from `campaignSave()`, kept in
    browser storage, its code, `stored`, `done`) plus `title`, the outcomes' titles, `people` (the
    village's named people, `Captain Hale: captured, 90/120 hp`), `verdict` and `next` (the next
    entry's title, null once done or with no save). `press({ kind: 'continue' })` builds the next
    entry from the save (`createGame(content, save.seed, { campaign })`), or the siege again;
    `press({ kind: 'code', text })` resumes from a typed code (`CampaignSession.resume`; a refusal
    goes to `message` as `<code>: <reason>`, nothing changes) and `press({ kind: 'stored' })` from
    `storedSave()`. A step that starts an entry does not step it, so the new world starts at tick 0. `canPlay(mission)` is false for a choice without a round (the dawn's exchange, ransom, leave).
  - `main.ts`: the DOM: `bootBrowserGame` with Canvas2D (`canvasDisplay` with both skins and the
    shell's `onSound`), `pointer: true`, the touch pad left on (the round on a phone), `audio`
    (`contentSfx`, `contentSongs`, music `siege`); the bar (`#launches`, one `#launch-<mission>`
    button per offered mission from `launchButtons()`, so from world tick 20 to 30 both;
    `#play`, `#delegate`, `#status`: the tick, the choice, the last outcome's title, the hall
    fallen or the raiders beaten, a refusal; while a round is hosted, its mini game's key hint)
    and `window.wwSiege` (`tick`, `choice`, `playing`, `outcomes`, `miniGame`, `round` (the walls'
    round's `kit` summary) and `clientAt(col, row)` (a walls' cell in client px, for the browser
    test's taps; gap D13)). Engine 0.13 T8: `#delegate` reads **Decide** and `#play` hides for a
    choice without a round; `#result` (the entry's end: title and verdict, outcomes, people, the
    save code in `#result-code` and `#continue`, "Continue: The dawn assault" or "Play again");
    `#code` and `#resume` (Enter too; keys typed there drive no game action) and `#stored`
    ("Carry on: ...", at tick 0 when this browser kept a save); the status starts with the entry's
    title; `wwSiege` adds `scenario`, `ended`, `named` and `captive`.
- `mini-siege.test.ts`: the content, the units against their types, the params checks
  (`bad_mini_game_use` at `params.room` and `params.outcomes.0.outcome`), the launch refusals,
  orders refused while the round is hosted, and over whole runs: the battle frozen at every
  world tick of the cost and the same in all three runs before the commit, the commit at 160
  whatever the round took, the hall at the end (400 played, less delegated, least driven off),
  the played world equal to a fresh one given the same result at the open tick (decision 3), and
  the same hashes twice. The preparation phase (Engine 0.12 T7): the walls against their types and
  off the road, the fortify params checks (`params.map`, `params.outcomes.0.outcome`), the offers
  (fortify from 5, both at 20; the sabotage refused while fortify holds the siege), and over the
  two fortify runs: the battle (and the walls) frozen from 11 to 39 and the same in both, the
  commit at 40 whatever the round took (116 ticks played), the gold and losses at the commit, the
  played world equal to a fresh one given the same result at 10, and the same hashes twice.
- `mini-siege.test.ts`, the dawn (Engine 0.13 T7): the campaign file, the dawn's units against
  their types, the siege's three ends (the captain active at 120 or 110, or captured at 90 by the
  raiders at 160) and their save codes (the ones the run files pin, round trips, at most 40
  characters), the played and quit sieges' carried records differing only in the captain, the
  two follow-ups (the same run file but `from`; the start worlds differing only in the captain
  and the opportunities his capture opens; the end: the raiders beaten or the village fallen),
  the save code restoring the dawn's start world with an equal hash (and `dawn-code`'s golden
  hashes equal to `dawn-captured`'s), the rescue, exchange and leave each closing the other
  choices, a failed rescue committed for good (unchanged record, the rescue refused
  `not_offered` by the kit and `mission_committed` by the sim, the ransom paid), a dead captain
  carried in as a record opening nothing, and no campaign save once the hall has fallen.
- `play.test.ts`: the page's glue on a real `SceneStack`, drawing every step into the null
  backend: launch at world tick 40, then delegate (`ram-burnt` at 160, the commit's event) or play
  (the round pushed and popped, `played.run.json`'s recorded round fed as the page's keys,
  `mini-game-end:pass`, `both-burnt` at 160); each path ends at world tick 260 with the run file's
  last state hash. A launch after the window closes is refused `not_offered`. The preparation
  phase the same way: `fortify` launched at world tick 10, delegated (`overrun` at 40) or played
  (`fortify-played.run.json`'s recorded round as keys, `status.miniGame` `td-defence`, the host's
  title `Man the walls`, `mini-game-end` for `td-defence`, `held-cheap` at 40), ending with the
  fortify run files' last hashes. Engine 0.12 T8: taps in the walls' round (picture (184, 88), the
  centre of cell 11,1 with the map at picture y 64) move the cursor, place archers (gold 80), a
  tap off the map does nothing, a secondary tap sells (gold 90), select quits to `overrun` at 40;
  and the played round's frames: every kind, tile and the main sounds in
  `canvas2d-td-defence.json`, a commit sound for every fortify outcome in the battle's skin.
  Engine 0.13 T8, the campaign: the delegated siege ends at 260 with `delegated`'s last hash and
  pinned code, stored (a new page's `storedSave()`), Continue plays the dawn with the captain on
  the map at 110 (no choices, the sergeant tagged `hero`) to its end at 200 (`done`, nothing
  stored to carry on, Continue starts over); the quit siege ends with `quit`'s code and the
  captain captured, Continue gives `dawn-captured`'s tick-0 hash, the three choices, the captive
  marker (`captives` 1, `captive` `Captain Hale`), the exchange only decided, ending on
  `dawn-exchange`'s last hash; a bad code refused (`code_typo`, twice) and `quit`'s code (lower
  case) resuming at `dawn-captured`'s tick-0 hash and ending on `dawn-leave`'s; the stored save
  carried on from; and no save once the hall has fallen (`fortify` delegated).
- Also: `tests/browser/mini-siege-page.test.ts` (the built page played from the launcher's link in
  headless Chromium: Launch then Delegate, and Launch then Play with the recorded round typed as
  keys; Engine 0.11 T10; since Engine 0.12 T8 the same for `fortify` at world tick 10, delegated
  (`overrun`), played by the recorded keys (`held-cheap`) and played by taps then given up
  (`overrun`), each committing at 40, with no page errors; since Engine 0.13 T8 the campaign: the
  siege to its end at 260 along both captain fates (Delegate, and Play then Backspace), the result
  panel's save code equal to `delegated`'s and `quit`'s pinned codes, Continue to the dawn (the
  captain on the map to its end at 200, "Play again"; or held: the three choice buttons, the
  exchange decided at 5 and committed at 15, the captive marker gone), a second page in the same
  browser carrying on from the stored save, and a fresh page refusing a bad code with its reason
  in the status and resuming the dawn from `quit`'s code), `tests/browser/mini-siege-shots.test.ts` (screenshots on both paths, below) and
  `tests/build/pages.test.ts` (the launcher and the build list the page).

## Entity ids

1 terrain, 2 types, 3 hall, 4-5 gold (north, south), 6 watchtower, 7-9 workers, 10-13 soldiers,
14-17 raiders, 18 ram, 19 catapult, 20 `north-wall`, 21 `north-tower`, 22 `south-wall`, 23
`south-tower`, 24 squad `defenders`, 25 the captain, 26 squad `escort`, 27-28 the guards, 29 the
world-level entity (`WorldTime`, `Opportunities`, `Missions`). (Before Engine 0.12 T7, without the
walls, the squads started at 20.)

The dawn (`dawn.world.json`): 1 terrain, 2 types, 3 hall, 4-5 soldiers, 6-9 raiders, 10 squad
`defenders`, 11 the captain, 12 the sergeant, 13 squad `ridge-band`, 14-15 the jailers, 16 the
world-level entity (spawned by its opportunities).

## Run files

All with seed 11 and checked until world tick 260. The sabotage runs open `sabotage` at tick 40
(offered from 20) and commit at world tick 160 (40 + 120); the preparation-phase runs open
`fortify` at tick 10 (offered from 5) and commit at world tick 40 (10 + 30).

| run                 | ticks | what happens                                                                                                                                                                                                                                                                                                                      | final hash         |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `played`            | 666   | played: a recorded 406-tick round (the kit's bot fighting) burns both engines (`both-burnt`); the world resumes at game tick 446; the hall ends at 400                                                                                                                                                                            | `cf2a262208819d24` |
| `delegated`         | 260   | delegated at once: seed 11 draws `ram-burnt` (the captain down 10); the catapult (60 hp) reaches the hall, which ends at 280                                                                                                                                                                                                      | `766ad9dde830f2bc` |
| `quit`              | 261   | played and quit on the round's first tick (select): `driven-off`, the captain down 30 and captured (off the map); both engines reach the hall, which ends at 112                                                                                                                                                                  | `f5282bcd8d9c7bdd` |
| `fortify-played`    | 376   | the preparation phase played: a recorded 116-tick round (the kit's `TdBot`: archers on `north-tower` and `south-wall`, then the wave) holds with no leak for 40 gold (`held-cheap`); the world resumes at game tick 127; at 40 the hall's gold is 110 and the four raiders are gone; the engines still bring the hall down by 200 | `0b43372f77faea35` |
| `fortify-delegated` | 260   | delegated at once: seed 11 draws `overrun`; at 40 `north-wall` and `south-wall` are gone, the towers at 60, `soldier-1` at 20, the captain at 90, the gold untouched; the raiders kill all but one soldier; the hall falls by 200                                                                                                 | `302436d18dc3917d` |

- Game ticks are not world ticks once a round is played: during the round the world does not
  move, so in `played` world tick `w` after 40 is game tick `w + 406` (`quit`: `w + 1`;
  `fortify-played`: `w + 116` after 10).
- The 0.11 runs' golden hashes were re-recorded once in Engine 0.12 T7 (decision 7: the map
  gained the walls and `fortify-window`); none of their assertions changed. They never open
  `fortify`, so their battle is the 0.11 one.
- Every run's golden hashes were re-recorded once more in Engine 0.13 T2 (decision 1): the
  raiders' named guards (`guard-1` Grell, `guard-2` Vosk) die in every run and are now kept as
  dead records (`Fate` dead, off the map) instead of destroyed, so the hashes move from the first
  sync hash after their deaths (world ticks 170 and 178 in the sabotage runs, 80 and 86 or 88 in
  the fortify runs); none of the assertions changed.
- The three sabotage runs' golden hashes were re-recorded again in Engine 0.13 T7: the mission's
  def (stored in the world when it opens) gained `hero` and the captain's `fromReport` damages,
  and `driven-off` captures the captain, so they move from the first sync hash after the open
  (world tick 60). One assertion changed, as a content change: `delegated`'s `named.captain.hp`
  at 160 is 110 (was 120), the declared 10 of `ram-burnt`. `played`'s recorded round loses no
  half heart, so its captain keeps 120; `quit`'s captain keeps 90 (`Health` stays with a captive)
  and the hall still ends at 112. The fortify runs never open the sabotage and did not move.
- The fortify runs assert: the walls and the gold at tick 0; the mission open at world tick 11
  with commit tick 40 and `siege` frozen by `mission:fortify`; the ram, a raider, the captain, a
  soldier, the gold and the raiders' count unchanged at world ticks 11, 25 and 39 (the watchtower
  still rising); at 40 the record (`fortify`, outcome, resolution, ticks 10 and 40), nothing open
  or frozen and the outcome's effects on the gold (`sides.village.stock.gold`), the walls, the
  defenders and the raiders (the played record's `report.stats`: `spent` 40, `leaked` 0, `placed`,
  `killed`); and the battle afterwards (the soldiers left, the hall down by 200, which walls stand
  at 260). `fortify-played` also checks the round in the snapshot (`missions.round`: `fortify`,
  `td-defence`, 116 ticks, `pass`, `held-cheap`) with the world tick standing at 10 through it.
  Their invariant is the engines alive (no sabotage), not the hall, which falls in both.
- Each asserts (at the game tick of each world tick): the plan's first orders at tick 1; the
  mission open with commit tick 160 and `siege` frozen; the ram, catapult, a raider, the captain
  and a soldier keeping their cell and hp at world ticks 41, 80, 120 and 159; the watchtower's hp
  rising by world tick 60 and the site finished (`sides.village.sites` 0,
  `sides.village.buildings.watchtower` 1) by 159; at 160 the record (`outcome`, `resolution`
  `played` / `delegated` / `quit`, `openTick` 40, `commitTick` 160), nothing frozen and that
  outcome's effects (`named.ram.alive`, `named.catapult.hp`, `named.captain.hp`; the played
  record's `report.stats.destroyed`); and the hall's hp at 260. `played` also checks the round in
  the snapshot (`missions.round`: its ticks, `pass`, `both-burnt`) and the world tick standing
  still through it.
- Paths: `named.<key>.*`, `sides.<faction>.*`, `kit.enemy.<step>.fired`,
  `world.components.Missions.0.1.(open|committed).<i>.*` and
  `world.components.WorldTime.0.1.frozen` (one world-level entity, so index 0).
- Every run file has sync `hashes` (every 20 ticks) and a golden `<name>.hashes.json`; each
  guards `enemy-follows-plan` (`pnpm -s cli mutants games/samples/mini-siege --json`).
- **Every kit's rules** (Engine 0.14, gap G12; docs/BUILD-LOG.md, Engine 0.14, decision 8 and
  item 257): `mutants` also tries the rounds' kits, as `topdown:<id>` (the sabotage and rescue
  rounds) and `towerdefense:<id>` (the fortify round), each judged by its own kit's strictness.
  `fortify-played` guards `towerdefense:win-on-clear` (with it off the round has no result at
  game tick 126, where the run asserts its `pass`). Every other round rule stays unguarded: a rule
  switched off in a round changes the next sync hash (every 20 ticks) before any check notices,
  and a hash mismatch stops the run without a failed check. The tower-defense kit is strict, but
  a `uses` kit is held only to the rules the run files list in `guards`, so its 13 unguarded rules
  (and the top-down kit's 4) are reported (`kits[].unguarded`) and the command exits 0; they are
  recorded in `docs/reports/stacking-test.md` (G12). The whole folder takes about four minutes
  (13 run files, 24 rules).
- **Recording the played round:** in a throwaway script, `createGame`, step to tick 40, `open`
  and `play` without input, then each tick give the host a `ScriptedInput` holding what
  `TopDownBot({ 'engine-camp': [{ do: 'fight' }] })` holds for the round's world
  (`(game.miniGame() as RoomChallenge).world`), recording each change as `{ frame, hold }` (frame
  0 the round's first tick), until `miniGame()` is null; that list is the `play` step's `input`.
  Changing the map, the types, the room or the mission's params changes the round: re-record,
  read the new values off `dump`, copy the hashes in and run `WW_UPDATE_GOLDEN=1 pnpm test
tests/runs`.
- **Recording the fortify round** the same way: step to tick 10, `open` and `play` `fortify`,
  then each tick hold what `new TdBot([{ do: 'place', tower: 'archers', col: 11, row: 1 }, { do:
'place', tower: 'archers', col: 4, row: 5 }, { do: 'wave' }])` holds for the round's game
  (`(game.miniGame() as TdDefenceRound).game`), recording each change as `{ frame, hold }`.

## The dawn assault (Engine 0.13 T7)

The follow-up, run headless from a siege run's end or its save code (`from` in a run file;
`engine/tools/CLAUDE.md`, Campaign runs and save codes). Every dawn run has seed 11, 200 world
ticks, the guard `enemy-follows-plan` (the raiders' `charge` fires at tick 1) and the invariant
`named.hall.alive`; the raiders never attack buildings, so the hall stays at 300 and the fight is
read off `sides.<faction>.units` and the named people.

- **The siege's ends pin their save codes** (`codes` at the last tick): `played`
  `2H120-1P1T8-0G01J-FJFCJ-2A00` (the captain active at 120), `delegated`
  `3YEP0-1P1T8-0G01Y-DJFCJ-2A2G` (active at 110) and `quit` `2VFP0-1P1T8-0M32N-PBJFC-J2A70`
  (captured by the raiders at 160, 90 hp); each records 150 gold. `pnpm -s cli code
games/samples/mini-siege/runs/quit.run.json` prints it. The fortify runs give no save (the hall
  falls, gap M31).

| run                  | ticks | from               | what happens                                                                                                                                                                                                                                                                              | final hash         |
| -------------------- | ----- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `dawn-held`          | 200   | `played.run.json`  | the captain on the map at 120 leads the defence: nothing opens; he falls by world tick 100 (a dead record), and the raiders are beaten by 200 (one soldier left)                                                                                                                          | `6e309a2e804edc78` |
| `dawn-captured`      | 200   | `quit.run.json`    | the same run file but `from`: the captain is held (off the map, 90 hp), the three captive choices are offered from 0 and close unused at 60; the village falls by 100 and five raiders stand at 200                                                                                       | `beb1611ce699c5a0` |
| `dawn-code`          | 200   | `quit`'s save code | `dawn-captured` from the code instead of the run: the same assertions and the same hashes (the done-when's equal hashes)                                                                                                                                                                  | `beb1611ce699c5a0` |
| `dawn-rescue`        | 200   | `quit.run.json`    | `rescue-captain` opened at 5 (the other choices close, `dawn` frozen to 45) and delegated: seed 11 draws `freed`; at 45 the captain is back at 10,15 with 90 hp, the sergeant at 40; three raiders stand at 200                                                                           | `c4401c51749ac409` |
| `dawn-rescue-failed` | 201   | `quit.run.json`    | the rescue played (the sergeant's 50 hp start the round on 5 half hearts) and given up at once: `failed` at world 45 injures her (30 hp) and offers `ransom-window`; reopening the rescue at game tick 50 is refused (`not_offered`); the ransom (120 gold) frees the captain at world 60 | `41809d9356d8ed03` |
| `dawn-exchange`      | 200   | `quit.run.json`    | `exchange-captain` opened and delegated at 5: 80 gold (70 left) and the captain freed at 15; three raiders stand at 200                                                                                                                                                                   | `a1516bdf0b2ba853` |
| `dawn-leave`         | 200   | `quit.run.json`    | `leave-captain` at 5: no effects, the captain stays captured; five raiders stand at 200, as with no choice at all                                                                                                                                                                         | `facb7083b39bcf95` |
| `dawn-fresh`         | 200   | `start: dawn`      | the dawn started fresh (Engine 0.14, gap G9: no carried record): its scenario file's captain at 120 and 150 gold, so it plays as `dawn-held`; pins the save code at 200                                                                                                                   | `6e309a2e804edc78` |

- `dawn-held` and `dawn-captured` differ only in `from`, so the only difference in their input is
  the carried record, and that differs only in the captain's entry (`mini-siege.test.ts`).
- Paths as in the siege's runs, plus `named.<key>.fate`, the opportunities at
  `world.components.Opportunities.0.1.list.<i>.status` (sorted by id: 0 `exchange-window`, 1
  `leave-window`, 2 `ransom-window`, 3 `rescue-window`) and the records at
  `world.components.Missions.0.1.committed.<i>.*`.
- After a change to the siege that moves its end world (or its save codes), re-record the dawn
  runs too: they replay their `from` run first.

## Playing in the browser

`pnpm dev`, then `games/samples/mini-siege/` from the launcher (or `pnpm build && pnpm preview`).
The battle plays at 10 world ticks a second; the camera starts east of the hall, the raiders come
down the road from the east. Mouse and touch work as in the RTS skirmish (click or tap selects,
drag boxes, right click or long-press commands, wheel or pinch zooms, middle drag or two fingers
pan). From world tick 20 to 200 the bar shows **Launch: Burn the siege engines** (the torch marks
the target): pressing it freezes the siege (the held units turn blue, the countdown starts at 120) and asks **Play** or **Delegate**; nothing moves until you answer.

- **Play**: the raiders' camp at night. Arrows move, X (or J, Shift) strikes, Backspace (Select)
  gives up (`driven-off`). Beat the ram and the catapult (and the guards) before the time runs out;
  what you burnt decides the outcome. The battle then resumes and the result lands at the commit
  tick, 120 world ticks after the launch.
- **Delegate**: the world draws an outcome by the mission's weights; it lands at the same tick.
- **The preparation phase** (Engine 0.12 T8): from world tick 5 to 30 the bar also shows
  **Launch: Man the walls** (from 20 to 30 next to the sabotage's button). Play it: the road
  between the village's walls, the hall's gold (up to 100) and two lives; arrows (or a tap) pick a
  wall, Z (or a second tap) builds the chosen tower there, X switches archers and ballista, C (or
  a right click, long-press) sells, Enter sends the raiders, Backspace gives up (`overrun`). Keep
  every raider off the gate for little gold to hold the walls cheaply. The result lands 30 world
  ticks after the launch, whether played or delegated; the sabotage can be launched after it.
- Afterwards the status line names the outcome; watch whether the hall holds.
- **The campaign** (Engine 0.13 T8): at world tick 260 the siege ends and a panel shows its
  result (the outcome, Captain Hale's fate and hp) and its **save code**, which this browser also
  keeps. **Continue: The dawn assault** plays the follow-up from it. If the captain was taken
  (give up the sabotage with Backspace, or a delegation that draws `driven-off`), the HUD shows the
  shackle and his name, and for the first 60 world ticks (6 seconds, gap M34) the bar offers
  **Break the captain out** (Play or Delegate, with Sergeant Mara Venn as the hero), **Pay for the
  captain** and **Leave the captain behind** (Decide); a failed rescue offers a dearer ransom
  instead. The dawn ends at its world tick 200; **Play again** starts over. Type a save code into
  the box at the right of the bar and press Resume (or Enter) to start from it (a wrong code says
  why), or press **Carry on** when the page opens to continue the campaign this browser saved.

## Screenshots

`pnpm -s cli screenshot games/samples/mini-siege/runs/delegated.run.json --tick 80 --json` (the
battle held, the siege in blue), `played.run.json --tick 200` (the mission room mid-round),
`delegated.run.json --tick 200` and `played.run.json --tick 600` (the battle after each commit:
the burnt catapult, or both engines gone). The page plays the run's mission steps through the
view's `mission` (Engine 0.11 T9), so `matchesHeadless` is true and the PNG is the same every run.
The preparation phase (Engine 0.12 T8): `fortify-played.run.json --tick 90` (the walls' round
mid-wave in its own skin) and `fortify-delegated.run.json --tick 60` (the battle after `overrun`,
two walls gone). `tests/browser/mini-siege-shots.test.ts` checks all eight (skipped where Chromium is
missing). Since Engine 0.13 T8 `screenshot` starts a run at its `from` as `run` does (gap M33 fixed):
`dawn-captured.run.json --tick 10` (the dawn with the captain held: the captive marker under the
gold, the choices' offer title) and `dawn-held.run.json --tick 30` (the raiders' band marching; the
view's camera is the map's centre, so the defenders by the hall are off the picture).

## How to test

`pnpm test games/samples/mini-siege`, `pnpm -s cli validate games/samples/mini-siege --json`,
`pnpm -s cli run games/samples/mini-siege/runs/played.run.json --json` (any run file; the
`dawn-*` runs for the follow-up; `pnpm -s cli code games/samples/mini-siege/runs/quit.run.json`
for the siege's save code;
`fortify-played.run.json` and `fortify-delegated.run.json` for the preparation phase),
`pnpm -s cli dump games/samples/mini-siege/runs/played.run.json --tick 566 --json` (the commit),
`pnpm -s cli mutants games/samples/mini-siege --json`, `pnpm test tests/runs` (golden hashes;
the backend parity test plays every run through the view's `frame()` and `render`), `pnpm test
games/samples/mini-siege/play.test.ts` (the page's glue), `pnpm vitest run
tests/browser/mini-siege-shots.test.ts` (the screenshots), `pnpm vitest run
tests/browser/mini-siege-page.test.ts` (the page played from its link, both missions on both
paths).

## Imports

- Allowed: relative paths inside this folder, `@engine/core/*`, `@engine/sim/*` (the glue
  builds the world and its mission port), `@engine/backends/*`, `@kits/rts`, `@kits/topdown` and
  `@kits/towerdefense`.
- Never: other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.
