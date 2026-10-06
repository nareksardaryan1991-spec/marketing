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
  // Поддельный микрофон — для проверки голосовых.
  args: ['--no-sandbox', '--lang=ru-RU', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

// Отдельный «пользователь» со своим хранилищем — как отдельное окно/телефон.
async function openAs(email) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 780 });
  // Интерфейс на русском — как выбор языка в самом приложении.
  await page.evaluateOnNewDocument(() => localStorage.setItem('app.language', 'ru'));
  // Считаем звуковые сигналы: каждый запуск аудио на странице.
  await page.evaluateOnNewDocument(() => {
    window.__sounds = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__sounds++;
      return play.call(this).catch(() => {});
    };
  });
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
// Первый видимый элемент: вкладки нижнего меню остаются на странице скрытыми (например, выбор
// валюты в профиле), а waitForSelector ждёт видимости именно первого совпадения.
async function firstVisible(page, selector, timeout = 9000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    for (const el of await page.$$(selector)) if (await el.evaluate((e) => e.offsetParent !== null)) return el;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no visible ${selector}`);
}

const text = (page) => page.evaluate(() => document.body.innerText.replace(/[\u00a0\u202f]/g, ' '));
const waitText = (page, value, timeout = 10000) =>
  page.waitForFunction((v) => document.body.innerText.includes(v), { timeout }, value).then(
    () => true,
    () => false,
  );

// Текст сообщения в ленте (узел, где начинается текст пузыря).
async function messageNode(page, body) {
  const handle = await page.evaluateHandle((body) => {
    const nodes = [...document.querySelectorAll('div')].filter(
      (el) => el.firstChild?.nodeType === 3 && el.firstChild.textContent === body,
    );
    return nodes[0] ?? null; // первое — само сообщение, дальше могут быть цитаты
  }, body);
  return handle.asElement();
}

// Где стоит сообщение: справа (своё) или слева (чужое), и чья подпись над ним.
async function bubble(page, body) {
  const node = await messageNode(page, body);
  if (!node) return null;
  return node.evaluate((node) => {
    const content = node.parentElement;
    const box = content.parentElement;
    const row = box.parentElement;
    const label = box.firstElementChild !== content ? box.firstElementChild.textContent : null;
    return { side: getComputedStyle(row).alignItems === 'flex-end' ? 'right' : 'left', label };
  });
}

// Меню сообщения — правой кнопкой мыши, как на компьютере.
async function menu(page, body, action) {
  const node = await messageNode(page, body);
  await node.click({ button: 'right' });
  await page.locator(`::-p-text(${action})`).click();
}

async function send(page, message) {
  const input = await page.waitForSelector('textarea');
  await input.type(message);
  await page.locator('[aria-label="Отправить"]').click();
  await waitText(page, message);
}

// На компьютере сообщение уходит по Enter, без кнопки.
async function sendWithEnter(page, message) {
  const input = await page.waitForSelector('textarea');
  await input.type(message);
  await page.keyboard.press('Enter');
  await waitText(page, message);
}

const sounds = (page) => page.evaluate(() => window.__sounds);

// 1. Два окна: менеджер и дизайнер переписываются одновременно.
const manager = await openAs('manager@demo.am');
const designer = await openAs('designer@demo.am');
await manager.goto(`${BASE}/team-chat/${DIRECT_CHAT}`, { waitUntil: 'networkidle0' });
await designer.goto(`${BASE}/team-chat/${DIRECT_CHAT}`, { waitUntil: 'networkidle0' });

const fromManager = `Привет от менеджера ${Date.now() % 10000}`;
await send(manager, fromManager);
check('designer receives manager message without reopening', await waitText(designer, fromManager, 9000));
const inDesigner = await bubble(designer, fromManager);
check("manager's message is on the left for designer, no name in a direct chat", inDesigner?.side === 'left' && !inDesigner?.label, JSON.stringify(inDesigner));
const inManager = await bubble(manager, fromManager);
check("manager's own message is on the right, without name", inManager?.side === 'right' && !inManager?.label, JSON.stringify(inManager));

const fromDesigner = `Ответ дизайнера ${Date.now() % 10000}`;
const managerSounds = await sounds(manager);
const designerSounds = await sounds(designer);
await sendWithEnter(designer, fromDesigner);
check('Enter sends the message and clears the field', await designer.$eval('textarea', (el) => el.value === ''));
check('manager receives designer reply', await waitText(manager, fromDesigner, 9000));
await new Promise((r) => setTimeout(r, 500));
check('manager hears the signal for a new message', (await sounds(manager)) > managerSounds);
check('designer hears no signal for own message', (await sounds(designer)) === designerSounds);
const reply = await bubble(manager, fromDesigner);
check("designer's reply is on the left for manager", reply?.side === 'left' && !reply?.label, JSON.stringify(reply));
check('manager sees two ticks once the designer has read', await waitText(manager, '✓✓', 9000));

// Как в Telegram: ответ, правка, реакция, закреп, удаление.
await menu(designer, fromManager, 'Ответить');
check('reply banner shows the quoted message', await waitText(designer, 'Ответ: Нарек'));
const answer = `Цитирую ${Date.now() % 10000}`;
await send(designer, answer);
check('reply shows a quote for the other side', await waitText(manager, answer, 9000) &&
  (await manager.evaluate((a, q) => {
    const node = [...document.querySelectorAll('div')].find((el) => el.firstChild?.nodeType === 3 && el.firstChild.textContent === a);
    return node?.parentElement.innerText.includes(q);
  }, answer, fromManager)));

await menu(manager, fromManager, 'Изменить');
const editInput = await manager.waitForSelector('textarea');
check('edit puts the text into the field', (await editInput.evaluate((el) => el.value)) === fromManager);
await editInput.click({ count: 3 });
const edited = `${fromManager} (исправлено)`;
await editInput.type(edited);
await manager.keyboard.press('Enter');
check('edited message shows «изменено» for the other side', await waitText(designer, edited, 9000) && await waitText(designer, 'изменено'));

await menu(designer, edited, '👍');
check('reaction is visible to the author', await manager.waitForFunction(() => document.body.innerText.includes('👍'), { timeout: 9000 }).then(() => true, () => false));

await menu(manager, fromDesigner, 'Закрепить');
check('pinned message bar appears', await waitText(manager, 'Закреплённое сообщение'));
check('pinned for the other side too', await waitText(designer, 'Закреплённое сообщение', 9000));

const oops = `Ошибочное ${Date.now() % 10000}`;
await send(manager, oops);
await waitText(designer, oops, 9000);
manager.once('dialog', (dialog) => dialog.accept());
await menu(manager, oops, 'Удалить');
check('deleted message disappears for everyone',
  await designer.waitForFunction((o) => !document.body.innerText.includes(o), { timeout: 9000 }, oops).then(() => true, () => false) &&
  await waitText(designer, 'Сообщение удалено'));

// Фото и голосовое.
await manager.locator('[aria-label="Прикрепить"]').click();
const [photoChooser] = await Promise.all([
  manager.waitForFileChooser(),
  manager.locator('::-p-text(Фото или видео)').click(),
]);
await photoChooser.accept([new URL('../../apps/mobile/assets/icon.png', import.meta.url).pathname]);
await manager.locator('[aria-label="Отправить"]').click();
const photoSrc = await designer.waitForSelector('img[src*="/object/sign/chat-files/"]', { timeout: 9000 }).then(
  (img) => img.evaluate((el) => el.src), () => null);
check('photo arrives and loads for the other side', !!photoSrc && (await fetch(photoSrc)).ok, photoSrc);
check('photo shows in the chat list as «Фото»', await (async () => {
  await manager.goto(`${BASE}/chats`, { waitUntil: 'networkidle0' });
  return waitText(manager, 'Фото');
})());
await manager.goto(`${BASE}/team-chat/${DIRECT_CHAT}`, { waitUntil: 'networkidle0' });

await designer.locator('[aria-label="Записать голосовое"]').click();
check('recording started', await waitText(designer, 'Запись'));
await new Promise((r) => setTimeout(r, 1500));
await designer.locator('[aria-label="Отправить"]').click();
check('voice message arrives with a player', await manager.waitForSelector('[aria-label="play"]', { timeout: 9000 }).then(() => true, () => false));
await manager.screenshot({ path: `${SCREENS}chat-manager.png` });
await designer.screenshot({ path: `${SCREENS}chat-designer.png` });

// Звонок: кнопка 🎥 сразу открывает комнату Jitsi, у собеседника — «Присоединиться».
const callTab = (page) =>
  browser.waitForTarget((t) => t.url().startsWith('https://meet.jit.si/marketing-') && t.opener() === page.target(), { timeout: 9000 })
    .then(async (t) => {
      const url = t.url();
      // Закрываем вкладку звонка: иначе окно чата уходит в фон и перестаёт отрисовываться.
      await (await t.page())?.close().catch(() => {});
      await page.bringToFront();
      return url;
    }, () => null);
const [started] = await Promise.all([callTab(manager), manager.locator('[aria-label="Видеозвонок"]').click()]);
check('video call opens a Jitsi room with the caller name', !!started && started.includes('config.startWithVideoMuted=false') && started.includes('displayName'), started);
check('the other side sees the call with «Присоединиться»', await waitText(designer, 'Присоединиться', 9000));
const [joined] = await Promise.all([callTab(designer), designer.locator('::-p-text(Присоединиться)').click()]);
check('joining opens the same room', !!joined && joined.split('#')[0] === started.split('#')[0], joined);
await designer.screenshot({ path: `${SCREENS}chat-call.png` });

// Общий чат: имена авторов над сообщениями; список чатов; компьютер — список и чат рядом.
await manager.goto(`${BASE}/team-chat/00000000-0000-4000-8000-00000000c0de`, { waitUntil: 'networkidle0' });
const teamLine = await bubble(manager, 'Буду. Пост №3 уже на проверке 👍');
check('team chat shows the author name in colour', teamLine?.side === 'left' && teamLine?.label === 'Ани Саргсян', JSON.stringify(teamLine));
check('team chat header counts members', await waitText(manager, 'участников'));
await manager.setViewport({ width: 1280, height: 800 });
await manager.goto(`${BASE}/chats`, { waitUntil: 'networkidle0' });
check('chat list has order, team and direct chats',
  await waitText(manager, 'Cafe Aroma') && await waitText(manager, 'Общий чат команды') && await waitText(manager, 'Ани Саргсян'));
check('wide screen shows a placeholder until a chat is picked', await waitText(manager, 'Выберите чат'));
await manager.locator('::-p-text(Общий чат команды)').click();
check('picked chat opens next to the list', await waitText(manager, 'Всем доброе утро'));
await manager.screenshot({ path: `${SCREENS}chats-wide.png` });

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
check('employee gets workspace after role is assigned', await waitText(newbie, 'Чаты'));

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

// 3а. Новый клиент: знакомство-разговор с агентами (по вопросу на экран), подарок после знакомства,
// «Ваша команда» и идеи задач от агентов.
const fresh = await openAs(null);
await fresh.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle0' });
const freshInputs = await fresh.$$('input');
await freshInputs[0].type('Нарине Акопян');
await freshInputs[1].type(`pizza${Date.now() % 100000}@demo.am`);
await freshInputs[2].type('secret123');
await fresh.locator('::-p-text(Зарегистрироваться)').click();
check('client signup starts a conversation with Ani, one question per screen',
  await waitText(fresh, 'Я Ани') && (await text(fresh)).includes('Вопрос 1 из 10'));
await fresh.screenshot({ path: `${SCREENS}meet-question.png` });
await fresh.locator('::-p-text(Далее)').click();
check('the business name is required', await waitText(fresh, 'Заполните'));
await fresh.type('textarea, input', 'Pizza Napoli');
await fresh.locator('::-p-text(Далее)').click();
await waitText(fresh, 'Чем вы занимаетесь');
await fresh.locator('::-p-text(Ресторан)').click();
await fresh.locator('::-p-text(Далее)').click();
check('next agent asks the next question', await waitText(fresh, 'Я Арсен') && (await text(fresh)).includes('Вопрос 3 из 10'));
await fresh.locator('::-p-text(Ереван)').click();
await fresh.locator('::-p-text(Далее)').click();
for (let i = 4; i <= 9; i++) {
  await waitText(fresh, `Вопрос ${i} из 10`);
  await fresh.locator('::-p-text(Пропустить)').click();
}
await waitText(fresh, 'Вопрос 10 из 10');
check('scriptwriter Aram asks for example posts', (await text(fresh)).includes('Я Арам'));
await fresh.locator('::-p-text(Пропустить и закончить)').click();
check('after the conversation the client gets a gift from the team', await waitText(fresh, 'Подарок от команды', 15000));
check('gift is shown right away, marked as an unchecked AI draft',
  await waitText(fresh, 'Черновик AI, менеджер ещё не проверял', 15000));
await fresh.locator('::-p-text(Открыть)').click();
check('gift has 3 posts and a weekly content plan',
  await waitText(fresh, 'Знакомьтесь: наш бариста') && (await text(fresh)).includes('Контент-план на неделю') && (await text(fresh)).includes('Воскресенье'));
await fresh.screenshot({ path: `${SCREENS}client-gift.png`, fullPage: true });
await fresh.goto(BASE, { waitUntil: 'networkidle0' });
check('«Your team» shows the agents with honest statuses',
  await waitText(fresh, 'Ваша команда') && (await text(fresh)).includes('Пока без задач') && (await text(fresh)).includes('Лилит'));
check('no «Личный кабинет» link inside the cabinet', !(await text(fresh)).includes('Личный кабинет'));
await fresh.locator('::-p-text(Заказы)').click();
check('empty orders show a hint with a button', await waitText(fresh, 'Здесь появятся ваши заказы'));
await fresh.locator('::-p-text(Главная)').click();
check('agents suggest ideas for the week', await waitText(fresh, 'Пост про осеннее меню', 15000));
await fresh.screenshot({ path: `${SCREENS}client-home-new.png`, fullPage: true });
await (await fresh.$$('::-p-text(Не сейчас)'))[1].click();
check('«Not now» hides the idea', await fresh.waitForFunction(() => !document.body.innerText.includes('Рилс: латте-арт'), { timeout: 5000 }).then(() => true, () => false));
await fresh.locator('::-p-text(Принять)').click();
check('accepting an idea creates an order waiting for payment',
  await waitText(fresh, 'Ждёт оплаты') && fresh.url().includes('/orders/'));

// 4. Клиент выбирает площадки и видит отдельные карточки с ценами.
const client = await openAs('client@demo.am');
await client.goto(`${BASE}/new-order`, { waitUntil: 'networkidle0' });
// Пакеты на месяц — первыми: состав, цена за месяц и выгода против заказа по отдельности.
check('new order starts with monthly packages and shows the saving',
  await waitText(client, '12 постов в месяц') && (await text(client)).includes('Пакет на месяц') && (await text(client)).includes('−14%'));
await client.screenshot({ path: `${SCREENS}new-order-packages.png`, fullPage: true });
await client.locator('::-p-text(12 постов в месяц)').click();
await client.locator('::-p-text(Перейти к оплате)').click();
check('package becomes a monthly order at the package price',
  await waitText(client, 'Пакет «12 постов в месяц»') && (await text(client)).includes('110 000') && (await text(client)).includes('/ мес'));
// Валюта: в профиле выбрали доллары — суммы с «≈ $», а платят в драмах.
const packageOrderUrl = client.url();
await client.goto(`${BASE}/profile`, { waitUntil: 'networkidle0' });
await client.locator('::-p-text(Доллар США)').click();
await new Promise((r) => setTimeout(r, 500));
await client.goto(packageOrderUrl, { waitUntil: 'networkidle0' });
check('prices are shown in the chosen currency, payment stays in drams',
  await waitText(client, 'Оплата в драмах') && /≈ [\d\s,]+ \$/.test(await text(client)) && (await text(client)).includes('110 000'));
await client.goto(`${BASE}/profile`, { waitUntil: 'networkidle0' });
await client.locator('::-p-text(Армянский драм)').click();
await waitText(client, 'Армянский драм');
await client.goto(`${BASE}/new-order`, { waitUntil: 'networkidle0' });
await client.locator('::-p-text(Собрать самому)').click();
await client.locator('::-p-text(Instagram)').click();
await client.locator('::-p-text(Facebook)').click();
const orderText = await text(client);
check('instagram and facebook cards with their own prices',
  orderText.includes('8 000') && orderText.includes('6 000') && orderText.includes('Дополнительно'));
await client.screenshot({ path: `${SCREENS}new-order.png`, fullPage: true });

// 5. Web push: сайт как приложение (манифест для «На экран „Домой“»), service worker
//    и открытие нужного экрана по нажатию на уведомление.
const ORDER = 'e0000000-0000-4000-8000-000000000001';
const pusher = await openAs('manager@demo.am');
const manifestHref = await pusher.evaluate(() => document.querySelector('link[rel="manifest"]')?.href);
const manifest = manifestHref && (await fetch(manifestHref).then((r) => r.json(), () => null));
check('web app manifest is linked', manifest?.display === 'standalone', manifestHref);
check('service worker is served', (await fetch(`${BASE}/sw.js`)).ok);
await pusher.browserContext().overridePermissions(BASE, ['notifications']);
await pusher.goto(`${BASE}/notifications`, { waitUntil: 'networkidle0' });
await pusher.locator('::-p-text(Включить push)').click();
// Без сервиса push в безголовом Chrome подписка может не получиться — важно, что ответ есть.
check('enable push answers with a status',
  await waitText(pusher, 'Включены').then((ok) => ok || waitText(pusher, 'Недоступны', 1000)));
const swScope = await pusher.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
check('service worker registered for the whole site', swScope === `${BASE}/`, swScope);
const tap = encodeURIComponent(JSON.stringify({ kind: 'client_message', order_id: ORDER }));
await pusher.goto(`${BASE}/?push=${tap}`, { waitUntil: 'networkidle0' });
check('notification tap opens the order chat',
  await pusher.waitForFunction((o) => location.pathname === `/orders/${o}/chat`, { timeout: 10000 }, ORDER).then(() => true, () => false),
  await pusher.evaluate(() => location.pathname + location.search));

// 6. Личный кабинет: клиент меняет имя, «о себе», цвет и фото — на главном видно сразу.
const PHOTO = new URL('../../apps/mobile/assets/icon.png', import.meta.url).pathname;
const cabinet = await openAs('client@demo.am');
await cabinet.locator('[aria-label="Личный кабинет"]').click();
check('home header opens the cabinet', await waitText(cabinet, 'Цвет обложки'));
const nameInput = await cabinet.waitForSelector('input[value="Анна Петросян"]');
await nameInput.click({ count: 3 });
await nameInput.type('Анна П.');
await (await cabinet.waitForSelector('textarea')).type('Владелица Cafe Aroma');
await cabinet.locator('::-p-text(Сохранить)').click();
check('name and bio saved', await waitText(cabinet, 'Сохранено'));
await cabinet.locator('[aria-label="#DB2777"]').click();
const [chooser] = await Promise.all([
  cabinet.waitForFileChooser(),
  cabinet.locator('::-p-text(Добавить фото)').click(),
]);
await chooser.accept([PHOTO]);
check('photo uploaded', await waitText(cabinet, 'Сменить фото'));
const avatarSrc = await cabinet.waitForSelector('img[src*="/storage/v1/object/public/avatars/"]').then(
  (img) => img.evaluate((el) => el.src), () => null);
check('photo is served back', avatarSrc && (await fetch(avatarSrc)).ok, avatarSrc);
await cabinet.screenshot({ path: `${SCREENS}cabinet.png`, fullPage: true });
await cabinet.goto(BASE, { waitUntil: 'networkidle0' });
const home = await text(cabinet);
check('home shows new name and bio', home.includes('Анна П.') && home.includes('Владелица Cafe Aroma'));
check('other people cannot upload into my folder',
  (await fetch(`${BASE}/storage/v1/object/avatars/c0000000-0000-4000-8000-000000000001/x.jpg`, {
    method: 'POST', headers: { Authorization: 'Bearer demo:designer@demo.am' }, body: 'x',
  })).status === 403);
await cabinet.screenshot({ path: `${SCREENS}home-client.png` });

// 7. Панель владельца и доска задач.
const owner = await openAs('admin@demo.am');
check('home has the owner dashboard button', await waitText(owner, 'Панель владельца'));
await owner.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' });
check('owner sees revenue this month', await waitText(owner, 'Прошлый месяц') && (await text(owner)).includes('63 000'));
check('dashboard shows team workload and overdue tasks',
  await waitText(owner, 'Нагрузка команды') && (await text(owner)).includes('Ани Саргсян') &&
  await waitText(owner, 'Просроченные задачи') && (await text(owner)).includes('просрочено ·'));
await owner.screenshot({ path: `${SCREENS}dashboard.png`, fullPage: true });
const boss = await openAs('manager@demo.am');
await boss.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle0' });
check('manager sees the dashboard without money', await waitText(boss, 'Нагрузка команды') && !(await text(boss)).includes('Прошлый месяц'));
await boss.setViewport({ width: 1400, height: 820 });
await boss.goto(`${BASE}/board`, { waitUntil: 'networkidle0' });
check('board shows columns with tasks', await waitText(boss, 'На проверке') && await waitText(boss, 'Опубликовано') && (await text(boss)).includes('TikTok'));
await boss.screenshot({ path: `${SCREENS}board-wide.png` });
await boss.locator('::-p-text(🔴 Просроченные)').click();
check('overdue filter leaves only overdue tasks',
  await boss.waitForFunction(() => !document.body.innerText.includes('TikTok'), { timeout: 5000 }).then(() => true, () => false) &&
  (await text(boss)).includes('Facebook'));
const worker = await openAs('designer@demo.am');
await worker.goto(`${BASE}/board`, { waitUntil: 'networkidle0' });
check('employee board shows only own tasks', await waitText(worker, 'Facebook') && !(await text(worker)).includes('TikTok'));
await worker.screenshot({ path: `${SCREENS}board-phone.png` });

// 7б. Согласование «как в Instagram»: превью, точка правки, «Одобрить всё», сетка;
//     промокод в заказе, квитанция; настройки владельца.
const reviewer = await openAs('client@demo.am');
check('home shows how many materials wait', await waitText(reviewer, 'Ждут вашего согласования: 3'));
await reviewer.locator('::-p-text(Ждут вашего согласования)').click();
check('approvals screen: approve all and auto-approval deadline',
  await waitText(reviewer, 'Одобрить всё (3)') && (await text(reviewer)).includes('Одобрится автоматически'));
check('every material shows it was checked by a human, with the manager name',
  (await text(reviewer)).split('Проверено человеком · Нарек').length - 1 === 3);
check('previews show the material images', await reviewer.waitForFunction(
  () => [...document.images].filter((i) => i.src.includes('deliverables') && i.naturalWidth > 0).length >= 3,
  { timeout: 8000 }).then(() => true, () => false));
await reviewer.screenshot({ path: `${SCREENS}approvals.png`, fullPage: true });
await reviewer.locator('::-p-text(Попросить правки)').click();
await waitText(reviewer, 'Нажмите на место в кадре');
// Кадр — в центр экрана, чтобы точку не накрыло нижнее меню.
const frameImg = await reviewer.$('img[src*="deliverables"]');
await frameImg.evaluate((el) => el.scrollIntoView({ block: 'center' }));
const frame = await frameImg.boundingBox();
await reviewer.mouse.click(frame.x + frame.width * 0.3, frame.y + frame.height * 0.6);
await reviewer.waitForSelector('textarea[placeholder="Что поменять в этом месте?"]');
await reviewer.type('textarea[placeholder="Что поменять в этом месте?"]', 'Логотип крупнее');
await reviewer.screenshot({ path: `${SCREENS}approval-mark.png`, fullPage: true });
await reviewer.locator('::-p-text(Отправить правки)').click();
check('changes with a pin sent, two materials left', await waitText(reviewer, 'Одобрить всё (2)'));
await reviewer.locator('::-p-text(Одобрить всё (2))').click();
await reviewer.locator('::-p-text(Точно одобрить все 2?)').click();
check('approve all leaves nothing waiting, with a hint and a button', await waitText(reviewer, 'Сейчас нечего согласовывать') && (await text(reviewer)).includes('На главную'));
await reviewer.locator('::-p-text(Сетка профиля)').click();
check('profile grid shows approved upcoming and published posts',
  await waitText(reviewer, 'одобрено') && (await reviewer.$$('img[src*="deliverables"]')).length >= 2);
await reviewer.screenshot({ path: `${SCREENS}approvals-grid.png` });

const team = await openAs('designer@demo.am');
await team.goto(`${BASE}/tasks/t0000000-0000-4000-8000-000000000002`, { waitUntil: 'networkidle0' });
check('team sees the pin and the note on the material',
  await waitText(team, 'Ответ клиента') && (await text(team)).includes('📍 1 — Логотип крупнее') &&
  (await text(team)).includes('Как увидит клиент'));
await team.screenshot({ path: `${SCREENS}task-marks.png`, fullPage: true });
await team.locator('::-p-text(Разобрать задачу)').click();
check('employee assistant breaks down the task', await waitText(team, 'Суть задачи'));
await team.goto(BASE, { waitUntil: 'networkidle0' });
await team.locator('::-p-text(Составить план на день)').click();
check('employee assistant plans the day', await waitText(team, 'Главное сейчас'));
await team.screenshot({ path: `${SCREENS}assistant-day.png`, fullPage: true });
const clientView = await openAs('client@demo.am');
await waitText(clientView, 'Ваша команда');
// Нижнее меню: у клиента пять вкладок, без доски и агентов команды.
const tabs = async (page) => page.$$eval('[role="tab"], a[role="link"][href]', (els) => els.map((e) => e.textContent.trim()));
const clientTabs = await tabs(clientView);
check('client has a bottom menu: home, orders, approvals, chats, profile',
  ['Главная', 'Заказы', 'Одобрить', 'Чаты', 'Профиль'].every((n) => clientTabs.some((x) => x.includes(n))) &&
  !clientTabs.some((x) => x.includes('Доска') || x.includes('Агенты')), JSON.stringify(clientTabs));
check('client does not see the employee assistant', !(await text(clientView)).includes('Мой день'));
check('client does not see AI agents', !(await text(clientView)).includes('AI-агенты'));
check('client sees calm achievements: weeks in a row and published posts',
  await waitText(clientView, 'Ваши успехи') && (await text(clientView)).includes('Вышло публикаций') &&
  (await text(clientView)).includes('Следующая цель'));

// Профиль бизнеса («мозг» агентов): одна карточка на главной ведёт в профиль; бренд — логотип и цвета.
check('business card shows how full the profile is', (await text(clientView)).includes('Профиль заполнен на'));
check('no separate «My business» link on the client home', !(await text(clientView)).includes('Мой бизнес'));
await clientView.locator('::-p-text(Дополнить профиль)').click();
check('business card opens the profile with the brand section',
  await waitText(clientView, 'Фирменные цвета') && (await text(clientView)).includes('#7A4B2A'));
await clientView.locator('[aria-label="#2563EB"]').click();
const [logoChooser] = await Promise.all([
  clientView.waitForFileChooser(),
  clientView.locator('::-p-text(Загрузить логотип)').click(),
]);
await logoChooser.accept([new URL('../../apps/mobile/assets/icon.png', import.meta.url).pathname]);
check('logo is uploaded and shown', await clientView.waitForSelector('img[src*="/object/public/brand/"]', { timeout: 9000 }).then(() => true, () => false));
await clientView.locator('::-p-text(Сохранить)').click();
await waitText(clientView, 'Ваша команда');
await clientView.screenshot({ path: `${SCREENS}client-home-business.png`, fullPage: true });
await clientView.goto(`${BASE}/business`, { waitUntil: 'networkidle0' });
check('brand color and logo are saved',
  await waitText(clientView, '#2563EB') &&
  await clientView.waitForSelector('img[src*="/object/public/brand/"]', { timeout: 5000 }).then(() => true, () => false));
await clientView.goto(BASE, { waitUntil: 'networkidle0' });

// AI-агенты: пишем дизайнеру своими словами → «Отправить» → картинка сразу в чате → в задачу.
const agentBoss = await openAs('manager@demo.am');
const bossTabs = await tabs(agentBoss);
check('manager has a bottom menu: home, board, chats, agents, profile',
  ['Главная', 'Доска', 'Чаты', 'Агенты', 'Профиль'].every((n) => bossTabs.some((x) => x.includes(n))) &&
  !bossTabs.some((x) => x.includes('Одобрить')), JSON.stringify(bossTabs));
check('empty sections fold into compact counters', /· 0/.test(await text(agentBoss)));
await agentBoss.locator('::-p-text(Профиль)').click();
check('profile tab lists the rare screens as rows with arrows',
  await waitText(agentBoss, 'Услуги и цены') && (await text(agentBoss)).includes('Команда') && (await text(agentBoss)).includes('Выйти'));
await agentBoss.locator('::-p-text(Агенты)').click();
await waitText(agentBoss, 'AI-менеджер');
await agentBoss.locator('::-p-text(Лилит)').click();
await waitText(agentBoss, 'Что сделать?');
// Вкладки остаются в памяти (например, «О себе» в профиле) — пишем именно в поле чата агента.
await agentBoss.type('textarea[placeholder="Напишите задачу своими словами…"]', 'Создай дизайн, где стоит человек, фон — море');
await agentBoss.locator('::-p-text(➤ Отправить)').click();
check('AI designer answers in the chat with an image',
  await waitText(agentBoss, 'Демо', 15000) &&
  await agentBoss.waitForSelector('img[src*="agent-files"]', { timeout: 5000 }).then(() => true, () => false));
check('chat shows the request as typed', (await text(agentBoss)).includes('Создай дизайн, где стоит человек, фон — море'));
await agentBoss.screenshot({ path: `${SCREENS}agent-chat-designer.png`, fullPage: true });
await agentBoss.locator('::-p-text(📌 В задачу…)').click();
await waitText(agentBoss, 'Отправить в задачу на проверку');
await agentBoss.waitForSelector('[role="radio"]');
await (await firstVisible(agentBoss, '[role="radio"]')).click();
await agentBoss.locator('::-p-text(Отправить на проверку)').click();
check('chat result goes to a task', await waitText(agentBoss, 'Отправлено в задачу'));
await agentBoss.locator('::-p-text(Отправлено в задачу)').click();
check('task shows the AI version for review',
  await waitText(agentBoss, 'Версию сделал AI-агент: Лилит · Дизайнер') && (await text(agentBoss)).includes('На проверке'));
await agentBoss.screenshot({ path: `${SCREENS}agent-task.png`, fullPage: true });

// Копирайтер: пример запроса одним нажатием → текст в чате.
// Старая ссылка на копирайтера ведёт к Ани (SMM): копирайтер объединён с ней.
await agentBoss.goto(`${BASE}/agents/copywriter`, { waitUntil: 'networkidle0' });
check('old copywriter link opens Ani (SMM)', await waitText(agentBoss, 'Ани · SMM'));
await agentBoss.locator('::-p-text(Напиши пост для кофейни про осеннее меню)').click();
await agentBoss.locator('::-p-text(➤ Отправить)').click();
check('AI SMM answers with text', await waitText(agentBoss, '#CafeAroma', 15000));

// Менеджер-агент: план по заказу применяется только кнопкой.
await agentBoss.goto(`${BASE}/agents/manager`, { waitUntil: 'networkidle0' });
await waitText(agentBoss, 'Выберите заказ');
await (await firstVisible(agentBoss, '[role="radio"]')).click();
await agentBoss.locator('::-p-text(🤖 Запустить)').click();
check('AI manager prepares a plan', await waitText(agentBoss, 'Применить план', 15000) && (await text(agentBoss)).includes('Демо-бриф'));
await agentBoss.locator('::-p-text(Применить план)').click();
check('manager applies the plan', await waitText(agentBoss, 'План применён'));
await agentBoss.screenshot({ path: `${SCREENS}agent-manager.png`, fullPage: true });

// Сотрудник видит только свои задачи и не видит AI-менеджера.
await team.goto(`${BASE}/agents`, { waitUntil: 'networkidle0' });
check('employee sees role agents but not the AI manager',
  await waitText(team, 'Сценарист') && (await text(team)).includes('Ани') && !(await text(team)).includes('AI-менеджер'));

await reviewer.goto(`${BASE}/new-order`, { waitUntil: 'networkidle0' });
await reviewer.locator('::-p-text(Собрать самому)').click();
await reviewer.locator('::-p-text(Instagram)').click();
await reviewer.locator('[aria-label="+"]').click();
await reviewer.type('input[placeholder="AUTUMN10"]', 'autumn10');
await reviewer.locator('::-p-text(Применить)').click();
check('promo code gives a discount before payment',
  await waitText(reviewer, 'скидка 10%') && (await text(reviewer)).includes('−800'));
await reviewer.screenshot({ path: `${SCREENS}new-order-promo.png`, fullPage: true });
await reviewer.locator('::-p-text(Убрать)').click();
await reviewer.type('input[placeholder="AUTUMN10"]', 'NOPE');
await reviewer.locator('::-p-text(Применить)').click();
check('unknown promo code is explained', await waitText(reviewer, 'Такого промокода нет'));

await reviewer.goto(`${BASE}/receipts`, { waitUntil: 'networkidle0' });
await reviewer.locator('::-p-text(Квитанция № 1)').click();
check('receipt shows what was paid', await waitText(reviewer, 'Сохранить PDF') && (await text(reviewer)).includes('63 000') &&
  (await text(reviewer)).includes('Idram'));
await reviewer.screenshot({ path: `${SCREENS}receipt.png`, fullPage: true });

await owner.goto(`${BASE}/services`, { waitUntil: 'networkidle0' });
check('owner manages auto-approval and promo codes',
  await waitText(owner, 'Автоодобрение') && await waitText(owner, 'AUTUMN10') && (await text(owner)).includes('использован 3 из 50'));
check('owner manages monthly packages and exchange rates',
  (await text(owner)).includes('Пакеты на месяц') && (await text(owner)).includes('Курсы валют'));

// 7в. Видимость в поиске и соцсетях: публичная главная — готовый HTML без JavaScript,
//     нормальные title и описание, Open Graph для превью ссылки.
const rawHtml = await (await fetch(`${BASE}/`)).text();
check('page has a real title and description instead of «Marketing»',
  /<title>Продвижение в Instagram, Facebook и TikTok с AI-командой[^<]*<\/title>/.test(rawHtml) &&
  /<meta name="description" content="Посты, сторис, рилсы/.test(rawHtml));
check('Open Graph and Twitter tags for link previews',
  ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card'].every((tag) => rawHtml.includes(`"${tag}"`)) &&
  rawHtml.includes('og-image.jpg'));
check('public home text is in the HTML itself, without JavaScript',
  rawHtml.includes('Как это работает') && rawHtml.includes('Проверено человеком') && rawHtml.includes('href="sign-up"') &&
  rawHtml.includes('lang="hy"') && rawHtml.includes('<html lang="ru"'));
const ogImage = await fetch(`${BASE}/og-image.jpg`);
check('link preview image is served', ogImage.ok && (await ogImage.arrayBuffer()).byteLength > 10000);
const visitor = await openAs(null);
check('with JavaScript the app replaces the static page and shows the same intro on the sign-in screen',
  await waitText(visitor, 'Как это работает') && (await text(visitor)).includes('Войти') &&
  !(await visitor.evaluate(() => !!document.querySelector('.home'))));
await visitor.screenshot({ path: `${SCREENS}public-home.png`, fullPage: true });

// 7г. Роль «Сотрудник»: должность вместо роли, только свои задачи, без AI-агентов и заказов.
// Демо-данные сначала: выше AI-менеджер перераспределяет задачи.
await fetch(`${BASE}/__reset`);
await new Promise((r) => setTimeout(r, 2000));
const employee = await openAs('employee@demo.am');
check('employee sees the job title and own task',
  await waitText(employee, 'Instagram · Пост #4') && (await text(employee)).includes('Фотограф'));
const employeeHome = await text(employee);
check('employee has no AI agents tab and no other people tasks',
  !employeeHome.includes('Агенты') && !employeeHome.includes('TikTok') && !employeeHome.includes('Пост #3'));
await employee.locator('::-p-text(Instagram · Пост #4)').click();
check('employee opens own task with the brief',
  await waitText(employee, 'Фото десертов на витрине') && !(await text(employee)).includes('Поручить AI-агенту'));
await employee.screenshot({ path: `${SCREENS}employee-task.png`, fullPage: true });

// 8. Вход сохранён, а пользователя на сервере больше нет (сброс демо) → экран входа, не ошибка.
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
