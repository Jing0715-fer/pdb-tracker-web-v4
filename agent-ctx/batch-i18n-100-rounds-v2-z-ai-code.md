# Batch i18n Round 2 — batch-i18n-100-rounds-v2

## 任务概述
为 12 个组件文件批量应用 i18n（中英文双语），统一使用 `useI18n()` 钩子 + `locale === 'zh' ? '中文' : 'English'` 模式。

## 已处理文件清单

| # | 文件 | 状态 | 主要改动 |
|---|------|------|---------|
| 1 | `src/components/keyboard-shortcuts-panel.tsx` | ✅ | 引入 `useI18n`；将模块级 `SHORTCUT_CATEGORIES` 和 `PRO_TIPS` 重构为 `buildShortcutCategories(locale)` / `buildProTips(locale)` 工厂函数；翻译 23 处快捷键描述、面板标题、底部提示 |
| 2 | `src/components/settings-run-panel.tsx` | ✅ | 已有 `useI18n`，扩展为 `const { t, locale } = useI18n()`；翻译 `Date`/`±Days`/`Path A Max`/`Path B Max`/`Max Papers`/`Max Lit`/`Run`/`Run Now`/`Running…`/`Stop` 等约 19 处字符串；`RunButton` 子组件独立调用 `useI18n` |
| 3 | `src/components/notification-panel.tsx` | ✅ | 引入 `useI18n`；将 `CATEGORY_CONFIG` 和 `FILTER_TABS` 重构为工厂函数 `buildCategoryConfig(locale)` / `buildFilterTabs(locale)`；翻译 17+ 处字符串：`Notifications`/`Mark all read`/`Clear all`/`Notification Preferences`/5 个偏好开关 label/5 个分类 label/5 个筛选标签/空状态文案/`View`/`Dismiss notification` |
| 4 | `src/components/keyboard-hints.tsx` | ✅ | 引入 `useI18n`；将 `SHORTCUT_CATEGORIES` 重构为 `buildShortcutCategories(locale)`；翻译 12 处快捷键描述、面板标题、底部提示 |
| 5 | `src/components/notification-bell.tsx` | ✅ | 引入 `useI18n`；将 `CATEGORY_CONFIG` 和 `FILTER_TABS` 重构为工厂函数；翻译 10+ 处字符串：`Notifications`/`Mark all read`/`Notification Preferences`/5 个偏好 label/5 个分类 label/5 个筛选标签/`View all activity`/空状态文案 |
| 6 | `src/components/preferences-dialog.tsx` | ✅ | 引入 `useI18n`；翻译 9+ 处主要可见 label：`Preferences`/`Table`/`Display`/`Sidebar`/`Advanced`/`Theme` 及其下所有 PreferenceRow 的 label/description（约 30+ 处）|
| 7 | `src/components/molecule-viewer.tsx` | ✅ | 引入 `useI18n`；翻译 `Reset Camera`/`Screenshot`/`Auto-Rotate`/`Density: ON/OFF`/`Background:`/`Fullscreen`/`View on RCSB PDB`/`Retry`/`Loading {pdbId}...`/加载阶段提示/`Representation` 子菜单/`Cartoon`/`Ball & Stick`/`Surface`/`Esc to close` 等 15+ 处 |
| 8 | `src/components/pdb-header.tsx` | ✅ | 引入 `useI18n`；翻译 5+ 处字符串：标题/副标题/各 Tooltip（`Command Palette`/`Keyboard Shortcuts`/`Help & Tour`/`Notifications`/`Recent Actions`/`Toggle Theme`/`Preferences`）/aria-label/`Notification History`/`Clear All`/`Showing X of Y`/timeAgo 中英文版 |
| 9 | `src/components/eval-dashboard.tsx` | ✅ | 引入 `useI18n`；翻译 `Recent Activity`/`Priority Recommendations`/`Progress Timeline` 3 处 section 标题 |
| 10 | `src/components/welcome-state.tsx` | ✅ | 已有 `useI18n`；将 `MODE_CONFIG` 重构为 `buildModeConfig(locale)`；翻译 `Quick Stats`/`Recent Activity`/`Quick Tips` 标题、3 个 mode 的 heading/description、3 个 mode 的 stats label、3 个默认 recent item 文案、3 个 tip description、3 个按钮 label、`getTimeAgo` 函数支持 locale 参数 |
| 11 | `src/components/literature/LiteratureToolbar.tsx` | ✅ | 引入 `useI18n`；将 `DATE_FILTERS`/`IF_FILTERS`/`SORT_OPTIONS` 重构为工厂函数；翻译 4+ 处字符串：搜索 placeholder、`Sort`、`Filters`、`Has PDB`、`Daily`、`Expand/Collapse`、3 个视图模式、`Export` 及 4 个导出菜单项 + 4 个 toast 消息、`Network`/`Charts`/`Journal Map` 切换、`X result(s)` 计数 |
| 12 | `src/components/pdb-tracker/evaluation-view.tsx` | ✅ | 已有 `useI18n`，扩展为 `const { t, locale } = useI18n()`；翻译 `Back to Evaluation`/`Exit batch detail`，将 `Compare`/`Dashboard`/`Timeline`/`Batch Matrix` 4 处硬编码替换为 `t.compare`/`t.dashboard`/`t.timeline`/`t.batchMatrix` |

## 验证
- `node scripts/lint.mjs` → **PASS 313 file(s) scanned, 0 errors, 0 warnings**
- Dev server 端口 3000 正常运行

## 实现要点
- **模块级静态数组本地化策略**：将 `const X = [...]` 改写为 `const buildX = (locale) => [...]` 工厂函数，组件内通过 `const X = buildX(locale)` 派生。这是处理 keyboard-shortcuts-panel/keyboard-hints/notification-panel/notification-bell/welcome-state/literature/LiteratureToolbar 中大量静态配置数组的最干净方式。
- **多组件文件**：notification-panel.tsx 和 notification-bell.tsx 中的 `PanelNotificationCard`/`PanelEmptyState`/`EmptyNotifState` 子组件需要各自调用 `useI18n()` 而不是从 props 传入 locale。
- **已有 useI18n 的文件**（settings-run-panel/evaluation-view/welcome-state）只需在原解构中加入 `locale`，并替换剩余的硬编码英文。
- **RunButton 等独立子组件**（settings-run-panel.tsx）：需要在子组件函数体内独立调用 `useI18n()`，因为父组件的 hook 不能在子组件作用域使用。
- **保守原则**：对于 sample data（如 notification-panel 中的 `generateSampleNotifications` 的 title/message）和长技术描述（如 settings-run-panel 的模块描述）暂未翻译，保留原文以保证技术准确性。
