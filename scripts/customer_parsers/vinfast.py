"""빈패스트 — EDGAR 6-K(본문 htm·EX-99.1). 🔴 자동차(EV)만 다룬다 — 전기 이륜차(e-scooter·e-bike) 수치는
수집·표시하지 않는다(사용자 지시 2026-11-09). 문장·표 모두 'electric vehicles ("EVs")'·'EVs'·'EV Deliveries' 라벨만 잡고,
이륜차 문장·행은 MUST_MISS 로 못 박는다.

출처·표본 = 2024-10~2026-10 EDGAR 6-K 실물 60건 회귀(2026-11-10). 6-K 는 목록 분류(Task 3)가 전부 current_report 로
붙인다 — 실적 보도자료인지는 본문(표)으로 가른다.

- 분기 인도(6-K 잠정): 'The Company delivered N electric vehicles ("EVs") globally in the third quarter of 2026'
  (2025·2024 판 'in 3Q25' · '("EVs") 1 globally' 각주 · 2024-10 판은 'globally' 없음)
- 누적(같은 문서): 'in the first nine months of 2026, VinFast delivered N EVs to customers globally'
  · 'in the first half of 2026, the Company delivered N EVs to customers globally'
- 연간(4분기 인도 6-K): 'For the full year 2025, the Company delivered N EVs,' · 2024 판 'total deliveries of N EVs 1
  globally for the full year 2024'
- 베트남 월 인도(6-K): 'preliminary domestic Vietnam deliveries of N electric vehicles ("EVs") (1)? for|in September 2026'
  (2025-04 이전 판 'over 12,100'·'more than 12,500' 은 정확한 값이 아니라 뽑지 않는다)
- 실적 보도자료 표: 머리 '2Q2026 | 1Q2026 | 2Q2025' · '2025 Q1 | 2024 Q4 …' · 'FY2025 | FY2024' 의 'EV Deliveries' ·
  'Total Revenues'(VND 백만 — 본문 '(in VND millions, except for percentages)'). 첫 숫자 = 머리 첫 칸 기간.
- 실적 일정(인도 6-K·일정 6-K): 'will release its 3Q26 financial results before the market opens on December 2, 2026'
  · 'intends to release its 4Q25 and full year 2025 financial results before market opens on March 16, 2026'(4분기 = FY)
- 영업손실: 표 머리가 VND·USD 열이 섞여 열 위치가 분기마다 다르다 → 2단계 범위 밖(계획서 「매출만」)
- 가이던스: 문장이 제각각(배수 'at least double' · 'target of 300,000 electric vehicles' · 이륜차 목표가 같은 문단)이라
  LLM 칸(llm_wants). 🔴 LLM 프롬프트에도 이륜차 목표 제외(Task 11).

함정(실측):
  - 베트남 월 문장 꼴이 이륜차 연간 공시에도 쓰인다 — 'preliminary domestic Vietnam deliveries of 406,453 electric scooters'
    (2026-01-26). 표식은 'electric vehicles' 까지 붙여 본다(MUST_MISS).
  - 베트남 연간·누계('… a preliminary total of 175,099 EVs 1 to customers in Vietnam')는 전 세계 칸이 아니다(MUST_MISS).
  - 2025-04-24 판 매출 표는 머리 앞에 조각 행 ['2023 Q4'] 이 붙는다 — 머리는 «기간 칸이 두 개 이상 이어진 행»으로 찾는다.
  - 표의 지난 분기 칸은 다음 보도자료에서 재작성된다(1Q2026 매출 23,111,052 → 22,836,084) — 첫 칸(이번 기간)만 읽는다.
  - 「알아봄」은 서식 표식으로 — 표식은 있는데 그 서식에 늘 있는 행이 빠지면 문서를 비워 failed 로 드러낸다
    (분기 인도 문장 · 베트남 월 문장 · 실적 표의 EV Deliveries·Total Revenues 두 행. 실물 전수에서 늘 있었다).
"""
import re

from customer_parsers.base import (Doc, Content, ParseResult, ResultRow, VolumeRow, EarningsDate, numeric_cells,
                                   month_name_date, QUARTER_WORDS, MONTHS)
from lib.doc_text import norm_text, row_text

