import type { Language, Localized } from './types';

const LOCALES: Record<Language, string> = { ru: 'ru-RU', hy: 'hy-AM', en: 'en-US' };

export function formatAmd(amount: number, language: Language): string {
  return `${new Intl.NumberFormat(LOCALES[language]).format(amount)} ֏`;
}

export function formatDate(iso: string, language: Language): string {
  return new Date(iso).toLocaleDateString(LOCALES[language]);
}

export function formatDateTime(iso: string, language: Language): string {
  return new Date(iso).toLocaleString(LOCALES[language], { dateStyle: 'short', timeStyle: 'short' });
}

export function localized(value: Localized, language: Language): string {
  return value[language] ?? value.ru ?? value.en ?? '';
}
