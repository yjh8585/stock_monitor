"""국내 상장 4사 DART 공정공시 파서 — 월 판매 · 분기 잠정실적 · 연간 가이던스 서식 · IR 개최 일정.
+ LLM 만 읽는 IR PDF(llm_only — 현대·기아 가이던스 PDF·Investor Day · 모비스 IR 경영실적(수주 목표) · KGM CEO IR 설명회)
+ 코드가 읽는 모비스 영문 실적 Script(form='script' — 연간 수주 목표 문장 · Task 5).

출처·표본 = 참고/고객사/research/korea.md(2026-11-09 실측) + 계획서 phase2 Task 7 의 채록분.
본문은 lib.dart_api.document_text(태그 제거·공백 한 칸) 결과를 읽는다.

함정(실측):
  - 1월분 월 판매는 표가 하나(누계 표 없음) → 「다음 표 머리까지」가 아니라 「2. 정보제공」 앞까지 자른다.
  - 2025년분 서식엔 「실적기간」 줄이 없다 → 기간은 「당기실적 (2026년10월)」·「('26.10월)」 머리에서 읽는다.
  - 정정공시는 정정 전 값이 먼저 나온다 → 정정사항 표 «뒤»의 서식만 읽는다(가이던스·IR 일정은 마지막 매치).
  - KGM 은 월 판매와 분기 실적이 같은 제목 → 본문으로 가른다(kgm_kind).
  - 모비스는 월 판매 공시가 없다(부품사) — 분기 잠정실적·IR 일정만.
  - 4분기 실적 발표 IR 은 연간 발표라 일정 기간을 'YYYY-FY' 로 쓴다(base.DATE_PERIOD — 'YYYY-Q4' 는 버려진다).
  - 중장기 목표(Investor Day 장래사업)는 연간 가이던스 문구가 아니라 코드가 안 뽑는다 → recognized=False(LLM 몫 —
    llm_wants 가 참이라 LLM 이 못 돈 실행에선 오케스트레이터가 pending 으로 둔다).
  - 「알아봄」 은 행이 나왔는지가 아니라 서식 표식으로 판정한다(가이던스 G_ANNUAL · IR 개최목적 「분기」+「실적」 ·
    실적 필수 칸) — 문구가 바뀌어 0행이면 not_target 으로 조용히 닫히지 않고 failed 로 드러난다.
  - 국문 음수 표기 '△'(예 '△89')는 음수로 읽는다(lib.quote_check 와 같은 규칙). 2024-11~2026-11 DART 본문 303건엔
    '△' 가 없고 음수는 '-298' 꼴이다 — 서식이 바뀌어도 부호가 뒤집히지 않게 둔다.
"""
import re

from customer_parsers.base import (
  Content, Doc, EarningsDate, GuidanceRow, ParseResult, ResultRow, VolumeRow,
)

TICKERS = ('005380', '000270', '003620', '012330')
KGM = '003620'
MOBIS = '012330'

# (지역 키, 공시 행 라벨) — 순서대로 찾는다(합계 라벨 「계」 가 다른 행 이름 안에 있어서).
SALES_LABELS = {
  '005380': [('domestic', '국내'), ('overseas', '해외'), ('total', '계')],
  '000270': [('domestic', '판매대수(내수)'), ('overseas', '판매대수(해외)'),
             ('special', '판매대수(특수)'), ('total', '계')],
  '003620': [('domestic', '내수'), ('export', '수출'), ('ckd', 'CKD'), ('total', '총계')],
}
# 화면 「정의 차이」 상자 — 원문 문구와 기존 표(IR 엑셀 적재분) 대조(2026-11-10 Task 7 Step 4)로 확인한 것만 적는다.
SALES_DEFINITION = {
  '005380': '회사 발표 월 판매 — 판매 시장 기준(국내 시장·해외 시장). DART 영업(잠정)실적 공정공시 속보치로 전월 값은 '
            '다음 달 공시에서 고쳐진다. 공장별 IR 엑셀(생산지 × 내수·수출)과 나누는 기준이 달라 합계가 맞지 않는다',
  '000270': '회사 발표 월 판매(내수·해외·특수) — DART 영업(잠정)실적 공정공시의 가마감 수치(회사 표기)로 전월 값은 '
            '다음 달 공시에서 고쳐진다. 공장별 IR 엑셀과는 집계 범위가 달라 계가 맞지 않는다',
  '003620': '회사 발표 월 판매 — DART 영업(잠정)실적 공정공시의 잠정집계치(회사 표기)로 전월 값은 다음 달 공시에서 '
            '고쳐진다. 수출은 완성차만(CKD 는 따로) — IR 엑셀 「수출」 은 CKD 를 포함하고 총계는 같다',
}

_NUM = r'(?:-|△\s?)?\d[\d,]*'   # 정수 칸 — '△' 는 국문 음수 표기
_SALES_HEAD = re.compile(r'구분\s*\(단위\s*:\s*대')
_SALES_PERIOD = re.compile(r"당기실적\s*\((?:(\d{4})년\s*|'(\d{2})\.)(\d{1,2})월\)")
_UNIT = re.compile(r'단위\s*:\s*(백만원|억원|천원)')
_TO_MILLION = {'백만원': 1.0, '억원': 100.0, '천원': 0.001}
_RESULT_PERIOD = re.compile(r'당기실적\s+(\d{4})-(\d{2})-\d{2}\s*~\s*(\d{4})-(\d{2})-\d{2}')
# 실적기간 줄이 없는 2024~2025 서식 — 「(2024년 3분기 )」(괄호 안 끝 공백) · KGM 「('25년1분기)」(두 자리 연도)
_RESULT_PERIOD_OLD = re.compile(r"\('?(\d{4}|\d{2})년\s*([1-4])분기\s*\)")
_RESULT_FIRST = re.compile(r'(?:^|\s)매출액\s+당해실적\s+' + _NUM)
RESULT_ITEMS = [
  ('revenue', '매출액'),
  ('operating_income', '영업이익'),
  ('net_income', '당기순이익'),
  ('net_income_parent', '지배기업 소유주지분 순이익'),   # 별도 공시(KGM)엔 이 줄이 없다 — 선택 칸
]
# 이 칸을 못 찾으면 서식(라벨)이 바뀐 것 — 문서를 failed 로 드러낸다(빠진 칸만 조용히 비지 않게)
RESULT_REQUIRED = ('revenue', 'operating_income', 'net_income')

G_SALES_FORM = re.compile(r'(\d{4})년 판매목표\(대수\)\s+(\d[\d,]*)\s+-')
G_SALES_PLAN = re.compile(r'(\d{4})년 판매목표\s*:\s*(\d+(?:\.\d+)?)만\s*대')
G_REV_GROWTH = re.compile(
  r'(\d{4})년 연결 기준 매출액 성장률\(전년대비\)\s*:\s*(-?\d+(?:\.\d+)?)\s*~\s*(-?\d+(?:\.\d+)?)\s*%')
