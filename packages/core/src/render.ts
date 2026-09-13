import { format } from "./model/fraction.ts";
import type { IngredientNode, Recipe, StepNode } from "./model/recipe.ts";
import {
  columnColor,
  RECIPE_COLORS,
  type RecipeColors,
  recipeColors,
  stageColumns,
} from "./render/palette.ts";

export type { RecipeColor, RecipeColors, StageColumns } from "./render/palette.ts";
/**
 * The drawing's colours are part of this entry too: a caller that renders the flow
 * itself needs the same ten hues core paints the bands in, and the same row tints the
 * chips wear.
 */
export { columnColor, RECIPE_COLORS, recipeColors, stageColumns };

const STYLES = `
.yumml-vis {
  --yv-ink: #22303c;
  --yv-line: #d8d9d5;
  --yv-paper: #fffdfa;
  --yv-focus: #025956;
  --yv-row-height: clamp(3.25rem, 4.5vw, 3.75rem);
  container-type: inline-size;
  box-sizing: border-box;
  width: 100%;
  overflow: hidden;
  border: 1px solid #deddd8;
  border-radius: clamp(1rem, 2.5vw, 1.75rem);
  background: #f1eee8;
  color: var(--yv-ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  box-shadow: 0 1rem 3rem rgb(34 48 60 / 8%);
}
.yumml-vis, .yumml-vis * { box-sizing: border-box; }
.yumml-vis .yv-header { display: flex; align-items: end; justify-content: space-between; gap: 1rem; padding: clamp(1.25rem, 4vw, 2.5rem); }
.yumml-vis .yv-title { margin: 0; font-size: clamp(1.5rem, 4vw, 2.5rem); line-height: 1.05; letter-spacing: -.035em; }
.yumml-vis .yv-servings { flex: none; margin: 0; border-radius: 999px; background: rgb(255 255 255 / 72%); padding: .45rem .75rem; color: #5a646d; font-size: .875rem; font-weight: 650; }
.yumml-vis .yv-prep { display: grid; gap: .65rem; margin: 0; padding: 0 clamp(1rem, 3vw, 2rem) clamp(1rem, 3vw, 2rem); list-style: none; }
.yumml-vis .yv-prep-item { display: flex; align-items: center; gap: .85rem; min-height: 3.75rem; border: 1px solid var(--yv-line); border-radius: 1rem; background: var(--yv-paper); padding: .65rem 1rem; font-weight: 700; box-shadow: 0 .15rem .5rem rgb(34 48 60 / 4%); }
.yumml-vis .yv-number { display: inline-grid; flex: none; width: 2rem; height: 2rem; place-items: center; border-radius: 50%; background: var(--yv-ink); color: white; font-variant-numeric: tabular-nums; }
.yumml-vis .yv-viewport { margin: 0 clamp(.75rem, 2vw, 2rem) clamp(.75rem, 2vw, 2rem); overflow-x: auto; border: 1px solid var(--yv-line); border-radius: 1.25rem; background: var(--yv-paper); scrollbar-color: #aeb4b6 transparent; }
/* The ring is the page's, not the recipe's: it is the same action colour the cookbook uses. */
.yumml-vis .yv-viewport:focus-visible { outline: .2rem solid var(--yv-focus); outline-offset: .15rem; }
.yumml-vis .yv-flow { display: grid; width: 100%; grid-template-columns: clamp(16rem, 40cqi, 40rem) minmax(0, 1fr); padding: 1rem; }
.yumml-vis .yv-ingredients { position: relative; z-index: 2; overflow: hidden; border: 1px solid #cfd4d3; border-radius: .7rem 0 0 .7rem; }
.yumml-vis .yv-ingredient { display: flex; min-height: var(--yv-row-height); align-items: center; gap: .45rem; border-bottom: 1px solid #cfd4d3; background: var(--yv-row-tint); padding: .6rem .85rem; font-size: .9rem; line-height: 1.25; }
.yumml-vis .yv-ingredient:last-child { border-bottom: 0; }
.yumml-vis .yv-quantity { flex: none; font-weight: 750; }
.yumml-vis .yv-empty { color: #68727a; font-style: italic; }
.yumml-vis .yv-stages { display: grid; min-width: 0; grid-template-columns: repeat(var(--yv-stage-count), minmax(6rem, 1fr)); }
.yumml-vis .yv-stage-column { display: grid; min-width: 0; grid-template-columns: repeat(var(--yv-lane-count), minmax(0, 1fr)); grid-template-rows: repeat(var(--yv-row-count), var(--yv-row-height)); }
.yumml-vis .yv-stage { display: grid; min-width: 0; grid-template-rows: repeat(var(--yv-row-count), var(--yv-row-height)); }
/* A band is a pastel, so its words are the hue's own ink and never white. */
.yumml-vis .yv-stage-band { position: relative; display: grid; min-height: var(--yv-row-height); place-items: center; border-inline-start: 1px solid color-mix(in srgb, var(--yv-on-fill) 28%, transparent); background: var(--yv-fill); color: var(--yv-on-fill); text-align: center; }
/*
  The chevron points into the next column, so it is outlined on the side that overlaps
  it: the board strokes the band and its point as one shape, and a line between a band
  and its own chevron would be a seam the drawing does not have. Two pastel fills of
  the same lightness is a hue-only edge, and this is what keeps the point a point for a
  reader who cannot see that hue.
*/
.yumml-vis .yv-stage-arrow { z-index: 3; align-self: center; justify-self: end; width: 1.6rem; height: 1.6rem; margin-right: -.8rem; background: var(--yv-fill); clip-path: polygon(0 0, 100% 50%, 0 100%, 25% 50%); filter: drop-shadow(1px 0 0 color-mix(in srgb, var(--yv-on-fill) 40%, transparent)); pointer-events: none; }
.yumml-vis .yv-stage-content { position: sticky; left: 0; z-index: 4; display: grid; max-width: 100%; justify-items: center; gap: .2rem; padding: .35rem .3rem; }
.yumml-vis .yv-stage .yv-number { width: 1.7rem; height: 1.7rem; background: var(--yv-paper); color: var(--yv-on-fill); font-weight: 800; }
.yumml-vis .yv-stage-label { overflow-wrap: anywhere; font-size: clamp(.72rem, 1.4vw, .9rem); font-weight: 750; line-height: 1.08; }
.yumml-vis .yv-duration { font-size: .7rem; font-weight: 650; opacity: .9; }
.yumml-vis .yv-no-stages { display: grid; place-items: center; color: #68727a; font-size: .875rem; }
@container (max-width: 40rem) {
  .yumml-vis .yv-header { align-items: start; flex-direction: column; }
  .yumml-vis .yv-servings { order: -1; }
  .yumml-vis .yv-flow { grid-template-columns: 13rem auto; padding: .6rem; }
  .yumml-vis .yv-stages { grid-template-columns: repeat(var(--yv-stage-count), minmax(6.25rem, 1fr)); }
  .yumml-vis .yv-ingredient { padding-inline: .75rem; }
}
@media (prefers-reduced-motion: no-preference) {
  .yumml-vis .yv-viewport { scroll-behavior: smooth; }
}
`;

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function displayIngredient(ingredient: IngredientNode): [string, string] {
  if (ingredient.qty === undefined) return ["", ingredient.desc];
  const unit = ingredient.unit === "item" ? "" : ` ${ingredient.unit}`;
  return [`${format(ingredient.qty)}${unit}`, ingredient.desc];
}

function displayDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [
    hours > 0 ? `${hours} hr` : "",
    minutes > 0 ? `${minutes} min` : "",
    remainder > 0 ? `${remainder} sec` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function ingredientAncestors(
  step: StepNode,
  ingredients: ReadonlySet<string>,
  steps: ReadonlyMap<string, StepNode>,
  cache: Map<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const cached = cache.get(step.id);
  if (cached) return cached;
  const result = new Set<string>();
  for (const draw of step.uses) {
    if (ingredients.has(draw.id)) result.add(draw.id);
    const producer = steps.get(draw.id);
    if (producer) {
      for (const id of ingredientAncestors(producer, ingredients, steps, cache)) {
        result.add(id);
      }
    }
  }
  cache.set(step.id, result);
  return result;
}

type StageColumn = readonly StepNode[];

type StagePlacement = {
  readonly step: StepNode;
  readonly start: number;
  readonly end: number;
  readonly lane: number;
};

/** Orders ingredient rows by walking each terminal branch back to its sources. */
function orderedIngredients(
  recipe: Recipe,
  orderedSteps: readonly StepNode[],
): IngredientNode[] {
  const ingredients = new Map(
    recipe.ingredients.map((ingredient) => [ingredient.id, ingredient]),
  );
  const steps = new Map(orderedSteps.map((step) => [step.id, step]));
  const seenIngredients = new Set<string>();
  const seenSteps = new Set<string>();
  const ordered: IngredientNode[] = [];

  function visit(step: StepNode): void {
    if (seenSteps.has(step.id)) return;
    seenSteps.add(step.id);
    for (const draw of step.uses) {
      const ingredient = ingredients.get(draw.id);
      if (ingredient !== undefined && !seenIngredients.has(ingredient.id)) {
        seenIngredients.add(ingredient.id);
        ordered.push(ingredient);
      }
      const producer = steps.get(draw.id);
      if (producer !== undefined) visit(producer);
    }
  }

  for (const step of orderedSteps) {
    if ((recipe.consumers[step.id]?.length ?? 0) === 0) visit(step);
  }
  return [...ordered, ...recipe.ingredients.filter(({ id }) => !seenIngredients.has(id))];
}

function stagePlacements(
  stages: StageColumn,
  ingredientIds: ReadonlySet<string>,
  ingredientIndex: ReadonlyMap<string, number>,
  stepById: ReadonlyMap<string, StepNode>,
  cache: Map<string, ReadonlySet<string>>,
  rowCount: number,
): StagePlacement[] {
  const lanes: StagePlacement[][] = [];
  return stages.map((step) => {
    const indices = [...ingredientAncestors(step, ingredientIds, stepById, cache)]
      .map((id) => ingredientIndex.get(id))
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b);
    const placement = {
      step,
      start: indices[0] ?? 0,
      end: indices.at(-1) ?? rowCount - 1,
      lane: 0,
    };
    const lane = lanes.findIndex((items) =>
      items.every(({ start, end }) => end < placement.start || placement.end < start),
    );
    placement.lane = lane === -1 ? lanes.length : lane;
    const target = lanes[placement.lane];
    if (target === undefined) lanes[placement.lane] = [placement];
    else target.push(placement);
    return placement;
  });
}

