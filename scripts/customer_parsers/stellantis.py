"""스텔란티스 — EDGAR 6-K EX-99.1(실적 보도자료) + 실적 일정 6-K + IR 소급 분기 팩트시트(PDF).

출처·표본 = 2024-10~2026-11 EDGAR 6-K 실물 58건(정기보고 6-K 제외) 회귀 + 팩트시트 PDF(2026-11-10).

- 요약 표: 머리 첫 칸이 '€ million / 000's units'(2026 판) · '€ million / units million'(FY2025 판) · '(€ million)'
  (FY2024·H1 2025 판). 머리 둘째 칸 = 이번 기간:
    'Q3 2026'(분기 — 넷째 칸이 'YTD 2026' 이면 누계 출하도) · 'FY 2025'·'2024'(연간) · 'H1 2025'(반기 누계 6M)
  행 Net revenues · Net profit(/(loss)) · Adjusted operating income(/(loss)) · Consolidated shipments(천 대)
  ('I F R S'·'N O N - G A A P' 세로 머리 셀이 첫 칸에 붙는 행이 있어 떼고 본다)
  값은 «머리와 같은 칸 위치»로 읽는다(둘째 칸 = 이번 기간 · 다섯째 칸 = 이번 누계) — 숫자만 모아 세면
  1분기 판처럼 누계 칸이 없는 표에서 자리가 밀린다.
- 가이던스 상자: 같은 표 머리 행 마지막 칸 'FY 2026 FINANCIAL GUIDANCE Net revenues: … AOI margin % (2) : … ' —
  숫자가 아닌 전망이라 value_text 로(low·high 는 null). 'H2 2025 GUIDANCE'(반기)·'FY 2025 GUIDANCE'(2025-02 첫 발표 ·
  2025-04 유보는 옛 서식 보도자료)는 코드가 안 뽑는다 — LLM 보조 칸(계획서 「회사별 코드/AI 표」). 본문 표식(_LLM_MARK)이
  있고 코드 가이던스가 0행이면 llm_wants 가 참(예비 실적 6-K 'Preliminary 2026 Financial Guidance' 포함).
- 실적 일정 6-K: 'will release its Third Quarter 2026 Financial Results on Wednesday, October 28, 2026' ·
  'its Full Year 2025 Results will be released on Thursday, February 26, 2026' · 'its First Half 2025 Results …'(= Q2 발표)
  · 'its Third Quarter 2025 Shipments and Revenues will be released on …'
- 북미 출하(IR 사이트 표)는 기존 collect_stellantis_shipments_ir.py 가 맡는다 — 여기서 만들지 않는다.
- 소급 분기 팩트시트(IR PDF · doc_type='fact_sheet'): 2025 Q1·Q3 당일 보도자료엔 이익이 없고, 2026-02 연간 발표 때 낸
  「Financial Fact Sheet: Expanded Quarterly Reporting for 2025 …」에 분기별 IFRS 영업이익·순이익·AOI 가 있다(3쪽·4쪽).
  PDF 글은 셀이 한 줄씩 세로로 나온다 → 라벨 줄 뒤 숫자 줄들의 «끝 7개» = 머리 끝 7칸(Q1·Q2·H1·Q3·Q4·H2·FY).
  행마다 앞쪽 열 수가 다르다(매출 19칸 · 영업이익 15칸 — 2024 분기 열이 없다)라 앞에서 세면 틀린다.
  Q1+Q2=H1 · Q3+Q4=H2 · H1+H2=FY(±1, 반올림) 검산이 어긋난 지표는 버린다(조용히 틀린 칸보다 빈칸).

함정(실측):
  - 2024-10·2025-04·2025-10 판(분기 '출하·매출' 보도자료)은 머리 첫 칸이 'Q3 2025' 이고 매출이 '€ billion' 소수 1자리다
    → 이 서식은 대상 밖(not_target). 그 분기 매출·이익은 팩트시트가, 출하는 기존 stellantis_shipments 가 갖고 있다.
  - FY2025 판 머리는 'units million' 이라 적혀 있지만 출하 값은 천 대다(5,484 = 9M 3,964 + Q4 1,520 · H2 2,820 =
    Q3 1,300 + Q4 1,520 으로 검산). 그래서 출하는 머리 낱말과 무관하게 천 대로 읽는다.
  - 1분기·FY2025 판의 상자는 'AOI margin (2) :'('%' 없음) — 2·3분기 판은 'AOI margin % (2) :'.
  - 'Adjusted operating income margin' 은 비율 행 — AOI 금액 칸에 들어가면 안 된다(라벨 끝 고정).
  - 「알아봄」은 서식 표식(요약 표 머리 · 일정 공지 제목 'Stellantis to Announce …')으로 — 표식이 있는데 그 서식에
    늘 있는 행(매출·순이익·AOI · 머리에 'units' 가 있으면 연결 출하 · 공지면 일정)이 빠지면 문서를 비워 failed.
"""
import re

