"""customer_parsers/breakdown.py 시험 — 스텔란티스·폴라리스·포르쉐 지역·차종·점유율 코드 파서(C-3).

고정값 = 2026-11-12 공개 IR 실물(EDGAR 6-K·8-K 본문 줄 · 포르쉐 팩트시트 XLSX)을 자른 조각. 네트워크·DB 없음.
실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_breakdown_parsers.py -q
"""
import pathlib
import sys
import unittest

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

from customer_parsers import breakdown as bd  # noqa: E402
from customer_parsers.base import Content  # noqa: E402
from customer_parsers.porsche import fs_content  # noqa: E402
from lib import customer_breakdown as cb  # noqa: E402

# 스텔란티스 Q3 2026 6-K 본문 줄(문서 229) — 그룹 요약 표 + 권역 표 + 점유율 문장
STLA_Q3 = '\n'.join([
  '€ million, except as otherwise stated | Q3 2026 | Q3 2025 | Change | YTD 2026 | YTD 2025 | Change',
  'Consolidated shipments (6) | 1,286 | 1,300 | (1)% | 4,244 | 3,964 | +7%',
  'NORTH AMERICA | ENLARGED EUROPE',
  '€ million, except as otherwise stated | Q3 2026 | Q3 2025 | Change | € million, except as otherwise stated | Q3 2026 | Q3 2025 | Change',
  'Shipments (000s) | 357 | 404 | (47) | Shipments (000s) | 588 | 534 | +54',
  'Net revenues | 15,586 | 16,087 | (3)% | Net revenues | 14,062 | 13,631 | +3%',
  'AOI margin | 0.4% | (3.0)% | +340 | bps | AOI margin | (2.2)% | 1.2% | (340) | bps',
  'MIDDLE EAST & AFRICA | SOUTH AMERICA',
  '€ million, except as otherwise stated | Q3 2026 | Q3 2025 | Change | € million, except as otherwise stated | Q3 2026 | Q3 2025 | Change',
  'Combined shipments (6) (000s) | 95 | 128 | (33) | Shipments (000s) | 251 | 252 | (1)',
  'Consolidated shipments (6) (000s) | 75 | 95 | (20) | Net revenues | 4,120 | 3,989 | +3%',
  'ASIA PACIFIC',   # 2026 부문 이름(2025 까지 CHINA AND INDIA & ASIA PACIFIC)
  '€ million, except as otherwise stated | Q3 2026 | Q3 2025 | Change',
  'Combined shipments (6) (000s) | 16 | 16 | -',
  'Consolidated shipments (6) (000s) | 15 | 16 | (1)',
  'NORTH AMERICA | ENLARGED EUROPE',
  '€ million, except as otherwise stated | YTD 2026 | YTD 2025 | Change | € million, except as otherwise stated | YTD 2026 | YTD 2025 | Change',
  'Shipments (000s) | 1,181 | 1,052 | +129 | Shipments (000s) | 1,987 | 1,825 | +162',
  'Chrysler Pacifica up 6% year-over-year. North America market share increased to 7.5%, up 10 bps year-over-year, '
  'driven by new product. EU30 market share was 14.8%, down 60 bps year-over-year or 15.6% including Leapmotor (7) , '
  'down 10 bps. Despite a market share decrease, Stellantis maintained its regional leadership with an 18.6% market share.',
])
# 연간판(문서 250) — 기간 머리가 '2025' · 'H2 2025' · 마세라티 칸 소수
STLA_FY = '\n'.join([
  'NORTH AMERICA | ENLARGED EUROPE',
  '€ million, except as otherwise stated | 2025 | 2024 | Change | € million, except as otherwise stated | 2025 | 2024 | Change',
  'Shipments (000s) | 1,472 | 1,432 | +40 | Shipments (000s) | 2,490 | 2,576 | (86)',
  'CHINA AND INDIA & ASIA PACIFIC | MASERATI',
  '€ million, except as otherwise stated | 2025 | 2024 | Change | € million, except as otherwise stated | 2025 | 2024 | Change',
  'Combined shipments (1) (000s) | 61 | 61 | - | Shipments (000s) | 7.9 | 11.3 | (3.4)',
  'MIDDLE EAST & AFRICA | SOUTH AMERICA',
  '€ million, except as otherwise stated | H2 2025 | H2 2024 | Change | € million, except as otherwise stated | H2 2025 | H2 2024 | Change',
  'Combined shipments (1) | 291 | 261 | +30 | Shipments (000s) | 529 | 518 | +11',
  'Consolidated shipments | 228 | 209 | +19',
])

