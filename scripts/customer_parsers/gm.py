"""GM — EDGAR 8-K 2.02 의 EX-99.1(실적 보도자료) 표에서 실적·도매 판매·가이던스를 뽑는다(+ 8-K 7.01 전망 수정).

출처·표본 = 참고/고객사/research/us_domestic.md(2026-11-09 실측) + 2024-10~2026-10 EDGAR 실물 25건 회귀(2026-11-10).

표 4종을 머리 행으로 알아본다(표 번호는 분기마다 바뀐다):
- 실적 요약: 머리 행 첫 칸 '($M) except per share amounts' · 둘째 칸 분기말 날짜
- 연결 손익: 'Three Months Ended <날짜>' 머리 + 'Combined' 칸의 Operating income (loss)
- 도매 판매: 행 라벨이 정확히 GMNA·GMI·Total 인 표(대수 천 대 · fleet 표는 'Total fleet sales' 라 빠진다)
- 가이던스: 머리 행에 'Updated 2026 guidance' 또는 '2027 Guidance'(4분기 판) 칸이 있는 표
  + 같은 연도의 전망 대조표('Year Ending December 31, <연도>')에서 장부상 4종(순이익·EPS-diluted·영업현금흐름·설비투자 · Task 9)
  · 전망 표가 없는 판(2025-07)은 발표 연도와 같은 대조표만으로 그 4종(필수 3지표는 안 읽는다)

함정(실측):
  - 4분기 판(2025-01·2026-01)은 실적 요약 머리에 괄호가 없다 — '$M except per share amounts'.
  - 흑자 분기 판은 순이익 라벨에 '(loss)' 가 없다 — 'Net income attributable to stockholders'.
  - 연결 손익 표의 부문 칸 수가 해마다 다르다(2025 까지 Cruise 칸 → Combined 가 다섯째 · 2026 부터 넷째) → 칸 번호를 머리에서 읽는다.
  - 4분기 판엔 분기 연결 손익 표가 없다(연간 'Years Ended' 만) → 4분기 장부상 영업이익은 회사 보도자료에 없다(빈칸이 정상).
  - 1분기 판 도매 표는 누계 칸이 없다(숫자 2개) → 분기 행만.
  - 2025-04-29(1분기) 판은 관세로 전망을 5월 1일 8-K 7.01 로 미뤘다 — 전망 표 없음이 정상.
  - 「알아봄」 은 서식 표식(실적 요약 머리 · 전망 표 머리)으로 — 머리는 있는데 필수 칸이 0행이면 failed 로 드러난다.
  - 도매 표·영업이익 행은 따로 표식이 없다 → 실적 행이 있는데 도매 3지역이 다 차지 않거나 1~3분기 영업이익이 없으면
    문서를 failed 로(_results_incomplete · 검토 1회차).
"""
import re
from dataclasses import replace

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
# 전망 표 머리를 알아봤는데 이 지표가 하나라도 빠지면 라벨이 바뀐 것 — 문서를 failed 로(최종 검토 P5 · 실적 쪽
# RESULT_REQUIRED 와 같은 방식). 실측: 2024-10~2026-10 전망 표 8편 모두 3지표가 다 있다(2026-11-10 DB)
GUIDANCE_REQUIRED = tuple(m for _, m, _ in GUIDANCE_ROWS)
# 장부상(reported) 연간 전망 4종(Task 9) — «있으면 뽑는다»(GUIDANCE_REQUIRED 밖 · 없어도 failed 아님).
# 실측(2024-10~2026-10 EX-99.1 8편 · 2026-11-11): 전망 대조표(머리 'Year Ending December 31, <연도>' — 실적 대조표는
# 'Years Ended')가 8편 모두에 있고 라벨은 아래 «|» 뒤 이름이다. 전망 표 안에도 앞 이름 행이 있는 판(2024-10·2025-01·2026-01·
# 2026-04)은 전망 표 행이 먼저다. 4분기 판은 새 해 EPS 대조표가 없어 전망 표 'EPS-diluted' 행뿐이고, 설비투자는
# 대조표('Less: Capital expenditures')에만 있다(4분기 판 본문 문장 'anticipated capital spending of …' 와 같은 값).
GUIDANCE_EXTRA_ROWS = (  # (라벨 정규식, metric, 단위) — 라벨 = 전망 표 이름 | 대조표 이름
  (r'Net income attributable to stockholders$', 'net_income_parent', 'billion'),
  (r'(?:Automotive operating cash flow|Net automotive cash provided by operating activities)$',
   'automotive_operating_cash_flow', 'billion'),
  (r'(?:EPS-diluted|Diluted earnings per common share)$', 'eps_diluted', 'per_share'),
  (r'(?:Less: )?Capital expenditures$', 'capex', 'billion'),
)
_RECON_HEAD = re.compile(r'^Year Ending\s+December 31, (20\d{2})$')
# 이 칸을 못 찾으면 실적 요약 라벨이 바뀐 것 — 문서를 failed 로 드러낸다(빠진 칸만 조용히 비지 않게)
RESULT_REQUIRED = ('revenue', 'ebit_adjusted')
# 4분기 판(2025-01·2026-01 실물)은 괄호 없이 '$M except per share amounts'
_RESULT_HEAD = re.compile(r'^\(?\$M\)? except per share')
_GUIDE_HEAD = re.compile(r'^(?:Updated |Initial )?(20\d{2}) [Gg]uidance$')
# 본문이 «지표를 특정해» 방향을 밝힌 문장만 그 지표 행의 stated 로(Task 15 Codex 대조 · 2026-07-21 실물
# 'The company is raising its full-year 2026 EBIT-adjusted guidance for the second time this year.').
# 제목의 'raises full-year 2026 guidance' 처럼 지표가 없는 문장은 전 지표에 퍼뜨리지 않는다(null 유지) ·
# 'updating … narrowing the range'(2026-10-20)는 방향 낱말이 아니라 stated 없음(숫자 비교가 정한다).
_STATED_SENT = re.compile(r'\b(rais|lower|reaffirm)(?:ing|es|ed|s)? its full[- ]year (20\d{2}) '
                          r'(EBIT-adjusted|adjusted automotive free cash flow|EPS-diluted-adjusted) guidance', re.I)
