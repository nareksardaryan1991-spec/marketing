#!/usr/bin/env python3
"""Просмотровый сервер: собранное веб-приложение + поддельный Supabase с демо-данными.

Нужен, чтобы посмотреть приложение без Docker и без облака. Работает только на этом
компьютере (127.0.0.1). Сообщения в чатах (с файлами, реакциями, правками) и личный кабинет сохраняются в памяти,
пока сервер запущен; одобрение и правки клиента, промокоды и настройки — тоже.
Остальные действия (оплата, назначение) не сохраняются.

Запуск: ./scripts/preview.sh  (или python3 scripts/preview/mock_server.py <папка сборки> <порт>)
Вход: client@demo.am / manager@demo.am / designer@demo.am / freelancer@demo.am / employee@demo.am, пароль demo1234.
"""
import http.server
import json
import threading
import os
import re
import sys
import time
import struct
import urllib.parse
import zlib
from datetime import datetime, timedelta, timezone

ROOT = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8081
PASSWORD = 'demo1234'

NOW = datetime.now(timezone.utc)


def iso(d):
    return d.isoformat()


def day(n, h=10):
    return iso((NOW + timedelta(days=n)).replace(hour=h, minute=0, second=0, microsecond=0))


# Сообщения «сегодня» — относительно текущего часа: иначе ранним утром (до 10:00 UTC) они
# оказывались в будущем и чат никогда не считался прочитанным.
def hours_ago(h):
    return iso((NOW - timedelta(hours=h)).replace(second=0, microsecond=0))


def now_iso():
    return iso(datetime.now(timezone.utc))


# Демо-заказ оплачен в этом месяце (иначе в первые дни месяца выручка «пропадает» из панели).
PAID_AT = max(day(-10), iso(NOW.replace(day=1, hour=0, minute=0, second=0, microsecond=0)))


# ---------- Люди ----------
CLIENT = 'c0000000-0000-4000-8000-000000000001'
MANAGER = 'a0000000-0000-4000-8000-000000000002'
DESIGNER = 'd0000000-0000-4000-8000-000000000003'
FREELANCER = 'f0000000-0000-4000-8000-000000000004'
EMPLOYEE = 'e7000000-0000-4000-8000-000000000007'


def person(pid, name, email, role):
    return {'id': pid, 'full_name': name, 'email': email, 'role': role, 'language': 'ru',
            'phone': None, 'job_title': None, 'avatar_path': None, 'cover_path': None, 'accent_color': None, 'bio': None,
            'last_seen_at': None, 'chat_wallpaper': None, 'currency': 'AMD', 'created_at': day(-40)}


ADMIN = 'ad000000-0000-4000-8000-000000000005'
NEWBIE = 'ab000000-0000-4000-8000-000000000006'
PROFILES = {
    'admin@demo.am': person(ADMIN, 'Арам Владелец', 'admin@demo.am', 'admin'),
    'newbie@demo.am': person(NEWBIE, 'Лусине Мартиросян', 'newbie@demo.am', 'pending'),
    'client@demo.am': person(CLIENT, 'Анна Петросян', 'client@demo.am', 'client'),
    'manager@demo.am': person(MANAGER, 'Нарек', 'manager@demo.am', 'manager'),
    'designer@demo.am': person(DESIGNER, 'Ани Саргсян', 'designer@demo.am', 'designer'),
    'freelancer@demo.am': person(FREELANCER, 'Давид Акопян', 'freelancer@demo.am', 'freelancer'),
    'employee@demo.am': {**person(EMPLOYEE, 'Гор Мкртчян', 'employee@demo.am', 'employee'), 'job_title': 'Фотограф'},
}
PASSWORDS = {email: PASSWORD for email in PROFILES}
# Не вошедший зритель: ничего не видит.
PENDING_ANON = person('00000000-0000-4000-8000-000000000000', '', '', 'pending')


def by_id(user_id):
    return next((p for p in PROFILES.values() if p['id'] == user_id), None)


def is_employee(role):
    return role not in ('client', 'pending')


def is_team(role):
    return role not in ('client', 'pending', 'freelancer', 'employee')


# Видят только свои задачи (сотрудник — ещё и без заказов).
def own_tasks_only(role):
    return role in ('freelancer', 'employee')


def is_manager(role):
    return role in ('manager', 'admin')

# Фото из личного кабинета (bucket avatars): путь -> (тип, байты). Живут, пока сервер запущен.
PHOTOS = {}
PROFILE_FIELDS = ('full_name', 'phone', 'language', 'avatar_path', 'cover_path', 'accent_color', 'bio',
                  'chat_wallpaper', 'currency')

# Кто делает текущий запрос — определяется по токену входа (у каждого окна свой).
REQUEST = threading.local()


def me():
    return PROFILES.get(getattr(REQUEST, 'email', None)) or PENDING_ANON


# ---------- Бизнес, услуги, заказ ----------
BIZ = 'b0000000-0000-4000-8000-000000000001'
ORDER = 'e0000000-0000-4000-8000-000000000001'
BUSINESSES = []
BUSINESS = {
    'id': BIZ, 'owner_id': CLIENT, 'name': 'Cafe Aroma', 'industry': 'Кофейня', 'city': 'Ереван',
    'description': 'Кофейня в центре: авторский кофе и десерты',
    'target_audience': 'Студенты и офисные сотрудники 20–35 лет', 'tone': 'Дружелюбный, с юмором',
    'goals': 'Больше гостей по утрам, рост подписчиков', 'competitors': 'Coffeeshop Company',
    'instagram_url': 'https://instagram.com/cafe_aroma', 'facebook_url': None, 'tiktok_url': None,
    'website_url': None, 'example_posts': 'Осень в каждой чашке 🍂 Тыквенный латте вернулся — тёплый, пряный, как вы любили. Ждём вас утром на Абовяна 12! #CafeAroma #Ереван',
    'brand_colors': ['#7A4B2A', '#F2C14E'], 'logo_path': None, 'onboarded_at': day(-40),
    'created_at': day(-40), 'updated_at': day(-2),
}


BUSINESSES.append(BUSINESS)
# Логотипы бизнесов (bucket brand): путь -> (тип, байты).
BRAND_FILES = {}


def can_edit_business(business_id):
    profile = me()
    business = next((b for b in BUSINESSES if b['id'] == business_id), None)
    return bool(profile and business and (business['owner_id'] == profile['id'] or is_manager(profile['role'])))


def service(sid, ru, hy, en, desc, price, order):
    return {'id': sid, 'name': {'ru': ru, 'hy': hy, 'en': en}, 'description': {'ru': desc},
            'price_amd': price, 'sort_order': order, 'active': True,
            'per_platform': sid in ('post', 'reel', 'story')}


SERVICES = [
    service('post', 'Пост', 'Գրառում', 'Post', 'Фото или дизайн + текст', 8000, 10),
    service('reel', 'Рилс', 'Ռիլս', 'Reel', 'Короткое вертикальное видео', 25000, 20),
    service('story', 'История', 'Սթորի', 'Story', 'Сторис для Instagram / Facebook', 4000, 30),
    service('ads_management', 'Настройка рекламы', 'Գովազդի կարգավորում', 'Ad campaign setup',
            'Запуск и ведение таргетированной рекламы', 30000, 40),
    service('video_shoot', 'Выезд на съёмку', 'Նկարահանում տեղում', 'On-site shoot',
            'Наш видеограф приезжает и снимает', 40000, 50),
]
SVC = {s['id']: {'name': s['name']} for s in SERVICES}

PLATFORMS = [
    {'id': 'instagram', 'name': 'Instagram', 'sort_order': 10, 'active': True},
    {'id': 'facebook', 'name': 'Facebook', 'sort_order': 20, 'active': True},
    {'id': 'tiktok', 'name': 'TikTok', 'sort_order': 30, 'active': True},
]
PLATFORM_SERVICES = [
    {'platform_id': p, 'service_id': sv, 'price_amd': price, 'label': label, 'active': True}
    for p, sv, price, label in [
        ('instagram', 'post', 8000, None), ('instagram', 'story', 4000, None), ('instagram', 'reel', 25000, None),
        ('facebook', 'post', 6000, None), ('facebook', 'story', 3000, None), ('facebook', 'reel', 20000, None),
        ('tiktok', 'reel', 25000, {'ru': 'Видео', 'hy': 'Տեսանյութ', 'en': 'Video'}),
    ]
]

ORDERS = [{
    'id': ORDER, 'business_id': BIZ, 'client_id': CLIENT, 'billing': 'monthly', 'publishing': 'team',
    'status': 'in_progress', 'items_total_amd': 63000, 'ad_budget_amd': 0, 'total_amd': 63000,
    'notes': 'Осеннее меню, акцент на тыквенный латте', 'paid_at': PAID_AT, 'created_at': day(-10),
    'promo_code': None, 'discount_amd': 0,
}]
def item(iid, order_id, sid, platform, qty, price):
    return {'id': iid, 'order_id': order_id, 'service_id': sid, 'platform_id': platform, 'quantity': qty,
            'unit_price_amd': price, 'line_total_amd': qty * price, 'services': SVC[sid]}


ITEMS = [
    item('i1', ORDER, 'post', 'instagram', 3, 8000),
    item('i2', ORDER, 'story', 'instagram', 2, 4000),
    item('i3', ORDER, 'post', 'facebook', 1, 6000),
    item('i4', ORDER, 'reel', 'tiktok', 1, 25000),
]


def demo_png(width, height, top, bottom):
    """Однотонная картинка с плавным переходом цвета — вместо настоящих фото в просмотре."""
    rows = b''.join(
        b'\x00' + bytes(round(top[c] + (bottom[c] - top[c]) * y / height) for c in range(3)) * width
        for y in range(height))
    chunk = lambda kind, data: struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


# Файлы материалов (bucket deliverables): путь -> PNG.
DELIVERABLE_FILES = {}
DEMO_COLORS = [((251, 191, 36), (194, 65, 12)), ((167, 139, 250), (67, 56, 202)),
               ((110, 231, 183), (4, 120, 87)), ((253, 164, 175), (190, 18, 60))]


def task(n, platform, svc, num, status, assignee=None, publish=None, due=None, brief=None, url=None, caption=None):
    tid = 't0000000-0000-4000-8000-%012d' % n
    deliverables = []
    if caption:
        files = []
        for i in range(2 if svc == 'post' else 1):
            path = '%s/%d-demo-%d.png' % (tid, n, i + 1)
            top, bottom = DEMO_COLORS[(n + i) % len(DEMO_COLORS)]
            DELIVERABLE_FILES[path] = demo_png(80, 100 if svc == 'post' else 142, top, bottom)
            files.append(path)
        deliverables.append({
            'id': 'v%d' % n, 'task_id': tid, 'version': 1, 'caption': caption, 'files': files, 'note': None,
            'created_by': DESIGNER, 'created_at': day(-1),
            'sent_to_client_at': day(-1) if status in ('client_review', 'approved', 'published') else None,
            # Проверил менеджер Нарек — значок «Проверено человеком».
            'reviewer_name': 'Нарек' if status in ('client_review', 'approved', 'published') else None,
        })
    return {
        'id': tid, 'order_id': ORDER, 'business_id': BIZ, 'service_id': svc, 'platform_id': platform,
        'number': num, 'status': status,
        'assignee_id': assignee, 'due_date': due, 'brief': brief, 'publish_at': publish,
        'published_at': publish if status == 'published' else None, 'published_url': url,
        'publish_error': None, 'autopublish_state': {}, 'created_at': day(-10), 'updated_at': day(-1),
        'client_review_since': day(-1) if status == 'client_review' else None,
        'services': SVC[svc], 'businesses': BUSINESS, 'orders': {'notes': ORDERS[0]['notes'], 'publishing': 'team'},
        'deliverables': deliverables,
        'kind': 'order', 'title': None, 'priority': 'normal', 'attachments': [], 'created_by': None, 'related_order_id': None,
    }


# Задача команды (поручение человеку): без заказа, услуги и номера; клиент — необязательно.
def team_task(n, title, status, assignee, priority='normal', due=None, brief=None, business=None, caption=None,
              creator=MANAGER):
    tid = 't1000000-0000-4000-8000-%012d' % n
    deliverables = [{
        'id': 'tv%d' % n, 'task_id': tid, 'version': 1, 'caption': caption, 'files': [], 'note': None,
        'created_by': assignee, 'created_at': day(-1), 'sent_to_client_at': None, 'reviewer_name': None,
    }] if caption else []
    return {
        'id': tid, 'kind': 'team', 'title': title, 'priority': priority, 'attachments': [], 'created_by': creator,
        'related_order_id': None, 'order_id': None, 'business_id': business['id'] if business else None,
        'service_id': None, 'platform_id': None, 'number': None, 'status': status, 'assignee_id': assignee,
        'due_date': due, 'brief': brief, 'publish_at': None, 'published_at': None, 'published_url': None,
        'publish_error': None, 'autopublish_state': {}, 'created_at': day(-3), 'updated_at': day(-1),
        'client_review_since': None, 'services': None, 'businesses': business, 'orders': None,
        'deliverables': deliverables, 'from_agent_run_id': None, 'draft_agent': None, 'reviewer_id': creator,
    }