from customer_parsers.base import (Doc, Content, ParseResult, ResultRow, VolumeRow, GuidanceRow, EarningsDate,
                                   month_name_date, to_number)
from lib.doc_text import norm_text, row_text

TICKERS = ('STLA',)
SHIP_DEF = '스텔란티스 연결 출하(consolidated shipments): 공장에서 딜러·유통사로 넘긴 대수, 합작사 제외 · 천 대 단위 발표'
_MONTH = r'(January|February|March|April|May|June|July|August|September|October|November|December)'
_HEAD0 = re.compile(r'€ million(?: /.*)?|\(€ million\)')
_HEAD_PERIOD = (
  (re.compile(r'Q([1-4]) (\d{4})'), 'quarter'),
  (re.compile(r'(?:FY ?)?(\d{4})'), 'year'),
  (re.compile(r'H1 (\d{4})'), 'h1'),
)
_ROWS = (  # (라벨 정규식 — 각주 뗀 뒤 전체 일치, metric, basis)
  (re.compile(r'Net revenues'), 'revenue', 'reported'),
  (re.compile(r'Net profit(?:/\(loss\))?'), 'net_income', 'reported'),
  (re.compile(r'Adjusted operating income(?:/\(loss\))?'), 'aoi', 'adjusted'),
)
_REQUIRED = {'revenue', 'net_income', 'aoi'}
_NUM = re.compile(r'\(?-?[\d,]+(?:\.\d+)?\)?')
_VERTICAL = re.compile(r'[A-Z](?: [A-Z])+(?: - [A-Z](?: [A-Z])+)*')   # 'I F R S' · 'N O N - G A A P'
_BOX = re.compile(r'FY (20\d{2}) FINANCIAL GUIDANCE (.+)$')
_BOX_ITEMS = (
  (re.compile(r'Net revenues: (.+?)(?= AOI margin| Industrial free|$)'), 'revenue_growth', 'Net revenues', None),
  (re.compile(r'AOI margin(?: %)?(?: \(\d\))? : (.+?)(?= Industrial free|$)'), 'aoi_margin', 'AOI margin %', 'adjusted'),
  (re.compile(r'Industrial free cash flows(?: \(\d\))? : (.+?)(?= \(incl\.| Expect|$)'), 'industrial_fcf',
   'Industrial free cash flows', 'adjusted'),
)
_PERIOD_WORD = {'first quarter': 'Q1', 'second quarter': 'Q2', 'third quarter': 'Q3', 'first half': 'Q2',
                'full year': 'FY'}
_WHAT = r'(First Quarter|Second Quarter|Third Quarter|First Half|Full Year) (\d{4})'
_WHEN = r'\w+day, ' + _MONTH + r' (\d{1,2}), (\d{4})'
_DATES = (
  re.compile(r'will release its ' + _WHAT + r' (?:Financial )?Results on ' + _WHEN, re.I),
  re.compile(r'its ' + _WHAT + r' (?:Financial Results|Results|Shipments and Revenues) will be released on ' + _WHEN, re.I),
)
_DATE_MARK = re.compile(r'Stellantis to Announce .{0,80}? on ' + _MONTH)
# 서술형 가이던스 표식(LLM 칸) — 상자 머리 'FY 2025 GUIDANCE'·'H2 2025 FINANCIAL GUIDANCE'·'FY 2024 GUIDANCE'(대문자) ·
# 예비 실적 6-K 제목형 'Preliminary 2026 Financial Guidance'. 따옴표 안('references to "FY 2026 Financial Guidance"' —
# Safe Harbor 문단)과 소문자 'guidance'(보수 규정·확인 문장)는 표식이 아니다
_LLM_MARK = re.compile(r'\b(?:FY |H[12] )?20\d{2} (?:FINANCIAL )?GUIDANCE\b|(?<!")\b(?:FY )?20\d{2} Financial Guidance\b(?!")')


def wants(doc: Doc) -> bool:
  # 정기보고 6-K(STELLANTIS N.V. <기간> 반기·분기 보고서)는 다른 파서처럼 대상 밖(pending)
  return ((doc.source == 'edgar' and doc.form == '6-K' and doc.doc_type != 'periodic')
          or (doc.source == 'ir' and doc.doc_type == 'fact_sheet'))


