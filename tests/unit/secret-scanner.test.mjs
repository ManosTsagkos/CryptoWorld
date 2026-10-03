import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const scanner = new URL("../../scripts/check-secrets.mjs", import.meta.url);
const fakeCredential = "gsk_" + "fixture".repeat(5);
const gitAvailable = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

async function fixture(action) {
  const directory = await mkdtemp(join(tmpdir(), "tcs-secret-scan-"));
  try {
    await action(directory);
  } finally {
    const actual = await realpath(directory);
    assert.equal(dirname(actual), await realpath(tmpdir()));
    assert.ok(basename(actual).startsWith("tcs-secret-scan-"));
    await rm(actual, { recursive: true, force: true });
  }
}

async function installScanner(directory) {
  await mkdir(join(directory, "scripts"), { recursive: true });
  await copyFile(scanner, join(directory, "scripts", "check-secrets.mjs"));
}

function scan(directory) {
  return spawnSync(process.execPath, [join(directory, "scripts", "check-secrets.mjs")], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function initGit(directory) {
  const result = spawnSync("git", ["init", "--quiet", directory], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("portable secret scanning detects public credentials without printing their values", async () => {
  await fixture(async (directory) => {
    await installScanner(directory);
    await writeFile(join(directory, "README.md"), fakeCredential);
    await mkdir(join(directory, ".local"));
    await writeFile(join(directory, ".local", "private.txt"), fakeCredential);
    const result = scan(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /README\.md/);
    assert.ok(!result.stderr.includes(fakeCredential));
    assert.ok(!result.stderr.includes("private.txt"));
  });
});

test(
  "Git publication scanning excludes ignored local keys but includes untracked public files",
  { skip: !gitAvailable },
  async () => {
    await fixture(async (directory) => {
      initGit(directory);
      await installScanner(directory);
      await writeFile(join(directory, ".gitignore"), ".dev.vars\n");
      await writeFile(join(directory, ".dev.vars"), fakeCredential);
      await writeFile(join(directory, "README.md"), "Public portfolio documentation");
      assert.equal(scan(directory).status, 0);
      await writeFile(join(directory, "README.md"), fakeCredential);
      const result = scan(directory);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /README\.md/);
      assert.ok(!result.stderr.includes(fakeCredential));
    });
  },
);

test(
  "a nested ZIP copy cannot silently inherit its parent repository's ignore rules",
  { skip: !gitAvailable },
  async () => {
    await fixture(async (directory) => {
      initGit(directory);
      await writeFile(join(directory, ".gitignore"), ".local/\n");
      const nested = join(directory, ".local", "downloaded-project");
      await installScanner(nested);
      await writeFile(join(nested, "README.md"), fakeCredential);
      const result = scan(nested);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /README\.md/);
      assert.ok(!result.stderr.includes(fakeCredential));
    });
  },
);
