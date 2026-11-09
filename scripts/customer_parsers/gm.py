"""GM — EDGAR 8-K 2.02 의 EX-99.1(실적 보도자료) 표에서 실적·도매 판매·가이던스를 뽑는다(+ 8-K 7.01 전망 수정).

출처·표본 = 참고/고객사/research/us_domestic.md(2026-11-09 실측) + 2024-10~2026-10 EDGAR 실물 25건 회귀(2026-11-10).

표 4종을 머리 행으로 알아본다(표 번호는 분기마다 바뀐다):
- 실적 요약: 머리 행 첫 칸 '($M) except per share amounts' · 둘째 칸 분기말 날짜
- 연결 손익: 'Three Months Ended <날짜>' 머리 + 'Combined' 칸의 Operating income (loss)
- 도매 판매: 행 라벨이 정확히 GMNA·GMI·Total 인 표(대수 천 대 · fleet 표는 'Total fleet sales' 라 빠진다)
- 가이던스: 머리 행에 'Updated 2026 guidance' 또는 '2027 Guidance'(4분기 판) 칸이 있는 표

함정(실측):
  - 4분기 판(2025-01·2026-01)은 실적 요약 머리에 괄호가 없다 — '$M except per share amounts'.
  - 흑자 분기 판은 순이익 라벨에 '(loss)' 가 없다 — 'Net income attributable to stockholders'.
  - 연결 손익 표의 부문 칸 수가 해마다 다르다(2025 까지 Cruise 칸 → Combined 가 다섯째 · 2026 부터 넷째) → 칸 번호를 머리에서 읽는다.
  - 4분기 판엔 분기 연결 손익 표가 없다(연간 'Years Ended' 만) → 4분기 장부상 영업이익은 회사 보도자료에 없다(빈칸이 정상).
  - 1분기 판 도매 표는 누계 칸이 없다(숫자 2개) → 분기 행만.
  - 2025-04-29(1분기) 판은 관세로 전망을 5월 1일 8-K 7.01 로 미뤘다 — 전망 표 없음이 정상.
  - 「알아봄」 은 서식 표식(실적 요약 머리 · 전망 표 머리)으로 — 머리는 있는데 필수 칸이 0행이면 failed 로 드러난다.
"""
import re

from customer_parsers.base import (Doc, Content, ParseResult, ResultRow, VolumeRow, GuidanceRow,
                                   numeric_cells, to_number)
from customer_parsers.common import quarter_from_date_text, parse_range
from lib.doc_text import norm_text, row_text

TICKERS = ('GM',)
WHOLESALE_DEF = ('GM 도매 판매(wholesale): 딜러·유통사·미국 정부에 넘긴 대수, 합작사(중국 등) 판매 제외. '
                 '천 대 단위 발표(합계는 반올림으로 지역 합과 1천 대까지 어긋날 수 있다)')
RESULT_ROWS = (  # (라벨 정규식, metric, basis, unit)
  (r'Revenue$', 'revenue', 'reported', 'million'),
  # 흑자 분기 판은 '(loss)' 가 없다(2025-Q1~Q3 실물 'Net income attributable to stockholders')
  (r'Net income (?:\(loss\) )?attributable to stockholders$', 'net_income_parent', 'reported', 'million'),
  (r'EBIT-adjusted$', 'ebit_adjusted', 'adjusted', 'million'),
  (r'EPS-diluted-adjusted$', 'eps_adjusted', 'adjusted', 'per_share'),
)
GUIDANCE_ROWS = (  # (라벨 정규식, metric, 단위)
  (r'EBIT-adjusted$', 'ebit_adjusted', 'billion'),
  (r'Adjusted automotive free cash flow$', 'adjusted_automotive_fcf', 'billion'),
  (r'EPS-diluted-adjusted$', 'eps_adjusted', 'per_share'),
)
# 이 칸을 못 찾으면 실적 요약 라벨이 바뀐 것 — 문서를 failed 로 드러낸다(빠진 칸만 조용히 비지 않게)
RESULT_REQUIRED = ('revenue', 'ebit_adjusted')
# 4분기 판(2025-01·2026-01 실물)은 괄호 없이 '$M except per share amounts'
_RESULT_HEAD = re.compile(r'^\(?\$M\)? except per share')
_GUIDE_HEAD = re.compile(r'^(?:Updated |Initial )?(20\d{2}) [Gg]uidance$')