def llm_wants(doc: Doc, result: ParseResult) -> bool:
  """서술형 가이던스가 있는데 코드가 가이던스를 못 뽑은 문서 — 옛 상자('FY 2025 GUIDANCE'·'H2 2025 GUIDANCE') 실적
  보도자료·옛 서식 분기 보도자료·예비 실적 6-K('Preliminary 2026 Financial Guidance'). 본문 표식은 parse 가
  result.llm_hint 로 남긴다. 2026 판처럼 상자(FY 2026 FINANCIAL GUIDANCE)를 코드가 다 읽은 문서는 넘기지 않는다."""
  return result.llm_hint and not result.guidance


def _cells(row):
  """'I F R S' 같은 세로 머리 셀을 떼어낸 행(그 뒤 칸이 머리 칸과 같은 자리가 된다)."""
  return row[1:] if len(row) > 2 and _VERTICAL.fullmatch(norm_text(row[0])) else row


def _num_at(row, i: int) -> float | None:
  if i >= len(row):
    return None
  c = norm_text(row[i])
  return to_number(c) if _NUM.fullmatch(c) else None


def _head_period(cell: str) -> tuple[str, str] | None:
  c = norm_text(cell)
  for rx, kind in _HEAD_PERIOD:
    m = rx.fullmatch(c)
    if m:
      if kind == 'quarter':
        return 'quarter', f'{m.group(2)}-Q{m.group(1)}'
      return ('year', m.group(1)) if kind == 'year' else ('ytd', f'{m.group(1)}-6M')
  return None


def parse_summary(tables) -> ParseResult:
  r = ParseResult()
  seen = False
  for rows in tables:
    head = rows[0] if rows else []
    if len(head) < 3 or not _HEAD0.fullmatch(norm_text(head[0])):
      continue
    seen = True
    hp = _head_period(head[1])
    if not hp:
      continue   # 'H2 2024'·'At September 30, 2026'·'YTD 2026' 같은 보조 표 — 다음 표를 본다
    grain, period = hp
    ytd = None
    if grain == 'quarter' and len(head) > 4:
      ym = re.fullmatch(r'YTD (\d{4})', norm_text(head[4]))
      q = int(period[-1])
      if ym and ym.group(1) == period[:4] and q > 1:
        ytd = ('year', period[:4]) if q == 4 else ('ytd', f'{period[:4]}-{q * 3}M')
    r.recognized = True
    for raw in rows[1:]:
      row = _cells(raw)
      lab = re.sub(r'(?:\s*\(\d\))+$', '', norm_text(row[0]))
      cur = _num_at(row, 1)
      if cur is None:
        continue
      for rx, metric, basis in _ROWS:
        if rx.fullmatch(lab):
          r.results.append(ResultRow(metric, lab, basis, grain, period, cur, 'million', 'EUR', row_text(row)))
      if lab == 'Consolidated shipments':
        r.volume.append(VolumeRow('shipments', 'total', grain, period, round(cur * 1000), SHIP_DEF, row_text(row)))
        y = _num_at(row, 4) if ytd else None
        if y is not None:
          r.volume.append(VolumeRow('shipments', 'total', ytd[0], ytd[1], round(y * 1000), SHIP_DEF, row_text(row)))
    box = _BOX.search(norm_text(head[-1]))
    if box:
      for rx, metric, label, basis in _BOX_ITEMS:
        bm = rx.search(box.group(2))
        if bm:
          r.guidance.append(GuidanceRow(metric, label, f'FY{box.group(1)}', None, None, bm.group(1).strip(), 'text',
                                        basis, bm.group(0)))
    # 이 서식에 늘 있는 행이 빠지면 꼴이 바뀐 것 — 문서를 비워 failed 로(조용한 0행·반쪽 적재 방지).
    # 머리에 YTD 칸이 있으면 누계 출하도 늘 있다 — None 이면 Change 칸이 쪼개져('(1)' '%') 자리가 밀린 것
    need_ship = 'units' in norm_text(head[0])
    ytd_missing = need_ship and ytd and not any((v.period_grain, v.period) == ytd for v in r.volume)
    if not _REQUIRED <= {x.metric for x in r.results} or (need_ship and not r.volume) or ytd_missing:
      return ParseResult(recognized=True)
    return r
  # 요약 표 머리(€ million)는 봤는데 이번 기간 칸을 하나도 못 알아봤다 = 기간 칸 꼴이 바뀌었다 → failed.
  # 실물 전수(2024-10~2026-11 · _HEAD0 표가 있는 6건)에서 보조 표만 있는 문서는 없었다(보조 표는 늘 본 표와 함께)
  return ParseResult(recognized=seen)


def parse_dates(text: str) -> tuple[list[EarningsDate], bool]:
  """(일정 행, 일정 공지 표식이 있나)."""
  t = norm_text(text)
  out = []
  for rx in _DATES:
    for m in rx.finditer(t):
      period = f'{m.group(2)}-{_PERIOD_WORD[m.group(1).lower()]}'
      out.append(EarningsDate(period, month_name_date(m.group(3), m.group(4), m.group(5)), m.group(0)))
  return out, _DATE_MARK.search(t) is not None


