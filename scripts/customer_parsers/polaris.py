"""폴라리스 — EDGAR 8-K 2.02 EX-99.1. 실적은 표, 가이던스는 '20XX BUSINESS OUTLOOK' 절의 문장.

출처·표본 = 참고/고객사/research/us_domestic.md(2026-11-09 실측) + 2024-10~2026-10 EDGAR 실물 9건 회귀(2026-11-10).

- 실적 요약 표: 머리 'Quarter ended <날짜> | Reported | YOY % Chg. | Adjusted* | YOY % Chg.'
  (퍼센트 셀은 numeric_cells 가 건너뛰므로 숫자 두 개 = 장부상·조정)
- 손익계산서: 머리 '2026 | 2025 | 2026 | 2025'(이번 해가 앞)의 영업이익 행
- 물량: 폴라리스는 대수를 발표하지 않는다 → 물량 없음(파서가 만들지 않는다)

함정(실측):
  - 요약 표의 조정 칸이 비는 분기가 있다(2026-Q1·Q2 'Sales | $ | 1,658.7 | 8%' — 숫자 하나). 그때는 장부상 매출만.
  - 손익계산서 영업이익 라벨이 손익 부호에 따라 바뀐다 — 'Operating income' · 'Operating (loss) income' ·
    'Operating loss' · 'Operating income (loss)'(표 제목도 'STATEMENTS OF (LOSS) INCOME'·'OF LOSS' 로 바뀐다).
  - 가이던스 문장 꼴(회차마다 다르다):
      2026 판 'expects 2026 adjusted sales to be between $7.15 billion to $7.30 billion and adjusted EPS of $1.60 to $1.70'
        ('expects' 가 매출 쪽에만 붙는다) · 'now expects adjusted EPS of $3.50 to $3.60 versus prior guidance of …'(앞 범위)
      2025-Q4 판 'expects 2026 sales to be up one to three percent' · 'adjusted diluted EPS … to be between $1.50 and $1.60'
      2025-Q3 판 'adjusted EPS of ~($0.05)'(근사 단일값·괄호 음수)
      'down one to four percent'·'down approximately 20 percent'(감소 % 범위)는 값이 음수인데 원문 수는 양수라 대조를 못 지나므로
        value_text(원문 낱말 그대로)로 싣는다. 'EPS … down approximately 65 percent'(EPS 증감률)는 맞는 metric 이 없어 뽑지 않는다.
      2025-Q1·Q2 판은 연간 전망 철회('withdrawing'·'withhold') + 분기 매출 전망만 — 분기 전망은 연간 가이던스가 아니라 뽑지 않는다.
  - 하이라이트 글머리표·10-14 잠정실적 보도자료의 분기 전망은 절 밖이라 보지 않는다(MUST_MISS).
  - 「알아봄」 은 서식 표식(요약 표 머리)으로 — 머리는 있는데 매출 칸이 없으면 failed 로 드러난다(kr_dart 와 같은 규칙).
"""
import re

from customer_parsers.base import Doc, Content, ParseResult, ResultRow, GuidanceRow, numeric_cells
from customer_parsers.common import quarter_from_date_text, word_or_number, money
from lib.doc_text import norm_text, row_text

TICKERS = ('PII',)
_HEAD = re.compile(r'^Quarter ended (.+\d{4})$')
_OP_LABEL = re.compile(r'^Operating (?:income|loss|\(loss\) income|income \(loss\))$')
_OUTLOOK = re.compile(r'(20\d{2}) BUSINESS OUTLOOK')
_STATED = re.compile(r'The Company is (raising|reaffirming|lowering|reducing|updating) (20\d{2}) full year', re.I)
_STATED_MAP = {'raising': 'raised', 'reaffirming': 'maintained', 'lowering': 'lowered', 'reducing': 'lowered'}
_EPS_PREFIX = r'adjusted (?:diluted )?EPS (?:attributed to Polaris Inc\. common stockholders )?'
_N = r'(\d+(?:\.\d+)?)'   # 🔴 '[\d.]+' 는 문장 끝 마침표까지 먹는다('$1.70.' → float 실패)
# (정규식, metric, 라벨, 단위, 꼴) — 꼴: 'range'(연도·하한·상한) · 'range_noyear'(하한·상한) · 'approx'(근사 단일값) ·
# 'pct_up'(연도·낱말 수 범위) · 'pct_text'(연도·원문 낱말 — 감소 % 는 value_text)
_G = (
  (re.compile(r'expects (20\d{2}) adjusted sales to be between \$' + _N + r' billion (?:to|and) \$' + _N + r' billion'),
   'adjusted_sales', 'Adjusted sales', 'billion', 'range'),
  (re.compile(_EPS_PREFIX + r'(?:of|to be between) \$' + _N + r' (?:to|and) \$' + _N),
   'eps_adjusted', 'Adjusted EPS', 'per_share', 'range_noyear'),
  (re.compile(_EPS_PREFIX + r'of ~(\(?\$\(?\d+(?:\.\d+)?\)?)'), 'eps_adjusted', 'Adjusted EPS', 'per_share', 'approx'),
  (re.compile(r'expects (20\d{2}) sales to be up (\w+) to (\w+) percent'), 'revenue_growth', 'Sales growth', 'percent',
   'pct_up'),
  (re.compile(r'(?:expects (20\d{2}) sales|(20\d{2}) sales outlook) to be (down (?:\w+ to \w+|approximately \w+) percent)'),
   'revenue_growth', 'Sales growth', 'percent', 'pct_text'),
)


