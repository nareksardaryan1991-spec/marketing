export type AppliedPromo = { code: string; percent: number | null; amount_amd: number | null };

// Скидка на сумму услуг — так же, как promo_discount в базе.
export function promoDiscount(promo: AppliedPromo | null, itemsTotal: number): number {
  if (!promo) return 0;
  const raw = promo.amount_amd ?? Math.round((itemsTotal * (promo.percent ?? 0)) / 100);
  return Math.min(itemsTotal, raw);
}

// Ошибки промокода с сервера → ключ перевода (остальные показываются как есть).
export function promoErrorKey(message: string): string | null {
  if (message.includes('promo code not found')) return 'promo.notFound';
  if (message.includes('promo code expired')) return 'promo.expired';
  if (message.includes('promo code used up')) return 'promo.usedUp';
  if (message.includes('order total must be positive')) return 'promo.tooBig';
  return null;
}
