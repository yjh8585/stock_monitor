"""폭스바겐 그룹 — IR 사이트 보도자료(일반 HTTP). 실적 보도자료 표·문장 + 분기 인도 보도자료 표 + ad-hoc 전망 변경.

출처·표본 = 2025-10~2026-10 IR 실물 13건(실적 5 · 인도 5 · ad-hoc 3 — 2026-11-10 캐시)으로 회귀.

- 실적 표(KPI): 머리 'Q1'(1분기 — 누계 칸 없음) · 'Q2 | H1' · 'Q3 | 9M' · 'Q4 | FY', 둘째 행 '2026 | 2025 | % | …'.
  «칸 위치»로 읽는다(둘째 칸 = 이번 분기 · 다섯째 칸 = 이번 누계) — 값 칸에 '–' 가 끼고 반기 판 퍼센트 칸이
  '–6,3' 처럼 독일식이라 숫자만 세면 열이 밀린다. 그래서 행 칸 수가 머리 너비(1+3 또는 1+6)와 다르면 꼴이 바뀐 것.
  행 Production·Vehicle sales(천 대) · Sales revenue · Operating result · Earnings after tax(€ 백만 · 분기만 — 다른
  파서와 같이 실적은 분기 값만 싣고 누계는 조회 계층이 더한다).
  ⚠️ 이 표의 Deliveries to customers 는 천 대 반올림이라 쓰지 않는다 — 인도는 인도 보도자료의 대 단위 값.
- 특수항목 전 영업이익: '8.8 billion EUR Operating Result before special items in 9M 2026' (누계) · 연간 판은
  'before special effects in 2025'(기간 낱말 없음 = 연간). 1분기·2025 9M 판에는 없다(늘 있는 칸 아님).
- 전망: 'Outlook for 2026' · 'Adjusted Outlook for 2026' · 'Outlook for fiscal year 2025 as of …' 문단 5항목
  (매출 · 영업이익률 · 투자 비율 · 순현금흐름 · 순유동성) + ad-hoc 'updates its forecast for fiscal year 2026' 문단
  (2026-09-18 판은 특수항목 총액·특수항목 조정 영업이익률도 — Task 9).
  매출은 반기까지 증감률(revenue_growth) → 9개월부터 금액(revenue) — metric 이 달라 방향 비교 대상이 아니다.
  '(previously: …)'·'previous forecast …' 는 이전 값이라 뽑지 않는다(방향은 guidance_direction 이 직전 검증 행과 비교).
  보고서 KPI 표의 'Original Forecast' 열은 읽지 않는다(이번 전망만 — 같은 날짜 두 행이 생기면 방향이 꼬인다).
- 인도 보도자료: 'Deliveries to customers by market | Jul. - Sep. 2026 | … | Jan. - Sep. 2026 | …' 의 World 행
  + 같은 표의 China 행(region 'china' · 있으면 — Task 13). 같은 머리의 BEV 표(World 240,200 · China 18,000)가 뒤에
  하나 더 있다 → World 가 가장 큰 표(전체 인도)를 쓴다.
- 중국 합작사 영업 결과 몫(china_jv_operating_result · Task 13): 브랜드 그룹 표 각주 2) 문장 · 기간 = 그 표의 누계.

doc_type 에 기대지 않는다 — ad-hoc 은 목록에서 제목에 results 가 없으면 전부 guidance 로 분류되고
(1건은 예비 실적·1건은 이사회 승인), 1분기 인도 보도자료는 목록에서 빠질 수 있다(제목 누락 · 원장). 판정은 본문의 서식 표식(표 머리·전망 머리)으로 한다.
「알아봄」인데 그 서식에 늘 있는 행·칸이 빠지면 문서를 비워 failed(조용한 0행 금지). 전망 머리는 있는데 늘 있는
항목이 빠졌거나, 전망 구간의 변경 표식 문장('now expects'·'previous forecast' 등)을 뽑은 행이 덮지 못했거나, 실적 표는
있는데 전망 머리가 없으면 llm_hint → llm_wants(코드 행은 그대로 적재하고 문장꼴이 바뀐 항목은 LLM 이 메운다).
"""
import re

from customer_parsers.base import Doc, Content, ParseResult, ResultRow, VolumeRow, GuidanceRow, to_number
from customer_parsers.common import uncovered_marks
from lib.doc_text import norm_text, row_text

TICKERS = ('VOW3.DE',)
# 정의 근거 = 실적 보도자료 표 'Volume Data 1)' 각주 원문 — 'The figures also include the equity-accounted Chinese joint
# ventures'(2025 9M·2025 연간·2026 1분기 판) · 'Including the equity-accounted joint ventures in China'(2026 반기·9M 판).
# 이 각주가 인도·판매·생산 세 행에 함께 걸린다. 인도 보도자료엔 각주가 없지만 World 값이 같은 분기 실적 표 인도와
# 같다(1,885,300 ↔ 1,885천 대) — 같은 정의로 본다. 각주에 없는 서술(매출 인식 대수 등)은 적지 않는다.
DEF = {'production': '폭스바겐 그룹 생산(중국 지분법 합작사 포함 — 회사 각주 · 천 대 단위 발표)',
       'sales': '폭스바겐 그룹 차량 판매(중국 지분법 합작사 포함 — 회사 각주 · 천 대 단위 발표)',
       'deliveries': '폭스바겐 그룹 고객 인도(중국 지분법 합작사 포함 — 실적 보도자료 각주 · 대 단위)'}
_Q = re.compile(r'Q([1-4])')
_YTD_WORD = {2: 'H1', 3: '9M', 4: 'FY'}
_YEAR = re.compile(r'20\d{2}')
_FIN_MARK = re.compile(r'Financial Data \(IFRS\)', re.I)   # 실적 표 표식(머리 꼴이 바뀌어도 이 행은 남는다)
_KPI_ROWS = {  # 라벨(각주·'(units)' 뗀 뒤) → (종류, metric)
  'Production': ('V', 'production'), 'Vehicle sales': ('V', 'sales'),
  'Sales revenue': ('R', 'revenue'), 'Operating result': ('R', 'operating_income'),
  'Earnings after tax': ('R', 'net_income'),
}
_BSI = re.compile(r'([\d.]+) billion EUR Operating Result before special (?:items|effects) in (?:(Q1|H1|9M|FY) )?(20\d{2})',
                  re.I)
_BSI_GRAIN = {'Q1': ('quarter', 'Q1'), 'H1': ('ytd', '6M'), '9M': ('ytd', '9M')}

