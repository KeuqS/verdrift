// Version sets as unions of half-open intervals [lo, hi) over [major, minor, patch].
// Every declaration (a pin like "20", a range like ">=3.10,<3.13") becomes a VersionSet,
// so "do these two declarations agree?" is a single question: do their sets intersect?
// Pre-release and build suffixes are ignored; verdrift reasons about release lines.

/** @typedef {[number, number, number]} Version */
/** @typedef {{ lo: Version, hi: Version | null }} Interval  hi === null means unbounded */
/** @typedef {Interval[]} VersionSet  sorted, non-overlapping; [] is the empty set */

/** @type {Version} */
const ZERO = [0, 0, 0];

/** @param {Version} a @param {Version} b */
export function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Parse a possibly partial version like "v20", "3.12", "1.22.3", "3.13.0rc1".
 * Returns the numeric parts given (1–3 of them) or null when the text is not a version.
 * @param {string} text
 * @returns {number[] | null}
 */
export function parsePartial(text) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+._]?[a-z][0-9a-z.+-]*)?$/i.exec(text.trim());
  if (!m) return null;
  return [m[1], m[2], m[3]].filter((p) => p !== undefined).map(Number);
}

/** @param {number[]} parts @returns {Version} */
function pad(parts) {
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Smallest version above every version that starts with `parts` ("20" -> 21.0.0, "3.12" -> 3.13.0). */
/** @param {number[]} parts @returns {Version} */
function bumpLast(parts) {
  const v = pad(parts);
  const i = parts.length - 1;
  v[i] += 1;
  for (let j = i + 1; j < 3; j++) v[j] = 0;
  return v;
}

/** @param {Version | null} lo @param {Version | null} hi @returns {VersionSet} */
function interval(lo, hi) {
  const from = lo ?? ZERO;
  if (hi && compare(from, hi) >= 0) return [];
  return [{ lo: from, hi }];
}

/** All versions starting with the given parts: "20" -> [20.0.0, 21.0.0). */
/** @param {number[]} parts @returns {VersionSet} */
export function prefixSet(parts) {
  return interval(pad(parts), bumpLast(parts));
}

/** @type {VersionSet} */
export const ANY = [{ lo: ZERO, hi: null }];

/** @param {VersionSet} a @param {VersionSet} b @returns {VersionSet} */
export function intersect(a, b) {
  /** @type {VersionSet} */
  const out = [];
  for (const x of a) {
    for (const y of b) {
      const lo = compare(x.lo, y.lo) >= 0 ? x.lo : y.lo;
      const hi = x.hi === null ? y.hi : y.hi === null ? x.hi : compare(x.hi, y.hi) <= 0 ? x.hi : y.hi;
      out.push(...interval(lo, hi));
    }
  }
  return normalize(out);
}

/** @param {VersionSet} a @param {VersionSet} b @returns {VersionSet} */
export function union(a, b) {
  return normalize([...a, ...b]);
}

/** @param {VersionSet} set @returns {VersionSet} */
function normalize(set) {
  const sorted = [...set].sort((x, y) => compare(x.lo, y.lo));
  /** @type {VersionSet} */
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && (last.hi === null || compare(iv.lo, last.hi) <= 0)) {
      if (last.hi !== null && (iv.hi === null || compare(iv.hi, last.hi) > 0)) last.hi = iv.hi;
    } else {
      out.push({ lo: iv.lo, hi: iv.hi });
    }
  }
  return out;
}

/** @param {VersionSet} a @param {VersionSet} b */
export function overlaps(a, b) {
  return intersect(a, b).length > 0;
}

/**
 * Parse an npm/node-semver range: "^20.11", ">=18 <21", "18 || 20", "1.2 - 2", "20.x", "*".
 * Also used for Poetry constraints (commas are treated as AND) and setup-* action ranges.
 * @param {string} text
 * @returns {VersionSet | null} null when the range cannot be parsed
 */
export function parseNpmRange(text) {
  /** @type {VersionSet} */
  let result = [];
  for (const alternative of text.split("||")) {
    const set = parseNpmComparatorSet(alternative.replace(/,/g, " "));
    if (set === null) return null;
    result = union(result, set);
  }
  return result;
}

/** @param {string} text @returns {VersionSet | null} */
function parseNpmComparatorSet(text) {
  const trimmed = text.trim();
  if (trimmed === "") return ANY;
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed);
  if (hyphen) {
    const from = parseXPartial(hyphen[1]);
    const to = parseXPartial(hyphen[2]);
    if (!from || !to) return null;
    return interval(pad(from), to.length === 0 ? null : bumpLast(to));
  }
  // Join operators to their operand: ">= 18" -> ">=18".
  const tokens = trimmed.replace(/(<=|>=|<|>|=|\^|~>|~)\s+/g, "$1").split(/\s+/);
  let set = ANY;
  for (const token of tokens) {
    const one = parseNpmComparator(token);
    if (one === null) return null;
    set = intersect(set, one);
  }
  return set;
}

