"""DART 보고서 «회계연도» 선택 회귀 검증 (`_stated_fiscal_year` · `_get_audit_rcpt`).

배경(2026-09-11 실측): 옛 코드는 보고서명이 밝힌 연도를 무시하고 제출일 추정
(`_infer_fiscal_year_from_rcept`)으로도 후보를 받아들였다. 정정 공시는 몇 년 뒤에
제출되므로 이 추정이 무력하다 — 2025년 11월에 낸 `[기재정정]감사보고서 (2022.12)` 가
FY2025 후보로 들어왔고, `_score_report` 의 `[기재정정]` 가산점(+4)이 진짜 FY2025
보고서(점수 3)를 이겨 **3년 전 실적이 FY2025 로 적재**됐다.

실측으로 확인한 실제 사고(둘 다 이 수정 전에는 MISMATCH):
  - 세진(00237093)       FY2025 → `[기재정정]연결감사보고서 (2022.12)`
  - 동희하이테크(00575601) FY2025 → `[기재정정]연결감사보고서 (2023.12)`

🔴 정정본 «우선» 자체는 옳다 — 같은 연도의 정정본은 여전히 원본을 이겨야 한다.
   이 테스트는 「연도가 다른 정정본이 이기는 것」만 막는다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_dart_fiscal_year.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

import pandas as pd

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'collect_dart_audit', SCRIPTS_DIR / 'collect_dart_audit.py'
)
aud = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(aud)

stated = aud._stated_fiscal_year

# 세진(00237093)의 실제 공시 목록 일부 — 2026-09-11 DART 조회 실측값.
SEJIN_FILINGS = [
    ('20260430', '20260430000046', '연결감사보고서 (2025.12)'),
    ('20260403', '20260403000528', '감사보고서 (2025.12)'),
    ('20251103', '20251103000071', '[기재정정]연결감사보고서 (2022.12)'),
    ('20251103', '20251103000068', '[기재정정]연결감사보고서 (2021.12)'),
    ('20251103', '20251103000065', '[기재정정]감사보고서 (2021.12)'),
    ('20251103', '20251103000062', '[기재정정]감사보고서 (2020.12)'),
    ('20250411', '20250411000426', '연결감사보고서 (2024.12)'),
    ('20240430', '20240430000403', '연결감사보고서 (2023.12)'),
    ('20220429', '20220429000498', '연결감사보고서 (2021.12)'),
]


class _FakeDart:
    """`dart.list` 만 흉내 내는 가짜 — 네트워크 없이 선택 로직만 검증한다."""

    def __init__(self, rows):
        self._rows = rows

    def list(self, corp_code, start=None, end=None, final=False, **kwargs):
        start_compact = (start or '').replace('-', '')
        end_compact = (end or '').replace('-', '')
        keep = [
            r for r in self._rows
            if (not start_compact or r[0] >= start_compact)
            and (not end_compact or r[0] <= end_compact)
        ]
        return pd.DataFrame(keep, columns=['rcept_dt', 'rcept_no', 'report_nm'])


def _pick(rows, fiscal_year):
    """`_get_audit_rcpt` 이 고른 보고서명을 돌려준다."""
    _, report_nm, _ = aud._get_audit_rcpt(_FakeDart(rows), '00000000', fiscal_year)
    return report_nm


class StatedFiscalYearTest(unittest.TestCase):
    def test_보고서명이_밝힌_연도를_읽는다(self):
        self.assertEqual(stated('감사보고서 (2022.12)'), 2022)
        self.assertEqual(stated('[기재정정]연결감사보고서 (2021.12)'), 2021)
        self.assertEqual(stated('사업보고서 (2023.12)'), 2023)

    def test_비_12월_결산도_읽는다(self):
        # 덴소형 3월 결산. 연도 보정은 호출부 책임이고 여기선 표기 그대로 읽는다.
        self.assertEqual(stated('감사보고서 (2024.03)'), 2024)

    def test_연도가_없으면_None(self):
        self.assertIsNone(stated('감사보고서'))
        self.assertIsNone(stated(''))
        self.assertIsNone(stated(None))

    def test_월이_말이_안_되면_None(self):
        # 연도처럼 생긴 다른 괄호값을 회계연도로 오인하지 않는다.
        self.assertIsNone(stated('무슨보고서 (2022.99)'))


class AuditReportPickTest(unittest.TestCase):
    def test_정정본이_연도를_넘어_이기지_못한다(self):
        """🔴 이 회귀가 실제 사고다 — 옛 코드는 2022 정정본을 골랐다."""
        self.assertEqual(_pick(SEJIN_FILINGS, 2025), '연결감사보고서 (2025.12)')

    def test_같은_연도에서는_정정본이_이긴다(self):
        self.assertEqual(_pick(SEJIN_FILINGS, 2021), '[기재정정]연결감사보고서 (2021.12)')

    def test_같은_연도_같은_정정_등급이면_연결이_이긴다(self):
        self.assertEqual(_pick(SEJIN_FILINGS, 2023), '연결감사보고서 (2023.12)')

    def test_해당_연도_보고서가_없으면_아무것도_고르지_않는다(self):
        """없는 것을 «있는 것처럼» 채우면 그것이 곧 유령 행이 된다."""
        self.assertIsNone(_pick(SEJIN_FILINGS, 2019))

    def test_연도를_안_밝힌_보고서는_제출일로_추정한다(self):
        rows = [('20230330', '20230330000001', '감사보고서')]
        self.assertEqual(_pick(rows, 2022), '감사보고서')  # 3월 제출 → FY2022
        self.assertIsNone(_pick(rows, 2023))

    def test_감사보고서가_없으면_사업보고서로_폴백한다(self):
        rows = [('20240330', '20240330000001', '사업보고서 (2023.12)')]
        self.assertEqual(_pick(rows, 2023), '사업보고서 (2023.12)')

    def test_분기_반기_보고서는_연간으로_쓰지_않는다(self):
        rows = [
            ('20230515', '20230515000001', '분기보고서 (2023.03)'),
            ('20230814', '20230814000001', '반기보고서 (2023.06)'),
        ]
        self.assertIsNone(_pick(rows, 2023))


if __name__ == '__main__':
    unittest.main()