# 전망 머리 — (정규식, 늘 있는 항목 수). 실적 보도자료 'Outlook' 문단은 5/5건에 5항목이 다 있었다.
# ad-hoc 은 표본 1건(4항목 · 투자 비율 없음)이라 «하나 이상»만 요구한다
_OUT_HEADS = (
  (re.compile(r'\bOutlook for (?:fiscal year )?(20\d{2})', re.I), 5),
  (re.compile(r'\bupdat\w* its forecast for (?:the )?(?:fiscal|financial) year (20\d{2})', re.I), 1),
)
_OUT_END = re.compile(r'continues to pursue its objective|The adjustment of the forecast|The forecast is based', re.I)
_OUT_MAX = 1500
_EUR = r'(?:€ ?|EUR ?)?'
_BN = r'([\d.]+)(?: billion(?: euros)?)?'
_RANGE_WORD = r'(approximately|about|around|between|up to|in the range of)'
_G = (  # (정규식, metric, 회사 라벨, 단위, basis, 항목 묶음) — 묶음이 같으면 하나로 센다(매출 금액·증감률)
  (re.compile(r'expects (?:Group )?sales revenue (?:in 20\d{2} )?of ' + _RANGE_WORD + ' ' + _EUR + _BN +
              r'(?: (?:and|to) ' + _EUR + r'([\d.]+))? billion', re.I),
   'revenue', 'Group sales revenue', 'billion', 'reported', 'revenue'),
  (re.compile(r'expects (?:its )?sales revenue (?:in|for) 20\d{2} to develop within a (range) of ([-+]?[\d.]+) '
              r'(?:to|and) ([-+]?[\d.]+) percent', re.I),
   'revenue_growth', 'Group sales revenue growth', 'percent', 'reported', 'revenue'),
  (re.compile(r'operating return on sales (?:is (?:still )?(?:expected|projected) to (?:reach |be |range )?|of )'
              + _RANGE_WORD + r' ([\d.]+)(?: (?:and|to) ([\d.]+))? percent', re.I),
   'operating_margin', 'Group operating return on sales', 'percent', 'reported', 'margin'),
  (re.compile(r'investment ratio (?:of )?' + _RANGE_WORD + r' ([\d.]+)(?: (?:and|to) ([\d.]+))? percent', re.I),
   'investment_ratio', 'Automotive investment ratio', 'percent', None, 'invest'),
  (re.compile(r'net cash flow (?:of |for the year 20\d{2} is expected to (?:range |be )?|in the Automotive Division to be )'
              + _RANGE_WORD + ' ' + _EUR + _BN + r'(?: (?:and|to) ' + _EUR + r'([\d.]+))? billion', re.I),
   'automotive_net_cash_flow', 'Automotive net cash flow', 'billion', None, 'ncf'),
  (re.compile(r'net liquidity in the Automotive Division is (?:still )?expected to (?:range |amount to |be )?'
              + _RANGE_WORD + ' ' + _EUR + _BN + r'(?: (?:and|to) ' + _EUR + r'([\d.]+))? billion', re.I),
   'automotive_net_liquidity', 'Automotive net liquidity', 'billion', None, 'liquidity'),
  # 특수항목 총액·특수항목 조정 영업이익률(Task 9) — 실물은 ad-hoc 2026-09-18(doc 1527) 1건뿐(실적 보도자료 Outlook 문단엔
  # 없다 · 2026-11-11 확인). 'previous forecast' 처럼 이전 값이 아니라 이번 연간 전망이다
  (re.compile(r'Special effects totaling ' + _RANGE_WORD + ' ' + _EUR + _BN + r'(?: (?:and|to) ' + _EUR + r'([\d.]+))? '
              r'billion', re.I),
   'special_items', 'Special effects', 'billion', None, 'special'),
  (re.compile(r'Adjusted for (?:the )?special (?:effects|items), the operating return on sales (?:for the full year 20\d{2} )?'
              r'would amount to (about|around|between|up to) ([\d.]+)(?: (?:and|to) ([\d.]+))? percent', re.I),
   'operating_margin_adjusted', 'Operating return on sales adjusted for special effects', 'percent', 'adjusted',
   'margin_adjusted'),
)
_APPROX = ('around', 'about', 'approximately')   # 근사 낱말 — 숫자는 그대로 두고 원문 구절을 value_text 로
# 문장이 스스로 밝힌 연도('… for the full year 2026 would amount to …') — 전망 머리 연도와 다르면 이번 전망이 아니다.
# _G 의 범위 그룹 번호(1~3)를 밀지 않으려고 정규식 안이 아니라 매치 문장에서 따로 읽는다
_SENT_YEAR = re.compile(r'for the full year (20\d{2})', re.I)
# 전망 변경 표식(실물 문장꼴에서 뽑음) — ad-hoc 'now expects' · 'previous forecast' · 'continues to expect' ·
# 'is still expected', 반기 판 '(previously: …)'. 전망 구간 안 이 표식 문장은 뽑은 행 quote 가 덮어야 한다
_CHANGE_MARK = re.compile(r'now (?:expects|targets|anticipates|projects)|previous forecast|previously:|continues to expect|'
                          r'is still expected|is expected to (?:increase|decrease|rise|fall)', re.I)
# 문장으로만 낸 매출 전망('expects its sales revenue for 2025 to be in line with the previous year') — 숫자가 없어 value_text
_G_TEXT = re.compile(r'expects (?:its )?(?:Group )?sales revenue (?:in|for) 20\d{2} to be (in line with the previous year)',
                     re.I)

_DELIV_HEAD = re.compile(r'Deliveries to customers by market', re.I)
_MON = r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?'
_DELIV_Q = re.compile(_MON + r' ?- ?' + _MON + r' (20\d{2})')
_END_MONTH = {'Mar': 3, 'Jun': 6, 'Sep': 9, 'Dec': 12}
_START_MONTH = {3: 'Jan', 6: 'Apr', 9: 'Jul', 12: 'Oct'}
# 인도 표 시장 행 중 이번에 싣는 것은 중국뿐(사용자 지시 2026-11-10 — 다른 시장은 사용자 판단). 실물 라벨 = 'China'
# (2026-10-12 doc 1508 — 'China incl. Hong Kong' 꼴 아님 · 대 단위)
_CHINA_ROW = 'China'
# 중국 지분법 합작사의 영업 결과 몫 — 브랜드 그룹 표 각주 2) 문장(2026 반기 doc 1514 'EUR 184 (506) million' ·
# 9M doc 1507 '€-113 (744) million'). 연결 실적에 안 들어가는 값이라 따로 싣는다. 괄호 안은 전년 값이라 읽지 않는다
_JV = re.compile(r'the share of the operating result generated by these companies amounted to (?:€ ?|EUR ?)'
                 r'([-–]?[\d,.]+) \([-–]?[\d,.]+\) million', re.I)
_BRAND_HEAD = ('Vehicle sales', 'Sales revenue', 'Operating result', 'Operating margin')


