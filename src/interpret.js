// Turn the raw strings found in files into VersionSets, or explain why they can't be.

import { parseNpmRange, parsePartial, prefixSet } from "./versions.js";

/** @typedef {import("./versions.js").VersionSet} VersionSet */
/** @typedef {"node" | "python" | "go"} Runtime */
/** @typedef {{ set: VersionSet } | { skip: string }} Interpretation */

// https://github.com/nodejs/Release/blob/main/CODENAMES.md
/** @type {Record<string, number>} */
const NODE_LTS_CODENAMES = {
  argon: 4,
  boron: 6,
  carbon: 8,
  dubnium: 10,
  erbium: 12,
  fermium: 14,
  gallium: 16,
  hydrogen: 18,
  iron: 20,
  jod: 22,
  krypton: 24,
  lithium: 26,
};

const FLOATING = new Set(["latest", "current", "stable", "oldstable", "node", "lts", "lts/*", "system"]);

/**
 * Interpret a pinned version as written in a version file, tool config, or CI input.
 * "20" means any 20.x; "3.x" and ">=3.10" style ranges (accepted by actions/setup-*) are also understood.
 * @param {Runtime} runtime
 * @param {string} raw
 * @returns {Interpretation}
 */
export function interpretVersion(runtime, raw) {
  let text = raw.trim();
  if (text === "") return { skip: "empty value" };
  const lower = text.toLowerCase();
  if (FLOATING.has(lower)) return { skip: `"${text}" floats to whatever is newest at install time` };
  if (runtime === "node" && lower.startsWith("lts/")) {
    const major = NODE_LTS_CODENAMES[lower.slice(4)];
    if (major === undefined) return { skip: `unknown Node.js LTS codename "${text}"` };
    return { set: prefixSet([major]) };
  }
  if (runtime === "go") text = text.replace(/^go(?=\d)/, "");
  if (runtime === "python") text = text.replace(/^(?:python|cpython)-?(?=\d)/i, "");
  const parts = parsePartial(text);
  if (parts) return { set: prefixSet(parts) };
  if (/^[<>=^~\d]/.test(text)) {
    const set = parseNpmRange(text);
    if (set) return { set };
  }
  return { skip: `"${raw.trim()}" is not a version verdrift understands` };
}

/** @type {Record<string, Runtime>} */
const IMAGE_RUNTIMES = { node: "node", python: "python", golang: "go" };

/**
 * Recognize official-style runtime images: node:20-alpine, docker.io/library/python:3.12-slim,
 * golang:1.22@sha256:..., cimg/node:20.11. Returns null for images that are not a known runtime.
 * @param {string} ref
 * @returns {{ runtime: Runtime, image: string } & Interpretation | null}
 */
export function interpretImage(ref) {
  const noDigest = ref.trim().split("@")[0];
  const lastSlash = noDigest.lastIndexOf("/");
  const nameTag = noDigest.slice(lastSlash + 1);
  const colon = nameTag.indexOf(":");
  const name = colon === -1 ? nameTag : nameTag.slice(0, colon);
  const runtime = IMAGE_RUNTIMES[name];
  if (!runtime) return null;
  if (colon === -1) return { runtime, image: noDigest, skip: "untagged image floats with :latest" };
  const tag = nameTag.slice(colon + 1);
  const m = /^(\d+(?:\.\d+){0,2})(?:-.*)?$/.exec(tag);
  if (!m) return { runtime, image: noDigest, skip: `tag "${tag}" is a floating alias` };
  return { runtime, image: noDigest, set: prefixSet(/** @type {number[]} */ (parsePartial(m[1]))) };
}
