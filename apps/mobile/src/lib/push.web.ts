export type PushStatus = 'enabled' | 'denied' | 'unavailable';

// В вебе push не поддерживаем — уведомления приходят в Telegram.
export async function registerPush(_userId: string, _ask: boolean): Promise<PushStatus> {
  return 'unavailable';
}