PII_Q3 = '\n'.join([
  'Third quarter sales were $2,043 million, up 11 percent. North America sales of $1,815 million represented 89 percent '
  'of total Company sales and increased 14 percent from $1,586 million in the third quarter of 2025. International sales '
  'of $228 million represented 11 percent of total Company sales and decreased 11 percent versus the third quarter of 2025.',
  'Sales (in millions) | Gross Profit Margin',
  'Q3 2026 | Q3 2025 | Change | Q3 2026 | Q3 2025 | Change',
  'Polaris Powersports | $ | 1,822.1 | $ | 1,543.2 | 18 | % | 22.3 | % | 22.2 | % | +5 bps',
  'Marine | $ | 133.4 | $ | 103.4 | 29 | % | 11.9 | % | 11.4 | % | +43 bps',
  'Aixam & Goupil | $ | 68.0 | $ | 77.3 | (12) | % | 27.5 | % | 28.0 | % | -47 bps',
  'Corporate | $ | 19.1 | $ | 117.7 | NM',   # 부문이 아니다 — 건너뛴다
  'Investor Contact: J.C. Weigelt 763-542-0525 | Media Contact: Jess Rogers 763-513-3445 | Page 2',   # 표 끝
  'Polaris Powersports segment gross profit | $ | 405.8 | $ | 342.9 | $ | 1,131.6 | $ | 850.4',
])
# 4분기판(문서 10) — 전년 값이 「in 2024」로만 적혀 분기인지 모른다 → 전년 행을 내지 않는다
PII_Q4 = '\n'.join([
  'North America sales of $1,623 million represented 84 percent of total company sales and increased 10 percent from '
  '$1,481 million in 2024. International sales of $299 million represented 16 percent of total Company sales.',
  'Q4 2025 | Q4 2024 | Change | Q4 2025 | Q4 2024 | Change',
  'Off Road | $ | 1,596.4 | $ | 1,437.2 | 11 | % | 21.2 | % | 21.4 | % | -18 bps',   # 2025 까지의 부문 이름
  'On Road | $ | 187.2 | $ | 180.8 | 4 | % | 15.4 | % | 9.9 | % | +546 bps',
])

_HEAD_Q = ['Units', '', 'Q3 2026', '', 'Q2 2026', '', 'Q1 2026']
_HEAD_C = ['Units', '', 'Q1-Q3 2026', '', 'Q1-Q2 2026', '', 'Q1 2026']
PORSCHE_SHEETS = [
  ('01 - Group EBIT', []),
  ('03 - Sales_deliveries by Region', [
    _HEAD_Q,
    ['Vehicle sales', '', '55,573', '', '61,955', '', '58,553'],
    ['Deliveries to customers', '', '56,226', '', '61,315', '', '60,991'],
    ['Germany', '', '6,016', '', '7,160', '', '7,778'],
    ['North America (excluding Mexico)', '', '18,376', '', '19,368', '', '18,344'],
    ['China (including Hong Kong)', '', '6,992', '', '6,982', '', '7,519'],
    _HEAD_C,
    ['Germany', '', '20,954', '', '14,938', '', '7,778'],
  ]),
  ('04 - Sales_deliveries by Model', [
    _HEAD_Q,
    ['Deliveries to customers', '', '56,226', '', '61,315', '', '60,991'],
    ['911', '', '11,683', '', '16,645', '', '13,889'],
    ['Macan BEV', '', '7,409', '', '', '', ''],     # 빈 칸 = 그 분기 없음(건너뛴다)
    ['Mystery Model', '', '1', '', '2', '', '3'],   # 모르는 라벨 → unknown
  ]),
]


