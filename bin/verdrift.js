#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { globToRegExp } from "../src/discover.js";
import { formatGithub, formatJson, formatText } from "../src/report.js";
import { scan } from "../src/scan.js";

const HELP = `Usage: verdrift [dir] [options]

Find every place a repo declares a Node, Python, or Go version and report where they disagree.

Options:
  --format <text|json|github>  output format (default: text; github emits Actions annotations)
  --local                      also check the runtimes installed on this machine
  --ignore <glob>              skip matching paths, e.g. --ignore 'examples/**' (repeatable)
  -h, --help                   show this help
  -v, --version                show the version

Exit codes: 0 no problems, 1 problems found, 2 usage error.
`;

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        format: { type: "string", default: "text" },
        local: { type: "boolean", default: false },
        ignore: { type: "string", multiple: true, default: [] },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (err) {
    return usageError(err instanceof Error ? err.message : String(err));
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (positionals.length > 1) return usageError(`expected at most one directory, got ${positionals.length}`);
  if (!["text", "json", "github"].includes(values.format)) {
    return usageError(`unknown --format "${values.format}" (expected text, json, or github)`);
  }
  const root = positionals[0] ?? ".";
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return usageError(`not a directory: ${root}`);

  const result = scan(root, { ignore: values.ignore.map(globToRegExp), local: values.local });

  if (values.format === "json") process.stdout.write(formatJson(result));
  else if (values.format === "github") process.stdout.write(formatGithub(result));
  else {
    const force = process.env.FORCE_COLOR;
    const color = force !== undefined ? force !== "0" : Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
    process.stdout.write(formatText(result, { color }));
  }
  return result.problems.length > 0 ? 1 : 0;
}

/** @param {string} message */
function usageError(message) {
  process.stderr.write(`verdrift: ${message}\nRun "verdrift --help" for usage.\n`);
  return 2;
}

process.exitCode = main();
