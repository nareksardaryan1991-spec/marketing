import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '@/i18n';
import { useAuth } from '@/providers/AuthProvider';

import { formatAmd } from './format';
import { supabase } from './supabase';
import type { Currency, Language } from './types';

// Цены в выбранной валюте. Платят всегда в драмах; $ и € — для ориентира по курсу,
// который задаёт владелец (agency_settings), поэтому со знаком «≈».

export const CURRENCIES: { code: Currency; sign: string }[] = [
  { code: 'AMD', sign: '֏' },
  { code: 'USD', sign: '$' },
  { code: 'EUR', sign: '€' },
];

type Rates = { USD: number; EUR: number };
let cached: Promise<Rates | null> | null = null;

export function loadRates(force = false): Promise<Rates | null> {
  if (!cached || force) {
    cached = Promise.resolve(
      supabase
        .from('agency_settings')
        .select('usd_rate_amd, eur_rate_amd')
        .maybeSingle()
        .then(({ data }) => (data ? { USD: Number(data.usd_rate_amd), EUR: Number(data.eur_rate_amd) } : null)),
    );
  }
  return cached;
}

const LOCALES: Record<Language, string> = { ru: 'ru-RU', hy: 'hy-AM', en: 'en-US' };

export function convert(amountAmd: number, currency: Currency, rates: Rates, language: Language): string {
  if (currency === 'AMD') return formatAmd(amountAmd, language);
  const value = amountAmd / rates[currency];
  const text = new Intl.NumberFormat(LOCALES[language], {
    style: 'currency',
    currency,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
  return `≈ ${text}`;
}

export function useMoney() {
  const { language } = useI18n();
  const { profile } = useAuth();
  const currency: Currency = profile?.currency ?? 'AMD';
  const [rates, setRates] = useState<Rates | null>(null);

  useEffect(() => {
    if (currency === 'AMD') return;
    let alive = true;
    loadRates().then((r) => alive && setRates(r));
    return () => {
      alive = false;
    };
  }, [currency]);

  // Цена для просмотра: в выбранной валюте (пока курс не загружен — в драмах).
  const money = useCallback(
    (amountAmd: number) =>
      currency === 'AMD' || !rates ? formatAmd(amountAmd, language) : convert(amountAmd, currency, rates, language),
    [currency, rates, language],
  );

  // Сумма к оплате: всегда в драмах, рядом — ориентир в выбранной валюте.
  const moneyToPay = useCallback(
    (amountAmd: number) =>
      currency === 'AMD' || !rates
        ? formatAmd(amountAmd, language)
        : `${formatAmd(amountAmd, language)} (${convert(amountAmd, currency, rates, language)})`,
    [currency, rates, language],
  );

  return { money, moneyToPay, currency };
}
