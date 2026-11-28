import base64
import tempfile
import unittest
from pathlib import Path

from floodlens.incidents import Incidents, MAX_IMAGE
from floodlens.help_requests import HelpRequests
from floodlens.store import Store


class IncidentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / 'test.sqlite3')
        self.incidents = Incidents(self.store)
        # Signature fixture only; this is not a real decoded image.
        self.photo = b'\xff\xd8\xfffixture\xff\xd9'
        self.payload = dict(kind='situation', severity='high', location='KMITL',
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

    def test_help_is_private_including_legacy_reports(self):
        old = self.incidents.create(self.payload)
        with self.store.connect() as db:
            db.execute("UPDATE incidents SET kind='help' WHERE id=?", (old['id'],))
        help_requests = HelpRequests(self.store)
        receipt = help_requests.create(dict(need='evacuation', people=2, landmark='Dorm gate',
                                            contact='private', details='Two students'))
        self.assertEqual(receipt['status'], 'received')
        self.assertNotIn('contact', receipt)
        self.assertEqual(self.incidents.latest(), {'reports': []})
        self.assertIsNone(self.incidents.photo(old['id']))
        self.assertIsNone(self.incidents.photo(receipt['id']))

class IncidentHandlerTests(unittest.TestCase):
    def test_http_contract_without_socket(self):
        import io
        import json
        from email.message import Message
        from unittest.mock import patch
        import app
        with tempfile.TemporaryDirectory() as temp:
            key = 'coordinator-test-' + 'x' * 32
            with patch.dict('os.environ', {'FLOODLENS_COORDINATOR_KEY': key}), \
                    patch('sys.argv', ['app.py', '--db', str(Path(temp) / 'http.sqlite3')]), \
                    patch('app.ThreadingHTTPServer') as server, patch('app.Monitor.start'), \
                    patch('app.Monitor.stop'), patch('builtins.print'):
                app.main()
            handler_type = server.call_args.args[1]
            def request(path, payload=None, origin=None, token=None):
                handler = object.__new__(handler_type)
                handler.path = path
                handler.headers = Message()
                raw = json.dumps(payload).encode() if payload is not None else b''
                handler.headers['Content-Length'] = str(len(raw))
                handler.headers['Content-Type'] = 'application/json'
                handler.headers['Host'] = '127.0.0.1:8000'
                if origin:
                    handler.headers['Origin'] = origin
                if token:
                    handler.headers['Authorization'] = 'Bearer ' + token
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
            self.assertEqual(request('/help')[0], 200)
            self.assertEqual(request('/track')[0], 200)
            self.assertEqual(request('/coordinator')[0], 200)
            help_payload = dict(need='evacuation', people=2, landmark='Dorm gate',
                                contact='private-contact', details='Two students')
            status, _, body = request('/api/help', help_payload)
            self.assertEqual(status, 201)
            tracking = json.loads(body)['id']
            queue, track = '/api/help/queue', '/api/help/status'
            self.assertEqual(request(track)[0], 404)
            self.assertEqual(request(queue, token=tracking)[0], 401)
            self.assertEqual(request(queue, dict(id=tracking, action='accept'))[0], 401)
            self.assertEqual(json.loads(request(track, token=tracking)[2])['status'], 'received')
            self.assertEqual(json.loads(request(queue, token=key)[2])['requests'][0]['contact'],
                             'private-contact')
            action = dict(id=tracking, action='accept', assignee='Volunteer')
            self.assertEqual(request(queue, action, token=key)[0], 200)
            self.assertEqual(request(queue, action, token=key)[0], 409)
            after = json.loads(request(track, token=tracking)[2])
            self.assertEqual(set(after), {'status', 'created_at', 'accepted_at', 'closed_at'})
            self.assertEqual(after['status'], 'accepted')
            self.assertIsNotNone(after['accepted_at'])
            self.assertEqual(request(queue, dict(action, action='assign', assignee='Team B'), token=key)[0], 200)
            self.assertEqual(request(queue, dict(id=tracking, action='close', outcome='Resolved'), token=key)[0], 200)
            self.assertEqual(json.loads(request(track, token=tracking)[2])['status'], 'closed')
            self.assertEqual(request(queue, dict(action, action='assign'), token=key)[0], 409)
            self.assertNotIn(b'private-contact', request('/api/reports')[2])