_STATED_WORD = {'rais': 'raised', 'lower': 'lowered', 'reaffirm': 'maintained'}
_STATED_METRIC = {'ebit-adjusted': 'ebit_adjusted', 'adjusted automotive free cash flow': 'adjusted_automotive_fcf',
                  'eps-diluted-adjusted': 'eps_adjusted'}


def wants(doc: Doc) -> bool:
  # 8-K 7.01(분기 중 전망 수정 · 2025-05-01 실측)도 같은 전망 표가 있으면 읽는다.
  # IR 은 미국 분기 Deliveries PDF 만(Task 8) — 덱·서한은 3단계 몫이라 내려받지 않는다(pending 그대로)
  return ((doc.source == 'edgar' and doc.doc_type in ('earnings_release', 'current_report'))
          or (doc.source == 'ir' and doc.form == 'us-deliveries'))


def fetch(session, doc: Doc) -> Content:
  """🔴 모듈 단위 훅 — GM 의 «모든» 문서가 여기로 온다. EDGAR 는 숫자 수집기의 기본 받기 그대로.
  IR(investor.gm.com)은 Akamai 가 requests 를 403 으로 막아 실제 Chrome(ir_lists._chrome_fetch)으로 받는다.
  실패는 lib 의 분류 예외(403 = HTTPError · Chrome 없음 = ChromeUnavailable(사유 「Chrome 없음」) · 시간 초과 = Timeout · 상한 초과 = lib 의 TooLarge)."""
  if doc.source != 'ir':
    from collect_customer_numbers import fetch_content   # 늦게 — 그 파일은 __main__ 으로 돈다(예외 클래스는 lib 것만)
    return fetch_content(session, doc)[0]
  from lib import ir_lists
  from lib.doc_text import html_to_text, pdf_text
  (status, body), = ir_lists._chrome_fetch([doc.url])
  b = ir_lists.chrome_body(status, body)
  if len(b) > ir_lists.MAX_IR_BYTES:   # 페이지 안 받기가 이미 끊지만 받는 쪽도 같은 상한으로 한 번 더
    raise ir_lists.TooLarge(len(b))
  if b[:5] == b'%PDF-':
    return Content(pdf_text(b), [], b)
  return Content(html_to_text(b.decode('utf-8', errors='replace')), [], b)


