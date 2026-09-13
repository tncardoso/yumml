/**
 * L2 — structural validation, and the bridge back to the source.
 *
 * Two jobs:
 *
 * 1. Run the wire schema and turn zod's issues into {@link Diagnostic}s with a
 *    code the test suite can assert on and a message that names the field.
 * 2. Route every diagnostic — including the ones L3 finds later — back to a line
 *    and column, by asking the YAML document for the node at the issue's path.
 *    When the path itself does not exist, which is what a
 *    missing field looks like, the nearest existing ancestor is used instead, so
 *    the error points at the ingredient rather than nowhere.
 */

import type { Document } from "yaml";
import {
  type Diagnostic,
  diagnostic,
  offsetToLocation,
  type Path,
} from "../diagnostics.ts";
import { closest } from "../model/id.ts";
import type { RecipeInput } from "../model/recipe.ts";
import { toModel } from "../model/recipe.ts";
import { UNIT_NAMES } from "../model/unit.ts";
import {
  type FieldLevel,
  fieldLevelAt,
  formatPath,
  KNOWN_FIELDS,
  recipeWire,
} from "../schema/wire.ts";

export type ValidateResult =
  | { readonly ok: true; readonly model: RecipeInput }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

const EXPECTED_WORDS: Record<string, string> = {
  string: "text",
  number: "a number",
  integer: "a whole number",
  boolean: "true or false",
  array: "a list",
  object: "a mapping",
  null: "nothing",
};

function describeExpected(expected: unknown): string {
  if (typeof expected !== "string") return "a different value";
  return EXPECTED_WORDS[expected] ?? expected;
}

/**
 * Names what the reader actually wrote. Zod 4 reports only the type it wanted,
 * so the received side comes from the document itself — which is also what makes
 * the unit hint possible.
 */
function describeValue(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "nothing";
  if (Array.isArray(value)) return "a list";
  return EXPECTED_WORDS[typeof value] ?? typeof value;
}

type IssueContext = {
  /** True when the document has a node at exactly this path. */
  readonly hasNode: (path: Path) => boolean;
  /** The plain-JS value at this path, for naming what the reader wrote. */
  readonly valueAt: (path: Path) => unknown;
};

type ZodIssue = {
  code: string;
  path: readonly (string | number)[];
  message: string;
  expected?: unknown;
  keys?: readonly string[];
  pattern?: string;
  params?: Record<string, unknown>;
};

function lastSegment(path: Path): string | number | undefined {
  return path.length === 0 ? undefined : path[path.length - 1];
}

function knownFieldsHints(level: FieldLevel, key: string): string | undefined {
  const suggestion = closest(
    key,
    KNOWN_FIELDS[level].filter((candidate) => candidate !== key),
  );
  return suggestion === undefined ? undefined : `did you mean "${suggestion}"?`;
}

const ID_MESSAGE = "must be kebab-case: lowercase letters, digits and single dashes";
const ID_HINT =
  "ids are shared by ingredients and steps, so a typo here surfaces as an unresolved reference";

/**
 * Maps one zod issue to a diagnostic. The code is chosen by what the issue is
 * about, not by zod's taxonomy: a reader cares that a field is named `qtty` and
 * unknown, not that zod called it `unrecognized_keys`.
 *
 * Each branch below is one thing that can be wrong with one field, which is what
 * keeps the codes stable and the messages specific.
 */
function issueToDiagnostic(issue: ZodIssue, context: IssueContext): Diagnostic {
  const path = issue.path;
  const key = lastSegment(path);
  const label = formatPath(path);
  const custom = issue.params?.yumml;

  if (typeof custom === "string") {
    return diagnostic({
      code: custom as Diagnostic["code"],
      message: issue.message,
      path,
    });
  }
  if (issue.code === "unrecognized_keys") {
    return unknownField(issue, path, key);
  }
  if (
    issue.code === "invalid_type" &&
    !context.hasNode(path) &&
    typeof key === "string"
  ) {
    const hint = knownFieldsHints(fieldLevelAt(path.slice(0, -1)), key);
    return diagnostic({
      code: "schema/missing-field",
      message: `"${label}" is required`,
      path,
      ...(hint === undefined ? {} : { hint }),
    });
  }
  // The only regular expression in the schema is the id pattern, so a regex
  // failure anywhere is an id problem — including one inside a `uses` entry.
  if (issue.code === "invalid_format" && issue.pattern !== undefined) {
    return invalidId(path, label);
  }
  if (key === "id" && !["invalid_type", "too_small", "too_big"].includes(issue.code)) {
    return invalidId(path, label);
  }
  if (key === "unit") {
    const written = context.valueAt(path);
    const suggestion =
      typeof written === "string" ? closest(written, UNIT_NAMES) : undefined;
    return diagnostic({
      code: "schema/invalid-unit",
      message: `"${label}" is not a unit yumml knows`,
      path,
      ...(suggestion === undefined ? {} : { hint: `did you mean "${suggestion}"?` }),
    });
  }
  if (key === "qty" || issue.code === "invalid_union") {
    return badValue(key, path, label);
  }
  if (issue.code === "too_small" && (key === "title" || key === "desc")) {
    return diagnostic({
      code: "schema/empty-string",
      message: `"${label}" must not be empty`,
      path,
    });
  }
  if (issue.code === "too_small" || issue.code === "too_big") {
    return diagnostic({ code: "schema/out-of-range", message: issue.message, path });
  }
  return diagnostic({
    code: "schema/invalid-type",
    message: `"${label}" must be ${describeExpected(issue.expected)}, not ${describeValue(context.valueAt(path))}`,
    path,
  });
}

