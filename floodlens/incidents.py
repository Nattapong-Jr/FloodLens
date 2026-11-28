"""Local community incident reports, stored separately from sensor observations."""
import base64
import binascii
import sqlite3
import uuid
from datetime import datetime, timezone

from floodlens.live import RADIUS_KM, distance

MAX_IMAGE = 3 * 1024 * 1024
MAX_REQUEST = 4 * 1024 * 1024 + 8192


def field(data, key, maximum, required=True):
    value = data.get(key, '')
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError(f'{key}: กรุณากรอกข้อมูลไม่เกิน {maximum} ตัวอักษร')
    return value.strip()


def coordinates(data):
    lat, lon = data.get('latitude'), data.get('longitude')
    if (lat is None) != (lon is None):
        raise ValueError('กรุณาระบุพิกัดให้ครบ')
    if lat is not None:
        for value, limit in ((lat, 90), (lon, 180)):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not -limit <= value <= limit:
                raise ValueError('พิกัดไม่ถูกต้อง')
    return lat, lon


class Incidents:
    def __init__(self, store):
        self.store = store
        with store.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL,
                severity TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL,
                latitude REAL, longitude REAL, mime TEXT NOT NULL, photo BLOB NOT NULL)''')
            db.execute('''CREATE TABLE IF NOT EXISTS incident_details (
                id TEXT PRIMARY KEY, reporter TEXT NOT NULL DEFAULT '', confirmed_at TEXT)''')

    def create(self, data, db=None):
        if db is None:
            with self.store.connect() as connection:
                return self.create(data, connection)
        if not isinstance(data, dict):
            raise ValueError('ข้อมูลต้องเป็น JSON object')
        kind, severity = field(data, 'kind', 20), field(data, 'severity', 20)
        if kind != 'situation' or severity not in ('low', 'medium', 'high'):
            raise ValueError('ประเภทหรือระดับความเร่งด่วนไม่ถูกต้อง')
        location, description = field(data, 'location', 200), field(data, 'description', 2000)
        reporter = field(data, 'reporter', 80, required=False)
        lat, lon = coordinates(data)
        encoded = data.get('photo')
        if not isinstance(encoded, str) or len(encoded) > MAX_REQUEST:
            raise ValueError('กรุณาแนบรูป JPEG หรือ PNG ขนาดไม่เกิน 3 MB')
        try:
            photo = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('ข้อมูลรูปภาพไม่ถูกต้อง') from None
        if not photo or len(photo) > MAX_IMAGE:
            raise ValueError('รูปภาพต้องมีขนาดไม่เกิน 3 MB')
        if photo.startswith(b'\xff\xd8\xff') and photo.endswith(b'\xff\xd9'):
            mime = 'image/jpeg'
        elif photo.startswith(b'\x89PNG\r\n\x1a\n') and photo.endswith(b'IEND\xaeB`\x82'):
            mime = 'image/png'
        else:
            raise ValueError('รองรับเฉพาะรูป JPEG หรือ PNG')
        ident = uuid.uuid4().hex
        stamp = datetime.now(timezone.utc).isoformat()
        db.execute('INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?,?,?)',
                   (ident, stamp, kind, severity, location, description, lat, lon, mime, photo))
        db.execute('INSERT INTO incident_details (id, reporter) VALUES (?,?)', (ident, reporter))
        return {'id': ident, 'created_at': stamp, 'status': 'recorded'}

    def latest(self):
        with self.store.connect() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute('''SELECT id, created_at, kind, severity, location,
                description, latitude, longitude FROM incidents WHERE kind='situation'
                ORDER BY created_at DESC LIMIT 50''').fetchall()
        return {'reports': [dict(row, photo_url='/api/reports/' + row['id'] + '/photo',
                                 status='unverified') for row in rows]}

    def photo(self, ident):
        with self.store.connect() as db:
            return db.execute("SELECT mime, photo FROM incidents WHERE id=? AND kind='situation'",
                              (ident,)).fetchone()

    def campus(self):
        with self.store.connect() as db:
            db.row_factory = sqlite3.Row
            db.create_function('campus_distance', 2, distance)
            rows = db.execute('''SELECT incidents.id, created_at, severity, location,
                description, latitude, longitude, COALESCE(reporter, '') AS reporter, confirmed_at
                FROM incidents LEFT JOIN incident_details USING (id) WHERE kind='situation'
                AND (latitude IS NULL OR campus_distance(latitude, longitude) <= ?)
                ORDER BY created_at DESC LIMIT 50''', (RADIUS_KM,)).fetchall()
        return {'reports': [dict(row) for row in rows]}

    def confirm(self, ident):
        with self.store.connect() as db:
            cursor = db.execute('''INSERT INTO incident_details (id, confirmed_at)
                SELECT id, ? FROM incidents WHERE id=? AND kind='situation'
                ON CONFLICT(id) DO UPDATE SET confirmed_at=excluded.confirmed_at''',
                (datetime.now(timezone.utc).isoformat(), ident))
            return cursor.rowcount == 1
