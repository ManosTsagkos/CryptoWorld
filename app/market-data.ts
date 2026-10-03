export const MARKET_REFRESH_MS = 5 * 60 * 1000;

export type LiveAsset = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  currentPrice: number;
  marketCap: number;
  marketCapRank: number | null;
  totalVolume: number;
  change1h: number;
  change24h: number;
  change7d: number;
  lastUpdated: string;
  sparkline7d: number[];
};

export type TrendingAsset = {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number | null;
  price: number | null;
  change24h: number | null;
};

export type MarketSnapshot = {
  updatedAt: string;
  providerUpdatedAt: string;
  refreshIntervalMs: number;
  stale: boolean;
  assets: LiveAsset[];
  global: {
    totalMarketCap: number | null;
    totalVolume: number | null;
    btcDominance: number | null;
    ethDominance: number | null;
    marketCapChange24h: number | null;
    volumeChange24h: number | null;
    activeCryptocurrencies: number;
    markets: number;
  };
  fearGreed: {
    value: number;
    classification: string;
    timestamp: string;
    timeUntilUpdate: number | null;
  } | null;
  trending: TrendingAsset[];
  sources: {
    market: string;
    sentiment: string;
  };
};

export type MarketHistory = {
  id: string;
  range: string;
  updatedAt: string;
  stale: boolean;
  prices: [number, number][];
  volumes: [number, number][];
  source: string;
};