TASKS = [
    task(1, 'instagram', 'post', 1, 'published', DESIGNER, day(-5, 12), url='https://instagram.com/p/demo-aroma-1',
         caption='Доброе утро начинается с Cafe Aroma ☕ Заходите на Абовяна 12 — первые 10 гостей получат круассан в подарок!'),
    task(2, 'instagram', 'post', 2, 'client_review', DESIGNER, day(2, 19), day(1)[:10],
         'Тыквенный латте: уютная осенняя подача, цена 1 800 ֏',
         caption='Осень пришла — и тыквенный латте вернулся! 🎃☕\nНежная пряная пенка, корица и немного магии. '
                 'Всего 1 800 ֏.\nЖдём вас на Абовяна 12 🍪\n\n#CafeAroma #Ереван #кофе #осень'),
    task(3, 'instagram', 'post', 3, 'internal_review', DESIGNER, due=day(2)[:10], brief='Новый десерт: чизкейк с солёной карамелью',
         caption='Солёная карамель + нежный чизкейк = идеальная пара к вашему капучино 🍰'),
    task(4, 'facebook', 'post', 1, 'in_progress', DESIGNER, due=day(-2)[:10], brief='Утренний кофе с собой: скидка 10% до 10:00'),
    task(5, 'tiktok', 'reel', 1, 'assigned', FREELANCER, due=day(1)[:10], brief='Процесс приготовления латте-арта, 15–20 секунд'),
    task(6, 'instagram', 'story', 1, 'approved', DESIGNER, day(1, 10), caption='Опрос: тыквенный латте или раф с карамелью? 🗳'),
    task(7, 'instagram', 'story', 2, 'new'),
    task(8, 'instagram', 'reel', 1, 'client_review', DESIGNER, day(3, 18),
         caption='30 секунд из жизни бариста: как рождается тыквенный латте 🎃'),
    task(9, 'instagram', 'story', 3, 'client_review', DESIGNER, day(2, 9),
         caption='Только сегодня: второй латте — за полцены ☕☕'),
    task(10, 'instagram', 'post', 4, 'assigned', EMPLOYEE, due=day(3)[:10], brief='Фото десертов на витрине при утреннем свете'),
    team_task(1, 'Фотосессия десертов для осеннего меню', 'in_progress', EMPLOYEE, 'high', day(2)[:10],
              'Чизкейк, тыквенный пирог и макаруны: 10–15 кадров, светлый фон, вертикаль и квадрат.', BUSINESS),
    team_task(2, 'Обновить шаблоны сторис в цветах бренда', 'internal_review', DESIGNER, 'normal', day(4)[:10],
              'Три шаблона: анонс, опрос, акция.', caption='Три шаблона готовы, исходники в Figma.', creator=ADMIN),
    team_task(3, 'Собрать референсы рилсов для кофеен', 'new', None, 'low', None, 'Пять-десять примеров, что сейчас заходит.'),
]

# Оплаты, квитанции, решения клиента, промокоды, настройки агентства.
PAYMENTS = [{'id': 'p0000000-0000-4000-8000-000000000001', 'order_id': ORDER, 'provider': 'idram',
             'amount_amd': 63000, 'status': 'succeeded', 'receipt_no': 1, 'updated_at': PAID_AT,
             'created_at': day(-10)}]
APPROVALS = []
PROMO_CODES = [{'code': 'AUTUMN10', 'percent': 10, 'amount_amd': None, 'max_uses': 50, 'used_count': 3,
                'valid_until': day(30)[:10], 'active': True, 'created_at': day(-5)}]
AGENCY = {'id': True, 'auto_approve_days': 3, 'usd_rate_amd': 390, 'eur_rate_amd': 420, 'updated_at': day(-5)}

# Пакеты на месяц (как в миграции 0024): состав из каталога и цена за месяц.
PACKAGES = [
    {'id': 'pa000000-0000-4000-8000-%012d' % n, 'name': name, 'description': desc, 'price_amd': price,
     'active': True, 'sort_order': n * 10, 'created_at': day(-30),
     'package_items': [{'package_id': 'pa000000-0000-4000-8000-%012d' % n, 'service_id': sid, 'platform_id': 'instagram',
                        'quantity': qty} for sid, qty in items]}
    for n, name, desc, price, items in [
        (1, {'ru': 'Старт', 'hy': 'Մեկնարկ', 'en': 'Start'},
         {'ru': '8 постов в Instagram в месяц: текст и картинка', 'hy': 'Ամսական 8 գրառում Instagram-ում՝ տեքստ և նկար',
          'en': '8 Instagram posts a month: text and image'}, 56000, [('post', 8)]),
        (2, {'ru': '12 постов в месяц', 'hy': 'Ամսական 12 գրառում', 'en': '12 posts a month'},
         {'ru': '12 постов с картинками и 8 сторис в Instagram', 'hy': '12 գրառում նկարներով և 8 սթորի Instagram-ում',
          'en': '12 posts with images and 8 stories on Instagram'}, 110000, [('post', 12), ('story', 8)]),
        (3, {'ru': 'Видео', 'hy': 'Տեսանյութ', 'en': 'Video'},
         {'ru': '8 постов и 4 рилса в Instagram в месяц', 'hy': 'Ամսական 8 գրառում և 4 ռիլս Instagram-ում',
          'en': '8 posts and 4 reels on Instagram a month'}, 145000, [('post', 8), ('reel', 4)]),
    ]
]


def create_package_order(data):
    """Как create_package_order в базе: ежемесячный заказ по составу пакета, цена — цена пакета."""
    package = next((p for p in PACKAGES if p['id'] == data.get('p_package_id') and p['active']), None)
    if not package:
        return None, 'package not found'
    order_id, error = create_order({'p_business_id': data.get('p_business_id'), 'p_billing': 'monthly',
                                    'p_publishing': data.get('p_publishing'), 'p_ad_budget_amd': 0,
                                    'p_notes': data.get('p_notes'),
                                    'p_items': [{k: i[k] for k in ('service_id', 'platform_id', 'quantity')}
                                                for i in package['package_items']]})
    if not order_id:
        return None, error
    order = next(o for o in ORDERS if o['id'] == order_id)
    price = min(package['price_amd'], order['items_total_amd'])
    order.update(package_id=package['id'], discount_amd=order['items_total_amd'] - price, total_amd=price)
    return order_id, None

MESSAGES = [
    {'id': 'm1', 'order_id': ORDER, 'author_id': CLIENT, 'author_name': 'Анна Петросян', 'from_client': True,
     'body': 'Здравствуйте! Можно в осенних постах сделать акцент на тыквенный латте?', 'created_at': day(-3, 9)},
    {'id': 'm2', 'order_id': ORDER, 'author_id': MANAGER, 'author_name': 'Нарек', 'from_client': False,
     'body': 'Конечно! Пост уже готов и ждёт вашего согласования в заказе 🙂', 'created_at': day(-1, 11)},
]

# ---------- Чат команды ----------
TEAM_ID = '00000000-0000-4000-8000-00000000c0de'
DIRECT_ID = 'dc000000-0000-4000-8000-000000000001'
CONVERSATIONS = {TEAM_ID: {'kind': 'team', 'members': None},
                 DIRECT_ID: {'kind': 'direct', 'members': {MANAGER, DESIGNER}}}
TEAM_MESSAGES = [
    {'id': 'tm1', 'conversation_id': TEAM_ID, 'author_id': MANAGER, 'author_name': 'Нарек',
     'body': 'Всем доброе утро! Сегодня в 11:00 короткая планёрка по Cafe Aroma.', 'created_at': hours_ago(5)},
    {'id': 'tm2', 'conversation_id': TEAM_ID, 'author_id': DESIGNER, 'author_name': 'Ани Саргсян',
     'body': 'Буду. Пост №3 уже на проверке 👍', 'created_at': hours_ago(4)},
    {'id': 'tm3', 'conversation_id': DIRECT_ID, 'author_id': MANAGER, 'author_name': 'Нарек',
     'body': 'Ани, для поста №4 возьми фото с новой витрины.', 'created_at': hours_ago(3)},
    {'id': 'tm4', 'conversation_id': DIRECT_ID, 'author_id': DESIGNER, 'author_name': 'Ани Саргсян',
     'body': 'Хорошо, сделаю до вечера.', 'created_at': hours_ago(2)},
]
READ_AT = {}

# ---------- Чаты как в Telegram ----------
# Файлы чатов (bucket chat-files): путь -> (тип, байты). Реакции, закреп, удалённые оригиналы.
CHAT_FILES = {}
REACTIONS = []
PINNED = {}
DELETED = {}

for _m in MESSAGES + TEAM_MESSAGES:
    _m.update({k: _m.get(k) for k in ('reply_to_id', 'forwarded_from', 'edited_at', 'deleted_at', 'call')})
    _m.setdefault('attachments', [])
TEAM_MESSAGES[1]['reply_to_id'] = 'tm1'
MESSAGES[1]['edited_at'] = day(-1, 12)
REACTIONS += [
    {'message_id': 'tm2', 'chat': 'team', 'chat_id': TEAM_ID, 'user_id': MANAGER, 'user_name': 'Нарек', 'emoji': '👍'},
    {'message_id': 'm2', 'chat': 'order', 'chat_id': ORDER, 'user_id': CLIENT, 'user_name': 'Анна Петросян', 'emoji': '❤️'},
]
PINNED[TEAM_ID] = 'tm1'
PROFILES['designer@demo.am']['last_seen_at'] = hours_ago(3)


OPEN_STATUSES = ('new', 'assigned', 'in_progress', 'internal_review', 'changes_requested')


def owner_dashboard():
    """Панель владельца (как owner_dashboard в миграции 0017, упрощённо)."""
    today, month = day(0)[:10], day(0)[:7]
    admin = me()['role'] == 'admin'
    paid = [o for o in ORDERS if o['paid_at']]
    counts = {}
    for o in ORDERS:
        counts[o['status']] = counts.get(o['status'], 0) + 1
    def n(statuses, kind=None):
        return sum(1 for t in TASKS if t['status'] in statuses and (not kind or t['kind'] == kind))
    overdue = [t for t in TASKS if t['due_date'] and t['due_date'] < today and t['status'] in OPEN_STATUSES]
    workload = []
    for p in PROFILES.values():
        if not is_employee(p['role']) or p['role'] == 'admin':
            continue
        mine = [t for t in TASKS if t['assignee_id'] == p['id'] and t['status'] in OPEN_STATUSES]
        workload.append({'id': p['id'], 'name': p['full_name'], 'role': p['role'], 'job_title': p.get('job_title'),
                         'avatar_path': p['avatar_path'], 'accent_color': p['accent_color'], 'open': len(mine),
                         'team_open': sum(1 for t in mine if t['kind'] == 'team'),
                         'overdue': sum(1 for t in mine if t in overdue)})
    workload.sort(key=lambda w: (-w['open'], w['name']))
    # AI-агенты: сейчас работают, их версии ждут проверки, сделано и ошибок за неделю.
    agents = []
    for i, aid in enumerate(('smm', 'designer', 'scriptwriter', 'targetologist', 'seo', 'manager')):
        runs = [r for r in AGENT_RUNS if r['agent'] == aid]
        review = sum(1 for t in TASKS if t['status'] == 'internal_review' and t['deliverables']
                     and max(t['deliverables'], key=lambda d: d['version']).get('agent') == aid)
        agents.append({'id': aid, 'ord': i, 'running': sum(1 for r in runs if r['status'] == 'running'), 'to_review': review,
                       'done_week': sum(1 for r in runs if r['status'] in ('done', 'applied')),
                       'failed_week': sum(1 for r in runs if r['status'] == 'failed')})
    agents.sort(key=lambda a: (-(a['running'] + a['to_review']), a['ord']))
    return {
        'is_admin': admin,
        'revenue_month': sum(o['total_amd'] for o in paid if o['paid_at'][:7] == month) if admin else None,
        'revenue_prev_month': 48000 if admin else None,
        'paid_orders_month': sum(1 for o in paid if o['paid_at'][:7] == month),
        'active_clients': len({o['client_id'] for o in ORDERS if o['status'] in ('paid', 'in_progress')}),
        'orders': counts,
        'tasks': {'unassigned': n(('new',)), 'in_work': n(('assigned', 'in_progress', 'changes_requested')),
                  'review': n(('internal_review',)), 'client': n(('client_review',), 'order'),
                  'publish': n(('approved', 'publishing'), 'order'), 'overdue': len(overdue),
                  'team_open': n(OPEN_STATUSES, 'team')},
        'workload': workload,
        'workload_agents': agents,
    }