def wants(doc: Doc) -> bool:
  # 보고서(periodic)·발표자료(presentation)는 대상 밖(pending). ad-hoc(guidance)은 본문으로 가른다
  return doc.source == 'ir' and doc.doc_type in ('earnings_release', 'sales_release', 'guidance')


def llm_wants(doc: Doc, result: ParseResult) -> bool:
  """전망 문장꼴이 바뀌어 코드가 늘 있는 항목을 다 못 뽑은 문서(본문 표식은 parse 가 llm_hint 로 남긴다)."""
  return result.llm_hint


BASE_CURRENCY = 'EUR'   # 보고 통화(LLM 행 통화 검사 기준)
LLM_HINT = ('Outlook(전망) 문단의 연간 항목만 — 매출(금액 revenue 또는 증감률 revenue_growth) · 영업이익률(operating_margin) · '
            'Automotive 투자 비율(investment_ratio) · Automotive 순현금흐름(automotive_net_cash_flow) · Automotive 순유동성'
            '(automotive_net_liquidity). 괄호 안 이전 값(previously: …)·이전 전망(previous forecast)은 뽑지 마세요.')


def _label(cell: str) -> str:
  return re.sub(r'(?:\s*\(units\))?(?:\s+\d)*$', '', norm_text(cell))


def _range(word: str, a: str, b: str | None) -> tuple[float | None, float | None]:
  a_ = float(a)
  if word.lower() == 'up to':
    return None, a_
  return (a_, float(b)) if b else (a_, a_)


# ---------------------------------------------------------------- 실적 표(KPI)
def parse_kpi(tables) -> ParseResult | None:
  """None = 실적 표 표식은 있는데 꼴이 어긋났다(문서 전체를 failed 로 — 전망 문장만 적재되는 반쪽을 막는다)."""
  for rows in tables:
    if not any(_FIN_MARK.match(norm_text(r[0])) for r in rows):
      continue
    head = [norm_text(c) for c in rows[0]]
    qm = _Q.fullmatch(head[0]) if head else None
    years = [norm_text(c) for c in rows[1]] if len(rows) > 1 else []
    if not qm or not years or not _YEAR.fullmatch(years[0]):
      return None
    q, year = int(qm.group(1)), years[0]
    if q == 1:
      if len(head) != 1:
        return None
      width, ytd = 3, None
    else:
      if len(head) != 2 or head[1] != _YTD_WORD[q]:
        return None
      width = 6
      ytd = ('year', year) if q == 4 else ('ytd', f'{year}-{q * 3}M')
    period = f'{year}-Q{q}'
    r = ParseResult(recognized=True)
    seen = set()
    for row in rows[2:]:
      kind_metric = _KPI_ROWS.get(_label(row[0]))
      if not kind_metric:
        continue
      cells = row[1:]
      if len(cells) != width:
        return None   # 칸이 빠지거나 늘었다 = 위치가 밀렸다
      cur = to_number(cells[0])
      if cur is None:
        return None
      kind, metric = kind_metric
      if metric in seen:
        return None   # 같은 행이 두 번 = 표가 겹쳤거나 꼴이 바뀌었다(어느 쪽이 맞는지 모른다)
      seen.add(metric)
      if kind == 'V':
        r.volume.append(VolumeRow(metric, 'total', 'quarter', period, round(cur * 1000), DEF[metric], row_text(row)))
        y = to_number(cells[3]) if ytd else None
        if ytd and y is None:
          return None
        if ytd:
          r.volume.append(VolumeRow(metric, 'total', ytd[0], ytd[1], round(y * 1000), DEF[metric], row_text(row)))
      else:
        name = _label(row[0])
        r.results.append(ResultRow(metric, name, 'reported', 'quarter', period, cur, 'million', 'EUR', row_text(row)))
    # 실물 5/5건에 다 있던 행 — 하나라도 빠지면 꼴이 바뀐 것
    if seen != {m for _, m in _KPI_ROWS.values()}:
      return None
    return r
  return ParseResult()


# ---------------------------------------------------------------- 문장(특수항목 전 영업이익 · 전망)
def parse_bsi(text: str, kpi_period: str | None) -> list[ResultRow]:
  """kpi_period = 실적 표의 이번 분기('2025-Q4'). 표가 없으면 읽지 않는다 · 연도가 표 연도와 다른 문장은 버린다 ·
  기간 낱말 없는 문장('… in 2025' = 연간)은 표가 Q4|FY 인 문서에서만 받는다(다른 판의 '… in 2025' 는 전년 비교 문장일 수 있다)."""
  out = []
  if kpi_period is None:
    return out
  for m in _BSI.finditer(text):
    word, year = (m.group(2) or 'FY').upper(), m.group(3)
    if year != kpi_period[:4] or (m.group(2) is None and not kpi_period.endswith('Q4')):
      continue
    grain, period = ('year', year) if word == 'FY' else (_BSI_GRAIN[word][0], f'{year}-{_BSI_GRAIN[word][1]}')
    out.append(ResultRow('operating_result_bsi', 'Operating Result before special items', 'adjusted', grain, period,
                         float(m.group(1)), 'billion', 'EUR', m.group(0)))
  return out


def parse_outlook(text: str) -> tuple[list[GuidanceRow], bool]:
  """(전망 행, llm_hint). 머리가 여러 번 나오면(ad-hoc 은 쪽 제목에도 있다) 머리마다 뒤 구간을 보고 항목별 첫 값을 쓴다."""
  found: dict[str, GuidanceRow] = {}
  need = 0
  bodies = []
  for head, n_need in _OUT_HEADS:
    for hm in head.finditer(text):
      need = max(need, n_need)
      body = text[hm.end():hm.end() + _OUT_MAX]
      end = _OUT_END.search(body)
      body = body[:end.start()] if end else body
      bodies.append(body)
      year = hm.group(1)
      for rx, metric, label, unit, basis, group in _G:
        m = next((x for x in rx.finditer(body)
                  if (sy := _SENT_YEAR.search(x.group(0))) is None or sy.group(1) == year), None)
        if m and group not in found:
          lo, hi = _range(m.group(1), m.group(2), m.group(3))
          # 'around'·'about'·'approximately' 는 근사 — 숫자는 그대로 두고 원문 구절('around €315 billion')을 value_text 로 남겨 화면이
          # 「약」을 붙인다(전망을 단정으로 바꾸지 않기 · Task 15 Codex 대조). 구절은 quote 의 꼬리라 quote_check 를 그대로 통과한다
          approx = m.group(0)[m.start(1) - m.start(0):] if m.group(1).lower() in _APPROX else None
          found[group] = GuidanceRow(metric, label, f'FY{year}', lo, hi, approx, unit, basis, m.group(0))
      tm = _G_TEXT.search(body)
      if tm and 'revenue' not in found:
        found['revenue'] = GuidanceRow('revenue_growth', 'Group sales revenue growth', f'FY{year}', None, None,
                                       tm.group(1), 'text', 'reported', tm.group(0))
  # 늘 있는 항목 수가 모자라거나, 변경 표식 문장 중 뽑은 행이 덮지 않은 것이 있으면(ad-hoc 은 «하나 이상»만 요구해
  # 일부 항목만 문장꼴이 바뀌면 조용히 빠진다) LLM 으로
  quotes = [g.quote for g in found.values()]
  missed = [s for b in bodies for s in uncovered_marks(b, _CHANGE_MARK, quotes)]
  hint = (need > 0 and len(found) < need) or bool(missed)
  return list(found.values()), hint


