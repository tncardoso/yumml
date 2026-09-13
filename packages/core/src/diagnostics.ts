/**
 * One diagnostic type for every stage of the pipeline.
 *
 * The CLI, the test suite and (later) an editor plugin all read the same shape.
 * Two rules keep it useful:
 *
 * - `code` is stable and documented; `message` is not. Tests assert on codes, so
 *   rewriting a message never breaks the suite.
 * - `path` is always present, because it is what lets the pipeline route an
 *   error back to a line and column in the source.
 *
 * v1 emits `severity: "error"` only; the field exists so a future
 * warning level does not change the shape of every consumer.
 */

export type DiagnosticCode =
  // L0 — loading
  | "load/unsupported-encoding"
  | "load/invalid-utf8"
  | "load/too-large"
  // L1 — YAML
  | "yaml/syntax"
  | "yaml/duplicate-key"
  | "yaml/unknown-tag"
  | "yaml/multiple-documents"
  | "yaml/merge-key"
  | "yaml/empty-document"
  // L2 — schema
  | "schema/invalid-type"
  | "schema/unknown-field"
  | "schema/missing-field"
  | "schema/empty-string"
  | "schema/out-of-range"
  | "schema/invalid-id"
  | "schema/invalid-unit"
  | "schema/invalid-quantity"
  | "schema/invalid-duration"
  | "schema/unit-without-qty"
  // L3 — semantics
  | "id/duplicate"
  | "ref/unresolved"
  | "ref/duplicate"
  | "dag/cycle"
  | "node/unused"
  | "ledger/under-drawn"
  | "ledger/over-drawn"
  | "ledger/amount-on-step"
  | "ledger/amount-on-unquantified";

export type Path = readonly (string | number)[];

export type SourceLocation = {
  /** 1-based line. */
  readonly line: number;
  /** 1-based column, in UTF-16 code units. */
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
};

export type Diagnostic = {
  readonly code: DiagnosticCode;
  /** A sentence for a human: names the field, never the internal type. */
  readonly message: string;
  readonly path: Path;
  readonly severity: "error";
  /** Offsets into the source text, in UTF-16 code units, when the diagnostic came from a real node. */
  readonly range?: readonly [number, number];
  readonly loc?: SourceLocation;
  /** "did you mean ...?" — only set when a close match was found. */
  readonly hint?: string;
};

export type DiagnosticInput = {
  code: DiagnosticCode;
  message: string;
  path: Path;
  range?: readonly [number, number];
  /** Set directly by the stages that only know a line and column (L1). */
  loc?: SourceLocation;
  hint?: string;
};

export function diagnostic(input: DiagnosticInput): Diagnostic {
  const { range, loc, hint, ...rest } = input;
  return {
    ...rest,
    severity: "error",
    ...(range === undefined ? {} : { range }),
    ...(loc === undefined ? {} : { loc }),
    ...(hint === undefined ? {} : { hint }),
  };
}

/** Converts a byte offset into a 1-based line and column. */
export function offsetToLocation(text: string, offset: number): SourceLocation {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/** Adds a `loc` to a diagnostic that has a `range`, and drops a dangling range. */
export function withLocation(text: string, diag: Diagnostic): Diagnostic {
  if (diag.range === undefined) return diag;
  const [start, end] = diag.range;
  const from = offsetToLocation(text, start);
  const to = offsetToLocation(text, end);
  return {
    ...diag,
    loc: {
      line: from.line,
      column: from.column,
      endLine: to.line,
      endColumn: to.column,
    },
  };
}

/** Sorts diagnostics by position so the CLI never prints them out of order. */
export function byPosition(a: Diagnostic, b: Diagnostic): number {
  const al = a.loc?.line ?? Number.MAX_SAFE_INTEGER;
  const bl = b.loc?.line ?? Number.MAX_SAFE_INTEGER;
  if (al !== bl) return al - bl;
  const ac = a.loc?.column ?? Number.MAX_SAFE_INTEGER;
  const bc = b.loc?.column ?? Number.MAX_SAFE_INTEGER;
  if (ac !== bc) return ac - bc;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

export type FormatOptions = {
  /** File name shown in the header, or `<input>` for a string. */
  readonly file?: string;
  /** Lines of source context. Defaults to 1. */
  readonly context?: number;
};

function lineBounds(text: string, line: number): { start: number; end: number } {
  let start = 0;
  let current = 1;
  while (current < line) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) return { start: text.length, end: text.length };
    start = nl + 1;
    current++;
  }
  const nl = text.indexOf("\n", start);
  return { start, end: nl === -1 ? text.length : nl };
}

/**
 * Renders a diagnostic as a compiler-style code frame:
 *
 * ```
 * fixtures/banana.yaml:13:11  error  ref/unresolved
 *   ingredient "butter" is not declared
 *     13 |     uses: ["butter"]
 *        |             ^^^^^^^^
 *   hint: did you mean "bacon"?
 * ```
 */
export function formatDiagnostic(
  text: string,
  diag: Diagnostic,
  options: FormatOptions = {},
): string {
  const file = options.file ?? "<input>";
  const context = options.context ?? 1;
  const line = diag.loc?.line;
  const column = diag.loc?.column;
  const header =
    line === undefined || column === undefined
      ? `${file}  error  ${diag.code}`
      : `${file}:${line}:${column}  error  ${diag.code}`;

  const out = [header, `  ${diag.message}`];
  if (line !== undefined && column !== undefined) {
    const gutter = String(line + context).length;
    const first = Math.max(1, line - context);
    const last = line + context;
    for (let l = first; l <= last; l++) {
      const { start, end } = lineBounds(text, l);
      if (start === end && l !== line) continue;
      out.push(`  ${String(l).padStart(gutter)} | ${text.slice(start, end)}`);
      if (l === line) {
        const endColumn = Math.max(diag.loc?.endColumn ?? column, column + 1);
        const width =
          diag.loc?.endLine === undefined || diag.loc.endLine === line
            ? Math.max(1, endColumn - column)
            : 1;
        out.push(
          `  ${" ".repeat(gutter)} | ${" ".repeat(column - 1)}${"^".repeat(width)}`,
        );
      }
    }
  }
  if (diag.hint) out.push(`  hint: ${diag.hint}`);
  return out.join("\n");
}
