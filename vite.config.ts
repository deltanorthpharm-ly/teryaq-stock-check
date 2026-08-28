// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const stockCheckApiTarget = process.env.STOCK_CHECK_API_PROXY_TARGET || "http://127.0.0.1:3001";

export default defineConfig({
  vite: {
    server: {
      host: "127.0.0.1",
      port: 5181,
      proxy: {
        "/api/stock-check": {
          target: stockCheckApiTarget,
          changeOrigin: true,
        },
      },
    },
  },
  nitro: {
    preset: "node-server",
    serveStatic: true,
    routeRules: {
      "/api/stock-check/**": {
        proxy: `${stockCheckApiTarget}/api/stock-check/**`,
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
