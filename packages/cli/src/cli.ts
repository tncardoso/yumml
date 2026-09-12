/**
 * The command line surface (plan.md §6).
 *
 * ```
 * yumml validate <file|->          # human-readable, exit 1 on any error
 * yumml validate <file> --json     # machine-readable diagnostics
 * yumml parse <file|->             # the validated model, as JSON
 * yumml parse <file> --summary     # the same model, for a human
 * ```
 *
 * Exit codes are part of the contract: `0` valid, `1` diagnostics, `2` usage or
 * I/O, `3` an internal error — so a crash is never mistaken for a bad recipe.
 *
 * All of the I/O is injected, which keeps this file testable without a
 * subprocess and keeps `process.exit` in `main.ts` where it belongs.
 */

import { type Diagnostic, formatDiagnostic, parseRecipe } from "yumml";
import { formatSummary } from "./summary.ts";

export const EXIT_OK = 0;
export const EXIT_DIAGNOSTICS = 1;
export const EXIT_USAGE = 2;
export const EXIT_INTERNAL = 3;

export type CliIo = {
  readonly argv: readonly string[];
  /** Reads a file by path. `-` means standard input. May throw. */
  readonly readFile: (path: string) => string | Uint8Array;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly version: string;
};

const USAGE = `yumml — recipes as YAML, checked hard

Usage
  yumml validate <file|->       check a recipe, print every problem
  yumml parse <file|->          check a recipe, print the model

Options
  --json                        machine-readable output (diagnostics or model)
  --summary                     for \`parse\`: a readable outline instead of JSON
  -h, --help                    this text
  -V, --version                 the version

Exit codes
  0  the recipe is valid
  1  the recipe has diagnostics
  2  bad usage, or the file could not be read
  3  a bug in yumml

Examples
  yumml validate fixtures/banana.yaml
  yumml validate - < fixtures/banana.yaml
  yumml parse fixtures/banana.yaml --summary
`;

type Options = {
  readonly command: "validate" | "parse";
  readonly file: string;
  readonly json: boolean;
  readonly summary: boolean;
};

function parseArgs(argv: readonly string[]): Options | { error: string } {
  let command: Options["command"] | undefined;
  let file: string | undefined;
  let json = false;
  let summary = false;
  let endOfOptions = false;

  for (const arg of argv) {
    // `--` ends the options, POSIX-style: `yumml validate -- odd-file.yaml`.
    // A package runner's own `--` is stripped in `main.ts`, before this runs.
    if (!endOfOptions && arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && arg === "--json") json = true;
    else if (!endOfOptions && arg === "--summary") summary = true;
    else if (!endOfOptions && arg.startsWith("-") && arg !== "-")
      return { error: `unknown option "${arg}"` };
    else if (command === undefined) {
      if (arg !== "validate" && arg !== "parse") {
        return { error: `unknown command "${arg}"` };
      }
      command = arg;
    } else if (file === undefined) file = arg;
    else return { error: `unexpected argument "${arg}"` };
  }

  if (command === undefined) return { error: "no command given" };
  if (file === undefined)
    return { error: `\`yumml ${command}\` needs a file, or - for stdin` };
  if (json && summary) return { error: "--json and --summary cannot both be used" };
  return { command, file, json, summary };
}

function jsonDiagnostics(file: string, diagnostics: readonly Diagnostic[]): string {
  return `${JSON.stringify({ ok: false, file, diagnostics }, null, 2)}\n`;
}

/** Prints one code frame per diagnostic, then a count. */
function reportDiagnostics(
  io: CliIo,
  file: string,
  text: string,
  diagnostics: readonly Diagnostic[],
): number {
  io.stderr(diagnostics.map((d) => formatDiagnostic(text, d, { file })).join("\n\n"));
  const count = diagnostics.length;
  io.stderr(`\n${file}: ${count} problem${count === 1 ? "" : "s"}\n`);
  return EXIT_DIAGNOSTICS;
}

function read(
  io: CliIo,
  file: string,
): { ok: true; text: string | Uint8Array } | { ok: false } {
  try {
    return { ok: true, text: io.readFile(file) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr(
      `yumml: cannot read ${file === "-" ? "standard input" : file}: ${reason}\n`,
    );
    return { ok: false };
  }
}

function run(io: CliIo, options: Options): number {
  const source = read(io, options.file);
  if (!source.ok) return EXIT_USAGE;
  // The frame needs the text. `parseRecipe` takes the original value, because
  // deciding the encoding is L0's job and its diagnostics know better than we do.
  const text =
    typeof source.text === "string" ? source.text : new TextDecoder().decode(source.text);
  const result = parseRecipe(source.text);

  if (options.command === "validate") {
    if (options.json) {
      io.stdout(
        result.ok
          ? `${JSON.stringify({ ok: true, file: options.file, diagnostics: [] }, null, 2)}\n`
          : jsonDiagnostics(options.file, result.diagnostics),
      );
      return result.ok ? EXIT_OK : EXIT_DIAGNOSTICS;
    }
    if (result.ok) {
      io.stdout(`${options.file}: valid\n`);
      return EXIT_OK;
    }
    return reportDiagnostics(io, options.file, text, result.diagnostics);
  }

  if (!result.ok) {
    if (options.json) {
      io.stdout(jsonDiagnostics(options.file, result.diagnostics));
      return EXIT_DIAGNOSTICS;
    }
    return reportDiagnostics(io, options.file, text, result.diagnostics);
  }

  io.stdout(
    options.summary
      ? formatSummary(result.recipe)
      : `${JSON.stringify(result.recipe, null, 2)}\n`,
  );
  return EXIT_OK;
}

/**
 * Runs one invocation. Never throws: an unexpected failure becomes exit code 3
 * with the message on stderr, because a stack trace is not a recipe verdict.
 */
export function runCli(io: CliIo): number {
  try {
    const argv = io.argv;
    if (argv.includes("-h") || argv.includes("--help")) {
      io.stdout(USAGE);
      return EXIT_OK;
    }
    if (argv.includes("-V") || argv.includes("--version")) {
      io.stdout(`${io.version}\n`);
      return EXIT_OK;
    }
    const args = parseArgs(argv);
    if ("error" in args) {
      io.stderr(`yumml: ${args.error}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    return run(io, args);
  } catch (error) {
    io.stderr(
      `yumml: internal error: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    return EXIT_INTERNAL;
  }
}
