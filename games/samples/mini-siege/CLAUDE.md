# games/samples/mini-siege

The mini siege (Engine 0.11, `docs/ROADMAP.md`, "0.11 The mini siege (multi-genre sample)"): an
RTS map with a village under attack and a watchtower going up, and one top-down mission,
**sabotaging the raiders' siege engines** (owner answer 23), that the player can play or delegate.
It joins the world simulation (`engine/sim`), the RTS kit (`kits/rts`), the top-down kit
(`kits/topdown`, its data-driven `mission-room`) and the mission contract (`engine/core`'s
`MissionHost`). The shape is decision 11 and the checks decision 12 of `docs/BUILD-LOG.md`,
Engine 0.11. Since T8 it plays headless (`pnpm cli run`); since T9 it has original NES-style art,
two skins, sounds and one song, a view for `pnpm cli screenshot`, and a page (`index.html`,
launcher link `games/samples/mini-siege/`) where the mission is launched and then played or
delegated. Every gap found is logged in `docs/reports/mini-siege.md` (ids `M1`, `M2`, ...).

## The rule

Content, skins and thin glue only (DESIGN.md: if two games could use it, it is engine; if it is
content, it is the game). The battle is the sim's, the raiders' plan and the mission are data, the
round and the mapping from its report to an outcome are the top-down kit's (`missionRoom`,
`topdownMissionAdapter`), the hosting is `MissionHost`. Never put map rows, stats, plan steps,
room rows, outcome rules or pixel rows in `.ts` files (`tests/architecture/no-content.test.ts`).
Anything the glue would write the same way in another game goes to the engine or a kit, or into
the gap report with a named release.

## Files

- `game.json`: kit `rts`, `uses` `topdown` (the mission's room), seed 11, 256x240,
  `headless.ts`, `view.ts`; content kinds `rts-map`, `rts-types`, `rts-enemy`, `mission`, `room`,
  `palette`, `sprite`, `skin`, `sfx`, `song`. `index.html` is its page: the launcher lists it and
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
  workers are not. One opportunity, `sabotage-window`, offers `sabotage` from tick 20 to 200.
- `content/types/siege.json` (`rts-types`): `worker`, `soldier` (50 hp, hits 6), `captain`
  (120 hp, hits 10), `raider` (30 hp, hits 4), `ram` (120 hp, hits 12, slow), `catapult` (100 hp,
  hits 10 at range 3, slow); `hall` (400 hp) and `watchtower` (200 hp, 480 work). Every unit in
  the map carries its type's numbers (`mini-siege.test.ts` checks it).
- `content/enemy/raiders.json` (`rts-enemy`): every 20 ticks from tick 0, `batter` (the ram) and
  `bombard` (the catapult) attack the nearest building, `charge` (the raiders) the nearest
  village unit.
- `content/missions/sabotage.mission.json` (`mission`): "Burn the siege engines", event
  `siege`, `worldTimeCost` 120, `play` `mission-room`, `onQuit` `driven-off`. Outcomes (weight,
  effects): `both-burnt` (1: destroy `ram` and `catapult`), `ram-burnt` (2: destroy `ram`,
  damage `catapult` 40), `catapult-burnt` (1: destroy `catapult`, damage `ram` 40),
  `driven-off` (2: damage `captain` 30). Its `params` (checked by `validate` through the kit's
  schema and `checkUse`): room `engine-camp`, goal `defeat-all`, 1500 ticks, 6 half hearts; the
  engines (raiders of type `ram` or `catapult`) as knights in the `E` cells with one room hp per
  40 world hp, the guards (raiders with squad role `regular`) as knights in the `n` cells; rules
  in order: both destroyed, the ram, the catapult, else driven off.
- `content/rooms/engine-camp.json` + `.map.txt` (`room`): the raiders' camp at night, one 16x11
  room with the hero's `@`, two `E` and two `n` slots.
- Art, all original text (T9; generated once from a throwaway script, then kept as text):
  - `content/sprites/siege.txt` (palette `content/palettes/siege.json`): tiles `grass`, `road`,
    `rock`; `worker`, `soldier`, `captain` (gold helmet and trim) and `raider` in three facings
    (`down`, `up`, `right`; the skin mirrors right for left) with two steps; the `ram` and the
    `catapult` from the side, two frames each, whole (`ram-0`) and burnt (`ram-burnt-0`, charred
    with flames); `hall` (48x48), `watchtower` (32x32) and its scaffold `site-2x2`; `gold`,
    `gold-empty`, `ring`, the bars `hp-0`..`hp-8` and `p-0`..`p-8`, `box`, the offer's torch
    `offer-0`/`offer-1`, HUD icons (`icon-gold`, `icon-units`, `icon-enemy`, `icon-time`,
    `icon-torch`) and `heart`. `content/palettes/siege-held.json` is the same palette in cold
    blues: the units and buildings of the frozen event while the mission is open.
  - `content/sprites/camp.txt` (palette `content/palettes/camp.json`, night colours, the same
    letters): the room's `wall` (a palisade) and `floor`, the hero (a villager in a blue hood:
    `hero-<down|up|side>-<0|1>`, `hero-attack-<dir>`), `sword-up`/`-down`/`-right`,
    `poof-0`..`2`, the guards (`guard-<dir>-<0|1>`, raiders with axes), the engines (`ram-0/1`,
    `catapult-0/1`), `heart` and `hourglass`.
  - `content/sprites/siege-font.txt`: an 8x8 font (digits, capitals, small letters, `'`, `,`,
    `.`, `-`, `:`), white with a black drop shadow, for the HUD's numbers and the mission title.