def chat_messages(chat):
    return MESSAGES if chat == 'order' else TEAM_MESSAGES


def chat_column(chat):
    return 'order_id' if chat == 'order' else 'conversation_id'


def can_access_chat(chat, cid):
    if chat == 'order':
        return me()['role'] != 'freelancer' and cid in my_order_ids()
    return can_access(cid)


def find_message(chat, mid):
    return next((m for m in chat_messages(chat) if m['id'] == mid), None)


def others_read_at(chat, cid):
    uid = me()['id']
    reads = {u: t for (u, c), t in READ_AT.items() if c == cid and u != uid}
    if chat == 'order':
        order = next((o for o in ORDERS if o['id'] == cid), None)
        client = order and order['client_id']
        reads = {u: t for u, t in reads.items() if (u != client) == (uid == client)}
    return max(reads.values(), default=None)


def attachment_kind(m):
    if m.get('call'):
        return 'call'
    return m['attachments'][0]['kind'] if m.get('attachments') else None


def my_chats():
    profile, uid, out = me(), me()['id'], []
    for order in ORDERS:
        if not can_access_chat('order', order['id']):
            continue
        msgs = [m for m in MESSAGES if m['order_id'] == order['id']]
        if not msgs and order['client_id'] != uid:
            continue
        last = msgs[-1] if msgs else None
        client = by_id(order['client_id'])
        biz = next((b for b in BUSINESSES if b['id'] == order['business_id']), {})
        read_at = READ_AT.get((uid, order['id']), '')
        mine = order['client_id'] == uid
        out.append({
            'chat': 'order', 'id': order['id'], 'kind': 'order', 'title': biz.get('name'),
            'business_name': biz.get('name'), 'order_created_at': order['created_at'],
            'peer_id': None if mine else client['id'], 'peer_role': None,
            'avatar_path': None if mine else client['avatar_path'],
            'last_seen_at': None if mine else client['last_seen_at'],
            'last_message_at': last and last['created_at'], 'last_body': last and last['body'],
            'last_author': last and last['author_name'], 'last_author_id': last and last['author_id'],
            'last_attachment': last and attachment_kind(last), 'last_deleted': bool(last and last['deleted_at']),
            'unread': sum(1 for m in msgs if m['author_id'] != uid and not m['deleted_at'] and m['created_at'] > read_at),
            'others_read_at': others_read_at('order', order['id']),
        })
    for conv in my_conversations():
        msgs = [m for m in TEAM_MESSAGES if m['conversation_id'] == conv['id']]
        last = msgs[-1] if msgs else None
        other = by_id(conv['other_user_id']) if conv['other_user_id'] else None
        read_at = READ_AT.get((uid, conv['id']), '')
        out.append({
            'chat': 'team', 'id': conv['id'], 'kind': conv['kind'], 'title': conv['other_name'],
            'business_name': None, 'order_created_at': None, 'peer_id': conv['other_user_id'],
            'peer_role': conv['other_role'], 'avatar_path': other and other['avatar_path'],
            'last_seen_at': other and other['last_seen_at'],
            'last_message_at': last and last['created_at'], 'last_body': last and last['body'],
            'last_author': last and last['author_name'], 'last_author_id': last and last['author_id'],
            'last_attachment': last and attachment_kind(last), 'last_deleted': bool(last and last['deleted_at']),
            'unread': sum(1 for m in msgs if m['author_id'] != uid and not m['deleted_at'] and m['created_at'] > read_at),
            'others_read_at': others_read_at('team', conv['id']),
        })
    out.sort(key=lambda c: c['last_message_at'] or '', reverse=True)
    return out


def chat_info(chat, cid):
    uid = me()['id']
    pinned = find_message(chat, PINNED.get(cid))
    pinned = pinned and not pinned['deleted_at'] and {k: pinned[k] for k in ('id', 'body', 'attachments', 'author_name')}
    peer, members, title = None, None, None
    if chat == 'order':
        order = next(o for o in ORDERS if o['id'] == cid)
        title = next((b['name'] for b in BUSINESSES if b['id'] == order['business_id']), None)
        if order['client_id'] == uid:
            seen = [p['last_seen_at'] for p in PROFILES.values() if is_team(p['role']) and p['last_seen_at']]
            peer = {'last_seen_at': max(seen, default=None)}
        else:
            c = by_id(order['client_id'])
            peer = {'id': c['id'], 'name': c['full_name'], 'avatar_path': c['avatar_path'], 'last_seen_at': c['last_seen_at']}
    elif CONVERSATIONS[cid]['kind'] == 'direct':
        o = by_id(next(m for m in CONVERSATIONS[cid]['members'] if m != uid))
        peer = {'id': o['id'], 'name': o['full_name'], 'avatar_path': o['avatar_path'], 'role': o['role'],
                'last_seen_at': o['last_seen_at']}
        title = o['full_name']
    else:
        members = sum(1 for p in PROFILES.values() if is_team(p['role']))
    return {'title': title, 'pinned': pinned or None, 'peer': peer, 'members': members,
            'others_read_at': others_read_at(chat, cid)}


def chat_rpc(fn, data):
    """Функции чатов (как в миграции 0015, упрощённо). Возвращает (ответ, ошибка)."""
    profile, uid = me(), me()['id']
    chat = data.get('p_chat') or data.get('p_from_chat')
    if fn == 'my_chats':
        return my_chats(), None
    if fn == 'touch_last_seen':
        if profile is not PENDING_ANON:
            profile['last_seen_at'] = now_iso()
        return None, None
    if fn == 'chat_info':
        if not can_access_chat(chat, data.get('p_chat_id')):
            return None, 'chat not found'
        return chat_info(chat, data.get('p_chat_id')), None
    if fn == 'mark_chat_read':
        if not can_access_chat(chat, data.get('p_chat_id')):
            return None, 'chat not found'
        READ_AT[(uid, data.get('p_chat_id'))] = now_iso()
        return None, None
    if fn == 'pin_chat_message':
        cid, mid = data.get('p_chat_id'), data.get('p_message_id')
        if not can_access_chat(chat, cid):
            return None, 'chat not found'
        if mid is None:
            PINNED.pop(cid, None)
        else:
            PINNED[cid] = mid
        return None, None
    message = find_message(chat, data.get('p_message_id')) if chat in ('order', 'team') else None
    if not message or message['deleted_at'] or not can_access_chat(chat, message[chat_column(chat)]):
        return None, 'message not found'
    cid = message[chat_column(chat)]
    if fn == 'edit_chat_message':
        body = (data.get('p_body') or '').strip()
        if message['author_id'] != uid or not (body or message['attachments']):
            return None, 'message not found'
        if body != message['body']:
            message.update(body=body, edited_at=now_iso())
        return None, None
    if fn == 'delete_chat_message':
        if message['author_id'] != uid and profile['role'] != 'admin':
            return None, 'only the author can delete a message'
        DELETED[message['id']] = {'message_id': message['id'], 'chat': chat, 'chat_id': cid,
                                  'body': message['body'], 'attachments': message['attachments']}
        message.update(body='', attachments=[], forwarded_from=None, edited_at=None, deleted_at=now_iso(), call=None)
        REACTIONS[:] = [r for r in REACTIONS if r['message_id'] != message['id']]
        if PINNED.get(cid) == message['id']:
            PINNED.pop(cid)
        return None, None
    if fn == 'react_to_message':
        emoji = data.get('p_emoji')
        existing = next((r for r in REACTIONS if r['message_id'] == message['id'] and r['user_id'] == uid), None)
        REACTIONS[:] = [r for r in REACTIONS if not (r['message_id'] == message['id'] and r['user_id'] == uid)]
        if emoji and (not existing or existing['emoji'] != emoji):
            REACTIONS.append({'message_id': message['id'], 'chat': chat, 'chat_id': cid, 'user_id': uid,
                              'user_name': profile['full_name'], 'emoji': emoji})
        return None, None
    if fn == 'forward_chat_message':
        target, tid = data.get('p_to_chat'), data.get('p_to_chat_id')
        if not can_access_chat(target, tid):
            return None, 'chat not found'
        copy = new_message(target, tid, message['body'], message['attachments'], None, None)
        copy['forwarded_from'] = message['forwarded_from'] or message['author_name']
        return copy['id'], None
    return None, None


def new_message(chat, cid, body, attachments, reply_to, call):
    profile = me()
    message = {'id': 'new-%d' % int(time.time() * 1000000), 'author_id': profile['id'],
               'author_name': profile['full_name'], 'body': (body or '').strip(), 'created_at': now_iso(),
               'attachments': attachments or [], 'reply_to_id': reply_to, 'forwarded_from': None,
               'edited_at': None, 'deleted_at': None, chat_column(chat): cid,
               'call': call and {'room': call['room'], 'video': bool(call.get('video'))}}
    if message['reply_to_id'] and not any(m['id'] == reply_to and m[chat_column(chat)] == cid for m in chat_messages(chat)):
        message['reply_to_id'] = None
    if chat == 'order':
        message['from_client'] = profile['role'] == 'client'
    chat_messages(chat).append(message)
    return message


def can_access(cid):
    conv, profile = CONVERSATIONS.get(cid), me()
    if not conv:
        return False
    if conv['kind'] == 'team':
        return is_team(profile['role'])
    return profile['id'] in conv['members']


def my_conversations():
    uid = me()['id']
    out = []
    for cid, conv in CONVERSATIONS.items():
        if not can_access(cid):
            continue
        msgs = [m for m in TEAM_MESSAGES if m['conversation_id'] == cid]
        last = msgs[-1] if msgs else None
        other = None
        if conv['kind'] == 'direct':
            other = next((by_id(m) for m in conv['members'] if m != uid), None)
        read_at = READ_AT.get((uid, cid), '')
        out.append({
            'id': cid, 'kind': conv['kind'],
            'other_user_id': other and other['id'], 'other_name': other and other['full_name'],
            'other_role': other and other['role'],
            'last_message_at': last and last['created_at'], 'last_body': last and last['body'],
            'last_author': last and last['author_name'],
            'unread': sum(1 for m in msgs if m['author_id'] != uid and m['created_at'] > read_at),
        })
    # Общий чат первым, дальше по свежести.
    out.sort(key=lambda c: c['last_message_at'] or '', reverse=True)
    out.sort(key=lambda c: c['kind'] != 'team')
    return out


# ---------- Отчёт ----------
SNAPSHOTS = [
    {'business_id': BIZ, 'taken_on': day(-31)[:10], 'followers_count': 1227, 'media_count': 180,
     'metrics_30d': {}, 'fetched_at': day(-31)},
    {'business_id': BIZ, 'taken_on': day(0)[:10], 'followers_count': 1284, 'media_count': 186,
     'metrics_30d': {'reach': 12940, 'views': 48310, 'total_interactions': 2410}, 'fetched_at': day(0, 6)},
]
POST_METRICS = [{
    'task_id': TASKS[0]['id'], 'business_id': BIZ, 'media_id': '1', 'permalink': TASKS[0]['published_url'],
    'media_type': 'FEED', 'metrics': {'reach': 3120, 'likes': 140, 'comments': 12, 'saved': 30, 'shares': 9},
    'fetched_at': day(0, 6),
    'tasks': {'number': 1, 'service_id': 'post', 'platform_id': 'instagram', 'published_at': TASKS[0]['published_at'],
              'published_url': TASKS[0]['published_url'], 'services': SVC['post']},
}]


# ---------- AI-агенты (демо: настоящего AI в просмотре нет) ----------
AGENT_RUNS = []
AGENT_IDS = ('smm', 'designer', 'scriptwriter', 'targetologist', 'seo', 'manager')
AGENT_NAMES = {'smm': 'Ани, AI-SMM', 'designer': 'Лилит, AI-дизайнер', 'scriptwriter': 'Арам, AI-сценарист',
               'targetologist': 'Арсен, AI-таргетолог', 'seo': 'Сона, AI-SEO'}
