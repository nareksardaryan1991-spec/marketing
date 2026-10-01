// Картинки AI-дизайнера: генератор рисует фон без текста, поверх кладём макет (заголовок,
// подзаголовок, цена, название бренда) шрифтом с армянскими и русскими буквами — текст всегда чёткий.
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';

import type { DesignImage } from './agents.ts';

const WASM_URL = 'https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
const FONT_BASE = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts';
// Noto Sans — латиница и кириллица, Noto Sans Armenian — армянские буквы.
const FONT_URLS = [
  `${FONT_BASE}/NotoSans/hinted/ttf/NotoSans-Regular.ttf`,
  `${FONT_BASE}/NotoSans/hinted/ttf/NotoSans-Bold.ttf`,
  `${FONT_BASE}/NotoSansArmenian/hinted/ttf/NotoSansArmenian-Regular.ttf`,
  `${FONT_BASE}/NotoSansArmenian/hinted/ttf/NotoSansArmenian-Bold.ttf`,
];

let ready: Promise<Uint8Array[]> | null = null;

// Движок и шрифты грузим один раз на экземпляр функции.
function prepare(): Promise<Uint8Array[]> {
  ready ??= (async () => {
    await initWasm(fetch(WASM_URL));
    return await Promise.all(
      FONT_URLS.map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`font ${url}: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      }),
    );
  })();
  return ready;
}

export type Format = 'feed' | 'story' | 'square';

const SIZE: Record<Format, { w: number; h: number; gen: string }> = {
  feed: { w: 1080, h: 1350, gen: '1024x1536' },
  story: { w: 1080, h: 1920, gen: '1024x1536' },
  square: { w: 1080, h: 1080, gen: '1024x1024' },
};

export const hasImageGenerator = () => !!Deno.env.get('IMAGE_API_KEY');

// Фон от генератора картинок. Без ключа — null, тогда фон рисуем сами градиентом.
export async function generateBackground(prompt: string, format: Format): Promise<Uint8Array | null> {
  const key = Deno.env.get('IMAGE_API_KEY');
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('IMAGE_MODEL') ?? 'gpt-image-1',
      prompt: `${prompt}\nNo text, no letters, no logos, no watermarks in the image.`,
      size: SIZE[format].gen,
      n: 1,
    }),
  });
  if (!res.ok) throw new Error(`image generator: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string') throw new Error('image generator returned no image');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const HEX = /^#[0-9a-fA-F]{6}$/;
const ARMENIAN = /[԰-֏ﬓ-ﬗ]/;

// Движок не умеет смешивать шрифты в одной строке: армянский рядом с латиницей пропадает или
// становится квадратиками. Поэтому каждое слово режем на куски одного алфавита, каждый кусок —
// отдельный <text> со своим шрифтом, а места считаем сами, измеряя ширину тем же движком.
type Run = { text: string; armenian: boolean };
type Placed = Run & { x: number };

function splitRuns(word: string): Run[] {
  const runs: Run[] = [];
  for (const ch of word) {
    // В армянском шрифте нет запятых, цифр и т. п. — всё, кроме армянских знаков, рисует Noto Sans.
    const last = runs.at(-1);
    const armenian = ARMENIAN.test(ch);
    if (last && last.armenian === armenian) last.text += ch;
    else runs.push({ text: ch, armenian });
  }
  return runs;
}

const fontOf = (run: Run) => (run.armenian ? 'Noto Sans Armenian' : 'Noto Sans');

function runSvg(run: Run, x: number, y: number, size: number, weight: number, extra = '') {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${fontOf(run)}" font-size="${size}" font-weight="${weight}" fill="#fff"${extra}>${escape(run.text)}</text>`;
}

function measure(run: Run, size: number, weight: number, fonts: Uint8Array[]): number {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="400">${runSvg(run, 0, 300, size, weight)}</svg>`;
  const resvg = new Resvg(svg, { font: { fontBuffers: fonts, loadSystemFonts: false } });
  const box = resvg.getBBox();
  resvg.free();
  return box ? box.x + box.width : 0;
}

// Переносим по словам с настоящей шириной; лишние строки обрезаем многоточием.
function layoutText(
  text: string,
  size: number,
  weight: number,
  maxWidth: number,
  maxLines: number,
  fonts: Uint8Array[],
): Placed[][] {
  const space = size * 0.28;
  const words = text.trim().split(/\s+/).filter(Boolean).map((word) => {
    const runs = splitRuns(word);
    const widths = runs.map((run) => measure(run, size, weight, fonts));
    return { runs, widths, width: widths.reduce((a, b) => a + b, 0) };
  });
  const lines: Placed[][] = [];
  let line: Placed[] = [];
  let x = 0;
  for (const word of words) {
    if (line.length && x + space + word.width > maxWidth) {
      lines.push(line);
      line = [];
      x = 0;
    }
    if (line.length) x += space;
    word.runs.forEach((run, i) => {
      line.push({ ...run, x });
      x += word.widths[i];
    });
  }
  if (line.length) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    const last = lines[maxLines - 1].at(-1)!;
    last.text = `${last.text.replace(/[.,;:!?]$/, '')}…`;
  }
  return lines;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function layoutSvg(design: DesignImage, brand: string, format: Format, background: Uint8Array | null) {
  const fonts = await prepare();
  const { w, h } = SIZE[format];
  const accent = HEX.test(design.accent_color) ? design.accent_color : '#4F46E5';
  const pad = 72;
  const headSize = format === 'story' ? 96 : 84;
  const subSize = format === 'story' ? 48 : 44;
  const head = layoutText(design.headline, headSize, 700, w - pad * 2, 3, fonts);
  const sub = layoutText(design.subline, subSize, 400, w - pad * 2, 3, fonts);
  const price = layoutText(design.price, 52, 700, w - pad * 2 - 64, 1, fonts)[0] ?? [];

  const blockHeight =
    head.length * headSize * 1.15 + (sub.length ? 24 + sub.length * subSize * 1.3 : 0) + (price.length ? 40 + 96 : 0);
  const top =
    design.text_position === 'top'
      ? pad + 80
      : design.text_position === 'center'
        ? (h - blockHeight) / 2
        : h - pad - blockHeight;

  let y = top;
  const parts: string[] = [];
  for (const line of head) {
    y += headSize;
    for (const run of line) parts.push(runSvg(run, pad + run.x, y, headSize, 700));
    y += headSize * 0.15;
  }
  if (sub.length) y += 24;
  for (const line of sub) {
    y += subSize;
    for (const run of line) parts.push(runSvg(run, pad + run.x, y, subSize, 400, ' fill-opacity="0.92"'));
    y += subSize * 0.3;
  }
  if (price.length) {
    y += 40;
    const last = price.at(-1)!;
    const textWidth = last.x + measure(last, 52, 700, fonts);
    parts.push(`<rect x="${pad}" y="${y}" width="${(textWidth + 64).toFixed(1)}" height="96" rx="48" fill="${accent}"/>`);
    for (const run of price) parts.push(runSvg(run, pad + 32 + run.x, y + 66, 52, 700));
  }
  const brandY = design.text_position === 'top' ? h - pad : pad + 32;
  for (const run of layoutText(brand.toUpperCase(), 32, 700, w - pad * 2, 1, fonts)[0] ?? []) {
    parts.push(runSvg(run, pad + run.x, brandY, 32, 700, ' fill-opacity="0.9"'));
  }

  // Затемнение под текстом, чтобы он читался на любом фоне. Без текста картинку не трогаем.
  const hasText = head.length > 0 || sub.length > 0 || price.length > 0;
  const shade = !hasText
    ? ''
    : design.text_position === 'center'
      ? `<rect width="${w}" height="${h}" fill="#000" fill-opacity="0.38"/>`
      : `<rect width="${w}" height="${h}" fill="url(#shade)"/>`;
  const shadeFrom = design.text_position === 'top' ? '0' : '1';
  const shadeTo = design.text_position === 'top' ? '1' : '0';
  const bg = background
    ? `<image href="data:image/png;base64,${toBase64(background)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${w}" height="${h}" fill="url(#plain)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="shade" x1="0" y1="${shadeFrom}" x2="0" y2="${shadeTo}">
      <stop offset="0" stop-color="#000" stop-opacity="0.75"/>
      <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="plain" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent}"/>
      <stop offset="1" stop-color="#111827"/>
    </linearGradient>
  </defs>
  ${bg}
  ${shade}
  ${parts.join('\n  ')}
</svg>`;
}

export async function renderPng(svg: string): Promise<Uint8Array> {
  const fontBuffers = await prepare();
  const resvg = new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false } });
  const png = resvg.render().asPng();
  resvg.free();
  return png;
}
