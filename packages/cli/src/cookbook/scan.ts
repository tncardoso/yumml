/**
 * Finding the recipes in a directory, and parsing them once.
 *
 * Two jobs, deliberately in one file: the walk answers "what files are there",
 * and the index answers "what does each of them say". They are used together and
 * they share the same cache key — the file's `mtimeMs` and size — so a change on
 * disk is noticed by comparing two numbers rather than by trusting a timestamp
 * we wrote ourselves.
 *
 * The walk is boring on purpose: recursive, no symlinks, an ignore list,
 * deterministic order, and a ceiling. A recipe directory that has been pointed
 * at `/` by accident should be a shrug, not a hang.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type ParseResult, parseRecipe } from "@yumml/yumml";

/** Above this many recipe files the walk stops and says so. */
export const MAX_FILES = 2000;

/** Directories that are never a recipe collection, checked by base name. */
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".pack", "coverage"]);

/** One recipe file, as found on disk, before it is read. */
export type FoundFile = {
  readonly slug: string;
  readonly relPath: string;
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
};

/** One recipe file, read and parsed. `result` is what `yumml validate` would say. */
export type IndexedRecipe = FoundFile & {
  readonly text: string;
  readonly result: ParseResult;
};

export type CookbookIndex = {
  readonly root: string;
  readonly recipes: readonly IndexedRecipe[];
  /** True when the tree held more than {@link MAX_FILES} recipes. */
  readonly truncated: boolean;
};

export type Scanner = {
  /** Walks the tree and parses whatever changed. Never throws for one bad file. */
  index(): Promise<CookbookIndex>;
};

/** True for `*.yaml` and `*.yml`, case-insensitively. */
export function isRecipeFile(name: string): boolean {
  return /\.ya?ml$/i.test(name);
}

export function isIgnoredDir(name: string): boolean {
  return name.startsWith(".") || IGNORED_DIRS.has(name);
}

/**
 * The URL name of a recipe: its path below the root, extension stripped.
 * `recipes/bread/sourdough.yaml` is `bread/sourdough`, which is also the key the
 * server looks up — never a path it builds from a request.
 */
export function slugFor(relPath: string): string {
  return relPath.replace(/\.ya?ml$/i, "");
}

/** Joins two halves of a relative path with `/`, whichever way the platform slices it. */
function childPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

/** A directory's entries, sorted, or nothing at all when it cannot be read. */
async function listDir(dir: string): Promise<Dirent[]> {
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    return dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    // A permission error on one directory should cost that directory, not the
    // page, and neither should a directory that vanished between two calls.
    return [];
  }
}

/** One file's stat, or nothing when it went away first. */
async function found(root: string, relPath: string): Promise<FoundFile | undefined> {
  try {
    const info = await stat(join(root, relPath));
    return {
      slug: slugFor(relPath),
      relPath,
      path: join(root, relPath),
      mtimeMs: info.mtimeMs,
      size: info.size,
    };
  } catch {
    return undefined;
  }
}

/** Every recipe file below `root`, as relative paths, until the ceiling. */
async function findRecipeFiles(
  root: string,
  limit: number,
): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = [];
  const queue: string[] = [""];
  let truncated = false;

  while (queue.length > 0) {
    const relDir = queue.shift() ?? "";
    const absDir = relDir === "" ? root : join(root, relDir);

    for (const dirent of await listDir(absDir)) {
      const relPath = childPath(relDir, dirent.name);
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        if (!isIgnoredDir(dirent.name)) queue.push(relPath);
      } else if (dirent.isFile() && isRecipeFile(dirent.name)) {
        if (paths.length >= limit) {
          truncated = true;
          break;
        }
        paths.push(relPath);
      }
    }
    if (truncated) break;
  }

  return { paths, truncated };
}

/**
 * Walks `root` for recipe files, stat-ing what it finds.
 *
 * Breadth-first, sorted at every level, so a run that hits the ceiling stops in
 * the same place every time — and sorted again at the end, because the order a
 * queue produces is not the order a person reads.
 */
export async function walk(
  root: string,
  limit: number = MAX_FILES,
): Promise<{ files: FoundFile[]; truncated: boolean }> {
  const { paths, truncated } = await findRecipeFiles(root, limit);
  const files: FoundFile[] = [];

  for (const relPath of paths) {
    const file = await found(root, relPath);
    if (file !== undefined) files.push(file);
  }
  files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

  return { files, truncated };
}

/**
 * A scanner over one root, with a cache keyed by path + mtime + size.
 *
 * There is no TTL and no invalidation policy: an entry that does not match the
 * current stat is simply not reused, and entries for files that disappeared are
 * dropped on the next pass, so the map cannot grow past the tree it describes.
 */
export function createScanner(root: string): Scanner {
  const cache = new Map<
    string,
    { mtimeMs: number; size: number; text: string; result: ParseResult }
  >();

  async function read(file: FoundFile): Promise<IndexedRecipe | undefined> {
    const hit = cache.get(file.path);
    if (hit !== undefined && hit.mtimeMs === file.mtimeMs && hit.size === file.size) {
      return { ...file, text: hit.text, result: hit.result };
    }

    let bytes: Uint8Array;
    try {
      bytes = await readFile(file.path);
    } catch {
      return undefined;
    }
    // The bytes go to the parser, which decides the encoding (L0) — and the text
    // is the UTF-8 reading of them, which is what the CLI's code frames need.
    // When L0 rejected the encoding there is no range to point at, so the text
    // is never used for that file.
    const text = new TextDecoder().decode(bytes);
    const result = parseRecipe(bytes);
    cache.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, text, result });
    return { ...file, text, result };
  }

  return {
    async index(): Promise<CookbookIndex> {
      const { files, truncated } = await walk(root);
      const recipes: IndexedRecipe[] = [];
      const current = new Set<string>();

      for (const file of files) {
        current.add(file.path);
        const recipe = await read(file);
        if (recipe !== undefined) recipes.push(recipe);
      }
      for (const path of cache.keys()) {
        if (!current.has(path)) cache.delete(path);
      }

      return { root, recipes, truncated };
    },
  };
}