G_OPM = re.compile(r'영업이익률 목표\s*:\s*(\d+(?:\.\d+)?)(?:\s*~\s*(\d+(?:\.\d+)?))?\s*%')
G_REV_TARGET = re.compile(r'매출액 목표\s*:\s*(\d+(?:\.\d+)?)\s*조원')
G_OP_TARGET = re.compile(r'영업이익 목표\s*:\s*(\d+(?:\.\d+)?)\s*조원')
G_CAPEX = re.compile(r'(\d{4})년 투자계획\s*:\s*(\d+(?:\.\d+)?)\s*조원')
# 기아 연중 가이던스 업데이트(정정공시 정정후 서식 — 20241025800224): 매출·영업이익은 범위, 영업이익률은 「N% 이상」
_F = r'(\d+(?:\.\d+)?)'
G_PNL_GUIDE = re.compile(
  r'(\d{4})년 손익 가이던스\s*·\s*매출액\s*:\s*' + _F + r'\s*~\s*' + _F + r'\s*조원\s*·\s*영업이익\s*:\s*'
  + _F + r'\s*~\s*' + _F + r'\s*조원\s*·\s*영업이익률\s*:\s*' + _F + r'\s*%(\s*이상)?')

# 연간 가이던스 서식의 표식 — 숫자를 못 뽑아도 이 표식이 있으면 「알아본 서식」(문구가 바뀌면 failed 로 드러난다).
# 중장기(Investor Day) 장래사업 5건(2024-11~2026-08 실물)엔 0건 — 「2030년 … 목표」 꼴이라 걸리지 않는다.
G_ANNUAL = re.compile(r'\d{4}년\s*(판매\s*목표|손익\s*(사업계획|가이던스)|투자\s*계획)|영업실적\s*전망')

_IR = re.compile(
  r'일시\s+(\d{4}-\d{2}-\d{2})\s+(?:\d{2}:\d{2}|--:--).{0,200}?개최목적\s+(\d{4})년\s*([1-4])분기\s*경영실적\s*발표')
# 개최목적 칸(다음 「N. 」 항목 앞까지). 🔴 범위를 이 칸으로 묶는다 — NDR 공시도 「6. 주요 설명회내용」 에
# 「3분기 경영실적」 을 적는다(20261104800225).
_IR_PURPOSE = re.compile(r'개최목적\s+(.{0,120}?)(?=\s\d{1,2}\.\s|$)')

# 현대모비스 영문 실적 Script(2Q26~ · 2026-11-11 실물 두 회차 모두 이 문장): 「… representing 13% of the annual order target
# of USD 8.97 billion.」 — 앞 절의 「reached USD 1.15 billion on a cumulative basis」 는 누계 «실적»이라 읽지 않는다.
# 같은 Script 의 「annual order plan of USD 11.8 billion, including modules」 는 모듈 포함 다른 범위라 이 정규식 밖이다.
SCRIPT_FORM = 'script'
_SCRIPT_TARGET = re.compile(r'annual\s+order\s+target\s+of\s+USD\s*(\d+(?:\.\d+)?)\s*(billion|million)\b', re.I)
_YEAR = re.compile(r'\b(20\d{2})\b')
_DOC_QUARTER_YEAR = re.compile(r'\b(20\d{2})\s*[1-4]Q\b')   # 목록 제목 「2026 3Q Business Results Script」
_PARAGRAPH = re.compile(r'\n\s*\n')
_SENTENCE_END = re.compile(r'[.!?](?=\s)')   # 소수점(「8.97」)은 뒤가 숫자라 문장 끝이 아니다


def is_mobis_script(doc: Doc) -> bool:
  """현대모비스 영문 실적 Script(목록 어댑터 lib.ir_lists.parse_mobis_script → form='script') — 수주 목표 문장을 코드가
  읽는다(parse_script_order_target · Task 5)."""
  return doc.source == 'ir' and doc.ticker == MOBIS and doc.form == SCRIPT_FORM


def llm_only(doc: Doc) -> bool:
  """코드는 안 읽고 LLM 만 읽는 IR 문서(계획서 「회사별 코드/AI 표」 llm 칸 · Task 11):
  현대·기아 가이던스 PDF(IR JSON guidanceValue → doc_type guidance) · Investor Day(현대·기아 CEO Investor Day 포함 · D6) ·
  현대모비스 IR 경영실적 PDF(수주 목표) · KGM CEO IR 설명회 PDF(releaseList → investor_day). 분기 경영실적 발표자료
  (presentation)는 대상 밖 — 가이던스는 DART 전망 공시를 코드가 읽는다. 모비스 영문 Script 는 코드가 읽으니 빠진다."""
  return doc.source == 'ir' and doc.form != SCRIPT_FORM and (
    doc.doc_type in ('guidance', 'investor_day') or (doc.ticker == MOBIS and doc.doc_type == 'presentation'))


def wants(doc: Doc) -> bool:
  return is_mobis_script(doc) or llm_only(doc) or doc.source == 'dart' and doc.doc_type in (
    'prelim_results', 'earnings_release', 'guidance', 'ir_event')


def expects_numbers(doc: Doc, content: Content | None = None) -> bool:
  """숫자가 반드시 있어야 하는 문서(오케스트레이터가 not_target 이면 「서식 미인식」 으로 드러낸다 · 최종 검토 P4) —
  DART 영업(잠정)실적 공정공시(분기 잠정실적·월 판매 · doc_type prelim_results/earnings_release) · 현대모비스 영문 Script
  (실물 2회차 모두 수주 목표 문장이 있다 — 문구가 바뀌어 못 읽으면 조용히 닫히지 않고 경고 · 결정 E7 2026-11-11).
  IR 개최 공고(NDR 등)·가이던스(중장기는 LLM 몫)는 숫자 없는 not_target 이 정상이라 빠진다.
  실측(2026-11-10): prelim_results 110건 전부 parsed. content(본문)는 훅 서명을 맞추려 받기만 한다(EDGAR 파서용)."""
  return is_mobis_script(doc) or doc.source == 'dart' and doc.doc_type in ('prelim_results', 'earnings_release')


def _int(s: str) -> int:
  """'1,234' → 1234 · '-298' → -298 · '△89'·'△ 89' → -89."""
  s = s.replace(',', '').replace(' ', '')
  return -int(s[1:]) if s.startswith('△') else int(s)


def _restated(text: str) -> str:
  """정정공시면 정정후 전체 서식만(정정사항 표 뒤 「※ 동 정보는 …」 머리부터) 돌려준다. 아니면 본문 그대로.
  🔴 정정사항 표엔 정정전·정정후 칸이 나란히 있고, 정정후 칸 문구가 원래 서식과 다를 수 있다 — 기아 2024-10-25
  정정(20241025800224)은 정정전 「매출액 목표 : 101.1조원」·정정후 「손익 가이던스 · 매출액 : 105~110조원」이라
  표째 읽으면 옛 목표만 걸려 그날의 가이던스로 둔갑했다. 머리가 없으면 정정사항 표 뒤부터(마지막 매치가 정정후)."""
  i = text.find('정정사항')
  if i < 0:
    return text
  j = text.find('※ 동 정보는', i)
  return text[j:] if j >= 0 else text[i:]


def _shift_month(ym: str, delta: int) -> str:
  y, m = map(int, ym.split('-'))
  m += delta
  while m < 1:
    y, m = y - 1, m + 12
  return f'{y}-{m:02d}'