- Skins: `content/skins/canvas2d.json` (the battle): every kind the RTS kit presents here
  (`unit:<type>` for the six types with `idle`, `walk`, `attack`, `build`, `gather`;
  `building:hall`, `building:watchtower`, `resource:gold`, `selection-ring`, `health-bar`,
  `progress-bar`, `mission-offer`, `selection-box`), looks by tag (T4): the engines' `damaged`
  (the burnt frames: a catapult or ram the result damaged), the watchtower's `site` (the
  scaffold), and `frozen` on every unit and building (the `siege-held` palette), `damaged` listed
  before `frozen` (gap M2); tiles `0`-`2`; HUD gold, own and enemy units, the commit countdown
  (`missionLeft`), and at the bottom the offer's or open mission's title (`offer`, `mission`, as
  `text`); event sounds: `mission-open` (`launch`), `mini-game-end:pass` / `:fail` / bare (quit),
  `mission-commit:outcome=<id>` (`burn` for an outcome that burns an engine) and bare
  `mission-commit`. `content/skins/canvas2d-mission-room.json` (the round, mini game
  `mission-room`): `hero`, `sword`, `poof`, `pickup:heart` and `knight` (the guards) with looks by
  tag `foe:ram` and `foe:catapult` (the topdown kit tags each placed foe with its world name);
  tiles `#` and `.`; the camera unclamped (the room under its HUD band); HUD the host's
  `host:mission` title (G19), hearts, the time left; sounds for `sword`, `kill` (`burn`), `hurt`,
  `dying`.
- Sound: `content/sfx/` (`sword`, `hurt`, `burn`, `pass`, `fail`, `launch`, `commit`, one line of
  MML each) and `content/songs/siege.json`, one short original loop in D minor (six bars at 120
  bpm, two pulses, triangle and noise), played by the page once the first gesture unlocks sound.
