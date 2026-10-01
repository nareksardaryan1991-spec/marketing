#!/usr/bin/env python3
"""Просмотровый сервер: собранное веб-приложение + поддельный Supabase с демо-данными.

Нужен, чтобы посмотреть приложение без Docker и без облака. Работает только на этом
компьютере (127.0.0.1). Сообщения в чатах (с файлами, реакциями, правками) и личный кабинет сохраняются в памяти,
пока сервер запущен; одобрение и правки клиента, промокоды и настройки — тоже.
Остальные действия (оплата, назначение) не сохраняются.

Запуск: ./scripts/preview.sh  (или python3 scripts/preview/mock_server.py <папка сборки> <порт>)
Вход: client@demo.am / manager@demo.am / designer@demo.am / freelancer@demo.am, пароль demo1234.
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


def now_iso():
    return iso(datetime.now(timezone.utc))


# Демо-заказ оплачен в этом месяце (иначе в первые дни месяца выручка «пропадает» из панели).
PAID_AT = max(day(-10), iso(NOW.replace(day=1, hour=0, minute=0, second=0, microsecond=0)))


# ---------- Люди ----------
CLIENT = 'c0000000-0000-4000-8000-000000000001'
MANAGER = 'a0000000-0000-4000-8000-000000000002'
DESIGNER = 'd0000000-0000-4000-8000-000000000003'
FREELANCER = 'f0000000-0000-4000-8000-000000000004'


def person(pid, name, email, role):
    return {'id': pid, 'full_name': name, 'email': email, 'role': role, 'language': 'ru',
            'phone': None, 'avatar_path': None, 'cover_path': None, 'accent_color': None, 'bio': None,
            'last_seen_at': None, 'chat_wallpaper': None, 'created_at': day(-40)}


ADMIN = 'ad000000-0000-4000-8000-000000000005'
NEWBIE = 'ab000000-0000-4000-8000-000000000006'
PROFILES = {
    'admin@demo.am': person(ADMIN, 'Арам Владелец', 'admin@demo.am', 'admin'),
    'newbie@demo.am': person(NEWBIE, 'Лусине Мартиросян', 'newbie@demo.am', 'pending'),
    'client@demo.am': person(CLIENT, 'Анна Петросян', 'client@demo.am', 'client'),
    'manager@demo.am': person(MANAGER, 'Нарек', 'manager@demo.am', 'manager'),
    'designer@demo.am': person(DESIGNER, 'Ани Саргсян', 'designer@demo.am', 'designer'),
    'freelancer@demo.am': person(FREELANCER, 'Давид Акопян', 'freelancer@demo.am', 'freelancer'),
}
PASSWORDS = {email: PASSWORD for email in PROFILES}
# Не вошедший зритель: ничего не видит.
PENDING_ANON = person('00000000-0000-4000-8000-000000000000', '', '', 'pending')


def by_id(user_id):
    return next((p for p in PROFILES.values() if p['id'] == user_id), None)


def is_employee(role):
    return role not in ('client', 'pending')


def is_team(role):
    return role not in ('client', 'pending', 'freelancer')


def is_manager(role):
    return role in ('manager', 'admin')

# Фото из личного кабинета (bucket avatars): путь -> (тип, байты). Живут, пока сервер запущен.
PHOTOS = {}
PROFILE_FIELDS = ('full_name', 'phone', 'language', 'avatar_path', 'cover_path', 'accent_color', 'bio',
                  'chat_wallpaper')

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
    'website_url': None, 'created_at': day(-40), 'updated_at': day(-2),
}


BUSINESSES.append(BUSINESS)


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
]

# Оплаты, квитанции, решения клиента, промокоды, настройки агентства.
PAYMENTS = [{'id': 'p0000000-0000-4000-8000-000000000001', 'order_id': ORDER, 'provider': 'idram',
             'amount_amd': 63000, 'status': 'succeeded', 'receipt_no': 1, 'updated_at': PAID_AT,
             'created_at': day(-10)}]
APPROVALS = []
PROMO_CODES = [{'code': 'AUTUMN10', 'percent': 10, 'amount_amd': None, 'max_uses': 50, 'used_count': 3,
                'valid_until': day(30)[:10], 'active': True, 'created_at': day(-5)}]
AGENCY = {'id': True, 'auto_approve_days': 3, 'updated_at': day(-5)}

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
     'body': 'Всем доброе утро! Сегодня в 11:00 короткая планёрка по Cafe Aroma.', 'created_at': day(0, 5)},
    {'id': 'tm2', 'conversation_id': TEAM_ID, 'author_id': DESIGNER, 'author_name': 'Ани Саргсян',
     'body': 'Буду. Пост №3 уже на проверке 👍', 'created_at': day(0, 6)},
    {'id': 'tm3', 'conversation_id': DIRECT_ID, 'author_id': MANAGER, 'author_name': 'Нарек',
     'body': 'Ани, для поста №4 возьми фото с новой витрины.', 'created_at': day(0, 7)},
    {'id': 'tm4', 'conversation_id': DIRECT_ID, 'author_id': DESIGNER, 'author_name': 'Ани Саргсян',
     'body': 'Хорошо, сделаю до вечера.', 'created_at': day(0, 8)},
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
PROFILES['designer@demo.am']['last_seen_at'] = day(0, 7)


OPEN_STATUSES = ('new', 'assigned', 'in_progress', 'internal_review', 'changes_requested')


def owner_dashboard():
    """Панель владельца (как owner_dashboard в миграции 0017, упрощённо)."""
    today, month = day(0)[:10], day(0)[:7]
    admin = me()['role'] == 'admin'
    paid = [o for o in ORDERS if o['paid_at']]
    counts = {}
    for o in ORDERS:
        counts[o['status']] = counts.get(o['status'], 0) + 1
    def n(statuses):
        return sum(1 for t in TASKS if t['status'] in statuses)
    overdue = [t for t in TASKS if t['due_date'] and t['due_date'] < today and t['status'] in OPEN_STATUSES]
    workload = []
    for p in PROFILES.values():
        if not is_employee(p['role']) or p['role'] == 'admin':
            continue
        mine = [t for t in TASKS if t['assignee_id'] == p['id'] and t['status'] in OPEN_STATUSES]
        workload.append({'id': p['id'], 'name': p['full_name'], 'role': p['role'], 'avatar_path': p['avatar_path'],
                         'accent_color': p['accent_color'], 'open': len(mine),
                         'overdue': sum(1 for t in mine if t in overdue)})
    workload.sort(key=lambda w: (-w['open'], w['name']))
    return {
        'is_admin': admin,
        'revenue_month': sum(o['total_amd'] for o in paid if o['paid_at'][:7] == month) if admin else None,
        'revenue_prev_month': 48000 if admin else None,
        'paid_orders_month': sum(1 for o in paid if o['paid_at'][:7] == month),
        'active_clients': len({o['client_id'] for o in ORDERS if o['status'] in ('paid', 'in_progress')}),
        'orders': counts,
        'tasks': {'unassigned': n(('new',)), 'in_work': n(('assigned', 'in_progress', 'changes_requested')),
                  'review': n(('internal_review',)), 'client': n(('client_review',)),
                  'publish': n(('approved', 'publishing')), 'overdue': len(overdue)},
        'workload': workload,
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
AGENT_IDS = ('copywriter', 'designer', 'smm', 'video', 'photographer', 'targetologist', 'seo', 'manager')
AGENT_NAMES = {'copywriter': 'AI-копирайтер', 'designer': 'AI-дизайнер', 'smm': 'AI-SMM', 'video': 'AI-видео',
               'photographer': 'AI-фотограф', 'targetologist': 'AI-таргетолог', 'seo': 'AI-SEO'}
AGENT_DEMO = {
    'copywriter': 'Осень пришла — и тыквенный латте тоже 🎃☕\nТёплый, пряный и ровно такой, как вы любите. '
                  'Заходите утром на Абовяна 12 — первые 10 гостей получат круассан в подарок!\n'
                  '#CafeAroma #Ереван #тыквенныйлатте #кофе #осень',
    'designer': 'Тыквенный латте уже здесь 🎃 Каждое утро с 8:00 на Абовяна 12.\n#CafeAroma #Ереван #осень',
    'smm': '1) Текст: Осенний вкус каждое утро — тыквенный латте в Cafe Aroma ☕ #CafeAroma #Ереван\n'
           '2) Лучшее время: вторник, 8:30 — аудитория едет на учёбу и работу.\n'
           '3) План: неделя 1 — пост о латте, неделя 2 — сторис с опросом, неделя 3 — рилс, неделя 4 — пост-итог.',
    'video': 'Сцена 1 (0–2 с): крупно пар над чашкой, текст «Осень в чашке».\n'
             'Сцена 2 (2–8 с): бариста наливает латте-арт.\nСцена 3 (8–15 с): гость улыбается, текст «Абовяна 12».\n'
             'Субтитры: «Осень в чашке. Тыквенный латте. Cafe Aroma».',
    'photographer': '1. Чашка крупно сверху, на фоне листьев (4:5).\n2. Руки бариста с питчером (9:16).\n'
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
        if not task or not (task['assignee_id'] == profile['id'] or is_manager(profile['role'])):
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
    if not task or not (task['assignee_id'] == profile['id'] or is_manager(profile['role'])):
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
        result.append({**run, 'tasks': {'service_id': task['service_id'], 'platform_id': task['platform_id'],
                                        'number': task['number'], 'services': task['services'],
                                        'businesses': {'name': task['businesses']['name']}} if task else None})
    return sorted(result, key=lambda r: r['created_at'], reverse=True)


# ---------- Выборки по таблицам (фильтры PostgREST — упрощённо) ----------
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
    return set()


def visible_tasks():
    profile = me()
    if profile['role'] == 'freelancer':
        return [t for t in TASKS if t['assignee_id'] == profile['id']]
    ids = my_order_ids()
    return [t for t in TASKS if t['order_id'] in ids]


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
        if role == 'freelancer':
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
        result = [{**o, 'businesses': {'name': next((b['name'] for b in BUSINESSES if b['id'] == o['business_id']), '')}}
                  for o in ORDERS if o['id'] in ids]
        if eq(q, 'id'):
            result = [o for o in result if o['id'] == eq(q, 'id')]
        return sorted(result, key=lambda o: o['created_at'], reverse=True)
    if table == 'order_items':
        ids = my_order_ids()
        oid = eq(q, 'order_id')
        return [i for i in ITEMS if i['order_id'] in ids and (not oid or i['order_id'] == oid)]
    if table == 'tasks':
        result = visible_tasks()
        for key_ in ('id', 'assignee_id', 'order_id', 'business_id'):
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
    if table == 'promo_codes':
        return PROMO_CODES if role == 'admin' else []
    if table == 'payments':
        ids = my_order_ids()
        result = [p for p in PAYMENTS if p['order_id'] in ids]
        for key_ in ('id', 'order_id', 'status'):
            if eq(q, key_):
                result = [p for p in result if p[key_] == eq(q, key_)]
        return sorted(result, key=lambda p: p['receipt_no'] or 0,
                      reverse=q.get('order', [''])[0] == 'receipt_no.desc')
    if table == 'deliverables':
        tid = eq(q, 'task_id')
        return [d for t in visible_tasks() for d in t['deliverables'] if not tid or d['task_id'] == tid]
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
    if table == 'task_comments':
        if not is_employee(role):
            return []
        return [{'id': 'c1', 'task_id': TASKS[1]['id'], 'author_id': MANAGER,
                 'body': 'Отлично, отправляю клиенту.', 'created_at': day(-1)}]
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
            if fn == 'create_order':
                order_id, error = create_order(data)
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
                AGENCY.update({k: v for k, v in data.items() if k == 'auto_approve_days'})
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
