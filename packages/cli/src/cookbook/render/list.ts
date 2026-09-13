/**
 * The list page: every recipe in the tree, and whether it is any good
 *
 *
 * Three rules are visible in every line below:
 *
 * - a recipe that checks out says nothing. There is no validity chip, no
 *   tick, no count of zero. The loud thing on this page is a file that failed,
 *   and it is loud by carrying the diagnostic that failed it;
 * - a file that does not parse is still a card. It cannot be drawn, so it
 *   shows why instead;
 * - search and filtering are this file's job, on the server, so the list a
 *   filter produces is a URL somebody can send.
 */

import type { Diagnostic, Recipe } from "@yumml/yumml";
import type { CookbookIndex, IndexedRecipe } from "../scan.ts";
import { formatDuration, plural } from "./format.ts";
import { type Html, html } from "./html.ts";
import { type FilterName, filterHref, recipeHref, renderPage } from "./page.ts";

/** The `under 30 min` chip's threshold. */
export const QUICK_SECONDS = 30 * 60;

export type ListOptions = {
  readonly query: string;
  readonly filter: FilterName;
  readonly version: string;
};

export type Summary = {
  readonly recipes: number;
  readonly ingredients: number;
  readonly broken: number;
  readonly quick: number;
};

/** The sum of the steps' `time` hints. Zero means no step had one. */
export function totalSeconds(entry: IndexedRecipe): number {
  if (!entry.result.ok) return 0;
  return entry.result.recipe.steps.reduce(
    (total, step) => total + (step.timeSec ?? 0),
    0,
  );
}

/** The whole tree's totals. Ingredients are counted only where a model exists. */
export function summarize(recipes: readonly IndexedRecipe[]): Summary {
  let ingredients = 0;
  let broken = 0;
  let quick = 0;

  for (const entry of recipes) {
    if (!entry.result.ok) {
      broken += 1;
      continue;
    }
    ingredients += entry.result.recipe.ingredients.length;
    const seconds = totalSeconds(entry);
    if (seconds > 0 && seconds < QUICK_SECONDS) quick += 1;
  }

  return { recipes: recipes.length, ingredients, broken, quick };
}

/**
 * The search checks the title, the path, and every node's `desc` or `id`,
 * case-insensitively. A file that does not parse has only its path to be found
 * by, which is honest — there is no title to match.
 */
export function matches(entry: IndexedRecipe, needle: string): boolean {
  if (entry.relPath.toLowerCase().includes(needle)) return true;
  if (!entry.result.ok) return false;

  const { recipe } = entry.result;
  if (recipe.title.toLowerCase().includes(needle)) return true;
  return (
    recipe.ingredients.some(
      (item) => item.id.includes(needle) || item.desc.toLowerCase().includes(needle),
    ) ||
    recipe.steps.some(
      (step) => step.id.includes(needle) || step.desc.toLowerCase().includes(needle),
    )
  );
}

export function select(
  recipes: readonly IndexedRecipe[],
  options: { query: string; filter: FilterName },
): readonly IndexedRecipe[] {
  const needle = options.query.trim().toLowerCase();
  return recipes.filter((entry) => {
    if (needle !== "" && !matches(entry, needle)) return false;
    if (options.filter === "broken") return !entry.result.ok;
    if (options.filter === "quick") {
      const seconds = totalSeconds(entry);
      return seconds > 0 && seconds < QUICK_SECONDS;
    }
    return true;
  });
}

function stats(summary: Summary): Html {
  if (summary.recipes === 0) return html``;
  return html`
    <div class="stats">
      <p class="stat">
        <span class="stat-number">${String(summary.recipes)}</span>
        <span class="stat-label">recipes</span>
      </p>
      <p class="stat">
        <span class="stat-number">${String(summary.ingredients)}</span>
        <span class="stat-label">ingredients</span>
      </p>
      ${
        summary.broken === 0
          ? ""
          : html`<p class="stat stat--broken">
            <span class="stat-number">${String(summary.broken)}</span>
            <span class="stat-label">diagnostics</span>
          </p>`
      }
    </div>
  `;
}

function chips(summary: Summary, options: ListOptions): Html {
  if (summary.recipes === 0) return html``;

  const chip = (filter: FilterName, label: string) => {
    const current = options.filter === filter;
    return html`<a
      class="chip${current ? " chip--current" : ""}"
      href="${filterHref(filter, options.query)}"
      ${current ? html`aria-current="true"` : ""}
    >${label}</a>`;
  };

  return html`
    <nav class="chips" aria-label="Filter recipes">
      ${chip("all", `All · ${summary.recipes}`)}
      ${summary.broken === 0 ? "" : chip("broken", `broken · ${summary.broken}`)}
      ${summary.quick === 0 ? "" : chip("quick", `Under 30 min · ${summary.quick}`)}
    </nav>
  `;
}