- TypeScript is glue:
  - `content.ts`: `loadMiniSiege(files)`, `siegeMap`, `siegeTypes`, `siegeEnemy`,
    `siegeMissions`, `siegeRooms`, `siegeScenario(content, seed)` (the types table spawned first,
    entity 2), `PLAYER` (`village`).
  - `headless.ts`: `createWorld`, `miniGames(content)` (the kit's `missionRoom` over the rooms;
    `validate` checks the mission's params with it), `createGame(content, seed, opts?)`: the
    sim world, the kit's `rtsGame` (the plan, the switched-off rules), and a `MissionHost` with
    `missionPort(world, { refs: scenarioKeys })`, the missions and `{ 'mission-room':
topdownMissionAdapter }`, wrapped in `MiniSiegeGame`. Its `mission(step)` sends `open`
    through the kit's `launchMission` (refused `not_offered` while no opportunity offers it) and
    the rest to the host, then calls `RtsGame.refresh()` (gap M7); `order`, `step`,
    `miniGame()` and `missionExperience()` are the host's; `records()` (T9) is the world's
    committed mission records, for the page. Its snapshot is the host's (`{ world,
kit, missions? }`) plus `sides` (the kit's `sidesOf`) and `named` (every scenario key:
    `{ alive, x, y, hp }`).
  - `picture.ts`: `siegeLook(content)` (both `canvas2d` skins by `skinSet`, the sheets, size, the
    grass colour), `siegeSource` / `siegeFrames(content, ui?)`: one stream over the
    `MiniSiegeGame`: the RTS kit's `presentWorld` for `village` with the game's missions (the
    offer marker, the mission HUD) while no round is hosted, else the round's `present()` with
    `status.miniGame` `mission-room` (its map through a `MapTracker`); plus the events the sim does
    not give (gap M21), made from what changed between two frames: `mission-open`,
    `mini-game-end` (the round's `result`), `mission-commit` (`outcome`, `resolution`, read from
    `MiniSiegeGame.records()`). `siegePicture(presenter, content, ui?)`,
    `siegeCanvasPicture(r, content, look, ui?, onSound?)` (the backend's `skinSetCanvasPresenter`:
    each frame to its skin).
  - `view.ts`: `createView` for `pnpm cli screenshot` and the backend parity test: `render`,
    `frame()`, `order` and `mission` (a run file's mission steps), the camera at the map's centre.
  - `files.ts` (browser only): the data files bundled as text (`import.meta.glob`, `?raw`).
  - `play.ts`: `SiegePlay`, the page's glue without DOM or clock: the `MiniSiegeGame`, an
    `RtsCamera` starting east of the hall, the kit's `RtsControls` (pointer gestures to orders).
    `launchButtons()` (the kit's `missionButtons`, none while a choice waits or a round runs),
    `press({ kind: 'launch', mission })` (the game's `open` step, through the kit's
    `launchMission`), then `choice()` and `press({ kind: 'play' | 'delegate' })`; nothing steps
    while the choice waits. `update(input)`: the battle one world tick every `STEPS_PER_TICK` (6:
    `TICKS_PER_SECOND` 10), a hosted round one tick per loop step (60 a second, the world
    waiting). `scene(stack, picture)` is the engine's `HostScene` over it (accessors), which
    pushes the core `miniGameScene` when the round starts and pops it on its end. `records()`,
    `title(mission)`, `outcomeTitle(mission, outcome)`, `sides()`, `message` (the last refusal).
  - `main.ts`: the DOM: `bootBrowserGame` with Canvas2D (`canvasDisplay` with both skins and the
    shell's `onSound`), `pointer: true`, the touch pad left on (the round on a phone), `audio`
    (`contentSfx`, `contentSongs`, music `siege`); the bar (`#launch`, `#play`, `#delegate`,
    `#status`: the tick, the choice, the last outcome's title, the hall fallen or the raiders
    beaten, a refusal) and `window.wwSiege` (`tick`, `choice`, `playing`, `outcomes`).
- `mini-siege.test.ts`: the content, the units against their types, the params checks
  (`bad_mini_game_use` at `params.room` and `params.outcomes.0.outcome`), the launch refusals,
  orders refused while the round is hosted, and over whole runs: the battle frozen at every
  world tick of the cost and the same in all three runs before the commit, the commit at 160
  whatever the round took, the hall at the end (400 played, less delegated, least driven off),
  the played world equal to a fresh one given the same result at the open tick (decision 3), and
  the same hashes twice.
