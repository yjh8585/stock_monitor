"""collect_cox_inventory 순수 함수 회귀 검증 — fixture 기반 unittest.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_cox_inventory.py

네트워크·DB·LLM 없이 순수 함수만 검증한다. 2026-07-15에 coxautoinc.com을 실제로
훑어 확인한 케이스(슬러그 어순 2종·월 이름 축약·404 페이지 장식 이미지·파일명 불규칙)를
고정한다. 이 중 하나라도 깨지면 수집이 조용히 빈손이 되거나 엉뚱한 이미지를 판독한다.
"""
import importlib.util
import sys
import unittest
from datetime import date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

# 수집 스크립트는 scripts/ 루트의 단일 파일 — 패키지가 아니라 파일 경로로 로드한다.
_spec = importlib.util.spec_from_file_location(
  'collect_cox_inventory', SCRIPTS_DIR / 'collect_cox_inventory.py'
)
col = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(col)

PAGE_URL = 'https://www.coxautoinc.com/insights/may-2026-new-vehicle-inventory/'
UPLOADS = 'https://www.coxautoinc.com/wp-content/uploads'


def _article_html(*img_tags: str) -> str:
  """본문 컨테이너를 가진 기사 페이지 뼈대. 헤더/저자/관련글 노이즈를 함께 넣는다."""
  noise_head = (
    f'<img class="custom-logo" src="{UPLOADS}/2025/09/primary_117d9b.svg" alt="Cox">'
    f'<img class="author-image" src="{UPLOADS}/2024/06/Erin-K-june-24.jpg" alt="Erin Keating">'
  )
  noise_tail = (
    f'<img class="attachment-related-thumb wp-post-image" '
    f'src="{UPLOADS}/2026/07/2026-chevrolet-equinox-ev-lt-306-v2.jpg?w=113" alt="">'
  )
  body = ''.join(f'<figure class="wp-block-image">{t}</figure>' for t in img_tags)
  return (
    f'<html><body>{noise_head}'
    f'<div class="content-area"><main class="content-section"><div class="post-content-wrapper">'
    f'<div class="post-content"><p>text</p>{body}</div>'
    f'</div></main></div>{noise_tail}</body></html>'
  )


class ParseYearMonthFromSlugTest(unittest.TestCase):
  """슬러그 → YYYYMM. 실측 슬러그 40건에서 뽑은 모든 형태를 고정한다."""

  def test_month_year_first_order(self):
    """2025-04 발행분부터의 어순: <월>-<연도>-new-vehicle-inventory."""
    self.assertEqual(col.parse_year_month_from_slug('may-2026-new-vehicle-inventory'), 202605)

  def test_inventory_first_order(self):
    """2023-06~2025-03 발행분의 어순: new-vehicle-inventory-<월>-<연도>."""
    self.assertEqual(col.parse_year_month_from_slug('new-vehicle-inventory-may-2023'), 202305)

  def test_abbreviated_months(self):
    """축약 월. 'february-2026-...'은 실제로 404이고 'feb-2026-...'이 정답이다.

    URL 조립이 왜 불가능한지 보여주는 케이스 — full/축약이 인접 달에서도 섞인다.
    """
    self.assertEqual(col.parse_year_month_from_slug('feb-2026-new-vehicle-inventory'), 202602)
    self.assertEqual(col.parse_year_month_from_slug('jan-2026-new-vehicle-inventory'), 202601)
    self.assertEqual(col.parse_year_month_from_slug('dec-2025-new-vehicle-inventory'), 202512)
    self.assertEqual(col.parse_year_month_from_slug('nov-2025-new-vehicle-inventory'), 202511)
    self.assertEqual(col.parse_year_month_from_slug('oct-2025-new-vehicle-inventory'), 202510)
    # 'sept'는 표준 3글자 축약(sep)이 아니다 — 별도로 매핑돼 있어야 한다.
    self.assertEqual(col.parse_year_month_from_slug('sept-2025-new-vehicle-inventory'), 202509)

  def test_full_month_names_adjacent_to_abbrev(self):
    self.assertEqual(col.parse_year_month_from_slug('march-2026-new-vehicle-inventory'), 202603)
    self.assertEqual(col.parse_year_month_from_slug('april-2026-new-vehicle-inventory'), 202604)
    self.assertEqual(
      col.parse_year_month_from_slug('new-vehicle-inventory-september-2023'), 202309
    )
    self.assertEqual(
      col.parse_year_month_from_slug('new-vehicle-inventory-december-2023'), 202312
    )

  def test_used_vehicle_article_rejected(self):
    """중고차 재고 기사는 브랜드 재고일수 차트가 없다 — 반드시 제외."""
    self.assertIsNone(col.parse_year_month_from_slug('used-vehicle-inventory-may-2026'))

  def test_non_monthly_articles_rejected(self):
    """월 토큰이 없는 특집/연간 기사. 잘못 받으면 엉뚱한 이미지를 판독한다."""
    self.assertIsNone(col.parse_year_month_from_slug('2022-new-vehicle-inventory'))
    self.assertIsNone(col.parse_year_month_from_slug('new-vehicle-inventory-level-up-51'))
    # 'healthy-2024'가 <단어>-<연도> 패턴에 걸리지만 월이 아니므로 건너뛰어야 한다.
    self.assertIsNone(col.parse_year_month_from_slug('new-vehicle-inventory-level-healthy-2024'))

  def test_unrelated_article_rejected(self):
    self.assertIsNone(col.parse_year_month_from_slug('may-2026-atp-report'))
    self.assertIsNone(col.parse_year_month_from_slug('ev-market-monitor-may-2026'))

  def test_case_insensitive(self):
    self.assertEqual(col.parse_year_month_from_slug('May-2026-New-Vehicle-Inventory'), 202605)


