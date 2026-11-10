# games/samples/mini-siege

Folder: `games/samples/mini-siege`. Detailed rules: [`games/samples/mini-siege/CLAUDE.md`](../../games/samples/mini-siege/CLAUDE.md).

## Purpose

The multi-genre sample (Engine 0.11): an RTS map with a village under attack and a watchtower
going up, and one top-down mission, burning the raiders' siege engines, that is played or
delegated. While the mission is open the battle is frozen and the watchtower keeps going up; the
result commits at the open tick plus the mission's fixed world-time cost and changes the battle
(engines destroyed or damaged, the captain hurt). It joins `engine/sim`, `kits/rts`,
`kits/topdown` (the data-driven `mission-room`) and `engine/core`'s `MissionHost`, and holds only
content and thin glue. It has original NES-style art (text sprite files and palettes), a skin for
the battle and one for the mission room, sounds and one short original MML song, and a page
(`index.html`) where the mission is launched, then played or delegated. Gaps found:
`docs/reports/mini-siege.md`.

Since Engine 0.12 T7 it also has a **preparation phase** before the raid: the `fortify` mission
("Man the walls"), offered from world tick 5 to 30, a tower-defense round (`kits/towerdefense`,
its data-driven `td-defence`) on the village's real walls (four wall entities on the map's build
cells) paid with the hall's real gold against the four real raiders, played or delegated. The
siege is frozen while it is open (30 world ticks); at the commit the matching outcome's effects
write the gold spent and the losses back to the world (gold, walls destroyed or damaged, defenders
hurt, raiders destroyed). It is the platform test: no `engine/sim` change; lessons in
`docs/reports/tower-defense.md`. Since Engine 0.12 T8 the page offers it too: the bar's
`Launch: Man the walls` button (one launch button per offered mission, from the RTS kit's
`missionButtons`), the same Play-or-Delegate choice, and while the round is played the picture is
the walls' round in its own skin (`canvas2d-td-defence.json`, picked by `skinSet` from the mini
game id), keys or pointer taps placing towers.

Since Engine 0.13 T7 it is a **campaign of two scenarios** (`content/campaigns/siege.campaign.json`):
the siege (`village`, 260 world ticks), then **the dawn assault** (`dawn`, 200 world ticks), a
second RTS map whose `from` carries the captain's fate and hp and the hall's gold from the siege's
end world. The sabotage's round now takes its hero from the captain (gap M13), and its
`driven-off` outcome captures him: in the dawn he is then off the map, held by the raiders, and
three captive choices open at once (one exclusive group): **rescue** (`rescue-captain`, a
`mission-room` round in its own room, the raiders' stockade (Engine 0.15 T11, gap M32), with the sergeant Mara Venn as the hero; a failure injures her and
opens a dearer **ransom**, never the rescue again), **exchange** (`exchange-captain`, 80 gold, a
choice with no round) and **leave** (`leave-captain`, no effects). With the captain home the dawn
assault is beaten; without him the village falls. A run file starts the dawn from a siege run's end
or from its save code (`from`), and the siege's runs pin their save codes (`codes`). Since T8 the
page plays the campaign: the siege ends at world tick 260 with a result panel (the outcome, the
captain's fate) and its save code, also kept in browser storage; Continue plays the dawn (the
captive choices in the bar when he was taken, a choice without a round offered as Decide, the
HUD's captive marker); a save code typed into the bar resumes it (a refused code shows its
reason), and Carry on picks up the save this browser kept (`CampaignSession` in
`engine/core/shell`).

## Public API entry points

- `game.json`: kit `rts`, uses `topdown` and `towerdefense`, seed 11, `headless.ts`, `view.ts`.
- Art and sound: `content/sprites/` (`siege.txt`, `camp.txt`, `siege-font.txt`, `defence.txt`
  for the walls' round), `content/palettes/` (`siege`, `siege-held` for the frozen siege, `camp`
  at night, `defence-ok` / `defence-blocked` for the ghost tower, `defence-hit` for a struck
  raider), `content/skins/canvas2d.json` (the battle, looks by tag `damaged`, `site`, `frozen`;
  commit sounds per outcome, the dawn's included; Engine 0.13 T8: the sergeant's look by tag
  `hero` and the HUD's captive marker), `canvas2d-mission-room.json` (the room, looks by tag `foe:ram`,
  `foe:catapult`) and `canvas2d-td-defence.json` (the walls' round: towers, raiders, shots,
  cursor, ghost, tiles, `td-*` sounds), `content/sfx/`, `content/songs/siege.json`.
