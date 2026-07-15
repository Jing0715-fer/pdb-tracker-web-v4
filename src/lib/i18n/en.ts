/**
 * English locale strings for PDB Tracker.
 * Used by the useI18n() hook.
 */
export const en = {
  // ─── Run Center ──────────────────────────────────────────────────────────
  runCenter: 'Run Center',
  runCenterDesc: 'Daily literature search · Protein target evaluation · PDB weekly report — supports parallel execution, SSE real-time progress, auto provider selection',
  llmProvider: 'LLM Provider',
  database: 'Database',
  dbTestWarning: 'Currently using a test database (db/custom.db) for validation only. Click "New" to create a production database.',
  dbReady: 'Database ready, Run Center and all 3 modules synced',
  dbNew: 'New',
  dbSelect: 'Select',
  dbSwitch: 'Switch',

  // ─── Module tabs ─────────────────────────────────────────────────────────
  tabEval: 'Protein Evaluation',
  tabEvalShort: 'Eval',
  tabLit: 'Literature Search',
  tabLitShort: 'Lit',
  tabWeekly: 'PDB Weekly Report',
  tabWeeklyShort: 'Weekly',

  // ─── Evaluation module ───────────────────────────────────────────────────
  evalTitle: 'Protein Target Evaluation + LLM Feasibility Report',
  evalEndpoint: 'POST /api/evaluations/run',
  evalDesc: 'UniProt → metadata + sequence → RCSB direct PDB → SIFTS coverage → NCBI BLASTp homology → scoring → atomic tasks include LLM report generation. Supports multiple UniProt IDs for batch evaluation with cross-target correlation analysis.',
  evalInputModeUniprot: 'UniProt ID',
  evalInputModeSequence: 'Sequence',
  evalSeqTypeAA: 'Amino Acid',
  evalSeqTypeDNA: 'DNA',
  evalTargets: 'Targets',
  evalAddTarget: 'Add',
  evalClearTargets: 'Clear',
  evalRun: 'Run Evaluation',
  evalRunning: 'Running…',
  evalPlaceholderUniprot: 'Enter UniProt ID (e.g. P04626), press Enter to add. Multiple IDs = batch eval.',
  evalPlaceholderSeqAA: 'Enter amino acid sequence for BLASTp homology search (separate multiple sequences with blank lines)',
  evalPlaceholderSeqDNA: 'Enter DNA sequence for BLASTp homology search (separate multiple sequences with blank lines)',
  evalBatchHint: 'Supports multiple sequence inputs, separated by blank lines. Each sequence is independently BLASTed and evaluated.',
  evalMaxPdb: 'Max PDB',
  evalBlastLimit: 'BLAST Limit',
  evalMaxLit: 'Max Literature',
  evalSkipBlast: 'Skip BLAST',
  evalForceBlast: 'Force BLAST',
  evalReport: 'View Report',

  // ─── Literature module ───────────────────────────────────────────────────
  litTitle: 'Daily Structure Biology Literature Report',
  litEndpoint: 'POST /api/literature/daily/run',
  litDesc: 'PubMed dual-pathway search (Path A: structural biology keywords + Path B: journal RSS), filter by method (Cryo-EM / X-ray / NMR), LLM Chinese summary aggregation, view historical reports by date.',
  litDate: 'Date',
  litWindowDays: 'Window (days)',
  litRun: 'Run Search',
  litRunning: 'Searching…',
  litMaxPapers: 'Max Papers',

  // ─── Weekly module ───────────────────────────────────────────────────────
  weeklyTitle: 'Adversarial PDB Weekly Report Generator',
  weeklyEndpoint: 'POST /api/pdb-weekly/run',
  weeklyDesc: 'web-v3 in-process 2-step adversarial generator: fetch → backfill → PubMed → Generator → Critic-Scientific → (Synthesis) → write DB. Uses the currently selected LLM provider. SSE streaming progress, non-blocking. Estimated 5-15 min.',
  weeklyWeek: 'ISO Week',
  weeklyCycles: 'Cycles',
  weeklyRun: 'Run Now',
  weeklyRunning: 'Generating…',

  // ─── Execution log ───────────────────────────────────────────────────────
  execLog: 'Execution Log',
  execLogExport: 'Export',
  execLogClear: 'Clear',
  execLogSearch: 'Search logs…',
  execLogFilterAll: 'All',
  execLogEmpty: 'No execution logs yet. Trigger a module above to get started.',
  execLogExportTitle: 'Run Center Execution Log',

  // ─── Settings ────────────────────────────────────────────────────────────
  settings: 'Settings',
  language: 'Language',
  languageEn: 'English',
  languageZh: '中文',

  // ─── Common ──────────────────────────────────────────────────────────────
  close: 'Close',
  cancel: 'Cancel',
  confirm: 'Confirm',
  delete: 'Delete',
  save: 'Save',
  loading: 'Loading…',
  noData: 'No data',
  next: 'Next',
  prev: 'Previous',
  finish: 'Finish',
  skip: 'Skip',
} as const;

export type Locale = typeof en;