def kgm_kind(text: str) -> str | None:
  """KGM 「영업(잠정)실적(공정공시)」 본문 → 'sales'(월 판매) · 'results'(분기 실적) · None(둘 다 아님).
  🔴 KGM 은 월 판매와 분기 실적이 같은 제목이라 제목으로는 못 가른다. 분기 실적은 「매출액 당해실적 <숫자>」,
  월 판매는 「구분 (단위: 대 …)」 표에 숫자 행이 있다(월 판매 공시의 손익 표는 「매출액 당해실적 - -」 로 빈다).
  IR 확장(발표자료 날짜 근거)이 같은 판정을 다시 쓴다 — 이름·반환값을 바꾸지 말 것."""
  if _RESULT_FIRST.search(text):
    return 'results'
  head = _SALES_HEAD.search(text)
  if head and re.search(r'\s' + _NUM + r'\s', text[head.end():head.end() + 400]):
    return 'sales'
  return None


def sales_period(text: str) -> str | None:
  m = _SALES_PERIOD.search(text)
  if not m:
    return None
  year = int(m.group(1)) if m.group(1) else 2000 + int(m.group(2))
  return f'{year}-{int(m.group(3)):02d}'


def parse_sales(ticker: str, text: str) -> tuple[list[VolumeRow], bool]:
  """월 판매 → (행, 서식을 알아봤나). 당기·전기 두 달을 같이 낸다(전월 값은 다음 공시에서 바뀐다 — 최신으로 덮는다)."""
  labels = SALES_LABELS.get(ticker)
  text = _restated(text)
  head = _SALES_HEAD.search(text)
  if labels is None or head is None:
    return [], False
  start = head.start()
  end = text.find('2. 정보제공', start)
  sec = text[start:end if end > 0 else len(text)]
  period = sales_period(sec) or sales_period(text)
  if period is None:
    return [], True
  cur: dict[str, int] = {}
  prev: dict[str, int] = {}
  quotes: dict[str, str] = {}
  pos = 0
  for key, label in labels:
    m = re.compile(r'(?:^|\s)' + re.escape(label) + r'\s+(' + _NUM + r')\s+(' + _NUM + r')').search(sec, pos)
    if not m:
      return [], True
    cur[key], prev[key] = _int(m.group(1)), _int(m.group(2))
    quotes[key] = m.group(0).strip()
    pos = m.end()
  parts = [k for k, _ in labels if k != 'total']
  for col in (cur, prev):
    if sum(col[k] for k in parts) != col['total']:
      return [], True  # 검산 실패 = 표 구조가 바뀌었다
  rows = []
  for p, col in ((period, cur), (_shift_month(period, -1), prev)):
    for key, _ in labels:
      rows.append(VolumeRow('sales', key, 'month', p, col[key], SALES_DEFINITION[ticker], quotes[key]))
  return rows, True


def parse_results(text: str) -> tuple[list[ResultRow], bool]:
  """분기 잠정실적(연결 또는 별도) → 백만원 환산 행."""
  body = _restated(text)
  unit = _UNIT.search(body)
  if not _RESULT_FIRST.search(body) or not unit:
    return [], False
  m = _RESULT_PERIOD.search(body)
  if m and int(m.group(1)) == int(m.group(3)) and int(m.group(4)) - int(m.group(2)) == 2:
    period = f'{m.group(3)}-Q{int(m.group(4)) // 3}'
  else:
    old = _RESULT_PERIOD_OLD.search(body)
    if not old:
      return [], True
    year = old.group(1) if len(old.group(1)) == 4 else f'20{old.group(1)}'
    period = f'{year}-Q{old.group(2)}'
  factor = _TO_MILLION[unit.group(1)]
  # 본문 앞머리는 xforms CSS 라 앞부분만 보면 안 된다(실측: 현대 연결 공시를 별도로 오판).
  separate = '별도 재무제표' in body or '연결' not in body
  rows = []
  for metric, label in RESULT_ITEMS:
    r = re.search(r'(?:^|\s)' + re.escape(label) + r'\s+당해실적\s+(' + _NUM + ')', body)
    if not r:
      if metric in RESULT_REQUIRED:
        return [], True   # 필수 칸 라벨이 바뀌었다 — 나머지 칸만 적재해 parsed 로 숨지 않게 문서를 failed 로
      continue
    rows.append(ResultRow(
      metric=metric, metric_name=label + (' (별도)' if separate else ''), basis='reported',
      period_grain='quarter', period=period, value=_int(r.group(1)) * factor,
      unit='million', currency='KRW', quote=r.group(0).strip()))
  return rows, True


def _year_before(text: str, pos: int, window: int = 80) -> str | None:
  hits = re.findall(r'(\d{4})년', text[max(0, pos - window):pos])
  return hits[-1] if hits else None


def _last(rx: re.Pattern, text: str):
  found = list(rx.finditer(text))
  return found[-1] if found else None


def parse_guidance(text: str) -> tuple[list[GuidanceRow], bool]:
  """연간 가이던스 서식(전망 공시·장래사업). 정정공시는 마지막 서식이 정정 후 값이다.
  알아봄 = 행이 나왔거나 연간 서식 표식(G_ANNUAL)이 걸렸다 — 표식은 있는데 0행이면 숫자 문구가 바뀐 것이라
  failed 로 드러난다. 중장기(Investor Day) 장래사업은 표식도 없어 recognized=False(그 숫자는 LLM 몫 — llm_wants)."""
  text = _restated(text)
  out: list[GuidanceRow] = []
  m = _last(G_SALES_FORM, text)
  if m:
    v = _int(m.group(2))
    out.append(GuidanceRow('sales_units', '판매목표(대수)', f'FY{m.group(1)}', v, v, None, 'units', None,
                           m.group(0).rstrip(' -').strip()))
  m = _last(G_SALES_PLAN, text)
  if m:
    v = round(float(m.group(2)) * 10_000)
    out.append(GuidanceRow('sales_units', '판매목표', f'FY{m.group(1)}', v, v, None, 'units', None, m.group(0)))
  m = _last(G_REV_GROWTH, text)
  if m:
    out.append(GuidanceRow('revenue_growth', '연결 기준 매출액 성장률(전년대비)', f'FY{m.group(1)}',
                           float(m.group(2)), float(m.group(3)), None, 'percent', 'reported', m.group(0)))
  for rx, metric, label, unit in (
    (G_OPM, 'operating_margin', '영업이익률 목표', 'percent'),
    (G_REV_TARGET, 'revenue', '매출액 목표', 'trillion'),
    (G_OP_TARGET, 'operating_income', '영업이익 목표', 'trillion'),
  ):
    m = _last(rx, text)
    if not m:
      continue
    year = _year_before(text, m.start())
    if year is None:
      continue
    low = float(m.group(1))
    high = float(m.group(2)) if m.lastindex and m.lastindex >= 2 and m.group(2) else low
    out.append(GuidanceRow(metric, label, f'FY{year}', low, high, None, unit,
                           'reported' if '연결 기준' in text[max(0, m.start() - 40):m.start()] else None,  # 연결 여부는 label 로
                           m.group(0)))
  m = _last(G_CAPEX, text)
  if m:
    v = float(m.group(2))
    out.append(GuidanceRow('capex', '투자계획', f'FY{m.group(1)}', v, v, None, 'trillion', None, m.group(0)))
  m = _last(G_PNL_GUIDE, text)
  if m:
    fy, q = f'FY{m.group(1)}', m.group(0)
    opm_low = float(m.group(6))
    out += [
      GuidanceRow('revenue', '매출액', fy, float(m.group(2)), float(m.group(3)), None, 'trillion', None, q),
      GuidanceRow('operating_income', '영업이익', fy, float(m.group(4)), float(m.group(5)), None, 'trillion', None, q),
      GuidanceRow('operating_margin', '영업이익률' + (' (이상)' if m.group(7) else ''), fy, opm_low,
                  None if m.group(7) else opm_low, None, 'percent', None, q),
    ]
  return out, bool(out) or bool(G_ANNUAL.search(text))


