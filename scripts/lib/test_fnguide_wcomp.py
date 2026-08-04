"""fnguide 신버전(wcomp) JSON 계약 파싱 회귀 검증.

배경(2026-08-04): 구 `comp.fnguide.com`이 폐지되고 `wcomp.fnguide.com`으로 이전되면서
재무제표가 HTML 표가 아니라 JSON 엔드포인트(`getFinIncome`/`getFinBalance`)로 바뀌었다.
계정 식별도 계정명 문자열이 아니라 회사 무관 표준 `AC_CODE`로 한다.
계약 상세는 docs/fnguide-wcomp-migration.md.

이 테스트가 지키는 것:
  1. 연간(Y) 응답에 섞여 오는 '(최근분기)' 열이 연간으로 적재되지 않는다
     — 특히 3월 결산 회사에서 결산월 비교만으로는 못 걸러낸다.
  2. '(전년동기)' 열은 freq와 무관하게 배제된다(손익만 있는 반쪽 행이 온전한 행을 덮음).
  3. 분기(Q) 응답은 discrete 분기값을 주므로 Q4가 연간누적이 되지 않는다.
  4. `부채총계`(130000)가 `자산총계`(110000)와 섞이지 않는다
     — 2026-07-18 감사에서 79개사 217행을 오염시켰던 부류.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_fnguide_wcomp.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import fnguide_client as fng  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    'collect_financials', SCRIPTS_DIR / 'collect_financials.py'
)
cf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cf)


def _row(ac_code, name, *vals):
    """dataset.data 행 하나를 만든다(VAL1..VALn)."""
    row = {'AC_CODE': ac_code, 'NAME': name, 'LVL': 0}
    for i, v in enumerate(vals, 1):
        row[f'VAL{i}'] = v
    return row


# ── 12월 결산 회사 연간 응답 (실측 형태: 연간 3년 + 최근분기 + 전년동기 + 증감률) ──
ANNUAL_INCOME = {
    'header': [
        {'YYMM': '2023/12', 'CD': 'VAL1'},
        {'YYMM': '2024/12', 'CD': 'VAL2'},
        {'YYMM': '2025/12', 'CD': 'VAL3'},
        {'YYMM': '2026/03 (최근분기)', 'CD': 'VAL4'},
        {'YYMM': '2025/03 (전년동기)', 'CD': 'VAL5'},
        {'YYMM': '전년동기대비(%)', 'CD': 'VAL6'},
    ],
    'data': [
        _row('200000', '매출액(수익)', '27017', '28479', '31896', '8383', '7712', '8.7'),
        _row('200360', '매출원가', '19624', '20550', '23165', '5918', '5696', '3.9'),
        _row('201370', '영업이익', '1870', '1721', '1703', '542', '407', '33.1'),
        _row('203170', '당기순이익', '1031', '1267', '1512', '620', '399', '55.3'),
        # 매핑에 없는 계정 — 무시돼야 한다
        _row('204490', '영업이익(발표기준)', '1870', '1721', '1703', '542', '407', '33.1'),
    ],
}

ANNUAL_BALANCE = {
    'header': [
        {'YYMM': '2023/12', 'CD': 'VAL1'},
        {'YYMM': '2024/12', 'CD': 'VAL2'},
        {'YYMM': '2025/12', 'CD': 'VAL3'},
        {'YYMM': '2026/03 (최근분기)', 'CD': 'VAL4'},
    ],
    'data': [
        _row('110000', '자산총계', '42327', '45745', '47095', '48592'),
        _row('112830', '유동자산', '15561', '18751', '19711', '20993'),
        _row('112840', '재고자산', '6408', '8940', '8659', '8659'),
        _row('130000', '부채총계', '25278', '27029', '26551', '27141'),
        _row('131580', '유동부채', '13300', '14543', '12520', '12498'),
        _row('120000', '자본총계', '17049', '18716', '20545', '21451'),
    ],
}

QUARTER_INCOME = {
    'header': [
        {'YYMM': '2025/06', 'CD': 'VAL1'},
        {'YYMM': '2025/09', 'CD': 'VAL2'},
        {'YYMM': '2025/12', 'CD': 'VAL3'},
        {'YYMM': '2026/03 (최근분기)', 'CD': 'VAL4'},
        {'YYMM': '2025/03 (전년동기)', 'CD': 'VAL5'},
        {'YYMM': '전년동기대비(%)', 'CD': 'VAL6'},
    ],
    'data': [
        _row('200000', '매출액(수익)', '8047', '7807', '8331', '8383', '7712', '8.7'),
        _row('201370', '영업이익', '426', '465', '405', '542', '407', '33.1'),
    ],
}

# ── 3월 결산 회사 연간 응답 (실측: 최근분기 라벨이 없고 4개 연도가 모두 결산값) ──
MARCH_FY_INCOME = {
    'header': [
        {'YYMM': '2023/03', 'CD': 'VAL1'},
        {'YYMM': '2024/03', 'CD': 'VAL2'},
        {'YYMM': '2025/03', 'CD': 'VAL3'},
        {'YYMM': '2026/03', 'CD': 'VAL4'},
        {'YYMM': '2025/03 (전년동기)', 'CD': 'VAL5'},
        {'YYMM': '전년동기대비(%)', 'CD': 'VAL6'},
    ],
    'data': [
        _row('200000', '매출액(수익)', '5386', '5682', '6262', '6595', '1615', '10.7'),
    ],
}

INVEST_INDEX = {
    'header': [
        {'YYMM': '2024/12', 'CD': 'VAL1'},
        {'YYMM': '2025/12', 'CD': 'VAL2'},
    ],
    'data': [
        {'NM': 'Per Share', 'LVL': 0, 'VAL1': None, 'VAL2': None},
        {'NM': '   EPS', 'LVL': 1, 'VAL1': '4,950', 'VAL2': '6,564'},
        {'NM': '   BPS', 'LVL': 1, 'VAL1': '59,225', 'VAL2': '63,997'},
        {'NM': '   PER', 'LVL': 1, 'VAL1': '10.75', 'VAL2': '18.27'},
        {'NM': '   EV/EBITDA', 'LVL': 1, 'VAL1': '4.12', 'VAL2': '7.53'},
        {'NM': '   수정DPS(보통주,현금)', 'LVL': 1, 'VAL1': '1,446', 'VAL2': '1,668'},
        {'NM': '   현금배당성향', 'LVL': 1, 'VAL1': '29.2', 'VAL2': '25.10'},  # 매핑 없음
    ],
}


class TestPeriodColumns(unittest.TestCase):
    def test_annual_excludes_latest_quarter(self):
        cols = fng.period_columns(ANNUAL_INCOME['header'], fng.FREQ_ANNUAL)
        self.assertEqual([c for c, _ in cols], ['VAL1', 'VAL2', 'VAL3'])

    def test_quarter_keeps_latest_quarter(self):
        cols = fng.period_columns(QUARTER_INCOME['header'], fng.FREQ_QUARTER)
        self.assertEqual([c for c, _ in cols], ['VAL1', 'VAL2', 'VAL3', 'VAL4'])
        self.assertEqual(cols[-1][1].isoformat(), '2026-03-31')

    def test_prior_period_always_excluded(self):
        """'(전년동기)'는 손익에만 있어 적재하면 재무상태 없는 반쪽 행이 된다."""
        for freq in (fng.FREQ_ANNUAL, fng.FREQ_QUARTER):
            cols = fng.period_columns(QUARTER_INCOME['header'], freq)
            self.assertNotIn('VAL5', [c for c, _ in cols])

    def test_growth_rate_column_excluded(self):
        """'전년동기대비(%)'는 기간이 아니라 증감률."""
        cols = fng.period_columns(ANNUAL_INCOME['header'], fng.FREQ_QUARTER)
        self.assertNotIn('VAL6', [c for c, _ in cols])

    def test_march_fiscal_year_keeps_all_four_years(self):
        """3월 결산사는 최근분기 라벨이 없어 4개 연도가 전부 결산값이다."""
        cols = fng.period_columns(MARCH_FY_INCOME['header'], fng.FREQ_ANNUAL)
        self.assertEqual([p.isoformat() for _, p in cols],
                         ['2023-03-31', '2024-03-31', '2025-03-31', '2026-03-31'])


class TestExtractAccounts(unittest.TestCase):
    def test_maps_by_ac_code_and_scales_unit(self):
        data = fng.extract_accounts(
            ANNUAL_INCOME, cf.FNGUIDE_INCOME_CODES, fng.FREQ_ANNUAL,
            cf.FNGUIDE_UNIT_MULTIPLIER)
        y2025 = data['2025-12-31']
        self.assertEqual(y2025['revenue'], 3189600.0)           # 31,896 억원 × 100
        self.assertEqual(y2025['operating_income'], 170300.0)
        self.assertEqual(y2025['net_income'], 151200.0)

    def test_unmapped_account_ignored(self):
        """'영업이익(발표기준)'(204490)은 매핑에 없으므로 영업이익을 덮지 않는다."""
        data = fng.extract_accounts(
            ANNUAL_INCOME, cf.FNGUIDE_INCOME_CODES, fng.FREQ_ANNUAL, 1.0)
        self.assertEqual(data['2023-12-31']['operating_income'], 1870.0)

    def test_liabilities_never_equals_assets(self):
        """부채총계(130000)가 자산총계(110000)로 오염되지 않는다(2026-07-18 감사 회귀)."""
        data = fng.extract_accounts(
            ANNUAL_BALANCE, cf.FNGUIDE_BALANCE_CODES, fng.FREQ_ANNUAL,
            cf.FNGUIDE_UNIT_MULTIPLIER)
        y2025 = data['2025-12-31']
        self.assertEqual(y2025['total_assets'], 4709500.0)
        self.assertEqual(y2025['total_liabilities'], 2655100.0)
        self.assertEqual(y2025['total_equity'], 2054500.0)
        self.assertEqual(y2025['inventory'], 865900.0)
        self.assertNotEqual(y2025['total_liabilities'], y2025['total_assets'])

    def test_missing_values_skipped(self):
        dataset = {'header': ANNUAL_INCOME['header'],
                   'data': [_row('200000', '매출액(수익)', None, '-', '31896')]}
        data = fng.extract_accounts(dataset, cf.FNGUIDE_INCOME_CODES,
                                    fng.FREQ_ANNUAL, 1.0)
        self.assertNotIn('2023-12-31', data)
        self.assertNotIn('2024-12-31', data)
        self.assertEqual(data['2025-12-31']['revenue'], 31896.0)


class TestInvestMap(unittest.TestCase):
    def test_strips_indent_and_parses_commas(self):
        m = fng.extract_invest_map(INVEST_INDEX, cf.FNGUIDE_INVEST_TO_DB)
        self.assertEqual(m['2025-12-31']['eps'], 6564.0)
        self.assertEqual(m['2025-12-31']['bps'], 63997.0)
        self.assertEqual(m['2025-12-31']['per'], 18.27)
        self.assertEqual(m['2025-12-31']['ev_ebitda'], 7.53)
        self.assertEqual(m['2025-12-31']['dps'], 1668.0)

    def test_unmapped_metric_ignored(self):
        m = fng.extract_invest_map(INVEST_INDEX, cf.FNGUIDE_INVEST_TO_DB)
        self.assertNotIn('dividend_yield', m['2025-12-31'])

    def test_none_object_is_safe(self):
        self.assertEqual(fng.extract_invest_map(None, cf.FNGUIDE_INVEST_TO_DB), {})


class TestInlineJson(unittest.TestCase):
    def test_extracts_balanced_object(self):
        html = ('<script>var a=1; invValueIndex: {"data":[{"NM":"EPS","VAL1":"1"}],'
                '"header":[{"YYMM":"2025/12","CD":"VAL1"}]}, other: 2;</script>')
        obj = fng.extract_inline_json(html, 'invValueIndex')
        self.assertEqual(obj['data'][0]['NM'], 'EPS')

    def test_brace_inside_string_does_not_break(self):
        html = 'invValueIndex: {"data":[{"NM":"a}b","VAL1":"1"}],"header":[]}'
        obj = fng.extract_inline_json(html, 'invValueIndex')
        self.assertEqual(obj['data'][0]['NM'], 'a}b')

    def test_missing_var_returns_none(self):
        self.assertIsNone(fng.extract_inline_json('<html></html>', 'invValueIndex'))


class TestBuildRows(unittest.TestCase):
    def _annual_rows(self, fye_month=12, income=ANNUAL_INCOME, balance=ANNUAL_BALANCE):
        data = fng.extract_accounts(income, cf.FNGUIDE_INCOME_CODES,
                                    fng.FREQ_ANNUAL, cf.FNGUIDE_UNIT_MULTIPLIER)
        if balance:
            for key, vals in fng.extract_accounts(
                    balance, cf.FNGUIDE_BALANCE_CODES, fng.FREQ_ANNUAL,
                    cf.FNGUIDE_UNIT_MULTIPLIER).items():
                data.setdefault(key, {'_period_end': vals['_period_end']}).update(
                    {k: v for k, v in vals.items() if k != '_period_end'})
        return cf._build_kr_rows('cid', 'KRW', 'annual', data,
                                 fiscal_year_end_month=fye_month)

    def test_annual_has_no_quarter_row(self):
        rows = self._annual_rows()
        self.assertEqual({r['fiscal_year'] for r in rows}, {2023, 2024, 2025})
        y25 = next(r for r in rows if r['fiscal_year'] == 2025)
        self.assertEqual(y25['revenue'], 3189600.0)
        self.assertEqual(y25['total_liabilities'], 2655100.0)

    def test_march_fiscal_year_offset(self):
        """3월 결산은 한국식 -1 보정: 2026-03-31 결산 → FY2025."""
        rows = self._annual_rows(fye_month=3, income=MARCH_FY_INCOME, balance=None)
        self.assertEqual({r['fiscal_year'] for r in rows}, {2022, 2023, 2024, 2025})
        fy25 = next(r for r in rows if r['fiscal_year'] == 2025)
        self.assertEqual(fy25['period_end_date'], '2026-03-31')
        self.assertEqual(fy25['revenue'], 659500.0)

    def test_quarterly_gives_discrete_q4(self):
        data = fng.extract_accounts(QUARTER_INCOME, cf.FNGUIDE_INCOME_CODES,
                                    fng.FREQ_QUARTER, cf.FNGUIDE_UNIT_MULTIPLIER)
        rows = cf._build_kr_rows('cid', 'KRW', 'quarterly', data,
                                 fiscal_year_end_month=12)
        q4 = next(r for r in rows
                  if r['fiscal_year'] == 2025 and r['fiscal_quarter'] == 4)
        self.assertEqual(q4['revenue'], 833100.0)  # discrete, NOT 연간누적
        self.assertIn('2026-03-31', {r['period_end_date'] for r in rows})

    def test_current_ratio_from_helper_columns(self):
        rows = self._annual_rows()
        y25 = next(r for r in rows if r['fiscal_year'] == 2025)
        self.assertAlmostEqual(y25['current_ratio'], 19711 / 12520, places=4)
        # 내부 헬퍼 컬럼은 DB 페이로드에 남지 않는다
        self.assertNotIn('_ca', y25)
        self.assertNotIn('_cl', y25)


class TestHasDatasetValues(unittest.TestCase):
    def test_true_when_values_present(self):
        self.assertTrue(fng.has_dataset_values(ANNUAL_INCOME))

    def test_false_when_all_empty(self):
        self.assertFalse(fng.has_dataset_values(
            {'header': ANNUAL_INCOME['header'],
             'data': [_row('200000', '매출액(수익)', None, None, None)]}))

    def test_false_when_none_or_no_header(self):
        self.assertFalse(fng.has_dataset_values(None))
        self.assertFalse(fng.has_dataset_values({'header': [], 'data': []}))


class TestKrHealth(unittest.TestCase):
    """fnguide 구조 변경 감지 — 대량 0행이면 이상(False)."""

    def test_structure_break_all_zero(self):
        self.assertFalse(cf._kr_health_ok(attempted=169, with_data=0))
        self.assertFalse(cf._kr_health_ok(attempted=169, with_data=5))

    def test_healthy_most_collected(self):
        self.assertTrue(cf._kr_health_ok(attempted=169, with_data=160))
        self.assertTrue(cf._kr_health_ok(attempted=10, with_data=5))

    def test_too_few_to_judge(self):
        self.assertTrue(cf._kr_health_ok(attempted=5, with_data=0))
        self.assertTrue(cf._kr_health_ok(attempted=0, with_data=0))


if __name__ == '__main__':
    unittest.main()
