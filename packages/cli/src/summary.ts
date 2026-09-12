/**
 * `yumml parse --summary`: the model rendered for a human, which is the one
 * place in this package that decides what a recipe looks like on a terminal.
 *
 * The layout is deliberately plain text: ingredients as written, steps in
 * cooking order, and the ledger last — a reader who skips the ledger still has a
 * readable recipe, and a reader who reads it sees why the amounts add up.
 */

import { format, type Recipe, type UnitName } from "@yumml/yumml";

function amount(qty: string | undefined, unit: UnitName): string {
  return qty === undefined ? "" : `${qty} ${unit}`;
}

function seconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [h > 0 ? `${h}h` : "", m > 0 ? `${m}m` : "", s > 0 ? `${s}s` : ""];
  return parts.filter((part) => part !== "").join("") || "0s";
}

export function formatSummary(recipe: Recipe): string {
  const lines: string[] = [];
  lines.push(`${recipe.title} (servings: ${recipe.servings})`);
  lines.push("");

  const width = Math.max(
    ...recipe.ingredients.map(
      (ingredient) =>
        amount(
          ingredient.qty === undefined ? undefined : format(ingredient.qty),
          ingredient.unit,
        ).length,
    ),
    0,
  );
  lines.push(`Ingredients (${recipe.ingredients.length})`);
  for (const ingredient of recipe.ingredients) {
    const left = amount(
      ingredient.qty === undefined ? undefined : format(ingredient.qty),
      ingredient.unit,
    );
    lines.push(`  ${left.padEnd(width)}  ${ingredient.desc}`);
  }
  lines.push("");

  const byId = new Map(recipe.steps.map((step) => [step.id, step]));
  lines.push(`Steps (${recipe.steps.length}, in cooking order)`);
  recipe.order.forEach((id, index) => {
    const step = byId.get(id);
    if (!step) return;
    const uses = step.uses
      .map((draw) =>
        draw.qty === undefined ? draw.id : `${draw.id} ${format(draw.qty)}`,
      )
      .join(", ");
    const rest = [
      uses === "" ? "" : `uses ${uses}`,
      step.timeSec === undefined ? "" : `timer ${seconds(step.timeSec)}`,
    ]
      .filter((part) => part !== "")
      .join("  |  ");
    lines.push(`  ${String(index + 1).padStart(2)}. ${step.id.padEnd(12)} ${step.desc}`);
    if (rest !== "") lines.push(`      ${" ".repeat(12)}  ${rest}`);
  });
  lines.push("");

  lines.push("Ledger");
  if (recipe.ledger.length === 0) lines.push("  nothing to balance");
  for (const entry of recipe.ledger) {
    const ingredient = recipe.ingredients.find((i) => i.id === entry.ingredient);
    const unit = ingredient?.unit ?? "item";
    const declared =
      `  ${entry.ingredient.padEnd(12)} declared ${format(entry.declared)} ${unit}`.padEnd(
        38,
      );
    const drawn = `drawn ${format(entry.drawn)} ${unit}`;
    const verdict = entry.balanced ? "ok" : "UNBALANCED";
    lines.push(`${declared}${drawn}  ${verdict}`);
  }
  return `${lines.join("\n")}\n`;
}
