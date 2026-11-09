"""포르쉐 AG — IR 사이트 보도자료(EQS 공시 html · 일반 HTTP). 누계 실적 표 + 인도 보도자료 표 + 전망 문장.

출처·표본 = 2025-10~2026-10 EQS 실물 11건(실적 5 · 인도 5 · 전망 변경 뉴스 1 — 2026-11-10 캐시)으로 회귀.

- 실적 표: 머리 'Porsche AG Group | Q1 2026'·'H1 2026'·'Q1-Q3 2026'·'FY 2025' | 전년 | 증감. 값 '€25.28 billion' ·
  '€595 million'(1분기 영업이익 · 2025 9M 판 '€40 million') — 단위를 칸에서 읽는다. 인도 '178,532'.
  분기 값은 발표하지 않는다(1분기만 분기) → 누계로 담고 분기는 조회 계층이 뺄셈 · 표시는 「누계 차이로 계산」.
  EQS html 은 바깥 표(머리 덩어리 + 같은 행 복사)와 안쪽 표가 겹쳐 나온다 → 머리 행은 앞 두 행 안에서 찾는다.
- 인도 보도자료: 머리 'Porsche Deliveries | January – September', 둘째 행 '2025 | 2026 | Difference'(전년이 «앞» 칸)
  → 올해 칸 위치를 연도 행에서 찾는다. 행 'Worldwide'. 1~3월은 분기, 1~6·1~9월은 누계, 1~12월은 연간.
- 전망: 'The forecast is based on the following figures: Group sales revenue of between 35 and 36 billion euros. Group
  operating return on sales of 5.5 to 7.5 per cent. …'(9M) · 1분기·반기 판은 'Sales revenues of 35 to 36 billion euros.
  Operating return on sales of …'('Group' 없음). 연도는 그 앞 'forecast for the full year 2026' 에서 읽는다.
  전망 변경 뉴스: 'the Automotive Net Cash Flow Margin for full year 2026 is expected to increase to 5.5 to 7.5 per cent
  (previous forecast: 3 to 5 per cent)' — 이전 값은 뽑지 않는다(방향은 guidance_direction).
  3월 연간·2025 9M 판의 전망 문단은 서술형이라 코드가 안 뽑는다 → llm_hint(llm_wants · 계획서 「회사별 코드/AI 표」).
- 생산 대수: 미확인(발표 위치를 못 찾았다 — 계획서 미확인 목록).

doc_type 에 기대지 않는다(목록 분류가 본문 낱말로 가른다) — 판정은 표 머리·전망 머리로. 「알아봄」인데 그 서식에 늘 있는
행(실적 표: 매출·영업이익·인도 · 인도 표: Worldwide)이 빠지거나 기간 칸 꼴이 바뀌면 문서를 비워 failed.
"""
import re

from customer_parsers.base import Doc, Content, ParseResult, ResultRow, VolumeRow, GuidanceRow, to_number
from customer_parsers.common import uncovered_marks
from lib.doc_text import norm_text, row_text

TICKERS = ('P911.DE',)
# 보도자료에 인도 정의 각주가 없다(실물 11건 확인) — 발표 방식만 적는다(1분기 외에는 누계로만 발표)
DEF = '포르쉐 AG 그룹 고객 인도(대 단위 · 1분기 외에는 누계로만 발표)'
_GROUP = 'Porsche AG Group'
_HEAD = re.compile(r'(Q1|Q1-Q2|H1|Q1-Q3|9M|FY|Fiscal year) ?(20\d{2})')
_MONTHS = {'Q1': 3, 'Q1-Q2': 6, 'H1': 6, 'Q1-Q3': 9, '9M': 9, 'FY': 12, 'Fiscal year': 12}
_MONEY = re.compile(r'€ ?([\d.,]+) (billion|million)')
_RES_ROWS = {'Sales revenue': 'revenue', 'Operating profit': 'operating_income'}
_DELIV_HEAD = re.compile(r'Porsche Deliveries')
_DELIV_SPAN = re.compile(r'January - (March|June|September|December)')
_SPAN_MONTHS = {'March': 3, 'June': 6, 'September': 9, 'December': 12}

