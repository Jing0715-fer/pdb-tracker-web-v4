/**
 * useI18n — lightweight i18n hook for PDB Tracker.
 *
 * Stores the user's language preference in localStorage and provides a `t`
 * function for looking up translated strings. Falls back to English when a
 * key is missing in the active locale.
 *
 * Usage:
 *   const { t, locale, setLocale } = useI18n();
 *   <span>{t.runCenter}</span>
 */
'use client';

import React, { useState, useCallback, createContext, useContext } from 'react';
import { en, type Locale as EnLocale } from './en';
import { zh, type Locale as ZhLocale } from './zh';

export type LocaleId = 'en' | 'zh';
export type TranslationKeys = EnLocale;

const LOCALE_STORAGE_KEY = 'pdb-tracker:locale';

// Merge: en is the base (all keys guaranteed), zh overrides
const translations: Record<LocaleId, TranslationKeys> = {
  en: en as TranslationKeys,
  zh: zh as TranslationKeys,
};

// ─── Context ────────────────────────────────────────────────────────────────

interface I18nContextValue {
  locale: LocaleId;
  t: TranslationKeys;
  setLocale: (l: LocaleId) => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  t: translations.en,
  setLocale: () => {},
});

// ─── Provider ───────────────────────────────────────────────────────────────

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializer reads localStorage once on first render — avoids the
  // setState-in-effect anti-pattern.
  const [locale, setLocaleState] = useState<LocaleId>(() => {
    if (typeof window === 'undefined') return 'en';
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY) as LocaleId | null;
      if (saved === 'en' || saved === 'zh') return saved;
    } catch { /* ignore */ }
    return 'en';
  });

  const setLocale = useCallback((l: LocaleId) => {
    setLocaleState(l);
    try { localStorage.setItem(LOCALE_STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const value: I18nContextValue = {
    locale,
    t: translations[locale] || translations.en,
    setLocale,
  };

  return React.createElement(I18nContext.Provider, { value }, children);
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
