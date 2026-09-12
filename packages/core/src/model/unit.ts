/**
 * The closed unit registry.
 *
 * `unit` is a closed enum in v1 (plan.md §3.4, D2): a typo in a unit is exactly
 * the kind of mistake the strict parser exists to catch, and conversion needs a
 * known list. Both US and metric units are present (D7).
 *
 * Each unit knows its system, its dimension, and — for units that measure a
 * continuous quantity — an exact decimal factor towards the canonical base
 * (millilitres for volume, grams for mass). Count units have no factor and never
 * convert: a `clove` is not a volume.
 *
 * Conversion is for display only. The ledger never converts, because every draw
 * inherits its target's unit (D28), so all ledger arithmetic happens inside one
 * unit.
 */

import { div, type Fraction, mul, parseQuantity } from "./fraction.ts";

export type UnitDimension = "count" | "volume" | "mass";
export type UnitSystem = "count" | "us" | "metric";

export type UnitInfo = {
  readonly system: UnitSystem;
  readonly dimension: UnitDimension;
  /** Exact decimal factor to the canonical base, or `null` for count units. */
  readonly factor: string | null;
};

export const UNITS = {
  item: { system: "count", dimension: "count", factor: null },
  pinch: { system: "count", dimension: "count", factor: null },
  clove: { system: "count", dimension: "count", factor: null },
  slice: { system: "count", dimension: "count", factor: null },
  can: { system: "count", dimension: "count", factor: null },
  package: { system: "count", dimension: "count", factor: null },

  tsp: { system: "us", dimension: "volume", factor: "4.92892159375" },
  tbsp: { system: "us", dimension: "volume", factor: "14.78676478125" },
  floz: { system: "us", dimension: "volume", factor: "29.5735295625" },
  cup: { system: "us", dimension: "volume", factor: "236.5882365" },
  pint: { system: "us", dimension: "volume", factor: "473.176473" },
  quart: { system: "us", dimension: "volume", factor: "946.352946" },
  gallon: { system: "us", dimension: "volume", factor: "3785.411784" },
  ml: { system: "metric", dimension: "volume", factor: "1" },
  l: { system: "metric", dimension: "volume", factor: "1000" },

  mg: { system: "metric", dimension: "mass", factor: "0.001" },
  g: { system: "metric", dimension: "mass", factor: "1" },
  kg: { system: "metric", dimension: "mass", factor: "1000" },
  oz: { system: "us", dimension: "mass", factor: "28.349523125" },
  lb: { system: "us", dimension: "mass", factor: "453.59237" },
} as const satisfies Record<string, UnitInfo>;

export type UnitName = keyof typeof UNITS;

export const UNIT_NAMES = Object.keys(UNITS) as UnitName[];

export const DEFAULT_UNIT: UnitName = "item";

export function isUnitName(value: unknown): value is UnitName {
  return typeof value === "string" && Object.hasOwn(UNITS, value);
}

export function unitInfo(name: UnitName): UnitInfo {
  return UNITS[name];
}

const FACTORS = new Map<UnitName, Fraction>();
function factorOf(name: UnitName): Fraction | null {
  const { factor } = UNITS[name];
  if (factor === null) return null;
  const cached = FACTORS.get(name);
  if (cached) return cached;
  const parsed = parseQuantity(factor);
  if (parsed === null) throw new Error(`unparseable unit factor for ${name}`);
  FACTORS.set(name, parsed);
  return parsed;
}

/**
 * Converts a value between two units of the same dimension, exactly. Returns
 * `null` when the dimensions differ or either unit is a count unit — the caller
 * decides whether that is an error or simply a quantity it cannot re-express.
 */
export function convert(value: Fraction, from: UnitName, to: UnitName): Fraction | null {
  if (from === to) return value;
  if (UNITS[from].dimension !== UNITS[to].dimension) return null;
  const a = factorOf(from);
  const b = factorOf(to);
  if (a === null || b === null) return null;
  return mul(value, div(a, b));
}
