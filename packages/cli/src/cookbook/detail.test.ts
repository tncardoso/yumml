/**
 * The recipe page: what the header, the timer bar, the strip and the flow
 * say, and that all of it is already
 * true with no script at all.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRecipe } from "@yumml/yumml";
import { firstStep, renderRecipePage } from "./render/detail.ts";
import type { IndexedRecipe } from "./scan.ts";

const BANANA = `
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

/**
 * Three ingredients in two columns, arranged so the two ways of picking an ingredient's
 * colour disagree: `three` is the third ingredient declared, so colouring it by its
 * position in `ingredients` gives it the third hue, while the column that draws it is
 * the second.
 */
const THREE = `
title: Three in a row
ingredients:
  - id: one
  - id: two
  - id: three
steps:
  - id: first
    uses: [one, two]
  - id: second
    uses: [first, three]
`;

/** The modification time the page reports, so "changed N ago" is not a race. */
const MTIME = Date.parse("2026-09-12T12:00:00Z");
const NOW = Date.parse("2026-09-12T12:02:00Z");

function entry(yaml: string, slug = "banana"): IndexedRecipe {
  return {
    slug,
    relPath: `${slug}.yaml`,
    path: `/recipes/${slug}.yaml`,
    mtimeMs: MTIME,
    size: yaml.length,
    text: yaml,
    result: parseRecipe(yaml),
  };
}

function page(yaml = BANANA, recipes = 1, current?: string, now = NOW): string {
  const item = entry(yaml);
  assert.ok(item.result.ok);
  const step =
    current === undefined
      ? firstStep(item.result.recipe)
      : item.result.recipe.steps.find((candidate) => candidate.id === current);
  return renderRecipePage(
    item,
    item.result.recipe,
    { recipes, version: "9.9.9", now },
    step,
  ).value;
}

describe("the recipe header", () => {
  test("names the recipe and counts it", () => {
    const html = page();
    assert.match(html, /<title>Banana Bread — yumml cookbook<\/title>/);
    assert.match(html, /<h1 class="recipe-title">Banana Bread<\/h1>/);
    assert.match(html, /10 servings/);
    assert.match(html, /4 ingredients/);
    assert.match(html, /8 steps/);
    assert.match(html, /1 h 30 min/);
  });

  test("the source card says where it is and when it changed", () => {
    const html = page();
    assert.match(html, /<a href="\/r\/banana\.yaml">banana\.yaml<\/a>/);
    assert.match(html, /schema yumml v1/);
    assert.match(html, /changed 2 min ago/);
    assert.match(html, /class="nav-count">1 recipe</);
  });

  test("counts the days in the plural a person says", () => {
    // The boards say "checked 2 min ago"; a file a day old must not say "1 days".
    const aDayLater = NOW + 86_400_000 - 120_000;
    assert.match(page(BANANA, 1, undefined, aDayLater), /changed 1 day ago/);
  });

  test("says nothing about validity, because this one is fine (C20)", () => {
    const html = page();
    assert.ok(!/>valid</.test(html));
    assert.ok(!html.includes("chip--broken"));
    assert.ok(!html.includes("diagnostics"), "no diagnostics mention");
  });
});