# 미국 분기 인도(IR Deliveries PDF) — 제목 + 총계 행만 읽는다(모델별 행은 차종 칸이 없어 읽지 않는다).
# 2026-11-11 실물 3편(Q4 2025·Q1 2026·Q3 2026) 모두 제목 「GM U.S. DELIVERIES FOR QUARTER n  YYYY」(공백 2칸) ·
# 총계 라벨 「GM Vehicle Total*」 · 숫자 = 올해 분기 · 전년 분기 · 증감% · 누계 올해 · 누계 전년 · 증감%.
_DELIV_HEAD = re.compile(r'GM U\.S\. DELIVERIES FOR QUARTER ([1-4])\s+(20\d{2})')
_DELIV_TOTAL = re.compile(r'GM Vehicle Total\*?\s+([\d,]+)\s+([\d,]+)')
DELIVERIES_DEF = ('GM 미국 인도(deliveries): 미국 고객 인도 대수 · 단종 모델 포함(원문 Deliveries 표의 GM Vehicle Total). '
                  '중국 등 해외 제외 — 도매(wholesale)와 다른 지표')


def parse_us_deliveries(text: str) -> tuple[list[VolumeRow], bool]:
  """Deliveries PDF 글 → (분기 총계 행, 서식을 알아봤나). 제목은 있는데 총계 행이 없으면 0행 + True(failed 로 드러난다)."""
  head = _DELIV_HEAD.search(text)
  if not head:
    return [], False
  total = _DELIV_TOTAL.search(text, head.end())
  if not total:
    return [], True
  period = f'{head.group(2)}-Q{head.group(1)}'
  return [VolumeRow('deliveries', 'us', 'quarter', period, int(total.group(1).replace(',', '')), DELIVERIES_DEF,
                    norm_text(total.group(0)))], True


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


def parse_guidance(tables, published_year: str) -> tuple[list[GuidanceRow], bool]:
  """전망 표 → (행, 서식을 알아봤나). 머리(올해 전망 칸)가 있는데 필수 지표(GUIDANCE_REQUIRED)가 하나라도 없으면
  칸 문구가 바뀐 것 — 0행 + True 로 돌려 문서를 failed 로 드러낸다.
  전망 표가 없으면 전망 대조표만으로 장부상 4종을 뽑는다(parse_recon_only)."""
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
      for rx, metric, unit, basis in ([(*x, 'adjusted') for x in GUIDANCE_ROWS]
                                      + [(*x, 'reported') for x in GUIDANCE_EXTRA_ROWS]):
        if re.match(rx, _label(row)):
          rng = parse_range(row[col + 1])
          if rng:
            out.append(GuidanceRow(metric, _label(row), f'FY{year}', rng[0], rng[1], None, unit, basis,
                                   row_text(row)))
    if not set(GUIDANCE_REQUIRED) <= {x.metric for x in out}:
      return [], True
    return out + parse_guidance_recon(tables, year, {x.metric for x in out}), True
  return parse_recon_only(tables, published_year)


def parse_recon_only(tables, published_year: str) -> tuple[list[GuidanceRow], bool]:
  """전망 표 없이 전망 대조표만 있는 판(2025-07 doc 212 — 본문은 'guidance is unchanged' 뿐) → 장부상 4종만.
  필수 3지표는 대조표에서 읽지 않는다(Task 9 범위 = 새 4지표). 연도는 대조표 머리이고, 근거는 발표 연도와 같은지다
  (1월 4분기 판의 새 해 전망도 발표 연도 — 같은 판의 지난해 최종 대조표는 발표 연도보다 앞이라 건너뛴다).
  - 대조표 없음 · 지난해 표뿐 · 표는 맞는데 라벨이 바뀜 → 0행 + False(새 4지표는 «있으면 뽑는다» — 실패 아님)
  - 대조표 연도가 발표 연도보다 뒤뿐 · 대조표 머리인데 연도를 못 읽음('Year Ending December 31, TBD' 꼴) → 연도를 확정
    못 함 → 0행 + True(문서를 failed 로 드러낸다 · 조용히 버리지 않게)"""
  heads = [norm_text(rows[0][0]) for rows in tables if rows and rows[0]]
  years = {m.group(1) for h in heads for m in [_RECON_HEAD.match(h)] if m}
  if published_year in years:
    out = parse_guidance_recon(tables, published_year, set())
    return out, bool(out)
  if any(y > published_year for y in years) or any(
      h.startswith('Year Ending') and not _RECON_HEAD.match(h) for h in heads):
    return [], True
  return [], False


