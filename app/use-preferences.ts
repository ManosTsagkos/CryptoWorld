"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createBrowserStore } from "./browser-store";
import {
  sanitizePriceAlerts,
  sanitizeSettings,
  sanitizeSymbols,
  type StoredAppSettings,
  type StoredPriceAlert,
} from "./frontend-utils";

function localStore<T>(key: string, initial: T, sanitize: (value: unknown) => T) {
  return createBrowserStore({
    key,
    initial,
    sanitize,
    storage: () => (typeof window === "undefined" ? null : window.localStorage),
    onStorageChange: (reload) => {
      if (typeof window === "undefined") return () => {};
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) reload();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
  });
}

const watchlist = localStore<string[]>("watchlist-symbols", [], sanitizeSymbols);
const alerts = localStore<StoredPriceAlert[]>("price-alerts", [], sanitizePriceAlerts);
const preferences = localStore<StoredAppSettings>(
  "app-settings",
  { reduceMotion: false, defaultRange: "1D" },
  sanitizeSettings,
);

const toggleWatchlistSymbol = (symbol: string) =>
  watchlist.update((symbols) =>
    symbols.includes(symbol)
      ? symbols.filter((existing) => existing !== symbol)
      : [...symbols, symbol],
  );

export function useWatchlist() {
  const symbols = useSyncExternalStore(
    watchlist.subscribe,
    watchlist.getSnapshot,
    watchlist.getServerSnapshot,
  );
  return {
    symbols,
    has: (symbol: string) => symbols.includes(symbol),
    toggle: toggleWatchlistSymbol,
  };
}

const addAlert = (symbol: string, targetPrice: number, direction: "above" | "below") => {
  if (!Number.isFinite(targetPrice) || targetPrice <= 0 || alerts.getSnapshot().length >= 100)
    return false;
  alerts.update((current) => [
    ...current,
    {
      id: crypto.randomUUID(),
      symbol,
      targetPrice,
      direction,
      triggered: false,
      createdAt: Date.now(),
    },
  ]);
  return true;
};
const removeAlert = (id: string) =>
  alerts.update((current) => current.filter((alert) => alert.id !== id));
const markTriggered = (id: string) =>
  alerts.update((current) =>
    current.map((alert) => (alert.id === id ? { ...alert, triggered: true } : alert)),
  );

export function useAlerts() {
  const current = useSyncExternalStore(
    alerts.subscribe,
    alerts.getSnapshot,
    alerts.getServerSnapshot,
  );
  return { alerts: current, addAlert, removeAlert, markTriggered };
}

const updatePreferences = (patch: Partial<StoredAppSettings>) =>
  preferences.update((current) => ({ ...current, ...patch }));

export function useSettings() {
  const settings = useSyncExternalStore(
    preferences.subscribe,
    preferences.getSnapshot,
    preferences.getServerSnapshot,
  );
  useEffect(() => {
    document.body.classList.toggle("reduce-motion", settings.reduceMotion);
  }, [settings.reduceMotion]);
  return { settings, update: updatePreferences };
}
