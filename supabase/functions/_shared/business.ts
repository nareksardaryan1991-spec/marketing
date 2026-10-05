// Профиль бизнеса клиента — «мозг» для AI: одинаковый текст для всех агентов и функций.
// Поля — из таблицы businesses (миграции 0001 и 0022).

// deno-lint-ignore no-explicit-any
export type BusinessRow = Record<string, any>;

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function brandColors(b: BusinessRow | null | undefined): string[] {
  return ((b?.brand_colors ?? []) as string[]).filter((c) => HEX.test(c));
}

export function businessProfile(b: BusinessRow | null | undefined): string {
  if (!b) return '## Client business\n(unknown)';
  const colors = brandColors(b);
  const lines = [
    ['Name', b.name],
    ['Industry', b.industry],
    ['City', b.city],
    ['About', b.description],
    ['Target audience', b.target_audience],
    ['Tone of voice', b.tone],
    ['Goals', b.goals],
    ['Competitors / references', b.competitors],
    ['Website', b.website_url],
    ['Instagram', b.instagram_url],
    ['Facebook', b.facebook_url],
    ['TikTok', b.tiktok_url],
    ['Brand colors', colors.length ? colors.join(', ') : null],
    ['Logo', b.logo_path ? 'uploaded (added to images automatically)' : null],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);
  const examples = b.example_posts
    ? `\n\n## Examples of the client's successful posts (match this style and voice; do not copy them)\n${String(b.example_posts).slice(0, 4000)}`
    : '';
  return `## Client business\n${lines.join('\n')}${examples}`;
}