describe("the timer bar", () => {
  test("shows the first step, with no script and no guessing", () => {
    const html = page();
    assert.match(html, /STEP 1 OF 8/);
    // The first step in order is the preparation, which has no time.
    assert.match(html, /<p class="timer-name">Butter and flour a loaf pan<\/p>/);
    assert.match(html, /--:--/);
    assert.match(html, /class="timer-badge" aria-hidden="true">1</);
  });

  test("one dot per step, the current one filled", () => {
    const html = page();
    assert.equal(html.match(/class="timer-dot(?!s)/g)?.length, 8);
    assert.equal(html.match(/timer-dot--on/g)?.length, 1);
    // In cooking order, which is the order the script will walk them in.
    const dots = [...html.matchAll(/class="timer-dot(?!s)[^>]*data-step="([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(dots, [
      "prepare",
      "mash",
      "melt",
      "brush",
      "sift",
      "mix",
      "mash-smooth",
      "bake",
    ]);
  });

  test("a step with a time shows it, as a clock", () => {
    const html = page(BANANA, 1, "bake");
    assert.match(html, /STEP 8 OF 8/);
    assert.match(html, /class="timer-digits">1:30:00</);
  });

  test("every control is present and inert until the script arrives (M3)", () => {
    const html = page();
    for (const control of [
      "timer-prev",
      "timer-play",
      "timer-add",
      "timer-mute",
      "timer-next",
    ]) {
      assert.match(html, new RegExp(`class="${control}"[^>]*disabled`), control);
    }
    assert.match(html, /\+ 1:00/);
    assert.match(html, />Chime</);
    assert.match(html, /Next step/);
  });

  test("the play button says which state it is in, and the chime is on (C23)", () => {
    const html = page();
    assert.match(html, /class="timer-play"[^>]*data-playing="false"/);
    assert.match(html, /class="timer-mute"[^>]*data-muted="false"/);
    assert.match(html, /class="timer-mute"[^>]*aria-pressed="true"/);
  });
});

describe("the current-step strip", () => {
  test("says what the step is and what it takes in", () => {
    // `melt` draws a quarter of the butter, and a step target is named by its
    // description.
    const html = page(BANANA, 1, "melt");
    assert.match(html, /<h2 class="strip-title">melt<\/h2>/);
    assert.match(html, /1\/4 cup butter/);

    // `mix` draws three steps and one unquantified ingredient.
    const mixing = page(BANANA, 1, "mix");
    assert.match(mixing, /sift/);
    assert.match(mixing, />salt</);
  });

  test("an ingredient chip wears its row's tint, so the strip and the flow agree", () => {
    // Banana is the first row and it sits in column 0, the one ingredient of this
    // recipe where the row and the chip cannot disagree. `three` is in column 1 while
    // being the third ingredient declared, so it is the one that shows the rule.
    assert.match(
      page(BANANA, 1, "mash"),
      /class="chip uses-chip" style="background: #dcf7f4">2 item banana</,
    );
    assert.match(
      page(THREE, 1, "second"),
      /class="chip uses-chip" style="background: #f2edff">three</,
    );
  });

  test("a preparation takes nothing in, and says so", () => {
    const html = page(BANANA, 1, "prepare");
    assert.match(html, /no ingredients — a preparation step/);
  });
});

describe("the core flow mount", () => {
  test("hands the checked Recipe to the browser renderer", () => {
    const html = page(BANANA, 1, "mix");
    assert.match(html, /class="flow-frame" data-yumml-recipe="/);
    assert.match(html, /&quot;title&quot;:&quot;Banana Bread&quot;/);
    assert.match(html, /&quot;id&quot;:&quot;mix&quot;/);
    assert.ok(!html.includes("flow-focus"), "the obsolete SVG flow is not rendered");
  });

  test("a long recipe is still passed whole to the responsive renderer", () => {
    const ingredients = Array.from(
      { length: 12 },
      (_, index) => `  - id: item-${index}\n    qty: 1\n    unit: item\n`,
    ).join("");
    const steps = Array.from(
      { length: 12 },
      (_, index) => `  - id: step-${index}\n    uses: [item-${index}]\n`,
    ).join("");
    const html = page(
      `title: Long\nservings: 1\ningredients:\n${ingredients}steps:\n${steps}`,
    );
    assert.match(html, /&quot;id&quot;:&quot;step-11&quot;/);
  });

  test("the legend names the three things in the picture", () => {
    const html = page();
    assert.match(html, /cooking column/);
    assert.match(html, /ingredient row/);
    assert.match(html, /legend-swatch--prep/);
  });
});

describe("what the script finds in the markup (M3)", () => {
  test("the client is a file, loaded after the parse", () => {
    assert.match(page(), /<script type="module" src="\/assets\/cookbook\.js"><\/script>/);
  });

  test("every step has a strip, and only the current one shows", () => {
    const strips = [
      ...page().matchAll(
        /class="strip"\s+data-step="([^"]+)"\s+data-seconds="([^"]*)"(\s+hidden)?/g,
      ),
    ].map((match) => ({
      id: match[1],
      seconds: match[2],
      hidden: match[3] !== undefined,
    }));

    // One per step in cooking order, which is the order the dots walk.
    assert.deepEqual(
      strips.map((strip) => strip.id),
      ["prepare", "mash", "melt", "brush", "sift", "mix", "mash-smooth", "bake"],
    );
    // The empty string is a step with no `time`: hidden or not, that is the only
    // thing the client reads a budget out of.
    assert.deepEqual(
      strips.filter((strip) => !strip.hidden).map((strip) => strip.id),
      ["prepare"],
    );
    assert.equal(strips[7]?.seconds, "5400");
    assert.equal(strips[0]?.seconds, "");
  });

  test("a step with no time says so, rather than inventing one", () => {
    assert.match(
      page(BANANA, 1, "prepare"),
      /<p class="strip-time">\s*no time set\s*<\/p>/,
    );
    assert.match(page(BANANA, 1, "bake"), /<p class="strip-time">\s*1 h 30 min\s*<\/p>/);
  });

  test("the bar describes the strip that shows", () => {
    // The name in the bar is the visible strip's `desc`; the script reads it from
    // there so the two cannot disagree, and the badge is the step's position.
    const html = page(BANANA, 1, "mix");
    assert.match(html, /<p class="timer-name">mix<\/p>/);
    assert.match(
      html,
      /class="strip"\s+data-step="mix"\s+data-seconds=""\s+>\s+<p class="strip-badge" aria-hidden="true">6<\/p>\s+<div class="strip-text">\s+<h2 class="strip-title">mix<\/h2>/,
    );
  });
});

describe("escaping", () => {
  test("a recipe cannot get markup into its own page", () => {
    const html = page(
      BANANA.replace(
        "title: Banana Bread",
        "title: '<img src=x onerror=alert(1)>'",
      ).replace("desc: Butter and flour a loaf pan", "desc: 'a < b & c'"),
    );
    assert.ok(!html.includes("<img src=x"));
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /a &lt; b &amp; c/);
  });
});
