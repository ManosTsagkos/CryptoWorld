"use client";

import type { CSSProperties, ReactNode, RefObject } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  BarChart3,
  Bell,
  BellRing,
  Bot,
  BriefcaseBusiness,
  Calculator,
  CalendarDays,
  ChartCandlestick,
  ChevronRight,
  Eye,
  Fullscreen,
  Gauge,
  LayoutDashboard,
  LineChart,
  Mail,
  Menu,
  Newspaper,
  PieChart,
  ScanSearch,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Share2,
  Shapes,
  SlidersHorizontal,
  Star,
  UserRound,
  WandSparkles,
  Wrench,
  X,
  Zap,
  Coins,
  BrainCircuit,
  Radio,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import MarketChart from "./components/MarketChart";
import { type LiveAsset, type MarketSnapshot, type TrendingAsset } from "./market-data";
import {
  SIGNAL_SYMBOLS,
  SIGNAL_TIMEFRAMES,
  type CreditWallet,
  type SignalAnalysis,
  type SignalDirection,
  type SignalTimeframe,
  type PublicTrackRecord,
  type WatchlistStatus,
} from "./signal-analysis";
import {
  CHART_RANGES,
  calculatePositionSize,
  convertAtPrices,
  encodeSharePayload,
  triggeredPriceAlerts,
} from "./frontend-utils";
import { useAlerts, useSettings, useWatchlist } from "./use-preferences";
import { fetchJson, usePolledResource } from "./use-polled-resource";
import { useDialogFocus } from "./use-dialog-focus";
import {
  FOMC_CALENDAR_SOURCE,
  FOMC_CALENDAR_CHECKED,
  upcomingFomcMeetings,
} from "./macro-calendar";

const ThreeGlobe = dynamic(() => import("./components/ThreeGlobe"), {
  ssr: false,
  loading: () => (
    <div className="globe-loading">
      <i />
      <span>INITIALIZING 3D NETWORK</span>
    </div>
  ),
});

type Accent = "cyan" | "blue" | "purple" | "pink" | "orange" | "green" | "red";
type SparkProps = { values: number[]; color?: string; className?: string; width?: number };
type MarketItem = {
  id: string;
  symbol: string;
  name: string;
  pair: "USDT";
  price: string;
  change: string;
  changeValue: number;
  change1h: number;
  change7d: number;
  accent: Accent;
  glyph: string;
  image: string | null;
  values: number[];
  asset: LiveAsset | null;
};

const marketConfig: Record<string, { id: string; accent: Accent; glyph: string }> = {
  BTC: { id: "bitcoin", accent: "orange", glyph: "₿" },
  ETH: { id: "ethereum", accent: "blue", glyph: "Ξ" },
  SOL: { id: "solana", accent: "pink", glyph: "S" },
  XRP: { id: "ripple", accent: "cyan", glyph: "X" },
  BNB: { id: "binancecoin", accent: "orange", glyph: "◆" },
  DOGE: { id: "dogecoin", accent: "orange", glyph: "Ð" },
  ADA: { id: "cardano", accent: "blue", glyph: "A" },
  DOT: { id: "polkadot", accent: "pink", glyph: "D" },
  LINK: { id: "chainlink", accent: "blue", glyph: "L" },
  LTC: { id: "litecoin", accent: "cyan", glyph: "Ł" },
  AVAX: { id: "avalanche-2", accent: "red", glyph: "A" },
  ATOM: { id: "cosmos", accent: "purple", glyph: "A" },
  UNI: { id: "uniswap", accent: "pink", glyph: "U" },
  NEAR: { id: "near", accent: "green", glyph: "N" },
  TRX: { id: "tron", accent: "red", glyph: "T" },
  BCH: { id: "bitcoin-cash", accent: "green", glyph: "B" },
  ETC: { id: "ethereum-classic", accent: "green", glyph: "E" },
};
const primarySymbols = ["BTC", "ETH", "SOL", "XRP", "BNB"];
const tickerSymbols = [
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
];
const NavigationContext = createContext<(section: string) => void>(() => undefined);
const CoinSelectionContext = createContext<(symbol: string) => void>(() => undefined);

