"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type AreaData,
  type Time,
} from "lightweight-charts";
import { type MarketHistory } from "../market-data";
import { normalizeHistoryPoints } from "../frontend-utils";
import { fetchJson, usePolledResource } from "../use-polled-resource";
import { buildChartSeries } from "./chart-series";

const symbolColor: Record<string, string> = {
  BTC: "#ff9b00",
  ETH: "#687cff",
  SOL: "#00e4c2",
  XRP: "#20d8ff",
  BNB: "#ffc21d",
};

export default function MarketChart({
  id,
  symbol,
  range,
}: {
  id: string;
  symbol: string;
  range: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const next = await fetchJson<MarketHistory>(
        `/api/market-history?id=${encodeURIComponent(id)}&range=${encodeURIComponent(range)}`,
        signal,
      );
      const prices = normalizeHistoryPoints(next.prices);
      if (!prices.length || typeof next.source !== "string") throw new Error("History unavailable");
      return {
        ...next,
        prices,
        volumes: normalizeHistoryPoints(next.volumes, true),
        requestKey: `${id}:${range}`,
      };
    },
    [id, range],
  );
  const { data, status } = usePolledResource(load, historyIsStale);
  const history = data?.requestKey === `${id}:${range}` ? data : null;
  const series = useMemo(
    () => (history ? buildChartSeries(history, range) : null),
    [history, range],
  );
  const visibleStatus =
    history && !series?.prices.length
      ? "unavailable"
      : !history && status !== "offline"
        ? "connecting"
        : status;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !history || !series?.prices.length) return;
    const accent = symbolColor[symbol] ?? "#00eaff";
    const { prices, volumes } = series;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#60718f",
        fontFamily: "var(--font-geist-mono)",
        fontSize: 9,
      },
      grid: {
        vertLines: { color: "rgba(59,87,143,.10)" },
        horzLines: { color: "rgba(59,87,143,.13)" },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.23 } },
      timeScale: {
        borderVisible: false,
        timeVisible: range !== "1Y" && range !== "ALL",
        secondsVisible: false,
        rightOffset: 1,
        barSpacing: 8,
        minBarSpacing: 2,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(0,231,255,.42)", labelBackgroundColor: "#0a4860" },
        horzLine: { color: "rgba(153,76,255,.38)", labelBackgroundColor: "#45286f" },
      },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });
    const latestPrice = prices.at(-1)?.value ?? 1;
    const precision = latestPrice >= 1 ? 2 : latestPrice >= 0.01 ? 4 : 8;
    const priceSeries = chart.addSeries(AreaSeries, {
      lineColor: accent,
      topColor: `${accent}45`,
      bottomColor: `${accent}03`,
      lineWidth: 2,
      priceLineColor: accent,
      priceLineWidth: 1,
      lastValueVisible: true,
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    priceSeries.setData(prices);
    volumeSeries.setData(volumes);
    chart.timeScale().fitContent();

    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    const label = document.createElement("b");
    const value = document.createElement("strong");
    const source = document.createElement("span");
    label.textContent = `${symbol}/USD`;
    source.textContent = `${history.source} · ${range}`;
    for (const child of [label, value, source]) tooltip.appendChild(child);
    container.appendChild(tooltip);
    chart.subscribeCrosshairMove((param) => {
      const point = param.seriesData.get(priceSeries) as AreaData<Time> | undefined;
      if (!param.point || !point || param.point.x < 0 || param.point.y < 0) {
        tooltip.classList.remove("visible");
        return;
      }
      const digits = point.value >= 1 ? 2 : point.value >= 0.01 ? 4 : 8;
      value.textContent = point.value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
      tooltip.style.left = `${Math.max(0, Math.min(param.point.x + 14, container.clientWidth - 126))}px`;
      tooltip.style.top = `${Math.max(8, param.point.y - 42)}px`;
      tooltip.classList.add("visible");
    });

    return () => {
      chart.remove();
      tooltip.remove();
    };
  }, [history, range, series, symbol]);

  return (
    <div className="market-chart-shell">
      <div className="market-chart-status" role="status">
        <span className={`live-pulse ${visibleStatus !== "live" ? "is-stale" : ""}`} />
        {visibleStatus === "connecting" ? "LOADING" : visibleStatus.toUpperCase()} PRICE{" "}
        <b>{symbol}/USD</b>
        <small>{(history?.source ?? "LIVE MARKET").toUpperCase()} · 5M</small>
      </div>
      <div
        ref={containerRef}
        className="market-chart"
        aria-label={`${symbol} price history chart`}
      />
      {visibleStatus === "offline" && (
        <div className="chart-offline">Live history temporarily unavailable</div>
      )}
      {visibleStatus === "unavailable" && (
        <div className="chart-offline">No prices available for this range</div>
      )}
    </div>
  );
}

function historyIsStale(history: MarketHistory) {
  return history.stale;
}