def _doc(**kw):
  d = {'id': 1, 'company_id': 'c', 'doc_type': 'earnings_release', 'form': '6-K', 'published_at': '2026-10-28'}
  d.update(kw)
  return d


def _edgar(text):
  return Content(text=text, tables=[], raw=b'')


def _txt(text):
  return Content(text=text, tables=[], raw=b'')


def _edgar(text):
  """실물 EDGAR Content 꼴 — 표 행(' | ' 가 있거나 전부 대문자인 줄)은 tables, 문장은 text."""
  rows, prose = [], []
  for ln in text.split('\n'):
    (rows if (' | ' in ln or ln.isupper()) else prose).append(ln)
  return Content(text='\n'.join(prose), tables=[[r.split(' | ') for r in rows]] if rows else [], raw=b'')


def _find(rows, **kw):
  return [r for r in rows if all(getattr(r, k) == v for k, v in kw.items())]


def _all_verified(test, rows, content):
  src = cb.SourcePages(content)
  for r in rows:
    ok, note = cb.verify(r, src)
    test.assertTrue(ok, (r.label_raw, r.metric, r.period, r.value, note))


class StellantisTest(unittest.TestCase):
  def test_quarter_regions(self):
    rows, unknown = bd.parse('STLA', _doc(), _edgar(STLA_Q3))
    self.assertEqual(unknown, [])
    na = _find(rows, kind='region', label_raw='NORTH AMERICA', metric='shipments', period='2026-Q3')
    self.assertEqual([r.value for r in na], [357000])
    self.assertEqual(_find(rows, label_raw='ENLARGED EUROPE', period='2025-Q3')[0].value, 534000)   # 전년 칸
    mea = {r.metric: r.value for r in _find(rows, label_raw='MIDDLE EAST & AFRICA', period='2026-Q3')}
    self.assertEqual(mea, {'combined_shipments': 95000, 'shipments': 75000})   # 연결 = shipments
    self.assertEqual(_find(rows, label_raw='SOUTH AMERICA', period='2026-Q3')[0].value, 251000)
    china = {r.metric: r.value for r in _find(rows, label_raw='ASIA PACIFIC', period='2026-Q3')}
    self.assertEqual(china, {'combined_shipments': 16000, 'shipments': 15000})
    self.assertEqual(_find(rows, label_raw='NORTH AMERICA', period_grain='ytd', period='2026-9M')[0].value, 1181000)
    # 그룹 요약 표(권역 머리 없음)의 1,286 은 지역 행이 아니다
    self.assertFalse(_find(rows, value=1286000))
    _all_verified(self, rows, _edgar(STLA_Q3))

  def test_share_sentences(self):
    rows, _ = bd.parse('STLA', _doc(), _edgar(STLA_Q3))
    share = {r.label_raw: r.value for r in _find(rows, kind='share')}
    # 지역 이름이 같은 문장 앞에 붙은 꼴만 — 남미 「regional leadership with an 18.6%」 은 지역이 문장 밖이라 안 잡는다
    self.assertEqual(share, {'North America': 7.5, 'EU30': 14.8})
    self.assertTrue(all(r.unit == 'share_pct' and r.period == '2026-Q3' for r in _find(rows, kind='share')))

  def test_full_year_and_half(self):
    rows, unknown = bd.parse('STLA', _doc(), _edgar(STLA_FY))
    self.assertEqual(unknown, [])
    self.assertEqual(_find(rows, label_raw='NORTH AMERICA', period_grain='year', period='2025')[0].value, 1472000)
    self.assertEqual(_find(rows, label_raw='MASERATI', period='2025')[0].value, 7900)
    self.assertEqual(_find(rows, label_raw='SOUTH AMERICA', period_grain='half', period='2025-H2')[0].value, 529000)
    # 오른쪽 블록이 끝난 짧은 행 = 왼쪽(Combined 가 먼저 온 블록)의 연결 출하
    mea = {r.metric: r.value for r in _find(rows, label_raw='MIDDLE EAST & AFRICA', period='2025-H2')}
    self.assertEqual(mea, {'combined_shipments': 291000, 'shipments': 228000})
    _all_verified(self, rows, _edgar(STLA_FY))

  def test_unknown_region_not_misattributed(self):
    text = STLA_FY.replace('MIDDLE EAST & AFRICA | SOUTH AMERICA', 'MIDDLE EAST & AFRICA | LATAM NEW')
    rows, unknown = bd.parse('STLA', _doc(), _edgar(text))
    self.assertIn('LATAM NEW', unknown)
    self.assertFalse(_find(rows, label_raw='LATAM NEW'))
    self.assertFalse(_find(rows, label_raw='SOUTH AMERICA'))

  def test_not_applicable(self):
    self.assertIsNone(bd.parse('STLA', _doc(), _txt('no regional tables here')))


