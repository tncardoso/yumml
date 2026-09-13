/**
 * The published JSON Schema, generated from the wire schema.
 *
 * Editors use it for completion and inline errors in `.yaml` files:
 *
 * ```yaml
 * # yaml-language-server: $schema=https://gh.tncardoso.com/yumml/schema/v1.json
 * title: Banana Bread
 * ```
 *
 * What it can express is the *shape*: required fields, types, the id pattern,
 * the unit enum, and the defaults. What it cannot express is everything with a
 * whole-file view — references, cycles, the "unit needs a qty" rule, and the
 * ledger. The top-level `description` says so, because someone reading it in an
 * editor will otherwise assume a green squiggle means a valid recipe.
 */

import { z } from "zod";
import { recipeWire } from "./wire.ts";

export const JSON_SCHEMA_ID = "https://gh.tncardoso.com/yumml/schema/v1.json";

export const JSON_SCHEMA_NOTE =
  "Shape only. A recipe that satisfies this schema can still be rejected by yumml: " +
  "every `uses` entry must name a declared ingredient or step, a step's `uses` " +
  "mapping may only carry `qty` when it targets an ingredient, `unit` needs a " +
  "`qty`, the graph must be acyclic, and the amounts drawn from each ingredient " +
  "must sum to exactly its declared quantity.";

export type JsonSchema = Record<string, unknown>;

/** Builds the JSON Schema document. `emit-json-schema.ts` writes it to disk. */
export function jsonSchema(): JsonSchema {
  const generated = z.toJSONSchema(recipeWire, {
    io: "input",
    unrepresentable: "any",
  }) as JsonSchema;
  const { properties, required, additionalProperties } = generated;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: JSON_SCHEMA_ID,
    title: "yumml recipe v1",
    description: JSON_SCHEMA_NOTE,
    type: "object",
    properties,
    required,
    additionalProperties,
  };
}

/** The file as it is checked in: pretty-printed, LF, with a trailing newline. */
export function jsonSchemaText(): string {
  return `${JSON.stringify(jsonSchema(), null, 2)}\n`;
}