# ---------------------------------------------------------------- 소급 분기 팩트시트(PDF)
FACTSHEET_URL = ('https://www.stellantis.com/content/dam/stellantis-corporate/investors/events-and-presentations/'
                 'other-documents/Financial-Fact-Sheet-Expanded-Quarterly-Reporting-for-2025-and-Segment-'
                 'Reclassification-for-2025-and-2024.pdf')
_FS_TAIL = ('Q1', 'Q2', 'H1', 'Q3', 'Q4', 'H2', 'FY')
_FS_ROWS = (  # (라벨 정규식 — 각주 번호 '(1)(4)(5)' 허용 · 비율 행 'margin (%)' 은 안 걸린다, metric, 회사 이름, basis)
  (r'Net revenues \(EUR M\)', 'revenue', 'Net revenues', 'reported'),
  (r'Operating income/\(loss\) \(EUR M\)', 'operating_income', 'Operating income/(loss)', 'reported'),
  (r'Net profit/\(loss\) \(EUR M\)', 'net_income', 'Net profit/(loss)', 'reported'),
  (r'Adjusted operating income/\(loss\) \(EUR M\)', 'aoi', 'Adjusted operating income/(loss)', 'adjusted'),
)
_FS_NUM = re.compile(r'^-?[\d,]+$')
_FS_HEADCELL = re.compile(r"(?:Q[1-4]|H[12]|FY) '\d\d|as (?:reported|adjusted).*")


def _fs_year(lines: list[str]) -> int | None:
  """머리의 «마지막» 7칸 "Q1 '25 … FY '25" 의 연도. 앞 해 열도 같은 7칸 꼴이라(Q1 '24 … FY '24 뒤에 'as reported')
  바로 다음 줄이 머리 칸이 아닌 자리만 인정한다 — 첫 자리를 잡으면 2025 값이 2024 칸으로 들어간다(시제품 실측)."""
  for i in range(len(lines) - 7):
    m = re.fullmatch(r"Q1 '(\d\d)", lines[i])
    if (m and [lines[i + k] for k in range(7)] == [f"{t} '{m.group(1)}" for t in _FS_TAIL]
        and not _FS_HEADCELL.fullmatch(lines[i + 7])):
      return 2000 + int(m.group(1))
  return None


def factsheet_checks(v: dict) -> bool:
  """Q1+Q2=H1 · Q3+Q4=H2 · H1+H2=FY (백만 단위 반올림이라 ±1)."""
  return all(abs(a + b - c) <= 1 for a, b, c in ((v['Q1'], v['Q2'], v['H1']), (v['Q3'], v['Q4'], v['H2']),
                                                  (v['H1'], v['H2'], v['FY'])))


def parse_factsheet(text: str) -> ParseResult:
  r = ParseResult()
  lines = [norm_text(l) for l in text.split('\n')]
  year = _fs_year(lines)
  if year is None:
    return r  # 다른 팩트시트(연간만 등) — 대상 아님
  r.recognized = True
  for rx, metric, name, basis in _FS_ROWS:
    j = next((i for i, l in enumerate(lines) if re.fullmatch(rx + r'(?:\(\d\))*', l)), None)
    if j is None:
      continue
    k = j + 1
    while k < len(lines) and _FS_NUM.match(lines[k]):
      k += 1
    nums = [to_number(x) for x in lines[j + 1:k]]
    if len(nums) < 7:
      continue
    v = dict(zip(_FS_TAIL, nums[-7:]))
    if not factsheet_checks(v):
      continue
    quote = ' '.join(lines[j:k])
    for t in ('Q1', 'Q2', 'Q3', 'Q4'):
      r.results.append(ResultRow(metric, name, basis, 'quarter', f'{year}-{t}', v[t], 'million', 'EUR', quote))
    r.results.append(ResultRow(metric, name, basis, 'ytd', f'{year}-6M', v['H1'], 'million', 'EUR', quote))
    r.results.append(ResultRow(metric, name, basis, 'year', str(year), v['FY'], 'million', 'EUR', quote))
  return r


def parse(doc: Doc, content: Content) -> ParseResult:
  if doc.doc_type == 'fact_sheet':
    return parse_factsheet(content.text)
  r = parse_summary(content.tables)
  r.dates, announced = parse_dates(content.text)
  if announced and not r.dates:
    return ParseResult(recognized=True)   # 일정 공지 제목은 있는데 날짜 문장 꼴이 바뀌었다
  r.recognized = r.recognized or bool(r.dates)
  r.llm_hint = bool(_LLM_MARK.search(norm_text(content.text)))
  return r


