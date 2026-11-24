"""SQLite observation archive. Forecasts are never mixed with observations."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS observations (
                    feed TEXT NOT NULL, station_id TEXT NOT NULL, epoch REAL NOT NULL,
                    payload TEXT NOT NULL, PRIMARY KEY(feed, station_id, epoch));
                CREATE TABLE IF NOT EXISTS snapshots (
                    id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS runs (
                    epoch REAL PRIMARY KEY, payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS observations_epoch ON observations(epoch);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def save(self, snapshot):
        encoded = json.dumps(snapshot, ensure_ascii=False, allow_nan=False)
        with self.connect() as db:
            for feed in ('water', 'rain', 'flow'):
                data = snapshot['feeds'].get(feed, {})
                if data.get('status') != 'ok':
                    continue
                for row in data['rows']:
                    stamp = datetime.fromisoformat(row['timestamp'])
                    if stamp.utcoffset() is None:
                        raise ValueError('Observation timestamp requires timezone')
                    db.execute('INSERT OR REPLACE INTO observations VALUES (?,?,?,?)',
                               (feed, row['station_id'], stamp.timestamp(),
                                json.dumps(row, ensure_ascii=False, allow_nan=False)))
            db.execute('INSERT OR REPLACE INTO snapshots VALUES (1,?)', (encoded,))
            run = {k: {'status': v['status'], 'rows': len(v['rows']), 'error': v.get('error')}
                   for k, v in snapshot['feeds'].items()}
            db.execute('INSERT OR REPLACE INTO runs VALUES (?,?)',
                       (datetime.now(timezone.utc).timestamp(), json.dumps(run)))
            # Keep run metadata bounded, but never silently delete observation history.
            db.execute('DELETE FROM runs WHERE epoch NOT IN (SELECT epoch FROM runs ORDER BY epoch DESC LIMIT 1000)')

    def latest(self):
        with self.connect() as db:
            row = db.execute('SELECT payload FROM snapshots WHERE id=1').fetchone()
        return json.loads(row[0]) if row else None

    def history(self, feed, station_id, hours=48, now=None):
        if feed not in ('water', 'rain', 'flow'):
            raise ValueError('feed must be water, rain or flow')
        if not 1 <= hours <= 720:
            raise ValueError('hours must be between 1 and 720')
        now = datetime.now(timezone.utc).timestamp() if now is None else now
        with self.connect() as db:
            records = db.execute('''SELECT payload FROM observations
                WHERE feed=? AND station_id=? AND epoch>=? AND epoch<=?
                ORDER BY epoch DESC LIMIT 5000''',
                (feed, station_id, now - hours * 3600, now + 900)).fetchall()
        return [json.loads(row[0]) for row in reversed(records)]

    def trends(self, now=None):
        """Delta between latest pair only, provided the pair is fresh and close."""
        now = datetime.now(timezone.utc).timestamp() if now is None else now
        with self.connect() as db:
            records = db.execute('''SELECT feed, station_id, epoch, payload FROM (
                SELECT *, ROW_NUMBER() OVER(PARTITION BY feed,station_id ORDER BY epoch DESC) AS n
                FROM observations WHERE epoch>=? AND epoch<=?
            ) WHERE n<=2 ORDER BY feed,station_id,epoch DESC''', (now-6*3600, now+900)).fetchall()
        pairs = {}
        for feed, station, epoch, payload in records:
            pairs.setdefault((feed, station), []).append((epoch, json.loads(payload)))
        result = {}
        for (feed, station), rows in pairs.items():
            if len(rows) < 2:
                continue
            (latest, current), (previous, prior) = rows
            gap = (latest - previous) / 3600
            if now - latest > 3*3600 or not 0 < gap <= 3:
                continue
            # A change in overlapping rolling 24h totals is not hourly rainfall.
            if feed == 'rain':
                continue
            delta = current['value'] - prior['value']
            result[(feed, station)] = {'delta': round(delta, 4), 'per_hour': round(delta/gap, 4),
                                       'hours': round(gap, 3), 'from': prior['timestamp'],
                                       'to': current['timestamp']}
        return result

    def stats(self):
        with self.connect() as db:
            count, first, last = db.execute('SELECT COUNT(*),MIN(epoch),MAX(epoch) FROM observations').fetchone()
            runs = db.execute('SELECT epoch,payload FROM runs ORDER BY epoch DESC LIMIT 10').fetchall()
        return {'observation_count': count, 'first_observation_epoch': first,
                'last_observation_epoch': last,
                'recent_runs': [{'epoch': epoch, 'feeds': json.loads(p)} for epoch, p in runs]}
