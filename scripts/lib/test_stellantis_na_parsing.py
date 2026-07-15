"""collect_stellantis_na_sales 파싱 회귀 검증 — fixture 기반 unittest.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_stellantis_na_parsing.py

네트워크·DB 없이 순수 파싱 함수만 검증한다. 2026-07-15에 실제로 프로덕션을 깨뜨린
케이스들(발행 명의 이관, 동일 차종 별칭)을 고정한다.
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

# 수집 스크립트는 scripts/ 루트의 단일 파일 — 패키지가 아니라 파일 경로로 로드한다.
_spec = importlib.util.spec_from_file_location(
  'collect_stellantis_na_sales', SCRIPTS_DIR / 'collect_stellantis_na_sales.py'
)
col = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(col)


def _row(model, q_curr, q_prior, q_yoy, ytd_curr, ytd_prior, ytd_yoy):
  return [model, q_curr, q_prior, q_yoy, ytd_curr, ytd_prior, ytd_yoy]


class RowKindTest(unittest.TestCase):
  """행 분류 — 발행 명의가 바뀌어도 회사 합계를 인식해야 한다."""

  def test_fca_us_llc_is_company_total(self):
    self.assertEqual(col._row_kind('FCA US LLC'), 'company_total')

  def test_stellantis_is_company_total(self):
    """2026Q2 이관 — 미인식 시 model로 오분류돼 직전 brand에 회사 합계가 통째로 얹힌다."""
    self.assertEqual(col._row_kind('Stellantis'), 'company_total')

  def test_company_total_is_case_insensitive(self):
    self.assertEqual(col._row_kind('STELLANTIS'), 'company_total')
    self.assertEqual(col._row_kind('fca us llc'), 'company_total')

  def test_dodge_double_space_is_brand_total(self):
    """PR 원문에 'DODGE  BRAND' 더블 스페이스가 실재한다."""
    self.assertEqual(col._row_kind('DODGE  BRAND'), 'brand_total')
    self.assertEqual(col._brand_from_row('DODGE  BRAND'), 'Dodge')

  def test_alfa_romeo_without_brand_suffix(self):
    self.assertEqual(col._row_kind('ALFA ROMEO'), 'brand_total')
    self.assertEqual(col._brand_from_row('ALFA ROMEO'), 'Alfa Romeo')

  def test_subtotal_skipped(self):
    self.assertEqual(col._row_kind('TOTAL Ram PU'), 'subtotal')

  def test_plain_model(self):
    self.assertEqual(col._row_kind('Compass'), 'model')


class YoyTest(unittest.TestCase):
  def test_div_by_zero_string_is_none(self):
    """신규 차종은 전년이 0이라 엑셀 오류 문자열이 그대로 새어 나온다(2026Q2 Cherokee HEV)."""
    self.assertIsNone(col._to_yoy('#DIV/0!'))

  def test_percent_parsed(self):
    self.assertEqual(col._to_yoy('6 %'), 6.0)

  def test_recalc_yoy(self):
    self.assertEqual(col._recalc_yoy(25416, 34728), -26.81)

  def test_recalc_yoy_zero_prev_is_none(self):
    self.assertIsNone(col._recalc_yoy(100, 0))
    self.assertIsNone(col._recalc_yoy(100, None))

  def test_recalc_yoy_none_curr_is_none(self):
    self.assertIsNone(col._recalc_yoy(None, 100))


class CompanyTotalLabelTest(unittest.TestCase):
  """'Stellantis' 회사 합계 라벨이 담긴 표 전체를 정규화한다."""

  def _rows(self, company_label):
    return [
      ['Stellantis Sales Summary Q2 2026'],
      ['Model', 'Curr Yr', 'Pr Yr', 'Change', 'Curr Yr', 'Pr Yr', 'Change'],
      _row('Compass', '10,000', '8,000', '25 %', '20,000', '16,000', '25 %'),
      _row('Wrangler', '5,000', '4,000', '25 %', '10,000', '8,000', '25 %'),
      _row('JEEP BRAND', '15,000', '12,000', '25 %', '30,000', '24,000', '25 %'),
      _row(company_label, '15,000', '12,000', '25 %', '30,000', '24,000', '25 %'),
    ]

  def test_stellantis_label_extracts_company_total(self):
    models, brand_totals, company_total = col.normalize_rows(
      self._rows('Stellantis'), '2026-Q2'
    )
    self.assertIsNotNone(company_total, 'Stellantis 라벨을 회사 합계로 인식해야 한다')
    self.assertEqual(company_total['q_curr'], 15000)
    # 회사 합계가 model로 새지 않아야 한다 (과거 버그: Jeep에 fallback)
    self.assertEqual([m['vehicle_model'] for m in models], ['Compass', 'Wrangler'])
    self.assertEqual(len(brand_totals), 1)

  def test_legacy_fca_label_still_works(self):
    _, _, company_total = col.normalize_rows(self._rows('FCA US LLC'), '2026-Q1')
    self.assertIsNotNone(company_total)
    self.assertEqual(company_total['q_curr'], 15000)


class ModelAliasMergeTest(unittest.TestCase):
  """Voyager → Pacifica 합산 병합 (사용자 지시 2026-07-15)."""

  def _rows(self):
    return [
      ['FCA US LLC Sales Summary Q1 2026'],
      ['Model', 'Curr Yr', 'Pr Yr', 'Change', 'Curr Yr', 'Pr Yr', 'Change'],
      _row('Voyager', '3,612', '2,319', '56 %', '3,612', '2,319', '56 %'),
      _row('Pacifica', '21,804', '32,409', '-33 %', '21,804', '32,409', '-33 %'),
      _row('CHRYSLER BRAND', '25,416', '34,728', '-27 %', '25,416', '34,728', '-27 %'),
      _row('FCA US LLC', '25,416', '34,728', '-27 %', '25,416', '34,728', '-27 %'),
    ]

  def test_voyager_merged_into_pacifica(self):
    models, _, _ = col.normalize_rows(self._rows(), '2026-Q1')
    self.assertEqual([m['vehicle_model'] for m in models], ['Pacifica'])
    self.assertEqual(models[0]['q_curr'], 25416)
    self.assertEqual(models[0]['q_prior'], 34728)

  def test_merged_yoy_is_recalculated_not_averaged(self):
    """원본 %(+56, -33)의 평균(+11.5)이 아니라 합산값에서 재계산해야 한다."""
    models, _, _ = col.normalize_rows(self._rows(), '2026-Q1')
    self.assertEqual(models[0]['q_yoy'], -26.81)
    self.assertEqual(models[0]['ytd_yoy'], -26.81)

  def test_brand_sum_preserved(self):
    """병합은 합계를 바꾸면 안 된다 — cross-check 허용 오차에 영향 없어야 한다."""
    models, brand_totals, _ = col.normalize_rows(self._rows(), '2026-Q1')
    self.assertEqual(sum(m['q_curr'] for m in models), brand_totals[0]['q_curr'])

  def test_voyager_alone_is_renamed(self):
    """Pacifica 없이 Voyager만 있어도 정본 이름으로 정규화된다."""
    rows = [
      ['FCA US LLC Sales Summary Q1 2026'],
      ['Model', 'Curr Yr', 'Pr Yr', 'Change', 'Curr Yr', 'Pr Yr', 'Change'],
      _row('Voyager', '3,612', '2,319', '56 %', '3,612', '2,319', '56 %'),
      _row('CHRYSLER BRAND', '3,612', '2,319', '56 %', '3,612', '2,319', '56 %'),
    ]
    models, _, _ = col.normalize_rows(rows, '2026-Q1')
    self.assertEqual([m['vehicle_model'] for m in models], ['Pacifica'])
    self.assertEqual(models[0]['q_curr'], 3612)
    # 병합이 없었으므로 원본 YoY 유지
    self.assertEqual(models[0]['q_yoy'], 56.0)

  def test_no_alias_returns_input_untouched(self):
    rows = [
      ['FCA US LLC Sales Summary Q1 2026'],
      ['Model', 'Curr Yr', 'Pr Yr', 'Change', 'Curr Yr', 'Pr Yr', 'Change'],
      _row('Compass', '10,000', '8,000', '25 %', '10,000', '8,000', '25 %'),
      _row('JEEP BRAND', '10,000', '8,000', '25 %', '10,000', '8,000', '25 %'),
    ]
    models, _, _ = col.normalize_rows(rows, '2026-Q1')
    self.assertEqual([m['vehicle_model'] for m in models], ['Compass'])
    self.assertEqual(models[0]['q_yoy'], 25.0)


class DiscoveryRegexTest(unittest.TestCase):
  """auto-discover — 슬러그 발행사 제약 제거 + 캡션 기반 분기 확정."""

  def test_href_matches_stellantis_slug(self):
    href = '/news-releases/stellantis-reports-us-sales-gains-in-first-half-2026-302816096.html'
    self.assertIsNotNone(col.HREF_RE.search(href))

  def test_href_matches_legacy_fca_slug(self):
    href = '/news-releases/fca-us-first-quarter-sales-increase-4-year-over-year-302731747.html'
    self.assertIsNotNone(col.HREF_RE.search(href))

  def test_caption_determines_quarter_regardless_of_publisher(self):
    for caption, expected in [
      ('Stellantis Sales Summary Q2 2026', ('Q2', '2026')),
      ('FCA US LLC Sales Summary Q1 2026', ('Q1', '2026')),
    ]:
      m = col.SUMMARY_CAPTION_RE.search(caption)
      self.assertIsNotNone(m, caption)
      self.assertEqual((m.group(1).upper(), m.group(2)), expected)

  def test_title_candidate_filter_accepts_half_year_title(self):
    """제목 기반 분기 확정은 폐기했으나, 후보 필터는 이 제목을 통과시켜야 한다."""
    title = 'Stellantis Reports US Sales Gains in First-half 2026'
    self.assertIsNotNone(col.TITLE_CANDIDATE_RE.search(title))


if __name__ == '__main__':
  unittest.main(verbosity=2)