- `assets/` (Engine 0.16 part F, F1): five CC0 low-poly packs as GLB files, each credited in
  `assets/CREDITS.md` (source URL, author, licence, files kept, changes; checked by `validate`),
  221 models, about 8.7 MB in all: `kenney-castle-kit` (Kenney, 2.0: walls, towers, gates, flags,
  the siege engines whole and burnt; its colormap baked into vertex colours),
  `kenney-nature-kit` (Kenney, 2.1: trees, rocks, river and path tiles, bridge, fences, tents,
  campfires, crops), `quaternius-medieval-village` (Quaternius, 2020: hall, houses, windmill,
  smithy, well, market props; from OBJ), `quaternius-characters` (Quaternius, Ultimate Animated
  Character Pack: knights, a viking raider, a worker; clips `Idle`, `Walk`, `Punch`, `Defeat` and
  more; from FBX) and `quaternius-farm-animals` (Quaternius: the sheep; from FBX). The last two
  stand in for the people and sheep the named packs lack (owner items). For the 3D siege map
  (part F, F6); `assets.test.ts` parses every GLB with `ModelLibrary` in Node and lists its clips.
- `picture.ts`: `siegeLook`, `siegeFrames` / `siegePicture` / `siegeCanvasPicture` (the battle's
  frames or the hosted round's through the core's `hostedSource` and the host's `roundFrame()`,
  with the host's `mission-open`, `mini-game-end` and `mission-commit` events; Engine 0.15 T6,
  gaps M6, M21 and D9).
- `view.ts`: `createView` (`render`, `frame()`, `order`, `mission`) for `pnpm cli screenshot`.
- `play.ts`: `SiegePlay`, since Engine 0.15 T10 (gaps M26, M34, M36, lesson D14) the engine's
  `MissionLaunch` (`launch`: launch buttons, play or delegate, the round, every campaign entry held
  at tick 0 until Begin, its end, the result, Continue, a save code, the stored save) handed only
  the mini siege's parts: `createGame`, the kit's `missionButtons`, the battle at 10 ticks a second,
  the pointer's orders through `RtsControls` and a fresh `RtsCamera` per entry, and the entry's
  summary (people and verdict); `main.ts` and `index.html`: the boot (pointer, shell audio and its
  volume control), the shell's `mountMissionBar` (the bar, the briefing, the result panel) and
  `window.wwSiege` (with `held()`). No launch, panel, save code or hint logic of its own.