AGENT_DEMO = {
    'smm': '1) Текст: Осень пришла — и тыквенный латте тоже 🎃☕ Заходите утром на Абовяна 12 — первые 10 гостей '
           'получат круассан в подарок!\n#CafeAroma #Ереван #тыквенныйлатте #кофе #осень\n'
           '2) Лучшее время: вторник, 8:30 — аудитория едет на учёбу и работу.\n'
           '3) План: неделя 1 — пост о латте, неделя 2 — сторис с опросом, неделя 3 — рилс, неделя 4 — пост-итог.',
    'designer': 'Тыквенный латте уже здесь 🎃 Каждое утро с 8:00 на Абовяна 12.\n#CafeAroma #Ереван #осень',
    'scriptwriter': 'Сценарий. Сцена 1 (0–2 с): крупно пар над чашкой, текст «Осень в чашке».\n'
                    'Сцена 2 (2–8 с): бариста наливает латте-арт.\nСцена 3 (8–15 с): гость улыбается, текст «Абовяна 12».\n'
                    'Субтитры: «Осень в чашке. Тыквенный латте. Cafe Aroma».\n'
                    'План съёмки: 1. Чашка крупно сверху, на фоне листьев (4:5). 2. Руки бариста с питчером (9:16). '
                    '3. Столик у окна с десертом, мягкий утренний свет.\nРеквизит: тыква, корица, плед.',
    'targetologist': 'Вариант 1: «Осень в чашке» — «Тыквенный латте ждёт вас на Абовяна 12». Кнопка: Проложить маршрут.\n'
                     'Аудитория: Ереван, 20–35, интересы — кофе, студенты, офис.\nБюджет: 3 варианта по 33% на тест 5 дней.',
    'seo': 'Описание профиля: Авторский кофе и десерты в центре Еревана ☕ Абовяна 12, с 8:00\n'
           'Ключевые слова: кофейня Ереван, кофе с собой, завтрак центр, десерты Абовяна…\n'
           'Хэштеги: #кофеереван #CafeAroma #ереван #yerevancafe',
}
_DEMO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agent-designer-demo.png')
AGENT_DEMO_PNG = open(_DEMO_PATH, 'rb').read() if os.path.exists(_DEMO_PATH) else demo_png(80, 100, *DEMO_COLORS[0])
_SCENE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agent-scene-demo.png')
AGENT_SCENE_PNG = open(_SCENE_PATH, 'rb').read() if os.path.exists(_SCENE_PATH) else AGENT_DEMO_PNG
# Картинки из чата с агентом (bucket agent-files): путь -> PNG.
AGENT_FILES = {}
AGENT_WORK_SECONDS = 2


# ---------- Кабинет клиента: подарок после знакомства и идеи задач (демо: AI нет) ----------
WELCOME_KITS = []
IDEA_BATCHES = []
TASK_IDEAS = []
WELCOME_DEMO = {
    'posts': [
        {'title': 'Тыквенный латте вернулся', 'caption': 'Демо (в просмотре AI не подключён). Осень в каждой чашке 🍂 '
         'Тыквенный латте снова в меню — заходите утром! [ЦЕНА]\n#CafeAroma #Ереван #осень #кофе',
         'image_idea': 'Чашка латте крупно на деревянном столе, вокруг осенние листья.', 'best_time': 'Вторник, 8:30'},
        {'title': 'Утро с круассаном', 'caption': 'Демо. Хорошее утро начинается с тёплого круассана и капучино ☕🥐 '
         'Ждём вас с 8:00.\n#CafeAroma #завтрак #Ереван', 'image_idea': 'Капучино и круассан у окна, мягкий утренний свет.',
         'best_time': 'Четверг, 8:00'},
        {'title': 'Знакомьтесь: наш бариста', 'caption': 'Демо. Каждый день вашу чашку готовит наш бариста — '
         'приходите познакомиться!\n#CafeAroma #бариста #кофейня', 'image_idea': 'Портрет бариста с питчером за стойкой.',
         'best_time': 'Суббота, 11:00'},
    ],
    'plan': [{'day': d, 'format': f, 'topic': tp} for d, f, tp in [
        ('monday', 'post', 'Тыквенный латте вернулся'), ('tuesday', 'story', 'Опрос: какой напиток осени лучший?'),
        ('wednesday', 'reel', 'Латте-арт за 15 секунд'), ('thursday', 'post', 'Утро с круассаном'),
        ('friday', 'story', 'Пятничная скидка [ЦЕНА]'), ('saturday', 'post', 'Знакомьтесь: наш бариста'),
        ('sunday', 'rest', 'Без публикации')]],
}
IDEAS_DEMO = [
    ('smm', 'Пост про осеннее меню', 'Ани напишет пост о сезонных напитках с призывом зайти утром.', 'post', 'instagram'),
    ('scriptwriter', 'Рилс: латте-арт за 15 секунд', 'Арам напишет сценарий и план съёмки короткого видео с бариста.', 'reel', 'instagram'),
    ('targetologist', 'Реклама на студентов рядом', 'Арсен настроит рекламу на студентов в радиусе 2 км от кофейни.', 'ads_management', None),
]


def yerevan_week_start():
    now = datetime.now(timezone.utc) + timedelta(hours=4)
    return (now - timedelta(days=now.weekday())).date().isoformat()


def own_business(profile):
    return next((b for b in BUSINESSES if b['owner_id'] == profile['id']), None)


def visible_business_ids():
    profile = me()
    return {b['id'] for b in BUSINESSES if b['owner_id'] == profile['id'] or is_team(profile['role'])}


def start_client_ai(data):
    """Как функция client-ai: подарок один раз на клиента, идеи — раз в неделю."""
    profile = me()
    if profile['role'] != 'client':
        return None, 'forbidden'
    business = own_business(profile)
    if not business:
        return None, 'business not found'
    if data.get('mode') == 'welcome':
        kit = next((k for k in WELCOME_KITS if k['client_id'] == profile['id']), None)
        if kit and kit['status'] != 'failed':
            return {'status': kit['status']}, None
        if kit:
            WELCOME_KITS.remove(kit)
        kit = {'business_id': business['id'], 'client_id': profile['id'], 'status': 'running', 'language': 'ru',
               'result': None, 'error': None, 'created_at': now_iso()}
        WELCOME_KITS.append(kit)
        threading.Timer(AGENT_WORK_SECONDS, lambda: kit.update(status='done', result=WELCOME_DEMO)).start()
        return {'status': 'running'}, None
    if data.get('mode') != 'ideas':
        return None, 'bad request'
    if not business.get('onboarded_at'):
        return None, 'onboarding not finished'
    week = yerevan_week_start()
    if any(b['business_id'] == business['id'] and b['week_start'] == week for b in IDEA_BATCHES):
        return {'week_start': week, 'started': False}, None
    batch = {'business_id': business['id'], 'week_start': week, 'status': 'running', 'created_at': now_iso()}
    IDEA_BATCHES.append(batch)

    def finish():
        for agent, title, description, service, platform in IDEAS_DEMO:
            TASK_IDEAS.append({'id': 'd1000000-0000-4000-8000-%012d' % (len(TASK_IDEAS) + 1), 'business_id': business['id'],
                               'week_start': week, 'agent': agent, 'title': title, 'description': description,
                               'service_id': service, 'platform_id': platform, 'status': 'proposed', 'order_id': None,
                               'created_at': now_iso(), 'decided_at': None})
        batch['status'] = 'done'
    threading.Timer(AGENT_WORK_SECONDS, finish).start()
    return {'week_start': week, 'started': True}, None


def decide_idea(idea_id, accept):
    profile = me()
    idea = next((i for i in TASK_IDEAS if i['id'] == idea_id), None)
    business = idea and next((b for b in BUSINESSES if b['id'] == idea['business_id']), None)
    if not idea or not business or business['owner_id'] != profile['id']:
        return None, 'idea not found'
    if idea['status'] != 'proposed':
        return None, 'idea is already decided'
    order_id = None
    if accept:
        order_id, error = create_order({'p_business_id': business['id'], 'p_billing': 'one_time', 'p_publishing': 'team',
                                        'p_ad_budget_amd': 0, 'p_notes': idea['title'] + '\n' + idea['description'],
                                        'p_items': [{'service_id': idea['service_id'], 'platform_id': idea['platform_id'],
                                                     'quantity': 1}]})
        if not order_id:
            return None, error
    idea.update(status='accepted' if accept else 'dismissed', order_id=order_id, decided_at=now_iso())
    return order_id, None


def start_agent(data):
    """Запуск агента — те же проверки, что в Edge Function ai-agent (упрощённо)."""
    profile = me()
    agent = data.get('agent')
    if not is_employee(profile['role']):
        return None, 'forbidden'
    if agent not in AGENT_IDS:
        return None, 'bad request'
    if data.get('mode') == 'request':
        prompt = (data.get('prompt') or '').strip()
        if not prompt or agent == 'manager':
            return None, 'bad request'
        run = {'id': 'ar000000-0000-4000-8000-%012d' % (len(AGENT_RUNS) + 1), 'agent': agent, 'status': 'running',
               'chat': True, 'task_id': None, 'order_id': None, 'instructions': prompt[:2000], 'deliverable_id': None,
               'result': None, 'error': None, 'images': 0, 'created_by': profile['id'], 'created_at': now_iso()}
        AGENT_RUNS.append(run)
        threading.Timer(AGENT_WORK_SECONDS, finish_request, [run]).start()
        return run['id'], None
    run = {'id': 'ar000000-0000-4000-8000-%012d' % (len(AGENT_RUNS) + 1), 'agent': agent, 'status': 'running', 'chat': False,
           'task_id': None, 'order_id': None, 'instructions': (data.get('instructions') or '').strip() or None,
           'deliverable_id': None, 'result': None, 'error': None, 'images': 0,
           'created_by': profile['id'], 'created_at': now_iso()}
    if agent == 'manager':
        if not is_manager(profile['role']):
            return None, 'only managers can use the AI manager'
        if data.get('order_id') not in my_order_ids():
            return None, 'order not found'
        run['order_id'] = data['order_id']
    else:
        task = next((t for t in visible_tasks() if t['id'] == data.get('task_id')), None)
        if not task or not (task['assignee_id'] == profile['id'] or (is_manager(profile['role']) and task['kind'] == 'order')):
            return None, 'task not found'
        if task['status'] not in ('new', 'assigned', 'in_progress', 'changes_requested'):
            return None, 'task is not in progress'
        if any(r['task_id'] == task['id'] and r['status'] == 'running' for r in AGENT_RUNS):
            return None, 'an AI agent is already working on this task'
        run['task_id'] = task['id']
    AGENT_RUNS.append(run)
    threading.Timer(AGENT_WORK_SECONDS, finish_agent, [run, profile['id']]).start()
    return run['id'], None


def finish_agent(run, user_id):
    if run['agent'] == 'manager':
        workers = {'post': DESIGNER, 'story': DESIGNER, 'reel': FREELANCER}
        plan = [{'task_id': t['id'], 'assignee_id': workers.get(t['service_id'], DESIGNER),
                 'due_date': (NOW + timedelta(days=3 + 2 * i)).date().isoformat(),
                 'brief': 'Демо-бриф: %s №%d — осеннее меню, акцент на тыквенный латте, тёплые цвета.' %
                          (SVC[t['service_id']]['name']['ru'], t['number']),
                 'reason': 'Демо: подходит по роли и загрузке.'}
                for i, t in enumerate(x for x in TASKS if x['order_id'] == run['order_id'] and x['status'] in ('new', 'assigned'))]
        run.update(status='done', result={'summary': 'Демо-план (в просмотре AI не подключён): брифы и сроки '
                                                     'на ближайшие две недели.', 'tasks': plan})
        return
    task = next(t for t in TASKS if t['id'] == run['task_id'])
    version = max([d['version'] for d in task['deliverables']] or [0]) + 1
    files = []
    if run['agent'] == 'designer':
        path = '%s/ai-demo-%d.png' % (task['id'], version)
        DELIVERABLE_FILES[path] = AGENT_DEMO_PNG
        files.append(path)
    deliverable = {'id': 'av%s-%d' % (task['id'][-4:], version), 'task_id': task['id'], 'version': version,
                   'caption': AGENT_DEMO[run['agent']], 'files': files, 'agent': run['agent'],
                   'note': '🤖 %s: демо-версия (в просмотре AI не подключён).' % AGENT_NAMES[run['agent']],
                   'created_by': user_id, 'created_at': now_iso(), 'sent_to_client_at': None}
    task['deliverables'].insert(0, deliverable)
    task['status'] = 'internal_review'
    task['assignee_id'] = task['assignee_id'] or user_id
    run.update(status='done', deliverable_id=deliverable['id'], images=len(files),
               result={'backgrounds': 'gradient'} if files else None)


def finish_request(run):
    """Демо-ответ в чате: дизайнеру — готовая картинка «человек у моря», остальным — пример текста."""
    files = []
    if run['agent'] == 'designer':
        path = '%s/%s-1.png' % (run['created_by'], run['id'])
        AGENT_FILES[path] = AGENT_SCENE_PNG
        files.append(path)
        text = 'Демо (в просмотре AI не подключён): так выглядит ответ на запрос «%s». ' \
               'С ключом генератора картинка будет нарисована точно по описанию.' % run['instructions']
    else:
        text = 'Демо (в просмотре AI не подключён), ответ на «%s»:\n\n%s' % (run['instructions'], AGENT_DEMO[run['agent']])
    run.update(status='done', images=len(files),
               result={'text': text, 'caption': None, 'files': files, 'needs_image_key': False})