class FullResImageUrlTest(unittest.TestCase):
  """리사이즈 쿼리 제거 → 원본(고해상도). 판독 정확도에 직결."""

  def test_strips_width_query(self):
    self.assertEqual(
      col.full_res_image_url(f'{UPLOADS}/2026/06/May-New-Inventory-Brand.jpeg?w=1024', PAGE_URL),
      f'{UPLOADS}/2026/06/May-New-Inventory-Brand.jpeg',
    )

  def test_strips_resize_query(self):
    self.assertEqual(
      col.full_res_image_url(f'{UPLOADS}/2026/06/x.jpeg?resize=768,432', PAGE_URL),
      f'{UPLOADS}/2026/06/x.jpeg',
    )

  def test_resolves_relative_url(self):
    self.assertEqual(
      col.full_res_image_url('/wp-content/uploads/2026/06/x.jpg', PAGE_URL),
      f'{UPLOADS}/2026/06/x.jpg',
    )


class MediaTypeTest(unittest.TestCase):
  def test_raster_formats(self):
    self.assertEqual(col.media_type_for_url(f'{UPLOADS}/a/May.jpeg'), 'image/jpeg')
    self.assertEqual(col.media_type_for_url(f'{UPLOADS}/a/April-2026-Inventory.jpg'), 'image/jpeg')
    self.assertEqual(col.media_type_for_url(f'{UPLOADS}/a/Jan-chart-2.png'), 'image/png')

  def test_svg_unsupported(self):
    """헤더 로고·404 장식은 svg — vision에 못 보낸다."""
    self.assertIsNone(col.media_type_for_url(f'{UPLOADS}/2025/09/primary_117d9b.svg'))

  def test_query_does_not_break_extension(self):
    self.assertEqual(col.media_type_for_url(f'{UPLOADS}/a/x.jpg?w=1024'), 'image/jpeg')


class ScoreImageCandidateTest(unittest.TestCase):
  """파일명 힌트 점수. alt가 전 기사 빈 문자열이라 파일명이 유일한 단서다."""

  def test_real_filenames_all_score(self):
    """실측 9개월 파일명 — 전부 후보로 잡혀야 한다(패턴이 매월 다르다)."""
    for name in (
      'May-New-Inventory-Brand.jpeg',
      'April-2026-Inventory.jpg',
      'March-New-Vehicle-Inventory.jpg',
      'Feb-2026-new-vehicle-inventory-chart.jpg',
      'Jan-2026-new-vehicle-inventory-chart-2.png',
      'Dec-2025-new-vehicle-inventory-chart-REVISED.png',
      'Nov-2025-new-vehicle-inventory-chart.jpg',
      'Oct-2025-new-vehicle-inventory-chart.jpg',
      'Sept-2025-new-vehicle-inventory-chart.jpg',
    ):
      self.assertGreater(col.score_image_candidate(f'{UPLOADS}/2026/06/{name}'), 0, name)

  def test_non_chart_images_score_zero(self):
    """404 페이지 장식·저자 사진·관련글 썸네일은 'inventory'가 없다."""
    self.assertEqual(col.score_image_candidate(f'{UPLOADS}/2025/09/about-us-img.png'), 0)
    self.assertEqual(col.score_image_candidate(f'{UPLOADS}/2024/06/Erin-K-june-24.jpg'), 0)
    self.assertEqual(col.score_image_candidate(f'{UPLOADS}/2026/03/Artboard-1@3x-100.jpg'), 0)

  def test_brand_hint_outranks_plain_inventory(self):
    """같은 기사에 재고 이미지가 둘이면 'Brand'가 붙은 쪽이 브랜드 차트다."""
    brand = col.score_image_candidate(f'{UPLOADS}/a/May-New-Inventory-Brand.jpeg')
    plain = col.score_image_candidate(f'{UPLOADS}/a/May-Total-Inventory.jpeg')
    self.assertGreater(brand, plain)