def wants(doc: Doc) -> bool:
  # 8-K 7.01(분기 중 전망 수정 · 2025-05-01 실측)도 같은 전망 표가 있으면 읽는다
  return doc.source == 'edgar' and doc.doc_type in ('earnings_release', 'current_report')


def _label(row: list[str]) -> str:
  return re.sub(r'\(\w\)$', '', norm_text(row[0])).strip()


def parse_results(tables) -> tuple[list[ResultRow], bool]:
  """실적 요약 표(이번 분기 = 머리 둘째 칸) → (행, 서식을 알아봤나).
  머리는 있는데 필수 칸(RESULT_REQUIRED)이 없으면 라벨이 바뀐 것 — 0행 + True 로 돌려 문서를 failed 로 드러낸다."""
  for rows in tables:
    head = next((r for r in rows[:3] if _RESULT_HEAD.match(norm_text(r[0]))), None)
    if not head or len(head) < 2:
      continue
    period = quarter_from_date_text(head[1])
    if period is None:
      return [], True
    out = []
    for row in rows:
      for rx, metric, basis, unit in RESULT_ROWS:
        nums = numeric_cells(row)
        if re.match(rx, _label(row)) and nums:
          out.append(ResultRow(metric, _label(row), basis, 'quarter', period, nums[0], unit, 'USD',
                               row_text(row)))
    if not set(RESULT_REQUIRED) <= {x.metric for x in out}:
      return [], True
    return out, True
  return [], False


def parse_operating_income(tables, period: str) -> list[ResultRow]:
  """연결 손익 표('Three Months Ended …' 머리)의 Operating income 행 — 둘째 머리 행의 첫 'Combined' 칸.
  부문 칸 수가 해마다 다르다(2025 까지 Cruise 칸이 있어 Combined 가 다섯째 · 2026 부터 넷째) → 칸 번호를 머리에서 읽는다."""
  for rows in tables:
    if not rows or not norm_text(rows[0][0]).startswith('Three Months Ended'):
      continue
    if len(rows) < 2 or 'Combined' not in rows[1]:
      continue
    col = rows[1].index('Combined')
    for row in rows:
      if _label(row) == 'Operating income (loss)':
        # '—' 는 빈 부문(0)이라 칸 위치를 지키려고 남기고 '$' 칸만 뺀다
        cells = [c for c in row[1:] if norm_text(c) != '$']
        if len(cells) <= col:
          return []
        # 🔴 norm_text 는 '—' 를 '-' 로 바꾼다 — 빈 칸 판정은 정규화 «전» 원문으로
        v = 0.0 if cells[col].strip() in ('—', '–', '-') else to_number(cells[col])
        if v is not None:
          return [ResultRow('operating_income', 'Operating income (loss)', 'reported', 'quarter', period,
                            v, 'million', 'USD', row_text(row))]
  return []


def parse_wholesale(tables) -> list[VolumeRow]:
  """도매 표 — 1분기 판은 누계 칸이 없다(숫자 2개: 올해·전년 분기) → 분기 행만. 4분기 판의 누계 칸은 연간('Years Ended')."""
  for rows in tables:
    labels = {_label(r): r for r in rows if r}
    if not {'GMNA', 'GMI', 'Total'} <= labels.keys():
      continue
    head = next((r for r in rows[:3] if quarter_from_date_text(r[0])), None)
    if not head:
      continue
    period = quarter_from_date_text(head[0])
    year, q = period.split('-Q')
    months = int(q) * 3
    ytd_grain, ytd_period = ('year', year) if months == 12 else ('ytd', f'{year}-{months}M')
    out = []
    for name, region in (('GMNA', 'north_america'), ('GMI', 'international'), ('Total', 'total')):
      nums = numeric_cells(labels[name])
      if len(nums) < (2 if q == '1' else 4):
        continue
      out.append(VolumeRow('wholesale', region, 'quarter', period, round(nums[0] * 1000), WHOLESALE_DEF,
                           row_text(labels[name])))
      if q != '1':
        out.append(VolumeRow('wholesale', region, ytd_grain, ytd_period, round(nums[2] * 1000), WHOLESALE_DEF,
                             row_text(labels[name])))
    return out
  return []