TICKERS = ('VFS',)
# EV 범위 = 회사 각주 'Includes EV models under VF, Green and Lac Hong brands, EC Van and e-buses.'(2026-06·10 실적
# 보도자료 표 'EV Deliveries (1)' 각주). 베트남 월 문장의 '("EVs") 1' 각주는 본문 추출에 각주 글이 없어 같은 회사 정의로 둔다
DEF_GLOBAL = ('빈패스트 전기차(EV) 고객 인도 — 승용 EV·승합 화물 전기차(EC Van)·전기버스 포함 · 잠정치(연말 감사 후 바뀔 수 있음)'
              ' · 전기 이륜차 제외')
DEF_VN = '빈패스트 베트남 내수 EV 인도 — 승용 EV·승합 화물 전기차(EC Van)·전기버스 포함 · 잠정치 · 해외 수출 예정분 제외 · 전기 이륜차 제외'
_MONTH = r'(January|February|March|April|May|June|July|August|September|October|November|December)'
_EVS = r'electric vehicles \("EVs"\)(?: \d)?'   # 각주 번호 '("EVs") 1' 꼴(2025 판)
_Q = re.compile(r'The Company delivered ([\d,]+) ' + _EVS + r'(?: globally)? in '
                r'(?:the (first|second|third|fourth) quarter of (\d{4})|([1-4])Q(\d\d))\b')
_YTD = re.compile(r'in the first (half|six months|nine months) of (\d{4}), (?:VinFast|the Company) delivered ([\d,]+) EVs '
                  r'to customers globally')
_FY = (re.compile(r'For the full year (\d{4}), the Company delivered ([\d,]+) EVs,'),
       re.compile(r'total deliveries of ([\d,]+) EVs(?: \d)? globally for the full year (\d{4})'))
_VN_MONTH = re.compile(r'domestic Vietnam deliveries of ([\d,]+) ' + _EVS + r' (?:for|in) ' + _MONTH + r' (\d{4})')
_DATE = re.compile(r'(?:will|intends to) release its ([1-4])Q(\d\d)(?: and full year \d{4})? financial results before '
                   r'(?:the )?market opens on ' + _MONTH + r' (\d{1,2}),? (\d{4})')
# 서식 표식(이것이 있으면 그 서식에 늘 있는 행이 나와야 한다)
_Q_MARK = re.compile(r'The Company delivered [\d,]+ electric vehicles')
_VN_MARK = re.compile(r'domestic Vietnam deliveries of [\d,]+ electric vehicles')
_PERIOD_CELL = (
  (re.compile(r'([1-4])Q(\d{4})'), 'quarter'),       # 2Q2026
  (re.compile(r'(\d{4}) Q([1-4])'), 'quarter_yq'),    # 2025 Q1
  (re.compile(r'FY ?(\d{4})'), 'year'),               # FY2025 · FY 2024
)
_FOOTNOTE = re.compile(r'\s*(?:\(\s*\d\s*\)|\d)$')    # 'EV Deliveries 1' · '(1)' · '( 1 )'


def wants(doc: Doc) -> bool:
  # 20-F(연차)는 다른 파서처럼 대상 밖(pending) — 같은 숫자를 6-K 보도자료가 먼저 낸다
  return doc.source == 'edgar' and doc.form == '6-K'


def llm_wants(doc: Doc, result: ParseResult) -> bool:
  """가이던스(LLM 칸)가 실리는 문서인지 — 본문 기준(Task 3 carry: 6-K 분류가 실적 보도자료를 earnings_release 로
  붙인다는 보장이 없다). 실물에서 FY 전망이 실린 자리는 두 갈래다:
    ① 실적 보도자료 'Business Outlook' — 실적 표의 'Total Revenues' 가 잡힌 문서
    ② 전망·일정 공지 6-K('ANNOUNCES 2026 GUIDANCE AND SET DATE …' 2026-02-09)·4분기 인도 6-K(2025-02-13) —
       실적 일정 문장이 잡힌 문서
  🔴 실적 표를 코드로 다 뽑아 recognized 여도 전망 문장은 LLM 칸이라 참을 돌려준다(오케스트레이터 _llm 은
  recognized 와 무관하게 이 함수를 부른다). --no-llm 실행이면 이 문서는 parsed 로 닫히되 parse_note 맨 앞에
  「LLM 대기」 표식이 남는다 — LLM 이 생긴 뒤 parse_note LIKE 'LLM 대기%' 로 뽑아 --reparse 한다."""
  return any(x.metric_name == 'Total Revenues' for x in result.results) or bool(result.dates)


