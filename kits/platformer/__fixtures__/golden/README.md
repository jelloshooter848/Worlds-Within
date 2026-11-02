# Golden traces against SMBC

Test-only fixtures for `kits/platformer/golden.test.ts`. Each `<script>.trace.json` is the player's
body after every tick of one scripted input in **SMBC REMIX v0.4.73, commit `e0eeee7`**
(`/home/user/jelloshooter848/smbc`, read-only), played by SMBC's headless runner
(`src/game/sim/headless.ts` `runSim`) with its default runner (the small default character, whose
movement numbers `../runner.profile.json` copies). The test replays each script in the kit and
compares tick by tick; it reads only these files, never SMBC.

- `flat.json` + `flat.map.txt`: the test map in the kit's level format (48x15: a floor with a
  three-tile gap at cols 30-32, a wall at col 36, rows 4-12, a four-tile ceiling at cols 8-11, row 9,
  the start `@` at col 12, row 12, and a goal `G` out of reach behind the wall). It is our own map,
  not an SMBC level. Every trace file holds the same tiles as SMBC saw them (`map`); the test checks
  that `flat.map.txt` matches with `@` and `G` read as `.`.
- `<script>.trace.json`: `script`, `about`, `source` (name, version, commit), `map`, `fields`
  (`x`, `y`: the body's top-left corner in sub-pixels, 1/256 px; `vx`, `vy`: 1/4096 px per tick,
  down positive), `ticks`, `steps` (the `ScriptedInput` script, identical in both) and `trace` (one
  row of `fields` per tick, read after the tick's update).

| Script             | Ticks | Input                                                                  |
| ------------------ | ----- | ---------------------------------------------------------------------- |
| `walk-right`       | 160   | right from rest                                                        |
| `run-skid-release` | 180   | right + run to tick 59, left (skid, turn) to 79, then nothing          |
| `tap-jump`         | 120   | jump on tick 10 only                                                   |
| `hold-jump`        | 120   | jump held ticks 10-49                                                  |
| `run-jump-wall`    | 240   | right + run, jump added on tick 120: over the gap, into the wall       |
| `jump-ceiling`     | 120   | left, jump added on tick 20 under the ceiling, everything let go at 40 |

The scripts keep away from SMBC's camera (its left edge stops a player walking back past it; the
kit has no scroll lock yet) and from one-tile gaps (SMBC's runner crosses those at speed; the kit
leaves that out), so both see the same world.

## Regenerating

