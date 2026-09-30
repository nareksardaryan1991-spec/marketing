// Сквозная проверка просмотровой версии в настоящем Chrome.
// Нужен запущенный ./scripts/preview.sh --background. Запуск: cd scripts/preview && npm run e2e
// Снимки экранов сохраняются в scripts/preview/screens/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:8081';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const DIRECT_CHAT = 'dc000000-0000-4000-8000-000000000001'; // менеджер ↔ дизайнер
const SCREENS = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(SCREENS, { recursive: true });

// Защита: собранное приложение должно обращаться именно к проверяемому серверу —
// иначе тест менял бы чужие данные (например, просмотровую версию на другом порту).
const html = await fetch(BASE).then((r) => r.text());
const bundlePath = html.match(/src="([^"]*entry-[^"]*\.js)"/)?.[1];
const bundle = bundlePath ? await fetch(new URL(bundlePath, BASE)).then((r) => r.text()) : '';
if (!bundle.includes(new URL(BASE).host)) {
  console.error(`STOP: приложение на ${BASE} собрано для другого сервера. Пересоберите с --clear.`);
  process.exit(2);
}

// Начинаем с исходных демо-данных.
await fetch(`${BASE}/__reset`).catch(() => null);
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 300));
  if (await fetch(BASE).then((r) => r.ok, () => false)) break;
}

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failed++;
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--lang=ru-RU'],
});

// Отдельный «пользователь» со своим хранилищем — как отдельное окно/телефон.
async function openAs(email) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 780 });
  // Интерфейс на русском — как выбор языка в самом приложении.
  await page.evaluateOnNewDocument(() => localStorage.setItem('app.language', 'ru'));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  if (email) await signIn(page, email);
  return page;
}

async function signIn(page, email, password = 'demo1234') {
  await page.waitForSelector('input[type="password"]');
  const [emailInput, passwordInput] = await page.$$('input');
  await emailInput.type(email);
  await passwordInput.type(password);
  await page.locator('::-p-text(Войти)').click();
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 10000 });
}

// Неразрывные пробелы (в ценах «8 000») приводим к обычным.
const text = (page) => page.evaluate(() => document.body.innerText.replace(/[\u00a0\u202f]/g, ' '));
const waitText = (page, value, timeout = 10000) =>
  page.waitForFunction((v) => document.body.innerText.includes(v), { timeout }, value).then(
    () => true,
    () => false,
  );

// Где стоит сообщение: справа (своё) или слева (чужое), и чья подпись над ним.
async function bubble(page, body) {
  return page.evaluate((body) => {
    const node = [...document.querySelectorAll('div')].find(
      (el) => el.children.length === 0 && el.textContent === body,
    );
    const box = node?.parentElement;
    if (!box) return null;
    const style = getComputedStyle(box);
    const label = box.firstElementChild !== node ? box.firstElementChild.textContent : null;
    return { side: style.alignSelf === 'flex-end' ? 'right' : 'left', label };
  }, body);
}

async function send(page, message) {
  const input = await page.waitForSelector('textarea');
  await input.type(message);
  await page.locator('[aria-label="Отправить"]').click();
  await waitText(page, message);
}

// 1. Два окна: менеджер и дизайнер переписываются одновременно.
const manager = await openAs('manager@demo.am');
const designer = await openAs('designer@demo.am');
await manager.goto(`${BASE}/team-chat/${DIRECT_CHAT}`, { waitUntil: 'networkidle0' });
await designer.goto(`${BASE}/team-chat/${DIRECT_CHAT}`, { waitUntil: 'networkidle0' });

const fromManager = `Привет от менеджера ${Date.now() % 10000}`;
await send(manager, fromManager);
check('designer receives manager message without reopening', await waitText(designer, fromManager, 9000));
const inDesigner = await bubble(designer, fromManager);
check("manager's message is on the left for designer, signed by name", inDesigner?.side === 'left' && inDesigner?.label === 'Нарек', JSON.stringify(inDesigner));
const inManager = await bubble(manager, fromManager);
check("manager's own message is on the right, without name", inManager?.side === 'right' && !inManager?.label, JSON.stringify(inManager));

