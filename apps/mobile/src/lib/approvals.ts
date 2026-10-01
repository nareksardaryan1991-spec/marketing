import { supabase } from './supabase';

// Дата по Еревану (YYYY-MM-DD) — как считает автоодобрение на сервере.
function yerevanDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(date);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// День, когда материал одобрится сам, и сколько дней до него (как auto_approve_on в базе).
export function autoApproveOn(
  since: string | null,
  days: number,
): { date: string; daysLeft: number } | null {
  if (!since || days <= 0) return null;
  const date = addDays(yerevanDate(new Date(since)), days);
  const today = yerevanDate(new Date());
  const daysLeft = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return { date, daysLeft };
}

export async function loadAutoApproveDays(): Promise<number> {
  const { data } = await supabase.from('agency_settings').select('auto_approve_days').maybeSingle();
  return data?.auto_approve_days ?? 0;
}

// Вид превью по услуге: пост, Reels/видео или история.
export type PreviewKind = 'post' | 'reel' | 'story';

export function previewKind(serviceId: string): PreviewKind {
  if (serviceId === 'reel') return 'reel';
  if (serviceId === 'story') return 'story';
  return 'post';
}

export function isVideo(path: string): boolean {
  return /\.(mp4|mov|m4v|webm|3gp)$/i.test(path);
}

export function formatSeconds(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