def parse_guidance_recon(tables, year: str, have: set[str]) -> list[GuidanceRow]:
  """전망 대조표 중 전망 표와 같은 연도 표(4분기 판의 지난해 최종 대조표는 건너뛴다)에서 GUIDANCE_EXTRA_ROWS 중
  아직 없는(have 밖) 지표 — 값 = 라벨 다음 첫 칸('Updated(a) | Previous' 의 Updated · 4분기 판은 칸이 하나)."""
  out = []
  for rows in tables:
    m = _RECON_HEAD.match(norm_text(rows[0][0])) if rows and rows[0] else None
    if not m or m.group(1) != year:
      continue
    for row in rows[1:]:
      for rx, metric, unit in GUIDANCE_EXTRA_ROWS:
        rng = parse_range(row[1]) if len(row) > 1 and metric not in have and re.match(rx, _label(row)) else None
        if rng:
          # 'Less: ' 는 대조표의 빼기 표시라 이름에서 뗀다(quote 는 행 원문 그대로)
          out.append(GuidanceRow(metric, _label(row).removeprefix('Less: '), f'FY{year}', rng[0], rng[1], None, unit,
                                 'reported', row_text(row)))
          have.add(metric)
  return out


def apply_stated(rows: list[GuidanceRow], text: str) -> list[GuidanceRow]:
  """본문의 «지표 특정» 방향 문장(_STATED_SENT)을 같은 지표·연도 행의 stated 로. 없는 지표는 그대로(null)."""
  said = {}
  for m in _STATED_SENT.finditer(norm_text(text)):
    said[(_STATED_METRIC[m.group(3).lower()], f'FY{m.group(2)}')] = _STATED_WORD[m.group(1).lower()]
  return [replace(x, stated=said[(x.metric, x.period)]) if (x.metric, x.period) in said else x for x in rows]


def parse(doc: Doc, content: Content) -> ParseResult:
  r = ParseResult()
  if doc.source == 'ir':   # IR 은 Deliveries PDF 만 들어온다(wants)
    r.volume, r.recognized = parse_us_deliveries(content.text)
    return r
  r.results, results_ok = parse_results(content.tables)
  if r.results:
    r.results += parse_operating_income(content.tables, r.results[0].period)
  r.volume = parse_wholesale(content.tables)
  r.guidance, guidance_ok = parse_guidance(content.tables, doc.published_at[:4])
  r.guidance = apply_stated(r.guidance, content.text)
  # 알아봄 = 실적 요약 머리 또는 전망 표 머리(전망 표만 있는 7.01 도 대상). 머리는 있는데 0행이면 failed 로 드러난다
  r.recognized = results_ok or guidance_ok
  if (results_ok and not r.results) or (guidance_ok and not r.guidance) or (r.results and _results_incomplete(r)):
    # 한쪽이 서식은 알아봤는데 0행 — 다른 쪽 행이 있어도 문서를 failed 로(kr_dart 와 같은 규칙)
    r.volume, r.results, r.guidance = [], [], []
  return r


def _results_incomplete(r: ParseResult) -> bool:
  """실적 보도자료인데 늘 있던 것이 빠졌나 — 도매 3지역(분기) · 1~3분기 장부상 영업이익.
  실측(2024-10~2026-10 9편): 도매는 9편 모두, 영업이익은 1~3분기 7편 모두 있다(4분기 판은 연결 손익이 연간뿐).
  도매 표에는 서식 표식이 따로 없어 표가 통째로 사라지면 조용히 0행이 된다 → 여기서 failed 로 드러낸다."""
  regions = {v.region for v in r.volume if v.period_grain == 'quarter'}
  if regions != {'north_america', 'international', 'total'}:
    return True
  return not r.results[0].period.endswith('Q4') and not any(x.metric == 'operating_income' for x in r.results)


# ---------------------------------------------------------------- 자가 시험(2026-11-09 실물 EX-99.1 원문 행)
# 실적 표본은 도매 3지역·1~3분기 영업이익이 함께 있어야 통과한다(_results_incomplete) — 실물 표를 붙인다
_WS_2026Q3 = [['Three Months Ended', 'Nine Months Ended'],
              ['September 30, 2026', 'September 30, 2025', 'September 30, 2026', 'September 30, 2025'],
              ['GMNA', '870', '840', '2,511', '2,516'], ['GMI', '159', '137', '407', '346'],
              ['Total', '1,028', '977', '2,917', '2,862']]
