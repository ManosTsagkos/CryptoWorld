import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as model from "../../docs/showcase/demo-model.mjs";

const {
  demoAssets,
  samplePrices,
  inspectTrend,
  chartCoordinates,
  normalizeDemoWatchlist,
  filterDemoAssets,
} = model;

test("sample ranges expose fixed prices without mutating shared data", () => {
  for (const asset of demoAssets) {
    assert.ok(Object.isFrozen(asset) && Object.isFrozen(asset.shape));
    for (const [range, count] of [
      ["1D", 12],
      ["1W", 21],
      ["1M", 31],
    ]) {
      const values = samplePrices(asset.symbol, range);
      assert.equal(values.length, count);
      assert.equal(values.at(-1), asset.price);
      assert.ok(values.every((value) => Number.isFinite(value) && value > 0));
      values[0] = -1;
      assert.ok(samplePrices(asset.symbol, range)[0] > 0);
    }
  }
  assert.throws(() => samplePrices("UNKNOWN"), RangeError);
  assert.throws(() => samplePrices("BTC", "year"), RangeError);
});

test("trend inspection handles rising, falling, flat and invalid samples", () => {
  const rising = inspectTrend([100, 101, 102, 103, 104, 110]);
  assert.ok(Math.abs(rising.change - 10) < 1e-10);
  assert.equal(rising.average, 104);
  assert.equal(rising.direction, "Above recent average");
  assert.equal(inspectTrend([110, 104, 103, 102, 101, 100]).direction, "Below recent average");
  assert.deepEqual(inspectTrend([42, 42]), {
    change: 0,
    average: 42,
    distance: 0,
    direction: "Near recent average",
  });
  for (const bad of [[], [1], [0, 1], [-1, 1], [1, NaN], [1, Infinity], null]) {
    assert.throws(() => inspectTrend(bad), RangeError);
  }
});

test("chart coordinates remain within the viewport and center flat prices", () => {
  for (const asset of demoAssets) {
    const points = chartCoordinates(samplePrices(asset.symbol, "1M"));
    assert.equal(points[0].x, 16);
    assert.equal(points.at(-1).x, 744);
    assert.ok(points.every(({ x, y }) => x >= 16 && x <= 744 && y >= 16 && y <= 224));
  }
  assert.deepEqual(chartCoordinates([5, 5], 100, 80, 10), [
    { x: 10, y: 40 },
    { x: 90, y: 40 },
  ]);
  for (const dimensions of [
    [30, 80, 16],
    [100, 20, 16],
    [100, 80, -1],
    [NaN, 80, 16],
  ]) {
    assert.throws(() => chartCoordinates([5, 6], ...dimensions), RangeError);
  }
});

test("search and watchlist filtering reject stored junk and handle empty results", () => {
  assert.deepEqual(normalizeDemoWatchlist(["BTC", "BTC", "ETH", "bad", {}, 1]), ["BTC", "ETH"]);
  assert.deepEqual(normalizeDemoWatchlist({ BTC: true }), []);
  assert.deepEqual(
    filterDemoAssets("  EtherEUM  ", []).map((asset) => asset.symbol),
    ["ETH"],
  );
  assert.deepEqual(
    filterDemoAssets("", ["BTC", "SOL"], true).map((asset) => asset.symbol),
    ["BTC", "SOL"],
  );
  assert.equal(filterDemoAssets("BTC", ["SOL"], true).length, 0);
  assert.equal(filterDemoAssets("missing", []).length, 0);
});

// A small DOM boundary executes the shipped controller without browser dependencies.
// It exercises transitions and storage failures; real browser layout is checked separately.
class Element {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.listeners = new Map();
    this.textContent = "";
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }
  append(...items) {
    this.children.push(...items);
  }
  replaceChildren() {
    this.children = [];
  }
  fire(name, event = {}) {
    this.listeners.get(name)?.(event);
  }
}

