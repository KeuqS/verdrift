import assert from "node:assert/strict";
import { test } from "node:test";
import { overlaps, parseNpmRange, parsePartial, parsePep440, prefixSet } from "../src/versions.js";

/** Does `range` (a VersionSet) contain the exact version `v`? */
function has(set, v) {
  return overlaps(set, prefixSet(v.split(".").map(Number)));
}

/** Assert which exact versions are inside / outside a parsed set. */
function check(set, inside, outside) {
  assert.ok(set, "expected the range to parse");
  for (const v of inside) assert.ok(has(set, v), `${v} should be inside`);
  for (const v of outside) assert.ok(!has(set, v), `${v} should be outside`);
}

test("parsePartial reads 1-3 numeric parts and ignores suffixes", () => {
  assert.deepEqual(parsePartial("v20"), [20]);
  assert.deepEqual(parsePartial("3.12"), [3, 12]);
  assert.deepEqual(parsePartial("1.22.3"), [1, 22, 3]);
  assert.deepEqual(parsePartial("3.13.0rc1"), [3, 13, 0]);
  assert.deepEqual(parsePartial("1.22rc1"), [1, 22]);
  assert.equal(parsePartial("lts/iron"), null);
  assert.equal(parsePartial("alpine"), null);
});

test("prefix pins are compatible exactly when one is a prefix of the other", () => {
  assert.ok(overlaps(prefixSet([20]), prefixSet([20, 11, 1])));
  assert.ok(overlaps(prefixSet([3, 12]), prefixSet([3])));
  assert.ok(!overlaps(prefixSet([20, 11]), prefixSet([20, 12])));
  assert.ok(!overlaps(prefixSet([3, 1]), prefixSet([3, 10])));
});

test("npm comparators and partial versions", () => {
  check(parseNpmRange(">=20"), ["20.0.0", "26.1.0"], ["18.20.4", "19.9.9"]);
  check(parseNpmRange(">18"), ["19.0.0"], ["18.20.0"]);
  check(parseNpmRange(">18.2.3"), ["18.2.4"], ["18.2.3"]);
  check(parseNpmRange("<20"), ["18.0.0", "19.9.9"], ["20.0.0"]);
  check(parseNpmRange("<=20"), ["20.9.0"], ["21.0.0"]);
  check(parseNpmRange(">= 18 < 21"), ["18.0.0", "20.11.1"], ["17.9.0", "21.0.0"]);
  check(parseNpmRange("20.x"), ["20.0.0", "20.99.0"], ["21.0.0"]);
  check(parseNpmRange("*"), ["0.1.0", "99.0.0"], []);
  check(parseNpmRange(""), ["1.0.0"], []);
});

test("npm caret and tilde", () => {
  check(parseNpmRange("^20.11"), ["20.11.0", "20.99.0"], ["20.10.9", "21.0.0"]);
  check(parseNpmRange("^0.2.3"), ["0.2.3", "0.2.9"], ["0.3.0"]);
  check(parseNpmRange("^0.0.3"), ["0.0.3"], ["0.0.4"]);
  check(parseNpmRange("~1.2.3"), ["1.2.3", "1.2.9"], ["1.3.0"]);
  check(parseNpmRange("~1"), ["1.9.0"], ["2.0.0"]);
  check(parseNpmRange("^3.10"), ["3.10.0", "3.13.1"], ["3.9.9", "4.0.0"]); // Poetry style
});

test("npm unions and hyphen ranges", () => {
  check(parseNpmRange("^18 || ^20"), ["18.1.0", "20.5.0"], ["19.0.0", "22.0.0"]);
  check(parseNpmRange("18 - 20"), ["18.0.0", "20.9.9"], ["21.0.0"]);
  check(parseNpmRange("1.2.3 - 2.3"), ["1.2.3", "2.3.9"], ["1.2.2", "2.4.0"]);
  check(parseNpmRange(">=3.9, <3.13"), ["3.12.4"], ["3.13.0", "3.8.0"]); // Poetry commas
});

test("npm ranges that cannot be parsed return null", () => {
  assert.equal(parseNpmRange("lts"), null);
  assert.equal(parseNpmRange(">=banana"), null);
});

test("PEP 440 specifiers follow pip's interpretation", () => {
  check(parsePep440(">=3.10"), ["3.10.0", "3.13.2"], ["3.9.18"]);
  check(parsePep440(">=3.10,<3.13"), ["3.12.7"], ["3.13.0", "3.9.0"]);
  check(parsePep440("~=3.11"), ["3.11.0", "3.14.0"], ["3.10.9", "4.0.0"]);
  check(parsePep440("~=3.11.2"), ["3.11.2", "3.11.9"], ["3.11.1", "3.12.0"]);
  check(parsePep440("==3.12.*"), ["3.12.0", "3.12.9"], ["3.13.0"]);
  check(parsePep440("!=3.11.*, >=3.9"), ["3.9.1", "3.12.0"], ["3.11.4", "3.8.0"]);
  // "<=3.12" means "<= 3.12.0" in PEP 440, so 3.12.5 is excluded — unlike npm.
  check(parsePep440("<=3.12"), ["3.12.0", "3.11.9"], ["3.12.5"]);
  // ">3.10" admits 3.10.1 in PEP 440 (it is greater than 3.10.0).
  check(parsePep440(">3.10"), ["3.10.1"], ["3.10.0"]);
  assert.equal(parsePep440(">=three"), null);
  assert.equal(parsePep440("~=3"), null);
});

test("disjoint ranges do not overlap", () => {
  assert.ok(!overlaps(parsePep440(">=3.10"), parsePep440("<3.9")));
  assert.ok(overlaps(parseNpmRange(">=18"), parseNpmRange("^20")));
});
