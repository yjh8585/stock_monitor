"""리비안 — EDGAR 8-K 의 실적 보도자료(EX-99.1·99.2 표) + 분기 생산·인도 보도자료(8-K 7.01 EX-99.1 문장).

출처·표본 = 참고/고객사/research/us_domestic.md(2026-11-09 실측) + 2024-11~2026-10 EDGAR 실물 20건 회귀(2026-11-10).

- 실적: 5개 분기 나란히 표('Three Months Ended' 머리 · 맨 오른쪽 = 이번 분기)의 Production·Delivery·
  Total revenues·Adjusted EBITDA, 손익계산서(머리 '2025 | 2026 | 2025 | 2026' — 전년이 앞)의 Loss from operations·
  Net loss attributable to common stockholders(지배 순손실 — 선택 칸)
- 가이던스: 'Current Outlook' · '2026 Annual Guidance Summary' · '2025 Guidance' 표
- 생산·인도 보도자료: 'produced N vehicles … delivered M vehicles' 문장 · 인도 가이던스 문장 · 실적 발표일 문장

함정(실측):
  - 행 라벨 각주가 회차마다 다르다 — 'Total revenues 2' · 'Adjusted EBITDA (non-GAAP) 1,2' · '…¹'. 2024-Q3 판은 매출 라벨이
    'Revenues'(2025 부터는 같은 라벨이 숫자 없는 절 머리라 숫자 칸 수로 걸러진다).
  - 전망 표 단위가 2025 판은 '$(1,700) million - $(1,900) million'·'($2,000) million - ($2,250) million'(괄호가 $ 앞) ·
    2026 판은 '$(2.10) billion'·'$(1.85)B'. 음수 범위는 적힌 순서가 «큰 손실 → 작은 손실» 이 아닐 수 있어 low ≤ high 로 맞춘다.
  - 4분기 판 생산·인도 문장은 'quarter and full-year ending'·'quarter and year ending', 연간은
    'For the full year 2025, Rivian produced …' 또는 'On a full-year 2024 basis, the company produced …'.
  - 인도 가이던스 문장 동사가 reaffirming·raising·narrowing 으로 갈린다(narrowing 은 방향 낱말이 아니라 stated 없음).
  - 실적 발표일 문장: 'May 6th, 2025 after market close'(연도 뒤 쉼표 없음). 연도가 없는 꼴('on February 20th, after
    market close' — 2025-01 판)은 quote 에 날짜 연도가 없어 대조를 못 지나므로 뽑지 않는다.
  - 4분기 실적 발표 = 연간 발표 → 일정 기간 'YYYY-FY'(base.DATE_PERIOD — 'YYYY-Q4' 는 버려진다).
  - 2026-07-06 2.02 본문(분기 잠정 «추정 범위»)·2024-Q3 판 본문 문장형 '2024 Outlook' 은 코드가 안 뽑는다(not_target / 표 없음).
  - 「알아봄」 은 서식 표식으로 — 5개 분기 표 · 전망 표 머리 · 'announced production and delivery totals' 문장.
    표식은 있는데 필수 칸이 0행이면 failed 로 드러난다(kr_dart 와 같은 규칙).
"""
import re

from customer_parsers.base import (Doc, Content, ParseResult, ResultRow, VolumeRow, GuidanceRow, EarningsDate,
                                   numeric_cells, month_name_date, QUARTER_WORDS)
from customer_parsers.common import quarter_from_date_text, parse_range, dedupe_first, edgar_202_expects_numbers
from lib.doc_text import norm_text, row_text

TICKERS = ('RIVN',)
DEF = {'production': '리비안 생산: 일리노이 노멀 공장 생산 대수(회사 발표)',
       'deliveries': '리비안 인도: 고객 인도 대수(회사 발표)'}
