"""DART 계정명→DB 컬럼 매핑(_match_acct) 회귀 검증.

배경(2026-07-17): collect_dart_domestic._try_finstate_all이 부분문자열 매칭
`next((v for k,v in ACCT_TO_DB.items() if k in acc_nm))`을 써서, 짧은 키 '매출'이
'매출채권'(외상매출금)을 잡아 revenue 자리에 매출채권을 넣었다(59+개사 매출 축소·이익률 뻥튀기).
collect_dart_domestic이 이제 _match_acct(정확일치 우선 + ACCT_REJECT)를 쓰므로,
이 계약(매출채권→None, 매출액→revenue 등)이 깨지면 즉시 실패해야 한다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_dart_accounts.py
  또는  scripts/venv/Scripts/python.exe scripts/lib/test_dart_accounts.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'collect_dart_audit', SCRIPTS_DIR / 'collect_dart_audit.py'
)
aud = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(aud)


class TestMatchAcct(unittest.TestCase):
    def test_revenue_accounts(self):
        for raw in ('매출액', '영업수익', '수익(매출액)', '매출(영업수익)'):
            self.assertEqual(aud._match_acct(raw), 'revenue', raw)

    def test_cogs_and_others(self):
        self.assertEqual(aud._match_acct('매출원가'), 'cogs')
        self.assertEqual(aud._match_acct('판매비와관리비'), 'sga')
        self.assertEqual(aud._match_acct('영업이익'), 'operating_income')
        self.assertEqual(aud._match_acct('당기순이익'), 'net_income')
        self.assertEqual(aud._match_acct('자산총계'), 'total_assets')

    def test_rejected_traps_not_revenue(self):
        """핵심 회귀: 대차대조표 함정계정이 revenue로 오매핑되면 안 된다."""
        # 매출채권(외상매출금) — 이번 버그의 주범
        self.assertIsNone(aud._match_acct('매출채권'))
        self.assertIsNone(aud._match_acct('매출채권및기타채권'))
        # 매출총이익 — 매출과 혼동되기 쉬움
        self.assertIsNone(aud._match_acct('매출총이익'))
        # 매출원가율(비율) — cogs 아님
        self.assertIsNone(aud._match_acct('매출원가율'))

    def test_rejected_are_not_any_column(self):
        for trap in ('매출채권', '매출총이익', '매출원가율', '단기차입금', '영업외수익'):
            self.assertIsNone(aud._match_acct(trap), trap)

    def test_exact_before_partial(self):
        """매출액은 revenue, 매출원가는 cogs — 정확일치가 부분일치보다 우선."""
        self.assertEqual(aud._match_acct('매출액'), 'revenue')
        self.assertNotEqual(aud._match_acct('매출원가'), 'revenue')


if __name__ == '__main__':
    unittest.main()