_WS_2025Q3 = [['Three Months Ended', 'Nine Months Ended'],   # 2025-10-21 실물
              ['September 30, 2025', 'September 30, 2024', 'September 30, 2025', 'September 30, 2024'],
              ['GMNA', '840', '893', '2,516', '2,588'], ['GMI', '137', '140', '346', '383'],
              ['Total', '977', '1,033', '2,862', '2,971']]
_OP_2026Q1 = [['Three Months Ended March 31, 2026', 'Three Months Ended March 31, 2025'],   # 2026-04-28 실물
              ['Automotive', 'GM Financial', 'Reclassifications/Eliminations', 'Combined', 'Automotive', 'Cruise',
               'GM Financial', 'Reclassifications/Eliminations', 'Combined'],
              ['Operating income (loss)', '2,252', '675', '—', '2,926', '2,957', '(273)', '673', '(4)', '3,352']]
_SUMMARY_2026Q3 = [['($M) except per share amounts', 'September 30, 2026', 'September 30, 2025'],
                   ['Revenue', '$', '50,015', '$', '48,591'], ['EBIT-adjusted', '$', '4,106', '$', '3,376']]
_OP_2026Q3 = [['Three Months Ended September 30, 2026'],
              ['Automotive', 'GM Financial', 'Reclassifications/Eliminations', 'Combined'],
              ['Operating income (loss)', '2,938', '660', '—', '3,598']]
# 전망 표 + 전망 대조표 — 2026-10-20 실물(doc 196 · 3분기 판) 표 6·9·10·11. 대조표 머리 'Year Ending December 31, 2026'
# 다음 행 'Updated(a) | Previous' — 이번 값은 라벨 다음 첫 칸
GUIDE_2026Q3 = [['Updated 2026 guidance', 'Previous 2026 guidance'],
                 ['EBIT-adjusted', '$14.5 billion - $15.5 billion', '$14.0 billion - $16.0 billion'],
                 ['Adjusted automotive free cash flow', '$11.5 billion - $12.5 billion', '$9.5 billion - $11.5 billion'],
                 ['EPS-diluted-adjusted', '$12.75 - $13.75', '$12.00 - $14.00']]
RECON_2026Q3 = [
  [['Year Ending December 31, 2026'], ['Updated(a)', 'Previous'],
   ['Net income attributable to stockholders', '$ 8.9-9.5', '$ 8.4-9.8'], ['Income tax expense', '2.0-2.4', '2.2-2.8'],
   ['Automotive interest (income) expense, net', '(0.1)', '(0.1)'], ['Adjustments', '3.7', '3.5'],
   ['EBIT-adjusted', '$ 14.5-15.5', '$ 14.0-16.0']],
  [['Year Ending December 31, 2026'], ['Updated(a)', 'Previous'],
   ['Diluted earnings per common share', '$ 9.72-10.72', '$ 8.98-10.98'], ['Adjustments', '3.03', '3.02'],
   ['EPS-diluted-adjusted', '$ 12.75-13.75', '$ 12.00-14.00']],
  [['Year Ending December 31, 2026'], ['Updated(a)', 'Previous'],
   ['Net automotive cash provided by operating activities', '$ 17.3-20.3', '$ 15.4-19.4'],
   ['Less: Capital expenditures', '10.0-12.0', '10.0-12.0'], ['Adjustments', '4.2', '4.1'],
   ['Adjusted automotive free cash flow', '$ 11.5-12.5', '$ 9.5-11.5']]]
# 4분기 판 — 2026-01-27 실물(doc 206) 표 6·10~14. 전망 표 안에 순이익·영업현금흐름·EPS-diluted 행이 있고, 대조표는
# 지난해 최종(2025) 3장 + 새 해(2026) 2장이다(새 해 EPS 대조표 없음 · 머리에 'Updated | Previous' 행 없음 · 공백 2칸)
GUIDE_2026Q4 = [['Final 2025 Guidance', '2025 Results', '2026 Guidance'],
                ['Net income attributable to stockholders', '$7.7 billion - $8.3 billion', '$2.7 billion',
                 '$10.3 billion - $11.7 billion'],
                ['EBIT-adjusted', '$12.0 billion - $13.0 billion', '$12.7 billion', '$13.0 billion - $15.0 billion'],
                ['Automotive operating cash flow', '$19.2 billion - $21.2 billion', '$18.7 billion',
                 '$19.0 billion - $23.0 billion'],
                ['Adjusted automotive free cash flow', '$10.0 billion - $11.0 billion', '$10.6 billion',
                 '$9.0 billion - $11.0 billion'],
                ['EPS-diluted', '$8.30 - $9.05', '$3.27', '$11.00 - $13.00'],
                ['EPS-diluted-adjusted', '$9.75 - $10.50', '$10.60', '$11.00 - $13.00']]
