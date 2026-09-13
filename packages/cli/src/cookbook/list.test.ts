/**
 * The list page as a whole: what it says about a recipe, what it refuses to say
 * about one that is fine, and what it does with a file that is not a recipe
 * at all.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRecipe } from "@yumml/yumml";
import {
  matches,
  QUICK_SECONDS,
  renderListPage,
  select,
  summarize,
  totalSeconds,
} from "./render/list.ts";
import type { CookbookIndex, IndexedRecipe } from "./scan.ts";

const GOOD = `
title: Banana Bread
servings: 10
ingredients:
  - id: banana
    qty: 2
    unit: item
  - id: butter
    qty: 1/2
    unit: cup
  - id: flour
    qty: 200
    unit: g
  - id: salt
steps:
  - id: prepare
    desc: Butter and flour a loaf pan
  - id: mash
    uses: [banana]
  - id: melt
    uses: [{ id: butter, qty: 1/4 }]
  - id: brush
    uses: [{ id: butter, qty: 1/4 }]
  - id: sift
    uses: [flour]
  - id: mix
    uses: [sift, melt, brush, salt]
  - id: mash-smooth
    uses: [mash, mix]
  - id: bake
    uses: [mash-smooth]
    time: 1h30m
`;

const QUICK = `
title: Cold Brew
servings: 2
ingredients:
  - id: coffee
    qty: 100
    unit: g
steps:
  - id: steep
    uses: [coffee]
    time: 5m
`;

const BROKEN = `title: Toast
servings: 0
ingredients:
  - id: bread
    qty: 2
    unit: slices
steps:
  - id: toast
    uses: [bread]
`;

function entry(slug: string, yaml: string, relPath = `${slug}.yaml`): IndexedRecipe {
  return {
    slug,
    relPath,
    path: `/recipes/${relPath}`,
    mtimeMs: 1,
    size: yaml.length,
    text: yaml,
    result: parseRecipe(yaml),
  };
}

function index(recipes: readonly IndexedRecipe[], truncated = false): CookbookIndex {
  return { root: "/recipes", recipes, truncated };
}

function page(
  recipes: readonly IndexedRecipe[],
  options: { query?: string; filter?: "all" | "broken" | "quick" } = {},
): string {
  return renderListPage(index(recipes), {
    query: options.query ?? "",
    filter: options.filter ?? "all",
    version: "9.9.9",
  }).value;
}

const banana = entry("banana", GOOD);
const cold = entry("cold-brew", QUICK);
const broken = entry("bread/banana", BROKEN, "bread/banana.yaml");

describe("the list", () => {
  test("counts what it has", () => {
    assert.deepEqual(summarize([banana, cold, broken]), {
      recipes: 3,
      ingredients: 5,
      broken: 1,
      quick: 1,
    });
  });

  test("a card carries the title, the numbers and the flow", () => {
    const html = page([banana]);
    assert.match(html, /<h3 class="card-title">Banana Bread<\/h3>/);
    assert.match(html, /10 servings ·\s*4 ingredients ·\s*8 steps/);
    assert.match(html, /class="card-flow" data-yumml-recipe="/);
    assert.match(html, /href="\/r\/banana"/);
    assert.match(html, /1 h 30 min/);
  });

  test("says nothing about a recipe that checks out", () => {
    const html = page([banana]);
    assert.ok(!html.includes("stat--broken"), "no diagnostics stat");
    assert.ok(!html.includes("chip--broken"), "no broken chip");
    assert.ok(!/>valid</.test(html), "no validity chip");
    assert.ok(!html.includes("0 diagnostics"));
    assert.ok(!html.includes('chip--current" href="/?filter=broken'));
  });

  test("a recipe with no times says so rather than inventing one", () => {
    const html = page([entry("no-time", GOOD.replace("    time: 1h30m\n", ""))]);
    assert.equal(totalSeconds(entry("no-time", "title: X")), 0);
    assert.match(html, /no time given/);
  });

  test("a file that does not parse is a card with the reason", () => {
    const html = page([broken]);
    assert.match(html, /class="card card--broken"/);
    assert.match(html, /chip chip--broken">schema\/out-of-range</);
    assert.match(html, /servings must be a whole number of at least 1/);
    assert.match(html, /1 more problem\b/);
    assert.match(html, /<h3 class="card-title">banana<\/h3>/);
    assert.match(html, /href="\/r\/bread\/banana"/);
  });

  test("the diagnostics stat appears only when something is wrong", () => {
    assert.match(page([broken]), /stat stat--broken/);
    assert.match(page([broken]), /<span class="stat-number">1<\/span>/);
  });

  test("escapes a title that is trying to be markup", () => {
    const sneaky = entry(
      "sneaky",
      GOOD.replace("title: Banana Bread", "title: '<script>alert(1)</script>'"),
    );
    const html = page([sneaky]);
    assert.ok(!html.includes("<script>"));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test("a truncated scan says so", () => {
    const html = renderListPage(index([banana], true), {
      query: "",
      filter: "all",
      version: "9.9.9",
    }).value;
    assert.match(html, /this tree holds more/);
  });

  test("nothing at all is an empty page, not an error", () => {
    const html = page([]);
    assert.match(html, /No recipes here yet/);
    assert.match(html, /Cookbook · 0 recipes/);
    assert.ok(!html.includes('class="chips"'));
  });
});

describe("searching and filtering", () => {
  test("matches the title, the path, an ingredient and a step", () => {
    assert.equal(matches(banana, "banana"), true);
    assert.equal(matches(banana, "butter"), true);
    assert.equal(matches(banana, "mash-smooth"), true);
    assert.equal(matches(banana, "loaf pan"), true);
    assert.equal(matches(banana, "sourdough"), false);
  });

  test("a broken file can still be found by its path", () => {
    assert.equal(matches(broken, "bread/banana"), true);
    assert.equal(matches(broken, "toast"), false);
  });

  test("select narrows by query and filter", () => {
    const all = [banana, cold, broken];
    assert.deepEqual(
      select(all, { query: "brew", filter: "all" }).map((item) => item.slug),
      ["cold-brew"],
    );
    assert.deepEqual(
      select(all, { query: "", filter: "broken" }).map((item) => item.slug),
      ["bread/banana"],
    );
    assert.deepEqual(
      select(all, { query: "", filter: "quick" }).map((item) => item.slug),
      ["cold-brew"],
    );
    assert.equal(QUICK_SECONDS, 1800);
  });

  test("a search for nothing is not a search", () => {
    assert.equal(select([banana, cold], { query: "   ", filter: "all" }).length, 2);
  });

  test("the empty result keeps the query in the form and offers a way out", () => {
    const html = page([banana], { query: "sourdough" });
    assert.match(html, /Nothing matches that/);
    assert.match(html, /value="sourdough"/);
    assert.match(html, /class="results-clear" href="\/"/);
    assert.match(html, /0 of 1 recipe/);
  });

  test("the chips carry the current search, and only exist when they mean something", () => {
    const clean = page([banana]);
    assert.match(clean, /aria-current="true"\s*>All · 1</);
    assert.ok(!clean.includes("filter=broken"));
    assert.ok(!clean.includes("filter=quick"));

    const messy = page([banana, broken, cold], { query: "b" });
    assert.match(messy, /href="\/\?q=b&amp;filter=broken"/);
    assert.match(messy, /broken · 1/);
    assert.match(messy, /Under 30 min · 1/);
    assert.match(messy, /aria-current="true"/);
  });

  test("a current filter survives the search box", () => {
    const html = page([banana, broken], { filter: "broken" });
    assert.match(html, /<input type="hidden" name="filter" value="broken"/);
  });
});

describe("the shell", () => {
  test("the nav counts the whole tree, not the filtered list", () => {
    const html = page([banana, cold], { query: "zucchini" });
    assert.match(html, /class="nav-count">2 recipes</);
    assert.match(html, /Cookbook · 2 recipes/);
  });

  test("the footer names the version and the two real links, and no code count", () => {
    const html = page([banana]);
    assert.match(html, /yumml 9\.9\.9 — a recipe is not a list/);
    assert.match(html, /yumml-v1\.schema\.json/);
    assert.match(html, /https:\/\/github\.com\/tncardoso\/yumml/);
    assert.ok(!html.includes("28 diagnostic"));
  });

  test("only the nav this site needs (C21)", () => {
    const html = page([banana]);
    for (const gone of ["New recipe", "Collections", "Guides", "Docs"]) {
      assert.ok(!html.includes(gone), gone);
    }
    assert.match(html, /class="nav-link" href="\/" aria-current="page">Home</);
  });
});
