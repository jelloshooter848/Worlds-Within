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

- `game.json`: kit `rts`, `uses` `topdown` (the mission rooms) and `towerdefense` (the walls'
  map), `kitOptions: { "topdown": { "rooms": "separate" } }` (Engine 0.15 T11, gap G17: each room
  file is a mission room of its own, checked alone, not one dungeon), seed 11, 320x180 (16:9 since
  Engine 0.16 F6; 256x240 before), `headless.ts`, `view.ts`; content kinds `rts-map`, `rts-types`,
  `rts-enemy`, `mission`, `campaign` (Engine 0.13), `room`, `td-map`, `td-towers`, `td-waves`, `palette`, `sprite`, `skin`,
  `sfx`, `song`, `decor` (Engine 0.16 F6). `index.html` is its page: the launcher lists it and
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
- Every mission file has a `text` (Engine 0.16 F5): the short description the in-picture mission
  card shows; presentation only (the sim never stores it), so no hash or save code moved.
- `content/missions/sabotage.mission.json` (`mission`): "Burn the siege engines", event
  `siege`, `marker` `ram` (the offer marker stands over the ram, Engine 0.15 T9, gap M25),
  `worldTimeCost` 120, `play` `mission-room`, `onQuit` `driven-off`. Outcomes (weight,
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
  ticks, then `dawn` for 200, then (Engine 0.14 T12) `ridge` for 160; since T8 each entry has the
  `title` the page shows (`The siege`, `The dawn assault`, `The ridge camp`). Since Engine 0.15 T10 (gap M34) each has a `text`, the briefing the
  page shows while the entry is held at tick 0. Since Engine 0.15 T8
  (gap M31) the siege's entry has `endIf: { "gone": "hall" }`: the campaign ends there when the
  hall has fallen, a loss said in data (the glue's own rule is gone). The glue builds the
  entry a campaign save names (`siegeCampaignPlace`); the order is never in code (gap M29), and
  the tests read every entry after the dawn from this file (gap M37). Since Engine 0.16 F4 each
  entry has a world `clock` (the siege day 2, 14:00; the dawn day 3, 05:30; the ridge day 3,
  10:00) and the campaign `ticksPerHour: 60` (the sabotage's 120 ticks are two hours);
  `MiniSiegeGame.clock()` reads it at the world tick and `siegeSource` puts `clockStatus` on every
  frame (`hostedSource`'s `status`). Presentation only: no hash or save code moved.
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
  40, `play` `mission-room` in its own room, `stockade` (Engine 0.15 T11, gap M32; it reused the
  sabotage's `engine-camp` until the kit's `rooms: "separate"` option let a second room stand
  alone), `hero` the village's `hero` (the sergeant, `hpPer` 10: 5 half hearts
  at 50 hp), the jailers as knights in the `n` cells, `defeat-all`; `freed` when the round passes
  (damage `sergeant` by `heroHpLost`, 10 delegated; `fate` freed the captain at 10,15 by the
  hall), else and on a quit `failed` (damage `sergeant` 20 or `heroHpLost`, `fate` injured,
  `opportunity` open `ransom-window`: a different follow-up, never the rescue again).
  `exchange-captain` (cost 10, no `play`: a choice, only delegated; `paid`: gold -80, `fate`
  freed), `ransom-captain` (cost 10, no `play`; `paid`: gold -120, `fate` freed) and
  `leave-captain` (cost 1, no `play`; `left`, no effects: the capture stands).
- `content/rooms/engine-camp.json` + `.map.txt` (`room`): the raiders' camp at night, one 16x11
  room with the hero's `@`, two `E` and two `n` slots: the sabotage's room.
- `content/rooms/stockade.json` + `.map.txt` (`room`, Engine 0.15 T11, gap M32): the raiders'
  stockade at dawn where the captain is held, the rescue's room: 16x11, the hero's `@` at (3,4),
  wall stubs and two posts in the yard (only `#` and `.`, the tiles the mission-room skin draws)
  and two `n` slots, where the jailers stand. Both rooms sit at cell (0,0), each with its own
  start, and both draw through the one round picture (`canvas2d-mission-room.json`, the shared
  frame source of Engine 0.15 T6) since the skin is the mini game's (`mission-room`), not a room's.
- `content/missions/fortify.mission.json` (`mission`, the preparation phase): "Man the walls",
  event `siege`, `worldTimeCost` 30, `play` `td-defence`, `onQuit` `overrun`. Its `params`
  (checked by `validate` through the towerdefense kit's schema and `checkUse`): map `walls`, 2
  lives; `build` the village's `wall` and `wall-tower` buildings onto the map's `W` cells (ascending
  id into reading order: `north-wall` 4,1, `north-tower` 11,1, `south-wall` 4,5, `south-tower`
  11,5); `budget` the village stockpile's (the hall's) gold, capped at 100; `wave` the four
  `raider-*` units (by key; the guards stay with the engines) as `raider`s with one hp per 10 world
  hp, speed 4, 10 ticks apart; rules in order: no leak and at most 40 spent `held-cheap`, no leak
  `held`, won `held-bloodied`, else `overrun`. Since Engine 0.15 T8 (lessons D3 and D4) its
  effects are **report-driven**: played, the gold taken from the hall is the round's `spent`,
  net of towers sold (the kit's `stats.spent`, which `spentAtMost` reads too) (`inventory` with `fromReport: "spent"`, `negate`, `max` 100, the budget's cap), the raiders
  removed are the round's `killed` (`destroy` with `each: "killed"`, `owner` `raiders`, `max` 4)
  and the walls lost its `fallen` (`each: "fallen"`, `owner` `village`); a report over a limit is
  refused (`report_over_limit`, a late refusal in the run's `refusedMissions`) and the mission is
  delegated at its commit. Delegated or quit, the declared amounts and lists apply: `held-cheap`
  (1: gold -40, destroy `raider-1`..`4`), `held` (2: gold -80, the same), `held-bloodied` (2: gold
  -80, destroy `raider-1` and `raider-2`, damage `south-wall` 40 (the fallen walls, each 40 when
  played) and `soldier-1` 20), `overrun` (1: destroy `north-wall` and `south-wall` (the fallen
  walls when played), damage both towers 60, `soldier-1` 30 and `captain` 30).
- `content/defence/` (the towerdefense kit's kinds): `maps/walls.json` + `.map.txt` (`td-map`,
  16x7: the road from the raiders' entry `S` on the east, bending down and back up to the hall's
  gate `X` on the west, `W` the four wall cells, legend `W` = build; `start` 0 gold, 2 lives, both
  replaced by the mission's params; since Engine 0.15 T7 no `waves`: only the `fortify` mission
  plays it, and its wave is the world's raiders, lesson D8) and `towers.json` (`td-towers`:
  `archers` 20 gold, range 2, damage 1, cooldown 3; `ballista` 40, range 3, damage 2, cooldown 6).
  The unplayed `waves/walls.json` and the `td-waves` kind are gone (Engine 0.15 T7).
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
  - `content/fonts/siege-tiny.txt` (Engine 0.16 F7): the 3D HUD's font, 3x5 capitals (the small
    letters draw as capitals), digits and punctuation, made by a throwaway generator and kept as
    text.
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
  `mission-room`; since Engine 0.16 F8 drawn from the CC0 0x72 DungeonTileset II, `images.dungeon`,
  below): `hero`, `sword`, `poof`, `pickup:heart` and `knight` (the guards) with looks by
  tag `foe:ram` and `foe:catapult` (the topdown kit tags each placed foe with its world name; the
  engines keep `camp.txt`'s frames); tiles `#` and `.`; the camera unclamped; HUD the host's
  `host:mission` title, hearts, the time left. `content/skins/canvas2d-td-defence.json` (Engine
  0.12 T8, the walls' round, mini game `td-defence`; since F8 drawn from the CC0 Kenney Tower
  Defense pack, below): `tower:archers`, `tower:ballista` (`idle`, `fire`), `enemy:raider`,
  `shot:archers`, `shot:ballista`, `ghost:<type>` and `cursor`; tiles `.` grass, `#` road, `B` the
  wall cell, `S` the camp, `X` the gate (the 16x7 map centred on the picture); HUD the host's
  `host:mission` title, `gold`, `lives`, `enemies`, the wave and at the bottom the chosen `tower`
  and its `towerCost`. Both rounds' looks are in "The hosted rounds in 2D" below; `td-end:won` /
  `:lost` only tint (the battle's `mini-game-end` sounds the end). The
  battle's skin sounds the fortify commit: `mission-commit:outcome=held-cheap` / `held` /
  `held-bloodied` (`hold`, a gold tint) and `overrun` (`breach`, a shake).
- Sound: `content/sfx/` (`sword`, `hurt`, `burn`, `pass`, `fail`, `launch`, `commit`; since
  Engine 0.12 T8 `place`, `arrow`, `bolt`, `leak`, `refused`, `hold`, `breach`; since Engine 0.13
  T8 `freed`, `coins`, `toll`; one line of MML each) and `content/songs/siege.json`, one short original loop in D minor (six bars at 120
  bpm, two pulses, triangle and noise), played by the page once the first gesture unlocks sound;
  since Engine 0.16 F7 the calm layer of the `three` skin's layered `music.siege`, whose danger
  layer is `content/songs/siege-danger.json` (the same six bars: a sixteenth-note pulse on the
  roots and a driving noise beat).
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
seed, opts?)`: the sim world, the kit's `rtsGame` on the sim's `rtsWorldPort(world)` (the
    plan, the switched-off rules; Engine 0.15 T6, gap M27: the one bridge, no copy here), and
    `MiniSiegeGame`, which since Engine 0.15 T6 (gap M18) **is** the engine's `MissionHost` (it
    extends it; no wrapper) with `missionPort(world)` (since Engine 0.15 T7 the port takes the
    world's own key table, `worldKeys`, and hands it to the rounds), the missions, both
    mini games, `ADAPTERS` and the kit's `rtsMissionHooks(rts)`: an `open` (a run file's step or
    the page's launch) is refused `not_offered` while no opportunity offers the mission, and the
    kit's view is refreshed after every mission step and commit (gap M7). Every `HeadlessGame` hook
    (`order`, `step`, `mission`, `miniGame()`, `missionExperience()`, `worldEvents`, `timeline`,
    `recordRounds`, `roundRecordings`) and the mission events on `events` (gap M21) are the
    host's; the class keeps `sim` (the world; the host's `world` is the host itself, for the
    shell), `rts`, `keys` (the world's key table, for `carriedRecord`), `factions` and `campaign`,
    and adds `named()` and `campaignSave()`; `records()` (the committed records, for the page) and
    `worldKeys()` (for `world.key` run checks) are the host's since Engine 0.15 T7 (gaps M28,
    M17), read through the sim's port. Its snapshot is the host's (`{ world,
kit, missions? }`) plus `sides` (the kit's `sidesOf`); `named()` (every scenario key:
    `{ alive, x, y, hp, fate? }`; since Engine 0.13 `alive` is "exists and its fate is not
    `dead`", and `fate` is listed only for a named person whose fate was set) is for the page and
    tests only, out of the snapshot since Engine 0.15 T9 (run files read `world.key.<key>`). Since Engine 0.13
    T7 `createGame`'s `opts.campaign` (a run file's `from`) picks the campaign entry: the dawn is
    built with the save's carried record (`worldFromScenario(json, { carried })`), the siege when
    left out; `MiniSiegeGame.campaignSave()` is the save at the end of the entry played now
    (`advanceCampaign` with the world's committed missions, in the siege `carriedRecord` for the
    dawn's `from`, and `gone: (key) => !keyAlive(sim, key)` for the entry's `endIf`), null until
    the entry is over and once the campaign is done. Since Engine 0.15 T8 the glue has no rule of
    its own: `entryOver()` is the engine's `entryOver` (gap M35: the entry's `ticks` reached with
    no mission open), read by the page too, a lost stockpile carries as zeros and the hall's fall
    ends the campaign through the campaign file's `endIf` (gap M31): the save then has `ended`. Engine 0.14 (gap G9): `starts(content)` lists the campaign's
    entries (`village`, `dawn`) for a run file's `start: { entry }`, and `createGame`'s
    `opts.start` builds that entry fresh (`siegeStartSave`: the engine's `campaignSaveAt`, no
    carried record, nothing committed before it): the dawn as its scenario file is written.
    Engine 0.14 T9 (gap M19): `recordRounds(on)` and `roundRecordings()` are the host's (the
    page's `?record` and `pnpm cli record --bot` use them).
    Engine 0.14 T7: `worldEvents(sinceTick)` and `timeline()` (the optional `HeadlessGame`
    hooks) are the `MissionHost`'s, which the sim's `missionPort` fills: the world's event log
    (kept whole; it was always on, it is never in the snapshot, so no hash moved) and its timeline
    record with the played rounds' experience. `pnpm -s cli timeline runs/played.run.json` lists
    the fortify window (offered 5, closed 30), the sabotage taken and opened at world tick 40 with
    `siege` frozen, and the unfreeze and `both-burnt` commit at world tick 160 (game tick 566);
    `pnpm -s cli events runs/played.run.json --from 40 --to 41` that tick's changes with their
    causes (`mission:sabotage`, `order:<n>`, `construct`).
  - `picture.ts`: `siegeLook(content)` (both `canvas2d` skins by `skinSet`, the sheets, size; the
    grass colour is the battle skin's `background`, Engine 0.15 gap G36, the rounds' skins clear to black), `siegeSource` / `siegeFrames(content, ui?)`: one stream over the
    `MiniSiegeGame`, the core's `hostedSource` (Engine 0.15 T6, gap M6): the RTS kit's
    `presentWorld` for `village` with the game's missions (the offer marker, the mission HUD)
    while no round is hosted, else the host's `roundFrame()` (the round's `present()` with
    `status.miniGame` set by the host to the mini game the mission plays, `mission-room` or
    `td-defence`, gap D9; its map through the source's own `MapTracker`); plus the host's events
    handed in with each draw (gap M21, `missionHostEvents`): `mission-open`, `mini-game-end` (the
    round's mission, mini game and `result`), `mission-commit` (`outcome`, `resolution`). The
    glue no longer diffs frames or switches the picture itself. `siegePicture(presenter, content, ui?)`,
    `siegeCanvasPicture(r, content, look, ui?, onSound?)` (the backend's `skinSetCanvasPresenter`:
    each frame to its skin).
  - `view.ts`: `createView` for `pnpm cli screenshot` and the backend parity test: `render`,
    `frame()`, `order` and `mission` (a run file's mission steps), the camera at the map's centre;
    the host's events of the steps since the last draw go to the frame (Engine 0.15 T6). With
    `--backend three` the screenshot page shows `frame()` through the `three` skins (the battle's
    and the rounds' `three-<id>.json`), every model they name preloaded first (`ModelLibrary.preload`)
    and the decor grids passed in (Engine 0.16 F6).
  - no `files.ts`: `main.ts` imports its data files from `virtual:game-files` (the build's plugin, `build/game-files.ts`; no `files.ts` since Engine 0.14 T2).
  - `play.ts`: `SiegePlay`, the page's glue without DOM or clock (since Engine 0.16 F7 its
    `camera` option, `keyPan(frame)` and `drift(steps)`: "The 3D page", below). Since Engine 0.15 T10 (gaps
    M26, M34, M36, lesson D14; docs/BUILD-LOG.md, Engine 0.15, decision 11) the page's flow is
    the engine's: `launch` is the shell's `MissionLaunch` (`engine/core/shell/mission-launch.ts`:
    `launchButtons()`, `press({ kind: 'launch' | 'play' | 'delegate' | 'begin' | 'continue' |
'code' | 'stored' })`, `choice()`, `canPlay`, `playing()`, `held()`, `briefing()`, `ended()`,
    `storedSave()`, `status(keys)`, `message`, `records()`, `title`, `outcomeTitle`,
    `entryTitle`), and `SiegePlay` hands it only the mini siege's parts: `create(save)`
    (`createGame` at the entry the campaign save is at, the siege fresh when null), the
    missions, `offers` (the RTS kit's `missionButtons`, checked again by the kit's
    `rtsMissionHooks` on open), `tick` (`rts.tick`), `stepsPerTick` (`STEPS_PER_TICK` 6:
    `TICKS_PER_SECOND` 10, kept here rather than the shell's scene `tickRate`, gap D2, because
    the battle reads the pointer's gestures every loop step), `control` (the pointer's gestures to
    the kit's `RtsControls`, an order to `RtsGame.issue`, its refusal the message), `onGame` (an
    `RtsCamera` east of the hall and fresh controls for every entry), `status` (the hall fallen or
    the raiders beaten) and the campaign: the engine's `CampaignSession` over the campaign file,
    `entryOver` and `save` (the game's `entryOver()` and `campaignSave()`, gap M35) and `summary`
    (`people`, the village's named people, `Captain Hale: captured, 90/120 hp`, and the `verdict`:
    the hall fallen, the raiders beaten, every defender fallen or the hall standing). Every entry
    (the siege, each Continue, a typed code, the stored save) is held at tick 0 until Begin (gap
    M34; `hold: false` for tests that do not need it); its end gives a `LaunchEntryResult`
    (`entry`, `title`, the outcomes' titles, `people`, `verdict`, `next`, and the session's
    `save`, `code`, `stored`, `done`). The rounds' key hints are the kits' (`missionRoom` and
    `tdDefence` declare their `controls`; the page's `ROUND_HINTS` is gone). Taps in the walls'
    round are frame input the kit's round reads itself (gaps D1, D12). Also `game` (the entry's
    `MiniSiegeGame`), `scenario`, `tick`, `view()`, `sides()`, `ui` and `scene(stack, picture)`
    (the launch's `HostScene`, which pushes the core `miniGameScene` when the round starts and
    pops it on its end; its `headless()` is the entry's game for the page's `window.__ww`).
    Since Engine 0.16 F5 `missionScreens(opts)` is the shell's `MissionScreens` over `launch`
    (the briefing, the mission card with Play or Delegate, the mission result and the entry's
    results, in the picture with the UI kit, styled by `game.json`'s `menus`), handed the sim's
    `missionCardFacts` and `worldChanges` on `game.sim` and the campaign's `ticksPerHour`: passed
    through, never computed here.
  - `main.ts`: the boot only (since Engine 0.16 F7 the page opens **in 3D**; "The 3D page",
    below): `bootBrowserGame` with `default3d`, the Three.js display (`threeDisplay` with the
    `three` skins, every model they name preloaded, the decor grids, the pixel sheets and fonts,
    the render scale) and the 2D ones (`canvasDisplay`, `pixiDisplay`), `pointer: true`, the touch
    pad left on (the round on a phone), `audio` (`contentSfx`, `contentSongs`, music `siege`, the
    `three` skin's layered `music`), `game` (the volume control's storage key, gap M1). In 3D the
    mission flow is in the picture: `SiegePlay.missionScreens` (its keys from the player's
    bindings, its sounds the shell's ui bus, the card in `siege-tiny`) under the shell's
    `missionScreensScene`, drawn with the display's `uiPainter`, the pointer's gestures on a
    screen kept from the battle's controls (`MissionScreens.uncovered`); no bar is mounted. In 2D
    the shell's `mountMissionBar({ launch, input })` (Engine 0.15 T10: `#bar` with `#launches`,
    `#play`, `#delegate`, `#status`, `#stored`, `#code`, `#resume`; `#briefing` with `#begin`;
    `#result` with `#result-code` and `#continue`; updated after every draw), or with
    `?ui=picture` the picture's screens there too. `body[data-ui]` is `picture` or `bar`. And
    `window.wwSiege` (`tick`, `held`, `choice`, `playing`, `outcomes`, `miniGame`, `round` (the
    hosted round's `kit` summary), `scenario`, `ended`, `named`, `captive`; from F7 `ui`,
    `screen` (the mission screen shown), `itemBox(item)` (a screen item's picture box, for
    scripts that click it), `worldToScreen` and `camera`; from F9 `texts` (the shown screen's
    texts, in order)). Engine 0.16 F9: under the title the frames carry `HUD_HIDDEN_STATUS` (no HUD
    or labels behind the title, gap M40); `body[data-screen]` is the mission screen shown (the
    page's CSS moves its controls to the bottom-right corner over a centred screen, the pause menu
    and the title, gap M41, and while a hosted round shows on the shell's 2D layer,
    `body[data-round='layer']`, Engine 0.16 polish P7: there in one narrow column, the sound
    button over an upright slider, in the picture's side margin beside the 256 px round, clear of
    its bar and panel; Engine 0.16 polish Q8: over a centred screen and the menus, one row clear
    of the HUD's key-hint panel, in the letterbox or just over the panel); a save code in the link (`?code=<code>`, gap M42) is pressed as the
    bar's code box would (the 3D page has no text box). No launch, campaign-panel, save-code
    or hint logic of its own. `index.html` is the canvas (in 2D leaving the bar's 40 px below
    it; in 3D the whole window), the 2D/3D toggle (`#backend`), the shell's sound control and
    pause button moved to the bottom centre in 3D (between the selected unit and the mission card), and the no-display message's style.
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
  played world equal to a fresh one given the same result at 10, and the same hashes twice; and a
  round that places and sells archers six times before keeping one (140 paid, 60 back) commits
  its played `held` and takes only the net 80 gold from the hall.
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
  carried in as a record opening nothing, the campaign ended (`ended`, a v2 code) once the hall
  has fallen, and no save before the entry is over (Engine 0.15 T8).
- `mission-screens.test.ts` (Engine 0.16 F5): the mission flow in the picture over the page's
  glue (`SiegePlay.missionScreens` and the shell's `missionScreensScene` on a real `SceneStack`):
  the siege's briefing begun by a key; the sabotage's card (`MISSION AVAILABLE`, its `text`,
  `Costs 2 hours of world time`, `Hero Captain Hale`, `Foes ram, catapult, Grell, Vosk`, the
  window's `Window closes in 160 ticks` counting down, the battle stepping on under it); the
  fortify's card and both listed while both windows are open; Delegate by a tap, by keys and by a
  gamepad, Play by the mouse (hover then click; the screens step aside for the round); the dawn's
  captive choices listed, one chosen, Play disabled for a choice; the mission result's Continue;
  and the results of the delegated, played and quit sieges (missions, losses by faction, people,
  buildings, the save code, Continue to the dawn's briefing) with each run file's last hash
  unmoved.
- `play.test.ts`: the page's glue on a real `SceneStack`, drawing every step into the null
  backend: launch at world tick 40, then delegate (`ram-burnt` at 160, the commit's event) or play
  (the round pushed and popped, `played.run.json`'s recorded round fed as the page's keys and
  recorded back by the game (Engine 0.14 T9: `roundRecordings()` equal to the committed input at
  tick 40, and `fortify-played`'s at tick 10),
  `mini-game-end:pass`, `both-burnt` at 160); each path ends at world tick 260 with the run file's
  last state hash. A launch after the window closes is refused `not_offered`. The preparation
  phase the same way: `fortify` launched at world tick 10, delegated (`overrun` at 40) or played
  (`fortify-played.run.json`'s recorded round as keys, `status.miniGame` `td-defence`, the host's
  title `Man the walls`, `mini-game-end` for `td-defence`, `held-cheap` at 40), ending with the
  fortify run files' last hashes. Engine 0.12 T8 (frame taps since Engine 0.15): taps in the
  walls' round (picture (184, 88), the centre of cell 11,1 with the map at picture y 64, the kit's
  `screenAtCell`) move the cursor, place archers (gold 80), a tap off the map does nothing, a
  secondary tap sells (gold 90), select quits to `overrun` at 40; the round's recording keeps its
  taps (`input.taps`, gap D1); a tap in the battle does nothing;
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
  carried on from; and the campaign ended once the hall has fallen (`fortify` delegated: `done`,
  Continue starts over). Engine 0.15 T10 (most tests pass `hold: false`): every entry held at tick
  0 until Begin (the siege and the dawn after Continue, with their briefings, nothing offered or
  stepped before; a code resumes held), the same hashes once begun, and the sabotage round's key
  hint from the mission room's controls.
- Also: `tests/runs/mission-events.test.ts` (Engine 0.15 T6, gap M21: `played` and `delegated`
  played through the tools' run loop, the host's `mission-open`, `mini-game-end` and
  `mission-commit` events on the game ticks their assertions name, the golden hashes unchanged),
  `tests/browser/mini-siege-page.test.ts` (the built page played from the launcher's link in
  headless Chromium: Launch then Delegate, and Launch then Play with the recorded round typed as
  keys; Engine 0.11 T10; since Engine 0.12 T8 the same for `fortify` at world tick 10, delegated
  (`overrun`), played by the recorded keys (`held-cheap`) and played by taps then given up
  (`overrun`), each committing at 40, with no page errors; since Engine 0.14 T9 the played
  sabotage page has `?record`: `window.__ww.recordings()` is the committed input, and written with
  `pnpm cli record` into a copy of `played.run.json` without it the run passes with the golden
  hashes; since Engine 0.13 T8 the campaign: the
  siege to its end at 260 along both captain fates (Delegate, and Play then Backspace), the result
  panel's save code equal to `delegated`'s and `quit`'s pinned codes, Continue to the dawn (the
  captain on the map to its end at 200, "Play again"; or held: the three choice buttons, the
  exchange decided at 5 and committed at 15, the captive marker gone), a second page in the same
  browser carrying on from the stored save, and a fresh page refusing a bad code with its reason
  in the status and resuming the dawn from `quit`'s code; since Engine 0.15 T10 every entry,
  the resumed dawn too, held at tick 0 with its briefing until Begin, nothing stepping or offered
  before), `tests/browser/mini-siege-shots.test.ts` (screenshots on both paths, below) and
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
| `played`            | 666   | played: a recorded 406-tick round (the kit's bot fighting) burns both engines (`both-burnt`); the world resumes at game tick 446; the hall ends at 400                                                                                                                                                                            | `4cb20d9d684a4849` |
| `delegated`         | 260   | delegated at once: seed 11 draws `ram-burnt` (the captain down 10); the catapult (60 hp) reaches the hall, which ends at 280                                                                                                                                                                                                      | `eeba3b08975e07e1` |
| `quit`              | 261   | played and quit on the round's first tick (select): `driven-off`, the captain down 30 and captured (off the map); both engines reach the hall, which ends at 112                                                                                                                                                                  | `b3cb42a0c0409b65` |
| `fortify-played`    | 376   | the preparation phase played: a recorded 116-tick round (the kit's `TdBot`: archers on `north-tower` and `south-wall`, then the wave) holds with no leak for 40 gold (`held-cheap`); the world resumes at game tick 127; at 40 the hall's gold is 110 and the four raiders are gone; the engines still bring the hall down by 200 | `2b9327daefddd9a1` |
| `fortify-delegated` | 260   | delegated at once: seed 11 draws `overrun`; at 40 `north-wall` and `south-wall` are gone, the towers at 60, `soldier-1` at 20, the captain at 90, the gold untouched; the raiders kill all but one soldier; the hall falls by 200                                                                                                 | `830abca417810eaa` |

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
- The two fortify runs' golden and sync hashes were re-recorded in Engine 0.15 T8 (decision 9):
  `fortify`'s def (stored while it is open, and its effects in the committed record) gained the
  report-driven effects, so both move from the first sync hash after the open (tick 20; final
  `0b43372f77faea35` to `c758b3283ab59e88` and `302436d18dc3917d` to `bd8f76744d63c45e`). No
  assertion changed: the played round spent 40 and killed all four raiders, which is what
  `held-cheap` declared, and `overrun`'s declared walls are its fallen ones.
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
  outcome's effects (`world.key.ram.alive`, `world.key.catapult.Health.hp`,
  `world.key.captain.Health.hp`; the played
  record's `report.stats.destroyed`); and the hall's hp at 260. `played` also checks the round in
  the snapshot (`missions.round`: its ticks, `pass`, `both-burnt`) and the world tick standing
  still through it.
- Paths (Engine 0.15 T7, gap M17: by scenario key, never by place in a component list):
  `world.key.<key>.alive`, `.fate`, `.Health.hp`, `.Position.x`/`.y` (`.Position` null off the
  map), `sides.<faction>.*`, `kit.enemy.<step>.fired`,
  `world.one.Missions.(open|committed).<i>.*` and `world.one.WorldTime.frozen` (the world-level
  component; `engine/tools/CLAUDE.md`, Keyed paths). The snapshot's old `named` summary
  was removed in Engine 0.15 T9 (decision 2: the hashes moved once, with M20 and `marker`).
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
  recorded in `docs/reports/stacking-test.md` (G12). `dawn-rescue-played` (Engine 0.15 T11)
  guards `topdown:walls-block-movement` (its recorded round no longer passes with it off), so 3 of
  the top-down kit's rules stay unguarded. The whole folder takes about four minutes (14 run
  files, 24 rules).
- **Recording the played round** (Engine 0.14 T9, gap M19; no script): `pnpm -s cli record
games/samples/mini-siege/runs/played.run.json --mission sabotage --bot '{"engine-camp": [{"do":
"fight"}]}' --json` plays the run with the `play` step's input left out, the topdown kit's
  `TopDownBot` fighting in the round, records the round (`MiniSiegeGame.recordRounds`, the
  host's) and writes it into the `play` step's `input` through the checked edit path, then runs
  the file. It writes the committed input unchanged (`changed: false`, `passed: true`, final hash
  `4cb20d9d684a4849` since Engine 0.15 T9), so the 0.11 script's recording is what the tool records. Or play it on the
  page with `?record` and write `window.__ww.recordings()` with `--input` (`engine/tools/CLAUDE.md`,
  Recording a round). Changing the map, the types, the room or the mission's params changes the
  round: remove the run file's `hashes`, re-record, read the new values off `dump`, copy the hashes
  in and run `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`.
- **Recording the fortify round** the same way: `pnpm -s cli record
games/samples/mini-siege/runs/fortify-played.run.json --mission fortify --bot '[{"do": "place",
"tower": "archers", "col": 11, "row": 1}, {"do": "place", "tower": "archers", "col": 4, "row":
5}, {"do": "wave"}]' --json` (the tower-defense kit's `TdBot`; also unchanged, final hash
  `2b9327daefddd9a1` since Engine 0.15 T9). Since Engine 0.15 (gap D1) a round played by taps on the page records its
  taps too (`input.taps`), which the run file's `play` step replays.
- **Recording the rescue round** (Engine 0.15 T11, gap M32): `pnpm -s cli record
games/samples/mini-siege/runs/dawn-rescue-played.run.json --mission rescue-captain --bot
'{"stockade": [{"do": "fight"}]}' --json` (the plan names the rescue's own room) wrote
  `dawn-rescue-played`'s `play` input. Giving the rescue its own room moved the sync and golden
  hashes of `dawn-rescue` and `dawn-rescue-failed` at ticks 20 and 40 only (the open mission's
  definition is in the world while it is open; their final hashes are unchanged); no other run
  moved.

## The dawn assault (Engine 0.13 T7)

The follow-up, run headless from a siege run's end or its save code (`from` in a run file;
`engine/tools/CLAUDE.md`, Campaign runs and save codes). Every dawn run has seed 11, 200 world
ticks, the guard `enemy-follows-plan` (the raiders' `charge` fires at tick 1) and the invariant
`world.key.hall.alive`; the raiders never attack buildings, so the hall stays at 300 and the fight is
read off `sides.<faction>.units` and the named people.

- **The siege's ends pin their save codes** (`codes` at the last tick; save code v2 since Engine
  0.15 T8, gap M38: missions by stable id code, so a mission file added later moves none):
  `played` `5EWCD-P0DGB-90200-69Y9X-J8820-00` (the captain active at 120), `delegated`
  `4BRDD-P0DGB-90200-7SP9X-J8820-2G` (active at 110) and `quit`
  `4DWHD-P0DGB-902GC-APSE9-XJ882-070` (captured by the raiders at 160, 90 hp); each records 150
  gold. `pnpm -s cli code games/samples/mini-siege/runs/quit.run.json` prints it. `dawn-code`
  keeps `quit`'s version 1 code, `2VFP0-1P1T8-0M32N-PBJFC-J2A70`, which the v1 reader still reads
  to the same save. The fortify runs' saves end the campaign (`ended`: the hall falls, the
  campaign file's `endIf`, gap M31).

| run                  | ticks | from               | what happens                                                                                                                                                                                                                                                                                                                                                | final hash         |
| -------------------- | ----- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `dawn-held`          | 200   | `played.run.json`  | the captain on the map at 120 leads the defence: nothing opens; he falls by world tick 100 (a dead record), and the raiders are beaten by 200 (one soldier left)                                                                                                                                                                                            | `c5e88a910dfe2710` |
| `dawn-captured`      | 200   | `quit.run.json`    | the same run file but `from`: the captain is held (off the map, 90 hp), the three captive choices are offered from 0 and close unused at 60; the village falls by 100 and five raiders stand at 200                                                                                                                                                         | `d13258df96b4db81` |
| `dawn-code`          | 200   | `quit`'s save code | `dawn-captured` from the code instead of the run: the same assertions and the same hashes (the done-when's equal hashes)                                                                                                                                                                                                                                    | `d13258df96b4db81` |
| `dawn-rescue`        | 200   | `quit.run.json`    | `rescue-captain` opened at 5 (the other choices close, `dawn` frozen to 45) and delegated: seed 11 draws `freed`; at 45 the captain is back at 10,15 with 90 hp, the sergeant at 40; three raiders stand at 200                                                                                                                                             | `1ebfaa6dae0eb6e5` |
| `dawn-rescue-played` | 400   | `quit.run.json`    | (Engine 0.15 T11, gap M32) the rescue played in the `stockade` room at 5 (input recorded with the kit's bot, below): the sergeant on 5 half hearts beats both jailers and the round passes at game tick 243 (`freed`, 238 round ticks, world still at 5); it commits `played` at world 45 (game 283): the captain freed at 10,15, the sergeant unhurt at 50 | `ea5896a26067e338` |
| `dawn-rescue-failed` | 201   | `quit.run.json`    | the rescue played (the sergeant's 50 hp start the round on 5 half hearts) and given up at once: `failed` at world 45 injures her (30 hp) and offers `ransom-window`; reopening the rescue at game tick 50 is refused (`not_offered`); the ransom (120 gold) frees the captain at world 60                                                                   | `9d9f5ad86dd28cae` |
| `dawn-exchange`      | 200   | `quit.run.json`    | `exchange-captain` opened and delegated at 5: 80 gold (70 left) and the captain freed at 15; three raiders stand at 200                                                                                                                                                                                                                                     | `3250cd0dccd5925c` |
| `dawn-leave`         | 200   | `quit.run.json`    | `leave-captain` at 5: no effects, the captain stays captured; five raiders stand at 200, as with no choice at all                                                                                                                                                                                                                                           | `86ec1de1cef2d19d` |
| `dawn-fresh`         | 200   | `start: dawn`      | the dawn started fresh (Engine 0.14, gap G9: no carried record): its scenario file's captain at 120 and 150 gold, so it plays as `dawn-held`; pins the save code at 200                                                                                                                                                                                     | `c5e88a910dfe2710` |

- `dawn-held` and `dawn-captured` differ only in `from`, so the only difference in their input is
  the carried record, and that differs only in the captain's entry (`mini-siege.test.ts`).
- Paths as in the siege's runs, plus `world.key.<key>.fate`, the opportunities at
  `world.one.Opportunities.list.<i>.status` (sorted by id: 0 `exchange-window`, 1
  `leave-window`, 2 `ransom-window`, 3 `rescue-window`) and the records at
  `world.one.Missions.committed.<i>.*`.
- After a change to the siege that moves its end world (or its save codes), re-record the dawn
  runs too: they replay their `from` run first.

## The ridge camp (Engine 0.14 T12, data files only)

Engine 0.14's Done when: a scenario added with **data files only** (no `.ts` change in this
folder) that the debugger steps through. Its files:

- `content/maps/ridge.world.json` (`rts-map`): "The ridge camp", the village's terrain with a rock
  ridge east of the road's end; the hall (340 of 400 hp, 120 gold), three soldiers (15,14-18) and
  the squad `defenders` (`captain` 14,15, `sergeant` 14,16); the raiders' camp: three raiders
  (37,13-17), a new `ram` (40,16) and the squad `ridge-band` with the chief `chief` (Varga, role
  `regular`, 41,15). No `from` (it starts as written; the dawn's save carries nothing into it)
  and no `EventMember`; one opportunity, `stores-window`, offering `stores-raid` from world tick
  10 to 90.
- `content/missions/stores-raid.mission.json`: "Raid the raiders' stores on the ridge", cost 20,
  no `play` (only delegated), `onQuit` `stores-taken`; outcomes `stores-taken` (2: gold +60) and
  `ram-burnt` (1: destroy `ram`). Its id sorts after `sabotage` on purpose: version 1 save codes
  index missions by sorted id, so an id sorting earlier would have moved every pinned code (gap
  M38; since Engine 0.15 T8 codes are version 2, by stable id code, and no longer care).
- The campaign's third entry, `ridge` (above).
- `runs/ridge-raid.run.json` (+ `.hashes.json`): `start: { entry: "ridge" }`, 160 ticks, hashes
  every 40; the raid opened and delegated at tick 10: seed 11 draws `ram-burnt` at world 30; the
  village wins (no raider left at 80, the chief among them), the hall untouched at 340, four
  village units at 160. Final hash `4670bab2df97d5f4` (since Engine 0.15 T9).
  `tests/browser/debugger-done-when.test.ts` steps it forward and back in the debugger against the
  golden hashes and reads its timeline, and opens a deliberately failing copy's replay at its
  failing tick.

On the page the ridge camp follows the dawn: Continue: The ridge camp, then the campaign is over.

## Playing in the browser

`pnpm dev`, then `games/samples/mini-siege/` from the launcher (or `pnpm build && pnpm preview`).
Every campaign entry opens on its briefing with the clock stopped at tick 0 (Engine 0.15 T10, gap
M34): press **Begin** when ready. The battle plays at 10 world ticks a second; the camera starts east of the hall, the raiders come
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
  shackle and his name, and for the first 60 world ticks (6 seconds from Begin, gap M34) the bar offers
  **Break the captain out** (Play or Delegate, with Sergeant Mara Venn as the hero), **Pay for the
  captain** and **Leave the captain behind** (Decide); a failed rescue offers a dearer ransom
  instead. The dawn ends at its world tick 200; **Play again** starts over. Type a save code into
  the box at the right of the bar and press Resume (or Enter) to start from it (a wrong code says
  why), or press **Carry on** when the page opens to continue the campaign this browser saved.

## Screenshots

`pnpm -s cli screenshot games/samples/mini-siege/runs/delegated.run.json --tick 80 --json` (the
battle held, the siege in blue; add `--backend three --allow-software-gl` for the 3D map, above), `played.run.json --tick 200` (the mission room mid-round),
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

## The siege map in 3D low-poly (Engine 0.16 F6)

The battle drawn by the 3D backend in a low-poly look after the mockup
(`docs/reports/mockups/mini-siege-3d.png`): `content/skins/three.json`, presentation only (no
hash, save code or path moved; the backend parity test plays every run through it).

- **The picture** is 320x180 (16:9; whole-number scales to 1920x1080 at six times, an owner
  item, decision in the F6 commit). The Canvas2D skins were re-laid for it (the battle's bottom HUD
  row at y 168, the walls' round's at 160) so the 2D page and screenshots still work; the tests'
  256x240 numbers moved with it (the walls' round's taps, the shots' sizes). The rooms and the
  walls' map fit the shorter picture as they were. The results screen shows the changes in two
  columns on a picture this wide (`engine/core/shell`'s `resultsScreen`), the rest counted.
- **Camera**: `camera3d.view` `ground` (Engine 0.16 F2), pitch 60, yaw -8, fov 35, the skin's
  `camera.zoom` 0.42 (the whole village, river and camp, as the mockup frames them); `scene3d`
  `renderScale` 6 (F3), so a screenshot is 1920x1080. The view's camera is still the map's centre.
- **Models** (`assets/`, credited in `assets/CREDITS.md`): workers, soldiers, Captain Hale and
  raiders are the Quaternius characters (`scale` 0.07), coloured with the kind's `materials`
  (the engine's model recolouring, F6: blue cloth for the village, red for the raiders, skin
  tones; the Quaternius `Skin` material is near black as converted) and playing `Idle`, `Walk`,
  `Punch` (attack) and `PickUp` (build, gather); the sergeant is a soldier with the `hero` tag's
  colours. The ram and catapult are the castle kit's, swapped for their `-demolished` models by
  the `damaged` tag look (`model`, F6). The hall is the village pack's inn with a blue roof; the
  watchtower the castle kit's, its site a low base, an open frame, then a frame with stairs as
  `progress:` passes 33 and 66; walls and wall towers the castle kit's; gold nodes a Nature Kit
  rock in gold, grey when empty. Every unit and building's `frozen` tag look is a blue `tint`
  (the event held by a mission). The offer marker is the glowing gem of `assets/mini-siege-marks/`
  (made by `tools/mark-models.ts`) over its target, with a point light and sparkles; the selection
  ring a ring of small green blocks; the health and progress bars draw nothing (a 0.01 px box):
  they are labels instead.
- **Labels**: a health bar over each unit and building whose bar the RTS kit shows (the kit's
  `hp:<hp>/<max>` tag, F6), red for raiders; `Battering ram` and `Catapult` under the engines;
  `Watchtower <n>%` and a progress bar over the site (`progress:`); places THE HALL and
  RAIDERS' CAMP on every map, in `siege-small`.
- **Terrain and decor**: grass, road and rock cells are Nature Kit ground tiles (recoloured by the
  tile's `materials`, a little `vary` tint), rocks stand on rock cells as decor. The decor grids
  `content/decor/village.txt`, `dawn.txt` and `ridge.txt` (one per scenario: the RTS kit's
  `mapId` names the map, F6) dress the map: the castle ring round the hall area (walls, round
  towers with blue hexagon roofs stacked by the legend's `stack`, F6), open to the east over the
  road and the battle rows 12-19 and at the south gold node, so no unit is ever drawn inside a
  wall; houses, smithy, market, well and carts inside; the river (columns 27-29, the bridge on
  the road; the raiders wade it elsewhere, as their paths always did); fields, the sheep pen and
  the windmill in the south; woods to the north and south; the open fields round the battle rows
  dressed as countryside (polish P10): a fenced corn plot north of the corridor, hay bales (`z`),
  flowers (`v`), grass, bushes, small rocks, stumps (`x`) and a few trees on the banks and field
  edges, each turned, sized and nudged per cell by the legend's `yaw`, `scale` range and
  `jitter`, every model one the skin already loads (the battle rows stay bare grass); the
  raiders' camp east of the river
  (tents, red banners, log piles and campfires, each with a flickering point light, smoke and
  flame: the legend's `light` and `emit`, F6). The dawn's camp is half struck; the ridge's sits
  among the ridge's rocks. Every legend entry is presentation only and drawn from the
  presentation RNG; `validate` checks the grids' sizes, characters and models.
- **Light**: a warm sun with soft shadows (2048 map, radius 4), an ambient and a hemisphere light,
  linear distance fog, ACES tone mapping, and a `timeOfDay` (F4) moving them with the world clock:
  the siege from mid-afternoon to sunset, the dawn's pink morning, the ridge's late morning.
- **The hosted rounds** had first 3D skins (`three-mission-room.json`, `three-td-defence.json`)
  until F8, which removed them: the 3D page draws the rounds in 2D (below).
- **Iterated against the mockup**: screenshots at this angle were taken and looked at beside the
  mockup about a dozen times (`pnpm cli screenshot ... --backend three --allow-software-gl`):
  the Nature Kit's teal colours recoloured, the river's banks turned, the ford tiles dropped,
  rocks moved off bare cells, the characters' black skin and armour recoloured, the tower roofs
  stacked, the engines' names moved under them so the gem shows, the camera pulled back to frame
  the castle and the camp, the dawn's light warmed and filled. Known gaps for later part F
  tasks: the HUD was still the 2D one in pixel fonts (F7 replaced it), the ram's cover is the castle kit's
  blue, the river is straight, and the map's edge shows in the far corners.

`three.test.ts` checks the picture (320x180 at render scale 6, ground view, shadows, fog, ACES,
a time of day), each scenario's own map id, decor grid (the map's size) and places, the scenery
kept off the roads, every entity's starting cell and the battle rows (columns 13-44, rows 12-19),
and a model for every kind the kit presents (the burnt ram, the site's three looks, the labels).

Screenshots: `pnpm -s cli screenshot games/samples/mini-siege/runs/delegated.run.json --backend
three --allow-software-gl --tick 80` (the village held, late afternoon), `dawn-held.run.json
--tick 30`, `ridge-raid.run.json --tick 40`; `tests/browser/mini-siege-shots.test.ts` shoots all
three twice (byte-identical, 1920x1080).

## The 3D page (Engine 0.16 F7)

The page (`index.html`, `main.ts`) opens in 3D by default and runs in 2D where WebGL 2 is missing
(the shell's `default3d`) or with `?backend=canvas2d` / `?backend=pixi`; the toggle (`#backend`)
links the other one. Presentation only: no hash, save code or run file moved.

- **The picture** is the `three` skin at the skin's render scale 6, capped to the window's pixels
  (`?scale=<n>` sets it; the browser tests use 1). Every glTF model the skins name is loaded
  before the first frame.
- **Camera and controls**: `SiegePlay`'s `camera` option takes the skin's ground camera
  (`skinGroundCamera`) and zoom, so the `RtsCamera` picks through F2's ground projection: clicks
  select, drags box-select what is drawn in the rectangle, right clicks command, the wheel and a
  pinch zoom (from the whole map, the skin's 0.42, to 2.5 times it, `ZOOM_RANGE`), drags and the
  picture's edges pan, and the arrow keys or WASD pan (`keyPan`, `KEY_PAN_SPEED`) while no round
  is played and no mission screen is shown. At the starting zoom the whole map is in view, so
  panning starts once zoomed in.
- **HUD** (`three.json`'s `hud`, the UI kit's widgets in the new `content/fonts/siege-tiny.txt`, a
  3x5 font whose small letters draw as capitals, and `siege-small` for headings; flat panels,
  F7): resource chips top left (gold, the village's units, the raiders, captives; counters that
  roll), the title bar top centre (the campaign entry's title, `entryTitle`, put on every frame
  by `siegeSource`, and the world clock `Day 2 14:00 afternoon` with its day bar), the
  objectives top right (hold the hall, with its health bar and a box that turns red when it
  falls; keep Hale alive, a red box and `Free Captain Hale` when he is captured; raise the tower with its progress,
  only where there is a watchtower: the RTS kit's `key.<key>.*` status and each item's `when`),
  the minimap bottom left in an Ashford Vale frame (terrain colours, the village's and the
  raiders' dots, the offer), the selected unit (name, type and role, health bar and number, while
  one thing is selected: `selectedName`, `selectedType`, `selectedRole`) and the key hints bottom
  right. The engines' and the watchtower's labels moved to `siege-tiny`.
- **Time of day**: the campaign's clocks (F4: the siege from 14:00, the dawn at 05:30, the ridge
  at 10:00; the sabotage's two hours ease over the skin's `timeOfDay` tween) move the light and sky.
- **Mission flow**: F5's screens in the picture, the briefing (Begin, Carry on), the mission card
  (Play or Delegate; several offers listed) and its window badge in `siege-tiny` at 124 px
  (`MissionScreens`' `card`, F7), the outcome card and the entry's results (the save code,
  Continue), by mouse, keys, gamepad and touch. A save code is typed on the 2D page's bar (the 3D
  page carries on from the stored save instead; decision in the F7 commit).
- **Title, pause, settings**: the shell's menus restyled to the HUD's colours (`game.json`'s
  `menus.style`: dark brown panels, gold headings and borders), the title's pixel art dropped;
  the title shows the village behind it, the camera drifting slowly closer in round its start
  (`SiegePlay.drift`, `TITLE_DRIFT`, presentation only, put back when play starts). The mission
  screens step aside while a menu shows.
- **Music**: `three.json`'s `music.siege` layers the song `siege` (calm) with
  `content/songs/siege-danger.json` (danger: a driving pulse and drums in the same six bars), the
  danger layer up while a mission is open (`missionLeft`) or raiders are within 3 cells of the
  village's buildings (the RTS kit's `enemyNear`), mixed by the shell's mixer. The title plays
  the same (calm). Event and UI sounds as before.
- **Mission-open flash** (Engine 0.16 polish P7, F3): `three.json`'s `mission-open` gives an
  event `flash` (`#fce0a8`, a warm cream, at alpha 0.25 fading over 18 presentation frames, three
  world ticks on the page) in place of the 2D skin's full-white two-tick `effect` flash, which
  whited out the whole 3D picture after Delegate. Like every flash it is skipped with the
  player's reduced-flashing setting.

`three.test.ts` checks the HUD (the UI kit's, every key it reads on the frames, the title, clock
and objectives drawn, no watchtower line at the dawn) and the music's danger layer while a
mission is open. `tests/browser/mini-siege-page.test.ts` drives the 3D page.

## The hosted rounds in 2D (Engine 0.16 F8)

The sabotage and rescue rooms (`mission-room`) and the walls' round (`td-defence`) play from the 3D
page in 2D, with the presentation parts C and E set for the top-down and tower-defense samples.
Presentation only: `fortify-played`, `played`, `dawn-rescue-played` and every other run keep their
hashes.

- **How the 3D page draws them** (owner item, decision in the F8 commit): `three.json`'s
  `rounds2d` lists both rounds, so the page's shell (`bootBrowserGame`'s `rounds2d`, from
  `main.ts`) starts the game's 2D display (its `default2d`, Canvas2D; the shell picks) on a canvas
  layered over the 3D one (`roundLayerDisplay` in `engine/core/shell`): a round's frames are drawn
  there with the `canvas2d-*` round skins, while the world stays in Three.js. The alternative, a
  3D skin per round, was F6's first look; the round packs are 2D pixel art, so 2D draws them as
  they are. The 3D round skins were removed. `pnpm cli screenshot --backend three` draws a
  round's frames the same way (the 2D picture scaled to 1920x1080).
- **Transition**: `game.json`'s `transitions.mission`, an iris (28 frames, 6 held), closes over
  the 3D world, opens on the round, and closes and opens again on the way back (the shell plays
  the `mission` slot when the round's scene is pushed and popped; it holds the game's ticks while
  it closes, so no state moves). The world clock stands still while the round is played; at the
  commit it jumps by the mission's cost, which the `three` skin's `timeOfDay` eases (F4).
- **The rooms** (`canvas2d-mission-room.json`, `images.dungeon` over
  `assets/dungeon-tileset-ii/tileset.png`, the frames' rectangles from the pack's tile list): brick
  walls (`wall_mid`; `wall_capped`, the cap over the bricks, where the floor is above: the tile's
  `join`), `floor_1`, the hero `knight_m` (idle, run with footstep dust as frame events, a lunge
  on `attack`, `hit` on `hurt`), the sword `weapon_regular_sword` turned to the facing
  (`turnToFacing: "up"`) with a pop-in, the guards `orc_warrior` (`masked_orc` for the second
  guard of each room), hearts `ui_heart_full`. Feel: the kit's knockback, a white hit flash while
  a foe or the hero is `flashing` (`hitFlash`, blinking), hit-pause and shake on `hit`, `kill`
  (also a zoom punch) and `hurt` (also a red flash and blood), slash sparks on `sword`, embers and
  smoke from a beaten foe's poof. The kit frames the room 2 px from the picture's top
  (`ROOM_TOP` in `headless.ts`, with the picture's size): the whole room shows, its HUD band (the
  title in `siege-small` and the hearts on a dark panel with the menus' gold border) over the top
  wall and the time bar over the bottom wall.
- **The walls** (`canvas2d-td-defence.json`, `images.td16`/`td24`/`td32` over
  `assets/kenney-tower-defense/tilesheet-16/24/32.png`, grid frames by tile index): grass `157`,
  road `158`, plots `64`; towers (`226`, `206`, firing `203`/`205`) turned toward their target
  (`turnToFacing`) with a pop-in; raiders (`247`, 32-px tiles) turned along the road, a white hit
  flash on `hit` and a health bar over each (a 2D `labels` bar from the kit's `hp:` tag, max 3);
  shots (`274`, `251`) with sparks, impacts on `td-shot`, smoke and shake on `td-kill`, hit-pause
  on the ballista; the ghost tower shows its **range** (`ring`: 40 px for the archers' 2 cells,
  56 px for the ballista's 3) and turns red where it cannot be built (`hitFlash` on `blocked`). The
  gate and the camp keep `defence.txt`'s frames; the HUD is two dark panels (top: title, gold,
  lives, raiders, wave; bottom: the tower and its cost).
- **Sound**: the rounds' event sounds as before (`sword`, `burn`, `hurt`, `fail`; `place`,
  `coins`, `refused`, `launch`, `arrow`, `bolt`, `leak`), and the music's third layer,
  `content/songs/siege-round.json` (a driving pulse, triangle and drums in the same six bars),
  up while a round's frames show (`three.json`'s `music.siege` rule on `miniGame`), with the danger
  layer under it.
- **Parts C and E are not on this branch**: these skins were brought to their bar with the packs
  their roadmap entries name and the engine's part A features (owner item). When The Old Crypt
  and The Winding Road merge, re-point the rounds at their skins and art (copied into this
  game's `assets/` with credits: games never import a sibling) and drop what they replace here.
  The old NES-style round frames in `camp.txt` and `defence.txt` (and the `defence-*` palettes)
  are kept, unused but the engines', gate's and camp's, until then.

`play.test.ts` checks the round skins (the 2D layer's rounds, their packs' sheets, the features
above); `tests/browser/mini-siege-page.test.ts` plays each round from the 3D page (keys and taps)
and checks the layer shows and hides with the transition; `tests/browser/mini-siege-shots.test.ts`
shoots the rooms and the walls in 2D and in 3D (`--backend three`), each byte-repeatable.

## The whole campaign in 3D (Engine 0.16 F9)

- `tests/browser/mini-siege-page.test.ts` plays the 3D page from the title (`&title=show`) through
  the siege along both captain fates (Delegate; Play then Backspace), each results screen's
  texts (the record, losses, people, buildings, the save code, nothing cut), Continue, the dawn
  (the captive choices when the captain was taken) to its results, the stored save, and the
  captured siege's save code in a fresh page's link (`?code=`; a bad code leaves the siege),
  with no page errors. `tests/browser/mini-siege-shots.test.ts` shoots the campaign through
  `--backend three` (the siege, the freeze, each path's end, the dawn's start and end), each
  matching the headless hashes and byte-identical twice. The run tests (presentation invariance
  and the stepped shell's) present the game as this page does (`tests/runs/three-page.ts`).
- Found while playing at 1080p and fixed (gaps M39-M44 in `docs/reports/mini-siege.md`): the
  results' columns (the engine's `resultsScreen`), the title over the HUD, labels under the HUD's
  panels, the page's controls over the key hint, the view's corners showing the background past
  the map (`three.json`'s `scene3d.skirt`, grass matched to the tiles as drawn) and the night too
  dark to read (the 3.5 and 21 hour keys' lights raised). Presentation only: no hash moved.

## Part F's review screenshots (Engine 0.16 F10)

`docs/reports/screenshots/0.16-F/` holds nine 1920x1080 shots of the 3D page for the owner's
review (the siege at the mockup's angle, the title, the briefing, the walls' card, the fortify
round, the sabotage room, the siege at 17:50, the results, the dawn), each listed in
`docs/BUILD-LOG.md`, "Engine 0.16 part F", where the first sits beside the mockup. They were taken
on the page's step hook and `wwSiege` hooks (seed 11) over `tests/browser/serve.ts`'s build, so a
change to the skins or the page makes them stale: retake them when the look changes, and only
PNGs go in that folder (`tests/architecture/no-content.test.ts`). The page test's
`WW_SHOTS_DIR=<dir>` shoots the same screens at 640x520. No hash moved in part F.

## Asset packs (Engine 0.16 part F, F1)

`assets/` is the one place binary files may live (docs/DESIGN.md, item 322): five CC0 low-poly
packs for the siege map in 3D (part F; the mockup `docs/reports/mockups/mini-siege-3d.png`), each a
folder credited in `assets/CREDITS.md` (`## <pack>` with source URL, author, licence, use, files
kept and what was changed; checked by `validate`), 221 GLB models, about 8.7 MB in all:

- `kenney-castle-kit` (Kenney, Castle Kit 2.0, 68 GLBs, 1.4 MB): walls, towers, gates, drawbridge,
  flags and the siege engines (ram, catapult, ballista, tower, trebuchet), each also burnt
  (`*-demolished`). Its colormap texture was baked into vertex colours (the model check refuses a
  texture in another file).
- `kenney-nature-kit` (Kenney, Nature Kit 2.1, 129 GLBs, 1.3 MB): trees, rocks, river and path
  ground tiles, the wooden bridge, fences, tents, campfires, crops. Unchanged.
- `quaternius-medieval-village` (Quaternius, Medieval Village Pack 2020, 19 GLBs, 2.8 MB): the hall
  (`inn`), houses, windmill (`mill`), smithy, well, market stands and yard props, converted from
  OBJ.
- `quaternius-characters` (Quaternius, Ultimate Animated Character Pack 2019, 4 GLBs, 3.1 MB):
  `knight-male` (soldiers), `knight-golden-male` (Captain Hale), `viking-male` (raiders, guards),
  `worker-male` (workers); clips `Idle`, `Walk`, `Walk_Carry`, `PickUp`, `Punch` (attack),
  `RecieveHit`, `Defeat` (the nearest to a death), `Victory`. Converted from FBX.
- `quaternius-farm-animals` (Quaternius, Farm Animals, 1 GLB, 0.2 MB): `sheep` (`Idle`, `Jump`),
  converted from FBX.

The named packs have no people or sheep, hence the last two (owner item 534 in `docs/BUILD-LOG.md`,
Engine 0.16 part F, which also covers the 2020 village pack and the clips). Since F8 two 2D packs
draw the hosted rounds: `dungeon-tileset-ii` (0x72, DungeonTileset II 1.7, one 512x512 PNG) and
`kenney-tower-defense` (Kenney, Tower Defense top-down, its tile sheet scaled to 16, 24 and 32 px
tiles; `license.txt`). Since F6 a sixth
folder, `mini-siege-marks`, holds the game's own models (the offer gem, the raiders' banner), made
by `tools/mark-models.ts` as embedded `.gltf` text. The `three` skins use them (above):
`assets.test.ts` checks the credits, that every model is self-contained with no texture, that
`ModelLibrary` (`engine/backends/three`) parses each one in Node, with the characters' and the
sheep's clips listed, and that the marks are what the script writes. Keep only files the game uses; a new pack gets a folder,
a `CREDITS.md` section and a line here.

## How to test

`pnpm test games/samples/mini-siege` (`assets.test.ts` the packs, `three.test.ts` the 3D map), `pnpm -s cli validate games/samples/mini-siege --json`,
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

## Title screen, pause menu and settings (Engine 0.16 T9)

`game.json`'s `menus` block (the shell's menus, `engine/core/shell/CLAUDE.md`; schema in
`engine/core/ui/menus.ts`): the title "The Mini Siege" in `siege-title` over the game's own
picture at its start (dimmed 0.35 since Engine 0.16 F7), the subtitle "Burn the siege engines before dawn" (the pixel art went in F7: the village shows behind it),
the song `siege`, a footer and the items start, continue, controls, settings; the pause menu
(resume, controls, settings, title); settings (master, music, sfx, mute, shake, flashing); and the controls screen's
rows (Select, command; Move (rounds); Strike (rounds); Build (walls); Give up a round), shown with the player's keys. Colours (Engine 0.16 F7, the 3D HUD's): dark brown panels `#1a140c`, focus bar `#6c4a1c`,
borders `#c8a060`, headings `#f0c060`. Fonts: `content/fonts/siege-small.txt` (the menu font: the fx lab's small font, original 5 px glyphs with A-Z, a-z, 0-9, punctuation and, for key names, the four arrows) and `siege-title.txt` (its title font: the small glyphs made bold and doubled with Scale2x, cell 12x18), made by a small generator; edit them by hand now. Claimed as `font` in `game.json`. The `ui-move`, `ui-select` and `ui-back` sfx are the menus' sounds.

`main.ts` passes `menus: { spec: content.manifest.menus, fonts, sheets }` to `bootBrowserGame`
and the fonts to the display. Back to title reloads the page (`restart: 'reload'`: its bar and `window` hook hold the first scene). Continue shows when this browser kept a campaign save (`launch.storedSave()`) and carries on from it (the bar's Carry on). `index.html` hides the page's bar on the title (`body[data-menu='title']`) and the briefing and result panels on the title and the pause menu. The page opens on the title (the game waits
at tick 0 under it); Escape, P, gamepad Start or the `II` button pause (the ticks are held).
`?debug=step` and `?record` skip the title, so run files, replays and the older browser tests
are unchanged; `?debug=step&title=show` shows it. Tested in `tests/browser/menus.test.ts` (title,
start, pause, settings and controls by keyboard and touch, settings kept across a reload;
`WW_SHOTS_DIR=<folder>` keeps `menus-<game>-*.png`), tuned from those screenshots at page scale.

## Imports

- Allowed: relative paths inside this folder, `@engine/core/*`, `@engine/sim/*` (the glue
  builds the world and its mission port), `@engine/backends/*`, `@kits/rts`, `@kits/topdown` and
  `@kits/towerdefense`.
- Never: other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.

## 2D backend choice

`?backend=pixi` draws the page through the PixiJS (WebGL) backend (`@engine/backends/pixi`, loaded
with a dynamic `import()`, its own chunk) and falls back to Canvas2D where WebGL is missing;
`?backend=canvas2d` keeps Canvas2D (Engine 0.16 T13b-4). Since Engine 0.16 F7 no query opens the
page in 3D, and Canvas2D is the 2D page where WebGL 2 is missing.