async function demoHarness({ stored = null, storageFails = false } = {}) {
  const [html, source] = await Promise.all([
    readFile(new URL("../../docs/showcase/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../docs/showcase/demo.mjs", import.meta.url), "utf8"),
  ]);
  const elements = new Map(
    [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element(match[1])]),
  );
  const get = (id) => {
    assert.ok(elements.has(id), `Controller refers to absent markup: ${id}`);
    return elements.get(id);
  };
  get("demo-coin").value = "BTC";
  get("demo-range").value = "1W";
  const windowListeners = new Map();
  const writes = [];
  const localStorage = {
    getItem() {
      if (storageFails) throw new Error("Disabled storage");
      return stored;
    },
    setItem(key, value) {
      if (storageFails) throw new Error("Disabled storage");
      writes.push([key, value]);
    },
  };
  const controller = source.replace(/^import[\s\S]*?from "\.\/demo-model\.mjs";\s*/, "");
  assert.notEqual(
    controller,
    source,
    "Harness must execute the shipped controller after linking its model import",
  );
  runInNewContext(controller, {
    ...model,
    Intl,
    document: { getElementById: get, createElement: (tag) => new Element(tag) },
    window: { addEventListener: (name, callback) => windowListeners.set(name, callback) },
    localStorage,
  });
  return { get, writes, storage: (event) => windowListeners.get("storage")(event) };
}

test("demo controller switches assets/ranges, inspects points and reports sample calculations", async () => {
  const { get } = await demoHarness();
  assert.equal(get("interactive-demo").dataset.ready, "true");
  assert.equal(get("demo-market-rows").children.length, 5);
  const originalLine = get("demo-chart-line").attributes.d;
  get("demo-coin").value = "ETH";
  get("demo-coin").fire("change");
  assert.equal(get("demo-asset-name").textContent, "Ethereum / ETH");
  assert.notEqual(get("demo-chart-line").attributes.d, originalLine);
  get("demo-range").value = "1D";
  get("demo-range").fire("change");
  assert.equal(get("demo-cursor").max, "11");
  get("demo-cursor").value = "0";
  get("demo-cursor").fire("input");
  assert.match(get("demo-cursor-label").textContent, /^Sample 1 of 12:/);
  get("demo-inspect").fire("click");
  assert.match(get("demo-trend").textContent, /five-point average/);
  assert.match(get("demo-trend").textContent, /example data/);
});

test("demo controller filters assets, persists a watchlist and removes saved entries", async () => {
  const { get, writes } = await demoHarness();
  get("demo-market-rows").children[0].children[3].children[0].fire("click");
  assert.deepEqual(writes.at(-1), ["cryptoworld-portfolio-sample-watchlist-v1", '["BTC"]']);
  get("demo-only-watched").checked = true;
  get("demo-only-watched").fire("change");
  assert.equal(get("demo-market-rows").children.length, 1);
  assert.equal(
    get("demo-market-rows").children[0].children[3].children[0].attributes["aria-pressed"],
    "true",
  );
  get("demo-search").value = "ethereum";
  get("demo-search").fire("input");
  assert.equal(get("demo-market-rows").children.length, 0);
  assert.equal(get("demo-empty").hidden, false);
  get("demo-search").value = "";
  get("demo-search").fire("input");
  get("demo-market-rows").children[0].children[3].children[0].fire("click");
  assert.equal(get("demo-market-rows").children.length, 0);
  assert.equal(writes.at(-1)[1], "[]");
});

test("demo controller recovers malformed storage and remains usable with storage blocked", async () => {
  for (const options of [{ stored: "{invalid" }, { storageFails: true }]) {
    const { get } = await demoHarness(options);
    assert.equal(get("demo-market-rows").children.length, 5);
    get("demo-market-rows").children[2].children[3].children[0].fire("click");
    get("demo-only-watched").checked = true;
    get("demo-only-watched").fire("change");
    assert.equal(get("demo-market-rows").children.length, 1);
    if (options.storageFails)
      assert.match(get("demo-watch-status").textContent, /kept for this visit/);
  }
});

test("demo watchlists sync across tabs and clear safely on invalid storage events", async () => {
  const { get, storage } = await demoHarness({ stored: '["ETH","bad","ETH"]' });
  assert.match(get("demo-watch-status").textContent, /^1 sample asset saved/);
  get("demo-only-watched").checked = true;
  get("demo-only-watched").fire("change");
  storage({ key: "other-app", newValue: '["BTC"]' });
  assert.match(get("demo-market-rows").children[0].children[0].children[0].textContent, /^ETH/);
  storage({ key: "cryptoworld-portfolio-sample-watchlist-v1", newValue: '["SOL"]' });
  assert.match(get("demo-market-rows").children[0].children[0].children[0].textContent, /^SOL/);
  get("demo-market-rows").children[0].children[0].children[0].fire("click");
  assert.equal(get("demo-asset-name").textContent, "Solana / SOL");
  storage({ key: "cryptoworld-portfolio-sample-watchlist-v1", newValue: "bad-json" });
  assert.equal(get("demo-empty").hidden, false);
  storage({ key: null, newValue: null });
  assert.equal(get("demo-market-rows").children.length, 0);
});
