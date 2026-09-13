/**
 * The server's promises: the routes it has, the routes it does
 * not, and the one security claim worth proving twice — that a URL can never
 * reach a file it did not come from the index with.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { type Cookbook, createCookbook } from "./server.ts";

const GOOD = `title: Banana Bread
servings: 10
ingredients:
  - id: banana
    qty: 2
    unit: item
steps:
  - id: mash
    uses: [banana]
    time: 5m
`;

const BROKEN = `title: Toast
servings: 0
ingredients:
  - id: bread
    qty: 2
    unit: slice
steps:
  - id: toast
    uses: [bread]
`;

const dirs: string[] = [];
const servers: Cookbook[] = [];

async function cookbook(
  files: Record<string, string> = { "banana.yaml": GOOD, "bad.yaml": BROKEN },
  options: { only?: string } = {},
): Promise<Cookbook> {
  const root = await mkdtemp(join(tmpdir(), "yumml-server-"));
  dirs.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, contents);
  }
  await writeFile(join(root, "notes.md"), "not a recipe\n");
  const server = await createCookbook({
    root,
    port: 0,
    version: "9.9.9",
    ...(options.only === undefined ? {} : { only: options.only }),
  });
  servers.push(server);
  return server;
}

after(async () => {
  for (const server of servers) await server.close();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** One raw request, whose path is sent exactly as written. */
function raw(
  server: Cookbook,
  path: string,
  method = "GET",
): Promise<{ status: number; headers: NodeJS.Dict<string | string[]>; body: string }> {
  return new Promise((resolve, reject) => {
    const call = request(
      { host: server.host, port: server.port, path, method },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
          });
        });
      },
    );
    call.on("error", reject);
    call.end();
  });
}

