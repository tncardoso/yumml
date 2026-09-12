# Changelog

The format is based on [Keep a Changelog][kac], and this project uses
[Semantic Versioning][semver]. See [docs/dev/releasing.md](docs/dev/releasing.md)
for the conventions.

## [Unreleased]

## [0.1.0] - 2026-09-12

### Added

#### The recipe language, v1

A recipe is YAML. Ingredients and steps are both nodes, they share one id namespace,
and every `uses` entry is an edge in a graph that has to stay acyclic.

- Two node kinds and one edge kind: an **ingredient** is a source, a **step** is a
  transform whose `uses` list names what it draws from, in draw order. A step with no
  `uses` is a preparation step.
- Ids are kebab-case ASCII, unique across ingredients and steps together, at most 64
  characters (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`).
- A `uses` entry is either a bare id, meaning all of it, or `{ id, qty }`. The amount
  form is legal **only** against an ingredient, which is what lets several steps share
  one ingredient and still balance.
- Quantities are exact rationals. Integers, decimals, and fractions (`1/2`) all parse
  without floating-point drift, so `1/3 + 1/3 + 1/3` is exactly one.
- The **quantity ledger**: the amounts drawn from every quantified ingredient must sum
  to exactly its declared quantity. A bare reference counts as the whole thing, so two
  of them are caught as over-drawn.
- Durations accept `90s`, `5m`, `1h30m`, `1h 30m`, ISO 8601, and a bare integer as
  minutes. A duration is a viewer hint, never a dependency.
- A closed unit registry of 20 units: count (`item`, `pinch`, `clove`, `slice`, `can`,
  `package`), US volume, metric volume, US mass, and metric mass. `item` is the
  default, and count units never convert across dimensions.
- `title` names the dish and is required; `servings` defaults to 1. Unknown keys are
  errors, reported with a did-you-mean suggestion.

#### `yumml`

- A four-stage pipeline — load, YAML, schema, semantics — that reports **every**
  problem in the file at once, sorted by position, instead of stopping at the first.
- 28 stable diagnostic codes across the four stages, each with a message, a path, a
  source range, and a line and column, so a diagnostic can be rendered as a
  compiler-style code frame that points at the character to change.
- Semantic checks: id uniqueness, reference resolution with suggestions for near
  misses, cycle detection reported as the cycle path, reachability, and the ledger.
- The core is browser-safe by construction. It parses strings and bytes, never touches
  `fs`, and its whole import graph resolves to just `yaml` and `zod` — asserted by a
  test that walks it.
- Zod is the source of truth: TypeScript types come from `z.infer`, validation runs
  from the same schema, and the JSON Schema for editors is generated from it, checked
  in, and asserted against the generator by the test suite so it cannot drift.
- The model is pure data and JSON-serializable: nodes with adjacency, a topological
  `order` with preparation steps first, a reverse `consumers` map, and a `ledger` of
  declared versus drawn per quantified ingredient.

#### `@yumml/cli`

- `yumml validate <file|->` and `yumml parse <file|->`, with `--json` for machines and
  `--summary` for a readable outline of the model.
- `-` reads standard input, so `yumml validate - < recipe.yaml` works.
- Exit codes are part of the contract: `0` valid, `1` diagnostics, `2` bad usage or
  unreadable input, `3` an internal bug. A crash is never mistaken for a bad recipe.

#### Repository

- A fixture corpus of 25 invalid recipes, one for every diagnostic code a file can
  express, each asserted to fail for exactly the reason its filename names, plus a
  valid recipe that exercises every default. The three `load/*` codes — too large,
  unsupported encoding, invalid UTF-8 — are asserted against raw bytes in unit tests,
  because a fixture file cannot express them.
- `fixtures/banana.yaml`, the annotated sketch the language was reverse-engineered
  from, held by a test to stay invalid in exactly the four known ways.
- 126 tests across 23 suites.
- A `justfile` for the tasks that matter, and GitHub Actions workflows that call it:
  the same commands run on a laptop and in the pipeline.

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html
[Unreleased]: https://github.com/tncardoso/yumml/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tncardoso/yumml/releases/tag/v0.1.0
