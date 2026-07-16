'use client';

import React from 'react';
import {
  Command,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Search,
  Eye,
  X,
  Navigation,
  MousePointerClick,
  Settings,
  Lightbulb,
  Zap,
  Upload,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  title: string;
  icon: React.ElementType;
  color: string;
  shortcuts: ShortcutItem[];
}

const buildShortcutCategories = (locale: 'en' | 'zh'): ShortcutCategory[] => [
  {
    title: locale === 'zh' ? '导航' : 'Navigation',
    icon: Navigation,
    color: 'text-blue-500',
    shortcuts: [
      { keys: ['↑', '↓'], description: locale === 'zh' ? '在表格行间导航' : 'Navigate table rows' },
      { keys: ['Enter'], description: locale === 'zh' ? '打开详情面板' : 'Open detail panel' },
      { keys: ['Space'], description: locale === 'zh' ? '切换收藏' : 'Toggle bookmark' },
      { keys: ['Alt', '←'], description: locale === 'zh' ? '上一周' : 'Previous week' },
      { keys: ['Alt', '→'], description: locale === 'zh' ? '下一周' : 'Next week' },
      { keys: ['⇧', 'Click'], description: locale === 'zh' ? '范围选择行' : 'Range select rows' },
      { keys: ['G'], description: locale === 'zh' ? '聚焦搜索并清空' : 'Focus search & clear' },
      { keys: ['D'], description: locale === 'zh' ? '复制 PDB ID 到剪贴板' : 'Copy PDB ID to clipboard' },
      { keys: ['/'], description: locale === 'zh' ? '聚焦表格筛选' : 'Focus table filter' },
    ],
  },
  {
    title: locale === 'zh' ? '操作' : 'Actions',
    icon: Zap,
    color: 'text-amber-500',
    shortcuts: [
      { keys: ['⌘/Ctrl', 'K'], description: locale === 'zh' ? '聚焦搜索' : 'Focus search' },
      { keys: ['⌘/Ctrl', 'E'], description: locale === 'zh' ? '切换 周报/评估 模式' : 'Toggle Weekly/Eval mode' },
      { keys: ['⌘/Ctrl', 'B'], description: locale === 'zh' ? '切换收藏' : 'Toggle bookmarks' },
      { keys: ['⌘/Ctrl', 'I'], description: locale === 'zh' ? '导入数据…' : 'Import Data…' },
      { keys: ['⌘/Ctrl', ','], description: locale === 'zh' ? '偏好设置' : 'Preferences' },
      { keys: ['C'], description: locale === 'zh' ? '打开对比' : 'Open comparison' },
      { keys: ['N'], description: locale === 'zh' ? '添加/切换备注' : 'Add/toggle note' },
      { keys: ['Esc'], description: locale === 'zh' ? '关闭面板（级联）' : 'Close panels (cascading)' },
      { keys: ['Alt', 'R'], description: locale === 'zh' ? '最近操作面板' : 'Recent actions panel' },
      { keys: ['⇧', '1-5'], description: locale === 'zh' ? '按最低评分筛选' : 'Filter by min rating' },
      { keys: ['⇧', '0'], description: locale === 'zh' ? '清除评分筛选' : 'Clear rating filter' },
      { keys: ['1'], description: locale === 'zh' ? '快捷筛选：仅 Cryo-EM' : 'Quick filter: Cryo-EM Only' },
      { keys: ['2'], description: locale === 'zh' ? '快捷筛选：仅 X-ray' : 'Quick filter: X-ray Only' },
      { keys: ['3'], description: locale === 'zh' ? '快捷筛选：高分辨率' : 'Quick filter: High Resolution' },
      { keys: ['4'], description: locale === 'zh' ? '快捷筛选：含配体' : 'Quick filter: With Ligands' },
      { keys: ['5'], description: locale === 'zh' ? '快捷筛选：本周发布' : 'Quick filter: Released This Week' },
      { keys: ['6'], description: locale === 'zh' ? '快捷筛选：高影响力' : 'Quick filter: High Impact' },
    ],
  },
  {
    title: locale === 'zh' ? '通用' : 'General',
    icon: Settings,
    color: 'text-emerald-500',
    shortcuts: [
      { keys: ['⌘/Ctrl', '⇧', 'P'], description: locale === 'zh' ? '命令面板' : 'Command palette' },
      { keys: ['?'], description: locale === 'zh' ? '本快捷键面板' : 'This shortcuts panel' },
    ],
  },
];

