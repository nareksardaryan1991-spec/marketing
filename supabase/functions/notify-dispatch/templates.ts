type Lang = 'ru' | 'hy' | 'en';
type Vars = Record<string, string>;
type Template = (v: Vars) => string;

const T: Record<string, Record<Lang, Template>> = {
  task_assigned: {
    ru: (v) => `Новая задача: ${v.service} #${v.number} — ${v.business}`,
    hy: (v) => `Նոր առաջադրանք՝ ${v.service} #${v.number} — ${v.business}`,
    en: (v) => `New task: ${v.service} #${v.number} — ${v.business}`,
  },
  task_review: {
    ru: (v) => `На проверку: ${v.service} #${v.number} — ${v.business}`,
    hy: (v) => `Ստուգման համար՝ ${v.service} #${v.number} — ${v.business}`,
    en: (v) => `Ready for review: ${v.service} #${v.number} — ${v.business}`,
  },
  task_returned: {
    ru: (v) => `Задачу вернули на доработку: ${v.service} #${v.number} — ${v.business}`,
    hy: (v) => `Առաջադրանքը վերադարձվել է լրամշակման՝ ${v.service} #${v.number} — ${v.business}`,
    en: (v) => `Task returned for rework: ${v.service} #${v.number} — ${v.business}`,
  },
  client_review: {
    ru: (v) => `Готово к согласованию: ${v.service} #${v.number}. Откройте приложение, чтобы одобрить или попросить правки.`,
    hy: (v) => `Պատրաստ է հաստատման՝ ${v.service} #${v.number}։ Բացեք հավելվածը՝ հաստատելու կամ ուղղումներ խնդրելու համար։`,
    en: (v) => `Ready for your approval: ${v.service} #${v.number}. Open the app to approve or request changes.`,
  },
  client_approved: {
    ru: (v) => `Клиент одобрил: ${v.service} #${v.number} — ${v.business}`,
    hy: (v) => `Հաճախորդը հաստատեց՝ ${v.service} #${v.number} — ${v.business}`,
    en: (v) => `Client approved: ${v.service} #${v.number} — ${v.business}`,
  },
  client_changes: {
    ru: (v) => `Клиент просит правки: ${v.service} #${v.number} — ${v.business}\n«${v.comment}»`,
    hy: (v) => `Հաճախորդը ուղղումներ է խնդրում՝ ${v.service} #${v.number} — ${v.business}\n«${v.comment}»`,
    en: (v) => `Client requested changes: ${v.service} #${v.number} — ${v.business}\n"${v.comment}"`,
  },
  client_message: {
    ru: (v) => `Сообщение от клиента ${v.business} (${v.author}):\n${v.preview}`,
    hy: (v) => `Հաղորդագրություն ${v.business} հաճախորդից (${v.author})՝\n${v.preview}`,
    en: (v) => `Message from client ${v.business} (${v.author}):\n${v.preview}`,
  },
  team_message: {
    ru: (v) => `Сообщение от команды (${v.author}):\n${v.preview}`,
    hy: (v) => `Հաղորդագրություն թիմից (${v.author})՝\n${v.preview}`,
    en: (v) => `Message from the team (${v.author}):\n${v.preview}`,
  },
  publish_due: {
    ru: (v) => `Пора публиковать: ${v.service} #${v.number} — ${v.business}`,
    hy: (v) => `Ժամանակն է հրապարակել՝ ${v.service} #${v.number} — ${v.business}`,
    en: (v) => `Time to publish: ${v.service} #${v.number} — ${v.business}`,
  },
  task_published: {
    ru: (v) => `Опубликовано: ${v.service} #${v.number}${v.url ? `\n${v.url}` : ''}`,
    hy: (v) => `Հրապարակված է՝ ${v.service} #${v.number}${v.url ? `\n${v.url}` : ''}`,
    en: (v) => `Published: ${v.service} #${v.number}${v.url ? `\n${v.url}` : ''}`,
  },
  renewal_due: {
    ru: (v) => `Прошёл месяц — пора продлить пакет для ${v.business}. Откройте заказ и нажмите «Повторить заказ».`,
    hy: (v) => `Անցել է մեկ ամիս․ ժամանակն է երկարացնել ${v.business}-ի փաթեթը։ Բացեք պատվերը և սեղմեք «Կրկնել պատվերը»։`,
    en: (v) => `A month has passed — time to renew the package for ${v.business}. Open the order and tap "Repeat order".`,
  },
  publish_failed: {
    ru: (v) => `Не удалось опубликовать в Instagram: ${v.service} #${v.number} — ${v.business}\n${v.error}\nОпубликуйте вручную или исправьте файлы и перенесите дату.`,
    hy: (v) => `Չհաջողվեց հրապարակել Instagram-ում՝ ${v.service} #${v.number} — ${v.business}\n${v.error}\nՀրապարակեք ձեռքով կամ ուղղեք ֆայլերը և փոխեք ամսաթիվը։`,
    en: (v) => `Instagram publishing failed: ${v.service} #${v.number} — ${v.business}\n${v.error}\nPublish manually, or fix the files and reschedule.`,
  },
  team_chat_message: {
    ru: (v) => `${v.channel === 'team' ? 'Чат команды — ' : ''}${v.author}:\n${v.preview}`,
    hy: (v) => `${v.channel === 'team' ? 'Թիմի չատ — ' : ''}${v.author}՝\n${v.preview}`,
    en: (v) => `${v.channel === 'team' ? 'Team chat — ' : ''}${v.author}:\n${v.preview}`,
  },
  staff_signup: {
    ru: (v) => `Новый сотрудник ждёт роль: ${v.name} (${v.email}). Назначьте роль на экране «Команда».`,
    hy: (v) => `Նոր աշխատակիցը սպասում է դերի՝ ${v.name} (${v.email})։ Նշանակեք դերը «Թիմ» էկրանին։`,
    en: (v) => `A new employee is waiting for a role: ${v.name} (${v.email}). Assign it on the Team screen.`,
  },
};

export function renderNotification(kind: string, language: string, vars: Vars): string | null {
  const templates = T[kind];
  if (!templates) return null;
  const lang = (['ru', 'hy', 'en'].includes(language) ? language : 'ru') as Lang;
  return templates[lang](vars);
}

export const TELEGRAM_TEXTS: Record<'linked' | 'howTo', Record<Lang, string>> = {
  linked: {
    ru: 'Готово! Уведомления будут приходить сюда.',
    hy: 'Պատրաստ է։ Ծանուցումները կգան այստեղ։',
    en: 'Done! Notifications will arrive here.',
  },
  howTo: {
    ru: 'Чтобы получать уведомления, откройте приложение → «Уведомления» → «Подключить Telegram».',
    hy: 'Ծանուցումներ ստանալու համար բացեք հավելվածը → «Ծանուցումներ» → «Միացնել Telegram»։',
    en: 'To get notifications, open the app → "Notifications" → "Connect Telegram".',
  },
};
