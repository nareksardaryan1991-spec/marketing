import { localized } from './format';
import type { Language, Localized } from './types';

// Названия площадок — бренды, одинаковые на всех языках.
export const PLATFORM_NAMES: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
};

export function platformName(platformId: string | null | undefined): string | null {
  if (!platformId) return null;
  return PLATFORM_NAMES[platformId] ?? platformId;
}

// Название услуги на площадке: рилс в TikTok показываем как «Видео».
const PLATFORM_LABELS: Record<string, Record<string, Localized>> = {
  tiktok: { reel: { ru: 'Видео', hy: 'Տեսանյութ', en: 'Video' } },
};

export function serviceLabel(
  serviceId: string,
  serviceName: Localized | null | undefined,
  platformId: string | null | undefined,
  language: Language,
): string {
  const custom = platformId ? PLATFORM_LABELS[platformId]?.[serviceId] : undefined;
  if (custom) return localized(custom, language);
  return serviceName ? localized(serviceName, language) : serviceId;
}

// «Instagram · Пост #2» — одинаково на всех экранах.
export function taskTitle(
  task: { service_id: string; platform_id: string | null; number: number },
  serviceName: Localized | null | undefined,
  language: Language,
): string {
  const label = serviceLabel(task.service_id, serviceName, task.platform_id, language);
  const platform = platformName(task.platform_id);
  return `${platform ? `${platform} · ` : ''}${label} #${task.number}`;
}