describe("the routes", () => {
  test("the list is served, with every recipe on it", async () => {
    const server = await cookbook();
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const html = await response.text();
    assert.match(html, /Banana Bread/);
    // The first thing wrong with `bad.yaml`, in the file's own order.
    assert.match(html, /schema\/out-of-range/);
    assert.match(html, /servings must be a whole number of at least 1/);
    assert.match(html, /2 recipes/);
    // The file that is not a recipe is not a card and not a count.
    assert.ok(!html.includes("notes.md"));
  });

  test("the query narrows the list, and the URL is the whole state", async () => {
    const server = await cookbook();
    const found = await (await fetch(`${server.url}?q=banana`)).text();
    assert.match(found, /1 of 2 recipes/);
    assert.match(found, /Banana Bread/);

    const missing = await (await fetch(`${server.url}?q=sourdough`)).text();
    assert.match(missing, /Nothing matches that/);

    const filtered = await (await fetch(`${server.url}?filter=broken`)).text();
    assert.match(filtered, /1 of 2 recipes/);
    assert.match(filtered, /schema\/out-of-range/);

    // An unknown filter is `all`, not a 500.
    const nonsense = await fetch(`${server.url}?filter=zebra`);
    assert.equal(nonsense.status, 200);
  });

  test("the stylesheet is served from the package, not from the request", async () => {
    const server = await cookbook();
    const response = await fetch(`${server.url}assets/cookbook.css`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/css/);
    assert.match(await response.text(), /--canvas: #efece6/);
  });

  test("the core renderer and its browser dependency are served from the whitelist", async () => {
    const server = await cookbook();
    const renderer = await fetch(`${server.url}assets/render.js`);
    assert.equal(renderer.status, 200);
    assert.match(await renderer.text(), /renderRecipe/);

    const fraction = await fetch(`${server.url}assets/model/fraction.js`);
    assert.equal(fraction.status, 200);
    assert.match(await fraction.text(), /function format/);
  });

  test("a path that is not a route is the site's own 404", async () => {
    const server = await cookbook();
    for (const path of ["nope", "r/does-not-exist", "assets/../nope"]) {
      const response = await fetch(`${server.url}${path}`);
      assert.equal(response.status, 404, path);
      const html = await response.text();
      assert.match(html, /No recipe here/);
      assert.match(html, /Back to the list/);
    }
  });

  test("a recipe has a page of its own", async () => {
    const server = await cookbook();
    const response = await fetch(`${server.url}r/banana`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title>Banana Bread — yumml cookbook<\/title>/);
    assert.match(html, /class="timer-digits">05:00</);
    assert.match(html, /STEP 1 OF 1/);
    assert.match(html, /How it flows/);
    assert.match(html, /class="flow-frame" data-yumml-recipe="/);
    assert.match(html, /changed just now/);
  });

  test("a recipe's own bytes are one URL away", async () => {
    const server = await cookbook();
    const response = await fetch(`${server.url}r/banana.yaml`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/yaml/);
    assert.equal(await response.text(), GOOD);
  });

  test("a file that is not a recipe has a page too, not a 404 (C4)", async () => {
    const server = await cookbook();
    const response = await fetch(`${server.url}r/bad`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Not a recipe/);
    assert.match(html, /schema\/out-of-range/);
    assert.match(html, /class="diagnostic-frame"/);
    // The frame is the CLI's own, so the page and the terminal agree.
    assert.ok(html.includes("2 | servings: 0"), "the source is in the frame");
  });

  test("a slug that ends in .yaml still works, both ways", async () => {
    const server = await cookbook({ "note.yaml.yaml": GOOD });
    const page = await fetch(`${server.url}r/note.yaml`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Banana Bread/);

    const raw = await fetch(`${server.url}r/note.yaml.yaml`);
    assert.equal(raw.status, 200);
    assert.equal(await raw.text(), GOOD);
  });

  test("GET and HEAD only", async () => {
    const server = await cookbook();
    const posted = await fetch(server.url, { method: "POST" });
    assert.equal(posted.status, 405);
    assert.equal(posted.headers.get("allow"), "GET, HEAD");

    // A HEAD carries the headers the GET would have, and no body: the length is
    // the length of the document, which is the point of asking.
    const head = await raw(server, "/", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    const get = await raw(server, "/");
    assert.equal(head.headers["content-length"], get.headers["content-length"]);
    assert.ok(Number(head.headers["content-length"]) > 0);
  });

  test("serving one recipe narrows the whole page to it", async () => {
    const server = await cookbook(
      { "banana.yaml": GOOD, "bad.yaml": BROKEN },
      { only: "banana" },
    );
    const html = await (await fetch(server.url)).text();
    assert.match(html, /1 recipe\b/);
    assert.match(html, /Banana Bread/);
    assert.ok(!html.includes("schema/out-of-range"));
    assert.deepEqual(await server.summary(), {
      total: 1,
      broken: 0,
      truncated: false,
    });
  });
});

describe("what a URL cannot reach (C12)", () => {
  test("an asset name that is not on the list is a 404", async () => {
    const server = await cookbook();
    for (const name of [
      "package.json",
      "cookbook.css.bak",
      "../package.json",
      "%2e%2e%2fpackage.json",
      "..%2fpackage.json",
    ]) {
      const response = await fetch(`${server.url}assets/${name}`);
      assert.equal(response.status, 404, name);
    }
  });

  test("a traversal sent by hand is normalized away before it is used", async () => {
    const server = await cookbook();
    // `fetch` would tidy this up for us, so it goes out raw. The URL parser is
    // what flattens it; the whitelist is what would have caught it anyway.
    for (const path of [
      "/assets/../package.json",
      "/assets/%2e%2e/package.json",
      "/r/../../package.json",
      "/../package.json",
    ]) {
      const response = await raw(server, path);
      assert.equal(response.status, 404, path);
      assert.ok(!response.body.includes('"name": "@yumml/cli"'), path);
    }
  });

  test("a percent sign that is not an escape is a bad request, not a crash", async () => {
    const server = await cookbook();
    const response = await raw(server, "/assets/%zz.css");
    assert.equal(response.status, 400);
  });
});

describe("the lifecycle", () => {
  test("port 0 gets a real port, and closing frees it", async () => {
    const server = await cookbook();
    assert.ok(server.port > 0);
    assert.equal(server.url, `http://127.0.0.1:${server.port}/`);
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await assert.rejects(fetch(server.url), "the port is free again");

    // Closing twice is not an error, because a signal handler and an error path
    // can both reach it.
    await server.close();
  });

  test("a busy port moves along instead of failing", async () => {
    const first = await cookbook();
    const second = await cookbook({ "other.yaml": GOOD });
    // Ask the second for the first's port: the fallback must find another.
    const clash = await createCookbook({
      root: dirs[dirs.length - 1] ?? ".",
      host: "127.0.0.1",
      port: first.port,
      version: "9.9.9",
    });
    servers.push(clash);
    assert.notEqual(clash.port, first.port);
    assert.ok(clash.port > 0);
    assert.equal((await fetch(clash.url)).status, 200);
    void second;
  });

  test("a directory that is not there is an empty cookbook, not a crash", async () => {
    const server = await createCookbook({
      root: join(tmpdir(), "yumml-does-not-exist-000"),
      port: 0,
      version: "9.9.9",
    });
    servers.push(server);
    const html = await (await fetch(server.url)).text();
    assert.match(html, /No recipes here yet/);
  });
});
