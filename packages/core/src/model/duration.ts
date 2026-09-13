/**
 * Step timers.
 *
 * A `time` on a step is a hint for the viewer's per-step timer: it
 * is not a dependency, not a schedule, and it never affects the DAG or the
 * ledger. Durations are normalized to whole seconds.
 *
 * Accepted forms:
 * - a YAML number, read as minutes: `time: 5`
 * - the compact form: `5m`, `90s`, `1h30m`, `1h 30m`
 * - ISO 8601: `PT5M`, `PT1H30M`, `P1DT2H`
 *
 * Rejected: a numeric string (`"5"`), fractional values, unknown units, zero.
 */

const COMPACT_UNITS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
};

const ISO = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

const COMPACT_TOKEN = /(\d+)([a-z]+)/g;

function total(parts: readonly number[]): number | null {
  const seconds = parts.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return seconds;
}

function parseCompact(text: string): number | null {
  const s = text.toLowerCase().replace(/\s+/g, "");
  if (s === "") return null;
  let cursor = 0;
  let seconds = 0;
  COMPACT_TOKEN.lastIndex = 0;
  let match = COMPACT_TOKEN.exec(s);
  if (!match) return null;
  while (match) {
    if (match.index !== cursor) return null;
    const value = Number(match[1]);
    const factor = COMPACT_UNITS[match[2] ?? ""];
    if (factor === undefined) return null;
    seconds += value * factor;
    cursor = COMPACT_TOKEN.lastIndex;
    match = COMPACT_TOKEN.exec(s);
  }
  if (cursor !== s.length) return null;
  return total([seconds]);
}

function parseIso(text: string): number | null {
  const m = ISO.exec(text);
  if (!m) return null;
  const [, w, d, h, min, s] = m;
  if (
    w === undefined &&
    d === undefined &&
    h === undefined &&
    min === undefined &&
    s === undefined
  ) {
    return null;
  }
  const num = (v: string | undefined) => (v === undefined ? 0 : Number(v));
  return total([num(w) * 604800, num(d) * 86400, num(h) * 3600, num(min) * 60, num(s)]);
}

/**
 * Parses a duration into whole seconds, or returns `null` when the input is not
 * a duration the spec accepts. Callers turn `null` into a diagnostic naming the
 * offending field.
 */
export function parseDuration(input: number | string): number | null {
  if (typeof input === "number") {
    if (!Number.isSafeInteger(input) || input <= 0) return null;
    return total([input * 60]);
  }
  const text = input.trim();
  if (text === "") return null;
  if (text.startsWith("P")) return parseIso(text);
  return parseCompact(text);
}

/** Renders seconds back into the compact form, for the CLI's `parse` output. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h > 0 ? `${h}h` : ""}${m > 0 ? `${m}m` : ""}${s > 0 || seconds === 0 ? `${s}s` : ""}`;
}
