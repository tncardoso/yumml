/**
 * What the scan promises: which files are recipes, in what order, and that a
 * change on disk is noticed by comparing a stat rather than by trusting a cache
 *
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { createScanner, isRecipeFile, slugFor, walk } from "./scan.ts";

const VALID = `title: Toast
servings: 2
ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [bread]
`;

/** One problem, and only one, so the assertion says what it means. */
const BAD = `title: Toast
servings: 0
ingredients:
  - id: bread
    qty: 1
    unit: slice
steps:
  - id: toast
    uses: [bread]
`;

const dirs: string[] = [];

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yumml-scan-"));
  dirs.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, contents);
  }
  return root;
}

after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("scan", () => {
  test("finds yaml and yml, and nothing else", () => {
    for (const name of ["a.yaml", "b.yml", "c.YAML"]) {
      assert.equal(isRecipeFile(name), true, name);
    }
    for (const name of ["a.yaml.bak", "recipe.json", "yaml", "a.yamlx"]) {
      assert.equal(isRecipeFile(name), false, name);
    }
  });

  test("a slug is the path without its extension", () => {
    assert.equal(slugFor("banana.yaml"), "banana");
    assert.equal(slugFor("bread/sourdough.yml"), "bread/sourdough");
    assert.equal(slugFor("a.b.yaml"), "a.b");
  });

  test("walks recursively, in a stable order, skipping what it must", async () => {
    const root = await tree({
      "b.yaml": VALID,
      "a.yml": VALID,
      "notes.md": "not a recipe",
      "deep/nested/c.yaml": VALID,
      "node_modules/ignored.yaml": VALID,
      ".hidden/ignored.yaml": VALID,
    });
    const { files, truncated } = await walk(root);

    assert.deepEqual(
      files.map((file) => file.relPath),
      ["a.yml", "b.yaml", "deep/nested/c.yaml"],
    );
    assert.deepEqual(
      files.map((file) => file.slug),
      ["a", "b", "deep/nested/c"],
    );
    assert.equal(truncated, false);
    assert.ok(files.every((file) => file.size > 0 && file.mtimeMs > 0));
  });

  test("a symlink is not followed", async () => {
    const root = await tree({ "a.yaml": VALID, "other/b.yaml": VALID });
    await symlink(join(root, "other"), join(root, "linked"));
    const { files } = await walk(root);
    assert.deepEqual(
      files.map((file) => file.relPath),
      ["a.yaml", "other/b.yaml"],
    );
  });

  test("stops at the ceiling and says so", async () => {
    const root = await tree({
      "a.yaml": VALID,
      "b.yaml": VALID,
      "c.yaml": VALID,
      "d.yaml": VALID,
    });
    const { files, truncated } = await walk(root, 3);
    assert.equal(files.length, 3);
    assert.equal(truncated, true);
  });

  test("an unreadable directory costs that directory, not the walk", async () => {
    const root = await tree({ "a.yaml": VALID });
    const { files } = await walk(join(root, "does-not-exist"));
    assert.deepEqual(files, []);
  });

  test("parses what it finds, and reports a broken file as a verdict", async () => {
    const root = await tree({
      "good.yaml": VALID,
      "bad.yaml": BAD,
    });
    const index = await createScanner(root).index();

    assert.equal(index.recipes.length, 2);
    assert.equal(index.truncated, false);
    const good = index.recipes.find((entry) => entry.slug === "good");
    const bad = index.recipes.find((entry) => entry.slug === "bad");
    assert.equal(good?.result.ok, true);
    assert.equal(bad?.result.ok, false);
    assert.deepEqual(
      bad?.result.ok === false ? bad.result.diagnostics.map((d) => d.code) : [],
      ["schema/out-of-range"],
    );
  });
});

describe("the scanner's cache", () => {
  test("reuses a parse until the file's mtime or size changes", async () => {
    const root = await tree({ "a.yaml": VALID });
    const scanner = createScanner(root);

    const first = await scanner.index();
    const second = await scanner.index();
    // Same object would be fine too; what matters is that the text and the model
    // are the cached ones rather than a second read.
    assert.equal(first.recipes[0]?.text, second.recipes[0]?.text);

    await writeFile(join(root, "a.yaml"), `${VALID}# a comment, so the size changes\n`);
    const third = await scanner.index();
    assert.equal(third.recipes[0]?.result.ok, true);
    assert.notEqual(third.recipes[0]?.text, first.recipes[0]?.text);
  });

  test("forgets a file that went away", async () => {
    const root = await tree({ "a.yaml": VALID, "b.yaml": VALID });
    const scanner = createScanner(root);
    assert.equal((await scanner.index()).recipes.length, 2);

    await rm(join(root, "b.yaml"));
    assert.deepEqual(
      (await scanner.index()).recipes.map((entry) => entry.slug),
      ["a"],
    );
  });
});
