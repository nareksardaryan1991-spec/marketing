#!/usr/bin/env python3
"""Просмотровый сервер: собранное веб-приложение + поддельный Supabase с демо-данными.

Нужен, чтобы посмотреть приложение без Docker и без облака. Работает только на этом
компьютере (127.0.0.1). Сообщения в чатах сохраняются в памяти, пока сервер запущен;
остальные действия (оплата, одобрение, назначение) не сохраняются.

Запуск: ./scripts/preview.sh  (или python3 scripts/preview/mock_server.py <папка сборки> <порт>)
Вход: client@demo.am / manager@demo.am / designer@demo.am / freelancer@demo.am, пароль demo1234.
"""
import http.server
import json
import threading
import os
import sys
import time
import urllib.parse
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


# ---------- Люди ----------
CLIENT = 'c0000000-0000-4000-8000-000000000001'
MANAGER = 'a0000000-0000-4000-8000-000000000002'
DESIGNER = 'd0000000-0000-4000-8000-000000000003'
FREELANCER = 'f0000000-0000-4000-8000-000000000004'


def person(pid, name, email, role):
    return {'id': pid, 'full_name': name, 'email': email, 'role': role, 'language': 'ru',
            'phone': None, 'created_at': day(-40)}


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
    'notes': 'Осеннее меню, акцент на тыквенный латте', 'paid_at': day(-10), 'created_at': day(-10),
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


def task(n, platform, svc, num, status, assignee=None, publish=None, due=None, brief=None, url=None, caption=None):
    tid = 't0000000-0000-4000-8000-%012d' % n
    deliverables = []
    if caption:
        deliverables.append({
            'id': 'v%d' % n, 'task_id': tid, 'version': 1, 'caption': caption, 'files': [], 'note': None,
            'created_by': DESIGNER, 'created_at': day(-1),
            'sent_to_client_at': day(-1) if status in ('client_review', 'approved', 'published') else None,
        })
    return {
        'id': tid, 'order_id': ORDER, 'business_id': BIZ, 'service_id': svc, 'platform_id': platform,
        'number': num, 'status': status,
        'assignee_id': assignee, 'due_date': due, 'brief': brief, 'publish_at': publish,
        'published_at': publish if status == 'published' else None, 'published_url': url,
        'publish_error': None, 'autopublish_state': {}, 'created_at': day(-10), 'updated_at': day(-1),
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
    task(4, 'facebook', 'post', 1, 'in_progress', DESIGNER, due=day(4)[:10], brief='Утренний кофе с собой: скидка 10% до 10:00'),
    task(5, 'tiktok', 'reel', 1, 'assigned', FREELANCER, due=day(5)[:10], brief='Процесс приготовления латте-арта, 15–20 секунд'),
    task(6, 'instagram', 'story', 1, 'approved', DESIGNER, day(1, 10), caption='Опрос: тыквенный латте или раф с карамелью? 🗳'),
    task(7, 'instagram', 'story', 2, 'new'),
]

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
        result = [o for o in ORDERS if o['id'] in ids]
        if eq(q, 'id'):
            result = [o for o in result if o['id'] == eq(q, 'id')]
        return sorted(result, key=lambda o: o['created_at'], reverse=True)
    if table == 'order_items':
        ids = my_order_ids()
        oid = eq(q, 'order_id')
        return [i for i in ITEMS if i['order_id'] in ids and (not oid or i['order_id'] == oid)]
    if table == 'tasks':
        result = visible_tasks()
        for key_ in ('id', 'assignee_id', 'order_id'):
            if eq(q, key_):
                result = [t for t in result if t[key_] == eq(q, key_)]
        status = q.get('status', [None])[0]
        if status:
            allowed = status[4:-1].split(',') if status.startswith('in.(') else [status[3:]]
            result = [t for t in result if t['status'] in allowed]
        if 'publish_at' in q:
            result = [t for t in result if t['publish_at']]
        return result
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
    ITEMS.extend(lines)
    budget = int(data.get('p_ad_budget_amd') or 0)
    ORDERS.append({
        'id': order_id, 'business_id': business['id'], 'client_id': profile['id'], 'billing': data.get('p_billing'),
        'publishing': data.get('p_publishing'), 'status': 'pending_payment', 'items_total_amd': total,
        'ad_budget_amd': budget, 'total_amd': total + budget, 'notes': (data.get('p_notes') or '').strip() or None,
        'paid_at': None, 'created_at': now_iso(),
    })
    return order_id, None


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
        body = json.dumps(data).encode()
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

        if self.command == 'POST' and path == '/rest/v1/businesses':
            data, profile = self.body(), me()
            if profile['role'] != 'client':
                return self.reply({'message': 'new row violates row-level security policy'}, 403)
            business = {**{k: None for k in BUSINESS}, **data, 'id': 'b0000000-0000-4000-8000-%012d' % (len(BUSINESSES) + 1),
                        'owner_id': profile['id'], 'created_at': now_iso(), 'updated_at': now_iso()}
            BUSINESSES.append(business)
            return self.reply(business if self.wants_object() else [business], 201)

        if self.command == 'POST' and path in ('/rest/v1/team_messages', '/rest/v1/messages'):
            data, profile = self.body(), me()
            message = {'id': 'new-%d' % int(time.time() * 1000), 'author_id': profile['id'],
                       'author_name': profile['full_name'], 'body': (data.get('body') or '').strip(),
                       'created_at': now_iso()}
            if path.endswith('team_messages'):
                if not can_access(data.get('conversation_id')):
                    return self.reply({'message': 'new row violates row-level security policy'}, 403)
                message['conversation_id'] = data.get('conversation_id')
                TEAM_MESSAGES.append(message)
            else:
                message.update(order_id=data.get('order_id'), from_client=profile['role'] == 'client')
                MESSAGES.append(message)
            return self.reply(message if self.wants_object() else [message], 201)

        if path.startswith('/rest/v1/'):
            data = rows(path.split('/')[3], q)
            if 'limit' in q:
                data = data[:int(q['limit'][0])]
            if self.wants_object():
                if data:
                    return self.reply(data[0])
                return self.reply({'message': 'not found', 'code': 'PGRST116'}, 406)
            return self.reply(data, headers={'Content-Range': '0-%d/%d' % (max(len(data) - 1, 0), len(data))})

        # Хранилище файлов и серверные функции в просмотре не работают.
        return self.reply([] if path.startswith('/storage/') else {'error': 'недоступно в просмотровой версии'},
                          200 if path.startswith('/storage/') else 501)

    def do_POST(self):
        self.api()

    def do_PATCH(self):
        self.api()

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
