import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const git = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: fileURLToPath(root),
  encoding: "utf8",
  timeout: 10_000,
});
const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: fileURLToPath(root),
  encoding: "utf8",
  timeout: 10_000,
});
const normalizedPath = (path) =>
  process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
// A ZIP extracted inside another repository must not inherit that parent's ignore rules.
const usesGitPublicationSet =
  git.status === 0 &&
  gitRoot.status === 0 &&
  normalizedPath(gitRoot.stdout.trim()) === normalizedPath(fileURLToPath(root));
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".vinext",
  ".wrangler",
  ".local",
  ".local-assets",
  ".netlify",
  "outputs",
  "work",
  "coverage",
]);
const localFile = (path) =>
  /(^|\/)(?:\.dev\.vars(?:\..+)?|\.env(?:\..+)?|hosting\.json)$/.test(path) &&
  !path.endsWith(".example");

async function portableFiles(directory = "") {
  const files = [];
  for (const entry of await readdir(new URL(`${directory || "."}/`, root), {
    withFileTypes: true,
  })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name))
      files.push(...(await portableFiles(path)));
    if (entry.isFile() && !localFile(path)) files.push(path);
  }
  return files;
}

// Git gives the exact publication set. The fallback also supports GitHub ZIP downloads.
const files = usesGitPublicationSet
  ? git.stdout.split("\0").filter(Boolean)
  : await portableFiles();
const contentPatterns = [
  /(?:gsk_|AIza|sk-or-v1-|sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /^[ \t]*(?:GROQ_API_KEY|GEMINI_API_KEY|OPENROUTER_API_KEY|CEREBRAS_API_KEY)[ \t]*=[ \t]*[^\s#]+/m,
];
const findings = new Set();
let publicationCount = 0;
for (const path of new Set(files)) {
  try {
    if (!(await stat(new URL(path, root))).isFile()) continue;
  } catch (error) {
    if (error.code === "ENOENT") continue; // Deleted tracked files are not published.
    throw error;
  }
  publicationCount++;
  if (
    usesGitPublicationSet &&
    (localFile(path) || /\.(?:pem|p12|pfx|sqlite|sqlite3|db)$/.test(path))
  ) {
    findings.add(path);
    continue;
  }
  if (!/\.(?:[cm]?[jt]sx?|jsonc?|md|ya?ml|css|sql|toml|txt|example)$/.test(path)) continue;
  try {
    const content = await readFile(new URL(path, root), "utf8");
    if (contentPatterns.some((pattern) => pattern.test(content))) findings.add(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error; // Deleted tracked files are not published.
  }
}
if (findings.size) {
  // Report only paths; never print the matching credential or its surrounding line.
  console.error(
    "Potential confidential content in publishable files:\n" + [...findings].sort().join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Secret check passed (${publicationCount} publishable files). Pattern scan only; not a guarantee against every secret format.`,
  );
}
