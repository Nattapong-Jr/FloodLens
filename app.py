"""Local-only, dependency-free dashboard. Run: python app.py"""
import argparse
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from floodlens.incidents import Incidents, MAX_REQUEST
from floodlens.help_requests import HelpRequests
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
    incidents = Incidents(store)
    help_requests = HelpRequests(store)
    coordinator_key = os.environ.get('FLOODLENS_COORDINATOR_KEY', '').encode()
    coverage = {name: os.environ.get('FLOODLENS_HELP_' + name.upper(), '').strip()
                for name in ('team', 'hours', 'contact')}
    if args.collect_once:
        monitor.collect()
        result = monitor.view('regional')
        print(json.dumps(result, ensure_ascii=True, allow_nan=False, indent=2))
        return 0 if not result['system']['last_error'] and all(f['status'] == 'ok' for f in result['feeds'].values()) else 1
    rows, issues = load_csv(args.data)

    class Handler(BaseHTTPRequestHandler):
        def bearer(self):
            value = self.headers.get('Authorization', '')
            return value[7:] if value.startswith('Bearer ') else ''

        def coordinator_allowed(self):
            if len(coordinator_key) >= 32 and hmac.compare_digest(self.bearer().encode(), coordinator_key):
                return True
            self.reply({'error': 'ต้องใช้รหัสทีมรับเรื่อง'}, 401)
            return False

        def reply(self, payload, status=200):
            body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path not in ('/api/reports', '/api/help', '/api/help/queue'):
                self.reply({'error': 'Not found'}, 404)
                return
            # Browsers must submit from this server, never from an unrelated site.
            origin = self.headers.get('Origin')
            if origin and origin != 'http://' + self.headers.get('Host', ''):
                self.reply({'error': 'Origin not allowed'}, 403)
                return
            updating_queue = self.path == '/api/help/queue'
            if updating_queue and not self.coordinator_allowed():
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= MAX_REQUEST:
                    self.close_connection = True
                    self.reply({'error': 'ข้อมูลมีขนาดใหญ่เกินไป (รูปไม่เกิน 3 MB)'}, 413)
                    return
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    self.reply({'error': 'Content-Type must be application/json'}, 415)
                    return
                payload = json.loads(self.rfile.read(length))
                if updating_queue:
                    if help_requests.update(payload):
                        self.reply({'updated': True})
                    else:
                        self.reply({'error': 'รายการเปลี่ยนแล้ว กรุณาโหลดคิวอีกครั้ง'}, 409)
                    return
                result = (help_requests if self.path == '/api/help' else incidents).create(payload)
            except (ValueError, UnicodeError) as exc:
                self.reply({'error': str(exc)}, 400)
                return
            except Exception:
                self.reply({'error': 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง'}, 500)
                return
            self.reply(result, 201)

        def do_GET(self):
            route = urlsplit(self.path).path
            if route == '/api/help/coverage':
                self.reply({'coverage': coverage if all(coverage.values()) else None})
                return
            if route == '/api/help/status':
                result = help_requests.track(self.bearer())
                self.reply(result or {'error': 'ไม่พบคำขอ'}, 200 if result else 404)
                return
            if route == '/api/help/queue':
                if self.coordinator_allowed():
                    self.reply(help_requests.queue())
                return
            if route == '/api/reports':
                self.reply(incidents.latest())
                return
            if route.startswith('/api/reports/') and route.endswith('/photo'):
                item = incidents.photo(route[len('/api/reports/'):-len('/photo')])
                if not item:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', item[0])
                self.send_header('Content-Length', str(len(item[1])))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                self.wfile.write(item[1])
                return
            if route == '/report' and parse_qs(urlsplit(self.path).query).get('kind') == ['help']:
                self.send_response(303)
                self.send_header('Location', '/help')
                self.end_headers()
                return
            pages = {'/report': 'report.html', '/reports.js': 'reports.js',
                     '/help': 'help.html', '/help.js': 'help.js', '/help-tools.css': 'help-tools.css',
                     '/track': 'track.html', '/coordinator': 'coordinator.html',
                     '/help-tools.js': 'help-tools.js'}
            if route in pages:
                filename = pages[route]
                body = (ROOT / 'web' / filename).read_bytes()
                self.send_response(200)
                mime = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript'}
                self.send_header('Content-Type', mime[Path(filename).suffix] + '; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)
                return
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
