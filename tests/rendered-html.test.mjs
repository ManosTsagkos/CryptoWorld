import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const root = new URL("../", import.meta.url);
const environment = { ...process.env };
const nodeHelp = spawnSync(process.execPath, ["--help"], { encoding: "utf8" }).stdout;
if (process.platform === "win32" && !environment.CI && nodeHelp.includes("--use-system-ca")) {
  environment.NODE_OPTIONS = `${environment.NODE_OPTIONS ?? ""} --use-system-ca`.trim();
}
let server;
let serverOutput = "";
let origin;
let testState;

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

before(async () => {
  // A fresh store per run avoids stale/corrupt state and concurrent-suite collisions.
  // It stays separate from the developer's database and cannot load their AI keys.
  const stateParent = fileURLToPath(new URL(".wrangler/", root));
  await mkdir(stateParent, { recursive: true });
  testState = await mkdtemp(join(stateParent, "test-"));
  environment.CRYPTOWORLD_TEST_STATE = testState;
  const wranglerCli = fileURLToPath(new URL("node_modules/wrangler/bin/wrangler.js", root));
  const migration = spawnSync(
    process.execPath,
    [
      wranglerCli,
      "d1",
      "migrations",
      "apply",
      "top-crypto-signals-db",
      "--local",
      "--persist-to",
      testState,
    ],
    {
      cwd: fileURLToPath(root),
      env: environment,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(
    migration.status,
    0,
    `Test database migration failed.\n${migration.error?.message ?? ""}\n${migration.stderr}\n${migration.stdout}`,
  );

  const port = await unusedPort();
  origin = `http://127.0.0.1:${port}`;
  const viteCli = fileURLToPath(new URL("node_modules/vite/bin/vite.js", root));
  server = spawn(
    process.execPath,
    [viteCli, "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--mode", "test"],
    {
      // Unique port + isolated D1 allow checks alongside the developer's preview.
      cwd: fileURLToPath(root),
      env: { ...environment, VINEXT_NO_DEV_LOCK: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => {
    serverOutput = (serverOutput + chunk).slice(-12_000);
  });
  server.stderr.on("data", (chunk) => {
    serverOutput = (serverOutput + chunk).slice(-12_000);
  });

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null)
      throw new Error(`Vite exited before the smoke test started.\n${serverOutput}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // The development server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Vite.\n${serverOutput}`);
});

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      server.kill("SIGTERM");
    });
  }
  // This path was created by mkdtemp above, never a developer persistence directory.
  if (testState) await rm(testState, { recursive: true, force: true, maxRetries: 3 });
});

function request(path, options) {
  return fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(5_000) });
}

test("server-renders the branded dashboard without exposing credentials", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>CryptoWorld/);
  assert.match(html, /aria-label="CryptoWorld home"/);
  assert.match(html, /CRYPTO ALL IN ONE/);
  assert.match(html, /<title>CryptoWorld — Crypto All In One<\/title>/);
  assert.doesNotMatch(html, /all-in-one/i);
  assert.match(html, /rel="icon"[^>]+href="\/cryptoworld-logo\.png"/);
  assert.doesNotMatch(html, /Top Crypto Signals|TOP CRYPTO SIGNALS/);
  assert.match(html, /SIGNAL INTELLIGENCE CORE/);
  assert.match(html, /MACRO &amp; GEOPOLITICAL NEWS/);
  assert.doesNotMatch(
    html,
    /vinext-starter|Your site is taking shape|(?:gsk_|AIza|sk-or-v1-)[A-Za-z0-9_-]{20,}/i,
  );
});

test("serves the CryptoWorld logo as a PNG asset", async () => {
  const response = await request("/cryptoworld-logo.png");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^image\/png\b/i);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("health endpoint reaches a migrated D1 database", async () => {
  const response = await request("/api/data-health");
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.d1.bound, true);
  assert.equal(health.d1.reachable, true);
  assert.ok(Number.isFinite(Date.parse(health.since)));
});

test("unknown pages render the branded 404 recovery page", async () => {
  const response = await request("/portfolio-review-missing");
  assert.equal(response.status, 404);
  assert.match(await response.text(), /This page is off the map/);
});

test("concurrent wallet reads grant daily credits once and preserve private caching", async () => {
  const headers = { "x-signal-visitor": `smoke-${randomUUID()}` };
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => request("/api/credits", { headers })),
  );
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  }
  const wallets = await Promise.all(responses.map((response) => response.json()));
  assert.equal(wallets.filter((wallet) => wallet.dailyClaim?.claimed).length, 1);
  for (const wallet of wallets) {
    assert.equal(wallet.persistent, true);
    assert.equal(wallet.balance, 101);
    assert.equal(wallet.streakDays, 1);
    assert.deepEqual(wallet.history, []);
  }
  const repeat = await (await request("/api/credits", { headers })).json();
  assert.equal(repeat.balance, 101);
  assert.equal(repeat.dailyClaim.claimed, false);
});

