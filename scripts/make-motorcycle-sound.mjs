// Генерирует звук уведомления чата — рёв мотоцикла (холостой ход → газ → сброс).
// Синтез, без чужих записей. Запуск: node scripts/make-motorcycle-sound.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const SECONDS = 2.2;
const out = join(dirname(fileURLToPath(import.meta.url)), '../apps/mobile/assets/sounds/motorcycle.wav');

// Частота вспышек в цилиндрах (Гц): холостой ход, резкий газ, плавный сброс.
function firingRate(t) {
  if (t < 0.35) return 28;
  if (t < 0.9) return 28 + (135 - 28) * Math.sin(((t - 0.35) / 0.55) * (Math.PI / 2));
  if (t < 1.3) return 135;
  return 135 - (135 - 45) * Math.min(1, (t - 1.3) / 0.9);
}

let seed = 1;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

const n = Math.floor(RATE * SECONDS);
const samples = new Float32Array(n);
let phase = 0;
let lowNoise = 0;
for (let i = 0; i < n; i++) {
  const t = i / RATE;
  phase += firingRate(t) / RATE;
  const p = phase % 1;
  // Каждая вспышка — резкий удар с быстрым затуханием; V-твин: второй удар слабее и со сдвигом.
  const pulse = Math.exp(-p * 9) + 0.6 * Math.exp(-((p + 0.62) % 1) * 11);
  lowNoise = lowNoise * 0.85 + noise() * 0.15;
  let s = pulse * (0.8 + 0.5 * lowNoise) + 0.25 * Math.sin(2 * Math.PI * phase * 2) * pulse;
  s = Math.tanh(s * 2.2); // перегруз — «рычание» выхлопа
  const fade = Math.min(1, t / 0.05, (SECONDS - t) / 0.25);
  samples[i] = s * fade;
}

// Убрать постоянную составляющую и довести до почти максимальной громкости.
const mean = samples.reduce((a, b) => a + b, 0) / n;
let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs((samples[i] -= mean)));
const pcm = Buffer.alloc(44 + n * 2);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + n * 2, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20); // PCM
pcm.writeUInt16LE(1, 22); // моно
pcm.writeUInt32LE(RATE, 24);
pcm.writeUInt32LE(RATE * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round((samples[i] / peak) * 0.95 * 32767), 44 + i * 2);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pcm);
console.log(`${out} (${(pcm.length / 1024).toFixed(0)} КБ)`);
