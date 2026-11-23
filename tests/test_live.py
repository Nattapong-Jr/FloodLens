import time
import unittest
from datetime import datetime
from floodlens.live import BANGKOK, LiveService, normalize_stations, normalize_forecast


class LiveTests(unittest.TestCase):
    def station(self, lat=13.73, value=-0.2):
        return {'station': {'id': 1, 'tele_station_name': {'th': 'KMITL'},
                            'tele_station_lat': lat, 'tele_station_long': 100.78},
                'waterlevel_msl': value, 'waterlevel_datetime': datetime.now(BANGKOK).isoformat()}

    def test_only_nearby_stations_and_valid_values(self):
        result = normalize_stations({'waterlevel_data': {'data': [self.station(), self.station(18), self.station(value='NaN')]}}, 'water')
        self.assertEqual(len(result['rows']), 1)
        self.assertEqual(result['rows'][0]['value'], -0.2)
        self.assertFalse(result['rows'][0]['stale'])
        self.assertEqual(result['rejected'], 1)

    def test_rain_is_24h_snapshot_not_hourly(self):
        record = self.station()
        record['rain_24h'] = 0
        record['rainfall_datetime'] = record['waterlevel_datetime']
        result = normalize_stations({'data': [record]}, 'rain')['rows'][0]
        self.assertEqual(result['value'], 0)
        self.assertEqual(result['unit'], 'mm / 24h')

    def test_missing_schema_is_error_not_empty(self):
        with self.assertRaises(ValueError):
            normalize_stations({'message': 'unauthorized'}, 'water')

    def test_stale_station_is_flagged(self):
        record = self.station()
        record['waterlevel_datetime'] = '2020-01-01 00:00:00'
        self.assertTrue(normalize_stations({'data': [record]}, 'water')['rows'][0]['stale'])

    def test_forecast_preserves_missing_and_filters_past(self):
        payload = {'hourly': {'time': [time.time()-7200, time.time()+7200],
                             'precipitation': [5, None], 'precipitation_probability': [50, None]},
                   'hourly_units': {'precipitation': 'mm', 'precipitation_probability': '%'}}
        rows = normalize_forecast(payload)['rows']
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]['precipitation_mm'])
        self.assertTrue(rows[0]['timestamp'].endswith('+07:00'))

    def test_failure_is_cached_and_no_demo_fallback(self):
        calls = []
        def fail(url):
            calls.append(url)
            raise OSError('offline')
        service = LiveService(fail)
        for _ in range(2):
            result = service.get()
            for feed in result['feeds'].values():
                self.assertEqual(feed['status'], 'error')
                self.assertEqual(feed['rows'], [])
        self.assertEqual(len(calls), 3)


if __name__ == '__main__':
    unittest.main()
