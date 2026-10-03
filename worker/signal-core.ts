/** Pure market-data rules, shared by the Worker and its behavior tests. */
export type Kline = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
};
export type ResolutionOutcome = { hit: boolean; resolvedPrice: number; reason: string };

export function hasOwnKey(object: object, key: string): boolean {
  return Object.hasOwn(object, key);
}

export function finiteNumberOrNull(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  )
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeKlines(value: unknown, quoteVolumeIndex = 7): Kline[] {
  if (!Array.isArray(value)) return [];
  const candles = value.flatMap((row): Kline[] => {
    if (!Array.isArray(row) || row.length < 6) return [];
    const [time, open, high, low, close, volume] = row.slice(0, 6).map(Number);
    const quoteVolume = Number(row[quoteVolumeIndex] ?? 0);
    if (
      ![time, open, high, low, close, volume, quoteVolume].every(Number.isFinite) ||
      time <= 0 ||
      Math.min(open, high, low, close) <= 0 ||
      volume < 0 ||
      quoteVolume < 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    )
      return [];
    return [{ time, open, high, low, close, volume, quoteVolume }];
  });
  return [...new Map(candles.map((candle) => [candle.time, candle])).values()].sort(
    (a, b) => a.time - b.time,
  );
}

/** Aggregate only complete, contiguous UTC-aligned bars. */
export function aggregateKlines(
  candles: Kline[],
  intervalMs: number,
  baseIntervalMs: number,
  now = Date.now(),
): Kline[] {
  const groups = new Map<number, Kline[]>();
  for (const candle of candles) {
    if (candle.time + baseIntervalMs > now) continue;
    const start = Math.floor(candle.time / intervalMs) * intervalMs;
    const group = groups.get(start) ?? [];
    group.push(candle);
    groups.set(start, group);
  }
  const expected = intervalMs / baseIntervalMs;
  return [...groups]
    .flatMap(([time, group]): Kline[] => {
      group.sort((a, b) => a.time - b.time);
      if (
        group.length !== expected ||
        time + intervalMs > now ||
        group.some((candle, index) => candle.time !== time + index * baseIntervalMs)
      )
        return [];
      return [
        {
          time,
          open: group[0].open,
          close: group.at(-1)!.close,
          high: Math.max(...group.map((candle) => candle.high)),
          low: Math.min(...group.map((candle) => candle.low)),
          volume: group.reduce((sum, candle) => sum + candle.volume, 0),
          quoteVolume: group.reduce((sum, candle) => sum + candle.quoteVolume, 0),
        },
      ];
    })
    .sort((a, b) => a.time - b.time);
}

export function calculateRsi(values: number[], period = 14): number {
  if (values.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

export function evaluateSignalOutcome(
  direction: "LONG" | "SHORT",
  mark: number,
  stopLoss: number | null,
  takeProfit: number | null,
  klines: Kline[],
  pastDeadline: boolean,
): ResolutionOutcome | null {
  if (!klines.length) return null;
  for (const candle of klines) {
    const stopTouched =
      stopLoss != null && (direction === "LONG" ? candle.low <= stopLoss : candle.high >= stopLoss);
    const profitTouched =
      takeProfit != null &&
      (direction === "LONG" ? candle.high >= takeProfit : candle.low <= takeProfit);
    // OHLC does not encode the order of intrabar touches. Use the conservative
    // outcome and expose that ambiguity instead of manufacturing a win.
    if (stopTouched)
      return {
        hit: false,
        resolvedPrice: stopLoss!,
        reason: profitTouched ? "ambiguous_intrabar_stop" : "stop_loss_hit",
      };
    if (profitTouched) return { hit: true, resolvedPrice: takeProfit!, reason: "take_profit_hit" };
  }
  if (!pastDeadline) return null;
  const lastClose = klines.at(-1)!.close;
  return {
    hit: direction === "LONG" ? lastClose > mark : lastClose < mark,
    resolvedPrice: lastClose,
    reason: "directional_timeout",
  };
}

export function resolutionWindow(
  candles: Kline[],
  start: number,
  end: number,
  intervalMs: number,
): Kline[] {
  const window = candles
    .filter((candle) => candle.time >= start && candle.time + intervalMs <= end)
    .sort((a, b) => a.time - b.time);
  const contiguous: Kline[] = [];
  let nextTime = Math.ceil(start / intervalMs) * intervalMs;
  for (const candle of window) {
    // A missing candle could conceal the first stop/target touch. Only the
    // observed, contiguous prefix after entry can support an honest outcome.
    if (candle.time !== nextTime) break;
    contiguous.push(candle);
    nextTime += intervalMs;
  }
  return contiguous;
}

export function expectedResolutionBars(start: number, end: number, intervalMs: number): number {
  return Math.max(
    0,
    (Math.floor(end / intervalMs) * intervalMs - Math.ceil(start / intervalMs) * intervalMs) /
      intervalMs,
  );
}

/** Read at most the accepted number of bytes, including chunked requests. */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function directionalRiskPlan(
  direction: "LONG" | "SHORT" | "NEUTRAL",
  mark: number,
  atr: number,
  support: number | null,
  resistance: number | null,
) {
  if (direction === "NEUTRAL")
    return { stopLoss: null, takeProfit: null, rewardRisk: null, riskVeto: false };
  const stopDistance = atr * (atr / mark > 0.02 ? 4 : 2);
  const target = direction === "LONG" ? resistance : support;
  const validTarget =
    target != null && target > 0 && (direction === "LONG" ? target > mark : target < mark);
  const stopLoss = direction === "LONG" ? mark - stopDistance : mark + stopDistance;
  const validStop = Number.isFinite(stopLoss) && stopLoss > 0 && stopDistance > 0;
  const rewardRisk = validTarget && validStop ? Math.abs(target! - mark) / stopDistance : null;
  return {
    stopLoss: validStop ? stopLoss : null,
    takeProfit: validTarget ? target : null,
    rewardRisk,
    riskVeto: rewardRisk == null || rewardRisk < 2,
  };
}

export function decodeUtf8Base64Url(encoded: string): unknown {
  if (encoded.length > 8_192 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error("Invalid shared payload");
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    ),
  );
}