function coinIconUrl(symbol: string) {
  return `https://assets.coincap.io/assets/icons/${symbol.toLowerCase()}@2x.png`;
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  const digits = value >= 1000 ? 2 : value >= 1 ? 2 : value >= 0.01 ? 4 : 8;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatCompactCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${formatPrice(Math.abs(value))}`;
}

function formatChange(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function normalizeSeries(values: number[], points = 18) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return Array.from({ length: points }, () => 50);
  const count = Math.min(points, clean.length);
  const sampled = Array.from(
    { length: count },
    (_, index) => clean[Math.round((index * (clean.length - 1)) / Math.max(1, count - 1))],
  );
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  if (max === min) return sampled.map(() => 50);
  return sampled.map((value) => 12 + ((value - min) / (max - min)) * 82);
}

function buildMarketItems(snapshot: MarketSnapshot | null, symbols = primarySymbols): MarketItem[] {
  const bySymbol = new Map((snapshot?.assets ?? []).map((asset) => [asset.symbol, asset]));
  return symbols.map((symbol) => {
    const config = marketConfig[symbol] ?? {
      id: symbol.toLowerCase(),
      accent: "blue" as Accent,
      glyph: symbol.slice(0, 1),
    };
    const asset = bySymbol.get(symbol) ?? null;
    return {
      id: asset?.id ?? config.id,
      symbol,
      name: asset?.name ?? symbol,
      pair: "USDT",
      price: formatPrice(asset?.currentPrice),
      change: asset ? formatChange(asset.change24h) : "—",
      changeValue: asset?.change24h ?? 0,
      change1h: asset?.change1h ?? 0,
      change7d: asset?.change7d ?? 0,
      accent: config.accent,
      glyph: config.glyph,
      image: asset?.image || coinIconUrl(symbol),
      values: normalizeSeries(asset?.sparkline7d ?? []),
      asset,
    };
  });
}

// Compare saved directions so a new watchlist entry does not notify on its first poll.
const WATCHLIST_DIRECTION_STORAGE_KEY = "watchlist-last-direction";

function loadLastDirections(): Record<string, SignalDirection> {
  if (typeof window === "undefined") return {};
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(WATCHLIST_DIRECTION_STORAGE_KEY) || "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([symbol, direction]) =>
          /^[A-Z0-9]{2,16}$/.test(symbol) &&
          (direction === "LONG" || direction === "SHORT" || direction === "NEUTRAL"),
      ),
    );
  } catch {
    return {};
  }
}
function saveLastDirections(map: Record<string, SignalDirection>) {
  try {
    window.localStorage.setItem(WATCHLIST_DIRECTION_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable */
  }
}

function useWatchlistBiasAlerts(notify: (text: string) => void) {
  const { symbols } = useWatchlist();
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">(
    () => {
      if (typeof window !== "undefined" && "Notification" in window) return Notification.permission;
      return "unsupported";
    },
  );

  const requestPush = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      notify(
        permission === "granted"
          ? "Browser alerts enabled while this site is open"
          : "Notification permission was not granted",
      );
    } catch {
      notify("Browser notifications are unavailable in this context");
    }
  }, [notify]);

  useEffect(() => {
    if (!symbols.length) return;
    let cancelled = false;

    const check = async () => {
      try {
        const response = await fetch(`/api/watchlist-status?symbols=${symbols.join(",")}`);
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { statuses: WatchlistStatus[] };
        if (cancelled || !Array.isArray(data.statuses)) return;
        const lastDirections = loadLastDirections();
        for (const status of data.statuses) {
          if (!status.direction || !status.actionable) continue;
          const previous = lastDirections[status.symbol];
          if (previous && previous !== status.direction) {
            const message = `${status.symbol} just flipped to ${status.direction} bias`;
            notify(message);
            if (
              typeof window !== "undefined" &&
              "Notification" in window &&
              Notification.permission === "granted"
            ) {
              new Notification("Signal bias change", {
                body: message,
                tag: `bias-${status.symbol}`,
              });
            }
          }
          lastDirections[status.symbol] = status.direction;
        }
        saveLastDirections(lastDirections);
      } catch {
        /* transient network hiccup — the next poll will retry */
      }
    };

    check();
    const interval = window.setInterval(check, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [symbols, notify]);

  return { pushPermission, requestPush };
}

function useLiveMarketData() {
  const {
    data: snapshot,
    status,
    refresh,
  } = usePolledResource(loadMarketSnapshot, snapshotIsStale);
  return { snapshot, status, refresh };
}

async function loadMarketSnapshot(signal: AbortSignal) {
  const next = await fetchJson<MarketSnapshot>("/api/market-data", signal);
  if (!Array.isArray(next.assets) || !next.assets.length || !next.global || !next.sources)
    throw new Error("Invalid market payload");
  return next;
}
function snapshotIsStale(snapshot: MarketSnapshot) {
  return snapshot.stale;
}

const nav: [string, LucideIcon, string?][] = [
  ["Dashboard", LayoutDashboard],
  ["Market Overview", BarChart3],
  ["Portfolio", BriefcaseBusiness],
  ["Screener", SlidersHorizontal, "NEW"],
  ["Trade Tools", Wrench],
  ["AI Insights", Bot, "NEW"],
  ["Analytics", LineChart],
  ["DeFi Scanner", Shield],
  ["News Feed", Newspaper],
  ["Alerts", Bell],
  ["Calendar", CalendarDays],
  ["Watchlist", Star],
  ["Settings", Settings],
];

function CryptoWorldBrand({ onClick }: { onClick: () => void }) {
  return (
    <button className="cryptoworld-brand" onClick={onClick} aria-label="CryptoWorld home">
      <img src="/cryptoworld-logo.png" alt="" width={48} height={48} />
      <span className="cryptoworld-wordmark">
        <strong>
          Crypto<span>World</span>
        </strong>
        <small>CRYPTO ALL-IN-ONE</small>
      </span>
    </button>
  );
}

const darkLogoSymbols = new Set(["DOT", "ONDO"]);

function CoinBadge({
  glyph,
  accent = "cyan",
  small = false,
  image,
  symbol,
}: {
  glyph: string;
  accent?: string;
  small?: boolean;
  image?: string | null;
  symbol?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !!image && !failed;
  const isDarkLogo = showImage && !!symbol && darkLogoSymbols.has(symbol.toUpperCase());
  return (
    <span
      className={`coin-badge coin-${accent} ${small ? "coin-small" : ""} ${isDarkLogo ? "coin-badge-mono" : ""}`}
    >
      {showImage ? (
        <img src={image} alt="" className="coin-badge-img" onError={() => setFailed(true)} />
      ) : (
        glyph
      )}
    </span>
  );
}

function CryptoOrbMark({ symbol, glyph }: { symbol: string; glyph?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = !failed;
  return (
    <span className={`crypto-orb-mark orb-${symbol.toLowerCase()}`} aria-hidden="true">
      {showImage ? (
        <img
          src={coinIconUrl(symbol)}
          alt=""
          className="crypto-orb-img"
          onError={() => setFailed(true)}
        />
      ) : (
        <em>{glyph ?? symbol.slice(0, 1)}</em>
      )}
    </span>
  );
}

function Sparkline({ values, color = "#00eaff", className = "", width = 100 }: SparkProps) {
  const points = values
    .map(
      (value, index) =>
        `${((index * width) / Math.max(1, values.length - 1)).toFixed(3)},${(100 - value).toFixed(3)}`,
    )
    .join(" ");
  const area = `0,100 ${points} ${width},100`;
  return (
    <div
      className={`sparkline ${className}`}
      style={{ "--spark": color } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" focusable="false">
        <polygon className="spark-area" points={area} />
        <polyline className="spark-stroke" points={points} />
      </svg>
    </div>
  );
}

function Panel({
  children,
  className = "",
  accent = "cyan",
  dialogRef,
  dialogLabel,
}: {
  children: ReactNode;
  className?: string;
  accent?: Accent;
  dialogRef?: RefObject<HTMLElement | null>;
  dialogLabel?: string;
}) {
  return (
    <section
      ref={dialogRef}
      role={dialogLabel ? "dialog" : undefined}
      aria-modal={dialogLabel ? true : undefined}
      aria-label={dialogLabel}
      tabIndex={dialogLabel ? -1 : undefined}
      className={`cyber-panel panel-${accent} ${className}`}
    >
      <span className="corner corner-a" />
      <span className="corner corner-b" />
      {children}
    </section>
  );
}

function PanelTitle({
  title,
  icon: Icon,
  iconSrc,
  action,
}: {
  title: string;
  icon?: LucideIcon;
  iconSrc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-title">
      <span>
        {iconSrc ? (
          <img src={iconSrc} alt="" className="panel-title-icon" />
        ) : (
          Icon && <Icon size={13} />
        )}
        {title}
      </span>
      {action}
    </div>
  );
}

function TopHeader({
  openMenu,
  notify,
  onSelectCoin,
  markets,
  snapshot,
  status,
  refresh,
}: {
  openMenu: () => void;
  notify: (text: string) => void;
  onSelectCoin: (symbol: string) => void;
  markets: MarketItem[];
  snapshot: MarketSnapshot | null;
  status: "connecting" | "live" | "stale" | "offline";
  refresh: () => Promise<void>;
}) {
  const navigate = useContext(NavigationContext);
  const { alerts } = useAlerts();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const matches = markets
    .filter((item) =>
      `${item.symbol} ${item.name}`.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .slice(0, 5);
  const selectResult = (symbol: string) => {
    setQuery(symbol);
    setFocused(false);
    onSelectCoin(symbol);
    navigate("Market Overview");
    notify(`${symbol} market selected`);
  };
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);
  return (
    <header className="top-header">
      <div className="logo-cell">
        <CryptoWorldBrand onClick={() => navigate("Dashboard")} />
      </div>
      <button className="mobile-menu" onClick={openMenu} aria-label="Open navigation">
        <Menu size={18} />
      </button>
      <form
        className="search-box"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim() && matches[0]) selectResult(matches[0].symbol);
        }}
      >
        <Search size={14} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setFocused(false);
          }}
          placeholder="Search coins or symbols..."
          aria-label="Search coins or symbols"
        />
        <kbd>Ctrl/⌘ K</kbd>
        {focused && query && (
          <div className="search-results">
            {matches.length ? (
              matches.map((item) => (
                <button
                  type="button"
                  key={item.symbol}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectResult(item.symbol)}
                >
                  <CoinBadge
                    glyph={item.glyph}
                    accent={item.accent}
                    image={item.image}
                    symbol={item.symbol}
                    small
                  />
                  <span>
                    <b>{item.symbol}</b>
                    <small>{item.price}</small>
                  </span>
                  <em className={item.changeValue < 0 ? "loss" : "gain"}>{item.change}</em>
                </button>
              ))
            ) : (
              <p>No matching market</p>
            )}
          </div>
        )}
      </form>
      <div className="header-stats">
        <div>
          <span>BTC Dominance</span>
          <strong>
            {snapshot?.global.btcDominance != null
              ? `${snapshot.global.btcDominance.toFixed(2)}%`
              : "—"}{" "}
            <em>{status === "live" ? "LIVE" : status.toUpperCase()}</em>
          </strong>
        </div>
        <div>
          <span>Total Market Cap</span>
          <strong>
            {formatCompactCurrency(snapshot?.global.totalMarketCap)}{" "}
            <em className={(snapshot?.global.marketCapChange24h ?? 0) < 0 ? "loss" : "gain"}>
              {formatChange(snapshot?.global.marketCapChange24h)}
            </em>
          </strong>
        </div>
        <div>
          <span>24h Volume</span>
          <strong>
            {formatCompactCurrency(snapshot?.global.totalVolume)}{" "}
            <em className={(snapshot?.global.volumeChange24h ?? 0) < 0 ? "loss" : "gain"}>
              {formatChange(snapshot?.global.volumeChange24h)}
            </em>
          </strong>
        </div>
        <div className="fear-stat">
          <span>
            Fear &amp; Greed <small>{snapshot?.sources.sentiment ?? "Alternative.me"}</small>
          </span>
          <strong>
            <i className="mini-gauge" />
            {snapshot?.fearGreed?.value ?? "—"}{" "}
            <em>({snapshot?.fearGreed?.classification ?? "Loading"})</em>
          </strong>
        </div>
      </div>
      <div className="header-actions">
        <button
          className={`data-sync-state sync-${status}`}
          onClick={() => void refresh()}
          aria-label="Refresh live market data"
        >
          <span />
          <small>{status === "live" ? "5M LIVE" : status.toUpperCase()}</small>
        </button>
        <button onClick={() => navigate("Alerts")} aria-label="Open price alerts">
          <Bell size={16} />
          {alerts.filter((alert) => !alert.triggered).length > 0 && (
            <b>{alerts.filter((alert) => !alert.triggered).length}</b>
          )}
        </button>
        <button onClick={() => navigate("News Feed")} aria-label="Open news feed">
          <Mail size={16} />
        </button>
        <button
          className="profile-orb"
          onClick={() => navigate("Settings")}
          aria-label="Open preferences"
        >
          <UserRound size={22} />
        </button>
        <div className="profile-name">
          <strong>Portfolio Demo</strong>
          <span>Local workspace</span>
        </div>
      </div>
    </header>
  );
}

function LiveNow({
  notify,
  onSelectCoin,
  markets,
  status,
  updatedAt,
  source,
}: {
  notify: (text: string) => void;
  onSelectCoin: (symbol: string) => void;
  markets: MarketItem[];
  status: "connecting" | "live" | "stale" | "offline";
  updatedAt?: string;
  source?: string;
}) {
  const updateLabel = updatedAt
    ? new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--:--";
  return (
    <div className="live-strip">
      <span className="live-label" title={`${source ?? "Market feed"} · refreshed ${updateLabel}`}>
        <i className={status === "live" ? "" : "is-stale"} />
        LIVE DATA <small>{status === "live" ? updateLabel : status.toUpperCase()}</small>
      </span>
      <div className="live-window">
        <div className="live-track">
          {[...markets, ...markets].map((item, index) => (
            <button
              className="live-coin"
              tabIndex={index >= markets.length ? -1 : undefined}
              aria-hidden={index >= markets.length ? true : undefined}
              onClick={() => {
                onSelectCoin(item.symbol);
                notify(`${item.symbol} live market opened`);
              }}
              key={`${item.symbol}-${index}`}
            >
              <CoinBadge
                glyph={item.glyph}
                accent={item.accent}
                image={item.image}
                symbol={item.symbol}
                small
              />
              <strong>{item.symbol}</strong>
              <span>{item.price}</span>
              <em className={item.changeValue < 0 ? "loss" : "gain"}>{item.change}</em>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Sidebar({
  open,
  close,
  notify,
  snapshot,
  status,
  btcSeries,
  active,
  onSelect,
}: {
  open: boolean;
  close: () => void;
  notify: (text: string) => void;
  snapshot: MarketSnapshot | null;
  status: "connecting" | "live" | "stale" | "offline";
  btcSeries: number[];
  active: string;
  onSelect: (section: string) => void;
}) {
  const sidebarRef = useRef<HTMLElement>(null);
  useDialogFocus(open, sidebarRef, close);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 820px)");
    const update = () => {
      if (sidebarRef.current) sidebarRef.current.inert = mobile.matches && !open;
    };
    update();
    mobile.addEventListener("change", update);
    return () => mobile.removeEventListener("change", update);
  }, [open]);
  const change = snapshot?.global.marketCapChange24h ?? 0;
  const marketState = !snapshot
    ? "Loading"
    : snapshot.global.marketCapChange24h == null
      ? "Unavailable"
      : change >= 1
        ? "Bullish"
        : change <= -1
          ? "Bearish"
          : "Neutral";
  const feedLabel =
    status === "live"
      ? "Live"
      : status === "connecting"
        ? "Connecting"
        : status === "stale"
          ? "Stale cache"
          : "Offline";
  const feedPercent = status === "live" ? 100 : 0;
  return (
    <aside ref={sidebarRef} className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <button className="close-sidebar" onClick={close} aria-label="Close navigation">
        <X size={17} />
      </button>
      <nav aria-label="Main navigation">
        {nav.map(([label, Icon, badge]) => (
          <button
            key={label}
            aria-current={active === label ? "page" : undefined}
            className={active === label ? "active" : ""}
            onClick={() => {
              onSelect(label);
              close();
              notify(`${label} workspace selected`);
            }}
          >
            <Icon size={17} />
            <span>{label}</span>
            {badge && <b>{badge}</b>}
            {!badge && label !== "Dashboard" && <ChevronRight size={14} />}
          </button>
        ))}
      </nav>
      <Panel className="upgrade-panel" accent="pink">
        <PanelTitle title="Explore Signal Core" />
        <ul>
          <li>Technical &amp; derivatives analysis</li>
          <li>Optional AI news summaries</li>
          <li>Risk levels &amp; chart patterns</li>
          <li>Credit activity &amp; daily rewards</li>
          <li>Shareable signal cards</li>
        </ul>
        <button
          onClick={() => {
            onSelect("AI Insights");
            close();
          }}
        >
          Open AI Insights <WandSparkles size={12} />
        </button>
      </Panel>
      <Panel className="status-panel" accent="cyan">
        <span>Market Status</span>
        <strong className={change < 0 ? "loss" : "gain"}>{marketState}</strong>
        <Sparkline values={btcSeries} color={change < 0 ? "#ff335d" : "#00f6c6"} />
        <div>
          <span>Live Data Feed</span>
          <b>{feedLabel}</b>
          <em>5m cadence</em>
        </div>
        <i className="status-progress" style={{ width: `${feedPercent}%` }} />
      </Panel>
    </aside>
  );
}

function GlobalOverview({
  notify,
  snapshot,
  markets,
}: {
  notify: (text: string) => void;
  snapshot: MarketSnapshot | null;
  markets: MarketItem[];
}) {
  const [active, setActive] = useState("cap");
  const change = snapshot?.global.marketCapChange24h ?? 0;
  const volumeChange = snapshot?.global.volumeChange24h ?? 0;
  const composite =
    markets[0]?.values.map(
      (_, index) =>
        markets.reduce((sum, market) => sum + (market.values[index] ?? 50), 0) /
        Math.max(1, markets.length),
    ) ?? Array.from({ length: 18 }, () => 50);
  const volumes = (snapshot?.assets ?? []).slice(0, 20).map((asset) => asset.totalVolume);
  const maxVolume = Math.max(1, ...volumes);
  const trend = !snapshot
    ? "Loading"
    : snapshot.global.marketCapChange24h == null
      ? "Unavailable"
      : change >= 1
        ? "Bullish"
        : change <= -1
          ? "Bearish"
          : "Neutral";
  return (
    <Panel className="global-overview" accent="cyan">
      <PanelTitle
        title="GLOBAL MARKET OVERVIEW"
        action={
          <small className="data-source-note">
            {(snapshot?.sources.market ?? "CONNECTING").toUpperCase()}
            {snapshot?.stale ? " · STALE" : ""}
          </small>
        }
      />
      <button
        className={`overview-block metric-button ${active === "cap" ? "metric-active" : ""}`}
        onClick={() => {
          setActive("cap");
          notify("Global market cap selected");
        }}
      >
        <span>Market Cap</span>
        <strong>
          {formatCompactCurrency(snapshot?.global.totalMarketCap)}{" "}
          <em className={change < 0 ? "loss" : "gain"}>
            {formatChange(snapshot?.global.marketCapChange24h)}
          </em>
        </strong>
        <Sparkline values={composite} color="#00a9ff" />
      </button>
      <button
        className={`overview-block volume-block metric-button ${active === "volume" ? "metric-active" : ""}`}
        onClick={() => {
          setActive("volume");
          notify("24h volume selected");
        }}
      >
        <span>24h Volume</span>
        <strong>
          {formatCompactCurrency(snapshot?.global.totalVolume)}{" "}
          <em className={volumeChange < 0 ? "loss" : "gain"}>
            {formatChange(snapshot?.global.volumeChange24h)}
          </em>
        </strong>
        <span className="volume-bars">
          {(volumes.length ? volumes : Array.from({ length: 20 }, () => 0)).map((volume, index) => (
            <i key={index} style={{ height: `${Math.max(5, (volume / maxVolume) * 100)}%` }} />
          ))}
        </span>
      </button>
      <button
        className={`trend-meter metric-button ${active === "trend" ? "metric-active" : ""}`}
        onClick={() => {
          setActive("trend");
          notify("Live global trend selected");
        }}
      >
        <span>Market Trend</span>
        <strong className={change < 0 ? "loss" : "gain"}>{trend}</strong>
        <em className={change < 0 ? "loss" : "gain"}>
          {formatChange(snapshot?.global.marketCapChange24h)}
        </em>
        <span className="gauge">
          <i />
          <b />
        </span>
      </button>
    </Panel>
  );
}

function MomentumCard({
  item,
  period,
  notify,
}: {
  item: MarketItem;
  period: "1H" | "24H" | "7D";
  notify: (text: string) => void;
}) {
  const navigate = useContext(NavigationContext);
  const selectCoin = useContext(CoinSelectionContext);
  const change =
    period === "1H" ? item.change1h : period === "24H" ? item.changeValue : item.change7d;
  return (
    <button
      className={`prediction-card prediction-${item.accent}`}
      onClick={() => {
        selectCoin(item.symbol);
        navigate("Market Overview");
        notify(`${item.symbol} live ${period} momentum selected`);
      }}
    >
      <span className="prediction-head">
        <CoinBadge
          glyph={item.glyph}
          accent={item.accent}
          image={item.image}
          symbol={item.symbol}
        />
        <strong>{item.symbol}</strong>
        <small>/ USD</small>
      </span>
      <b>{item.price}</b>
      <em className={change < 0 ? "loss" : "gain"}>{item.asset ? formatChange(change) : "—"}</em>
      <span>{period} CHANGE</span>
      {item.asset && (
        <Sparkline
          values={item.values}
          color={
            item.accent === "orange" ? "#ff9b00" : item.accent === "blue" ? "#536cff" : "#00eaff"
          }
        />
      )}
    </button>
  );
}

function LiveMomentum({
  notify,
  markets,
}: {
  notify: (text: string) => void;
  markets: MarketItem[];
}) {
  const [period, setPeriod] = useState<"1H" | "24H" | "7D">("24H");
  return (
    <Panel className="predictions" accent="purple">
      <PanelTitle
        title="LIVE MOMENTUM"
        action={
          <span className="prediction-actions">
            <b className="beta">LIVE</b>
            {(["1H", "24H", "7D"] as const).map((value) => (
              <button
                key={value}
                className={period === value ? "active" : ""}
                onClick={() => setPeriod(value)}
              >
                {value}
              </button>
            ))}
          </span>
        }
      />
      <div className="prediction-grid">
        {markets.slice(0, 3).map((item) => (
          <MomentumCard item={item} period={period} notify={notify} key={item.symbol} />
        ))}
      </div>
    </Panel>
  );
}

function TrendingNow({
  notify,
  trending,
}: {
  notify: (text: string) => void;
  trending: TrendingAsset[];
}) {
  const navigate = useContext(NavigationContext);
  const selectCoin = useContext(CoinSelectionContext);
  const items = trending.slice(0, 4);
  return (
    <Panel className="events" accent="blue">
      <PanelTitle
        title="TRENDING NOW"
        action={<small className="data-source-note">TOP MOVERS · 24H</small>}
      />
      <div className="event-list">
        {items.length ? (
          items.map((item) => (
            <button
              className="event-row"
              onClick={() => {
                selectCoin(item.symbol);
                navigate("AI Insights");
                notify(`${item.name} market pulse selected`);
              }}
              key={item.id}
            >
              <CoinBadge
                glyph={item.symbol.slice(0, 1)}
                accent={marketConfig[item.symbol]?.accent ?? "purple"}
                image={coinIconUrl(item.symbol)}
                symbol={item.symbol}
              />
              <span>
                <strong>{item.symbol}</strong>
                <small>{item.name}</small>
              </span>
              <time className={(item.change24h ?? 0) < 0 ? "loss" : "gain"}>
                {item.change24h == null
                  ? `#${item.marketCapRank ?? "—"}`
                  : formatChange(item.change24h)}
              </time>
            </button>
          ))
        ) : (
          <div className="data-empty">Trending markets are not available yet</div>
        )}
      </div>
    </Panel>
  );
}

function Movers({
  type,
  notify,
  assets,
}: {
  type: "gainers" | "losers";
  notify: (text: string) => void;
  assets: LiveAsset[];
}) {
  const navigate = useContext(NavigationContext);
  const selectCoin = useContext(CoinSelectionContext);
  const data = [...assets]
    .filter((asset) => Number.isFinite(asset.change24h))
    .sort((a, b) => (type === "gainers" ? b.change24h - a.change24h : a.change24h - b.change24h))
    .slice(0, 5);
  return (
    <Panel className={`movers movers-${type}`} accent={type === "gainers" ? "cyan" : "pink"}>
      <PanelTitle title={`TOP ${type.toUpperCase()}`} />
      <div>
        {data.length ? (
          data.map((asset, index) => (
            <button
              className="mover-row"
              onClick={() => {
                selectCoin(asset.symbol);
                navigate("AI Insights");
                notify(`${asset.symbol}/USD market pulse selected`);
              }}
              key={asset.id}
            >
              <CoinBadge
                glyph={marketConfig[asset.symbol]?.glyph ?? asset.symbol.slice(0, 1)}
                accent={
                  marketConfig[asset.symbol]?.accent ??
                  (type === "gainers"
                    ? (["cyan", "red", "purple", "blue", "blue"][index] as Accent)
                    : (["blue", "orange", "red", "green", "blue"][index] as Accent))
                }
                image={asset.image || coinIconUrl(asset.symbol)}
                symbol={asset.symbol}
                small
              />
              <strong>
                {asset.symbol}
                <small>/ USD</small>
              </strong>
              <span>{formatPrice(asset.currentPrice)}</span>
              <em className={asset.change24h < 0 ? "loss" : "gain"}>
                {formatChange(asset.change24h)}
              </em>
            </button>
          ))
        ) : (
          <div className="data-empty">Live movers are not available yet</div>
        )}
      </div>
    </Panel>
  );
}

