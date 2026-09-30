import type { DocumentPickerAsset } from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { jpegName, MAX_IMAGE_WIDTH, needsConversion } from './imageRules';

export type PreparedFile = {
  uri: string;
  name: string;
  mimeType: string;
  // Исходный файл (для веба), если не перекодировали.
  file?: File;
  width?: number;
  height?: number;
};

// Фото приводим к JPEG шириной не больше 1440 px — такие Instagram принимает всегда.
// Видео и PDF не трогаем. Если фото не удалось прочитать (например, HEIC в браузере),
// загружаем как есть.
export async function prepareForUpload(asset: DocumentPickerAsset): Promise<PreparedFile> {
  const original: PreparedFile = {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? 'application/octet-stream',
    file: asset.file,
  };
  if (!asset.mimeType?.startsWith('image/')) return original;

  try {
    const context = ImageManipulator.manipulate(asset.uri);
    let image = await context.renderAsync();
    const { width, height } = image;
    if (!needsConversion(asset.mimeType, asset.name, width)) {
      return { ...original, width, height };
    }
    if (width > MAX_IMAGE_WIDTH) {
      context.resize({ width: MAX_IMAGE_WIDTH });
      image = await context.renderAsync();
    }
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    return {
      uri: saved.uri,
      name: jpegName(asset.name),
      mimeType: 'image/jpeg',
      width: saved.width,
      height: saved.height,
    };
  } catch {
    return original;
  }
}
