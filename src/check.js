// Compare declarations of the same runtime. A conflict is reported only when no version
// could satisfy both sides, so "20" vs "20.11.1" or ">=18" vs "22" are fine.

import { overlaps } from "./versions.js";

/** @typedef {import("./sources.js").Declaration} Declaration */
/** @typedef {import("./sources.js").Problem} Problem */
/** @typedef {import("./interpret.js").Runtime} Runtime */
/** @typedef {Declaration & { set: import("./versions.js").VersionSet }} Resolved */

export const RUNTIMES = /** @type {const} */ (["node", "python", "go"]);

/** "package.json:14 engines.node" @param {Declaration} d */
export function locate(d) {
  return d.where ? `${d.file}:${d.line} ${d.where}` : `${d.file}:${d.line}`;
}

/** "FROM node:20-alpine" or "node 18 (setup-node matrix.node)" @param {Declaration} d */
function describe(d) {
  if (d.where.includes(d.raw)) return d.where;
  return d.where ? `${d.runtime} ${d.raw} (${d.where})` : `${d.runtime} ${d.raw}`;
}

/**
 * Which pin is the reference the others are compared against: the dedicated version file
 * (.nvmrc, .python-version, …) wins, then tool configs, then images, then CI.
 * @param {Declaration} d
 */
export function pinPriority(d) {
  const base = d.file.slice(d.file.lastIndexOf("/") + 1);
  if (d.where === "") return 0; // single-purpose version file
  if (base === ".tool-versions" || base.includes("mise")) return 1;
  if (d.where === "volta.node" || d.where === "toolchain") return 2;
  return 3;
}

/** Directory a declaration speaks for: CI config describes the whole repo. @param {Declaration} d */
function dirOf(d) {
  if (d.role === "ci") return "";
  const slash = d.file.lastIndexOf("/");
  return slash === -1 ? "" : d.file.slice(0, slash);
}

/**
 * A range (engines, requires-python, go.mod) speaks for its own directory tree, so a nested
 * package's engines.node is not applied to an unrelated Dockerfile elsewhere in a monorepo.
 * @param {Declaration} range @param {Declaration} d
 */
function applies(range, d) {
  const dir = dirOf(range);
  const other = dirOf(d);
  return dir === "" || other === dir || other.startsWith(`${dir}/`);
}

/**
 * @param {Declaration[]} declarations
 * @returns {Problem[]}
 */
export function findConflicts(declarations) {
  /** @type {Problem[]} */
  const problems = [];
  for (const runtime of RUNTIMES) {
    const usable = /** @type {Resolved[]} */ (declarations.filter((d) => d.runtime === runtime && d.set !== null));
    const ranges = usable.filter((d) => d.role === "range");
    const depth = (/** @type {Declaration} */ d) => d.file.split("/").length;
    const pins = usable
      .filter((d) => d.role === "pin")
      .sort((a, b) => pinPriority(a) - pinPriority(b) || depth(a) - depth(b));
    const ci = usable.filter((d) => d.role === "ci");

    ranges.forEach((r, i) => {
      const other = ranges
        .slice(0, i)
        .find((prev) => (applies(prev, r) || applies(r, prev)) && !overlaps(prev.set, r.set));
      if (other) {
        problems.push({
          rule: "range-conflict",
          file: r.file,
          line: r.line,
          runtime,
          value: r.raw,
          message: `${runtime} "${r.raw}" (${r.where}) and "${other.raw}" (${locate(other)}) allow no common version`,
        });
      }
    });

    for (const d of [...pins, ...ci]) {
      const range = ranges.find((r) => applies(r, d) && !overlaps(r.set, d.set));
      if (range) {
        problems.push({
          rule: "outside-range",
          file: d.file,
          line: d.line,
          runtime,
          value: d.raw,
          message: `${describe(d)} is outside "${range.raw}" (${locate(range)})`,
        });
      }
    }

    /** @type {Resolved[]} */
    const agreed = [];
    for (const pin of pins) {
      const other = agreed.find((prev) => !overlaps(prev.set, pin.set));
      if (other) {
        problems.push({
          rule: "pin-mismatch",
          file: pin.file,
          line: pin.line,
          runtime,
          value: pin.raw,
          message: `${describe(pin)} disagrees with ${other.raw} (${locate(other)})`,
        });
      } else {
        agreed.push(pin);
      }
    }
  }
  return problems;
}