/** A card for a recipe that parsed: the flow, the numbers, and nothing else. */
function goodCard(entry: IndexedRecipe, recipe: Recipe): Html {
  const seconds = totalSeconds(entry);
  return html`
    <a class="card" href="${recipeHref(entry.slug)}" data-recipe="${entry.slug}">
      <div class="card-flow" data-yumml-recipe="${JSON.stringify(recipe)}"></div>
      <div class="card-body">
        <h3 class="card-title">${recipe.title}</h3>
        <p class="card-meta">
          ${plural(recipe.servings, "serving", "servings")} ·
          ${plural(recipe.ingredients.length, "ingredient", "ingredients")} ·
          ${plural(recipe.steps.length, "step", "steps")}
        </p>
      </div>
      <div class="card-foot">
        <span class="chip chip--quiet">
          ${seconds === 0 ? "no time given" : formatDuration(seconds)}
        </span>
      </div>
    </a>
  `;
}

/**
 * A card for a file that did not parse. It has no title and no flow, so it
 * shows the first thing wrong with it and how many more there are.
 */
function brokenCard(entry: IndexedRecipe): Html {
  const diagnostics: readonly Diagnostic[] = entry.result.ok
    ? []
    : entry.result.diagnostics;
  const first = diagnostics[0];
  const rest = diagnostics.length - 1;
  const name = entry.slug.split("/").pop() ?? entry.slug;

  return html`
    <a class="card card--broken" href="${recipeHref(entry.slug)}" data-recipe="${entry.slug}">
      <div class="card-flow card-flow--broken">
        <p class="card-diagnostic">
          <span class="chip chip--broken">${first?.code ?? "error"}</span>
        </p>
        <p class="card-diagnostic-message">${first?.message ?? "not a recipe"}</p>
          ${
            rest <= 0
              ? ""
              : html`<p class="card-more">
              ${plural(rest, "more problem", "more problems")}
            </p>`
          }
      </div>
      <div class="card-body">
        <h3 class="card-title">${name}</h3>
        <p class="card-meta">${entry.relPath} · does not parse</p>
      </div>
    </a>
  `;
}

function results(
  shown: readonly IndexedRecipe[],
  summary: Summary,
  options: ListOptions,
): Html {
  const narrowed = options.filter !== "all" || options.query.trim() !== "";
  const heading = narrowed
    ? `${shown.length} of ${plural(summary.recipes, "recipe", "recipes")}`
    : "All recipes";

  if (shown.length === 0) {
    return html`
      <section class="results">
        <div class="results-head">
          <h2 class="results-title">${heading}</h2>
          ${narrowed ? html`<a class="results-clear" href="/">clear</a>` : ""}
        </div>
        <p class="empty">
          ${
            summary.recipes === 0
              ? "No recipes here yet. A recipe is a .yaml file with a title, ingredients and steps."
              : "Nothing matches that. Try another word, or clear the filter."
          }
        </p>
      </section>
    `;
  }

  return html`
    <section class="results">
      <div class="results-head">
        <h2 class="results-title">${heading}</h2>
        ${narrowed ? html`<a class="results-clear" href="/">clear</a>` : ""}
      </div>
      <div class="cards">
        ${shown.map((entry) =>
          entry.result.ok ? goodCard(entry, entry.result.recipe) : brokenCard(entry),
        )}
      </div>
    </section>
  `;
}

/** The whole document: nav, hero, chips, cards, footer. */
export function renderListPage(index: CookbookIndex, options: ListOptions): Html {
  const summary = summarize(index.recipes);
  const shown = select(index.recipes, options);

  const body = html`
    <section class="hero">
      <p class="eyebrow">Cookbook · ${plural(summary.recipes, "recipe", "recipes")}</p>
      <h1 class="hero-title">Every recipe, checked.</h1>
      ${stats(summary)}
    </section>
    ${
      index.truncated
        ? html`<p class="notice">
          Showing the first ${String(index.recipes.length)} recipes: this tree holds more.
          Point the cookbook at a recipe directory instead.
        </p>`
        : ""
    }
    ${chips(summary, options)} ${results(shown, summary, options)}
  `;

  return renderPage({
    title: "Cookbook",
    recipes: summary.recipes,
    query: options.query,
    filter: options.filter,
    version: options.version,
    body,
  });
}
