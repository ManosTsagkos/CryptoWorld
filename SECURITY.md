# Security and private configuration

This is a public portfolio application. AI credentials belong in the ignored `.dev.vars` file for development and in the hosting provider's secret store for deployment. The application works without AI keys using public data APIs and deterministic technical analysis.

## Before publishing changes

Run `npm run secrets:check` or the complete `npm run check`. The scanner checks the current publishable file set for common credential formats and private configuration files, and reports filenames only. It is a useful safeguard, not a replacement for reviewing staged changes or checking repository history.

Do not commit local D1 state, visitor history, provider responses containing private information, `.env` files, `.dev.vars`, private keys or deployment account configuration. The build and runtime tests deliberately exclude local AI keys.

If a real credential is committed, revoke it with the provider immediately. Removing the current file does not remove it from existing commits.

## Current trust model

- Visitor IDs are anonymous browser identifiers, not authentication. The demonstration credit wallet is unsuitable for paid balances or sensitive personal data.
- Client-supplied email headers do not identify a user or select their analysis history.
- Analysis requests validate the origin, symbol and timeframe before debiting credits.
- Shared signal links contain an explicitly selected public analysis summary in the URL. Never add private notes or credentials to that payload.
- Market data and headline text come from external providers and are treated as untrusted input.

## Reporting an issue

Avoid posting keys, full private responses, visitor IDs or database dumps in public issues. Use the repository owner's private GitHub security reporting channel if enabled. For ordinary bugs, submit sanitized reproduction steps following [the troubleshooting guide](docs/troubleshooting.md).
