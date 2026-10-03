import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin.ts";

// Restricted macOS environments need polling instead of FSEvents.
const usePollingWatcher = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      watch: {
        // Local databases, review copies and exports must not trigger HMR.
        ignored: [
          "**/.local/**",
          "**/.local-assets/**",
          "**/.wrangler/**",
          "**/outputs/**",
          "**/dist/**",
        ],
        ...(usePollingWatcher ? { useFsEvents: false, usePolling: true } : {}),
      },
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        configPath: "./wrangler.jsonc",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        ...(mode === "test"
          ? { persistState: { path: ".wrangler/test-state" }, inspectorPort: false }
          : {}),
        // Build artifacts must never package a developer's local AI keys.
        // Deployment supplies secrets independently through the Worker environment.
        ...(command === "build" || mode === "test"
          ? { config: { secrets: { required: [] } } }
          : {}),
      }),
    ],
  };
});