# 전망 — 'The forecast is based on the following figures:' 뒤 구간. 실물 3/3건(2026 1분기·반기·9M)에 5항목이 다 있었다
_ANCHOR = re.compile(r'The forecast is based on the following figures:', re.I)
_ANCHOR_YEAR = re.compile(r'forecast for (?:the )?full year (20\d{2})|forecast for the (20\d{2}) financial year', re.I)
_WIN = 600
_RNG = r'(?:between )?([\d.]+) (?:and|to) ([\d.]+)'
_G = (  # (정규식, metric, 회사 라벨, 단위, basis)
  (re.compile(r'(?:Group )?Sales revenues? of ' + _RNG + r' billion euros', re.I), 'revenue', 'Group sales revenue',
   'billion', 'reported'),
  (re.compile(r'(?:Group )?Operating return on sales of ' + _RNG + r' per cent', re.I), 'operating_margin',
   'Group operating return on sales', 'percent', 'reported'),
  (re.compile(r'Automotive net cash ?flow margin of ' + _RNG + r' per cent', re.I), 'automotive_ncf_margin',
   'Automotive net cashflow margin', 'percent', None),
  (re.compile(r'Automotive EBITDA margin of ' + _RNG + r' per cent', re.I), 'automotive_ebitda_margin',
   'Automotive EBITDA margin', 'percent', None),
  (re.compile(r'Automotive BEV share (?:of )?' + _RNG + r' per cent', re.I), 'bev_share', 'Automotive BEV share',
   'percent', None),
)
# 전망 변경 문장(뉴스 · ad-hoc) — '<항목> for full year 2026 is expected to increase to 5.5 to 7.5 per cent'
_CHANGE = re.compile(r'(Group sales revenue|Group operating return on sales|Automotive net cash ?flow margin|'
                     r'Automotive EBITDA margin|Automotive BEV share) for (?:the )?full year (20\d{2}) is expected to '
                     r'(?:increase|decrease|rise|fall|be|change) to ' + _RNG + r' (per cent|billion euros)', re.I)
# 전망 변경 표식(실물 2026-09-09 뉴스 문장꼴 'is expected to increase to' · '(previous forecast: …)') — 기준 문장이 없는
# 문서에서 이 표식 문장은 뽑은 행 quote 가 덮어야 한다
_CHANGE_MARK = re.compile(r'previous forecast|now expects|is expected to (?:increase|decrease|rise|fall)', re.I)
# 서술형 전망 표식(LLM 칸) — 3월 연간 'Forecast for 2026 …' · 2025 9M 'Forecast for 2025 takes into account …' ·
# 전망 변경 뉴스의 'previous forecast'
_LLM_MARK = re.compile(r'\bForecast for 20\d{2}\b|previous forecast', re.I)


def wants(doc: Doc) -> bool:
  return doc.source == 'ir' and doc.doc_type in ('earnings_release', 'sales_release', 'guidance')


def llm_wants(doc: Doc, result: ParseResult) -> bool:
  """서술형 전망(3월 연간·2025 9M)이나 문장꼴이 바뀐 전망 — 본문 표식은 parse 가 llm_hint 로 남긴다."""
  return result.llm_hint


BASE_CURRENCY = 'EUR'   # 보고 통화(LLM 행 통화 검사 기준)
LLM_HINT = ('Forecast·Outlook(전망) 문단의 연간 항목만 — 그룹 매출(revenue) · 그룹 영업이익률(operating_margin) · '
            'Automotive EBITDA margin · Automotive net cash flow margin · Automotive BEV share. '
            '괄호 안 이전 전망(previous forecast: …)과 중장기 목표 중 연도가 없는 것은 뽑지 마세요.')


def _period(word: str, year: str) -> tuple[str, str]:
  months = _MONTHS[word]
  if months == 3:
    return 'quarter', f'{year}-Q1'
  return ('year', year) if months == 12 else ('ytd', f'{year}-{months}M')