def attach_run(data):
    """Результат из чата → версия задачи на проверке (как режим attach в ai-agent)."""
    profile = me()
    run = next((r for r in AGENT_RUNS if r['id'] == data.get('run_id')), None)
    if not run or not (run['created_by'] == profile['id'] or is_manager(profile['role'])):
        return 'not found'
    if not run['chat'] or run['status'] != 'done' or run['deliverable_id']:
        return 'this result cannot be attached'
    task = next((t for t in visible_tasks() if t['id'] == data.get('task_id')), None)
    if not task or not (task['assignee_id'] == profile['id'] or (is_manager(profile['role']) and task['kind'] == 'order')):
        return 'task not found'
    if task['status'] not in ('new', 'assigned', 'in_progress', 'changes_requested'):
        return 'task is not in progress'
    version = max([d['version'] for d in task['deliverables']] or [0]) + 1
    files = []
    for i, path in enumerate(run['result']['files']):
        target = '%s/ai-chat-%d-%d.png' % (task['id'], version, i + 1)
        DELIVERABLE_FILES[target] = AGENT_FILES[path]
        files.append(target)
    deliverable = {'id': 'av%s-%d' % (task['id'][-4:], version), 'task_id': task['id'], 'version': version,
                   'caption': run['result']['caption'] or run['result']['text'], 'files': files, 'agent': run['agent'],
                   'note': '🤖 %s: «%s»' % (AGENT_NAMES[run['agent']], run['instructions']),
                   'created_by': profile['id'], 'created_at': now_iso(), 'sent_to_client_at': None}
    task['deliverables'].insert(0, deliverable)
    task['status'] = 'internal_review'
    task['assignee_id'] = task['assignee_id'] or profile['id']
    run.update(task_id=task['id'], deliverable_id=deliverable['id'])
    return None


def apply_manager_plan(run_id):
    run = next((r for r in AGENT_RUNS if r['id'] == run_id), None)
    if not is_manager(me()['role']):
        return None, 'only managers can apply the plan'
    if not run or run['agent'] != 'manager' or run['status'] != 'done':
        return None, 'plan not found'
    count = 0
    for item in run['result']['tasks']:
        task = next((t for t in TASKS if t['id'] == item['task_id'] and t['order_id'] == run['order_id']), None)
        if task and task['status'] in ('new', 'assigned'):
            task.update(assignee_id=item['assignee_id'] or task['assignee_id'], due_date=item['due_date'] or task['due_date'],
                        brief=item['brief'] or task['brief'])
            if task['status'] == 'new' and task['assignee_id']:
                task['status'] = 'assigned'
            count += 1
    run['status'] = 'applied'
    return count, None


def visible_agent_runs():
    profile = me()
    tasks = {t['id']: t for t in visible_tasks()}
    result = []
    for run in AGENT_RUNS:
        if not (run['created_by'] == profile['id'] or is_manager(profile['role']) or
                (run['task_id'] in tasks and is_employee(profile['role']))):
            continue
        task = tasks.get(run['task_id'])
        version = next((d for d in task['deliverables'] if d['id'] == run.get('deliverable_id')), None) if task else None
        result.append({**run, 'tasks': {'service_id': task['service_id'], 'platform_id': task['platform_id'],
                                        'number': task['number'], 'services': task['services'],
                                        'businesses': {'name': task['businesses']['name']} if task['businesses'] else None,
                                        'kind': task['kind'], 'business_id': task['business_id'],
                                        'order_id': task['order_id'], 'related_order_id': task['related_order_id']}
                       if task else None,
                       'deliverables': {'caption': version['caption'], 'files': version['files']} if version else None})
    return sorted(result, key=lambda r: r['created_at'], reverse=True)


# ---------- Выборки по таблицам (фильтры PostgREST — упрощённо) ----------
# Комментарии к задачам: тексты проверки и обсуждение.
TASK_COMMENTS = [{'id': 'c1', 'task_id': TASKS[1]['id'], 'author_id': MANAGER,
                  'body': 'Отлично, отправляю клиенту.', 'created_at': day(-1)}]


def find_task(task_id):
    return next((t for t in TASKS if t['id'] == task_id), None)


# «Кто видит» и история задач команды (0032, 0034).
# Демо: менеджер отмечен в задаче владельца — видит её, но менять не может.
TASK_WATCHERS = [{'task_id': 't1000000-0000-4000-8000-000000000002', 'user_id': MANAGER}]
TASK_HISTORY = []


def sees_team(t, profile):
    return t['kind'] == 'team' and (
        profile['role'] == 'admin' or profile['id'] in (t['created_by'], t['assignee_id'], t.get('reviewer_id'))
        or any(w['task_id'] == t['id'] and w['user_id'] == profile['id'] for w in TASK_WATCHERS))


# Менять задачу команды — автор (пока он менеджер) и владелец (0033).
def can_edit_team(t, profile):
    return t['kind'] == 'team' and (
        profile['role'] == 'admin' or (t['created_by'] == profile['id'] and is_manager(profile['role'])))


def log_history(task_id, field, old, new):
    if old != new:
        TASK_HISTORY.append({'id': 'h%d' % (len(TASK_HISTORY) + 1), 'task_id': task_id, 'actor_id': me()['id'],
                             'field': field, 'old_value': old, 'new_value': new, 'created_at': now_iso()})


def set_status(task_, status):
    if task_['kind'] == 'team':
        log_history(task_['id'], 'status', task_['status'], status)
    task_['status'] = status


def set_watchers(task_, ids, log=True):
    old = sorted(w['user_id'] for w in TASK_WATCHERS if w['task_id'] == task_['id'])
    new = sorted({i for i in ids if by_id(i) and by_id(i)['role'] != 'admin'})
    TASK_WATCHERS[:] = [w for w in TASK_WATCHERS if w['task_id'] != task_['id']]
    TASK_WATCHERS.extend({'task_id': task_['id'], 'user_id': i} for i in new)
    if log:
        log_history(task_['id'], 'watchers', old, new)


# Работа над задачей и задачи команды — те же проверки, что в базе (0003, 0025, 0028, 0032–0034).
def task_rpc(fn, data):
    profile = me()
    manager = is_manager(profile['role'])
    if fn in ('create_team_task', 'update_team_task'):
        task_ = None
        if fn == 'create_team_task':
            if not manager:
                return None, 'only managers can create team tasks'
        else:
            task_ = find_task(data.get('p_task_id'))
            if not task_ or not sees_team(task_, profile):
                return None, 'task not found'
            if not can_edit_team(task_, profile):
                return None, 'only the author or the owner can change the task'
        title = (data.get('p_title') or '').strip()
        if not title:
            return None, 'title is required'
        assignee = data.get('p_assignee_id')
        reviewer = data.get('p_reviewer_id') or (task_['reviewer_id'] if task_ else profile['id'])
        for person, old in ((assignee, task_ and task_['assignee_id']), (reviewer, task_ and task_['reviewer_id'])):
            if person and not (by_id(person) and is_employee(by_id(person)['role'])):
                return None, 'assignee must be a team member'
            if person and person != old and by_id(person)['role'] == 'admin' and profile['role'] != 'admin':
                return None, 'only the owner can give a task to the owner'
        watchers = data.get('p_watchers')
        if watchers and any(not (by_id(w) and is_employee(by_id(w)['role'])) for w in watchers):
            return None, 'watchers must be team members'
        order = next((o for o in ORDERS if o['id'] == data.get('p_order_id')), None)
        business_id = order['business_id'] if order else data.get('p_business_id')
        business = next((b for b in BUSINESSES if b['id'] == business_id), None)
        fields = {'title': title, 'brief': (data.get('p_description') or '').strip() or None, 'assignee_id': assignee,
                  'due_date': data.get('p_due_date'), 'priority': data.get('p_priority') or 'normal',
                  'business_id': business['id'] if business else None, 'businesses': business,
                  'related_order_id': order['id'] if order else None, 'reviewer_id': reviewer, 'updated_at': now_iso()}
        if fn == 'create_team_task':
            run = None
            if data.get('p_from_run_id'):
                run = next((r for r in AGENT_RUNS if r['id'] == data['p_from_run_id'] and r['agent'] != 'manager'
                            and r['status'] in ('done', 'applied')), None)
                if not run:
                    return None, 'agent work not found'
            new = team_task(len(TASKS) + 100, title, 'assigned' if assignee else 'new', assignee, creator=profile['id'])
            new.update(fields)
            if run:
                new.update(from_agent_run_id=run['id'], draft_agent=run['agent'])
            new['created_at'] = now_iso()
            TASKS.append(new)
            set_watchers(new, watchers or [], log=False)
            log_history(new['id'], 'created', None, title)
            return new['id'], None
        if task_['status'] == 'new' and assignee:
            fields['status'] = 'assigned'
        elif task_['status'] == 'assigned' and not assignee:
            fields['status'] = 'new'
        for key in ('title', 'brief', 'due_date', 'priority', 'status', 'assignee_id', 'reviewer_id', 'related_order_id'):
            if key in fields:
                log_history(task_['id'], key, task_.get(key), fields[key])
        log_history(task_['id'], 'business', (task_.get('businesses') or {}).get('name'), business and business['name'])
        task_.update(fields)
        if watchers is not None:
            set_watchers(task_, watchers)
        return None, None
    task_ = find_task(data.get('p_task_id'))
    visible = task_ and task_['id'] in {t['id'] for t in visible_tasks()}
    if not visible:
        return None, 'task not found'
    if fn == 'set_team_task_attachments':
        if not can_edit_team(task_, profile):
            return None, 'only the author or the owner can change the task'
        log_history(task_['id'], 'attachments', task_['attachments'], data.get('p_files') or [])
        task_['attachments'] = data.get('p_files') or []
        return None, None
    if fn == 'delete_team_task':
        if not can_edit_team(task_, profile):
            return None, 'only the author or the owner can change the task'
        TASKS.remove(task_)
        return None, None
    if fn == 'start_task':
        if task_['assignee_id'] != profile['id'] or task_['status'] != 'assigned':
            return None, 'task cannot be started'
        set_status(task_, 'in_progress')
        return None, None
    if fn == 'submit_deliverable':
        if not (task_['assignee_id'] == profile['id'] or (manager and task_['kind'] == 'order')):
            return None, 'task not found'
        if task_['status'] not in ('assigned', 'in_progress', 'changes_requested'):
            return None, 'task is not in progress'
        caption = (data.get('p_caption') or '').strip() or None
        files = data.get('p_files') or []
        if not caption and not files:
            return None, 'deliverable is empty'
        version = len(task_['deliverables']) + 1
        task_['deliverables'].insert(0, {
            'id': '%s-v%d' % (task_['id'], version), 'task_id': task_['id'], 'version': version, 'caption': caption,
            'files': files, 'note': (data.get('p_note') or '').strip() or None, 'created_by': profile['id'],
            'created_at': now_iso(), 'sent_to_client_at': None, 'reviewer_name': None})
        set_status(task_, 'internal_review')
        return None, None
    if fn == 'review_task':
        approve, comment = data.get('p_approve'), (data.get('p_comment') or '').strip()
        reviewer = (task_.get('reviewer_id') == profile['id'] or profile['role'] == 'admin') if task_['kind'] == 'team' else manager
        if not reviewer:
            return None, 'only the reviewer can review this task'
        if task_['kind'] == 'team' and not approve and not comment:
            return None, 'comment is required to return the task'
        if task_['status'] != 'internal_review':
            return None, 'task is not waiting for review'
        if not approve:
            set_status(task_, 'in_progress')
        elif task_['kind'] == 'team':
            set_status(task_, 'approved')
        else:
            task_['status'] = 'client_review'
            task_['client_review_since'] = now_iso()
        if approve and task_['deliverables']:
            latest = max(task_['deliverables'], key=lambda d: d['version'])
            latest['reviewer_name'] = profile['full_name']
            if task_['kind'] == 'order':
                latest['sent_to_client_at'] = now_iso()
        if comment:
            TASK_COMMENTS.append({'id': 'c%d' % (len(TASK_COMMENTS) + 1), 'task_id': task_['id'],
                                  'author_id': profile['id'], 'body': comment, 'created_at': now_iso()})
        task_['updated_at'] = now_iso()
        return None, None
    return None, 'unknown function'


TASK_RPCS = ('create_team_task', 'update_team_task', 'set_team_task_attachments', 'delete_team_task',
             'start_task', 'submit_deliverable', 'review_task')


