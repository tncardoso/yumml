/**
 * The command line surface.
 *
 * ```
 * yumml validate <file|->          # human-readable, exit 1 on any error
 * yumml validate <file> --json     # machine-readable diagnostics
 * yumml parse <file|->             # the validated model, as JSON
 * yumml parse <file> --summary     # the same model, for a human
 * yumml cookbook [dir|file]        # the pages, served, and rebuilt as you edit
 * ```
 *
 * Exit codes are part of the contract: `0` valid or stopped as asked, `1`
 * diagnostics, `2` usage or I/O, `3` an internal error — so a crash is never
 * mistaken for a bad recipe.
 *
 * All of the I/O is injected, which keeps this file testable without a
 * subprocess and keeps `process.exit` in `main.ts` where it belongs. The
 * cookbook needs two more seams than the other commands — a browser to open and
 * a promise that says when to stop — and they are optional, because
 * `validate` and `parse` neither open a window nor wait for `Ctrl-C`.
 */

import { type Diagnostic, formatDiagnostic, parseRecipe } from "@yumml/yumml";
import { processSignals, runCookbook } from "./cookbook/command.ts";
import { EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK, EXIT_USAGE } from "./exit.ts";
import { formatSummary } from "./summary.ts";

export { EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK, EXIT_USAGE };

export type CliIo = {
  readonly argv: readonly string[];
  /** Reads a file by path. `-` means standard input. May throw. */
  readonly readFile: (path: string) => string | Uint8Array;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly version: string;
  /** `yumml cookbook --open`. Never called by the other commands. */
  readonly openBrowser?: (url: string) => void;
  /** Resolves when the cookbook should stop. Never awaited by the other commands. */
  readonly stopped?: Promise<void>;
};

const USAGE = `yumml — recipes as YAML, checked hard

Usage
  yumml validate <file|->       check a recipe, print every problem
  yumml parse <file|->          check a recipe, print the model
  yumml cookbook [dir|file]     serve the recipes, rebuilt as you edit

Options
  --json                        machine-readable output (diagnostics or model)
  --summary                     for \`parse\`: a readable outline instead of JSON
  --port <n>                    for \`cookbook\`: the port, default 4321; 0 picks a free one
  --host <addr>                 for \`cookbook\`: bind something other than 127.0.0.1
  --open                        for \`cookbook\`: open the URL in a browser (off by default)
  --no-watch                    for \`cookbook\`: serve without reloading on change
  -h, --help                    this text
  -V, --version                 the version

Exit codes
  0  the recipe is valid, or the cookbook stopped as asked
  1  the recipe has diagnostics
  2  bad usage, or a file could not be read
  3  a bug in yumml

Examples
  yumml validate fixtures/banana.valid.yaml
  yumml validate - < fixtures/banana.valid.yaml
  yumml parse fixtures/banana.valid.yaml --summary
  yumml cookbook fixtures/
`;

const COMMANDS = ["validate", "parse", "cookbook"] as const;

type Command = (typeof COMMANDS)[number];

type Options =
  | {
      readonly command: "validate" | "parse";
      readonly file: string;
      readonly json: boolean;
      readonly summary: boolean;
    }
  | {
      readonly command: "cookbook";
      readonly file: string;
      readonly host: string;
      readonly port: number;
      readonly open: boolean;
      readonly watch: boolean;
    };

/** Which options each command takes, so a stray flag names the command that wanted it. */
const OPTIONS_OF: Record<Command, readonly string[]> = {
  validate: ["--json"],
  parse: ["--json", "--summary"],
  cookbook: ["--port", "--host", "--open", "--no-watch"],
};

function parsePort(value: string | undefined): number | { error: string } {
  if (value === undefined) return { error: "`--port` needs a number" };
  if (!/^\d+$/.test(value)) return { error: `--port must be a number, not "${value}"` };
  const port = Number(value);
  if (port > 65535) return { error: `--port must be 65535 or less, not ${port}` };
  return port;
}

/** Everything the flags can set, filled in as they are read. */
type Flags = {
  json: boolean;
  summary: boolean;
  open: boolean;
  watch: boolean;
  port: number;
  host: string;
};