def wants(doc: Doc) -> bool:
  return doc.source == 'edgar' and doc.doc_type == 'earnings_release'


def parse_results(tables) -> tuple[list[ResultRow], bool]:
  """요약 표 → (행, 서식을 알아봤나). 머리는 있는데 매출 행이 없으면 0행 + True(failed 로 드러난다)."""
  for rows in tables:
    head = next((r for r in rows[:3] if _HEAD.match(norm_text(r[0]))), None)
    if not head or 'Reported' not in head or not any(c.startswith('Adjusted') for c in head):
      continue
    period = quarter_from_date_text(head[0])
    out = []
    for row in rows:
      lab, nums = norm_text(row[0]), numeric_cells(row)
      if not 1 <= len(nums) <= 2:
        continue
      if lab == 'Sales':
        out.append(ResultRow('revenue', 'Sales', 'reported', 'quarter', period, nums[0], 'million', 'USD', row_text(row)))
        if len(nums) == 2:   # 조정 칸이 빈 분기(2026-Q1·Q2)는 장부상만
          out.append(ResultRow('adjusted_sales', 'Adjusted sales', 'adjusted', 'quarter', period, nums[1], 'million',
                               'USD', row_text(row)))
      elif re.fullmatch(r'Net (?:income|\(loss\) income|income \(loss\)|loss) attributable to Polaris', lab):
        out.append(ResultRow('net_income_parent', lab, 'reported', 'quarter', period, nums[0], 'million', 'USD',
                             row_text(row)))
      elif lab == 'Diluted EPS attributable to Polaris' and len(nums) == 2:
        out.append(ResultRow('eps_adjusted', 'Adjusted EPS', 'adjusted', 'quarter', period, nums[1], 'per_share',
                             'USD', row_text(row)))
    if not any(x.metric == 'revenue' for x in out):
      return [], True
    return out, True
  return [], False


def parse_operating(tables, period: str) -> list[ResultRow]:
  y = period[:4]
  for rows in tables:
    if not any(r[:2] == [y, str(int(y) - 1)] for r in rows[:5]):
      continue
    for row in rows:
      lab = norm_text(row[0])
      if _OP_LABEL.match(lab):
        nums = numeric_cells(row)
        if nums:
          return [ResultRow('operating_income', lab, 'reported', 'quarter', period, nums[0],
                            'million', 'USD', row_text(row))]
  return []


def parse_guidance(text: str) -> list[GuidanceRow]:
  t = norm_text(text)
  head = _OUTLOOK.search(t)  # 하이라이트 줄·CEO 말·잠정실적 문장은 보지 않는다
  if not head:
    return []
  sect = t[head.start():head.start() + 1500]
  default_year = head.group(1)
  sm = _STATED.search(sect)
  stated = _STATED_MAP.get(sm.group(1).lower()) if sm else None
  out = []
  for rx, metric, label, unit, kind in _G:
    m = rx.search(sect)
    if not m:
      continue
    g = m.groups()
    lo = hi = text_value = None
    if kind in ('range', 'pct_up'):
      year, lo, hi = g[0], word_or_number(g[1]), word_or_number(g[2])
    elif kind == 'range_noyear':
      year, lo, hi = default_year, float(g[0]), float(g[1])
    elif kind == 'approx':
      year, lo = default_year, money(g[0])
      hi = lo
    else:  # pct_text
      year, text_value = g[0] or g[1], g[2]
    out.append(GuidanceRow(metric, label, f'FY{year}', lo, hi, text_value, unit,
                           'reported' if metric == 'revenue_growth' else 'adjusted', m.group(0), stated))
  # 같은 metric 이 두 꼴로 잡히면 처음 것(범위가 근사값보다 앞에 있다)
  seen, uniq = set(), []
  for x in out:
    if x.metric not in seen:
      seen.add(x.metric)
      uniq.append(x)
  return uniq