def eq(q, key):
    value = q.get(key, [None])[0]
    return value[3:] if value and value.startswith('eq.') else None


def my_order_ids():
    profile = me()
    if is_team(profile['role']):
        return {o['id'] for o in ORDERS}
    if profile['role'] == 'client':
        return {o['id'] for o in ORDERS if o['client_id'] == profile['id']}
    if profile['role'] == 'freelancer':
        return {t['order_id'] for t in TASKS if t['assignee_id'] == profile['id']}
    # Сотрудник заказы (с суммами) не видит.
    return set()


def visible_tasks():
    profile = me()
    # Задачи команды — автор, исполнитель, проверяющий, отмеченные и владелец (0032); клиент — никакие.
    if own_tasks_only(profile['role']):
        return [t for t in TASKS if (t['kind'] == 'order' and t['assignee_id'] == profile['id']) or sees_team(t, profile)]
    ids = my_order_ids()
    return [t for t in TASKS if (t['kind'] == 'order' and t['order_id'] in ids) or sees_team(t, profile)]


def in_filter(q, key):
    value = q.get(key, [None])[0]
    if value and value.startswith('not.in.('):
        return 'not', value[8:-1].split(',')
    if value and value.startswith('in.('):
        return 'in', value[4:-1].split(',')
    return None, None


def rows(table, q):
    profile = me()
    role = profile['role']
    if table == 'profiles':
        if eq(q, 'id'):
            found = [p for p in PROFILES.values() if p['id'] == eq(q, 'id')]
            return found if (found and (found[0]['id'] == profile['id'] or is_team(role) or
                                        (is_employee(role) and is_employee(found[0]['role'])))) else []
        if role in ('client', 'pending'):
            return [profile]
        people = [p for p in PROFILES.values() if is_team(role) or is_employee(p['role'])]
        mode, roles = in_filter(q, 'role')
        if mode == 'not':
            people = [p for p in people if p['role'] not in roles]
        skip = q.get('id', [''])[0]
        if skip.startswith('neq.'):
            people = [p for p in people if p['id'] != skip[4:]]
        return sorted(people, key=lambda p: p['full_name'])
    if table == 'businesses':
        owner = eq(q, 'owner_id')
        if eq(q, 'id'):
            found = [b for b in BUSINESSES if b['id'] == eq(q, 'id')]
        elif owner:
            found = [b for b in BUSINESSES if b['owner_id'] == owner]
        else:
            found = BUSINESSES
        if is_team(role):
            return found
        if role == 'client':
            return [b for b in found if b['owner_id'] == profile['id']]
        if own_tasks_only(role):
            biz = {t['business_id'] for t in visible_tasks()}
            return [b for b in found if b['id'] in biz]
        return []
    if table == 'services':
        return SERVICES
    if table == 'platforms':
        return PLATFORMS
    if table == 'platform_services':
        return PLATFORM_SERVICES
    if table == 'orders':
        ids = my_order_ids()
        result = [{**o, 'businesses': {'name': next((b['name'] for b in BUSINESSES if b['id'] == o['business_id']), '')},
                   'packages': next(({'name': p['name']} for p in PACKAGES if p['id'] == o.get('package_id')), None)}
                  for o in ORDERS if o['id'] in ids]
        if eq(q, 'id'):
            result = [o for o in result if o['id'] == eq(q, 'id')]
        mode, statuses = in_filter(q, 'status')
        if mode == 'in':
            result = [o for o in result if o['status'] in statuses]
        return sorted(result, key=lambda o: o['created_at'], reverse=True)
    if table == 'order_items':
        ids = my_order_ids()
        oid = eq(q, 'order_id')
        return [i for i in ITEMS if i['order_id'] in ids and (not oid or i['order_id'] == oid)]
    if table == 'tasks':
        result = visible_tasks()
        for key_ in ('id', 'assignee_id', 'order_id', 'business_id', 'kind'):
            if eq(q, key_):
                result = [t for t in result if t[key_] == eq(q, key_)]
        for status in q.get('status', []):
            if status.startswith('neq.'):
                result = [t for t in result if t['status'] != status[4:]]
                continue
            allowed = status[4:-1].split(',') if status.startswith('in.(') else [status[3:]]
            result = [t for t in result if t['status'] in allowed]
        due = q.get('due_date', [''])[0]
        if due.startswith('lt.'):
            result = [t for t in result if t['due_date'] and t['due_date'] < due[3:]]
        if 'publish_at' in q:
            result = [t for t in result if t['publish_at']]
        mode, services = in_filter(q, 'service_id')
        if mode == 'in':
            result = [t for t in result if t['service_id'] in services]
        if 'platform_id.eq.instagram' in q.get('or', [''])[0]:
            result = [t for t in result if t['platform_id'] in (None, 'instagram')]
        if q.get('order', [''])[0].startswith('client_review_since'):
            result = sorted(result, key=lambda t: t.get('client_review_since') or '')
        return result
    if table == 'approvals':
        tid = eq(q, 'task_id')
        visible = {t['id'] for t in visible_tasks()}
        return sorted([a for a in APPROVALS if a['task_id'] in visible and (not tid or a['task_id'] == tid)],
                      key=lambda a: a['created_at'], reverse=True)
    if table == 'welcome_kits':
        return [k for k in WELCOME_KITS if k['business_id'] in visible_business_ids()]
    if table == 'idea_batches':
        week = eq(q, 'week_start')
        return [b for b in IDEA_BATCHES if b['business_id'] in visible_business_ids() and (not week or b['week_start'] == week)]
    if table == 'task_ideas':
        week = eq(q, 'week_start')
        return [i for i in TASK_IDEAS if i['business_id'] in visible_business_ids() and (not week or i['week_start'] == week)]
    if table == 'agent_runs':
        result = visible_agent_runs()
        for key_ in ('agent', 'task_id', 'created_by'):
            if eq(q, key_):
                result = [r for r in result if r[key_] == eq(q, key_)]
        if eq(q, 'chat'):
            result = [r for r in result if r['chat'] == (eq(q, 'chat') == 'true')]
        if 'chat.eq.false' in q.get('or', [''])[0]:
            result = [r for r in result if not r['chat'] or r['task_id']]
        return result
    if table == 'agency_settings':
        return [AGENCY] if role != 'pending' else []
    if table == 'packages':
        return [p for p in PACKAGES if p['active'] or is_manager(role)]
    if table == 'promo_codes':
        return PROMO_CODES if role == 'admin' else []
    if table == 'payments':
        ids = my_order_ids()
        result = [p for p in PAYMENTS if p['order_id'] in ids]
        for key_ in ('id', 'order_id', 'status', 'provider'):
            if eq(q, key_):
                result = [p for p in result if p[key_] == eq(q, key_)]
        return sorted(result, key=lambda p: p['receipt_no'] or 0,
                      reverse=q.get('order', [''])[0] == 'receipt_no.desc')
    if table == 'deliverables':
        tid = eq(q, 'task_id')
        # Заметка для менеджера в базе лежит отдельно (deliverable_notes) — здесь её не отдаём.
        return [{k: v for k, v in d.items() if k != 'note'}
                for t in visible_tasks() for d in t['deliverables'] if not tid or d['task_id'] == tid]
    if table == 'deliverable_notes':
        if not is_employee(role):
            return []
        tid = eq(q, 'task_id')
        return [{'deliverable_id': d['id'], 'task_id': d['task_id'], 'note': d['note']}
                for t in visible_tasks() for d in t['deliverables']
                if d.get('note') and (not tid or d['task_id'] == tid)]
    if table == 'messages':
        ids = my_order_ids() if role != 'freelancer' else set()
        oid = eq(q, 'order_id')
        return [m for m in MESSAGES if m['order_id'] in ids and (not oid or m['order_id'] == oid)]
    if table == 'team_messages':
        cid = eq(q, 'conversation_id')
        return [m for m in TEAM_MESSAGES if can_access(m['conversation_id']) and (not cid or m['conversation_id'] == cid)]
    if table == 'chat_reactions':
        cid = eq(q, 'chat_id')
        return [r for r in REACTIONS if r['chat_id'] == cid and can_access_chat(r['chat'], cid)]
    if table == 'deleted_chat_messages':
        cid = eq(q, 'chat_id')
        return [d for d in DELETED.values() if d['chat_id'] == cid] if role == 'admin' else []
    if table in ('task_watchers', 'task_history'):
        visible = {t['id'] for t in visible_tasks()}
        tid = eq(q, 'task_id')
        source = TASK_WATCHERS if table == 'task_watchers' else TASK_HISTORY
        return [r for r in source if r['task_id'] in visible and (not tid or r['task_id'] == tid)]
    if table == 'task_comments':
        if not is_employee(role):
            return []
        visible = {t['id'] for t in visible_tasks()}
        tid = eq(q, 'task_id')
        return [c for c in TASK_COMMENTS if c['task_id'] in visible and (not tid or c['task_id'] == tid)]
    if table == 'social_accounts':
        if role == 'client' and not [b for b in BUSINESSES if b['owner_id'] == profile['id'] and b['id'] == BIZ]:
            return []
        return [{'id': 's1', 'business_id': BIZ, 'platform': 'instagram', 'username': 'cafe_aroma',
                 'token_expires_at': day(50), 'insights_error': None, 'insights_updated_at': day(0, 6),
                 'created_at': day(-30)}]
    if table == 'account_snapshots':
        return SNAPSHOTS if BIZ in {b['id'] for b in rows('businesses', {})} else []
    if table == 'post_metrics':
        return POST_METRICS if BIZ in {b['id'] for b in rows('businesses', {})} else []
    return []


def create_order(data):
    """Заказ по тем же правилам, что create_order в базе (упрощённо)."""
    profile = me()
    business = next((b for b in BUSINESSES if b['id'] == data.get('p_business_id') and b['owner_id'] == profile['id']), None)
    if not business:
        return None, 'business not found'
    order_id = 'e0000000-0000-4000-8000-%012d' % (len(ORDERS) + 1)
    lines, total = [], 0
    for raw in data.get('p_items') or []:
        qty = int(raw.get('quantity') or 0)
        if qty <= 0:
            continue
        service = next((sv for sv in SERVICES if sv['id'] == raw.get('service_id')), None)
        platform = raw.get('platform_id')
        if not service:
            return None, 'unknown service'
        if service['per_platform']:
            offer = next((o for o in PLATFORM_SERVICES if o['platform_id'] == platform and o['service_id'] == service['id'] and o['active']), None)
            if not offer:
                return None, 'unknown service'
            price = offer['price_amd']
        else:
            if platform:
                return None, 'unknown service'
            price = service['price_amd']
        lines.append(item('i%d' % (len(ITEMS) + len(lines) + 1), order_id, service['id'], platform, qty, price))
        total += qty * price
    if not lines:
        return None, 'order is empty'
    budget = int(data.get('p_ad_budget_amd') or 0)
    promo, discount = None, 0
    if (data.get('p_promo_code') or '').strip():
        promo, error = valid_promo(data['p_promo_code'])
        if error:
            return None, error
        discount = min(total, promo['amount_amd'] or round(total * promo['percent'] / 100))
    if total - discount + budget <= 0:
        return None, 'order total must be positive'
    ITEMS.extend(lines)
    ORDERS.append({
        'id': order_id, 'business_id': business['id'], 'client_id': profile['id'], 'billing': data.get('p_billing'),
        'publishing': data.get('p_publishing'), 'status': 'pending_payment', 'items_total_amd': total,
        'ad_budget_amd': budget, 'total_amd': total - discount + budget,
        'notes': (data.get('p_notes') or '').strip() or None, 'paid_at': None, 'created_at': now_iso(),
        'promo_code': promo['code'] if promo else None, 'discount_amd': discount,
    })
    return order_id, None


def valid_promo(code):
    promo = next((p for p in PROMO_CODES if p['code'] == (code or '').strip().upper() and p['active']), None)
    if not promo:
        return None, 'promo code not found'
    if promo['valid_until'] and promo['valid_until'] < NOW.date().isoformat():
        return None, 'promo code expired'
    if promo['max_uses'] and promo['used_count'] >= promo['max_uses']:
        return None, 'promo code used up'
    return promo, None