def parse_guidance(tables) -> tuple[list[GuidanceRow], bool]:
  """전망 표 → (행, 서식을 알아봤나). 머리(올해 전망 칸)가 있는데 0행이면 칸 문구가 바뀐 것(failed 로 드러난다)."""
  for rows in tables:
    head = rows[0] if rows else []
    col = next((i for i, c in enumerate(head) if _GUIDE_HEAD.match(norm_text(c))), None)
    if col is None:
      continue
    year = _GUIDE_HEAD.match(norm_text(head[col])).group(1)
    out = []
    for row in rows[1:]:
      if len(row) != len(head) + 1:
        continue
      for rx, metric, unit in GUIDANCE_ROWS:
        if re.match(rx, _label(row)):
          rng = parse_range(row[col + 1])
          if rng:
            out.append(GuidanceRow(metric, _label(row), f'FY{year}', rng[0], rng[1], None, unit, 'adjusted',
                                   row_text(row)))
    return out, True
  return [], False


def parse(doc: Doc, content: Content) -> ParseResult:
  r = ParseResult()
  r.results, results_ok = parse_results(content.tables)
  if r.results:
    r.results += parse_operating_income(content.tables, r.results[0].period)
  r.volume = parse_wholesale(content.tables)
  r.guidance, guidance_ok = parse_guidance(content.tables)
  # 알아봄 = 실적 요약 머리 또는 전망 표 머리(전망 표만 있는 7.01 도 대상). 머리는 있는데 0행이면 failed 로 드러난다
  r.recognized = results_ok or guidance_ok
  if (results_ok and not r.results) or (guidance_ok and not r.guidance):
    # 한쪽이 서식은 알아봤는데 0행 — 다른 쪽 행이 있어도 문서를 failed 로(kr_dart 와 같은 규칙)
    r.volume, r.results, r.guidance = [], [], []
  return r


