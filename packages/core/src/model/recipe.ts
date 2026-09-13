/**
 * The domain model: what every later stage (renderer, shopping list, scaler)
 * reads.
 *
 * It is plain data — no classes, no `Map`, no methods — so `yumml parse --json`
 * can print it and a browser can hold it across a structured clone. Step order,
 * reverse edges and the ledger are precomputed here even though only the checks
 * need them today, because recomputing them in every consumer is how two
 * consumers end up disagreeing about what depends on what.
 */

import { type Diagnostic, diagnostic } from "../diagnostics.ts";
import type { RecipeWire, UseWire } from "../schema/wire.ts";
import { parseDuration } from "./duration.ts";
import { type Fraction, format, parseQuantity } from "./fraction.ts";
import { DEFAULT_UNIT, isUnitName, type UnitName } from "./unit.ts";

/**
 * One entry of a step's `uses` list. A missing `qty` is the bare form, which
 * means "full use" of the target.
 */
export type Draw = {
  readonly id: string;
  /** Absent means the whole declared amount, and is only legal against a step,
   *  or against an ingredient that has no quantity at all. */
  readonly qty?: Fraction;
};

export type IngredientNode = {
  readonly id: string;
  /** Display text; falls back to the id. */
  readonly desc: string;
  /** Absent means unquantified: "salt to taste" and ledger-exempt. */
  readonly qty?: Fraction;
  /** Always present in the model. Meaningful only when `qty` is. */
  readonly unit: UnitName;
};

export type StepNode = {
  readonly id: string;
  readonly desc: string;
  readonly uses: readonly Draw[];
  /** Viewer timer hint in seconds. */
  readonly timeSec?: number;
};

/** One row of the ledger: how much was declared against how much is drawn. */
export type LedgerEntry = {
  readonly ingredient: string;
  readonly declared: Fraction;
  readonly drawn: Fraction;
  readonly balanced: boolean;
};

export type RecipeInput = {
  readonly title: string;
  readonly servings: number;
  readonly ingredients: readonly IngredientNode[];
  readonly steps: readonly StepNode[];
};

export type Recipe = RecipeInput & {
  /** Topological order, preparation steps first, file order as tie-break. */
  readonly order: readonly string[];
  /** Reverse edges: node id → the steps that draw from it. */
  readonly consumers: Readonly<Record<string, readonly string[]>>;
  /** One entry per quantified ingredient. */
  readonly ledger: readonly LedgerEntry[];
};

function toDraw(use: UseWire): Draw | undefined {
  if (typeof use === "string") return { id: use };
  if (use.qty === undefined) return { id: use.id };
  const qty = parseQuantity(use.qty);
  if (qty === null) return undefined;
  return { id: use.id, qty };
}

/**
 * Turns a structurally valid recipe into the model, applying defaults and
 * parsing the values the wire schema could only describe: quantities, durations
 * and the `unit`-without-`qty` rule.
 *
 * Structural problems were already found by the wire schema. The diagnostics
 * returned here carry a `path` but no `range`: the caller owns the source text
 * and attaches the position (see `parse/validate.ts`).
 */
export function toModel(
  wire: RecipeWire,
): { model: RecipeInput } | { diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const ingredients: IngredientNode[] = [];

  wire.ingredients.forEach((ingredient, index) => {
    const path = ["ingredients", index] as const;
    let qty: Fraction | undefined;
    if (ingredient.qty !== undefined) {
      const parsed = parseQuantity(ingredient.qty);
      if (parsed === null) {
        diagnostics.push(
          diagnostic({
            code: "schema/invalid-quantity",
            message: `"qty" must be a number, or a fraction such as "1/2" or "0.5", not ${JSON.stringify(ingredient.qty)}`,
            path: [...path, "qty"],
          }),
        );
      } else if (parsed.n <= 0) {
        diagnostics.push(
          diagnostic({
            code: "schema/out-of-range",
            message: `"qty" must be greater than 0, not ${format(parsed)}`,
            path: [...path, "qty"],
          }),
        );
      } else {
        qty = parsed;
      }
    }

    if (ingredient.unit !== undefined) {
      if (!isUnitName(ingredient.unit)) {
        diagnostics.push(
          diagnostic({
            code: "schema/invalid-unit",
            message: `"${ingredient.unit}" is not a known unit`,
            path: [...path, "unit"],
          }),
        );
      } else if (qty === undefined && ingredient.qty === undefined) {
        diagnostics.push(
          diagnostic({
            code: "schema/unit-without-qty",
            message: `"unit" needs a "qty" next to it: an ingredient without an amount is "to taste" and has no unit`,
            path: [...path, "unit"],
            hint: `remove "unit", or give the ingredient a quantity`,
          }),
        );
      }
    }

    ingredients.push({
      id: ingredient.id,
      desc: ingredient.desc ?? ingredient.id,
      ...(qty === undefined ? {} : { qty }),
      unit: isUnitName(ingredient.unit) ? ingredient.unit : DEFAULT_UNIT,
    });
  });

  const steps: StepNode[] = [];
  wire.steps.forEach((step, index) => {
    const path = ["steps", index] as const;
    const uses: Draw[] = [];
    step.uses.forEach((use, useIndex) => {
      const draw = toDraw(use);
      if (draw === undefined) {
        diagnostics.push(
          diagnostic({
            code: "schema/invalid-quantity",
            message: `"qty" must be a number, or a fraction such as "1/2" or "0.5"`,
            path: [...path, "uses", useIndex, "qty"],
          }),
        );
        return;
      }
      uses.push(draw);
    });

    let timeSec: number | undefined;
    if (step.time !== undefined) {
      const parsed = parseDuration(step.time);
      if (parsed === null) {
        diagnostics.push(
          diagnostic({
            code: "schema/invalid-duration",
            message: `"time" must be a duration such as "5m", "1h30m" or "PT5M", or a whole number of minutes`,
            path: [...path, "time"],
          }),
        );
      } else {
        timeSec = parsed;
      }
    }

    steps.push({
      id: step.id,
      desc: step.desc ?? step.id,
      uses,
      ...(timeSec === undefined ? {} : { timeSec }),
    });
  });

  if (diagnostics.length > 0) return { diagnostics };
  return { model: { title: wire.title, servings: wire.servings, ingredients, steps } };
}