def client_decide(task_ids, approve, comment, marks):
    """Решение клиента по задачам на согласовании (как client_decide / client_approve_many)."""
    profile = me()
    mine = {o['id'] for o in ORDERS if o['client_id'] == profile['id']}
    done = 0
    for t in TASKS:
        if t['id'] not in task_ids or t['order_id'] not in mine or t['status'] != 'client_review':
            continue
        latest = max(t['deliverables'], key=lambda d: d['version'], default=None)
        files = latest['files'] if latest else []
        if not approve and any(m.get('file_path') not in files or not (m.get('note') or '').strip() for m in marks):
            return 0, 'invalid marks'
        APPROVALS.append({
            'id': 'ap%d' % (len(APPROVALS) + 1), 'task_id': t['id'], 'deliverable_id': latest['id'] if latest else None,
            'decision': 'approved' if approve else 'changes_requested',
            'comment': None if approve else ((comment or '').strip() or None), 'auto': False, 'created_at': now_iso(),
            'approval_marks': [] if approve else [
                {'position': i + 1, 'file_path': m['file_path'], 'x': m['x'], 'y': m['y'],
                 'at_seconds': m.get('at_seconds'), 'note': m['note'].strip()} for i, m in enumerate(marks)],
        })
        t['status'] = 'approved' if approve else 'changes_requested'
        t['client_review_since'] = None
        done += 1
    return done, None if done else 'nothing to approve'