The generator below is kept here as text (it is not part of the repo's build). It imports SMBC by
its own path aliases, and SMBC's level index uses Vite's `import.meta.glob`, so it runs through a
small Vite module runner (`run.mjs`, below) using this repo's Vite, with SMBC as the root. Nothing is
installed in or written to the SMBC checkout (the Vite cache goes to the working directory). From
an empty working directory holding `generate.ts` and `run.mjs`:

```sh
GOLDEN_OUT=$PWD/out node run.mjs $PWD/generate.ts
npx prettier --write out/*.json   # from the Worlds Within root, then copy:
# out/<script>.json -> kits/platformer/__fixtures__/golden/<script>.trace.json
```

With SMBC at `e0eeee7` the output is byte-for-byte these files (after Prettier).

### run.mjs

```js
import {
  createServer,
  createServerModuleRunner,
} from '/home/user/Worlds-Within/node_modules/vite/dist/node/index.js';
const SMBC = '/home/user/jelloshooter848/smbc';
const server = await createServer({
  configFile: false,
  root: SMBC,
  logLevel: 'error',
  resolve: {
    alias: {
      '@engine': SMBC + '/src/engine',
      '@game': SMBC + '/src/game',
      '@content': SMBC + '/src/content',
    },
  },
  server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: [SMBC, process.cwd()] } },
  optimizeDeps: { noDiscovery: true, include: [] },
  cacheDir: process.cwd() + '/.vite-cache',
});
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
try {
  await runner.import(process.argv[2]);
} finally {
  await runner.close();
  await server.close();
}
```

### generate.ts

```ts
/**
 * Golden-trace generator for kits/platformer (Worlds Within, Engine 0.5 T6).
 *
 * Runs SMBC REMIX headless (src/game/sim/headless.ts runSim, default runner: MARIO, small) on a
 * purpose-built flat test map and records the player's body each tick: x, y (top-left corner, in
 * sub-pixels, 1/256 px) and vx, vy (1/4096 px per tick). Writes one JSON file per script into the
 * directory in GOLDEN_OUT (default: the current one).
 */
import { writeFileSync } from 'node:fs';
import { runSim } from '@game/sim/headless';
import { MARIO } from '@game/characters/mario';
import { parseTextMap } from '@game/level/textmap';
import type { Action } from '@engine/input/actions';

const OUT = process.env.GOLDEN_OUT ?? '.';
const SMBC = { name: 'SMBC REMIX', version: '0.4.73', commit: 'e0eeee7' };

/**
 * The test map, our own (not an SMBC level): 48x15, a floor on rows 13-14 with a gap at cols 30-32,
 * a wall at col 36 (rows 4-12), a ceiling at cols 8-11 (row 9) and the start at col 12, row 12.
 */
const MAP: string[] = [];
for (let row = 0; row < 15; row++) {
  let line = '';
  for (let col = 0; col < 48; col++) {
    const floor = row >= 13 && !(col >= 30 && col <= 32);
    const wall = col === 36 && row >= 4 && row <= 12;
    const ceiling = row === 9 && col >= 8 && col <= 11;
    line += floor || wall || ceiling ? '#' : '.';
  }
  MAP.push(line);
}
const START = { col: 12, row: 12 };

type Steps = { frame: number; hold: Action[] }[];
const SCRIPTS: { name: string; about: string; ticks: number; steps: Steps }[] = [
  { name: 'walk-right', about: 'hold right from rest', ticks: 160, steps: [{ frame: 0, hold: ['right'] }] },
  {
    name: 'run-skid-release',
    about: 'run right, then hold left (skid and turn), then let go (friction)',
    ticks: 180,
    steps: [
      { frame: 0, hold: ['right', 'run'] },
      { frame: 60, hold: ['left'] },
      { frame: 80, hold: [] },
    ],
  },
  {
    name: 'tap-jump',
    about: 'a one-tick jump press from standing',
    ticks: 120,
    steps: [
      { frame: 10, hold: ['jump'] },
      { frame: 11, hold: [] },
    ],
  },
  {
    name: 'hold-jump',
    about: 'jump held for 40 ticks from standing',
    ticks: 120,
    steps: [
      { frame: 10, hold: ['jump'] },
      { frame: 50, hold: [] },
    ],
  },
  {
    name: 'run-jump-wall',
    about: 'run right, jump over the gap and into the wall, held',
    ticks: 240,
    steps: [
      { frame: 0, hold: ['right', 'run'] },
      { frame: 120, hold: ['right', 'run', 'jump'] },
    ],
  },
  {
    name: 'jump-ceiling',
    about: 'walk left under the ceiling and jump into it, then let go',
    ticks: 120,
    steps: [
      { frame: 0, hold: ['left'] },
      { frame: 20, hold: ['left', 'jump'] },
      { frame: 40, hold: [] },
    ],
  },
];

const src = ['id: golden', 'name: golden', `start: ${START.col},${START.row}`, '', '[tiles]', ...MAP].join(
  '\n',
);
const level = parseTextMap(src);
for (const s of SCRIPTS) {
  const trace: number[][] = [];
  const r = runSim({
    level,
    character: MARIO,
    script: { steps: s.steps },
    maxFrames: s.ticks,
    until: (w) => {
      const b = w.player.body;
      trace.push([b.x, b.y, b.vx, b.vy]);
      return false;
    },
  });
  if (r.outcome !== 'timeout') throw new Error(`${s.name}: ended early (${r.outcome})`);
  const fields = ['x', 'y', 'vx', 'vy'];
  const file = {
    script: s.name,
    about: s.about,
    source: SMBC,
    map: MAP,
    fields,
    ticks: s.ticks,
    steps: s.steps,
    trace,
  };
  writeFileSync(`${OUT}/${s.name}.json`, JSON.stringify(file) + '\n');
  console.log(s.name, trace.length, 'ticks, end', trace.at(-1));
}
```