function appendPreparation(
  document: Document,
  root: HTMLElement,
  prep: readonly StepNode[],
  numbers: ReadonlyMap<string, number>,
): void {
  if (prep.length === 0) return;
  const list = element(document, "ol", "yv-prep");
  list.setAttribute("aria-label", "Preparation");
  for (const step of prep) {
    const item = element(document, "li", "yv-prep-item");
    item.dataset.nodeId = step.id;
    item.append(
      element(document, "span", "yv-number", String(numbers.get(step.id))),
      element(document, "span", "yv-prep-text", step.desc),
    );
    if (step.timeSec !== undefined) {
      item.append(
        element(document, "span", "yv-duration", displayDuration(step.timeSec)),
      );
    }
    list.append(item);
  }
  root.append(list);
}

function fillIngredients(
  document: Document,
  list: HTMLElement,
  ingredients: readonly IngredientNode[],
  colors: RecipeColors,
): void {
  if (ingredients.length === 0) {
    list.append(element(document, "div", "yv-ingredient yv-empty", "No ingredients"));
    return;
  }
  for (const ingredient of ingredients) {
    const row = element(document, "div", "yv-ingredient");
    row.dataset.nodeId = ingredient.id;
    row.setAttribute("role", "listitem");
    // Every ingredient of a recipe that parsed has a colour; the first column's is the
    // one a model that did not come from the parser falls back to.
    const color = colors.ingredients.get(ingredient.id) ?? columnColor(0);
    row.style.setProperty("--yv-row-tint", color.tint);
    const [quantity, description] = displayIngredient(ingredient);
    if (quantity !== "") row.append(element(document, "span", "yv-quantity", quantity));
    row.append(element(document, "span", "yv-ingredient-label", description));
    list.append(row);
  }
}

