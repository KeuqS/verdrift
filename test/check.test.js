import assert from "node:assert/strict";
import { test } from "node:test";
import { findConflicts } from "../src/check.js";
import { checkLocal } from "../src/local.js";
import { Collector, extractorFor } from "../src/sources.js";

/** Collect declarations from several in-memory files. */
function declarationsOf(files) {
  const c = new Collector();
  for (const [path, text] of Object.entries(files)) extractorFor(path)?.(c, path, text);
  return c.declarations;
}

const rules = (problems) => problems.map((p) => `${p.rule} ${p.file}:${p.line}`);

test("agreeing declarations produce no problems", () => {
  const decls = declarationsOf({
    ".nvmrc": "22.11.0\n",
    "package.json": '{"engines":{"node":">=20"}}',
    Dockerfile: "FROM node:22-alpine\n",
    "pyproject.toml": 'requires-python = ">=3.10"\n[project]\nrequires-python = ">=3.10"\n',
    ".python-version": "3.12\n",
  });
  assert.deepEqual(findConflicts(decls), []);
});

test("pin mismatch is reported against the version file, not between every pair", () => {
  const problems = findConflicts(
    declarationsOf({
      ".nvmrc": "22\n",
      Dockerfile: "FROM node:20\n",
      "compose.yaml": "services:\n  web:\n    image: node:20-slim\n",
    }),
  );
  assert.deepEqual(rules(problems), ["pin-mismatch Dockerfile:1", "pin-mismatch compose.yaml:3"]);
  assert.match(problems[0].message, /FROM node:20 disagrees with 22 \(\.nvmrc:1\)/);
});

test("pins that each match a coarse reference but not each other are still reported", () => {
  const problems = findConflicts(
    declarationsOf({
      ".nvmrc": "20\n",
      Dockerfile: "FROM node:20.11\n",
      "compose.yaml": "services:\n  a:\n    image: node:20.12\n",
    }),
  );
  assert.deepEqual(rules(problems), ["pin-mismatch compose.yaml:3"]);
});

test("pins and matrix entries outside a range are reported", () => {
  const problems = findConflicts(
    declarationsOf({
      "go.mod": "module x\n\ngo 1.22\n",
      Dockerfile: "FROM golang:1.21-alpine\n",
      ".github/workflows/ci.yml":
        "jobs:\n  t:\n    strategy:\n      matrix:\n        go: ['1.21', '1.22']\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: ${{ matrix.go }}\n",
    }),
  );
  assert.deepEqual(rules(problems), ["outside-range Dockerfile:1", "outside-range .github/workflows/ci.yml:5"]);
  assert.match(problems[0].message, /FROM golang:1.21-alpine is outside "1.22" \(go.mod:3 go directive\)/);
});

test("CI versions are not compared with pins", () => {
  const problems = findConflicts(
    declarationsOf({
      ".nvmrc": "22\n",
      ".github/workflows/ci.yml":
        "jobs:\n  t:\n    strategy:\n      matrix:\n        node: ['20', '22', '24']\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ matrix.node }}\n",
    }),
  );
  assert.deepEqual(problems, []);
});

test("CI jobs that pick different versions on purpose do not conflict with each other", () => {
  const problems = findConflicts(
    declarationsOf({
      ".github/workflows/a.yml":
        "jobs:\n  t:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.13'\n",
      ".github/workflows/b.yml":
        "jobs:\n  t:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.10'\n",
    }),
  );
  assert.deepEqual(problems, []);
});

test("a nested package's range only applies inside its own directory", () => {
  const problems = findConflicts(
    declarationsOf({
      "package.json": '{"engines":{"node":">=18"}}',
      "packages/modern/package.json": '{"engines":{"node":">=22"}}',
      "packages/modern/Dockerfile": "FROM node:20\n",
      "tools/legacy/Dockerfile": "FROM node:18\n",
      ".github/workflows/ci.yml":
        "jobs:\n  t:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '18'\n",
    }),
  );
  // packages/modern/Dockerfile violates its own package's range; tools/ and CI are only bound by the root range.
  assert.deepEqual(
    rules(problems).filter((r) => r.startsWith("outside-range")),
    ["outside-range packages/modern/Dockerfile:1"],
  );
});

test("ranges with no common version conflict", () => {
  const problems = findConflicts(
    declarationsOf({
      "pyproject.toml": '[project]\nrequires-python = ">=3.11"\n[tool.poetry.dependencies]\npython = "<3.10"\n',
    }),
  );
  assert.deepEqual(rules(problems), ["range-conflict pyproject.toml:4"]);
});

test("skipped declarations never produce conflicts", () => {
  const problems = findConflicts(
    declarationsOf({ ".nvmrc": "lts/*\n", Dockerfile: "FROM node:20\nFROM node:latest\n" }),
  );
  assert.deepEqual(problems, []);
});

test("--local compares the installed runtime with ranges and developer pins only", () => {
  const decls = declarationsOf({
    ".nvmrc": "22\n",
    Dockerfile: "FROM node:20\nFROM golang:1.22\n",
    "pyproject.toml": '[project]\nrequires-python = ">=3.11"\n',
  });
  const probe = (runtime) => (runtime === "node" ? { version: "20.18.0", command: "node" } : null);
  const { installed, problems } = checkLocal(decls, probe);
  assert.deepEqual(
    installed.map((i) => `${i.runtime}=${i.version}`),
    ["node=20.18.0", "python=null"],
    "go is only declared by a container image, so it is not probed",
  );
  assert.deepEqual(
    problems.map((p) => p.rule),
    ["local-mismatch", "local-missing"],
  );
  assert.match(problems[0].message, /installed node 20.18.0 \(node\) does not match "22" \(\.nvmrc:1\)/);
});
