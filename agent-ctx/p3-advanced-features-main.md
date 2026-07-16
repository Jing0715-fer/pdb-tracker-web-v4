# Task: p3-advanced-features — Plugin System, Collaboration, Citation Network

**Agent:** main (p3-advanced-features)
**Date:** 2026-07-16
**Scope:** Create 7 new files (5 listed + 2 supporting) — do NOT modify existing source.

## Files created

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/lib/plugin-system.ts` | `LLMProviderPlugin` interface + `PluginRegistry` class + process-wide singleton `pluginRegistry` + `callWithPlugin()` fall-through helper |
| 2 | `src/lib/plugins/sample-provider.ts` | Two mock providers (`sample:echo`, `sample:reverse`) demonstrating the plugin contract + `registerAllSampleProviders()` helper |
| 3 | `src/lib/eval-plugin.ts` | `EvalModulePlugin` interface (`preEvaluate` / `postScore` / `customScore`) + `EvalPluginRegistry` class + process-wide singleton `evalPluginRegistry` + safe `runPreEvaluate` / `runPostScore` / `runCustomScores` orchestrators |
| 4 | `src/app/api/comments/route.ts` | `GET / POST / DELETE /api/comments` — lazy `CREATE TABLE IF NOT EXISTS Comments` + parameterised raw SQL |
| 5 | `src/app/api/share/route.ts` | `POST /api/share` (create snapshot + UUID token) + `GET /api/share` (list) — lazy `CREATE TABLE IF NOT EXISTS Shares` |
| 6 | `src/app/api/share/[shareId]/route.ts` | `GET /api/share/{shareId}` — fetch + expiry check (404 if expired/missing) |
| 7 | `src/app/api/citations/route.ts` | `GET /api/citations?pmids=...` — builds `{ nodes, edges }` citation network from PubMed/PDB data |

Note: file 6 is not in the original task list but is required by the spec ("GET `/api/share/{shareId}`") — Next.js App Router requires a separate `[shareId]/route.ts` file for path-parameter routes. Per the task constraint "only create new files — do NOT modify existing source", creating this additional new file is permitted.

## Key design decisions

### 1. `plugin-system.ts` — Custom LLM provider registry
- `LLMProviderPlugin` interface exactly as specified (`id`, `name`, `description`, `call`, `isAvailable`).
- `PluginRegistry` methods: `register`, `unregister`, `get`, `list`, `listAvailable` — all matching the spec signatures.
- `register()` validates required fields (id, call, isAvailable) and throws `TypeError` on bad input — protects against runtime-misconfigured plugins.
- `listAvailable()` uses `Promise.all` over `isAvailable()` probes; a throwing probe is silently skipped (never crashes the caller).
- Process-wide singleton via `globalThis.__pdb_plugin_registry__` — same pattern as `src/lib/db.ts` so Next.js hot-reload does not duplicate state.
- Bonus: `callWithPlugin(prompt, ids?, options?)` walks candidate providers in order, falls through on failure, mirroring the built-in provider walker in `src/lib/llm.ts`.

### 2. `plugins/sample-provider.ts` — Mock echo/reverse providers
- Two providers shipped: `sample:echo` (echoes prompt with system/model/temperature prefix) and `sample:reverse` (returns prompt reversed) — demonstrates multi-provider registration.
- `isAvailable()` always returns `true` (nothing to probe for a mock).
- `call()` returns deterministic content + `tokensUsed` (≈ chars/4) + `durationMs` (real wall-clock).
- Tiny `setTimeout(resolve, 10)` latency so consumers can exercise loading UIs without hitting a real network.
- `registerAllSampleProviders()` convenience helper — safe to call multiple times (idempotent).

### 3. `eval-plugin.ts` — Custom evaluation module registry
- `EvalModulePlugin` interface exactly as specified: optional `preEvaluate` / `postScore` / `customScore`.
- `EvalPluginRegistry.register()` validates that at least one of the three hooks is implemented.
- Three orchestrator methods that **never throw** on a plugin error:
  - `runPreEvaluate(uniprotId)` — aggregates `{ skip, extraData }` across plugins (skip = OR, extraData = merged).
  - `runPostScore(uniprotId, scores)` — chains plugins so each sees the previous one's mutations.
  - `runCustomScores(data)` — returns `{ [pluginId]: { score, label, details? } }`.
- Failed hooks are logged via `console.error` and skipped — a broken plugin cannot poison the main evaluation pipeline (`src/lib/target-evaluation.ts`).

### 4. `comments/route.ts` — Comment CRUD
- `runtime = 'nodejs'; dynamic = 'force-dynamic'` — matches the existing `db-config` route convention so the route never gets statically optimised or cached.
- `ensureSchema()` runs `CREATE TABLE IF NOT EXISTS Comments (...)` + `CREATE INDEX IF NOT EXISTS idx_comments_target` on first access. Table layout: `id INTEGER PK AUTOINCREMENT`, `targetType`, `targetId`, `author`, `content`, `createdAt` (ISO), `updatedAt` (ISO).
- **GET** `/api/comments?targetType=evaluation&targetId=P04626` — returns `{ comments: Comment[] }`. Supports optional filtering by `targetType` alone or no filter (recent activity), and an optional `limit` (default 200, max 1000).
- **POST** `/api/comments` body `{ targetType, targetId, author, content }` — validates required fields (returns 400 with field list on missing), trims + length-caps inputs, defaults `author` to `"anonymous"`, returns `{ comment: Comment }` with status 201. Reads back the inserted row via `last_insert_rowid()` so the response is authoritative.
- **DELETE** `/api/comments?id=N` — idempotent (returns `{ ok: true }` even if row didn't exist); includes `deleted` count for diagnostic UIs.
- All SQL via `db.$queryRawUnsafe` / `db.$executeRawUnsafe` with `?` placeholders — never string-interpolated — so the API is SQL-injection-safe.
- BigInt-safe via `safeJsonParse` (same helper used by `evaluations/route.ts`).

### 5. `share/route.ts` + `[shareId]/route.ts` — Evaluation share links
- Lazy `CREATE TABLE IF NOT EXISTS Shares (shareId TEXT PK, uniprotId, snapshotJson, sharedAt, expiresAt)` + index on `expiresAt` for sweep queries.
- **POST** `/api/share` body `{ uniprotId, expiresInHours? }` — returns 404 if the evaluation does not exist (nothing to share). Otherwise:
  - Snapshots the full evaluation (Evaluation row + EvaluationPdbStructure[] + EvaluationBlastResult[]) as JSON in `snapshotJson`. This makes the shared view **immutable** — a later re-run does not change what was shared (standard "share snapshot" contract).
  - Generates a UUID token via `crypto.randomUUID()`.
  - Default expiry 168h (7 days), max 8760h (1 year), clamped server-side.
  - Returns `{ shareId, url, expiresAt, sharedAt }` with status 201. The `url` is a relative path (`/api/share/{shareId}`) so the browser resolves it with its own origin — works behind the sandbox gateway without host config.
- **GET** `/api/share` (no path param) — lists recent shares (excludes the large `snapshotJson` column), marks each as `expired: boolean`. Supports optional `?uniprotId=` filter.
- **GET** `/api/share/{shareId}` (in `[shareId]/route.ts`) — uses the Next.js 15+ `params: Promise<{shareId}>` signature. Returns 404 if missing OR expired (treats "expired" identically to "missing" so callers have one code path). Corrupt `snapshotJson` returns 500 with a clear message.

### 6. `citations/route.ts` — Citation network builder
- **GET** `/api/citations?pmids=12345,67890[&minWeight=1]` — accepts up to 200 comma-separated PMIDs. Empty list → 400; missing papers → empty graph (not 404).
- Returns `{ nodes, edges, stats }` where:
  - `CitationNode = { id, title, authors, journal, year, if }` — `if` is looked up from `PdbStructure.journalIf` matched by PubMed ID (highest value wins).
  - `CitationEdge = { source, target, type, weight }` — `type ∈ 'shared_pdb' | 'shared_keyword' | 'shared_method'`, `weight` = count of shared items.
  - `stats` = `{ nodeCount, edgeCount, edgesByType }` for UI quick-render.
- Edge construction:
  - **shared_pdb** — papers both reference the same PDB ID. Sources: `PdbStructure.pubmedId` (the deposition paper) PLUS `EvaluationBlastResult.pubmedId` (papers that cite a PDB without being its depositor — captured by the eval pipeline). The blast-result query is wrapped in `.catch(() => [])` because the table may not exist on a fresh DB.
  - **shared_method** — papers' associated PDBs share a normalised method. `normalizeMethod()` collapses `"X-RAY DIFFRACTION"` → `"x-ray"`, `"ELECTRON MICROSCOPY"` → `"cryo-em"`, etc., so similar methods match.
  - **shared_keyword** — papers share significant tokens from title + abstract. `extractKeywords()` lowercases, matches `[a-z][a-z0-9]{3,}` (≥4 chars), filters against a 100+ word stopword set, caps at 40 keywords/paper.
- All pairwise comparisons are O(N²) where N ≤ 200 → ≤ 19,900 comparisons — well within budget. Each comparison does 3 small `Set.intersectionSize` calls (iterating the smaller set).
- IF lookup intentionally does NOT call Crossref (unlike `literature/papers/route.ts`) to keep the endpoint fast and dependency-free — `if` is `null` when no local match exists.
- All SQL via `db.$queryRawUnsafe` with `?` placeholders and a dynamically-built `IN (?, ?, ...)` list — SQL-injection-safe even though `pmids` is user-supplied.

## Verification

### `node scripts/lint.mjs`
```
FAIL  324 file(s), 3 errors, 0 warnings
```
The 3 errors are PRE-EXISTING (confirmed against worklog.md and the p4-devops agent-ctx):
- `src/components/eval-dashboard.tsx:754:30  react-hooks/preserve-manual-memoization`
- `src/components/weekly-structure-compare.tsx:70:45  react-hooks/preserve-manual-memoization`

**0 errors / 0 warnings in any of the 7 new files** — verified by grepping the lint output for `plugin-system|eval-plugin|sample-provider|comments/route|share/route|share/\[shareId\]/route|citations/route` → no matches.

### `npx tsc --noEmit` (project-wide)
113 TS errors total, all pre-existing in untouched files (i18n, llm.ts, weekly components, etc.). Grep for the 7 new file paths in the TS output → ZERO matches.

### Smoke test (`bun /tmp/smoke.mjs`)
Imported `plugin-system.ts`, `plugins/sample-provider.ts`, `eval-plugin.ts` and exercised every public method:
```
providers: [ "sample:echo", "sample:reverse" ]
available: [ "sample:echo", "sample:reverse" ]
echo result: {"providerId":"sample:echo","content":"[echo via echo-1 (t=0.7)] Hello world","tokensUsed":10,"durationMs":12}
reverse result: {"providerId":"sample:reverse","content":"[reverse via reverse-1] cba","tokensUsed":7,"durationMs":5}
after unregister: [ "sample:reverse" ]
after registerAll: [ "sample:reverse", "sample:echo" ]
preEvaluate: {"skip":false,"extraData":{"note":"checked P04626"}}
customScores: {"test:druggability":{"score":100,"label":"Druggability","details":"pdb=5 cov=60"}}
postScore: {"overall":{"score":70,"label":"Overall"},"confidence":{"score":80,"label":"Confidence"}}
SMOKE PASS
```

### Runtime note (same as p4-devops)
The currently-running server is the **production standalone build** (`.next/standalone`, started by `start-standalone.sh`), not `bun run dev`. New `src/app/api/*/route.ts` files are therefore not served until the next `next build`. This is expected and outside the task scope — the task's verification criterion is `node scripts/lint.mjs`, which passes for all 7 new files. `dev.log` shows no compile errors after the new files were created (only the pre-existing `url.parse()` deprecation warnings).
