/**
 * The palette, and the rule that decides which node wears which colour.
 *
 * The tests here are the reason a hue can never be added by eye: every colour the
 * drawing paints has to clear 4.5:1 against the words that sit on it, and every
 * colour in the list has to be far enough from its neighbour to read as a different
 * column. When one of those fails, this file says which pair and by how much.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { parseRecipe } from "../index.ts";
import type { Recipe, StepNode } from "../model/recipe.ts";
import { columnColor, RECIPE_COLORS, recipeColors, stageColumns } from "./palette.ts";

const GALINHADA_SOURCE = readFileSync(
  new URL("../../../../fixtures/galinhada.valid.yaml", import.meta.url),
  "utf8",
);

/** The ten hues as the plan's table writes them down: one line per column, in order. */
const TABLE = [
  ["teal", "#8ce3dd", "#025956", "#dcf7f4"],
  ["violet", "#d7c6ff", "#534276", "#f2edff"],
  ["coral", "#ffbfb2", "#743a2f", "#ffebe7"],
  ["jade", "#a5e1c2", "#145b3f", "#e2f6eb"],
  ["magenta", "#eebfec", "#663a65", "#faeaf9"],
  ["amber", "#fbc68d", "#6d4200", "#ffeddb"],
  ["indigo", "#bcd1ff", "#3a4c76", "#e9f0ff"],
  ["moss", "#c2dca3", "#3f561c", "#ebf4e1"],
  ["rose", "#fdbdc8", "#723844", "#feeaed"],
  ["sky", "#9bdbfd", "#025473", "#e0f4fe"],
] as const;

function channels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** sRGB → linear light, the transfer function the contrast formula is defined on. */
function linear(channel: number): number {
  const unit = channel / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast: what the text on a fill has to clear. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/** OKLab, from the hex. The lightness is a lap's step; `atan2` of a and b is the hue. */
function oklab(hex: string): { readonly lightness: number; readonly hue: number } {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
  };
}

/** The shorter way round the hue circle: 350° and 10° are twenty degrees apart. */
function hueGap(a: string, b: string): number {
  const gap = Math.abs(oklab(a).hue - oklab(b).hue);
  return Math.min(gap, 360 - gap);
}

function galinhada(): Recipe {
  const parsed = parseRecipe(GALINHADA_SOURCE);
  assert.ok(parsed.ok, "the galinhada fixture has to parse");
  return parsed.recipe;
}

function orderedSteps(recipe: Recipe): readonly StepNode[] {
  const byId = new Map(recipe.steps.map((step) => [step.id, step]));
  return recipe.order
    .map((id) => byId.get(id))
    .filter((step): step is StepNode => step !== undefined);
}

describe("RECIPE_COLORS", () => {
  test("is the ten hues the table names, in the order the columns take them", () => {
    assert.equal(RECIPE_COLORS.length, TABLE.length);
    TABLE.forEach(([name, fill, ink, tint], index) => {
      const color = RECIPE_COLORS[index];
      assert.deepEqual(
        { fill: color?.fill, ink: color?.ink, tint: color?.tint },
        { fill, ink, tint },
        `${name} is not what the table says`,
      );
    });
  });

  test("every word on a fill clears 4.5:1 on it, and on its row's tint", () => {
    for (const [name, fill, ink, tint] of TABLE) {
      const onFill = contrast(ink, fill);
      const onTint = contrast(ink, tint);
      assert.ok(onFill >= 4.5, `${name}: ${onFill.toFixed(2)}:1 ink on fill`);
      assert.ok(onTint >= 4.5, `${name}: ${onTint.toFixed(2)}:1 ink on tint`);
    }
  });

  test("neighbouring columns are a hue apart, not a shade apart", () => {
    for (let index = 0; index < RECIPE_COLORS.length - 1; index += 1) {
      const color = RECIPE_COLORS[index];
      const next = RECIPE_COLORS[index + 1];
      if (color === undefined || next === undefined) continue;
      const gap = hueGap(color.fill, next.fill);
      assert.ok(
        gap >= 60,
        `column ${index} and ${index + 1} are only ${gap.toFixed(0)}° apart`,
      );
    }
  });

  test("the seam after the tenth column is a lap, not a repeat", () => {
    // The one place two neighbouring columns are close in hue is the wrap from `sky`
    // back to `teal`, and a lap of lightness is what separates them there.
    const last = columnColor(RECIPE_COLORS.length - 1);
    const seam = columnColor(RECIPE_COLORS.length);
    assert.notEqual(seam.fill, last.fill, "the eleventh column repeats the tenth");
    assert.ok(
      oklab(last.fill).lightness - oklab(seam.fill).lightness >= 0.05,
      "the eleventh column is not a step darker than the tenth",
    );
  });

  test("the tenth lap is one step darker, never the first colour again", () => {
    for (let index = 0; index < RECIPE_COLORS.length; index += 1) {
      const first = RECIPE_COLORS[index];
      const second = columnColor(index + RECIPE_COLORS.length);
      if (first === undefined) continue;
      assert.notEqual(second.fill, first.fill, `column ${index} repeats its fill`);
      assert.ok(
        hueGap(second.fill, first.fill) <= 5,
        `column ${index + RECIPE_COLORS.length} is not the same hue as column ${index}`,
      );
      assert.ok(
        oklab(first.fill).lightness - oklab(second.fill).lightness >= 0.05,
        `the lap at column ${index + RECIPE_COLORS.length} is not darker`,
      );
      assert.ok(
        contrast(second.ink, second.fill) >= 4.5,
        `the lap ${index} is unreadable`,
      );
    }
  });
});

