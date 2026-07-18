"""fnguide 신규 레이아웃(SVD_Finance) 파싱 회귀 검증.

배경(2026-07-18): fnguide가 Snapshot Financial Highlight를 회사 무관 fallback으로
바꾸고(snap[9] 가비지) 연간/분기 통합표로 변경 → 옛 _find_annual_table이 표를 못 찾아
KR 상장사 0행 수집. 정답 경로 = SVD_Finance.asp 직접 URL:
  fin[0]=연간손익, fin[1]=분기손익(discrete Q4!), fin[2]=연간재무상태, fin[3]=분기재무상태.
대차대조표 총계 라벨이 자산총계→'자산', 부채총계→'부채', 자본총계→'자본'로 바뀜.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_fnguide_svd.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'collect_financials', SCRIPTS_DIR / 'collect_financials.py'
)
cf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cf)

# ── 넥센타이어(002350) 실측 SVD_Finance 테이블 (억원) ──────────────────────
FIN0_ANNUAL_IS = {
    'headers': ['IFRS(연결)', '2023/12', '2024/12', '2025/12', '2026/03', '전년동기', '전년동기(%)'],
    'rows': [
        ['매출액', '27,017', '28,479', '31,896', '8,383', '7,712', '8.7'],
        ['매출원가', '19,624', '20,550', '23,165', '5,918', '5,696', '3.9'],
        ['매출총이익', '7,393', '7,929', '8,731', '2,465', '2,016', '22.3'],
        ['판매비와관리비', '5,523', '6,208', '7,028', '1,923', '1,609', '19.5'],
        ['영업이익', '1,870', '1,721', '1,703', '542', '407', '33.1'],
        ['당기순이익', '1,031', '1,267', '1,512', '620', '399', '55.3'],
    ],
}
FIN1_QTR_IS = {
    'headers': ['IFRS(연결)', '2025/06', '2025/09', '2025/12', '2026/03', '전년동기', '전년동기(%)'],
    'rows': [
        ['매출액', '8,047', '7,807', '8,331', '8,383', '7,712', '8.7'],
        ['매출원가', '5,897', '5,575', '5,997', '5,918', '5,696', '3.9'],
        ['영업이익', '426', '465', '405', '542', '407', '33.1'],
        ['당기순이익', '192', '548', '372', '620', '399', '55.3'],
    ],
}
FIN2_ANNUAL_BS = {
    'headers': ['IFRS(연결)', '2023/12', '2024/12', '2025/12', '2026/03'],
    'rows': [
        ['자산', '42,327', '45,745', '47,095', '48,592'],
        ['유동자산', '15,561', '18,751', '19,711', '20,993'],
        ['재고자산', '6,408', '8,940', '8,659', '8,659'],
        ['비유동자산', '26,766', '26,994', '27,384', '27,599'],
        ['부채', '25,278', '27,029', '26,551', '27,141'],
        ['유동부채', '13,300', '14,543', '12,520', '12,498'],
        ['자본', '17,049', '18,716', '20,545', '21,451'],
        ['자본금', '541', '541', '541', '541'],
    ],
}
FIN3_QTR_BS = {
    'headers': ['IFRS(연결)', '2025/06', '2025/09', '2025/12', '2026/03'],
    'rows': [
        ['자산', '47,549', '49,417', '47,095', '48,592'],
        ['부채', '28,448', '29,483', '26,551', '27,141'],
        ['자본', '19,101', '19,934', '20,545', '21,451'],
    ],
}
# 무관 표(주주·peer 등) — 분류기가 무시해야 함
PEER_GARBAGE = {
    'headers': ['구분', '삼성전자', 'WI26 반도체', '코스피 전기·전자', '코스피'],
    'rows': [['매출액', '3,336,059', '4,679,371', '6,823,927', '39,172,046']],
}
HOLDERS = {'headers': ['운용사명', '보유수량'], 'rows': [['삼성자산운용', '100']]}

ALL_TABLES = [HOLDERS, PEER_GARBAGE, FIN0_ANNUAL_IS, FIN1_QTR_IS, FIN2_ANNUAL_BS, FIN3_QTR_BS]


class TestPeriodKind(unittest.TestCase):
    def test_annual_tables(self):
        self.assertEqual(cf._table_period_kind(FIN0_ANNUAL_IS), 'annual')
        self.assertEqual(cf._table_period_kind(FIN2_ANNUAL_BS), 'annual')

    def test_quarterly_tables(self):
        self.assertEqual(cf._table_period_kind(FIN1_QTR_IS), 'quarterly')
        self.assertEqual(cf._table_period_kind(FIN3_QTR_BS), 'quarterly')


class TestClassify(unittest.TestCase):
    def test_picks_four_tables(self):
        c = cf._classify_finance_tables(ALL_TABLES)
        self.assertIs(c['annual_income'], FIN0_ANNUAL_IS)
        self.assertIs(c['quarterly_income'], FIN1_QTR_IS)
        self.assertIs(c['annual_balance'], FIN2_ANNUAL_BS)
        self.assertIs(c['quarterly_balance'], FIN3_QTR_BS)

    def test_ignores_peer_garbage(self):
        """peer 표(첫행 '매출액'이지만 날짜 헤더 없음)를 손익표로 오인하지 않는다."""
        c = cf._classify_finance_tables([PEER_GARBAGE, HOLDERS])
        self.assertIsNone(c['annual_income'])
        self.assertIsNone(c['quarterly_income'])


class TestBalanceTotalsMapping(unittest.TestCase):
    def test_short_labels_map_to_totals(self):
        """신규 라벨 '자산'/'부채'/'자본' → total_assets/liabilities/equity (억원×100)."""
        pd = {}
        cf._merge_balance_table(pd, FIN2_ANNUAL_BS, cf.FNGUIDE_UNIT_MULTIPLIER)
        y2025 = pd['2025-12-31']
        self.assertEqual(y2025['total_assets'], 4709500.0)      # 47,095 × 100
        self.assertEqual(y2025['total_liabilities'], 2655100.0)  # 26,551 × 100
        self.assertEqual(y2025['total_equity'], 2054500.0)       # 20,545 × 100
        self.assertEqual(y2025['inventory'], 865900.0)           # 8,659 × 100


class TestBuildRows(unittest.TestCase):
    def _annual_rows(self):
        pd = cf._parse_income_table(FIN0_ANNUAL_IS, cf.FNGUIDE_UNIT_MULTIPLIER)
        cf._merge_balance_table(pd, FIN2_ANNUAL_BS, cf.FNGUIDE_UNIT_MULTIPLIER)
        return cf._build_kr_rows('cid', 'KRW', 'annual', pd, fiscal_year_end_month=12)

    def test_annual_excludes_latest_quarter_column(self):
        rows = self._annual_rows()
        years = {r['fiscal_year'] for r in rows}
        self.assertEqual(years, {2023, 2024, 2025})  # 2026/03 분기열 제외
        y25 = next(r for r in rows if r['fiscal_year'] == 2025)
        self.assertEqual(y25['revenue'], 3189600.0)  # 31,896 × 100
        self.assertEqual(y25['total_liabilities'], 2655100.0)

    def test_quarterly_gives_discrete_q4(self):
        pd = cf._parse_income_table(FIN1_QTR_IS, cf.FNGUIDE_UNIT_MULTIPLIER)
        rows = cf._build_kr_rows('cid', 'KRW', 'quarterly', pd, fiscal_year_end_month=12)
        q4 = next(r for r in rows if r['fiscal_year'] == 2025 and r['fiscal_quarter'] == 4)
        self.assertEqual(q4['revenue'], 833100.0)  # 8,331 × 100 (discrete, NOT 연간)


class TestKrHealth(unittest.TestCase):
    """fnguide 구조 변경 감지 — 대량 0행이면 이상(False)."""

    def test_structure_break_all_zero(self):
        self.assertFalse(cf._kr_health_ok(attempted=169, with_data=0))
        self.assertFalse(cf._kr_health_ok(attempted=169, with_data=5))

    def test_healthy_most_collected(self):
        self.assertTrue(cf._kr_health_ok(attempted=169, with_data=160))
        self.assertTrue(cf._kr_health_ok(attempted=10, with_data=5))  # 정확히 절반 OK

    def test_too_few_to_judge(self):
        # 회사 10개 미만이면 신호 부족 → 판단 보류(True), 정상 회사 과차단 방지
        self.assertTrue(cf._kr_health_ok(attempted=5, with_data=0))
        self.assertTrue(cf._kr_health_ok(attempted=0, with_data=0))


if __name__ == '__main__':
    unittest.main()
