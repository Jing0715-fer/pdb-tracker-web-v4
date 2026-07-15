# Task: batch-i18n-rounds — Apply i18n translations to 16 component files

## Summary

Applied i18n translations (`useI18n()` hook from `@/lib/i18n`) to 16 component files,
replacing hardcoded English UI strings with `t.*` references drawn from the existing
translation dictionaries in `src/lib/i18n/en.ts` and `src/lib/i18n/zh.ts`.

All required translation keys already exist in the dictionaries
(`searchEvals`, `exportDataBtn`, `filterTable`, `searchPapers`, `searchAll`,
`markAllRead`, `clearAll`, `clearAllActivities`, `closeBtn`, `breadcrumb`,
`resolutionLabel`, `molprobityScore`, `clashScore`, `ramaFavored`, `entities`,
`ligands`, `selectAllRows`, `refreshDataBtn`, `copySection`, `copySummary`,
`regenerateSummary`, `collapse`, `copy`, `changeColor`, `changeLigandColor`).

## Files modified (16)

1. `src/components/EvalPageControls.tsx` — searchEvals + exportDataBtn
2. `src/components/EvaluationToolbar.tsx` — filterTable
3. `src/components/LiteratureSection.tsx` — searchPapers
4. `src/components/command-palette.tsx` — searchAll
5. `src/components/activity-feed.tsx` — markAllRead / clearAll / clearAllActivities / closeBtn
6. `src/components/breadcrumb-nav.tsx` — breadcrumb
7. `src/components/comparison-panel.tsx` — resolutionLabel / molprobityScore / clashScore /
   ramaFavored / entities / ligands
8. `src/components/WeeklyPdbTable.tsx` — selectAllRows (hook was already present)
9. `src/components/literature/LiteratureDetailPanel.tsx` — closeBtn
10. `src/components/literature/LiteraturePaperCompare.tsx` — closeBtn
11. `src/components/cache-status-indicator.tsx` — refreshDataBtn (title + aria-label)
12. `src/components/enhanced-footer.tsx` — refreshDataBtn (title + aria-label)
13. `src/components/ai-analysis-panel.tsx` — copySection
14. `src/components/ai-weekly-summary-panel.tsx` — copySummary / regenerateSummary / collapse
15. `src/components/sequence-viewer.tsx` — copy
16. `src/components/PdbStructureViewer.tsx` — changeColor (title + aria-label on entity color
    button), changeLigandColor (aria-label on ligand color button).
    Note: This file has multiple component functions; `useI18n()` was added to both
    `ChainRowItem` and `LigandRowItem`, since each uses `t.*`.

## Pattern applied

For each file:
1. Added `import { useI18n } from '@/lib/i18n';` near other local imports.
2. Added `const { t, locale } = useI18n();` immediately after the props-destructure
   closing `) {` and before any state hooks.
3. Replaced the listed hardcoded strings with `t.<key>` references.
4. For `WeeklyPdbTable.tsx` (file 8), the import + hook were already in place from
   a previous i18n round; only the `aria-label="Select all rows"` → `t.selectAllRows`
   replacement was applied.

## Verification

- `node scripts/lint.mjs` → **PASS — 313 file(s) scanned, 0 errors, 0 warnings**
- No leftover target strings remain in the 16 assigned files.

## Notes / Out-of-scope

The following files also contain similar untranslated strings but were **not** in
this batch's task list (left for a future round):
- `src/components/notification-panel.tsx` — "Mark all read"
- `src/components/notification-bell.tsx` — "Mark all read"
- `src/components/literature/LiteratureToolbar.tsx` — "Search papers by title..."

In `src/components/PdbStructureViewer.tsx`, line 687 (ligand color button) still has
`title="Change color"` because the task only specified replacing the first occurrence
of `title="Change color"` (entity color button, line 588). The aria-label for the
ligand button was changed to `t.changeLigandColor` as instructed.