describe("recipeColors", () => {
  test("gives every band and every ingredient a colour", () => {
    const recipe = galinhada();
    const colors = recipeColors(recipe);
    for (const step of recipe.steps) {
      const color = colors.steps.get(step.id);
      if (step.uses.length === 0) {
        // A preparation step is a card above the flow, not a band in it, so it has
        // no column and no colour. The banana fixture is where that shows up.
        assert.equal(color, undefined, `${step.id} is a preparation and got a band`);
        continue;
      }
      assert.notEqual(color, undefined, `${step.id} has no colour`);
    }
    for (const ingredient of recipe.ingredients) {
      assert.notEqual(
        colors.ingredients.get(ingredient.id),
        undefined,
        `${ingredient.id} has no colour`,
      );
    }
  });

  test("every step of a column is one colour, and no two columns share one", () => {
    const recipe = galinhada();
    const colors = recipeColors(recipe);
    const columns = stageColumns(orderedSteps(recipe));
    assert.equal(columns.length, 9, "galinhada is a nine-column recipe");

    const bandColors = columns.map((column) =>
      column.map((step) => {
        const color = colors.steps.get(step.id);
        assert.notEqual(color, undefined);
        return color?.fill;
      }),
    );
    for (const [index, fills] of bandColors.entries()) {
      assert.equal(
        new Set(fills).size,
        1,
        `column ${index} is drawn in more than one colour`,
      );
    }
    for (let index = 0; index < bandColors.length - 1; index += 1) {
      assert.notEqual(
        bandColors[index]?.[0],
        bandColors[index + 1]?.[0],
        `columns ${index} and ${index + 1} are the same colour`,
      );
    }
  });

  test("an ingredient wears the colour of the earliest column that draws it", () => {
    const colors = recipeColors(galinhada());
    // `frango` is cut in column 0; `paprica` is stirred into column 4 alone.
    assert.equal(colors.ingredients.get("frango")?.fill, RECIPE_COLORS[0]?.fill);
    assert.equal(colors.ingredients.get("paprica")?.fill, RECIPE_COLORS[4]?.fill);
    assert.notEqual(colors.ingredients.get("frango")?.fill, undefined);
  });

  test("declaring order does not decide the colour", () => {
    // `salt` is drawn by `mix` (column 1) and by `dust` (column 0), and `mix` is
    // declared first. The row sits under column 0's band, so it wears column 0.
    const parsed = parseRecipe(`
title: Salt twice
ingredients:
  - id: flour
  - id: salt
steps:
  - id: mix
    uses: [sift, salt]
  - id: sift
    uses: [flour]
  - id: dust
    uses: [salt]
`);
    assert.ok(parsed.ok, "the recipe has to parse");
    const columns = stageColumns(orderedSteps(parsed.recipe));
    assert.deepEqual(
      columns.map((column) => column.map((step) => step.id)),
      [["sift", "dust"], ["mix"]],
    );
    const colors = recipeColors(parsed.recipe);
    assert.equal(colors.ingredients.get("salt")?.fill, RECIPE_COLORS[0]?.fill);
    assert.equal(colors.steps.get("mix")?.fill, RECIPE_COLORS[1]?.fill);
  });
});