def parse_china_jv(tables, text: str, kpi: ParseResult) -> list[ResultRow]:
  """각주는 브랜드 그룹 표에 걸린다 — 그 표는 누계 기간(9M 판 = 9M)이라 표의 'Volkswagen Group' 판매(천 대)가 실적 표
  누계 판매와 같을 때만 그 기간으로 싣는다(1분기 판은 분기). 기간을 확인 못 하면 이 행만 빠진다(늘 있는 칸 아님)."""
  m = _JV.search(text)
  sales = [x for x in kpi.volume if x.metric == 'sales']
  if not m or not sales:
    return []
  cum = sales[-1]   # parse_kpi 는 분기 → 누계 순으로 넣는다(1분기 판은 분기 하나)
  for rows in tables:
    if not rows or tuple(norm_text(c) for c in rows[0]) != _BRAND_HEAD:
      continue
    grp = next((row for row in rows[1:] if norm_text(row[0]) == 'Volkswagen Group' and len(row) > 1), None)
    units = to_number(grp[1]) if grp else None
    if units is None or round(units * 1000) != cum.value:
      return []
    v = to_number(m.group(1).replace('–', '-'))
    if v is None:
      return []
    return [ResultRow('china_jv_operating_result', 'Share of the operating result of the equity-accounted companies in '
                      'China', 'reported', cum.period_grain, cum.period, v, 'million', 'EUR', m.group(0))]
  return []


# ---------------------------------------------------------------- 인도 보도자료
def parse_deliveries(tables) -> ParseResult | None:
  """None = 인도 표 머리는 있는데 World 행·기간 칸 꼴이 어긋났다.
  중국 행(Task 13)은 World 를 고른 그 표에서만 «있으면 뽑는다» — 못 찾거나 칸이 어긋나면 중국 행만 빠진다(문서 failed 아님).
  BEV 표에도 China 행이 있어(18,000 — 전기차만) 다른 표의 China 를 읽으면 전체 인도로 잘못 들어간다."""
  cands = []   # (World 분기 값, 머리, World 행, 표)
  for rows in tables:
    head = [norm_text(c) for c in rows[0]] if rows else []
    if not head or not _DELIV_HEAD.fullmatch(head[0]):
      continue
    world = next((row for row in rows[1:] if norm_text(row[0]) == 'World'), None)
    if world is None or len(world) != len(head):
      return None
    cands.append((to_number(world[1]) or 0, head, world, rows))
  if not cands:
    return ParseResult()
  _, head, world, rows = max(cands, key=lambda c: c[0])
  qm = _DELIV_Q.fullmatch(head[1])
  if not qm or qm.group(2) not in _END_MONTH or _START_MONTH[_END_MONTH[qm.group(2)]] != qm.group(1):
    return None
  year, end = qm.group(3), _END_MONTH[qm.group(2)]
  r = ParseResult(recognized=True)
  cur = to_number(world[1])
  if cur is None:
    return None
  grain = None
  if end != 3:
    ym = _DELIV_Q.fullmatch(head[4]) if len(head) > 4 else None
    y = to_number(world[4]) if len(world) > 4 else None
    if not ym or ym.group(1) != 'Jan' or ym.group(2) != qm.group(2) or ym.group(3) != year or y is None:
      return None
    grain, period = ('year', year) if end == 12 else ('ytd', f'{year}-{end}M')
  china = next((row for row in rows[1:] if norm_text(row[0]) == _CHINA_ROW), None)
  for region, row in (('total', world), ('china', china)):
    q = to_number(row[1]) if row is not None and len(row) == len(head) else None
    y = to_number(row[4]) if q is not None and grain else None
    if q is None or (grain and y is None):
      continue   # World 는 위에서 확인했다 — 여기서 빠지는 것은 중국 행뿐
    r.volume.append(VolumeRow('deliveries', region, 'quarter', f'{year}-Q{end // 3}', round(q), DEF['deliveries'],
                              row_text(row)))
    if grain:
      r.volume.append(VolumeRow('deliveries', region, grain, period, round(y), DEF['deliveries'], row_text(row)))
  return r


def parse(doc: Doc, content: Content) -> ParseResult:
  text = norm_text(content.text)
  r, dv = parse_kpi(content.tables), parse_deliveries(content.tables)
  if r is None or dv is None:
    return ParseResult(recognized=True)   # 서식 표식은 있는데 늘 있는 행·칸이 빠졌다 → failed
  r.results += parse_bsi(text, next((x.period for x in r.results if x.metric == 'revenue'), None))
  r.results += parse_china_jv(content.tables, text, r)
  r.guidance, hint = parse_outlook(text)
  r.extend(dv)
  kpi_seen = any(x.metric == 'revenue' for x in r.results)
  # 실적 표는 있는데 전망 머리가 없다 = 전망 문단 꼴이 바뀌었다(실물 5/5건에 있었다)
  r.llm_hint = hint or (kpi_seen and not any(h.search(text) for h, _ in _OUT_HEADS))
  # 폭스바겐의 LLM 칸은 전부 «문장꼴이 바뀌어 코드가 놓친» 항목이다(원래 서술형인 문서가 없다) → 문구 미스
  r.code_miss = r.llm_hint
  r.recognized = r.recognized or bool(r.guidance) or bool(r.results)
  return r


# ---------------------------------------------------------------- 자가 시험(2025-10~2026-10 실물 원문)
KPI_Q3 = [['Q3', '9M'], ['2026', '2025', '%', '2026', '2025', '%'], ['Volume Data 1 in thousands'],
          ['Deliveries to customers (units)', '1,885', '2,199', '-14.3', '6,011', '6,604', '-9.0'],
          ['Vehicle sales (units)', '1,883', '2,218', '-15.1', '5,880', '6,581', '-10.6'],
          ['Production (units)', '1,786', '2,125', '-15.9', '5,957', '6,644', '-10.3'],
          ['Employees (on Sep. 30, 2026/Dec. 31, 2025)', '648.1', '662.9', '-2.2'],
          ['Financial Data (IFRS), € million'],
          ['Sales revenue', '75,277', '80,305', '-6.3', '233,378', '238,669', '-2.2'],
          ['Operating result', '-5,860', '-1,299', '–', '71', '5,408', '-98.7'],
          ['Operating return on sales (%)', '-7.8', '-1.6', '0.0', '2.3'],
          ['Earnings after tax', '-5,822', '-1,072', '–', '-2,720', '3,405', '–']]
