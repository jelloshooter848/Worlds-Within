# engine/tools

Placeholder: the CLI for LLMs and people (validate, run, dump, screenshot) arrives in Engine 0.3. No
code lives here until then.

- May import anything in `engine/` and `kits/`.
- Loads a game by its folder path at run time, never by a static import: nothing in `engine/`
  imports from `games/`.
- Every run is repeatable from a seed, so an agent can check its own work.
