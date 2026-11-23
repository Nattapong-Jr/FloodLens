import tempfile
import unittest
from pathlib import Path
from floodlens.data import FIELDS, load_csv


class DataTests(unittest.TestCase):
    def load(self, lines):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'test.csv'
            path.write_text(','.join(FIELDS) + '\n' + '\n'.join(lines), encoding='utf-8')
            return load_csv(path)

    def test_duplicates_do_not_double_count_rain(self):
        row = '2026-10-01T00:00:00+07:00,S1,5,1,demo,true'
        rows, issues = self.load([row, row])
        self.assertEqual(sum(r['rain_mm'] for r in rows), 5)
        self.assertEqual(len(issues), 1)

    def test_missing_is_not_zero(self):
        rows, issues = self.load(['2026-10-01T00:00:00+07:00,S1,,0,demo,true'])
        self.assertIsNone(rows[0]['rain_mm'])
        self.assertEqual(rows[0]['water_level_m'], 0)
        self.assertEqual(len(issues), 1)

    def test_invalid_values_rejected(self):
        for rain in ('-1', 'NaN', 'inf', 'abc'):
            with self.subTest(rain=rain):
                rows, issues = self.load([f'2026-10-01T00:00:00+07:00,S1,{rain},1,demo,true'])
                self.assertEqual(rows, [])
                self.assertTrue(issues)

    def test_timezone_required(self):
        rows, issues = self.load(['2026-10-01T00:00:00,S1,1,1,demo,true'])
        self.assertFalse(rows)
        self.assertTrue(issues)

    def test_negative_water_level_can_be_valid(self):
        rows, issues = self.load(['2026-10-01T00:00:00+07:00,S1,0,-0.2,demo,true'])
        self.assertEqual(rows[0]['water_level_m'], -0.2)
        self.assertFalse(issues)


if __name__ == '__main__':
    unittest.main()
