"""Локальный сервер для сайта-сюрприза: py server.py  ->  http://127.0.0.1:8000

Отличия от стандартного http.server:
  * поддержка HTTP Range (без неё Chrome/Edge плохо загружают и зацикливают видео mp4);
  * отключено кеширование, чтобы после правок не оставался старый style.css;
  * корректный MIME-тип для .mp4 (на Windows он иногда берётся из реестра неверно);
  * обрыв соединения браузером (он часто отменяет запрос видео) не засоряет консоль ошибками.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
import re

os.chdir(Path(__file__).resolve().parent)

HOST, PORT = '127.0.0.1', 8000


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.mp4': 'video/mp4',
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
    }
    _range_left = None

    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def send_head(self):
        self._range_left = None
        header = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not header or not os.path.isfile(path):
            return super().send_head()

        match = re.match(r'^\s*bytes=(\d*)-(\d*)\s*$', header)
        if not match or (match.group(1) == '' and match.group(2) == ''):
            return super().send_head()

        size = os.path.getsize(path)
        first, last = match.groups()
        if first == '':                       # "bytes=-N": последние N байт
            start = max(0, size - int(last))
            end = size - 1
        else:
            start = int(first)
            end = int(last) if last else size - 1
        end = min(end, size - 1)

        if start >= size or start > end:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None

        f = open(path, 'rb')
        f.seek(start)
        self._range_left = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(self._range_left))
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        left = self._range_left
        self._range_left = None
        try:
            if left is None:
                super().copyfile(source, outputfile)
                return
            while left > 0:
                chunk = source.read(min(64 * 1024, left))
                if not chunk:
                    break
                outputfile.write(chunk)
                left -= len(chunk)
        except (ConnectionError, OSError):
            pass  # браузер закрыл соединение - это нормально

    def handle(self):
        try:
            super().handle()
        except (ConnectionError, OSError):
            pass


if __name__ == '__main__':
    print(f'Открой сайт: http://{HOST}:{PORT}')
    print('Остановить сервер: Ctrl+C')
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print('\nСервер остановлен.')
