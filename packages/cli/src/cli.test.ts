/**
 * The CLI's contract is its exit code, so that is what these tests assert:
 * `0` valid, `1` diagnostics, `2` usage or I/O, `3` a bug in yumml.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK, EXIT_USAGE, runCli } from "./cli.ts";

const VALID = `title: Toast
servings: 2
ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [bread]
    time: 5m
`;

/** Two shape problems at once: the schema reports everything in one pass. */
const INVALID_SHAPE = `title: Toast
servings: 0
ingredients:
  - id: bread
    qty: 2
    unit: slices
steps:
  - id: toast
    uses: [bread]
`;

/** Shape is clean, so L3 runs: the `butter` nobody declares. */
const INVALID_REFS = `title: Toast
ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [bread, butter]
`;

type Run = {
  code: number;
  out: string;
  err: string;
};

async function run(
  argv: readonly string[],
  files: Record<string, string> = {},
): Promise<Run> {
  let out = "";
  let err = "";
  const code = await runCli({
    argv,
    readFile: (path) => {
      const file = files[path];
      if (file === undefined)
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return file;
    },
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    version: "9.9.9",
  });
  return { code, out, err };
}

describe("yumml validate", () => {
  test("a valid recipe exits 0", async () => {
    const result = await run(["validate", "toast.yaml"], { "toast.yaml": VALID });
    assert.equal(result.code, EXIT_OK);
    assert.equal(result.out, "toast.yaml: valid\n");
    assert.equal(result.err, "");
  });

  test("a broken recipe exits 1 and prints a code frame per problem", async () => {
    const result = await run(["validate", "toast.yaml"], { "toast.yaml": INVALID_SHAPE });
    assert.equal(result.code, EXIT_DIAGNOSTICS);
    assert.match(result.err, /schema\/out-of-range/);
    assert.match(result.err, /schema\/invalid-unit/);
    assert.match(result.err, /2 \| servings: 0/);
    assert.match(result.err, /toast\.yaml: 2 problems/);
    assert.equal(result.out, "");
  });

  test("a reference problem is reported once the shape is sound", async () => {
    const result = await run(["validate", "toast.yaml"], { "toast.yaml": INVALID_REFS });
    assert.equal(result.code, EXIT_DIAGNOSTICS);
    assert.match(result.err, /ref\/unresolved/);
    assert.match(result.err, /8 \| {5}uses: \[bread, butter\]/);
    assert.match(result.err, /1 problem\n/);
  });

  test("--json prints diagnostics an editor can read", async () => {
    const result = await run(["validate", "toast.yaml", "--json"], {
      "toast.yaml": INVALID_REFS,
    });
    assert.equal(result.code, EXIT_DIAGNOSTICS);
    const payload = JSON.parse(result.out) as {
      ok: boolean;
      file: string;
      diagnostics: { code: string; message: string; loc?: { line: number } }[];
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.file, "toast.yaml");
    assert.deepEqual(
      payload.diagnostics.map((d) => d.code),
      ["ref/unresolved"],
    );
    assert.equal(payload.diagnostics[0]?.loc?.line, 8);
  });

  test("--json on a valid recipe still reports ok", async () => {
    const result = await run(["validate", "toast.yaml", "--json"], {
      "toast.yaml": VALID,
    });
    assert.equal(result.code, EXIT_OK);
    assert.deepEqual(JSON.parse(result.out), {
      ok: true,
      file: "toast.yaml",
      diagnostics: [],
    });
  });

  test("reads standard input when the file is -", async () => {
    const result = await run(["validate", "-"], { "-": VALID });
    assert.equal(result.code, EXIT_OK);
    assert.equal(result.out, "-: valid\n");
  });

  test("a missing file is a usage error, not a diagnostic", async () => {
    const result = await run(["validate", "nope.yaml"]);
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /cannot read nope\.yaml/);
  });
});

describe("yumml parse", () => {
  test("prints the model as JSON", async () => {
    const result = await run(["parse", "toast.yaml"], { "toast.yaml": VALID });
    assert.equal(result.code, EXIT_OK);
    const recipe = JSON.parse(result.out) as {
      title: string;
      servings: number;
      ledger: { ingredient: string; balanced: boolean }[];
      order: string[];
      steps: { timeSec?: number }[];
    };
    assert.equal(recipe.title, "Toast");
    assert.equal(recipe.servings, 2);
    assert.deepEqual(recipe.order, ["toast"]);
    assert.equal(recipe.steps[0]?.timeSec, 300);
    assert.deepEqual(recipe.ledger, [
      {
        ingredient: "bread",
        declared: { n: 2, d: 1 },
        drawn: { n: 2, d: 1 },
        balanced: true,
      },
    ]);
  });

  test("--summary prints a readable outline", async () => {
    const result = await run(["parse", "toast.yaml", "--summary"], {
      "toast.yaml": VALID,
    });
    assert.equal(result.code, EXIT_OK);
    assert.match(result.out, /^Toast \(servings: 2\)/);
    assert.match(result.out, /^ {2}2 slice {2}bread$/m);
    assert.match(result.out, /^ {3}1\. toast\s+toast$/m);
    assert.match(result.out, /uses bread\s+\|\s+timer 5m/);
    assert.match(result.out, /Ledger\n {2}bread\s+declared 2 slice\s+drawn 2 slice\s+ok/);
  });

  test("a broken recipe refuses to print a model", async () => {
    const result = await run(["parse", "toast.yaml"], { "toast.yaml": INVALID_REFS });
    assert.equal(result.code, EXIT_DIAGNOSTICS);
    assert.equal(result.out, "");
    assert.match(result.err, /ref\/unresolved/);
  });

  test("--json on a broken recipe is still machine-readable", async () => {
    const result = await run(["parse", "toast.yaml", "--json"], {
      "toast.yaml": INVALID_REFS,
    });
    assert.equal(result.code, EXIT_DIAGNOSTICS);
    assert.equal((JSON.parse(result.out) as { ok: boolean }).ok, false);
  });
});

describe("usage", () => {
  test("--help and --version exit 0", async () => {
    const help = await run(["--help"]);
    assert.equal(help.code, EXIT_OK);
    assert.match(help.out, /^yumml — recipes as YAML, checked hard/);
    assert.match(help.out, /Exit codes/);

    const version = await run(["--version"]);
    assert.equal(version.code, EXIT_OK);
    assert.equal(version.out, "9.9.9\n");
  });

  test("nonsense arguments exit 2 with the usage text", async () => {
    for (const argv of [
      [],
      ["frobnicate"],
      ["validate"],
      ["validate", "--nope", "x.yaml"],
    ]) {
      const result = await run(argv);
      assert.equal(result.code, EXIT_USAGE, argv.join(" "));
      assert.match(result.err, /Usage/);
    }
  });

  test("--json and --summary are mutually exclusive", async () => {
    const result = await run(["parse", "toast.yaml", "--json", "--summary"], {
      "toast.yaml": VALID,
    });
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /cannot both be used/);
  });

  test("a bug in yumml exits 3, never 1", async () => {
    const code = await runCli({
      argv: ["validate", "toast.yaml"],
      readFile: () => VALID,
      stdout: () => {
        throw new Error("the terminal exploded");
      },
      stderr: () => {},
      version: "9.9.9",
    });
    assert.equal(code, EXIT_INTERNAL);
  });
});
