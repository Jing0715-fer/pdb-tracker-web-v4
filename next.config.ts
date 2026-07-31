import type { NextConfig } from "next";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname_val = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ["molstar"],
  // Next.js 16 dev mode blocks cross-origin HMR by default. Playwright
  // headless chromium sees 127.0.0.1:3000 as cross-origin. Allow it.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '.space-z.ai'],
  // Optimize barrel imports for heavy libraries so webpack only resolves
  // the actually-used symbols instead of the entire barrel graph. This is
  // the single biggest dev-mode memory win for apps that pull from large
  // barrel-export libraries (recharts, framer-motion, radix).
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'framer-motion',
      '@radix-ui/react-icons',
      'date-fns',
      'react-markdown',
    ],
  },
  // Webpack file-watcher ignore list. Runtime writes to these paths
  // (.hermes/ LLM cache + db-config, dev.log tee'd output, db/ SQLite,
  // wiki/ LLM-Wiki reports) must NOT trigger a Fast Refresh / recompile —
  // otherwise the page refreshes and CSS flashes during evaluation runs.
  webpack: (config, { dev }) => {
    // ── OOM mitigation (low-memory environments) ─────────────────────────
    // molstar (~95 MB of TypeScript source) is imported dynamically from
    // client components. In dev, webpack eagerly compiles every dynamic-
    // import target on first request — with 4 GB of RAM the Next.js dev
    // server OOMs while compiling the homepage. Three knobs:
    //
    //   1. parallelism: 1 — serialize module compilation. Parallel workers
    //      each allocate their own heap and together exceed available RAM.
    //   2. unmanagedPaths for molstar — webpack skips re-scanning its 95 MB
    //      of source on every rebuild.
    //   3. infrastructureLogging.level: 'warn' — silence the verbose
    //      progress logs that themselves hold large string buffers in memory.
    //   The single biggest help is the NODE_OPTIONS --max-old-space-size
    //   set in package.json dev script (3072 lets V8 grow into virtual
    //      memory even when physical RAM is only 4 GB — the kernel pages).
    config.parallelism = 1;
    config.snapshot = config.snapshot || {};
    config.snapshot.unmanagedPaths = [
      ...(config.snapshot.unmanagedPaths || []),
      resolve(__dirname_val, 'node_modules', 'molstar'),
    ];
    config.infrastructureLogging = Object.assign(config.infrastructureLogging || {}, {
      level: 'warn',
    });

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
