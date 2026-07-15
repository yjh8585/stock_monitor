"""collect_stellantis_shipments 파싱·도출 회귀 검증 — fixture 기반 unittest.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_stellantis_shipments.py

네트워크·DB 없이 순수 함수만 검증한다. fixture는 2026-07-15에 SEC에서 실제로 관측한
레이아웃을 그대로 옮긴 것이며, 특히 아래 두 함정을 고정한다.
  1. FY/Q1 PR의 'NORTH AMERICA | ENLARGED EUROPE' 2열 병렬 — 지역별 값 블록 분할
     (같은 표에 'MIDDLE EAST & AFRICA | SOUTH AMERICA' 출하 행이 또 있어 표를 안 가리면
      엉뚱한 지역 값을 집는다)
  2. 차분 도출 — Q2 = H1 − Q1, Q4 = FY − H1 − Q3
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

# 수집 스크립트는 scripts/ 루트의 단일 파일 — 패키지가 아니라 파일 경로로 로드한다.
_spec = importlib.util.spec_from_file_location(
  'collect_stellantis_shipments', SCRIPTS_DIR / 'collect_stellantis_shipments.py'
)
col = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(col)


# ---------------------------------------------------------------------------
# fixture — SEC 실측 레이아웃
# ---------------------------------------------------------------------------
# FY2025 PR: 'NORTH AMERICA | ENLARGED EUROPE' 2열 병렬. 북미 = 1,472천대.
FY2025_NA_EE_TABLE = [
  ['NORTH AMERICA', 'ENLARGED EUROPE'],
  ['€ million, except as otherwise stated', '2025', '2024', 'Change',
   '€ million, except as otherwise stated', '2025', '2024', 'Change'],
  ['Shipments (000s)', '1,472', '1,432', '+40',
   'Shipments (000s)', '2,490', '2,576', '(86)'],
  ['Net revenues', '60,962', '63,450', '(2,488)',
   'Net revenues', '57,773', '59,010', '(1,237)'],
]

# 같은 FY2025 PR의 다른 표 — 출하 행이 있지만 북미가 없다. 반드시 무시돼야 한다.
# 행 안에서 지역별 라벨이 다르다('Combined shipments' vs 'Shipments').
FY2025_MEA_SA_TABLE = [
  ['MIDDLE EAST & AFRICA', 'SOUTH AMERICA'],
  ['€ million, except as otherwise stated', '2025', '2024', 'Change',
   '€ million, except as otherwise stated', '2025', '2024', 'Change'],
  ['Combined shipments (1) (000s)', '542', '534', '+8',
   'Shipments (000s)', '1,000', '912', '+88'],
  ['Consolidated shipments (1) (000s)', '453', '423', '+30',
   'Net revenues', '16,197', '15,863', '+334'],
]

# Q3 2025 PR: 북미 단일 섹션 + YTD 열이 뒤에 붙는다. 북미 당기 = 403천대.
Q3_2025_TABLE = [
  ['NORTH AMERICA'],
  ['Q3 2025', 'Q3 2024', 'Change', 'YTD 2025', 'YTD 2024'],
  ['Shipments (000s)', '403', '299', '+104', '1,050', '1,137'],
]

# Q1 2021 PR: 북미 단일 섹션, Pro Forma 기준. 북미 = 451천대.
Q1_2021_TABLE = [
  ['NORTH AMERICA'],
  ['Shipments (000s)', '451', '471', '(20)'],
  ['Net revenues (€ million)', '15,916', '14,546', '+1,370'],
]


class PeriodKeyTest(unittest.TestCase):
  """exhibit 파일명 → (기간, 연도)."""

  def test_quarter_doc(self):
    self.assertEqual(col.parse_period_key('stellantisnvq12026pressrel.htm'), ('Q1', 2026))
    self.assertEqual(col.parse_period_key('stellantisnvq32025pressrel.htm'), ('Q3', 2025))

  def test_half_and_full_year_doc(self):
    self.assertEqual(col.parse_period_key('stellantisnvh12025pressrel.htm'), ('H1', 2025))
    self.assertEqual(col.parse_period_key('stellantisnvfy2025pressrel.htm'), ('FY', 2025))

  def test_non_pressrel_doc_is_none(self):
    """커버페이지·보충자료·로고는 본문이 아니다."""
    self.assertIsNone(col.parse_period_key('a6-kcoverpageq12026pressre.htm'))
    self.assertIsNone(col.parse_period_key('stellantislogoa.jpg'))


class NumericCellTest(unittest.TestCase):
  def test_thousands_separator(self):
    self.assertEqual(col.parse_numeric_cell('1,472'), 1472)

  def test_parenthesis_is_negative(self):
    """IR 표는 음수를 괄호로 쓴다 — '(191)' → -191."""
    self.assertEqual(col.parse_numeric_cell('(191)'), -191)

  def test_non_numeric_is_none(self):
    for cell in ('n.m.', '', 'Shipments (000s)', '+40 bps', '1.6%'):
      self.assertIsNone(col.parse_numeric_cell(cell), cell)


class RegionHeaderTest(unittest.TestCase):
  def test_two_region_header(self):
    self.assertEqual(
      col.find_region_header(FY2025_NA_EE_TABLE), ['NORTH AMERICA', 'ENLARGED EUROPE']
    )

  def test_single_region_header(self):
    self.assertEqual(col.find_region_header(Q3_2025_TABLE), ['NORTH AMERICA'])

  def test_table_without_region_header(self):
    """지역명 외 셀이 섞인 행은 헤더가 아니다 (수치 행 오인식 방지)."""
    self.assertIsNone(col.find_region_header([
      ['Consolidated shipments (1)', '5,484', '5,415', '+1%'],
    ]))


class ExtractNorthAmericaTest(unittest.TestCase):
  """북미 절대값 추출 — 표 선택 + 2열 병렬 블록 분할."""

  def test_two_column_parallel_layout(self):
    """NA|EE 병렬에서 북미 블록의 첫 숫자(당기)를 집는다. 2,490(유럽)이 아니다."""
    self.assertEqual(col.extract_north_america_shipments([FY2025_NA_EE_TABLE]), 1472)

  def test_single_region_with_ytd_columns(self):
    """Q3 표는 뒤에 YTD 열이 붙지만 당기(첫 숫자)만 취한다."""
    self.assertEqual(col.extract_north_america_shipments([Q3_2025_TABLE]), 403)

  def test_single_region_pro_forma(self):
    self.assertEqual(col.extract_north_america_shipments([Q1_2021_TABLE]), 451)

  def test_ignores_table_without_north_america(self):
    """MEA|SA 표에도 출하 행이 있다 — 북미 표가 아니면 건너뛴다."""
    self.assertIsNone(col.extract_north_america_shipments([FY2025_MEA_SA_TABLE]))

  def test_picks_north_america_table_among_many(self):
    """FY PR 실제 구성: 그룹 요약 → NA|EE → MEA|SA 순. 북미 표만 골라야 한다."""
    tables = [
      [['Consolidated shipments (1)', '5,484', '5,415', '+1%']],
      FY2025_NA_EE_TABLE,
      FY2025_MEA_SA_TABLE,
    ]
    self.assertEqual(col.extract_north_america_shipments(tables), 1472)

  def test_north_america_not_leftmost(self):
    """북미가 오른쪽 블록이어도 지역 순서로 매핑한다 (레이아웃 변경 대비)."""
    table = [
      ['ENLARGED EUROPE', 'NORTH AMERICA'],
      ['Shipments (000s)', '2,490', '2,576', '(86)',
       'Shipments (000s)', '1,472', '1,432', '+40'],
    ]
    self.assertEqual(col.extract_north_america_shipments([table]), 1472)


class DeriveQuartersTest(unittest.TestCase):
  """차분 도출 — Q2 = H1 − Q1, Q4 = FY − H1 − Q3."""

  # 2025 실측: Q1 325 / H1 647 / Q3 403 / FY 1,472
  VALUES_2025 = {'Q1': 325, 'H1': 647, 'Q3': 403, 'FY': 1472}

  def _by_quarter(self, rows):
    return {r['quarter']: r for r in rows}

  def test_q2_is_h1_minus_q1(self):
    rows = self._by_quarter(col.derive_year_quarters(self.VALUES_2025, 2025))
    self.assertEqual(rows[2]['thousands'], 322)      # 647 - 325
    self.assertTrue(rows[2]['is_derived'])

  def test_q4_is_fy_minus_h1_minus_q3(self):
    rows = self._by_quarter(col.derive_year_quarters(self.VALUES_2025, 2025))
    self.assertEqual(rows[4]['thousands'], 422)      # 1472 - 647 - 403
    self.assertTrue(rows[4]['is_derived'])

  def test_q1_q3_are_absolute_not_derived(self):
    rows = self._by_quarter(col.derive_year_quarters(self.VALUES_2025, 2025))
    self.assertEqual((rows[1]['thousands'], rows[1]['is_derived']), (325, False))
    self.assertEqual((rows[3]['thousands'], rows[3]['is_derived']), (403, False))

  def test_quarters_sum_to_fy(self):
    """분기 합 == FY. 도출 공식의 항등식이 깨지면 즉시 잡힌다."""
    rows = col.derive_year_quarters(self.VALUES_2025, 2025)
    self.assertEqual(sum(r['thousands'] for r in rows), self.VALUES_2025['FY'])

  def test_derived_sources_point_to_confirming_pr(self):
    """Q2는 H1 PR이, Q4는 FY PR이 확정한다 — source_url 매핑 근거."""
    rows = self._by_quarter(col.derive_year_quarters(self.VALUES_2025, 2025))
    self.assertEqual(rows[2]['source_period'], 'H1')
    self.assertEqual(rows[4]['source_period'], 'FY')

  def test_partial_year_without_h1(self):
    """2026처럼 Q1만 나온 연도는 Q2~Q4를 만들지 않는다 (H1 미발표)."""
    rows = col.derive_year_quarters({'Q1': 379}, 2026)
    self.assertEqual([r['quarter'] for r in rows], [1])

  def test_q4_needs_all_three_inputs(self):
    """FY만 있고 H1/Q3가 없으면 Q4를 만들지 않는다."""
    rows = col.derive_year_quarters({'Q1': 325, 'FY': 1472}, 2025)
    self.assertEqual([r['quarter'] for r in rows], [1])

  def test_negative_derived_is_dropped(self):
    """H1 < Q1 이면 파싱 오류 — 스키마 CHECK(>=0) 위반 전에 제외한다."""
    rows = col.derive_year_quarters({'Q1': 500, 'H1': 400}, 2025)
    self.assertEqual([r['quarter'] for r in rows], [1])


class BuildDbRowsTest(unittest.TestCase):
  SOURCES = {
    'Q1': ('https://sec.gov/q1.htm', '2025-04-30'),
    'H1': ('https://sec.gov/h1.htm', '2025-07-29'),
  }

  def test_thousands_converted_to_units(self):
    """IR은 천대, DB는 대 — ×1000 환산."""
    quarters = [{'quarter': 1, 'thousands': 325, 'is_derived': False,
                 'source_period': 'Q1', 'year': 2025}]
    row = col.build_db_rows(quarters, self.SOURCES)[0]
    self.assertEqual(row['shipments_units'], 325_000)
    self.assertEqual(row['year_period'], '2025-Q1')
    self.assertEqual(row['region'], 'North America')
    self.assertEqual(row['period_type'], 'quarter')

  def test_derived_row_sources_from_confirming_pr(self):
    """Q2 행의 source_url/filing_date는 H1 PR을 가리킨다."""
    quarters = [{'quarter': 2, 'thousands': 322, 'is_derived': True,
                 'source_period': 'H1', 'year': 2025}]
    row = col.build_db_rows(quarters, self.SOURCES)[0]
    self.assertTrue(row['is_derived'])
    self.assertEqual(row['source_url'], 'https://sec.gov/h1.htm')
    self.assertEqual(row['filing_date'], '2025-07-29')


if __name__ == '__main__':
  unittest.main(verbosity=2)
