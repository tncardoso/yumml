/**
 * The HTTP server behind `yumml cookbook`.
 *
 * Five routes, no framework, and one rule that decides the shape of the
 * routing: **a request never contributes a path segment to a filesystem lookup**
 * The list route reads a directory that was already scanned, `/assets/`
 * goes through the whitelist in `paths.ts`, and everything else is a 404. That is
 * why the traversal tests are short: there is no code here to traverse with.
 *
 * No watcher, `/events`, or `/api/validate` route yet. What is here is
 * what the list page needs plus the lifecycle the CLI builds on: bind, report a
 * URL, close cleanly, and never touch `process` — the CLI owns signals, the
 * terminal and the exit code.
 */

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { extname } from "node:path";
import { assetPath } from "./paths.ts";
import { renderRecipePage } from "./render/detail.ts";
import { renderBrokenPage } from "./render/diagnostics.ts";
import { html, render } from "./render/html.ts";
import { renderListPage, summarize } from "./render/list.ts";
import { isFilterName, renderPage } from "./render/page.ts";
import { type CookbookIndex, createScanner, type Scanner } from "./scan.ts";

export type CookbookOptions = {
  /** The directory to serve, already known to exist by the caller. */
  readonly root: string;
  /** Serve only this slug, for `yumml cookbook one-recipe.yaml`. */
  readonly only?: string;
  readonly host?: string;
  readonly port?: number;
  /** Printed in the footer, and reported by `summary()`. */
  readonly version?: string;
  /** Where internal errors go. The CLI owns the terminal. */
  readonly log?: (message: string) => void;
};

export type CookbookSummary = {
  readonly total: number;
  readonly broken: number;
  readonly truncated: boolean;
};

export type Cookbook = {
  /** The URL to open, with the port the OS actually gave us. */
  readonly url: string;
  readonly host: string;
  readonly port: number;
  /** What the banner says: how many recipes, and how many of them are broken. */
  summary(): Promise<CookbookSummary>;
  /** Stops listening and drops open connections. Safe to call twice. */
  close(): Promise<void>;
};

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
};

/** How many ports past the requested one are worth trying. */
const PORT_ATTEMPTS = 10;

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** The address a person can type: the bound one, or this machine's when bound to all. */
function displayHost(host: string): string {
  if (host !== "0.0.0.0" && host !== "::") return host;
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return "127.0.0.1";
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  head: boolean,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(body, "utf8");
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(payload.byteLength),
    // Nothing here is worth caching: the point of the command is that the files
    // under it change while it runs.
    "cache-control": "no-store",
    ...headers,
  });
  response.end(head ? undefined : payload);
}

function sendStatus(
  response: ServerResponse,
  status: number,
  head: boolean,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { "cache-control": "no-store", ...headers });
  response.end(head ? undefined : Buffer.alloc(0));
}

/** A 404 in the site's own clothes: a card links to one until it has its own page. */
function notFound(options: CookbookOptions, pathname: string): string {
  return render(
    renderPage({
      title: "Not found",
      recipes: 0,
      query: "",
      filter: "all",
      version: options.version ?? "",
      body: html`
        <section class="hero">
          <p class="eyebrow">404</p>
          <h1 class="hero-title">No recipe here.</h1>
          <p class="empty">The cookbook has nothing at <code>${pathname}</code>.</p>
          <p><a class="results-clear" href="/">Back to the list</a></p>
        </section>
      `,
    }),
  );
}

/** A 500 that says where the stack went instead of putting it in the page. */
function broken(options: CookbookOptions): string {
  return render(
    renderPage({
      title: "Error",
      recipes: 0,
      query: "",
      filter: "all",
      version: options.version ?? "",
      body: html`
        <section class="hero">
          <p class="eyebrow">500</p>
          <h1 class="hero-title">yumml broke.</h1>
          <p class="empty">The terminal it was started from has the stack trace.</p>
        </section>
      `,
    }),
  );
}

/** Binds one port, or rejects with whatever the OS said. */
function listen(
  server: ReturnType<typeof createServer>,
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: unknown) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