/**
 * Reads one option — and its value, for the two that take one — or says what is
 * wrong with it. Returns the index the scan should continue from.
 */
function readFlag(
  flag: string,
  argv: readonly string[],
  index: number,
  flags: Flags,
): { next: number } | { error: string } {
  switch (flag) {
    case "--json":
      flags.json = true;
      return { next: index };
    case "--summary":
      flags.summary = true;
      return { next: index };
    case "--open":
      flags.open = true;
      return { next: index };
    case "--no-watch":
      flags.watch = false;
      return { next: index };
    case "--port": {
      const port = parsePort(argv[index + 1]);
      if (typeof port !== "number") return { error: port.error };
      flags.port = port;
      return { next: index + 1 };
    }
    case "--host": {
      const host = argv[index + 1];
      if (host === undefined || host.startsWith("-")) {
        return { error: "`--host` needs an address" };
      }
      flags.host = host;
      return { next: index + 1 };
    }
    default:
      return { error: `unknown option "${flag}"` };
  }
}

function assemble(
  command: Command,
  positional: readonly string[],
  seen: readonly string[],
  flags: Flags,
): Options | { error: string } {
  for (const flag of seen) {
    if (!OPTIONS_OF[command].includes(flag)) {
      return { error: `${flag} is not an option of \`yumml ${command}\`` };
    }
  }
  if (flags.json && flags.summary) {
    return { error: "--json and --summary cannot both be used" };
  }

  const [file] = positional;
  if (command === "cookbook") {
    if (file === "-") return { error: "`yumml cookbook` cannot read standard input" };
    // The path is optional, and `.` is the recipe directory people mean.
    return {
      command,
      file: file ?? ".",
      host: flags.host,
      port: flags.port,
      open: flags.open,
      watch: flags.watch,
    };
  }

  if (file === undefined) {
    return { error: `\`yumml ${command}\` needs a file, or - for stdin` };
  }
  return { command, file, json: flags.json, summary: flags.summary };
}

function parseArgs(argv: readonly string[]): Options | { error: string } {
  const flags: Flags = {
    json: false,
    summary: false,
    open: false,
    watch: true,
    port: 4321,
    host: "127.0.0.1",
  };
  const seen: string[] = [];
  const positional: string[] = [];
  let endOfOptions = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    // `--` ends the options, POSIX-style: `yumml validate -- odd-file.yaml`.
    // A package runner's own `--` is stripped in `main.ts`, before this runs.
    if (!endOfOptions && arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (endOfOptions || !arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }

    // Every flag is recorded, so `--json` on `cookbook` can be reported by name
    // rather than as an unknown option.
    seen.push(arg);
    const read = readFlag(arg, argv, index, flags);
    if ("error" in read) return { error: read.error };
    index = read.next;
  }

  // One command, then at most one path: `--- rest` is everything after both.
  const [first, ...rest] = positional;
  if (first === undefined) return { error: "no command given" };
  if (!(COMMANDS as readonly string[]).includes(first)) {
    return { error: `unknown command "${first}"` };
  }
  if (rest.length > 1) return { error: `unexpected argument "${rest[1]}"` };

  return assemble(first as Command, rest, seen, flags);
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

async function run(io: CliIo, options: Options): Promise<number> {
  if (options.command === "cookbook") {
    return runCookbook(
      {
        root: options.file,
        host: options.host,
        port: options.port,
        open: options.open,
        version: io.version,
      },
      {
        stdout: io.stdout,
        stderr: io.stderr,
        ...(io.openBrowser === undefined ? {} : { openBrowser: io.openBrowser }),
        stopped: io.stopped ?? processSignals(),
      },
    );
  }

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
 *
 * Asynchronous since the cookbook arrived: binding a port cannot happen after the
 * exit code has been decided, so the whole surface awaits rather than lying about
 * what it returns.
 */
export async function runCli(io: CliIo): Promise<number> {
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
    return await run(io, args);
  } catch (error) {
    io.stderr(
      `yumml: internal error: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    return EXIT_INTERNAL;
  }
}
