import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRecipe } from "../index.ts";
import { format } from "../model/fraction.ts";
import type { Recipe } from "../model/recipe.ts";

function accept(source: string): Recipe {
  const result = parseRecipe(source);
  assert.ok(
    result.ok,
    `expected a valid recipe, got ${JSON.stringify(result.diagnostics)}`,
  );
  return result.recipe;
}

function reject(source: string) {
  const result = parseRecipe(source);
  assert.ok(!result.ok, "expected the recipe to be rejected");
  return result.diagnostics;
}

const BASE = `title: Toast
ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [bread]
`;

/** Replaces the ingredients or steps block of a known-good recipe. */
function withParts(ingredients: string, steps: string): string {
  return `title: Toast\ningredients:\n${ingredients}steps:\n${steps}`;
}

describe("L3 — ids", () => {
  test("ingredients and steps share one namespace (D10)", () => {
    const diagnostics = reject(
      withParts(
        "  - id: toast\n    qty: 1\n    unit: slice\n",
        "  - id: toast\n    uses: [toast]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["id/duplicate"],
    );
    assert.equal(diagnostics[0]?.loc?.line, 7);
  });

  test("two ingredients may not share an id either", () => {
    const diagnostics = reject(
      withParts(
        "  - id: bread\n    qty: 1\n    unit: slice\n  - id: bread\n    qty: 1\n    unit: slice\n",
        "  - id: toast\n    uses: [bread]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["id/duplicate"],
    );
  });
});

describe("L3 — references", () => {
  test("an unresolved reference is an error, never ignored (D3)", () => {
    const diagnostics = reject(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n",
        "  - id: toast\n    uses: [bread, butter]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["ref/unresolved"],
    );
    assert.match(diagnostics[0]?.message ?? "", /"butter" is not declared/);
  });

  test("the same target twice in one step is an error (D11)", () => {
    const diagnostics = reject(
      withParts(
        "  - id: flour\n    qty: 2\n    unit: cup\n",
        "  - id: dust\n    uses: [flour, flour]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["ref/duplicate"],
    );
  });

  test("two different steps may share an ingredient when the amounts add up", () => {
    const parsed = accept(
      withParts(
        "  - id: butter\n    qty: 1/2\n    unit: cup\n",
        "  - id: melt\n    uses: [{ id: butter, qty: 1/4 }]\n  - id: brush\n    uses: [{ id: butter, qty: 1/4 }]\n  - id: bake\n    uses: [melt, brush]\n",
      ),
    );
    assert.equal(format(parsed.ledger[0]?.drawn ?? { n: 0, d: 1 }), "1/2");
    assert.ok(parsed.ledger[0]?.balanced);
  });
});

describe("L3 — the DAG", () => {
  test("a cycle is reported with the loop it found", () => {
    const diagnostics = reject(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n",
        "  - id: a\n    uses: [bread, b]\n  - id: b\n    uses: [a]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["dag/cycle"],
    );
    assert.match(diagnostics[0]?.message ?? "", /a → b → a/);
  });

  test("a step may not use itself", () => {
    const diagnostics = reject(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n",
        "  - id: a\n    uses: [a, bread]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["dag/cycle"],
    );
  });

  test("cooking order is topological, with file order as tie-break (D18)", () => {
    const parsed = accept(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n  - id: jam\n    qty: 2\n    unit: tbsp\n",
        "  - id: spread\n    uses: [jam]\n  - id: toast\n    uses: [bread]\n  - id: serve\n    uses: [toast, spread]\n",
      ),
    );
    // `spread` is declared first and depends on nothing else, so it stays first.
    assert.deepEqual(parsed.order, ["spread", "toast", "serve"]);
  });

  test("reverse edges are recorded for every node", () => {
    const parsed = accept(BASE);
    assert.deepEqual(parsed.consumers, { bread: ["toast"], toast: [] });
  });

  test("several terminal steps are allowed (D27)", () => {
    const parsed = accept(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n  - id: jam\n    qty: 2\n    unit: tbsp\n",
        "  - id: toast\n    uses: [bread]\n  - id: spread\n    uses: [jam]\n",
      ),
    );
    assert.deepEqual(parsed.order, ["toast", "spread"]);
  });

  test("a preparation step is a step with no inputs", () => {
    const parsed = accept(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n",
        "  - id: preheat\n    desc: Heat the oven\n  - id: toast\n    uses: [bread]\n",
      ),
    );
    assert.deepEqual(parsed.steps[0]?.uses, []);
    assert.deepEqual(parsed.order, ["preheat", "toast"]);
  });
});