_GUIDE_HEAD = re.compile(r'^(?:Current Outlook|(20\d{2}) (?:Annual )?Guidance(?: Summary)?)$', re.I)
GUIDANCE_ROWS = ((r'Vehicles Delivered$', 'deliveries', 'units', None),
                 (r'Adj(?:usted|\.) EBITDA$', 'adjusted_ebitda', 'billion', 'adjusted'),
                 (r'Capital Expenditures$', 'capex', 'billion', None))
# 전망 표 머리를 알아봤는데 이 지표가 하나라도 빠지면 라벨이 바뀐 것 — 문서를 failed 로(최종 검토 P5 · GM 과 같은 방식).
# 실측: 2025-02~2026-10 전망 표 8편 모두 3지표가 다 있다(2026-11-10 DB)
GUIDANCE_REQUIRED = tuple(m for _, m, _, _ in GUIDANCE_ROWS)
# 5개 분기 표에서 이 칸을 못 찾으면 라벨이 바뀐 것 — 문서를 failed 로(빠진 칸만 조용히 비지 않게)
QUARTER_REQUIRED = ('production', 'deliveries', 'revenue', 'adjusted_ebitda')
_NET_LABEL = re.compile(r'Net loss attributable to common (?:stock|share)holders(?:, basic and diluted)?')
_FOOTNOTE = re.compile(r'(?:\s+\d(?:,\d)*|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)$')
_MONTH = r'(January|February|March|April|May|June|July|August|September|October|November|December)'
_PD = re.compile(r'quarter (?:and (?:full[- ])?year )?ending ' + _MONTH + r' (\d{1,2}), (\d{4})\. The company produced '
                 r'([\d,]+) vehicles .{0,80}?delivered ([\d,]+) vehicles')
_PD_YEAR = (re.compile(r'For the full year (20\d{2}), Rivian produced ([\d,]+) vehicles and delivered ([\d,]+) vehicles'),
            re.compile(r'On a full-year (20\d{2}) basis, the company produced ([\d,]+) vehicles and delivered ([\d,]+)'))
_PD_MARK = re.compile(r'announced production and delivery (?:totals|figures)', re.I)
_G_SENT = re.compile(r'(reaffirm\w*|rais\w*|lower\w*|reduc\w*|updat\w*|narrow\w*) its (?:full[- ]year )?(20\d{2}) delivery '
                     r'(?:range )?guidance (?:range )?(?:of |to |from [\d,]+ ?(?:-|to) ?[\d,]+(?: vehicles)?,? to )'
                     r'([\d,]+) ?(?:-|to) ?([\d,]+)')
_STATED = {'reaffirm': 'maintained', 'rais': 'raised', 'lower': 'lowered', 'reduc': 'lowered'}
_DATE = re.compile(r'on ' + _MONTH + r' (\d{1,2})(?:st|nd|rd|th)?, (\d{4}),? after market close, it will release its '
                   r'(first|second|third|fourth) quarter (?:and full year )?(\d{4}) financial results')


def wants(doc: Doc) -> bool:
  return doc.source == 'edgar' and doc.doc_type in ('earnings_release', 'sales_release', 'current_report')


def expects_numbers(doc: Doc, content: Content) -> bool:
  """EDGAR 8-K Item 2.02 — 단 분기 잠정 «범위» 공시(2026-07-06 'certain preliminary and unaudited estimates')는 코드가
  일부러 안 읽으니 거짓(「서식 미인식」 오탐 · Task 10 항목 2)."""
  return edgar_202_expects_numbers(doc, content)


def _label(row):
  return _FOOTNOTE.sub('', norm_text(row[0])).strip()


