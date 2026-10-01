// Рисует узор для фона чатов (как в Telegram): apps/mobile/assets/chat/pattern.png.
// Плитка повторяется без швов; фигуры чёрные и почти прозрачные — цвет даёт фон под ней,
// на тёмном фоне приложение перекрашивает узор в белый.
// Запуск: node scripts/make-chat-pattern.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZE = 240;
const CELL = 40;
const ALPHA = 0.11;
const SAMPLES = 4; // сглаживание: 4×4 точки на пиксель

// Повторяемые «случайные» числа: узор одинаковый при каждом запуске.
let seed = 20260930;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// Фигуры в координатах относительно центра, размер ~ r.
const shapes = {
  ring: (x, y, r) => Math.abs(Math.hypot(x, y) - r) < r * 0.16,
  dot: (x, y, r) => Math.hypot(x, y) < r * 0.4,
  plus: (x, y, r) => (Math.abs(x) < r * 0.16 && Math.abs(y) < r) || (Math.abs(y) < r * 0.16 && Math.abs(x) < r),
  heart: (x, y, r) => {
    const u = x / r, v = -y / r + 0.25;
    return (u * u + v * v - 0.6) ** 3 - u * u * v ** 3 * 0.9 <= 0;
  },
  star: (x, y, r) => {
    const angle = Math.atan2(y, x), dist = Math.hypot(x, y);
    const k = Math.cos(5 * angle);
    return dist < r * (0.55 + 0.45 * Math.max(0, k) ** 2);
  },
  square: (x, y, r) => {
    const c = Math.cos(0.6), s = Math.sin(0.6);
    const u = x * c - y * s, v = x * s + y * c;
    const edge = Math.max(Math.abs(u), Math.abs(v));
    return edge < r * 0.7 && edge > r * 0.48;
  },
  wave: (x, y, r) => Math.abs(x) < r && Math.abs(y - Math.sin((x / r) * Math.PI) * r * 0.35) < r * 0.15,
};
const names = Object.keys(shapes);

const placed = [];
for (let cy = 0; cy < SIZE; cy += CELL) {
  for (let cx = 0; cx < SIZE; cx += CELL) {
    placed.push({
      fn: shapes[names[Math.floor(random() * names.length)]],
      x: cx + CELL / 2 + (random() - 0.5) * 10,
      y: cy + CELL / 2 + (random() - 0.5) * 10,
      r: 7 + random() * 4,
    });
  }
}

const pixels = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let py = 0; py < SIZE; py++) {
  const row = py * (SIZE * 4 + 1);
  pixels[row] = 0; // PNG: строка без фильтра
  for (let px = 0; px < SIZE; px++) {
    let hits = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = px + (sx + 0.5) / SAMPLES, y = py + (sy + 0.5) / SAMPLES;
        if (placed.some((s) => Math.hypot(x - s.x, y - s.y) < s.r * 1.3 && s.fn(x - s.x, y - s.y, s.r))) hits++;
      }
    }
    pixels[row + 1 + px * 4 + 3] = Math.round((hits / SAMPLES ** 2) * ALPHA * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // бит на канал
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = fileURLToPath(new URL('../apps/mobile/assets/chat/pattern.png', import.meta.url));
fs.mkdirSync(new URL('../apps/mobile/assets/chat/', import.meta.url), { recursive: true });
fs.writeFileSync(out, png);
console.log('saved', out, png.length, 'bytes');