def llm_wants(doc: Doc, res: ParseResult) -> bool:
  """코드가 숫자를 못 뽑는 가이던스 문서(중장기 Investor Day 등)와 LLM 만 읽는 IR 문서는 LLM 이 읽는다."""
  return llm_only(doc) or doc.doc_type == 'guidance' and not res.guidance


BASE_CURRENCY = 'KRW'   # 보고 통화(LLM 행 통화 검사 기준) — 모비스 IR 수주 목표는 USD 라 LLM 이 currency 를 적는다
_HINT_DART = ('공시 서식의 연간 전망·목표(판매·매출·영업이익·투자 등)와 연도가 밝혀진 중장기 목표만. 분기 실적·전년 실적은 '
              '뽑지 마세요.')
_HINT_IR = {
  MOBIS: '연간 수주 목표(order_intake — 핵심부품 해외 수주 등 원문 이름은 metric_label 에 그대로)와 연도가 밝혀진 중장기 '
         '목표만. 분기·누적 수주 «실적»은 목표가 아니니 뽑지 마세요.',
  KGM: '「20XX년 사업계획」의 판매(대수)·매출 목표만. 분기 실적은 뽑지 마세요.',
}
_HINT_IR_OEM = ('잉여현금흐름(FCF)·주주환원·투자 등 «DART 전망 공시에 없는» 연간 항목과 연도가 밝혀진 중장기 목표만. 연간 '
                '판매대수·매출 성장률·영업이익률은 DART 공시를 코드가 따로 읽으니 뽑지 마세요.')


def LLM_HINT(doc: Doc) -> str:  # noqa: N802 — 오케스트레이터가 모듈 속성 LLM_HINT 를 찾는다(문자열 또는 함수)
  if doc.source != 'ir':
    return _HINT_DART
  return _HINT_IR.get(doc.ticker, _HINT_IR_OEM)


def parse_ir_date(text: str) -> tuple[list[EarningsDate], bool]:
  """IR 개최 안내공시 → 실적 발표일. NDR·컨퍼런스(개최목적에 「분기 경영실적 발표」 없음)는 건너뛴다.
  4분기 발표 = 연간 발표 → 'YYYY-FY'. 정정공시는 정정 후 서식이 뒤에 오므로 마지막 매치.
  알아봄 = 일시까지 읽었거나, 개최목적 칸에 「분기」 와 「실적」 이 있다(문구가 바뀌어 0행이면 failed 로 드러난다)."""
  m = _last(_IR, text)
  if not m:
    purpose = _last(_IR_PURPOSE, text)
    return [], bool(purpose and '분기' in purpose.group(1) and '실적' in purpose.group(1))
  year, q = m.group(2), m.group(3)
  period = f'{year}-FY' if q == '4' else f'{year}-Q{q}'
  return [EarningsDate(period, m.group(1), m.group(0))], True


def _script_year(text: str, m: re.Match, doc_year: int | None) -> int | None:
  """수주 목표 문장의 연도. ① 같은 문장 안 매치 앞의 가장 가까운 연도(「For 2027, we set an annual order target …」)
  → ② 없으면 같은 문단(빈 줄 사이)의 연도가 하나일 때 그것 → ③ 문단에 연도가 없으면 문서 분기의 연도(목록 제목).
  문단에 서로 다른 연도가 둘 이상인데 문장에 연도가 없으면 None(어느 해 목표인지 원문으로 못 가린다 — 4분기 Script 가
  다음 해 1월에 「… in 2026. … annual order target …」 꼴로 오면 FY 를 잘못 붙인다). 문서 밖 연도는 쓰지 않는다."""
  start = max((p.end() for p in _PARAGRAPH.finditer(text, 0, m.start())), default=0)
  sent = max((s.end() for s in _SENTENCE_END.finditer(text, start, m.start())), default=start)
  before = _YEAR.findall(text, sent, m.start())
  if before:
    return int(before[-1])
  nxt = _PARAGRAPH.search(text, m.end())
  years = set(_YEAR.findall(text, start, nxt.start() if nxt else len(text)))
  if len(years) == 1:
    return int(next(iter(years)))
  return doc_year if not years else None


def parse_script_order_target(text: str, doc_year: int | None) -> tuple[list[GuidanceRow], bool]:
  """현대모비스 영문 Script 본문 → 연간 수주 목표(order_intake · USD · 코드 행). 연도 = _script_year — 못 정하면 행을
  만들지 않는다(알아봤는데 0행 = failed 로 드러난다). 알아봄 = 목표 문장이 있다 — 없으면 recognized=False 이고,
  Script 는 expects_numbers 가 참이라 오케스트레이터가 「서식 미인식」 으로 경고한다(문구 변경이 조용히 닫히지 않게 · E7)."""
  out = []
  matches = list(_SCRIPT_TARGET.finditer(text))
  for m in matches:
    year = _script_year(text, m, doc_year)
    if year is None:
      continue
    v = float(m.group(1))
    out.append(GuidanceRow('order_intake', 'annual order target', f'FY{year}', v, v, None, m.group(2).lower(), None,
                           ' '.join(m.group(0).split()), currency='USD'))
  return out, bool(matches)


def _doc_quarter_year(title: str) -> int | None:
  m = _DOC_QUARTER_YEAR.search(title or '')
  return int(m.group(1)) if m else None


def parse(doc: Doc, content: Content) -> ParseResult:
  text = content.text
  res = ParseResult()
  if is_mobis_script(doc):
    res.guidance, res.recognized = parse_script_order_target(text, _doc_quarter_year(doc.title))
    return res
  if llm_only(doc):
    return res   # IR 발표자료 — 코드가 읽지 않는다(llm_wants 가 참 · LLM 행이 없으면 not_target)
  if doc.doc_type == 'ir_event':
    res.dates, res.recognized = parse_ir_date(text)
    return res
  if doc.doc_type == 'guidance':
    res.guidance, res.recognized = parse_guidance(text)
    # 연간 서식 표식(G_ANNUAL)은 걸렸는데 숫자 0행 = 문구 미스(LLM 이 채워도 note 에 드러낸다). 중장기 장래사업은 표식이
    # 없어 recognized=False — 원래 LLM 몫이라 문구 미스가 아니다
    res.code_miss = res.recognized and not res.guidance
    return res
  kind = kgm_kind(text) if doc.ticker == KGM else None
  sales_ok = results_ok = False
  if kind != 'results':
    res.volume, sales_ok = parse_sales(doc.ticker, text)
  if kind != 'sales':
    res.results, results_ok = parse_results(text)
  res.recognized = sales_ok or results_ok
  if (sales_ok and not res.volume) or (results_ok and not res.results):
    # 한쪽이 서식은 알아봤는데 0행(검산 실패·라벨 변경) — 다른 쪽 행이 있어도 문서를 failed 로 드러낸다
    res.volume, res.results = [], []
  return res