def parse_quarter_table(tables) -> tuple[list[VolumeRow], list[ResultRow], bool]:
  """5개 분기 표 → (물량, 실적, 서식을 알아봤나). 필수 칸이 빠지면 0행 + True."""
  for rows in tables:
    if len(rows) < 3 or norm_text(rows[0][0]) != 'Three Months Ended':
      continue
    dates = rows[1]
    if len(dates) < 2 or not all(quarter_from_date_text(c) for c in dates):
      continue
    period = quarter_from_date_text(dates[-1])
    vol, res = [], []
    for row in rows[2:]:
      nums = numeric_cells(row)
      if len(nums) != len(dates):
        continue
      lab = _label(row)
      if lab in ('Production', 'Delivery'):
        metric = 'production' if lab == 'Production' else 'deliveries'
        vol.append(VolumeRow(metric, 'total', 'quarter', period, round(nums[-1]), DEF[metric], row_text(row)))
      elif lab in ('Total revenues', 'Revenues'):
        res.append(ResultRow('revenue', 'Total revenues', 'reported', 'quarter', period, nums[-1], 'million', 'USD',
                             row_text(row)))
      elif lab == 'Adjusted EBITDA (non-GAAP)':
        res.append(ResultRow('adjusted_ebitda', 'Adjusted EBITDA', 'adjusted', 'quarter', period, nums[-1],
                             'million', 'USD', row_text(row)))
    vol = dedupe_first(vol, lambda v: v.metric)
    res = dedupe_first(res, lambda x: x.metric)
    if not set(QUARTER_REQUIRED) <= {x.metric for x in [*vol, *res]}:
      return [], [], True
    return vol, res, True
  return [], [], False


def parse_income_statement(tables, period: str) -> list[ResultRow]:
  """손익계산서(머리 'Three Months Ended …' · 둘째 행 '전년 | 올해 …')의 영업손실·지배 순손실 — 둘째 숫자가 이번 분기."""
  year = int(period[:4])
  for rows in tables:
    if len(rows) < 3 or not norm_text(rows[0][0]).startswith('Three Months Ended'):
      continue
    if rows[1][:2] != [str(year - 1), str(year)]:  # 전년이 앞 — 둘째 숫자가 이번 분기
      continue
    out = []
    for row in rows:
      lab, nums = _label(row), numeric_cells(row)
      if len(nums) < 2:
        continue
      if lab == 'Loss from operations':
        out.append(ResultRow('operating_income', lab, 'reported', 'quarter', period, nums[1], 'million', 'USD',
                             row_text(row)))
      elif _NET_LABEL.fullmatch(lab):
        out.append(ResultRow('net_income_parent', lab, 'reported', 'quarter', period, nums[1], 'million', 'USD',
                             row_text(row)))
    if out:
      return dedupe_first(out, lambda x: x.metric)
  return []


def _guidance_cell(cell: str, unit: str) -> tuple[tuple[float, float] | None, str]:
  """전망 칸 → ((low, high), 단위). '($2,000) million' → '$(2,000)' · 'billion' → 'B' 로 맞춘 뒤 읽는다."""
  c = norm_text(cell).replace('($', '$(')
  if unit != 'units' and ' million' in c:
    c, unit = c.replace(' million', ''), 'million'
  rng = parse_range(c.replace(' billion', 'B'))
  return (tuple(sorted(rng)) if rng else None), unit


def parse_guidance_table(tables, default_year: str) -> tuple[list[GuidanceRow], bool]:
  """전망 표 → (행, 머리를 알아봤나). 머리는 있는데 필수 지표(GUIDANCE_REQUIRED)가 하나라도 없으면 칸 문구가
  바뀐 것 — 0행 + True 로 돌려 문서를 failed 로 드러낸다."""
  for rows in tables:
    m = _GUIDE_HEAD.match(norm_text(rows[0][0])) if rows and rows[0] and len(rows[0]) == 1 else None
    if not m:
      continue
    year = m.group(1) or default_year
    out = []
    for row in rows[1:]:
      if len(row) < 2:
        continue
      for rx, metric, unit, basis in GUIDANCE_ROWS:
        if re.match(rx, _label(row)):
          rng, u = _guidance_cell(row[1], unit)
          if rng:
            out.append(GuidanceRow(metric, _label(row), f'FY{year}', rng[0], rng[1], None, u, basis,
                                   row_text(row)))
    if not set(GUIDANCE_REQUIRED) <= {x.metric for x in out}:
      return [], True
    return out, True
  return [], False


