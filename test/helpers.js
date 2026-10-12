import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Collector, extractorFor } from "../src/sources.js";

/** Write `files` (path -> content) into a fresh temporary directory and return its path. */
export function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "verdrift-test-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Run the extractor for one file and return what it collected. */
export function extract(path, text) {
  const c = new Collector();
  const fn = extractorFor(path);
  if (!fn) throw new Error(`no extractor for ${path}`);
  fn(c, path, text);
  return c;
}

/** Compact view of declarations for assertions: "runtime role raw @line [skip]". */
export function summarize(declarations) {
  return declarations.map((d) => `${d.runtime} ${d.role} ${d.raw} @${d.line}${d.skip ? " skip" : ""}`);
}
