import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { byPosition, type Diagnostic, formatDiagnostic } from "../diagnostics.ts";
import { parseRecipe } from "../index.ts";
import { loadSource } from "./load.ts";
import { parseYaml } from "./yaml.ts";

const GOOD = `title: Toast
ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [bread]
`;

describe("L1 — YAML policy", () => {
  test("parses a plain recipe", () => {
    const result = parseYaml(GOOD);
    assert.ok(result.ok);
    assert.deepEqual((result.value as Record<string, unknown>).title, "Toast");
  });

  test("duplicate keys are an error, not last-write-wins", () => {
    const result = parseYaml(`${GOOD}title: Bread\n`);
    assert.ok(!result.ok);
    assert.equal(result.diagnostics[0]?.code, "yaml/duplicate-key");
    assert.equal(result.diagnostics[0]?.loc?.line, 9);
    assert.equal(result.diagnostics[0]?.loc?.column, 1);
  });

  test("a second document is an error", () => {
    const result = parseYaml(`${GOOD}---\ntitle: Bread\n`);
    assert.ok(!result.ok);
    assert.equal(result.diagnostics[0]?.code, "yaml/multiple-documents");
  });

  test("a trailing `---` with nothing after it is not a second document", () => {
    assert.ok(parseYaml(`${GOOD}---\n`).ok);
  });

  test("merge keys are refused (D24)", () => {
    const result = parseYaml("title: Toast\nbase: &b\n  qty: 2\nmore:\n  <<: *b\n");
    assert.ok(!result.ok);
    assert.equal(result.diagnostics[0]?.code, "yaml/merge-key");
    assert.deepEqual(result.diagnostics[0]?.path, ["more", "<<"]);
  });

  test("custom tags are refused", () => {
    const result = parseYaml("title: !Ref toast\n");
    assert.ok(!result.ok);
    assert.equal(result.diagnostics[0]?.code, "yaml/unknown-tag");
  });

  test("anchors and aliases are resolved", () => {
    const result = parseYaml("a: &x 2\nb: *x\n");
    assert.ok(result.ok);
    assert.deepEqual(result.value, { a: 2, b: 2 });
  });

  test("scalars are never coerced beyond the YAML 1.2 core schema (D24)", () => {
    const result = parseYaml("d: 2024-01-01\ny: yes\nn: no\nz: 007\n");
    assert.ok(result.ok);
    assert.deepEqual(result.value, { d: "2024-01-01", y: "yes", n: "no", z: 7 });
  });

  test("syntax errors, tabs and empty files are reported", () => {
    const syntax = parseYaml("title: [Toast\n");
    assert.ok(!syntax.ok);
    assert.equal(syntax.diagnostics[0]?.code, "yaml/syntax");

    const tabs = parseYaml("a:\n\tb: 1\n");
    assert.ok(!tabs.ok);
    assert.equal(tabs.diagnostics[0]?.code, "yaml/syntax");

    const empty = parseYaml("# nothing here\n");
    assert.ok(!empty.ok);
    assert.equal(empty.diagnostics[0]?.code, "yaml/empty-document");
  });

  test("CRLF sources parse the same as LF", () => {
    const crlf = GOOD.replace(/\n/g, "\r\n");
    const result = parseRecipe(crlf);
    assert.ok(result.ok);
    assert.equal(result.recipe.title, "Toast");
  });
});

describe("L0 — loading", () => {
  test("a UTF-8 BOM is stripped", () => {
    const result = parseRecipe(`\uFEFF${GOOD}`);
    assert.ok(result.ok);
    assert.equal(result.recipe.title, "Toast");
  });

  test("bytes are decoded, and a UTF-8 BOM in the bytes too", () => {
    const bytes = new TextEncoder().encode(GOOD);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    assert.ok(parseRecipe(withBom).ok);
    assert.ok(parseRecipe(bytes).ok);
  });

  test("UTF-16 is refused rather than guessed at", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x74, 0x00]);
    const loaded = loadSource(bytes);
    assert.ok(!loaded.ok);
    assert.equal(loaded.diagnostics[0]?.code, "load/unsupported-encoding");
  });

  test("invalid UTF-8 is refused", () => {
    const loaded = loadSource(new Uint8Array([0x74, 0xff, 0xfe, 0x69]));
    assert.ok(!loaded.ok);
    assert.equal(loaded.diagnostics[0]?.code, "load/invalid-utf8");
  });

  test("a huge input is refused before it is parsed", () => {
    const loaded = loadSource("a".repeat(1_048_577));
    assert.ok(!loaded.ok);
    assert.equal(loaded.diagnostics[0]?.code, "load/too-large");
  });
});

describe("diagnostics", () => {
  test("a code frame points at the offending text", () => {
    const text = 'title: Toast\nsteps:\n  - id: toast\n    uses: ["bread"]\n';
    const diagnostic: Diagnostic = {
      code: "ref/unresolved",
      message: '"bread" is not declared as an ingredient or a step',
      path: ["steps", 0, "uses", 0],
      severity: "error",
      range: [40, 47],
      loc: { line: 4, column: 11, endLine: 4, endColumn: 18 },
      hint: 'did you mean "bacon"?',
    };
    const rendered = formatDiagnostic(text, diagnostic, { file: "toast.yaml" });
    assert.match(rendered, /toast\.yaml:4:11 {2}error {2}ref\/unresolved/);
    assert.match(rendered, /uses: \["bread"\]/);
    assert.match(rendered, /\^+\n/);
    assert.match(rendered, /hint: did you mean "bacon"\?/);
  });

  test("diagnostics sort by position, and unpositioned ones go last", () => {
    const at = (line: number, column: number, code: string): Diagnostic => ({
      code: code as Diagnostic["code"],
      message: code,
      path: [],
      severity: "error",
      loc: { line, column },
    });
    const sorted = [at(5, 1, "b"), at(2, 3, "c"), at(2, 1, "a"), at(9, 9, "d")].sort(
      byPosition,
    );
    assert.deepEqual(
      sorted.map((d) => d.code),
      ["a", "c", "b", "d"],
    );
    const unpositioned: Diagnostic = {
      code: "load/too-large",
      message: "big",
      path: [],
      severity: "error",
    };
    assert.deepEqual(
      [unpositioned, at(1, 1, "a")].sort(byPosition).map((d) => d.code),
      ["a", "load/too-large"],
    );
  });
});
