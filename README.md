# yumml 🍌 — recipes as YAML

<p align="center">
  <img src="https://img.shields.io/badge/node-%E2%89%A522.6-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22.6 or newer">
  <img src="https://img.shields.io/badge/license-MIT-3DA639?style=flat-square" alt="MIT">
  <img src="https://img.shields.io/badge/diagnostics-28%20stable%20codes-6C5CA6?style=flat-square" alt="28 diagnostic codes">
  <img src="https://img.shields.io/badge/tests-126%20passing-2C8C7D?style=flat-square" alt="126 tests passing">
</p>

**A recipe is not a list. It is a graph with a ledger, and yumml checks both.**

yumml reads a recipe written in YAML and refuses to guess. Ingredients and steps are
nodes, every `uses` entry is an edge, and the amounts drawn from an ingredient have to
sum to exactly what was declared, in exact rational arithmetic. `1/4 cup + 1/4 cup` is
`1/2 cup`. `0.1 + 0.2` is not a mystery.

It is a language definition, a parser, and a CLI. It is also the front half of a recipe
viewer: check a recipe first, draw it second. 

## There is no lenient mode

This is the whole personality of the project, so it goes first.

Most recipe formats will accept anything and let the reader sort it out. yumml does the
opposite. A recipe with a problem gets **diagnostics**, never a repaired model. There is
no `--force`, no warning tier, no "parsed with 3 issues" that quietly drops a typo on the
floor. Strict mode is not an option here; it is the only mode.

What that buys you is that a mistake costs one line of output instead of a disappointing
cake. The validator points at the character, quotes the line, and when it recognises the
shape of the error it tells you what you probably meant:

```console
$ yumml validate bread.yaml
bread.yaml:6:5  error  schema/unknown-field
  unknown field "qtty" in ingredients[0]
  5 |     unit: slice
  6 |     qtty: 2
    |     ^^^^
  7 | steps:
  hint: did you mean "qty"?
```

The ledger is the check no other recipe format does. Split `1/2 cup` of butter between
`melt` and `brush` and yumml does the arithmetic:

```console
$ yumml validate butter.yaml
butter.yaml:4:10  error  ledger/under-drawn
  1/2 cup of "butter" is declared, but only 1/4 cup is drawn
  3 |   - id: butter
  4 |     qty: 1/2
    |          ^^^
  5 |     unit: cup
  hint: 1/4 cup is left over
```

Cycles get the same treatment. `uses` is meant to be a DAG, and a loop is reported as the
path it takes: `these steps use each other in a loop: a → b → a`.

Errors are not the only thing you get. **Every problem in the file comes back at once**,
sorted by position. Someone fixing a recipe wants the whole list, not a first error and
another round trip.

## Quick start

yumml is not on npm yet, so run it from a clone:

```bash
git clone git@github.com:tncardoso/yumml.git
cd yumml
pnpm install
```

Then check a recipe. There is a real one in the fixtures:

```bash
pnpm run yumml:dev -- validate fixtures/banana.valid.yaml
# fixtures/banana.valid.yaml: valid
```

Break it and watch what happens:

```bash
pnpm run yumml:dev -- validate fixtures/invalid/ledger-over-drawn.yaml
```

Ask for the model instead of a verdict, rendered for a person:

<details>
<summary><code>pnpm run yumml:dev -- parse fixtures/banana.valid.yaml --summary</code></summary>

```console
Banana Bread (servings: 10)

Ingredients (4)
  2 item   banana
  1/2 cup  butter
  200 g    flour
           salt

Steps (8, in cooking order)
   1. prepare      Butter and flour a loaf pan
   2. mash         mash
                    uses banana
   3. melt         melt
                    uses butter 1/4
   4. brush        brush
                    uses butter 1/4
   5. sift         sift
                    uses flour
   6. mix          mix
                    uses sift, melt, brush, salt
   7. mash-smooth  mash-smooth
                    uses mash, mix
   8. bake         bake
                    uses mash-smooth  |  timer 1h30m

Ledger
  banana       declared 2 item        drawn 2 item  ok
  butter       declared 1/2 cup       drawn 1/2 cup  ok
  flour        declared 200 g         drawn 200 g  ok
```

</details>

Note the order: `prepare` first, then the topological sort. `salt` is declared with no
quantity, so it is exempt from the ledger arithmetic, but it still has to be drawn by a
step or it would be an unused node: `mix` does that. The summary is plain text on purpose.
A reader who skips the ledger still has a readable recipe, and a reader who reads it sees
why the amounts add up.

