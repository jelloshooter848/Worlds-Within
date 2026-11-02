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

The current build is an engine demo: three top-down rooms with placeholder art and an original
song. Arrows move, **Z** / **X** use the sword, **C** uses the selected item.

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Layout

The repo has its target layout since Engine 0.2 (see [docs/ROADMAP.md](docs/ROADMAP.md)). Release
numbers in this table are engine releases; rows marked (none) arrive in the release named.

| Now                        | Later                                                                  | What it is                                                                                     |
| -------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `engine/core`              | `engine/core`                                                          | Loop, scenes, input, chiptune audio, save, RNG (no game rules)                                 |
| `engine/backends/canvas2d` | `engine/backends/canvas2d`, `engine/backends/three` (0.6)              | Drawing (2D now; Three.js 2.5D/3D from 0.6)                                                    |
| `engine/backends/null`     | `engine/backends/null`                                                 | The headless renderer for tests, CI and the sim                                                |
| `engine/tools`             | `engine/tools`                                                         | The CLI for LLMs and people: validate, run, dump, screenshot (0.3)                             |
| `engine/sim`               | `engine/sim`                                                           | The optional world simulation (0.8)                                                            |
| `kits/topdown`             | `kits/topdown`, later `kits/platformer`, `kits/rts`                    | Gameplay rules: rooms, doors, heroes, enemies. Kits never draw                                 |
| `build`                    | `build`                                                                | Build tooling: finds the game pages for Vite, and the launcher index's small script            |
| `games/demo`               | `games/demo` (until 0.15), then `games/samples/dungeon`                | The current demo: content, skins and a thin entry point. Grows into the dungeon sample at 0.15 |
| (none)                     | `games/platformer-test` (0.7 to 0.15), then `games/samples/platformer` | The stacking-test game. Grows into the platformer sample at 0.15                               |
| (none)                     | `games/samples/<name>`                                                 | Engine sample games, one per kit plus the mini siege, all required for 1.0 (0.9 to 0.15)       |
| (none)                     | `games/worlds-within`                                                  | Worlds Within itself (from Worlds Within 0.1, after Engine 1.0)                                |

Run the demo with `pnpm dev`: it opens a small index of every game (found from the folders
`games/*/` and `games/samples/*/`); pick `games/demo`. `pnpm build` builds the index and each game as
its own page in `dist/`. The page discovery lives in `build/` (see [build/CLAUDE.md](build/CLAUDE.md)).

Games depend on the engine; the engine never imports from games.

## Releases

Pushing a release tag (`engine-vX.Y.Z` or `ww-vX.Y.Z`, always three parts) runs
[.github/workflows/pages.yml](.github/workflows/pages.yml). It runs the same checks as CI, builds with
`VITE_BASE=/<repo name>/` and publishes `dist/` to GitHub Pages. It can also be started by hand from the
Actions tab (**Run workflow**). Each page lands at:

| Page             | URL                                                      |
| ---------------- | -------------------------------------------------------- |
| Index of games   | `https://<owner>.github.io/<repo>/`                      |
| `games/demo`     | `https://<owner>.github.io/<repo>/games/demo/`           |
| Any other game   | `https://<owner>.github.io/<repo>/games/<name>/`         |
| An engine sample | `https://<owner>.github.io/<repo>/games/samples/<name>/` |

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
