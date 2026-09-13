/**
 * Exact rational arithmetic for recipe quantities.
 *
 * Recipes are checked with the ledger rule: the amounts drawn
 * from an ingredient must sum to exactly its declared quantity. Floating point
 * cannot answer that question (`0.1 + 0.2 !== 0.3`), so every quantity in yumml
 * is a {@link Fraction} — a normalized pair of safe integers — and never a
 * `number`.
 *
 * Decimal input such as `0.5` or `"0.1"` is parsed from its *decimal string
 * form*, so `0.1` becomes exactly 1/10 rather than the binary approximation.
 */

/** A rational number in lowest terms, with `d > 0`. Immutable and JSON-safe. */
export type Fraction = {
  readonly n: number;
  readonly d: number;
};

/** Thrown when a fractional operation would leave the safe integer range. */
export class FractionOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FractionOverflowError";
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function safe(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new FractionOverflowError(`${what} escapes the safe integer range`);
  }
  return value;
}

/**
 * Builds a fraction from a numerator and denominator. The result is always in
 * lowest terms with a positive denominator.
 */
export function fraction(n: number, d = 1): Fraction {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) {
    throw new FractionOverflowError("fraction parts must be safe integers");
  }
  if (d === 0) throw new FractionOverflowError("division by zero");
  if (n === 0) return { n: 0, d: 1 };
  const sign = d < 0 ? -1 : 1;
  const g = gcd(n, d) * sign;
  return { n: n / g, d: d / g };
}

export const ZERO: Fraction = { n: 0, d: 1 };
export const ONE: Fraction = { n: 1, d: 1 };

export function isZero(f: Fraction): boolean {
  return f.n === 0;
}

export function isNegative(f: Fraction): boolean {
  return f.n < 0;
}

export function isPositive(f: Fraction): boolean {
  return f.n > 0;
}

export function add(a: Fraction, b: Fraction): Fraction {
  const g = gcd(a.d, b.d);
  const ad = a.d / g;
  const bd = b.d / g;
  const n = safe(safe(a.n * bd, "addition") + safe(b.n * ad, "addition"), "addition");
  const d = safe(a.d * bd, "addition");
  return fraction(n, d);
}

export function sub(a: Fraction, b: Fraction): Fraction {
  return add(a, { n: -b.n, d: b.d });
}

export function mul(a: Fraction, b: Fraction): Fraction {
  const g1 = gcd(a.n, b.d);
  const g2 = gcd(b.n, a.d);
  const n = safe((a.n / g1) * (b.n / g2), "multiplication");
  const d = safe((a.d / g2) * (b.d / g1), "multiplication");
  return fraction(n, d);
}

/** Divides `a` by `b`. Throws {@link FractionOverflowError} when `b` is zero. */
export function div(a: Fraction, b: Fraction): Fraction {
  if (isZero(b)) throw new FractionOverflowError("division by zero");
  return mul(a, { n: b.d * Math.sign(b.n), d: Math.abs(b.n) });
}

export function neg(f: Fraction): Fraction {
  return { n: -f.n, d: f.d };
}

/** Returns a negative number when `a < b`, zero when equal, positive when `a > b`. */
export function cmp(a: Fraction, b: Fraction): number {
  return a.n * b.d - b.n * a.d;
}

export function eq(a: Fraction, b: Fraction): boolean {
  return a.n === b.n && a.d === b.d;
}

/** Lossy. Only for display; never use the result to decide whether a ledger balances. */
export function toNumber(f: Fraction): number {
  return f.n / f.d;
}

/** Renders as `"3"` or `"1/2"`, the form the spec accepts back. */
export function format(f: Fraction): string {
  return f.d === 1 ? String(f.n) : `${f.n}/${f.d}`;
}

export function sum(values: readonly Fraction[]): Fraction {
  return values.reduce(add, ZERO);
}

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const RATIO = /^([+-]?)(\d+)\/(\d+)$/;

function fromDecimalString(text: string, allowExponent: boolean): Fraction | null {
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const [, sign = "", int = "", frac = "", exp] = m;
  // Exponent notation is only reachable through `String(number)`, for values
  // like 1e-7. As written text it is not one of the forms the spec lists.
  if (exp !== undefined && !allowExponent) return null;
  const digits = `${int}${frac}`;
  const exponent = Number(exp ?? "0") - frac.length;
  if (Math.abs(exponent) > 18 || digits.length > 18) return null;
  const mantissa = Number(digits);
  if (!Number.isSafeInteger(mantissa)) return null;
  const n = sign === "-" ? -mantissa : mantissa;
  if (!Number.isSafeInteger(n)) return null;
  try {
    return exponent >= 0 ? fraction(n * 10 ** exponent, 1) : fraction(n, 10 ** -exponent);
  } catch {
    return null;
  }
}

/**
 * Parses the quantity forms the spec accepts (`2`, `0.5`, `"1/2"`, `"0.5"`)
 * into an exact fraction. Returns `null` for anything else, including `NaN`,
 * infinities, zero denominators and values outside the safe integer range; the
 * caller turns that into a diagnostic.
 *
 * Sign and zero are *not* checked here: `fraction` handles them, and the schema
 * rejects non-positive quantities so the message can name the field.
 */
export function parseQuantity(input: number | string): Fraction | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return fromDecimalString(String(input), true);
  }
  const text = input.trim();
  const ratio = RATIO.exec(text);
  if (ratio) {
    try {
      return fraction(Number(ratio[2]) * (ratio[1] === "-" ? -1 : 1), Number(ratio[3]));
    } catch {
      return null;
    }
  }
  return fromDecimalString(text, false);
}
