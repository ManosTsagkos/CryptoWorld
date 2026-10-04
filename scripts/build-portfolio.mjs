import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

// Pages receives a small allowlist, never the application build or a repository dump.
export const portfolioFiles = Object.freeze([
  ["docs/showcase/index.html", "index.html"],
  ["docs/showcase/styles.css", "styles.css"],
  ["docs/showcase/showcase.js", "showcase.js"],
  ["docs/showcase/demo.mjs", "demo.mjs"],
  ["docs/showcase/demo-model.mjs", "demo-model.mjs"],
  ["public/cryptoworld-logo.png", "assets/cryptoworld-logo.png"],
  ["docs/screenshots/dashboard.jpg", "assets/dashboard.jpg"],
  ["docs/screenshots/market-overview.jpg", "assets/market-overview.jpg"],
  ["docs/screenshots/mobile.jpg", "assets/mobile.jpg"],
]);

export async function buildPortfolio(root = fileURLToPath(new URL("../", import.meta.url))) {
  const projectRoot = resolve(root);
  const output = join(projectRoot, "dist", "portfolio");
  const staging = join(projectRoot, "dist", `portfolio-staging-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  try {
    for (const [source, destination] of portfolioFiles) {
      const sourcePath = join(projectRoot, source);
      const info = await lstat(sourcePath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`Portfolio asset must be a regular file: ${source}`);
      }
      const targetPath = join(staging, destination);
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
    const html = await readFile(join(staging, "index.html"), "utf8");
    if (!html.includes("CryptoWorld") || !html.includes("./assets/dashboard.jpg")) {
      throw new Error("Portfolio page is missing its brand or dashboard preview.");
    }
    await writeFile(join(staging, ".nojekyll"), "");
    // These exact generated directories are the only recursive cleanup targets.
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    return output;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = await buildPortfolio();
  console.log(`Portfolio built at ${output} (${portfolioFiles.length} public files + .nojekyll).`);
}
