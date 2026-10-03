export const SIGNAL_TIMEFRAMES = {
  "15m": { label: "15M", creditCost: 3 },
  "30m": { label: "30M", creditCost: 4 },
  "1h": { label: "1H", creditCost: 5 },
  "3h": { label: "3H", creditCost: 6 },
  "6h": { label: "6H", creditCost: 8 },
} as const;

export type SignalTimeframe = keyof typeof SIGNAL_TIMEFRAMES;
export const SIGNAL_SYMBOLS = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "BNB",
  "DOGE",
  "ADA",
  "DOT",
  "LINK",
  "LTC",
  "AVAX",
  "ATOM",
  "UNI",
  "NEAR",
  "TRX",
  "BCH",
  "ETC",
] as const;
export type SignalDirection = "LONG" | "SHORT" | "NEUTRAL";

// Preserve disagreement so the UI can explain lower conviction.
export type EnsembleInfo = {
  ranSecondOpinion: boolean;
  secondaryProvider: string | null;
  secondarySentiment: "Bullish" | "Bearish" | "Neutral" | null;
  agreement: "agree" | "disagree" | "unavailable";
  note: string;
};

export type SignalAnalysis = {
  id: string;
  symbol: string;
  timeframe: SignalTimeframe;
  creditCost: number;
  updatedAt: string;
  provider: string;
  direction: SignalDirection;
  actionable: boolean;
  score: number;
  confidence: number;
  // Calibration adjusts the displayed value; retain the raw formula for later evaluation.
  rawConfidence: number;
  confidenceCalibrated: boolean;
  buyPct: number;
  sellPct: number;
  mark: number;
  support: number | null;
  resistance: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  countdownSeconds: number;
  technical: {
    score: number;
    rsi: number;
    ema20: number;
    ema50: number;
    macdHistogram: number;
    bollingerPercentB: number;
    atr: number;
    volume24h: number;
    volumeChangePct: number | null;
    regime: "trending" | "choppy";
    efficiencyRatio: number;
    volatilityLevel: "low" | "normal" | "high";
  };
  derivatives: {
    score: number | null;
    fundingPct: number | null;
    oiChangePct: number | null;
    longPct: number | null;
    shortPct: number | null;
    basisPct: number | null;
    note: string;
  };
  news: {
    score: number | null;
    sentiment: "Bullish" | "Bearish" | "Neutral";
    confidence: number;
    impact: number;
    summary: string;
    bullets: string[];
    catalyst: string;
    invalidation: string;
    headlines: { title: string; source: string; url: string }[];
    ensemble: EnsembleInfo;
  };
  safety: {
    frozen: boolean;
    reasons: string[];
    stablecoinPrice: number | null;
    spreadPct: number | null;
    orderBookImbalance: number | null;
    rewardRisk: number | null;
    riskVeto: boolean;
  };
  historicalReplay: {
    sampleSize: number;
    hitRate: number;
    outcomes: boolean[];
  };
  // These are geometric pattern rules, independent of the optional AI news model.
  chartPatterns: Array<{
    type: string;
    direction: "bullish" | "bearish";
    confidence: number;
    status: "forming" | "confirmed";
    breakoutLevel: number | null;
    description: string;
    points: { index: number; price: number; time: number }[];
  }>;
  thesis: string;
  sources: string[];
  balance: number;
};

// Public aggregates must not include visitor identity or credit activity.
export type PublicTrackRecord = {
  available: boolean;
  hitRatePct: number | null;
  sampleSize: number;
  windowDays: number;
  symbol: string | null;
  timeframe: string | null;
};

export type ConfidenceCalibrationBucket = {
  label: string;
  min: number;
  max: number;
  sampleSize: number;
  actualHitRatePct: number | null;
};
export type ConfidenceCalibration = {
  buckets: ConfidenceCalibrationBucket[];
  minSampleSize: number;
};

export type DailyClaimResult = { claimed: boolean; granted: number; streakDays: number };

// Reads existing signals; checking a watchlist does not spend credits.
export type WatchlistStatus = {
  symbol: string;
  direction: SignalDirection | null;
  actionable: boolean;
  timeframe: string | null;
  updatedAt: string | null;
  ageMinutes: number | null;
};

export type CreditWallet = {
  balance: number;
  lifetimeSpent: number;
  initialGrant: number;
  persistent: boolean;
  // Describes the reward granted on this load; absent for memory-only wallets.
  dailyClaim: DailyClaimResult | null;
  streakDays: number;
  history: Array<{
    id: string;
    symbol: string;
    timeframe: SignalTimeframe;
    creditCost: number;
    direction: SignalDirection;
    score: number;
    confidence: number;
    provider: string;
    createdAt: string;
  }>;
};
