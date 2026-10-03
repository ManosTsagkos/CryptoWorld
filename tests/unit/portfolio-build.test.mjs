import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildPortfolio, portfolioFiles } from "../../scripts/build-portfolio.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "cryptoworld-portfolio-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [source] of portfolioFiles) {
    const target = join(root, source);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      source.endsWith("index.html")
        ? 'CryptoWorld <img src="./assets/dashboard.jpg">'
        : "public asset",
    );
  }
  return root;
}

test("portfolio publication copies only its explicit static asset list", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, ".dev.vars"), "owner-only-placeholder");
  await mkdir(join(root, "dist", "client"), { recursive: true });
  await writeFile(join(root, "dist", "client", "app.js"), "private app build placeholder");
  const output = await buildPortfolio(root);
  assert.deepEqual(
    (await readdir(output)).sort(),
    [".nojekyll", "assets", "index.html", "showcase.js", "styles.css"].sort(),
  );
  assert.deepEqual(
    (await readdir(join(output, "assets"))).sort(),
    ["cryptoworld-logo.png", "dashboard.jpg", "market-overview.jpg", "mobile.jpg"].sort(),
  );
  assert.equal(await readFile(join(root, ".dev.vars"), "utf8"), "owner-only-placeholder");
  assert.equal(
    await readFile(join(root, "dist", "client", "app.js"), "utf8"),
    "private app build placeholder",
  );
});

test("a failed portfolio build preserves the previously generated preview", async (t) => {
  const root = await fixture(t);
  const output = await buildPortfolio(root);
  const original = await readFile(join(output, "index.html"), "utf8");
  await rm(join(root, "docs", "showcase", "styles.css"));
  await assert.rejects(buildPortfolio(root), { code: "ENOENT" });
  assert.equal(await readFile(join(output, "index.html"), "utf8"), original);
  assert.deepEqual((await readdir(join(root, "dist"))).sort(), ["portfolio"]);
});

test("portfolio assets cannot be symbolic links to private files", async (t) => {
  const root = await fixture(t);
  const logoPath = join(root, "public", "cryptoworld-logo.png");
  const privatePath = join(root, ".dev.vars");
  await writeFile(privatePath, "private-placeholder");
  await rm(logoPath);
  try {
    await symlink(privatePath, logoPath, "file");
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      t.skip("Windows file symlinks require Developer Mode or elevated privileges.");
      return;
    }
    throw error;
  }
  await assert.rejects(buildPortfolio(root), /regular file/);
});