`--json` on either command gives you the same information as data, which is what you feed
to a renderer:

```bash
pnpm run yumml:dev -- validate recipe.yaml --json   # { ok, file, diagnostics: [...] }
pnpm run yumml:dev -- parse recipe.yaml --json      # the Recipe model
```

### Exit codes are part of the contract

| code | meaning |
|------|---------|
| `0` | the recipe is valid |
| `1` | the recipe has diagnostics |
| `2` | bad usage, or the file could not be read |
| `3` | a bug in yumml |

A crash is never mistaken for a bad recipe. That matters the moment yumml runs inside CI,
a git hook, or an editor.

Full CLI surface:

```console
yumml validate <file|->       check a recipe, print every problem
yumml parse <file|->          check a recipe, print the model

Options
  --json                      machine-readable output (diagnostics or model)
  --summary                   for `parse`: a readable outline instead of JSON
  -h, --help                  this text
  -V, --version               the version
```

`-` reads standard input, so `yumml validate - < recipe.yaml` works, as does piping from a
generator or an LLM.

## The recipe language (v1)

Two node kinds, one id namespace, one edge kind. An **ingredient** is a source node. A
**step** is a transform node whose `uses` list names the nodes it draws from, in order.
Everything must be reachable from a terminal step.

```yaml
title: Banana Bread          # required, non-empty after trim
servings: 10                 # optional, integer >= 1, default 1

ingredients:
  - id: banana               # required, unique across ingredients AND steps
    desc: Banana             # optional, defaults to the id
    qty: 2                   # optional; number, "1/2", or "0.5"
    unit: item               # optional, default item; requires qty
  - id: butter
    qty: 1/2
    unit: cup

steps:
  - id: prepare              # no uses -> a preparation step, no inputs
    desc: Butter and flour a loaf pan
  - id: mash
    uses: [banana]           # bare: the whole of "banana"
    time: 5m                 # optional, viewer timer hint
  - id: melt
    uses: [{ id: butter, qty: 1/4 }]   # amount form, ingredients only
  - id: brush
    uses: [{ id: butter, qty: 1/4 }]   # sums with the above to butter's 1/2 cup
  - id: mash-smooth
    uses: [mash, melt, brush]          # step targets are always bare
```

The amount form is the interesting part. It is legal **only** against an ingredient, which
is what lets several steps share one ingredient and still balance. A bare reference means
"all of it", so two bare references to the same ingredient count twice and get caught.
Steps are never quantified, and a `uses` entry inherits its unit from its target and can
never carry its own.

**Ids** are kebab-case ASCII, at most 64 characters, and shared between ingredients and
steps: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. `mash-smooth` is fine. `Banana`, `mash_smooth`,
and `mashSmooth` are not.

**Quantities** are exact. Integers, decimals, and fractions all parse to a rational, so
`3 × 1/3 cup` is exactly one cup and the ledger never rounds.

**Durations** accept `90s`, `5m`, `1h30m`, `1h 30m`, a bare integer as minutes, and
ISO 8601 (`PT1H30M`), and normalise to seconds. A `time` is a hint for the viewer's
per-step timer. It is not a dependency and never reorders anything.

**Units** are a closed enum, because a typo in a unit is exactly what the strict parser
exists to catch:

| dimension | units |
|-----------|-------|
| count | `item` `pinch` `clove` `slice` `can` `package` |
| volume, US | `tsp` `tbsp` `floz` `cup` `pint` `quart` `gallon` |
| volume, metric | `ml` `l` |
| mass, US | `oz` `lb` |
| mass, metric | `mg` `g` `kg` |

`item` is the default. Count units carry no conversion factor and never convert across
dimensions: a `clove` is not a volume. Conversions are for display only. The ledger never
converts, because every draw inherits its target's unit, so all its arithmetic happens
inside a single unit.

### Unknown keys are errors

There is no extension hook in v1. `name` at the top level is an error, not an alias for
`title`; `servigs` gets a did-you-mean. A closed schema is what makes a typo loud instead
of silent.

## Four stages, four ways to fail

Every stage can fail on its own terms, and each one carries the source position forward so
that the error you read points at a line in *your* file.

```
L0 load     bytes ──► text                    encoding, BOM, 1 MiB cap
L1 yaml     text ──► document + plain object  one doc, no merge keys, no custom tags
L2 schema   object ─► model                   types, defaults, quantities, unknown keys
L3 checks   model ──► Recipe                  ids, refs, DAG, ledger, reachability
```

