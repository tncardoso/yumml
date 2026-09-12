#!/usr/bin/env node
/**
 * The executable. Everything interesting lives in `cli.ts`; this file only
 * connects it to the process: argv, real files, stdin, and the exit code.
 */

import { readFileSync } from "node:fs";
import { runCli } from "./cli.ts";

const version = "0.1.1";

const argv = process.argv.slice(2);

const exitCode = runCli({
  // A package runner forwards the arguments that follow a `--` of its own, and
  // flags can follow it there: `pnpm run yumml -- parse recipe.yaml --summary`.
  // That separator belongs to the launch, not to yumml's own grammar, so it is
  // dropped here rather than in `parseArgs`.
  argv: argv[0] === "--" ? argv.slice(1) : argv,
  readFile: (path) => (path === "-" ? readFileSync(0) : readFileSync(path)),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  version,
});

process.exit(exitCode);