const fromDesigner = `Ответ дизайнера ${Date.now() % 10000}`;
await send(designer, fromDesigner);
check('manager receives designer reply', await waitText(manager, fromDesigner, 9000));
const reply = await bubble(manager, fromDesigner);
check("designer's reply is on the left for manager, signed «Ани Саргсян»", reply?.side === 'left' && reply?.label === 'Ани Саргсян', JSON.stringify(reply));
await manager.screenshot({ path: `${SCREENS}chat-manager.png` });
await designer.screenshot({ path: `${SCREENS}chat-designer.png` });

// 2. Новый сотрудник ждёт роль, владелец назначает — у сотрудника открывается работа.
const newbie = await openAs('newbie@demo.am');
check('pending employee sees waiting screen', await waitText(newbie, 'назначит вам роль'));
await newbie.screenshot({ path: `${SCREENS}pending.png` });

const admin = await openAs('admin@demo.am');
await admin.goto(`${BASE}/team`, { waitUntil: 'networkidle0' });
check('admin sees «Ждут роли» with the newbie', (await text(admin)).includes('Ждут роли') && (await text(admin)).includes('Лусине'));
await admin.screenshot({ path: `${SCREENS}team-admin.png`, fullPage: true });
await admin.locator('::-p-text(Лусине Мартиросян)').click();
await admin.locator('::-p-text(Фотограф)').click();
check('role assigned', await waitText(admin, 'Фотограф'));

await newbie.locator('::-p-text(Проверить)').click();
check('employee gets workspace after role is assigned', await waitText(newbie, 'Чат команды'));

const managerTeam = await openAs('manager@demo.am');
await managerTeam.goto(`${BASE}/team`, { waitUntil: 'networkidle0' });
check('manager cannot change roles', (await text(managerTeam)).includes('Роли назначает владелец'));

// 3. Регистрация: «Я сотрудник» → ожидание роли.
const signup = await openAs(null);
await signup.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle0' });
await signup.locator('::-p-text(Я сотрудник агентства)').click();
const inputs = await signup.$$('input');
await inputs[0].type('Новый Монтажёр');
await inputs[1].type(`editor${Date.now() % 100000}@demo.am`);
await inputs[2].type('secret123');
await signup.screenshot({ path: `${SCREENS}signup.png`, fullPage: true });
await signup.locator('::-p-text(Зарегистрироваться)').click();
check('staff signup lands on waiting screen', await waitText(signup, 'назначит вам роль'));

// 4. Клиент выбирает площадки и видит отдельные карточки с ценами.
const client = await openAs('client@demo.am');
await client.goto(`${BASE}/new-order`, { waitUntil: 'networkidle0' });
await client.locator('::-p-text(Instagram)').click();
await client.locator('::-p-text(Facebook)').click();
const orderText = await text(client);
check('instagram and facebook cards with their own prices',
  orderText.includes('8 000') && orderText.includes('6 000') && orderText.includes('Дополнительно'));
await client.screenshot({ path: `${SCREENS}new-order.png`, fullPage: true });

// 5. Вход сохранён, а пользователя на сервере больше нет (сброс демо) → экран входа, не ошибка.
const ghost = await openAs(null);
await ghost.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle0' });
const ghostInputs = await ghost.$$('input');
await ghostInputs[0].type('Временный клиент');
await ghostInputs[1].type(`ghost${Date.now() % 100000}@demo.am`);
await ghostInputs[2].type('secret123');
await ghost.locator('::-p-text(Зарегистрироваться)').click();
await waitText(ghost, 'Расскажите о бизнесе');
await fetch(`${BASE}/__reset`);
await new Promise((r) => setTimeout(r, 2000));
await ghost.reload({ waitUntil: 'networkidle0' });
check('missing user is signed out instead of an error', await waitText(ghost, 'Войти'), (await text(ghost)).slice(0, 40));

await browser.close();
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL E2E CHECKS PASSED');
process.exitCode = failed ? 1 : 0;
