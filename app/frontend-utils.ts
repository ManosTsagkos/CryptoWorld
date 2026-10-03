export const CHART_RANGES = ["1H", "1D", "1W", "1M", "3M", "1Y", "ALL"] as const;
export type StoredAppSettings = { reduceMotion: boolean; defaultRange: string };

export function sanitizeSettings(value: unknown): StoredAppSettings {
  const settings =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    reduceMotion: settings.reduceMotion === true,
    defaultRange:
      typeof settings.defaultRange === "string" &&
      CHART_RANGES.some((range) => range === settings.defaultRange)
        ? settings.defaultRange
        : "1D",
  };
}

export type StoredPriceAlert = {
  id: string;
  symbol: string;
  targetPrice: number;
  direction: "above" | "below";
  triggered: boolean;
  createdAt: number;
};

export function sanitizeSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((symbol): symbol is string => typeof symbol === "string")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => /^[A-Z0-9]{2,16}$/.test(symbol)),
    ),
  ].slice(0, 100);
}

export function sanitizePriceAlerts(value: unknown): StoredPriceAlert[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value
    .filter((item): item is StoredPriceAlert => {
      if (!item || typeof item !== "object") return false;
      const alert = item as Partial<StoredPriceAlert>;
      if (
        typeof alert.id !== "string" ||
        !alert.id ||
        ids.has(alert.id) ||
        typeof alert.symbol !== "string" ||
        !/^[A-Z0-9]{2,16}$/.test(alert.symbol) ||
        typeof alert.targetPrice !== "number" ||
        !Number.isFinite(alert.targetPrice) ||
        alert.targetPrice <= 0 ||
        (alert.direction !== "above" && alert.direction !== "below") ||
        typeof alert.triggered !== "boolean" ||
        typeof alert.createdAt !== "number" ||
        !Number.isFinite(alert.createdAt) ||
        alert.createdAt < 0
      )
        return false;
      ids.add(alert.id);
      return true;
    })
    .slice(0, 100);
}

/** Chart libraries require strictly increasing, unique Unix seconds. */
export function normalizeHistoryPoints(value: unknown, allowZero = false): [number, number][] {
  if (!Array.isArray(value)) return [];
  const bySecond = new Map<number, number>();
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [timestamp, price] = point;
    if (
      typeof timestamp !== "number" ||
      !Number.isFinite(timestamp) ||
      timestamp < 0 ||
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      (allowZero ? price < 0 : price <= 0)
    )
      continue;
    bySecond.set(Math.floor(timestamp / 1000), price);
  }
  return [...bySecond].sort(([a], [b]) => a - b).map(([second, price]) => [second * 1000, price]);
}

export function encodeSharePayload(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function calculatePositionSize(
  account: number,
  riskPct: number,
  entry: number,
  stop: number,
) {
  if (
    ![account, riskPct, entry, stop].every(Number.isFinite) ||
    account <= 0 ||
    riskPct <= 0 ||
    riskPct > 100 ||
    entry <= 0 ||
    stop <= 0 ||
    entry === stop
  )
    return null;
  const riskAmount = (account * riskPct) / 100;
  const size = riskAmount / Math.abs(entry - stop);
  const value = size * entry;
  return [riskAmount, size, value].every(Number.isFinite) ? { riskAmount, size, value } : null;
}

export function convertAtPrices(
  quantity: number,
  fromPrice: number | null,
  toPrice: number | null,
) {
  if (
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    fromPrice == null ||
    toPrice == null ||
    !Number.isFinite(fromPrice) ||
    !Number.isFinite(toPrice) ||
    fromPrice <= 0 ||
    toPrice <= 0
  )
    return null;
  const result = quantity * (fromPrice / toPrice);
  return Number.isFinite(result) ? result : null;
}

export function triggeredPriceAlerts(
  alerts: StoredPriceAlert[],
  prices: ReadonlyMap<string, number>,
) {
  return alerts.filter((alert) => {
    const price = prices.get(alert.symbol);
    return (
      !alert.triggered &&
      price != null &&
      Number.isFinite(price) &&
      price > 0 &&
      (alert.direction === "above" ? price >= alert.targetPrice : price <= alert.targetPrice)
    );
  });
}
