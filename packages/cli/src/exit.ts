/**
 * The exit codes, and why the cookbook is the odd one out.
 *
 * `0` is a valid recipe or a clean stop, `1` is a recipe with diagnostics, `2` is
 * bad usage or a file that could not be read, and `3` is a bug in yumml. The
 * cookbook never returns `1` — a broken recipe is content, not a failed invocation
 * — but the four
 * codes are one contract, so they live in one place and are re-exported by
 * `cli.ts`, which is where they used to be.
 */

export const EXIT_OK = 0;
export const EXIT_DIAGNOSTICS = 1;
export const EXIT_USAGE = 2;
export const EXIT_INTERNAL = 3;
