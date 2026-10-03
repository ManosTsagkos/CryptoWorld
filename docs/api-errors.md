# API errors

The API returns JSON errors in the form:

```json
{
  "error": "Safe user-facing description"
}
```

Private wallet and analysis responses use `Cache-Control: private, no-store`. Public successful data responses can use short shared caching.

## Application status codes

| Status | Meaning                                         | Typical action                                                        |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------- |
| `200`  | Request completed.                              | Validate timestamps and source fields before using data.              |
| `400`  | Unsupported parameter or invalid JSON.          | Check the symbol, timeframe and request body.                         |
| `402`  | Credit balance is below the analysis cost.      | Read the returned balance and required cost.                          |
| `403`  | Cross-origin analysis request rejected.         | Send the request from the same application origin.                    |
| `404`  | Shared signal payload is missing or invalid.    | Generate a new share link from a valid analysis.                      |
| `413`  | Analysis request exceeds the 16 KiB body limit. | Send only the requested symbol and timeframe.                         |
| `429`  | Analysis rate limit reached.                    | Wait briefly before retrying.                                         |
| `502`  | Required upstream work failed.                  | Check data health and Worker logs; retry after the provider recovers. |

## Endpoint-specific errors

### `GET /api/market-data`

`502 Live market data is temporarily unavailable` means the primary market request and all applicable fallbacks failed or returned unusable data.

### `GET /api/market-history`

- `400 Unsupported market or range`: the requested ID or range is outside the allowlist.
- `502`: historical providers could not supply usable points.

### `GET /api/credits`

`502 Credit wallet is temporarily unavailable` normally indicates a D1 query or migration problem when persistence is enabled.

### `POST /api/signal-analysis`

- `400 Invalid analysis request`: body is not valid JSON.
- `400 Unsupported symbol or timeframe`: value is outside the server allowlist.
- `402 Insufficient credits`: no debit occurred.
- `403 Cross-origin analysis requests are not allowed`: browser origin differs from the application origin.
- `413`: the request body exceeds the 16 KiB limit; no credit debit occurs.
- `429 Please wait...`: the per-visitor rate interval has not elapsed.
- `502`: live analysis failed; if credits were already debited, the Worker attempts a refund.

## Upstream failures

Provider status codes are not copied directly to users because response bodies can contain unstable or sensitive diagnostic details. Worker logs record a short event name, provider hostname and safe status information.

Retries are limited to temporary conditions (`429` and `503`). Timeout, fallback and stale-cache behavior are documented in `docs/troubleshooting.md`.