def parse_results(tables) -> ParseResult | None:
  """None = 실적 표 머리('Porsche AG Group')는 있는데 기간 칸·늘 있는 행이 어긋났다."""
  for rows in tables:
    head = next((x for x in rows[:2] if norm_text(x[0]) == _GROUP), None)
    if head is None:
      continue
    m = _HEAD.fullmatch(norm_text(head[1])) if len(head) >= 3 else None
    if not m:
      return None
    grain, period = _period(m.group(1), m.group(2))
    r = ParseResult(recognized=True)
    for row in rows[rows.index(head) + 1:]:
      lab = norm_text(row[0])
      cell = norm_text(row[1]) if len(row) > 1 else ''
      if lab in _RES_ROWS:
        b = _MONEY.fullmatch(cell)
        if not b:
          return None
        r.results.append(ResultRow(_RES_ROWS[lab], lab, 'reported', grain, period, to_number(b.group(1)), b.group(2),
                                   'EUR', row_text(row)))
      elif lab == 'Deliveries to customers':
        v = to_number(cell)
        if v is None:
          return None
        r.volume.append(VolumeRow('deliveries', 'total', grain, period, round(v), DEF, row_text(row)))
    if {x.metric for x in r.results} != set(_RES_ROWS.values()) or not r.volume:
      return None
    return r
  return ParseResult()


def parse_deliveries(tables) -> ParseResult | None:
  """None = 인도 표 머리는 있는데 기간·연도 칸·Worldwide 행이 어긋났다."""
  for rows in tables:
    i = next((k for k, x in enumerate(rows[:2]) if _DELIV_HEAD.fullmatch(norm_text(x[0]))), None)
    if i is None:
      continue
    head = rows[i]
    sm = _DELIV_SPAN.fullmatch(norm_text(head[1])) if len(head) > 1 else None
    years = [norm_text(c) for c in rows[i + 1]] if len(rows) > i + 1 else []
    ys = [k for k, c in enumerate(years) if re.fullmatch(r'20\d{2}', c)]
    if not sm or len(ys) != 2:
      return None
    col = max(ys, key=lambda k: years[k])   # 올해 칸(전년이 앞에 온다)
    year = years[col]
    world = next((x for x in rows[i + 2:] if norm_text(x[0]) == 'Worldwide'), None)
    # Worldwide 행 = 라벨 + 연도 행 칸 수(칸이 빠지면 올해 칸 자리가 밀린다) · 인도는 양수
    v = to_number(world[col + 1]) if world and len(world) == len(years) + 1 else None
    if v is None or v <= 0:
      return None
    months = _SPAN_MONTHS[sm.group(1)]
    grain, period = _period({3: 'Q1', 6: 'H1', 9: 'Q1-Q3', 12: 'FY'}[months], year)
    return ParseResult(volume=[VolumeRow('deliveries', 'total', grain, period, round(v), DEF, row_text(world))],
                       recognized=True)
  return ParseResult()


def parse_guidance(text: str) -> tuple[list[GuidanceRow], bool]:
  """(전망 행, llm_hint)."""
  out = []
  am = _ANCHOR.search(text)
  if am:
    ym = None
    for ym in _ANCHOR_YEAR.finditer(text[:am.start()]):
      pass   # 앞쪽 마지막 'forecast for the full year 2026'
    year = (ym.group(1) or ym.group(2)) if ym else None
    if year is None:
      return [], True   # 머리는 있는데 연도를 못 읽었다 — 지어내지 않고 LLM 으로
    body = text[am.end():am.end() + _WIN]
    for rx, metric, label, unit, basis in _G:
      m = rx.search(body)
      if m:
        out.append(GuidanceRow(metric, label, f'FY{year}', float(m.group(1)), float(m.group(2)), None, unit, basis,
                               m.group(0)))
    return out, len(out) < len(_G)
  label_metric = {lab.lower(): (metric, lab, unit, basis) for _, metric, lab, unit, basis in _G}
  label_metric['automotive net cash flow margin'] = label_metric['automotive net cashflow margin']
  for m in _CHANGE.finditer(text):
    metric, lab, unit, basis = label_metric[m.group(1).lower()]
    if metric not in {g.metric for g in out}:
      out.append(GuidanceRow(metric, lab, f'FY{m.group(2)}', float(m.group(3)), float(m.group(4)), None, unit, basis,
                             m.group(0)))
  # 변경 표식 문장 중 뽑은 행이 덮지 않은 것 = 그 항목만 문장꼴이 바뀌었다 → 코드 행은 두고 LLM 으로
  missed = uncovered_marks(text, _CHANGE_MARK, [g.quote for g in out])
  return out, bool(missed) or (not out and _LLM_MARK.search(text) is not None)