# ---------------------------------------------------------------- 자가 시험
# 행 값 = korea.md 표본 원문 그대로. 앞의 표 머리(「구분 (단위…) 당기실적 (…)」)는 같은 공시 본문에서 그대로 옮겼다
# (2026-11-09 채록: 현대 20261102800520·20250203800835 · 기아 20261102800493·20250203800774 · KGM 20261102800582).
# 🔴 머리 띄어쓰기가 회사마다 다르다 — 현대 `구분(단위:대,%)` · 기아 `구분 (단위:대,%)` · KGM `구분 (단위: 대, %)`·`(2026년 10월)`.
_HEAD_2610 = '구분(단위:대,%) 당기실적 (2026년10월) 전기실적 (2026년9월) 전기대비 증감율(%) 흑자적자전환여부 전년동기실적 (2025년10월) 전년동기 대비 증감율(%) 흑자적자전환여부 '
# KGM 10월 판매 본문(20261102800582) — 손익 표가 「- -」 로 비고 판매 표가 뒤에 온다(kgm_kind 'sales' 표본)
_KGM_2610 = ('1. 실적내용 단위 : 백만원, % 구분 당기실적 전기실적 전기대비 전년동기실적 전년동기대비 () () 증감율(%) '
             '흑자적자전환여부 () 증감율(%) 흑자적자전환여부 매출액 당해실적 - - - - - - - 누계실적 - - - - - - - '
             '영업이익 당해실적 - - - - - - - 누계실적 - - - - - - - '
             '구분 (단위: 대, %) 당기실적 (2026년 10월) 전기실적 (2026년 09월) 전기 대비 증감율 (%) - 전년동기 실적 (2025년 10월) 전년동기대비 증감율(%) - '
             '내수 2,037 2,100 -3.0% - 3,537 -42.4% - 수출 4,440 6,703 -33.8% - 5,980 -25.8% - 완성차 계 6,477 8,803 -26.4% - 9,517 -31.9% - '
             'CKD 60 60 0.0% - 0 - - 총계 6,537 8,863 -26.2% - 9,517 -31.3% -')
MUST_HIT_SALES = [
  ('005380', _HEAD_2610 + '국내 49,042 49,022 0.04 - 53,822 -8.9 - 해외 280,731 261,026 7.5 - 298,261 -5.9 - 계 329,773 310,048 6.4 - 352,083 -6.3 -',
   {('2026-10', 'domestic'): 49042, ('2026-10', 'overseas'): 280731, ('2026-10', 'total'): 329773,
    ('2026-09', 'overseas'): 261026}),
  ('005380', '구분(단위:대,%) 당기실적 (2025년1월) 전기실적 (2024년12월) 전기대비 증감율(%) 전년동기실적 (2024년1월) 전년동기 대비증감율(%) ' + '국내 46,054 61,323 -24.9 49,810 -7.5 해외 264,345 268,967 -1.7 268,013 -1.4 계 310,399 330,290 -6.0 317,823 -2.3',
   {('2025-01', 'total'): 310399, ('2024-12', 'overseas'): 268967}),
  ('000270', "구분 (단위:대,%) 당기실적 ('26.10월) 전기실적 ('26.9월) 전기대비 증감율 (%) - 전년동기실적 ('25.10월) 전년동기대비 증감율 (%) - " + '판매대수(내수) 51,007 45,705 +11.6 - 40,001 +27.5 - 판매대수(해외) 239,308 236,125 +1.3 - 223,215 +7.2 - 판매대수(특수) 904 745 +21.3 - 801 +12.9 - 계 291,219 282,575 +3.1 - 264,017 +10.3 -',
   {('2026-10', 'domestic'): 51007, ('2026-10', 'special'): 904, ('2026-10', 'total'): 291219}),
  # 기아 구서식(20250203800774 — 「흑자적자전환여부」 열 없음 · 1월분이라 표 하나)
  ('000270', "구분(단위:대,%) 당기실적 ('25.1월) 전기실적 ('24.12월) 전기대비 증감율(%) 전년동기실적 ('24.1월) 전년동기대비 증감율(%) "
   '판매대수(내수) 38,403 46,070 -16.6 44,608 -13.9 판매대수(해외) 200,993 193,769 +3.7 200,794 +0.1 '
   '판매대수(특수) 175 616 -71.6 184 -4.9 계 239,571 240,455 -0.4 245,586 -2.4',
   {('2025-01', 'domestic'): 38403, ('2024-12', 'domestic'): 46070, ('2025-01', 'total'): 239571}),
  ('003620', _KGM_2610, {('2026-10', 'export'): 4440, ('2026-10', 'ckd'): 60, ('2026-10', 'total'): 6537}),
]
# DART 20261029800228(현대 3Q26 연결) · 20261104800215(KGM 3Q26 별도·억원) · 20241025800215(기아 구서식 「(2024년 3분기 )」) ·
# 20250424800433(KGM 구서식 「('25년1분기)」) 본문에서 그대로 옮김.
_KGM_3Q26 = ('영업(잠정)실적(공정공시) 실적기간 당기실적 2026-07-01 ~ 2026-09-30 전기실적 2026-04-01 ~ 2026-06-30 1. 실적내용 '
             '단위 : 억원, % 구분 당기실적 전기실적 전기대비 전년동기실적 전년동기대비 (2026년 3분기) (2026년 2분기) 증감율(%) '
             '흑자적자전환여부 (2025년 3분기) 증감율(%) 흑자적자전환여부 매출액 당해실적 9,941 11,823 -15.9 - 11,889 -16.4 - '
             '누계실적 33,129 - - - 31,321 5.8 - 영업이익 당해실적 -298 88 - 적자전환 30 - 적자전환 '
             '법인세비용차감전계속사업이익 당해실적 -1,325 176 - 적자전환 110 - 적자전환 누계실적 -774 - - - 221 - 적자전환 '
             '당기순이익 당해실적 -1,332 176 - 적자전환 105 - 적자전환 누계실적 -780 - - - 215 - 적자전환 '
             '- 상기 실적은 한국채택국제회계기준(K-IFRS)에 따라 작성된 별도 재무제표로')