function Portfolio({ notify, assets }: { notify: (text: string) => void; assets: LiveAsset[] }) {
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [allocation, setAllocation] = useState("BTC");
  const dialogRef = useRef<HTMLElement>(null);
  const closePortfolio = useCallback(() => setExpanded(false), []);
  useDialogFocus(expanded, dialogRef, closePortfolio);
  const quantities: Record<string, number> = { BTC: 0.65, ETH: 7.5, SOL: 60, XRP: 2400, BNB: 5 };
  const holdings = Object.entries(quantities)
    .map(([symbol, quantity]) => ({
      symbol,
      quantity,
      asset: assets.find((item) => item.symbol === symbol),
    }))
    .filter((item) => item.asset) as { symbol: string; quantity: number; asset: LiveAsset }[];
  const totalValue = holdings.reduce(
    (sum, item) => sum + item.quantity * item.asset.currentPrice,
    0,
  );
  const previousValue = holdings.reduce(
    (sum, item) =>
      sum +
      (item.quantity * item.asset.currentPrice) / Math.max(0.05, 1 + item.asset.change24h / 100),
    0,
  );
  const delta = totalValue - previousValue;
  const portfolioChange = previousValue ? (delta / previousValue) * 100 : 0;
  const ranked = [...holdings].sort((a, b) => b.asset.change24h - a.asset.change24h);
  const best = ranked[0];
  const worst = ranked.at(-1);
  const allocationRows = holdings.map((item, index) => ({
    ...item,
    percent: totalValue ? ((item.quantity * item.asset.currentPrice) / totalValue) * 100 : 0,
    color: ["orange", "pink", "cyan", "blue", "violet"][index],
  }));
  let cursor = 0;
  const donutStops = allocationRows
    .map((item, index) => {
      const start = cursor;
      cursor += item.percent;
      const color = ["#ff9b00", "#f02be5", "#00eaff", "#2874ff", "#8252ff"][index];
      return `${color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    })
    .join(", ");
  const portfolioRaw = Array.from({ length: 20 }, (_, index) =>
    holdings.reduce((sum, item) => {
      const prices = item.asset.sparkline7d;
      const point =
        prices[Math.round((index * Math.max(0, prices.length - 1)) / 19)] ??
        item.asset.currentPrice;
      return sum + item.quantity * point;
    }, 0),
  );
  const portfolioSeries = normalizeSeries(portfolioRaw, 20);
  return (
    <Panel
      dialogRef={dialogRef}
      dialogLabel={expanded ? "Live demo portfolio" : undefined}
      className={`portfolio ${expanded ? "portfolio-fullscreen" : ""}`}
      accent="blue"
    >
      <PanelTitle
        title="LIVE DEMO PORTFOLIO"
        action={
          <span className="portfolio-actions">
            <button
              onClick={() => setHidden((value) => !value)}
              aria-label={hidden ? "Show values" : "Hide values"}
            >
              <Eye size={12} />
            </button>
            <button
              onClick={() => setExpanded((value) => !value)}
              aria-label={expanded ? "Exit fullscreen" : "Open fullscreen"}
            >
              {expanded ? <X size={12} /> : <Fullscreen size={12} />}
            </button>
          </span>
        }
      />
      <div className="portfolio-value">
        <span>Fixed holdings · live prices</span>
        <strong>
          {hidden ? "$•••,•••.••" : formatPrice(holdings.length ? totalValue : null)}{" "}
          <em className={portfolioChange < 0 ? "loss" : "gain"}>
            {formatChange(holdings.length ? portfolioChange : null)}
          </em>
        </strong>
      </div>
      {holdings.length > 0 && (
        <Sparkline values={portfolioSeries} color="#f044ff" className="portfolio-spark" />
      )}
      <div className="portfolio-facts">
        <p>
          <span>24h Change</span>
          <strong className={delta < 0 ? "loss" : "gain"}>
            {hidden ? "$••,•••.••" : formatSignedCurrency(holdings.length ? delta : null)}
          </strong>
        </p>
        <p>
          <span>Best Performer</span>
          <strong>
            {best ? (
              <>
                <CoinBadge
                  glyph={marketConfig[best.symbol]?.glyph ?? best.symbol[0]}
                  accent={marketConfig[best.symbol]?.accent ?? "cyan"}
                  image={best.asset.image || coinIconUrl(best.symbol)}
                  symbol={best.symbol}
                  small
                />
                {best.symbol}{" "}
                <em className={best.asset.change24h < 0 ? "loss" : "gain"}>
                  {formatChange(best.asset.change24h)}
                </em>
              </>
            ) : (
              "—"
            )}
          </strong>
        </p>
        <p>
          <span>Worst Performer</span>
          <strong>
            {worst ? (
              <>
                <CoinBadge
                  glyph={marketConfig[worst.symbol]?.glyph ?? worst.symbol[0]}
                  accent={marketConfig[worst.symbol]?.accent ?? "blue"}
                  image={worst.asset.image || coinIconUrl(worst.symbol)}
                  symbol={worst.symbol}
                  small
                />
                {worst.symbol}{" "}
                <em className={worst.asset.change24h < 0 ? "loss" : "gain"}>
                  {formatChange(worst.asset.change24h)}
                </em>
              </>
            ) : (
              "—"
            )}
          </strong>
        </p>
      </div>
      <div className="allocation">
        <button
          className="donut"
          style={donutStops ? { background: `conic-gradient(${donutStops})` } : undefined}
          onClick={() => notify(`${allocation} demo allocation selected`)}
          aria-label={`${allocation} demo allocation`}
        />
        <ul>
          {allocationRows.map((item) => (
            <li className={allocation === item.symbol ? "active" : ""} key={item.symbol}>
              <button onClick={() => setAllocation(item.symbol)}>
                <i className={item.color} />
                {item.symbol}
                <b>{item.percent.toFixed(0)}%</b>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <button
        className="wide-button"
        onClick={() => {
          setExpanded(true);
          notify("Live demo portfolio analytics opened");
        }}
      >
        View Live Valuation <ArrowRight size={12} />
      </button>
      {expanded && (
        <div className="portfolio-expanded-data">
          <h3>Live demo methodology</h3>
          <div>
            <span>Valuation source</span>
            <b>Live market snapshot</b>
          </div>
          <div>
            <span>Refresh cadence</span>
            <b>5 minutes</b>
          </div>
          <div>
            <span>Holdings mode</span>
            <b>Fixed demo quantities</b>
          </div>
        </div>
      )}
    </Panel>
  );
}

function QuickTools({ notify }: { notify: (text: string) => void }) {
  const navigate = useContext(NavigationContext);
  const tools: [string, LucideIcon, string][] = [
    ["Price Alerts", Bell, "Alerts"],
    ["Convert", Calculator, "Trade Tools"],
    ["Risk Calculator", Gauge, "Trade Tools"],
    ["Portfolio", PieChart, "Portfolio"],
    ["Scan Coins", ScanSearch, "Screener"],
    ["Macro Calendar", CalendarDays, "Calendar"],
    ["DeFi Scanner", Shield, "DeFi Scanner"],
    ["News Feed", Newspaper, "News Feed"],
  ];
  return (
    <Panel className="quick-tools" accent="pink">
      <PanelTitle title="QUICK TOOLS" />
      <div>
        {tools.map(([name, Icon, section]) => (
          <button
            key={name}
            onClick={() => {
              navigate(section);
              notify(`${name} opened`);
            }}
          >
            <Icon size={14} />
            <span>{name}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function PremiumMarketCard({
  item,
  active,
  onSelect,
  notify,
}: {
  item: MarketItem;
  active: boolean;
  onSelect: (symbol: string) => void;
  notify: (text: string) => void;
}) {
  const { has, toggle } = useWatchlist();
  const watching = has(item.symbol);
  const colors: Record<Accent, string> = {
    cyan: "#00eaff",
    blue: "#2c6dff",
    purple: "#784dff",
    pink: "#fa3bd7",
    orange: "#ff9b00",
    green: "#00f09b",
    red: "#ff335d",
  };
  return (
    <Panel
      className={`market-card premium-market-card ${active ? "market-active" : ""} ${watching ? "market-watching" : ""}`}
      accent={item.accent}
    >
      <div className="market-head">
        <CoinBadge
          glyph={item.glyph}
          accent={item.accent}
          image={item.image}
          symbol={item.symbol}
        />
        <button
          className="market-symbol"
          onClick={() => {
            onSelect(item.symbol);
            notify(`${item.symbol}/${item.pair} synchronized across the dashboard`);
          }}
        >
          <strong>{item.symbol}</strong>
          <small>/ {item.pair}</small>
        </button>
        <button
          className="market-watch-action"
          onClick={() => {
            toggle(item.symbol);
            notify(`${item.symbol} ${watching ? "removed from" : "added to"} watchlist`);
          }}
          aria-label={`${watching ? "Remove" : "Add"} ${item.symbol} watchlist`}
        >
          <Star size={12} fill={watching ? "currentColor" : "none"} />
        </button>
      </div>
      <strong className="market-price">{item.price}</strong>
      <em className={item.changeValue < 0 ? "loss" : "gain"}>{item.change}</em>
      <Sparkline values={item.values} color={colors[item.accent]} />
      {active && (
        <span className="market-live-badge">
          <i />
          LIVE
        </span>
      )}
    </Panel>
  );
}

function PremiumGlobeHero({
  selectedCoin,
  onSelectCoin,
  range,
  onRange,
  notify,
}: {
  selectedCoin: string;
  onSelectCoin: (symbol: string) => void;
  range: string;
  onRange: (range: string) => void;
  notify: (text: string) => void;
}) {
  const [paused, setPaused] = useState(false);
  const { settings } = useSettings();
  const markers = [
    { symbol: "BTC", glyph: "₿", className: "coin-btc" },
    { symbol: "ETH", glyph: "Ξ", className: "coin-eth" },
    { symbol: "SOL", glyph: "S", className: "coin-sol" },
    { symbol: "XRP", glyph: "X", className: "coin-xrp" },
    { symbol: "BNB", glyph: "◆", className: "coin-bnb" },
  ];
  return (
    <Panel className="globe-hero interactive-globe premium-globe" accent="blue">
      <ThreeGlobe
        selectedCoin={selectedCoin}
        range={range}
        paused={paused || settings.reduceMotion}
      />
      <div className="globe-vignette" />
      <div className="globe-scanline" />
      {markers.map((marker) => (
        <button
          key={marker.symbol}
          className={`globe-coin ${marker.className} ${selectedCoin === marker.symbol ? "active" : ""}`}
          onClick={() => {
            onSelectCoin(marker.symbol);
            notify(`${marker.symbol} intelligence synchronized`);
          }}
          aria-label={`Select ${marker.symbol} network`}
        >
          <CryptoOrbMark symbol={marker.symbol} glyph={marker.glyph} />
          <b>{marker.symbol}</b>
        </button>
      ))}
      <div className="time-controls">
        {["1H", "1D", "1W", "1M", "3M", "1Y", "ALL"].map((item) => (
          <button
            key={item}
            className={range === item ? "active" : ""}
            onClick={() => {
              onRange(item);
              notify(`Global range set to ${item}`);
            }}
          >
            {item}
          </button>
        ))}
        <button
          className={`customize ${paused ? "active" : ""}`}
          onClick={() => {
            setPaused((value) => !value);
            notify(paused ? "3D globe rotation resumed" : "3D globe rotation paused");
          }}
        >
          {paused ? "Resume" : "Pause"} <Settings size={11} />
        </button>
      </div>
    </Panel>
  );
}

function PremiumMarketTrend({
  selectedCoin,
  range,
  onRange,
  onSelectCoin,
  markets,
}: {
  selectedCoin: string;
  range: string;
  onRange: (range: string) => void;
  onSelectCoin: (symbol: string) => void;
  markets: MarketItem[];
}) {
  const [view, setView] = useState<"flow" | "candles">("flow");
  const [hover, setHover] = useState<number | null>(null);
  const ranges = ["1H", "1D", "1W", "1M", "1Y", "ALL"];
  const flowMarkets = markets.slice(0, 4);
  const lineData = flowMarkets.map((market) => market.values);
  const colors = ["#ff9800", "#456cff", "#00dff3", "#e43cff"];
  const hoverIndex =
    hover === null
      ? 0
      : Math.min(
          Math.max(0, (lineData[0]?.length ?? 1) - 1),
          Math.round((hover / 100) * Math.max(0, (lineData[0]?.length ?? 1) - 1)),
        );
  return (
    <Panel className="market-trend premium-chart-panel reference-trend" accent="purple">
      <PanelTitle
        title="MARKET TREND"
        action={
          <div className="trend-title-actions">
            <button
              className="chart-view-toggle"
              onClick={() => setView((value) => (value === "flow" ? "candles" : "flow"))}
              aria-label={
                view === "flow" ? "Show live price history" : "Show seven-day market flow"
              }
            >
              {view === "flow" ? <ChartCandlestick size={11} /> : <LineChart size={11} />}
            </button>
            {view === "candles" ? (
              <div className="tiny-tabs">
                {ranges.map((item) => (
                  <button
                    key={item}
                    onClick={() => onRange(item)}
                    className={range === item ? "active" : ""}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : (
              <small className="data-source-note">7D LIVE FLOW</small>
            )}
          </div>
        }
      />
      {view === "candles" ? (
        <MarketChart
          key={`${selectedCoin}-${range}`}
          id={
            markets.find((item) => item.symbol === selectedCoin)?.id ??
            marketConfig[selectedCoin]?.id ??
            selectedCoin.toLowerCase()
          }
          symbol={selectedCoin}
          range={range}
        />
      ) : (
        <>
          <div
            className="multi-chart premium-flow-chart"
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setHover(
                Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
              );
            }}
            onPointerLeave={() => setHover(null)}
          >
            {lineData.map((line, index) => (
              <Sparkline key={flowMarkets[index].symbol} values={line} color={colors[index]} />
            ))}
            <div className="trend-legend">
              {flowMarkets.map((item, index) => (
                <button
                  key={item.symbol}
                  className={selectedCoin === item.symbol ? "active" : ""}
                  onClick={() => onSelectCoin(item.symbol)}
                >
                  <i style={{ background: colors[index], boxShadow: `0 0 7px ${colors[index]}` }} />
                  <span>{item.symbol}</span>
                  <b className={item.changeValue < 0 ? "loss" : "gain"}>{item.change}</b>
                </button>
              ))}
            </div>
            {hover !== null && (
              <div className="trend-crosshair" style={{ left: `${hover}%` }}>
                <span>
                  <b>7D NORMALIZED INDEX</b>
                  {flowMarkets.map((item, index) => (
                    <em key={item.symbol} style={{ color: colors[index] }}>
                      {item.symbol} {lineData[index]?.[hoverIndex]?.toFixed(1) ?? "—"}
                    </em>
                  ))}
                </span>
              </div>
            )}
          </div>
          <div className="chart-hours">
            <span>7D AGO</span>
            <span>6D</span>
            <span>5D</span>
            <span>4D</span>
            <span>3D</span>
            <span>2D</span>
            <span>1D</span>
            <span>12H</span>
            <span>NOW</span>
          </div>
        </>
      )}
    </Panel>
  );
}

function signalVisitorId() {
  const key = "top-crypto-signal-visitor";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9-]{12,80}$/.test(existing)) return existing;
    const created = window.crypto.randomUUID();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    // Blocked storage still needs a unique visitor, rather than a shared wallet.
    return `session-${window.crypto.randomUUID()}`;
  }
}

function formatCountdown(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

// Share cards deliberately omit private wallet and credit details.
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(" ");
  let line = "";
  let lines = 0;
  let cursorY = y;
  for (let i = 0; i < words.length; i += 1) {
    const testLine = `${line}${words[i]} `;
    if (ctx.measureText(testLine).width > maxWidth && line !== "") {
      if (lines >= maxLines - 1) {
        ctx.fillText(`${line.trim()}…`, x, cursorY);
        return;
      }
      ctx.fillText(line, x, cursorY);
      line = `${words[i]} `;
      cursorY += lineHeight;
      lines += 1;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, cursorY);
}

function renderShareCanvas(analysis: SignalAnalysis): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 560;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const directionColor =
    analysis.direction === "LONG"
      ? "#00efb5"
      : analysis.direction === "SHORT"
        ? "#ff5c5c"
        : "#9aa8c4";

  const bgGradient = ctx.createLinearGradient(0, 0, 1000, 560);
  bgGradient.addColorStop(0, "#0a0f24");
  bgGradient.addColorStop(1, "#04060f");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, 1000, 560);
  ctx.strokeStyle = "rgba(120,140,200,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, 952, 512);

  ctx.fillStyle = "#7688a3";
  ctx.font = "600 20px monospace";
  ctx.fillText("CRYPTOWORLD · CONVERGENCE ENGINE", 60, 90);

  ctx.fillStyle = "#e7edf9";
  ctx.font = "800 56px sans-serif";
  ctx.fillText(`${analysis.symbol}/USDT`, 60, 165);

  ctx.fillStyle = "#7688a3";
  ctx.font = "600 22px monospace";
  ctx.fillText(SIGNAL_TIMEFRAMES[analysis.timeframe].label.toUpperCase(), 60, 198);

  ctx.fillStyle = `${directionColor}22`;
  ctx.strokeStyle = directionColor;
  ctx.lineWidth = 2;
  roundRect(ctx, 60, 228, 360, 62, 30);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = directionColor;
  ctx.font = "800 28px monospace";
  ctx.fillText(`${analysis.direction} BIAS`, 92, 268);

  ctx.fillStyle = "#e7edf9";
  ctx.font = "700 28px sans-serif";
  ctx.fillText(`${analysis.confidence}% confidence`, 60, 342);

  ctx.fillStyle = directionColor;
  ctx.font = "800 42px monospace";
  ctx.fillText(`${analysis.score > 0 ? "+" : ""}${analysis.score}`, 60, 412);
  ctx.fillStyle = "#7688a3";
  ctx.font = "600 18px monospace";
  ctx.fillText("CONVERGENCE SCORE", 60, 437);

  ctx.fillStyle = "#b8c5d8";
  ctx.font = "500 20px sans-serif";
  wrapText(ctx, analysis.thesis, 60, 470, 880, 27, 3);

  ctx.fillStyle = "#5c6c88";
  ctx.font = "500 16px monospace";
  ctx.fillText(
    `Not financial advice — educational signal · ${new Date(analysis.updatedAt).toLocaleDateString()}`,
    60,
    520,
  );

  return canvas;
}

function SignalIntelligenceCore({
  selectedCoin,
  asset,
  notify,
}: {
  selectedCoin: string;
  asset: LiveAsset | null;
  notify: (text: string) => void;
}) {
  const [timeframe, setTimeframe] = useState<SignalTimeframe>("1h");
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [completedAnalysis, setAnalysis] = useState<SignalAnalysis | null>(null);
  const analysis = completedAnalysis?.timeframe === timeframe ? completedAnalysis : null;
  const [trackRecord, setTrackRecord] = useState<PublicTrackRecord | null>(null);
  const [globalTrackRecord, setGlobalTrackRecord] = useState<PublicTrackRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const visitor = useRef("");
  const request = useRef<AbortController | null>(null);
  const active = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeDialog = useCallback(() => setExpanded(false), []);
  const cost = SIGNAL_TIMEFRAMES[timeframe].creditCost;
  const supported = SIGNAL_SYMBOLS.some((symbol) => symbol === selectedCoin);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  useDialogFocus(expanded, dialogRef, closeDialog);

  const loadWallet = useCallback(
    async (signal?: AbortSignal) => {
      if (!visitor.current) visitor.current = signalVisitorId();
      const response = await fetch("/api/credits", {
        headers: { "x-signal-visitor": visitor.current },
        signal,
      });
      if (!response.ok) throw new Error("Credit wallet unavailable");
      const data = (await response.json()) as CreditWallet;
      if (!active.current || signal?.aborted) return;
      setWallet(data);
      if (data.dailyClaim?.claimed) {
        const streakText =
          data.dailyClaim.streakDays > 1 ? ` · day ${data.dailyClaim.streakDays} streak` : "";
        notify(
          `+${data.dailyClaim.granted} free credit${data.dailyClaim.granted > 1 ? "s" : ""}${streakText}`,
        );
      }
    },
    [notify],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadWallet(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("Credit wallet is reconnecting…");
    });
    return () => controller.abort();
  }, [loadWallet]);

  // Tracked results come from resolved signals, not the separate candle replay.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/track-record", { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<PublicTrackRecord>) : null))
      .then((data) => {
        if (data && !controller.signal.aborted) setGlobalTrackRecord(data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const trackedSymbol = analysis?.symbol ?? selectedCoin;
    const trackedTimeframe = analysis?.timeframe ?? timeframe;
    fetch(`/api/track-record?symbol=${trackedSymbol}&timeframe=${trackedTimeframe}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? (response.json() as Promise<PublicTrackRecord>) : null))
      .then((data) => {
        if (data && !controller.signal.aborted) setTrackRecord(data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [analysis, selectedCoin, timeframe]);

  useEffect(() => {
    if (!analysis) return;
    const deadline = Date.parse(analysis.updatedAt) + analysis.countdownSeconds * 1000;
    const timer = window.setInterval(
      () => setCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [analysis]);

  const runAnalysis = async () => {
    if (loading || request.current || !supported) return;
    if (wallet && wallet.balance < cost) {
      setError(`Insufficient credits — ${cost} required, ${wallet.balance} available.`);
      notify("Signal Core needs more credits");
      return;
    }
    setLoading(true);
    setLoadingHint(false);
    setError("");
    const hintTimer = window.setTimeout(() => setLoadingHint(true), 4000);
    const controller = new AbortController();
    request.current = controller;
    const timeoutTimer = window.setTimeout(() => controller.abort(), 60_000);
    try {
      if (!visitor.current) visitor.current = signalVisitorId();
      const response = await fetch("/api/signal-analysis", {
        method: "POST",
        headers: { "content-type": "application/json", "x-signal-visitor": visitor.current },
        body: JSON.stringify({ symbol: selectedCoin, timeframe }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as SignalAnalysis & {
        error?: string;
        balance?: number;
      };
      if (!response.ok) throw new Error(payload.error ?? "Signal analysis failed");
      if (!active.current || controller.signal.aborted) return;
      setAnalysis(payload);
      setCountdown(payload.countdownSeconds);
      setWallet((current) =>
        current
          ? {
              ...current,
              balance: payload.balance,
              lifetimeSpent: current.lifetimeSpent + payload.creditCost,
              history: [
                {
                  id: payload.id,
                  symbol: payload.symbol,
                  timeframe: payload.timeframe,
                  creditCost: payload.creditCost,
                  direction: payload.direction,
                  score: payload.score,
                  confidence: payload.confidence,
                  provider: payload.provider,
                  createdAt: payload.updatedAt,
                },
                ...current.history,
              ].slice(0, 5),
            }
          : current,
      );
      notify(`${payload.symbol} ${payload.timeframe.toUpperCase()} intelligence complete`);
    } catch (runError) {
      if (!active.current) return;
      const isTimeout = runError instanceof DOMException && runError.name === "AbortError";
      setError(
        isTimeout
          ? "Signal analysis timed out after 60s — please try again."
          : runError instanceof Error
            ? runError.message
            : "Signal analysis failed",
      );
      loadWallet().catch(() => undefined);
    } finally {
      window.clearTimeout(hintTimer);
      window.clearTimeout(timeoutTimer);
      request.current = null;
      if (active.current) {
        setLoadingHint(false);
        setLoading(false);
      }
    }
  };

  const handleShare = useCallback(async () => {
    if (!analysis) return;
    try {
      const payload = {
        s: analysis.symbol,
        t: analysis.timeframe,
        d: analysis.direction,
        c: analysis.confidence,
        sc: analysis.score,
        th: analysis.thesis.slice(0, 240),
        at: analysis.updatedAt,
      };
      const encoded = encodeSharePayload(payload);
      const shareUrl = `${window.location.origin}/share?d=${encoded}`;
      const shareText = `${analysis.symbol} ${SIGNAL_TIMEFRAMES[analysis.timeframe].label} — ${analysis.direction} bias (${analysis.confidence}% confidence) via CryptoWorld`;

      const canvas = renderShareCanvas(analysis);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      const file = blob
        ? new File([blob], `${analysis.symbol}-${analysis.timeframe}-signal.png`, {
            type: "image/png",
          })
        : null;

      if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            title: shareText,
            text: shareText,
            url: shareUrl,
            files: [file],
          });
          return;
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === "AbortError") return;
          // user dismissed the native share sheet — fall back to link + download below
        }
      }

      try {
        await navigator.clipboard.writeText(shareUrl);
        notify("Share link copied to clipboard");
      } catch {
        notify("Clipboard unavailable — the signal card will download instead");
      }

      if (blob) {
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = `${analysis.symbol}-${analysis.timeframe}-signal.png`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    } catch {
      notify("Couldn't generate the share card — please try again");
    }
  }, [analysis, notify]);

  const direction = analysis?.direction ?? "READY";
  const coreColor =
    direction === "LONG" ? "#00f5a4" : direction === "SHORT" ? "#ff335d" : "#21d9ff";
  const activeLayerWeight = analysis
    ? 30 + (analysis.derivatives.score == null ? 0 : 30) + (analysis.news.score == null ? 0 : 40)
    : 100;
  const hasAiNews =
    !!analysis && analysis.provider !== "Deterministic fallback" && analysis.news.score != null;
  const layers = [
    {
      label: "TECHNICAL",
      weight: `${Math.round((30 / activeLayerWeight) * 100)}%`,
      score: analysis?.technical.score ?? null,
      icon: BarChart3,
    },
    {
      label: "DERIVATIVES",
      weight:
        analysis && analysis.derivatives.score == null
          ? "N/A"
          : `${Math.round((30 / activeLayerWeight) * 100)}%`,
      score: analysis?.derivatives.score ?? null,
      icon: Radio,
    },
    {
      label: "AI NEWS",
      weight:
        analysis && analysis.news.score == null
          ? "N/A"
          : `${Math.round((40 / activeLayerWeight) * 100)}%`,
      score: analysis?.news.score ?? null,
      icon: BrainCircuit,
    },
  ];
  const compactThesis =
    analysis?.thesis ??
    `${selectedCoin} is synchronized with the live market feed. Activate the convergence engine for technical, derivatives and AI news analysis.`;

  return (
    <Panel
      className={`signal-core ${expanded ? "signal-core-expanded" : ""} ${loading ? "signal-core-loading" : ""}`}
      accent="purple"
    >
      <PanelTitle
        title="SIGNAL INTELLIGENCE CORE"
        icon={BrainCircuit}
        action={
          <div className="core-title-actions">
            <span
              className="core-engine-live"
              title={analysis?.provider ?? "Technical analysis works without AI credentials"}
            >
              <i />
              {analysis?.provider === "Deterministic fallback"
                ? "TECHNICAL MODE"
                : analysis
                  ? "AI ENGINE"
                  : "ENGINE READY"}
            </span>
            {globalTrackRecord && globalTrackRecord.sampleSize >= 10 && (
              <span
                className="core-track-record"
                title={`${globalTrackRecord.sampleSize} resolved signals over the last ${globalTrackRecord.windowDays} days, site-wide`}
              >
                <ShieldCheck size={11} />
                <b>{globalTrackRecord.hitRatePct}%</b> hit rate · N={globalTrackRecord.sampleSize}
              </span>
            )}
            {wallet && wallet.streakDays >= 2 && (
              <span
                className="streak-badge"
                title={`${wallet.streakDays}-day daily streak — come back tomorrow to keep it going`}
              >
                🔥<b>{wallet.streakDays}</b>d
              </span>
            )}
            <span className="credit-wallet">
              <Coins size={11} />
              <b>{wallet?.balance ?? "—"}</b> CREDITS
            </span>
          </div>
        }
      />
      <div className="signal-core-toolbar">
        <div className="core-asset">
          <CoinBadge
            glyph={marketConfig[selectedCoin]?.glyph ?? selectedCoin[0]}
            accent={marketConfig[selectedCoin]?.accent ?? "cyan"}
            image={asset?.image || coinIconUrl(selectedCoin)}
            symbol={selectedCoin}
            small
          />
          <span>
            <b>{selectedCoin}/USDT</b>
            <small>{asset ? formatPrice(asset.currentPrice) : "SYNCING"}</small>
          </span>
        </div>
        <div className="core-timeframes">
          {(Object.keys(SIGNAL_TIMEFRAMES) as SignalTimeframe[]).map((value) => (
            <button
              key={value}
              disabled={loading}
              aria-pressed={timeframe === value}
              className={timeframe === value ? "active" : ""}
              onClick={() => setTimeframe(value)}
            >
              {SIGNAL_TIMEFRAMES[value].label}
              <small>{SIGNAL_TIMEFRAMES[value].creditCost}C</small>
            </button>
          ))}
        </div>
        <button
          className="core-run"
          disabled={loading || !asset || !supported}
          onClick={runAnalysis}
        >
          {loading ? (
            <>
              <i className="core-spinner" />
              {loadingHint ? "COLLECTING LIVE CHANNELS" : "ANALYZING CHANNELS"}
            </>
          ) : (
            <>
              <Zap size={12} />
              {supported ? `ACTIVATE · ${cost} CREDITS` : "ANALYSIS NOT SUPPORTED"}
            </>
          )}
        </button>
      </div>
      <div className="signal-core-body">
        <div className="core-score-block">
          <div
            className="core-score-ring"
            style={
              {
                "--core-score": `${Math.max(4, analysis ? analysis.confidence : 18) * 3.6}deg`,
                "--core-color": coreColor,
              } as CSSProperties
            }
          >
            <img src="/aiinsights.png" alt="Signal confidence" className="core-score-ring-img" />
          </div>
          <div>
            <strong style={{ color: coreColor }}>{direction}</strong>
            <span>{analysis ? `${analysis.confidence}% CONFIDENCE` : "AWAITING ACTIVATION"}</span>
            {analysis && <small>NEXT CYCLE {formatCountdown(countdown)}</small>}
          </div>
        </div>
        <div className="core-layer-stack">
          {layers.map(({ label, weight, score: layerScore, icon: Icon }) => (
            <div className="core-layer" key={label}>
              <span>
                <Icon size={11} />
                <b>{label}</b>
                <small>{weight}</small>
              </span>
              <i>
                <b
                  style={{
                    width: `${layerScore == null ? 8 : Math.max(3, Math.min(100, (layerScore + 100) / 2))}%`,
                    background:
                      layerScore == null
                        ? "#29466f"
                        : layerScore >= 0
                          ? "linear-gradient(90deg,#126dff,#00f5cf)"
                          : "linear-gradient(90deg,#8c24ff,#ff335d)",
                  }}
                />
              </i>
              <em className={layerScore == null ? "" : layerScore < 0 ? "loss" : "gain"}>
                {layerScore == null
                  ? analysis
                    ? "N/A"
                    : "READY"
                  : `${layerScore > 0 ? "+" : ""}${layerScore}`}
              </em>
            </div>
          ))}
        </div>
        <div className="core-thesis">
          <span>CONVERGENCE THESIS</span>
          <p>{compactThesis}</p>
          <div className="core-trade-levels">
            <span>
              <small>MARK</small>
              <b>{analysis ? formatPrice(analysis.mark) : "—"}</b>
            </span>
            <span>
              <small>TARGET</small>
              <b>{analysis?.takeProfit ? formatPrice(analysis.takeProfit) : "—"}</b>
            </span>
            <span>
              <small>STOP</small>
              <b>{analysis?.stopLoss ? formatPrice(analysis.stopLoss) : "—"}</b>
            </span>
          </div>
          <button disabled={!analysis} onClick={() => setExpanded(true)}>
            OPEN FULL ANALYSIS <ArrowRight size={11} />
          </button>
        </div>
      </div>
      {!supported && (
        <div className="core-error">
          Signal analysis supports {SIGNAL_SYMBOLS.join(", ")}. Live market metrics remain available
          for {selectedCoin}.
        </div>
      )}
      {error && (
        <div className="core-error" role="alert">
          <TriangleAlert size={11} />
          {error}
        </div>
      )}
      {expanded &&
        analysis &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="signal-lab-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${analysis.symbol} full signal analysis`}
            onClick={(event) => {
              if (event.target === event.currentTarget) setExpanded(false);
            }}
          >
            <div className="signal-lab-shell">
              <header>
                <div>
                  <span className="analysis-kicker">CRYPTOWORLD · CONVERGENCE ENGINE</span>
                  <h2>
                    {analysis.symbol}/USDT <em>{SIGNAL_TIMEFRAMES[analysis.timeframe].label}</em>
                  </h2>
                  <p>
                    {new Date(analysis.updatedAt).toLocaleString()} · {analysis.provider}
                  </p>
                </div>
                <div className="lab-credit">
                  <Coins size={14} />
                  <span>
                    <b>{analysis.balance}</b> credits remaining
                  </span>
                </div>
                <button
                  className="share-signal-btn"
                  onClick={handleShare}
                  aria-label="Share this signal"
                >
                  <Share2 size={14} />
                  Share
                </button>
                <button data-dialog-close onClick={closeDialog} aria-label="Close full analysis">
                  <X size={18} />
                </button>
              </header>
              <div className="signal-lab-grid">
                <section className="lab-verdict">
                  <div
                    className="lab-verdict-score"
                    style={{ "--core-color": coreColor } as CSSProperties}
                  >
                    <span>{analysis.score > 0 ? `+${analysis.score}` : analysis.score}</span>
                    <small>CONVERGENCE</small>
                  </div>
                  <div>
                    <span>ENGINE VERDICT</span>
                    <h3 style={{ color: coreColor }}>{analysis.direction}</h3>
                    <b>
                      {analysis.confidence}% confidence
                      {analysis.confidenceCalibrated && (
                        <small
                          className="calibration-note"
                          title={`Raw formula output was ${analysis.rawConfidence}% — adjusted to match this bucket's real historical hit rate.`}
                        >
                          {" "}
                          · calibrated from {analysis.rawConfidence}%
                        </small>
                      )}
                    </b>
                    <p>{analysis.thesis}</p>
                  </div>
                  <div className="lab-buy-sell">
                    <span style={{ width: `${analysis.buyPct}%` }}>BUY {analysis.buyPct}%</span>
                    <em style={{ width: `${analysis.sellPct}%` }}>SELL {analysis.sellPct}%</em>
                  </div>
                </section>
                <section className="lab-channel">
                  <h3>
                    <BarChart3 size={14} /> TECHNICAL · {layers[0].weight}
                  </h3>
                  <div className="lab-metric-grid">
                    <span>
                      <small>SCORE</small>
                      <b>
                        {analysis.technical.score > 0 ? "+" : ""}
                        {analysis.technical.score}
                      </b>
                    </span>
                    <span>
                      <small>RSI 14</small>
                      <b>{analysis.technical.rsi.toFixed(1)}</b>
                    </span>
                    <span>
                      <small>EMA 20</small>
                      <b>{formatPrice(analysis.technical.ema20)}</b>
                    </span>
                    <span>
                      <small>EMA 50</small>
                      <b>{formatPrice(analysis.technical.ema50)}</b>
                    </span>
                    <span>
                      <small>MACD HIST</small>
                      <b>{analysis.technical.macdHistogram.toFixed(4)}</b>
                    </span>
                    <span>
                      <small>ATR</small>
                      <b>{formatPrice(analysis.technical.atr)}</b>
                    </span>
                    <span>
                      <small>24H VOLUME</small>
                      <b>{formatCompactCurrency(analysis.technical.volume24h)}</b>
                    </span>
                    <span>
                      <small>VOLUME Δ</small>
                      <b>{formatChange(analysis.technical.volumeChangePct)}</b>
                    </span>
                    <span>
                      <small>REGIME</small>
                      <b className={analysis.technical.regime === "trending" ? "gain" : ""}>
                        {analysis.technical.regime === "trending" ? "Trending" : "Choppy"} (
                        {analysis.technical.efficiencyRatio.toFixed(2)})
                      </b>
                    </span>
                    <span>
                      <small>VOLATILITY</small>
                      <b>
                        {analysis.technical.volatilityLevel[0].toUpperCase() +
                          analysis.technical.volatilityLevel.slice(1)}
                      </b>
                    </span>
                  </div>
                </section>
                <section className="lab-channel">
                  <h3>
                    <Radio size={14} /> DERIVATIVES · {layers[1].weight}
                  </h3>
                  <div className="lab-metric-grid">
                    <span>
                      <small>SCORE</small>
                      <b>
                        {analysis.derivatives.score == null
                          ? "N/A"
                          : `${analysis.derivatives.score > 0 ? "+" : ""}${analysis.derivatives.score}`}
                      </b>
                    </span>
                    <span>
                      <small>FUNDING</small>
                      <b>
                        {analysis.derivatives.fundingPct == null
                          ? "N/A"
                          : `${analysis.derivatives.fundingPct.toFixed(4)}%`}
                      </b>
                    </span>
                    <span>
                      <small>OPEN INTEREST</small>
                      <b>
                        {analysis.derivatives.oiChangePct == null
                          ? "N/A"
                          : formatChange(analysis.derivatives.oiChangePct)}
                      </b>
                    </span>
                    <span>
                      <small>LONG / SHORT</small>
                      <b>
                        {analysis.derivatives.longPct == null
                          ? "N/A"
                          : `${analysis.derivatives.longPct.toFixed(0)} / ${analysis.derivatives.shortPct?.toFixed(0)}`}
                      </b>
                    </span>
                  </div>
                  <p>{analysis.derivatives.note}</p>
                </section>
                <section className="lab-ai-news">
                  <h3>
                    <BrainCircuit size={14} /> {hasAiNews ? "AI NEWS INTELLIGENCE" : "NEWS CONTEXT"}{" "}
                    · {layers[2].weight}
                  </h3>
                  <div className="lab-ai-head">
                    <strong
                      className={
                        analysis.news.sentiment === "Bearish"
                          ? "loss"
                          : analysis.news.sentiment === "Bullish"
                            ? "gain"
                            : ""
                      }
                    >
                      {hasAiNews
                        ? analysis.news.sentiment.toUpperCase()
                        : "AI ANALYSIS UNAVAILABLE"}
                    </strong>
                    <span>
                      {hasAiNews
                        ? `${analysis.news.confidence}% model confidence · impact ${analysis.news.impact}/9`
                        : "No model output · live headlines remain available"}
                    </span>
                  </div>
                  {analysis.news.ensemble.agreement === "disagree" && (
                    <div className="lab-ensemble-flag disagree">
                      <TriangleAlert size={12} />
                      <span>
                        AI models disagree — lower conviction. {analysis.news.ensemble.note}
                      </span>
                    </div>
                  )}
                  {analysis.news.ensemble.agreement === "agree" &&
                    analysis.news.ensemble.ranSecondOpinion && (
                      <div className="lab-ensemble-flag agree">
                        <ShieldCheck size={12} />
                        <span>
                          Confirmed by a second model ({analysis.news.ensemble.secondaryProvider}).
                        </span>
                      </div>
                    )}
                  <p>{analysis.news.summary}</p>
                  <ul>
                    {analysis.news.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {analysis.news.headlines.length > 0 && (
                    <div className="lab-headlines">
                      {analysis.news.headlines.slice(0, 3).map((item) => (
                        <a
                          href={item.url || undefined}
                          target="_blank"
                          rel="noreferrer"
                          key={`${item.source}-${item.title}`}
                        >
                          <small>{item.source}</small>
                          <span>{item.title}</span>
                          <ArrowRight size={10} />
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="lab-trigger">
                    <span>
                      <small>CATALYST</small>
                      {analysis.news.catalyst}
                    </span>
                    <span>
                      <small>INVALIDATION</small>
                      {analysis.news.invalidation}
                    </span>
                  </div>
                </section>
                <section className="lab-risk">
                  <h3>
                    <Shield size={14} /> RISK & EXECUTION
                  </h3>
                  <div className="lab-metric-grid">
                    <span>
                      <small>MARK</small>
                      <b>{formatPrice(analysis.mark)}</b>
                    </span>
                    <span>
                      <small>SUPPORT</small>
                      <b>{analysis.support ? formatPrice(analysis.support) : "N/A"}</b>
                    </span>
                    <span>
                      <small>RESISTANCE</small>
                      <b>{analysis.resistance ? formatPrice(analysis.resistance) : "N/A"}</b>
                    </span>
                    <span>
                      <small>REWARD / RISK</small>
                      <b>
                        {analysis.safety.rewardRisk == null
                          ? "N/A"
                          : `${analysis.safety.rewardRisk.toFixed(2)}:1`}
                      </b>
                    </span>
                    <span>
                      <small>BOOK IMBALANCE</small>
                      <b>
                        {analysis.safety.orderBookImbalance == null
                          ? "N/A"
                          : analysis.safety.orderBookImbalance.toFixed(2)}
                      </b>
                    </span>
                    <span>
                      <small>SPREAD</small>
                      <b>
                        {analysis.safety.spreadPct == null
                          ? "N/A"
                          : `${analysis.safety.spreadPct.toFixed(3)}%`}
                      </b>
                    </span>
                    <span>
                      <small>HISTORICAL REPLAY</small>
                      <b>
                        {analysis.historicalReplay.hitRate.toFixed(0)}% ·{" "}
                        {analysis.historicalReplay.sampleSize}
                      </b>
                    </span>
                    <span>
                      <small>TRACK RECORD (LIVE)</small>
                      <b
                        className={
                          trackRecord && trackRecord.sampleSize >= 10
                            ? trackRecord.hitRatePct! >= 50
                              ? "gain"
                              : "loss"
                            : ""
                        }
                      >
                        {!trackRecord
                          ? "Loading…"
                          : trackRecord.sampleSize >= 10
                            ? `${trackRecord.hitRatePct}% · N=${trackRecord.sampleSize}`
                            : `Building · N=${trackRecord.sampleSize}`}
                      </b>
                    </span>
                  </div>
                  <div className="lab-replay-dots">
                    {analysis.historicalReplay.outcomes.map((hit, index) => (
                      <i className={hit ? "hit" : "miss"} key={`${hit}-${index}`} />
                    ))}
                    <span>
                      EMA trend replay on real historical candles — not a live track record.
                    </span>
                  </div>
                  <div className="lab-replay-dots">
                    <ShieldCheck size={11} />
                    <span>
                      {trackRecord && trackRecord.sampleSize >= 10
                        ? `Live track record: this exact ${analysis.symbol}/${SIGNAL_TIMEFRAMES[analysis.timeframe].label} setup has resolved ${trackRecord.sampleSize} real signals over the last ${trackRecord.windowDays} days, with ${trackRecord.hitRatePct}% successful outcomes (target-first or deadline-direction resolution).`
                        : `Building a real track record for this setup — ${trackRecord ? trackRecord.sampleSize : 0} signal(s) resolved so far. Needs at least 10 before we show a hit rate.`}
                    </span>
                  </div>
                  <div
                    className={`lab-safety-state ${analysis.safety.frozen || analysis.safety.riskVeto ? "warning" : "safe"}`}
                  >
                    <i />
                    {analysis.safety.frozen
                      ? analysis.safety.reasons.join(" · ")
                      : analysis.safety.riskVeto
                        ? "Risk veto active — reward/risk below 2:1"
                        : "All systemic safety checks passed"}
                  </div>
                </section>

                <section className="lab-patterns">
                  <h3>
                    <Shapes size={14} /> CHART PATTERNS{" "}
                    <small className="rule-based-tag">rule-based, not AI</small>
                  </h3>
                  {analysis.chartPatterns.length ? (
                    <div className="pattern-list">
                      {analysis.chartPatterns.map((pattern, index) => (
                        <div
                          className={`pattern-card ${pattern.direction}`}
                          key={`${pattern.type}-${index}`}
                        >
                          <div className="pattern-head">
                            <span className="pattern-type">{pattern.type}</span>
                            <span className={`pattern-status ${pattern.status}`}>
                              {pattern.status === "confirmed" ? "✓ Confirmed" : "Forming"}
                            </span>
                          </div>
                          <p>{pattern.description}</p>
                          <div className="pattern-meta">
                            <span>Geometry fit: {pattern.confidence}%</span>
                            {pattern.breakoutLevel != null && (
                              <span>Breakout level: {formatPrice(pattern.breakoutLevel)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="pattern-empty">
                      No textbook double top/bottom, head & shoulders, or triangle pattern detected
                      on this timeframe right now.
                    </p>
                  )}
                </section>
                <section className="lab-sources">
                  <span>LIVE SOURCES</span>
                  {analysis.sources.map((source) => (
                    <b key={source}>{source}</b>
                  ))}
                  {wallet?.history.length ? (
                    <div className="lab-credit-history">
                      <span>RECENT CREDIT ACTIVITY</span>
                      {wallet.history.slice(0, 3).map((item) => (
                        <div key={item.id}>
                          <b>
                            {item.symbol} {SIGNAL_TIMEFRAMES[item.timeframe].label}
                          </b>
                          <em
                            className={
                              item.direction === "SHORT"
                                ? "loss"
                                : item.direction === "LONG"
                                  ? "gain"
                                  : ""
                            }
                          >
                            {item.direction}
                          </em>
                          <small>-{item.creditCost}C</small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <small>
                    {hasAiNews
                      ? "AI output is an analytical summary, not investment advice."
                      : "Technical mode uses rules and live market data; no AI model output is included."}{" "}
                    Verify independently before any financial decision.
                  </small>
                </section>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </Panel>
  );
}

function buildLiveSignal(asset: LiveAsset | null, symbol: string) {
  if (!asset)
    return {
      name: symbol,
      signal: "Awaiting Live Data",
      score: 0,
      risk: "Unknown",
      accent: "#60718f",
      summary:
        "A momentum score will appear after the market provider returns a valid price snapshot.",
      drivers: "Live returns and volatility are unavailable.",
      action: "Wait for the live feed to reconnect before reviewing momentum.",
    };
  const change1h = asset?.change1h ?? 0;
  const change24h = asset?.change24h ?? 0;
  const change7d = asset?.change7d ?? 0;
  const score = Math.max(
    18,
    Math.min(94, Math.round(50 + change1h * 4 + change24h * 2.4 + change7d * 0.8)),
  );
  const prices = asset?.sparkline7d ?? [];
  const returns = prices
    .slice(-25)
    .slice(1)
    .map((value, index) =>
      prices.slice(-25)[index] ? Math.abs(value / prices.slice(-25)[index] - 1) * 100 : 0,
    );
  const volatility = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length);
  const risk = volatility > 1.2 ? "High" : volatility > 0.45 ? "Medium" : "Low";
  const signal =
    score >= 72 ? "Bullish Momentum" : score <= 36 ? "Bearish Pressure" : "Neutral / Watch";
  const accent =
    score >= 72
      ? "#00f59a"
      : score <= 36
        ? "#ff335d"
        : marketConfig[symbol]?.accent === "orange"
          ? "#ff9b00"
          : "#20d8ff";
  return {
    name: asset?.name ?? symbol,
    signal,
    score,
    risk,
    accent,
    summary: `${symbol} is ${formatChange(change24h)} over 24h and ${formatChange(change7d)} over 7d, based on the latest market snapshot.`,
    drivers: `1h ${formatChange(change1h)} · 24h ${formatChange(change24h)} · 7d ${formatChange(change7d)} · Rank #${asset?.marketCapRank ?? "—"}`,
    action:
      "Rules-based momentum summary only. Confirm with independent research; this is not investment advice.",
  };
}

function PremiumAIInsights({
  selectedCoin,
  notify,
  asset,
}: {
  selectedCoin: string;
  range: string;
  notify: (text: string) => void;
  asset: LiveAsset | null;
}) {
  const [section, setSection] = useState<"summary" | "drivers" | "action">("summary");
  const [expanded, setExpanded] = useState(false);
  const signal = buildLiveSignal(asset, selectedCoin);
  const text =
    section === "summary" ? signal.summary : section === "drivers" ? signal.drivers : signal.action;
  const sections = ["summary", "drivers", "action"] as const;
  return (
    <Panel className={`ai-insights ai-reference ${expanded ? "ai-expanded" : ""}`} accent="blue">
      <PanelTitle title="LIVE MARKET PULSE" action={<b className="beta">5M</b>} />
      <div className="ai-reference-content">
        <button
          className="ai-reference-head"
          style={{ "--signal": signal.accent } as CSSProperties}
          onClick={() => {
            setSection(sections[(sections.indexOf(section) + 1) % sections.length]);
            notify(`${selectedCoin} market pulse view changed`);
          }}
          aria-label="Cycle market pulse"
        >
          <img src="/marketpulse.png" alt="" className="ai-reference-head-img" />
          <i />
          <b />
          <em>{asset ? signal.score : "—"}</em>
        </button>
        <div className="ai-reference-copy">
          <strong style={{ color: signal.accent }}>{signal.signal}</strong>
          <b>
            {signal.name} ({selectedCoin})
          </b>
          <small>1H / 24H / 7D · {signal.risk} risk</small>
          <p>{text}</p>
        </div>
      </div>
      <div className="ai-reference-footer">
        <span className="insight-dots">
          {sections.map((value) => (
            <button
              aria-label={`Show ${value} pulse`}
              aria-pressed={section === value}
              className={section === value ? "active" : ""}
              onClick={() => setSection(value)}
              key={value}
            />
          ))}
        </span>
        <button
          disabled={!asset}
          onClick={() => {
            setExpanded(true);
            notify(`${selectedCoin} quant detail opened`);
          }}
        >
          View Quant Detail <ArrowRight size={11} />
        </button>
      </div>
      {expanded && (
        <div className="insight-detail premium-insight-detail">
          <button
            className="insight-close"
            onClick={() => setExpanded(false)}
            aria-label="Close market analysis"
          >
            <X size={14} />
          </button>
          <span className="analysis-kicker">CRYPTOWORLD · RULES ENGINE</span>
          <h3>{signal.name} live momentum report</h3>
          <strong style={{ color: signal.accent }}>{signal.score}%</strong>
          {[
            ["Momentum", signal.score],
            ["1h strength", Math.max(10, Math.min(95, 50 + finite(asset?.change1h) * 8))],
            ["7d strength", Math.max(10, Math.min(95, 50 + finite(asset?.change7d) * 2))],
          ].map(([label, value]) => (
            <div className="confidence-row" key={String(label)}>
              <span>{label}</span>
              <i>
                <b style={{ width: `${value}%`, background: signal.accent }} />
              </i>
              <em>{Math.round(Number(value))}%</em>
            </div>
          ))}
          <p>{signal.action}</p>
        </div>
      )}
    </Panel>
  );
}

const sectionMeta: Record<string, { icon: LucideIcon; blurb: string }> = {
  "Trade Tools": {
    icon: Wrench,
    blurb: "Order tickets, execution presets and cross-exchange routing are being wired up.",
  },
  Analytics: {
    icon: LineChart,
    blurb: "Deeper performance analytics and custom reporting are on the way.",
  },
  "DeFi Scanner": {
    icon: Shield,
    blurb: "On-chain protocol scanning and yield/risk surfacing are in progress.",
  },
  "News Feed": {
    icon: Newspaper,
    blurb: "A dedicated, filterable news stream is being assembled.",
  },
  Alerts: { icon: Bell, blurb: "Custom price and signal alert management is coming soon." },
  Calendar: {
    icon: CalendarDays,
    blurb: "An economic and on-chain events calendar is in the works.",
  },
  Watchlist: { icon: Star, blurb: "A standalone, sortable watchlist workspace is coming soon." },
  Settings: {
    icon: Settings,
    blurb: "Account, notification and display preferences will live here.",
  },
};

function SectionPlaceholder({ section }: { section: string }) {
  const meta = sectionMeta[section] ?? {
    icon: LayoutDashboard,
    blurb: "This workspace is being built.",
  };
  const Icon = meta.icon;
  return (
    <Panel className="section-placeholder" accent="purple">
      <div className="section-placeholder-body">
        <span className="section-placeholder-icon">
          <Icon size={26} />
        </span>
        <h2>{section}</h2>
        <p>{meta.blurb}</p>
        <span className="section-placeholder-tag">COMING SOON</span>
      </div>
    </Panel>
  );
}

type OnChainNewsItem = {
  id: string;
  category: "On-Chain";
  headline: string;
  source: string;
  url: string;
  impact: number;
  direction: "up" | "down";
};

function useOnChainNews() {
  const { data: items, status } = usePolledResource(loadOnChainNews);
  return { items, status };
}
async function loadOnChainNews(signal: AbortSignal) {
  const data = await fetchJson<OnChainNewsItem[]>("/api/onchain-news", signal);
  if (!Array.isArray(data)) throw new Error("Invalid news payload");
  return data;
}

function NewsFeed({ notify }: { notify: (text: string) => void }) {
  const { items, status } = useOnChainNews();
  return (
    <Panel className="news-feed" accent="orange">
      <PanelTitle
        title="ON CHAIN NEWS"
        action={
          <small className="data-source-note">
            {status === "live" ? "MED-HIGH IMPACT · 5M" : status.toUpperCase()}
          </small>
        }
      />
      <div className="news-feed-list">
        {items === null ? (
          <div className="data-empty">
            {status === "offline"
              ? "On-chain news feed is temporarily unavailable"
              : "Loading live headlines…"}
          </div>
        ) : items.length ? (
          items.map((item) => (
            <a
              className="news-feed-row"
              href={item.url || undefined}
              target="_blank"
              rel="noreferrer"
              onClick={() => notify(`${item.category} update opened`)}
              key={item.id}
            >
              <span className={`news-feed-direction ${item.direction === "up" ? "gain" : "loss"}`}>
                {item.direction === "up" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              </span>
              <span className="news-feed-body">
                <strong>
                  <em className={item.direction === "up" ? "gain" : "loss"}>
                    {item.direction === "up" ? "UP" : "DOWN"}
                  </em>{" "}
                  <small>{item.source}</small>
                </strong>
                <p>{item.headline}</p>
              </span>
              <b className="news-feed-impact">{item.impact}/10</b>
            </a>
          ))
        ) : (
          <div className="data-empty">No medium/high impact on-chain headlines right now</div>
        )}
      </div>
    </Panel>
  );
}

type MacroNewsItem = {
  id: string;
  category: "Macro" | "Geopolitical" | "Regulation" | "Institutional";
  headline: string;
  source: string;
  url: string;
  impact: number;
  direction: "up" | "down";
};

function useMacroNews() {
  const { data: items, status } = usePolledResource(loadMacroNews);
  return { items, status };
}
async function loadMacroNews(signal: AbortSignal) {
  const data = await fetchJson<MacroNewsItem[]>("/api/macro-news", signal);
  if (!Array.isArray(data)) throw new Error("Invalid news payload");
  return data;
}

function MacroNewsFeed({ notify }: { notify: (text: string) => void }) {
  const { items, status } = useMacroNews();
  return (
    <Panel className="news-feed macro-news" accent="red">
      <PanelTitle
        title="MACRO & GEOPOLITICAL NEWS"
        action={
          <small className="data-source-note">
            {status === "live" ? "MED-HIGH IMPACT · 5M" : status.toUpperCase()}
          </small>
        }
      />
      <div className="news-feed-list">
        {items === null ? (
          <div className="data-empty">
            {status === "offline"
              ? "Macro news feed is temporarily unavailable"
              : "Loading live headlines…"}
          </div>
        ) : items.length ? (
          items.map((item) => (
            <a
              className="news-feed-row"
              href={item.url || undefined}
              target="_blank"
              rel="noreferrer"
              onClick={() => notify(`${item.category} update opened`)}
              key={item.id}
            >
              <span className="news-feed-category">{item.category}</span>
              <span className={`news-feed-direction ${item.direction === "up" ? "gain" : "loss"}`}>
                {item.direction === "up" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              </span>
              <span className="news-feed-body">
                <strong>
                  <em className={item.direction === "up" ? "gain" : "loss"}>
                    {item.direction === "up" ? "UP" : "DOWN"}
                  </em>{" "}
                  <small>{item.source}</small>
                </strong>
                <p>{item.headline}</p>
              </span>
              <b className="news-feed-impact">{item.impact}/10</b>
            </a>
          ))
        ) : (
          <div className="data-empty">No medium/high impact macro headlines right now</div>
        )}
      </div>
    </Panel>
  );
}

function DashboardMain({
  selectedCoin,
  setSelectedCoin,
  range,
  setRange,
  notify,
  selectedMarket,
}: {
  selectedCoin: string;
  setSelectedCoin: (symbol: string) => void;
  range: string;
  setRange: (range: string) => void;
  notify: (text: string) => void;
  selectedMarket: MarketItem | undefined;
}) {
  return (
    <>
      <SignalIntelligenceCore
        key={selectedCoin}
        selectedCoin={selectedCoin}
        asset={selectedMarket?.asset ?? null}
        notify={notify}
      />
      <div className="dashboard-news-globe-row">
        <MacroNewsFeed notify={notify} />
        <PremiumGlobeHero
          selectedCoin={selectedCoin}
          onSelectCoin={setSelectedCoin}
          range={range}
          onRange={setRange}
          notify={notify}
        />
      </div>
    </>
  );
}

function DashboardRail({
  selectedCoin,
  range,
  notify,
  selectedMarket,
}: {
  selectedCoin: string;
  range: string;
  notify: (text: string) => void;
  selectedMarket: MarketItem | undefined;
}) {
  return (
    <>
      <PremiumAIInsights
        key={selectedCoin}
        selectedCoin={selectedCoin}
        range={range}
        notify={notify}
        asset={selectedMarket?.asset ?? null}
      />
      <NewsFeed notify={notify} />
    </>
  );
}

function MarketOverviewMain({
  selectedCoin,
  setSelectedCoin,
  range,
  setRange,
  notify,
  snapshot,
  markets,
  assets,
}: {
  selectedCoin: string;
  setSelectedCoin: (symbol: string) => void;
  range: string;
  setRange: (range: string) => void;
  notify: (text: string) => void;
  snapshot: MarketSnapshot | null;
  markets: MarketItem[];
  assets: LiveAsset[];
}) {
  return (
    <>
      <div className="market-grid">
        {markets.map((item) => (
          <PremiumMarketCard
            item={item}
            active={selectedCoin === item.symbol}
            onSelect={setSelectedCoin}
            notify={notify}
            key={item.symbol}
          />
        ))}
      </div>
      <GlobalOverview notify={notify} snapshot={snapshot} markets={markets} />
      <div className="analysis-grid">
        <PremiumMarketTrend
          selectedCoin={selectedCoin}
          range={range}
          onRange={setRange}
          onSelectCoin={setSelectedCoin}
          markets={markets}
        />
        <LiveMomentum notify={notify} markets={markets} />
      </div>
      <div className="lower-grid">
        <TrendingNow notify={notify} trending={snapshot?.trending ?? []} />
        <Movers type="gainers" notify={notify} assets={assets} />
        <Movers type="losers" notify={notify} assets={assets} />
      </div>
    </>
  );
}

function PortfolioMain({
  notify,
  assets,
}: {
  notify: (text: string) => void;
  assets: LiveAsset[];
}) {
  return (
    <>
      <Portfolio notify={notify} assets={assets} />
      <div className="lower-grid">
        <Movers type="gainers" notify={notify} assets={assets} />
        <Movers type="losers" notify={notify} assets={assets} />
      </div>
    </>
  );
}

function AIInsightsMain({
  selectedCoin,
  range,
  notify,
  selectedMarket,
}: {
  selectedCoin: string;
  range: string;
  notify: (text: string) => void;
  selectedMarket: MarketItem | undefined;
}) {
  return (
    <>
      <SignalIntelligenceCore
        key={selectedCoin}
        selectedCoin={selectedCoin}
        asset={selectedMarket?.asset ?? null}
        notify={notify}
      />
      <PremiumAIInsights
        key={`${selectedCoin}-pulse`}
        selectedCoin={selectedCoin}
        range={range}
        notify={notify}
        asset={selectedMarket?.asset ?? null}
      />
    </>
  );
}

function WatchlistMain({
  selectedCoin,
  setSelectedCoin,
  notify,
  markets,
  pushPermission,
  requestPush,
}: {
  selectedCoin: string;
  setSelectedCoin: (symbol: string) => void;
  notify: (text: string) => void;
  markets: MarketItem[];
  pushPermission: NotificationPermission | "unsupported";
  requestPush: () => void;
}) {
  const { symbols } = useWatchlist();
  const starred = markets.filter((item) => symbols.includes(item.symbol));
  const [statuses, setStatuses] = useState<WatchlistStatus[]>([]);

  useEffect(() => {
    if (!symbols.length) return;
    let cancelled = false;
    fetch(`/api/watchlist-status?symbols=${symbols.join(",")}`)
      .then((response) =>
        response.ok ? (response.json() as Promise<{ statuses: WatchlistStatus[] }>) : null,
      )
      .then((data) => {
        if (data && !cancelled) setStatuses(data.statuses);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [symbols]);

  const statusFor = (symbol: string) => statuses.find((status) => status.symbol === symbol);

  return (
    <Panel accent="purple">
      <PanelTitle
        title="WATCHLIST"
        action={
          <div className="watchlist-actions">
            {pushPermission !== "unsupported" && (
              <button
                className={`push-toggle ${pushPermission === "granted" ? "on" : ""}`}
                onClick={requestPush}
                disabled={pushPermission === "granted"}
              >
                <BellRing size={11} />
                {pushPermission === "granted" ? "Browser alerts on" : "Enable browser alerts"}
              </button>
            )}
            <small className="data-source-note">{starred.length} STARRED</small>
          </div>
        }
      />
      {starred.length ? (
        <div className="market-grid">
          {starred.map((item) => {
            const status = statusFor(item.symbol);
            return (
              <div className="watchlist-card-wrap" key={item.symbol}>
                <PremiumMarketCard
                  item={item}
                  active={selectedCoin === item.symbol}
                  onSelect={setSelectedCoin}
                  notify={notify}
                />
                {status?.direction ? (
                  <div className={`watchlist-bias ${status.direction.toLowerCase()}`}>
                    <span>{status.direction} bias</span>
                    <small>
                      {status.timeframe} ·{" "}
                      {status.ageMinutes != null && status.ageMinutes < 60
                        ? `${status.ageMinutes}m ago`
                        : status.ageMinutes != null
                          ? `${Math.round(status.ageMinutes / 60)}h ago`
                          : ""}
                    </small>
                  </div>
                ) : (
                  <div className="watchlist-bias none">
                    <span>No recent signal</span>
                    <small>Run an analysis to start tracking this coin&apos;s bias</small>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="data-empty">
          No coins starred yet — tap the star on any market card (Market Overview) to add it here.
        </div>
      )}
      {starred.length > 0 && (
        <p className="watchlist-hint">
          You&apos;ll be notified in-app{pushPermission === "granted" ? " and via push" : ""}{" "}
          whenever one of these flips to a new bias — checked every 90 seconds while the app is
          open.
        </p>
      )}
    </Panel>
  );
}

function PositionSizeCalculator() {
  const [accountSize, setAccountSize] = useState("1000");
  const [riskPct, setRiskPct] = useState("1");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const calculation = calculatePositionSize(
    Number(accountSize),
    Number(riskPct),
    Number(entry),
    Number(stop),
  );
  return (
    <Panel accent="blue">
      <PanelTitle title="POSITION SIZE CALCULATOR" icon={Calculator} />
      <div className="calc-grid">
        <label>
          Account size (USD)
          <input
            value={accountSize}
            onChange={(e) => setAccountSize(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          Risk per trade (%)
          <input value={riskPct} onChange={(e) => setRiskPct(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          Entry price
          <input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
        </label>
        <label>
          Stop-loss price
          <input
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
        </label>
      </div>
      <div className="calc-results">
        <div>
          <span>Risk amount</span>
          <b>{calculation ? formatPrice(calculation.riskAmount) : "—"}</b>
        </div>
        <div>
          <span>Position size</span>
          <b>{calculation ? `${calculation.size.toFixed(4)} units` : "—"}</b>
        </div>
        <div>
          <span>Position value</span>
          <b>{calculation ? formatPrice(calculation.value) : "—"}</b>
        </div>
      </div>
    </Panel>
  );
}

function QuickConvert({ markets }: { markets: MarketItem[] }) {
  const [amount, setAmount] = useState("1");
  const [fromSymbol, setFromSymbol] = useState("BTC");
  const [toSymbol, setToSymbol] = useState("USD");
  const options = ["USD", ...markets.map((item) => item.symbol)];
  const fromPrice =
    fromSymbol === "USD"
      ? 1
      : (markets.find((item) => item.symbol === fromSymbol)?.asset?.currentPrice ?? null);
  const toPrice =
    toSymbol === "USD"
      ? 1
      : (markets.find((item) => item.symbol === toSymbol)?.asset?.currentPrice ?? null);
  const quantity = Number(amount);
  const result = amount.trim() ? convertAtPrices(quantity, fromPrice, toPrice) : null;
  return (
    <Panel accent="cyan">
      <PanelTitle title="QUICK CONVERT" icon={Coins} />
      <div className="convert-row">
        <input
          aria-label="Amount to convert"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
        <select
          aria-label="Convert from"
          value={fromSymbol}
          onChange={(e) => setFromSymbol(e.target.value)}
        >
          {options.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
        <ArrowRight size={14} />
        <select
          aria-label="Convert to"
          value={toSymbol}
          onChange={(e) => setToSymbol(e.target.value)}
        >
          {options.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
      </div>
      <div className="convert-result" role="status">
        {result == null
          ? "Awaiting valid live prices"
          : `${result.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${toSymbol}`}
      </div>
      <p className="calendar-disclaimer">
        Indicative conversion at live USD prices, excluding fees and spreads.
      </p>
    </Panel>
  );
}

function TradeToolsMain({ markets }: { markets: MarketItem[] }) {
  return (
    <>
      <PositionSizeCalculator />
      <QuickConvert markets={markets} />
    </>
  );
}

function VolatilityLeaderboard({ assets }: { assets: LiveAsset[] }) {
  const ranked = [...assets]
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, 10);
  return (
    <Panel accent="pink">
      <PanelTitle
        title="VOLATILITY LEADERBOARD"
        action={<small className="data-source-note">TOP {assets.length} · 24H</small>}
      />
      <div className="news-feed-list">
        {ranked.map((asset) => (
          <div className="news-feed-row" key={asset.id}>
            <CoinBadge
              glyph={asset.symbol.slice(0, 1)}
              accent={marketConfig[asset.symbol.toUpperCase()]?.accent ?? "pink"}
              image={asset.image || coinIconUrl(asset.symbol)}
              symbol={asset.symbol.toUpperCase()}
              small
            />
            <span className="news-feed-body">
              <strong>{asset.symbol.toUpperCase()}</strong>
              <p>{asset.name}</p>
            </span>
            <b className={asset.change24h >= 0 ? "gain" : "loss"}>
              {asset.change24h >= 0 ? "+" : ""}
              {asset.change24h.toFixed(2)}%
            </b>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MarketBreadth({ assets }: { assets: LiveAsset[] }) {
  const up = assets.filter((asset) => asset.change24h > 0).length;
  const down = assets.filter((asset) => asset.change24h < 0).length;
  const total = up + down;
  const upPct = total ? Math.round((up / total) * 100) : 0;
  return (
    <Panel accent="green">
      <PanelTitle
        title="MARKET BREADTH"
        action={<small className="data-source-note">TOP {assets.length}</small>}
      />
      <div className="breadth-bar">
        <div className="breadth-up" style={{ width: `${upPct}%` }} />
      </div>
      <div className="breadth-stats">
        <span className="gain">
          {up} up ({upPct}%)
        </span>
        <span className="loss">
          {down} down ({total ? 100 - upPct : 0}%)
        </span>
      </div>
    </Panel>
  );
}

type DataHealthEntry = { primary: number; fallback: number; failure: number };
type D1Health = { bound: boolean; reachable: boolean; error?: string; note?: string };
type DataHealthResponse = {
  note: string;
  since: string;
  d1: D1Health;
  sources: Record<string, DataHealthEntry>;
};

function useDataHealth() {
  return usePolledResource(loadDataHealth);
}
async function loadDataHealth(signal: AbortSignal) {
  const data = await fetchJson<DataHealthResponse>("/api/data-health", signal);
  if (!data.d1 || !data.sources) throw new Error("Invalid health payload");
  return data;
}

function DataHealthPanel() {
  const { data, status } = useDataHealth();
  const entries = data ? Object.entries(data.sources) : [];
  const d1Ok = data?.d1.bound && data.d1.reachable;
  return (
    <Panel accent="orange">
      <PanelTitle
        title="DATA SOURCE HEALTH"
        action={
          <small className="data-source-note">
            {status === "live" ? "THIS WORKER INSTANCE" : status.toUpperCase()}
          </small>
        }
      />
      {data && (
        <div className={`news-feed-row ${d1Ok ? "" : "loss"}`}>
          <span className="news-feed-body">
            <strong>D1 DATABASE (persistence)</strong>
            <p>
              {d1Ok
                ? "Connected — credits, rate limits, and cache persist across cold starts"
                : (data.d1.note ??
                  data.d1.error ??
                  "Not reachable — running on temporary in-memory storage")}
            </p>
          </span>
          <b className={d1Ok ? "gain" : "loss"}>{d1Ok ? "OK" : "AT RISK"}</b>
        </div>
      )}
      {!entries.length ? (
        <div className="data-empty">
          {status === "offline"
            ? "Health data is temporarily unavailable"
            : "No upstream calls recorded on this instance yet"}
        </div>
      ) : (
        <div className="news-feed-list">
          {entries.map(([category, counts]) => {
            const total = counts.primary + counts.fallback + counts.failure || 1;
            const healthPct = Math.round(((counts.primary + counts.fallback) / total) * 100);
            return (
              <div className="news-feed-row" key={category}>
                <span className="news-feed-body">
                  <strong>{category}</strong>
                  <p>
                    {counts.primary} primary · {counts.fallback} fallback · {counts.failure} failed
                  </p>
                </span>
                <b className={healthPct >= 80 ? "gain" : healthPct >= 40 ? "" : "loss"}>
                  {healthPct}%
                </b>
              </div>
            );
          })}
        </div>
      )}
      {data && <p className="calendar-disclaimer">{data.note}</p>}
    </Panel>
  );
}

function AnalyticsMain({ assets }: { assets: LiveAsset[] }) {
  return (
    <>
      <MarketBreadth assets={assets} />
      <VolatilityLeaderboard assets={assets} />
      <DataHealthPanel />
    </>
  );
}

// Reuse the market snapshot so changing screener filters needs no network request.
type ScreenerSortKey =
  "currentPrice" | "change1h" | "change24h" | "change7d" | "totalVolume" | "marketCap";
type ScreenerFilterKey =
  "all" | "gainers" | "losers" | "momentumUp" | "momentumDown" | "largeCap" | "volumeLeaders";

const SCREENER_FILTERS: { key: ScreenerFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "gainers", label: "Gainers 24h" },
  { key: "losers", label: "Losers 24h" },
  { key: "momentumUp", label: "Momentum ↑" },
  { key: "momentumDown", label: "Momentum ↓" },
  { key: "largeCap", label: "Large Cap (Top 20)" },
  { key: "volumeLeaders", label: "Volume Leaders" },
];

const SCREENER_COLUMNS: { key: ScreenerSortKey; label: string }[] = [
  { key: "currentPrice", label: "Price" },
  { key: "change1h", label: "1H" },
  { key: "change24h", label: "24H" },
  { key: "change7d", label: "7D" },
  { key: "totalVolume", label: "Volume" },
  { key: "marketCap", label: "Mkt Cap" },
];

function ScreenerMain({
  selectedCoin,
  setSelectedCoin,
  notify,
  assets,
}: {
  selectedCoin: string;
  setSelectedCoin: (symbol: string) => void;
  notify: (text: string) => void;
  assets: LiveAsset[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ScreenerFilterKey>("all");
  const [sortKey, setSortKey] = useState<ScreenerSortKey>("marketCap");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [minVolumeInput, setMinVolumeInput] = useState("");

  const volumeThreshold = (Number(minVolumeInput) || 0) * 1_000_000;

  const topVolumeIds = useMemo(() => {
    const sorted = [...assets].sort((a, b) => b.totalVolume - a.totalVolume);
    return new Set(sorted.slice(0, 10).map((asset) => asset.id));
  }, [assets]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assets.filter((asset) => {
      if (
        query &&
        !asset.name.toLowerCase().includes(query) &&
        !asset.symbol.toLowerCase().includes(query)
      )
        return false;
      if (asset.totalVolume < volumeThreshold) return false;
      switch (filter) {
        case "gainers":
          return asset.change24h > 0;
        case "losers":
          return asset.change24h < 0;
        case "momentumUp":
          return asset.change1h > 0 && asset.change24h > 0 && asset.change7d > 0;
        case "momentumDown":
          return asset.change1h < 0 && asset.change24h < 0 && asset.change7d < 0;
        case "largeCap":
          return (asset.marketCapRank ?? 999) <= 20;
        case "volumeLeaders":
          return topVolumeIds.has(asset.id);
        default:
          return true;
      }
    });
  }, [assets, search, filter, volumeThreshold, topVolumeIds]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const diff = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
      return sortDir === "asc" ? diff : -diff;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: ScreenerSortKey) => {
    if (sortKey === key) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <Panel className="screener" accent="cyan">
      <PanelTitle
        title="SCREENER"
        icon={SlidersHorizontal}
        action={
          <small className="data-source-note">
            {sorted.length} / {assets.length} COINS · RULE-BASED
          </small>
        }
      />
      <div className="screener-controls">
        <input
          className="screener-search"
          aria-label="Filter coins by name or symbol"
          placeholder="Search coin or symbol..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <input
          className="screener-volume"
          aria-label="Minimum 24-hour volume in millions of dollars"
          type="number"
          min={0}
          placeholder="Min 24h vol ($M)"
          value={minVolumeInput}
          onChange={(event) => setMinVolumeInput(event.target.value)}
        />
      </div>
      <div className="screener-filters">
        {SCREENER_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            className={filter === key ? "active" : ""}
            onClick={() => {
              setFilter(key);
              notify(`Screener filter: ${label}`);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="screener-table-wrap">
        <table className="screener-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Coin</th>
              {SCREENER_COLUMNS.map(({ key, label }) => (
                <th
                  key={key}
                  className="sortable"
                  aria-sort={
                    sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                  }
                >
                  <button onClick={() => toggleSort(key)}>
                    {label} {sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((asset, index) => (
              <tr
                key={asset.id}
                className={selectedCoin === asset.symbol.toUpperCase() ? "active-row" : ""}
              >
                <td>{asset.marketCapRank ?? index + 1}</td>
                <td className="screener-coin">
                  <img
                    src={asset.image}
                    alt={asset.symbol}
                    onError={(event) => {
                      event.currentTarget.style.visibility = "hidden";
                    }}
                  />
                  <button
                    onClick={() => {
                      setSelectedCoin(asset.symbol.toUpperCase());
                      notify(`${asset.symbol.toUpperCase()} selected`);
                    }}
                    aria-label={`Select ${asset.name}`}
                  >
                    {asset.symbol.toUpperCase()}
                  </button>
                  <small>{asset.name}</small>
                </td>
                <td>{formatPrice(asset.currentPrice)}</td>
                <td className={asset.change1h >= 0 ? "gain" : "loss"}>
                  {formatChange(asset.change1h)}
                </td>
                <td className={asset.change24h >= 0 ? "gain" : "loss"}>
                  {formatChange(asset.change24h)}
                </td>
                <td className={asset.change7d >= 0 ? "gain" : "loss"}>
                  {formatChange(asset.change7d)}
                </td>
                <td>{formatCompactCurrency(asset.totalVolume)}</td>
                <td>{formatCompactCurrency(asset.marketCap)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="screener-empty">
                  No coins match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

type DefiProtocol = {
  id: string;
  name: string;
  category: string;
  tvl: number;
  change1d: number | null;
  change7d: number | null;
  chain: string;
};

function useDefiProtocols() {
  const { data, status } = usePolledResource(loadDefiProtocols, protocolsAreStale);
  return { items: data?.items ?? null, status, stale: status === "stale" };
}
async function loadDefiProtocols(signal: AbortSignal) {
  const data = await fetchJson<{ items: DefiProtocol[]; stale: boolean }>(
    "/api/defi-protocols",
    signal,
  );
  if (!Array.isArray(data.items)) throw new Error("Invalid protocol payload");
  return data;
}
function protocolsAreStale(data: { stale: boolean }) {
  return data.stale;
}

function DeFiScannerMain({ notify }: { notify: (text: string) => void }) {
  const { items, status, stale } = useDefiProtocols();
  return (
    <Panel accent="green">
      <PanelTitle
        title="DEFI SCANNER"
        action={
          <small className="data-source-note">
            {status === "connecting"
              ? "LOADING…"
              : stale
                ? "DEFILLAMA · CACHED"
                : "DEFILLAMA · TOP TVL"}
          </small>
        }
      />
      <div className="news-feed-list">
        {items === null ? (
          <div className="data-empty">
            {status === "offline"
              ? "DeFi data is temporarily unavailable"
              : "Loading live protocol data…"}
          </div>
        ) : items.length ? (
          items.map((protocol) => (
            <a
              className="news-feed-row"
              href={`https://defillama.com/protocol/${encodeURIComponent(protocol.id)}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => notify(`${protocol.name} opened on DeFiLlama`)}
              key={protocol.id}
            >
              <span className="news-feed-category">{protocol.category}</span>
              <span className="news-feed-body">
                <strong>
                  {protocol.name} <small>{protocol.chain}</small>
                </strong>
                <p>TVL {formatCompactCurrency(protocol.tvl)}</p>
              </span>
              <b className={(protocol.change1d ?? 0) >= 0 ? "gain" : "loss"}>
                {protocol.change1d == null
                  ? "—"
                  : `${protocol.change1d >= 0 ? "+" : ""}${protocol.change1d.toFixed(1)}%`}
              </b>
            </a>
          ))
        ) : (
          <div className="data-empty">No protocols available in the latest response</div>
        )}
      </div>
    </Panel>
  );
}

function usePriceAlertMonitoring(assets: LiveAsset[], notify: (text: string) => void) {
  const { alerts, markTriggered } = useAlerts();
  useEffect(() => {
    const hits = triggeredPriceAlerts(
      alerts,
      new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset.currentPrice])),
    );
    if (!hits.length) return;
    hits.forEach((alert) => markTriggered(alert.id));
    notify(
      hits
        .map((alert) => `${alert.symbol} ${alert.direction} ${formatPrice(alert.targetPrice)}`)
        .join(" · "),
    );
  }, [alerts, assets, markTriggered, notify]);
}

function AlertsMain({
  notify,
  markets,
}: {
  notify: (text: string) => void;
  markets: MarketItem[];
}) {
  const { alerts, addAlert, removeAlert } = useAlerts();
  const [symbol, setSymbol] = useState("BTC");
  const [target, setTarget] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");

  return (
    <>
      <Panel accent="red">
        <PanelTitle title="CREATE PRICE ALERT" icon={Bell} />
        <div className="calc-grid">
          <label>
            Symbol
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {markets.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol}
                </option>
              ))}
            </select>
          </label>
          <label>
            Direction
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "above" | "below")}
            >
              <option value="above">Crosses above</option>
              <option value="below">Crosses below</option>
            </select>
          </label>
          <label>
            Target price (USD)
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          </label>
        </div>
        <button
          className="core-run"
          disabled={!Number.isFinite(Number(target)) || Number(target) <= 0}
          onClick={() => {
            const price = Number(target);
            if (!Number.isFinite(price) || price <= 0) return;
            if (!addAlert(symbol, price, direction)) {
              notify("The 100-alert limit is reached. Remove an alert to add another.");
              return;
            }
            setTarget("");
            notify(`Alert set: ${symbol} ${direction} $${price}`);
          }}
        >
          <Bell size={12} />
          ADD ALERT
        </button>
      </Panel>
      <Panel accent="purple">
        <PanelTitle
          title="ACTIVE ALERTS"
          action={
            <small className="data-source-note">
              {alerts.filter((alert) => !alert.triggered).length} ACTIVE
            </small>
          }
        />
        <div className="news-feed-list">
          {alerts.length ? (
            alerts.map((alert) => (
              <div className="news-feed-row" key={alert.id}>
                <span className="news-feed-body">
                  <strong>
                    {alert.symbol} {alert.direction} ${alert.targetPrice}
                  </strong>
                  <p>
                    {alert.triggered
                      ? "Triggered"
                      : "Watching live price · checked every 5 min while this tab is open"}
                  </p>
                </span>
                <button
                  className="market-watch-action"
                  onClick={() => removeAlert(alert.id)}
                  aria-label="Remove alert"
                >
                  <X size={12} />
                </button>
              </div>
            ))
          ) : (
            <div className="data-empty">No alerts yet — set one above.</div>
          )}
        </div>
      </Panel>
    </>
  );
}

function CalendarMain() {
  const [today, setToday] = useState(FOMC_CALENDAR_CHECKED);
  useEffect(() => {
    const hydration = window.setTimeout(() => setToday(new Date().toISOString().slice(0, 10)), 0);
    return () => window.clearTimeout(hydration);
  }, []);
  const events = upcomingFomcMeetings(today);
  const dateLabel = (value: string) =>
    new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return (
    <Panel accent="cyan">
      <PanelTitle
        title="MACRO CALENDAR"
        action={<small className="data-source-note">FEDERAL RESERVE · 2026–27</small>}
      />
      <p className="calendar-disclaimer">
        Published FOMC meeting dates, checked {FOMC_CALENDAR_CHECKED}. Future dates remain
        tentative.{" "}
        <a href={FOMC_CALENDAR_SOURCE} target="_blank" rel="noreferrer">
          Open official calendar <ArrowRight size={10} />
        </a>
      </p>
      <div className="news-feed-list">
        {events.map(([start, end]) => (
          <div className="news-feed-row" key={start}>
            <span className="news-feed-category">Macro</span>
            <span className="news-feed-body">
              <strong>FOMC policy meeting</strong>
              <p>
                {dateLabel(start)} – {dateLabel(end)}
              </p>
            </span>
            <b className="news-feed-impact">{dateLabel(end)}</b>
          </div>
        ))}
        {!events.length && (
          <div className="data-empty">
            This reference schedule has ended. Open the official calendar for the next published
            meetings.
          </div>
        )}
      </div>
    </Panel>
  );
}

function SettingsMain({ setRange }: { setRange: (range: string) => void }) {
  const { settings, update } = useSettings();
  return (
    <Panel accent="blue">
      <PanelTitle title="PREFERENCES" icon={Settings} />
      <div className="settings-row">
        <span>Reduce motion (disable ambient animations)</span>
        <button
          className={`settings-toggle ${settings.reduceMotion ? "on" : ""}`}
          aria-pressed={settings.reduceMotion}
          onClick={() => update({ reduceMotion: !settings.reduceMotion })}
        >
          {settings.reduceMotion ? "ON" : "OFF"}
        </button>
      </div>
      <div className="settings-row">
        <span>Default chart range</span>
        <select
          aria-label="Default chart range"
          value={settings.defaultRange}
          onChange={(e) => {
            update({ defaultRange: e.target.value });
            setRange(e.target.value);
          }}
        >
          {CHART_RANGES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <p className="calendar-disclaimer">Preferences are saved on this device/browser only.</p>
    </Panel>
  );
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const [activeSection, setActiveSection] = useState("Dashboard");
  const [selectedCoin, setSelectedCoin] = useState("ETH");
  const [range, setRange] = useState("1D");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const { snapshot, status, refresh } = useLiveMarketData();
  const markets = useMemo(() => buildMarketItems(snapshot), [snapshot]);
  const tickerMarkets = useMemo(() => buildMarketItems(snapshot, tickerSymbols), [snapshot]);
  const selectedMarket = useMemo(
    () => buildMarketItems(snapshot, [selectedCoin])[0],
    [snapshot, selectedCoin],
  );
  const assets = useMemo(() => snapshot?.assets ?? [], [snapshot]);
  const notify = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1900);
  }, []);
  const { pushPermission, requestPush } = useWatchlistBiasAlerts(notify);
  usePriceAlertMonitoring(assets, notify);
  const { settings } = useSettings();
  useEffect(() => {
    const initial = window.setTimeout(() => setRange(settings.defaultRange), 0);
    return () => window.clearTimeout(initial);
  }, [settings.defaultRange]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const marketRail = (
    <>
      <PremiumAIInsights
        key={selectedCoin}
        selectedCoin={selectedCoin}
        range={range}
        notify={notify}
        asset={selectedMarket?.asset ?? null}
      />
      <QuickTools notify={notify} />
    </>
  );

  let mainContent: ReactNode;
  let railContent: ReactNode;
  let mainClassName = "dashboard-content";
  let railClassName = "right-rail";

  switch (activeSection) {
    case "Dashboard":
      mainContent = (
        <DashboardMain
          selectedCoin={selectedCoin}
          setSelectedCoin={setSelectedCoin}
          range={range}
          setRange={setRange}
          notify={notify}
          selectedMarket={selectedMarket}
        />
      );
      railContent = (
        <DashboardRail
          selectedCoin={selectedCoin}
          range={range}
          notify={notify}
          selectedMarket={selectedMarket}
        />
      );
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "Market Overview":
      mainContent = (
        <MarketOverviewMain
          selectedCoin={selectedCoin}
          setSelectedCoin={setSelectedCoin}
          range={range}
          setRange={setRange}
          notify={notify}
          snapshot={snapshot}
          markets={markets}
          assets={assets}
        />
      );
      railContent = marketRail;
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "Portfolio":
      mainContent = <PortfolioMain notify={notify} assets={assets} />;
      railContent = (
        <>
          <QuickTools notify={notify} />
        </>
      );
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "AI Insights":
      mainContent = (
        <AIInsightsMain
          selectedCoin={selectedCoin}
          range={range}
          notify={notify}
          selectedMarket={selectedMarket}
        />
      );
      railContent = (
        <>
          <QuickTools notify={notify} />
        </>
      );
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "News Feed":
      mainContent = (
        <>
          <NewsFeed notify={notify} />
          <MacroNewsFeed notify={notify} />
        </>
      );
      railContent = (
        <>
          <QuickTools notify={notify} />
        </>
      );
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "Watchlist":
      mainContent = (
        <WatchlistMain
          selectedCoin={selectedCoin}
          setSelectedCoin={setSelectedCoin}
          notify={notify}
          markets={markets}
          pushPermission={pushPermission}
          requestPush={requestPush}
        />
      );
      railContent = (
        <>
          <QuickTools notify={notify} />
        </>
      );
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "Screener":
      mainContent = (
        <ScreenerMain
          selectedCoin={selectedCoin}
          setSelectedCoin={setSelectedCoin}
          notify={notify}
          assets={assets}
        />
      );
      railContent = marketRail;
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "Trade Tools":
      mainContent = <TradeToolsMain markets={tickerMarkets} />;
      railContent = (
        <>
          <QuickTools notify={notify} />
        </>
      );
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "Analytics":
      mainContent = <AnalyticsMain assets={assets} />;
      railContent = marketRail;
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "DeFi Scanner":
      mainContent = <DeFiScannerMain notify={notify} />;
      railContent = (
        <>
          <QuickTools notify={notify} />
        </>
      );
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "Alerts":
      mainContent = <AlertsMain notify={notify} markets={tickerMarkets} />;
      railContent = (
        <>
          <QuickTools notify={notify} />
        </>
      );
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "Calendar":
      mainContent = <CalendarMain />;
      railContent = (
        <>
          <QuickTools notify={notify} />
        </>
      );
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    case "Settings":
      mainContent = <SettingsMain setRange={setRange} />;
      railContent = (
        <>
          <QuickTools notify={notify} />
        </>
      );
      mainClassName = "dashboard-content section-content";
      railClassName = "right-rail section-rail";
      break;
    default:
      mainContent = <SectionPlaceholder section={activeSection} />;
      railContent = (
        <>
          <QuickTools notify={notify} />
        </>
      );
      mainClassName = "dashboard-content section-content section-content-empty";
      railClassName = "right-rail section-rail";
  }

  return (
    <NavigationContext.Provider value={setActiveSection}>
      <CoinSelectionContext.Provider value={setSelectedCoin}>
        <div className="component-mode">
          <div className="cyber-app">
            <div className="star-field" />
            <TopHeader
              openMenu={() => setMenuOpen(true)}
              notify={notify}
              onSelectCoin={setSelectedCoin}
              markets={tickerMarkets}
              snapshot={snapshot}
              status={status}
              refresh={refresh}
            />
            <LiveNow
              notify={notify}
              onSelectCoin={setSelectedCoin}
              markets={tickerMarkets}
              status={status}
              updatedAt={snapshot?.providerUpdatedAt}
              source={snapshot?.sources.market}
            />
            {menuOpen && (
              <button className="mobile-scrim" onClick={closeMenu} aria-label="Close navigation" />
            )}
            <div className="body-grid">
              <Sidebar
                open={menuOpen}
                close={closeMenu}
                notify={notify}
                snapshot={snapshot}
                status={status}
                btcSeries={markets[0]?.values ?? Array.from({ length: 18 }, () => 50)}
                active={activeSection}
                onSelect={setActiveSection}
              />
              <main id="main-content" tabIndex={-1} className={mainClassName}>
                {mainContent}
              </main>
              <aside className={railClassName}>{railContent}</aside>
            </div>
          </div>
          <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">
            <Zap size={13} />
            {toast}
          </div>
        </div>
      </CoinSelectionContext.Provider>
    </NavigationContext.Provider>
  );
}