function unknownField(
  issue: ZodIssue,
  path: Path,
  key: string | number | undefined,
): Diagnostic {
  const unknown = issue.keys?.[0] ?? String(key);
  const hint = knownFieldsHints(fieldLevelAt(path), unknown);
  return diagnostic({
    code: "schema/unknown-field",
    message: `unknown field "${unknown}" in ${formatPath(path)}`,
    path: [...path, unknown],
    ...(hint === undefined ? {} : { hint }),
  });
}

function invalidId(path: Path, label: string): Diagnostic {
  return diagnostic({
    code: "schema/invalid-id",
    message: `"${label}" ${ID_MESSAGE}`,
    path,
    hint: ID_HINT,
  });
}

/** A value the reader wrote in a form the spec does not accept. */
function badValue(
  key: string | number | undefined,
  path: Path,
  label: string,
): Diagnostic {
  if (key === "qty") {
    return diagnostic({
      code: "schema/invalid-quantity",
      message: `"${label}" must be a number, or a fraction such as "1/2" or "0.5"`,
      path,
    });
  }
  return diagnostic({
    code: "schema/invalid-type",
    message: `"${label}" must be an id, or { id, qty }`,
    path,
    hint: 'a reference is either "butter" or { id: butter, qty: 1/4 }',
  });
}

/** True when the document has a node at exactly `path`. */
export function hasNodeAt(doc: Document, path: Path): boolean {
  return doc.getIn(path, true) !== undefined;
}

/** The range of the node at `path`, or of its nearest existing ancestor. */
export function rangeForPath(
  doc: Document,
  path: Path,
): readonly [number, number] | undefined {
  for (let length = path.length; length >= 0; length--) {
    const node = doc.getIn(path.slice(0, length), true) as
      | { range?: readonly [number, number, number] | null }
      | undefined;
    const range = node?.range;
    if (range) return [range[0], range[1]];
  }
  const contents = doc.contents as { range?: readonly [number, number, number] } | null;
  if (contents?.range) return [contents.range[0], contents.range[1]];
  return undefined;
}

/** The range of the key node for `key` inside the map at `path` (excluding the key). */
export function keyRangeForPath(
  doc: Document,
  path: Path,
): readonly [number, number] | undefined {
  if (path.length === 0) return undefined;
  const key = path[path.length - 1];
  const parent = doc.getIn(path.slice(0, -1), true) as
    | {
        items?: {
          key?: { value?: unknown; range?: readonly [number, number, number] };
        }[];
      }
    | undefined;
  for (const item of parent?.items ?? []) {
    const keyNode = item.key;
    if (keyNode === undefined || keyNode.value !== key) continue;
    const range = keyNode.range;
    if (range) return [range[0], range[1]];
  }
  return undefined;
}

/** Adds `range` and `loc` to diagnostics that only carry a `path`. */
export function withSource(
  text: string,
  doc: Document,
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  return diagnostics.map((diag) => {
    const range = diag.range ?? rangeForPath(doc, diag.path);
    if (range === undefined) return diag;
    const from = offsetToLocation(text, range[0]);
    const to = offsetToLocation(text, range[1]);
    return {
      ...diag,
      range,
      loc: {
        line: from.line,
        column: from.column,
        endLine: to.line,
        endColumn: to.column,
      },
    };
  });
}

/**
 * Validates an already-parsed YAML value against the wire schema, then builds
 * the model. Returns every problem it can find, not just the first: someone
 * fixing a recipe wants the whole list in one pass.
 */
export function validateValue(
  doc: Document,
  value: unknown,
  text: string,
): ValidateResult {
  const context: IssueContext = {
    hasNode: (path) => hasNodeAt(doc, path),
    valueAt: (path) => doc.getIn(path, false) as unknown,
  };

  const parsed = recipeWire.safeParse(value);
  if (!parsed.success) {
    const diagnostics = parsed.error.issues.map((issue) =>
      issueToDiagnostic(issue as unknown as ZodIssue, context),
    );
    // An unknown field is reported against the key the reader wrote, not against
    // whatever value sits beside it.
    const located = diagnostics.map((diag) => {
      if (diag.code !== "schema/unknown-field") return diag;
      const range = keyRangeForPath(doc, diag.path);
      return range === undefined ? diag : { ...diag, range };
    });
    return { ok: false, diagnostics: withSource(text, doc, located) };
  }

  const modelled = toModel(parsed.data);
  if ("diagnostics" in modelled) {
    return { ok: false, diagnostics: withSource(text, doc, modelled.diagnostics) };
  }
  return { ok: true, model: modelled.model };
}
