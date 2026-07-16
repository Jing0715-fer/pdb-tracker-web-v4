# Task: p4-devops — DevOps files for PDB Structure Tracker

**Agent:** main (p4-devops)
**Date:** 2026-07-16
**Scope:** Create 5 new DevOps files only — do NOT modify existing source.

## Files created

| # | Path | Purpose |
|---|------|---------|
| 1 | `.github/workflows/ci.yml` | GitHub Actions CI/CD pipeline |
| 2 | `src/app/api/health/route.ts` | Health-check endpoint (200 ok / 503 degraded) |
| 3 | `src/lib/logger.ts` | Structured JSON logger with `createLogger(module)` |
| 4 | `scripts/backup-db.sh` | SQLite backup script (cron-friendly, 7-backup rotation) |
| 5 | `src/app/api/docs/route.ts` | OpenAPI 3.0 spec endpoint |

## Key design decisions

### 1. CI/CD (`.github/workflows/ci.yml`)
- Two jobs: `lint` (runs on every push + PR) and `build` (gated behind `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` so PRs skip the expensive production build).
- Uses `oven-sh/setup-bun@v2` + `actions/setup-node@v4` (Node 20) per the task spec.
- Caches `node_modules` (keyed on `bun.lock` + `package.json`) and `.next/cache` (keyed on lockfile + `next.config.ts`) with `restore-keys` fallbacks for partial hits.
- `concurrency` group cancels superseded runs on the same ref.
- `bun install --frozen-lockfile` for reproducible installs.
- Build job sets `NEXT_TELEMETRY_DISABLED=1` for clean logs.

### 2. Health endpoint (`src/app/api/health/route.ts`)
- `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'` — matches the existing `db-config` route convention so the route never gets statically optimized or cached.
- Imports `db` from `@/lib/db` (the Proxy) and runs `db.$queryRaw\`SELECT 1\`` to probe the **active** DB (honours `.hermes/db-config.json` → `DATABASE_URL` → bundled test DB).
- Returns the exact shape requested: `status`, `timestamp`, `uptime`, `memory{rss,heapUsed,heapTotal,external}` (bytes→MB), `db`, `version` (`1.0.0`).
- 200 when DB ok, **503** when the probe throws — wrapped so a thrown Prisma error degrades the probe instead of crashing the route.
- Uses the new `createLogger('api/health')` for the failure path.

### 3. Logger (`src/lib/logger.ts`)
- `LogLevel` union + `LogEntry` interface exactly as specified.
- `createLogger(module)` returns `{ debug, info, warn, error, module }`.
- Each method builds a `LogEntry` and `console.log(JSON.stringify(entry))` (single-line JSON, stdout — aggregator-friendly).
- `error(message, error?, data?)` serializes via `serializeError()` which handles `Error` instances, strings, and plain objects (captures `name`/`message`/`stack`).
- `LEVEL_PRIORITY` + `resolveMinLevel()` (env `LOG_LEVEL` or `NODE_ENV`-based default: `debug` in dev, `info` in prod) gates emission so below-threshold entries aren't stringified at all.
- Default logger (`createLogger('app')`) exported as default; `createLogger` named export.

### 4. Backup script (`scripts/backup-db.sh`)
- `set -euo pipefail`; resolves `PROJECT_ROOT` from `BASH_SOURCE` so it works from any cwd (cron-friendly).
- Source: `db/pdb-tracker.db` → dest: `db/backups/pdb-tracker-YYYYMMDD-HHMMSS.db` (UTC stamps for cron consistency).
- **Atomic write**: `cp -a` to `*.tmp` then `mv` into place — a crashed run never leaves a half-written backup the prune step would keep.
- **Rotation**: `ls -1t pdb-tracker-*.db` (newest first) → delete everything after index `KEEP_COUNT=7`. `backup.log` and `.tmp` files are excluded from the candidate set.
- **Logging**: every action (`BACKUP ok`, `PRUNE removed`, `SKIP`, `WARN`, `FAIL`) appends one ISO-8601-UTC line to `db/backups/backup.log` AND echoes to stdout (so cron captures it).
- Missing source DB → `SKIP` + exit 0 (so cron doesn't spam on a fresh install).
- Verified working: ran it once → produced `pdb-tracker-20260716-102648.db` (163840 bytes, size matches source) + log entry.

### 5. API docs (`src/app/api/docs/route.ts`)
- Returns a full **OpenAPI 3.0.3** document as `application/json; charset=utf-8` with `Cache-Control: no-store`.
- `info` block: title "PDB Structure Tracker API", version `1.0.0`, description.
- All 9 required paths documented with `summary`, `parameters`, `requestBody` (where applicable), and typed `responses`:
  - `GET /api/snapshots`, `GET /api/entries`, `GET /api/evaluations`, `POST /api/evaluations/run`, `DELETE /api/evaluations/{uniprotId}`, `GET /api/db-config`, `POST /api/db-config`, `GET /api/health`, `POST /api/literature/daily/run`, `POST /api/pdb-weekly/run`.
- `components.schemas` define reusable `Error`, `Snapshot`, `PdbEntry`, `Evaluation`, `EvaluationsResponse`, `DbConfig` shapes (referenced via `$ref`) — schemas match the actual response shapes emitted by the existing routes (verified against `src/app/api/snapshots/route.ts`, `evaluations/route.ts`, `db-config/route.ts`).
- Tags group endpoints by feature for Swagger UI navigation.

## Verification

### `node scripts/lint.mjs`
```
FAIL  317 file(s), 3 errors, 0 warnings

/home/z/my-project/src/components/eval-dashboard.tsx
  754:30  error  react-hooks/preserve-manual-memoization  (PRE-EXISTING)
/home/z/my-project/src/components/weekly-structure-compare.tsx
  70:45  error  react-hooks/preserve-manual-memoization  (PRE-EXISTING)
```
- **0 errors / 0 warnings in the 3 new TS files** (`logger.ts`, `api/health/route.ts`, `api/docs/route.ts`).
- The 3 errors are pre-existing in untouched files — confirmed by worklog.md line 3055 and by grepping the lint output for `logger|api/health|api/docs` (no matches).

### Backup script runtime test
```
$ bash scripts/backup-db.sh
[2026-07-16T10:26:48Z] BACKUP ok src=/home/z/my-project/db/pdb-tracker.db dest=/home/z/my-project/db/backups/pdb-tracker-20260716-102648.db src_bytes=163840 dest_bytes=163840
```
File sizes match → backup integrity verified.

### Runtime note (not a failure)
The currently-running server is the **production standalone build** (`.next/standalone`, started by `start-standalone.sh`), not `bun run dev`. New `src/app/api/*/route.ts` files are therefore not served until the next `next build` (which the new CI pipeline runs on push to `main`). This is expected and outside the task scope — the task's verification criterion is `node scripts/lint.mjs`, which passes for all new files.
