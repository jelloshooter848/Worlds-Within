# Worlds Within

A small TypeScript game engine built for LLM coding assistants, and Worlds Within, the multi-genre game
it is being built for: one persistent world where any mission can be delegated or played in its own
genre, with consequences that stay.

The engine comes first and reaches its own 1.0, proved by small sample games. Worlds Within starts its
own version line (Worlds Within 0.1) only after Engine 1.0. See:

- [docs/DESIGN.md](docs/DESIGN.md): what the game is and the decisions so far
- [docs/ROADMAP.md](docs/ROADMAP.md): the planned releases
- [docs/BUILD-LOG.md](docs/BUILD-LOG.md): what each release built and the choices made
- [docs/design/conversation.md](docs/design/conversation.md): the original design conversation
- [docs/research/prior-art.md](docs/research/prior-art.md): other LLM-first engines and tools, and what to borrow

## Run it

```sh
pnpm install
pnpm dev          # opens http://localhost:5173, a list of every game
```

The index lists five engine samples, each with MML music and sfx. Their own art is original
NES-style pixel art stored as text, and the two Engine 0.16 samples also use third-party CC0 art
packs, kept as binary files in the game's `assets/` folder with a `CREDITS.md`:

- `games/samples/dungeon`: **The Old Crypt** (Engine 0.16 part C), eight top-down rooms at 16:9 on
  the CC0 DungeonTileset II: the courtyard, guard room, store room, bat hall and crypt with the
  relic and the way out, and a new wing (the chasm, the ossuary and the warden hall) where the
  dash crosses pits to a key that opens the locked door of the Bone Warden, a three-phase boss.
  An intro dialog, an end dialog and an end screen frame the run. Arrows move, **X** uses the
  sword, **C** uses the item (the bombs or the dash), **Right Shift** picks the next item and
  **Esc** or **P** pauses.
- `games/samples/platformer`: **Hopper's Way** (Engine 0.16 part B), the flagship platformer:
  three side-scrolling levels and Burrlock's arena (a mini-boss) at 16:9, with a level select and
  an end screen, in 2D and in a lit, fogged 2.5D view.
- `games/samples/rts-skirmish`: **The River Ford** (Engine 0.16 part D), a ten-minute skirmish
  against an AI base across a river with three fords, on Kenney's CC0 Medieval RTS art at 16:9:
  gather gold, build, train workers, soldiers and archers, and take the far bank's town centre
  before the AI's three waves and final push take yours. Fog of war, a clickable minimap, order
  markers, path dots, unit barks and build and train progress in the world. Mouse or touch: click
  selects, drag boxes, right click commands, the wheel zooms.
- `games/samples/tower-defense`: **The Winding Road** (Engine 0.16 part E), a ten-wave tower
  defense on Kenney's CC0 Tower Defense art at 16:9: build arrow, cannon (splash) and frost (slow)
  towers on the stones at the road's bends, upgrade each twice, watch the next wave's preview,
  speed the game up to 2x or 3x, and hold the gate for a one- to three-star rating. Range rings,
  projectiles and impacts, health bars and layered music. Keys, taps or the mouse.
- `games/samples/mini-siege`: the mini siege, an RTS battle whose missions are played as a
  top-down room or a tower-defense round, or delegated.

`games/platformer-lab` is the platformer kit's test lab, `games/platformer-classic` the old
five-level Hopper's Way with its two top-down doors (a test game since Engine 0.16 part B),
`games/rts-classic` the 0.15 River Ford battle against a raiding party (a test game since Engine
0.16 part D), `games/td-classic` the 0.15 Winding Road (one map, two tower types, three waves; a
test game since Engine 0.16 part E) and
`games/fx-lab` the presentation lab of Engine 0.16 (animation sets, frame events and the effects to
come), all also on the index.

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Layout

