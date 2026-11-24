"""Background polling and nonblocking read views for the local dashboard."""
import copy
from datetime import datetime
from threading import Event, Lock, Thread

from floodlens.live import BANGKOK, LAT, LON, RADIUS_KM, REGIONAL_RADIUS_KM


class Monitor:
    def __init__(self, live, store, interval=300):
        if interval < 300:
            raise ValueError('Polling interval must be at least 300 seconds')
        self.live, self.store, self.interval = live, store, interval
        self.stop_event, self.lock = Event(), Lock()
        self.snapshot = store.latest()
        self.last_attempt = None
        self.last_error = None
        self.thread = None
        self.collecting = False

    def collect(self):
        self.last_attempt = datetime.now(BANGKOK).isoformat()
        self.collecting = True
        try:
            snapshot = self.live.get('regional')
            snapshot['collected_at'] = datetime.now(BANGKOK).isoformat()
            self.store.save(snapshot)
            with self.lock:
                self.snapshot = snapshot
            self.last_error = None
        except Exception as exc:
            self.last_error = f'{type(exc).__name__}: {exc}'
        finally:
            self.collecting = False

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.thread = Thread(target=self._run, name='FloodLens-collector', daemon=True)
        self.thread.start()

    def _run(self):
        while not self.stop_event.is_set():
            self.collect()
            if self.stop_event.wait(self.interval):
                break

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=17)

    def view(self, scope='local'):
        if scope not in ('local', 'regional'):
            raise ValueError('scope must be local or regional')
        with self.lock:
            snapshot = copy.deepcopy(self.snapshot)
        radius = RADIUS_KM if scope == 'local' else REGIONAL_RADIUS_KM
        if snapshot is None:
            snapshot = {'feeds': {key: {'status': 'pending', 'rows': [], 'fetched_at': None}
                                  for key in ('water', 'rain', 'flow', 'forecast')}}
        snapshot['area'] = {'name': 'KMITL / Bangkok regional context', 'scope': scope,
                            'latitude': LAT, 'longitude': LON, 'radius_km': radius}
        now = datetime.now(BANGKOK)
        trends = self.store.trends()
        for key, feed in snapshot['feeds'].items():
            stamp = feed.get('fetched_at')
            feed['cache_stale'] = not stamp or (now-datetime.fromisoformat(stamp)).total_seconds() > 900
            if key == 'forecast':
                feed['rows'] = [r for r in feed['rows'] if datetime.fromisoformat(r['timestamp']) >= now]
                for point in feed.get('locations', []):
                    point['rows'] = [r for r in point['rows'] if datetime.fromisoformat(r['timestamp']) >= now]
            else:
                feed['rows'] = [r for r in feed['rows'] if r['distance_km'] <= radius]
                for row in feed['rows']:
                    age = (now-datetime.fromisoformat(row['timestamp'])).total_seconds()
                    row['stale'] = age > 3*3600 or age < -900 or feed['cache_stale']
                    row['trend'] = trends.get((key, row['station_id'])) if not row['stale'] else None
            if feed['status'] in ('ok', 'empty'):
                feed['status'] = 'ok' if feed['rows'] else 'empty'
        snapshot['system'] = {'poll_seconds': self.interval, 'collecting': self.collecting,
                               'last_attempt': self.last_attempt, 'last_error': self.last_error,
                               'collector_running': bool(self.thread and self.thread.is_alive()),
                               **self.store.stats()}
        return snapshot
