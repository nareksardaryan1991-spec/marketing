import * as DocumentPicker from 'expo-document-picker';

import { prepareForUpload } from './prepareImage';
import { readAsset } from './readAsset';
import { supabase } from './supabase';

const BUCKET = 'deliverables';

export type UploadedFile = { path: string; name: string; width?: number; height?: number };

// Выбор файлов и загрузка в папку задачи. Возвращает пути в Storage.
export async function pickAndUpload(taskId: string): Promise<UploadedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'video/*', 'application/pdf'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];

  const uploaded: UploadedFile[] = [];
  for (const asset of result.assets) {
    const file = await prepareForUpload(asset);
    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${taskId}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, await readAsset(file), { contentType: file.mimeType });
    if (error) throw error;
    uploaded.push({ path, name: file.name, width: file.width, height: file.height });
  }
  return uploaded;
}

// По умолчанию — материалы задач; картинки из чата с AI-агентом лежат в бакете agent-files.
export async function signedUrls(paths: string[], bucket = BUCKET): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60);
  if (error) throw error;
  const urls: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }
  return urls;
}

export function fileName(path: string): string {
  return path.split('/').pop()?.replace(/^\d+-/, '') ?? path;
}

export function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|heic)$/i.test(path);
}
