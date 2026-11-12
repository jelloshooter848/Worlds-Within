# games/samples/rts-skirmish

Folder: `games/samples/rts-skirmish`. Detailed rules: [`games/samples/rts-skirmish/CLAUDE.md`](../../games/samples/rts-skirmish/CLAUDE.md).

## Purpose

The first RTS sample (Engine 0.9) and the first folder under `games/samples/`, **The River Ford**
(finished in Engine 0.15 T14; docs/BUILD-LOG.md, Engine 0.15, decision 13). From Engine 0.16 part
D it is the full skirmish: on a CC0 pack, Kenney's Medieval RTS (D7: `assets/kenney-medieval-rts/`,
credited in `assets/CREDITS.md`), at 16:9 (480x270, 4x is 1920x1080), and since D8 **one map
for a match against an AI base across the river**: a 64x40 map (point-symmetric, a river down
columns 31-32 with three fords), red (three workers, a town centre, the hero Wren) against blue,
an AI opponent written as data (`content/enemy/blue.json`, the kit's skirmish plan with knowledge
`fog`: it gathers, builds a barracks, trains soldiers and archers, scouts until it finds red,
answers what it sees and sends waves at red's base a few minutes apart, then a final push), and
the end as data (`content/end/ford.json`: win by razing blue's town centre; lose your town centre
or every unit). The page plays it with fog of war, a clickable minimap, order markers, path dots,
barks (a sfx per unit type and a short line in the HUD), build and train progress in the world,
and an end screen with the match's stats. It holds only content and thin glue, and its
`CLAUDE.md` is the worked example of an RTS game on the kit. The 0.15 battle (the 40x24 map, the
raiding party, its five run files) lives on unchanged as `games/rts-classic` (D2). **D9** balanced
the match to about ten minutes (data only: the AI's three waves and final push, a sturdier and
priced town centre, more gold on the far nodes), recorded a win and a loss (`match-won`,
`match-lost`, ~6000 ticks), and added the feel: layered music with a danger layer while seen
enemies are near the player's buildings, a varied sound for every event, the selected-unit panel
and the camera's edge scroll and zoom.

## Public API entry points

- `game.json`: kit `rts`, 480x270, seed 9, `headless.ts`, `view.ts`; content kinds `rts-map`,
  `rts-types`, `rts-enemy`, `rts-end` (D8), `rts-names` (polish Q, D2), `rts-decor` (polish Q, Q6), `palette`, `sprite`, `skin`, `sfx`, `song`, `font`;
  the title "The River Ford" ("Take the far bank of the river") and the controls screen's rows
  (with Jump: the minimap).
- `assets/kenney-medieval-rts/` (D7): the pack's sheet and atlas, `license.txt`, and
  `ford-tiles.png` made by `tools/ford-tiles.ts` (polish Q, Q6: with the scenery's frames, the
  pack's trees, bushes, stumps, logs and rocks, pebbles, dirt, round grass patches, tufts,
  flowers, mushrooms and bank reeds); `assets/CREDITS.md`.
- `content/`: `maps/ford.world.json` (`rts-map`, D8), `types/skirmish.json` (`rts-types`:
  worker, soldier, archer, hero; town centre, barracks; buildings with `sight`),
  `enemy/blue.json` (`rts-enemy`, knowledge `fog`), `end/ford.json` (`rts-end`),
  `names/skirmish.json` (`rts-names`, polish Q, D2: the HUD's display names, "Town Centre",
  "Worker" and the rest, `skirmishNames`, presentation only; the panel's `selectedName` and the
  training line's `trainingName`), `maps/ford.decor.txt` (`rts-decor`, polish Q, Q6: the map's
  scenery, 64x40, trees, pines, bushes, stumps, rocks, boulders, pebbles, flowers, mushrooms,
  tufts, dirt, darker and lighter grass and bank reeds; `skirmishDecor`, passed to
  `presentWorld` as `decor`, drawn by the skin's `tiles`; presentation only, never on the
  minimap; roads, fords, gold, buildings, building sites and starting cells kept clear,
  `decor.test.ts`),
  `sprites/skirmish.txt` and `skirmish-font.txt`, `palettes/skirmish.json`, `skins/canvas2d.json`
  (images `rts` and `ford`; every kind the kit presents, archers too; `fog`; `events` with the
  barks `bark:unitType=<type>`; the HUD: counters, a 128x80 minimap with fog and team dots, the
  bark lines (`text` items `when: { status: "bark", eq: <order> }`) and the banners),
  `sfx/*.json` (fifteen: the battle's nine, four barks, and from D9 `crumble` and `alarm`) and
  `songs/ford.json` with (D9) its danger layer `songs/ford-danger.json`; the skin's `music`
  (`ford`: calm and danger, mixed on `enemyNear`) and the selected-unit panel (D9).
- `headless.ts`: `createGame(content, seed, opts?)` (a `SkirmishGame`: the kit's `rtsGame` on the
  sim's `rtsWorldPort(world)`, taking recorded orders and interface actions; snapshot `{ world,
kit, sides, ui }`, the kit part with the AI's memory `seen`; `view()`, `result()`,
  `worldEvents`, `timeline`, `worldKeys`), `createWorld`, `sidesOf`, `skirmishResult(view, end)`
  (the kit's `matchResult` under the end rule; kept out of the snapshot); D9:
  `SkirmishGame.recorded()` (`RecordedEntry`), the recorded orders with the interface actions in
  their place, which the page exports.
- `actions.ts`: interface actions (`click`, `box`, `command`, `build`, `train`, `stop`).
- `picture.ts`: `skirmishLook`, `sideKinds`, `heardEvents` (an unseen side's events left out),
  `SkirmishPresentState`, `SkirmishFrameOptions` (`ui`, `fog` default on, `feedback`),
  `skirmishFrames`, `skirmishPicture`, `skirmishCanvasPicture(r, look, opts?, onSound?)`,
  `BARK_TICKS`.
- `play.ts` (`SkirmishPlay`: camera, controls, buttons, the minimap's taps
  (`minimapPoint`), order feedback to the picture, `result()`, `stats()` (`MatchStats`),
  `TICKS_PER_SECOND` 10; `stepsPerTick` 1 in manual-loop mode, D9), `main.ts` + `index.html` (the
  page; `window.wwSkirmish` with `minimapClientAt` and `stats`; D9: the layered music, the scene's
  `headless()` for the step hook, the pointer's edge scroll and wheel), `recording.ts`
  (`BattleRecorder`), `view.ts` (`createView`; D10: the run's selection drawn, interface
  commands' markers and barks, and `directorCamera`, which frames the fight, else the selection,
  else the player's units, zoomed out to fit, for `pnpm cli screenshot`).
- `runs/` (D8): `opening`, `ai-barracks`, `fog` and `razed`, each with sync `hashes` and golden
  `<name>.hashes.json`; together they guard all six kit rules with no run weak
  (`tests/runs/rts-skirmish-mutants.test.ts`). D9: `match-won` (5900 ticks, blue's town centre
  down at 5803) and `match-lost` (5700, red's taken at 5681), hashes every 100, opening with
  interface actions that fail every kit rule by tick 2; the presentation tests play their first
  600 ticks (`tests/runs/view-play.ts`, `presentedRun`). Polish Q (Q7): `big-fight` (1800 ticks,
  hashes every 100), `match-won`'s opening then both armies fighting on blue's bank, for the
  review's zoomed-out big-fight shot (tick 1763).

## Imports allowed

- Relative paths inside the folder, `@engine/core/*`, `@engine/sim/*`, `@engine/backends/*` and
  `@kits/rts`.
- Never other games or kits. Nothing in `engine/` or `kits/` imports from here.

## How to test

`pnpm test games/samples/rts-skirmish` (`skirmish.test.ts`: the map, the AI and end rule, the art,
sound, barks and the end, and every run's golden hashes with the page's fog drawn on and off;
`play.test.ts`: the page's scene; `decor.test.ts`: the scenery's rules; `assets.test.ts`), `pnpm -s cli validate
games/samples/rts-skirmish --json`, `pnpm -s cli run games/samples/rts-skirmish/runs/fog.run.json
--json` (any run file), `pnpm -s cli mutants games/samples/rts-skirmish --json` (no rule
unguarded, no run weak), `pnpm test tests/runs` (golden hashes, backend parity, fog on and off),
`pnpm -s cli screenshot games/samples/rts-skirmish/runs/fog.run.json --tick 444 --json`,
`pnpm vitest run tests/browser/rts-skirmish.test.ts` (from the games index and the title, the
opening by mouse and touch in headless Chromium, the minimap click, its export replayed; D9: the
whole `match-won` replayed through the step hook to the end screen with the golden hashes, its
export replayed headless), `pnpm vitest run tests/browser/pixi-parity.test.ts` (the fog run and,
D9, `match-won` at 1920 and 1940 on Canvas2D and PixiJS, strict bound).

## 2D backend choice

The page draws through the PixiJS (WebGL) backend by default (`default2d: 'pixi'` in `main.ts`,
Engine 0.16 T13b-8; `@engine/backends/pixi`, loaded with a dynamic `import()`, its own chunk) and
falls back to Canvas2D where WebGL is missing (`body[data-backend]` says which runs; software
WebGL, such as headless Chromium's SwiftShader, counts as WebGL). `?backend=canvas2d` forces
Canvas2D (exact Canvas2D output, a machine whose WebGL misbehaves); `?backend=pixi` names the
default. `pnpm cli screenshot` and the run files' backend parity still draw through Canvas2D
(`view.ts`). Tested in `tests/browser/pixi-pages.test.ts` (the default, the fallback with WebGL
taken away, `?backend=canvas2d`); the page and menus browser tests play on PixiJS.