def parse_text(text: str) -> ParseResult:
  r = ParseResult()
  t = norm_text(text)
  for m in _PD.finditer(t):
    period = quarter_from_date_text(f'{m.group(1)} {m.group(2)}, {m.group(3)}')
    r.volume.append(VolumeRow('production', 'total', 'quarter', period, int(m.group(4).replace(',', '')),
                              DEF['production'], m.group(0)))
    r.volume.append(VolumeRow('deliveries', 'total', 'quarter', period, int(m.group(5).replace(',', '')),
                              DEF['deliveries'], m.group(0)))
  for rx in _PD_YEAR:
    for m in rx.finditer(t):
      r.volume.append(VolumeRow('production', 'total', 'year', m.group(1), int(m.group(2).replace(',', '')),
                                DEF['production'], m.group(0)))
      r.volume.append(VolumeRow('deliveries', 'total', 'year', m.group(1), int(m.group(3).replace(',', '')),
                                DEF['deliveries'], m.group(0)))
  for m in _G_SENT.finditer(t):
    stated = next((v for k, v in _STATED.items() if m.group(1).lower().startswith(k)), None)
    lo, hi = sorted((float(m.group(3).replace(',', '')), float(m.group(4).replace(',', ''))))
    r.guidance.append(GuidanceRow('deliveries', 'Vehicles Delivered', f'FY{m.group(2)}', lo, hi,
                                  None, 'units', None, m.group(0), stated))
  for m in _DATE.finditer(t):
    q = QUARTER_WORDS[m.group(4).lower()]
    period = f'{m.group(5)}-FY' if q == 4 else f'{m.group(5)}-Q{q}'   # 4분기 발표 = 연간 발표
    r.dates.append(EarningsDate(period, month_name_date(m.group(1), m.group(2), m.group(3)), m.group(0)))
  # 생산·인도 보도자료 표식이 있으면 0행이어도 알아본 문서(문장 꼴이 바뀌면 failed 로 드러난다)
  r.recognized = bool(r.volume or r.guidance or r.dates or _PD_MARK.search(t))
  return r


def parse(doc: Doc, content: Content) -> ParseResult:
  r = ParseResult()
  r.volume, r.results, table_ok = parse_quarter_table(content.tables)
  guidance_ok = False
  if r.results:
    r.results += parse_income_statement(content.tables, r.results[0].period)
    r.guidance, guidance_ok = parse_guidance_table(content.tables, r.results[0].period[:4])
  r.recognized = table_ok
  if (table_ok and not r.results) or (guidance_ok and not r.guidance):
    # 서식은 알아봤는데 필수 칸이 0행 — 다른 행이 있어도 문서를 failed 로(kr_dart 와 같은 규칙)
    r.volume, r.results, r.guidance = [], [], []
    return r
  r.extend(parse_text(content.text))
  r.volume = dedupe_first(r.volume, lambda v: (v.metric, v.period))
  r.guidance = dedupe_first(r.guidance, lambda g: (g.metric, g.period))
  return r


