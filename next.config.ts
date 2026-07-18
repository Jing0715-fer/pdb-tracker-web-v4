import type { NextConfig } from "next";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname_val = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ["molstar"],
  // Next.js 16 dev mode blocks cross-origin HMR by default. Playwright
  // headless chromium sees 127.0.0.1:3000 as cross-origin. Allow it.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Webpack file-watcher ignore list. Runtime writes to these paths
  // (.hermes/ LLM cache + db-config, dev.log tee'd output, db/ SQLite,
  // wiki/ LLM-Wiki reports) must NOT trigger a Fast Refresh / recompile —
  // otherwise the page refreshes and CSS flashes during evaluation runs.
  webpack: (config, { dev }) => {
    if (dev) {
      const root = resolve(__dirname_val);
      const ignored = [
        resolve(root, '.hermes'),
        resolve(root, 'dev.log'),
        resolve(root, 'dev.out.log'),
        resolve(root, 'db'),
        resolve(root, 'wiki'),
        resolve(root, 'tool-results'),
        resolve(root, '.bun'),
      ];
      // Use webpack's snapshot config to ignore these paths — this prevents
      // file changes from triggering rebuilds. WatchIgnorePlugin may not
      // always be available depending on the Next.js internal webpack setup,
      // so we set snapshot.managedPaths + immutablePaths as the reliable
      // mechanism.
      config.snapshot = config.snapshot || {};
      config.snapshot.managedPaths = (config.snapshot.managedPaths || []).concat(ignored);
      config.snapshot.immutablePaths = (config.snapshot.immutablePaths || []).concat(ignored);
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "*" },
        ],
      },
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;