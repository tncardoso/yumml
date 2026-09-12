import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Fraction } from "./fraction.ts";
import {
  add,
  cmp,
  div,
  eq,
  FractionOverflowError,
  format,
  fraction,
  isNegative,
  isZero,
  mul,
  neg,
  parseQuantity,
  sub,
  sum,
  toNumber,
} from "./fraction.ts";

/** `parseQuantity` returns `null` for junk; these inputs are all knowable. */
function q(input: number | string): Fraction {
  const parsed = parseQuantity(input);
  assert.ok(parsed !== null, `parseQuantity(${String(input)})`);
  return parsed;
}

describe("parseQuantity", () => {
  test("reads numbers, decimals and fractions", () => {
    assert.deepEqual(parseQuantity(2), fraction(2));
    assert.deepEqual(parseQuantity(0.5), fraction(1, 2));
    assert.deepEqual(parseQuantity("1/2"), fraction(1, 2));
    assert.deepEqual(parseQuantity("0.25"), fraction(1, 4));
    assert.deepEqual(parseQuantity(" 3 "), fraction(3));
    assert.deepEqual(parseQuantity("1.5"), fraction(3, 2));
  });

  test("parses decimals exactly, never through a float", () => {
    // Number(0.1 + 0.2) is 0.30000000000000004; the fractions are exact.
    assert.deepEqual(parseQuantity(0.1), fraction(1, 10));
    assert.deepEqual(add(q(0.1), q(0.2)), fraction(3, 10));
    assert.deepEqual(parseQuantity("0.1"), fraction(1, 10));
    assert.deepEqual(toNumber(q(0.1)), 0.1);
  });

  test("refuses what the spec refuses", () => {
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e21,
      "abc",
      "1/0",
      "1/2/3",
      "",
      "0x10",
      "1e5",
      "  ",
      "-",
    ]) {
      assert.equal(parseQuantity(bad), null, `${String(bad)} should not parse`);
    }
  });

  test("keeps sign and zero, which the schema rejects later", () => {
    assert.deepEqual(parseQuantity(-2), fraction(-2));
    assert.deepEqual(parseQuantity("0"), fraction(0));
    assert.ok(isNegative(q(-1)));
    assert.ok(isZero(q(0)));
  });
});

describe("Fraction arithmetic", () => {
  test("normalizes on construction", () => {
    assert.deepEqual(fraction(2, 4), fraction(1, 2));
    assert.deepEqual(fraction(-2, -4), fraction(1, 2));
    assert.deepEqual(fraction(4, -2), { n: -2, d: 1 });
    assert.deepEqual(fraction(0, 5), { n: 0, d: 1 });
    assert.deepEqual(fraction(12, 8), fraction(3, 2));
  });

  test("rejects a zero denominator and unsafe parts", () => {
    assert.throws(() => fraction(1, 0), FractionOverflowError);
    assert.throws(() => fraction(2 ** 53, 1), FractionOverflowError);
    assert.throws(() => fraction(1, 2 ** 53), FractionOverflowError);
  });

  test("adds, subtracts, multiplies and divides exactly", () => {
    assert.deepEqual(add(fraction(1, 3), fraction(1, 6)), fraction(1, 2));
    assert.deepEqual(sub(fraction(1, 2), fraction(1, 3)), fraction(1, 6));
    assert.deepEqual(mul(fraction(2, 3), fraction(3, 4)), fraction(1, 2));
    assert.deepEqual(div(fraction(1, 2), fraction(1, 4)), fraction(2));
    assert.deepEqual(neg(fraction(1, 2)), fraction(-1, 2));
    assert.throws(() => div(fraction(1, 2), fraction(0)), FractionOverflowError);
  });

  test("three thirds are exactly one", () => {
    const third = fraction(1, 3);
    assert.deepEqual(sum([third, third, third]), fraction(1));
    assert.equal(cmp(sum([third, third, third]), fraction(1)), 0);
  });

  test("compares and formats", () => {
    assert.ok(cmp(fraction(1, 3), fraction(1, 2)) < 0);
    assert.ok(cmp(fraction(1, 2), fraction(1, 3)) > 0);
    assert.equal(cmp(fraction(1, 2), fraction(2, 4)), 0);
    assert.ok(eq(fraction(2, 4), fraction(1, 2)));
    assert.equal(format(fraction(2)), "2");
    assert.equal(format(fraction(1, 4)), "1/4");
    assert.equal(format(fraction(-1, 4)), "-1/4");
  });

  test("overflow surfaces instead of silently rounding", () => {
    const big = fraction(Number.MAX_SAFE_INTEGER);
    assert.throws(() => mul(big, big), FractionOverflowError);
    assert.throws(() => add(big, big), FractionOverflowError);
  });
});
