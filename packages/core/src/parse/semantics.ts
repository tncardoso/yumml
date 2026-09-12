/**
 * L3 — the checks a structural schema cannot express, and the final model.
 *
 * In order: ids are unique, every reference resolves, the graph is acyclic,
 * nothing is declared and left unused, and the ledger balances. Each stage runs
 * only if the ones before it were clean: a dangling reference makes the ledger
 * arithmetic meaningless, so reporting both would bury the real mistake under
 * cascades.
 *
 * The ledger rule is plan.md §11, the normative one: for each quantified
 * ingredient, the sum of the draws that target it must equal its declared
 * quantity exactly, with a bare draw counting as the whole amount. Only
 * ingredients are quantified (D26), so this is a per-ingredient sum and never
 * depends on the order of the steps.
 */

import { type Diagnostic, diagnostic } from "../diagnostics.ts";
import { add, cmp, type Fraction, format, sub, ZERO } from "../model/fraction.ts";
import { closest } from "../model/id.ts";
import type {
  IngredientNode,
  LedgerEntry,
  Recipe,
  RecipeInput,
  StepNode,
} from "../model/recipe.ts";

export type AnalyzeResult =
  | { readonly ok: true; readonly recipe: Recipe }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

type NodeKind = "ingredient" | "step";
type NodeRef = { readonly kind: NodeKind; readonly index: number };

function indexNodes(model: RecipeInput): Map<string, NodeRef> {
  const ids = new Map<string, NodeRef>();
  model.ingredients.forEach((ingredient, index) => {
    ids.set(ingredient.id, { kind: "ingredient", index });
  });
  model.steps.forEach((step, index) => {
    ids.set(step.id, { kind: "step", index });
  });
  return ids;
}

/** Duplicate ids, across ingredients and steps together (D10). */
function checkIds(model: RecipeInput): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const visit = (id: string, path: readonly (string | number)[]): void => {
    if (seen.has(id)) {
      diagnostics.push(
        diagnostic({
          code: "id/duplicate",
          message: `"${id}" is already used by another ingredient or step`,
          path: [...path, "id"],
          hint: "ids are shared by ingredients and steps, so each one must be unique in the recipe",
        }),
      );
      return;
    }
    seen.add(id);
  };
  model.ingredients.forEach((ingredient, index) => {
    visit(ingredient.id, ["ingredients", index]);
  });
  model.steps.forEach((step, index) => {
    visit(step.id, ["steps", index]);
  });
  return diagnostics;
}

/** Every `uses` entry resolves, and only ingredients carry an amount (D28). */
function checkReferences(model: RecipeInput, ids: Map<string, NodeRef>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const allIds = [...ids.keys()];

  model.steps.forEach((step, stepIndex) => {
    const seenInThisStep = new Set<string>();
    step.uses.forEach((draw, useIndex) => {
      const path = ["steps", stepIndex, "uses", useIndex] as const;
      const target = ids.get(draw.id);
      const idPath = draw.qty === undefined ? path : [...path, "id"];

      if (seenInThisStep.has(draw.id)) {
        diagnostics.push(
          diagnostic({
            code: "ref/duplicate",
            message: `"${draw.id}" is already drawn by this step`,
            path: idPath,
            hint: 'a bare reference means "all of it", so listing the same target twice counts it twice',
          }),
        );
        return;
      }
      seenInThisStep.add(draw.id);

      if (target === undefined) {
        const suggestion = closest(draw.id, allIds);
        diagnostics.push(
          diagnostic({
            code: "ref/unresolved",
            message: `"${draw.id}" is not declared as an ingredient or a step`,
            path: idPath,
            ...(suggestion === undefined
              ? {}
              : { hint: `did you mean "${suggestion}"?` }),
          }),
        );
        return;
      }
      if (draw.qty === undefined) return;
      if (target.kind === "step") {
        diagnostics.push(
          diagnostic({
            code: "ledger/amount-on-step",
            message: `"${draw.id}" is a step, and only ingredients have amounts`,
            path: [...path, "qty"],
            hint: `write "${draw.id}" without a quantity to use all of it`,
          }),
        );
        return;
      }
      const ingredient = model.ingredients[target.index];
      if (ingredient?.qty === undefined) {
        diagnostics.push(
          diagnostic({
            code: "ledger/amount-on-unquantified",
            message: `"${draw.id}" has no "qty" of its own, so it cannot be drawn in part`,
            path: [...path, "qty"],
            hint: `give the ingredient a "qty", or write "${draw.id}" without a quantity`,
          }),
        );
      }
    });
  });

  return diagnostics;
}

/** Reference structure of the DAG: the steps this step draws from. */
function producersOf(step: StepNode, ids: Map<string, NodeRef>): string[] {
  const producers: string[] = [];
  for (const draw of step.uses) {
    if (ids.get(draw.id)?.kind !== "step") continue;
    if (!producers.includes(draw.id)) producers.push(draw.id);
  }
  return producers;
}

/** Depth-first search that returns the loop it walked into, for the message. */
function findCycle(
  steps: readonly StepNode[],
  ids: Map<string, NodeRef>,
): { at: number; cycle: string[] } | undefined {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];
  let found: string[] | undefined;

  const visit = (id: string): boolean => {
    state.set(id, "open");
    stack.push(id);
    const step = stepById.get(id);
    for (const draw of step?.uses ?? []) {
      if (ids.get(draw.id)?.kind !== "step") continue;
      const seen = state.get(draw.id);
      if (seen === "open") {
        found = [...stack.slice(stack.indexOf(draw.id)), draw.id];
        return true;
      }
      if (seen === undefined && visit(draw.id)) return true;
    }
    stack.pop();
    state.set(id, "done");
    return false;
  };

  for (const [index, step] of steps.entries()) {
    if (state.get(step.id) !== undefined) continue;
    if (visit(step.id)) return { at: index, cycle: found ?? [step.id] };
  }
  return undefined;
}

