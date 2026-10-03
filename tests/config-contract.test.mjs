import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

test("keeps credentials local and publishes placeholder configuration", async () => {
  const [gitignore, example, worker] = await Promise.all([
    text(".gitignore"),
    text(".dev.vars.example"),
    text("worker/index.ts"),
  ]);

  assert.match(gitignore, /^\.dev\.vars$/m);
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(example, /^GROQ_API_KEY=$/m);
  assert.match(example, /^GEMINI_API_KEY=$/m);
  assert.doesNotMatch(example, /(?:gsk_|AIza)[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(worker, /C:\\Users\\/i);
});

test("Drizzle journal references every committed migration in order", async () => {
  const journal = JSON.parse(await text("drizzle/meta/_journal.json"));
  const files = (await readdir(new URL("drizzle/", root)))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const journalFiles = journal.entries.map((entry) => `${entry.tag}.sql`);

  assert.deepEqual(journalFiles, files);
  assert.deepEqual(
    journal.entries.map((entry) => entry.idx),
    journal.entries.map((_, index) => index),
  );
});

test("documents a reproducible quality-check command", async () => {
  const packageJson = JSON.parse(await text("package.json"));

  assert.equal(packageJson.engines.node, ">=22.13.0");
  assert.equal(
    packageJson.scripts.check,
    "npm run secrets:check && npm run format:check && npm run lint && npm run typecheck && npm run test",
  );
  assert.equal(packageJson.scripts["format:check"], "prettier --check .");
  assert.ok(packageJson.scripts["db:migrate:local"]);
});

test("the demo container sets up a local database without loading owner credentials", async () => {
  const container = JSON.parse(await text(".devcontainer/devcontainer.json"));

  assert.equal(container.name, "CryptoWorld");
  assert.equal(container.image, "mcr.microsoft.com/devcontainers/javascript-node:22-bookworm");
  assert.equal(container.postCreateCommand, "npm ci && npm run db:migrate:local");
  assert.deepEqual(container.forwardPorts, [5173]);
  assert.equal(container.portsAttributes["5173"].label, "CryptoWorld demo");
  assert.equal(container.remoteUser, "node");
  assert.equal(container.containerEnv, undefined);
  assert.equal(container.remoteEnv, undefined);
  assert.equal(container.mounts, undefined);
});

test("Pages publishes only the portfolio artifact after the full quality check", async () => {
  const [workflow, packageText] = await Promise.all([
    text(".github/workflows/portfolio-pages.yml"),
    text("package.json"),
  ]);
  const packageJson = JSON.parse(packageText);
  assert.equal(packageJson.scripts["build:portfolio"], "node scripts/build-portfolio.mjs");
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /run: npm run check[\s\S]*run: npm run build:portfolio/);
  assert.match(workflow, /path: dist\/portfolio\s/);
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /name: github-pages/);
  assert.doesNotMatch(workflow, /pull_request:|secrets\./);
});

test("portfolio copy uses the unhyphenated Crypto all in one tagline", async () => {
  for (const path of ["README.md", "docs/showcase/index.html"]) {
    const copy = await text(path);
    assert.match(copy, /Crypto all in one/);
    assert.doesNotMatch(copy, /all-in-one/i);
  }
});