RECON_2026Q4 = [
  [['Year Ending  December 31, 2025'], ['Net income attributable to stockholders', '$ 7.7-8.3'],
   ['Income tax expense', '1.8-2.2'], ['Automotive interest income, net', '(0.1)'], ['Adjustments(a)', '2.6'],
   ['EBIT-adjusted', '$ 12.0-13.0']],
  [['Year Ending  December 31, 2025'], ['Net automotive cash provided by operating activities', '$ 19.2-21.2'],
   ['Less: Capital expenditures', '10.0-11.0'], ['Adjustments(a)', '0.8'], ['Adjusted automotive free cash flow', '$ 10.0-11.0']],
  [['Year Ending  December 31, 2025'], ['Diluted earnings per common share', '$ 8.30-9.05'], ['Adjustments(a)', '1.45'],
   ['EPS-diluted-adjusted', '$ 9.75-10.50']],
  [['Year Ending  December 31, 2026'], ['Net income attributable to stockholders', '$ 10.3-11.7'],
   ['Income tax expense', '2.6-3.2'], ['Automotive interest expense, net', '0.1'], ['EBIT-adjusted(a)', '$ 13.0-15.0']],
  [['Year Ending  December 31, 2026'], ['Net automotive cash provided by operating activities', '$ 19.0-23.0'],
   ['Less: Capital expenditures', '10.0-12.0'], ['Adjusted automotive free cash flow(a)', '$ 9.0-11.0']]]
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
     ['Operating income (loss)', '—', '—', '—', '—']], _WS_2026Q3],
   {('R', 'operating_income', '2026-Q3'): 0.0}),
  # 전망 표만 있는 8-K 7.01(2025-05-01 실물 머리) — recognized 여야 not_target 으로 버려지지 않는다
  ([[['Updated 2025 Guidance', 'Previous 2025 Guidance'],
     ['EBIT-adjusted', '$10.0 billion - $12.5 billion', '$13.7 billion - $15.7 billion'],
     ['Adjusted automotive free cash flow', '$7.5 billion - $10.0 billion', '$11.0 billion - $13.0 billion'],
     ['EPS-diluted-adjusted', '$8.25 - $10.00', '$11.00 - $12.00']]],
   {('G', 'ebit_adjusted', 'FY2025'): (10.0, 12.5)}),
  # 4분기 판 머리(2026-01 실물): 'Final 2025 Guidance | 2025 Results | 2026 Guidance' — 셋째 칸이 새 해 전망
  ([[['Final 2025 Guidance', '2025 Results', '2026 Guidance'],
     ['EBIT-adjusted', '$12.0 billion - $13.0 billion', '$12.7 billion', '$13.0 billion - $15.0 billion'],
     ['Adjusted automotive free cash flow', '$10.0 billion - $11.0 billion', '$10.6 billion',
      '$9.0 billion - $11.0 billion'],
     ['EPS-diluted-adjusted', '$9.75 - $10.50', '$10.60', '$11.00 - $13.00']]],
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
     ['Operating income (loss)', '281', '—', '795', '—', '1,076', '3,424', '(417)', '678', '(33)', '3,651']],
    _WS_2025Q3],
   {('R', 'net_income_parent', '2025-Q3'): 1327.0, ('R', 'operating_income', '2025-Q3'): 1076.0,
    ('V', 'total', '2025-Q3'): 977000}),
  # 1분기 판(2026-04-28) 도매 표 — 누계 칸 없음
  ([[['($M) except per share amounts', 'March 31, 2026', 'March 31, 2025'],
     ['Revenue', '$', '43,624', '$', '44,020'], ['EBIT-adjusted', '$', '4,253', '$', '3,490']],
    [['Three Months Ended'], ['March 31, 2026', 'March 31, 2025'],
     ['GMNA', '793', '827'], ['GMI', '106', '85'], ['Total', '899', '912']], _OP_2026Q1],
   {('V', 'total', '2026-Q1'): 899000, ('V', 'north_america', '2026-Q1'): 793000,
    ('R', 'operating_income', '2026-Q1'): 2926.0}),
  # 전망 대조표의 장부상 연간 전망 4종(Task 9) — 3분기 판(doc 196): 전망 표는 3행뿐 · 대조표 'Updated' 칸
  ([GUIDE_2026Q3, *RECON_2026Q3],
   {('G', 'ebit_adjusted', 'FY2026'): (14.5, 15.5), ('G', 'net_income_parent', 'FY2026'): (8.9, 9.5),
    ('G', 'eps_diluted', 'FY2026'): (9.72, 10.72), ('G', 'automotive_operating_cash_flow', 'FY2026'): (17.3, 20.3),
    ('G', 'capex', 'FY2026'): (10.0, 12.0)}),
  # 4분기 판(doc 206): 순이익·영업현금흐름·EPS-diluted 는 전망 표 행 · 설비투자는 새 해 대조표 · 지난해 최종 대조표는 안 읽는다
  ([GUIDE_2026Q4, *RECON_2026Q4],
   {('G', 'ebit_adjusted', 'FY2026'): (13.0, 15.0), ('G', 'net_income_parent', 'FY2026'): (10.3, 11.7),
    ('G', 'eps_diluted', 'FY2026'): (11.0, 13.0), ('G', 'automotive_operating_cash_flow', 'FY2026'): (19.0, 23.0),
    ('G', 'capex', 'FY2026'): (10.0, 12.0), ('G', 'capex', 'FY2025'): None, ('G', 'net_income_parent', 'FY2025'): None}),
]
# 「알아봤는데 0행」 이어야 하는 표본 — 라벨이 바뀐 것이 not_target 으로 조용히 닫히지 않고 failed 로 드러나는지
MUST_RECOGNIZED_EMPTY = [
  ('실적 요약: 매출 라벨 변경', [[['($M) except per share amounts', 'September 30, 2026', 'September 30, 2025'],
                                  ['Total net sales and revenue', '$', '50,015', '$', '48,591'],
                                  ['EBIT-adjusted', '$', '4,106', '$', '3,376']]]),
  ('전망 표: 행 라벨 변경', [[['Updated 2026 guidance', 'Previous 2026 guidance'],
                              ['EBIT-adj.', '$14.5 billion - $15.5 billion', '$14.0 billion - $16.0 billion']]]),
  # 전망 표에서 필수 지표 하나만 라벨이 바뀜(최종 검토 P5) — 나머지 2행이 있어도 문서를 failed 로
  ('전망 표: 지표 하나 빠짐', [[['Updated 2026 guidance', 'Previous 2026 guidance'],
                               ['EBIT-adjusted', '$14.5 billion - $15.5 billion', '$14.0 billion - $16.0 billion'],
                               ['Adj. automotive FCF', '$11.5 billion - $12.5 billion', '$9.5 billion - $11.5 billion'],
                               ['EPS-diluted-adjusted', '$12.75 - $13.75', '$12.00 - $14.00']]]),
  # 도매 표가 통째로 사라짐(검토 1회차) — 실적·영업이익은 있어도 문서를 failed 로
  ('도매 표 없음', [_SUMMARY_2026Q3, _OP_2026Q3]),
  # 1~3분기 판인데 연결 손익의 영업이익 행이 사라짐(검토 1회차)
  ('3분기 영업이익 없음', [_SUMMARY_2026Q3, _WS_2026Q3]),
]
# 실적 요약의 'GMNA EBIT-adjusted' 행은 부문 값이다 — 회사 칸 'EBIT-adjusted' 와 함께 둬서
# ebit_adjusted 가 «정확히 1행 · 회사 값» 인지 parse_results 를 직접 불러 센다(라벨을 re.search 로 풀면 2행이 된다)
SEGMENT_SAMPLE = [['($M) except per share amounts', 'September 30, 2026', 'September 30, 2025'],
                  ['Revenue', '$', '50,015', '$', '48,591'],
                  ['GMNA EBIT-adjusted', '$', '3,592', '$', '2,506', '$', '1,087', '43.4', '%'],
                  ['EBIT-adjusted', '$', '4,106', '$', '3,376', '$', '730', '21.6', '%']]
