import type { AreaData, HistogramData, Time } from "lightweight-charts";
import type { MarketHistory } from "../market-data";

export const VOLUME_COLORS = {
  rising: "rgba(0,229,169,.30)",
  falling: "rgba(255,52,91,.26)",
  unknown: "rgba(96,113,143,.26)",
};

export function samplePoints<T>(values: readonly T[], limit = 180): T[] {
  if (!Number.isInteger(limit) || limit < 2)
    throw new RangeError("Chart sample limit must be at least two");
  if (values.length <= limit) return [...values];
  return Array.from(
    { length: limit },
    (_, index) => values[Math.round((index * (values.length - 1)) / (limit - 1))],
  );
}

function latestPriceIndex(prices: MarketHistory["prices"], timestamp: number) {
  let start = 0;
  let end = prices.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (prices[middle][0] <= timestamp) start = middle + 1;
    else end = middle;
  }
  return start - 1;
}

// Inputs are already sorted and deduplicated at the API boundary.
export function buildChartSeries(
  history: Pick<MarketHistory, "prices" | "volumes">,
  range: string,
  now = Date.now(),
) {
  const cutoff = range === "1H" ? now - 60 * 60 * 1000 : 0;
  const prices: AreaData<Time>[] = samplePoints(
    history.prices.filter(([timestamp]) => timestamp >= cutoff),
  ).map(([timestamp, value]) => ({ time: Math.floor(timestamp / 1000) as Time, value }));

  const volumes: HistogramData<Time>[] = samplePoints(
    history.volumes.filter(([timestamp]) => timestamp >= cutoff),
  ).map(([timestamp, value]) => {
    // Volume and price providers can use different sampling intervals.
    const index = latestPriceIndex(history.prices, timestamp);
    const color =
      index < 1
        ? VOLUME_COLORS.unknown
        : history.prices[index][1] >= history.prices[index - 1][1]
          ? VOLUME_COLORS.rising
          : VOLUME_COLORS.falling;
    return { time: Math.floor(timestamp / 1000) as Time, value, color };
  });
  return { prices, volumes };
}
