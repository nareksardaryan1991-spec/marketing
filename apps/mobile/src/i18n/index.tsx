import { getLocales } from 'expo-localization';
import { I18n, type TranslateOptions } from 'i18n-js';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { storage } from '@/lib/storage';
import type { Language } from '@/lib/types';

import { en } from './en';
import { hy } from './hy';
import { ru } from './ru';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'ru', label: 'Русский' },
  { code: 'hy', label: 'Հայերեն' },
  { code: 'en', label: 'English' },
];

const STORAGE_KEY = 'app.language';

const i18n = new I18n({ ru, hy, en });
i18n.defaultLocale = 'ru';
i18n.enableFallback = true;

function isLanguage(value: unknown): value is Language {
  return value === 'ru' || value === 'hy' || value === 'en';
}

function initialLanguage(): Language {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // хранилище недоступно — берём язык устройства
  }
  const device = getLocales()[0]?.languageCode;
  return isLanguage(device) ? device : 'ru';
}

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, options?: TranslateOptions) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      storage?.setItem(STORAGE_KEY, next);
    } catch {
      // не критично
    }
  }, []);

  const t = useCallback(
    (key: string, options?: TranslateOptions) => i18n.t(key, { locale: language, ...options }),
    [language],
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useI18n must be used inside LanguageProvider');
  return ctx;
}
