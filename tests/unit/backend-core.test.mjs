import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Load the exact production rules without the Cloudflare entry-point imports.
const source = await readFile(new URL("../../worker/signal-core.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const core = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const feedSource = await readFile(new URL("../../worker/feed-parser.ts", import.meta.url), "utf8");
const feedCompiled = ts.transpileModule(feedSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const feeds = await import(
  `data:text/javascript;base64,${Buffer.from(feedCompiled).toString("base64")}`
);

const minute = 60_000;
const hour = 60 * minute;
const epoch = Date.UTC(2026, 0, 1);
function candle(time = epoch, overrides = {}) {
  return {
    time,
    open: 100,
    high: 105,
    low: 95,
    close: 101,
    volume: 2,
    quoteVolume: 200,
    ...overrides,
  };
}

test("rejects inherited timeframe keys instead of treating them as supported input", () => {
  const timeframes = { "1h": { cost: 5 } };
  assert.equal(core.hasOwnKey(timeframes, "1h"), true);
  for (const key of ["constructor", "toString", "__proto__", "6h"])
    assert.equal(core.hasOwnKey(timeframes, key), false);
});

test("distinguishes a valid zero from missing or malformed provider metrics", () => {
  assert.equal(core.finiteNumberOrNull("0"), 0);
  assert.equal(core.finiteNumberOrNull("-0.001"), -0.001);
  for (const input of [null, undefined, "", " ", "unavailable", [], {}, false, Infinity])
    assert.equal(core.finiteNumberOrNull(input), null);
});

test("normalizes, sorts and deduplicates exchange candles, discarding malformed prices", () => {
  const valid = [epoch, "100", "105", "95", "101", "2", 0, "200"];
  const next = [epoch + minute, "101", "106", "96", "102", "3", 0, "300"];
  const malformed = [epoch + 2 * minute, 100, 99, 95, 101, 2, 0, 200];
  assert.deepEqual(
    core.normalizeKlines([next, valid, valid, malformed, [epoch, 1, 2, 0, 1, 1], null]),
    [
      candle(),
      candle(epoch + minute, {
        open: 101,
        high: 106,
        low: 96,
        close: 102,
        volume: 3,
        quoteVolume: 300,
      }),
    ],
  );
  assert.deepEqual(core.normalizeKlines({ code: -1 }), []);
  assert.equal(core.normalizeKlines([[epoch, 100, 105, 95, 101, 2, 200]], 6)[0].quoteVolume, 200);
});

test("builds real three-hour candles and drops unfinished or missing hourly groups", () => {
  const hourly = Array.from({ length: 7 }, (_, index) =>
    candle(epoch + index * hour, { close: 100 + index, high: 106 + index }),
  );
  const result = core.aggregateKlines(hourly, 3 * hour, hour, epoch + 6.5 * hour);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result[0],
    candle(epoch, { close: 102, high: 108, volume: 6, quoteVolume: 600 }),
  );
  assert.equal(result[1].time, epoch + 3 * hour);
  assert.equal(
    core.aggregateKlines(
      hourly.filter((_, index) => index !== 1),
      3 * hour,
      hour,
      epoch + 6.5 * hour,
    ).length,
    1,
  );
});

test("flat prices have neutral RSI, while monotonic gains/losses hit the bounds", () => {
  assert.equal(core.calculateRsi(Array(40).fill(100)), 50);
  assert.equal(core.calculateRsi(Array.from({ length: 40 }, (_, index) => index + 1)), 100);
  assert.equal(core.calculateRsi(Array.from({ length: 40 }, (_, index) => 100 - index)), 0);
  assert.equal(core.calculateRsi([100, 101]), 50);
});

test("resolves ambiguous intrabar take-profit and stop-loss conservatively in both directions", () => {
  const path = [candle(epoch, { high: 112, low: 88 })];
  assert.deepEqual(core.evaluateSignalOutcome("LONG", 100, 90, 110, path, true), {
    hit: false,
    resolvedPrice: 90,
    reason: "ambiguous_intrabar_stop",
  });
  assert.deepEqual(core.evaluateSignalOutcome("SHORT", 100, 110, 90, path, true), {
    hit: false,
    resolvedPrice: 110,
    reason: "ambiguous_intrabar_stop",
  });
});

test("grades touches chronologically and only grades direction after the deadline", () => {
  const firstStop = [candle(epoch, { low: 89 }), candle(epoch + minute, { high: 115 })];
  assert.equal(
    core.evaluateSignalOutcome("LONG", 100, 90, 110, firstStop, true).reason,
    "stop_loss_hit",
  );
  assert.equal(core.evaluateSignalOutcome("LONG", 100, 90, 110, [candle()], false), null);
  assert.equal(core.evaluateSignalOutcome("LONG", 100, 90, 110, [candle()], true).hit, true);
  assert.equal(core.evaluateSignalOutcome("LONG", 100, 90, 110, [], true), null);
});

test("excludes pre-entry, after-deadline and unfinished candles from the resolution window", () => {
  const path = [-1, 0, 1, 2, 3].map((index) => candle(epoch + index * minute));
  assert.deepEqual(
    core
      .resolutionWindow(path, epoch + 30_000, epoch + 2.5 * minute, minute)
      .map((row) => row.time),
    [epoch + minute],
  );
});

test("a missing candle prevents later touches or a timeout from manufacturing a resolved win", () => {
  const path = [0, 1, 3, 4].map((index) =>
    candle(epoch + index * minute, index === 3 ? { high: 115 } : {}),
  );
  const window = core.resolutionWindow(path, epoch, epoch + 5 * minute, minute);
  assert.deepEqual(
    window.map((row) => row.time),
    [epoch, epoch + minute],
  );
  assert.equal(core.expectedResolutionBars(epoch, epoch + 5 * minute, minute), 5);
  assert.equal(core.evaluateSignalOutcome("LONG", 100, 90, 110, window, window.length === 5), null);
  assert.deepEqual(core.resolutionWindow(path.slice(1), epoch, epoch + 5 * minute, minute), []);
  // A known stop before the gap remains a valid conservative loss.
  const stopped = core.resolutionWindow(
    [candle(epoch, { low: 88 }), ...path.slice(1)],
    epoch,
    epoch + 5 * minute,
    minute,
  );
  assert.equal(
    core.evaluateSignalOutcome("LONG", 100, 90, 110, stopped, false).reason,
    "stop_loss_hit",
  );
});

test("resolution coverage counts full bars across fractional entry and deadline timestamps", () => {
  assert.equal(core.expectedResolutionBars(epoch + 30_000, epoch + 15.5 * minute, minute), 14);
  assert.equal(core.expectedResolutionBars(epoch + 30_000, epoch + 45_000, minute), 0);
  const path = Array.from({ length: 16 }, (_, index) => candle(epoch + index * minute));
  assert.equal(
    core.resolutionWindow(path, epoch + 30_000, epoch + 15.5 * minute, minute).length,
    14,
  );
});

test("bounds request bodies by bytes and cancels chunked input as soon as the limit is exceeded", async () => {
  const valid = new Request("https://local.test", { method: "POST", body: "Αβ" });
  assert.equal(await core.readLimitedBody(valid, 4), "Αβ");
  assert.equal(
    await core.readLimitedBody(
      new Request("https://local.test", { method: "POST", body: "Αβ" }),
      3,
    ),
    null,
  );
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(4));
    },
    cancel() {
      cancelled = true;
    },
  });
  const oversized = new Request("https://local.test", {
    method: "POST",
    body: stream,
    duplex: "half",
  });
  assert.equal(await core.readLimitedBody(oversized, 6), null);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 3, "must not consume an unbounded stream");
  const malformed = new Request("https://local.test", {
    method: "POST",
    body: new Uint8Array([255]),
  });
  await assert.rejects(core.readLimitedBody(malformed, 16));
});