def parse(doc: Doc, content: Content) -> ParseResult:
  text = norm_text(content.text)
  r, dv = parse_results(content.tables), parse_deliveries(content.tables)
  if r is None or dv is None:
    return ParseResult(recognized=True)   # 서식 표식은 있는데 늘 있는 행·칸이 빠졌다 → failed
  r.extend(dv)
  r.guidance, r.llm_hint = parse_guidance(text)
  # 문구 미스 = 코드 표식(전망 머리 'The forecast is based on…')이 있는데 항목·연도를 다 못 읽었거나, 코드가 일부 항목은
  # 읽었는데 변경 표식 문장이 남았다. 머리 없는 서술형 연간 판(3월 연간·2025 9M)은 원래 LLM 몫이라 문구 미스가 아니다
  r.code_miss = r.llm_hint and (_ANCHOR.search(text) is not None or bool(r.guidance))
  # 실적 표는 있는데 전망 문단을 코드가 하나도 못 읽었다(서술형 연간 판 등) → LLM
  r.llm_hint = r.llm_hint or (bool(r.results) and not r.guidance)
  r.recognized = r.recognized or bool(r.guidance)
  return r


# ---------------------------------------------------------------- 자가 시험(2025-10~2026-10 실물 원문)
RES_9M = [['Porsche AG Group', 'Q1-Q3 2026', 'Q1-Q3 2025'], ['Sales revenue', '€25.28 billion', '€26.86 billion'],
          ['Operating profit', '€1.74 billion', '€0.04 billion'], ['Operating return on sales', '6.9%', '0.2%'],
          ['Deliveries to customers', '178,532', '212,509']]
# EQS 바깥 표 — 첫 행이 머리 덩어리, 둘째 행이 머리(실물 그대로 겹쳐 나온다)
RES_Q1_OUTER = [['Dr. Ing. h.c. F. Porsche AG / Key word(s): Quarterly / Interim Statement Porsche AG resolutely pushes '
                 'ahead with strategic realignment'],
                ['Porsche AG Group', 'Q1 2026', 'Q1 2025', 'Alteration'],
                ['Sales revenue', '€8.40 billion', '€8.86 billion', '-5.2%'],
                ['Operating profit', '€595 million', '€762 million', '-21.9%'],
                ['Operating return on sales', '7.1%', '8.6%'],
                ['Deliveries to customers', '60,991', '71,470', '-14.7%']]
G_9M = ('Porsche AG confirms its forecast for the full year 2026. Taking into account the cash inflow from the sale of the '
        'stakes in Bugatti Rimac and the Rimac Group, and the further funding of pension obligations amounting to 250 '
        'million euros, anAutomotive net cashflow margin of 5.5 to 7.5 per cent is expected. The forecast is based on the '
        'following figures: Group sales revenue of between 35 and 36 billion euros. Group operating return on sales of '
        '5.5 to 7.5 per cent. Automotive net cashflow margin of 5.5 to 7.5 per cent. Automotive EBITDA margin of 15 to 17 '
        'per cent. Automotive BEV share between 24 and 26 per cent. Porsche AG Group Q1-Q3 2026 Q1-Q3 2025 Sales revenue '
        '€25.28 billion €26.86 billion Operating profit €1.74 billion €0.04 billion Operating return on sales 6.9% 0.2%')
# 1분기 판 — 'Group' 없는 'Sales revenues of' · 'Operating return on sales of' · '… 15 to 17 per cent and Automotive BEV'
G_Q1 = ('Despite a continuing challenging economic environment and geopolitical uncertainties, Porsche AG confirms its '
        'forecast for the full year 2026. This forecast does not include the possible effects of an ongoing conflict in '
        'the Middle East, as it is currently not possible to make a reliable assessment. The forecast is based on the '
        'following figures: Sales revenues of 35 to 36 billion euros. Operating return on sales of 5.5 to 7.5 per cent. '
        'Automotive net cashflow margin of 3 to 5 per cent. Automotive EBITDA margin of 15 to 17 per cent and Automotive '
        'BEV share between 24 and 26 per cent. Porsche AG Group Q1 2026 Q1 2025 Alteration Sales revenue €8.40 billion')
