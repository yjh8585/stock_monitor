"""collect_stellantis_shipments_ir 파싱 회귀 검증 — fixture 기반 unittest.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_stellantis_shipments_ir.py

네트워크·DB 없이 순수 함수만 검증한다. fixture는 2026-07-16에 stellantis.com Q2 2026
'Estimated Consolidated Shipments' 릴리스에서 실제로 관측한 지역별 표를 그대로 옮긴 것이다.
고정하는 함정:
  1. 표 첫 열 'units/000' (천대) + 헤더 첫 기간이 슬러그의 (분기,연도)와 일치해야 당기 열이다.
  2. 'North America' 행의 **첫 숫자**가 당기 출하(뒤 열은 전년·증감·%).
  3. 슬러그에서 (분기, 연도) 파싱.
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'collect_stellantis_shipments_ir', SCRIPTS_DIR / 'collect_stellantis_shipments_ir.py'
)
col = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(col)


# stellantis.com Q2 2026 릴리스 실측 표 (units/000).
Q2_2026_TABLE = [
    ['units/000', 'Consolidated Shipments (1)'],
    ['Q2 2026', 'Q2 2025', 'Unit change', '% Change'],
    ['Stellantis', '1,597', '1,447', '150', '10%'],
    ['North America', '445', '323', '122', '38%'],
    ['Enlarged Europe', '762', '723', '39', '5%'],
    ['Middle East & Africa', '121', '125', '(4)', '(3%)'],
    ['South America', '253', '260', '(7)', '(3%)'],
    ['Asia Pacific', '16', '16', '0', '0%'],
]

Q2_URL = (
    'https://www.stellantis.com/en/news/press-releases/2026/july/'
    'stellantis-reports-q2-2026-estimated-consolidated-shipments-of-1-6-million-units-'
    '10-percent-year-over-year'
)
Q1_URL = (
    'https://www.stellantis.com/en/news/press-releases/2026/april/'
    'stellantis-reports-q1-2026-estimated-consolidated-shipments-of-1-4-million-units-12-percent-y-o-y'
)


class SlugTest(unittest.TestCase):
    def test_q2_slug(self):
        self.assertEqual(col.parse_slug_period(Q2_URL), (2, 2026))

    def test_q1_slug(self):
        self.assertEqual(col.parse_slug_period(Q1_URL), (1, 2026))

    def test_non_shipment_pr_is_none(self):
        url = 'https://www.stellantis.com/en/news/press-releases/2026/june/stellantis-and-uber-partner'
        self.assertIsNone(col.parse_slug_period(url))

    def test_financial_results_pr_is_none(self):
        url = 'https://www.stellantis.com/en/news/press-releases/2026/april/first-quarter-2026-financial-results'
        self.assertIsNone(col.parse_slug_period(url))


class NumericCellTest(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(col.parse_numeric_cell('445'), 445)

    def test_thousands_separator(self):
        self.assertEqual(col.parse_numeric_cell('1,597'), 1597)

    def test_parenthesized_negative(self):
        self.assertEqual(col.parse_numeric_cell('(4)'), -4)

    def test_percent_is_none(self):
        self.assertIsNone(col.parse_numeric_cell('38%'))

    def test_label_is_none(self):
        self.assertIsNone(col.parse_numeric_cell('North America'))


class PeriodColumnTest(unittest.TestCase):
    def test_finds_current_period_header(self):
        idx = col.find_current_period_column(Q2_2026_TABLE, 2, 2026)
        # 헤더 행 ['Q2 2026', 'Q2 2025', ...]의 0번 열
        self.assertEqual(idx, 0)

    def test_wrong_period_not_found(self):
        # 이 표는 Q2 2026인데 Q3 2026을 찾으면 None (엉뚱한 릴리스 방어)
        self.assertIsNone(col.find_current_period_column(Q2_2026_TABLE, 3, 2026))


class ExtractNorthAmericaTest(unittest.TestCase):
    def test_extracts_current_quarter_value(self):
        # 당기(Q2 2026) 북미 = 445천대 (전년 323이 아니라)
        self.assertEqual(col.extract_north_america_thousands(Q2_2026_TABLE, 2, 2026), 445)

    def test_header_mismatch_returns_none(self):
        # 헤더가 Q2 2026인데 Q1을 요구하면 정합 실패 → None
        self.assertIsNone(col.extract_north_america_thousands(Q2_2026_TABLE, 1, 2026))

    def test_no_north_america_row_returns_none(self):
        rows = [
            ['units/000', 'Consolidated Shipments (1)'],
            ['Q2 2026', 'Q2 2025', 'Unit change', '% Change'],
            ['Enlarged Europe', '762', '723', '39', '5%'],
        ]
        self.assertIsNone(col.extract_north_america_thousands(rows, 2, 2026))

    def test_full_thousands_conversion(self):
        # 수집기가 ×1000 하므로 파싱은 천대 단위(445)를 그대로 돌려준다
        thousands = col.extract_north_america_thousands(Q2_2026_TABLE, 2, 2026)
        self.assertEqual(thousands * col.UNITS_PER_THOUSAND, 445000)


if __name__ == '__main__':
    unittest.main(verbosity=2)