test("requires targets on the correct side of the mark and a valid positive stop", () => {
  assert.equal(core.directionalRiskPlan("LONG", 100, 1, 90, 95).riskVeto, true);
  assert.equal(core.directionalRiskPlan("SHORT", 100, 1, 105, 110).riskVeto, true);
  assert.equal(core.directionalRiskPlan("LONG", 100, 0, 90, 110).riskVeto, true);
  assert.equal(core.directionalRiskPlan("LONG", 100, 30, 90, 200).riskVeto, true);
  assert.deepEqual(core.directionalRiskPlan("LONG", 100, 1, 90, 110), {
    stopLoss: 98,
    takeProfit: 110,
    rewardRisk: 5,
    riskVeto: false,
  });
  assert.deepEqual(core.directionalRiskPlan("NEUTRAL", 100, 1, 90, 110), {
    stopLoss: null,
    takeProfit: null,
    rewardRisk: null,
    riskVeto: false,
  });
});

test("round-trips Unicode share payloads and rejects malformed or oversized links", () => {
  const payload = { th: "Ανοδική τάση — Ethereum 🚀", s: "ETH" };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  assert.deepEqual(core.decodeUtf8Base64Url(encoded), payload);
  for (const invalid of ["%%%", "a".repeat(8_193), Buffer.from([255]).toString("base64url")])
    assert.throws(() => core.decodeUtf8Base64Url(invalid));
});

