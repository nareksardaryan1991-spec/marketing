import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { invokeFunction as invoke } from './functions';
import type { Language } from './types';

export type PaymentProvider = 'arca' | 'idram';

type StartResult =
  | { mode: 'test'; payment_id: string }
  | { mode: 'redirect'; payment_id: string; url: string };

// Создаёт платёж. Для настоящей оплаты открывает страницу банка и ждёт возврата в приложение.
// Возвращает payment_id тестового платежа, если сервер в тестовом режиме.
export async function startPayment(
  orderId: string,
  provider: PaymentProvider,
  language: Language,
): Promise<{ testPaymentId: string } | null> {
  const returnUrl = Linking.createURL(`/orders/${orderId}`);
  const result = await invoke<StartResult>('payment-create', {
    order_id: orderId,
    provider,
    return_url: returnUrl,
    language,
  });

  if (result.mode === 'test') return { testPaymentId: result.payment_id };

  if (Platform.OS === 'web') {
    window.location.assign(result.url);
  } else {
    await WebBrowser.openAuthSessionAsync(result.url, returnUrl);
  }
  return null;
}

export async function confirmTestPayment(paymentId: string, success: boolean) {
  await invoke('payment-test-confirm', { payment_id: paymentId, success });
}