# ---------------------------------------------------------------- 자가 시험(2026-11-09 실물 EX-99.1 원문 행)
MUST_HIT = [
  ([[['Three Months Ended'],
     ['($M) except per share amounts', 'September 30, 2026', 'September 30, 2025', 'Change', '% Change'],
     ['Revenue', '$', '50,015', '$', '48,591', '$', '1,424', '2.9', '%'],
     ['Net income (loss) attributable to stockholders(a)', '$', '3,335', '$', '1,327', '$', '2,008', 'n.m.'],
     ['EBIT-adjusted', '$', '4,106', '$', '3,376', '$', '730', '21.6', '%'],
     ['EBIT-adjusted margin', '8.2', '%', '6.9', '%', '1.3 ppts', '18.8', '%'],
     ['EPS-diluted-adjusted', '$', '3.70', '$', '2.80', '$', '0.90', '32.2', '%']],
    [['Three Months Ended September 30, 2026', 'Three Months Ended September 30, 2025'],
     ['Automotive', 'GM Financial', 'Reclassifications/Eliminations', 'Combined', 'Automotive', 'Cruise', 'GM Financial',
      'Reclassifications/Eliminations', 'Combined'],
     ['Operating income (loss)', '2,938', '660', '—', '3,598', '281', '—', '795', '—', '1,076']],
    [['Updated 2026 guidance', 'Previous 2026 guidance'],
     ['EBIT-adjusted', '$14.5 billion - $15.5 billion', '$14.0 billion - $16.0 billion'],
     ['Adjusted automotive free cash flow', '$11.5 billion - $12.5 billion', '$9.5 billion - $11.5 billion'],
     ['EPS-diluted-adjusted', '$12.75 - $13.75', '$12.00 - $14.00']],
    [['Three Months Ended', 'Nine Months Ended'],
     ['September 30, 2026', 'September 30, 2025', 'September 30, 2026', 'September 30, 2025'],
     ['GMNA', '870', '840', '2,511', '2,516'],
     ['GMI', '159', '137', '407', '346'],
     ['Total', '1,028', '977', '2,917', '2,862']],
    [['Three Months Ended', 'Nine Months Ended'],
     ['September 30, 2026', 'September 30, 2025', 'September 30, 2026', 'September 30, 2025'],
     ['GMNA', '160', '148', '551', '498'],
     ['GMI', '107', '113', '302', '277'],
     ['Total fleet sales', '267', '261', '853', '775']]],
   {('R', 'revenue', '2026-Q3'): 50015.0, ('R', 'operating_income', '2026-Q3'): 3598.0, ('R', 'net_income_parent', '2026-Q3'): 3335.0,
    ('R', 'ebit_adjusted', '2026-Q3'): 4106.0, ('R', 'eps_adjusted', '2026-Q3'): 3.70,
    ('G', 'ebit_adjusted', 'FY2026'): (14.5, 15.5), ('G', 'adjusted_automotive_fcf', 'FY2026'): (11.5, 12.5),
    ('G', 'eps_adjusted', 'FY2026'): (12.75, 13.75),
    ('V', 'total', '2026-Q3'): 1028000, ('V', 'north_america', '2026-Q3'): 870000,
    ('V', 'total', '2026-9M'): 2917000}),
  # Combined 칸 자체가 '—'(빈 부문 = 0)인 행 — 정규화 뒤 비교면 조용히 [] 였다(2026-11-09 대조 지적)
  ([[['($M) except per share amounts', 'September 30, 2026', 'September 30, 2025'],
     ['Revenue', '$', '50,015', '$', '48,591'], ['EBIT-adjusted', '$', '4,106', '$', '3,376']],
    [['Three Months Ended September 30, 2026'], ['Automotive', 'GM Financial', 'Reclassifications/Eliminations', 'Combined'],
     ['Operating income (loss)', '—', '—', '—', '—']]],
   {('R', 'operating_income', '2026-Q3'): 0.0}),
  # 전망 표만 있는 8-K 7.01(2025-05-01 실물 머리) — recognized 여야 not_target 으로 버려지지 않는다
  ([[['Updated 2025 Guidance', 'Previous 2025 Guidance'],
     ['EBIT-adjusted', '$10.0 billion - $12.5 billion', '$13.7 billion - $15.7 billion']]],
   {('G', 'ebit_adjusted', 'FY2025'): (10.0, 12.5)}),
  # 4분기 판 머리(2026-01 실물): 'Final 2025 Guidance | 2025 Results | 2026 Guidance' — 셋째 칸이 새 해 전망
  ([[['Final 2025 Guidance', '2025 Results', '2026 Guidance'],
     ['EBIT-adjusted', '$12.0 billion - $13.0 billion', '$12.7 billion', '$13.0 billion - $15.0 billion']]],
   {('G', 'ebit_adjusted', 'FY2026'): (13.0, 15.0)}),
  # 4분기 판(2026-01-27) 실적 요약 머리 — 괄호 없는 '$M' · 연간 도매 칸('Years Ended')
  ([[['Three Months Ended'],
     ['$M except per share amounts', 'December 31, 2025', 'December 31, 2024', 'Change', '% Change'],
     ['Revenue', '$', '45,287', '$', '47,702', '$', '(2,415)', '(5.1)', '%'],
     ['EBIT-adjusted', '$', '2,843', '$', '2,509', '$', '334', '13.3', '%']],
    [['Three Months Ended', 'Years Ended'],
     ['December 31, 2025', 'December 31, 2024', 'December 31, 2025', 'December 31, 2024'],
     ['GMNA', '780', '876', '3,296', '3,464'], ['GMI', '157', '163', '503', '547'], ['Total', '937', '1,039', '3,799', '4,010']]],
   {('R', 'revenue', '2025-Q4'): 45287.0, ('R', 'ebit_adjusted', '2025-Q4'): 2843.0,
    ('V', 'total', '2025-Q4'): 937000, ('V', 'total', '2025'): 3799000}),
  # 2025-Q3 판(2025-10-21) — 흑자 분기 순이익 라벨 · Cruise 칸이 있는 연결 손익(Combined 가 다섯째)
  ([[['($M) except per share amounts', 'September 30, 2025', 'September 30, 2024', 'Change', '% Change'],
     ['Revenue', '$', '48,591', '$', '48,757', '$', '(166)', '(0.3)', '%'],
     ['Net income attributable to stockholders', '$', '1,327', '$', '3,056', '$', '(1,729)', '(56.6)', '%'],
     ['EBIT-adjusted', '$', '3,376', '$', '4,115', '$', '(739)', '(18.0)', '%']],
    [['Three Months Ended September 30, 2025', 'Three Months Ended September 30, 2024'],
     ['Automotive', 'Cruise', 'GM Financial', 'Reclassifications/Eliminations', 'Combined', 'Automotive', 'Cruise',
      'GM Financial', 'Reclassifications/Eliminations', 'Combined'],
     ['Operating income (loss)', '281', '—', '795', '—', '1,076', '3,424', '(417)', '678', '(33)', '3,651']]],
   {('R', 'net_income_parent', '2025-Q3'): 1327.0, ('R', 'operating_income', '2025-Q3'): 1076.0}),
  # 1분기 판(2026-04-28) 도매 표 — 누계 칸 없음
  ([[['($M) except per share amounts', 'March 31, 2026', 'March 31, 2025'],
     ['Revenue', '$', '43,624', '$', '44,020'], ['EBIT-adjusted', '$', '4,253', '$', '3,490']],
    [['Three Months Ended'], ['March 31, 2026', 'March 31, 2025'],
     ['GMNA', '793', '827'], ['GMI', '106', '85'], ['Total', '899', '912']]],
   {('V', 'total', '2026-Q1'): 899000, ('V', 'north_america', '2026-Q1'): 793000}),
]
# 「알아봤는데 0행」 이어야 하는 표본 — 라벨이 바뀐 것이 not_target 으로 조용히 닫히지 않고 failed 로 드러나는지
MUST_RECOGNIZED_EMPTY = [
  ('실적 요약: 매출 라벨 변경', [[['($M) except per share amounts', 'September 30, 2026', 'September 30, 2025'],
                                  ['Total net sales and revenue', '$', '50,015', '$', '48,591'],
                                  ['EBIT-adjusted', '$', '4,106', '$', '3,376']]]),
  ('전망 표: 행 라벨 변경', [[['Updated 2026 guidance', 'Previous 2026 guidance'],
                              ['EBIT-adj.', '$14.5 billion - $15.5 billion', '$14.0 billion - $16.0 billion']]]),
]
MUST_MISS = [
  # 실적 요약의 'GMNA EBIT-adjusted' 행은 부문 값이라 회사 전체 칸에 들어가면 안 된다
  ([[['($M) except per share amounts', 'September 30, 2026', 'September 30, 2025'],
     ['GMNA EBIT-adjusted', '$', '3,592', '$', '2,506', '$', '1,087', '43.4', '%']]], ('R', 'ebit_adjusted')),
  # 'Previous' 칸만 있는 표는 전망이 아니다
  ([[['Previous 2026 guidance'], ['EBIT-adjusted', '$14.0 billion - $16.0 billion']]], ('G', 'ebit_adjusted')),
  # fleet 표(합계 라벨이 'Total fleet sales')는 도매 판매가 아니다
  ([[['Three Months Ended', 'Nine Months Ended'], ['September 30, 2026', 'September 30, 2025'],
     ['GMNA', '160', '148', '551', '498'], ['GMI', '107', '113', '302', '277'],
     ['Total fleet sales', '267', '261', '853', '775']]], ('V', 'total')),
]


def _flatten(r: ParseResult) -> dict:
  out = {}
  for x in r.results:
    out[('R', x.metric, x.period)] = x.value
  for x in r.guidance:
    out[('G', x.metric, x.period)] = (x.low, x.high)
  for x in r.volume:
    out[('V', x.region, x.period)] = x.value
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'GM', 'edgar', 'earnings_release', '8-K', '2.02', '', '', '2026-10-20')
  for tables, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text='', tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for tables, key in MUST_MISS:
    got = _flatten(parse(doc, Content(text='', tables=tables)))
    if any(k[:2] == key for k in got):
      errs.append(f'MUST_MISS {key} 가 뽑혔다')
  for name, tables in MUST_RECOGNIZED_EMPTY:
    res = parse(doc, Content(text='', tables=tables))
    if res.count() or not res.recognized:
      errs.append(f'{name}: 행 {res.count()} · recognized={res.recognized} (기대 0행 · True)')
  return errs
