/**
 * A file that is not a recipe, shown as the verdict it got.
 *
 * A recipe that checks out says nothing, and a
 * file that does not says everything. Every diagnostic is here, in the order the
 * CLI prints them, with the same code frame — `formatDiagnostic` draws it, so the
 * browser and the terminal cannot disagree about where the problem is. The text
 * that goes into the frame is the file's own, byte for byte.
 *
 * There is no `/api/validate` route yet: that route is for a consumer that wants the answer
 * without a page, not for this one.
 */

import { type Diagnostic, formatDiagnostic } from "@yumml/yumml";
import type { IndexedRecipe } from "../scan.ts";
import { formatAge, plural } from "./format.ts";
import { type Html, html } from "./html.ts";
import { recipeHref, renderPage } from "./page.ts";

export type BrokenOptions = {
  /** The whole tree's recipe count, for the nav. */
  readonly recipes: number;
  readonly version: string;
  readonly now: number;
};

/** One diagnostic: the code as a chip, and the exact frame the CLI would have printed. */
function block(text: string, file: string, diagnostic: Diagnostic): Html {
  return html`
    <li class="diagnostic">
      <p><span class="chip chip--broken">${diagnostic.code}</span></p>
      <pre class="diagnostic-frame">${formatDiagnostic(text, diagnostic, { file })}</pre>
    </li>
  `;
}

/** The whole document for a file that did not parse. */
export function renderBrokenPage(entry: IndexedRecipe, options: BrokenOptions): Html {
  const diagnostics = entry.result.ok ? [] : entry.result.diagnostics;
  const name = entry.slug.split("/").pop() ?? entry.slug;

  return renderPage({
    title: `${name} — not a recipe`,
    recipes: options.recipes,
    query: "",
    filter: "all",
    version: options.version,
    body: html`
      <section class="recipe-head">
        <div class="recipe-heading">
          <p class="eyebrow">Not a recipe</p>
          <h1 class="recipe-title">${name}</h1>
          <p class="empty">
            ${plural(diagnostics.length, "problem", "problems")}, and yumml will not
            guess past ${diagnostics.length === 1 ? "it" : "any of them"}. Fix the file and
            reload: nothing is kept between runs.
          </p>
        </div>
        <aside class="source">
          <p class="source-file">
            <a href="${recipeHref(entry.slug)}.yaml">${entry.relPath}</a>
          </p>
          <p class="source-line">schema yumml v1</p>
          <p class="source-line">changed ${formatAge(entry.mtimeMs, options.now)} · ${plural(
            diagnostics.length,
            "diagnostic",
            "diagnostics",
          )}</p>
        </aside>
      </section>
      <ol class="diagnostics">
        ${diagnostics.map((diagnostic) => block(entry.text, entry.relPath, diagnostic))}
      </ol>
    `,
  });
}
