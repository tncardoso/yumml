/**
 * L1 — YAML to a plain object, keeping the source ranges.
 *
 * The parser is `yaml` (eemeli), chosen because it is pure JavaScript with no
 * Node built-ins (so the browser build works), because `parseDocument` keeps the
 * byte range of every node — which is what makes an error message point at a
 * line — and because it refuses to construct arbitrary objects from tags.
 *
 * The policy here is plan.md §4.2: one document, duplicate keys are errors,
 * merge keys and custom tags are refused, and scalars are never coerced beyond
 * the YAML 1.2 core schema. In particular `2024-01-01` stays a string and
 * `yes` stays a string (D24); a `title: 2024` does not become a year.
 */

import {
  type Document,
  type DocumentOptions,
  type ParseOptions,
  parseAllDocuments,
  type SchemaOptions,
} from "yaml";
import {
  type Diagnostic,
  diagnostic,
  offsetToLocation,
  type Path,
} from "../diagnostics.ts";
import { keyRangeForPath } from "./validate.ts";

export type YamlResult =
  | { readonly ok: true; readonly doc: Document; readonly value: unknown }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

const PARSE_OPTIONS: ParseOptions & DocumentOptions & SchemaOptions = {
  version: "1.2",
  schema: "core",
  merge: false,
  uniqueKeys: true,
  customTags: [],
  // Keys are always strings, and a key that is not a scalar is an error.
  stringKeys: true,
};

/**
 * A document with nothing in it: `---` at the end of a file, or a file that is
 * only comments. The parser gives these a null scalar rather than no contents.
 */
function isEmptyDocument(doc: Document): boolean {
  const contents = doc.contents as { value?: unknown } | null;
  if (contents === null) return true;
  return contents.value === null && !("items" in contents) && !("pairs" in contents);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finds a literal `<<` key, which is what a merge key looks like when refused. */
function findMergeKey(value: unknown, path: Path = []): Path | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findMergeKey(item, [...path, index]);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (key === "<<") return [...path, key];
    const found = findMergeKey(item, [...path, key]);
    if (found) return found;
  }
  return undefined;
}

/**
 * Parses source text into a YAML document plus its plain-JS value. Anchors and
 * aliases are resolved; a recipe that needs an alias for a 20-line file is
 * unlikely, but refusing them would break valid YAML for no gain.
 */
export function parseYaml(text: string): YamlResult {
  let docs: Document[];
  try {
    docs = parseAllDocuments(text, PARSE_OPTIONS);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          code: "yaml/syntax",
          message:
            error instanceof Error ? error.message : "the YAML could not be parsed",
          path: [],
        }),
      ],
    };
  }

  const content = docs.filter((doc) => !isEmptyDocument(doc));
  if (content.length === 0) {
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          code: "yaml/empty-document",
          message: "the file is empty; a recipe needs a title and at least one step",
          path: [],
          loc: { line: 1, column: 1, endLine: 1, endColumn: 1 },
        }),
      ],
    };
  }
  if (content.length > 1) {
    const second = content[1];
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          code: "yaml/multiple-documents",
          message:
            "a recipe file holds exactly one recipe, but a second document starts here",
          path: [],
          ...rangeOf(text, second?.contents?.range),
        }),
      ],
    };
  }

  const doc = content[0] as Document;
  const diagnostics: Diagnostic[] = [];

  for (const error of doc.errors) {
    diagnostics.push(
      diagnostic({
        code: error.code === "DUPLICATE_KEY" ? "yaml/duplicate-key" : "yaml/syntax",
        message: firstLine(error.message),
        path: [],
        ...locOf(error.linePos),
      }),
    );
  }
  for (const warning of doc.warnings) {
    if (warning.code === "TAG_RESOLVE_FAILED") {
      diagnostics.push(
        diagnostic({
          code: "yaml/unknown-tag",
          message: firstLine(warning.message),
          path: [],
          ...locOf(warning.linePos),
        }),
      );
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: 100 });
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          code: "yaml/syntax",
          message:
            error instanceof Error ? error.message : "the YAML could not be resolved",
          path: [],
        }),
      ],
    };
  }

  if (value === null || value === undefined) {
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          code: "yaml/empty-document",
          message:
            "the file has no content; a recipe needs a title and at least one step",
          path: [],
        }),
      ],
    };
  }

  const merge = findMergeKey(value);
  if (merge) {
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          code: "yaml/merge-key",
          message:
            'a recipe does not use YAML merge keys ("<<"); write the fields out instead',
          path: merge,
          ...rangeOf(text, keyRangeForPath(doc, merge)),
        }),
      ],
    };
  }

  return { ok: true, doc, value };
}

function firstLine(message: string): string {
  return message.split("\n")[0] ?? message;
}

/** A range plus its 1-based location, or nothing when there is no node. */
function rangeOf(
  text: string,
  range: readonly [number, number, number] | readonly [number, number] | undefined | null,
): {
  range?: [number, number];
  loc?: { line: number; column: number; endLine: number; endColumn: number };
} {
  if (!range) return {};
  const [start, end] = [range[0], range[1]];
  const from = offsetToLocation(text, start);
  const to = offsetToLocation(text, end);
  return {
    range: [start, end],
    loc: { line: from.line, column: from.column, endLine: to.line, endColumn: to.column },
  };
}

function locOf(linePos: readonly { line: number; col: number }[] | undefined): {
  loc?: { line: number; column: number; endLine: number; endColumn: number };
} {
  const start = linePos?.[0];
  if (!start) return {};
  const end = linePos?.[1] ?? { line: start.line, col: start.col + 1 };
  return {
    loc: {
      line: start.line,
      column: start.col,
      endLine: end.line,
      endColumn: end.col,
    },
  };
}
