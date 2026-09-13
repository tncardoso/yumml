/**
 * Turning the model's numbers into the page's words.
 *
 * The two conventions the Penpot boards use, and the only two here:
 *
 * - a quantity reads `2 item`, `1/2 cup`, or `200 g` — the amount, then the unit,
 *   through the core's exact rational formatter, so `1/3` never becomes `0.333`;
 * - a length of time reads `45 min`, `1 h 30 min`, or `18 h`, which is what the
 *   recipe cards in `refs/cookbook-recipe-list.html` show.
 */

import { format, type IngredientNode, type UnitName } from "@yumml/yumml";

/** `1 ingredient`, `4 ingredients`. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** `2 item`, `1/2 cup`, or `200 g` — and nothing at all for an unquantified ingredient. */
export function formatAmount(
  qty: string | undefined,
  unit: UnitName | undefined,
): string {
  if (qty === undefined) return "";
  return unit === undefined ? qty : `${qty} ${unit}`;
}

/** The same, straight off a model node. */
export function amountOf(ingredient: IngredientNode): string {
  return formatAmount(
    ingredient.qty === undefined ? undefined : format(ingredient.qty),
    ingredient.qty === undefined ? undefined : ingredient.unit,
  );
}

/** `salt`, or `1/2 cup butter` — how an ingredient is labelled wherever it is drawn. */
export function labelOf(ingredient: IngredientNode): string {
  const amount = amountOf(ingredient);
  return amount === "" ? ingredient.desc : `${amount} ${ingredient.desc}`;
}

/**
 * A countdown, the way a timer shows it: `02:30`, or `1:30:00` once there is an
 * hour to show. Seconds are always two digits, so the digits do not jitter as
 * they count.
 */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const pair = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pair(minutes)}:${pair(rest)}`
    : `${pair(minutes)}:${pair(rest)}`;
}

/**
 * How long ago a file changed, in the same words the board uses. The boards say
 * "checked 2 min ago", which is a claim yumml cannot make — nothing here knows
 * when you last ran `validate` — so the page says what it does know, which is
 * the file's modification time.
 */
export function formatAge(mtimeMs: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - mtimeMs) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  if (seconds < 604_800)
    return `${plural(Math.round(seconds / 86_400), "day", "days")} ago`;
  return new Date(mtimeMs).toISOString().slice(0, 10);
}

/**
 * A duration a person reads rather than parses: `45 min`, `1 h 30 min`, `18 h`.
 * Seconds only ever appear below a minute, which is how a step with `time: 30s`
 * stops looking like a rounding error.
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0 min";
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