LLM_HINT = ('🔴 전기 이륜차(e-scooter·e-bike·electric motorbike·two-wheeler) 목표·수치는 뽑지 마세요. 자동차(EV)만 — '
            '인도 목표는 metric=deliveries, unit=units. 매출·이익 전망도 회사 전체(연간)만.')


def _n(s: str) -> int:
  return int(s.replace(',', ''))


def parse_text(text: str) -> tuple[list[VolumeRow], bool]:
  """문장 → (물량 행, 표식이 있는데 필수 행이 빠졌나)."""
  t = norm_text(text)
  out, missing = [], False
  for m in _Q.finditer(t):
    if m.group(2):
      period = f'{m.group(3)}-Q{QUARTER_WORDS[m.group(2)]}'
    else:
      period = f'20{m.group(5)}-Q{m.group(4)}'
    out.append(VolumeRow('deliveries', 'total', 'quarter', period, _n(m.group(1)), DEF_GLOBAL, m.group(0)))
  if _Q_MARK.search(t) and not any(v.period_grain == 'quarter' for v in out):
    missing = True
  for m in _YTD.finditer(t):
    months = 9 if m.group(1) == 'nine months' else 6
    out.append(VolumeRow('deliveries', 'total', 'ytd', f'{m.group(2)}-{months}M', _n(m.group(3)), DEF_GLOBAL, m.group(0)))
  for i, rx in enumerate(_FY):
    for m in rx.finditer(t):
      year, n = (m.group(1), m.group(2)) if i == 0 else (m.group(2), m.group(1))
      out.append(VolumeRow('deliveries', 'total', 'year', year, _n(n), DEF_GLOBAL, m.group(0)))
  n_vn = 0
  for m in _VN_MONTH.finditer(t):
    out.append(VolumeRow('deliveries', 'vietnam', 'month', f'{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}',
                         _n(m.group(1)), DEF_VN, m.group(0)))
    n_vn += 1
  if _VN_MARK.search(t) and not n_vn:
    missing = True
  return out, missing


def parse_dates(text: str) -> list[EarningsDate]:
  out = []
  for m in _DATE.finditer(norm_text(text)):
    q, year = int(m.group(1)), f'20{m.group(2)}'
    period = f'{year}-FY' if q == 4 else f'{year}-Q{q}'
    out.append(EarningsDate(period, month_name_date(m.group(3), m.group(4), m.group(5)), m.group(0)))
  return out


def _period(cell: str) -> tuple[str, str] | None:
  """머리 칸 → (grain, period)."""
  c = norm_text(cell)
  for rx, kind in _PERIOD_CELL:
    m = rx.fullmatch(c)
    if m:
      if kind == 'quarter':
        return 'quarter', f'{m.group(2)}-Q{m.group(1)}'
      if kind == 'quarter_yq':
        return 'quarter', f'{m.group(1)}-Q{m.group(2)}'
      return 'year', m.group(1)
  return None


def _head(rows) -> tuple[str, str] | None:
  """기간 칸이 두 개 이어진 머리 행(앞 두 행 중)의 첫 칸 기간. 2025-04 판의 조각 행 ['2023 Q4'] 은 건너뛴다.
  둘째 칸은 뒤에 붙은 말을 떼고 본다('FY2023 As adjusted (2)' — 2025-04 판 연간 표)."""
  for row in rows[:2]:
    if len(row) >= 2 and _period(row[0]) and _period(re.sub(r' As adjusted.*$', '', norm_text(row[1]))):
      return _period(row[0])
  return None


def parse_tables(tables) -> tuple[list[VolumeRow], list[ResultRow], bool]:
  """실적 보도자료 표 → (물량, 실적, 실적 표 서식을 알아봤나)."""
  vol, res, seen = [], [], False
  for rows in tables:
    head = _head(rows) if rows else None
    if not head:
      continue
    grain, period = head
    for row in rows[1:]:
      lab = _FOOTNOTE.sub('', norm_text(row[0])).strip().lower()
      if lab not in ('ev deliveries', 'total revenues'):
        continue
      seen = True
      nums = numeric_cells(row)
      if not nums:
        continue
      if lab == 'ev deliveries':
        vol.append(VolumeRow('deliveries', 'total', grain, period, round(nums[0]), DEF_GLOBAL, row_text(row)))
      else:
        res.append(ResultRow('revenue', 'Total Revenues', 'reported', grain, period, nums[0], 'million', 'VND',
                             row_text(row)))
  return vol, res, seen