# ---------------------------------------------------------------- 자가 시험(2024-11~2026-10 EDGAR 실물 원문)
Q3_TABLES = [
  [['Three Months Ended'],
   ['September 30, 2025', 'December 31, 2025', 'March 31, 2026', 'June 30, 2026', 'September 30, 2026'],
   ['Production', '10,720', '10,974', '10,236', '12,613', '19,751'],
   ['Delivery', '13,201', '9,745', '10,365', '12,194', '19,248'],
   ['Total revenues', '$', '1,558', '$', '1,286', '$', '1,381', '$', '1,658', '$', '2,155'],
   ['Adjusted EBITDA (non-GAAP) 1', '$', '(602)', '$', '(465)', '$', '(472)', '$', '(379)', '$', '(435)']],
  [['Three Months Ended September 30,', 'Nine Months Ended September 30,'], ['2025', '2026', '2025', '2026'],
   ['Loss from operations', '(983)', '(881)', '(2,752)', '(2,598)']],
  [['Current Outlook'], ['Vehicles Delivered', '67,000 – 70,000'], ['Adjusted EBITDA', '$(1.85)B – $(1.75)B'],
   ['Capital Expenditures', '$1.40B – $1.50B']],
]
# 2024-Q3 판(2024-11-07 EX-99.2) — 매출 라벨 'Revenues' · 각주 '1,2'
Q3_2024_TABLE = [
  ['Three Months Ended'],
  ['September 30, 2023', 'December 31, 2023', 'March 31, 2024', 'June 30, 2024', 'September 30, 2024'],
  ['Production', '16,304', '17,541', '13,980', '9,612', '13,157'],
  ['Delivery', '15,564', '13,972', '13,588', '13,790', '10,018'],
  ['Revenues', '$', '1,337', '$', '1,315', '$', '1,204', '$', '1,158', '$', '874'],
  ['Adjusted EBITDA (non-GAAP) 1,2', '$', '(902)', '$', '(1,006)', '$', '(798)', '$', '(857)', '$', '(757)']]
