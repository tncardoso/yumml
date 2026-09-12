/**
 * L0 — turning bytes into text.
 *
 * The CLI reads the file; the core never touches the filesystem, so the same
 * parser runs in a browser (D1). What is decided here: the encoding, the BOM,
 * and a size cap so a runaway file cannot hang a page.
 */

import { type Diagnostic, diagnostic } from "../diagnostics.ts";

/** 1 MiB. A recipe is a few kilobytes; anything past this is not a recipe. */
export const MAX_INPUT_SIZE = 1024 * 1024;

export type LoadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

function fail(code: Diagnostic["code"], message: string): LoadResult {
  return { ok: false, diagnostics: [diagnostic({ code, message, path: [] })] };
}

/**
 * Accepts a string (already decoded) or raw bytes, and returns the source text.
 *
 * Bytes must be UTF-8. A UTF-16 BOM is rejected rather than guessed at, because
 * a BOM-present file is a file saved by the wrong tool, and silently decoding
 * half of it produces YAML errors that point nowhere useful.
 */
export function loadSource(input: string | Uint8Array): LoadResult {
  if (typeof input === "string") {
    if (input.length > MAX_INPUT_SIZE) {
      return fail(
        "load/too-large",
        `the input is larger than ${MAX_INPUT_SIZE} characters`,
      );
    }
    return { ok: true, text: input.charCodeAt(0) === 0xfeff ? input.slice(1) : input };
  }

  if (input.length > MAX_INPUT_SIZE) {
    return fail("load/too-large", `the input is larger than ${MAX_INPUT_SIZE} bytes`);
  }

  let bytes = input;
  if (bytes.length >= 2) {
    const [b0, b1] = [bytes[0], bytes[1]];
    const utf16le = b0 === 0xff && b1 === 0xfe;
    const utf16be = b0 === 0xfe && b1 === 0xff;
    if (utf16le || utf16be) {
      return fail(
        "load/unsupported-encoding",
        `the file looks UTF-16 (${utf16be ? "big" : "little"}-endian); yumml reads UTF-8`,
      );
    }
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  }

  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return fail("load/invalid-utf8", "the file is not valid UTF-8");
  }
}