# 현대 3Q26 연결(20261029800228) — 영업이익 누계 줄은 생략하고 이었다(행 값은 원문 그대로)
_HMC_3Q26 = (
  '연결재무제표 기준 영업(잠정)실적(공정공시) 실적기간 당기실적 2026-07-01 ~ 2026-09-30 전기실적 2026-04-01 ~ 2026-06-30 '
  '1. 연결실적내용 단위 : 백만원, % 구분 당기실적 전기실적 전기대비 전년동기실적 전년동기대비 (2026년 3분기) (2026년 2분기) '
  '증감율(%) 흑자적자전환여부 (2025년 3분기) 증감율(%) 흑자적자전환여부 매출액 당해실적 45,110,247 49,215,328 -8.3 - '
  '46,721,448 -3.4 - 누계실적 140,264,461 - - - 139,415,886 0.6 - 영업이익 당해실적 2,677,232 2,850,888 -6.1 - '
  '2,537,266 5.5 - 법인세비용차감전계속사업이익 당해실적 2,906,622 3,645,740 -20.3 - 3,325,963 -12.6 - '
  '누계실적 10,073,873 - - - 12,175,904 -17.3 - 당기순이익 당해실적 1,931,746 2,887,962 -33.1 - 2,548,183 -24.2 - '
  '누계실적 7,404,634 - - - 9,180,747 -19.3 - 지배기업 소유주지분 순이익 당해실적 1,704,370')
MUST_HIT_RESULTS = [
  (_HMC_3Q26,
   {('revenue', '2026-Q3'): 45110247.0, ('operating_income', '2026-Q3'): 2677232.0,
    ('net_income', '2026-Q3'): 1931746.0, ('net_income_parent', '2026-Q3'): 1704370.0}, '매출액'),
  (_KGM_3Q26, {('revenue', '2026-Q3'): 994100.0, ('operating_income', '2026-Q3'): -29800.0,
               ('net_income', '2026-Q3'): -133200.0}, '매출액 (별도)'),
  # 기아 2024 3Q — 영업이익 이후 줄(전기 이하·법인세 줄)은 생략하고 당기순이익 줄을 이었다
  ('연결재무제표 기준 영업(잠정)실적(공정공시) 1. 연결실적내용 단위 : 백만원, % 구분 당기실적 전기실적 전기대비증감율(%) '
   '전년동기실적 전년동기대비증감율(%) (2024년 3분기 ) (2024년 2분기 ) (2023년 3분기 ) 매출액 당해실적 26,519,877 '
   '27,567,907 -3.8 25,545,392 +3.8 누계실적 80,300,635 53,780,758 - 75,480,266 +6.4 영업이익 당해실적 2,881,280 '
   '당기순이익 당해실적 2,267,912 2,956,622 -23.3 2,221,005 +2.1',
   {('revenue', '2024-Q3'): 26519877.0, ('operating_income', '2024-Q3'): 2881280.0,
    ('net_income', '2024-Q3'): 2267912.0}, '매출액'),
  # KGM 25Q1 — 법인세 줄은 생략하고 당기순이익 줄을 이었다
  ("영업(잠정)실적(공정공시) 1. 실적내용 단위 : 억원, % 구분 당기실적 전기실적 전기대비증감율(%) 전년동기실적 "
   "전년동기대비증감율(%) ('25년1분기) ('24년4분기 ) ('24년1분기 ) 매출액 당해실적 9,070 9,732 -6.80 9,814 -7.58 "
   '누계실적 9,070 37,825 - 9,814 -7.58 영업이익 당해실적 106 207 -48.79 173 -38.73 '
   '당기순이익 당해실적 85 52 63.46 561 -84.85 '
   '- 상기 실적은 한국채택국제회계기준(K-IFRS)에 따라 작성된 별도 재무제표로',
   {('revenue', '2025-Q1'): 907000.0, ('operating_income', '2025-Q1'): 10600.0,
    ('net_income', '2025-Q1'): 8500.0}, '매출액 (별도)'),
  # 가상 — 국문 음수 표기 '△'(DART 본문 303건엔 없다 · lib.quote_check 와 같은 규칙으로 음수)
  (_KGM_3Q26.replace('영업이익 당해실적 -298', '영업이익 당해실적 △298'),
   {('operating_income', '2026-Q3'): -29800.0}, '매출액 (별도)'),
]
# KGM 판정 — 같은 제목(영업(잠정)실적)의 월 판매·분기 실적·그 밖
MUST_KGM_KIND = [(_KGM_2610, 'sales'), (_KGM_3Q26, 'results'),
                 ('1. 일시 및 장소 일시 2026-11-04 14:00 장소 - 3. 개최목적 2026년 3분기 경영실적 발표', None)]
