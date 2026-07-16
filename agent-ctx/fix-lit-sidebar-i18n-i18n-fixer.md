# Task: fix-lit-sidebar-i18n — Literature mode sidebar & stat cards i18n

**Agent:** i18n-fixer
**Date:** 2025-01

## Goal

Fix the remaining English text in the Literature mode sidebar and stat cards so they switch dynamically between `zh` and `en` via the `useI18n()` hook's `locale` value, using the project's `locale === 'zh' ? '中文' : 'English'` inline pattern.

## Files modified

| File | Changes |
|------|---------|
| `src/components/literature/LiteratureDateSidebar.tsx` | Added `useI18n` import + `const { locale } = useI18n();`. Localized "Papers by Date" → "按日期浏览论文", "All:" / "Filtered:" / "All years" → "全部:" / "已筛选:" / "所有年份". |
| `src/components/pdb-tracker.tsx` | (Already had `const { t, locale } = useI18n();`.) Localized the inline lit detail panel strings: "Reading Progress" → "阅读进度", "Mark as Complete" → "标记为已完成", "Completed" → "已完成". |
| `src/components/literature/LiteratureReadingList.tsx` | Added `useI18n` import + `const { locale } = useI18n();` inside `ReadingListSidebar`. Localized "Reading Lists" → "阅读列表", "All Papers" → "全部论文", "Recently Added" → "最近添加", "Average Progress" → "平均进度", "papers in lists" → "篇在列表中", "completed" → "篇已完成". Added id-based helper `getDefaultListDisplayName(id, locale)` so default list names render as "待读"/"阅读中"/"已读" without mutating users' localStorage entries. |
| `src/components/literature/LiteratureReadingProgress.tsx` | Added `useI18n` import + `const { locale } = useI18n();`. Localized "Reading Progress" → "阅读进度", segment labels "Completed"/"Reading"/"Unread" → "已完成"/"阅读中"/"未读", summary "papers completed (… overall progress)" → "篇论文已完成 (… 总体进度)". |
| `src/components/literature/LiteratureStatCards.tsx` | Added `useI18n` import + `const { locale } = useI18n();`. Localized all 5 stat-card titles + subtitles + tooltips: "Total Papers" → "论文总数", "with IF data" → "有 IF 数据", "Avg Impact Factor" → "平均影响因子", "top-tier" → "顶级", "Top Journal" → "顶级期刊", "Latest Update" → "最新更新", "Reading Progress" → "阅读进度", "read"/"reading" → "已读"/"阅读中", "No data" → "暂无数据", "Invalid date" → "无效日期". |
| `src/components/literature/LiteratureSection.tsx` | (Already had `const { t, locale } = useI18n();`.) Localized the Dashboard view stat card labels: "Total Papers" → "论文总数", "Structures" → "结构", "High-IF (≥10)" → "高 IF (≥10)", "Avg IF" → "平均 IF". Plus surrounding English: "Paper Dashboard" → "论文仪表盘", "Browse papers…" → "按每周发布浏览论文", "Fetch Metadata" → "获取元数据", "Folders by Date" → "按日期分文件夹", "weeks" → "周", "No weekly data available" → "暂无周数据", "entries" → "条目", "papers" → "篇论文", "Top IF" → "顶级 IF", "Back to Folders" → "返回文件夹", "No literature data" → "暂无文献数据", "No results found" → "未找到结果", "Try a different search term" → "尝试其他搜索词". |
| `src/components/ui/stat-card.tsx` | Added `useI18n` import. Localized `FreshnessDot`'s "Fresh"/"Recent"/"Aging" labels → "新鲜"/"近期"/"老化". (Shared component — used by Weekly, Eval & Literature modules, so all three benefit.) |
| `src/components/literature/LiteratureDetailPanel.tsx` | (Already had `useI18n` import.) Extended `getReadingStatus(progress, locale)` helper to accept `locale` so its returned `label` ("Read"/"Reading"/"Unread") is localized to "已读"/"阅读中"/"未读". Localized: "Reading Progress" → "阅读进度", "Mark as Read" → "标记为已读", "Completed" → "已完成", "Reset" → "重置", "AI Summary" → "AI 摘要", "Generating..." → "生成中...", "Associated PDB Structures" → "关联 PDB 结构", "Related PDB Structures" → "相关 PDB 结构", tooltip "View 3D structure" / "Close 3D viewer" → "查看 3D 结构" / "关闭 3D 查看器". |

## Implementation notes

1. **Hook placement** — `const { locale } = useI18n();` is the first line of every component body that didn't already have it (right after props destructuring, before any other hooks/state). This satisfies React's rules-of-hooks ordering requirement.
2. **DEFAULT_LISTS persistence** — In `LiteratureReadingList.tsx`, the `To Read` / `Reading` / `Read` strings are persisted to `localStorage` as `name` on the `ReadingList` objects. To avoid migrating users' saved lists on locale switch, I left the storage format untouched and added `getDefaultListDisplayName(id, locale)` — when rendering, default lists (id `to-read` / `reading` / `read`) display via the helper, while custom user-created lists still render their stored `name`.
3. **`getReadingStatus` signature change** — Was `(progress: number)`, now `(progress: number, locale: 'en' | 'zh')`. Single call site updated.
4. **Shared `stat-card.tsx`** — `FreshnessDot` is used by Weekly, Evaluation and Literature modules. Adding `useI18n()` here benefits all three with no behaviour change for the `en` locale.

## Lint verification

```
$ node scripts/lint.mjs
FAIL  313 file(s), 3 errors, 0 warnings
  src/components/eval-dashboard.tsx            754:30  react-hooks/preserve-manual-memoization
  src/components/weekly-structure-compare.tsx   70:45  react-hooks/preserve-manual-memoization
```

The 3 errors are **pre-existing** in `eval-dashboard.tsx` and `weekly-structure-compare.tsx` — confirmed by running `git stash` → `node scripts/lint.mjs` (same 3 errors) → `git stash pop`. My changes introduced **0 new errors / 0 new warnings**.

## Dev server

`dev.log` shows workers ready on port 3000 with no compile errors after edits.

## Task status: ✅ DONE
