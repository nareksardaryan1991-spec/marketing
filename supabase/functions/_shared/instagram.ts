// Instagram API with Instagram Login: авторизация, токены, публикация.
import { requireEnv } from './http.ts';

const GRAPH = 'https://graph.instagram.com';
const VERSION = 'v25.0';

export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
];

export function callbackUrl(): string {
  return `${requireEnv('SUPABASE_URL')}/functions/v1/instagram-callback`;
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('INSTAGRAM_APP_ID'),
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: INSTAGRAM_SCOPES.join(','),
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

export class InstagramError extends Error {}

async function parse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const message = data.error?.error_user_msg ?? data.error?.message ?? data.error_message;
    throw new InstagramError(message ?? `Instagram API error ${res.status}`);
  }
  return data;
}

async function graphGet(path: string, params: Record<string, string>) {
  return await parse(await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`));
}

async function graphPost(path: string, params: Record<string, string>) {
  return await parse(
    await fetch(`${GRAPH}/${VERSION}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    }),
  );
}

// code → короткий токен → долгий (60 дней) → id и username аккаунта.
export async function connectWithCode(code: string) {
  const short = await parse(
    await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: requireEnv('INSTAGRAM_APP_ID'),
        client_secret: requireEnv('INSTAGRAM_APP_SECRET'),
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl(),
        code,
      }),
    }),
  );
  // Ответ бывает как плоским объектом, так и { data: [ ... ] }.
  const shortToken: string | undefined = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new InstagramError('No access token in Instagram response');

  const long = await graphGet('access_token', {
    grant_type: 'ig_exchange_token',
    client_secret: requireEnv('INSTAGRAM_APP_SECRET'),
    access_token: shortToken,
  });
  const me = await graphGet(`${VERSION}/me`, {
    fields: 'user_id,username',
    access_token: long.access_token,
  });
  return {
    accessToken: long.access_token as string,
    expiresAt: new Date(Date.now() + Number(long.expires_in) * 1000),
    userId: String(me.user_id),
    username: me.username as string,
  };
}

export async function refreshToken(accessToken: string) {
  const data = await graphGet('refresh_access_token', {
    grant_type: 'ig_refresh_token',
    access_token: accessToken,
  });
  return {
    accessToken: data.access_token as string,
    expiresAt: new Date(Date.now() + Number(data.expires_in) * 1000),
  };
}

export type ContainerParams = {
  image_url?: string;
  video_url?: string;
  media_type?: 'VIDEO' | 'REELS' | 'STORIES' | 'CAROUSEL';
  caption?: string;
  is_carousel_item?: 'true';
  children?: string;
};

export async function createContainer(igUserId: string, token: string, params: ContainerParams) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  const data = await graphPost(`${igUserId}/media`, { ...clean, access_token: token });
  return String(data.id);
}

export type ContainerStatus = 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';

export async function containerStatus(containerId: string, token: string) {
  const data = await graphGet(`${VERSION}/${containerId}`, {
    fields: 'status_code,status',
    access_token: token,
  });
  return { code: data.status_code as ContainerStatus, detail: data.status as string | undefined };
}

export async function publishContainer(igUserId: string, token: string, containerId: string) {
  const data = await graphPost(`${igUserId}/media_publish`, {
    creation_id: containerId,
    access_token: token,
  });
  return String(data.id);
}

export async function permalink(mediaId: string, token: string): Promise<string | null> {
  try {
    const data = await graphGet(`${VERSION}/${mediaId}`, { fields: 'permalink', access_token: token });
    return data.permalink ?? null;
  } catch {
    return null;
  }
}

// ---------- Статистика ----------

export const ACCOUNT_METRICS = [
  'reach',
  'views',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'shares',
  'saves',
];

// Набор метрик зависит от типа публикации (см. документацию Instagram Media Insights).
export function mediaMetrics(productType: string | undefined): string[] {
  if (productType === 'STORY') return ['reach', 'views', 'shares', 'total_interactions', 'replies'];
  const base = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions'];
  return productType === 'REELS' ? [...base, 'ig_reels_avg_watch_time'] : base;
}

type InsightRow = {
  name: string;
  values?: { value: number }[];
  total_value?: { value: number };
};

export function parseInsights(data: { data?: InsightRow[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of data.data ?? []) {
    const value = row.total_value?.value ?? row.values?.at(-1)?.value;
    if (typeof value === 'number') out[row.name] = value;
  }
  return out;
}

export async function accountInfo(token: string) {
  const me = await graphGet(`${VERSION}/me`, {
    fields: 'user_id,followers_count,media_count',
    access_token: token,
  });
  return {
    followers: typeof me.followers_count === 'number' ? me.followers_count : null,
    media: typeof me.media_count === 'number' ? me.media_count : null,
  };
}

// Итоги аккаунта за период (не больше 30 дней).
export async function accountInsights(igUserId: string, token: string, since: Date, until: Date) {
  return parseInsights(
    await graphGet(`${VERSION}/${igUserId}/insights`, {
      metric: ACCOUNT_METRICS.join(','),
      period: 'day',
      metric_type: 'total_value',
      since: String(Math.floor(since.getTime() / 1000)),
      until: String(Math.floor(until.getTime() / 1000)),
      access_token: token,
    }),
  );
}

export async function mediaInfo(mediaId: string, token: string) {
  const data = await graphGet(`${VERSION}/${mediaId}`, {
    fields: 'id,permalink,media_type,media_product_type',
    access_token: token,
  });
  return {
    permalink: (data.permalink as string | undefined) ?? null,
    mediaType: data.media_type as string | undefined,
    productType: data.media_product_type as string | undefined,
  };
}

export async function mediaInsights(mediaId: string, productType: string | undefined, token: string) {
  return parseInsights(
    await graphGet(`${VERSION}/${mediaId}/insights`, {
      metric: mediaMetrics(productType).join(','),
      access_token: token,
    }),
  );
}

// Ссылки вида https://www.instagram.com/p/ABC/?igsh=… приводим к одному виду.
export function normalizePermalink(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

// Последние публикации аккаунта: permalink → id (для постов, опубликованных вручную).
export async function recentMediaByPermalink(igUserId: string, token: string) {
  const data = await graphGet(`${VERSION}/${igUserId}/media`, {
    fields: 'id,permalink',
    limit: '100',
    access_token: token,
  });
  const map = new Map<string, string>();
  for (const item of data.data ?? []) {
    if (item.permalink) map.set(normalizePermalink(item.permalink), String(item.id));
  }
  return map;
}
