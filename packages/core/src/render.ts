import { format } from "./model/fraction.ts";
import type { IngredientNode, Recipe, StepNode } from "./model/recipe.ts";

const COLORS = ["#168477", "#397da8", "#6555a6", "#9f4f79", "#b9682f"] as const;

const STYLES = `
.yumml-vis {
  --yv-ink: #22303c;
  --yv-line: #d8d9d5;
  --yv-paper: #fffdfa;
  --yv-row-height: clamp(4.25rem, 6vw, 5.25rem);
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
.yumml-vis .yv-viewport:focus-visible { outline: .2rem solid #397da8; outline-offset: .15rem; }
.yumml-vis .yv-flow { display: grid; width: 100%; grid-template-columns: clamp(16rem, 40cqi, 40rem) minmax(0, 1fr); padding: 1rem; }
.yumml-vis .yv-ingredients { position: relative; z-index: 2; overflow: hidden; border: 1px solid #cfd4d3; border-radius: .7rem 0 0 .7rem; }
.yumml-vis .yv-ingredient { display: flex; min-height: var(--yv-row-height); align-items: center; gap: .45rem; border-bottom: 1px solid #cfd4d3; background: #f7faf9; background: color-mix(in srgb, var(--yv-row-color) 8%, white); padding: .75rem 1rem; line-height: 1.25; }
.yumml-vis .yv-ingredient:last-child { border-bottom: 0; }
.yumml-vis .yv-quantity { flex: none; font-weight: 750; }
.yumml-vis .yv-empty { color: #68727a; font-style: italic; }
.yumml-vis .yv-stages { display: grid; min-width: 0; grid-template-columns: repeat(var(--yv-stage-count), minmax(6rem, 1fr)); }
.yumml-vis .yv-stage { display: grid; min-width: 0; grid-template-rows: repeat(var(--yv-row-count), var(--yv-row-height)); }
.yumml-vis .yv-stage-band { position: relative; display: grid; min-height: var(--yv-row-height); place-items: center; border-inline-start: 1px solid rgb(0 0 0 / 18%); background: var(--yv-color); color: white; text-align: center; }
.yumml-vis .yv-stage:not(:last-child) .yv-stage-band::after { position: absolute; z-index: 3; right: -.8rem; width: 1.6rem; height: 1.6rem; background: var(--yv-color); content: ""; clip-path: polygon(0 0, 100% 50%, 0 100%, 25% 50%); }
.yumml-vis .yv-stage-content { position: sticky; left: 0; z-index: 4; display: grid; max-width: 100%; justify-items: center; gap: .35rem; padding: .7rem .4rem; }
.yumml-vis .yv-stage .yv-number { background: white; color: var(--yv-color); font-weight: 800; }
.yumml-vis .yv-stage-label { overflow-wrap: anywhere; font-size: clamp(.82rem, 1.6vw, 1rem); font-weight: 750; line-height: 1.08; }
.yumml-vis .yv-duration { font-size: .75rem; font-weight: 650; opacity: .9; }
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
  recipe: Recipe,
  stageIndex: ReadonlyMap<string, number>,
): void {
  if (recipe.ingredients.length === 0) {
    list.append(element(document, "div", "yv-ingredient yv-empty", "No ingredients"));
    return;
  }
  for (const ingredient of recipe.ingredients) {
    const row = element(document, "div", "yv-ingredient");
    row.dataset.nodeId = ingredient.id;
    row.setAttribute("role", "listitem");
    const firstConsumer = recipe.consumers[ingredient.id]?.[0];
    const colorIndex =
      firstConsumer === undefined ? 0 : (stageIndex.get(firstConsumer) ?? 0);
    row.style.setProperty(
      "--yv-row-color",
      COLORS[colorIndex % COLORS.length] ?? COLORS[0],
    );
    const [quantity, description] = displayIngredient(ingredient);
    if (quantity !== "") row.append(element(document, "span", "yv-quantity", quantity));
    row.append(element(document, "span", "yv-ingredient-label", description));
    list.append(row);
  }
}

function fillStages(
  document: Document,
  list: HTMLElement,
  recipe: Recipe,
  stages: readonly StepNode[],
  stepById: ReadonlyMap<string, StepNode>,
  numbers: ReadonlyMap<string, number>,
  rowCount: number,
): void {
  if (stages.length === 0) {
    list.className += " yv-no-stages";
    list.textContent = "Preparation only";
    return;
  }
  const ingredientIds = new Set(recipe.ingredients.map((ingredient) => ingredient.id));
  const ingredientIndex = new Map(
    recipe.ingredients.map((ingredient, index) => [ingredient.id, index]),
  );
  const ancestorCache = new Map<string, ReadonlySet<string>>();
  for (const [index, step] of stages.entries()) {
    const indices = [...ingredientAncestors(step, ingredientIds, stepById, ancestorCache)]
      .map((id) => ingredientIndex.get(id))
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b);
    const start = indices[0] ?? 0;
    const end = indices.at(-1) ?? rowCount - 1;
    const color = COLORS[index % COLORS.length] ?? COLORS[0];
    const stage = element(document, "div", "yv-stage");
    stage.dataset.nodeId = step.id;
    stage.style.setProperty("--yv-color", color);
    const band = element(document, "div", "yv-stage-band");
    band.style.setProperty("grid-row", `${start + 1} / span ${end - start + 1}`);
    band.style.setProperty("--yv-color", color);
    const content = element(document, "div", "yv-stage-content");
    content.append(
      element(document, "span", "yv-number", String(numbers.get(step.id))),
      element(document, "span", "yv-stage-label", step.desc),
    );
    if (step.timeSec !== undefined) {
      content.append(
        element(document, "span", "yv-duration", displayDuration(step.timeSec)),
      );
    }
    band.append(content);
    stage.append(band);
    list.append(stage);
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
  const stages = orderedSteps.filter((step) => step.uses.length > 0);
  const stageIndex = new Map(stages.map((step, index) => [step.id, index]));
  const rowCount = Math.max(recipe.ingredients.length, 1);
  const stageCount = Math.max(stages.length, 1);

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

  fillIngredients(document, ingredientList, recipe, stageIndex);

  const stageList = element(document, "div", "yv-stages");
  fillStages(document, stageList, recipe, stages, stepById, numbers, rowCount);

  flow.append(ingredientList, stageList);
  viewport.append(flow);
  root.append(viewport);
  target.replaceChildren(root);
  return root;
}