describe("L3 — unused nodes", () => {
  test("an ingredient nobody draws is an error (D12)", () => {
    const diagnostics = reject(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n  - id: honey\n    qty: 1\n    unit: tsp\n",
        "  - id: toast\n    uses: [bread]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["node/unused"],
    );
    assert.match(
      diagnostics[0]?.message ?? "",
      /"honey" is declared but no step uses it/,
    );
  });

  test("a step nobody draws is a terminal step, not an error", () => {
    assert.ok(accept(BASE).steps.length === 1);
  });
});

describe("L3 — the ledger", () => {
  test("a leftovers is an error, with the amount left over", () => {
    const diagnostics = reject(
      withParts(
        "  - id: butter\n    qty: 1/2\n    unit: cup\n",
        "  - id: melt\n    uses: [{ id: butter, qty: 1/4 }]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["ledger/under-drawn"],
    );
    assert.match(diagnostics[0]?.hint ?? "", /1\/4 cup/);
  });

  test("drawing more than is declared is an error", () => {
    const diagnostics = reject(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n",
        "  - id: toast\n    uses: [bread]\n  - id: toast-again\n    uses: [bread]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["ledger/over-drawn"],
    );
    assert.match(diagnostics[0]?.message ?? "", /draw 4 slice/);
  });

  test("an explicit amount larger than the declared one is an error", () => {
    const diagnostics = reject(
      withParts(
        "  - id: butter\n    qty: 1/2\n    unit: cup\n",
        "  - id: melt\n    uses: [{ id: butter, qty: 1 }]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["ledger/over-drawn"],
    );
  });

  test("thirds add up exactly", () => {
    const parsed = accept(
      withParts(
        "  - id: milk\n    qty: 1\n    unit: cup\n",
        "  - id: a\n    uses: [{ id: milk, qty: 1/3 }]\n  - id: b\n    uses: [{ id: milk, qty: 1/3 }]\n  - id: c\n    uses: [{ id: milk, qty: 1/3 }]\n  - id: serve\n    uses: [a, b, c]\n",
      ),
    );
    assert.equal(format(parsed.ledger[0]?.drawn ?? { n: 0, d: 1 }), "1");
    assert.ok(parsed.ledger[0]?.balanced);
  });

  test("only ingredients are quantified (D26)", () => {
    const diagnostics = reject(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n",
        "  - id: toast\n    uses: [bread]\n  - id: serve\n    uses: [{ id: toast, qty: 1 }]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["ledger/amount-on-step"],
    );
  });

  test("an unquantified ingredient has no amount to draw from (D17)", () => {
    const diagnostics = reject(
      withParts("  - id: salt\n", "  - id: season\n    uses: [{ id: salt, qty: 1 }]\n"),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["ledger/amount-on-unquantified"],
    );
  });

  test("an unquantified ingredient is exempt but must still be drawn", () => {
    const parsed = accept(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n  - id: salt\n",
        "  - id: toast\n    uses: [bread, salt]\n",
      ),
    );
    assert.equal(parsed.ledger.length, 1);
    assert.equal(parsed.ledger[0]?.ingredient, "bread");

    const diagnostics = reject(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n  - id: salt\n",
        "  - id: toast\n    uses: [bread]\n",
      ),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      ["node/unused"],
    );
  });

  test("a step is never weighed against anything", () => {
    const parsed = accept(
      withParts(
        "  - id: bread\n    qty: 2\n    unit: slice\n",
        "  - id: toast\n    uses: [bread]\n  - id: cut\n    uses: [toast]\n",
      ),
    );
    assert.deepEqual(
      parsed.ledger.map((entry) => entry.ingredient),
      ["bread"],
    );
  });
});
