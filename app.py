"""Local-only, dependency-free dashboard. Run: python app.py"""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from floodlens.data import load_csv
from floodlens.live import LiveService
from floodlens.monitor import Monitor
from floodlens.store import Store

ROOT = Path(__file__).resolve().parent


def api_response(path, monitor, store, rows, issues):
    route = urlsplit(path)
    query = parse_qs(route.query)
    if route.path == '/api/live':
        return monitor.view(query.get('scope', ['local'])[0])
    if route.path == '/api/history':
        feed = query.get('feed', ['water'])[0]
        station = query.get('station_id', [''])[0]
        if not station or len(station) > 100:
            raise ValueError('station_id is required (max 100 characters)')
        hours = int(query.get('hours', ['48'])[0])
        return {'feed': feed, 'station_id': station, 'hours': hours,
                'rows': store.history(feed, station, hours)}
    if route.path == '/api/health':
        view = monitor.view()
        return {'system': view['system'], 'feeds': {k: {'status': v['status'],
                'fetched_at': v.get('fetched_at'), 'cache_stale': v['cache_stale']}
                for k, v in view['feeds'].items()}}
    if route.path == '/api/data':
        return {'rows': rows, 'issues': issues}
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, default=ROOT / 'data/demo.csv')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--check-live', action='store_true',
                        help='Fetch real feeds, print JSON, exit 1 unless all feeds have data')
    parser.add_argument('--db', type=Path, default=ROOT / 'data/floodlens.sqlite3')
    parser.add_argument('--collect-once', action='store_true',
                        help='Fetch and archive one regional snapshot, then exit')
    args = parser.parse_args()
    live = LiveService()
    if args.check_live:
        result = live.get()
        print(json.dumps(result, ensure_ascii=True, allow_nan=False, indent=2))
        return 0 if all(feed['status'] == 'ok' for feed in result['feeds'].values()) else 1
    store = Store(args.db)
    monitor = Monitor(live, store)
    if args.collect_once:
        monitor.collect()
        result = monitor.view('regional')
        print(json.dumps(result, ensure_ascii=True, allow_nan=False, indent=2))
        return 0 if not result['system']['last_error'] and all(f['status'] == 'ok' for f in result['feeds'].values()) else 1
    rows, issues = load_csv(args.data)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            status = 200
            try:
                payload = api_response(self.path, monitor, store, rows, issues)
            except ValueError as exc:
                payload, status = {'error': str(exc)}, 400
            except Exception:
                payload, status = {'error': 'Internal error; inspect collector health and database access'}, 500
            if payload is not None:
                body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
                mime = 'application/json; charset=utf-8'
            elif self.path in ('/', '/index.html'):
                body = (ROOT / 'web/index.html').read_bytes()
                mime = 'text/html; charset=utf-8'
            elif self.path in ('/csv', '/dashboard.js'):
                body = (ROOT / 'web' / ('csv.html' if self.path == '/csv' else 'dashboard.js')).read_bytes()
                mime = 'text/html; charset=utf-8' if self.path == '/csv' else 'text/javascript; charset=utf-8'
            else:
                self.send_error(404)
                return
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

    print(f'FloodLens: http://127.0.0.1:{args.port} (Ctrl+C to stop)', flush=True)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    monitor.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        monitor.stop()


if __name__ == '__main__':
    raise SystemExit(main())