class SelectChartImageTest(unittest.TestCase):
  """본문 컨테이너 범위 + 파일명 점수로 차트 1장 선별."""

  def test_selects_content_image_ignoring_chrome(self):
    """헤더 로고·저자 사진·관련글 썸네일이 있어도 본문 차트를 고른다."""
    html = _article_html(
      f'<img src="{UPLOADS}/2026/06/May-New-Inventory-Brand.jpeg?w=1024" alt="" '
      f'class="wp-image-57220">'
    )
    self.assertEqual(
      col.select_chart_image(html, PAGE_URL),
      f'{UPLOADS}/2026/06/May-New-Inventory-Brand.jpeg',
    )

  def test_404_page_yields_none(self):
    """404 페이지는 본문 컨테이너가 없고 wp-image-* 장식이 3개 있다.

    슬러그를 조립하다 404를 맞아도 장식 PNG를 판독하러 가면 안 된다.
    """
    html = (
      f'<html><body><main class="main"><div class="wp-block-group error-hero-pattern">'
      f'<figure class="wp-block-image"><img src="{UPLOADS}/2025/09/about-us-rays.svg" '
      f'class="wp-image-51210" alt=""></figure>'
      f'<figure class="wp-block-image"><img src="{UPLOADS}/2025/09/about-us-img.png" '
      f'class="wp-image-51767" alt=""></figure>'
      f'</div></main></body></html>'
    )
    self.assertIsNone(col.select_chart_image(html, PAGE_URL))

  def test_sole_content_image_taken_regardless_of_filename(self):
    """파일명 힌트가 전부 어긋나도 본문 이미지가 유일하면 그걸 차트로 본다.

    실측 202606: Cox가 'Slide1-v2.jpeg'(파워포인트 기본 내보내기 이름)로 올려
    'inventory' 필수 힌트가 깨졌다. 월간 재고 기사는 본문 이미지가 늘 차트 1장이므로
    유일할 때는 채택하고, 차트가 아니면 vision 판독·validate_extraction이 걸러낸다.
    """
    html = _article_html(f'<img src="{UPLOADS}/2026/07/Slide1-v2.jpeg?w=1024" alt="">')
    self.assertEqual(
      col.select_chart_image(html, PAGE_URL),
      f'{UPLOADS}/2026/07/Slide1-v2.jpeg',
    )

  def test_multiple_hintless_images_yield_none(self):
    """힌트 없는 이미지가 여러 장이면 어느 게 차트인지 모른다 — 찍지 말고 포기."""
    html = _article_html(
      f'<img src="{UPLOADS}/2026/06/some-photo.jpg" alt="">',
      f'<img src="{UPLOADS}/2026/06/another-photo.jpg" alt="">',
    )
    self.assertIsNone(col.select_chart_image(html, PAGE_URL))

  def test_prefers_brand_chart_when_two_inventory_images(self):
    """Cox가 산업 전체 차트를 추가해도 브랜드 차트를 골라야 한다."""
    html = _article_html(
      f'<img src="{UPLOADS}/2026/06/May-Total-Inventory.jpeg?w=1024" alt="">',
      f'<img src="{UPLOADS}/2026/06/May-New-Inventory-Brand.jpeg?w=1024" alt="">',
    )
    self.assertEqual(
      col.select_chart_image(html, PAGE_URL),
      f'{UPLOADS}/2026/06/May-New-Inventory-Brand.jpeg',
    )

  def test_svg_in_content_ignored(self):
    html = _article_html(f'<img src="{UPLOADS}/2026/06/inventory-icon.svg" alt="">')
    self.assertIsNone(col.select_chart_image(html, PAGE_URL))