# ---------------------------------------------------------------- 자가 시험(2024-10~2026-11 실물 원문)
Q3_HEAD = ["€ million / 000's units", 'Q3 2026', 'Q3 2025', 'Change', 'YTD 2026', 'YTD 2025', 'Change',
           "FY 2026 FINANCIAL GUIDANCE Net revenues: Mid-Single Digit % Increase AOI margin % (2) : Low-Single Digit % "
           "Industrial free cash flows (3) : Improved Y-o-Y (incl. ∼€1.6B in cash payments related to H2 '25 charges) "
           "Expect positive Industrial free cash flows (3) in 2027"]
_Q3_ROWS = [['I F R S', 'Net revenues', '37,611', '37,206', '+1%', '119,225', '111,467', '+7%'],
            ['Net profit/(loss)', '(453)', '(4,532)', '+90%', '217', '(6,788)', 'n.m.'],
            ['N O N - G A A P', 'Adjusted operating income/(loss) (1)', '256', '90', '+184%', '1,989', '630', '+216%'],
            ['Adjusted operating income margin (2)', '0.7%', '0.2%', '50', 'bps', '1.7%', '0.6%', '110', 'bps'],
            ['Consolidated shipments (6)', '1,286', '1,300', '(1)%', '4,244', '3,964', '+7%']]
