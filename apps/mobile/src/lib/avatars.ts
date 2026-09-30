import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { readAsset } from './readAsset';
import { supabase } from './supabase';

const BUCKET = 'avatars';

export type ProfilePhoto = 'avatar' | 'cover';

// Цвета обложки на выбор в личном кабинете.
export const ACCENT_COLORS = [
  '#4F46E5',
  '#2563EB',
  '#0891B2',
  '#059669',
  '#CA8A04',
  '#EA580C',
  '#DC2626',
  '#DB2777',
  '#7C3AED',
  '#374151',
];

export function photoUrl(path: string | null | undefined): string | null {
  return path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
}

// Фото профиля — квадрат 512 px, обложка — не шире 1200 px, обе в JPEG.
// Если фото не удалось прочитать (например, HEIC в браузере), загружаем как есть.
async function prepare(asset: DocumentPicker.DocumentPickerAsset, kind: ProfilePhoto) {
  try {
    const context = ImageManipulator.manipulate(asset.uri);
    const { width, height } = await context.renderAsync();
    if (kind === 'avatar') {
      const side = Math.min(width, height);
      context.crop({
        originX: Math.floor((width - side) / 2),
        originY: Math.floor((height - side) / 2),
        width: side,
        height: side,
      });
      if (side > 512) context.resize({ width: 512, height: 512 });
    } else if (width > 1200) {
      context.resize({ width: 1200 });
    }
    const saved = await (await context.renderAsync()).saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.85,
    });
    return { uri: saved.uri, mimeType: 'image/jpeg', ext: 'jpg' };
  } catch {
    return {
      uri: asset.uri,
      file: asset.file,
      mimeType: asset.mimeType ?? 'image/jpeg',
      ext: asset.name.split('.').pop()?.toLowerCase() || 'jpg',
    };
  }
}

// Выбор фото и загрузка в папку пользователя. Возвращает путь в Storage или null, если отменили.
// Имя каждый раз новое, чтобы браузер не показывал старое фото из кэша.
export async function pickProfilePhoto(userId: string, kind: ProfilePhoto): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'image/*',
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const file = await prepare(result.assets[0], kind);
  const path = `${userId}/${kind}-${Date.now()}.${file.ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, await readAsset(file), { contentType: file.mimeType });
  if (error) throw error;
  return path;
}

// Старые фото удаляем молча: если не вышло, остаётся лишний файл, профиль от этого не ломается.
export async function removeProfilePhotos(paths: (string | null | undefined)[]) {
  const existing = paths.filter((p): p is string => !!p);
  if (existing.length > 0) await supabase.storage.from(BUCKET).remove(existing);
}
