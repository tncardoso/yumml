import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatDuration, parseDuration } from "./duration.ts";

describe("parseDuration", () => {
  test("a bare number is minutes (D22)", () => {
    assert.equal(parseDuration(5), 300);
    assert.equal(parseDuration(1), 60);
    assert.equal(parseDuration(90), 5400);
  });

  test("the compact form", () => {
    assert.equal(parseDuration("90s"), 90);
    assert.equal(parseDuration("5m"), 300);
    assert.equal(parseDuration("1h30m"), 5400);
    assert.equal(parseDuration("1h 30m"), 5400);
    assert.equal(parseDuration("2 hours"), 7200);
    assert.equal(parseDuration("1min"), 60);
    assert.equal(parseDuration("1h30m10s"), 5410);
  });

  test("ISO 8601", () => {
    assert.equal(parseDuration("PT5M"), 300);
    assert.equal(parseDuration("PT1H30M"), 5400);
    assert.equal(parseDuration("P1DT2H"), 93600);
    assert.equal(parseDuration("PT45S"), 45);
    assert.equal(parseDuration("P1W"), 604800);
  });

  test("refuses zero, negatives, fractions and typos", () => {
    for (const bad of [
      0,
      -5,
      1.5,
      Number.NaN,
      "5",
      "",
      "  ",
      "soon",
      "1h30",
      "PT",
      "0m",
      "P",
      "m5",
      "1x",
      "1h 30",
      "PT1.5S",
    ]) {
      assert.equal(parseDuration(bad), null, `${String(bad)} should not parse`);
    }
  });

  test("round-trips through the compact form", () => {
    for (let minutes = 1; minutes <= 200; minutes++) {
      const seconds = minutes * 60;
      assert.equal(parseDuration(formatDuration(seconds)), seconds);
    }
    for (const seconds of [1, 59, 61, 3599, 3600, 3661, 86_399, 86_400]) {
      assert.equal(parseDuration(formatDuration(seconds)), seconds);
    }
  });
});