MUST_HIT = [
  ([[Q3_HEAD, *_Q3_ROWS]], '',
   {('R', 'revenue', '2026-Q3'): 37611.0, ('R', 'net_income', '2026-Q3'): -453.0, ('R', 'aoi', '2026-Q3'): 256.0,
    ('V', 'shipments', '2026-Q3'): 1286000, ('V', 'shipments', '2026-9M'): 4244000,
    ('G', 'revenue_growth', 'FY2026'): 'Mid-Single Digit % Increase', ('G', 'aoi_margin', 'FY2026'): 'Low-Single Digit %',
    ('G', 'industrial_fcf', 'FY2026'): 'Improved Y-o-Y', ('N',): 5}),
  # 2026-04-30 1분기 판 — 누계 칸 없음(숫자 2개) · 상자 'AOI margin (2) :'('%' 없음)
  ([[["€ million / 000's units", 'Q1 2026', 'Q1 2025', 'Change',
      "FY 2026 FINANCIAL GUIDANCE Net revenues: Mid-Single Digit % Increase AOI margin (2) : Low-Single Digit % "
      "Industrial free cash flows (3) : Improved Y-o-Y (incl. ~€2B in cash payments related to H2 '25 charges)"],
     ['I F R S', 'Net revenues', '38,132', '35,813', '+6%'],
     ['Net profit/(loss)', '377', '(387)', 'n.m'],
     ['N O N - G A A P', 'Adjusted operating income/(loss) (1)', '960', '327', '+194%'],
     ['Consolidated shipments (6)', '1,361', '1,217', '+12%']]], '',
   {('R', 'revenue', '2026-Q1'): 38132.0, ('R', 'net_income', '2026-Q1'): 377.0, ('R', 'aoi', '2026-Q1'): 960.0,
    ('V', 'shipments', '2026-Q1'): 1361000, ('G', 'aoi_margin', 'FY2026'): 'Low-Single Digit %', ('N',): 4}),
  # 2026-02-26 FY2025 판 — 머리 'FY 2025 | FY 2024 | Change | H2 2025 …' · 'units million' 이지만 값은 천 대
  ([[['€ million / units million', 'FY 2025', 'FY 2024', 'Change', 'H2 2025', 'H2 2024', 'Change',
      'FY 2026 FINANCIAL GUIDANCE Net revenues: Mid-Single Digit % Increase AOI margin (3) : Low-Single Digit %'],
     ['I F R S', 'Net revenues', '153,508', '156,878', '(2)%', '79,247', '71,861', '+10%'],
     ['Net profit/(loss)', '(22,332)', '5,520', 'n.m.', '(20,076)', '(127)', 'n.m.'],
     ['N O N - G A A P', 'Adjusted operating income/(loss) (2)', '(842)', '8,648', '(110)%', '(1,382)', '185', 'n.m.'],
     ['Consolidated shipments (1)', '5,484', '5,415', '+1%', '2,820', '2,543', '+11%']]], '',
   {('R', 'revenue', '2025'): 153508.0, ('R', 'net_income', '2025'): -22332.0, ('R', 'aoi', '2025'): -842.0,
    ('V', 'shipments', '2025'): 5484000, ('N',): 4}),
  # 2025-02-26 FY2024 판 · 2025-07-29 H1 2025 판 — 머리 '(€ million)' · 라벨 'Net profit'·'Adjusted operating income'
  ([[['(€ million)', '2024', '2023', 'Change', 'FY 2025 GUIDANCE Net Revenue Growth: Positive'],
     ['I F R S', 'Net revenues', '156,878', '189,544', '(17)%'], ['Net profit', '5,520', '18,625', '(70)%'],
     ['N O N - G A A P', 'Adjusted operating income (1)', '8,648', '24,343', '(64)%']]], '',
   {('R', 'revenue', '2024'): 156878.0, ('R', 'net_income', '2024'): 5520.0, ('R', 'aoi', '2024'): 8648.0, ('N',): 3}),
  ([[['(€ million)', 'H1 2025', 'H1 2024', 'Change', 'H2 2025 GUIDANCE Net revenues: Increased vs. H1 2025'],
     ['I F R S', 'Net revenues', '74,261', '85,017', '(13)%'], ['Net profit/(loss)', '(2,256)', '5,647', '(140)%'],
     ['N O N - G A A P', 'Adjusted operating income (1)', '540', '8,463', '(94)%']]], '',
   {('R', 'revenue', '2025-6M'): 74261.0, ('R', 'aoi', '2025-6M'): 540.0, ('N',): 3}),
  # 실적 일정 6-K 세 꼴(2026 · 2025 연간 · 2025 반기 · 2025 출하·매출)
  ([], 'Stellantis N.V. announced that it will release its Third Quarter 2026 Financial Results on Wednesday, '
       'October 28, 2026.', {('D', '2026-Q3'): '2026-10-28'}),
  ([], 'Stellantis N.V. announced today that its Full Year 2025 Results will be released on Thursday, February 26, 2026.',
   {('D', '2025-FY'): '2026-02-26'}),
  ([], 'Stellantis N.V. announced today that its First Half 2025 Results will be released on Tuesday, July 29, 2025.',
   {('D', '2025-Q2'): '2025-07-29'}),
  ([], 'announced today that its Third Quarter 2025 Shipments and Revenues will be released on Thursday, October 30, 2025',
   {('D', '2025-Q3'): '2025-10-30'}),
]
MUST_MISS = [
  # 'Adjusted operating income margin' 은 비율 행 — AOI 금액 칸에 들어가면 안 된다(256 하나만)
  ([[Q3_HEAD, *_Q3_ROWS]], lambda got: [v for k, v in got.items() if k[:2] == ('R', 'aoi')] == [256.0],
   'AOI 칸이 256 하나가 아니다(비율 행 오염)'),
  # 2027 산업 FCF 기대 문장은 FY2026 전망 칸이 아니다 — FY2026 산업 FCF 는 'Improved Y-o-Y' 그대로.
  # '(incl. …)' 괄호가 없는 꼴(요약서 시제품 표본)도 본다 — 괄호가 있으면 그 앞에서 끊겨 ' Expect' 경계를 시험하지 못한다
  ([[Q3_HEAD, *_Q3_ROWS]], lambda got: not any(k[0] == 'G' and k[2] == 'FY2027' for k in got)
   and got.get(('G', 'industrial_fcf', 'FY2026')) == 'Improved Y-o-Y', 'FY2027 칸이 생겼거나 FY2026 산업 FCF 가 2027 문장을 먹었다'),
  ([[Q3_HEAD[:7] + ['FY 2026 FINANCIAL GUIDANCE Industrial free cash flows (3) : Improved Y-o-Y Expect positive '
                    'Industrial free cash flows (3) in 2027'], *_Q3_ROWS]],
   lambda got: got.get(('G', 'industrial_fcf', 'FY2026')) == 'Improved Y-o-Y'
   and not any(k[0] == 'G' and k[2] == 'FY2027' for k in got), "괄호 없는 상자에서 2027 문장을 먹었다"),
  # 1분기 판의 전년 칸(Q1 2025 = 35,813)을 이번 기간으로 읽지 않는다
  ([MUST_HIT[1][0][0]], lambda got: ('R', 'revenue', '2025-Q1') not in got and got.get(('R', 'revenue', '2026-Q1')) == 38132.0,
   '1분기 판에서 전년 칸을 읽었다'),
  # 'H2 2025 GUIDANCE'·'FY 2025 GUIDANCE'(FINANCIAL 없는 옛 상자)는 코드가 뽑지 않는다(LLM 보조 칸)
  ([MUST_HIT[3][0][0]], lambda got: not any(k[0] == 'G' for k in got) and got.get(('R', 'revenue', '2024')) == 156878.0,
   '옛 상자에서 가이던스를 뽑았다'),
]
# 0행 · recognized 여야 하는 (이름, 표, 본문)
MUST_RECOGNIZED_EMPTY = [
  ('요약 표에 AOI 행 없음', [[Q3_HEAD, *_Q3_ROWS[:2], _Q3_ROWS[4]]], ''),
  ('요약 표에 연결 출하 행 없음', [[Q3_HEAD, *_Q3_ROWS[:4]]], ''),
  ('일정 공지 문장 꼴 변경', [], 'Stellantis to Announce Third Quarter 2026 Financial Results on October 28 AMSTERDAM, '
                                 'October 15, 2026 - Stellantis N.V. will publish Q3 2026 results on October 28, 2026.'),
  # 머리는 € million 인데 기간 칸 꼴이 바뀌었다('Q3 2026' → '3Q 2026') — 조용히 not_target 이 되면 안 된다
  ('요약 표 기간 칸 꼴 변경', [[[Q3_HEAD[0], '3Q 2026', '3Q 2025', *Q3_HEAD[3:]], *_Q3_ROWS]], ''),
  # 머리에 YTD 칸이 있는데 Change 칸이 '(1)' '%' 로 쪼개져 누계 출하 자리가 밀렸다
  ('YTD 머리인데 누계 출하 없음', [[Q3_HEAD, *_Q3_ROWS[:4],
                                   ['Consolidated shipments (6)', '1,286', '1,300', '(1)', '%', '4,244', '3,964', '+7%']]], ''),
]
# llm_wants (이름, 표, 본문, 기대) — 본문 표식(서술형 가이던스)이 있고 코드가 가이던스를 못 뽑았을 때만 참
LLM_WANTS = [
  ('옛 상자 FY 2025 GUIDANCE(FY2024 판)', [MUST_HIT[3][0][0]], 'FY 2025 GUIDANCE Net Revenue Growth: Positive', True),
  ('옛 상자 H2 2025 GUIDANCE(H1 2025 판)', [MUST_HIT[4][0][0]], 'H2 2025 GUIDANCE Net revenues: Increased vs. H1 2025', True),
  ('예비 실적 6-K 제목형', [], 'Initiating Preliminary 2026 Financial Guidance. In spite of the challenging industry context', True),
  ('2026 상자를 코드가 다 읽음', [[Q3_HEAD, *_Q3_ROWS]], Q3_HEAD[-1], False),
  ('Safe Harbor 따옴표 안', [], 'This document, in particular references to "FY 2026 Financial Guidance", contains forward', False),
  ('보수 규정 소문자 guidance', [], 'In line with the guidance provided under the Dutch Corporate Governance Code', False),
]
# 대상 아님 — 옛 분기 '출하·매출' 서식(머리 첫 칸이 기간 · 매출 € billion)
MUST_NOT_RECOGNIZED = [
  [['Q3 2025', 'Q3 2024', 'Change', 'H2 2025 FINANCIAL GUIDANCE Net revenues: Increased vs. H1 2025'],
   ['Combined shipments (000 units)', '1,334', '1,174', '+14%'], ['Consolidated shipments (000 units)', '1,300', '1,148', '+13%'],
   ['Net revenues (€ billion)', '37.2', '33.0', '+13%']],
]


