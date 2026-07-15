/**
 * Chinese locale strings for PDB Tracker.
 * Used by the useI18n() hook.
 */
export const zh = {
  // ─── Run Center ──────────────────────────────────────────────────────────
  runCenter: '运行中心',
  runCenterDesc: '每日文献检索 · 蛋白靶点评估 · PDB 周报生成 — 支持并行触发、SSE 实时进度、自动 provider 选择',
  llmProvider: 'LLM 提供方',
  database: '数据库',
  dbTestWarning: '当前使用的是测试数据库（db/custom.db），仅用于功能验证。建议点击「新建」创建正式数据库以保存您的工作数据。',
  dbReady: '数据库已就绪，运行中心与三大模块已同步',
  dbNew: '新建',
  dbSelect: '选择',
  dbSwitch: '切换',

  // ─── Module tabs ─────────────────────────────────────────────────────────
  tabEval: '蛋白靶点评估',
  tabEvalShort: '评估',
  tabLit: '每日文献检索',
  tabLitShort: '文献',
  tabWeekly: 'PDB 周报生成',
  tabWeeklyShort: '周报',

  // ─── Evaluation module ───────────────────────────────────────────────────
  evalTitle: '蛋白靶点评估 + LLM 可行性报告',
  evalEndpoint: 'POST /api/evaluations/run',
  evalDesc: 'UniProt → 元数据 + 序列 → RCSB 直接 PDB → SIFTS 覆盖率 → NCBI BLASTp 同源 → 评分 → 原子任务包含 LLM 报告生成（写入 Evaluation.report + EvaluationReport 表 + 可选 LLM-Wiki）。支持多个 UniProt ID 批量评估，自动归入 batch，并分析靶点间共有的结构与相关性。',
  evalInputModeUniprot: 'UniProt ID',
  evalInputModeSequence: '序列输入',
  evalSeqTypeAA: '氨基酸',
  evalSeqTypeDNA: 'DNA',
  evalTargets: '靶点',
  evalAddTarget: '添加',
  evalClearTargets: '清空',
  evalRun: '立即评估',
  evalRunning: '评估中…',
  evalPlaceholderUniprot: '输入 UniProt ID（如 P04626），回车添加。多个 ID = 批量评估。',
  evalPlaceholderSeqAA: '输入氨基酸序列进行 BLASTp 同源搜索（多序列用空行分隔）',
  evalPlaceholderSeqDNA: '输入 DNA 序列进行 BLASTp 同源搜索（多序列用空行分隔）',
  evalBatchHint: '支持多序列输入，用空行分隔。每条序列独立进行 BLAST 搜索和评估。',
  evalMaxPdb: 'Max PDB',
  evalBlastLimit: 'BLAST 上限',
  evalMaxLit: 'maxLitCount',
  evalSkipBlast: 'skipBlast',
  evalForceBlast: 'forceBlast',
  evalReport: '查看评估报告',

  // ─── Literature module ───────────────────────────────────────────────────
  litTitle: '每日结构生物学文献报告',
  litEndpoint: 'POST /api/literature/daily/run',
  litDesc: 'PubMed 双通路检索（Path A 结构生物学关键词 + Path B 期刊 RSS），按方法筛选（Cryo-EM / X-ray / NMR），LLM 中文摘要聚合，可在历史报告列表中回看任意日期摘要。',
  litDate: '日期',
  litWindowDays: '窗口天数',
  litRun: '立即检索',
  litRunning: '检索中…',
  litMaxPapers: '上限',

  // ─── Weekly module ───────────────────────────────────────────────────────
  weeklyTitle: '对抗式 PDB 周报生成器',
  weeklyEndpoint: 'POST /api/pdb-weekly/run',
  weeklyDesc: 'web-v3 进程内 2-step 对抗式生成器：fetch → backfill → PubMed → Generator → Critic-Scientific → (Synthesis) → 写 DB。复用当前选中的 LLM 提供方。SSE 流式推送进度，页面不会冻结。预计耗时 5–15 分钟。',
  weeklyWeek: 'ISO 周',
  weeklyCycles: '迭代',
  weeklyRun: '立即触发',
  weeklyRunning: '生成中…',

  // ─── Execution log ───────────────────────────────────────────────────────
  execLog: '执行日志',
  execLogExport: '导出',
  execLogClear: '清空',
  execLogSearch: '搜索日志…',
  execLogFilterAll: '全部',
  execLogEmpty: '暂无执行日志，触发上方模块即可开始',
  execLogExportTitle: '运行中心执行日志',

  // ─── Settings ────────────────────────────────────────────────────────────
  settings: '设置',
  language: '语言',
  languageEn: 'English',
  languageZh: '中文',

  // ─── Common ──────────────────────────────────────────────────────────────
  close: '关闭',
  cancel: '取消',
  confirm: '确认',
  delete: '删除',
  save: '保存',
  loading: '加载中…',
  noData: '暂无数据',
  next: '下一步',
  prev: '上一步',
  finish: '完成',
  skip: '跳过',
} as const;

export type Locale = typeof zh;
