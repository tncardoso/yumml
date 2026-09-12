import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRecipe } from "../index.ts";
import { format, fraction } from "../model/fraction.ts";
import type { Recipe } from "../model/recipe.ts";

/** Wraps a list of step/ingredient lines into a whole recipe. */
function recipe(body: string): string {
  return `title: Toast\n${body}`;
}

function codes(input: string): string[] {
  const result = parseRecipe(recipe(input));
  assert.ok(!result.ok, "expected the recipe to be rejected");
  return result.diagnostics.map((d) => d.code);
}

function reject(input: string) {
  const result = parseRecipe(recipe(input));
  assert.ok(!result.ok, "expected the recipe to be rejected");
  return result.diagnostics;
}

function accept(input: string): Recipe {
  const result = parseRecipe(recipe(input));
  assert.ok(
    result.ok,
    `expected a valid recipe, got ${JSON.stringify(result.diagnostics)}`,
  );
  return result.recipe;
}

describe("L2 — schema", () => {
  test("defaults are applied: servings, unit, desc, uses", () => {
    const parsed = accept(`ingredients:
  - id: bread
    qty: 2
steps:
  - id: toast
    uses: [bread]
`);
    assert.equal(parsed.servings, 1);
    assert.equal(parsed.ingredients[0]?.unit, "item");
    assert.equal(parsed.ingredients[0]?.desc, "bread");
    assert.equal(parsed.steps[0]?.desc, "toast");
    assert.deepEqual(parsed.steps[0]?.uses, [{ id: "bread" }]);
  });

  test("unknown fields are errors, with a did-you-mean", () => {
    const diagnostics = reject(`servings: 2
ingredientss:
  - id: bread
    qty: 2
steps:
  - id: toast
    uses: [bread]
`);
    // A misspelled key is two problems at once: the key that is unknown, and
    // the field that is therefore missing.
    const unknown = diagnostics.find((d) => d.code === "schema/unknown-field");
    assert.equal(unknown?.hint, 'did you mean "ingredients"?');
    assert.deepEqual(unknown?.path, ["ingredientss"]);
    assert.ok(diagnostics.some((d) => d.code === "schema/missing-field"));
  });

  test("a missing field is named, and does not suggest itself", () => {
    const result = parseRecipe(`ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [bread]
`);
    assert.ok(!result.ok);
    const [first] = result.diagnostics;
    assert.equal(first?.code, "schema/missing-field");
    assert.equal(first?.message, '"title" is required');
    assert.equal(first?.hint, undefined);
    assert.equal(first?.loc?.line, 1);
  });

  test("a wrong type names both sides, unless the value is missing", () => {
    const [first] = reject(`servings: many
ingredients: []
steps:
  - id: toast
`);
    assert.equal(first?.code, "schema/invalid-type");
    assert.equal(first?.message, '"servings" must be a number, not text');
    assert.deepEqual(first?.path, ["servings"]);
  });

  test("quantities, durations and units are checked where they are used", () => {
    assert.deepEqual(
      codes(`ingredients:
  - id: bread
    qty: lots
    unit: slice
steps:
  - id: toast
    uses: [bread]
`),
      ["schema/invalid-quantity"],
    );

    assert.deepEqual(
      codes(`servings: 2
ingredients:
  - id: bread
    qty: 0
    unit: slice
steps:
  - id: toast
    uses: [bread]
`),
      ["schema/out-of-range"],
    );

    assert.deepEqual(
      codes(`ingredients:
  - id: bread
    qty: 1/0
    unit: slice
steps:
  - id: toast
    uses: [bread]
`),
      ["schema/invalid-quantity"],
    );
  });

  test("time accepts the documented forms and refuses the rest", () => {
    for (const time of ['"5m"', '"1h30m"', '"PT5M"', "5"]) {
      const parsed = accept(`ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [bread]
    time: ${time}
`);
      assert.ok((parsed.steps[0]?.timeSec ?? 0) > 0, time);
    }
    assert.deepEqual(
      codes(`ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [bread]
    time: soon
`),
      ["schema/invalid-duration"],
    );
  });

  test("an id must be kebab-case, wherever it appears", () => {
    assert.deepEqual(
      codes(`ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast_it
    uses: [bread]
`),
      ["schema/invalid-id"],
    );

    const [inUse] = reject(`ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [Bread]
`);
    assert.equal(inUse?.code, "schema/invalid-id");
    assert.deepEqual(inUse?.path, ["steps", 0, "uses", 0]);
  });

  test("an unknown unit suggests the near miss", () => {
    const [first] = reject(`ingredients:
  - id: bread
    qty: 2
    unit: slices
steps:
  - id: toast
    uses: [bread]
`);
    assert.equal(first?.code, "schema/invalid-unit");
    assert.equal(first?.hint, 'did you mean "slice"?');
  });

  test("unit without qty is refused, and qty with unit is not", () => {
    assert.deepEqual(
      codes(`ingredients:
  - id: salt
    unit: pinch
steps:
  - id: season
    uses: [salt]
`),
      ["schema/unit-without-qty"],
    );

    const ok = accept(`ingredients:
  - id: salt
steps:
  - id: season
    uses: [salt]
`);
    assert.equal(ok.ingredients[0]?.qty, undefined);
    assert.equal(ok.ingredients[0]?.unit, "item");
  });

  test("an empty title is its own error", () => {
    const result = parseRecipe('title: ""\ningredients: []\nsteps:\n  - id: toast\n');
    assert.ok(!result.ok);
    assert.deepEqual(
      result.diagnostics.map((d) => d.code),
      ["schema/empty-string"],
    );
  });

  test("everything wrong is reported at once, with positions", () => {
    const input = `name: Toast
servings: 0
ingredients:
  - id: bread
    qty: 2
    unit: slices
steps:
  - id: toast
    uses: [bread]
`;
    const result = parseRecipe(input);
    assert.ok(!result.ok);
    const diagnostics = result.diagnostics;
    assert.ok(diagnostics.length >= 4, `expected several, got ${diagnostics.length}`);
    const lines = diagnostics.map((d) => d.loc?.line);
    assert.deepEqual(
      lines,
      [...lines].sort((a, b) => (a ?? 0) - (b ?? 0)),
    );
    for (const diagnostic of diagnostics) {
      assert.ok(diagnostic.loc !== undefined, diagnostic.code);
      assert.ok((diagnostic.loc?.column ?? 0) > 0);
    }
    const unknown = diagnostics.find((d) => d.code === "schema/unknown-field");
    assert.equal(unknown?.loc?.line, 1);
    assert.equal(unknown?.loc?.column, 1);
  });

  test("decimals survive as exact fractions", () => {
    const parsed = accept(`ingredients:
  - id: butter
    qty: 0.1
    unit: cup
  - id: sugar
    qty: 0.2
    unit: cup
steps:
  - id: cream
    uses: [butter, sugar]
`);
    assert.equal(format(parsed.ingredients[0]?.qty ?? fraction(0)), "1/10");
    assert.equal(format(parsed.ingredients[1]?.qty ?? fraction(0)), "1/5");
  });

  test("the ledger is not run while the shape is broken", () => {
    // `butter` is never declared, and the file also has three shape problems.
    const diagnostics = reject(`name: dd
servings: 10
ingredients:
  - id: banana
    name: banana
    qty: 2
    unit: cup tsp item ... (default item)
steps:
  - id: melt
    uses: [butter]
`);
    assert.ok(!diagnostics.some((d) => d.code === "ref/unresolved"));
    assert.ok(diagnostics.every((d) => d.code.startsWith("schema/")));
  });

  test("the unresolved reference appears once the shape is fixed", () => {
    const diagnostics = reject(`ingredients:
  - id: banana
    qty: 2
    unit: item
steps:
  - id: melt
    uses: [bananas]
`);
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["ref/unresolved"],
    );
    assert.equal(diagnostics[0]?.hint, 'did you mean "banana"?');
    assert.equal(diagnostics[0]?.loc?.line, 8);
    assert.equal(diagnostics[0]?.loc?.column, 12);
  });
});
