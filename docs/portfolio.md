# Demo walkthrough

Visit the [public interactive demo](https://manostsagkos.github.io/CryptoWorld/#interactive-demo) to try a sample dashboard with no installation or account. Select an asset and chart range, move the chart cursor, inspect the sample trend, search the asset table and save a watchlist. Every price is a fixed, illustrative example; this browser-only demo makes no live market-data or AI requests. The page also presents screenshots of the full app.

## One-minute public demo

1. Choose **Ethereum** and **1 month**. The chart, price summary and accessible chart description update together.
2. Move **Inspect a point** with the keyboard arrow keys to read individual prices. Press **Inspect sample trend** to compare the latest price with the explained five-point average; this is an illustrative calculation, not the full signal engine.
3. Search for **Solana**, press its **Save** button and turn on **Show my watchlist**. Clear the search or try a name outside the saved list to see the empty state.
4. Reload the page. The watchlist remains in this browser; when storage is blocked, it still works for the current visit and tells you that persistence is unavailable.

The shipped demo controller is exercised by [interaction tests](../tests/unit/portfolio-demo.test.mjs), including malformed stored data, blocked storage and cross-tab updates. The [architecture](architecture.md) explains how this static sample differs from the live application.

## Full application review

[Open GitHub Codespaces](https://codespaces.new/ManosTsagkos/CryptoWorld) to run the full app in a browser with public feeds. Codespaces requires a GitHub account, uses your quota and should be stopped after the review.

Start with the [dashboard screenshot](screenshots/dashboard.jpg), [Market Overview](screenshots/market-overview.jpg) and [mobile view](screenshots/mobile.jpg), or run the app to try the interactions yourself.

## Start the demo

From the project directory, with Node.js 22.13 or newer:

```bash
npm ci
npm run db:migrate:local
npm run dev
```

Open the local URL printed in the terminal. You need an internet connection for public feeds, but no AI key, exchange account, payment method or deployment account.

## Try these first

1. On **Dashboard**, drag the globe, change the selected coin and pause rotation. Check the source labels next to market data.
2. In **Market Overview**, switch the coin and chart range. The chart loads the matching price history.
3. Open **Screener**, filter the markets and select a result. Coins without signal-engine support are marked rather than silently replaced with BTC.
4. In **AI Insights**, run a BTC analysis. With no AI keys, the technical engine still works and shows **Technical Mode**. Open the result to inspect indicators, available derivatives data and risk levels.
5. Star a coin in **Market Overview**, then find it in **Watchlist**. Open the app in a second tab to see the watchlist update there too.
6. Create a price condition in **Alerts**, then navigate to another view. Monitoring continues while the tab remains open.
7. Try reduced motion and the default chart range in **Settings**, then resize the window to check the mobile navigation. Preferences are saved in this browser.

The demo wallet starts with 100 credits and grants a daily UTC reward on its first load that day. Analyses spend the displayed credit cost. There are no real purchases. Portfolio quantities are fixed examples, while their prices come from the market feed.

## Under the hood

`/api/data-health` shows database reachability and fallback counters for the current Worker isolate. [`worker/signal-core.ts`](../worker/signal-core.ts) contains the candle-validation and resolution rules. [`tests/`](../tests/) covers those calculations, migrations, request boundaries and wallet behavior.

Run `npm run check` to execute the complete local check. The runtime suite creates its own local database and excludes AI keys; it does not call paid AI services.

This is a runnable portfolio project, not a trading service. There are no claims of customers, guaranteed returns or production uptime. Anonymous wallets, browser-only alerts and candle-based outcomes are explained in the [README](../README.md). The dated [dependency review](dependency-security.md) includes the known development-tool advisory.