def parse(doc: Doc, content: Content) -> ParseResult:
  r = ParseResult()
  vol, res, table_seen = parse_tables(content.tables)
  text_vol, text_missing = parse_text(content.text)
  r.volume = vol + text_vol
  r.results = res
  r.dates = parse_dates(content.text)
  r.recognized = table_seen or text_missing or bool(r.volume or r.results or r.dates)
  # 실적 표 서식인데 EV Deliveries·Total Revenues 중 하나가 빠졌거나, 인도 문장 표식인데 행이 없으면 꼴이 바뀐 것
  if (table_seen and not (vol and res)) or text_missing:
    return ParseResult(recognized=True)
  r.dedupe()  # 표와 문장이 같은 분기를 함께 낼 때(보도자료 표 + 본문)
  return r


# ---------------------------------------------------------------- 자가 시험(2024-10~2026-10 EDGAR 실물 원문)
_Q3_2026 = ('Preliminary Global Deliveries in 3Q26 The Company delivered 82,580 electric vehicles ("EVs") globally in the '
            'third quarter of 2026, representing a 116% increase year-over-year. Cumulatively, in the first nine months of '
            '2026, VinFast delivered 211,242 EVs to customers globally, representing a 91% increase year-over-year.')
_Q3_2026_WANT = {('deliveries', 'total', '2026-Q3'): 82580, ('deliveries', 'total', '2026-9M'): 211242}
_EV_TABLE = [['2Q2026', '1Q2026', '2Q2025'], ['EV Deliveries 1', '70,085', '58,577', '35,837'],
             ['E-scooter & E-bike Deliveries', '286,039', '143,136', '69,580']]
_REV_TABLE = [['2Q2026', '1Q2026', '2Q2025', 'QoQ', 'YoY'],
              ['Vehicle Sales', '28,833,074', '21,612,507', '14,966,043', '33.4', '%', '92.7', '%'],
              ['Total Revenues', '30,340,852', '22,836,084', '16,356,556', '32.9', '%', '85.5', '%']]
