import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fraction, parseQuantity } from "./fraction.ts";
import { editDistance, isValidId } from "./id.ts";
import {
  convert,
  DEFAULT_UNIT,
  isUnitName,
  UNIT_NAMES,
  UNITS,
  unitInfo,
} from "./unit.ts";

describe("unit registry", () => {
  test("every unit declares a system and a dimension", () => {
    for (const name of UNIT_NAMES) {
      const info = unitInfo(name);
      assert.ok(
        info.system === "us" || info.system === "metric" || info.system === "count",
      );
      assert.ok(
        info.dimension === "volume" ||
          info.dimension === "mass" ||
          info.dimension === "count",
      );
      assert.equal(info.system === "count", info.factor === null, `${name} factor`);
    }
  });

  test("both measurement systems are represented (D7)", () => {
    const systems = new Set(UNIT_NAMES.map((name) => unitInfo(name).system));
    assert.ok(systems.has("us") && systems.has("metric") && systems.has("count"));
  });

  test('"item" is the default and there are no unexpected names', () => {
    assert.equal(DEFAULT_UNIT, "item");
    assert.equal(UNIT_NAMES.length, 20);
    assert.ok(isUnitName("tbsp"));
    assert.ok(!isUnitName("tablespoon"));
    assert.ok(!isUnitName(""));
    assert.ok(!isUnitName(7));
    assert.ok(!isUnitName("constructor"), "prototype keys are not units");
    assert.equal(Object.keys(UNITS).length, UNIT_NAMES.length);
  });
});

describe("convert", () => {
  test("converts inside a dimension, exactly", () => {
    assert.deepEqual(convert(fraction(1), "cup", "ml"), parseQuantity("236.5882365"));
    assert.deepEqual(convert(fraction(1), "tbsp", "tsp"), fraction(3));
    assert.deepEqual(convert(fraction(1), "kg", "g"), fraction(1000));
    assert.deepEqual(convert(fraction(2), "l", "ml"), fraction(2000));
    assert.deepEqual(convert(fraction(16), "oz", "lb"), fraction(1));
  });

  test("never crosses dimensions, and count units have no factor", () => {
    assert.equal(convert(fraction(1), "cup", "g"), null);
    assert.equal(convert(fraction(1), "item", "g"), null);
    assert.deepEqual(convert(fraction(1), "tsp", "cup"), fraction(1, 48));
  });

  test("converting to the same unit keeps count units intact", () => {
    assert.deepEqual(convert(fraction(3), "clove", "clove"), fraction(3));
    assert.deepEqual(convert(fraction(1, 2), "cup", "cup"), fraction(1, 2));
  });
});

describe("ids", () => {
  test("accepts kebab-case, rejects everything else", () => {
    for (const good of ["a", "banana", "mash-smooth", "step-2", "x1-y2-z3"]) {
      assert.ok(isValidId(good), good);
    }
    for (const bad of [
      "Banana",
      "mash_smooth",
      "mashSmooth",
      "-mash",
      "mash-",
      "mash--smooth",
      "2mash",
      "mash smooth",
      "",
    ]) {
      assert.ok(!isValidId(bad), bad);
    }
    assert.ok(!isValidId("a".repeat(65)));
    assert.ok(isValidId("a".repeat(64)));
  });

  test("edit distance and close matches", () => {
    assert.equal(editDistance("butter", "butter"), 0);
    assert.equal(editDistance("butter", "buter"), 1);
    assert.equal(editDistance("butter", "batter"), 1);
    assert.equal(editDistance("", "abc"), 3);
  });
});