# 가이던스 — 행 전부가 기대값과 같아야 한다(정정전 옛 값이 덤으로 붙는 것도 실패)
MUST_HIT_GUIDANCE = [
  # 20260129800348 (현대 장래사업, 2026-01-29) — korea.md 표본
  ('·2026년 판매목표 : 416만대 ·2026년 연결 기준 매출액 성장률(전년대비) : 1.0 ~ 2.0% 수준 ·2026년 연결 기준 영업이익률 목표 : 6.3 ~ 7.3% 수준 ·2026년 투자계획 : 17.8조원',
   {('sales_units', 'FY2026'): (4160000, 4160000), ('revenue_growth', 'FY2026'): (1.0, 2.0),
    ('operating_margin', 'FY2026'): (6.3, 7.3), ('capex', 'FY2026'): (17.8, 17.8)}),
  # 20261029800240 (현대 전망 정정, 2026-10-29) — 정정사항 표(정정전 4,158,300) 뒤 서식이 정정후 4,000,000
  ('4. 정정사항 정정항목 정정전 정정후 2026년 판매목표(대수) 4,158,300 4,000,000 2026년 판매목표(대수)-국내 700,000 664,000 '
   '2026년 판매목표(대수)-해외 3,458,300 3,336,000 ※ 관련공시 - 2026-01-05 영업실적 등에 대한 전망(공정공시) - '
   '영업실적 등에 대한 전망(공정공시) ※ 동 정보는 예측정보로서 향후 실제 결과와는 다를 수 있음 1. 영업실적 전망 내용 '
   '구분(단위 : 억원) 2026 사업연도 2027 사업연도 2028 사업연도 대상기간 시작일 - - - 종료일 - - - 매출액 - - - '
   '영업이익 - - - 법인세비용차감전계속사업이익 - - - 당기순이익 - - - 2026년 판매목표(대수) 4,000,000 - - -국내 664,000 - - -해외 3,336,000 - -',
   {('sales_units', 'FY2026'): (4000000, 4000000)}),
  # 20260105800035 (기아 전망, 2026-01-05) · 20260128800332 (기아 사업계획, 2026-01-28) — korea.md 표본
  ('2026년 판매목표(대수) 3,350,000 - - - 국내 565,000 - - - 해외 2,775,000 - - - 특수사업 10,000 - -',
   {('sales_units', 'FY2026'): (3350000, 3350000)}),
  ('◎ 2026년 손익 사업계획 · 매출액 목표 : 122.3조원 · 영업이익 목표 : 10.2조원 · 영업이익률 목표 : 8.3%',
   {('revenue', 'FY2026'): (122.3, 122.3), ('operating_income', 'FY2026'): (10.2, 10.2),
    ('operating_margin', 'FY2026'): (8.3, 8.3)}),
  # 20241025800224 (기아 장래사업 정정, 2024-10-25) — 정정사항 표의 정정전 「사업계획 101.1조원」 이 아니라
  # 정정후 서식(「※ 동 정보는」 뒤)의 「손익 가이던스」 범위만. 영업이익률은 「12.0% 이상」 → 하한만
  ('4. 정정사항 정정항목 정정전 정정후 1. 장래계획 사항 기아 2024년 사업계획 기아 2024년 가이던스 2.주요내용 및 추진 일정 - '
   '세부내용 ◎ 2024년 손익 사업계획 · 매출액 목표 : 101.1조원 · 영업이익 목표 : 12.0조원 · 영업이익률 목표 : 11.9% '
   '◎ 2024년 손익 가이던스 · 매출액 : 105~110조원 · 영업이익 : 12.8~13.2조원 · 영업이익률 : 12.0% 이상 2.주요내용 및 추진 일정 - 기대효과 '
   '※ 동 정보는 장래 계획사항으로서 향후 변경될 수 있음 1. 장래계획 사항 기아 2024년 가이던스 2. 주요내용 및 추진일정 목적 '
   '2024년 가이던스 업데이트를 통한 투자자 이해 제고 세부내용 ◎ 2024년 손익 가이던스 · 매출액 : 105~110조원 · '
   '영업이익 : 12.8~13.2조원 · 영업이익률 : 12.0% 이상 추진일정 시작일 2024-01-01 종료일 2024-12-31',
   {('revenue', 'FY2024'): (105.0, 110.0), ('operating_income', 'FY2024'): (12.8, 13.2),
    ('operating_margin', 'FY2024'): (12.0, None)}),
]
# 코드가 뽑으면 안 되는 문구 — 중장기 목표(LLM 몫)
MUST_MISS_GUIDANCE = [
  '중장기(2030년) 영업이익률 목표 : 9+α%',                                  # 20260826800246 현대 Investor Day
  '재무 목표 1. 매출액 2028년 : 150조원 2030년 : 170조원 2. 영업이익 / 영업이익률 2028년 : 13.5조원 / 9% 2030년 : 17.0조원 / 10%',  # 20260409800576 기아
]
MUST_HIT_IR = [
  ('1. 일시 및 장소 일시 2026-10-29 14:10 장소 - 2. 참가 대상자 기관 투자가 및 애널리스트 3. 개최목적 2026년 3분기 경영실적발표 4.',
   ('2026-Q3', '2026-10-29')),   # 20261022800377 현대
  ('1. 일시 및 장소 일시 2026-10-30 --:-- 장소 서울 2. 참가 대상자 애널리스트, 기관투자자, 언론 外 3. 개최목적 2026년 3분기 경영실적 발표',
   ('2026-Q3', '2026-10-30')),   # 20261014800271 기아 — 시각이 --:--
  ('1. 일시 및 장소 일시 2026-01-29 14:10 장소 - 2. 참가 대상자 기관 투자가 및 애널리스트 3. 개최목적 2025년 4분기 경영실적발표 4.',
   ('2025-FY', '2026-01-29')),   # 20260122800148 현대 — 4분기 발표 = 연간 발표(일정 기간 'YYYY-FY')
]
MUST_MISS_IR = [  # 20261104800225 NDR — 「주요 설명회내용」 에 「3분기 경영실적」 이 있어도 개최목적이 아니다
  '1. 일시 및 장소 일시 2026-11-04 09:00 장소 유럽/미국/아시아 2. 참가 대상자 해외 주요 기관 투자가 3. 개최목적 해외지역 방문 IR '
  '(Non-Deal Roadshow) 실시 4. 개최방법 투자자 면담 (One-on-One 및 소그룹) 5. 후원기관 CLSA/Macquarie/Morgan Stanley '
  '6. 주요 설명회내용(요약) 2026년 3분기 경영실적 설',
]
# 「알아봤는데 0행」 이어야 하는 표본 — 문구가 바뀐 것이 not_target 으로 조용히 닫히지 않고 failed 로 드러나는지
MUST_RECOGNIZED_EMPTY = [
  ('실적: 필수 칸 라벨 변경', lambda: parse_results(_HMC_3Q26.replace('당기순이익 당해실적', '분기순이익 당해실적'))),
  ('가이던스: 숫자 문구 변경', lambda: parse_guidance('·2026년 판매목표 : 약 416만대 수준 ·2026년 투자계획 : 미정')),
  ('IR: 일시 칸 변경', lambda: parse_ir_date(
    '1. 일시 및 장소 일시 2026년 10월 29일 오후 2시 장소 - 2. 참가 대상자 기관 투자가 및 애널리스트 '
    '3. 개최목적 2026년 3분기 경영실적발표 4. 개최방법 컨퍼런스콜')),
]
# 알아보면 안 되는 표본 — 중장기 Investor Day(20260826800246 원문) · NDR(MUST_MISS_IR)
MUST_UNRECOGNIZED = [
  ('가이던스: 중장기 Investor Day', lambda: parse_guidance(
    '1. 장래계획 사항 중장기 경영 전략 및 재무 목표 발표 2. 주요내용 및 추진일정 목적 2026년 CEO Investor Day 개최 통한 '
    '당사 사업 관련 투자자 이해 제고 세부내용 · 중장기 전략 - 당사 주요 판매 및 지역별 전략 - 미래 모빌리티 및 미래 기술 '
    '전략 · 중장기 재무계획 - 중장기(2030년) 영업이익률 목표 : 9+α% - 당사 총주주환원율 영문 용어 변경 : Total '
    'Shareholder Return(TSR) → Total Payout Ratio(TPR) ※ 상세 내용 첨부파일 참조 추진일정 시작일 - 종료일 2030-12-31')),
  ('IR: NDR', lambda: parse_ir_date(MUST_MISS_IR[0])),
]
# 현대모비스 영문 Script — 2026-11-11 실물 PDF(2026 3Q·2Q Earnings Call Script (EN))의 pdf_text 결과 그대로(줄바꿈·빈 줄 포함)
SCRIPT_3Q26 = ('of KRW 880.7 billion, up 7.8% year\n-over-year, supported by regional selling price \n'
               'increases and a reduced tariff burden. Total operating profit for the third quarter \n'
               'increased 17.2% year-over-year to KRW 914.1 billion. \n'
               'Non-captive orders for Core Parts reached USD 1.15 billion on a cumulative basis through \n'
               'the third quarter of 2026, representing 13% of the annual order target of USD 8.97 billion.\n \n'
               'Next, I will discuss R&D Tech Day. In September, we unveiled approximately 60 R&D \n')
_SCRIPT_2Q26 = ('Non-captive orders for Core Parts reached USD 740 million in the second quarter of 2026, \n'
                'representing 8.2% of the annual order target of USD 8.97 billion.\n \n')
# 가상 문구(실물 없음 — 4분기 Script 가 다음 해 1월에 올 꼴 대비): 같은 문장 앞의 연도 · 문단에 연도 둘 + 문장엔 없음
_SCRIPT_NEXT_YEAR = ('Non-captive orders for Core Parts reached USD 9.2 billion in 2026. \n'
                     'For 2027, we set an annual order target of USD 9.5 billion.\n \n')
_SCRIPT_TWO_YEARS = ('Non-captive orders for Core Parts reached USD 9.2 billion in 2026, up from USD 9.1 billion in 2025. \n'
                     'We set an annual order target of USD 9.5 billion.\n \n')