# 본문 방향 문장 → stated (Task 15 Codex 대조). 표는 MUST_HIT[0] 의 2026 전망 표를 그대로 쓴다.
# (본문, {metric: 기대 stated}) — 지표 없는 제목 문장·'updating … narrowing' 은 전부 None 이어야 한다
STATED_SAMPLES = [
  # 2026-07-21 실물(제목 + 본문) — EBIT-adjusted 만 raised · FCF·EPS 는 null
  ('GM releases 2026 second-quarter results, raises full-year 2026 guidance and declares quarterly dividend '
   'DETROIT - ... and EBIT-adjusted of $3.9 billion. The company is raising its full-year 2026 EBIT-adjusted '
   'guidance for the second time this year.',
   {'ebit_adjusted': 'raised', 'adjusted_automotive_fcf': None, 'eps_adjusted': None}),
  # 제목만(지표 특정 없음) — 전 지표 null
  ('GM releases 2026 second-quarter results, raises full-year 2026 guidance and declares quarterly dividend',
   {'ebit_adjusted': None, 'adjusted_automotive_fcf': None, 'eps_adjusted': None}),
  # 2026-10-20 실물 — 'updating … narrowing the range' 는 방향 낱말이 아니다
  ('The company is updating its full-year 2026 EBIT-adjusted guidance, narrowing the range',
   {'ebit_adjusted': None, 'adjusted_automotive_fcf': None, 'eps_adjusted': None}),
]
MUST_MISS = [
  # 'Previous' 칸만 있는 표는 전망이 아니다
  ([[['Previous 2026 guidance'], ['EBIT-adjusted', '$14.0 billion - $16.0 billion']]], ('G', 'ebit_adjusted')),
  # fleet 표(합계 라벨이 'Total fleet sales')는 도매 판매가 아니다
  ([[['Three Months Ended', 'Nine Months Ended'], ['September 30, 2026', 'September 30, 2025'],
     ['GMNA', '160', '148', '551', '498'], ['GMI', '107', '113', '302', '277'],
     ['Total fleet sales', '267', '261', '853', '775']]], ('V', 'total')),
]