test("parses RSS descriptions, CDATA and escaped article URLs without losing Unicode", () => {
  const xml = `<rss><channel><item>
    <title><![CDATA[Bitcoin &amp; Ethereum — νέα]]></title>
    <description><![CDATA[<p>Market <b>update</b></p>]]></description>
    <content:encoded>Volume &#x2191;</content:encoded>
    <link>https://example.test/article?a=1&amp;b=2</link>
  </item><item><title>Ignored by limit</title></item></channel></rss>`;
  assert.deepEqual(feeds.parseFeedEntries(xml, 1), [
    {
      title: "Bitcoin & Ethereum — νέα",
      description: "Market update  Volume ↑",
      url: "https://example.test/article?a=1&b=2",
    },
  ]);
});

test("prefers Atom article links regardless of attribute or link order", () => {
  const xml = `<feed><entry><title>ETF update</title>
    <link href="https://example.test/feed" rel="self"/>
    <link href = 'https://example.test/article?a=1&amp;b=2' rel = 'alternate'/>
    <summary>Institutional flows</summary>
  </entry></feed>`;
  assert.equal(feeds.parseFeedEntries(xml, 30)[0].url, "https://example.test/article?a=1&b=2");
});

test("an Atom link without rel is an article link ahead of self or enclosure links", () => {
  const xml = `<feed><entry><title>Protocol update</title>
    <link href="https://example.test/feed" rel="self"/>
    <link href="https://example.test/image.png" rel="enclosure"/>
    <link href="https://example.test/article"/>
  </entry></feed>`;
  assert.equal(feeds.parseFeedEntries(xml, 30)[0].url, "https://example.test/article");
});

test("feed links reject executable schemes and support explicit RSS GUID permalinks", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///etc/passwd",
    "/relative",
    "",
  ])
    assert.equal(feeds.sanitizeExternalUrl(url), "");
  const xml = `<rss><item><title>Unsafe link</title><link>javascript:alert(1)</link><guid isPermaLink="true">https://example.test/article</guid></item>
    <item><title>Not a link</title><guid isPermaLink="false">https://example.test/id</guid></item></rss>`;
  assert.deepEqual(
    feeds.parseFeedEntries(xml, 30).map((entry) => entry.url),
    ["https://example.test/article", ""],
  );
});

test("invalid numeric XML entities cannot discard the whole feed", () => {
  const xml = `<rss><item><title>Bad &#9999999999999; &#xD800; &#0; entity</title></item><item><title>Valid &#128640; story</title></item></rss>`;
  assert.deepEqual(
    feeds.parseFeedEntries(xml, 30).map((entry) => entry.title),
    ["Bad � � � entity", "Valid 🚀 story"],
  );
});

test("news keyword matching keeps short symbols out of unrelated words", () => {
  assert.equal(feeds.keywordMatches("the sec announced a ban.", "sec"), true);
  assert.equal(feeds.keywordMatches("the second urban report", "sec"), false);
  assert.equal(feeds.keywordMatches("the second urban report", "ban"), false);
  assert.equal(
    feeds.keywordMatches("federal reserve interest rate decision", "interest rate"),
    true,
  );
  assert.equal(feeds.keywordMatches("ETH/USD exchange volume", "eth"), true);
});
