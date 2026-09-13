/**
 * Where this package keeps the cookbook's files and the core browser modules it serves.
 *
 * The cookbook's own files are relative to this module rather than to
 * `process.cwd()`. Core's public render entry is resolved as a package, so it
 * works both from a checkout and from an installed CLI.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The only names `/assets/<name>` will ever serve, in the order they are written. */
export const ASSET_NAMES = [
  "cookbook.css",
  "cookbook.js",
  "render.js",
  "render/palette.js",
  "model/fraction.js",
] as const;

export type AssetName = (typeof ASSET_NAMES)[number];

const ASSETS = new URL("../../assets/", import.meta.url);
const require = createRequire(import.meta.url);
const resolvedCoreRender = require.resolve("@yumml/yumml/render");
const CORE_RENDER = resolvedCoreRender.endsWith(".ts")
  ? fileURLToPath(new URL("../../../core/dist/render.js", import.meta.url))
  : resolvedCoreRender;
/*
  Every module the browser will ask for, keyed by the URL it asks for it under.
  `render.js` is an ES module, so each of its own relative imports is a second
  request: a name missing here is not a missing file, it is a 404 in the middle of
  loading the client, and the whole page loses its flow and its timer with it.
*/
const CORE_ASSETS: Readonly<Record<string, string>> = {
  "render.js": CORE_RENDER,
  "render/palette.js": join(dirname(CORE_RENDER), "render/palette.js"),
  "model/fraction.js": join(dirname(CORE_RENDER), "model/fraction.js"),
};

export function assetsDir(): string {
  return fileURLToPath(ASSETS);
}

/**
 * The absolute path of a published asset, or `undefined` for every other name.
 *
 * The whitelist is the whole point: a request never contributes a path
 * segment of its own, so `../` in a URL cannot reach anything. The file is not
 * guaranteed to exist — `cookbook.js` arrives with the client — and a caller
 * that gets a path must still cope with a read failure.
 */
export function assetPath(name: string): string | undefined {
  const coreAsset = CORE_ASSETS[name];
  if (coreAsset !== undefined) return coreAsset;
  return (ASSET_NAMES as readonly string[]).includes(name)
    ? fileURLToPath(new URL(name, ASSETS))
    : undefined;
}
