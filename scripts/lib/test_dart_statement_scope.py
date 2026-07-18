"""DART 재무제표 파싱 시 주석(note) 표에서 계정이 새어드는 것을 차단하는 회귀 검증.

배경(2026-07-18): 일부 회사(케이비오토텍·평화기공 등)의 손익계산서는 성질별 분류라
'매출원가' 행이 없다. _parse_financial_tables가 문서 전체(재무제표+주석 200여 표)를
훑어 계정별 첫 매칭을 취하면서, 매출원가를 **주석 표**에서 잘못 집어 단위(천원→백만원
미변환, 1000×)·계정(세부라인) 오적재가 발생했다. 손익계정은 '손익계산서 본표'에서만,
대차계정은 '재무상태표 본표'에서만 추출해야 한다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_dart_statement_scope.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'collect_dart_audit', SCRIPTS_DIR / 'collect_dart_audit.py'
)
aud = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(aud)


def tables(html: str):
    return BeautifulSoup(html, 'html.parser').find_all('table')


# 손익계산서 본표 (매출원가 없음 = 성질별) + 뒤이은 주석 표(매출원가 오값)
IS_NO_COGS_PLUS_NOTE = """
<table>
  <tr><th>과목</th><th>당기</th></tr>
  <tr><td>I. 매출액</td><td>100,000,000,000</td></tr>
  <tr><td>V. 영업이익</td><td>5,000,000,000</td></tr>
  <tr><td>당기순이익</td><td>3,000,000,000</td></tr>
</table>
<table>
  <tr><th>주석 30. 비용의 성격별 분류</th><th></th></tr>
  <tr><td>매출원가</td><td>239,037,574</td></tr>
</table>
"""

# 손익계산서 본표에 매출원가가 있는 경우 (정상 추출)
IS_WITH_COGS = """
<table>
  <tr><td>매출액</td><td>100,000,000,000</td></tr>
  <tr><td>매출원가</td><td>80,000,000,000</td></tr>
  <tr><td>영업이익</td><td>5,000,000,000</td></tr>
  <tr><td>당기순이익</td><td>3,000,000,000</td></tr>
</table>
"""

# 재무상태표 본표 + 주석의 재고자산 세부(오값)
BS_PLUS_NOTE = """
<table>
  <tr><td>자산총계</td><td>50,000,000,000</td></tr>
  <tr><td>재고자산</td><td>8,000,000,000</td></tr>
  <tr><td>부채총계</td><td>30,000,000,000</td></tr>
  <tr><td>자본총계</td><td>20,000,000,000</td></tr>
</table>
<table>
  <tr><th>주석 10. 재고자산 명세</th><th></th></tr>
  <tr><td>재고자산</td><td>111,111</td></tr>
</table>
"""


# 본 손익계산서(매출원가 없음) + 뒤쪽 요약표(전 계정 보유, 단위 다름) — 케이비오토텍 패턴
IS_PRIMARY_THEN_SUMMARY = """
<table>
  <tr><td>I. 매출액</td><td>100,000,000,000</td></tr>
  <tr><td>V. 영업이익</td><td>5,000,000,000</td></tr>
  <tr><td>당기순이익</td><td>3,000,000,000</td></tr>
</table>
<table>
  <tr><th>요약재무정보 (단위 상이)</th><th></th></tr>
  <tr><td>매출액</td><td>100,000,000</td></tr>
  <tr><td>매출원가</td><td>239,037,574</td></tr>
  <tr><td>영업이익</td><td>5,000,000</td></tr>
  <tr><td>당기순이익</td><td>3,000,000</td></tr>
  <tr><td>자산총계</td><td>50,000,000</td></tr>
  <tr><td>부채총계</td><td>30,000,000</td></tr>
  <tr><td>자본총계</td><td>20,000,000</td></tr>
</table>
"""


class TestStatementScope(unittest.TestCase):
    def test_cogs_not_pulled_from_notes(self):
        r = aud._parse_financial_tables(tables(IS_NO_COGS_PLUS_NOTE))
        self.assertAlmostEqual(r['revenue']['current'], 100000.0)
        self.assertAlmostEqual(r['operating_income']['current'], 5000.0)
        # 매출원가는 손익계산서 본표에 없음 → 주석값(239,037,574)을 집으면 안 됨
        self.assertNotIn('cogs', r)

    def test_cogs_extracted_when_in_income_statement(self):
        r = aud._parse_financial_tables(tables(IS_WITH_COGS))
        self.assertAlmostEqual(r['revenue']['current'], 100000.0)
        self.assertAlmostEqual(r['cogs']['current'], 80000.0)

    def test_cogs_not_from_later_summary_table(self):
        """본 손익계산서에 매출원가가 없으면, 뒤쪽 요약표(전 계정 보유)에서 채우지 않는다."""
        r = aud._parse_financial_tables(tables(IS_PRIMARY_THEN_SUMMARY))
        self.assertAlmostEqual(r['revenue']['current'], 100000.0)  # 본표에서
        self.assertNotIn('cogs', r)  # 뒤 요약표 값(239,037,574)을 안 집음

    def test_inventory_from_balance_sheet_not_note(self):
        r = aud._parse_financial_tables(tables(BS_PLUS_NOTE))
        self.assertAlmostEqual(r['total_assets']['current'], 50000.0)
        self.assertAlmostEqual(r['inventory']['current'], 8000.0)  # 본표값, 주석 111,111 아님


if __name__ == '__main__':
    unittest.main()