def _brands(pairs):
  return [{'brand': b, 'days_supply': v} for b, v in pairs]


def _valid_brands():
  """실측 2026-05 차트와 같은 구성(30개, NATION 포함)."""
  return _brands([
    ('Toyota', 34), ('Lexus', 34), ('Honda', 46), ('Cadillac', 62), ('Audi', 69),
    ('Kia', 70), ('Chevrolet', 72), ('Subaru', 73), ('BMW', 76), ('NATION', 76),
    ('Infiniti', 78), ('GMC', 82), ('Nissan', 82), ('Lincoln', 88), ('Mazda', 89),
    ('Porsche', 90), ('Ford', 93), ('Hyundai', 95), ('Acura', 98), ('Mercedes', 98),
    ('MINI', 99), ('Land Rover', 103), ('Genesis', 104), ('Mitsubishi', 108),
    ('Volkswagen', 109), ('Buick', 113), ('Chrysler', 129), ('Ram', 144),
    ('Jeep', 145), ('Dodge', 148),
  ])


def _bars_excluding(brand: str):
  """해당 브랜드 막대를 뺀 차트. Cox가 이상치로 제외한 달의 실제 모습이다
  (제외 브랜드는 막대가 없다 — 있으면 validate_extraction이 모순으로 잡는다)."""
  return [b for b in _valid_brands() if b['brand'] != brand]


class NormalizeBrandsTest(unittest.TestCase):
  """소스 라벨 변경 흡수. brand가 PK라 정규화 안 하면 한 회사가 두 시계열로 갈린다."""

  def test_mercedes_benz_normalized(self):
    """실측: 2025-12·2026-01 'Mercedes-Benz' → 2026-02~ 'Mercedes'."""
    got = col.normalize_brands(_brands([('Mercedes-Benz', 111)]))
    self.assertEqual(got[0]['brand'], 'Mercedes')

  def test_current_label_untouched(self):
    got = col.normalize_brands(_brands([('Mercedes', 98)]))
    self.assertEqual(got[0]['brand'], 'Mercedes')

  def test_days_supply_preserved(self):
    got = col.normalize_brands(_brands([('Mercedes-Benz', 111)]))
    self.assertEqual(got[0]['days_supply'], 111)

  def test_other_brands_untouched(self):
    got = col.normalize_brands(_brands([('Land Rover', 103), ('NATION', 76)]))
    self.assertEqual([b['brand'] for b in got], ['Land Rover', 'NATION'])

  def test_whitespace_stripped(self):
    got = col.normalize_brands(_brands([(' Jeep ', 145)]))
    self.assertEqual(got[0]['brand'], 'Jeep')

  def test_normalized_duplicate_is_detectable(self):
    """정규화 후 중복이 생기면 검증이 잡아야 한다 (같은 배치 upsert가 터지는 걸 방지)."""
    rows = _valid_brands() + _brands([('Mercedes-Benz', 98)])
    fails = col.validate_extraction(col.normalize_brands(rows), 202605)
    self.assertTrue(any('중복' in f for f in fails))


class ValidateExtractionTest(unittest.TestCase):
  """vision 오독·이미지 오선택을 적재 전에 잡는 게이트."""

  def test_real_chart_passes(self):
    self.assertEqual(col.validate_extraction(_valid_brands(), 202605), [])

  def test_empty_fails(self):
    self.assertTrue(col.validate_extraction([], 202605))

  def test_missing_nation_fails(self):
    """NATION 부재 = 재고일수 차트가 아닌 이미지를 판독했다는 신호."""
    rows = [b for b in _valid_brands() if b['brand'] != 'NATION']
    fails = col.validate_extraction(rows, 202605)
    self.assertTrue(any('NATION' in f for f in fails))

  def test_too_few_bars_fails(self):
    """차트 일부만 읽은 경우."""
    fails = col.validate_extraction(_brands([('NATION', 76), ('Jeep', 145)]), 202605)
    self.assertTrue(any('최소' in f for f in fails))

  def test_duplicate_brand_fails(self):
    rows = _valid_brands() + _brands([('Jeep', 140)])
    fails = col.validate_extraction(rows, 202605)
    self.assertTrue(any('중복' in f for f in fails))

  def test_digit_misread_fails(self):
    """144 → 1448 같은 자릿수 오독을 상한으로 잡는다."""
    rows = _valid_brands()[:-1] + _brands([('Dodge', 1448)])
    fails = col.validate_extraction(rows, 202605)
    self.assertTrue(any('범위 밖' in f for f in fails))

  def test_non_integer_fails(self):
    rows = _valid_brands()[:-1] + [{'brand': 'Dodge', 'days_supply': '148'}]
    fails = col.validate_extraction(rows, 202605)
    self.assertTrue(any('정수' in f for f in fails))


