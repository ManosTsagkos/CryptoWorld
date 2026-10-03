/** Cloudflare Worker entry point for CryptoWorld. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  SIGNAL_SYMBOLS,
  SIGNAL_TIMEFRAMES,
  type CreditWallet,
  type SignalAnalysis,
  type SignalTimeframe,
  type PublicTrackRecord,
  type WatchlistStatus,
} from "../app/signal-analysis";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  creditAccounts,
  signalAnalyses,
  signalRateLimits as signalRateLimitsTable,
  kvCache,
} from "../db/schema";
import {
  aggregateKlines,
  calculateRsi as rsi,
  decodeUtf8Base64Url,
  directionalRiskPlan,
  evaluateSignalOutcome,
  expectedResolutionBars,
  finiteNumberOrNull,
  hasOwnKey,
  normalizeKlines,
  readLimitedBody,
  resolutionWindow,
  type Kline,
} from "./signal-core";
import { keywordMatches, parseFeedEntries } from "./feed-parser";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  GEMINI_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const MARKET_REFRESH_MS = 5 * 60 * 1000;
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const COINPAPRIKA_API = "https://api.coinpaprika.com/v1";
const COINBASE_EXCHANGE_API = "https://api.exchange.coinbase.com";
const LLAMA_COINS_API = "https://coins.llama.fi";
const ALTERNATIVE_API = "https://api.alternative.me/fng/?limit=1&format=json";
const BINANCE_SPOT_API = "https://api.binance.com";
const BINANCE_FUTURES_API = "https://fapi.binance.com";
const BYBIT_API = "https://api.bybit.com";
const rangeDays: Record<string, string> = {
  "1H": "1",
  "1D": "1",
  "1W": "7",
  "1M": "30",
  "3M": "90",
  "1Y": "365",
  ALL: "max",
};
const allowedSignalSymbols = new Set<string>(SIGNAL_SYMBOLS);
const signalCoinIds: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  BNB: "binancecoin",
  DOGE: "dogecoin",
  ADA: "cardano",
  DOT: "polkadot",
  LINK: "chainlink",
  LTC: "litecoin",
  AVAX: "avalanche-2",
  ATOM: "cosmos",
  UNI: "uniswap",
  NEAR: "near",
  TRX: "tron",
  BCH: "bitcoin-cash",
  ETC: "ethereum-classic",
};
const allowedHistoryIds = new Set(Object.values(signalCoinIds));
const canonicalIdsBySymbol = signalCoinIds;
const coinbaseProductsById: Record<string, string> = {
  bitcoin: "BTC-USD",
  ethereum: "ETH-USD",
  solana: "SOL-USD",
  ripple: "XRP-USD",
  binancecoin: "BNB-USD",
  dogecoin: "DOGE-USD",
  cardano: "ADA-USD",
  polkadot: "DOT-USD",
  chainlink: "LINK-USD",
  litecoin: "LTC-USD",
  "avalanche-2": "AVAX-USD",
  cosmos: "ATOM-USD",
  uniswap: "UNI-USD",
  near: "NEAR-USD",
  tron: "TRX-USD",
  "bitcoin-cash": "BCH-USD",
  "ethereum-classic": "ETC-USD",
};
const llamaCoinsById: Record<string, string> = {
  bitcoin: "coingecko:bitcoin",
  ethereum: "coingecko:ethereum",
  solana: "coingecko:solana",
  ripple: "coingecko:ripple",
  binancecoin: "coingecko:binancecoin",
  dogecoin: "coingecko:dogecoin",
  cardano: "coingecko:cardano",
  polkadot: "coingecko:polkadot",
  chainlink: "coingecko:chainlink",
  litecoin: "coingecko:litecoin",
  "avalanche-2": "coingecko:avalanche-2",
  cosmos: "coingecko:cosmos",
  uniswap: "coingecko:uniswap",
  near: "coingecko:near",
  tron: "coingecko:tron",
  "bitcoin-cash": "coingecko:bitcoin-cash",
  "ethereum-classic": "coingecko:ethereum-classic",
};
const coreMarketAssets = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "polkadot", symbol: "DOT", name: "Polkadot" },
] as const;
const binanceIntervals: Record<SignalTimeframe, string> = {
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "3h": "1h",
  "6h": "6h",
};
const bybitIntervals: Record<SignalTimeframe, string> = {
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "3h": "60",
  "6h": "360",
};
const timeframeSeconds: Record<SignalTimeframe, number> = {
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "3h": 10800,
  "6h": 21600,
};
const newsAliases: Record<string, string[]> = {
  BTC: ["btc", "bitcoin"],
  ETH: ["eth", "ethereum"],
  SOL: ["sol", "solana"],
  XRP: ["xrp", "ripple"],
  BNB: ["bnb", "binance coin"],
  DOGE: ["doge", "dogecoin"],
  ADA: ["ada", "cardano"],
  DOT: ["dot", "polkadot"],
  LINK: ["link", "chainlink"],
  LTC: ["ltc", "litecoin"],
  AVAX: ["avax", "avalanche"],
  ATOM: ["atom", "cosmos"],
  UNI: ["uni", "uniswap"],
  NEAR: ["near protocol", "near"],
  TRX: ["trx", "tron"],
  BCH: ["bch", "bitcoin cash"],
  ETC: ["etc", "ethereum classic"],
};
const signalFeeds = [
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
  { source: "Blockworks", url: "https://blockworks.co/feed" },
  { source: "CryptoSlate", url: "https://cryptoslate.com/feed/" },
  { source: "NewsBTC", url: "https://www.newsbtc.com/feed/" },
  { source: "Bitcoin.com", url: "https://news.bitcoin.com/feed/" },
  { source: "U.Today", url: "https://u.today/rss" },
  { source: "CryptoPotato", url: "https://cryptopotato.com/feed/" },
  { source: "The Daily Hodl", url: "https://dailyhodl.com/feed/" },
];

type CachedPayload = { expiresAt: number; value: unknown };
const historyCache = new Map<string, CachedPayload>();
const sparklineCache = new Map<string, CachedPayload>();
const newsCache = new Map<string, CachedPayload>();
const localCreditWallets = new Map<string, { balance: number; lifetimeSpent: number }>();
const signalRateLimits = new Map<string, number>();

async function reserveAnalysisSlot(env: Env, userId: string): Promise<boolean> {
  const timestamp = Date.now();
  if (!env.DB) {
    warnMissingD1Once();
    if (timestamp - (signalRateLimits.get(userId) ?? 0) < 2_500) return false;
    signalRateLimits.set(userId, timestamp);
    return true;
  }
  // The conditional upsert is atomic across isolates. A read followed by a
  // write allowed simultaneous requests to pass the same cooldown check.
  const [row] = await drizzle(env.DB)
    .insert(signalRateLimitsTable)
    .values({ userId, lastRunAt: timestamp })
    .onConflictDoUpdate({
      target: signalRateLimitsTable.userId,
      set: { lastRunAt: timestamp },
      setWhere: sql`${signalRateLimitsTable.lastRunAt} <= ${timestamp - 2_500}`,
    })
    .returning({ userId: signalRateLimitsTable.userId });
  return Boolean(row);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Retries only on 429 (rate limited) and 503 (temporarily overloaded) — every
// other status (400/401/403/404/500...) is returned immediately since a retry
// won't change the outcome. Honors Retry-After when the upstream sends one.
async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000,
  attempts = 3,
): Promise<Response> {
  let response: Response;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    response = await fetchWithTimeout(url, init, timeoutMs);
    if (response.status !== 429 && response.status !== 503) return response;
    if (attempt === attempts) return response;
    const retryAfterMs = Number(response.headers.get("retry-after")) * 1000;
    const backoffMs =
      Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? Math.min(retryAfterMs, 5_000)
        : 350 * 2 ** (attempt - 1) + Math.random() * 150;
    console.error(
      "upstream-rate-limited-retrying",
      new URL(url).hostname,
      response.status,
      `attempt ${attempt}/${attempts}`,
      `waiting ${Math.round(backoffMs)}ms`,
    );
    await sleep(backoffMs);
  }
  return response!;
}

// In-memory diagnostic counters (per isolate — resets on cold start, so this
// is a live "is anything leaning on fallbacks right now" check, not durable
// history). Exposed read-only via GET /api/data-health.
type SourceTier = "primary" | "fallback" | "failure";
const dataSourceStats = new Map<string, Record<SourceTier, number>>();
const dataSourceStatsStartedAt = new Date().toISOString();
function recordSourceUsage(category: string, tier: SourceTier) {
  const entry = dataSourceStats.get(category) ?? { primary: 0, fallback: 0, failure: 0 };
  entry[tier] += 1;
  dataSourceStats.set(category, entry);
}
function dataHealthSnapshot() {
  return Object.fromEntries(
    [...dataSourceStats.entries()].map(([category, counts]) => [category, counts]),
  );
}

// Logs once per isolate (not once per request) so a missing D1 binding is
// loud in the logs instead of silently degrading credits/rate-limits/cache
// to memory-only (which resets on every cold start).
let warnedMissingD1 = false;
function warnMissingD1Once() {
  if (warnedMissingD1) return;
  warnedMissingD1 = true;
  console.error(
    "d1-binding-missing",
    "No D1 database bound — credits, rate limits, and the shared cache are running memory-only and will reset on the next cold start. Check the DB binding in wrangler config / hosting settings.",
  );
}

async function fetchJson(url: string) {
  const response = await fetchWithRetry(url, {
    headers: { accept: "application/json", "user-agent": "TopCryptoSignals/1.0" },
  });
  if (!response.ok) {
    console.error("market-upstream-status", new URL(url).hostname, response.status);
    throw new Error(`Upstream returned ${response.status}`);
  }
  return response.json().catch(() => {
    throw new Error(`Invalid JSON from ${new URL(url).hostname}`);
  }) as Promise<Record<string, unknown>>;
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control":
        status === 200
          ? "public, max-age=60, s-maxage=300, stale-while-revalidate=120"
          : "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

// Shared-card text is visitor input and must be escaped before HTML interpolation.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type CoinbaseHistoryConfig = { days: number; granularity: 60 | 300 | 3600 | 21600 | 86400 };

const coinbaseHistoryRanges: Record<string, CoinbaseHistoryConfig> = {
  "1H": { days: 1 / 24, granularity: 60 },
  "1D": { days: 1, granularity: 300 },
  "1W": { days: 7, granularity: 3600 },
  "1M": { days: 30, granularity: 21600 },
  "3M": { days: 90, granularity: 86400 },
  "1Y": { days: 365, granularity: 86400 },
  ALL: { days: 365 * 3, granularity: 86400 },
};

async function getCoinbaseMarketHistory(id: string, range: string, now = Date.now()) {
  const product = coinbaseProductsById[id];
  const config = coinbaseHistoryRanges[range];
  if (!product || !config) throw new Error("Unsupported Coinbase market history request");
  const end = Math.floor(now / 1000);
  const start = Math.floor(end - config.days * 86_400);
  const maxChunkSeconds = config.granularity * 299;
  const rawCandles: unknown[][] = [];

  for (let cursor = start; cursor < end; cursor += maxChunkSeconds + config.granularity) {
    const chunkEnd = Math.min(end, cursor + maxChunkSeconds);
    const upstreamUrl = new URL(`/products/${product}/candles`, COINBASE_EXCHANGE_API);
    upstreamUrl.search = new URLSearchParams({
      start: new Date(cursor * 1000).toISOString(),
      end: new Date(chunkEnd * 1000).toISOString(),
      granularity: String(config.granularity),
    }).toString();
    const chunk = (await fetchJson(upstreamUrl.toString())) as unknown;
    if (Array.isArray(chunk)) rawCandles.push(...chunk.filter(Array.isArray));
  }

  const candles = Array.from(new Map(rawCandles.map((row) => [safeNumber(row[0]), row])).values())
    .filter((row) => row.length >= 6 && safeNumber(row[0]) > 0 && safeNumber(row[4]) > 0)
    .sort((left, right) => safeNumber(left[0]) - safeNumber(right[0]));
  if (!candles.length) throw new Error("Coinbase returned no market candles");
  return {
    id,
    range,
    updatedAt: new Date(now).toISOString(),
    stale: false,
    prices: candles.map(
      (row) => [safeNumber(row[0]) * 1000, safeNumber(row[4])] as [number, number],
    ),
    volumes: candles.map(
      (row) =>
        [safeNumber(row[0]) * 1000, safeNumber(row[5]) * safeNumber(row[4])] as [number, number],
    ),
    source: "Coinbase Exchange",
  };
}

async function getCoinbaseSparkline(id: string) {
  const now = Date.now();
  const cached = sparklineCache.get(id);
  if (cached && cached.expiresAt > now) return cached.value as number[];
  const history = await getCoinbaseMarketHistory(id, "1W", now);
  const values = history.prices.map((point) => point[1]);
  sparklineCache.set(id, { expiresAt: now + MARKET_REFRESH_MS, value: values });
  return values;
}

const llamaHistoryRanges: Record<string, { seconds: number; span: number; period: string }> = {
  "1H": { seconds: 3_600, span: 60, period: "1m" },
  "1D": { seconds: 86_400, span: 288, period: "5m" },
  "1W": { seconds: 7 * 86_400, span: 168, period: "1h" },
  "1M": { seconds: 30 * 86_400, span: 120, period: "6h" },
  "3M": { seconds: 90 * 86_400, span: 90, period: "1d" },
  "1Y": { seconds: 365 * 86_400, span: 365, period: "1d" },
  ALL: { seconds: 3 * 365 * 86_400, span: 1095, period: "1d" },
};

async function getLlamaMarketHistory(id: string, range: string, now = Date.now()) {
  const coin = llamaCoinsById[id];
  const config = llamaHistoryRanges[range];
  if (!coin || !config) throw new Error("Unsupported DefiLlama market history request");
  const requestUrl = new URL(`/chart/${coin}`, LLAMA_COINS_API);
  requestUrl.search = new URLSearchParams({
    start: String(Math.floor(now / 1000) - config.seconds),
    span: String(config.span),
    period: config.period,
  }).toString();
  const upstream = await fetchJson(requestUrl.toString());
  const coins = (upstream.coins ?? {}) as Record<string, unknown>;
  const row = (coins[coin] ?? {}) as Record<string, unknown>;
  const rawPrices = Array.isArray(row.prices) ? row.prices : [];
  const prices = rawPrices
    .map((raw) => {
      const point = raw as Record<string, unknown>;
      return [safeNumber(point.timestamp) * 1000, safeNumber(point.price)] as [number, number];
    })
    .filter((point) => point[0] > 0 && point[1] > 0)
    .sort((left, right) => left[0] - right[0]);
  if (prices.length < 2) throw new Error("DefiLlama returned insufficient market history");
  return {
    id,
    range,
    updatedAt: new Date(now).toISOString(),
    stale: false,
    prices,
    volumes: prices.map(([timestamp]) => [timestamp, 0] as [number, number]),
    source: "DefiLlama Price API",
  };
}

function percentChange(current: number, previous: number) {
  return previous > 0 ? ((current - previous) / previous) * 100 : 0;
}

function historicalPrice(points: [number, number][], target: number) {
  if (!points.length) return 0;
  return points.reduce((nearest, point) =>
    Math.abs(point[0] - target) < Math.abs(nearest[0] - target) ? point : nearest,
  )[1];
}

async function getLlamaMarketSnapshot(now: number) {
  const coinKeys = coreMarketAssets.map((asset) => llamaCoinsById[asset.id]).join(",");
  const currentUrl = `${LLAMA_COINS_API}/prices/current/${coinKeys}`;
  const [currentResult, fearResult, globalResult] = await Promise.all([
    fetchJson(currentUrl),
    fetchJson(ALTERNATIVE_API).catch(() => ({ data: [] })),
    // DefiLlama's coin-price API has no market-cap/dominance concept at all —
    // that's CoinGecko's specialty. Even when CoinGecko's heavier paginated
    // markets endpoint is failing/rate-limited (the reason we're in this
    // fallback tier to begin with), this single lightweight /global call
    // often still succeeds, since it's a much smaller request. If it also
    // fails, we report these fields as unavailable (null) rather than a
    // misleading "0%" / "$0".
    fetchJson(`${COINGECKO_API}/global`).catch((error) => {
      console.error(
        "coingecko-global-supplement-failed",
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    }),
  ]);
  const currentCoins = (currentResult.coins ?? {}) as Record<string, unknown>;
  const historyById = new Map<string, [number, number][]>();
  for (const asset of coreMarketAssets) {
    try {
      const history = await getLlamaMarketHistory(asset.id, "1W", now);
      historyById.set(asset.id, history.prices);
    } catch (error) {
      console.error(
        "defillama-sparkline-unavailable",
        asset.symbol,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  const assets = coreMarketAssets
    .map((asset) => {
      const coinKey = llamaCoinsById[asset.id];
      const current = (currentCoins[coinKey] ?? {}) as Record<string, unknown>;
      const points = historyById.get(asset.id) ?? [];
      const currentPrice = safeNumber(current.price, points.at(-1)?.[1] ?? 0);
      const currentTimestamp = safeNumber(current.timestamp, Math.floor(now / 1000)) * 1000;
      return {
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        image: "",
        currentPrice,
        marketCap: 0,
        marketCapRank: null,
        totalVolume: 0,
        change1h: percentChange(
          currentPrice,
          historicalPrice(points, currentTimestamp - 3_600_000),
        ),
        change24h: percentChange(
          currentPrice,
          historicalPrice(points, currentTimestamp - 86_400_000),
        ),
        change7d: percentChange(
          currentPrice,
          historicalPrice(points, currentTimestamp - 7 * 86_400_000),
        ),
        lastUpdated: new Date(currentTimestamp).toISOString(),
        sparkline7d: points.map((point) => point[1]),
      };
    })
    .filter((asset) => asset.currentPrice > 0);
  if (assets.length < 5) throw new Error("DefiLlama returned insufficient live assets");
  const fearRows = Array.isArray(fearResult.data) ? fearResult.data : [];
  const fearRow = fearRows[0] as Record<string, unknown> | undefined;
  const fearGreed = fearRow
    ? {
        value: safeNumber(fearRow.value),
        classification: String(fearRow.value_classification ?? "Unavailable"),
        timestamp: new Date(safeNumber(fearRow.timestamp) * 1000).toISOString(),
        timeUntilUpdate:
          fearRow.time_until_update == null ? null : safeNumber(fearRow.time_until_update),
      }
    : computeProxyFearGreed(assets);
  const trending = computeTrendingByAttention(assets).map((asset) => ({
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    marketCapRank: asset.marketCapRank,
    price: asset.currentPrice,
    change24h: asset.change24h,
  }));
  const globalData = (globalResult as { data?: Record<string, unknown> } | null)?.data;
  return {
    updatedAt: new Date(now).toISOString(),
    providerUpdatedAt:
      assets.reduce(
        (latest, asset) => (asset.lastUpdated > latest ? asset.lastUpdated : latest),
        "",
      ) || new Date(now).toISOString(),
    refreshIntervalMs: MARKET_REFRESH_MS,
    stale: false,
    assets,
    global: globalData
      ? {
          totalMarketCap: safeNumber(
            (globalData.total_market_cap as Record<string, unknown> | undefined)?.usd,
          ),
          totalVolume: safeNumber(
            (globalData.total_volume as Record<string, unknown> | undefined)?.usd,
          ),
          btcDominance: safeNumber(
            (globalData.market_cap_percentage as Record<string, unknown> | undefined)?.btc,
          ),
          ethDominance: safeNumber(
            (globalData.market_cap_percentage as Record<string, unknown> | undefined)?.eth,
          ),
          marketCapChange24h: safeNumber(globalData.market_cap_change_percentage_24h_usd),
          volumeChange24h: safeNumber(globalData.volume_change_percentage_24h_usd),
          activeCryptocurrencies: safeNumber(globalData.active_cryptocurrencies),
          markets: safeNumber(globalData.markets),
        }
      : {
          totalMarketCap: null,
          totalVolume: null,
          btcDominance: null,
          ethDominance: null,
          marketCapChange24h: null,
          volumeChange24h: null,
          activeCryptocurrencies: 0,
          markets: 0,
        },
    fearGreed,
    trending,
    sources: {
      market: globalData ? "DefiLlama Price API + CoinGecko Global" : "DefiLlama Price API",
      sentiment: fearRow ? "Alternative.me" : "Approximated (Alternative.me unavailable)",
    },
  };
}

async function getCoinPaprikaMarketSnapshot(now: number) {
  const [tickersResult, globalResult, fearResult] = await Promise.all([
    fetchJson(`${COINPAPRIKA_API}/tickers?quotes=USD&limit=100`),
    fetchJson(`${COINPAPRIKA_API}/global`),
    fetchJson(ALTERNATIVE_API).catch(() => ({ data: [] })),
  ]);
  const tickerRows = Array.isArray(tickersResult) ? tickersResult.slice(0, 100) : [];
  const assets = await Promise.all(
    tickerRows.map(async (raw) => {
      const row = raw as Record<string, unknown>;
      const symbol = String(row.symbol ?? "").toUpperCase();
      const quote = (((row.quotes ?? {}) as Record<string, unknown>).USD ?? {}) as Record<
        string,
        unknown
      >;
      const canonicalId = canonicalIdsBySymbol[symbol] ?? String(row.id ?? "");
      let sparkline7d: number[] = [];
      if (coinbaseProductsById[canonicalId]) {
        sparkline7d = await getCoinbaseSparkline(canonicalId).catch(() => []);
      }
      if (!sparkline7d.length && llamaCoinsById[canonicalId]) {
        try {
          const llamaHistory = await getLlamaMarketHistory(canonicalId, "1W", now);
          sparkline7d = llamaHistory.prices.map((point) => point[1]);
        } catch (error) {
          console.error(
            "sparkline-fallback-failed",
            canonicalId,
            error instanceof Error ? error.message : "unknown error",
          );
        }
      }
      return {
        id: canonicalId,
        symbol,
        name: String(row.name ?? symbol),
        image: "",
        currentPrice: safeNumber(quote.price),
        marketCap: safeNumber(quote.market_cap),
        marketCapRank: row.rank == null ? null : safeNumber(row.rank),
        totalVolume: safeNumber(quote.volume_24h),
        change1h: safeNumber(quote.percent_change_1h),
        change24h: safeNumber(quote.percent_change_24h),
        change7d: safeNumber(quote.percent_change_7d),
        lastUpdated: String(row.last_updated ?? new Date(now).toISOString()),
        sparkline7d,
      };
    }),
  );
  if (!assets.length) throw new Error("CoinPaprika returned no market assets");
  const globalData = globalResult as Record<string, unknown>;
  const fearRows = Array.isArray(fearResult.data) ? fearResult.data : [];
  const fearRow = fearRows[0] as Record<string, unknown> | undefined;
  const fearGreed = fearRow
    ? {
        value: safeNumber(fearRow.value),
        classification: String(fearRow.value_classification ?? "Unavailable"),
        timestamp: new Date(safeNumber(fearRow.timestamp) * 1000).toISOString(),
        timeUntilUpdate:
          fearRow.time_until_update == null ? null : safeNumber(fearRow.time_until_update),
      }
    : computeProxyFearGreed(assets);
  const totalMarketCap = safeNumber(globalData.market_cap_usd);
  const ethMarketCap = assets.find((asset) => asset.symbol === "ETH")?.marketCap ?? 0;
  const trending = computeTrendingByAttention(assets).map((asset) => ({
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    marketCapRank: asset.marketCapRank,
    price: asset.currentPrice,
    change24h: asset.change24h,
  }));
  return {
    updatedAt: new Date(now).toISOString(),
    providerUpdatedAt:
      assets.reduce(
        (latest, asset) => (asset.lastUpdated > latest ? asset.lastUpdated : latest),
        "",
      ) || new Date(now).toISOString(),
    refreshIntervalMs: MARKET_REFRESH_MS,
    stale: false,
    assets,
    global: {
      totalMarketCap,
      totalVolume: safeNumber(globalData.volume_24h_usd),
      btcDominance: safeNumber(globalData.bitcoin_dominance_percentage),
      ethDominance: totalMarketCap ? (ethMarketCap / totalMarketCap) * 100 : 0,
      marketCapChange24h: safeNumber(globalData.market_cap_change_24h),
      volumeChange24h: safeNumber(globalData.volume_24h_change_24h),
      activeCryptocurrencies: safeNumber(globalData.cryptocurrencies_number),
      markets: 0,
    },
    fearGreed,
    trending,
    sources: {
      market: "CoinPaprika + Coinbase Exchange",
      sentiment: fearRow ? "Alternative.me" : "Approximated (Alternative.me unavailable)",
    },
  };
}

async function getMarketSnapshot(env: Env) {
  const now = Date.now();
  const cachedSnapshot = await readKvCache<Record<string, unknown>>(env, "market-snapshot");
  if (cachedSnapshot) return cachedSnapshot;

  try {
    const snapshot = await getCoinPaprikaMarketSnapshot(now);
    await writeKvCache(env, "market-snapshot", snapshot, MARKET_REFRESH_MS);
    recordSourceUsage("market-snapshot", "primary");
    return snapshot;
  } catch (error) {
    console.error(
      "coinpaprika-market-fallback",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  try {
    const snapshot = await getLlamaMarketSnapshot(now);
    await writeKvCache(env, "market-snapshot", snapshot, MARKET_REFRESH_MS);
    recordSourceUsage("market-snapshot", "fallback");
    return snapshot;
  } catch (error) {
    console.error(
      "defillama-market-fallback",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  const marketUrl = new URL(`${COINGECKO_API}/coins/markets`);
  marketUrl.search = new URLSearchParams({
    vs_currency: "usd",
    order: "market_cap_desc",
    per_page: "100",
    page: "1",
    sparkline: "true",
    price_change_percentage: "1h,24h,7d",
  }).toString();

  try {
    const [marketRaw, globalRaw, trendingResult, fearResult] = await Promise.all([
      fetchJson(marketUrl.toString()),
      fetchJson(`${COINGECKO_API}/global`),
      fetchJson(`${COINGECKO_API}/search/trending`).catch(() => ({ coins: [] })),
      fetchJson(ALTERNATIVE_API).catch(() => ({ data: [] })),
    ]);
    const marketRows = Array.isArray(marketRaw) ? marketRaw : [];
    const assets = marketRows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const sparkline = row.sparkline_in_7d as { price?: unknown } | undefined;
      return {
        id: String(row.id ?? ""),
        symbol: String(row.symbol ?? "").toUpperCase(),
        name: String(row.name ?? ""),
        image: String(row.image ?? ""),
        currentPrice: Number(row.current_price ?? 0),
        marketCap: Number(row.market_cap ?? 0),
        marketCapRank: row.market_cap_rank == null ? null : Number(row.market_cap_rank),
        totalVolume: Number(row.total_volume ?? 0),
        change1h: Number(row.price_change_percentage_1h_in_currency ?? 0),
        change24h: Number(
          row.price_change_percentage_24h_in_currency ?? row.price_change_percentage_24h ?? 0,
        ),
        change7d: Number(row.price_change_percentage_7d_in_currency ?? 0),
        lastUpdated: String(row.last_updated ?? new Date(now).toISOString()),
        sparkline7d: Array.isArray(sparkline?.price)
          ? sparkline.price.map(Number).filter(Number.isFinite)
          : [],
      };
    });
    const globalData = (globalRaw.data ?? {}) as Record<string, unknown>;
    const marketCap = (globalData.total_market_cap ?? {}) as Record<string, unknown>;
    const volume = (globalData.total_volume ?? {}) as Record<string, unknown>;
    const dominance = (globalData.market_cap_percentage ?? {}) as Record<string, unknown>;
    const trendingRows = Array.isArray(trendingResult.coins) ? trendingResult.coins : [];
    const trending = trendingRows.slice(0, 6).map((entry) => {
      const item = ((entry as Record<string, unknown>).item ?? {}) as Record<string, unknown>;
      const data = (item.data ?? {}) as Record<string, unknown>;
      const changes = (data.price_change_percentage_24h ?? {}) as Record<string, unknown>;
      return {
        id: String(item.id ?? ""),
        symbol: String(item.symbol ?? "").toUpperCase(),
        name: String(item.name ?? ""),
        marketCapRank: item.market_cap_rank == null ? null : Number(item.market_cap_rank),
        price: data.price == null ? null : Number(data.price),
        change24h: changes.usd == null ? null : Number(changes.usd),
      };
    });
    const fearRows = Array.isArray(fearResult.data) ? fearResult.data : [];
    const fearRow = fearRows[0] as Record<string, unknown> | undefined;
    const fearGreed = fearRow
      ? {
          value: Number(fearRow.value ?? 0),
          classification: String(fearRow.value_classification ?? "Unavailable"),
          timestamp: new Date(Number(fearRow.timestamp ?? 0) * 1000).toISOString(),
          timeUntilUpdate:
            fearRow.time_until_update == null ? null : Number(fearRow.time_until_update),
        }
      : computeProxyFearGreed(assets);
    const providerUpdatedAt =
      assets.reduce(
        (latest, asset) => (asset.lastUpdated > latest ? asset.lastUpdated : latest),
        "",
      ) || new Date(now).toISOString();
    const snapshot = {
      updatedAt: new Date(now).toISOString(),
      providerUpdatedAt,
      refreshIntervalMs: MARKET_REFRESH_MS,
      stale: false,
      assets,
      global: {
        totalMarketCap: Number(marketCap.usd ?? 0),
        totalVolume: Number(volume.usd ?? 0),
        btcDominance: Number(dominance.btc ?? 0),
        ethDominance: Number(dominance.eth ?? 0),
        marketCapChange24h: Number(globalData.market_cap_change_percentage_24h_usd ?? 0),
        volumeChange24h: Number(globalData.volume_change_percentage_24h_usd ?? 0),
        activeCryptocurrencies: Number(globalData.active_cryptocurrencies ?? 0),
        markets: Number(globalData.markets ?? 0),
      },
      fearGreed,
      trending,
      sources: {
        market: "CoinGecko",
        sentiment: fearRow ? "Alternative.me" : "Approximated (Alternative.me unavailable)",
      },
    };
    await writeKvCache(env, "market-snapshot", snapshot, MARKET_REFRESH_MS);
    recordSourceUsage("market-snapshot", "fallback");
    return snapshot;
  } catch (error) {
    const stale = await readKvCacheStale<Record<string, unknown>>(env, "market-snapshot");
    if (stale) {
      recordSourceUsage("market-snapshot", "failure");
      return { ...stale, stale: true, error: "Live providers temporarily unavailable" };
    }
    recordSourceUsage("market-snapshot", "failure");
    throw error;
  }
}

async function getMarketHistory(url: URL) {
  const id = url.searchParams.get("id") ?? "";
  const range = (url.searchParams.get("range") ?? "1D").toUpperCase();
  if (!allowedHistoryIds.has(id) || !hasOwnKey(rangeDays, range))
    throw new Error("Unsupported market history request");
  const cacheKey = `${id}:${range}`;
  const now = Date.now();
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const value = await getLlamaMarketHistory(id, range, now);
    historyCache.set(cacheKey, { expiresAt: now + MARKET_REFRESH_MS, value });
    recordSourceUsage("market-history", "primary");
    return value;
  } catch (error) {
    console.error(
      "defillama-history-fallback",
      id,
      range,
      error instanceof Error ? error.message : "unknown error",
    );
  }
  try {
    const value = await getCoinbaseMarketHistory(id, range, now);
    historyCache.set(cacheKey, { expiresAt: now + MARKET_REFRESH_MS, value });
    recordSourceUsage("market-history", "fallback");
    return value;
  } catch (error) {
    console.error(
      "coinbase-history-fallback",
      id,
      range,
      error instanceof Error ? error.message : "unknown error",
    );
  }
  try {
    const upstream = await fetchJson(
      `${COINGECKO_API}/coins/${id}/market_chart?vs_currency=usd&days=${rangeDays[range]}`,
    );
    const value = {
      id,
      range,
      updatedAt: new Date(now).toISOString(),
      stale: false,
      prices: Array.isArray(upstream.prices) ? upstream.prices : [],
      volumes: Array.isArray(upstream.total_volumes) ? upstream.total_volumes : [],
      source: "CoinGecko",
    };
    historyCache.set(cacheKey, { expiresAt: now + MARKET_REFRESH_MS, value });
    recordSourceUsage("market-history", "fallback");
    return value;
  } catch (error) {
    if (cached) {
      recordSourceUsage("market-history", "failure");
      return { ...(cached.value as Record<string, unknown>), stale: true };
    }
    recordSourceUsage("market-history", "failure");
    throw error;
  }
}

type NewsHeadline = { title: string; source: string; url: string };
type AIReading = {
  sentiment: "Bullish" | "Bearish" | "Neutral";
  confidence: number;
  impact: number;
  summary: string;
  bullets: string[];
  catalyst: string;
  invalidation: string;
  provider: string;
};

// A second opinion belongs to the combined result, not an individual reading.
type EnsembleInfo = {
  ranSecondOpinion: boolean;
  secondaryProvider: string | null;
  secondarySentiment: "Bullish" | "Bearish" | "Neutral" | null;
  agreement: "agree" | "disagree" | "unavailable";
  note: string;
};
type AIReadingWithEnsemble = AIReading & { ensemble: EnsembleInfo };

function clamp(value: number, min = -100, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function safeNumber(value: unknown, fallback = 0) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// Alternative.me has no well-known free equivalent, so when it's down we
// don't just show "—" — we compute a rough proxy from live momentum instead.
// This is clearly NOT the real crowd-sourced Fear & Greed Index (that also
// factors in volatility, social sentiment, and surveys); it's a same-ballpark
// stand-in so the panel isn't blank, and callers should label it as such.
// A pure price-change sort just reproduces "top gainers", which isn't really
// what "trending" means (people also search for/attention-spike on coins that
// aren't necessarily up the most). When we have real per-asset volume data
// (CoinPaprika/CoinGecko tiers, unlike DefiLlama's price-only tier), blend in
// unusual volume-to-market-cap turnover as a second signal.
function computeTrendingByAttention<
  T extends { currentPrice: number; change24h: number; totalVolume: number; marketCap: number },
>(assets: T[], limit = 6): T[] {
  return [...assets]
    .filter((asset) => asset.currentPrice > 0)
    .map((asset) => {
      const turnoverRatio = asset.marketCap > 0 ? asset.totalVolume / asset.marketCap : 0;
      const score = Math.abs(asset.change24h) + turnoverRatio * 100;
      return { asset, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.asset);
}

function computeProxyFearGreed(assets: Array<{ change24h: number; change7d: number }>) {
  if (!assets.length) return null;
  const avg24h = assets.reduce((sum, asset) => sum + asset.change24h, 0) / assets.length;
  const avg7d = assets.reduce((sum, asset) => sum + asset.change7d, 0) / assets.length;
  const momentum = avg24h * 1.5 + avg7d * 0.5;
  const value = Math.max(0, Math.min(100, Math.round(50 + momentum * 3)));
  const classification =
    value < 25
      ? "Extreme Fear"
      : value < 45
        ? "Fear"
        : value < 55
          ? "Neutral"
          : value < 75
            ? "Greed"
            : "Extreme Greed";
  return { value, classification, timestamp: new Date().toISOString(), timeUntilUpdate: null };
}

async function fetchUnknownJson(url: string, init?: RequestInit) {
  const response = await fetchWithRetry(url, {
    ...init,
    headers: {
      accept: "application/json",
      "user-agent": "TopCryptoSignals/2.0",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    console.error("signal-upstream-status", new URL(url).hostname, response.status);
    throw new Error(`Upstream returned ${response.status}`);
  }
  return response.json().catch(() => {
    throw new Error(`Invalid JSON from ${new URL(url).hostname}`);
  }) as Promise<unknown>;
}

function binanceUrl(base: string, path: string, params: Record<string, string | number>) {
  const url = new URL(path, base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.toString();
}

function parseKlines(value: unknown): Kline[] {
  return normalizeKlines(value);
}

function marketHistoryKlines(value: unknown, groupSize: number): Kline[] {
  const history = value as { prices?: unknown; volumes?: unknown };
  const prices = Array.isArray(history?.prices) ? (history.prices as unknown[][]) : [];
  const volumes = Array.isArray(history?.volumes) ? (history.volumes as unknown[][]) : [];
  const rows: Kline[] = [];
  for (let index = 0; index < prices.length; index += groupSize) {
    const priceGroup = prices
      .slice(index, index + groupSize)
      .map((row) => safeNumber(row[1]))
      .filter(Boolean);
    if (!priceGroup.length) continue;
    const volumeGroup = volumes.slice(index, index + groupSize).map((row) => safeNumber(row[1]));
    rows.push({
      time: safeNumber(prices[index]?.[0]),
      open: priceGroup[0],
      high: Math.max(...priceGroup),
      low: Math.min(...priceGroup),
      close: priceGroup.at(-1)!,
      volume: 0,
      quoteVolume: volumeGroup.at(-1) ?? 0,
    });
  }
  return rows;
}

function historyRequestUrl(id: string, range: string) {
  const url = new URL("https://signal-core.local/api/market-history");
  url.searchParams.set("id", id);
  url.searchParams.set("range", range);
  return url;
}

function ema(values: number[], period: number) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const output = [values[0]];
  for (const value of values.slice(1))
    output.push(value * multiplier + output.at(-1)! * (1 - multiplier));
  return output;
}

function macdHistogram(values: number[]) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, index) => (fast[index] ?? 0) - (slow[index] ?? 0));
  const signal = ema(line, 9);
  return (line.at(-1) ?? 0) - (signal.at(-1) ?? 0);
}

function bollingerPercentB(values: number[], period = 20) {
  const window = values.slice(-period);
  if (window.length < period) return 0.5;
  const average = window.reduce((sum, value) => sum + value, 0) / window.length;
  const variance = window.reduce((sum, value) => sum + (value - average) ** 2, 0) / window.length;
  const deviation = Math.sqrt(variance);
  const upper = average + deviation * 2;
  const lower = average - deviation * 2;
  return upper === lower ? 0.5 : ((values.at(-1) ?? average) - lower) / (upper - lower);
}

function atr(klines: Kline[], period = 14) {
  const window = klines.slice(-(period + 1));
  if (window.length < 2) return 0;
  const ranges = window
    .slice(1)
    .map((candle, index) =>
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - window[index].close),
        Math.abs(candle.low - window[index].close),
      ),
    );
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

// Kaufman's efficiency ratio measures trend consistency; ATR/price measures
// volatility. Keeping both lets the prompt distinguish choppy from trending markets.
function computeMarketRegime(values: number[], atrValue: number, mark: number, lookback = 20) {
  const window = values.slice(-(lookback + 1));
  const netMove = window.length > 1 ? Math.abs(window.at(-1)! - window[0]) : 0;
  const totalMove =
    window.length > 1
      ? window.slice(1).reduce((sum, value, index) => sum + Math.abs(value - window[index]), 0)
      : 0;
  const efficiencyRatio = totalMove > 0 ? clamp(netMove / totalMove, 0, 1) : 0;
  const regime: "trending" | "choppy" = efficiencyRatio >= 0.4 ? "trending" : "choppy";
  const atrPct = mark > 0 ? (atrValue / mark) * 100 : 0;
  const volatilityLevel: "low" | "normal" | "high" =
    atrPct < 1 ? "low" : atrPct <= 3 ? "normal" : "high";
  return {
    regime,
    volatilityLevel,
    efficiencyRatio: Math.round(efficiencyRatio * 100) / 100,
    atrPct: Math.round(atrPct * 100) / 100,
  };
}

// --- Chart Pattern Recognition ---------------------------------------------
// Purely geometric/rule-based — no AI, no training, no ML model. Runs on the
// same OHLC candles already fetched for the technical layer, so it costs
// nothing extra. The approach: find local swing highs/lows (a standard
// "fractal" technique), then check whether recent swings fit the textbook
// shape of a handful of well-known reversal/continuation patterns.
type SwingPoint = { index: number; price: number; type: "high" | "low"; time: number };

type DetectedPattern = {
  type: string;
  direction: "bullish" | "bearish";
  confidence: number; // 0-100, geometry-fit score — not a probability of profit
  status: "forming" | "confirmed";
  breakoutLevel: number | null;
  description: string;
  points: { index: number; price: number; time: number }[];
};

function findSwingPoints(klines: Kline[], lookback = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < klines.length - lookback; i += 1) {
    const windowSlice = klines.slice(i - lookback, i + lookback + 1);
    const current = klines[i];
    if (windowSlice.every((candle) => candle.high <= current.high)) {
      points.push({ index: i, price: current.high, type: "high", time: current.time });
    } else if (windowSlice.every((candle) => candle.low >= current.low)) {
      points.push({ index: i, price: current.low, type: "low", time: current.time });
    }
  }
  return points;
}

function toPatternPoints(swings: SwingPoint[]) {
  return swings.map((swing) => ({ index: swing.index, price: swing.price, time: swing.time }));
}

function detectDoubleTopsAndBottoms(swings: SwingPoint[], klines: Kline[]): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const lastClose = klines.at(-1)?.close ?? 0;
  const highs = swings.filter((swing) => swing.type === "high");
  const lows = swings.filter((swing) => swing.type === "low");

  for (let i = 0; i < highs.length - 1; i += 1) {
    const first = highs[i];
    const second = highs[i + 1];
    const heightDiffPct = Math.abs(first.price - second.price) / first.price;
    if (heightDiffPct > 0.025) continue;
    const between = lows.filter((low) => low.index > first.index && low.index < second.index);
    if (!between.length) continue;
    const neckline = Math.min(...between.map((low) => low.price));
    const retracementPct = (first.price - neckline) / first.price;
    if (retracementPct < 0.02) continue;
    const confidence = clamp(
      Math.round(
        65 + (1 - heightDiffPct / 0.025) * 15 + (Math.min(retracementPct, 0.08) / 0.08) * 20,
      ),
      0,
      100,
    );
    results.push({
      type: "Double Top",
      direction: "bearish",
      confidence,
      status: lastClose < neckline ? "confirmed" : "forming",
      breakoutLevel: neckline,
      description: `Two peaks near $${formatPatternPrice(first.price)} with a neckline at $${formatPatternPrice(neckline)}.`,
      points: toPatternPoints([first, ...between, second]),
    });
  }

  for (let i = 0; i < lows.length - 1; i += 1) {
    const first = lows[i];
    const second = lows[i + 1];
    const heightDiffPct = Math.abs(first.price - second.price) / first.price;
    if (heightDiffPct > 0.025) continue;
    const between = highs.filter((high) => high.index > first.index && high.index < second.index);
    if (!between.length) continue;
    const neckline = Math.max(...between.map((high) => high.price));
    const retracementPct = (neckline - first.price) / first.price;
    if (retracementPct < 0.02) continue;
    const confidence = clamp(
      Math.round(
        65 + (1 - heightDiffPct / 0.025) * 15 + (Math.min(retracementPct, 0.08) / 0.08) * 20,
      ),
      0,
      100,
    );
    results.push({
      type: "Double Bottom",
      direction: "bullish",
      confidence,
      status: lastClose > neckline ? "confirmed" : "forming",
      breakoutLevel: neckline,
      description: `Two troughs near $${formatPatternPrice(first.price)} with a neckline at $${formatPatternPrice(neckline)}.`,
      points: toPatternPoints([first, ...between, second]),
    });
  }
  return results;
}

function detectHeadAndShoulders(swings: SwingPoint[], klines: Kline[]): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const lastClose = klines.at(-1)?.close ?? 0;
  const highs = swings.filter((swing) => swing.type === "high");
  const lows = swings.filter((swing) => swing.type === "low");

  for (let i = 0; i < highs.length - 2; i += 1) {
    const [leftShoulder, head, rightShoulder] = [highs[i], highs[i + 1], highs[i + 2]];
    if (head.price <= leftShoulder.price || head.price <= rightShoulder.price) continue;
    const shoulderDiffPct = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
    if (shoulderDiffPct > 0.04) continue;
    const headProminencePct =
      (head.price - Math.max(leftShoulder.price, rightShoulder.price)) / head.price;
    if (headProminencePct < 0.015) continue;
    const necklinePoints = lows.filter(
      (low) => low.index > leftShoulder.index && low.index < rightShoulder.index,
    );
    if (necklinePoints.length < 2) continue;
    const neckline =
      necklinePoints.reduce((sum, point) => sum + point.price, 0) / necklinePoints.length;
    const confidence = clamp(
      Math.round(
        60 + (1 - shoulderDiffPct / 0.04) * 20 + (Math.min(headProminencePct, 0.05) / 0.05) * 20,
      ),
      0,
      100,
    );
    results.push({
      type: "Head & Shoulders",
      direction: "bearish",
      confidence,
      status: lastClose < neckline ? "confirmed" : "forming",
      breakoutLevel: neckline,
      description: `Head at $${formatPatternPrice(head.price)} above two similar shoulders, neckline near $${formatPatternPrice(neckline)}.`,
      points: toPatternPoints([leftShoulder, ...necklinePoints, head, rightShoulder]),
    });
  }

  for (let i = 0; i < lows.length - 2; i += 1) {
    const [leftShoulder, head, rightShoulder] = [lows[i], lows[i + 1], lows[i + 2]];
    if (head.price >= leftShoulder.price || head.price >= rightShoulder.price) continue;
    const shoulderDiffPct = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
    if (shoulderDiffPct > 0.04) continue;
    const headProminencePct =
      (Math.min(leftShoulder.price, rightShoulder.price) - head.price) / head.price;
    if (headProminencePct < 0.015) continue;
    const necklinePoints = highs.filter(
      (high) => high.index > leftShoulder.index && high.index < rightShoulder.index,
    );
    if (necklinePoints.length < 2) continue;
    const neckline =
      necklinePoints.reduce((sum, point) => sum + point.price, 0) / necklinePoints.length;
    const confidence = clamp(
      Math.round(
        60 + (1 - shoulderDiffPct / 0.04) * 20 + (Math.min(headProminencePct, 0.05) / 0.05) * 20,
      ),
      0,
      100,
    );
    results.push({
      type: "Inverse Head & Shoulders",
      direction: "bullish",
      confidence,
      status: lastClose > neckline ? "confirmed" : "forming",
      breakoutLevel: neckline,
      description: `Head at $${formatPatternPrice(head.price)} below two similar shoulders, neckline near $${formatPatternPrice(neckline)}.`,
      points: toPatternPoints([leftShoulder, ...necklinePoints, head, rightShoulder]),
    });
  }
  return results;
}

function linearSlope(points: SwingPoint[]): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.index, 0);
  const sumY = points.reduce((sum, point) => sum + point.price, 0);
  const sumXY = points.reduce((sum, point) => sum + point.index * point.price, 0);
  const sumXX = points.reduce((sum, point) => sum + point.index * point.index, 0);
  const denominator = n * sumXX - sumX * sumX;
  return denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
}

function detectTriangles(swings: SwingPoint[], klines: Kline[]): DetectedPattern[] {
  const highs = swings.filter((swing) => swing.type === "high").slice(-4);
  const lows = swings.filter((swing) => swing.type === "low").slice(-4);
  if (highs.length < 2 || lows.length < 2) return [];
  const lastClose = klines.at(-1)?.close ?? 0;
  const avgPrice = lastClose || 1;
  const highSlopePct = (linearSlope(highs) / avgPrice) * 100;
  const lowSlopePct = (linearSlope(lows) / avgPrice) * 100;
  const flatThreshold = 0.05; // % price change per candle considered "flat"

  const highIsFlat = Math.abs(highSlopePct) < flatThreshold;
  const lowIsFlat = Math.abs(lowSlopePct) < flatThreshold;
  const points = toPatternPoints([...highs, ...lows].sort((a, b) => a.index - b.index));
  const upperLevel = highs.at(-1)?.price ?? avgPrice;
  const lowerLevel = lows.at(-1)?.price ?? avgPrice;

  if (highIsFlat && lowSlopePct > flatThreshold) {
    return [
      {
        type: "Ascending Triangle",
        direction: "bullish",
        confidence: clamp(Math.round(55 + Math.min(lowSlopePct, 1) * 25), 0, 100),
        status: lastClose > upperLevel ? "confirmed" : "forming",
        breakoutLevel: upperLevel,
        description: `Flat resistance near $${formatPatternPrice(upperLevel)} with rising support — a classic bullish-continuation setup.`,
        points,
      },
    ];
  }
  if (lowIsFlat && highSlopePct < -flatThreshold) {
    return [
      {
        type: "Descending Triangle",
        direction: "bearish",
        confidence: clamp(Math.round(55 + Math.min(Math.abs(highSlopePct), 1) * 25), 0, 100),
        status: lastClose < lowerLevel ? "confirmed" : "forming",
        breakoutLevel: lowerLevel,
        description: `Flat support near $${formatPatternPrice(lowerLevel)} with falling resistance — a classic bearish-continuation setup.`,
        points,
      },
    ];
  }
  if (highSlopePct < -flatThreshold && lowSlopePct > flatThreshold) {
    const directionGuess: "bullish" | "bearish" =
      klines.at(-1)!.close >= klines.at(-Math.min(20, klines.length))!.close
        ? "bullish"
        : "bearish";
    return [
      {
        type: "Symmetrical Triangle",
        direction: directionGuess,
        confidence: clamp(
          Math.round(50 + (Math.min(Math.abs(highSlopePct), 1) + Math.min(lowSlopePct, 1)) * 12),
          0,
          100,
        ),
        status: "forming",
        breakoutLevel: null,
        description:
          "Converging trendlines — direction of breakout will confirm bias; treat as neutral until it breaks.",
        points,
      },
    ];
  }
  return [];
}

function formatPatternPrice(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(6);
}

function detectChartPatterns(klines: Kline[]): DetectedPattern[] {
  if (klines.length < 30) return [];
  const swings = findSwingPoints(klines, klines.length > 120 ? 4 : 3);
  const detected = [
    ...detectDoubleTopsAndBottoms(swings, klines),
    ...detectHeadAndShoulders(swings, klines),
    ...detectTriangles(swings, klines),
  ];
  return detected.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

function historicalTrendReplay(values: number[], count = 6) {
  const outcomes: boolean[] = [];
  const start = Math.max(1, values.length - count - 1);
  for (let index = start; index < values.length - 1; index += 1) {
    const window = values.slice(0, index + 1);
    const predictedUp = (ema(window, 20).at(-1) ?? 0) >= (ema(window, 50).at(-1) ?? 0);
    const actualUp = values[index + 1] >= values[index];
    outcomes.push(predictedUp === actualUp);
  }
  const hitRate = outcomes.length ? (outcomes.filter(Boolean).length / outcomes.length) * 100 : 0;
  return { sampleSize: outcomes.length, hitRate, outcomes };
}

async function getRelevantHeadlines(symbol: string): Promise<NewsHeadline[]> {
  const now = Date.now();
  const cached = newsCache.get(symbol);
  if (cached && cached.expiresAt > now) return cached.value as NewsHeadline[];
  const keywords = newsAliases[symbol] ?? [symbol.toLowerCase()];
  const results = await Promise.all(
    signalFeeds.map(async (feed) => {
      try {
        const response = await fetchWithTimeout(
          feed.url,
          { headers: { "user-agent": "TopCryptoSignals/2.0" } },
          8_000,
        );
        if (!response.ok) {
          recordSourceUsage(`news-feed:${feed.source}`, "failure");
          return [];
        }
        const contentType = response.headers.get("content-type") ?? "";
        const xml = await response.text();
        // Some feeds occasionally serve an HTML block/error page with a 200
        // status (e.g. a CDN challenge page). Guard against silently "parsing"
        // that as if it were real RSS/Atom content.
        if (!/xml|rss|atom/i.test(contentType) && !/^\s*<\?xml|<rss\b|<feed\b/i.test(xml)) {
          recordSourceUsage(`news-feed:${feed.source}`, "failure");
          console.error(
            "news-feed-non-xml-response",
            feed.source,
            contentType || "no content-type header",
          );
          return [];
        }
        recordSourceUsage(`news-feed:${feed.source}`, "primary");
        return parseFeedEntries(xml, 45)
          .map(({ title, description, url }) => {
            return {
              title,
              source: feed.source,
              url,
              haystack: `${title} ${description}`.toLowerCase(),
            };
          })
          .filter(
            (item) =>
              item.title && keywords.some((keyword) => keywordMatches(item.haystack, keyword)),
          );
      } catch {
        recordSourceUsage(`news-feed:${feed.source}`, "failure");
        return [];
      }
    }),
  );
  const unique = new Map<string, NewsHeadline>();
  results.flat().forEach(({ title, source, url }) => {
    if (!unique.has(title)) unique.set(title, { title, source, url });
  });
  const headlines = [...unique.values()].slice(0, 6);
  newsCache.set(symbol, { expiresAt: now + MARKET_REFRESH_MS, value: headlines });
  return headlines;
}

type MacroNewsCategory = "Macro" | "Geopolitical" | "Regulation" | "On-Chain" | "Institutional";

type MacroNewsItem = {
  id: string;
  category: MacroNewsCategory;
  headline: string;
  source: string;
  url: string;
  impact: number;
  direction: "up" | "down";
};

const macroCategoryKeywords: Record<MacroNewsCategory, string[]> = {
  Macro: [
    "fed",
    "federal reserve",
    "interest rate",
    "rate cut",
    "rate hike",
    "inflation",
    "cpi",
    "jobs report",
    "recession",
    "central bank",
    "treasury",
    "yields",
    "powell",
    "fomc",
  ],
  Geopolitical: [
    "war",
    "conflict",
    "sanction",
    "tariff",
    "trade war",
    "invasion",
    "military",
    "geopolitic",
    "ceasefire",
    "election",
    "shutdown",
  ],
  Regulation: [
    "sec",
    "regulator",
    "regulation",
    "lawsuit",
    "congress",
    "bill",
    "law",
    "compliance",
    "ban",
    "cftc",
    "legislation",
    "court",
  ],
  "On-Chain": [
    "hack",
    "exploit",
    "breach",
    "whale",
    "wallet",
    "bridge",
    "protocol",
    "outage",
    "vulnerability",
    "stolen",
    "rug pull",
  ],
  Institutional: [
    "etf",
    "blackrock",
    "fidelity",
    "institutional",
    "custody",
    "asset manager",
    "pension",
    "sovereign wealth",
    "ipo",
    "acquire",
    "acquisition",
  ],
};

const macroPositiveKeywords = [
  "surge",
  "rally",
  "approve",
  "approval",
  "adopt",
  "bullish",
  "gain",
  "launch",
  "partnership",
  "record high",
  "inflow",
  "cut rates",
  "ease",
  "upgrade",
  "breakthrough",
];
const macroNegativeKeywords = [
  "hack",
  "exploit",
  "crash",
  "ban",
  "bearish",
  "sanction",
  "lawsuit",
  "decline",
  "selloff",
  "sell-off",
  "plunge",
  "outage",
  "breach",
  "shutdown",
  "hike",
  "delay",
  "reject",
  "warn",
  "war",
  "conflict",
  "tension",
  "escalat",
  "tariff",
  "invasion",
  "threat",
];

function classifyMacroHeadline(
  title: string,
  description: string,
): { category: MacroNewsCategory | null; direction: "up" | "down"; impact: number } {
  const haystack = `${title} ${description}`.toLowerCase();
  let bestCategory: MacroNewsCategory | null = null;
  let bestMatches = 0;
  for (const [category, keywords] of Object.entries(macroCategoryKeywords) as [
    MacroNewsCategory,
    string[],
  ][]) {
    const matches = keywords.filter((keyword) => keywordMatches(haystack, keyword)).length;
    if (matches > bestMatches) {
      bestMatches = matches;
      bestCategory = category;
    }
  }
  const positiveMatches = macroPositiveKeywords.filter((keyword) =>
    keywordMatches(haystack, keyword),
  ).length;
  const negativeMatches = macroNegativeKeywords.filter((keyword) =>
    keywordMatches(haystack, keyword),
  ).length;
  const direction: "up" | "down" = negativeMatches > positiveMatches ? "down" : "up";
  const sentimentStrength = Math.abs(positiveMatches - negativeMatches);
  const impact = Math.max(1, Math.min(10, Math.round(4 + bestMatches * 1.4 + sentimentStrength)));
  return { category: bestCategory, direction, impact };
}

async function getClassifiedFeedHeadlines(): Promise<MacroNewsItem[]> {
  const now = Date.now();
  const cacheKey = "__feed-raw__";
  const cached = newsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value as MacroNewsItem[];

  const results = await Promise.all(
    signalFeeds.map(async (feed) => {
      try {
        const response = await fetchWithTimeout(
          feed.url,
          { headers: { "user-agent": "TopCryptoSignals/2.0" } },
          8_000,
        );
        if (!response.ok) return [];
        const contentType = response.headers.get("content-type") ?? "";
        const xml = await response.text();
        if (!/xml|rss|atom/i.test(contentType) && !/^\s*<\?xml|<rss\b|<feed\b/i.test(xml)) {
          console.error(
            "news-feed-non-xml-response",
            feed.source,
            contentType || "no content-type header",
          );
          return [];
        }
        const entries = parseFeedEntries(xml, 30);
        const parsed = entries
          .map(({ title, description, url }) => {
            if (!title) return null;
            const { category, direction, impact } = classifyMacroHeadline(title, description);
            if (!category) return null;
            return {
              id: `${feed.source}-${title}`,
              category,
              headline: title,
              source: feed.source,
              url,
              impact,
              direction,
            };
          })
          .filter((item): item is MacroNewsItem => Boolean(item));
        if (!entries.length)
          console.error(
            "news-feed-empty-response",
            feed.source,
            `content-type=${contentType || "none"} bytes=${xml.length}`,
          );
        return parsed;
      } catch (error) {
        console.error(
          "news-feed-fetch-failed",
          feed.source,
          error instanceof Error ? error.message : "unknown error",
        );
        return [];
      }
    }),
  );

  // Different feeds often cover the same event with slightly different
  // wording ("Fed cuts rates by 25bps" vs "Fed Cuts Rates 25 Basis
  // Points") — exact-string dedup lets both through as separate items.
  // Normalize to a bag of significant words and treat headlines as
  // duplicates once they're similar enough (Jaccard similarity: shared
  // words over total distinct words across both headlines). Jaccard
  // instead of shared/min-size avoids falsely merging distinct stories
  // that happen to share a few generic reporting words (e.g. "China
  // imposes tariffs on tech" vs "US imposes tariffs on steel" — both
  // are legitimately separate stories despite overlapping wording).
  const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "of",
    "to",
    "in",
    "on",
    "for",
    "with",
    "at",
    "by",
    "is",
    "are",
    "was",
    "were",
    "as",
    "it",
    "its",
    "this",
    "that",
    "after",
    "over",
    "amid",
    "amidst",
    "new",
    "impose",
    "imposes",
    "imposed",
    "report",
    "reports",
    "reported",
    "says",
    "said",
  ]);
  function significantWords(headline: string): Set<string> {
    return new Set(
      headline
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
    );
  }
  function isNearDuplicate(a: Set<string>, b: Set<string>): boolean {
    if (!a.size || !b.size) return false;
    let shared = 0;
    for (const word of a) if (b.has(word)) shared++;
    const union = a.size + b.size - shared;
    return shared / union >= 0.5;
  }

  const deduped: MacroNewsItem[] = [];
  const seenWords: Set<string>[] = [];
  for (const item of results.flat()) {
    const words = significantWords(item.headline);
    if (seenWords.some((existing) => isNearDuplicate(existing, words))) continue;
    seenWords.push(words);
    deduped.push(item);
  }
  const classified = deduped;
  if (!classified.length) {
    console.error(
      "news-feed-no-classified-headlines",
      `raw-headlines=${results.flat().length} feeds=${signalFeeds.length}`,
    );
  }
  newsCache.set(cacheKey, { expiresAt: now + MARKET_REFRESH_MS, value: classified });
  return classified;
}

// 6+ is the target "medium/high impact" bar shown in the UI. Headlines are
// sparse and news cycles vary, so on quiet days nothing may clear that bar
// even though relevant, lower-impact headlines exist. Rather than show an
// empty panel, relax to the best available items (4+) so the feed still has
// content — the "6-10" label describes the target range for the primary
// filter, not a hard contract.
function pickByImpact(pool: MacroNewsItem[], logTag: string): MacroNewsItem[] {
  const strict = pool.filter((item) => item.impact >= 6);
  const items = (strict.length ? strict : pool.filter((item) => item.impact >= 4))
    .sort((left, right) => right.impact - left.impact)
    .slice(0, 8);
  if (!items.length) console.error(logTag, `pool=${pool.length}`);
  return items;
}

async function getMacroNews(): Promise<MacroNewsItem[]> {
  const classified = await getClassifiedFeedHeadlines();
  // "On-Chain" (hacks, exploits, whale moves, protocol/bridge events) is a
  // distinct news category — it belongs in the dedicated on-chain feed, not
  // this macro/geopolitical panel, so it's excluded here.
  const macroOnly = classified.filter((item) => item.category !== "On-Chain");
  return pickByImpact(macroOnly, "macro-news-empty-after-filter");
}

async function getOnChainNews(): Promise<MacroNewsItem[]> {
  const classified = await getClassifiedFeedHeadlines();
  const onChainOnly = classified.filter((item) => item.category === "On-Chain");
  return pickByImpact(onChainOnly, "onchain-news-empty-after-filter");
}

type DefiProtocolPayload = {
  id: string;
  name: string;
  category: string;
  tvl: number;
  change1d: number | null;
  change7d: number | null;
  chain: string;
};

async function getDefiProtocols(
  env: Env,
): Promise<{ items: DefiProtocolPayload[]; stale: boolean }> {
  const cacheKey = "defi-protocols";
  const cached = await readKvCache<DefiProtocolPayload[]>(env, cacheKey);
  if (cached) return { items: cached, stale: false };

  try {
    const response = await fetchWithRetry(
      "https://api.llama.fi/protocols",
      { headers: { "user-agent": "TopCryptoSignals/2.0" } },
      10_000,
      2,
    );
    if (!response.ok) throw new Error(`DefiLlama protocols error ${response.status}`);
    const raw = (await response.json()) as Array<Record<string, unknown>>;

    const items = raw
      .filter((protocol) => typeof protocol.tvl === "number" && protocol.tvl > 0)
      .sort((left, right) => (right.tvl as number) - (left.tvl as number))
      .slice(0, 15)
      .map((protocol): DefiProtocolPayload => ({
        id: String(protocol.slug ?? protocol.id ?? protocol.name),
        name: String(protocol.name ?? "Unknown protocol"),
        category: String(protocol.category ?? "DeFi"),
        tvl: protocol.tvl as number,
        change1d: typeof protocol.change_1d === "number" ? protocol.change_1d : null,
        change7d: typeof protocol.change_7d === "number" ? protocol.change_7d : null,
        chain: String(
          protocol.chain ?? (Array.isArray(protocol.chains) ? protocol.chains[0] : "Multi-chain"),
        ),
      }));

    await writeKvCache(env, cacheKey, items, MARKET_REFRESH_MS);
    recordSourceUsage("defi-protocols", "primary");
    return { items, stale: false };
  } catch (error) {
    console.error(
      "defillama-protocols-failed",
      error instanceof Error ? error.message : "unknown error",
    );
    const stale = await readKvCacheStale<DefiProtocolPayload[]>(env, cacheKey);
    if (stale) {
      recordSourceUsage("defi-protocols", "fallback");
      return { items: stale, stale: true };
    }
    recordSourceUsage("defi-protocols", "failure");
    throw error;
  }
}

function extractJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error("ai-json-extract-failed");
    throw new Error("AI provider returned no JSON object");
  }
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch (error) {
    console.error("ai-json-parse-failed");
    throw new Error("AI provider returned malformed JSON", { cause: error });
  }
}

function normalizeAIReading(raw: Record<string, unknown>, provider: string): AIReading {
  const sentiment =
    raw.sentiment === "Bullish" || raw.sentiment === "Bearish" ? raw.sentiment : "Neutral";
  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets
        .map(String)
        .map((value) => value.slice(0, 180))
        .slice(0, 3)
    : [];
  return {
    sentiment,
    confidence: Math.round(clamp(safeNumber(raw.confidence, 50), 0, 100)),
    impact: Math.round(clamp(safeNumber(raw.impact, 4), 1, 9)),
    summary: String(
      raw.summary ?? "The available channels do not yet show decisive convergence.",
    ).slice(0, 420),
    bullets: bullets.length
      ? bullets
      : [
          "No decisive news catalyst was identified.",
          "Technical and derivatives confirmation remain required.",
          "Risk controls remain active.",
        ],
    catalyst: String(raw.catalyst ?? "A confirmed breakout with expanding volume.").slice(0, 220),
    invalidation: String(
      raw.invalidation ?? "Loss of trend structure or a material risk event.",
    ).slice(0, 220),
    provider,
  };
}

async function withRetries<T>(fn: () => Promise<T>, attempts = 2, baseDelayMs = 400): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts)
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function callGroq(apiKey: string, prompt: string) {
  const value = (await fetchUnknownJson("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      max_completion_tokens: 760,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are the risk-first crypto market analyst inside CryptoWorld. Use only the supplied live metrics and headlines. Never promise returns. Return valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
    }),
  })) as { choices?: Array<{ message?: { content?: string } }> };
  return normalizeAIReading(
    extractJsonObject(value.choices?.[0]?.message?.content ?? ""),
    "Groq · Llama 3.3 70B",
  );
}

async function callOpenRouter(
  apiKey: string,
  prompt: string,
  model = "meta-llama/llama-3.3-70b-instruct:free",
) {
  const value = (await fetchUnknownJson("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-title": "CryptoWorld",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 760,
      messages: [
        {
          role: "system",
          content:
            "You are the risk-first crypto market analyst inside CryptoWorld. Use only the supplied live metrics and headlines. Never promise returns. Return valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
    }),
  })) as { choices?: Array<{ message?: { content?: string } }> };
  return normalizeAIReading(
    extractJsonObject(value.choices?.[0]?.message?.content ?? ""),
    `OpenRouter · ${model}`,
  );
}

async function callGemini(apiKey: string, prompt: string) {
  let lastError: unknown;
  for (const model of ["gemini-3.5-flash", "gemini-2.5-flash"]) {
    try {
      const value = (await fetchUnknownJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: "You are the risk-first crypto market analyst inside CryptoWorld. Use only supplied data and return valid JSON only.",
                },
              ],
            },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 760,
              responseMimeType: "application/json",
            },
          }),
        },
      )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return normalizeAIReading(
        extractJsonObject(value.candidates?.[0]?.content?.parts?.[0]?.text ?? ""),
        `Google · ${model}`,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function callCerebras(apiKey: string, prompt: string) {
  const value = (await fetchUnknownJson("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama3.1-70b",
      temperature: 0.2,
      max_tokens: 760,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are the risk-first crypto market analyst inside CryptoWorld. Use only the supplied live metrics and headlines. Never promise returns. Return valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
    }),
  })) as { choices?: Array<{ message?: { content?: string } }> };
  return normalizeAIReading(
    extractJsonObject(value.choices?.[0]?.message?.content ?? ""),
    "Cerebras · Llama 3.1 70B",
  );
}

async function getAIReading(
  env: Env,
  prompt: string,
  technicalScore: number,
  derivativesScore: number | null,
  regime: {
    regime: "trending" | "choppy";
    efficiencyRatio: number;
    volatilityLevel: "low" | "normal" | "high";
    atrPct: number;
  },
): Promise<AIReadingWithEnsemble> {
  const attempts: Array<{ name: string; run: () => Promise<AIReading> }> = [];
  if (env.GROQ_API_KEY)
    attempts.push({
      name: "groq",
      run: () => withRetries(() => callGroq(env.GROQ_API_KEY!, prompt)),
    });
  if (env.OPENROUTER_API_KEY)
    attempts.push({
      name: "openrouter",
      run: () =>
        withRetries(() => callOpenRouter(env.OPENROUTER_API_KEY!, prompt, env.OPENROUTER_MODEL)),
    });
  if (env.GEMINI_API_KEY)
    attempts.push({
      name: "gemini",
      run: () => withRetries(() => callGemini(env.GEMINI_API_KEY!, prompt)),
    });
  if (env.CEREBRAS_API_KEY)
    attempts.push({
      name: "cerebras",
      run: () => withRetries(() => callCerebras(env.CEREBRAS_API_KEY!, prompt)),
    });

  const noEnsemble = (note: string): EnsembleInfo => ({
    ranSecondOpinion: false,
    secondaryProvider: null,
    secondarySentiment: null,
    agreement: "unavailable",
    note,
  });

  // Two configured providers run concurrently. This costs two calls but
  // gives an independent second opinion and exposes directional disagreement.
  if (attempts.length >= 2) {
    const [primaryResult, secondaryResult] = await Promise.allSettled([
      attempts[0].run(),
      attempts[1].run(),
    ]);
    if (primaryResult.status === "fulfilled")
      console.log("ai-provider-succeeded", attempts[0].name);
    else
      console.error(
        "ai-provider-failed",
        attempts[0].name,
        primaryResult.reason instanceof Error ? primaryResult.reason.message : "unknown error",
      );
    if (secondaryResult.status === "fulfilled")
      console.log("ai-provider-succeeded", attempts[1].name);
    else
      console.error(
        "ai-provider-failed",
        attempts[1].name,
        secondaryResult.reason instanceof Error ? secondaryResult.reason.message : "unknown error",
      );

    if (primaryResult.status === "fulfilled" && secondaryResult.status === "fulfilled") {
      const primary = primaryResult.value;
      const secondary = secondaryResult.value;
      const hardDisagreement =
        (primary.sentiment === "Bullish" && secondary.sentiment === "Bearish") ||
        (primary.sentiment === "Bearish" && secondary.sentiment === "Bullish");
      const ensemble: EnsembleInfo = hardDisagreement
        ? {
            ranSecondOpinion: true,
            secondaryProvider: attempts[1].name,
            secondarySentiment: secondary.sentiment,
            agreement: "disagree",
            note: `${attempts[0].name} read ${primary.sentiment}, ${attempts[1].name} read ${secondary.sentiment} — the models disagree, so conviction is lowered rather than picking a side.`,
          }
        : {
            ranSecondOpinion: true,
            secondaryProvider: attempts[1].name,
            secondarySentiment: secondary.sentiment,
            agreement: "agree",
            note: `${attempts[1].name} independently reached a compatible read (${secondary.sentiment}), reinforcing this call.`,
          };
      // Disagreement caps confidence rather than averaging it away — the
      // point is to flag genuine uncertainty, not paper over it.
      const confidence = hardDisagreement ? Math.min(primary.confidence, 55) : primary.confidence;
      return { ...primary, confidence, ensemble };
    }
    if (primaryResult.status === "fulfilled") {
      return {
        ...primaryResult.value,
        ensemble: noEnsemble(
          `${attempts[1].name} (second opinion) failed to respond — proceeding on ${attempts[0].name} alone.`,
        ),
      };
    }
    if (secondaryResult.status === "fulfilled") {
      return {
        ...secondaryResult.value,
        ensemble: noEnsemble(
          `${attempts[0].name} failed to respond — used ${attempts[1].name}'s read instead, with no second opinion.`,
        ),
      };
    }
    // Both of the top two failed — fall through to any remaining providers.
  }

  for (const attempt of attempts.slice(attempts.length >= 2 ? 2 : 0)) {
    try {
      const reading = await attempt.run();
      console.log("ai-provider-succeeded", attempt.name);
      return {
        ...reading,
        ensemble: noEnsemble(
          attempts.length >= 2
            ? "The first two providers both failed — this is a later fallback with no second opinion available."
            : "Only one AI provider is configured — no second opinion to compare against.",
        ),
      };
    } catch (error) {
      console.error(
        "ai-provider-failed",
        attempt.name,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  console.error(
    "ai-provider-failed",
    "all-providers-exhausted",
    `tried: ${attempts.map((attempt) => attempt.name).join(", ") || "none configured"}`,
  );

  const base =
    derivativesScore == null ? technicalScore : technicalScore * 0.55 + derivativesScore * 0.45;
  const sentiment = base > 18 ? "Bullish" : base < -18 ? "Bearish" : "Neutral";
  // Same regime-awareness the LLM prompt gets: don't let this deterministic
  // fallback sound more confident than a choppy/ranging market deserves.
  const confidenceCeiling = regime.regime === "choppy" ? 60 : 72;
  return {
    sentiment,
    confidence: Math.round(clamp(48 + Math.abs(base) * 0.35, 35, confidenceCeiling)),
    impact: 3,
    summary: `The language-model layer is temporarily unavailable, so this report is using the deterministic convergence engine only (regime: ${regime.regime}).`,
    bullets: [
      "Technical structure remains the primary driver.",
      "Derivatives confirmation is included where available.",
      "Wait for the AI news layer before treating the setup as fully converged.",
    ],
    catalyst: "AI news confirmation plus expanding price and open-interest momentum.",
    invalidation: "A reversal in EMA structure or a safety-layer trigger.",
    provider: "Deterministic fallback",
    ensemble: noEnsemble(
      "No AI provider responded — this is the deterministic fallback, not a model output.",
    ),
  };
}

// Generic D1-backed cache: an in-memory Map is checked first for speed within
// the same isolate, then D1 for consistency across isolates/edge locations.
// Falls back to memory-only if there's no D1 binding (e.g. local dev without
// D1 configured) so nothing breaks when env.DB is absent.
const kvMemoryCache = new Map<string, CachedPayload>();

async function readKvCache<T>(env: Env, key: string): Promise<T | null> {
  const now = Date.now();
  const local = kvMemoryCache.get(key);
  if (local && local.expiresAt > now) return local.value as T;
  if (!env.DB) {
    warnMissingD1Once();
    return null;
  }
  try {
    const db = drizzle(env.DB);
    const [row] = await db.select().from(kvCache).where(eq(kvCache.cacheKey, key)).limit(1);
    if (row && row.expiresAt > now) {
      const parsed = JSON.parse(row.value) as T;
      kvMemoryCache.set(key, { expiresAt: row.expiresAt, value: parsed });
      return parsed;
    }
  } catch (error) {
    console.error(
      "kv-cache-read-failed",
      key,
      error instanceof Error ? error.message : "unknown error",
    );
  }
  return null;
}

// Last-resort read that ignores TTL expiry. Only used once every live
// provider has already failed, so stale data beats no data.
async function readKvCacheStale<T>(env: Env, key: string): Promise<T | null> {
  const local = kvMemoryCache.get(key);
  if (local) return local.value as T;
  if (!env.DB) {
    warnMissingD1Once();
    return null;
  }
  try {
    const db = drizzle(env.DB);
    const [row] = await db.select().from(kvCache).where(eq(kvCache.cacheKey, key)).limit(1);
    if (row) return JSON.parse(row.value) as T;
  } catch (error) {
    console.error(
      "kv-cache-stale-read-failed",
      key,
      error instanceof Error ? error.message : "unknown error",
    );
  }
  return null;
}

async function writeKvCache(env: Env, key: string, value: unknown, ttlMs: number): Promise<void> {
  const expiresAt = Date.now() + ttlMs;
  kvMemoryCache.set(key, { expiresAt, value });
  if (!env.DB) {
    warnMissingD1Once();
    return;
  }
  try {
    const db = drizzle(env.DB);
    const serialized = JSON.stringify(value);
    await db
      .insert(kvCache)
      .values({ cacheKey: key, value: serialized, expiresAt })
      .onConflictDoUpdate({ target: kvCache.cacheKey, set: { value: serialized, expiresAt } });
  } catch (error) {
    console.error(
      "kv-cache-write-failed",
      key,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

// "local-preview" is a deliberately shared bucket for requests with no
// visitor header at all (curl, API tooling, JS-disabled browsers) — the
// frontend (signalVisitorId in page.tsx) always sends a real per-visitor
// header, generating a random per-session one even when localStorage is
// blocked, so real users should never land here.
function signalUserId(request: Request) {
  // This public portfolio has no authenticated identity boundary. A client
  // supplied email header must never select another visitor's private history.
  const visitor = request.headers.get("x-signal-visitor")?.trim();
  return visitor && /^[a-zA-Z0-9-]{12,80}$/.test(visitor) ? `visitor:${visitor}` : "local-preview";
}

type DailyClaimResult = { claimed: boolean; granted: number; streakDays: number };

// Wallet loads grant free credits once per UTC day, with a bonus every
// seventh consecutive day. The claim is atomic across simultaneous requests.
const DAILY_FREE_CREDIT_BASE = 1;
const DAILY_FREE_CREDIT_STREAK_BONUS = 2;
const DAILY_STREAK_BONUS_EVERY_DAYS = 7;

function utcDateString(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function claimDailyFreeCredits(env: Env, userId: string): Promise<DailyClaimResult | null> {
  if (!env.DB) return null; // local/dev in-memory wallet has no persistent streak concept
  const db = drizzle(env.DB);
  const now = Date.now();
  const today = utcDateString(now);
  const yesterday = utcDateString(now - 86_400_000);
  const nextStreak = sql`CASE WHEN ${creditAccounts.lastFreeClaimDate} = ${yesterday} THEN ${creditAccounts.streakDays} + 1 ELSE 1 END`;
  const grant = sql`CASE WHEN (${nextStreak}) % ${DAILY_STREAK_BONUS_EVERY_DAYS} = 0 THEN ${DAILY_FREE_CREDIT_STREAK_BONUS} ELSE ${DAILY_FREE_CREDIT_BASE} END`;
  // One conditional update prevents two concurrent wallet loads from both
  // claiming today's grant. SQLite evaluates expressions from the old row.
  const [claimed] = await db
    .update(creditAccounts)
    .set({
      balance: sql`${creditAccounts.balance} + (${grant})`,
      lastFreeClaimDate: today,
      streakDays: nextStreak,
      updatedAt: now,
    })
    .where(
      and(
        eq(creditAccounts.userId, userId),
        or(isNull(creditAccounts.lastFreeClaimDate), ne(creditAccounts.lastFreeClaimDate, today)),
      ),
    )
    .returning({ streakDays: creditAccounts.streakDays });
  if (claimed)
    return {
      claimed: true,
      granted:
        claimed.streakDays % DAILY_STREAK_BONUS_EVERY_DAYS === 0
          ? DAILY_FREE_CREDIT_STREAK_BONUS
          : DAILY_FREE_CREDIT_BASE,
      streakDays: claimed.streakDays,
    };
  const [account] = await db
    .select({ streakDays: creditAccounts.streakDays })
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userId))
    .limit(1);
  return account ? { claimed: false, granted: 0, streakDays: account.streakDays } : null;
}

async function getCreditWallet(env: Env, userId: string): Promise<CreditWallet> {
  const now = Date.now();
  if (!env.DB) {
    warnMissingD1Once();
    const wallet = localCreditWallets.get(userId) ?? { balance: 100, lifetimeSpent: 0 };
    localCreditWallets.set(userId, wallet);
    return {
      ...wallet,
      initialGrant: 100,
      persistent: false,
      history: [],
      dailyClaim: null,
      streakDays: 0,
    };
  }
  const db = drizzle(env.DB);
  await db
    .insert(creditAccounts)
    .values({ userId, balance: 100, lifetimeSpent: 0, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  const dailyClaim = await claimDailyFreeCredits(env, userId);
  const [account] = await db
    .select({
      balance: creditAccounts.balance,
      lifetimeSpent: creditAccounts.lifetimeSpent,
      streakDays: creditAccounts.streakDays,
    })
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userId))
    .limit(1);
  const historyRows = await db
    .select()
    .from(signalAnalyses)
    .where(eq(signalAnalyses.userId, userId))
    .orderBy(desc(signalAnalyses.createdAt))
    .limit(5);
  // History stores raw confidence, so apply the same current calibration as
  // the live result. Calibration can change as more signals resolve.
  const calibrationBuckets = await getConfidenceCalibration(env);
  return {
    balance: safeNumber(account?.balance, 100),
    lifetimeSpent: safeNumber(account?.lifetimeSpent),
    initialGrant: 100,
    persistent: true,
    dailyClaim,
    streakDays: safeNumber(account?.streakDays, 0),
    history: historyRows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      timeframe: row.timeframe as SignalTimeframe,
      creditCost: row.creditCost,
      direction: row.direction as SignalAnalysis["direction"],
      score: row.score,
      confidence: calibrateConfidence(row.confidence, calibrationBuckets).confidence,
      provider: row.provider,
      createdAt: new Date(row.createdAt).toISOString(),
    })),
  };
}

async function debitCredits(env: Env, userId: string, cost: number) {
  if (!env.DB) {
    warnMissingD1Once();
    const wallet = localCreditWallets.get(userId) ?? { balance: 100, lifetimeSpent: 0 };
    if (wallet.balance < cost) return null;
    wallet.balance -= cost;
    wallet.lifetimeSpent += cost;
    localCreditWallets.set(userId, wallet);
    return wallet.balance;
  }
  const db = drizzle(env.DB);
  const now = Date.now();
  await db
    .insert(creditAccounts)
    .values({ userId, balance: 100, lifetimeSpent: 0, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  await claimDailyFreeCredits(env, userId);
  const [row] = await db
    .update(creditAccounts)
    .set({
      balance: sql`${creditAccounts.balance} - ${cost}`,
      lifetimeSpent: sql`${creditAccounts.lifetimeSpent} + ${cost}`,
      updatedAt: Date.now(),
    })
    .where(and(eq(creditAccounts.userId, userId), gte(creditAccounts.balance, cost)))
    .returning({ balance: creditAccounts.balance });
  return row ? row.balance : null;
}

async function refundCredits(env: Env, userId: string, cost: number) {
  if (!env.DB) {
    warnMissingD1Once();
    const wallet = localCreditWallets.get(userId);
    if (wallet) {
      wallet.balance += cost;
      wallet.lifetimeSpent = Math.max(0, wallet.lifetimeSpent - cost);
    }
    return;
  }
  const db = drizzle(env.DB);
  await db
    .update(creditAccounts)
    .set({
      balance: sql`${creditAccounts.balance} + ${cost}`,
      lifetimeSpent: sql`MAX(0, ${creditAccounts.lifetimeSpent} - ${cost})`,
      updatedAt: Date.now(),
    })
    .where(eq(creditAccounts.userId, userId));
}

async function saveSignalAnalysis(env: Env, userId: string, analysis: SignalAnalysis) {
  if (!env.DB) {
    warnMissingD1Once();
    return;
  }
  const db = drizzle(env.DB);
  // A cached reading may predate this caller. Tracking begins when this call
  // is saved, never against price action that happened before the request.
  const createdAt = Date.now();
  await db.insert(signalAnalyses).values({
    id: analysis.id,
    userId,
    symbol: analysis.symbol,
    timeframe: analysis.timeframe,
    creditCost: analysis.creditCost,
    // Calibration must learn from the raw formula, never its adjusted output.
    direction: analysis.direction,
    score: analysis.score,
    confidence: analysis.rawConfidence,
    provider: analysis.provider,
    createdAt,
    // Persist entry and risk levels for later candle-based grading.
    mark: analysis.mark,
    stopLoss: analysis.stopLoss,
    takeProfit: analysis.takeProfit,
    resolveAt: createdAt + timeframeSeconds[analysis.timeframe] * 1000,
    // Frozen or vetoed calls must not trigger watchlist alerts.
    actionable: analysis.actionable ? 1 : 0,
  });
}

// Persisted track record: grade actionable calls against later price history.

const RESOLUTION_KLINE_INTERVAL = "1m";
const RESOLUTION_KLINE_MS = 60_000;

async function fetchResolutionKlines(
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<Kline[]> {
  const pair = `${symbol}USDT`;
  const value = await fetchUnknownJson(
    binanceUrl(BINANCE_SPOT_API, "/api/v3/klines", {
      symbol: pair,
      interval: RESOLUTION_KLINE_INTERVAL,
      startTime,
      endTime,
      limit: 500,
    }),
  ).catch(() => null);
  let klines = resolutionWindow(parseKlines(value), startTime, endTime, RESOLUTION_KLINE_MS);
  if (klines.length < expectedResolutionBars(startTime, endTime, RESOLUTION_KLINE_MS)) {
    const bybitKlines = await getBybitKlines(pair, "1", 500, {
      start: startTime,
      end: endTime,
    }).catch(() => null);
    if (bybitKlines) {
      const fallback = resolutionWindow(bybitKlines, startTime, endTime, RESOLUTION_KLINE_MS);
      if (fallback.length > klines.length) klines = fallback;
    }
  }
  return klines;
}

async function resolveOneSignal(
  env: Env,
  row: {
    id: string;
    symbol: string;
    direction: string;
    mark: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    createdAt: number;
    resolveAt: number | null;
  },
) {
  if (row.mark == null || row.resolveAt == null) return; // legacy rows have no entry/horizon
  if (row.direction !== "LONG" && row.direction !== "SHORT") return; // NEUTRAL calls were never a trade to grade
  const now = Date.now();
  const endTime = Math.min(now, row.resolveAt);
  const klines = await fetchResolutionKlines(row.symbol, row.createdAt, endTime).catch(() => []);
  if (!klines.length) return; // no data yet, or a fetch hiccup — try again on a later pass
  // A partial/truncated response cannot determine the timeout outcome. Wait
  // for a later pass rather than treating an early close as the horizon close.
  const hasDeadlineCoverage =
    klines.length === expectedResolutionBars(row.createdAt, row.resolveAt, RESOLUTION_KLINE_MS);
  const outcome = evaluateSignalOutcome(
    row.direction as "LONG" | "SHORT",
    row.mark,
    row.stopLoss,
    row.takeProfit,
    klines,
    now >= row.resolveAt && hasDeadlineCoverage,
  );
  if (!outcome) return;
  const db = drizzle(env.DB);
  await db
    .update(signalAnalyses)
    .set({
      resolved: 1,
      hit: outcome.hit ? 1 : 0,
      resolvedAt: now,
      resolvedPrice: outcome.resolvedPrice,
      resolutionReason: outcome.reason,
    })
    .where(and(eq(signalAnalyses.id, row.id), eq(signalAnalyses.resolved, 0)));
}

// Called opportunistically on real traffic (no cron trigger needed). Grabs a
// small batch of the oldest still-unresolved signals — some may already be
// past their deadline (get finalized now), others may just be checked early
// for a take-profit/stop-loss touch and left pending if neither has hit yet.
async function resolveDueSignals(env: Env, limit = 12) {
  if (!env.DB) return;
  try {
    const db = drizzle(env.DB);
    const pending = await db
      .select({
        id: signalAnalyses.id,
        symbol: signalAnalyses.symbol,
        direction: signalAnalyses.direction,
        mark: signalAnalyses.mark,
        stopLoss: signalAnalyses.stopLoss,
        takeProfit: signalAnalyses.takeProfit,
        createdAt: signalAnalyses.createdAt,
        resolveAt: signalAnalyses.resolveAt,
      })
      .from(signalAnalyses)
      .where(
        and(
          eq(signalAnalyses.resolved, 0),
          eq(signalAnalyses.actionable, 1),
          isNotNull(signalAnalyses.mark),
          isNotNull(signalAnalyses.resolveAt),
          or(eq(signalAnalyses.direction, "LONG"), eq(signalAnalyses.direction, "SHORT")),
        ),
      )
      .orderBy(signalAnalyses.createdAt)
      .limit(limit);
    await Promise.all(
      pending.map((row) =>
        resolveOneSignal(env, row).catch((error) =>
          console.error(
            "signal-resolution-failed",
            row.id,
            error instanceof Error ? error.message : "unknown error",
          ),
        ),
      ),
    );
  } catch (error) {
    console.error(
      "signal-resolution-batch-failed",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

// Watchlist alerts use the latest persisted call per symbol and cost no credits.
// Symbols with no history return an unavailable direction.
async function getWatchlistStatuses(env: Env, symbols: string[]): Promise<WatchlistStatus[]> {
  const empty = (symbol: string): WatchlistStatus => ({
    symbol,
    direction: null,
    actionable: false,
    timeframe: null,
    updatedAt: null,
    ageMinutes: null,
  });
  if (!env.DB) return symbols.map(empty);
  const db = drizzle(env.DB);
  const results: WatchlistStatus[] = [];
  for (const symbol of symbols) {
    try {
      const [row] = await db
        .select({
          direction: signalAnalyses.direction,
          timeframe: signalAnalyses.timeframe,
          createdAt: signalAnalyses.createdAt,
          actionable: signalAnalyses.actionable,
        })
        .from(signalAnalyses)
        .where(eq(signalAnalyses.symbol, symbol))
        .orderBy(desc(signalAnalyses.createdAt))
        .limit(1);
      if (!row) {
        results.push(empty(symbol));
        continue;
      }
      results.push({
        symbol,
        direction: row.direction as SignalAnalysis["direction"],
        actionable: row.actionable === 1,
        timeframe: row.timeframe,
        updatedAt: new Date(row.createdAt).toISOString(),
        ageMinutes: Math.round((Date.now() - row.createdAt) / 60000),
      });
    } catch (error) {
      console.error(
        "watchlist-status-failed",
        symbol,
        error instanceof Error ? error.message : "unknown error",
      );
      results.push(empty(symbol));
    }
  }
  return results;
}

async function getPublicTrackRecord(
  env: Env,
  symbol: string | null,
  timeframe: string | null,
): Promise<PublicTrackRecord> {
  if (!env.DB)
    return { available: false, hitRatePct: null, sampleSize: 0, windowDays: 30, symbol, timeframe };
  const db = drizzle(env.DB);
  const windowDays = 30;
  const sinceTs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const conditions = [
    eq(signalAnalyses.resolved, 1),
    eq(signalAnalyses.actionable, 1),
    isNotNull(signalAnalyses.hit),
    gte(signalAnalyses.createdAt, sinceTs),
  ];
  if (symbol) conditions.push(eq(signalAnalyses.symbol, symbol));
  if (timeframe) conditions.push(eq(signalAnalyses.timeframe, timeframe));
  const [row] = await db
    .select({ total: sql<number>`COUNT(*)`, hits: sql<number>`SUM(${signalAnalyses.hit})` })
    .from(signalAnalyses)
    .where(and(...conditions));
  const total = safeNumber(row?.total, 0);
  const hits = safeNumber(row?.hits, 0);
  return {
    available: true,
    hitRatePct: total > 0 ? Math.round((hits / total) * 1000) / 10 : null,
    sampleSize: total,
    windowDays,
    symbol,
    timeframe,
  };
}

// Confidence is a formula, not a probability. Once a bucket has enough resolved
// calls, display its observed hit rate and retain the raw value for calibration.
type CalibrationBucket = {
  label: string;
  min: number;
  max: number;
  sampleSize: number;
  actualHitRatePct: number | null;
};

const CALIBRATION_BUCKET_DEFS: Array<{ label: string; min: number; max: number }> = [
  { label: "5-40", min: 0, max: 40 },
  { label: "40-60", min: 40, max: 60 },
  { label: "60-75", min: 60, max: 75 },
  { label: "75-90", min: 75, max: 90 },
  { label: "90-100", min: 90, max: 101 },
];
const CALIBRATION_MIN_SAMPLE = 10;
const CALIBRATION_CACHE_KEY = "confidence-calibration-v1";
const CALIBRATION_CACHE_TTL_MS = MARKET_REFRESH_MS;

async function computeCalibrationBuckets(env: Env): Promise<CalibrationBucket[]> {
  const empty = CALIBRATION_BUCKET_DEFS.map((bucket) => ({
    ...bucket,
    sampleSize: 0,
    actualHitRatePct: null as number | null,
  }));
  if (!env.DB) return empty;
  try {
    const db = drizzle(env.DB);
    const rows = await db
      .select({ confidence: signalAnalyses.confidence, hit: signalAnalyses.hit })
      .from(signalAnalyses)
      .where(
        and(
          eq(signalAnalyses.resolved, 1),
          eq(signalAnalyses.actionable, 1),
          isNotNull(signalAnalyses.hit),
        ),
      );
    return CALIBRATION_BUCKET_DEFS.map((bucket) => {
      const inBucket = rows.filter(
        (row) => row.confidence >= bucket.min && row.confidence < bucket.max,
      );
      const hits = inBucket.filter((row) => row.hit === 1).length;
      return {
        ...bucket,
        sampleSize: inBucket.length,
        actualHitRatePct:
          inBucket.length > 0 ? Math.round((hits / inBucket.length) * 1000) / 10 : null,
      };
    });
  } catch (error) {
    console.error(
      "calibration-compute-failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return empty;
  }
}

async function getConfidenceCalibration(env: Env): Promise<CalibrationBucket[]> {
  const cached = await readKvCache<CalibrationBucket[]>(env, CALIBRATION_CACHE_KEY);
  if (cached) return cached;
  const buckets = await computeCalibrationBuckets(env);
  await writeKvCache(env, CALIBRATION_CACHE_KEY, buckets, CALIBRATION_CACHE_TTL_MS);
  return buckets;
}

type ConfidenceCalibrationResult = {
  confidence: number;
  rawConfidence: number;
  calibrated: boolean;
  bucketLabel: string | null;
};

// Below the minimum sample size a bucket is left uncalibrated — not enough
// resolved evidence yet to override the formula's own number.
function calibrateConfidence(
  rawConfidence: number,
  buckets: CalibrationBucket[],
): ConfidenceCalibrationResult {
  const bucket =
    buckets.find((b) => rawConfidence >= b.min && rawConfidence < b.max) ?? buckets.at(-1) ?? null;
  if (!bucket || bucket.sampleSize < CALIBRATION_MIN_SAMPLE || bucket.actualHitRatePct == null) {
    return {
      confidence: rawConfidence,
      rawConfidence,
      calibrated: false,
      bucketLabel: bucket?.label ?? null,
    };
  }
  return {
    confidence: Math.round(bucket.actualHitRatePct),
    rawConfidence,
    calibrated: true,
    bucketLabel: bucket.label,
  };
}

// --- Derivatives fallback (Binance Futures is primary; Bybit covers the gap
// when Binance is geo-blocked, rate-limited, or otherwise unreachable) ---
async function getBybitFundingSnapshot(pair: string) {
  const value = (await fetchUnknownJson(
    `${BYBIT_API}/v5/market/tickers?category=linear&symbol=${pair}`,
  )) as {
    result?: { list?: Array<Record<string, unknown>> };
  };
  const row = value.result?.list?.[0];
  if (!row) throw new Error("Bybit returned no futures ticker data");
  const fundingRate = finiteNumberOrNull(row.fundingRate);
  const markPrice = finiteNumberOrNull(row.markPrice);
  if (fundingRate == null || markPrice == null || markPrice <= 0)
    throw new Error("Bybit returned invalid futures ticker data");
  return { fundingPct: fundingRate * 100, markPrice };
}

async function getBybitOpenInterestChange(pair: string) {
  const value = (await fetchUnknownJson(
    `${BYBIT_API}/v5/market/open-interest?category=linear&symbol=${pair}&intervalTime=1h&limit=24`,
  )) as {
    result?: { list?: Array<Record<string, unknown>> };
  };
  const rows = (value.result?.list ?? [])
    .slice()
    .sort((left, right) => safeNumber(left.timestamp) - safeNumber(right.timestamp));
  if (rows.length < 2) throw new Error("Bybit returned insufficient open interest history");
  const start = finiteNumberOrNull(rows[0]?.openInterest);
  const end = finiteNumberOrNull(rows.at(-1)?.openInterest);
  if (start == null || end == null || start <= 0 || end <= 0)
    throw new Error("Bybit returned invalid open interest history");
  return ((end - start) / start) * 100;
}

async function getBybitLongShortRatio(pair: string) {
  const value = (await fetchUnknownJson(
    `${BYBIT_API}/v5/market/account-ratio?category=linear&symbol=${pair}&period=5min&limit=1`,
  )) as {
    result?: { list?: Array<Record<string, unknown>> };
  };
  const row = value.result?.list?.[0];
  if (!row) throw new Error("Bybit returned no long/short ratio");
  const longRatio = finiteNumberOrNull(row.buyRatio);
  const shortRatio = finiteNumberOrNull(row.sellRatio);
  if (
    longRatio == null ||
    shortRatio == null ||
    longRatio < 0 ||
    longRatio > 1 ||
    shortRatio < 0 ||
    shortRatio > 1
  )
    throw new Error("Bybit returned invalid long/short ratio");
  return { longPct: longRatio * 100, shortPct: shortRatio * 100 };
}

async function getBybitOrderBook(pair: string) {
  const value = (await fetchUnknownJson(
    `${BYBIT_API}/v5/market/orderbook?category=spot&symbol=${pair}&limit=10`,
  )) as {
    result?: { b?: unknown[][]; a?: unknown[][] };
  };
  const bids = value.result?.b ?? [];
  const asks = value.result?.a ?? [];
  if (!bids.length && !asks.length) throw new Error("Bybit returned no order book data");
  return { bids, asks };
}

async function getBybitSpotPrice(pair: string) {
  const value = (await fetchUnknownJson(
    `${BYBIT_API}/v5/market/tickers?category=spot&symbol=${pair}`,
  )) as {
    result?: { list?: Array<Record<string, unknown>> };
  };
  const row = value.result?.list?.[0];
  if (!row) throw new Error("Bybit returned no spot ticker");
  const price = finiteNumberOrNull(row.lastPrice);
  if (price == null || price <= 0) throw new Error("Bybit returned an invalid spot price");
  return price;
}

async function getBybitKlines(
  pair: string,
  interval: string,
  limit: number,
  window?: { start: number; end: number },
): Promise<Kline[]> {
  const requestUrl = binanceUrl(BYBIT_API, "/v5/market/kline", {
    category: "spot",
    symbol: pair,
    interval,
    limit,
    ...(window ?? {}),
  });
  const value = (await fetchUnknownJson(requestUrl)) as {
    result?: { list?: unknown[][] };
  };
  const rows = value.result?.list ?? [];
  if (!rows.length) throw new Error("Bybit returned no kline data");
  // Bybit returns newest-first: [start, open, high, low, close, volume, turnover]
  return normalizeKlines(rows, 6);
}

async function getCoinbaseSignalKlines(
  id: string,
  timeframe: SignalTimeframe,
  now = Date.now(),
): Promise<Kline[]> {
  const product = coinbaseProductsById[id];
  if (!product) throw new Error("Unsupported Coinbase signal market");
  const period = timeframeSeconds[timeframe];
  const basePeriod = timeframe === "30m" ? 900 : timeframe === "3h" ? 3_600 : period;
  const end = Math.floor(now / 1_000);
  const start = Math.floor((end - period * 202) / basePeriod) * basePeriod;
  const raw: unknown[][] = [];
  for (let cursor = start; cursor < end; cursor += basePeriod * 299) {
    const chunk = await fetchUnknownJson(
      binanceUrl(COINBASE_EXCHANGE_API, `/products/${product}/candles`, {
        start: new Date(cursor * 1_000).toISOString(),
        end: new Date(Math.min(end, cursor + basePeriod * 299) * 1_000).toISOString(),
        granularity: basePeriod,
      }),
    );
    if (Array.isArray(chunk)) raw.push(...chunk.filter(Array.isArray));
  }
  // Coinbase: [time seconds, low, high, open, close, base volume]. The
  // quote-volume estimate is not used for the exchange-volume comparison.
  const normalized = normalizeKlines(
    raw.map((row) => [safeNumber(row[0]) * 1_000, row[3], row[2], row[1], row[4], row[5], 0, 0]),
  );
  return aggregateKlines(normalized, period * 1_000, basePeriod * 1_000, now);
}

async function getCoinbaseDailyKlines(id: string, now = Date.now()): Promise<Kline[]> {
  const product = coinbaseProductsById[id];
  if (!product) throw new Error("Unsupported Coinbase daily market");
  const value = await fetchUnknownJson(
    binanceUrl(COINBASE_EXCHANGE_API, `/products/${product}/candles`, {
      start: new Date(now - 3 * 86_400_000).toISOString(),
      end: new Date(now).toISOString(),
      granularity: 86_400,
    }),
  );
  if (!Array.isArray(value)) return [];
  return normalizeKlines(
    value
      .filter(Array.isArray)
      .map((row) => [safeNumber(row[0]) * 1_000, row[3], row[2], row[1], row[4], row[5], 0, 0]),
  );
}

async function buildSignalAnalysis(
  env: Env,
  symbol: string,
  timeframe: SignalTimeframe,
  balance: number,
): Promise<SignalAnalysis> {
  const pair = `${symbol}USDT`;
  const interval = binanceIntervals[timeframe];
  const coinId = signalCoinIds[symbol];
  const candleLimit = timeframe === "3h" ? 606 : 200;
  const prepareCandles = (candles: Kline[]) =>
    aggregateKlines(
      candles,
      timeframeSeconds[timeframe] * 1_000,
      (timeframe === "3h" ? 3_600 : timeframeSeconds[timeframe]) * 1_000,
    );
  const [
    klinesValue,
    dailyValue,
    tickerValue,
    volumeKlinesValue,
    shortHistory,
    weekHistory,
    marketSnapshot,
    fundingResult,
    oiResult,
    ratioResult,
    depthResult,
    stablecoinResult,
    headlines,
  ] = await Promise.all([
    fetchUnknownJson(
      binanceUrl(BINANCE_SPOT_API, "/api/v3/klines", {
        symbol: pair,
        interval,
        limit: candleLimit,
      }),
    ).catch(() => null),
    fetchUnknownJson(
      binanceUrl(BINANCE_SPOT_API, "/api/v3/klines", { symbol: pair, interval: "1d", limit: 2 }),
    ).catch(() => null),
    fetchUnknownJson(binanceUrl(BINANCE_SPOT_API, "/api/v3/ticker/24hr", { symbol: pair })).catch(
      () => null,
    ),
    fetchUnknownJson(
      binanceUrl(BINANCE_SPOT_API, "/api/v3/klines", { symbol: pair, interval: "1h", limit: 48 }),
    ).catch(() => null),
    getMarketHistory(historyRequestUrl(coinId, "1D")).catch(() => null),
    getMarketHistory(historyRequestUrl(coinId, "1W")).catch(() => null),
    getMarketSnapshot(env).catch(() => null),
    fetchUnknownJson(
      binanceUrl(BINANCE_FUTURES_API, "/fapi/v1/premiumIndex", { symbol: pair }),
    ).catch(() => null),
    fetchUnknownJson(
      binanceUrl(BINANCE_FUTURES_API, "/futures/data/openInterestHist", {
        symbol: pair,
        period: "1h",
        limit: 24,
      }),
    ).catch(() => null),
    fetchUnknownJson(
      binanceUrl(BINANCE_FUTURES_API, "/futures/data/globalLongShortAccountRatio", {
        symbol: pair,
        period: "5m",
        limit: 1,
      }),
    ).catch(() => null),
    fetchUnknownJson(
      binanceUrl(BINANCE_SPOT_API, "/api/v3/depth", { symbol: pair, limit: 10 }),
    ).catch(() => null),
    fetchUnknownJson(
      binanceUrl(BINANCE_SPOT_API, "/api/v3/ticker/price", { symbol: "USDCUSDT" }),
    ).catch(() => null),
    getRelevantHeadlines(symbol),
  ]);
  const binanceKlines = prepareCandles(parseKlines(klinesValue));
  let klines = binanceKlines;
  let klinesSource = "Binance Spot";
  if (klines.length < 55) {
    const bybitKlines = await getBybitKlines(pair, bybitIntervals[timeframe], candleLimit)
      .then(prepareCandles)
      .catch((error) => {
        console.error(
          "bybit-klines-fallback-failed",
          pair,
          error instanceof Error ? error.message : "unknown error",
        );
        return null;
      });
    if (bybitKlines && bybitKlines.length >= 55) {
      klines = bybitKlines;
      klinesSource = "Bybit";
    }
  }
  if (klines.length < 55) {
    const coinbaseKlines = await getCoinbaseSignalKlines(coinId, timeframe).catch((error) => {
      console.error(
        "coinbase-signal-klines-fallback-failed",
        symbol,
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    });
    if (coinbaseKlines && coinbaseKlines.length >= 55) {
      klines = coinbaseKlines;
      klinesSource = "Coinbase Exchange (USD candles)";
    }
  }
  const shortGroup = timeframe === "15m" ? 3 : timeframe === "30m" ? 6 : 12;
  const weekGroup = timeframe === "3h" ? 3 : timeframe === "6h" ? 6 : 1;
  const fallbackKlines =
    timeframe === "15m" || timeframe === "30m"
      ? marketHistoryKlines(shortHistory, shortGroup)
      : marketHistoryKlines(weekHistory, weekGroup);
  if (klines.length < 55) {
    klines = fallbackKlines;
    klinesSource = `${String(((timeframe === "15m" || timeframe === "30m" ? shortHistory : weekHistory) as Record<string, unknown> | null)?.source ?? "Live Historical Feed")} (price-sample estimates)`;
  }
  recordSourceUsage("signal-klines", klinesSource === "Binance Spot" ? "primary" : "fallback");
  let binanceDaily = parseKlines(dailyValue);
  if (binanceDaily.length < 2) {
    const bybitDaily = await getBybitKlines(pair, "D", 2).catch((error) => {
      console.error(
        "bybit-daily-klines-fallback-failed",
        pair,
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    });
    if (bybitDaily && bybitDaily.length >= 2) binanceDaily = bybitDaily;
  }
  if (binanceDaily.length < 2) binanceDaily = await getCoinbaseDailyKlines(coinId).catch(() => []);
  const daily = binanceDaily;
  if (klines.length < 55)
    throw new Error("Insufficient candle history for a stable EMA50 on this market");
  const closes = klines.map((candle) => candle.close);
  const snapshotAssets = ((marketSnapshot as Record<string, unknown> | null)?.assets ??
    []) as Array<Record<string, unknown>>;
  const marketAsset = snapshotAssets.find((asset) => String(asset.symbol) === symbol);
  const ticker = tickerValue as Record<string, unknown> | null;
  const mark = safeNumber(ticker?.lastPrice, safeNumber(marketAsset?.currentPrice, closes.at(-1)));
  if (mark <= 0) throw new Error("No valid current market price");
  const ema20 = ema(closes, 20).at(-1) ?? mark;
  const ema50 = ema(closes, 50).at(-1) ?? mark;
  const currentRsi = rsi(closes);
  const histogram = macdHistogram(closes);
  const percentB = bollingerPercentB(closes);
  const trendScore = ema20 >= ema50 ? 48 : -48;
  const technicalScore = Math.round(
    clamp(trendScore + (currentRsi - 50) * 0.65 + Math.sign(histogram) * 8 + (percentB - 0.5) * 12),
  );
  const currentAtr = atr(klines);
  const regime = computeMarketRegime(closes, currentAtr, mark);
  const chartPatterns = detectChartPatterns(klines);
  const historicalReplay = historicalTrendReplay(closes);
  let volumeKlines = parseKlines(volumeKlinesValue);
  if (volumeKlines.length < 48) {
    const bybitVolumeKlines = await getBybitKlines(pair, "60", 48).catch((error) => {
      console.error(
        "bybit-volume-klines-fallback-failed",
        pair,
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    });
    if (bybitVolumeKlines && bybitVolumeKlines.length >= 48) volumeKlines = bybitVolumeKlines;
  }
  const latestVolume =
    volumeKlines.length >= 48
      ? volumeKlines.slice(-24).reduce((sum, candle) => sum + candle.quoteVolume, 0)
      : 0;
  const previousVolume =
    volumeKlines.length >= 48
      ? volumeKlines.slice(-48, -24).reduce((sum, candle) => sum + candle.quoteVolume, 0)
      : 0;
  const volume24h =
    latestVolume ||
    safeNumber(
      ticker?.quoteVolume,
      safeNumber(
        marketAsset?.totalVolume,
        klines.slice(-24).reduce((sum, candle) => sum + candle.quoteVolume, 0),
      ),
    );
  const volumeChangePct =
    latestVolume && previousVolume
      ? ((latestVolume - previousVolume) / previousVolume) * 100
      : null;

  const funding = fundingResult as Record<string, unknown> | null;
  const oiRows = Array.isArray(oiResult) ? (oiResult as Array<Record<string, unknown>>) : [];
  const ratios = Array.isArray(ratioResult) ? (ratioResult as Array<Record<string, unknown>>) : [];
  // OI spans 24 hours; compare it with the same price horizon instead of
  // the entire 200-candle window (which changes drastically by timeframe).
  const price24hAgo = historicalPrice(
    klines.map((candle) => [candle.time, candle.close]),
    Date.now() - 86_400_000,
  );
  const priceChange =
    finiteNumberOrNull(ticker?.priceChangePercent) ??
    finiteNumberOrNull(marketAsset?.change24h) ??
    percentChange(mark, price24hAgo);
  const oiStart = safeNumber(oiRows[0]?.sumOpenInterest);
  const oiEnd = safeNumber(oiRows.at(-1)?.sumOpenInterest);
  let oiChangePct =
    oiRows.length >= 2 && oiStart > 0 && oiEnd > 0 ? ((oiEnd - oiStart) / oiStart) * 100 : null;
  const fundingRate = finiteNumberOrNull(funding?.lastFundingRate);
  const futuresMark = finiteNumberOrNull(funding?.markPrice);
  let fundingPct = fundingRate == null ? null : fundingRate * 100;
  let basisPct =
    futuresMark != null && futuresMark > 0 ? ((futuresMark - mark) / mark) * 100 : null;
  const longRatio = finiteNumberOrNull(ratios[0]?.longAccount);
  const shortRatio = finiteNumberOrNull(ratios[0]?.shortAccount);
  let longPct = longRatio != null && longRatio >= 0 && longRatio <= 1 ? longRatio * 100 : null;
  let shortPct = shortRatio != null && shortRatio >= 0 && shortRatio <= 1 ? shortRatio * 100 : null;
  const derivativesSources = new Set<string>();
  if (fundingPct != null || oiChangePct != null) derivativesSources.add("Binance Futures");

  // Binance Futures is geo-restricted for some Cloudflare Worker edge locations,
  // so fall back to Bybit's public linear-perpetual endpoints (no auth required)
  // whenever the primary funding rate or open-interest change is missing.
  if (fundingPct == null || oiChangePct == null) {
    const [bybitFunding, bybitOiChange] = await Promise.all([
      fundingPct == null
        ? getBybitFundingSnapshot(pair).catch((error) => {
            console.error(
              "bybit-funding-fallback-failed",
              pair,
              error instanceof Error ? error.message : "unknown error",
            );
            return null;
          })
        : null,
      oiChangePct == null
        ? getBybitOpenInterestChange(pair).catch((error) => {
            console.error(
              "bybit-oi-fallback-failed",
              pair,
              error instanceof Error ? error.message : "unknown error",
            );
            return null;
          })
        : null,
    ]);
    if (fundingPct == null && bybitFunding) {
      fundingPct = bybitFunding.fundingPct;
      basisPct = ((bybitFunding.markPrice - mark) / mark) * 100;
      derivativesSources.add("Bybit");
    }
    if (oiChangePct == null && bybitOiChange != null) {
      oiChangePct = bybitOiChange;
      derivativesSources.add("Bybit");
    }
  }
  if (longPct == null || shortPct == null) {
    const bybitRatio = await getBybitLongShortRatio(pair).catch((error) => {
      console.error(
        "bybit-ratio-fallback-failed",
        pair,
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    });
    if (bybitRatio) {
      longPct = bybitRatio.longPct;
      shortPct = bybitRatio.shortPct;
      derivativesSources.add("Bybit");
    }
  }
  if (fundingPct == null && oiChangePct == null) recordSourceUsage("signal-derivatives", "failure");
  else
    recordSourceUsage(
      "signal-derivatives",
      derivativesSources.has("Bybit") ? "fallback" : "primary",
    );

  let derivativesScore: number | null = null;
  let derivativesNote = "Futures data is unavailable for this market; weights were normalized.";
  if (oiChangePct != null && fundingPct != null) {
    if (priceChange > 0 && oiChangePct > 0) {
      derivativesScore = 60;
      derivativesNote =
        "Price and open interest are expanding together — fresh bullish participation.";
    } else if (priceChange > 0) {
      derivativesScore = 15;
      derivativesNote =
        "Price is rising while open interest contracts — squeeze-driven and less durable.";
    } else if (oiChangePct > 0) {
      derivativesScore = -60;
      derivativesNote = "Open interest is expanding into falling price — new bearish positioning.";
    } else {
      derivativesScore = -15;
      derivativesNote =
        "Price and open interest are contracting — selling pressure may be exhausting.";
    }
    if (fundingPct > 0.05) {
      derivativesScore -= 25;
      derivativesNote += " Long funding is overheated.";
    }
    if (fundingPct < -0.05) {
      derivativesScore += 25;
      derivativesNote += " Short funding is crowded.";
    }
    derivativesScore = Math.round(clamp(derivativesScore));
  }

  const headlineBlock = headlines.length
    ? headlines.map((item, index) => `${index + 1}. [${item.source}] ${item.title}`).join("\n")
    : "No asset-specific headlines were returned by the monitored feeds.";
  const regimeGuidance =
    regime.regime === "choppy"
      ? "This market is currently CHOPPY/RANGING (low directional efficiency) — be conservative. Do not assign high confidence to a directional call unless the news and derivatives layers both independently confirm it; prefer Neutral in ambiguous cases."
      : "This market is currently TRENDING (high directional efficiency) — a directional call is more justifiable here, but confidence should still reflect the strength of agreement across channels, not just the trend.";
  const prompt = `Analyze ${symbol}/USDT for the ${timeframe} horizon.\nLive metrics: mark ${mark}; technical score ${technicalScore}/100; RSI ${currentRsi.toFixed(1)}; EMA20 ${ema20}; EMA50 ${ema50}; MACD histogram ${histogram}; Bollinger %B ${percentB.toFixed(3)}; 24h quote volume ${volume24h}; volume change ${volumeChangePct ?? "unavailable"}%; derivatives score ${derivativesScore ?? "unavailable"}; funding ${fundingPct ?? "unavailable"}%; open-interest change ${oiChangePct ?? "unavailable"}%; market change over sampled candles ${priceChange.toFixed(2)}%.\nMarket regime: ${regime.regime} (efficiency ratio ${regime.efficiencyRatio}, 0=chop/1=clean trend); volatility: ${regime.volatilityLevel} (ATR ${regime.atrPct}% of price). ${regimeGuidance}\nRecent monitored headlines:\n${headlineBlock}\nReturn exactly this JSON shape: {"sentiment":"Bullish|Bearish|Neutral","confidence":0,"impact":1,"summary":"2 concise sentences","bullets":["fact","fact","fact"],"catalyst":"one confirmation trigger","invalidation":"one invalidation trigger"}. Confidence is 0-100 and impact is 1-9. Distinguish facts from inference.`;
  const ai = await getAIReading(env, prompt, technicalScore, derivativesScore, regime);
  const newsSign = ai.sentiment === "Bullish" ? 1 : ai.sentiment === "Bearish" ? -1 : 0;
  // The deterministic fallback summarizes existing technical evidence. It
  // is not independent news confirmation and must not be counted twice.
  const newsScore =
    ai.provider === "Deterministic fallback"
      ? null
      : Math.round(clamp(newsSign * ai.confidence * (ai.impact / 9)));
  const weighted = [
    { weight: 0.3, score: technicalScore },
    ...(derivativesScore == null ? [] : [{ weight: 0.3, score: derivativesScore }]),
    ...(newsScore == null ? [] : [{ weight: 0.4, score: newsScore }]),
  ];
  const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round(
    clamp(weighted.reduce((sum, item) => sum + item.weight * item.score, 0) / weightTotal),
  );
  let direction: SignalAnalysis["direction"] =
    score > 12 ? "LONG" : score < -12 ? "SHORT" : "NEUTRAL";

  const previous = daily.at(-2) ?? daily[0];
  const pivot = previous ? (previous.high + previous.low + previous.close) / 3 : null;
  const resistance = previous && pivot != null ? 2 * pivot - previous.low : null;
  const support = previous && pivot != null ? 2 * pivot - previous.high : null;
  const depth = depthResult as { bids?: unknown[]; asks?: unknown[] } | null;
  let bids = Array.isArray(depth?.bids) ? (depth.bids as unknown[][]) : [];
  let asks = Array.isArray(depth?.asks) ? (depth.asks as unknown[][]) : [];
  if (!bids.length && !asks.length) {
    const bybitBook = await getBybitOrderBook(pair).catch((error) => {
      console.error(
        "bybit-orderbook-fallback-failed",
        pair,
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    });
    if (bybitBook) {
      bids = bybitBook.bids as unknown[][];
      asks = bybitBook.asks as unknown[][];
      recordSourceUsage("signal-orderbook", "fallback");
    } else recordSourceUsage("signal-orderbook", "failure");
  } else recordSourceUsage("signal-orderbook", "primary");
  const bidDepth = bids.reduce((sum, row) => sum + safeNumber(row[1]), 0);
  const askDepth = asks.reduce((sum, row) => sum + safeNumber(row[1]), 0);
  const orderBookImbalance = bidDepth + askDepth ? bidDepth / (bidDepth + askDepth) : null;
  const bestBid = safeNumber(bids[0]?.[0]);
  const bestAsk = safeNumber(asks[0]?.[0]);
  const spreadPct =
    bestBid && bestAsk ? ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100 : null;
  const usdcAsset = snapshotAssets.find((asset) => String(asset.symbol) === "USDC");
  let stablecoinPrice =
    finiteNumberOrNull((stablecoinResult as Record<string, unknown> | null)?.price) ??
    finiteNumberOrNull(usdcAsset?.currentPrice);
  if (stablecoinPrice == null) {
    stablecoinPrice = await getBybitSpotPrice("USDCUSDT").catch((error) => {
      console.error(
        "bybit-stablecoin-fallback-failed",
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    });
    recordSourceUsage("signal-stablecoin", stablecoinPrice == null ? "failure" : "fallback");
  } else recordSourceUsage("signal-stablecoin", "primary");
  const { stopLoss, takeProfit, rewardRisk, riskVeto } = directionalRiskPlan(
    direction,
    mark,
    currentAtr,
    support,
    resistance,
  );
  const safetyReasons: string[] = [];
  if (stablecoinPrice != null && Math.abs(stablecoinPrice - 1) > 0.015)
    safetyReasons.push(`USDC peg deviation ${(Math.abs(stablecoinPrice - 1) * 100).toFixed(2)}%`);
  if (spreadPct != null && spreadPct > 0.25)
    safetyReasons.push(`Wide order-book spread ${spreadPct.toFixed(2)}%`);
  const frozen = safetyReasons.length > 0;
  if (frozen || riskVeto) direction = "NEUTRAL";
  const actionable = direction !== "NEUTRAL" && !frozen && !riskVeto;
  const confidence = Math.round(clamp(50 + Math.abs(score) / 2, 5, 95));
  const calibrationBuckets = await getConfidenceCalibration(env);
  const calibration = calibrateConfidence(confidence, calibrationBuckets);
  const period = timeframeSeconds[timeframe];
  const updatedAt = new Date().toISOString();
  const thesis = frozen
    ? `Safety freeze: ${safetyReasons.join("; ")}. No new position is recommended until the condition normalizes.`
    : riskVeto
      ? rewardRisk == null
        ? `The channels lean ${score > 0 ? "bullish" : "bearish"}, but no valid directional target and stop are available. Wait for a confirmed setup.`
        : `The channels lean ${score > 0 ? "bullish" : "bearish"}, but the ATR-based reward/risk is ${rewardRisk.toFixed(2)}:1, below the required 2:1.`
      : direction === "NEUTRAL"
        ? `${symbol} has mixed channel readings. Wait for stronger Technical, Derivatives and News convergence.`
        : `${direction} bias for ${symbol}: Technical ${technicalScore > 0 ? "+" : ""}${technicalScore}, Derivatives ${derivativesScore == null ? "N/A" : `${derivativesScore > 0 ? "+" : ""}${derivativesScore}`}, News ${newsScore == null ? "N/A" : `${newsScore > 0 ? "+" : ""}${newsScore}`}. ${ai.summary}`;

  return {
    id: crypto.randomUUID(),
    symbol,
    timeframe,
    creditCost: SIGNAL_TIMEFRAMES[timeframe].creditCost,
    updatedAt,
    provider: ai.provider,
    direction,
    actionable,
    score,
    confidence: calibration.confidence,
    rawConfidence: calibration.rawConfidence,
    confidenceCalibrated: calibration.calibrated,
    buyPct: Math.round(clamp(50 + score / 2, 5, 95)),
    sellPct: Math.round(clamp(50 - score / 2, 5, 95)),
    mark,
    support,
    resistance,
    stopLoss,
    takeProfit,
    countdownSeconds: period - (Math.floor(Date.now() / 1000) % period),
    technical: {
      score: technicalScore,
      rsi: currentRsi,
      ema20,
      ema50,
      macdHistogram: histogram,
      bollingerPercentB: percentB,
      atr: currentAtr,
      volume24h,
      volumeChangePct,
      regime: regime.regime,
      efficiencyRatio: regime.efficiencyRatio,
      volatilityLevel: regime.volatilityLevel,
    },
    derivatives: {
      score: derivativesScore,
      fundingPct,
      oiChangePct,
      longPct,
      shortPct,
      basisPct,
      note: derivativesNote,
    },
    news: {
      score: newsScore,
      sentiment: ai.sentiment,
      confidence: ai.confidence,
      impact: ai.impact,
      summary: ai.summary,
      bullets: ai.bullets,
      catalyst: ai.catalyst,
      invalidation: ai.invalidation,
      headlines,
      ensemble: ai.ensemble,
    },
    safety: {
      frozen,
      reasons: safetyReasons,
      stablecoinPrice,
      spreadPct,
      orderBookImbalance,
      rewardRisk,
      riskVeto,
    },
    historicalReplay,
    chartPatterns,
    thesis,
    sources: [
      klinesSource,
      ...(derivativesScore == null ? [] : [...derivativesSources]),
      ...headlines
        .map((item) => item.source)
        .filter((source, index, values) => values.indexOf(source) === index),
      ai.provider,
    ],
    balance,
  };
}

const signalAnalysisCache = new Map<string, { expiresAt: number; value: SignalAnalysis }>();
const SIGNAL_ANALYSIS_CACHE_MS = 45_000;

// Share recent market readings, while each caller keeps a separate ID,
// credit debit and history entry.
async function getSignalAnalysis(
  env: Env,
  symbol: string,
  timeframe: SignalTimeframe,
  balance: number,
): Promise<SignalAnalysis> {
  const cacheKey = `${symbol}:${timeframe}`;
  const now = Date.now();
  const cached = signalAnalysisCache.get(cacheKey);
  const base =
    cached && cached.expiresAt > now
      ? cached.value
      : await buildSignalAnalysis(env, symbol, timeframe, balance);
  if (!cached || cached.expiresAt <= now) {
    signalAnalysisCache.set(cacheKey, { expiresAt: now + SIGNAL_ANALYSIS_CACHE_MS, value: base });
  }
  const period = timeframeSeconds[timeframe];
  return {
    ...base,
    id: crypto.randomUUID(),
    balance,
    countdownSeconds: period - (Math.floor(now / 1000) % period),
  };
}

function privateJsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

// Share cards carry public reading fields in the URL, without wallet or visitor IDs.
type SharePayload = {
  s: string;
  t: string;
  d: "LONG" | "SHORT" | "NEUTRAL";
  c: number;
  sc: number;
  th: string;
  at: string;
};

function decodeSharePayload(encoded: string): SharePayload | null {
  try {
    const parsed = decodeUtf8Base64Url(encoded) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return null;
    if (
      typeof parsed.s !== "string" ||
      !allowedSignalSymbols.has(parsed.s) ||
      typeof parsed.t !== "string" ||
      !hasOwnKey(SIGNAL_TIMEFRAMES, parsed.t) ||
      (parsed.d !== "LONG" && parsed.d !== "SHORT" && parsed.d !== "NEUTRAL") ||
      typeof parsed.c !== "number" ||
      !Number.isFinite(parsed.c) ||
      typeof parsed.sc !== "number" ||
      !Number.isFinite(parsed.sc) ||
      typeof parsed.th !== "string" ||
      typeof parsed.at !== "string" ||
      !Number.isFinite(Date.parse(parsed.at))
    )
      return null;
    return {
      s: parsed.s,
      t: parsed.t,
      d: parsed.d,
      c: clamp(parsed.c, 0, 100),
      sc: clamp(parsed.sc, -100, 100),
      th: parsed.th.slice(0, 280),
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

function renderSharePage(payload: SharePayload, origin: string): string {
  const directionColor =
    payload.d === "LONG" ? "#00efb5" : payload.d === "SHORT" ? "#ff5c5c" : "#9aa8c4";
  const title = `${payload.s} ${payload.t.toUpperCase()} — ${payload.d} bias (${payload.c}% confidence)`;
  const description =
    payload.th ||
    `Convergence score ${payload.sc > 0 ? "+" : ""}${payload.sc} on the ${payload.t.toUpperCase()} timeframe.`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeSymbol = escapeHtml(payload.s);
  const safeTimeframe = escapeHtml(payload.t.toUpperCase());
  const safeDirection = escapeHtml(payload.d);
  const safeDate = escapeHtml(new Date(payload.at).toUTCString());
  const safeOrigin = escapeHtml(origin);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<meta name="description" content="${safeDescription}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${safeTitle}" />
<meta property="og:description" content="${safeDescription}" />
<meta property="og:site_name" content="CryptoWorld" />
<link rel="icon" href="${safeOrigin}/cryptoworld-logo.png" type="image/png" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${safeTitle}" />
<meta name="twitter:description" content="${safeDescription}" />
<meta name="robots" content="noindex" />
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#04060f; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:24px; }
  .card { width:100%; max-width:420px; border-radius:14px; border:1px solid rgba(120,140,200,.25); background:linear-gradient(165deg, rgba(20,26,50,.9), rgba(6,9,20,.95)); padding:28px; color:#e7edf9; box-shadow:0 20px 60px rgba(0,0,0,.5); }
  .eyebrow { font:600 11px/1.4 monospace; letter-spacing:.12em; color:#7688a3; text-transform:uppercase; }
  h1 { font-size:26px; margin:8px 0 2px; }
  .dir { display:inline-block; margin:10px 0 16px; padding:6px 14px; border-radius:999px; font:800 13px monospace; letter-spacing:.06em; color:${directionColor}; border:1px solid ${directionColor}55; background:${directionColor}15; }
  .stats { display:flex; gap:18px; margin-bottom:16px; }
  .stats div span { display:block; font:600 10px monospace; color:#7688a3; letter-spacing:.05em; }
  .stats div b { font-size:18px; }
  p.thesis { color:#b8c5d8; font-size:13px; line-height:1.6; }
  .footer { margin-top:20px; padding-top:16px; border-top:1px solid rgba(120,140,200,.15); display:flex; justify-content:space-between; align-items:center; gap:12px; font:600 10px monospace; color:#5c6c88; }
  a.cta { color:#00eaff; text-decoration:none; font-weight:700; white-space:nowrap; }
</style>
</head>
<body>
  <div class="card">
    <div class="eyebrow">CryptoWorld · ${safeTimeframe}</div>
    <h1>${safeSymbol}/USDT</h1>
    <div class="dir">${safeDirection} BIAS · ${payload.c}% CONFIDENCE</div>
    <div class="stats">
      <div><span>CONVERGENCE</span><b>${payload.sc > 0 ? "+" : ""}${payload.sc}</b></div>
      <div><span>SHARED</span><b>${safeDate}</b></div>
    </div>
    ${payload.th ? `<p class="thesis">${safeDescription}</p>` : ""}
    <div class="footer"><span>Not financial advice — educational signal.</span><a class="cta" href="${safeOrigin}">Run your own →</a></div>
  </div>
</body>
</html>`;
}

function renderShareErrorPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Signal not found</title><meta name="robots" content="noindex" /></head><body style="background:#04060f;color:#e7edf9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><p>This shared signal link is invalid or has expired.</p></body></html>`;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    if (request.method === "GET" && url.pathname === "/api/market-data") {
      try {
        return jsonResponse(await getMarketSnapshot(env));
      } catch {
        return jsonResponse({ error: "Live market data is temporarily unavailable" }, 502);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/data-health") {
      const d1 = !env.DB
        ? { bound: false, reachable: false }
        : await env.DB.prepare("SELECT 1")
            .first()
            .then(() => ({ bound: true, reachable: true }))
            .catch((error: unknown) => {
              console.error(
                "d1-health-check-failed",
                error instanceof Error ? error.message : "unknown error",
              );
              return { bound: true, reachable: false, error: "Database health check failed" };
            });
      return privateJsonResponse({
        note: "In-memory counters for this isolate only — resets on cold start. primary = main source worked, fallback = a backup source had to be used, failure = every source failed.",
        since: dataSourceStatsStartedAt,
        d1: {
          ...d1,
          note: d1.bound
            ? undefined
            : "No D1 binding — credits, rate limits, and shared cache are memory-only and reset on every cold start.",
        },
        sources: dataHealthSnapshot(),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/macro-news") {
      try {
        return jsonResponse(await getMacroNews());
      } catch {
        return jsonResponse({ error: "Macro news is temporarily unavailable" }, 502);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/onchain-news") {
      try {
        return jsonResponse(await getOnChainNews());
      } catch {
        return jsonResponse({ error: "On-chain news is temporarily unavailable" }, 502);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/defi-protocols") {
      try {
        return jsonResponse(await getDefiProtocols(env));
      } catch {
        return jsonResponse({ error: "DeFi protocol data is temporarily unavailable" }, 502);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/market-history") {
      try {
        return jsonResponse(await getMarketHistory(url));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Market history is temporarily unavailable";
        return jsonResponse({ error: message }, message.startsWith("Unsupported") ? 400 : 502);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/credits") {
      try {
        return privateJsonResponse(await getCreditWallet(env, signalUserId(request)));
      } catch {
        return privateJsonResponse({ error: "Credit wallet is temporarily unavailable" }, 502);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/watchlist-status") {
      const symbols = (url.searchParams.get("symbols") || "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 10);
      if (!symbols.length) return jsonResponse({ statuses: [] });
      const invalid = symbols.filter((symbol) => !allowedSignalSymbols.has(symbol));
      if (invalid.length)
        return jsonResponse({ error: `Unsupported symbol(s): ${invalid.join(", ")}` }, 400);
      try {
        return jsonResponse({ statuses: await getWatchlistStatuses(env, symbols) });
      } catch {
        return jsonResponse({ error: "Watchlist status is temporarily unavailable" }, 502);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/track-record") {
      const symbol = url.searchParams.get("symbol")?.trim().toUpperCase() || null;
      const timeframe = url.searchParams.get("timeframe")?.trim() || null;
      if (symbol && !allowedSignalSymbols.has(symbol))
        return jsonResponse({ error: "Unsupported symbol" }, 400);
      if (timeframe && !hasOwnKey(SIGNAL_TIMEFRAMES, timeframe))
        return jsonResponse({ error: "Unsupported timeframe" }, 400);
      ctx.waitUntil(resolveDueSignals(env));
      try {
        return jsonResponse(await getPublicTrackRecord(env, symbol, timeframe));
      } catch {
        return jsonResponse({ error: "Track record is temporarily unavailable" }, 502);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/calibration") {
      try {
        return jsonResponse({
          buckets: await getConfidenceCalibration(env),
          minSampleSize: CALIBRATION_MIN_SAMPLE,
        });
      } catch {
        return jsonResponse({ error: "Calibration data is temporarily unavailable" }, 502);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/signal-analysis") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        return privateJsonResponse(
          { error: "Cross-origin analysis requests are not allowed" },
          403,
        );
      const userId = signalUserId(request);
      let body: Record<string, unknown>;
      if (safeNumber(request.headers.get("content-length")) > 16_384)
        return privateJsonResponse({ error: "Analysis request is too large" }, 413);
      try {
        const text = await readLimitedBody(request, 16_384);
        if (text == null)
          return privateJsonResponse({ error: "Analysis request is too large" }, 413);
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          return privateJsonResponse({ error: "Invalid analysis request" }, 400);
        body = parsed as Record<string, unknown>;
      } catch {
        return privateJsonResponse({ error: "Invalid analysis request" }, 400);
      }
      const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
      const timeframe = (
        typeof body.timeframe === "string" ? body.timeframe : ""
      ) as SignalTimeframe;
      if (!allowedSignalSymbols.has(symbol) || !hasOwnKey(SIGNAL_TIMEFRAMES, timeframe))
        return privateJsonResponse({ error: "Unsupported symbol or timeframe" }, 400);
      const cost = SIGNAL_TIMEFRAMES[timeframe].creditCost;
      let balance: number | null = null;
      try {
        if (!(await reserveAnalysisSlot(env, userId)))
          return privateJsonResponse(
            { error: "Please wait a moment before running another analysis" },
            429,
          );
        balance = await debitCredits(env, userId, cost);
        if (balance == null) {
          const wallet = await getCreditWallet(env, userId);
          return privateJsonResponse(
            {
              error: `Insufficient credits. ${cost} required.`,
              balance: wallet.balance,
              required: cost,
            },
            402,
          );
        }
        const analysis = await getSignalAnalysis(env, symbol, timeframe, balance);
        await saveSignalAnalysis(env, userId, analysis);
        ctx.waitUntil(resolveDueSignals(env)); // piggyback: grade older pending signals while we're here
        return privateJsonResponse(analysis);
      } catch (error) {
        console.error(
          "signal-analysis-failure",
          error instanceof Error ? error.message : "unknown error",
        );
        if (balance != null) {
          try {
            await refundCredits(env, userId, cost);
          } catch (refundError) {
            console.error(
              "signal-credit-refund-failed",
              refundError instanceof Error ? refundError.message : "unknown error",
            );
            return privateJsonResponse(
              {
                error:
                  "Analysis failed and the credit refund is temporarily unavailable. Please check your wallet before trying again.",
              },
              502,
            );
          }
          return privateJsonResponse(
            {
              error:
                "The live signal engine could not complete this analysis. Your credits were restored.",
            },
            502,
          );
        }
        return privateJsonResponse(
          { error: "The signal engine is temporarily unavailable. No credits were charged." },
          502,
        );
      }
    }

    // Stateless sharing requires no database reads or writes.
    if (request.method === "GET" && url.pathname === "/share") {
      const encoded = url.searchParams.get("d");
      const payload = encoded ? decodeSharePayload(encoded) : null;
      if (!payload) {
        return new Response(renderShareErrorPage(), {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return new Response(renderSharePage(payload, url.origin), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
