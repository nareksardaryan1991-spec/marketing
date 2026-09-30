#!/usr/bin/env python3
"""Раздаёт собранное веб-приложение только на этом компьютере (127.0.0.1).

Любой путь без файла отдаёт index.html — так работают ссылки вида /orders/123.
Запуск: python3 scripts/serve-web.py <папка> <порт>
"""
import http.server
import os
import sys

root, port = sys.argv[1], int(sys.argv[2])


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=root, **kwargs)

    def send_head(self):
        path = self.path.split('?')[0].lstrip('/')
        if not path or not os.path.isfile(os.path.join(root, path)):
            self.path = '/index.html'
        return super().send_head()

    def log_message(self, *args):
        pass


print(f'Приложение: http://localhost:{port}  (Ctrl+C — остановить)', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
