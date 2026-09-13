/**
 * The recipe page.
 *
 * The board, top to bottom: the title and its chips, the source card, the dark
 * timer bar, the current-step strip, and the whole flow with a ring around the
 * step you are on. Nothing here is interactive yet — the timer bar shows the
 * first step and the dots sit where a script will later move them — and that
 * means that, with no script at all, this page is
 * still a recipe you can read and cook from.
 *
 * The strip is where a step's `desc` belongs. The bands in the drawing are 144px
 * wide and carry the step's id, exactly as the board does it: its "fold in" band
 * sits under a strip reading "Fold in the flour, cocoa and salt until just
 * glossy".
 *
 * The page is also the contract the client script reads: **every step's
 * strip is rendered**, with all but the current one `hidden`, and the bar's name is
 * read off the visible strip. That is what keeps the script to DOM wiring — moving
 * to step 5 unhides a section the server wrote, rather than recomputing amounts and
 * chips in a browser — and it is why the strips are the one part of this page
 * that costs a document per step instead of one.
 */

import { format, type Recipe, type StepNode } from "@yumml/yumml";
import type { IndexedRecipe } from "../scan.ts";
import { formatAge, formatClock, formatDuration, labelOf, plural } from "./format.ts";
import { type Html, html } from "./html.ts";
import { recipeHref, renderPage } from "./page.ts";

export type DetailOptions = {
  /** The whole tree's recipe count, for the nav. */
  readonly recipes: number;
  readonly version: string;
  /** The clock the "changed N ago" line reads. Passed in so tests can pin it. */
  readonly now: number;
};

const ROW_TINTS = ["#eef6f5", "#eef4f7", "#f0f0f7", "#f7f0f4", "#f9f3ef"] as const;

/** The step a page shows when nothing has moved yet: the first one in order. */
export function firstStep(recipe: Recipe): StepNode | undefined {
  const first = recipe.order[0];
  return recipe.steps.find((step) => step.id === first) ?? recipe.steps[0];
}

/** The sum of the steps' `time` hints, or 0 when none of them has one. */
function totalSeconds(recipe: Recipe): number {
  return recipe.steps.reduce((total, step) => total + (step.timeSec ?? 0), 0);
}

/**
 * What a step takes in, as the chips the board shows: an ingredient is labelled
 * with its amount and its name, a step with its name, and the ingredient chips
 * wear the same tint their row has in the drawing, which is how the strip and the
 * flow are made to look like the same thing.
 */
function draws(recipe: Recipe, step: StepNode): Html {
  if (step.uses.length === 0) {
    return html`<span class="uses-none">no ingredients — a preparation step</span>`;
  }
  const rowOf = new Map(recipe.ingredients.map((item, index) => [item.id, index]));
  const byId = new Map(recipe.steps.map((candidate) => [candidate.id, candidate]));

  return html`${step.uses.map((draw) => {
    const ingredient = recipe.ingredients.find((item) => item.id === draw.id);
    if (ingredient !== undefined) {
      // What *this step* draws, which is not always what the ingredient declares:
      // `melt` takes a quarter of the butter, and saying "1/2 cup" there would be a
      // lie about the recipe. The same tint the ingredient's row has in the
      // drawing, so the strip and the flow read as one picture.
      const tint = ROW_TINTS[(rowOf.get(ingredient.id) ?? 0) % ROW_TINTS.length];
      const label =
        draw.qty === undefined
          ? labelOf(ingredient)
          : `${format(draw.qty)} ${ingredient.unit} ${ingredient.desc}`;
      return html`<span class="chip uses-chip" style="background: ${tint}">${label}</span>`;
    }
    const target = byId.get(draw.id);
    const label = target?.desc ?? draw.id;
    return html`<span class="chip uses-chip">${label}</span>`;
  })}`;
}

function timer(recipe: Recipe, step: StepNode | undefined): Html {
  const position = recipe.order.indexOf(step?.id ?? "") + 1;
  const total = recipe.order.length;
  const seconds = step?.timeSec;

  // Every control is rendered disabled, and the script enables the ones the
  // current state can use: with no script at all the bar is a display of the
  // first step rather than a row of buttons that do nothing.
  return html`
    <section class="timer" aria-label="Step timer">
      <button class="timer-prev" type="button" disabled>
        <span class="timer-chevron" aria-hidden="true">‹</span> Prev
      </button>
      <p class="timer-badge" aria-hidden="true">${String(position)}</p>
      <div class="timer-where">
        <p class="timer-position">STEP ${position} OF ${total}</p>
        <p class="timer-name">${step?.desc ?? ""}</p>
        <p class="timer-dots" aria-hidden="true">
          ${recipe.order.map(
            (id, index) =>
              html`<span
                class="timer-dot${index === 0 ? " timer-dot--on" : ""}"
                data-step="${id}"
              ></span>`,
          )}
        </p>
      </div>
      <div class="timer-clock">
        <p class="timer-digits">${seconds === undefined ? "--:--" : formatClock(seconds)}</p>
        <p class="timer-track" aria-hidden="true">
          <span class="timer-progress"></span>
        </p>
      </div>
      <button
        class="timer-play"
        type="button"
        disabled
        data-playing="false"
        aria-label="Start the timer"
      >
        <span class="timer-play-glyph" aria-hidden="true"></span>
      </button>
      <button class="timer-add" type="button" disabled>+ 1:00</button>
      <button
        class="timer-mute"
        type="button"
        disabled
        data-muted="false"
        aria-pressed="true"
        title="The chime when the countdown ends"
      >Chime</button>
      <button class="timer-next" type="button" disabled>
        Next step <span class="timer-chevron" aria-hidden="true">›</span>
      </button>
    </section>
  `;
}