def session_for(profile):
    return {
        'access_token': 'demo:' + profile['email'], 'refresh_token': 'demo', 'token_type': 'bearer', 'expires_in': 86400,
        'expires_at': int(time.time()) + 86400,
        'user': {'id': profile['id'], 'email': profile['email'], 'aud': 'authenticated', 'role': 'authenticated',
                 'app_metadata': {}, 'user_metadata': {}, 'created_at': profile['created_at']},
    }


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', '*')
        self.send_header('Access-Control-Expose-Headers', 'Content-Range')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def reply(self, data, status=200, headers=None):
        body = b'' if self.command == 'HEAD' else json.dumps(data).encode()
        self.send_response(status)
        self.cors()
        self.send_header('Content-Type', 'application/json')
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        length = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(length) or b'{}') if length else {}

    def wants_object(self):
        return 'vnd.pgrst.object' in (self.headers.get('Accept') or '')

    def api(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        path = url.path
        auth = self.headers.get('Authorization') or ''
        REQUEST.email = auth[len('Bearer demo:'):] if auth.startswith('Bearer demo:') else None

        if path == '/auth/v1/token':
            data = self.body()
            email = (data.get('email') or '').lower()
            profile = PROFILES.get(email)
            if not profile or PASSWORDS.get(email) != data.get('password'):
                return self.reply({'error': 'invalid_grant', 'error_description': 'Invalid login credentials',
                                   'code': 'invalid_credentials', 'msg': 'Invalid login credentials'}, 400)
            return self.reply(session_for(profile))
        if path == '/auth/v1/logout':
            self.send_response(204)
            self.cors()
            self.end_headers()
            return None
        if path.startswith('/auth/v1/user') and self.command == 'PUT':
            password = self.body().get('password')
            if me() is PENDING_ANON or not password:
                return self.reply({'msg': 'not signed in'}, 401)
            PASSWORDS[me()['email']] = password
            return self.reply({'id': me()['id'], 'email': me()['email'], 'aud': 'authenticated'})
        if path.startswith('/auth/v1/user'):
            return self.reply({'id': me()['id'], 'email': me()['email'], 'aud': 'authenticated'})
        if path.startswith('/auth/v1/signup'):
            data = self.body()
            email = (data.get('email') or '').strip().lower()
            meta = data.get('data') or {}
            if not email or email in PROFILES:
                return self.reply({'code': 'user_already_exists', 'msg': 'User already registered'}, 422)
            role = 'pending' if meta.get('account_type') == 'staff' else 'client'
            profile = person('u0000000-0000-4000-8000-%012d' % (len(PROFILES) + 1),
                             meta.get('full_name') or email, email, role)
            PROFILES[email] = profile
            PASSWORDS[email] = data.get('password')
            return self.reply(session_for(profile))

        # Личный кабинет: человек меняет только свой профиль и только разрешённые поля.
        if self.command == 'PATCH' and path == '/rest/v1/profiles':
            data, profile = self.body(), me()
            if eq(q, 'id') != profile['id'] or profile is PENDING_ANON:
                return self.reply([])
            profile.update({k: v for k, v in data.items() if k in PROFILE_FIELDS})
            return self.reply(profile if self.wants_object() else [profile])

        if path.startswith('/storage/v1/object/public/avatars/'):
            photo = PHOTOS.get(urllib.parse.unquote(path[len('/storage/v1/object/public/avatars/'):]))
            if not photo:
                return self.reply({'error': 'not found'}, 404)
            self.send_response(200)
            self.cors()
            self.send_header('Content-Type', photo[0])
            self.send_header('Content-Length', str(len(photo[1])))
            self.end_headers()
            self.wfile.write(photo[1])
            return None
        # Логотипы (bucket brand): публичные ссылки, загрузка — владельцу бизнеса или менеджеру.
        if path.startswith('/storage/v1/object/public/brand/'):
            logo = BRAND_FILES.get(urllib.parse.unquote(path[len('/storage/v1/object/public/brand/'):]))
            if not logo:
                return self.reply({'error': 'not found'}, 404)
            self.send_response(200)
            self.cors()
            self.send_header('Content-Type', logo[0])
            self.send_header('Content-Length', str(len(logo[1])))
            self.end_headers()
            self.wfile.write(logo[1])
            return None
        if path.startswith('/storage/v1/object/brand/') and self.command == 'POST':
            name = urllib.parse.unquote(path[len('/storage/v1/object/brand/'):])
            if not can_edit_business(name.split('/')[0]):
                return self.reply({'statusCode': '403', 'error': 'Unauthorized',
                                   'message': 'new row violates row-level security policy'}, 403)
            length = int(self.headers.get('Content-Length') or 0)
            BRAND_FILES[name] = (self.headers.get('Content-Type') or 'image/png', self.rfile.read(length))
            return self.reply({'Key': 'brand/' + name, 'Id': name})
        if path == '/storage/v1/object/brand' and self.command == 'DELETE':
            removed = [n for n in self.body().get('prefixes', []) if can_edit_business(n.split('/')[0]) and BRAND_FILES.pop(n, None)]
            return self.reply([{'name': n} for n in removed])
        if path.startswith('/storage/v1/object/avatars/') and self.command == 'POST':
            name = urllib.parse.unquote(path[len('/storage/v1/object/avatars/'):])
            if name.split('/')[0] != me()['id']:
                return self.reply({'statusCode': '403', 'error': 'Unauthorized',
                                   'message': 'new row violates row-level security policy'}, 403)
            length = int(self.headers.get('Content-Length') or 0)
            PHOTOS[name] = (self.headers.get('Content-Type') or 'image/jpeg', self.rfile.read(length))
            return self.reply({'Key': 'avatars/' + name, 'Id': name})
        if path == '/storage/v1/object/avatars' and self.command == 'DELETE':
            removed = [n for n in self.body().get('prefixes', []) if n.split('/')[0] == me()['id'] and PHOTOS.pop(n, None)]
            return self.reply([{'name': n} for n in removed])

        # Файлы чатов: загрузка в свою папку доступного чата, ссылки на скачивание.
        if path.startswith('/storage/v1/object/chat-files/') and self.command == 'POST':
            name = urllib.parse.unquote(path[len('/storage/v1/object/chat-files/'):])
            parts = name.split('/')
            if len(parts) != 4 or parts[2] != me()['id'] or not can_access_chat(parts[0], parts[1]):
                return self.reply({'statusCode': '403', 'error': 'Unauthorized',
                                   'message': 'new row violates row-level security policy'}, 403)
            length = int(self.headers.get('Content-Length') or 0)
            CHAT_FILES[name] = (self.headers.get('Content-Type') or 'application/octet-stream', self.rfile.read(length))
            return self.reply({'Key': 'chat-files/' + name, 'Id': name})
        if path == '/storage/v1/object/sign/chat-files' and self.command == 'POST':
            paths = self.body().get('paths') or []
            return self.reply([{'path': p, 'error': None if p in CHAT_FILES else 'not found',
                                'signedURL': '/object/sign/chat-files/%s?token=demo' % urllib.parse.quote(p)
                                if p in CHAT_FILES else None} for p in paths])
        if path.startswith('/storage/v1/object/sign/chat-files/'):
            found = CHAT_FILES.get(urllib.parse.unquote(path[len('/storage/v1/object/sign/chat-files/'):]))
            if not found:
                return self.reply({'error': 'not found'}, 404)
            self.send_response(200)
            self.cors()
            self.send_header('Content-Type', found[0])
            self.send_header('Content-Length', str(len(found[1])))
            self.end_headers()
            self.wfile.write(found[1])
            return None

        if path.startswith('/rest/v1/rpc/'):
            fn, data = path.rsplit('/', 1)[1], self.body()
            if fn == 'set_user_role':
                target = by_id(data.get('target_user'))
                if me()['role'] != 'admin':
                    return self.reply({'message': 'only the administrator can change roles'}, 400)
                if not target or target['id'] == me()['id'] or target['role'] == 'admin' or data.get('new_role') == 'admin':
                    return self.reply({'message': 'this role cannot be changed'}, 400)
                target['role'] = data.get('new_role')
                return self.reply(None)
            if fn == 'set_job_title':
                target = by_id(data.get('target_user'))
                if me()['role'] != 'admin':
                    return self.reply({'message': 'only the administrator can change job titles'}, 400)
                if not target or not is_employee(target['role']):
                    return self.reply({'message': 'user not found'}, 400)
                target['job_title'] = (data.get('new_title') or '').strip() or None
                return self.reply(None)
            if fn == 'task_order_notes':
                found = [t for t in visible_tasks() if t['id'] == data.get('p_task_id')]
                order = found and next((o for o in ORDERS if o['id'] == found[0]['order_id']), None)
                return self.reply(order['notes'] if order else None)
            if fn in TASK_RPCS:
                result, error = task_rpc(fn, data)
                return self.reply({'message': error}, 400) if error else self.reply(result)
            if fn == 'create_order':
                order_id, error = create_order(data)
                return self.reply(order_id) if order_id else self.reply({'message': error}, 400)
            if fn in ('accept_task_idea', 'dismiss_task_idea'):
                order_id, error = decide_idea(data.get('p_idea_id'), fn == 'accept_task_idea')
                return self.reply({'message': error}, 400) if error else self.reply(order_id)
            if fn == 'create_package_order':
                order_id, error = create_package_order(data)
                return self.reply(order_id) if order_id else self.reply({'message': error}, 400)
            if fn == 'check_promo':
                promo, error = valid_promo(data.get('p_code'))
                return self.reply({'message': error}, 400) if error else self.reply(
                    {k: promo[k] for k in ('code', 'percent', 'amount_amd')})
            if fn in ('client_decide', 'client_approve_many'):
                single = fn == 'client_decide'
                approve = data.get('p_approve') if single else True
                marks = data.get('p_marks') or []
                if single and not approve and not (data.get('p_comment') or '').strip() and not marks:
                    return self.reply({'message': 'describe what to change'}, 400)
                done, error = client_decide([data.get('p_task_id')] if single else data.get('p_task_ids') or [],
                                            approve, data.get('p_comment'), marks)
                if single and error == 'nothing to approve':
                    error = 'task is not waiting for your decision'
                return self.reply({'message': error}, 400) if error else self.reply(None if single else done)
            if fn in ('my_chats', 'touch_last_seen', 'chat_info', 'mark_chat_read', 'pin_chat_message',
                      'edit_chat_message', 'delete_chat_message', 'react_to_message', 'forward_chat_message'):
                result, error = chat_rpc(fn, data)
                return self.reply({'message': error}, 400) if error else self.reply(result)
            if fn == 'owner_dashboard':
                return self.reply(owner_dashboard()) if is_manager(me()['role']) else \
                    self.reply({'message': 'only managers can see the dashboard'}, 400)
            if fn == 'apply_manager_plan':
                count, error = apply_manager_plan(data.get('p_run_id'))
                return self.reply({'message': error}, 400) if error else self.reply(count)
            if fn == 'my_conversations':
                return self.reply(my_conversations())
            if fn == 'mark_conversation_read':
                READ_AT[(me()['id'], data.get('p_conversation_id'))] = now_iso()
                return self.reply(None)
            if fn == 'open_direct_conversation':
                pair = {me()['id'], data.get('p_user_id')}
                cid = next((k for k, c in CONVERSATIONS.items() if c['members'] == pair), None)
                if not cid:
                    cid = 'dc000000-0000-4000-8000-%012d' % len(CONVERSATIONS)
                    CONVERSATIONS[cid] = {'kind': 'direct', 'members': pair}
                return self.reply(cid)
            return self.reply(None)

        if path in ('/rest/v1/agency_settings', '/rest/v1/promo_codes') and self.command in ('PATCH', 'POST'):
            data = self.body()
            if me()['role'] != 'admin':
                return self.reply([])
            if path.endswith('agency_settings'):
                AGENCY.update({k: v for k, v in data.items() if k in ('auto_approve_days', 'usd_rate_amd', 'eur_rate_amd')})
                return self.reply([AGENCY])
            if self.command == 'PATCH':
                promo = next((p for p in PROMO_CODES if p['code'] == eq(q, 'code')), None)
                if promo:
                    promo.update({k: v for k, v in data.items() if k == 'active'})
                return self.reply([promo] if promo else [])
            code = (data.get('code') or '').upper()
            if not re.fullmatch(r'[A-Z0-9_-]{3,32}', code) or any(p['code'] == code for p in PROMO_CODES):
                return self.reply({'message': 'duplicate key value violates unique constraint "promo_codes_pkey"'}, 409)
            promo = {'code': code, 'percent': data.get('percent'), 'amount_amd': data.get('amount_amd'),
                     'max_uses': data.get('max_uses'), 'used_count': 0, 'valid_until': data.get('valid_until'),
                     'active': True, 'created_at': now_iso()}
            PROMO_CODES.insert(0, promo)
            return self.reply([promo], 201)

        # Картинки из чата с агентом: свои — автору, все — менеджерам.
        if path == '/storage/v1/object/sign/agent-files' and self.command == 'POST':
            mine = lambda p: p.split('/')[0] == me()['id'] or is_manager(me()['role'])
            paths = [p for p in self.body().get('paths') or [] if mine(p) and p in AGENT_FILES]
            return self.reply([{'path': p, 'error': None,
                                'signedURL': '/object/sign/agent-files/%s?token=demo' % urllib.parse.quote(p)} for p in paths])
        if path.startswith('/storage/v1/object/sign/agent-files/'):
            png = AGENT_FILES.get(urllib.parse.unquote(path[len('/storage/v1/object/sign/agent-files/'):]))
            if not png:
                return self.reply({'error': 'not found'}, 404)
            self.send_response(200)
            self.cors()
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(png)))
            self.end_headers()
            self.wfile.write(png)
            return None

        # «Передать человеку»: копия файла черновика агента в папку задачи (как storage.copy).
        if path == '/storage/v1/object/copy' and self.command == 'POST':
            data = self.body()
            source = AGENT_FILES if data.get('bucketId') == 'agent-files' else DELIVERABLE_FILES
            target = data.get('destinationKey') or ''
            if (data.get('destinationBucket') != 'deliverables' or not is_manager(me()['role'])
                    or data.get('sourceKey') not in source or target.split('/')[0] not in {t['id'] for t in visible_tasks()}):
                return self.reply({'error': 'not found', 'message': 'Object not found'}, 400)
            DELIVERABLE_FILES[target] = source[data['sourceKey']]
            return self.reply({'Key': 'deliverables/' + target})

        # Материалы задач: подписанные ссылки и сами картинки.
        if path == '/storage/v1/object/sign/deliverables' and self.command == 'POST':
            visible = {t['id'] for t in visible_tasks()}
            paths = [p for p in self.body().get('paths') or [] if p.split('/')[0] in visible]
            return self.reply([{'path': p, 'error': None if p in DELIVERABLE_FILES else 'not found',
                                'signedURL': '/object/sign/deliverables/%s?token=demo' % urllib.parse.quote(p)
                                if p in DELIVERABLE_FILES else None} for p in paths])
        if path.startswith('/storage/v1/object/sign/deliverables/'):
            png = DELIVERABLE_FILES.get(urllib.parse.unquote(path[len('/storage/v1/object/sign/deliverables/'):]))
            if not png:
                return self.reply({'error': 'not found'}, 404)
            self.send_response(200)
            self.cors()
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(png)))
            self.end_headers()
            self.wfile.write(png)
            return None

        # Пакеты: меняет менеджер или владелец (как правила в базе).
        if path in ('/rest/v1/packages', '/rest/v1/package_items') and self.command in ('POST', 'PATCH', 'DELETE'):
            if not is_manager(me()['role']):
                return self.reply({'message': 'new row violates row-level security policy'}, 403)
            data = self.body() if self.command != 'DELETE' else {}
            if path.endswith('packages') and self.command == 'POST':
                package = {'id': 'pa000000-0000-4000-8000-%012d' % (len(PACKAGES) + 1), 'description': {}, 'active': True,
                           'sort_order': 0, 'created_at': now_iso(), **data, 'package_items': []}
                PACKAGES.append(package)
                return self.reply(package if self.wants_object() else [package], 201)
            if path.endswith('packages'):
                package = next((p for p in PACKAGES if p['id'] == eq(q, 'id')), None)
                if package:
                    package.update({k: v for k, v in data.items() if k in ('name', 'description', 'price_amd', 'active')})
                return self.reply([package] if package else [])
            if self.command == 'DELETE':
                package = next((p for p in PACKAGES if p['id'] == eq(q, 'package_id')), None)
                if package:
                    package['package_items'] = []
                return self.reply([])
            rows_ = data if isinstance(data, list) else [data]
            for row in rows_:
                package = next((p for p in PACKAGES if p['id'] == row.get('package_id')), None)
                if package:
                    package['package_items'].append(row)
            return self.reply(rows_, 201)

        if self.command == 'PATCH' and path == '/rest/v1/businesses':
            # Профиль бизнеса меняет владелец или менеджер (как правило в базе).
            data, profile, q = self.body(), me(), urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            business = next((b for b in BUSINESSES if b['id'] == eq(q, 'id')), None)
            if not business or not (business['owner_id'] == profile['id'] or is_manager(profile['role'])):
                return self.reply([])
            colors = data.get('brand_colors', business.get('brand_colors') or [])
            if len(colors) > 5 or not all(re.fullmatch(r'#[0-9A-Fa-f]{6}', c) for c in colors):
                return self.reply({'message': 'violates check constraint "businesses_brand_colors_check"'}, 400)
            logo = data.get('logo_path', business.get('logo_path'))
            if logo and not logo.startswith(business['id'] + '/'):
                return self.reply({'message': 'violates check constraint "businesses_check"'}, 400)
            business.update({k: v for k, v in data.items() if k in BUSINESS and k not in ('id', 'owner_id')})
            business['updated_at'] = now_iso()
            return self.reply(business if self.wants_object() else [business])

        if self.command == 'POST' and path == '/rest/v1/businesses':
            data, profile = self.body(), me()
            if profile['role'] != 'client':
                return self.reply({'message': 'new row violates row-level security policy'}, 403)
            business = {**{k: None for k in BUSINESS}, **data, 'id': 'b0000000-0000-4000-8000-%012d' % (len(BUSINESSES) + 1),
                        'owner_id': profile['id'], 'created_at': now_iso(), 'updated_at': now_iso()}
            BUSINESSES.append(business)
            return self.reply(business if self.wants_object() else [business], 201)

        if self.command == 'POST' and path in ('/rest/v1/team_messages', '/rest/v1/messages'):
            data = self.body()
            chat = 'team' if path.endswith('team_messages') else 'order'
            cid = data.get(chat_column(chat))
            attachments = data.get('attachments') or []
            call = data.get('call')
            if call and not re.fullmatch(r'marketing-[a-z0-9]{20}', str(call.get('room'))):
                return self.reply({'message': 'invalid call'}, 400)
            if not can_access_chat(chat, cid) or not ((data.get('body') or '').strip() or attachments or call):
                return self.reply({'message': 'new row violates row-level security policy'}, 403)
            if any(a.get('path') not in CHAT_FILES for a in attachments):
                return self.reply({'message': 'attachment not found'}, 400)
            message = new_message(chat, cid, data.get('body'), attachments, data.get('reply_to_id'), call)
            return self.reply(message if self.wants_object() else [message], 201)

        if path.startswith('/rest/v1/'):
            data = rows(path.split('/')[3], q)
            if q.get('order', [''])[0].startswith('created_at.desc'):
                data = sorted(data, key=lambda r: r.get('created_at') or '', reverse=True)
            if 'limit' in q:
                data = data[:int(q['limit'][0])]
            if self.wants_object():
                if data:
                    return self.reply(data[0])
                return self.reply({'message': 'not found', 'code': 'PGRST116'}, 406)
            return self.reply(data, headers={'Content-Range': '0-%d/%d' % (max(len(data) - 1, 0), len(data))})

        if path == '/functions/v1/ai-agent' and self.command == 'POST':
            data = self.body()
            if data.get('mode') == 'attach':
                error = attach_run(data)
                return self.reply({'error': error}, 400) if error else self.reply({'ok': True})
            run_id, error = start_agent(data)
            return self.reply({'error': error}, 400) if error else self.reply({'run_id': run_id})

        if path == '/functions/v1/client-ai' and self.command == 'POST':
            result, error = start_client_ai(self.body())
            return self.reply({'error': error}, 400) if error else self.reply(result)

        # Оплата без банка (PAYMENT_MODE=test): клиент создаёт платёж, подтверждает только владелец.
        if path == '/functions/v1/payment-create' and self.command == 'POST':
            order_id = self.body().get('order_id')
            order = next((o for o in ORDERS if o['id'] == order_id), None)
            if not order or order['client_id'] != me()['id']:
                return self.reply({'error': 'order not found'}, 404)
            if order['status'] != 'pending_payment':
                return self.reply({'error': 'order already paid'}, 409)
            payment = {'id': 'p0000000-0000-4000-8000-%012d' % (len(PAYMENTS) + 1), 'order_id': order['id'],
                       'provider': 'test', 'amount_amd': order['total_amd'], 'status': 'created', 'receipt_no': None,
                       'created_at': now_iso(), 'updated_at': now_iso()}
            PAYMENTS.append(payment)
            return self.reply({'mode': 'test', 'payment_id': payment['id']})
        if path == '/functions/v1/payment-test-confirm' and self.command == 'POST':
            if me()['role'] != 'admin':
                return self.reply({'error': 'only the owner can confirm test payments'}, 403)
            data = self.body()
            payment = next((p for p in PAYMENTS if p['id'] == data.get('payment_id') and p['provider'] == 'test'), None)
            if not payment:
                return self.reply({'error': 'payment not found'}, 404)
            order = next(o for o in ORDERS if o['id'] == payment['order_id'])
            if data.get('success'):
                payment.update(status='succeeded', updated_at=now_iso(),
                               receipt_no=max([p['receipt_no'] or 0 for p in PAYMENTS]) + 1)
                if order['status'] == 'pending_payment':
                    order.update(status='paid', paid_at=now_iso())
            else:
                payment.update(status='failed', updated_at=now_iso())
            return self.reply({'ok': True})
        if path == '/functions/v1/ai-assistant' and self.command == 'POST':
            # Настоящего AI в просмотре нет — показываем, как выглядит ответ помощника.
            if self.body().get('task_id'):
                text = ('Демо-ответ (в просмотровой версии AI не подключён).\n\n'
                        '1. Суть задачи: пост для Cafe Aroma о новом сезонном напитке.\n'
                        '2. Что важно клиенту: тёплые тона, логотип справа, без красного.\n'
                        '3. Шаги: формат 1080×1350, фото напитка крупно, цена — уточнить у менеджера.\n'
                        '4. Вопрос менеджеру: есть ли акция на первую неделю?')
            else:
                text = ('Демо-ответ (в просмотровой версии AI не подключён).\n\n'
                        'Сначала — правки клиента по посту №2: заменить фон.\n'
                        'Сегодня срок — сторис №1.\n'
                        'Дальше — рилс №1 до пятницы.\n\n'
                        'Главное сейчас: правки по посту №2.')
            return self.reply({'text': text})

        # Хранилище файлов и серверные функции в просмотре не работают.
        return self.reply([] if path.startswith('/storage/') else {'error': 'недоступно в просмотровой версии'},
                          200 if path.startswith('/storage/') else 501)

    def do_POST(self):
        self.api()

    def do_PATCH(self):
        self.api()

    def do_PUT(self):
        self.api()

    def do_DELETE(self):
        self.api()

    def do_HEAD(self):
        if urllib.parse.urlparse(self.path).path.startswith('/rest/'):
            return self.api()
        return super().do_HEAD()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == '/__reset':
            # Вернуть демо-данные к исходным: сервер перезапускает сам себя.
            self.reply({'reset': True})
            self.wfile.flush()
            threading.Thread(target=lambda: (time.sleep(0.3), os.execv(sys.executable, [sys.executable] + sys.argv)),
                             daemon=True).start()
            return None
        if path.startswith(('/rest/', '/auth/', '/storage/', '/functions/')):
            return self.api()
        if path == '/' or not os.path.isfile(os.path.join(ROOT, path.lstrip('/'))):
            self.path = '/index.html'
        return super().do_GET()


if __name__ == '__main__':
    print(f'Просмотр: http://localhost:{PORT}  (Ctrl+C — остановить)', flush=True)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