def parse(doc: Doc, content: Content) -> ParseResult:
  r = ParseResult()
  r.results, r.recognized = parse_results(content.tables)
  if r.results:
    r.results += parse_operating(content.tables, r.results[0].period)
    r.guidance = parse_guidance(content.text)
  return r


# ---------------------------------------------------------------- 자가 시험(2024-10~2026-10 EDGAR 실물 원문)
MUST_HIT = [
  ([[['(in millions, except per share data)'],
     ['Quarter ended September 30, 2026', 'Reported', 'YOY % Chg.', 'Adjusted*', 'YOY % Chg.'],
     ['Sales', '$', '2,042.6', '11%', '$', '2,041.8', '11%'],
     ['Diluted EPS attributable to Polaris', '$', '0.66', 'NM', '$', '1.08', '163%']],
    [['Three months ended September 30,', 'Nine months ended September 30,'], ['2026', '2025', '2026', '2025'],
     ['Operating income (loss)', '73.4', '20.4', '183.1', '(28.6)']]],
   '2026 BUSINESS OUTLOOK The Company is raising 2026 full year adjusted sales and adjusted EPS guidance. The Company '
   'now expects 2026 adjusted sales to be between $7.55 billion to $7.60 billion versus prior guidance of $7.30 '
   'billion to $7.50 billion. The Company now expects adjusted EPS of $3.50 to $3.60 versus prior guidance of $3.00 '
   'to $3.10, of which approximately $1.09 is attributed to the benefit of tariff refunds',
   {('R', 'revenue', '2026-Q3'): 2042.6, ('R', 'adjusted_sales', '2026-Q3'): 2041.8,
    ('R', 'eps_adjusted', '2026-Q3'): 1.08, ('R', 'operating_income', '2026-Q3'): 73.4,
    ('G', 'adjusted_sales', 'FY2026'): (7.55, 7.60), ('G', 'eps_adjusted', 'FY2026'): (3.50, 3.60),
    ('S', 'eps_adjusted'): 'raised'}),
  # 2026-Q1 판(2026-04-28) — 조정 칸이 빈 매출 행 · 'Operating loss' · 'expects' 가 매출 쪽에만 붙은 EPS 문장
  ([[['(in millions, except per share data)'],
     ['Quarter ended March 31, 2026', 'Reported', 'YOY % Chg.', 'Adjusted*', 'YOY % Chg.'],
     ['Sales', '$', '1,658.7', '8%'],
     ['Net (loss) income attributable to Polaris', '$', '(47.4)', '29%', '$', '7.5', 'NM'],
     ['Diluted EPS attributable to Polaris', '$', '(0.83)', '29%', '$', '0.13', 'NM']],
    [['CONSOLIDATED STATEMENTS OF LOSS'], ['(In Millions, Except Per Share Data), (Unaudited)'],
     ['Three months ended March 31,'], ['2026', '2025'], ['Operating loss', '(39.1)', '(36.1)']]],
   '2026 BUSINESS OUTLOOK The Company is reaffirming 2026 full year adjusted sales and adjusted EPS guidance. The '
   'Company expects 2026 adjusted sales to be between $7.15 billion to $7.30 billion and adjusted EPS of $1.60 to '
   '$1.70.',
   {('R', 'revenue', '2026-Q1'): 1658.7, ('R', 'adjusted_sales', '2026-Q1'): None, ('R', 'operating_income', '2026-Q1'): -39.1,
    ('R', 'net_income_parent', '2026-Q1'): -47.4, ('R', 'eps_adjusted', '2026-Q1'): 0.13,
    ('G', 'adjusted_sales', 'FY2026'): (7.15, 7.30), ('G', 'eps_adjusted', 'FY2026'): (1.60, 1.70),
    ('S', 'adjusted_sales'): 'maintained'}),
  # 2025-Q1 판 'Operating (loss) income' · 2025-Q3 판 근사 단일값 EPS '~($0.05)'
  ([[['(in millions, except per share data)'],
     ['Quarter ended September 30, 2025', 'Reported', 'YOY % Chg.', 'Adjusted*', 'YOY % Chg.'],
     ['Sales', '$', '1,841.6', '7%', '$', '1,838.0', '7%']],
    [['Three months ended September 30,', 'Nine months ended September 30,'], ['2025', '2024', '2025', '2024'],
     ['Operating (loss) income', '20.4', '66.1', '(28.6)', '224.8']]],
   '2025 BUSINESS OUTLOOK The Company reintroduced updated 2025 full year adjusted sales and adjusted EPS guidance. The '
   'Company now expects 2025 adjusted sales to be between $6.9 billion to $7.1 billion and adjusted EPS of ~($0.05).',
   {('R', 'operating_income', '2025-Q3'): 20.4, ('G', 'adjusted_sales', 'FY2025'): (6.9, 7.1),
    ('G', 'eps_adjusted', 'FY2025'): (-0.05, -0.05)}),
]
# 문장만(실적 표 없이 parse_guidance 를 직접) — 2025-Q4·2024-Q4·2024-Q3 판
MUST_HIT_TEXT = [
  ('2026 BUSINESS OUTLOOK The Company expects 2026 sales to be up one to three percent versus 2025. The Company '
   'expects adjusted diluted EPS attributed to Polaris Inc. common stockholders to be between $1.50 and $1.60, '
   'relative to ($0.01) in 2025.',
   {('G', 'revenue_growth', 'FY2026'): (1.0, 3.0), ('G', 'eps_adjusted', 'FY2026'): (1.50, 1.60)}),
  ('2025 BUSINESS OUTLOOK The Company expects 2025 sales to be down one to four percent versus 2024. The Company '
   'expects adjusted diluted EPS attributed to Polaris Inc. common stockholders to be down approximately 65 percent '
   'versus 2024.', {('T', 'revenue_growth', 'FY2025'): 'down one to four percent'}),
  ('2024 BUSINESS OUTLOOK The Company updated its 2024 sales outlook to be down approximately 20 percent relative to '
   '2023 versus its previous outlook of down 17 to 20 percent relative to 2023.',
   {('T', 'revenue_growth', 'FY2024'): 'down approximately 20 percent'}),
]
MUST_MISS = [
  # 하이라이트 줄(본문 'BUSINESS OUTLOOK' 절 밖)은 같은 값을 되풀이할 뿐 — 절 밖에서는 뽑지 않는다
  '• Polaris is raising full year 2026 guidance to adjusted EPS of $3.50 to $3.60 from $3.00 to $3.10.',
  # 10-14 잠정실적 보도자료의 '분기' 전망 범위는 연간 가이던스가 아니다
  'we expect third quarter sales to be at the high end of our previously issued guidance range of $1.6 billion to '
  '$1.8 billion. We anticipate third quarter adjusted EPS to be in the range of $0.31 to $0.41',
  # 2025-Q1 판 — 분기 매출 전망 + 연간 철회(연간 가이던스 행이 없어야 한다) · EPS 증감률은 metric 이 없다
  '2025 BUSINESS OUTLOOK The Company introduced second quarter 2025 sales guidance of $1.6 billion to $1.8 billion. '
  'The Company is withdrawing full year 2025 guidance due to trade and economic uncertainty.',
  '2025 BUSINESS OUTLOOK The Company expects adjusted diluted EPS attributed to Polaris Inc. common stockholders to be '
  'down approximately 65 percent versus 2024.',
]
# 요약 표 머리는 있는데 매출 라벨이 바뀌면 0행 · recognized(failed 로 드러난다)
MUST_RECOGNIZED_EMPTY = [[['(in millions, except per share data)'],
                          ['Quarter ended September 30, 2026', 'Reported', 'YOY % Chg.', 'Adjusted*', 'YOY % Chg.'],
                          ['Net sales', '$', '2,042.6', '11%', '$', '2,041.8', '11%']]]


def _flatten(r: ParseResult) -> dict:
  out = {}
  for x in r.results:
    out[('R', x.metric, x.period)] = x.value
  for x in r.guidance:
    out[('G', x.metric, x.period)] = (x.low, x.high)
    out[('T', x.metric, x.period)] = x.value_text
    if x.stated:
      out[('S', x.metric)] = x.stated
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'PII', 'edgar', 'earnings_release', '8-K', '2.02', '', '', '2026-10-27')
  for tables, text, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for text, want in MUST_HIT_TEXT:
    r = ParseResult()
    r.guidance = parse_guidance(text)
    got = _flatten(r)
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT_TEXT {k}: 기대 {v} · 실제 {got.get(k)}')
  for text in MUST_MISS:
    rows = parse_guidance(text)
    if rows:
      errs.append(f'MUST_MISS 가이던스가 뽑혔다: {[(g.metric, g.low, g.high, g.value_text) for g in rows]}')
  res = parse(doc, Content(text='', tables=MUST_RECOGNIZED_EMPTY))
  if res.count() or not res.recognized:
    errs.append(f'요약 표 매출 라벨 변경: 행 {res.count()} · recognized={res.recognized} (기대 0행 · True)')
  return errs
