# Troubleshooting

This guide follows the same order used in an application-support investigation: reproduce, isolate the failing layer, collect evidence, then validate the fix.

## 1. Establish a clean baseline

```bash
node --version
npm ci
npm run check
```

Expected Node.js version: `22.13.0` or newer.

If `npm ci` reports dependency drift, do not use `--force` or `legacy-peer-deps` as the first response. Confirm that `package.json` and `package-lock.json` are from the same commit.

## 2. Dashboard does not start

Run `npm run dev` and check the first terminal error before debugging the UI. Common causes are:

- unsupported Node.js version;
- incomplete `npm ci`;
- occupied local port;
- invalid JSON in `wrangler.jsonc` or `.openai/hosting.json`;
- stale Cloudflare runtime types after changing Wrangler configuration.

Regenerate runtime types with:

```bash
npm run types:cloudflare
```

If HTTPS requests fail only on a managed Windows machine with a corporate proxy or custom root certificate, retry the command with Node's system certificate store enabled:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm run dev
```

Do not disable TLS verification. Remove the temporary environment variable when it is no longer needed.

## 3. Database or credits are not persistent

Apply the migrations:

```bash
npm run db:migrate:local
```

Then open `/api/data-health`. Interpret D1 fields as follows:

- `bound: false`: no `DB` binding reached the Worker;
- `bound: true, reachable: false`: the binding exists but its query failed;
- `bound: true, reachable: true`: D1 is available.

Without D1, credits and rate limits intentionally fall back to in-memory state and reset on Worker restart.

## 4. Market cards show stale or unavailable data

Open `/api/data-health`. The source counters are per Worker isolate and reset after a cold start:

- `primary`: the preferred source succeeded;
- `fallback`: a backup provider supplied the response;
- `failure`: all providers for that category failed.

Next, call `/api/market-data` directly and inspect the HTTP status, `stale` field, source labels and provider timestamp. `429` and `503` responses from providers are retried with backoff; other status codes fail immediately because retrying usually does not change them.

## 5. AI analysis uses deterministic fallback

This is expected when no AI key is configured or all configured providers fail.

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Configure one supported provider key.
3. Restart the development server.
4. Run an analysis and inspect the returned `provider` and `news.ensemble` fields.

Never paste a real key into source code, screenshots, issues or logs.

## 6. Analysis returns an error

Check the status code before changing code:

- `400`: invalid JSON, symbol or timeframe;
- `402`: insufficient demonstration credits;
- `403`: cross-origin browser request;
- `413`: request body exceeds the 16 KiB limit;
- `429`: another analysis was requested too quickly;
- `502`: upstream data or analysis could not complete.

On a `502` after a successful debit, the Worker attempts to refund the same credit cost. Confirm the wallet through `GET /api/credits`.

## 7. UI data differs from a provider website

Record the symbol, timeframe, application timestamp, source label, stale state and external provider timestamp. Differences can result from cache timing, USD versus USDT pairs, provider aggregation methods or fallback usage. Compare equivalent timestamps and pairs before treating the difference as a calculation defect.

## 8. Escalation evidence

For a reproducible issue, collect:

- exact command or endpoint;
- timestamp and timezone;
- HTTP status;
- sanitized response body;
- `/api/data-health` output;
- relevant Worker log event names;
- steps to reproduce;
- expected and observed behavior.

Do not include API keys, email headers, visitor IDs or full third-party response bodies.

## 9. Dependency audit findings

Check both the complete dependency tree and deployed dependencies. A development-tool advisory is not automatically a reachable Worker API vulnerability, but must not be silently ignored. The current reviewed finding and its reproduction commands are in [Dependency security](dependency-security.md).
