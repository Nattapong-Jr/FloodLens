"""Private requests for coordination, separate from public incident reports."""
import uuid
import sqlite3
from datetime import datetime, timezone

from floodlens.incidents import coordinates, field

NEEDS = ('evacuation', 'supplies', 'medical', 'other')


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class HelpRequests:
    def __init__(self, store):
        self.store = store
        with store.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS help_requests (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, need TEXT NOT NULL,
                people INTEGER NOT NULL, landmark TEXT NOT NULL, details TEXT NOT NULL,
                contact TEXT NOT NULL, latitude REAL, longitude REAL)''')
            db.execute('''CREATE TABLE IF NOT EXISTS help_work (
                id TEXT PRIMARY KEY, accepted_at TEXT NOT NULL, assignee TEXT NOT NULL,
                outcome TEXT NOT NULL DEFAULT '', closed_at TEXT)''')

    def create(self, data):
        if not isinstance(data, dict):
            raise ValueError('ข้อมูลต้องเป็น JSON object')
        need = field(data, 'need', 20)
        people = data.get('people')
        if need not in NEEDS or type(people) is not int or not 1 <= people <= 10000:
            raise ValueError('กรุณาระบุสิ่งที่ต้องการและจำนวนคนให้ถูกต้อง')
        landmark = field(data, 'landmark', 200)
        details = field(data, 'details', 2000, required=False)
        contact = field(data, 'contact', 200, required=False)
        lat, lon = coordinates(data)
        ident, created = uuid.uuid4().hex, timestamp()
        with self.store.connect() as db:
            db.execute('INSERT INTO help_requests VALUES (?,?,?,?,?,?,?,?,?)',
                       (ident, created, need, people, landmark, details, contact, lat, lon))
        return {'id': ident, 'created_at': created, 'status': 'received'}

    def track(self, ident):
        with self.store.connect() as db:
            db.row_factory = sqlite3.Row
            row = db.execute('''SELECT help_requests.created_at, accepted_at, closed_at
                FROM help_requests LEFT JOIN help_work USING (id) WHERE id=?''', (ident,)).fetchone()
        if row is None:
            return None
        return dict(row, status='closed' if row['closed_at'] else
                    'accepted' if row['accepted_at'] else 'received')

    def queue(self):
        with self.store.connect() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute('''SELECT help_requests.*, accepted_at, assignee, outcome, closed_at
                FROM help_requests LEFT JOIN help_work USING (id)
                ORDER BY CASE WHEN accepted_at IS NULL THEN 0 WHEN closed_at IS NULL THEN 1 ELSE 2 END,
                CASE WHEN closed_at IS NULL THEN created_at END, closed_at DESC''').fetchall()
        return {'requests': [dict(row) for row in rows]}

    def update(self, data):
        if not isinstance(data, dict):
            raise ValueError('ข้อมูลต้องเป็น JSON object')
        ident, action = field(data, 'id', 32), field(data, 'action', 20)
        with self.store.connect() as db:
            if action == 'accept':
                assignee = field(data, 'assignee', 100)
                result = db.execute('''INSERT OR IGNORE INTO help_work (id, accepted_at, assignee)
                    SELECT id, ?, ? FROM help_requests WHERE id=?''', (timestamp(), assignee, ident))
            elif action == 'assign':
                assignee = field(data, 'assignee', 100)
                result = db.execute('UPDATE help_work SET assignee=? WHERE id=? AND closed_at IS NULL',
                                    (assignee, ident))
            elif action == 'close':
                outcome = field(data, 'outcome', 2000)
                result = db.execute('''UPDATE help_work SET outcome=?, closed_at=?
                    WHERE id=? AND closed_at IS NULL''', (outcome, timestamp(), ident))
            else:
                raise ValueError('ไม่รู้จักคำสั่ง')
            return result.rowcount == 1
