#!/usr/bin/env node
/**
 * The executable. Everything interesting lives in `cli.ts`; this file only
 * connects it to the process: argv, real files, stdin, and the exit code.
 */

import { readFileSync } from "node:fs";
import { runCli } from "./cli.ts";

const version = "0.1.0";

const exitCode = runCli({
  argv: process.argv.slice(2),
  readFile: (path) => (path === "-" ? readFileSync(0) : readFileSync(path)),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  version,
});

process.exit(exitCode);
