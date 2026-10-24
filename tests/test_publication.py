from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import unittest
from urllib.parse import unquote, urlsplit
from scripts.verify_publication import check_assets


@contextmanager
def published(files):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            name = unquote(urlsplit(self.path).path.lstrip('/'))
            body = files.get(name)
            self.send_response(404 if body is None else 200)
            self.end_headers()
            if body is not None:
                self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield 'http://127.0.0.1:' + str(server.server_port)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class PublicationTest(unittest.TestCase):
    def test_checks_text_binary_and_encoded_paths(self):
        files = {'index.html': b'<main>Direct</main>',
                 'logo.png': b'\x89PNG\x00\xff', 'arquivo com espaço.js': b'const x=1;'}
        with published(files) as site:
            self.assertEqual(check_assets(site, files), [])

    def test_rejects_stale_file_and_missing_file(self):
        expected = {'index.html': b'new', 'app.js': b'current'}
        with published({'index.html': b'old'}) as site:
            errors = {row['path']: row['error'] for row in check_assets(site, expected)}
        self.assertIn('diferente', errors['index.html'])
        self.assertEqual(errors['app.js'], 'HTTP 404')

    def test_rejects_empty_verification(self):
        with self.assertRaises(ValueError):
            check_assets('https://example.invalid', {})
