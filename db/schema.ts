import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

// Apply Drizzle migrations before serving requests; tables are not created at runtime.

export const creditAccounts = sqliteTable("credit_accounts", {
  userId: text("user_id").primaryKey(),
  balance: integer("balance").notNull().default(100),
  lifetimeSpent: integer("lifetime_spent").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  // UTC calendar day (YYYY-MM-DD), shared by the daily claim and streak logic.
  lastFreeClaimDate: text("last_free_claim_date"),
  streakDays: integer("streak_days").notNull().default(0),
});

export const signalAnalyses = sqliteTable(
  "signal_analyses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    creditCost: integer("credit_cost").notNull(),
    direction: text("direction").notNull(),
    score: integer("score").notNull(),
    confidence: integer("confidence").notNull(),
    provider: text("provider").notNull(),
    createdAt: integer("created_at").notNull(),
    // Outcome fields are populated by the candle-based resolver.
    mark: real("mark"),
    stopLoss: real("stop_loss"),
    takeProfit: real("take_profit"),
    resolveAt: integer("resolve_at"),
    resolved: integer("resolved").notNull().default(0),
    hit: integer("hit"),
    resolvedAt: integer("resolved_at"),
    resolvedPrice: real("resolved_price"),
    resolutionReason: text("resolution_reason"),
    // Watchlist alerts must not treat frozen or risk-vetoed signals as actionable.
    actionable: integer("actionable").notNull().default(1),
  },
  (table) => [
    index("signal_analyses_user_created_idx").on(table.userId, table.createdAt),
    index("signal_analyses_resolve_idx").on(table.resolved, table.resolveAt),
  ],
);

// Shared state survives Worker restarts and is visible across isolates.

export const signalRateLimits = sqliteTable("signal_rate_limits", {
  userId: text("user_id").primaryKey(),
  lastRunAt: integer("last_run_at").notNull(),
});

export const kvCache = sqliteTable("kv_cache", {
  cacheKey: text("cache_key").primaryKey(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
