/**
 * Recipe identifiers.
 *
 * Ingredients and steps share one id namespace (plan.md D10), so a typo in
 * `uses` is never ambiguous, and a duplicate id is an error across both lists.
 * The pattern is deliberately narrow: kebab-case ASCII, which keeps ids usable
 * as anchors, map keys and CSS selectors in the renderer.
 */

export const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const ID_MAX_LENGTH = 64;

/** True when `value` is a legal id. Used by the schema and by suggestions. */
export function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= ID_MAX_LENGTH && ID_PATTERN.test(value)
  );
}

/** Levenshtein distance, used for did-you-mean hints on unresolved references. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const current = new Array<number>(cols).fill(0);
    current[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[cols - 1] ?? 0;
}

/**
 * Picks the closest candidate to `value`, for the `hint` field of a diagnostic.
 * Returns `undefined` when nothing is close enough to be worth suggesting, so
 * the reader is not sent chasing unrelated names.
 */
export function closest(
  value: string,
  candidates: readonly string[],
  maxDistance = 2,
): string | undefined {
  let best: string | undefined;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    const distance = editDistance(value, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= maxDistance ? best : undefined;
}
