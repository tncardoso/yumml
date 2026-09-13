/**
 * yumml — the recipe language, its parser and its checks.
 *
 * The pipeline is four stages, each of which can fail on its own terms:
 *
 * ```
 * L0 load     bytes ──► text                   (encoding, BOM, size cap)
 * L1 yaml     text ──► document + plain object (one doc, no merge, no tags)
 * L2 schema   object ─► model                  (types, defaults, quantities)
 * L3 checks   model ──► Recipe                 (ids, refs, DAG, ledger)
 * ```
 *
 * `parseRecipe` runs all four and returns either a {@link Recipe} or the list of
 * everything wrong with the input. There is no lenient mode: a recipe that
 * has a problem gets diagnostics, never a repaired model.
 *
 * ```ts
 * const result = parseRecipe(yamlText);
 * if (!result.ok) {
 *   for (const d of result.diagnostics) console.error(formatDiagnostic(yamlText, d));
 * }
 * ```
 */

import { byPosition, type Diagnostic } from "./diagnostics.ts";
import type { Recipe } from "./model/recipe.ts";
import { loadSource } from "./parse/load.ts";
import { analyze } from "./parse/semantics.ts";
import { validateValue, withSource } from "./parse/validate.ts";
import { parseYaml } from "./parse/yaml.ts";

export type ParseResult =
  | { readonly ok: true; readonly recipe: Recipe; readonly diagnostics: readonly [] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/**
 * Parses and checks a recipe. Accepts the file's text or its raw bytes; the
 * caller does the reading, so this runs unchanged in a browser.
 *
 * Diagnostics come back sorted by position in the source, and every one of them
 * that has a position in the file carries `loc` and `range`.
 */
export function parseRecipe(input: string | Uint8Array): ParseResult {
  const loaded = loadSource(input);
  if (!loaded.ok) return { ok: false, diagnostics: [...loaded.diagnostics] };

  const text = loaded.text;
  const yaml = parseYaml(text);
  if (!yaml.ok) {
    return { ok: false, diagnostics: [...yaml.diagnostics].sort(byPosition) };
  }

  const validated = validateValue(yaml.doc, yaml.value, text);
  if (!validated.ok) {
    return { ok: false, diagnostics: [...validated.diagnostics].sort(byPosition) };
  }

  const analyzed = analyze(validated.model);
  if (!analyzed.ok) {
    // L3 diagnostics carry a path but no position; the same routing as L2 puts
    // them back on the line the reader has to change.
    const located = withSource(text, yaml.doc, analyzed.diagnostics);
    return { ok: false, diagnostics: [...located].sort(byPosition) };
  }

  return { ok: true, recipe: analyzed.recipe, diagnostics: [] };
}

/**
 * The same pipeline, stopping before it is worth building a model: the caller
 * only wants to know whether the file is a valid recipe.
 */
export function validateRecipe(input: string | Uint8Array): {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
} {
  const result = parseRecipe(input);
  return result.ok
    ? { ok: true, diagnostics: [] }
    : { ok: false, diagnostics: result.diagnostics };
}

export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticInput,
  Path,
  SourceLocation,
} from "./diagnostics.ts";
export {
  byPosition,
  diagnostic,
  formatDiagnostic,
  offsetToLocation,
  withLocation,
} from "./diagnostics.ts";
export { formatDuration, parseDuration } from "./model/duration.ts";
export type { Fraction } from "./model/fraction.ts";
export {
  add,
  cmp,
  div,
  eq,
  format,
  fraction,
  isNegative,
  isPositive,
  isZero,
  mul,
  neg,
  parseQuantity,
  sub,
  sum,
  toNumber,
  ZERO,
} from "./model/fraction.ts";
export {
  closest,
  editDistance,
  ID_MAX_LENGTH,
  ID_PATTERN,
  isValidId,
} from "./model/id.ts";
export type {
  Draw,
  IngredientNode,
  LedgerEntry,
  Recipe,
  RecipeInput,
  StepNode,
} from "./model/recipe.ts";
export { toModel } from "./model/recipe.ts";
export type { UnitDimension, UnitInfo, UnitName, UnitSystem } from "./model/unit.ts";
export { DEFAULT_UNIT, isUnitName, UNIT_NAMES, UNITS, unitInfo } from "./model/unit.ts";
export type { RecipeColor, RecipeColors, StageColumns } from "./render/palette.ts";
export {
  columnColor,
  RECIPE_COLORS,
  recipeColors,
  stageColumns,
} from "./render/palette.ts";
export { renderRecipe } from "./render.ts";
export {
  JSON_SCHEMA_ID,
  JSON_SCHEMA_NOTE,
  jsonSchema,
  jsonSchemaText,
} from "./schema/json-schema.ts";
export type { IngredientWire, RecipeWire, StepWire, UseWire } from "./schema/wire.ts";
export {
  formatPath,
  ingredientWire,
  KNOWN_FIELDS,
  recipeWire,
  stepWire,
} from "./schema/wire.ts";
export { analyze, loadSource, parseYaml, validateValue, withSource };