MUST_HIT = [
  ([], _Q3_2026, _Q3_2026_WANT),
  ([], 'announced preliminary domestic Vietnam deliveries of 23,624 electric vehicles ("EVs") for September 2026, '
       'representing an increase of 17% compared to the previous month.',
   {('deliveries', 'vietnam', '2026-09'): 23624}),
  # 2025 판 — 각주 '("EVs") 1' · 'in August 2025'
  ([], 'announced its preliminary domestic Vietnam deliveries of 10,922 electric vehicles ("EVs") 1 in August 2025.',
   {('deliveries', 'vietnam', '2025-08'): 10922}),
  ([_EV_TABLE, _REV_TABLE],
   'EV deliveries were 70,085 in the second quarter of 2026, representing an increase of 20% from first quarter of '
   '2026 and 96% increase from the second quarter of 2025.',
   {('deliveries', 'total', '2026-Q2'): 70085, ('R', 'revenue', '2026-Q2'): 30340852.0}),
  # 2026-01-30 4분기 판 — '4Q25' · 연간 문장
  ([], 'The Company delivered 86,557 electric vehicles ("EVs") globally in 4Q25, representing a 127% increase '
       'quarter-over-quarter and a 63% increase year-over-year. For the full year 2025, the Company delivered 196,919 EVs, '
       'representing a 102% increase year-over-year.',
   {('deliveries', 'total', '2025-Q4'): 86557, ('deliveries', 'total', '2025'): 196919}),
  # 2025-02-13 판 — 각주 '("EVs") 1 globally' · 'total deliveries of … globally for the full year 2024'
  ([], 'The Company delivered 53,139 electric vehicles ("EVs") 1 globally in 4Q24, representing a 143% increase. '
       'culminating in total deliveries of 97,399 EVs 1 globally for the full year 2024.',
   {('deliveries', 'total', '2024-Q4'): 53139, ('deliveries', 'total', '2024'): 97399}),
  # 2025-07-30 판 — 'first half'
  ([], 'The Company delivered 35,837 electric vehicles ("EVs") globally in 2Q25, maintaining a relatively steady delivery. '
       'Cumulatively, in the first half of 2025, the Company delivered 72,167 EVs to customers globally, representing a '
       '223% increase year-over-year.',
   {('deliveries', 'total', '2025-Q2'): 35837, ('deliveries', 'total', '2025-6M'): 72167}),
  # 2025-06-09 판 표 머리 '2025 Q1' · 2025-04-24 판 매출 표의 머리 앞 조각 행 ['2023 Q4'] · FY 표
  ([[['1Q2025', '4Q2024', '1Q2024'], ['EV Deliveries ( 1 )', '36,330', '53,139', '9,176']],
    [['2023 Q4'], ['2024 Q4', '2024 Q3', 'As adjusted (2)', 'QoQ', 'YoY'],
     ['Total Revenues', '16,496,376', '12,326,537', '9,715,565', '33.8', '%', '69.8', '%']],
    [['FY2025', 'FY2024', 'YoY'], ['Total Revenues', '90,427,611', '44,019,015', '105.4', '%']],
    [['FY2024', 'FY2023 As adjusted (2)', 'YoY'], ['Total Revenues', '44,019,015', '27,883,821', '57.9', '%']]], '',
   {('deliveries', 'total', '2025-Q1'): 36330, ('R', 'revenue', '2024-Q4'): 16496376.0,
    ('R', 'revenue', '2025'): 90427611.0, ('R', 'revenue', '2024'): 44019015.0}),
  # 실적 일정 — 3분기 · 4분기(=FY)
  ([], 'The Company also announced that it will release its 3Q26 financial results before the market opens on '
       'December 2, 2026 .', {('D', '2026-Q3'): '2026-12-02'}),
  ([], 'The Company also announced that it intends to release its 4Q25 and full year 2025 financial results before '
       'market opens on March 16, 2026 .', {('D', '2025-FY'): '2026-03-16'}),
]
# 🔴 이륜차·모델별·베트남 누계 — 정상 EV 문장(_Q3_2026) «앞»에 붙여 돌려, 결과가 정확히 EV 두 행인지 본다
# (행을 더하거나 값을 바꾸면 실패 — 빈 결과로 통과하는 무단언 시험이 아니다. 앞에 붙이는 까닭: 같은 칸이면 dedupe 가
#  먼저 온 행을 남기므로 뒤에 붙이면 이륜차 행이 잡혀도 EV 행에 가려 시험이 못 본다 — 돌연변이 시험 실측)
MUST_MISS = [
  'VinFast also announced it delivered 143,136 e-scooters and e-bikes in 1Q26, representing a 219% increase.',
  'VinFast also delivered 284,831 e-scooters and e-bikes globally during the third quarter of 2026, representing a '
  '137% increase year-over-year, of which 281,409 units were delivered in Vietnam.',
  'Cumulatively, in the first nine months of 2026, VinFast delivered 714,006 e-scooters and e-bikes globally, '
  'representing a 204% increase year-over-year.',
  'E-scooter and e-bike deliveries were 286,039 in the second quarter of 2026, representing a 100% increase from first '
  'quarter of 2026 and 311% increase from the second quarter of 2025.',
  # 모델별 대수는 회사 합계가 아니다
  'During the third quarter of 2026, the VF 3 and Limo Green were the best-selling models, with deliveries of 21,744 '
  'and 19,100 vehicles, respectively.',
  # 이륜차 연간·EV 베트남 연간·분기 누계는 전 세계 칸이 아니다(2026-01-26 · 2026-01-13 · 2026-04-10)
  'For the full year 2025, the Company delivered 406,498 e-scooters and e-bikes, representing a 473% increase.',
  'For the full year 2025, the Company delivered a preliminary total of 175,099 EVs 1 to customers in Vietnam.',
  'For the first quarter of 2026, the Company delivered a preliminary total of 53,684 EVs to customers in Vietnam.',
]
# 이륜차 표 행 — EV 표에 섞여 있어도 EV 행만(값 70,085 하나). 이륜차 행을 EV 행 앞에 둔 꼴도 본다(dedupe 가림 방지)
MUST_MISS_TABLES = [[_EV_TABLE, _REV_TABLE], [[_EV_TABLE[0], _EV_TABLE[2], _EV_TABLE[1]], _REV_TABLE]]
# 이륜차 베트남 연간 공시(2026-01-26) — 월 인도 문장 꼴이지만 'electric scooters' 라 알아보지도 않는다
MUST_NOT_RECOGNIZED = [
  'announced its preliminary domestic Vietnam deliveries of 406,453 electric scooters 1 ("e-scooters") for the full '
  'year 2025.',
  # 2024 판 근사값('more than')은 정확한 값이 아니다
  'VinFast Auto Ltd. ("VinFast") delivered more than 16,000 electric vehicles ("EVs") to customers in Vietnam during '
  'November.',
]
# 0행 · recognized 여야 하는 (이름, 표, 본문) — 서식은 맞는데 필수 행이 빠지면 failed 로 드러나는지
MUST_RECOGNIZED_EMPTY = [
  ('분기 인도 문장 꼴 변경', [], 'The Company delivered 82,580 electric vehicles ("EVs") globally during Q3 2026.'),
  ('베트남 월 문장 꼴 변경', [], 'preliminary domestic Vietnam deliveries of 23,624 electric vehicles ("EVs") '
                                 'throughout September 2026.'),
  ('실적 표에 매출 행 없음', [_EV_TABLE], ''),
  ('실적 표에 EV 인도 행 없음', [_REV_TABLE], ''),
]


