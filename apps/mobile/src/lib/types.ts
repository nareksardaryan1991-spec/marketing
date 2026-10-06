export type UserRole =
  | 'client'
  | 'pending'
  | 'admin'
  | 'manager'
  | 'designer'
  | 'videographer'
  | 'video_editor'
  | 'photographer'
  | 'copywriter'
  | 'smm'
  | 'targetologist'
  | 'seo'
  | 'freelancer'
  // Сотрудник с должностью: видит только свои задачи (миграция 0027).
  | 'employee';

export type Language = 'ru' | 'hy' | 'en';

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  // Должность («Фотограф»); назначает владелец.
  job_title?: string | null;
  language: Language;
  email: string | null;
  // Личный кабинет: пути в bucket avatars, цвет обложки (#RRGGBB) и «о себе».
  avatar_path: string | null;
  cover_path: string | null;
  accent_color: string | null;
  bio: string | null;
  // Валюта показа цен (платят всегда в драмах).
  currency?: Currency;
  // Чаты: когда был в сети и фон («preset:<id>» или «photo:<путь>»).
  last_seen_at: string | null;
  chat_wallpaper: string | null;
  created_at: string;
};

export type Business = {
  id: string;
  owner_id: string;
  name: string;
  industry: string;
  city: string | null;
  description: string | null;
  target_audience: string | null;
  tone: string | null;
  goals: string | null;
  competitors: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
  website_url: string | null;
  // «Мозг» для AI-агентов (миграция 0022).
  example_posts: string | null;
  brand_colors: string[];
  logo_path: string | null;
  // Знакомство пройдено (миграция 0023); до этого клиент видит только его.
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Localized = Partial<Record<Language, string>>;

export type Service = {
  id: string;
  name: Localized;
  description: Localized;
  price_amd: number;
  sort_order: number;
  active: boolean;
  // true — заказывается для конкретной площадки (пост, история, рилс).
  per_platform: boolean;
};

export type Platform = {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
};

export type PlatformService = {
  platform_id: string;
  service_id: string;
  price_amd: number;
  // Своё название на площадке (например, «Видео» в TikTok).
  label: Localized | null;
  active: boolean;
};

export type OrderStatus = 'pending_payment' | 'paid' | 'in_progress' | 'completed' | 'cancelled';
export type BillingType = 'one_time' | 'monthly';
export type PublishingMode = 'team' | 'auto' | 'client';

export type Order = {
  id: string;
  business_id: string;
  client_id: string;
  billing: BillingType;
  publishing: PublishingMode;
  status: OrderStatus;
  items_total_amd: number;
  ad_budget_amd: number;
  total_amd: number;
  notes: string | null;
  paid_at: string | null;
  // Промокод и скидка на услуги (рекламный бюджет не уменьшается).
  promo_code: string | null;
  discount_amd: number;
  // Заказ оформлен пакетом (миграция 0024).
  package_id?: string | null;
  created_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  service_id: string;
  platform_id: string | null;
  quantity: number;
  unit_price_amd: number;
  line_total_amd: number;
};

export type TaskStatus =
  | 'new'
  | 'assigned'
  | 'in_progress'
  | 'internal_review'
  | 'client_review'
  | 'changes_requested'
  | 'approved'
  | 'publishing'
  | 'published';

export type TaskKind = 'order' | 'team';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

// Работа по заказу (kind = 'order': заказ, услуга, номер) или задача команды (kind = 'team':
// название, важность, файлы к заданию; клиент и заказ — необязательно). Миграция 0028.
export type Task = {
  id: string;
  kind: TaskKind;
  order_id: string | null;
  business_id: string | null;
  service_id: string | null;
  platform_id: string | null;
  number: number | null;
  title: string | null;
  priority: TaskPriority;
  attachments: string[];
  created_by: string | null;
  related_order_id: string | null;
  status: TaskStatus;
  assignee_id: string | null;
  due_date: string | null;
  brief: string | null;
  publish_at: string | null;
  published_at: string | null;
  published_url: string | null;
  publish_error: string | null;
  autopublish_state: { container?: string; children?: string[]; failed?: boolean };
  // Когда материал отправлен клиенту на согласование (от этого считается автоодобрение).
  client_review_since: string | null;
  created_at: string;
  updated_at: string;
};

export type Deliverable = {
  id: string;
  task_id: string;
  version: number;
  caption: string | null;
  files: string[];
  // Заметка для менеджера — в отдельной таблице deliverable_notes, видна только команде.
  note?: string | null;
  created_by: string;
  created_at: string;
  // Какой AI-агент сделал версию (null — человек).
  agent?: string | null;
  // Когда ушла клиенту и кто из менеджеров её проверил (миграции 0009, 0025).
  sent_to_client_at?: string | null;
  reviewer_name?: string | null;
};

export type TaskComment = {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export type SocialAccount = {
  id: string;
  business_id: string;
  platform: 'instagram';
  username: string | null;
  token_expires_at: string;
  insights_error: string | null;
  insights_updated_at: string | null;
  created_at: string;
};

// Колонки, доступные приложению (токен читает только сервер).
export const SOCIAL_ACCOUNT_COLUMNS =
  'id, business_id, platform, username, token_expires_at, insights_error, insights_updated_at, created_at';

export type AccountSnapshot = {
  business_id: string;
  taken_on: string;
  followers_count: number | null;
  media_count: number | null;
  metrics_30d: Record<string, number>;
  fetched_at: string;
};

export type PostMetrics = {
  task_id: string;
  business_id: string;
  media_id: string;
  permalink: string | null;
  media_type: string | null;
  metrics: Record<string, number>;
  fetched_at: string;
};

// Точка правки на материале: x, y — доля ширины и высоты кадра, at_seconds — секунда видео.
export type ApprovalMark = {
  file_path: string;
  x: number;
  y: number;
  at_seconds: number | null;
  note: string;
};

export type PromoCode = {
  code: string;
  percent: number | null;
  amount_amd: number | null;
  max_uses: number | null;
  used_count: number;
  valid_until: string | null;
  active: boolean;
  created_at: string;
};

export type Currency = 'AMD' | 'USD' | 'EUR';

// Пакет на месяц: набор услуг каталога с ценой за месяц.
export type Package = {
  id: string;
  name: Localized;
  description: Localized;
  price_amd: number;
  active: boolean;
  sort_order: number;
  package_items: PackageItem[];
};

export type PackageItem = { service_id: string; platform_id: string | null; quantity: number };
