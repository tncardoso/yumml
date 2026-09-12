/**
 * Tests that hold the repository itself together:
 *
 * - `banana.yaml` stays invalid, and stays invalid in *exactly* the ways we know;
 * - every file in `fixtures/invalid/` fails with exactly the code its name says;
 * - the checked-in JSON Schema matches the wire schema;
 * - the core package never reaches for a Node built-in, so a browser can run it.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseRecipe } from "../index.ts";
import { jsonSchema, jsonSchemaText } from "../schema/json-schema.ts";
import { KNOWN_FIELDS } from "../schema/wire.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const fixtures = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));

/** A fixture named after its diagnostic code: `ledger-under-drawn` → `ledger/under-drawn`. */
function codeOf(file: string): string {
  return file.replace(/\.yaml$/, "").replace(/^([a-z]+)-/, "$1/");
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

type JsonObject = Record<string, unknown>;

/** Walks the generated schema, where every step of the way is `unknown`. */
function obj(value: unknown): JsonObject {
  assert.ok(
    typeof value === "object" && value !== null,
    `expected an object, got ${typeof value}`,
  );
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), `expected an array, got ${typeof value}`);
  return value;
}

function keys(value: unknown): string[] {
  return Object.keys(obj(value)).sort();
}

describe("the banana.yaml sketch", () => {
  const text = read("banana.yaml");

  test("stays invalid, in exactly the known ways", () => {
    const result = parseRecipe(text);
    assert.ok(
      !result.ok,
      "banana.yaml must never pass: if it does, the sketch or the schema changed",
    );
    assert.deepEqual(
      result.diagnostics.map((d) => d.code),
      [
        "schema/missing-field", // the top-level key is `name`, so `title` is missing
        "schema/unknown-field", // ... which is the `name` key
        "schema/unknown-field", // the ingredient uses `name`, not `desc`
        "schema/invalid-unit", // "cup tsp item ... (default item)" is prose in a unit field
      ],
    );
  });

  test("still tells the reader where to look", () => {
    const result = parseRecipe(text);
    assert.ok(!result.ok);
    for (const diagnostic of result.diagnostics) {
      assert.ok(diagnostic.loc !== undefined, diagnostic.code);
      assert.match(diagnostic.message, /title|name|unit/);
    }
  });

  test("the unresolved `butter` appears once the shape is fixed", () => {
    // The file's `melt` step draws from an ingredient nobody declares. That is
    // L3, and L3 only runs when L2 is clean, so it takes a repaired copy of the
    // sketch to see it.
    const repaired = `title: dd
servings: 10
ingredients:
  - id: banana
    desc: banana
    qty: 2
    unit: item
steps:
  - id: prepare
    desc: Butter and flour a loaf pan
  - id: mash
    desc: mash
    uses: [banana]
  - id: melt
    uses: [butter]
`;
    const result = parseRecipe(repaired);
    assert.ok(!result.ok);
    assert.deepEqual(
      result.diagnostics.map((d) => d.code),
      ["ref/unresolved"],
    );
    assert.equal(result.diagnostics[0]?.loc?.line, 15);
  });
});

describe("the invalid fixture corpus", () => {
  const files = readdirSync(`${fixtures}invalid`).filter((name) =>
    name.endsWith(".yaml"),
  );

  test("there is a fixture for every code the parser can emit", () => {
    assert.ok(files.length >= 20, `only ${files.length} fixtures`);
  });

  for (const file of files) {
    test(`${file} fails with ${codeOf(file)}`, () => {
      const expected = codeOf(file);
      const result = parseRecipe(read(`${fixtures}invalid/${file}`));
      assert.ok(!result.ok, `${file} should not be valid`);
      assert.deepEqual(
        result.diagnostics.map((d) => d.code),
        [expected],
        `${file} should fail for one reason, the one it is named after`,
      );
      for (const diagnostic of result.diagnostics) {
        assert.ok(
          diagnostic.loc !== undefined,
          `${file}: no position for ${diagnostic.code}`,
        );
        assert.ok(diagnostic.message.length > 0);
      }
    });
  }
});

describe("the valid fixture", () => {
  const text = read(`${fixtures}banana.valid.yaml`);

  test("validates", () => {
    const result = parseRecipe(text);
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
  });

  test("balances its ledger and cooks in order", () => {
    const result = parseRecipe(text);
    assert.ok(result.ok);
    const { recipe } = result;
    assert.deepEqual(recipe.order, [
      "prepare",
      "mash",
      "melt",
      "brush",
      "sift",
      "mix",
      "mash-smooth",
      "bake",
    ]);
    assert.ok(recipe.ledger.every((entry) => entry.balanced));
    assert.deepEqual(
      recipe.ledger.map((entry) => entry.ingredient),
      ["banana", "butter", "flour"],
    );
    assert.equal(recipe.steps.at(-1)?.timeSec, 5400);
    assert.deepEqual(recipe.consumers.butter, ["melt", "brush"]);
  });

  test("survives a JSON round trip, which is what the CLI prints", () => {
    const result = parseRecipe(text);
    assert.ok(result.ok);
    const printed: unknown = JSON.parse(JSON.stringify(result.recipe));
    assert.deepEqual(printed, result.recipe);
  });
});

describe("the published JSON Schema", () => {
  test("the checked-in file is not stale", () => {
    const checkedIn = read(`${root}packages/core/schema/yumml-v1.schema.json`);
    assert.equal(
      checkedIn,
      jsonSchemaText(),
      "run `pnpm schema` after changing src/schema/wire.ts",
    );
  });

  test("describes every field the hint table knows about", () => {
    const properties = obj(jsonSchema().properties);
    assert.deepEqual(keys(properties), [...KNOWN_FIELDS.recipe].sort());

    const ingredient = obj(obj(obj(properties.ingredients).items).properties);
    assert.deepEqual(keys(ingredient), [...KNOWN_FIELDS.ingredient].sort());

    const step = obj(obj(obj(properties.steps).items).properties);
    assert.deepEqual(keys(step), [...KNOWN_FIELDS.step].sort());

    const use = obj(obj(obj(obj(properties.steps).items).properties).uses);
    const useObject = obj(array(obj(use.items).anyOf)[1]);
    assert.deepEqual(keys(useObject.properties), [...KNOWN_FIELDS.use].sort());
  });

  test("pins the id pattern and the unit list", () => {
    const properties = obj(jsonSchema().properties);
    const ingredient = obj(obj(obj(properties.ingredients).items).properties);
    assert.equal(obj(ingredient.id).pattern, "^[a-z][a-z0-9]*(-[a-z0-9]+)*$");
    assert.equal(array(obj(ingredient.unit).enum).length, 20);
  });
});

describe("browser safety (D1)", () => {
  test("the core import graph has no Node built-in", () => {
    const entry = fileURLToPath(new URL("../index.ts", import.meta.url));
    const seen = new Set<string>();
    const bare = new Set<string>();
    const queue = [entry];

    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      const source = read(file);
      for (const match of source.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
        const specifier = match[1] ?? "";
        if (specifier.startsWith(".")) {
          queue.push(fileURLToPath(new URL(specifier, `file://${file}`)));
        } else {
          bare.add(specifier);
        }
      }
    }

    assert.ok(seen.size > 8, `walked only ${seen.size} files`);
    assert.deepEqual(
      [...bare].sort(),
      ["yaml", "zod"],
      "the core may only depend on yaml and zod: anything else risks a Node built-in",
    );
    for (const file of seen) {
      assert.ok(!file.includes(".test."), "tests must not be imported by src");
    }
  });
});