- `content/`: `maps/village.world.json` (`rts-map`, with the walls and the `fortify-window` and
  `sabotage-window` opportunities), `maps/dawn.world.json` (the follow-up: its `from`, the
  captive choices' four `relative` opportunities), `campaigns/siege.campaign.json` (`village`
  then `dawn`), `missions/rescue-captain.mission.json`, `exchange-captain`, `ransom-captain`,
  `leave-captain`, `types/siege.json` (with `wall` and `wall-tower`),
  `enemy/raiders.json`, `missions/sabotage.mission.json` (outcomes, weights, effects, `onQuit`,
  cost 120, the `mission-room` params), `rooms/engine-camp.json` + `.map.txt` (the sabotage's
  room) and `rooms/stockade.json` + `.map.txt` (the rescue's, Engine 0.15 T11), two separate
  mission rooms (`game.json`'s `kitOptions.topdown.rooms` `"separate"`, gap G17),
  `missions/fortify.mission.json` (cost 30, the `td-defence` params: walls, budget, wave and
  rules; outcomes `held-cheap`, `held`, `held-bloodied`, `overrun` with their effects and weights)
  and `defence/` (the walls' `td-map`, `td-towers` `archers` and `ballista`, the map's `td-waves`).
- `headless.ts`: `createGame(content, seed, opts?)` (a `MiniSiegeGame`: since Engine 0.15 T6 a
  `MissionHost` itself (it extends it, gap M18) over the kit's `rtsGame` on the sim's
  `rtsWorldPort` (gap M27), with the kit's `rtsMissionHooks` (`open` refused `not_offered`, the
  view refreshed); the sim world is `sim`; snapshot `{ world, kit, missions?,
sides }` (`named()` for the page, not hashed, since Engine 0.15 T9); Engine 0.13: `opts.campaign` starts it at a campaign save, `campaignSave()`
  gives the save if the entry played now ended now; Engine 0.14 T7: `worldEvents(sinceTick)` and
  `timeline()`, the world's event log and timeline record, for `pnpm cli events` and `timeline`), `siegeCampaignPlace`, `miniGames(content)`
  (`mission-room` and `td-defence`), `ADAPTERS`, `createWorld`.
- `content.ts`: `loadMiniSiege`, `siegeMap(content, name?)`, `siegeCampaign`, `FIRST_SCENARIO`, `siegeTypes`, `siegeEnemy`, `siegeMissions`,
  `siegeRooms`, `siegeDefenceMaps`, `siegeTowers`, `siegeScenario`.
- `runs/played.run.json` (a recorded round burns both engines; since Engine 0.14 T9 its round is
  recorded with `pnpm -s cli record runs/played.run.json --mission sabotage --bot '{"engine-camp":
[{"do": "fight"}]}'`, or played on the page with `?record` and written with `--input`, no
  script), `delegated.run.json` (the world
  draws `ram-burnt`), `quit.run.json` (the round quit: `driven-off`), `fortify-played.run.json`
  (the preparation phase: a recorded tower-defense round holds for 40 gold, `held-cheap`) and
  `fortify-delegated.run.json` (the world draws `overrun`), each with sync `hashes` and golden
  `<name>.hashes.json`. Engine 0.13 T7, the dawn: `dawn-held.run.json` (from `played`, the
  captain home) and `dawn-captured.run.json` (from `quit`, the captain taken), the same in all but
  `from`; `dawn-code.run.json` (from `quit`'s save code: the same hashes as `dawn-captured`);
  `dawn-fresh.run.json` (Engine 0.14, gap G9: `start: { "entry": "dawn" }`, the dawn fresh with
  no carried record; `headless.ts` exports `starts(content)`, the campaign's entries);
  `dawn-rescue` (delegated), `dawn-rescue-played` (Engine 0.15 T11: the rescue played in the
  stockade and won, recorded with `--bot '{"stockade": [{"do": "fight"}]}'`),
  `dawn-rescue-failed` (the round given up: the ransom opens, the rescue is
  refused), `dawn-exchange` and `dawn-leave`. Engine 0.14 T12, the ridge camp (Engine 0.14's Done
  when: a scenario added with **data files only**): `content/maps/ridge.world.json`, the
  delegated-only `stores-raid` mission, the campaign's third entry `ridge` and
  `ridge-raid.run.json` (`start: { "entry": "ridge" }`; the raid draws `ram-burnt` at world 30),
  stepped and rewound in the debugger by `tests/browser/debugger-done-when.test.ts`.
- Engine 0.15 T7: the run files check the world by scenario key (`world.key.<key>...`,
  `world.one.Missions...`; no `named.` or positional component path is read), the host's
  `records()` and `worldKeys()` come from the sim's port, and the walls' `td-map` has no wave list
  (only `fortify` plays it; lesson D8).
- Engine 0.15 T8: `fortify`'s effects read the round's report (the gold `spent`, the `killed`
  raiders, the `fallen` walls, with declared limits; lessons D3, D4), the siege's campaign entry
  ends the campaign when the hall is gone (`endIf`, gap M31), `campaignSave()` and the page use
  the engine's `entryOver` (gap M35), and the pinned save codes are version 2 (gap M38;
  `dawn-code` keeps a v1 code, still read). The fortify runs' hashes moved once.
- Engine 0.16 F4: the campaign gives each entry a world clock (the siege from day 2, 14:00; the
  dawn assault day 3, 05:30; the ridge camp day 3, 10:00; 60 ticks an hour, so the sabotage's 120
  ticks are two hours) and every frame carries it (`MiniSiegeGame.clock()`, `hostedSource`'s
  `status`: `clock.day`, `clock.time`, `clock.text`, `clock.phase`, `clock.fraction`). No hash
  or save code moved; the 3D skin and HUD that show it are part F's later tasks.

## Imports allowed

- Relative paths inside the folder, `@engine/core/*`, `@engine/sim/*`, `@engine/backends/*`,
  `@kits/rts`, `@kits/topdown` and `@kits/towerdefense`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/mini-siege` (`assets.test.ts` the CC0 packs), `pnpm -s cli validate games/samples/mini-siege --json`,
`pnpm -s cli run games/samples/mini-siege/runs/played.run.json --json` (and `delegated`,
`quit`, `fortify-played`, `fortify-delegated`, the `dawn-*` runs), `pnpm -s cli code
games/samples/mini-siege/runs/quit.run.json` (the save code at the siege's end), `pnpm -s cli mutants games/samples/mini-siege --json`, `pnpm test tests/runs`,
`pnpm -s cli screenshot games/samples/mini-siege/runs/played.run.json --tick 200 --json` (the
room; `delegated.run.json --tick 80` the frozen battle; `fortify-played.run.json --tick 90` the
walls' round; `dawn-captured.run.json --tick 10` the dawn with the captain held),
`tests/browser/mini-siege-shots.test.ts`; the page played from its link, both missions on both
paths (and the walls' round by taps), and the campaign along both captain fates and from a save
code: `tests/browser/mini-siege-page.test.ts`; the ridge camp in the debugger, and a failing
copy's replay opened at its failing tick: `tests/browser/debugger-done-when.test.ts`.
To play: `pnpm dev`, then `games/samples/mini-siege/` from the launcher.

## 2D backend choice

`?backend=pixi` draws the page through the PixiJS (WebGL) backend (`@engine/backends/pixi`, loaded
with a dynamic `import()`, its own chunk) and falls back to Canvas2D where WebGL is missing;
`?backend=canvas2d` or no query keeps Canvas2D, the default (Engine 0.16 T13b-4).
