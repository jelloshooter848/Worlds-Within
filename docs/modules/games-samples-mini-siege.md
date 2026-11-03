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
`docs/reports/tower-defense.md`. The page draws the walls' round from Engine 0.12 T8.

## Public API entry points

- `game.json`: kit `rts`, uses `topdown` and `towerdefense`, seed 11, `headless.ts`, `view.ts`.
- Art and sound: `content/sprites/` (`siege.txt`, `camp.txt`, `siege-font.txt`),
  `content/palettes/` (`siege`, `siege-held` for the frozen siege, `camp` at night),
  `content/skins/canvas2d.json` (the battle, looks by tag `damaged`, `site`, `frozen`) and
  `canvas2d-mission-room.json` (the room, looks by tag `foe:ram`, `foe:catapult`),
  `content/sfx/`, `content/songs/siege.json`.
- `picture.ts`: `siegeLook`, `siegeFrames` / `siegePicture` / `siegeCanvasPicture` (the battle's
  frames or the hosted round's, with `mission-open`, `mini-game-end` and `mission-commit` events).
- `view.ts`: `createView` (`render`, `frame()`, `order`, `mission`) for `pnpm cli screenshot`.
- `play.ts`: `SiegePlay` (launch button, play or delegate choice, the battle at 10 ticks a second,
  the round at 60) and its `HostScene`; `main.ts` and `index.html`: the page (`bootBrowserGame`,
  pointer, shell audio, `window.wwSiege`).
- `content/`: `maps/village.world.json` (`rts-map`, with the walls and the `fortify-window` and
  `sabotage-window` opportunities), `types/siege.json` (with `wall` and `wall-tower`),
  `enemy/raiders.json`, `missions/sabotage.mission.json` (outcomes, weights, effects, `onQuit`,
  cost 120, the `mission-room` params), `rooms/engine-camp.json` + `.map.txt`,
  `missions/fortify.mission.json` (cost 30, the `td-defence` params: walls, budget, wave and
  rules; outcomes `held-cheap`, `held`, `held-bloodied`, `overrun` with their effects and weights)
  and `defence/` (the walls' `td-map`, `td-towers` `archers` and `ballista`, the map's `td-waves`).
- `headless.ts`: `createGame(content, seed, opts?)` (a `MiniSiegeGame`: a `MissionHost` over the
  kit's `rtsGame`, `open` through the kit's `launchMission`; snapshot `{ world, kit, missions?,
sides, named }`), `miniGames(content)` (`mission-room` and `td-defence`), `ADAPTERS`,
  `createWorld`.
- `content.ts`: `loadMiniSiege`, `siegeMap`, `siegeTypes`, `siegeEnemy`, `siegeMissions`,
  `siegeRooms`, `siegeDefenceMaps`, `siegeTowers`, `siegeScenario`.
- `runs/played.run.json` (a recorded round burns both engines), `delegated.run.json` (the world
  draws `ram-burnt`), `quit.run.json` (the round quit: `driven-off`), `fortify-played.run.json`
  (the preparation phase: a recorded tower-defense round holds for 40 gold, `held-cheap`) and
  `fortify-delegated.run.json` (the world draws `overrun`), each with sync `hashes` and golden
  `<name>.hashes.json`.

## Imports allowed

- Relative paths inside the folder, `@engine/core/*`, `@engine/sim/*`, `@engine/backends/*`,
  `@kits/rts`, `@kits/topdown` and `@kits/towerdefense`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/mini-siege`, `pnpm -s cli validate games/samples/mini-siege --json`,
`pnpm -s cli run games/samples/mini-siege/runs/played.run.json --json` (and `delegated`,
`quit`, `fortify-played`, `fortify-delegated`), `pnpm -s cli mutants games/samples/mini-siege --json`, `pnpm test tests/runs`,
`pnpm -s cli screenshot games/samples/mini-siege/runs/played.run.json --tick 200 --json` (the
room; `delegated.run.json --tick 80` the frozen battle), `tests/browser/mini-siege-shots.test.ts`; the page played from its link on
both paths: `tests/browser/mini-siege-page.test.ts`.
To play: `pnpm dev`, then `games/samples/mini-siege/` from the launcher.
