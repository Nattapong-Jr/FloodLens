import base64
import tempfile
import unittest
from pathlib import Path

from floodlens.incidents import Incidents, MAX_IMAGE
from floodlens.store import Store


class IncidentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / 'test.sqlite3')
        self.incidents = Incidents(self.store)
        # Signature fixture only; this is not a real decoded image.
        self.photo = b'\xff\xd8\xfffixture\xff\xd9'
        self.payload = dict(kind='help', severity='high', location='KMITL',
                            description='Flooded road', latitude=13.73, longitude=100.78,
                            photo=base64.b64encode(self.photo).decode())

    def test_persist_and_retrieve_photo(self):
        result = self.incidents.create(self.payload)
        reopened = Incidents(self.store)
        report = reopened.latest()['reports'][0]
        self.assertEqual(result['id'], report['id'])
        self.assertEqual(report['status'], 'unverified')
        self.assertEqual(report['latitude'], 13.73)
        self.assertNotIn('photo', report)
        self.assertEqual(reopened.photo(result['id']), ('image/jpeg', self.photo))
        self.assertIsNone(reopened.photo('../unknown'))

    def test_reject_invalid_payload_without_saving(self):
        for change in ({'kind': 'invalid'}, {'severity': 'urgent'}, {'location': ' '},
                       {'description': 'x' * 2001}, {'latitude': 91}, {'longitude': None},
                       {'latitude': float('nan')}, {'latitude': True},
                       {'photo': '<svg/>'}, {'photo': base64.b64encode(b'<svg/>').decode()},
                       {'photo': base64.b64encode(b'x' * (MAX_IMAGE + 1)).decode()}):
            with self.subTest(change=list(change)):
                with self.assertRaises(ValueError):
                    self.incidents.create(dict(self.payload, **change))
        self.assertEqual(self.incidents.latest(), {'reports': []})

    def test_location_description_without_coordinates(self):
        result = self.incidents.create(dict(self.payload, latitude=None, longitude=None))
        self.assertEqual(result['status'], 'recorded')
        self.assertIsNone(self.incidents.latest()['reports'][0]['latitude'])

class IncidentHandlerTests(unittest.TestCase):
    def test_http_contract_without_socket(self):
        import io
        import json
        from email.message import Message
        from unittest.mock import patch
        import app
        with tempfile.TemporaryDirectory() as temp:
            with patch('sys.argv', ['app.py', '--db', str(Path(temp) / 'http.sqlite3')]), \
                    patch('app.ThreadingHTTPServer') as server, patch('app.Monitor.start'), \
                    patch('app.Monitor.stop'), patch('builtins.print'):
                app.main()
            handler_type = server.call_args.args[1]
            def request(path, payload=None, origin=None):
                handler = object.__new__(handler_type)
                handler.path = path
                handler.headers = Message()
                raw = json.dumps(payload).encode() if payload is not None else b''
                handler.headers['Content-Length'] = str(len(raw))
                handler.headers['Content-Type'] = 'application/json'
                handler.headers['Host'] = '127.0.0.1:8000'
                if origin:
                    handler.headers['Origin'] = origin
                handler.rfile, handler.wfile = io.BytesIO(raw), io.BytesIO()
                statuses, headers = [], {}
                handler.send_response = statuses.append
                handler.send_header = lambda k, v: headers.update({k: v})
                handler.end_headers = lambda: None
                handler.send_error = statuses.append
                if payload is None:
                    handler.do_GET()
                else:
                    handler.do_POST()
                return statuses[0], headers, handler.wfile.getvalue()
            photo = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==')
            payload = dict(kind='situation', severity='low', location='KMITL',
                           description='Road', photo=base64.b64encode(photo).decode())
            self.assertEqual(request('/report')[0], 200)
            self.assertEqual(request('/reports.js')[0], 200)
            status, _, body = request('/api/reports', payload, 'http://127.0.0.1:8000')
            self.assertEqual(status, 201)
            ident = json.loads(body)['id']
            rows = json.loads(request('/api/reports')[2])['reports']
            self.assertEqual(rows[0]['id'], ident)
            status, headers, image = request(rows[0]['photo_url'])
            self.assertEqual(status, 200)
            self.assertEqual(headers['Content-Type'], 'image/png')
            self.assertEqual(image, photo)
            self.assertEqual(request('/api/reports', {})[0], 400)
            self.assertEqual(request('/api/reports', payload, 'http://other.example')[0], 403)
            self.assertEqual(request('/api/reports/missing/photo')[0], 404)