class BuildDbRowsTest(unittest.TestCase):
  def test_row_shape_matches_table(self):
    rows = col.build_db_rows(
      _brands([('Jeep', 145), ('NATION', 76)]), 202605, 'https://a/article', 'https://a/i.jpeg'
    )
    self.assertEqual(len(rows), 2)
    r = rows[0]
    self.assertEqual(
      set(r),
      {'brand', 'year_month', 'days_supply', 'is_outlier_excluded', 'source_url',
       'image_url', 'collected_at'},
    )
    self.assertEqual(r['brand'], 'Jeep')
    self.assertEqual(r['year_month'], 202605)
    self.assertEqual(r['days_supply'], 145)
    self.assertIs(r['is_outlier_excluded'], False)

  def test_strips_label_whitespace(self):
    rows = col.build_db_rows(_brands([(' Land Rover ', 103)]), 202605, 'u', 'i')
    self.assertEqual(rows[0]['brand'], 'Land Rover')


class OutlierExcludedRowsTest(unittest.TestCase):
  """이상치 제외 브랜드를 행으로 남긴다 — 이 테이블의 존재 이유(스텔란티스 재고 감시).

  실측: Chrysler가 202512~202603 4개월 제외됐다. 로그·캐시로만 남기면 캐시가 gitignore라
  CI에서 증발해, 재고가 가장 심각한 달의 신호가 통째로 사라진다.
  """

  def test_excluded_brand_becomes_row(self):
    rows = col.build_db_rows(_bars_excluding('Chrysler'), 202512, 'u', 'i', ['Chrysler'])
    chrysler = [r for r in rows if r['brand'] == 'Chrysler']
    self.assertEqual(len(chrysler), 1)
    self.assertIsNone(chrysler[0]['days_supply'])
    self.assertIs(chrysler[0]['is_outlier_excluded'], True)

  def test_excluded_row_satisfies_db_check_constraint(self):
    """CHECK: (제외 AND 값 없음) OR (제외 아님 AND 값 있음). 어기면 DB가 거부한다."""
    rows = col.build_db_rows(_bars_excluding('Chrysler'), 202512, 'u', 'i', ['Chrysler'])
    for r in rows:
      with self.subTest(brand=r['brand']):
        if r['is_outlier_excluded']:
          self.assertIsNone(r['days_supply'])
        else:
          self.assertIsNotNone(r['days_supply'])

  def test_bar_brands_not_marked_excluded(self):
    rows = col.build_db_rows(_valid_brands(), 202605, 'u', 'i', [])
    self.assertTrue(all(r['is_outlier_excluded'] is False for r in rows))

  def test_no_excluded_arg_keeps_old_behavior(self):
    """excluded 미지정 = 제외 브랜드 없음 (신규 행 없음)."""
    rows = col.build_db_rows(_valid_brands(), 202605, 'u', 'i')
    self.assertEqual(len(rows), len(_valid_brands()))

  def test_excluded_brand_gets_alias_normalized(self):
    """정규화를 빼먹으면 제외된 달 'Mercedes-Benz' / 복귀한 달 'Mercedes'로 시계열이 쪼개진다."""
    self.assertEqual(col.normalize_excluded(['Mercedes-Benz']), ['Mercedes'])

  def test_excluded_alias_reaches_the_row(self):
    """normalize_excluded를 거친 라벨이 실제 적재 행에 반영되는지 (경로 전체 확인)."""
    excluded = col.normalize_excluded([' Mercedes-Benz '])
    rows = col.build_db_rows(_bars_excluding('Mercedes'), 202512, 'u', 'i', excluded)
    brands = [r['brand'] for r in rows if r['is_outlier_excluded']]
    self.assertEqual(brands, ['Mercedes'])

  def test_excluded_whitespace_and_dupes_dropped(self):
    self.assertEqual(col.normalize_excluded([' Chrysler ', 'Chrysler', '']), ['Chrysler'])

  def test_brand_in_both_bar_and_box_fails(self):
    """막대에도 있고 제외 박스에도 있으면 모순 — 어느 쪽이 맞는지 모르므로 그 달을 버린다."""
    fails = col.validate_extraction(_valid_brands(), 202605, ['Chrysler'])
    self.assertTrue(any('모순' in f for f in fails))

  def test_contradiction_detected_after_alias_normalization(self):
    """'Mercedes-Benz' 제외 + 'Mercedes' 막대 = 같은 회사. 정규화 후에야 모순으로 보인다."""
    excluded = col.normalize_excluded(['Mercedes-Benz'])
    fails = col.validate_extraction(_valid_brands(), 202605, excluded)
    self.assertTrue(any('모순' in f for f in fails))

  def test_valid_excluded_brand_passes(self):
    """제외 브랜드가 막대에 없으면 정상 (Chrysler 빠진 차트 + 제외 박스)."""
    bars = [b for b in _valid_brands() if b['brand'] != 'Chrysler']
    self.assertEqual(col.validate_extraction(bars, 202512, ['Chrysler']), [])