function fillStages(
  document: Document,
  list: HTMLElement,
  ingredients: readonly IngredientNode[],
  columns: readonly StageColumn[],
  stepById: ReadonlyMap<string, StepNode>,
  numbers: ReadonlyMap<string, number>,
  rowCount: number,
): void {
  if (columns.length === 0) {
    list.className += " yv-no-stages";
    list.textContent = "Preparation only";
    return;
  }
  const ingredientIds = new Set(ingredients.map((ingredient) => ingredient.id));
  const ingredientIndex = new Map(
    ingredients.map((ingredient, index) => [ingredient.id, index]),
  );
  const ancestorCache = new Map<string, ReadonlySet<string>>();
  for (const [index, stages] of columns.entries()) {
    // One hue per column, laps included: `columnColor` is what `recipeColors` reads
    // too, so a band and the chip that names its ingredient cannot drift apart.
    const color = columnColor(index);
    const placements = stagePlacements(
      stages,
      ingredientIds,
      ingredientIndex,
      stepById,
      ancestorCache,
      rowCount,
    );
    const column = element(document, "div", "yv-stage-column");
    column.style.setProperty(
      "--yv-lane-count",
      String(Math.max(...placements.map(({ lane }) => lane + 1))),
    );
    for (const { step, start, end, lane } of placements) {
      const stage = element(document, "div", "yv-stage");
      stage.dataset.nodeId = step.id;
      stage.style.setProperty("--yv-fill", color.fill);
      stage.style.setProperty("--yv-on-fill", color.ink);
      stage.style.setProperty("grid-column", String(lane + 1));
      stage.style.setProperty("grid-row", `1 / span ${rowCount}`);
      // The band and the number inherit the two roles off the stage; the chevron is a
      // sibling of the stage, so it takes its own copy.
      const band = element(document, "div", "yv-stage-band");
      band.style.setProperty("grid-row", `${start + 1} / span ${end - start + 1}`);
      const content = element(document, "div", "yv-stage-content");
      content.append(
        element(document, "span", "yv-number", String(numbers.get(step.id))),
        element(document, "span", "yv-stage-label", step.id),
      );
      if (step.timeSec !== undefined) {
        content.append(
          element(document, "span", "yv-duration", displayDuration(step.timeSec)),
        );
      }
      band.append(content);
      stage.append(band);
      column.append(stage);
      if (index < columns.length - 1) {
        const arrow = element(document, "div", "yv-stage-arrow");
        arrow.setAttribute("aria-hidden", "true");
        arrow.style.setProperty("--yv-fill", color.fill);
        arrow.style.setProperty("--yv-on-fill", color.ink);
        arrow.style.setProperty("grid-column", "1 / -1");
        arrow.style.setProperty("grid-row", `${start + 1} / span ${end - start + 1}`);
        column.append(arrow);
      }
    }
    list.append(column);
  }
}

/**
 * Renders a responsive, fully client-side visualization of a checked Recipe.
 * Existing children of `target` are replaced. The returned element is the
 * visualization root.
 */
export function renderRecipe(recipe: Recipe, target: HTMLElement): HTMLElement {
  const document = target.ownerDocument;
  const stepById = new Map(recipe.steps.map((step) => [step.id, step]));
  const orderedSteps = recipe.order
    .map((id) => stepById.get(id))
    .filter((step): step is StepNode => step !== undefined);
  const numbers = new Map(orderedSteps.map((step, index) => [step.id, index + 1]));
  const prep = orderedSteps.filter((step) => step.uses.length === 0);
  const columns = stageColumns(orderedSteps);
  const ingredients = orderedIngredients(recipe, orderedSteps);
  const colors = recipeColors(recipe);
  const rowCount = Math.max(ingredients.length, 1);
  const stageCount = Math.max(columns.length, 1);

  const root = element(document, "section", "yumml-vis");
  root.setAttribute("aria-label", `${recipe.title} recipe flow`);
  root.style.setProperty("--yv-row-count", String(rowCount));
  root.style.setProperty("--yv-stage-count", String(stageCount));

  const style = element(document, "style", "", STYLES);
  const header = element(document, "header", "yv-header");
  header.append(
    element(document, "h2", "yv-title", recipe.title),
    element(
      document,
      "p",
      "yv-servings",
      `${recipe.servings} ${recipe.servings === 1 ? "serving" : "servings"}`,
    ),
  );
  root.append(style, header);

  appendPreparation(document, root, prep, numbers);

  const viewport = element(document, "div", "yv-viewport");
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", "Ingredients and cooking steps");
  const flow = element(document, "div", "yv-flow");
  const ingredientList = element(document, "div", "yv-ingredients");
  ingredientList.setAttribute("role", "list");

  fillIngredients(document, ingredientList, ingredients, colors);

  const stageList = element(document, "div", "yv-stages");
  fillStages(document, stageList, ingredients, columns, stepById, numbers, rowCount);

  flow.append(ingredientList, stageList);
  viewport.append(flow);
  root.append(viewport);
  target.replaceChildren(root);
  return root;
}
