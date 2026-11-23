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
    parser.add_argument('--check-live', action='store_true',
                        help='Fetch real feeds, print JSON, exit 1 unless all feeds have data')
    args = parser.parse_args()
    live = LiveService()
    if args.check_live:
        result = live.get()
        print(json.dumps(result, ensure_ascii=True, allow_nan=False, indent=2))
        return 0 if all(feed['status'] == 'ok' for feed in result['feeds'].values()) else 1
    rows, issues = load_csv(args.data)

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
    raise SystemExit(main())
