/**
 * The shell every page shares: the nav, the footer, and the two things the
 * browser needs — the design's font and the stylesheet.
 *
 * The nav has the wordmark, the one link
 * there is anywhere to go, the search field, and how many recipes there are.
 * `Collections`, `Guides`, `Docs` and `+ New recipe` are gone rather than
 * rendered as links that lead nowhere.
 *
 * The font comes from Google Fonts, with a system stack behind it: the boards are
 * set in Inter Tight, and a local tool must still read properly with no network.
 *
 * The two files in `assets/` are the page's only assets, and they are served from
 * the package rather than inlined. The script is `defer`red: it runs after
 * the parse, so nothing it does can hold up the page it enhances.
 */

import { plural } from "./format.ts";
import { type Html, html } from "./html.ts";

export const REPOSITORY = "https://github.com/tncardoso/yumml";
export const SCHEMA_URL = `${REPOSITORY}/blob/main/packages/core/schema/yumml-v1.schema.json`;

/** The three ways the list can be narrowed, and the one the server will accept. */
export const FILTERS = ["all", "broken", "quick"] as const;

export type FilterName = (typeof FILTERS)[number];

export function isFilterName(value: string): value is FilterName {
  return (FILTERS as readonly string[]).includes(value);
}

export type PageOptions = {
  /** The document title, before the site's own suffix. */
  readonly title: string;
  /** The recipe count in the nav, and the whole index's, not the filtered one. */
  readonly recipes: number;
  readonly query: string;
  readonly filter: FilterName;
  readonly version: string;
  readonly body: Html;
};

/** The URL name of a recipe: the root route, then its path. */
export function recipeHref(slug: string): string {
  return `/r/${slug.split("/").map(encodeURIComponent).join("/")}`;
}

/** Where a filter links, keeping the current search. */
export function filterHref(filter: FilterName, query: string): string {
  const parameters = new URLSearchParams();
  if (query !== "") parameters.set("q", query);
  if (filter !== "all") parameters.set("filter", filter);
  const search = parameters.toString();
  return search === "" ? "/" : `/?${search}`;
}

function nav(options: PageOptions): Html {
  return html`
    <header class="nav">
      <div class="nav-inner">
        <p class="brand">
          <span class="brand-mark" aria-hidden="true">🍌</span>
          <span class="brand-word">yumml</span>
          <a class="nav-link" href="/" aria-current="page">Home</a>
        </p>
        <form class="search" method="get" action="/" role="search">
          ${
            options.filter === "all"
              ? ""
              : html`<input type="hidden" name="filter" value="${options.filter}" />`
          }
          <input
            class="search-input"
            type="search"
            name="q"
            value="${options.query}"
            placeholder="Search"
            aria-label="Search recipes"
          />
          <button class="search-button" type="submit">Search</button>
        </form>
        <p class="nav-count">${plural(options.recipes, "recipe", "recipes")}</p>
      </div>
    </header>
  `;
}

function footer(options: PageOptions): Html {
  return html`
    <footer class="footer">
      <div class="footer-inner">
        <p class="footer-note">
          yumml ${options.version} — a recipe is not a list, it is a graph with a ledger.
        </p>
        <p class="footer-links">
          <a href="${SCHEMA_URL}">JSON Schema</a>
          <span aria-hidden="true">·</span>
          <a href="${REPOSITORY}">GitHub</a>
        </p>
      </div>
    </footer>
  `;
}

export function renderPage(options: PageOptions): Html {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${options.title} — yumml cookbook</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,100..900;1,100..900&display=swap"
    />
    <link rel="stylesheet" href="/assets/cookbook.css" />
    <script type="module" src="/assets/cookbook.js"></script>
  </head>
  <body>
    ${nav(options)}
    <main class="main">${options.body}</main>
    ${footer(options)}
  </body>
</html>
`;
}