YAML policy is deliberately narrow: one document per file, merge keys (`<<`) rejected,
custom tags (`!!python/...`) rejected, duplicate keys are an error rather than
last-write-wins, and YAML 1.1 coercions are refused, so `yes`/`no` stay strings and
`2024-01-01` stays a string instead of becoming a `Date`.

## 28 stable diagnostic codes

Codes are the contract. Messages are not, and tests assert on codes so a message rewrite
never breaks the suite.

| stage | codes |
|-------|-------|
| load | `load/unsupported-encoding` `load/invalid-utf8` `load/too-large` |
| yaml | `yaml/syntax` `yaml/duplicate-key` `yaml/unknown-tag` `yaml/multiple-documents` `yaml/merge-key` `yaml/empty-document` |
| schema | `schema/invalid-type` `schema/unknown-field` `schema/missing-field` `schema/empty-string` `schema/out-of-range` `schema/invalid-id` `schema/invalid-unit` `schema/invalid-quantity` `schema/invalid-duration` `schema/unit-without-qty` |
| semantics | `id/duplicate` `ref/unresolved` `ref/duplicate` `dag/cycle` `node/unused` `ledger/under-drawn` `ledger/over-drawn` `ledger/amount-on-step` `ledger/amount-on-unquantified` |

Every diagnostic carries `code`, `message`, `path`, `severity`, and, when it came from a
real node in the file, `range` and `loc`. `severity` exists but v1 only ever emits
`"error"`.

## Use it as a library

`yumml` is browser-safe by construction: it parses strings and bytes, never touches
`fs`, and takes no Node built-ins. The CLI is a thin wrapper around it.

```ts
import { parseRecipe, formatDiagnostic } from "@yumml/yumml";

const result = parseRecipe(yamlText);
if (result.ok) {
  const { title, order, ledger } = result.recipe;
} else {
  for (const d of result.diagnostics) console.error(formatDiagnostic(yamlText, d));
}
```

`Recipe` is pure data and JSON-serializable, which is what `--json` prints and what a
renderer embeds: nodes with adjacency, a topological `order` with preparation steps first,
a reverse `consumers` map, and a `ledger` with one declared-versus-drawn entry per
quantified ingredient.

Render that model into any HTML element with the browser-only visualization API:

```ts
import { parseRecipe, renderRecipe } from "@yumml/yumml";

const result = parseRecipe(yamlText);
if (result.ok) renderRecipe(result.recipe, document.querySelector("#recipe")!);
```

The renderer replaces the element's contents with responsive HTML and scoped CSS. It has
no server component, network requests, runtime dependencies, or global styles.

The smaller pieces are exported too, for callers that want one stage instead of four:
`parseYaml`, `validateValue`, `analyze`, `loadSource`, `withSource`, plus exact rational
arithmetic (`fraction`, `add`, `mul`, `cmp`, `format`), duration parsing, and the unit
registry with its conversion factors.

## Editor support

The JSON Schema is generated from the Zod schema that does the validating, checked into
the repo, and asserted against the generator by the test suite, so it cannot drift:

```
packages/core/schema/yumml-v1.schema.json
```

Point your editor at it and get completion and inline errors while you write:

```yaml
# yaml-language-server: $schema=./packages/core/schema/yumml-v1.schema.json
```

The schema describes the **shape only**. Its own description says so: a recipe can satisfy
the schema and still be rejected, because reference resolution, acyclicity, and the ledger
are not expressible in JSON Schema. Your editor catches the typos; `yumml validate`
catches the arithmetic.

## Development

```bash
pnpm install
pnpm test        # 126 tests
pnpm run check   # biome
pnpm run typecheck
pnpm run ci      # all three
pnpm run schema  # regenerate the JSON Schema
```

Two commands to know while working on the CLI:

```bash
pnpm run yumml:dev -- validate recipe.yaml   # runs the TypeScript directly
pnpm build && pnpm run yumml -- validate recipe.yaml   # runs dist/
```

Layout:

```
packages/core/     the language: parser, schema, semantics   (no fs, no Node built-ins)
packages/cli/      the `yumml` command
fixtures/          recipes that must pass, and ones that must fail with a named code
```

`packages/core` depends on exactly two things: `yaml` for the parser and `zod` for the
schema. Zod is the source of truth, TypeScript types come from `z.infer`, and the JSON
Schema is generated from it.

## License

MIT.
