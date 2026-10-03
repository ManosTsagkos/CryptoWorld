import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
const core = await loadModule("../../app/frontend-utils.ts");
const calendar = await loadModule("../../app/macro-calendar.ts");
const { createBrowserStore } = await loadModule("../../app/browser-store.ts");
const alert = {
  id: "a",
  symbol: "BTC",
  targetPrice: 100,
  direction: "above",
  triggered: false,
  createdAt: 1,
};

test("corrupt browser settings fall back to safe values and only supported ranges", () => {
  for (const value of [null, [], "bad", { reduceMotion: "yes", defaultRange: "constructor" }]) {
    assert.deepEqual(core.sanitizeSettings(value), { reduceMotion: false, defaultRange: "1D" });
  }
  assert.deepEqual(
    core.sanitizeSettings({ reduceMotion: true, defaultRange: "3M", injected: true }),
    { reduceMotion: true, defaultRange: "3M" },
  );
});

test("watchlist values are normalized, deduplicated, capped and reject invalid symbols", () => {
  assert.deepEqual(
    core.sanitizeSymbols([" btc ", "BTC", "eth", null, 8, "<script>", "A", "ABC/USDT"]),
    ["BTC", "ETH"],
  );
  assert.deepEqual(core.sanitizeSymbols({ BTC: true }), []);
  assert.equal(
    core.sanitizeSymbols(Array.from({ length: 150 }, (_, index) => `COIN${index}`)).length,
    100,
  );
});

test("invalid stored alerts and duplicate identifiers cannot enter the alert monitor", () => {
  const invalid = [
    null,
    {},
    { ...alert, id: "" },
    { ...alert, targetPrice: -1 },
    { ...alert, targetPrice: Infinity },
    { ...alert, direction: "sideways" },
    { ...alert, triggered: "false" },
    { ...alert, createdAt: -1 },
  ];
  assert.deepEqual(core.sanitizePriceAlerts([...invalid, alert, { ...alert }]), [alert]);
});

test("price alerts trigger at the threshold, ignore missing prices and never retrigger", () => {
  const below = { ...alert, id: "b", symbol: "ETH", direction: "below", targetPrice: 10 };
  const already = { ...alert, id: "c", triggered: true };
  assert.deepEqual(
    core.triggeredPriceAlerts(
      [alert, below, already],
      new Map([
        ["BTC", 100],
        ["ETH", 10],
      ]),
    ),
    [alert, below],
  );
  for (const value of [NaN, Infinity, 0, -1])
    assert.deepEqual(core.triggeredPriceAlerts([alert], new Map([["BTC", value]])), []);
  assert.deepEqual(core.triggeredPriceAlerts([alert], new Map()), []);
});

test("chart data is chronologically sorted and unique after millisecond-to-second conversion", () => {
  assert.deepEqual(
    core.normalizeHistoryPoints([
      [3000, 3],
      [1100, 1],
      [1999, 2],
      [2000, 0],
      [4000, Infinity],
      [-1000, 2],
      [5000, -1],
      [6000, "1"],
    ]),
    [
      [1000, 2],
      [3000, 3],
    ],
  );
  assert.deepEqual(
    core.normalizeHistoryPoints(
      [
        [1000, 0],
        [2000, 4],
      ],
      true,
    ),
    [
      [1000, 0],
      [2000, 4],
    ],
  );
  assert.deepEqual(core.normalizeHistoryPoints(null), []);
});

test("share links round-trip Greek text and emoji without btoa Unicode errors", () => {
  const payload = { th: "Ανοδική τάση — Ethereum 🚀", s: "ETH" };
  const encoded = core.encodeSharePayload(payload);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")), payload);
});

test("risk sizing works for long and short stops and refuses invalid/overflowing inputs", () => {
  assert.deepEqual(core.calculatePositionSize(1000, 1, 100, 95), {
    riskAmount: 10,
    size: 2,
    value: 200,
  });
  assert.deepEqual(core.calculatePositionSize(1000, 1, 100, 105), {
    riskAmount: 10,
    size: 2,
    value: 200,
  });
  for (const args of [
    [0, 1, 100, 95],
    [1000, 101, 100, 95],
    [1000, 1, 100, 100],
    [1000, 1, NaN, 90],
    [1e308, 100, 1e308, 1],
  ]) {
    assert.equal(core.calculatePositionSize(...args), null);
  }
});

test("indicative conversions preserve valid zero amounts but never display Infinity", () => {
  assert.equal(core.convertAtPrices(2, 500, 100), 10);
  assert.equal(core.convertAtPrices(0, 500, 100), 0);
  for (const args of [
    [2, null, 100],
    [2, 500, 0],
    [-1, 500, 100],
    [1e308, 1000, 1],
    [2, Infinity, 100],
  ]) {
    assert.equal(core.convertAtPrices(...args), null);
  }
});

test("macro calendar retains an ongoing meeting and expires old published schedules", () => {
  assert.deepEqual(calendar.upcomingFomcMeetings("2026-10-28")[0], ["2026-10-27", "2026-10-28"]);
  assert.deepEqual(calendar.upcomingFomcMeetings("2026-10-29")[0], ["2026-12-08", "2026-12-09"]);
  assert.deepEqual(calendar.upcomingFomcMeetings("2028-01-01"), []);
});

test("browser stores synchronize another tab's changes without losing a stable React snapshot", () => {
  let saved = JSON.stringify(["BTC"]);
  let reload;
  let stopped = 0;
  const store = createBrowserStore({
    key: "watchlist",
    initial: [],
    sanitize: core.sanitizeSymbols,
    storage: () => ({
      getItem: () => saved,
      setItem: (_, value) => {
        saved = value;
      },
    }),
    onStorageChange: (listener) => {
      reload = listener;
      return () => {
        stopped++;
      };
    },
  });
  assert.deepEqual(store.getServerSnapshot(), []);
  assert.deepEqual(store.getSnapshot(), ["BTC"]);
  const first = store.getSnapshot();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications++;
  });
  assert.equal(store.getSnapshot(), first);
  saved = JSON.stringify(["ETH", "eth"]);
  reload();
  assert.deepEqual(store.getSnapshot(), ["ETH"]);
  assert.equal(notifications, 1);
  reload();
  assert.equal(notifications, 1);
  store.update((symbols) => [...symbols, "SOL"]);
  assert.deepEqual(JSON.parse(saved), ["ETH", "SOL"]);
  saved = null;
  reload();
  assert.deepEqual(store.getSnapshot(), []);
  unsubscribe();
  assert.equal(stopped, 1);
});

test("blocked storage keeps preferences in memory while malformed JSON resets safely", () => {
  let blocked = true;
  let saved = "{invalid json";
  let reload;
  const store = createBrowserStore({
    key: "preferences",
    initial: { reduceMotion: false, defaultRange: "1D" },
    sanitize: core.sanitizeSettings,
    storage: () => {
      if (blocked) throw new Error("Storage access denied");
      return {
        getItem: () => saved,
        setItem: (_, value) => {
          saved = value;
        },
      };
    },
    onStorageChange: (listener) => {
      reload = listener;
      return () => {};
    },
  });
  const unsubscribe = store.subscribe(() => {});
  store.update((settings) => ({ ...settings, reduceMotion: true }));
  assert.equal(store.getSnapshot().reduceMotion, true);
  reload();
  assert.equal(store.getSnapshot().reduceMotion, true);
  blocked = false;
  reload();
  assert.deepEqual(store.getSnapshot(), { reduceMotion: false, defaultRange: "1D" });
  unsubscribe();
});
