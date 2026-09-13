/**
 * `yumml cookbook` as a command: check the path, start the server, say where it
 * is, wait to be told to stop.
 *
 * Everything from the outside world arrives as an argument — `stdout`, `stderr`,
 * whether to open a browser, and the promise that resolves on `Ctrl-C`. That is
 * what lets the tests run this whole function, server and all, with no signal, no
 * terminal and no browser.
 *
 * The banner is short and claims nothing this milestone cannot do: there is no
 * watcher yet, so it does not say "watching".
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { EXIT_OK, EXIT_USAGE } from "../exit.ts";
import { slugFor } from "./scan.ts";
import { type Cookbook, createCookbook } from "./server.ts";

export type CookbookIo = {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Opens a browser. Injected so a test never launches one. */
  readonly openBrowser?: (url: string) => void;
  /** Resolves when the user asked to stop: `Ctrl-C`, `SIGTERM`. */
  readonly stopped: Promise<void>;
};

export type CookbookRunOptions = {
  /** A directory, or a single recipe file. */
  readonly root: string;
  readonly host: string;
  readonly port: number;
  readonly open: boolean;
  readonly version: string;
};

/** A `stopped` promise wired to this process's signals, for the real CLI. */
export function processSignals(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

/** Opens the URL with whatever the platform uses, detached, and ignores failure. */
function openWithSystem(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `24 recipes in recipes/`, or `1 recipe in bread.yaml`, or `2000+ recipes in /`. */
function banner(
  summary: { total: number; broken: number },
  where: string,
  truncated: boolean,
): string {
  const total = truncated ? `${summary.total}+` : String(summary.total);
  const recipes = `${total} ${summary.total === 1 && !truncated ? "recipe" : "recipes"}`;
  const problems =
    summary.broken === 0
      ? ""
      : ` (${count(summary.broken, "file", "files")} with problems)`;
  return `yumml cookbook: ${recipes} in ${where}${problems}`;
}

/**
 * Runs the command until it is stopped, and returns the exit code. Never throws:
 * a path that is not there is a usage error, and a server that cannot bind is
 * reported with the reason the OS gave.
 */
export async function runCookbook(
  options: CookbookRunOptions,
  io: CookbookIo,
): Promise<number> {
  let isDirectory = false;
  try {
    const info = await stat(options.root);
    isDirectory = info.isDirectory();
    if (!isDirectory && !info.isFile()) {
      io.stderr(`yumml: cannot read ${options.root}: not a file or a directory\n`);
      return EXIT_USAGE;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr(`yumml: cannot read ${options.root}: ${reason}\n`);
    return EXIT_USAGE;
  }

  // A file is one recipe out of the directory that holds it, which is what
  // keeps the scan, the index and the URLs identical in both cases.
  const absolute = resolve(options.root);
  const root = isDirectory ? absolute : dirname(absolute);
  const only = isDirectory ? undefined : slugFor(basename(absolute));

  let cookbook: Cookbook;
  try {
    cookbook = await createCookbook({
      root,
      ...(only === undefined ? {} : { only }),
      host: options.host,
      port: options.port,
      version: options.version,
      log: (message) => io.stderr(message),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr(`yumml: cannot serve ${options.root}: ${reason}\n`);
    return EXIT_USAGE;
  }

  const summary = await cookbook.summary();
  const where = isDirectory
    ? options.root.endsWith("/")
      ? options.root
      : `${options.root}/`
    : options.root;

  io.stdout(`${banner(summary, where, summary.truncated)}\n`);
  io.stdout(`                ${cookbook.url}\n`);
  if (options.port !== 0 && options.port !== cookbook.port) {
    io.stdout(
      `                port ${options.port} was busy; ${cookbook.port} was free\n`,
    );
  }
  io.stdout("                Ctrl-C to stop\n");

  if (options.open) (io.openBrowser ?? openWithSystem)(cookbook.url);

  await io.stopped;
  await cookbook.close();
  return EXIT_OK;
}
