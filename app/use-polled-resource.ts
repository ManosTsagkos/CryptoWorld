"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MARKET_REFRESH_MS } from "./market-data";

export type FeedStatus = "connecting" | "live" | "stale" | "offline";

/** One in-flight request per feed; abort on unmount and retain useful cached data. */
export function usePolledResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  isStale: (data: T) => boolean = neverStale,
) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const active = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const hasData = useRef(false);

  const refresh = useCallback(async () => {
    if (!active.current || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    try {
      const next = await load(AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]));
      if (!active.current || controller.signal.aborted) return;
      hasData.current = true;
      setData(next);
      setStatus(isStale(next) ? "stale" : "live");
    } catch {
      if (active.current && !controller.signal.aborted)
        setStatus(hasData.current ? "stale" : "offline");
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [load, isStale]);

  useEffect(() => {
    active.current = true;
    hasData.current = false;
    const initial = window.setTimeout(() => {
      setData(null);
      setStatus("connecting");
      void refresh();
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, MARKET_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active.current = false;
      pending.current?.abort();
      pending.current = null;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { data, status, refresh };
}

function neverStale() {
  return false;
}

export async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}