G_CHANGE = ('The Automotive Net Cash Flow Margin forecast published in the Half-Year Financial Report did not include any '
            'effects from divestments. Taking into account the aforementioned cash inflow and the further funding of '
            'pension obligations, the Automotive Net Cash Flow Margin for full year 2026 is expected to increase to 5.5 to '
            '7.5 per cent (previous forecast: 3 to 5 per cent). 09.09.2026 CET/CEST Dissemination of a Corporate News')
# 3월 연간 판 — 서술형(코드 대상 아님 → LLM)
G_FY = ('Forecast for 2026 Porsche AG is again anticipating very challenging market conditions for the 2026 financial '
        'year. Based on these assumptions and additional one-off effects, Porsche expects a higher Group operating return '
        'on sales in the range of 5.5 to 7.5 per cent for the 2026 financial year. This forecast includes assumed sales '
        'revenue in the range of around 35 to 36 billion euros. Porsche also expects a higher Automotive net cash flow '
        'margin, ranging between 3 and 5 per cent.')
RES_FY = [['Porsche AG Group', 'FY 2025', 'FY 2024', 'Change'], ['Sales revenue', '€36.27 billion', '€40.08 billion', '-9.5%'],
          ['Operating profit', '€0.41 billion', '€5.64 billion', '-92.7%'], ['Operating return on sales', '1.1%', '14.1%'],
          ['Deliveries to customers', '279,449', '310,718', '-10.1%']]
DELIV_9M = [['Porsche Deliveries', 'January – September'], ['2025', '2026', 'Difference'],
            ['Worldwide', '212,509', '178,532', '-16%'], ['Germany', '22,492', '20,954', '-7%']]

