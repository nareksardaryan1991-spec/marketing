// Как опубликовать задачу в Instagram, исходя из услуги и файлов.

export type MediaKind = 'image' | 'video';
export type PublishPlan =
  | { type: 'single'; mediaType: 'IMAGE' | 'REELS' | 'STORIES'; file: string; kind: MediaKind; caption: boolean }
  | { type: 'carousel'; files: { path: string; kind: MediaKind }[] };

export class PlanError extends Error {}

export function mediaKind(path: string): MediaKind | null {
  if (/\.jpe?g$/i.test(path)) return 'image';
  if (/\.(mp4|mov)$/i.test(path)) return 'video';
  return null;
}

export function buildPlan(serviceId: string, files: string[]): PublishPlan {
  if (files.length === 0) throw new PlanError('No media files: Instagram needs at least one photo or video');

  const typed = files.map((path) => {
    const kind = mediaKind(path);
    if (!kind) {
      throw new PlanError(
        `Unsupported file ${path.split('/').pop()}: Instagram accepts JPEG photos and MP4/MOV videos`,
      );
    }
    return { path, kind };
  });

  switch (serviceId) {
    case 'story':
      return { type: 'single', mediaType: 'STORIES', file: typed[0].path, kind: typed[0].kind, caption: false };
    case 'reel': {
      const video = typed.find((f) => f.kind === 'video');
      if (!video) throw new PlanError('A reel needs a video file (MP4/MOV)');
      return { type: 'single', mediaType: 'REELS', file: video.path, kind: 'video', caption: true };
    }
    case 'post':
      if (typed.length > 10) throw new PlanError('A carousel can have at most 10 files');
      if (typed.length > 1) return { type: 'carousel', files: typed };
      return {
        type: 'single',
        mediaType: typed[0].kind === 'image' ? 'IMAGE' : 'REELS',
        file: typed[0].path,
        kind: typed[0].kind,
        caption: true,
      };
    default:
      throw new PlanError(`Service "${serviceId}" cannot be published automatically`);
  }
}