/** `prepare`-style steps and terminal steps are allowed; everything else is drawn. */
function checkUnused(model: RecipeInput, consumers: Map<string, string[]>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  model.ingredients.forEach((ingredient, index) => {
    const used = consumers.get(ingredient.id) ?? [];
    if (used.length === 0) {
      diagnostics.push(
        diagnostic({
          code: "node/unused",
          message: `"${ingredient.id}" is declared but no step uses it`,
          path: ["ingredients", index],
          hint: 'remove the ingredient, or add it to a step\'s "uses"',
        }),
      );
    }
  });
  return diagnostics;
}

/** Sums the draws aimed at one ingredient; a bare draw counts as the whole amount. */
function sumDraws(model: RecipeInput, ingredient: IngredientNode): Fraction {
  let drawn = ZERO;
  const declared = ingredient.qty ?? ZERO;
  for (const step of model.steps) {
    for (const draw of step.uses) {
      if (draw.id !== ingredient.id) continue;
      drawn = add(drawn, draw.qty ?? declared);
    }
  }
  return drawn;
}

function checkLedger(
  model: RecipeInput,
  consumers: Map<string, string[]>,
): {
  diagnostics: Diagnostic[];
  ledger: LedgerEntry[];
} {
  const diagnostics: Diagnostic[] = [];
  const ledger: LedgerEntry[] = [];

  model.ingredients.forEach((ingredient, index) => {
    if (ingredient.qty === undefined) return;
    // An ingredient nobody draws is reported as unused; adding "and nothing was
    // drawn from it" would be the same mistake told twice.
    if ((consumers.get(ingredient.id) ?? []).length === 0) return;
    const unit = ingredient.unit;
    const drawn = sumDraws(model, ingredient);
    const balance = cmp(drawn, ingredient.qty);
    const path = ["ingredients", index, "qty"] as const;
    ledger.push({
      ingredient: ingredient.id,
      declared: ingredient.qty,
      drawn,
      balanced: balance === 0,
    });
    if (balance < 0) {
      diagnostics.push(
        diagnostic({
          code: "ledger/under-drawn",
          message: `${format(ingredient.qty)} ${unit} of "${ingredient.id}" is declared, but only ${format(drawn)} ${unit} is drawn`,
          path,
          hint: `${format(sub(ingredient.qty, drawn))} ${unit} is left over`,
        }),
      );
    } else if (balance > 0) {
      diagnostics.push(
        diagnostic({
          code: "ledger/over-drawn",
          message: `the steps draw ${format(drawn)} ${unit} of "${ingredient.id}", but only ${format(ingredient.qty)} ${unit} is declared`,
          path,
          hint: 'a bare reference means "all of it", so two of them count twice',
        }),
      );
    }
  });

  return { diagnostics, ledger };
}

/** Cooking order: producers first, file order among independent steps (D18). */
function topologicalOrder(
  steps: readonly StepNode[],
  ids: Map<string, NodeRef>,
): string[] {
  const done = new Set<string>();
  const pending = new Map<string, Set<string>>(
    steps.map((step) => [step.id, new Set(producersOf(step, ids))]),
  );
  const order: string[] = [];
  const remaining = steps.map((step) => step.id);

  while (remaining.length > 0) {
    // Scan in file order each round, so independent steps keep their order (D18).
    const ready = remaining.filter((id) => (pending.get(id)?.size ?? 0) === 0);
    if (ready.length === 0) break; // a cycle; analyze reported it already
    for (const id of ready) {
      order.push(id);
      done.add(id);
      remaining.splice(remaining.indexOf(id), 1);
    }
    for (const producers of pending.values()) {
      for (const producer of done) producers.delete(producer);
    }
  }
  return order;
}

/**
 * Runs the semantic checks and, when they all pass, returns the finished
 * {@link Recipe}. When any of them fails the recipe is not returned at all: a
 * model that half-balances is worse than no model.
 */
export function analyze(model: RecipeInput): AnalyzeResult {
  const ids = indexNodes(model);
  const duplicates = checkIds(model);
  if (duplicates.length > 0) return { ok: false, diagnostics: duplicates };

  const references = checkReferences(model, ids);
  if (references.length > 0) return { ok: false, diagnostics: references };

  const cycle = findCycle(model.steps, ids);
  if (cycle) {
    const cyclePath = ["steps", cycle.at, "uses"] as const;
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          code: "dag/cycle",
          message: `these steps use each other in a loop: ${cycle.cycle.join(" → ")}`,
          path: cyclePath,
          hint: "a step can only use a step that is made before it",
        }),
      ],
    };
  }

  const consumers = new Map<string, string[]>();
  for (const ingredient of model.ingredients) consumers.set(ingredient.id, []);
  for (const step of model.steps) consumers.set(step.id, []);
  for (const step of model.steps) {
    for (const draw of step.uses) {
      const list = consumers.get(draw.id);
      if (list && !list.includes(step.id)) list.push(step.id);
    }
  }

  const unused = checkUnused(model, consumers);
  const { diagnostics: ledgerDiagnostics, ledger } = checkLedger(model, consumers);
  const diagnostics = [...unused, ...ledgerDiagnostics];
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  return {
    ok: true,
    recipe: {
      ...model,
      order: topologicalOrder(model.steps, ids),
      consumers: Object.fromEntries(consumers),
      ledger,
    },
  };
}
