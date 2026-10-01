import * as DocumentPicker from 'expo-document-picker';

import { prepareForUpload } from './prepareImage';
import { readAsset } from './readAsset';
import { supabase } from './supabase';
import type { Language, UserRole } from './types';

// Оба чата — по заказу (messages) и команды (team_messages) — устроены одинаково.
export type ChatKind = 'order' | 'team';
export type ChatRef = { chat: ChatKind; id: string };

export type AttachmentKind = 'photo' | 'video' | 'file' | 'voice';
export type Attachment = {
  path: string;
  kind: AttachmentKind;
  name?: string;
  mime?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
};

export type ChatMessage = {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  from_client?: boolean;
  attachments: Attachment[];
  reply_to_id: string | null;
  forwarded_from: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  // Сообщение-звонок: комната Jitsi и аудио/видео.
  call: { room: string; video: boolean } | null;
};

export type Reaction = { message_id: string; user_id: string; user_name: string; emoji: string };

// Оригинал удалённого сообщения — его видит только владелец.
export type DeletedOriginal = { message_id: string; body: string; attachments: Attachment[] };

export type ChatInfo = {
  title: string | null;
  pinned: { id: string; body: string; attachments: Attachment[]; author_name: string } | null;
  peer: {
    id?: string;
    name?: string;
    avatar_path?: string | null;
    role?: UserRole;
    last_seen_at: string | null;
  } | null;
  members: number | null;
  others_read_at: string | null;
};

// Строка общего списка чатов (функция my_chats в базе).
export type ChatListItem = {
  chat: ChatKind;
  id: string;
  kind: 'order' | 'team' | 'direct';
  title: string | null;
  business_name: string | null;
  order_created_at: string | null;
  peer_id: string | null;
  peer_role: UserRole | null;
  avatar_path: string | null;
  last_seen_at: string | null;
  last_message_at: string | null;
  last_body: string | null;
  last_author: string | null;
  last_author_id: string | null;
  last_attachment: AttachmentKind | 'call' | null;
  last_deleted: boolean;
  unread: number;
  others_read_at: string | null;
};

export const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🙏', '👏'];

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function chatTable(chat: ChatKind) {
  return chat === 'order' ? 'messages' : 'team_messages';
}

export function chatColumn(chat: ChatKind) {
  return chat === 'order' ? 'order_id' : 'conversation_id';
}

export function chatHref(ref: ChatRef) {
  return ref.chat === 'order' ? (`/orders/${ref.id}/chat` as const) : (`/team-chat/${ref.id}` as const);
}

// ---------- Файлы ----------

// Файл, выбранный или записанный, но ещё не отправленный.
export type PendingFile = {
  key: string;
  uri: string;
  file?: File;
  name: string;
  mime: string;
  kind: AttachmentKind;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
};

function kindOf(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

// Фото приводятся к JPEG до 1440 px (как материалы задач), остальное — как есть.
export async function pickChatFiles(media: boolean): Promise<PendingFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: media ? ['image/*', 'video/*'] : '*/*',
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  const files: PendingFile[] = [];
  for (const asset of result.assets.slice(0, 10)) {
    const mime = asset.mimeType ?? 'application/octet-stream';
    const prepared = media || mime.startsWith('image/') ? await prepareForUpload(asset) : null;
    files.push({
      key: `${Date.now()}-${files.length}-${asset.name}`,
      uri: prepared?.uri ?? asset.uri,
      file: prepared ? prepared.file : asset.file,
      name: prepared?.name ?? asset.name,
      mime: prepared?.mimeType ?? mime,
      kind: media ? kindOf(prepared?.mimeType ?? mime) : kindOf(mime) === 'photo' ? 'photo' : 'file',
      size: asset.size ?? undefined,
      width: prepared?.width,
      height: prepared?.height,
    });
  }
  return files;
}

