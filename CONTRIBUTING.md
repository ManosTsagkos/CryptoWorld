# Contributing

Use Node.js 22.13 or newer. Install with `npm ci`, initialize local D1 with `npm run db:migrate:local`, then start `npm run dev`. AI keys are optional; see [the README](README.md).

Before opening a pull request, run `npm run check`. Tests use an isolated D1 store under the ignored `.wrangler/test-state` directory and do not load your AI keys.

Use `npm run format` after editing. Formatting is checked alongside lint and tests, so the source stays consistent across editors. Generated runtime types, migrations, lockfiles and local working files are excluded.

When changing a database table, update `db/schema.ts`, run `npm run db:generate`, and include the new migration and snapshot. The schema regression test executes all committed SQL against a fresh SQLite database and compares it with the schema and final snapshot.

For provider or indicator changes, add a focused unit fixture that covers the behavior and failure case. The standard test suite avoids public API requests so it can run reproducibly in CI. Verify live provider behavior separately and document which source supplied the result.

Keep secrets and machine-specific files local. For bug reports, include the endpoint, status, timestamp and sanitized reproduction steps described in [Troubleshooting](docs/troubleshooting.md).