export async function createCookbook(options: CookbookOptions): Promise<Cookbook> {
  const host = options.host ?? "127.0.0.1";
  const version = options.version ?? "";
  const log = options.log ?? (() => {});
  const scanner: Scanner = createScanner(options.root);

  /** The list is served from a fresh index, which is what makes a reload current. */
  async function scan(): Promise<CookbookIndex> {
    const scanned = await scanner.index();
    if (options.only === undefined) return scanned;
    return {
      ...scanned,
      recipes: scanned.recipes.filter((entry) => entry.slug === options.only),
    };
  }

  /** `/` and nothing else: the list, narrowed by the query string. */
  async function serveList(
    response: ServerResponse,
    head: boolean,
    url: URL,
  ): Promise<void> {
    const filter = url.searchParams.get("filter") ?? "all";
    const page = renderListPage(await scan(), {
      query: url.searchParams.get("q") ?? "",
      filter: isFilterName(filter) ? filter : "all",
      version,
    });
    send(response, 200, render(page), head);
  }

  /** `/assets/<name>`, where the name came from the whitelist or not at all. */
  async function serveAsset(
    response: ServerResponse,
    head: boolean,
    name: string,
  ): Promise<void> {
    const asset = assetPath(name);
    if (asset === undefined) {
      sendStatus(response, 404, head);
      return;
    }
    try {
      const bytes = await readFile(asset);
      response.writeHead(200, {
        "content-type": contentType(asset),
        "content-length": String(bytes.byteLength),
        "cache-control": "no-store",
      });
      response.end(head ? undefined : bytes);
    } catch {
      // A name on the list whose file is missing is a 404, not a crash.
      sendStatus(response, 404, head);
    }
  }

  /**
   * `/r/<slug>` is the page, and `/r/<slug>.yaml` is the file.
   *
   * The slug is looked up in the index; the extension is only a hint about which
   * of the two the reader asked for. A file called `x.yaml.yaml` therefore keeps
   * its page at `/r/x.yaml`, which is the lookup that wins — its bytes are the one
   * thing this scheme cannot name, and that is the price of a readable URL over a
   * `/raw/` prefix.
   */
  async function serveRecipe(
    response: ServerResponse,
    head: boolean,
    requested: string,
  ): Promise<void> {
    const current = await scan();
    const context = {
      recipes: current.recipes.length,
      version,
      now: Date.now(),
    };

    const found = current.recipes.find((entry) => entry.slug === requested);
    if (found !== undefined) {
      const page = found.result.ok
        ? renderRecipePage(found, found.result.recipe, context)
        : renderBrokenPage(found, context);
      send(response, 200, render(page), head);
      return;
    }

    const raw = requested.replace(/\.ya?ml$/i, "");
    const file =
      raw === requested ? undefined : current.recipes.find((entry) => entry.slug === raw);
    if (file === undefined) {
      send(response, 404, notFound(options, `/r/${requested}`), head);
      return;
    }

    const payload = Buffer.from(file.text, "utf8");
    response.writeHead(200, {
      "content-type": "text/yaml; charset=utf-8",
      "content-length": String(payload.byteLength),
      "cache-control": "no-store",
    });
    response.end(head ? undefined : payload);
  }

  async function respond(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const method = request.method ?? "GET";
    const head = method === "HEAD";
    if (method !== "GET" && method !== "HEAD") {
      sendStatus(response, 405, head, { allow: "GET, HEAD" });
      return;
    }

    let url: URL;
    let pathname: string;
    try {
      url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendStatus(response, 400, head);
      return;
    }

    if (pathname === "/") {
      await serveList(response, head, url);
      return;
    }
    if (pathname.startsWith("/assets/")) {
      await serveAsset(response, head, pathname.slice("/assets/".length));
      return;
    }
    if (pathname.startsWith("/r/") && pathname.length > "/r/".length) {
      await serveRecipe(response, head, pathname.slice("/r/".length));
      return;
    }

    send(response, 404, notFound(options, pathname), head);
  }

  const server = createServer((request, response) => {
    respond(request, response).catch((error: unknown) => {
      const reason = error instanceof Error ? error.stack : String(error);
      log(`yumml: internal error: ${reason}\n`);
      if (response.headersSent) {
        response.end();
        return;
      }
      try {
        send(response, 500, broken(options), request.method === "HEAD");
      } catch {
        response.destroy();
      }
    });
  });

  const requested = options.port ?? 4321;
  let bound = requested;
  let failure: unknown;
  let listening = false;

  for (let attempt = 0; attempt < (requested === 0 ? 1 : PORT_ATTEMPTS); attempt++) {
    const candidate = requested === 0 ? 0 : requested + attempt;
    try {
      await listen(server, candidate, host);
      bound = candidate;
      listening = true;
      break;
    } catch (error) {
      failure = error;
      // Only a busy port is worth another number: a bad address or a privileged
      // port will fail the same way ten times.
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") break;
    }
  }
  if (!listening) throw failure;

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : bound;
  let closed = false;

  return {
    url: `http://${displayHost(host)}:${port}/`,
    host,
    port,
    async summary(): Promise<CookbookSummary> {
      const current = await scan();
      const totals = summarize(current.recipes);
      return {
        total: totals.recipes,
        broken: totals.broken,
        truncated: current.truncated,
      };
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // A browser holding a keep-alive connection would otherwise keep close()
      // waiting, and Ctrl-C would look like a hang.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