class PolarisTest(unittest.TestCase):
  def test_q3(self):
    rows, unknown = bd.parse('PII', _doc(form='8-K'), _edgar(PII_Q3))
    self.assertEqual(unknown, [])
    reg = {(r.label_raw, r.metric, r.period): r.value for r in _find(rows, kind='region')}
    self.assertEqual(reg, {
      ('North America', 'sales', '2026-Q3'): 1_815_000_000, ('North America', 'sales_mix', '2026-Q3'): 89,
      ('North America', 'sales', '2025-Q3'): 1_586_000_000,
      ('International', 'sales', '2026-Q3'): 228_000_000, ('International', 'sales_mix', '2026-Q3'): 11})
    seg = {(r.label_raw, r.period): r.value for r in _find(rows, kind='model')}
    self.assertEqual(seg[('Polaris Powersports', '2026-Q3')], 1_822_100_000)
    self.assertEqual(seg[('Aixam & Goupil', '2025-Q3')], 77_300_000)
    self.assertEqual(len(seg), 6)   # 매출총이익 표의 같은 이름 행은 안 잡는다
    _all_verified(self, rows, _edgar(PII_Q3))

  def test_q4_prior_ambiguous(self):
    rows, _ = bd.parse('PII', _doc(form='8-K'), _edgar(PII_Q4))
    self.assertFalse(_find(rows, label_raw='North America', period='2024-Q4'))
    self.assertEqual(_find(rows, label_raw='North America', metric='sales', period='2025-Q4')[0].value, 1_623_000_000)
    self.assertEqual(_find(rows, kind='model', label_raw='On Road', period='2024-Q4')[0].value, 180_800_000)
    _all_verified(self, rows, _edgar(PII_Q4))

  def test_not_applicable(self):
    self.assertIsNone(bd.parse('PII', _doc(form='8-K'), _txt('Polaris announces dividend')))


class PorscheTest(unittest.TestCase):
  def test_fact_sheet(self):
    content = fs_content(PORSCHE_SHEETS)
    rows, unknown = bd.parse('P911.DE', _doc(doc_type='fact_sheet', form='fact-sheet-xlsx'), content)
    self.assertEqual(unknown, ['Mystery Model'])
    reg = {(r.label_raw, r.period): r.value for r in _find(rows, kind='region')}
    self.assertEqual(reg[('Germany', '2026-Q1')], 7778)
    self.assertEqual(reg[('North America (excluding Mexico)', '2026-Q3')], 18376)
    self.assertEqual(len(reg), 9)   # 3지역 × 3분기 · 누계 블록·합계·판매 행은 안 담는다
    mod = {(r.label_raw, r.period): r.value for r in _find(rows, kind='model')}
    self.assertEqual(mod, {('911', '2026-Q3'): 11683, ('911', '2026-Q2'): 16645, ('911', '2026-Q1'): 13889,
                           ('Macan BEV', '2026-Q3'): 7409})
    _all_verified(self, rows, content)

  def test_press_release_not_applicable(self):
    self.assertIsNone(bd.parse('P911.DE', _doc(doc_type='earnings_release', form='eqs'), _txt('Porsche AG Group')))


class DispatchTest(unittest.TestCase):
  def test_unknown_ticker(self):
    self.assertIsNone(bd.parse('VOW3.DE', _doc(), _edgar(STLA_Q3)))


if __name__ == '__main__':
  unittest.main()