test("invalid analysis payloads are rejected without consuming credits", async () => {
  const headers = {
    "content-type": "application/json",
    "x-signal-visitor": `invalid-${randomUUID()}`,
  };
  const before = await (await request("/api/credits", { headers })).json();
  for (const body of [
    "{",
    "null",
    "[]",
    JSON.stringify({ symbol: "BTC", timeframe: "constructor" }),
    JSON.stringify({ symbol: "BTC", timeframe: "__proto__" }),
    JSON.stringify({ symbol: "FAKE", timeframe: "1h" }),
  ]) {
    const response = await request("/api/signal-analysis", { method: "POST", headers, body });
    assert.equal(response.status, 400, body);
    assert.equal(typeof (await response.json()).error, "string");
  }
  const after = await (await request("/api/credits", { headers })).json();
  assert.equal(after.balance, before.balance);
  assert.equal(after.lifetimeSpent, before.lifetimeSpent);
});

test("cross-origin analysis requests and inherited timeframe keys are rejected", async () => {
  const response = await request("/api/signal-analysis", {
    method: "POST",
    headers: { origin: "https://unrelated.example", "content-type": "application/json" },
    body: JSON.stringify({ symbol: "BTC", timeframe: "1h" }),
  });
  assert.equal(response.status, 403);
  assert.equal((await request("/api/track-record?timeframe=constructor")).status, 400);
  assert.equal((await request("/api/market-history?id=bitcoin&range=constructor")).status, 400);
});

test("oversized analysis requests are rejected before credit processing", async () => {
  const headers = {
    "x-signal-visitor": `oversize-${randomUUID()}`,
    "content-type": "application/json",
  };
  const response = await request("/api/signal-analysis", {
    method: "POST",
    headers,
    body: JSON.stringify({ symbol: "BTC", timeframe: "1h", extra: "α".repeat(9_000) }),
  });
  assert.equal(response.status, 413);
  const wallet = await (await request("/api/credits", { headers })).json();
  assert.equal(wallet.balance, 101);
  assert.equal(wallet.lifetimeSpent, 0);
});

test("client-supplied email headers cannot select another visitor's wallet", async () => {
  const visitorA = `wallet-${randomUUID()}`;
  const visitorB = `wallet-${randomUUID()}`;
  const email = "untrusted@example.invalid";
  const walletA = await (
    await request("/api/credits", {
      headers: { "x-signal-visitor": visitorA, "oai-authenticated-user-email": email },
    })
  ).json();
  const walletB = await (
    await request("/api/credits", {
      headers: { "x-signal-visitor": visitorB, "oai-authenticated-user-email": email },
    })
  ).json();
  assert.equal(walletA.dailyClaim.claimed, true);
  assert.equal(walletB.dailyClaim.claimed, true);
  const repeatA = await (
    await request("/api/credits", {
      headers: {
        "x-signal-visitor": visitorA,
        "oai-authenticated-user-email": "different@example.invalid",
      },
    })
  ).json();
  assert.equal(repeatA.dailyClaim.claimed, false);
  assert.equal(repeatA.balance, walletA.balance);
});

test("watchlist validates symbols and returns an empty list for no selection", async () => {
  const empty = await request("/api/watchlist-status");
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { statuses: [] });
  assert.equal((await request("/api/watchlist-status?symbols=NOT_A_COIN")).status, 400);
});

test("share pages support UTF-8 text and escape user-provided markup", async () => {
  const payload = {
    s: "BTC",
    t: "1h",
    d: "LONG",
    c: 70,
    sc: 45,
    at: new Date().toISOString(),
    th: 'Ανάλυση <script>alert("test")</script>',
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const response = await request(`/share?d=${encoded}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Ανάλυση/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.equal((await request("/share?d=invalid")).status, 404);
});

test("production build does not package local secret files or secret-shaped client values", async () => {
  const serverFiles = await readdir(new URL("dist/server/", root));
  assert.ok(!serverFiles.some((name) => name.startsWith(".dev.vars") || name.startsWith(".env")));
  const chunks = new URL("dist/client/_next/static/chunks/", root);
  for (const name of await readdir(chunks)) {
    if (!name.endsWith(".js")) continue;
    assert.doesNotMatch(
      await readFile(new URL(name, chunks), "utf8"),
      /(?:gsk_|AIza|sk-or-v1-)[A-Za-z0-9_-]{20,}/,
      name,
    );
  }
});
