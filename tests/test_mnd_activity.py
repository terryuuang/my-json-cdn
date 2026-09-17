import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('mnd', Path(__file__).resolve().parents[1] / 'scripts/update_mnd_activity.py')
mnd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mnd)


class ReportParsingTests(unittest.TestCase):
    def report(self, body):
        return mnd.parse_report('<div class="maincontent"><p>中華民國115年9月16日0600時至115年9月17日0600時止。</p>' + body + '</div>', 'https://www.mnd.gov.tw/news/plaact/87777')

    def test_totals_and_combined_area_are_distinct(self):
        row = self.report('<p>偵獲共機19架次（逾越中線進入北部、西南及東部空域共17架次）、共艦8艘及公務船2艘。</p>')
        self.assertEqual((row['aircraft'], row['reportedAreaAircraft'], row['vessels'], row['officialShips']), (19, 17, 8, 2))
        self.assertEqual((row['periodStart'], row['date']), ('2026-09-16', '2026-09-17'))

    def test_explicit_none_is_zero_but_unreported_fields_are_null(self):
        row = self.report('<p>偵獲共艦5艘。上述期間未偵獲共機，故無提供航跡圖。</p>')
        self.assertEqual(row['aircraft'], 0)
        self.assertIsNone(row['officialShips'])
        self.assertIsNone(row['reportedAreaAircraft'])
        self.assertIsNone(row['imageUrl'])

    def test_area_count_without_total_prefix(self):
        row = self.report('<p>共機4架次（進入西南及東部空域2架次）、共艦6艘及公務船2艘。</p>')
        self.assertEqual(row['reportedAreaAircraft'], 2)

    def test_missing_and_inconsistent_counts_fail_closed(self):
        with self.assertRaises(ValueError):
            self.report('<p>網站維護中</p>')
        with self.assertRaises(ValueError):
            self.report('<p>共機2架（進入空域共3架）、共艦1艘</p>')

    def test_external_images_are_not_republished(self):
        row = self.report('<p>共機1架、共艦1艘</p><img src="https://example.com/tracker"><img src="/NewUpload/report.jpg">')
        self.assertEqual(row['imageUrl'], 'https://www.mnd.gov.tw/NewUpload/report.jpg')


if __name__ == '__main__':
    unittest.main()
