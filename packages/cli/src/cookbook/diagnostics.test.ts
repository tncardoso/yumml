/**
 * The page a file gets when it is not a recipe.
 *
 * The important test here is the last one: the frame on the page is the string
 * `formatDiagnostic` prints, for every broken fixture in the repository. That is
 * what stops the two surfaces — the terminal and the browser — from drifting into
 * two different explanations of the same mistake.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Diagnostic, formatDiagnostic, parseRecipe } from "@yumml/yumml";
import { renderBrokenPage } from "./render/diagnostics.ts";
import type { IndexedRecipe } from "./scan.ts";

const fixtures = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));
/** A whole recipe with one thing wrong with it, so the counts mean something. */
const ONE_PROBLEM = `title: Toast
servings: 0
ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [bread]
`;

const MTIME = Date.parse("2026-09-12T12:00:00Z");
const NOW = Date.parse("2026-09-12T12:02:00Z");

function entry(text: string, slug = "bad"): IndexedRecipe {
  return {
    slug,
    relPath: `${slug}.yaml`,
    path: `/recipes/${slug}.yaml`,
    mtimeMs: MTIME,
    size: text.length,
    text,
    result: parseRecipe(text),
  };
}

function page(text: string): string {
  return renderBrokenPage(entry(text), {
    recipes: 3,
    version: "9.9.9",
    now: NOW,
  }).value;
}

/** The `<pre>` blocks, in order, with their entities put back. */
function frames(html: string): string[] {
  return [...html.matchAll(/<pre class="diagnostic-frame">([\s\S]*?)<\/pre>/g)].map(
    (match) =>
      (match[1] ?? "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&"),
  );
}

describe("the page for a file that is not a recipe", () => {
  test("names the file, counts the problems and points at the source", () => {
    const html = page(ONE_PROBLEM);
    assert.match(html, /<title>bad — not a recipe — yumml cookbook<\/title>/);
    assert.match(html, /<h1 class="recipe-title">bad<\/h1>/);
    assert.match(html, /class="eyebrow">Not a recipe</);
    assert.match(html, /<a href="\/r\/bad\.yaml">bad\.yaml<\/a>/);
    assert.match(html, /changed 2 min ago · \d+ diagnostics?/);
  });

  test("one problem reads in the singular", () => {
    const html = page(ONE_PROBLEM);
    assert.match(html, /1 problem, and yumml will not\s+guess past it/);
    assert.match(html, /1 diagnostic</);
  });

  test("several problems are counted, and all of them are shown", () => {
    const html = page("title: ''\n");
    const codes = [...html.matchAll(/chip chip--broken">([^<]+)</g)].map(
      (match) => match[1],
    );
    assert.ok(codes.length >= 3, `expected several diagnostics, got ${codes.length}`);
    assert.equal(frames(html).length, codes.length);
  });

  test("the code is a chip, and the frame is the CLI's own monospace block", () => {
    const html = page(ONE_PROBLEM);
    assert.match(html, /chip chip--broken">schema\/out-of-range</);
    assert.equal(frames(html).length, 1);
    assert.match(
      frames(html)[0] ?? "",
      /^bad\.yaml:2:11 {2}error {2}schema\/out-of-range$/m,
    );
    assert.match(frames(html)[0] ?? "", /servings: 0/);
    assert.match(frames(html)[0] ?? "", /\^$/m);
  });

  test("escapes the source it quotes, the way the terminal cannot", () => {
    const html = page("title: '<img src=x onerror=alert(1)>'\n");
    assert.ok(!html.includes("<img src=x"));
    // The frame is the exception, and on purpose: it is inside a <pre>, and the
    // characters that would end the element are escaped either way.
    assert.ok(!html.includes("</pre><img"));
  });
});

describe("the page and the terminal agree", () => {
  const dir = `${fixtures}invalid/`;
  const files = readdirSync(dir).filter((name) => name.endsWith(".yaml"));

  for (const file of files) {
    test(`${file}: the frames are exactly what the CLI prints`, () => {
      const text = readFileSync(`${dir}${file}`, "utf8");
      const result = parseRecipe(text);
      assert.equal(result.ok, false, `${file} must stay invalid`);

      const page = renderBrokenPage(
        { ...entry(text, file.replace(/\.yaml$/, "")), relPath: file },
        { recipes: 1, version: "9.9.9", now: NOW },
      ).value;
      const shown = frames(page);
      const printed = (
        result.ok ? [] : (result.diagnostics as readonly Diagnostic[])
      ).map((diagnostic) => formatDiagnostic(text, diagnostic, { file }));

      assert.deepEqual(shown, printed);
    });
  }

  test("the frames keep the CLI's order, top to bottom", () => {
    const text = readFileSync(`${fixtures}banana.yaml`, "utf8");
    const page = readBroken(text);
    const lines = frames(page).map((frame) => frame.split("\n")[0] ?? "");
    const sorted = [...lines].sort((a, b) => {
      const line = (value: string) => Number(value.split(":")[1] ?? 0);
      return line(a) - line(b);
    });
    assert.deepEqual(lines, sorted);
  });
});

function readBroken(text: string): string {
  return renderBrokenPage(entry(text, "banana"), {
    recipes: 1,
    version: "9.9.9",
    now: NOW,
  }).value;
}
