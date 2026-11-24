import copy
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import Mock

from app import api_response
from floodlens.live import BANGKOK
from floodlens.monitor import Monitor
from floodlens.store import Store


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'archive.sqlite3'
        self.store = Store(self.path)
        self.now = datetime.now(BANGKOK)

    def snapshot(self, value=1, minutes=0, status='ok'):
        row = {'station_id': '3', 'timestamp': (self.now-timedelta(minutes=minutes)).isoformat(),
               'value': value, 'distance_km': 1.98, 'source': 'ThaiWater', 'unit': 'm MSL'}
        return {'feeds': {feed: {'rows': [copy.deepcopy(row)] if status == 'ok' else [],
                                'status': status, 'fetched_at': self.now.isoformat()}
                          for feed in ('water', 'rain', 'flow', 'forecast')}}

    def test_archive_idempotent_corrections_persist_after_restart(self):
        first = self.snapshot()
        first['feeds']['forecast']['rows'] = []
        self.store.save(first)
        self.store.save(first)
        first['feeds']['water']['rows'][0]['value'] = 1.5
        self.store.save(first)
        restarted = Store(self.path)
        self.assertEqual(restarted.stats()['observation_count'], 3)
        self.assertEqual(restarted.history('water', '3')[0]['value'], 1.5)

    def test_trends_use_actual_interval_and_never_sum_rolling_rain(self):
        self.store.save(self.snapshot(1, 30))
        self.store.save(self.snapshot(1.1, 0))
        trends = self.store.trends(self.now.timestamp())
        self.assertAlmostEqual(trends[('water', '3')]['per_hour'], .2)
        self.assertNotIn(('rain', '3'), trends)

    def test_stale_and_long_gap_trends_suppressed(self):
        self.store.save(self.snapshot(1, 300))
        self.store.save(self.snapshot(2, 0))
        self.assertEqual(self.store.trends(self.now.timestamp()), {})

    def test_failed_collection_does_not_erase_archive_or_look_live(self):
        live = Mock()
        live.get.return_value = self.snapshot()
        monitor = Monitor(live, self.store)
        monitor.collect()
        live.get.return_value = self.snapshot(status='error')
        monitor.collect()
        self.assertTrue(self.store.history('water', '3'))
        self.assertEqual(monitor.view()['feeds']['water']['status'], 'error')
        self.assertEqual(monitor.view()['feeds']['water']['rows'], [])

    def test_view_refreshes_staleness_and_respects_scope(self):
        data = self.snapshot(minutes=300)
        data['feeds']['water']['rows'][0]['distance_km'] = 50
        monitor = Monitor(Mock(), self.store)
        monitor.snapshot = data
        self.assertEqual(monitor.view()['feeds']['water']['rows'], [])
        self.assertTrue(monitor.view('regional')['feeds']['water']['rows'][0]['stale'])

    def test_pending_nonblocking_and_history_validation(self):
        monitor = Monitor(Mock(), self.store)
        self.assertEqual(monitor.view()['feeds']['water']['status'], 'pending')
        for path in ['/api/live?scope=unknown', '/api/history',
                     '/api/history?station_id=3&hours=721',
                     '/api/history?station_id=3&feed=forecast']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                api_response(path, monitor, self.store, [], [])
        self.assertEqual(api_response('/api/history?station_id=3', monitor, self.store, [], [])['rows'], [])

    def test_database_error_keeps_previous_snapshot_but_reports_failure(self):
        monitor = Monitor(Mock(), self.store)
        monitor.live.get.return_value = self.snapshot()
        monitor.collect()
        original = monitor.snapshot
        monitor.store.save = Mock(side_effect=OSError('disk full'))
        monitor.collect()
        self.assertIs(monitor.snapshot, original)
        self.assertIn('disk full', monitor.last_error)
