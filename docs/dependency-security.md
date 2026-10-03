# Dependency security review

Reviewed on 3 October 2026. Audit results can change when new advisories are published.

## Outstanding development-tool advisory

The full `npm audit` currently reports eight high-severity dependency entries caused by one underlying advisory: [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). It concerns stack exhaustion when `braces` processes deeply nested brace patterns. The affected version is `braces` 3.0.3; the advisory lists no patched version, and 3.0.3 remains the latest npm release at the review date.

The package is transitive development tooling, reached through `micromatch` and `fast-glob` in the Next ESLint plugin and Vinext's Vite CommonJS/dynamic-import tooling. In this project these tools process repository configuration and source import patterns. The market, credits, analysis and share endpoints do not pass visitor input into those glob processors. A search of the generated Worker JavaScript also found no `braces`, `micromatch` or `fast-glob` references. This limits the identified exposure to development/build inputs; it is not a blanket claim that the application has no security risk.

`npm audit --omit=dev` reports zero advisories for production dependencies at the same review date. The full audit warning is intentionally retained. The suggested forced downgrades of `eslint-config-next` to 14.2.35 and `vinext` to 0.0.15 would change the framework/tooling compatibility and are not an appropriate patch for this application.

Until an upstream fix is released, use trusted repository configuration and source files when running lint or builds. Review changes to glob patterns, dynamic imports and build configuration before running tooling from an unfamiliar branch. Recheck the upstream advisory and npm releases, then update the lockfile and run the complete quality checks when a compatible fix becomes available.

## Reproducing the review

```sh
npm audit
npm audit --omit=dev
npm ls braces --all
npm view braces version
npm run check
```

Do not disable TLS verification to run these commands. Environments that require the operating system's trusted certificates can use Node's `--use-system-ca` option as described in the troubleshooting guide.