BRAND = [['Vehicle sales', 'Sales revenue', 'Operating result', 'Operating margin'],
         ['Thousand vehicles/ € million', '2026', '2025', '2026', '2025', '2026', '2025', '2026', '2025'],
         ['Core brand group', '3,753', '3,771', '106,417', '106,950', '4,326', '4,719', '4.1', '4.4'],
         ['Volkswagen Group', '5,880', '6,581', '233,378', '238,669', '71', '5,408', '0.0', '2.3']]
OUT_9M = ('Outlook for 2026 The Volkswagen Group expects Group sales revenue in 2026 of around €315 billion. The '
          'Group’s operating return on sales is expected to reach up to 1 percent. In the Automotive Division, the company '
          'expects an investment ratio of between 11 and 12 percent and net cash flow of between €3 billion and €6 billion '
          'for 2026. Net liquidity in the Automotive Division is expected to range between €32 billion and €34 billion in '
          '2026. The Volkswagen Group continues to pursue its objective of maintaining a solid financing and liquidity policy.')
OUT_H1 = ('Adjusted Outlook for 2026 The Volkswagen Group expects sales revenue in 2026 to develop within a range of –3 to 0 '
          'percent compared with the previous year (previously: range of 0 to +3 percent). The Group’s operating return '
          'on sales is still expected to be between 4.0 and 5.5 percent. In the Automotive Division, the company continues '
          'to expect an investment ratio of between 11 and 12 percent in 2026. Net cash flow for the year 2026 is expected '
          'to range between EUR 3 billion and EUR 6 billion. Net liquidity in the Automotive Division is expected to range '
          'between EUR 32 billion and EUR 34 billion in 2026.')
# 1분기·연간 판 — 'within a range of 0 and +3' · 'is expected to range between 4.0 and 5.5'
OUT_Q1 = ('Outlook for 2026 The Volkswagen Group expects sales revenue in 2026 to develop within a range of 0 and +3 percent '
          'compared with the previous year. The Group\'s operating return on sales is expected to range between 4.0 and '
          '5.5 percent. In the Automotive Division, the company expects an investment ratio of between 11 and 12 percent in '
          '2026. Net cash flow for the year 2026 is expected to range between EUR 3 billion and EUR 6 billion. Net liquidity '
          'in the Automotive Division is expected to range between EUR 32 billion and EUR 34 billion in 2026.')
# 2025 9M 판 — 매출이 문장뿐 · 'projected' · 'investment ratio between' · 'to be around EUR 0 billion' · 'amount to around'
OUT_2025 = ('Outlook for fiscal year 2025 as of September 19, 2025 The Volkswagen Group expects its sales revenue for 2025 to '
            'be in line with the previous year. The Group\'s operating return on sales is projected to range between 2.0 and '
            '3.0 percent. In the Automotive Division, the company expects an investment ratio between 12 and 13 percent in '
            '2025. Net cash flow for the year 2025 is expected to be around EUR 0 billion. This includes cash outflows for '
            'future-oriented investments as well as for restructuring measures. Net liquidity in the Automotive Division is '
            'expected to amount to around EUR 30 billion in 2025. The Volkswagen Group continues to pursue its objective')
# ad-hoc 전망 변경(2026-09-18) — 쪽 제목에도 머리가 한 번 더 나온다
ADHOC = ('Volkswagen AG updates its forecast for fiscal year 2026 | Volkswagen Group Skip to content Group Media Investors '
         '09/18/2026 · 17:17 Ad hoc Volkswagen AG updates its forecast for fiscal year 2026 Share Against the backdrop of '
         'an impairment of the Porsche AG goodwill, a challenging market environment, especially in China, and additional '
         'restructuring expenses, Volkswagen AG is updating its forecast for fiscal year 2026 as follows: The company now '
         'expects Group Sales Revenue of around 315 billion euros, broadly equivalent to the midpoint of the previous '
         'forecast range of a development of -3 to 0 percent (2025: 321.9 billion euros). The company now expects to '
         'achieve an Operating Return on Sales of up to 1 percent (2025: 2.8 percent; previous forecast 4.0 to 5.5 percent; '
         'average analyst expectation: 4.1 percent). Special effects totaling around 10 billion euros are expected weigh '
         'on operating profit in the financial year, of which 0.9 billion euros were already reported in the first half '
         'of 2026. Adjusted for the special effects, the operating return on sales for the full year 2026 would amount to '
         'about 4 percent. Volkswagen AG continues to expect Net Cash Flow in the Automotive Division to be in the range of '
         'EUR 3 billion to EUR 6 billion. Net Liquidity in the Automotive Division is still expected to be in the range of '
         'EUR 32 billion to EUR 34 billion in 2026. The adjustment of the forecasts for consolidated sales and operating '
         'return on sales is mainly due to the following factors:')
DELIV_HEAD = ['Deliveries to customers by  market', 'Jul. - Sep. 2026', 'Jul. - Sep. 2025', 'Delta (%)',
              'Jan. - Sep. 2026', 'Jan. - Sep. 2025', 'Delta (%)']
DELIV_Q3 = [DELIV_HEAD, ['North America', '232,700', '246,900', '-5.8', '680,200', '708,800', '-4.0'],
            ['World', '1,885,300', '2,198,900', '-14.3', '6,011,000', '6,604,300', '-9.0']]
DELIV_BEV = [DELIV_HEAD, ['USA', '5,100', '37,400', '-86.4', '14,900', '68,700', '-78.4'],
             ['World', '240,200', '252,100', '-4.7', '678,700', '717,700', '-5.4']]
DELIV_Q3_CN = [*DELIV_Q3[:2], ['China', '405,800', '660,300', '-38.5', '1,378,800', '1,974,000', '-30.2'],
               ['Rest of Asia-Pacific', '67,200', '76,800', '-12.4', '212,500', '233,900', '-9.1'], DELIV_Q3[2]]
DELIV_BEV_CN = [*DELIV_BEV[:2], ['China', '18,000', '25,800', '-30.1', '48,900', '85,100', '-42.5'], DELIV_BEV[2]]
# 9M 실적 보도자료(doc 1507) 브랜드 그룹 표 각주 2) — 괄호 안 744 는 전년 값
JV_9M = ('2) The sales revenue and operating result of the equity-accounted companies in China are not included in the '
         'consolidated figures; the share of the operating result generated by these companies amounted to €-113 (744) '
         'million.')