MUST_HIT = [  # (표, 본문, 기대 {키: 값} · ('N',) = 값 행 수 · ('H',) = llm_hint)
  ([RES_9M], G_9M,
   {('R', 'revenue', '2026-9M'): (25.28, 'billion'), ('R', 'operating_income', '2026-9M'): (1.74, 'billion'),
    ('V', 'deliveries', '2026-9M'): 178532, ('G', 'revenue', 'FY2026'): (35.0, 36.0),
    ('G', 'operating_margin', 'FY2026'): (5.5, 7.5), ('G', 'automotive_ncf_margin', 'FY2026'): (5.5, 7.5),
    ('G', 'automotive_ebitda_margin', 'FY2026'): (15.0, 17.0), ('G', 'bev_share', 'FY2026'): (24.0, 26.0),
    ('N',): 8, ('H',): False}),
  ([RES_Q1_OUTER], G_Q1,
   {('R', 'revenue', '2026-Q1'): (8.4, 'billion'), ('R', 'operating_income', '2026-Q1'): (595.0, 'million'),
    ('V', 'deliveries', '2026-Q1'): 60991, ('G', 'revenue', 'FY2026'): (35.0, 36.0),
    ('G', 'automotive_ncf_margin', 'FY2026'): (3.0, 5.0), ('G', 'bev_share', 'FY2026'): (24.0, 26.0),
    ('N',): 8, ('H',): False}),
  ([[['Porsche AG Group', 'H1 2026', 'H1 2025', 'Alteration'], ['Sales revenue', '€17.23 billion', '€18.16 billion', '-5.1%'],
     ['Operating profit', '€1.35 billion', '€1.01 billion', '+33.9%'], ['Deliveries to customers', '122,306', '146,391']]],
   '', {('R', 'revenue', '2026-6M'): (17.23, 'billion'), ('V', 'deliveries', '2026-6M'): 122306, ('N',): 3,
        ('H',): True}),   # 실적 표는 있는데 전망을 하나도 못 읽었다 → LLM
  # 3월 연간 판 — 실적·인도는 코드, 서술형 전망은 LLM
  ([RES_FY], G_FY, {('R', 'revenue', '2025'): (36.27, 'billion'), ('V', 'deliveries', '2025'): 279449, ('N',): 3,
                    ('H',): True}),
  # 2025 9M 판 — '€40 million'
  ([[['Porsche AG Group', 'Q1-Q3 2025', 'Q1-Q3 2024', 'Change'], ['Sales revenue', '€26.86 billion', '€28.56 billion'],
     ['Operating profit', '€40 million', '€4,035 million', '-99.0%'], ['Deliveries to customers', '212,509', '226,026']]],
   '', {('R', 'operating_income', '2025-9M'): (40.0, 'million'), ('N',): 3}),
  # 전망 변경 뉴스(2026-09-09)
  ([], G_CHANGE, {('G', 'automotive_ncf_margin', 'FY2026'): (5.5, 7.5), ('N',): 1, ('H',): False}),
  # 인도 보도자료 — 전년 칸이 앞 · 1~3월은 분기 · 1~12월은 연간
  ([DELIV_9M], '', {('V', 'deliveries', '2026-9M'): 178532, ('N',): 1}),
  ([[['Porsche Deliveries', 'January – March'], ['2025', '2026', 'Difference'], ['Worldwide', '71,470', '60,991', '-15%']]],
   '', {('V', 'deliveries', '2026-Q1'): 60991, ('N',): 1}),
  ([[['Porsche Deliveries', 'January – December'], ['2024', '2025', 'Difference'],
     ['Worldwide', '310,718', '279,449', '-10%']]], '', {('V', 'deliveries', '2025'): 279449, ('N',): 1}),
]
MUST_MISS = [  # (표, 본문, 판정(got) → 참, 사유)
  # 'Operating return on sales 6.9%' 표 행 · 'operating return on sales of 6.9 per cent' 실적 문장은 전망이 아니다
  ([RES_9M], 'Porsche achieved sales revenue of 25.28 billion euros and operating profit of 1.74 billion euros, with an '
             'operating return on sales of 6.9 per cent.',
   lambda g: not any(k[0] == 'G' for k in g) and g.get(('R', 'revenue', '2026-9M')) == (25.28, 'billion'),
   '실적 비율을 전망으로 읽었다'),
  # 기준 문장 앞의 'anAutomotive net cashflow margin of 5.5 to 7.5 per cent is expected' 가 아니라 기준 문장 뒤 값 — 1분기 판은 3~5
  ([RES_Q1_OUTER], 'anAutomotive net cashflow margin of 9 to 10 per cent is expected. ' + G_Q1,
   lambda g: g.get(('G', 'automotive_ncf_margin', 'FY2026')) == (3.0, 5.0), '기준 문장 앞 값을 읽었다'),
  # 기준 문장 «뒤» 구간 안의 단일값 실적 비율('Operating return on sales of 6.9 per cent')은 전망이 아니다 — 범위 값만
  ([RES_9M], G_9M.replace('following figures: ', 'following figures: Operating return on sales of 6.9 per cent in the '
                                                 'first nine months. '),
   lambda g: g.get(('G', 'operating_margin', 'FY2026')) == (5.5, 7.5) and sum(k[0] == 'G' for k in g) == 5,
   '기준 문장 뒤 단일값 실적 비율을 전망으로 읽었다'),
  # 전망 변경 뉴스의 '(previous forecast: 3 to 5 per cent)' 는 이전 값
  ([], G_CHANGE, lambda g: [v for k, v in g.items() if k[0] == 'G'] == [(5.5, 7.5)], '이전 전망을 읽었다'),
  # 인도 보도자료의 전년 칸(212,509)을 올해로 읽지 않는다
  ([DELIV_9M], '', lambda g: g.get(('V', 'deliveries', '2026-9M')) == 178532 and ('V', 'deliveries', '2025-9M') not in g,
   '인도 표 전년 칸을 읽었다'),
]
MUST_RECOGNIZED_EMPTY = [
  ('실적 표 기간 칸 꼴 변경(9M/2026)', [[['Porsche AG Group', '9M/2026', '9M/2025'], *RES_9M[1:]]], G_9M),
  ('실적 표에 영업이익 행 없음', [[r for r in RES_9M if r[0] != 'Operating profit']], G_9M),
  ('실적 표 금액 칸 꼴 변경(EUR 25.28 bn)', [[RES_9M[0], ['Sales revenue', 'EUR 25.28 bn', 'EUR 26.86 bn'], *RES_9M[2:]]], ''),
  ('인도 표에 Worldwide 행 없음', [[DELIV_9M[0], DELIV_9M[1], DELIV_9M[3]]], ''),
  ('인도 표 Worldwide 칸 하나 빠짐', [[DELIV_9M[0], DELIV_9M[1], ['Worldwide', '178,532', '-16%']]], ''),
  # 각주 칸이 끼어 한 칸씩 밀림 — 칸 수를 안 보면 올해 자리에 전년 값(212,509)이 온다
  ('인도 표 Worldwide 칸 하나 늘어 밀림', [[DELIV_9M[0], DELIV_9M[1], ['Worldwide', '1)', '212,509', '178,532', '-16%']]], ''),
  ('인도 표 Worldwide 음수', [[DELIV_9M[0], DELIV_9M[1], ['Worldwide', '212,509', '(178,532)', '-16%']]], ''),
  ('인도 표 기간 칸 꼴 변경', [[['Porsche Deliveries', 'Q1-Q3'], *DELIV_9M[1:]]], ''),
]
LLM_WANTS = [
  ('9M 5항목 다 뽑음', [RES_9M], G_9M, False),
  ('기준 문장 뒤 BEV 문장꼴 변경', [RES_9M], G_9M.replace('Automotive BEV share between', 'BEV share target of'), True),
  ('3월 연간 서술형', [RES_FY], G_FY, True),
  ('전망 변경 뉴스인데 문장꼴 변경', [], 'the margin will now be 5.5 to 7.5 per cent (previous forecast: 3 to 5 per cent)', True),
  # 변경 문장 두 개 중 하나만 꼴이 바뀜 — 순현금흐름 마진은 코드가 뽑지만 EBITDA 문장('previous forecast')이 안 덮인다
  ('전망 변경 문장 하나만 꼴 변경', [], G_CHANGE + ' The Automotive EBITDA margin will now land between 16 and 18 per cent '
                                             '(previous forecast: 15 to 17 per cent).', True),
  ('전망 변경 문장 다 뽑음', [], G_CHANGE, False),
  ('전망 없는 일반 뉴스', [], 'Porsche completes sale of its stakes in Bugatti Rimac and Rimac Group.', False),
]
MUST_NOT_RECOGNIZED = [
  ('일반 뉴스', [[['Language:', 'English'], ['ISIN:', 'DE000PAG9113']]], 'Porsche completes sale of its stakes.'),
]