/** Partial version that may use x/X/* wildcards; returns only the concrete leading parts. */
/** @param {string} text @returns {number[] | null} */
function parseXPartial(text) {
  const t = text.replace(/^v/i, "");
  if (/^[xX*]$/.test(t)) return [];
  const m = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+][0-9A-Za-z.+-]*)?$/.exec(t);
  if (!m) return null;
  /** @type {number[]} */
  const parts = [];
  for (const p of [m[1], m[2], m[3]]) {
    if (p === undefined || /^[xX*]$/.test(p)) break;
    parts.push(Number(p));
  }
  return parts;
}

/** @param {string} token @returns {VersionSet | null} */
function parseNpmComparator(token) {
  const m = /^(<=|>=|<|>|=|\^|~>|~)?(.+)$/.exec(token);
  if (!m) return null;
  const op = m[1] ?? "";
  const parts = parseXPartial(m[2]);
  if (parts === null) return null;
  if (parts.length === 0) {
    // "*", ">=*" match everything; "<*" / ">*" match nothing.
    return op === "<" || op === ">" ? [] : ANY;
  }
  switch (op) {
    case "":
    case "=":
      return prefixSet(parts);
    case ">=":
      return interval(pad(parts), null);
    case ">":
      // ">1.2" excludes all of 1.2.x; ">1.2.3" excludes only 1.2.3.
      return interval(bumpLast(parts), null);
    case "<":
      return interval(null, pad(parts));
    case "<=":
      return interval(null, bumpLast(parts));
    case "~":
    case "~>":
      return interval(pad(parts), bumpLast(parts.length === 1 ? parts : parts.slice(0, 2)));
    case "^": {
      // Caret allows changes that do not modify the left-most non-zero part.
      const v = pad(parts);
      let keep = parts.findIndex((p) => p !== 0);
      if (keep === -1) keep = parts.length - 1; // ^0, ^0.0, ^0.0.0
      return interval(v, bumpLast(parts.slice(0, keep + 1)));
    }
    default:
      return null;
  }
}

/**
 * Parse a PEP 440 version specifier set as used by requires-python: ">=3.10,<3.13", "~=3.11", "==3.12.*".
 * Unlike npm, "<=3.12" means "<= 3.12.0", which is how pip evaluates it against an interpreter.
 * @param {string} text
 * @returns {VersionSet | null}
 */
export function parsePep440(text) {
  let set = ANY;
  for (const clause of text.split(",")) {
    const c = clause.trim();
    if (c === "") continue;
    const m = /^(===|~=|==|!=|<=|>=|<|>)\s*(.+)$/.exec(c);
    if (!m) return null;
    const [, op, operand] = m;
    const wildcard = operand.endsWith(".*");
    const parts = parsePartial(wildcard ? operand.slice(0, -2) : operand);
    if (!parts) return null;
    /** @type {VersionSet} */
    let one;
    if (wildcard) {
      if (op !== "==" && op !== "!=") return null;
      one = prefixSet(parts);
      if (op === "!=") one = complement(one);
    } else {
      const v = pad(parts);
      /** @type {VersionSet} */
      const exact = interval(v, bumpLast([v[0], v[1], v[2]]));
      switch (op) {
        case "==":
        case "===":
          one = exact;
          break;
        case "!=":
          one = complement(exact);
          break;
        case ">=":
          one = interval(v, null);
          break;
        case ">":
          one = interval(bumpLast([v[0], v[1], v[2]]), null);
          break;
        case "<":
          one = interval(null, v);
          break;
        case "<=":
          one = interval(null, bumpLast([v[0], v[1], v[2]]));
          break;
        case "~=":
          if (parts.length < 2) return null;
          one = interval(v, bumpLast(parts.slice(0, -1)));
          break;
        default:
          return null;
      }
    }
    set = intersect(set, one);
  }
  return set;
}

/** @param {VersionSet} set @returns {VersionSet} */
function complement(set) {
  /** @type {VersionSet} */
  const out = [];
  /** @type {Version | null} */
  let cursor = ZERO;
  for (const iv of set) {
    if (cursor !== null) out.push(...interval(cursor, iv.lo));
    cursor = iv.hi;
  }
  if (cursor !== null) out.push({ lo: cursor, hi: null });
  return out;
}

/** "20.11.1" from [20, 11, 1]. @param {Version} v */
export function formatVersion(v) {
  return v.join(".");
}