class FreshnessGateTest(unittest.TestCase):
  """조용한 정지 방지. Cox 발행일 11~18일(전월 데이터), cron은 매월 20일."""

  def test_latest_is_previous_month_passes(self):
    """2026-07-20 실행 → 202606이 최신이면 정상."""
    self.assertIsNone(col.check_freshness(202606, date(2026, 7, 20)))

  def test_stale_by_one_month_after_publish_window_fails(self):
    """20일인데 전월(202606)이 안 보이면 발행 기한을 넘긴 것 — 발견이 깨졌다는 신호."""
    self.assertIsNotNone(col.check_freshness(202605, date(2026, 7, 20)))

  def test_stale_by_one_month_before_publish_window_tolerated(self):
    """1~18일엔 전월 기사가 아직 발행 전일 수 있다 — 오탐 금지."""
    self.assertIsNone(col.check_freshness(202605, date(2026, 7, 5)))
    self.assertIsNone(col.check_freshness(202605, date(2026, 7, 18)))

  def test_two_months_stale_always_fails(self):
    """발행 창 안이어도 두 달 뒤처짐은 변명의 여지가 없다."""
    self.assertIsNotNone(col.check_freshness(202604, date(2026, 7, 5)))
    self.assertIsNotNone(col.check_freshness(202604, date(2026, 7, 20)))

  def test_year_boundary(self):
    """1월 실행 → 전월은 전년 12월. 연도 경계에서 산술이 깨지면 매년 1월에 오탐."""
    self.assertIsNone(col.check_freshness(202512, date(2026, 1, 20)))
    self.assertIsNotNone(col.check_freshness(202511, date(2026, 1, 20)))

  def test_future_month_passes(self):
    """소스가 앞서 발행하는 예외 상황 — 게이트 목적(정지 감지)이 아니므로 통과."""
    self.assertIsNone(col.check_freshness(202607, date(2026, 7, 20)))

  def test_add_months_across_years(self):
    self.assertEqual(col.add_months(202601, -1), 202512)
    self.assertEqual(col.add_months(202512, 1), 202601)
    self.assertEqual(col.add_months(202606, -6), 202512)

  def test_months_between(self):
    self.assertEqual(col.months_between(202606, 202605), 1)
    self.assertEqual(col.months_between(202601, 202512), 1)
    self.assertEqual(col.months_between(202605, 202605), 0)
    self.assertEqual(col.months_between(202512, 202601), -1)


