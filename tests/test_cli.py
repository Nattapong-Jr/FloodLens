"""CLI diagnostics contracts, independent of network access."""
import io
import json
import unittest
from unittest.mock import patch

from app import main


class CheckLiveTests(unittest.TestCase):
    def check(self, status):
        result = {'feeds': {'water': {'status': status, 'rows': []}}}
        with patch('sys.argv', ['app.py', '--check-live']), \
                patch('app.LiveService') as service, \
                patch('app.load_csv') as csv, \
                patch('sys.stdout', new_callable=io.StringIO) as output:
            service.return_value.get.return_value = result
            code = main()
            csv.assert_not_called()
            self.assertEqual(json.loads(output.getvalue()), result)
            return code

    def test_success_exit_code(self):
        self.assertEqual(self.check('ok'), 0)

    def test_failure_and_empty_exit_codes(self):
        for status in ('error', 'empty'):
            with self.subTest(status=status):
                self.assertEqual(self.check(status), 1)