const buildProTips = (locale: 'en' | 'zh') => [
  { icon: ArrowLeft, text: locale === 'zh' ? '使用 Alt+方向键快速浏览周报' : 'Use Alt+Arrow keys to quickly browse weeks' },
  { icon: Search, text: locale === 'zh' ? '按 C 比较所选结构' : 'Press C to compare selected structures' },
  { icon: MousePointerClick, text: locale === 'zh' ? '右键单击任意行查看更多选项' : 'Right-click any row for more options' },
  { icon: Command, text: locale === 'zh' ? '使用 ⌘+K 快速访问搜索' : 'Use ⌘+K for quick search access' },
  { icon: Zap, text: locale === 'zh' ? '按 Alt+R 查看最近操作' : 'Press Alt+R to view recent actions' },
  { icon: Upload, text: locale === 'zh' ? '按 1-6 立即切换快捷筛选' : 'Press 1-6 to toggle quick filters instantly' },
  { icon: Command, text: locale === 'zh' ? '使用 ⌘+I 导入 CSV 或 JSON 数据' : 'Use ⌘+I to import CSV or JSON data' },
  { icon: MousePointerClick, text: locale === 'zh' ? '右键单击列标题可固定/冻结列，便于横向滚动' : 'Right-click column headers to pin/freeze columns for horizontal scroll' },
];

const ICON_KEYS = new Set(['⌘', '⇧', '↑', '↓', '←', '→', 'Space', 'Esc']);

function Kbd({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <kbd
      className={`inline-flex items-center justify-center ${
        wide ? 'min-w-[28px] px-1.5' : 'min-w-[20px] px-1'
      } py-0.5 rounded text-[10px] font-mono font-medium bg-white dark:bg-[#2b2926] border border-claude-border-light dark:border-[#3d3832] shadow-sm text-claude-text dark:text-[#e8e4dd] kbd-enhanced`}
    >
      {children}
    </kbd>
  );
}

function renderKey(key: string) {
  switch (key) {
    case '⌘':
      return <Command className="h-2.5 w-2.5" />;
    case '⌘/Ctrl':
      return (
        <>
          <Command className="h-2.5 w-2.5 mr-0.5" />
          <span>/</span>
          <span>Ctrl</span>
        </>
      );
    case '⇧':
      return <ArrowUp className="h-2.5 w-2.5" />;
    case '↑':
      return <ArrowUp className="h-2.5 w-2.5" />;
    case '↓':
      return <ArrowDown className="h-2.5 w-2.5" />;
    case '←':
      return <ArrowLeft className="h-2.5 w-2.5" />;
    case '→':
      return <ArrowRight className="h-2.5 w-2.5" />;
    case 'Space':
      return 'Space';
    case 'Esc':
      return <X className="h-2.5 w-2.5" />;
    default:
      return key;
  }
}