_FS_HEAD = ["FY '22", "H1 '23", "H2 '23", "FY '23", "Q1 '24", "Q2 '24", "H1 '24", "Q3 '24", "Q4 '24", "H2 '24", "FY '24",
            'as reported', "FY '24", 'as adjusted(1)', "Q1 '25", "Q2 '25", "H1 '25", "Q3 '25", "Q4 '25", "H2 '25", "FY '25"]
_FS_TEXT = '\n'.join(_FS_HEAD + [
  'Net revenues (EUR M)(1)', '179,592', '98,368', '91,176', '189,544', '41,697', '43,320', '85,017', '32,960', '38,901',
  '71,861', '156,878', '156,878', '35,813', '38,448', '74,261', '37,206', '42,041', '79,247', '153,508', 'North America',
  '85,475',
  'Operating income/(loss) (EUR M)', '20,276', '13,541', '8,835', '22,376', '6,639', '-2,952', '3,687', '3,687', '-316',
  '-2,394', '-2,710', '-2,455', '-21,089', '-23,544', '-26,254', 'Net financial expenses/(income) (EUR M)', '768',
  'Net profit/(loss) (EUR M)', '16,779', '10,918', '7,707', '18,625', '5,647', '-127', '5,520', '5,520', '-387', '-1,869',
  '-2,256', '-2,068', '-18,008', '-20,076', '-22,332', 'Diluted EPS (EUR)', '5.31',
  'Adjusted operating income/(loss) (EUR M)(1)(4)(5)', '24,017', '14,126', '10,217', '24,343', '8,463', '185', '8,648',
  '8,648', '327', '213', '540', '90', '-1,472', '-1,382', '-842', 'North America', '13,987',
  'Adjusted operating income/(loss) margin (%)(2)(5)', '13.4%', '14.4%', '11.2%', '12.8%', '10.0%', '0.3%', '5.5%', '5.5%',
  '0.9%', '0.6%', '0.7%', '0.2%', '-3.5%', '-1.7%', '-0.5%'])