# 2025-Q1 판(2025-05-06) — 전망 표 단위 million · 손익계산서는 3개월 칸만
Q1_2025_TABLES = [
  [['Current outlook'], ['Vehicles Delivered', '40,000 - 46,000'],
   ['Adj. EBITDA', '$(1,700) million - $(1,900) million'], ['Capital Expenditures', '$1,800 million - $1,900 million']],
  [['Three Months Ended'],
   ['March 31, 2024', 'June 30, 2024', 'September 30, 2024', 'December 31, 2024', 'March 31, 2025'],
   ['Production', '13,980', '9,612', '13,157', '12,727', '14,611'],
   ['Delivery', '13,588', '13,790', '10,018', '14,183', '8,640'],
   ['Total revenues 2', '$', '1,204', '$', '1,158', '$', '874', '$', '1,734', '$', '1,240'],
   ['Adjusted EBITDA (non-GAAP) 1,2', '$', '(798)', '$', '(857)', '$', '(757)', '$', '(277)', '$', '(329)']],
  [['Three Months Ended March 31,'], ['2024', '2025'], ['Loss from operations', '(1,484)', '(655)'],
   ['Net loss attributable to common stockholders', '$', '(1,446)', '$', '(545)']],
]
MUST_HIT = [
  (Q3_TABLES, '', {('V', 'production', '2026-Q3'): 19751, ('V', 'deliveries', '2026-Q3'): 19248,
                   ('R', 'revenue', '2026-Q3'): 2155.0, ('R', 'adjusted_ebitda', '2026-Q3'): -435.0,
                   ('R', 'operating_income', '2026-Q3'): -881.0,
                   ('G', 'deliveries', 'FY2026'): (67000.0, 70000.0),
                   ('G', 'adjusted_ebitda', 'FY2026'): (-1.85, -1.75), ('G', 'capex', 'FY2026'): (1.40, 1.50)}),
  ([Q3_2024_TABLE], '', {('R', 'revenue', '2024-Q3'): 874.0, ('R', 'adjusted_ebitda', '2024-Q3'): -757.0,
                         ('V', 'production', '2024-Q3'): 13157}),
  # 2025 판 전망 표: million 단위·적힌 순서가 거꾸로인 음수 범위 → low ≤ high
  (Q1_2025_TABLES, '', {('R', 'operating_income', '2025-Q1'): -655.0, ('R', 'adjusted_ebitda', '2025-Q1'): -329.0,
                        ('R', 'net_income_parent', '2025-Q1'): -545.0,
                        ('G', 'adjusted_ebitda', 'FY2025'): (-1900.0, -1700.0), ('G', 'capex', 'FY2025'): (1800.0, 1900.0),
                        ('U', 'adjusted_ebitda'): 'million'}),
  # 4분기 판(2026-02-12 실물 EX-99.1) — 머리 '2026 Annual Guidance Summary'(연도가 머리에 · 실적 분기 2025-Q4 와 다르다)
  # + 5개 분기 표. billion 단위·적힌 순서가 거꾸로인 음수 범위
  ([[['2026 Annual Guidance Summary'], ['Vehicles Delivered', '62,000 - 67,000'],
     ['Adj. EBITDA', '$(2.10) billion - $(1.80) billion'], ['Capital Expenditures', '$1.95 billion - $2.05 billion']],
    [['Three Months Ended'],
     ['December 31, 2024', 'March 31, 2025', 'June 30, 2025', 'September 30, 2025', 'December 31, 2025'],
     ['Production', '12,727', '14,611', '5,979', '10,720', '10,974'],
     ['Delivery', '14,183', '8,640', '10,661', '13,201', '9,745'],
     ['Total revenues', '$', '1,734', '$', '1,240', '$', '1,303', '$', '1,558', '$', '1,286'],
     ['Adjusted EBITDA (non-GAAP) 1', '$', '(277)', '$', '(329)', '$', '(667)', '$', '(602)', '$', '(465)']]],
   '', {('G', 'adjusted_ebitda', 'FY2026'): (-2.10, -1.80), ('U', 'adjusted_ebitda'): 'billion',
        ('G', 'deliveries', 'FY2026'): (62000.0, 67000.0), ('G', 'capex', 'FY2026'): (1.95, 2.05),
        ('R', 'revenue', '2025-Q4'): 1286.0, ('R', 'adjusted_ebitda', '2025-Q4'): -465.0}),
  ([], 'today announced production and delivery totals for the quarter ending September 30, 2026. The company '
       'produced 19,751 vehicles at its manufacturing facility in Normal, Illinois and delivered 19,248 vehicles '
       'during the same period. Production and delivery results for the quarter are in line with Rivian\'s outlook. '
       'The company is reaffirming its 2026 delivery range guidance of 65,000 - 70,000. The company also announced '
       'that on October 29, 2026, after market close, it will release its third quarter 2026 financial results.',
   {('V', 'production', '2026-Q3'): 19751, ('V', 'deliveries', '2026-Q3'): 19248,
    ('G', 'deliveries', 'FY2026'): (65000.0, 70000.0), ('D', '2026-Q3'): '2026-10-29',
    ('S', 'deliveries'): 'maintained'}),
  ([], 'the company is today raising its full year 2026 delivery guidance from 62,000 - 67,000 vehicles, to '
       '65,000 - 70,000.', {('G', 'deliveries', 'FY2026'): (65000.0, 70000.0), ('S', 'deliveries'): 'raised'}),
  # 4분기 발표 = 연간 발표 → 일정 기간 '2025-FY'(요약서 시제품의 '2025-Q4' 는 base.DATE_PERIOD 가 버린다)
  ([], 'For the full year 2025, Rivian produced 42,284 vehicles and delivered 42,247 vehicles. The company also '
       'announced that on February 12th, 2026, after market close, it will release its fourth quarter and full year '
       '2025 financial results.',
   {('V', 'production', '2025'): 42284, ('V', 'deliveries', '2025'): 42247, ('D', '2025-FY'): '2026-02-12'}),
  # 2025-01-03 판 — 'quarter and full-year ending' · 'On a full-year 2024 basis'
  ([], 'today announced production and delivery totals for the quarter and full-year ending December 31, 2024. The '
       'company produced 12,727 vehicles at its manufacturing facility in Normal, Illinois and delivered 14,183 vehicles '
       'during the same period. On a full-year 2024 basis, the company produced 49,476 vehicles and delivered 51,579.',
   {('V', 'production', '2024-Q4'): 12727, ('V', 'deliveries', '2024-Q4'): 14183, ('V', 'production', '2024'): 49476,
    ('V', 'deliveries', '2024'): 51579}),
  # 2025-04-02 판 — 연도 뒤 쉼표 없음 · 2025-07-02 판 'delivery guidance range of'
  ([], 'Rivian is also reaffirming its 2025 delivery range guidance of 46,000 to 51,000 vehicles. The company also '
       'announced that on May 6th, 2025 after market close, it will release its first quarter 2025 financial results.',
   {('G', 'deliveries', 'FY2025'): (46000.0, 51000.0), ('D', '2025-Q1'): '2025-05-06'}),
  ([], 'Rivian is also reaffirming its 2025 delivery guidance range of 40,000 to 46,000 vehicles.',
   {('G', 'deliveries', 'FY2025'): (40000.0, 46000.0), ('S', 'deliveries'): 'maintained'}),
  # 2025-10-02 판 — narrowing(방향 낱말 아님 → stated 없음, 숫자 비교가 정한다)
  ([], 'Today the company is narrowing its 2025 delivery guidance range to 41,500 to 43,500 vehicles.',
   {('G', 'deliveries', 'FY2025'): (41500.0, 43500.0), ('S', 'deliveries'): None}),
]
MUST_MISS = [
  # 사업 설명 속 'R2 출시는 2026년 2분기' 는 실적 발표일이 아니다
  ([], 'in preparation for the launch of R2 in the second quarter of 2026.', 'D'),
  # 연도 없는 발표일(2025-01-03 판)은 대조를 못 지나므로 뽑지 않는다
  ([], 'The company also announced that on February 20th, after market close, it will release its fourth quarter 2024 '
       'financial results.', 'D'),
]
# 「알아봤는데 0행」 이어야 하는 표본 — 꼴이 바뀐 것이 not_target 으로 조용히 닫히지 않고 failed 로 드러나는지
MUST_RECOGNIZED_EMPTY = [
  ('5개 분기 표: 매출 라벨 변경', [[r if r[0] != 'Total revenues' else ['Net revenues', *r[1:]] for r in Q3_TABLES[0]]], ''),
  ('전망 표: 칸 문구 변경', [Q3_TABLES[0], [['Current Outlook'], ['Deliveries (units)', '67,000 – 70,000']]], ''),
  # 필수 지표 하나만 라벨이 바뀜(최종 검토 P5 — GM 과 같은 구멍) — 나머지 2행이 있어도 failed
  ('전망 표: 지표 하나 빠짐', [Q3_TABLES[0], [['Current Outlook'], ['Vehicles Delivered', '67,000 – 70,000'],
                                              ['Adjusted EBITDA', '$(1.85)B – $(1.75)B'],
                                              ['Capital Spending', '$1.40B – $1.50B']]], ''),
  ('생산·인도 문장 변경', [], 'Rivian Automotive, Inc. today announced production and delivery totals for the third '
                              'quarter of 2026: 19,751 vehicles were produced and 19,248 were delivered.'),
]


def _flatten(r: ParseResult) -> dict:
  out = {}
  for x in r.volume:
    out[('V', x.metric, x.period)] = x.value
  for x in r.results:
    out[('R', x.metric, x.period)] = x.value
  for x in r.guidance:
    out[('G', x.metric, x.period)] = (x.low, x.high)
    out[('S', x.metric)] = x.stated
    out[('U', x.metric)] = x.unit
  for x in r.dates:
    out[('D', x.period)] = x.event_date
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'RIVN', 'edgar', 'earnings_release', '8-K', '2.02', '', '', '2026-10-29')
  for tables, text, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    for k, v in want.items():
      if got.get(k, 'missing') != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k, "missing")}')
  for tables, text, kind in MUST_MISS:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    if any(k[0] == kind for k in got):
      errs.append(f'MUST_MISS {kind} 가 뽑혔다: {got}')
  for name, tables, text in MUST_RECOGNIZED_EMPTY:
    res = parse(doc, Content(text=text, tables=tables))
    if res.count() or not res.recognized:
      errs.append(f'{name}: 행 {res.count()} · recognized={res.recognized} (기대 0행 · True)')
  return errs
