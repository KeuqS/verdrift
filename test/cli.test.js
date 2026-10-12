import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { globToRegExp } from "../src/discover.js";
import { makeRepo } from "./helpers.js";

const BIN = fileURLToPath(new URL("../bin/verdrift.js", import.meta.url));

function run(args, cwd) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const DRIFTED = {
  ".nvmrc": "22\n",
  "package.json": '{\n  "engines": {\n    "node": ">=20"\n  }\n}\n',
  Dockerfile: "FROM node:20-alpine\n",
};

test("exit 1 and a readable report when versions drift", () => {
  const { code, stdout } = run([makeRepo(DRIFTED)]);
  assert.equal(code, 1);
  assert.match(stdout, /✗ Dockerfile:1 +FROM node:20-alpine/);
  assert.match(stdout, /1 problem\n/);
  assert.match(stdout, /FROM node:20-alpine disagrees with 22 \(\.nvmrc:1\) {2}pin-mismatch/);
});

test("exit 0 when everything agrees", () => {
  const { code, stdout } = run([makeRepo({ ...DRIFTED, Dockerfile: "FROM node:22-alpine\n" })]);
  assert.equal(code, 0);
  assert.match(stdout, /✓ No drift: 3 declarations in 3 files agree\./);
});

test("exit 0 with a clear message when nothing is declared", () => {
  const { code, stdout } = run([makeRepo({ "README.md": "hi\n" })]);
  assert.equal(code, 0);
  assert.match(stdout, /No Node, Python, or Go version declarations found/);
});

test("--format json is machine-readable and omits internal version sets", () => {
  const { code, stdout } = run([makeRepo(DRIFTED), "--format", "json"]);
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.problems.length, 1);
  assert.equal(out.problems[0].rule, "pin-mismatch");
  assert.equal(out.declarations.length, 3);
  assert.equal("set" in out.declarations[0], false);
  assert.equal(out.installed, null);
});

test("--format github emits escaped workflow annotations", () => {
  const { stdout } = run([makeRepo(DRIFTED), "--format", "github"]);
  // Properties escape ":" and ","; the message only escapes %, CR, and LF.
  assert.match(stdout, /^::error file=Dockerfile,line=1,title=verdrift pin-mismatch::FROM node:20-alpine disagrees/m);
  assert.match(stdout, /verdrift: 1 problem in 3 declarations/);
});

test("--ignore skips matching paths", () => {
  const root = makeRepo({ ...DRIFTED, "examples/legacy/Dockerfile": "FROM node:16\n" });
  assert.match(run([root]).stdout, /examples\/legacy\/Dockerfile/);
  const { stdout } = run([root, "--ignore", "examples/**", "--ignore", "Dockerfile"]);
  assert.doesNotMatch(stdout, /Dockerfile/);
});

test("inside a git repo, .gitignore'd files are not read", () => {
  const root = makeRepo({ ...DRIFTED, ".gitignore": "generated/\n", "generated/Dockerfile": "FROM node:14\n" });
  execFileSync("git", ["init", "-q"], { cwd: root });
  const { stdout } = run([root]);
  assert.doesNotMatch(stdout, /generated/);
  assert.match(stdout, /Dockerfile:1/);
});

test("a malformed file is a warning, not a crash", () => {
  const { code, stdout } = run([makeRepo({ "package.json": "{ nope", ".nvmrc": "22\n" })]);
  assert.equal(code, 0);
  assert.match(stdout, /! package.json: could not parse/);
});

test("usage errors exit 2", () => {
  assert.equal(run(["--format", "xml"]).code, 2);
  assert.equal(run(["--nope"]).code, 2);
  assert.equal(run(["/definitely/not/here"]).code, 2);
  assert.equal(run(["a", "b"]).code, 2);
});

test("--help and --version", () => {
  assert.match(run(["--help"]).stdout, /Usage: verdrift/);
  assert.match(run(["--version"]).stdout, /^\d+\.\d+\.\d+\n$/);
});

test("globToRegExp", () => {
  assert.ok(globToRegExp("examples/**").test("examples/a/b/Dockerfile"));
  assert.ok(!globToRegExp("examples/**").test("src/examples/Dockerfile"));
  assert.ok(globToRegExp("fixtures").test("test/fixtures/.nvmrc"));
  assert.ok(globToRegExp("*.Dockerfile").test("deploy/api.Dockerfile"));
  assert.ok(!globToRegExp("Dockerfile").test("Dockerfile.dev"));
  assert.ok(globToRegExp("docker/*/Dockerfile").test("docker/api/Dockerfile"));
});