# IR Deliveries PDF — 2026-11-11 실물(Deliveries Q3 2026.pdf)의 pdf_text 결과에서 머리·총계 구간만 그대로(줄바꿈·공백 포함)
DELIVERIES_Q3_2026 = (
  'GM U.S. DELIVERIES FOR QUARTER 3  2026\n2026\n2025\n%Change \nVolume\n2026\n2025\n%Change \nVolume\nEnclave\n'
  '                    8,523               8,239 \n3.4\n           30,726            28,624 \n7.3\nEncore GX\n'
  'GM Vehicle Total*\n                 670,974            710,347 \n-5.5\n       2,012,299        2,150,298 \n-6.4\n'
  '77 selling days for QUARTER 3 this year and 77 selling days for the same QUARTER last year.\n'
  'Vehicle Total * Includes discontinued models.\n')
DELIVERIES_MUST_HIT = [(DELIVERIES_Q3_2026, ('us', '2026-Q3', 670974))]
# 제목은 알아봤는데 총계 행이 없음 — 모델별·브랜드 합계(Buick Total* 등)로 새지 않고 0행 + recognized
DELIVERIES_MUST_RECOGNIZED_EMPTY = [DELIVERIES_Q3_2026.replace('GM Vehicle Total*', 'Buick Total*')]


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
  ebit = [x.value for x in parse_results([SEGMENT_SAMPLE])[0] if x.metric == 'ebit_adjusted']
  if ebit != [4106.0]:
    errs.append(f'부문 EBIT-adjusted 섞임: ebit_adjusted {ebit} (기대 [4106.0])')
  for text, want in STATED_SAMPLES:
    got = {x.metric: x.stated for x in parse(doc, Content(text=text, tables=MUST_HIT[0][0])).guidance}
    if got != want:
      errs.append(f'stated: 기대 {want} · 실제 {got} ({text[:40]}…)')
  ir = Doc(0, 'test', 'GM', 'ir', 'sales_release', 'us-deliveries', '', '', '', '2026-10-01')
  for text, want in DELIVERIES_MUST_HIT:
    got = [(v.region, v.period, v.value) for v in parse(ir, Content(text=text)).volume]
    if got != [want]:
      errs.append(f'Deliveries MUST_HIT: 기대 {[want]} · 실제 {got}')
  for text in DELIVERIES_MUST_RECOGNIZED_EMPTY:
    res = parse(ir, Content(text=text))
    if res.count() or not res.recognized:
      errs.append(f'Deliveries 총계 없음: 행 {res.count()} · recognized={res.recognized} (기대 0행 · True)')
  return errs