- `play.test.ts`: the page's glue on a real `SceneStack`, drawing every step into the null
  backend: launch at world tick 40, then delegate (`ram-burnt` at 160, the commit's event) or play
  (the round pushed and popped, `played.run.json`'s recorded round fed as the page's keys,
  `mini-game-end:pass`, `both-burnt` at 160); each path ends at world tick 260 with the run file's
  last state hash. A launch after the window closes is refused `not_offered`.
- Also: `tests/browser/mini-siege-shots.test.ts` (screenshots on both paths, below) and
  `tests/build/pages.test.ts` (the launcher and the build list the page).

## Entity ids

1 terrain, 2 types, 3 hall, 4-5 gold (north, south), 6 watchtower, 7-9 workers, 10-13 soldiers,
14-17 raiders, 18 ram, 19 catapult, 20 squad `defenders`, 21 the captain, 22 squad `escort`, 23-24
the guards, 25 the world-level entity (`WorldTime`, `Opportunities`, `Missions`).

## Run files

All with seed 11, the mission opened at tick 40 (the opportunity is offered from 20), committed at
world tick 160 (40 + 120), and checked until world tick 260.

| run         | ticks | what happens                                                                                                                                           | final hash         |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `played`    | 666   | played: a recorded 406-tick round (the kit's bot fighting) burns both engines (`both-burnt`); the world resumes at game tick 446; the hall ends at 400 | `25d3a40b93c9b076` |
| `delegated` | 260   | delegated at once: seed 11 draws `ram-burnt`; the catapult (60 hp) reaches the hall, which ends at 280                                                 | `0576a976323b2882` |
| `quit`      | 261   | played and quit on the round's first tick (select): `driven-off`, the captain down 30; both engines reach the hall, which ends at 112                  | `28863925b7cb91d1` |

- Game ticks are not world ticks once a round is played: during the round the world does not
  move, so in `played` world tick `w` after 40 is game tick `w + 406` (`quit`: `w + 1`).
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
- **Recording the played round:** in a throwaway script, `createGame`, step to tick 40, `open`
  and `play` without input, then each tick give the host a `ScriptedInput` holding what
  `TopDownBot({ 'engine-camp': [{ do: 'fight' }] })` holds for the round's world
  (`(game.miniGame() as RoomChallenge).world`), recording each change as `{ frame, hold }` (frame
  0 the round's first tick), until `miniGame()` is null; that list is the `play` step's `input`.
  Changing the map, the types, the room or the mission's params changes the round: re-record,
  read the new values off `dump`, copy the hashes in and run `WW_UPDATE_GOLDEN=1 pnpm test
tests/runs`.

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
- Afterwards the status line names the outcome; watch whether the hall holds. A whole game takes
  two or three minutes.

## Screenshots

`pnpm -s cli screenshot games/samples/mini-siege/runs/delegated.run.json --tick 80 --json` (the
battle held, the siege in blue), `played.run.json --tick 200` (the mission room mid-round),
`delegated.run.json --tick 200` and `played.run.json --tick 600` (the battle after each commit:
the burnt catapult, or both engines gone). The page plays the run's mission steps through the
view's `mission` (Engine 0.11 T9), so `matchesHeadless` is true and the PNG is the same every run;
`tests/browser/mini-siege-shots.test.ts` checks all four (skipped where Chromium is missing).

## How to test

`pnpm test games/samples/mini-siege`, `pnpm -s cli validate games/samples/mini-siege --json`,
`pnpm -s cli run games/samples/mini-siege/runs/played.run.json --json` (any run file),
`pnpm -s cli dump games/samples/mini-siege/runs/played.run.json --tick 566 --json` (the commit),
`pnpm -s cli mutants games/samples/mini-siege --json`, `pnpm test tests/runs` (golden hashes;
the backend parity test plays every run through the view's `frame()` and `render`), `pnpm test
games/samples/mini-siege/play.test.ts` (the page's glue), `pnpm vitest run
tests/browser/mini-siege-shots.test.ts` (the screenshots).

## Imports

- Allowed: relative paths inside this folder, `@engine/core/*`, `@engine/sim/*` (the glue
  builds the world and its mission port), `@engine/backends/*`, `@kits/rts` and `@kits/topdown`.
- Never: other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.
