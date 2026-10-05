import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { readAsset } from './readAsset';
import { supabase } from './supabase';

const BUCKET = 'brand';
export const MAX_BRAND_COLORS = 5;
export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

// Готовые цвета — быстрый выбор на телефоне; свой цвет можно ввести кодом #RRGGBB.
export const BRAND_PRESETS = [
  '#111827',
  '#FFFFFF',
  '#DC2626',
  '#EA580C',
  '#F2C14E',
  '#16A34A',
  '#0D9488',
  '#2563EB',
  '#4F46E5',
  '#9333EA',
  '#DB2777',
  '#7A4B2A',
];

export function logoUrl(path: string | null | undefined): string | null {
  return path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
}

// Логотип — PNG (сохраняем прозрачность) не больше 512 px: AI-дизайнер кладёт его на картинки.
async function prepare(asset: DocumentPicker.DocumentPickerAsset) {
  try {
    const context = ImageManipulator.manipulate(asset.uri);
    const { width, height } = await context.renderAsync();
    if (Math.max(width, height) > 512) {
      context.resize(width >= height ? { width: 512 } : { height: 512 });
    }
    const saved = await (await context.renderAsync()).saveAsync({ format: SaveFormat.PNG });
    return { uri: saved.uri, mimeType: 'image/png', ext: 'png' };
  } catch {
    return {
      uri: asset.uri,
      file: asset.file,
      mimeType: asset.mimeType ?? 'image/png',
      ext: asset.name.split('.').pop()?.toLowerCase() || 'png',
    };
  }
}

// Выбор логотипа и загрузка в папку бизнеса. Возвращает путь или null, если отменили.
// Имя каждый раз новое, чтобы браузер не показывал старый логотип из кэша.
export async function pickLogo(businessId: string): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/png', 'image/jpeg'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const file = await prepare(result.assets[0]);
  const path = `${businessId}/logo-${Date.now()}.${file.ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, await readAsset(file), { contentType: file.mimeType });
  if (error) throw error;
  return path;
}

// Старый логотип удаляем молча: если не вышло, остаётся лишний файл, профиль не ломается.
export async function removeLogo(path: string | null | undefined) {
  if (path) await supabase.storage.from(BUCKET).remove([path]);
}

// Насколько заполнен профиль бизнеса: чем полнее, тем точнее работают агенты.
export function profileCompleteness(b: {
  description: string | null;
  target_audience: string | null;
  tone: string | null;
  goals: string | null;
  city: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
  example_posts: string | null;
  brand_colors: string[] | null;
  logo_path: string | null;
}): number {
  const parts = [
    b.description,
    b.target_audience,
    b.tone,
    b.goals,
    b.city,
    b.website_url || b.instagram_url || b.facebook_url || b.tiktok_url,
    b.example_posts,
    (b.brand_colors ?? []).length > 0,
    b.logo_path,
  ];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}
