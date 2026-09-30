// Требования Instagram к фото.

// Шире — Instagram хранит фото уменьшенным до 1440 px.
export const MAX_IMAGE_WIDTH = 1440;

// Пропорции для поста в ленте: от 4:5 (вертикаль) до 1.91:1 (горизонталь).
const FEED_MIN_RATIO = 4 / 5;
const FEED_MAX_RATIO = 1.91;

export function fitsFeed(width: number, height: number): boolean {
  const ratio = width / height;
  // Небольшой запас на округление при уменьшении.
  return ratio >= FEED_MIN_RATIO - 0.01 && ratio <= FEED_MAX_RATIO + 0.01;
}

export function ratioLabel(width: number, height: number): string {
  const ratio = width / height;
  const known: [number, string][] = [
    [1, '1:1'],
    [4 / 5, '4:5'],
    [9 / 16, '9:16'],
    [16 / 9, '16:9'],
    [3 / 4, '3:4'],
    [4 / 3, '4:3'],
    [2 / 3, '2:3'],
    [3 / 2, '3:2'],
  ];
  const match = known.find(([r]) => Math.abs(r - ratio) < 0.02);
  return match ? match[1] : `${ratio.toFixed(2)}:1`;
}

// Нужно ли перекодировать файл: всё, что не JPEG, или слишком широкое фото.
export function needsConversion(mimeType: string | undefined, name: string, width: number): boolean {
  const isJpeg = mimeType === 'image/jpeg' || /\.jpe?g$/i.test(name);
  return !isJpeg || width > MAX_IMAGE_WIDTH;
}

export function jpegName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg';
}