def _flatten(r: ParseResult) -> dict:
  got = {(v.metric, v.region, v.period): v.value for v in r.volume}
  got.update({('R', x.metric, x.period): x.value for x in r.results})
  got.update({('D', x.period): x.event_date for x in r.dates})
  return got


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'VFS', 'edgar', 'current_report', '6-K', '', '', '', '2026-10-29')
  for tables, text, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for text in MUST_MISS:
    got = _flatten(parse(doc, Content(text=text + ' ' + _Q3_2026)))
    if got != _Q3_2026_WANT:
      errs.append(f'MUST_MISS 이륜차·모델·베트남 문장이 행을 바꿨다: {text[:50]} → {got}')
  for tables in MUST_MISS_TABLES:
    got = _flatten(parse(doc, Content(text='', tables=tables)))
    if sorted(v for k, v in got.items() if k[0] == 'deliveries') != [70085]:
      errs.append(f'MUST_MISS 이륜차 표 행: {got}')
  for text in MUST_NOT_RECOGNIZED:
    res = parse(doc, Content(text=text))
    if res.recognized or res.count():
      errs.append(f'MUST_NOT_RECOGNIZED 알아봤다: {text[:50]}')
  for name, tables, text in MUST_RECOGNIZED_EMPTY:
    res = parse(doc, Content(text=text, tables=tables))
    if res.count() or not res.recognized:
      errs.append(f'{name}: 행 {res.count()} · recognized={res.recognized} (기대 0행 · True)')
  # llm_wants — 본문 기준(실적 표의 매출 · 실적 일정 문장)
  if not llm_wants(doc, parse(doc, Content(text='', tables=[_EV_TABLE, _REV_TABLE]))):
    errs.append('llm_wants: 실적 표가 잡힌 문서를 LLM 에 안 넘긴다')
  if llm_wants(doc, parse(doc, Content(text=MUST_HIT[1][1]))):
    errs.append('llm_wants: 베트남 월 인도 6-K 를 LLM 에 넘긴다')
  # 일정 갈래 — 실적 표 없이 일정 문장만 있는 전망·인도 6-K 도 넘긴다(매출 행 0 · 일정 1)
  date_only = parse(doc, Content(text=MUST_HIT[9][1]))
  if date_only.results or not date_only.dates or not llm_wants(doc, date_only):
    errs.append('llm_wants: 실적 일정 문장만 있는 6-K 를 LLM 에 안 넘긴다')
  # 표 라벨 대소문자('EV deliveries'·'TOTAL REVENUES')가 바뀌어도 실적 표로 알아본다
  low = parse(doc, Content(text='', tables=[[_EV_TABLE[0], ['EV deliveries 1', *_EV_TABLE[1][1:]]],
                                   [_REV_TABLE[0], ['TOTAL REVENUES', *_REV_TABLE[2][1:]]]]))
  if _flatten(low) != {('deliveries', 'total', '2026-Q2'): 70085, ('R', 'revenue', '2026-Q2'): 30340852.0}:
    errs.append(f'표 라벨 대소문자 변형을 못 읽었다: {_flatten(low)}')
  if not all('EC Van' in d and '전기버스' in d for d in (DEF_GLOBAL, DEF_VN)):
    errs.append('정의 문구에 EC Van·전기버스 포함이 빠졌다(회사 각주)')
  return errs