/**
 * One step of the walk: its number, its `desc`, what it draws, and the time it
 * claims.
 *
 * Every step gets one of these, and all but the current are hidden — which is
 * what keeps the strip out of the script's hands. The chips carry the tints, the
 * amounts and the words that the drawing and the board use, so moving to another
 * step is unhiding a section rather than recomputing a recipe in a browser.
 * With no script, the one visible strip is the first step's.
 *
 * `data-seconds` is the step's budget, and the empty string means it has none:
 * that one attribute is how the client knows whether the digits read `--:--` or a
 * clock, and whether play and `+ 1:00` are enabled.
 */
function strip(
  recipe: Recipe,
  step: StepNode,
  position: number,
  current: string | undefined,
): Html {
  const seconds = step.timeSec;
  const hidden = step.id === current ? html`` : html` hidden`;
  return html`
    <section
      class="strip"
      data-step="${step.id}"
      data-seconds="${seconds === undefined ? "" : String(seconds)}"${hidden}
    >
      <p class="strip-badge" aria-hidden="true">${String(position)}</p>
      <div class="strip-text">
        <h2 class="strip-title">${step.desc}</h2>
        <p class="strip-uses">${draws(recipe, step)}</p>
      </div>
      <p class="strip-time">
        ${seconds === undefined ? "no time set" : formatDuration(seconds)}
      </p>
    </section>
  `;
}

/** One strip per step, in cooking order, with the current one showing. */
function strips(recipe: Recipe, current: string | undefined): Html {
  return html`${recipe.order.map((id, index) => {
    const step = recipe.steps.find((candidate) => candidate.id === id);
    return step === undefined ? "" : strip(recipe, step, index + 1, current);
  })}`;
}

function legend(): Html {
  return html`
    <p class="legend" aria-hidden="true">
      <span class="legend-item"><span class="legend-swatch legend-swatch--step"></span>step column</span>
      <span class="legend-item"><span class="legend-swatch legend-swatch--row"></span>ingredient row</span>
      <span class="legend-item"><span class="legend-swatch legend-swatch--prep"></span>prep</span>
    </p>
  `;
}

function head(entry: IndexedRecipe, recipe: Recipe, options: DetailOptions): Html {
  const seconds = totalSeconds(recipe);
  return html`
    <section class="recipe-head">
      <div class="recipe-heading">
        <h1 class="recipe-title">${recipe.title}</h1>
        <p class="recipe-meta">
          <span class="chip">${plural(recipe.servings, "serving", "servings")}</span>
          <span class="chip">${plural(recipe.ingredients.length, "ingredient", "ingredients")}</span>
          <span class="chip">${plural(recipe.steps.length, "step", "steps")}</span>
          ${
            seconds === 0
              ? ""
              : html`<span class="chip">${formatDuration(seconds)}</span>`
          }
        </p>
      </div>
      <aside class="source">
        <p class="source-file">
          <a href="${recipeHref(entry.slug)}.yaml">${entry.relPath}</a>
        </p>
        <p class="source-line">schema yumml v1</p>
        <p class="source-line">changed ${formatAge(entry.mtimeMs, options.now)}</p>
      </aside>
    </section>
  `;
}

/** The whole document for a recipe that parses. */
export function renderRecipePage(
  entry: IndexedRecipe,
  recipe: Recipe,
  options: DetailOptions,
  current?: StepNode,
): Html {
  const step = current ?? firstStep(recipe);
  return renderPage({
    title: recipe.title,
    recipes: options.recipes,
    query: "",
    filter: "all",
    version: options.version,
    body: html`
      ${head(entry, recipe, options)} ${timer(recipe, step)}
      ${strips(recipe, step?.id)}
      <section class="flow-panel">
        <div class="flow-head">
          <div>
            <h2 class="flow-title">How it flows</h2>
            <p class="flow-sub">
              Every column is a step. Its height is what it takes in — read left to right.
            </p>
          </div>
          ${legend()}
        </div>
        <div class="flow-frame" data-yumml-recipe="${JSON.stringify(recipe)}"></div>
      </section>
    `,
  });
}