MUST_HIT = [  # (표, 본문, 기대 {키: 값} · ('N',) = 값 행 수)
  # 근사어 approximately(Task 10) — 숫자는 그대로
  ([], OUT_9M.replace('of around €315', 'of approximately €315'), {('G', 'revenue', 'FY2026'): (315.0, 315.0)}),
  ([KPI_Q3, BRAND], '8.8 billion EUR Operating Result before special items in 9M 2026; operating return on sales '
                    'before special items of 3.8% … ' + OUT_9M,
   {('V', 'production', 'total', '2026-Q3'): 1786000, ('V', 'production', 'total', '2026-9M'): 5957000,
    ('V', 'sales', 'total', '2026-Q3'): 1883000, ('V', 'sales', 'total', '2026-9M'): 5880000,
    ('R', 'revenue', '2026-Q3'): 75277.0, ('R', 'operating_income', '2026-Q3'): -5860.0,
    ('R', 'net_income', '2026-Q3'): -5822.0, ('R', 'operating_result_bsi', '2026-9M'): 8.8,
    ('G', 'revenue', 'FY2026'): (315.0, 315.0), ('G', 'operating_margin', 'FY2026'): (None, 1.0),
    ('G', 'investment_ratio', 'FY2026'): (11.0, 12.0), ('G', 'automotive_net_cash_flow', 'FY2026'): (3.0, 6.0),
    ('G', 'automotive_net_liquidity', 'FY2026'): (32.0, 34.0), ('N',): 13, ('H',): False}),
  ([], OUT_H1,
   {('G', 'revenue_growth', 'FY2026'): (-3.0, 0.0), ('G', 'operating_margin', 'FY2026'): (4.0, 5.5),
    ('G', 'investment_ratio', 'FY2026'): (11.0, 12.0), ('G', 'automotive_net_cash_flow', 'FY2026'): (3.0, 6.0),
    ('G', 'automotive_net_liquidity', 'FY2026'): (32.0, 34.0), ('N',): 5, ('H',): False}),
  ([], OUT_Q1, {('G', 'revenue_growth', 'FY2026'): (0.0, 3.0), ('G', 'operating_margin', 'FY2026'): (4.0, 5.5),
                ('N',): 5, ('H',): False}),
  ([], OUT_2025, {('G', 'revenue_growth', 'FY2025'): 'in line with the previous year',
                  ('G', 'operating_margin', 'FY2025'): (2.0, 3.0), ('G', 'investment_ratio', 'FY2025'): (12.0, 13.0),
                  ('G', 'automotive_net_cash_flow', 'FY2025'): (0.0, 0.0),
                  ('G', 'automotive_net_liquidity', 'FY2025'): (30.0, 30.0), ('N',): 5, ('H',): False}),
  # 특수항목 총액(special_items)·특수항목 조정 영업이익률(operating_margin_adjusted)도 연간 전망 문장이다(Task 9)
  ([], ADHOC, {('G', 'revenue', 'FY2026'): (315.0, 315.0), ('G', 'operating_margin', 'FY2026'): (None, 1.0),
               ('G', 'automotive_net_cash_flow', 'FY2026'): (3.0, 6.0),
               ('G', 'automotive_net_liquidity', 'FY2026'): (32.0, 34.0),
               ('G', 'special_items', 'FY2026'): (10.0, 10.0), ('G', 'operating_margin_adjusted', 'FY2026'): (4.0, 4.0),
               ('N',): 6, ('H',): False}),
  # 반기 판 — 퍼센트 칸 '–6,3'·'–9.5'(독일식·en dash)여도 칸 위치로 읽는다
  ([[['Q2', 'H1'], ['2026', '2025', '%', '2026', '2025', '%'],
     ['Vehicle sales (units)', '2,043', '2,263', '-9.7', '3,997', '4,363', '-8,4'],
     ['Production (units)', '2,014', '2,325', '-13.4', '4,171', '4,519', '-7,7'],
     ['Financial Data (IFRS), € million'],
     ['Sales revenue', '82,444', '80,806', '2.0', '158,102', '158,364', '–0.2'],
     ['Operating result', '3,469', '3,834', '–9.5', '5,931', '6,707', '–11.6'],
     ['Earnings after tax', '1,538', '2,291', '–32.9', '3,103', '4,477', '–30.7']]],
   '6.9 billion EUR Operating Result before special items in H1 2026 Adjusted for special items',
   {('V', 'production', 'total', '2026-6M'): 4171000, ('R', 'revenue', '2026-Q2'): 82444.0,
    ('R', 'operating_income', '2026-Q2'): 3469.0, ('R', 'operating_result_bsi', '2026-6M'): 6.9, ('N',): 8,
    ('H',): True}),   # 실적 표는 있는데 전망 머리가 없다 → LLM
  # 1분기 판(누계 칸 없음) · 연간 판(Q4 | FY · BSI 'special effects in 2025')
  ([[['Q1'], ['2026', '2025', '%'], ['Vehicle sales (units)', '1,954', '2,100', '-6.9'],
     ['Production (units)', '2,157', '2,194', '-1.7'], ['Financial Data (IFRS), € million'],
     ['Sales revenue', '75,657', '77,558', '-2.5'], ['Operating result', '2,463', '2,873', '-14.3'],
     ['Earnings after tax', '1,564', '2,186', '-28.4']]], OUT_Q1,
   {('V', 'production', 'total', '2026-Q1'): 2157000, ('R', 'operating_income', '2026-Q1'): 2463.0, ('N',): 10}),
  ([[['Q4', 'FY'], ['2025', '2024', '%', '2025', '2024', '%'],
     ['Vehicle sales (units)', '2,441', '2,574', '-5.1', '9,022', '9,037', '-0.2'],
     ['Production (units)', '2,222', '2,322', '-4.3', '8,866', '8,954', '-1.0'],
     ['Financial Data (IFRS), € million'],
     ['Sales revenue', '83,245', '87,377', '-4.7', '321,913', '324,656', '-0.8'],
     ['Operating result', '3,460', '6,248', '-44.6', '8,868', '19,060', '–53.5'],
     ['Earnings after tax', '3,499', '3,558', '-1.7', '6,904', '12,394', '–44.3']]],
   '14.8 billion EUR Operating Result before special effects in 2025 Adjusted for … ' + OUT_Q1,
   {('V', 'sales', 'total', '2025-Q4'): 2441000, ('V', 'sales', 'total', '2025'): 9022000, ('R', 'revenue', '2025-Q4'): 83245.0,
    ('R', 'operating_result_bsi', '2025'): 14.8, ('N',): 13}),
  # 인도 보도자료 — 전체 표(World 1,885,300)와 BEV 표(World 240,200)가 같은 머리 → 큰 쪽
  ([DELIV_Q3, DELIV_BEV], '', {('V', 'deliveries', 'total', '2026-Q3'): 1885300, ('V', 'deliveries', 'total', '2026-9M'): 6011000,
                               ('N',): 2}),
  ([[['Deliveries to customers by  market', 'Oct. – Dec.  2025', 'Oct. – Dec. 2024', 'Delta (%)', 'Jan. – Dec. 2025',
      'Jan. – Dec. 2024', 'Delta (%)'], ['World', '2,379,800', '2,502,300', '-4.9', '8,983,900', '9,026,700', '-0.5']]], '',
   {('V', 'deliveries', 'total', '2025-Q4'): 2379800, ('V', 'deliveries', 'total', '2025'): 8983900, ('N',): 2}),
  # 중국 행(Task 13 · doc 1508 실물) — World 와 같은 표에서 · 지역이 키에 있어 서로 덮지 않는다
  ([DELIV_Q3_CN, DELIV_BEV_CN], '', {('V', 'deliveries', 'total', '2026-Q3'): 1885300,
                                     ('V', 'deliveries', 'total', '2026-9M'): 6011000,
                                     ('V', 'deliveries', 'china', '2026-Q3'): 405800,
                                     ('V', 'deliveries', 'china', '2026-9M'): 1378800, ('N',): 4}),
  # 중국 합작사 몫 영업 결과 — 브랜드 표 그룹 판매 5,880 = 실적 표 9M 판매 → 9M
  ([KPI_Q3, BRAND], OUT_9M + ' ' + JV_9M, {('R', 'china_jv_operating_result', '2026-9M'): -113.0, ('N',): 13}),
  # 1분기 인도 보도자료(목록에서 빠질 수 있다 — 꼴이 오면 읽는다)
  ([[['Deliveries to customers by market', 'Jan. - Mar. 2026', 'Jan. - Mar. 2025', 'Delta (%)'],
     ['World', '2,048,700', '2,133,800', '-4.0']]], '', {('V', 'deliveries', 'total', '2026-Q1'): 2048700, ('N',): 1}),
]
MUST_MISS = [  # (표, 본문, 판정(got) → 참이어야 함, 사유)
  # 중국 말고 다른 시장(North America 등)은 이번 범위 밖 · BEV 표 China(18,000)를 전체 인도 중국으로 읽지 않는다
  ([DELIV_BEV_CN, DELIV_Q3_CN], '',
   lambda g: {k[2] for k in g if k[:2] == ('V', 'deliveries')} == {'total', 'china'}
   and g.get(('V', 'deliveries', 'china', '2026-Q3')) == 405800, '다른 시장 행·BEV 표 China 를 읽었다'),
  # 중국 행이 없으면 중국 행만 빠지고 World 는 그대로(문서 failed 아님)
  ([DELIV_Q3], '', lambda g: g.get(('V', 'deliveries', 'total', '2026-Q3')) == 1885300
   and not any(k[2] == 'china' for k in g if k[0] == 'V'), '중국 행 없는 표에서 World 가 빠졌다'),
  # 브랜드 표 그룹 판매가 실적 표 누계와 다르면(다른 기간) 합작사 행을 싣지 않는다 — 다른 행은 그대로
  ([KPI_Q3, [*BRAND[:3], ['Volkswagen Group', '3,997', '4,363', '158,102', '158,364', '5,931', '6,707', '3.8', '4.2']]],
   JV_9M, lambda g: not any(k[:2] == ('R', 'china_jv_operating_result') for k in g)
   and g[('R', 'operating_income', '2026-Q3')] == -5860.0, '기간을 확인 못 한 합작사 행을 실었다'),
  # 실적 표의 천 대 반올림 인도(1,885)는 인도 칸에 들어가면 안 된다 — 생산·판매는 그대로 읽힌다
  ([KPI_Q3], '', lambda g: not any(k[:2] == ('V', 'deliveries') for k in g) and g[('V', 'production', 'total', '2026-Q3')] == 1786000,
   '실적 표의 천 대 인도가 인도 칸에 들어갔다'),
  # 브랜드 그룹 표의 'Volkswagen Group … 71' 은 실적 표 값이 아니다 — 영업이익은 실적 표 분기 값 하나
  ([BRAND, KPI_Q3], '', lambda g: [v for k, v in g.items() if k[:2] == ('R', 'operating_income')] == [-5860.0],
   '브랜드 그룹 표에서 영업이익을 읽었다'),
  # '(previously: range of 0 to +3 percent)' 는 이전 값 — 이번 값(-3~0)만
  ([], OUT_H1, lambda g: g.get(('G', 'revenue_growth', 'FY2026')) == (-3.0, 0.0), '반기 판에서 이전 매출 전망을 읽었다'),
  # ad-hoc 의 'previous forecast 4.0 to 5.5' · 'midpoint … -3 to 0 percent' 는 이번 전망 아님 · 조정 영업이익률
  # 'about 4 percent' 는 operating_margin 칸의 값이 아니다(operating_margin_adjusted 칸 — MUST_HIT)
  ([], ADHOC, lambda g: g.get(('G', 'operating_margin', 'FY2026')) == (None, 1.0)
   and ('G', 'revenue_growth', 'FY2026') not in g, 'ad-hoc 에서 이전·조정 값을 읽었다'),
  # 조정 영업이익률 문장이 밝힌 연도(2025)가 전망 머리 연도(2026)와 다르면 이번 전망이 아니다 — FY2026 으로 찍지 않는다
  ([], ADHOC.replace('for the full year 2026 would amount to about 4 percent',
                     'for the full year 2025 would amount to about 4 percent'),
   lambda g: not any(k[:2] == ('G', 'operating_margin_adjusted') for k in g), '다른 연도의 조정 영업이익률을 읽었다'),
  # 전망 문단 끝('continues to pursue its objective') 뒤 브랜드 그룹 문단의 문장은 그룹 전망이 아니다 — 문단에서 빠진
  # 항목을 뒤 문단 값으로 메우지 않고 LLM 으로 넘긴다
  ([], OUT_9M.replace('expects an investment ratio of between 11 and 12 percent and ', 'expects ')
   + ' Further information on the brand groups: the Core brand group expects an investment ratio of around 6 percent.',
   lambda g: ('G', 'investment_ratio', 'FY2026') not in g and g[('H',)] is True, '전망 문단 밖 문장을 읽었다'),
  # 기간 낱말 없는 BSI 문장('… in 2025' = 연간)은 Q4|FY 판에서만 · 연도가 실적 표와 다른 문장은 버린다 — 9M 표 값은 그대로
  ([KPI_Q3], '14.8 billion EUR Operating Result before special effects in 2026. 8.8 billion EUR Operating Result before '
             'special items in 9M 2025',
   lambda g: not any(k[:2] == ('R', 'operating_result_bsi') for k in g) and g[('R', 'revenue', '2026-Q3')] == 75277.0,
   'Q4|FY 판이 아닌 문서의 연간 BSI·다른 연도 BSI 를 읽었다'),
  # BEV 표 World(240,200)를 전체 인도로 읽지 않는다 — 표 순서가 바뀌어도
  ([DELIV_BEV, DELIV_Q3], '', lambda g: g.get(('V', 'deliveries', 'total', '2026-Q3')) == 1885300, 'BEV 표 World 를 읽었다'),
  # 근사어(approximately·about)가 이전 전망 구절 안이면 읽지 않는다 — 이번 값(up to 1)만(Task 10)
  ([], ADHOC.replace('previous forecast 4.0 to 5.5 percent', 'previous forecast approximately 5 percent'),
   lambda g: g.get(('G', 'operating_margin', 'FY2026')) == (None, 1.0), 'ad-hoc 이전 전망의 근사 값을 읽었다'),
]
# 0행 · recognized 여야 하는 (이름, 표, 본문) — 서식 표식은 있는데 늘 있는 행·칸이 빠졌다
MUST_RECOGNIZED_EMPTY = [
  ('실적 표에 Operating result 행 없음', [[r for r in KPI_Q3 if r[0] != 'Operating result']], ''),
  ('실적 표 머리 꼴 변경(3Q)', [[['3Q', '9M'], *KPI_Q3[1:]]], ''),
  # 전망 문장은 읽히지만 실적 표가 깨졌으면 문서 전체를 비운다(전망만 적재된 반쪽 parsed 금지)
  ('실적 표 머리 꼴 변경 + 전망 문단', [[['3Q', '9M'], *KPI_Q3[1:]]], OUT_9M),
  ('실적 표 누계 낱말 어긋남(Q3 | H1)', [[['Q3', 'H1'], *KPI_Q3[1:]]], ''),
  ('실적 표 값 칸 하나 빠짐(위치 밀림)', [[*KPI_Q3[:8], ['Sales revenue', '75,277', '80,305', '233,378', '238,669', '-2.2'],
                                          *KPI_Q3[9:]]], ''),
  ('실적 표에 같은 행 두 번', [[*KPI_Q3, ['Sales revenue', '75,300', '80,305', '-6.2', '233,400', '238,669', '-2.2']]], ''),
  ('인도 표에 World 행 없음', [[DELIV_HEAD, DELIV_Q3[1]]], ''),
  ('인도 표 기간 칸 꼴 변경', [[[DELIV_HEAD[0], 'Q3 2026', *DELIV_HEAD[2:]], DELIV_Q3[2]]], ''),
]
# llm_wants (이름, 표, 본문, 기대)
LLM_WANTS = [
  ('전망 5항목 다 뽑음', [], OUT_9M, False),
  ('전망 머리는 있는데 순유동성 문장꼴 변경', [], OUT_9M.replace('Net liquidity in the Automotive Division is expected to range',
                                                          'Net liquidity should land'), True),
  ('실적 표는 있는데 전망 머리 없음', [KPI_Q3], '', True),
  ('ad-hoc 이사회 승인(전망 없음)', [], 'Ad hoc Supervisory Board Approves Comprehensive Future Plan for the Volkswagen Group', False),
  # ad-hoc 에서 영업이익률 문장만 꼴이 바뀜 — 나머지 3항목은 코드가 뽑지만 그 문장('previous forecast' 표식)이 안 덮인다
  ('ad-hoc 영업이익률 문장만 꼴 변경', [], ADHOC.replace('now expects to achieve an Operating Return on Sales of up to 1 percent',
                                                       'now targets an operating margin of at most 1 percent'), True),
  ('ad-hoc 전망 변경 다 뽑음', [], ADHOC, False),
  ('반기 판 previously 문장도 뽑음', [], OUT_H1, False),
  ('ad-hoc 전망 변경 머리만 있고 항목 0', [], 'Volkswagen AG is updating its forecast for fiscal year 2026 as follows: '
                                             'revenue to fall sharply.', True),
]
MUST_NOT_RECOGNIZED = [
  ('ad-hoc 예비 수치(전망 머리 없음)', [], 'Based on preliminary figures, Volkswagen AG generated net cash flow of around €6 '
                                           'billion in the Automotive Division in the 2025 fiscal year (2024: €5.0 billion).'),
  ('전기차 누적 인도 기념 보도자료', [[['VW ID.4 / ID.5', '901'], ['VW ID.3', '628']]], ''),
]


