import { RUNTIMES } from "./check.js";

/** @typedef {import("./scan.js").ScanResult} ScanResult */

/** @param {boolean} color */
function palette(color) {
  /** @param {string} code */
  const wrap = (code) => (/** @type {string} */ s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { red: wrap("31"), green: wrap("32"), yellow: wrap("33"), dim: wrap("2"), bold: wrap("1") };
}

/**
 * Human-readable report: declarations grouped by runtime, then problems.
 * @param {ScanResult} result
 * @param {{ color: boolean }} options
 */
export function formatText(result, { color }) {
  const c = palette(color);
  const out = [];
  /** @param {import("./sources.js").Declaration} d */
  const hasProblem = (d) =>
    result.problems.some((p) => p.file === d.file && p.line === d.line && (p.value === undefined || p.value === d.raw));

  for (const runtime of RUNTIMES) {
    const decls = result.declarations.filter((d) => d.runtime === runtime);
    if (decls.length === 0) continue;
    out.push(c.bold(runtime));
    const rows = decls.map((d) => [`${d.file}:${d.line}`, d.where, d.role, d.raw]);
    const widths = [0, 1].map((i) => Math.min(48, Math.max(...rows.map((r) => r[i].length))));
    decls.forEach((d, i) => {
      const [loc, where, role, raw] = rows[i];
      const mark = hasProblem(d) ? c.red("✗") : " ";
      const line = `${mark} ${loc.padEnd(widths[0])}  ${where.padEnd(widths[1])}  ${role.padEnd(6)} ${raw}`;
      out.push(d.skip ? c.dim(`${line}  (skipped: ${d.skip})`) : line);
    });
    out.push("");
  }

  if (result.installed) {
    out.push(c.bold("installed"));
    for (const i of result.installed) {
      out.push(`  ${i.runtime.padEnd(7)} ${i.version ? `${i.version} (${i.command})` : c.dim("not found")}`);
    }
    out.push("");
  }

  for (const w of result.warnings) out.push(c.yellow(`! ${w.file}: ${w.message}`));
  if (result.warnings.length) out.push("");

  const count = result.declarations.length;
  const fileCount = new Set(result.declarations.map((d) => d.file)).size;
  if (count === 0) {
    out.push("No Node, Python, or Go version declarations found.");
  } else if (result.problems.length === 0) {
    out.push(c.green(`✓ No drift: ${plural(count, "declaration")} in ${plural(fileCount, "file")} agree.`));
  } else {
    out.push(c.red(c.bold(`${plural(result.problems.length, "problem")}`)));
    const locs = result.problems.map((p) => (p.line ? `${p.file}:${p.line}` : p.file));
    const width = Math.min(48, Math.max(...locs.map((l) => l.length)));
    result.problems.forEach((p, i) => {
      out.push(`${c.red("✗")} ${locs[i].padEnd(width)}  ${p.message}  ${c.dim(p.rule)}`);
    });
  }
  return `${out.join("\n")}\n`;
}

/** @param {number} n @param {string} word */
function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Stable machine-readable output. Version sets are internal and omitted.
 * @param {ScanResult} result
 */
export function formatJson(result) {
  return `${JSON.stringify(
    {
      declarations: result.declarations.map(({ set, ...d }) => d),
      problems: result.problems,
      warnings: result.warnings,
      installed: result.installed,
    },
    null,
    2,
  )}\n`;
}

/**
 * GitHub Actions workflow commands: each problem becomes an annotation on the offending line.
 * https://docs.github.com/en/actions/reference/workflow-commands-for-github-actions
 * @param {ScanResult} result
 */
export function formatGithub(result) {
  /** @param {string} s */
  const esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  /** @param {string} s */
  const escProp = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const lines = result.problems.map((p) =>
    p.line
      ? `::error file=${escProp(p.file)},line=${p.line},title=${escProp(`verdrift ${p.rule}`)}::${esc(p.message)}`
      : `::error title=${escProp(`verdrift ${p.rule}`)}::${esc(p.message)}`,
  );
  for (const w of result.warnings) lines.push(`::warning file=${escProp(w.file)}::${esc(w.message)}`);
  lines.push(
    result.problems.length
      ? `verdrift: ${plural(result.problems.length, "problem")} in ${plural(result.declarations.length, "declaration")}`
      : `verdrift: no drift in ${plural(result.declarations.length, "declaration")}`,
  );
  return `${lines.join("\n")}\n`;
}