// Путь: <order|team>/<id чата>/<id автора>/<время>-<имя> — так его пропускают правила хранилища.
export async function uploadChatFile(ref: ChatRef, userId: string, file: PendingFile): Promise<Attachment> {
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
  const path = `${ref.chat}/${ref.id}/${userId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from('chat-files')
    .upload(path, await readAsset(file), { contentType: file.mime });
  if (error) throw error;
  return {
    path,
    kind: file.kind,
    name: file.name,
    mime: file.mime,
    size: file.size,
    duration: file.duration,
    width: file.width,
    height: file.height,
  };
}

// Ссылки на файлы живут час; держим их, пока не устарели, чтобы фото не мигали.
const urlCache = new Map<string, { url: string; until: number }>();

export async function chatFileUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const result: Record<string, string> = {};
  const missing: string[] = [];
  for (const path of new Set(paths)) {
    const cached = urlCache.get(path);
    if (cached && cached.until > now) result[path] = cached.url;
    else missing.push(path);
  }
  if (missing.length > 0) {
    const { data } = await supabase.storage.from('chat-files').createSignedUrls(missing, 60 * 60);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        urlCache.set(item.path, { url: item.signedUrl, until: now + 50 * 60 * 1000 });
        result[item.path] = item.signedUrl;
      }
    }
  }
  return result;
}

export function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(seconds?: number) {
  const total = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ---------- Время и «был в сети» ----------

const LOCALES: Record<Language, string> = { ru: 'ru-RU', hy: 'hy-AM', en: 'en-US' };

export function timeOf(iso: string, language: Language) {
  return new Date(iso).toLocaleTimeString(LOCALES[language], { hour: '2-digit', minute: '2-digit' });
}

function dayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// 0 — сегодня, 1 — вчера и т.д.
export function daysAgo(iso: string) {
  return Math.round((dayStart(new Date()) - dayStart(new Date(iso))) / 86_400_000);
}

export function dayLabel(iso: string, language: Language, t: (key: string) => string) {
  const ago = daysAgo(iso);
  if (ago === 0) return t('chats.today');
  if (ago === 1) return t('chats.yesterday');
  const date = new Date(iso);
  return date.toLocaleDateString(LOCALES[language], {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

// Время в списке чатов: сегодня — часы, на этой неделе — день недели, раньше — дата.
export function listTime(iso: string, language: Language) {
  const ago = daysAgo(iso);
  if (ago === 0) return timeOf(iso, language);
  if (ago < 7) return new Date(iso).toLocaleDateString(LOCALES[language], { weekday: 'short' });
  return new Date(iso).toLocaleDateString(LOCALES[language], { day: 'numeric', month: 'short' });
}

// Приложение отмечает «я в сети» раз в минуту — значит, был меньше 2 минут назад = в сети.
export const ONLINE_MS = 2 * 60 * 1000;

export function isOnline(lastSeen: string | null | undefined) {
  return !!lastSeen && Date.now() - new Date(lastSeen).getTime() < ONLINE_MS;
}

export function lastSeenText(
  lastSeen: string | null | undefined,
  language: Language,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (isOnline(lastSeen)) return t('chats.online');
  if (!lastSeen) return t('chats.longAgo');
  const ago = daysAgo(lastSeen);
  const time = timeOf(lastSeen, language);
  if (ago === 0) return t('chats.lastSeenAt', { time });
  if (ago === 1) return t('chats.lastSeenYesterday', { time });
  return t('chats.lastSeenOn', {
    date: new Date(lastSeen).toLocaleDateString(LOCALES[language], { day: 'numeric', month: 'short' }),
  });
}

// Короткое описание сообщения: для цитаты, закрепа и списка чатов.
export function messagePreview(
  message: {
    body: string;
    attachments?: Attachment[];
    deleted_at?: string | null;
    call?: { video: boolean } | null;
  } | null,
  t: (key: string) => string,
) {
  if (!message) return '';
  if (message.deleted_at) return t('chats.deleted');
  if (message.call) return message.call.video ? `🎥 ${t('chats.videoCall')}` : `📞 ${t('chats.audioCall')}`;
  if (message.body) return message.body;
  const first = message.attachments?.[0];
  if (!first) return '';
  return attachmentLabel(first.kind, t, first.name);
}

export function attachmentLabel(
  kind: AttachmentKind | 'call' | null,
  t: (key: string) => string,
  name?: string,
) {
  switch (kind) {
    case 'call':
      return `📞 ${t('chats.call')}`;
    case 'photo':
      return `📷 ${t('chats.photo')}`;
    case 'video':
      return `🎬 ${t('chats.video')}`;
    case 'voice':
      return `🎤 ${t('chats.voice')}`;
    case 'file':
      return `📎 ${name || t('chats.file')}`;
    default:
      return '';
  }
}
