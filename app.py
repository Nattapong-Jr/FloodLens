"""Local-only, dependency-free dashboard. Run: python app.py"""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from floodlens.data import load_csv
from floodlens.live import LiveService

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, default=ROOT / 'data/demo.csv')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    rows, issues = load_csv(args.data)
    live = LiveService()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/api/live':
                body = json.dumps(live.get(), ensure_ascii=False, allow_nan=False).encode()
                mime = 'application/json; charset=utf-8'
            elif self.path == '/api/data':
                body = json.dumps({'rows': rows, 'issues': issues}, ensure_ascii=False).encode()
                mime = 'application/json; charset=utf-8'
            elif self.path in ('/', '/index.html'):
                body = (ROOT / 'web/index.html').read_bytes()
                mime = 'text/html; charset=utf-8'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

    print(f'FloodLens: http://127.0.0.1:{args.port} (Ctrl+C to stop)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