# (본문, 문서 분기 연도, 기대 (기간, low, high, 통화, 단위))
MUST_HIT_SCRIPT = [
  ('representing 13% of the annual order target of USD 8.97 billion', 2026, ('FY2026', 8.97, 8.97, 'USD', 'billion')),
  (SCRIPT_3Q26, None, ('FY2026', 8.97, 8.97, 'USD', 'billion')),    # 같은 문장의 연도(「third quarter of 2026」)
  (_SCRIPT_2Q26, None, ('FY2026', 8.97, 8.97, 'USD', 'billion')),   # 문서 연도 없이 문장 연도만으로
  (_SCRIPT_NEXT_YEAR, 2026, ('FY2027', 9.5, 9.5, 'USD', 'billion')),   # 문장 앞 연도가 문서·문단의 2026 보다 먼저
]
# (본문, 문서 분기 연도, recognized 기대) — 행 0 이어야 한다
MUST_MISS_SCRIPT = [
  # 누계 «실적» — 목표 문장이 아니다(알아보지 않음 → expects_numbers 가 참이라 「서식 미인식」 경고)
  ('Non-captive orders for Core Parts reached USD 1.15 billion on a cumulative basis through the third quarter of 2026',
   2026, False),
  (_SCRIPT_TWO_YEARS, 2026, True),   # 어느 해 목표인지 못 가린다 → 행 없음 · 알아봄(0행 = failed)
]


def _parse_doc_test() -> list[str]:
  """현대 월 판매 검산 실패 + 실적 행이 한 문서에 있어도 실적 행이 실패를 가리지 않는다(문서 0행 · recognized)."""
  broken = _HEAD_2610 + '국내 49,042 49,022 0.04 - 53,822 -8.9 - 해외 280,731 261,026 7.5 - 298,261 -5.9 - 계 329,774 310,048 6.4 - 352,083 -6.3 -'
  doc = Doc(id=0, company_id='', ticker='005380', source='dart', doc_type='sales_release', form='', items='',
            title='', url='', published_at='2026-11-02')
  res = parse(doc, Content(text=broken + ' ' + _HMC_3Q26))
  if not res.recognized or res.count():
    return [f'kr_dart 판매 검산 실패가 실적 행에 가려짐: recognized={res.recognized} 행={res.count()}']
  # expects_numbers(P4) — 잠정실적은 참 · IR 개최 공고·가이던스는 거짓
  want = {'prelim_results': True, 'earnings_release': True, 'ir_event': False, 'guidance': False}
  bad = [t for t, w in want.items() if expects_numbers(Doc(**{**doc.__dict__, 'doc_type': t})) != w]
  if bad:
    return [f'kr_dart expects_numbers 어긋남: {bad}']
  # 모비스 영문 Script 는 코드가 읽는다(LLM 에 넘기지 않는다) · 국문 경영실적 PDF 는 지금처럼 LLM 만
  script = Doc(**{**doc.__dict__, 'ticker': MOBIS, 'source': 'ir', 'doc_type': 'presentation', 'form': SCRIPT_FORM,
                  'title': '2026 3Q Business Results Script'})
  perf = Doc(**{**script.__dict__, 'form': 'performance'})
  # Script 는 숫자가 꼭 있어야 하는 문서(목표 문장을 못 읽으면 「서식 미인식」 경고 · E7) · 국문 실적 PDF 는 아니다
  if not wants(script) or llm_only(script) or not llm_only(perf) or not expects_numbers(script) \
     or expects_numbers(perf):
    return ['kr_dart 모비스 Script 갈래 어긋남(wants·llm_only·expects_numbers)']
  res = parse(script, Content(text=SCRIPT_3Q26))
  if [g.period for g in res.guidance] != ['FY2026'] or llm_wants(script, res):
    return [f'kr_dart 모비스 Script parse: {res.guidance} · llm_wants={llm_wants(script, res)}']
  return []


def self_test() -> list[str]:
  errs = []
  for ticker, text, want in MUST_HIT_SALES:
    rows, _ = parse_sales(ticker, text)
    got = {(r.period, r.region): r.value for r in rows}
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'kr_dart 월 판매 {ticker} {k}: {got.get(k)} ≠ {v}')
  for text, want, name in MUST_HIT_RESULTS:
    rows, _ = parse_results(text)
    got = {(r.metric, r.period): r.value for r in rows}
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'kr_dart 분기 실적 {k}: {got.get(k)} ≠ {v}')
    names = {r.metric_name for r in rows if r.metric == 'revenue'}
    if names != {name}:
      errs.append(f'kr_dart 연결/별도 판정: {names} ≠ {name}')
  for text, kind in MUST_KGM_KIND:
    if kgm_kind(text) != kind:
      errs.append(f'kr_dart KGM 판정: {kgm_kind(text)} ≠ {kind}')
  for text, want in MUST_HIT_GUIDANCE:
    rows, _ = parse_guidance(text)
    got = sorted((r.metric, r.period, r.low, r.high) for r in rows)
    if got != sorted((m, p, lo, hi) for (m, p), (lo, hi) in want.items()):
      errs.append(f'kr_dart 가이던스 {text[:30]}: {got}')
  for text in MUST_MISS_GUIDANCE:
    rows, _ = parse_guidance(text)
    if rows:
      errs.append(f'kr_dart 가이던스 오탐: {text[:40]} → {rows}')
  for text, (period, day) in MUST_HIT_IR:
    rows, _ = parse_ir_date(text)
    if not rows or (rows[0].period, rows[0].event_date) != (period, day):
      errs.append(f'kr_dart IR 일정 놓침: {text[:50]}')
  for text in MUST_MISS_IR:
    if parse_ir_date(text)[0]:
      errs.append(f'kr_dart IR 일정 오탐: {text[:50]}')
  for name, run in MUST_RECOGNIZED_EMPTY:
    rows, ok = run()
    if rows or not ok:
      errs.append(f'kr_dart {name}: 행 {len(rows)} · recognized={ok} (기대 0행 · True)')
  for name, run in MUST_UNRECOGNIZED:
    rows, ok = run()
    if rows or ok:
      errs.append(f'kr_dart {name}: 행 {len(rows)} · recognized={ok} (기대 0행 · False)')
  for text, _ in MUST_HIT_GUIDANCE:
    if not parse_guidance(text)[1]:
      errs.append(f'kr_dart 가이던스 recognized 아님: {text[:30]}')
  for text, year, want in MUST_HIT_SCRIPT:
    rows, ok = parse_script_order_target(text, year)
    got = [(r.period, r.low, r.high, r.currency, r.unit) for r in rows if r.metric == 'order_intake']
    if got != [want] or not ok:
      errs.append(f'kr_dart 모비스 Script 수주 목표 {text[:40]!r}: {got} ≠ {want}')
  for text, year, recognized in MUST_MISS_SCRIPT:
    rows, ok = parse_script_order_target(text, year)
    if rows or ok != recognized:
      errs.append(f'kr_dart 모비스 Script 오탐 {text[:40]!r}: 행 {len(rows)} · recognized={ok} (기대 0행 · {recognized})')
  return errs + _parse_doc_test()
