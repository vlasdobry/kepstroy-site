"""Local review only: no external analytics and no form delivery."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HTML = Path(__file__).resolve().parents[1] / 'html'


class Preview(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HTML), **kwargs)

    def end_headers(self):
        self.send_header('Content-Security-Policy', "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'self'")
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        self.send_error(405, 'Local preview: submissions disabled')


print('Review at http://127.0.0.1:8094/ ; external analytics and delivery disabled', flush=True)
ThreadingHTTPServer(('127.0.0.1', 8094), Preview).serve_forever()