function ShortcutRow({ shortcut }: { shortcut: ShortcutItem }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-claude-border-light/50 dark:hover:bg-claude-border/30 transition-colors">
      <span className="text-[11px] text-claude-text-secondary dark:text-[#c8c3bc]">
        {shortcut.description}
      </span>
      <div className="flex items-center gap-1 flex-shrink-0">
        {shortcut.keys.map((key, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-[9px] text-claude-text-muted/50 mx-0.5">+</span>}
            <Kbd wide={key.length > 2}>{renderKey(key)}</Kbd>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcutsPanel({ open, onOpenChange }: KeyboardShortcutsPanelProps) {
  const { locale } = useI18n();
  if (!open) return null;

  const SHORTCUT_CATEGORIES = buildShortcutCategories(locale);
  const PRO_TIPS = buildProTips(locale);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={() => onOpenChange(false)}
      />
      {/* Panel */}
      <div className="relative w-full max-w-2xl max-h-[85vh] mx-4 glass-panel rounded-2xl border border-claude-border dark:border-[#3d3832] shadow-2xl overflow-hidden shortcuts-panel-enter">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-claude-border/50 dark:border-[#3d3832]/50">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-claude-accent/10 text-claude-accent">
              <Command className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-claude-text dark:text-[#e8e4dd]">
                {locale === 'zh' ? '键盘快捷键' : 'Keyboard Shortcuts'}
              </h2>
              <p className="text-[10px] text-claude-text-muted dark:text-[#9b9590]">
                {locale === 'zh' ? '按 Esc 关闭此面板' : 'Press Esc to close this panel'}
              </p>
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-claude-border-light dark:hover:bg-claude-border transition-colors text-claude-text-muted hover:text-claude-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-140px)] p-6 space-y-6 custom-scrollbar">
          {/* Shortcut Categories */}
          {SHORTCUT_CATEGORIES.map((category, catIndex) => {
            const IconComp = category.icon;
            return (
              <div
                key={category.title}
                className="animate-in fade-in slide-in-from-bottom-1 duration-200"
                style={{ animationDelay: `${catIndex * 60}ms`, animationFillMode: 'both' }}
              >
                {/* Category Header */}
                <div className="flex items-center gap-2 mb-3">
                  <div className={`flex items-center justify-center w-5 h-5 rounded-md bg-current/10 ${category.color}`}>
                    <IconComp className="h-3 w-3" />
                  </div>
                  <h3 className="text-xs font-semibold text-claude-text dark:text-[#e8e4dd] uppercase tracking-wider">
                    {category.title}
                  </h3>
                  <div className="flex-1 h-px bg-claude-border-light/50 dark:bg-[#3d3832]/50 ml-1" />
                </div>
                {/* Shortcuts Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 stagger-children" style={{ '--stagger-delay': '0.04s' } as React.CSSProperties}>
                  {category.shortcuts.map((shortcut) => (
                    <ShortcutRow key={shortcut.description} shortcut={shortcut} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Pro Tips Section */}
          <div
            className="animate-in fade-in slide-in-from-bottom-1 duration-200"
            style={{ animationDelay: `${SHORTCUT_CATEGORIES.length * 60}ms`, animationFillMode: 'both' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center justify-center w-5 h-5 rounded-md bg-amber-500/10 text-amber-500">
                <Lightbulb className="h-3 w-3" />
              </div>
              <h3 className="text-xs font-semibold text-claude-text dark:text-[#e8e4dd] uppercase tracking-wider">
                {locale === 'zh' ? '进阶提示' : 'Pro Tips'}
              </h3>
              <div className="flex-1 h-px bg-amber-500/15 dark:bg-amber-500/10 ml-1" />
            </div>
            <div className="space-y-1.5">
              {PRO_TIPS.map((tip, i) => {
                const TipIcon = tip.icon;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-amber-500/[0.04] dark:bg-amber-500/[0.06] border border-amber-500/[0.08] dark:border-amber-500/[0.06]"
                  >
                    <TipIcon className="h-3.5 w-3.5 text-amber-500/70 mt-0.5 flex-shrink-0" />
                    <span className="text-[11px] text-claude-text-secondary dark:text-[#c8c3bc] leading-relaxed">
                      {tip.text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-claude-border/50 dark:border-[#3d3832]/50 bg-white/40 dark:bg-[#1a1917]/40">
          <p className="text-[10px] text-center text-claude-text-muted">
            {locale === 'zh' ? (
              <>在搜索或输入框中输入时快捷键将被禁用 · 按 <Kbd>?</Kbd> 重新打开此面板</>
            ) : (
              <>{locale === 'zh' ? '在搜索或输入框中输入时快捷键已禁用 · 按 ' : 'Shortcuts are disabled when typing in search or input fields · Press '}<Kbd>?</Kbd>{locale === 'zh' ? ' 重新打开此面板' : ' to reopen this panel'}</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
