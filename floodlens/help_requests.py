"""Private requests for coordination, separate from public incident reports."""
import uuid
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
