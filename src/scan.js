import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findConflicts } from "./check.js";
import { discoverFiles } from "./discover.js";
import { checkLocal } from "./local.js";
import { Collector, extractorFor } from "./sources.js";

/**
 * @typedef {object} ScanResult
 * @property {string[]} files  files that were read
 * @property {import("./sources.js").Declaration[]} declarations
 * @property {import("./sources.js").Problem[]} problems
 * @property {{ file: string, message: string }[]} warnings
 * @property {{ runtime: string, version: string | null, command: string | null }[] | null} installed  null without --local
 */

/**
 * @param {string} root
 * @param {{ ignore?: RegExp[], local?: boolean, probe?: Parameters<typeof checkLocal>[1] }} [options]
 * @returns {ScanResult}
 */
export function scan(root, options = {}) {
  const files = discoverFiles(root, options.ignore ?? []);
  const c = new Collector();
  for (const file of files) {
    const extract = /** @type {NonNullable<ReturnType<typeof extractorFor>>} */ (extractorFor(file));
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue; // tracked but deleted from the work tree
    }
    try {
      extract(c, file, text);
    } catch (err) {
      c.warnings.push({ file, message: `could not parse: ${err instanceof Error ? err.message.split("\n")[0] : err}` });
    }
  }
  const problems = [...c.problems, ...findConflicts(c.declarations)];
  let installed = null;
  if (options.local) {
    const local = checkLocal(c.declarations, options.probe);
    installed = local.installed;
    problems.push(...local.problems);
  }
  return { files, declarations: c.declarations, problems, warnings: c.warnings, installed };
}
