"""yfinance 글로벌 재무의 회계연도 -1 보정 회귀 검증.

배경(2026-11-02): 비-12월 결산사의 분기 행이 같은 결산일로 fiscal_year 만 1 차이로
두 번 쌓였다(9개사 29묶음, 정리 = 마이그레이션 20261103000001). 보정 여부(`fy_offset`)는
연간 손익의 첫 결산일로 판단하는데, yfinance 가 연간 손익을 빈 값으로 주는 날이면
판단 근거가 없어 보정 없이(0) 분기 행을 적재했다 → 같은 중복이 다시 생긴다.

이 테스트가 지키는 것:
  1. 연간 손익이 비면 그 회사는 행을 내지 않는다(결산월을 모르면 키를 못 정한다).
  2. 비-12월 결산(8월)은 분기·연간 모두 -1, 12월 결산은 0.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_yf_fiscal_offset.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'collect_financials', SCRIPTS_DIR / 'collect_financials.py'
)
cf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cf)


def _frame(*ends):
    """결산일 열마다 매출 1개를 가진 yfinance 형태 DataFrame."""
    return pd.DataFrame(
        {pd.Timestamp(e): [100.0] for e in ends}, index=['Total Revenue']
    )


EMPTY = pd.DataFrame()


class _FakeTicker:
    def __init__(self, annual, quarterly):
        self.info = {'financialCurrency': 'USD'}
        self.income_stmt = annual
        self.balance_sheet = EMPTY
        self.quarterly_income_stmt = quarterly
        self.quarterly_balance_sheet = EMPTY


def _collect(ticker_obj):
    company = {'status': 'active', 'ticker': 'JBL', 'name_kr': '자빌'}
    with mock.patch.object(cf, 'get_global_companies', return_value=[company]), \
         mock.patch.object(cf.yf, 'Ticker', return_value=ticker_obj):
        return cf._collect_global_financials({'JBL': 'cid'}, {'JBL': 'USD'})


class YfFiscalOffsetTest(unittest.TestCase):
    def test_empty_annual_emits_no_rows(self):
        # 2026-05-21 형태: 분기는 오는데 연간이 비었다 → 보정 없는 키(2025Q4)가 새로 생기던 경로
        rows = _collect(_FakeTicker(EMPTY, _frame('2025-11-30', '2026-02-28')))
        self.assertEqual(rows, [])

    def test_none_annual_emits_no_rows(self):
        rows = _collect(_FakeTicker(None, _frame('2025-11-30')))
        self.assertEqual(rows, [])

    def test_non_december_year_end_shifts_minus_one(self):
        rows = _collect(_FakeTicker(_frame('2025-08-31'), _frame('2025-11-30', '2026-02-28')))
        keys = {(r['period_type'], r['period_end_date'], r['fiscal_year'], r['fiscal_quarter'])
                for r in rows}
        self.assertEqual(keys, {
            ('annual', '2025-08-31', 2024, None),
            ('quarterly', '2025-11-30', 2024, 4),
            ('quarterly', '2026-02-28', 2025, 1),
        })

    def test_december_year_end_keeps_calendar_year(self):
        rows = _collect(_FakeTicker(_frame('2025-12-31'), _frame('2025-12-31')))
        self.assertEqual({r['fiscal_year'] for r in rows}, {2025})


if __name__ == '__main__':
    unittest.main()
