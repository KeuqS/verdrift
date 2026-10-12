// --local: compare the runtimes installed on this machine with what the repo declares.

import { execFileSync } from "node:child_process";
import { locate, pinPriority } from "./check.js";
import { overlaps, parsePartial, prefixSet } from "./versions.js";

/** @typedef {import("./sources.js").Declaration} Declaration */
/** @typedef {import("./sources.js").Problem} Problem */
/** @typedef {import("./interpret.js").Runtime} Runtime */

/** @type {Record<Runtime, { commands: string[][], pattern: RegExp }>} */
const PROBES = {
  node: { commands: [["node", "--version"]], pattern: /v(\d+\.\d+\.\d+)/ },
  python: {
    commands: [
      ["python3", "--version"],
      ["python", "--version"],
    ],
    pattern: /Python (\d+\.\d+\.\d+)/,
  },
  go: { commands: [["go", "version"]], pattern: /go(\d+\.\d+(?:\.\d+)?)/ },
};

/**
 * Run from the scanned directory so version-manager shims (asdf, mise, volta) resolve as they
 * would for a developer there. GOTOOLCHAIN=local stops `go version` from downloading the
 * toolchain named in go.mod and reporting that instead of what is installed.
 * @param {Runtime} runtime
 * @param {string} cwd
 * @returns {{ version: string, command: string } | null}
 */
export function installedVersion(runtime, cwd) {
  const probe = PROBES[runtime];
  for (const [cmd, ...args] of probe.commands) {
    try {
      const out = execFileSync(cmd, args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GOTOOLCHAIN: "local" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      });
      const m = probe.pattern.exec(out);
      if (m) return { version: m[1], command: cmd };
    } catch {
      // not installed or not runnable; try the next candidate
    }
  }
  return null;
}

/**
 * @param {Declaration[]} declarations
 * @param {(runtime: Runtime) => { version: string, command: string } | null} probe
 * @returns {{ installed: { runtime: Runtime, version: string | null, command: string | null }[], problems: Problem[] }}
 */
export function checkLocal(declarations, probe) {
  /** @type {Problem[]} */
  const problems = [];
  const installed = [];
  const runtimes = /** @type {Runtime[]} */ ([...new Set(declarations.map((d) => d.runtime))]);
  for (const runtime of runtimes) {
    // Containers and CI legitimately run their own runtime; the machine should match the
    // supported ranges and the developer-facing pins (version files, tool configs).
    const relevant = declarations.filter(
      (d) =>
        d.runtime === runtime && d.set !== null && (d.role === "range" || (d.role === "pin" && pinPriority(d) <= 2)),
    );
    if (relevant.length === 0) continue;
    const found = probe(runtime);
    installed.push({ runtime, version: found?.version ?? null, command: found?.command ?? null });
    if (!found) {
      problems.push({
        rule: "local-missing",
        file: "(local)",
        line: 0,
        runtime,
        message: `${runtime} is declared in this repo but not installed (or not on PATH)`,
      });
      continue;
    }
    const exact = prefixSet(/** @type {number[]} */ (parsePartial(found.version)));
    const bad = relevant.find((d) => !overlaps(/** @type {any} */ (d.set), exact));
    if (bad) {
      problems.push({
        rule: "local-mismatch",
        file: "(local)",
        line: 0,
        runtime,
        message: `installed ${runtime} ${found.version} (${found.command}) does not match "${bad.raw}" (${locate(bad)})`,
      });
    }
  }
  return { installed, problems };
}
