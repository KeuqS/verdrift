// Find the files verdrift reads. Inside a git work tree, `git ls-files` gives tracked and
// untracked-but-not-ignored files, so .gitignore is respected for free; otherwise walk the tree.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { extractorFor } from "./sources.js";

// Directories that hold other people's code or build output, never the repo's own declarations.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  "dist",
  "build",
  "target",
  ".next",
]);

/**
 * @param {string} root
 * @param {RegExp[]} ignore  matched against repo-relative paths
 * @returns {string[]} repo-relative paths with forward slashes, sorted
 */
export function discoverFiles(root, ignore) {
  const all = gitFiles(root) ?? walk(root);
  return all
    .filter((p) => !p.split("/").some((part) => SKIP_DIRS.has(part)))
    .filter((p) => !ignore.some((re) => re.test(p)))
    .filter((p) => extractorFor(p) !== null)
    .sort();
}

/** @param {string} root @returns {string[] | null} */
function gitFiles(root) {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    });
    return [...new Set(out.split("\0").filter(Boolean))];
  } catch {
    return null;
  }
}

/** @param {string} root @returns {string[]} */
function walk(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel */
  const visit = (rel) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(path);
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  };
  visit("");
  return out;
}

/**
 * Glob to RegExp: `*` matches within a path segment, `**` across segments, `?` one character.
 * A pattern without a slash matches at any depth ("Dockerfile.legacy" or "fixtures").
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const anchored = glob.includes("/") ? `^${re.replace(/^\\?\//, "")}` : `(^|/)${re}`;
  return new RegExp(`${anchored}($|/)`);
}