The repo has its target layout since Engine 0.2 (see [docs/ROADMAP.md](docs/ROADMAP.md)). Release
numbers in this table are engine releases; the row marked (none) has not arrived yet.

| Now                                                                                  | Later                 | What it is                                                                                          |
| ------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------- |
| `engine/core`                                                                        |                       | Loop, scenes, input, chiptune audio, save, RNG, missions (no game rules)                            |
| `engine/backends/canvas2d`, `engine/backends/three`                                  |                       | Drawing: Canvas2D, and Three.js for 2.5D/3D (from 0.6)                                              |
| `engine/backends/null`                                                               |                       | The headless renderer for tests, CI and the sim                                                     |
| `engine/tools`                                                                       |                       | The CLI for LLMs and people: validate, run, dump, screenshot, mutants and more                      |
| `engine/sim`                                                                         |                       | The optional world simulation (from 0.8)                                                            |
| `kits/topdown`, `kits/platformer`, `kits/rts`, `kits/towerdefense`                   |                       | Gameplay rules per genre: rooms, levels, armies, towers and waves. Kits never draw                  |
| `build`                                                                              |                       | Build tooling: finds the game pages for Vite, and the launcher index's small script                 |
| `games/samples/dungeon`, `platformer`, `rts-skirmish`, `tower-defense`, `mini-siege` |                       | The engine's sample games, one per kit plus the mini siege (content, skins, thin glue), all for 1.0 |
| `games/platformer-lab`                                                               |                       | The platformer kit's test lab: levels and run files that guard every kit rule                       |
| `games/fx-lab`                                                                       |                       | The presentation lab (from 0.16): every presentation feature shown on two short platformer levels   |
| (none)                                                                               | `games/worlds-within` | Worlds Within itself (from Worlds Within 0.1, after Engine 1.0)                                     |

Run the samples with `pnpm dev`: it opens a small index of every game (found from the folders
`games/*/` and `games/samples/*/`); pick any sample. `pnpm build` builds the index and each game as
its own page in `dist/`. The page discovery lives in `build/` (see [build/CLAUDE.md](build/CLAUDE.md)).

Games depend on the engine; the engine never imports from games.

## Releases

Pushing a release tag (`engine-vX.Y.Z` or `ww-vX.Y.Z`, always three parts) runs
[.github/workflows/pages.yml](.github/workflows/pages.yml). It runs the same checks as CI, builds with
`VITE_BASE=/<repo name>/` and publishes `dist/` to GitHub Pages. It can also be started by hand from the
Actions tab (**Run workflow**). Each page lands at:

| Page                    | URL                                                       |
| ----------------------- | --------------------------------------------------------- |
| Index of games          | `https://<owner>.github.io/<repo>/`                       |
| `games/samples/dungeon` | `https://<owner>.github.io/<repo>/games/samples/dungeon/` |
| Any other game          | `https://<owner>.github.io/<repo>/games/<name>/`          |
| An engine sample        | `https://<owner>.github.io/<repo>/games/samples/<name>/`  |

One-time setup, two steps (without both, the deploy step fails):

1. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. This creates the
   `github-pages` environment.
2. In **Settings → Environments → github-pages → Deployment branches and tags**, add the tag rules
   `engine-v*` and `ww-v*` (or choose **No restriction**). By default the environment only lets the
   default branch deploy, so a release tag is refused with "not allowed to deploy to github-pages due to
   environment protection rules".

A hand-started **Run workflow** also deploys only from a branch or tag those rules allow.

To check a Pages build locally:

```sh
VITE_BASE=/Worlds-Within/ pnpm build
pnpm preview      # then open http://localhost:4173/Worlds-Within/
```

## Origin

`engine/` and `kits/topdown` started as copies of the engine and top-down kit from
[SMBC REMIX](https://github.com/jelloshooter848/SMBC) v0.4.73, by the same author, under the MIT
license. Nothing else from SMBC (its levels, characters, art or music) is part of this project.

## License

MIT
