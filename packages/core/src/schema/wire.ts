/**
 * The wire schema: what a recipe file is allowed to contain, in the exact shape
 * the YAML holds it.
 *
 * This is the single source of truth. It is deliberately *pure*:
 * no transforms, no custom checks, nothing zod cannot express as JSON Schema.
 * Two things are derived from it:
 *
 * - the JSON Schema checked into `packages/core/schema/`, which editors use;
 * - the structural half of `parse/validate.ts`, which turns zod issues into
 *   diagnostics.
 *
 * Values that need real work — quantities into exact fractions, durations into
 * seconds, and the `unit`-without-`qty` rule — are parsed afterwards in
 * `schema/model.ts`, because a transform would erase the types from the emitted
 * JSON Schema and eat the error codes.
 */

import { z } from "zod";
import { ID_MAX_LENGTH, ID_PATTERN } from "../model/id.ts";
import { UNIT_NAMES } from "../model/unit.ts";

/** `z.enum` needs a non-empty tuple; the registry is a plain array of names. */
const unitEnum = z.enum(UNIT_NAMES as [string, ...string[]]);

const id = z
  .string()
  .max(ID_MAX_LENGTH, `an id may be at most ${ID_MAX_LENGTH} characters`)
  .regex(ID_PATTERN, "an id is kebab-case: lowercase letters, digits and single dashes");

const text = z.string().min(1, "must not be empty");

const quantity = z
  .union([z.number(), z.string()])
  .describe('a number, or a fraction such as "1/2" or "0.5"');

const duration = z
  .union([z.number(), z.string()])
  .describe('minutes as a number, or a duration such as "5m", "1h30m" or "PT5M"');

const unit = unitEnum.optional().describe('defaults to "item" when qty is present');

/** A reference from a step to another node, with an optional amount. */
const use = z.union([
  id,
  z.strictObject({
    id,
    qty: quantity,
  }),
]);

export const ingredientWire = z.strictObject({
  id,
  desc: text.optional(),
  qty: quantity.optional(),
  unit,
});

export const stepWire = z.strictObject({
  id,
  desc: text.optional(),
  uses: z.array(use).default([]),
  time: duration.optional(),
});

export const recipeWire = z.strictObject({
  title: text,
  servings: z
    .number()
    .int()
    .min(1, "servings must be a whole number of at least 1")
    .default(1),
  ingredients: z.array(ingredientWire),
  steps: z.array(stepWire).min(1, "a recipe needs at least one step"),
});

export type IngredientWire = z.infer<typeof ingredientWire>;
export type StepWire = z.infer<typeof stepWire>;
export type UseWire = z.infer<typeof use>;
export type RecipeWire = z.infer<typeof recipeWire>;

/**
 * The fields the schema allows, per level. Only used to offer a did-you-mean
 * hint when a key is unknown or missing; a test asserts this list matches the
 * JSON Schema, so it cannot silently drift from the schema above.
 */
export const KNOWN_FIELDS = {
  recipe: ["title", "servings", "ingredients", "steps"],
  ingredient: ["id", "desc", "qty", "unit"],
  step: ["id", "desc", "uses", "time"],
  use: ["id", "qty"],
} as const satisfies Record<string, readonly string[]>;

export type FieldLevel = keyof typeof KNOWN_FIELDS;

/**
 * Which set of fields applies at `path`. Used for hints, and to name the field
 * in a message without the reader having to count list indices.
 */
export function fieldLevelAt(path: readonly (string | number)[]): FieldLevel {
  let level: FieldLevel = "recipe";
  for (const part of path) {
    if (part === "ingredients") level = "ingredient";
    else if (part === "steps") level = "step";
    else if (part === "uses") level = "use";
  }
  return level;
}

/** Renders a path the way a reader would write it: `steps[2].uses`. */
export function formatPath(path: readonly (string | number)[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out === "" ? part : `.${part}`;
  }
  return out === "" ? "recipe" : out;
}