def _flatten(r: ParseResult) -> dict:
  out = {('V', x.metric, x.period): x.value for x in r.volume}
  out.update({('R', x.metric, x.period): (x.value, x.unit) for x in r.results})
  out.update({('G', x.metric, x.period): (x.low, x.high) for x in r.guidance})
  out[('N',)] = len(r.volume) + len(r.results) + len(r.guidance)
  out[('H',)] = r.llm_hint
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'P911.DE', 'ir', 'earnings_release', '', '', '', '', '2026-10-27')
  for tables, text, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for tables, text, ok, why in MUST_MISS:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    if not ok(got):
      errs.append(f'MUST_MISS {why}: {got}')
  for name, tables, text in MUST_RECOGNIZED_EMPTY:
    res = parse(doc, Content(text=text, tables=tables))
    if res.count() or not res.recognized:
      errs.append(f'{name}: 행 {res.count()} · recognized={res.recognized} (기대 0행 · True)')
  for name, tables, text, want in LLM_WANTS:
    if llm_wants(doc, parse(doc, Content(text=text, tables=tables))) != want:
      errs.append(f'llm_wants {name}: 기대 {want}')
  for name, tables, text in MUST_NOT_RECOGNIZED:
    res = parse(doc, Content(text=text, tables=tables))
    if res.recognized or res.count():
      errs.append(f'MUST_NOT_RECOGNIZED {name}: {_flatten(res)}')
  return errs
