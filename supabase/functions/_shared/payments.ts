import { crypto } from 'jsr:@std/crypto@1';
import { encodeHex } from 'jsr:@std/encoding@1/hex';

import { requireEnv } from './http.ts';

export type Provider = 'arca' | 'idram' | 'test';

// PAYMENT_MODE=test — оплата без банка (кнопка «Оплатить (тест)» в приложении).
export function paymentMode(): 'test' | 'live' {
  return Deno.env.get('PAYMENT_MODE') === 'live' ? 'live' : 'test';
}

// Куда можно вернуть пользователя после оплаты (защита от открытого редиректа).
// Префикс должен совпадать целиком: "http://localhost" пропускает
// "http://localhost:8081/…", но не "http://localhost.evil.com".
export function isAllowedReturnUrl(url: string): boolean {
  const prefixes = (Deno.env.get('APP_RETURN_PREFIXES') ?? 'marketing://,exp://,http://localhost')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return prefixes.some((prefix) => {
    if (!url.startsWith(prefix)) return false;
    if (url.length === prefix.length || prefix.endsWith('/')) return true;
    return /[:/?#]/.test(url[prefix.length]);
  });
}

// ---- ArCa (платёжный шлюз банков Армении, REST API vPOS) ----
// ARCA_API_URL: тест — https://ipaytest.arca.am:8445/payment/rest, боевой — выдаёт банк.

const AMD_CURRENCY_CODE = '051';

async function arcaCall(method: string, params: Record<string, string>) {
  const body = new URLSearchParams({
    userName: requireEnv('ARCA_USERNAME'),
    password: requireEnv('ARCA_PASSWORD'),
    ...params,
  });
  const res = await fetch(`${requireEnv('ARCA_API_URL')}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return await res.json();
}

export async function arcaRegister(opts: {
  paymentId: string;
  amountAmd: number;
  returnUrl: string;
  description: string;
  language: string;
}): Promise<{ orderId: string; formUrl: string }> {
  const data = await arcaCall('register.do', {
    // Номер заказа в шлюзе — id платежа без дефисов (32 символа).
    orderNumber: opts.paymentId.replaceAll('-', ''),
    // Сумма в минимальных единицах (лума).
    amount: String(opts.amountAmd * 100),
    currency: AMD_CURRENCY_CODE,
    returnUrl: opts.returnUrl,
    description: opts.description,
    language: opts.language,
  });
  if (!data.orderId || !data.formUrl) {
    throw new Error(`ArCa register failed: ${data.errorCode} ${data.errorMessage ?? ''}`);
  }
  return { orderId: data.orderId, formUrl: data.formUrl };
}

// orderStatus: 2 — оплачено, 3 — отменено, 6 — отклонено.
export async function arcaStatus(orderId: string) {
  return await arcaCall('getOrderStatusExtended.do', { orderId });
}

// ---- Idram ----
// Оплата: переход на страницу Idram с параметрами EDP_*.
// Результат: Idram присылает POST на RESULT_URL (idram-callback), указанный в кабинете продавца.

export function idramPaymentUrl(opts: {
  paymentId: string;
  amountAmd: number;
  description: string;
  language: string;
}): string {
  const params = new URLSearchParams({
    // Коды языков Idram: RU, EN, AM (армянский — AM, а не HY).
    EDP_LANGUAGE: opts.language === 'hy' ? 'AM' : opts.language.toUpperCase(),
    EDP_REC_ACCOUNT: requireEnv('IDRAM_REC_ACCOUNT'),
    EDP_DESCRIPTION: opts.description,
    EDP_AMOUNT: String(opts.amountAmd),
    EDP_BILL_NO: opts.paymentId,
  });
  return `https://banking.idram.am/Payment/GetPayment?${params}`;
}

export async function idramChecksumValid(form: URLSearchParams): Promise<boolean> {
  const source = [
    requireEnv('IDRAM_REC_ACCOUNT'),
    form.get('EDP_AMOUNT'),
    requireEnv('IDRAM_SECRET_KEY'),
    form.get('EDP_BILL_NO'),
    form.get('EDP_PAYER_ACCOUNT'),
    form.get('EDP_TRANS_ID'),
    form.get('EDP_TRANS_DATE'),
  ].join(':');
  const digest = await crypto.subtle.digest('MD5', new TextEncoder().encode(source));
  return encodeHex(digest).toUpperCase() === (form.get('EDP_CHECKSUM') ?? '').toUpperCase();
}

// Idram присылает сумму строкой вида "1000.00".
export function sameAmount(received: string | null, expectedAmd: number): boolean {
  return received !== null && Math.abs(Number(received) - expectedAmd) < 0.01;
}