FS_HIT = {('R', 'aoi', '2025-Q1'): 327.0, ('R', 'operating_income', '2025-Q1'): -316.0, ('R', 'net_income', '2025-Q1'): -387.0,
          ('R', 'aoi', '2025-Q2'): 213.0, ('R', 'operating_income', '2025-Q2'): -2394.0, ('R', 'net_income', '2025-Q2'): -1869.0,
          ('R', 'aoi', '2025-Q3'): 90.0, ('R', 'operating_income', '2025-Q3'): -2455.0, ('R', 'net_income', '2025-Q3'): -2068.0,
          ('R', 'aoi', '2025-6M'): 540.0, ('R', 'operating_income', '2025-6M'): -2710.0, ('R', 'net_income', '2025-6M'): -2256.0,
          ('R', 'revenue', '2025-Q1'): 35813.0, ('R', 'operating_income', '2025'): -26254.0}


def _flatten(r: ParseResult) -> dict:
  out = {('R', x.metric, x.period): x.value for x in r.results}
  out.update({('V', x.metric, x.period): x.value for x in r.volume})
  out.update({('G', x.metric, x.period): x.value_text for x in r.guidance})
  out.update({('D', x.period): x.event_date for x in r.dates})
  out[('N',)] = len(r.results) + len(r.volume)
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'STLA', 'edgar', 'earnings_release', '6-K', '', '', '', '2026-10-28')
  for tables, text, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for tables, ok, why in MUST_MISS:
    got = _flatten(parse(doc, Content(text='', tables=tables)))
    if not ok(got):
      errs.append(f'MUST_MISS {why}: {got}')
  for name, tables, text in MUST_RECOGNIZED_EMPTY:
    res = parse(doc, Content(text=text, tables=tables))
    if res.count() or not res.recognized:
      errs.append(f'{name}: 행 {res.count()} · recognized={res.recognized} (기대 0행 · True)')
  for name, tables, text, want in LLM_WANTS:
    if llm_wants(doc, parse(doc, Content(text=text, tables=tables))) != want:
      errs.append(f'llm_wants {name}: 기대 {want}')
  if _head_period('FY2025') != ('year', '2025'):
    errs.append("머리 'FY2025'(띄어쓰기 없음)를 연간으로 못 읽었다")
  for table in MUST_NOT_RECOGNIZED:
    res = parse(doc, Content(text='', tables=[table]))
    if res.recognized or res.count():
      errs.append(f'MUST_NOT_RECOGNIZED 옛 분기 서식을 알아봤다: {_flatten(res)}')
  fdoc = Doc(0, 'test', 'STLA', 'ir', 'fact_sheet', '', '', '', FACTSHEET_URL, '2026-02-26')
  got = _flatten(parse(fdoc, Content(text=_FS_TEXT)))
  for k, v in FS_HIT.items():
    if got.get(k) != v:
      errs.append(f'FS_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  if got[('N',)] != 24:
    errs.append(f'FS 행 수 {got[("N",)]} (기대 24 = 4지표 × Q1~Q4·상반기·연간)')
  # 검산: Q1+Q2 = H1(상반기 발표값 540 · −2,710 · −2,256)
  for m in ('aoi', 'operating_income', 'net_income'):
    if got.get(('R', m, '2025-Q1'), 0) + got.get(('R', m, '2025-Q2'), 0) != got.get(('R', m, '2025-6M')):
      errs.append(f'FS 검산 {m}: Q1+Q2 ≠ H1')
  # MUST_MISS: 비율 행(margin %)이 aoi 칸으로 들어가면 안 된다 · 검산이 어긋난 지표는 통째로 버린다
  if got.get(('R', 'aoi', '2025-Q4')) != -1472.0:
    errs.append('FS aoi Q4 가 비율 행에 오염됐다')
  bad = _flatten(parse(fdoc, Content(text=_FS_TEXT.replace('\n-2,394\n', '\n-2,400\n'))))  # 영업이익 Q2 만 6 틀리게
  if any(k[1:2] == ('operating_income',) for k in bad) or bad[('N',)] != 18:
    errs.append(f'FS 검산이 어긋난 영업이익 행만 버려지지 않았다(행 {bad[("N",)]} · 기대 18)')
  if parse(fdoc, Content(text='\n'.join(_FS_HEAD[:14]))).recognized:
    errs.append('FS 머리 끝 7칸이 없는 PDF 를 대상으로 알아봤다')
  return errs
