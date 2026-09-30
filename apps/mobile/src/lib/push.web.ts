import { supabase } from './supabase';
import { webBase } from './webApp';

// install — iPhone: web push работает только в сайте, добавленном на экран «Домой».
export type PushStatus = 'enabled' | 'denied' | 'unavailable' | 'install';

// Публичный ключ VAPID; закрытый хранится в секретах Supabase (notify-dispatch).
const KEY = process.env.EXPO_PUBLIC_WEB_PUSH_KEY;

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function keyBytes(base64url: string) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a || a.byteLength !== b.length) return false;
  const bytes = new Uint8Array(a);
  return bytes.every((x, i) => x === b[i]);
}

async function registration() {
  return navigator.serviceWorker.register(`${webBase}/sw.js`, { scope: `${webBase}/` });
}

// Подписывает браузер на web push и сохраняет подписку за пользователем.
// Разрешение спрашивается только по нажатию кнопки (ask): Safari иначе не покажет запрос.
export async function registerPush(_userId: string, ask: boolean): Promise<PushStatus> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'install' : 'unavailable';
  }
  if (!KEY) return 'unavailable';

  let permission = Notification.permission;
  if (permission === 'default' && ask) permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  try {
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const key = keyBytes(KEY);
    let sub = await reg.pushManager.getSubscription();
    // Ключ сервера сменился — старая подписка больше не работает.
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const { keys } = sub.toJSON();
    const { error } = await supabase.rpc('save_web_push_subscription', {
      p_endpoint: sub.endpoint,
      p_p256dh: keys?.p256dh,
      p_auth: keys?.auth,
    });
    return error ? 'unavailable' : 'enabled';
  } catch {
    return 'unavailable';
  }
}

// При выходе из аккаунта: уведомления этого пользователя больше не приходят в этот браузер.
export async function unregisterPush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration(`${webBase}/`);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await supabase.rpc('delete_web_push_subscription', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  } catch {}
}
