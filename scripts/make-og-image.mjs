// Картинка для превью ссылки на сайт в Telegram, WhatsApp, Facebook (Open Graph, 1200×630):
// снимает scripts/og-image.html в Chrome и кладёт в apps/mobile/public/og-image.jpg.
// Запуск (нужны зависимости scripts/preview и Chrome): node scripts/make-og-image.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('./preview/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const page = fileURLToPath(new URL('./og-image.html', import.meta.url));
const out = fileURLToPath(new URL('../apps/mobile/public/og-image.jpg', import.meta.url));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
const tab = await browser.newPage();
await tab.setViewport({ width: 1200, height: 630 });
await tab.goto(`file://${page}`, { waitUntil: 'networkidle0' });
// JPEG — лёгкий файл: WhatsApp не показывает превью с тяжёлой картинкой.
await tab.screenshot({ path: out, type: 'jpeg', quality: 88 });
await browser.close();
console.log('og-image.jpg готов:', out);