class DiffRowsTest(unittest.TestCase):
  """LLM 재판독이 맞던 값을 조용히 덮어쓰는 걸 잡는 대조 게이트."""

  @staticmethod
  def _existing(pairs):
    return {
      (b, ym): {'brand': b, 'year_month': ym, 'days_supply': v, 'is_outlier_excluded': x}
      for b, ym, v, x in pairs
    }

  def test_identical_values_no_change(self):
    rows = col.build_db_rows(_brands([('Jeep', 145)]), 202605, 'u', 'i')
    existing = self._existing([('Jeep', 202605, 145, False)])
    self.assertEqual(col.diff_rows(rows, existing), [])

  def test_digit_misread_detected(self):
    """145 → 146. 범위·개수 게이트를 통과하는 한 자리 오독이 정확히 이 경로로 샌다."""
    rows = col.build_db_rows(_brands([('Jeep', 146)]), 202605, 'u', 'i')
    existing = self._existing([('Jeep', 202605, 145, False)])
    changes = col.diff_rows(rows, existing)
    self.assertEqual(len(changes), 1)
    self.assertEqual(changes[0]['old_days_supply'], 145)
    self.assertEqual(changes[0]['new_days_supply'], 146)

  def test_new_row_is_not_a_change(self):
    """기존 행이 없으면 덮어쓸 게 없다 — 신규 월/브랜드는 경고 대상 아님."""
    rows = col.build_db_rows(_brands([('Jeep', 145)]), 202605, 'u', 'i')
    self.assertEqual(col.diff_rows(rows, {}), [])

  def test_excluded_flag_flip_detected(self):
    """135 → 이상치 제외. 값이 사라지는 것도 변경으로 잡아야 한다."""
    rows = col.build_db_rows([], 202604, 'u', 'i', ['Chrysler'])
    existing = self._existing([('Chrysler', 202604, 135, False)])
    changes = col.diff_rows(rows, existing)
    self.assertEqual(len(changes), 1)
    self.assertTrue(changes[0]['new_excluded'])
    self.assertFalse(changes[0]['old_excluded'])

  def test_stable_excluded_row_no_change(self):
    """이미 제외로 적재된 달을 재판독해도 그대로면 변경 아님 (매월 재판독이라 중요)."""
    rows = col.build_db_rows([], 202512, 'u', 'i', ['Chrysler'])
    existing = self._existing([('Chrysler', 202512, None, True)])
    self.assertEqual(col.diff_rows(rows, existing), [])

  def test_threshold_not_reached_allows_month(self):
    changes = [
      {'year_month': 202605, 'brand': 'Jeep'},
      {'year_month': 202605, 'brand': 'Ram'},
    ]
    self.assertEqual(col.months_over_change_threshold(changes), {})

  def test_threshold_reached_flags_month(self):
    """3개 이상 = 구조적 오독이거나 차트 재작성 — 사람이 보기 전엔 덮어쓰지 않는다."""
    changes = [
      {'year_month': 202605, 'brand': b} for b in ('Jeep', 'Ram', 'Dodge')
    ]
    self.assertEqual(col.months_over_change_threshold(changes), {202605: 3})

  def test_threshold_is_per_month_not_global(self):
    """서로 다른 달에 1건씩 흩어진 변경은 임계를 넘지 않는다 (전체 합산하면 오탐)."""
    changes = [
      {'year_month': 202605, 'brand': 'Jeep'},
      {'year_month': 202604, 'brand': 'Ram'},
      {'year_month': 202603, 'brand': 'Dodge'},
    ]
    self.assertEqual(col.months_over_change_threshold(changes), {})


class SelectTargetsTest(unittest.TestCase):
  FOUND = {
    202605: {'url': 'u5', 'slug': 's5', 'date': '2026-06-11'},
    202604: {'url': 'u4', 'slug': 's4', 'date': '2026-05-14'},
    202603: {'url': 'u3', 'slug': 's3', 'date': '2026-04-16'},
    202602: {'url': 'u2', 'slug': 's2', 'date': '2026-03-12'},
  }

  def test_recent_months_newest_first(self):
    """기본 동작: 최근 N개월 재처리(소급 수정 대응)."""
    got = [ym for ym, _ in col.select_targets(self.FOUND, 3, [])]
    self.assertEqual(got, [202605, 202604, 202603])

  def test_explicit_overrides_months(self):
    got = [ym for ym, _ in col.select_targets(self.FOUND, 3, [202602])]
    self.assertEqual(got, [202602])

  def test_unknown_month_skipped(self):
    got = [ym for ym, _ in col.select_targets(self.FOUND, 3, [209912])]
    self.assertEqual(got, [])

  def test_months_beyond_available(self):
    got = [ym for ym, _ in col.select_targets(self.FOUND, 99, [])]
    self.assertEqual(len(got), 4)


if __name__ == '__main__':
  unittest.main(verbosity=2)