# 근사 낱말 보존(Task 15 Codex 대조) — (본문, metric, 기대 value_text). 숫자도 그대로여야 한다(MUST_HIT 가 본다).
# 1507(9M 보도자료)·1527(ad-hoc) 실물 문장 · 'between'·'up to' 는 근사가 아니라 None
APPROX_SAMPLES = [
  (OUT_9M, 'revenue', 'around €315 billion'),                  # 2026-10-29 9M 판(doc 1507)
  (ADHOC, 'revenue', 'around 315 billion'),                    # 2026-09-18 ad-hoc(doc 1527) — 'billion euros' 의 앞까지
  (OUT_9M, 'automotive_net_cash_flow', None),                  # 'between €3 billion and €6 billion'
  (OUT_9M, 'operating_margin', None),                          # 'up to 1 percent'
  (OUT_2025, 'automotive_net_liquidity', 'around EUR 30 billion'),
  (ADHOC, 'special_items', 'around 10 billion'),               # 'Special effects totaling around 10 billion euros'
  (ADHOC, 'operating_margin_adjusted', 'about 4 percent'),     # 'about' 도 근사 — 'would amount to about 4 percent'
  # Task 10 — 'approximately'·'about' 도 around 와 같은 근사(숫자 그대로 · 구절을 value_text)
  (OUT_9M.replace('of around €315', 'of approximately €315'), 'revenue', 'approximately €315 billion'),
  (OUT_9M.replace('of around €315', 'of about €315'), 'revenue', 'about €315 billion'),
]


def _flatten(r: ParseResult) -> dict:
  out = {('V', x.metric, x.region, x.period): x.value for x in r.volume}   # 지역 — 중국 행이 전체 행을 덮지 않게
  out.update({('R', x.metric, x.period): x.value for x in r.results})
  # 숫자가 있으면 숫자(근사 구절은 APPROX_SAMPLES 가 따로 본다) · 숫자 없는 문장 전망만 value_text
  out.update({('G', x.metric, x.period): ((x.low, x.high) if x.low is not None or x.high is not None else x.value_text)
              for x in r.guidance})
  out[('N',)] = len(r.volume) + len(r.results) + len(r.guidance)
  out[('H',)] = r.llm_hint
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'VOW3.DE', 'ir', 'earnings_release', '', '', '', '', '2026-10-29')
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
  for text, metric, want in APPROX_SAMPLES:
    row = next((g for g in parse_outlook(text)[0] if g.metric == metric), None)
    if row is None or row.value_text != want or (want and want not in row.quote):
      errs.append(f'APPROX {metric}: 기대 {want} · 실제 {row and row.value_text}')
  return errs
