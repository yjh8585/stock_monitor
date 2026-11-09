"""고객사 숫자 파서 공통 — 문서·결과 자료형과 숫자 읽기.

파서 모듈(이 폴더의 회사별 파일)은 아래 이름을 갖는다:
  TICKERS: tuple[str, ...]              companies.ticker — 회사 식별(코드에 「고객」 명단을 두지 않는다)
  wants(doc: Doc) -> bool               이 문서를 읽을지(제목·서식·폼으로만 — 본문은 아직 없다)
  parse(doc: Doc, content: Content) -> ParseResult
  self_test() -> list[str]              MUST_HIT·MUST_MISS 어긋남 목록(빈 목록 = 통과)
  (선택) fetch(session, doc) -> Content  기본 내려받기로 안 되는 곳(Playwright·XLSX)
  (선택) llm_wants(doc, result) -> bool  코드로 못 뽑는 칸을 LLM 에 넘길 문서인지
  (선택) llm_only(doc) -> bool           코드가 읽지 않고 LLM 만 읽는 문서(IR 발표자료 등) — LLM 이 안 도는 실행에선
                                        내려받지 않고 LLM 대기로 둔다
  (선택) LLM_HINT: str | (doc) -> str     LLM 프롬프트에 붙일 회사별 지시(뽑을 것·뺄 것)
  (선택) LLM_DROP: re.Pattern            LLM 행 중 quote·metric_label 이 걸리면 버린다(프롬프트만 믿지 않는 제외 — 빈패스트 이륜차)
  (llm_wants 가 있으면 필수) BASE_CURRENCY: str   보고 통화(CURRENCIES 중) — LLM 행 통화 검사의 기준. companies.currency 는
                                        «상장» 통화라(스텔란티스·빈패스트 = USD) 쓰지 않는다

행 규약:
  🔴 quote 는 값·날짜가 든 원문 «연속 구간»을 통째로 싣는다. '…'·' / ' 로 떼어 값만 뒤에 붙이면
     lib/quote_check 가 12자 이상 조각 안의 값만 인정하므로 대조에 실패한다(verified=false).
  표 행 quote 는 doc_text.row_text(셀 사이 ' | ') — 대조기가 '|' 를 공백으로 본다.
  metric·unit·basis·period 는 아래 정규 어휘·기간 형식만 쓴다(check_vocab — 어긋난 행은 적재 전에 버려진다).
"""
import re
from dataclasses import dataclass, field
from datetime import date

from lib.doc_text import norm_text


@dataclass(frozen=True)
class Doc:
  id: int
  company_id: str
  ticker: str
  source: str          # edgar | dart | ir
  doc_type: str
  form: str
  items: str
  title: str
  url: str
  published_at: str    # YYYY-MM-DD
  source_id: str = ''  # EDGAR accession · DART 접수번호 · IR 키


@dataclass
class Content:
  text: str
  tables: list[list[list[str]]] = field(default_factory=list)
  raw: bytes = b''


@dataclass(frozen=True)
class VolumeRow:
  metric: str          # shipments | deliveries | production | wholesale | sales
  region: str          # 'total' 또는 회사 원문 지역(소문자 영문 키)
  period_grain: str    # month | quarter | ytd | year
  period: str          # 2026-10 · 2026-Q3 · 2026-9M · 2026
  value: int           # 대
  definition: str      # 회사 정의 한 줄(화면 「정의 차이」 상자)
  quote: str           # 원문 행·문장


@dataclass(frozen=True)
class ResultRow:
  metric: str          # revenue | operating_income | net_income | ebit_adjusted | ...
  metric_name: str     # 회사가 쓴 이름 그대로
  basis: str           # reported | adjusted
  period_grain: str    # quarter | ytd | year
  period: str          # 2026-Q3 · 2026-6M · 2026
  value: float
  unit: str            # million | billion | per_share
  currency: str
  quote: str


@dataclass(frozen=True)
class GuidanceRow:
  metric: str
  metric_label: str
  period: str          # FY2026
  low: float | None
  high: float | None
  value_text: str | None
  unit: str
  basis: str | None
  quote: str
  stated: str | None = None   # 원문이 밝힌 방향 낱말 → raised 등(숫자로 비교 못 할 때만 쓴다)
  # 금액·주당 값의 통화 — None = 회사 보고 통화(파서 모듈 BASE_CURRENCY). 코드 파서 행은 늘 None, LLM 행만 외화를 적는다
  # (모비스 수주 목표 'USD 89.7억' · Task 11 수정 1회차)
  currency: str | None = None


@dataclass(frozen=True)
class EarningsDate:
  period: str          # 발표 대상 2026-Q3 · 연간(4분기+연간 발표) 2026-FY
  event_date: str      # YYYY-MM-DD
  quote: str


@dataclass
class ParseResult:
  volume: list[VolumeRow] = field(default_factory=list)
  results: list[ResultRow] = field(default_factory=list)
  guidance: list[GuidanceRow] = field(default_factory=list)
  dates: list[EarningsDate] = field(default_factory=list)
  # 대상 서식으로 «알아봤는가». True 인데 숫자가 0개면 형식 변경(파싱 실패)이다.
  recognized: bool = False
  # 본문에 코드가 못 뽑는 LLM 칸(서술형 가이던스 상자 등)의 표식이 있었나 — llm_wants(doc, result) 는 본문을 받지 않아
  # 파서가 여기에 남긴다(스텔란티스). 쓰지 않는 파서는 거짓 그대로
  llm_hint: bool = False
  # LLM 에 넘기는 까닭이 «코드 표식(전망 머리·서식)은 있는데 코드 가이던스가 모자람(문구 미스)»인가 — 원래 서술형이라
  # LLM 몫인 문서(빈패스트 전망·IR 발표자료)는 거짓. LLM 행이 문구 미스를 가리지 않게 오케스트레이터가 parse_note 에
  # 「코드 문구 미스」를 남긴다(Task 11 · Task 7 carry)
  code_miss: bool = False

  def count(self) -> int:
    return len(self.volume) + len(self.results) + len(self.guidance) + len(self.dates)

  def dedupe(self) -> None:
    """적재 키(PK) 기준 중복 제거 — 먼저 들어온 행이 남는다(코드 행을 LLM 행보다 먼저 넣으므로 코드 우선).
    한 upsert 안에 같은 PK 가 두 번 있으면 Postgres 가 'cannot affect row a second time' 으로 문서 적재를 통째로 거절한다."""
    def first(rows, key):
      seen, out = set(), []
      for r in rows:
        k = key(r)
        if k not in seen:
          seen.add(k)
          out.append(r)
      return out
    self.volume = first(self.volume, lambda r: (r.metric, r.region, r.period_grain, r.period))
    self.results = first(self.results, lambda r: (r.period_grain, r.period, r.metric))
    self.guidance = first(self.guidance, lambda r: (r.metric, r.period))
    self.dates = first(self.dates, lambda r: r.period)

  def extend(self, other: 'ParseResult') -> None:
    self.volume += other.volume
    self.results += other.results
    self.guidance += other.guidance
    self.dates += other.dates
    self.recognized = self.recognized or other.recognized
    self.llm_hint = self.llm_hint or other.llm_hint
    self.code_miss = self.code_miss or other.code_miss


# ---------------------------------------------------------------- 정규 어휘(파서·LLM 스키마가 이것만 쓴다)
# 실적·가이던스 metric 은 한 벌이다 — 같은 키여야 가이던스 카드에서 실적과 나란히 보이고, 코드 행·LLM 행 충돌 판정과
# 방향 이력이 같은 칸으로 모인다. 새 키는 여기 한 줄 + 화면 라벨(lib/customers) 한 줄.
METRICS = (
  'revenue', 'revenue_growth', 'operating_income', 'operating_margin', 'net_income', 'net_income_parent',
  'ebit_adjusted', 'aoi', 'aoi_margin', 'adjusted_ebitda', 'adjusted_sales', 'eps_adjusted', 'operating_result_bsi',
  'adjusted_automotive_fcf', 'industrial_fcf', 'free_cash_flow', 'automotive_net_cash_flow', 'automotive_net_liquidity',
  'automotive_ncf_margin', 'automotive_ebitda_margin', 'investment_ratio', 'capex', 'bev_share', 'order_intake',
  'deliveries', 'sales_units', 'other')
VOLUME_METRICS = ('shipments', 'deliveries', 'production', 'wholesale', 'sales')   # DB CHECK 와 같음
UNITS = ('million', 'billion', 'trillion', 'per_share', 'percent', 'units', 'text')
RESULT_UNITS = ('million', 'billion', 'per_share')                                  # DB CHECK 와 같음
BASES = ('reported', 'adjusted')                                                    # DB CHECK 와 같음 — 연결/별도는 여기 아님
STATED = ('raised', 'maintained', 'lowered', 'withdrawn')                           # DB CHECK 와 같음
CURRENCIES = ('KRW', 'USD', 'EUR', 'VND')                                           # customer_guidance.currency CHECK 와 같음

# 기간 표기 — 표마다 DB CHECK 가 일부에만 있어(가이던스만 FY) 여기서 한 벌로 맞춘다. 표기가 갈리면
# 같은 분기가 두 행('2026-Q3'·'2026Q3')으로 쌓여 화면·방향 이력이 조용히 갈라진다.
PERIOD_FORMATS = {
  'month': re.compile(r'\d{4}-(0[1-9]|1[0-2])'),   # 2026-10
  'quarter': re.compile(r'\d{4}-Q[1-4]'),           # 2026-Q3
  'ytd': re.compile(r'\d{4}-\d{1,2}M'),             # 2026-9M · 2026-6M (반기 'H1' 아님)
  'year': re.compile(r'\d{4}'),                     # 2026
}
VOLUME_GRAINS = ('month', 'quarter', 'ytd', 'year')   # DB CHECK 와 같음
RESULT_GRAINS = ('quarter', 'ytd', 'year')            # DB CHECK 와 같음
GUIDANCE_PERIOD = re.compile(r'FY\d{4}')               # DB CHECK 와 같음
# 실적 일정의 연간 발표(4분기+연간)는 'YYYY-FY' 다 — Task 4 IR 일정(VW·폴라리스)이 이미 이 꼴로 넣었다.
# 그래서 일정에 'YYYY-Q4' 는 없다(있으면 같은 발표가 두 행이 된다).
DATE_PERIOD = re.compile(r'\d{4}-(Q[1-3]|FY)')
_ISO_DATE = re.compile(r'\d{4}-\d{2}-\d{2}')


def _period_ok(grain: str, period: str, grains: tuple[str, ...]) -> bool:
  return grain in grains and PERIOD_FORMATS[grain].fullmatch(period or '') is not None


def _row_errors(kind: str, x) -> list[str]:
  """행 하나의 어휘·기간 형식 위반(빈 목록 = 통과). 사유에는 칸 이름과 표기만 싣는다(값 금지)."""
  e = []
  if kind == 'volume':
    if x.metric not in VOLUME_METRICS:
      e.append(f'volume metric {x.metric}')
    if not _period_ok(x.period_grain, x.period, VOLUME_GRAINS):
      e.append(f'volume period {x.period_grain}:{x.period}')
  elif kind == 'results':
    if x.metric not in METRICS:
      e.append(f'result metric {x.metric}')
    if x.unit not in RESULT_UNITS:
      e.append(f'result unit {x.unit}')
    if x.basis not in BASES:
      e.append(f'result basis {x.basis}')
    if not _period_ok(x.period_grain, x.period, RESULT_GRAINS):
      e.append(f'result period {x.period_grain}:{x.period}')
  elif kind == 'guidance':
    if x.metric not in METRICS:
      e.append(f'guidance metric {x.metric}')
    if x.unit not in UNITS:
      e.append(f'guidance unit {x.unit}')
    if x.basis is not None and x.basis not in BASES:
      e.append(f'guidance basis {x.basis}')
    if x.stated is not None and x.stated not in STATED:
      e.append(f'guidance stated {x.stated}')
    if not GUIDANCE_PERIOD.fullmatch(x.period or ''):
      e.append(f'guidance period {x.period}')
    if x.low is None and x.high is None and not x.value_text:
      e.append('guidance 값 없음')   # DB CHECK(low·high·value_text 중 하나)
  else:  # dates
    if not DATE_PERIOD.fullmatch(x.period or ''):
      e.append(f'date period {x.period}')
    if not _ISO_DATE.fullmatch(x.event_date or ''):
      e.append(f'date event_date {x.event_date}')
  return e


_KINDS = ('volume', 'results', 'guidance', 'dates')


def check_vocab(r: 'ParseResult') -> list[str]:
  """어휘·기간 형식 밖 값 목록(DB CHECK 오류와 표기 갈림을 미리 막는다)."""
  return [err for kind in _KINDS for x in getattr(r, kind) for err in _row_errors(kind, x)]


def drop_off_vocab(r: 'ParseResult') -> list[str]:
  """check_vocab 위반 행을 r 에서 버리고 사유 목록을 돌려준다(오케스트레이터가 parse_note 에 남긴다).
  문서 전체가 아니라 그 행만 버린다 — 한 행의 표기 실수로 같은 문서의 맞는 행까지 잃지 않게."""
  notes = []
  for kind in _KINDS:
    keep = []
    for x in getattr(r, kind):
      errs = _row_errors(kind, x)
      notes += errs
      if not errs:
        keep.append(x)
    setattr(r, kind, keep)
  return notes


def _v(grain, period):
  return VolumeRow('deliveries', 'total', grain, period, 1, 'd', 'q')


def _res(grain, period):
  return ResultRow('revenue', 'Revenue', 'reported', grain, period, 1.0, 'million', 'USD', 'q')


def _g(period):
  return GuidanceRow('revenue', 'Revenue', period, 1.0, 2.0, None, 'billion', None, 'q')


VOCAB_HIT = [  # 통과해야 하는 표기
  ('volume', _v('month', '2026-10')), ('volume', _v('quarter', '2026-Q3')), ('volume', _v('ytd', '2026-9M')),
  ('volume', _v('year', '2026')), ('results', _res('ytd', '2026-6M')), ('results', _res('year', '2026')),
  ('guidance', _g('FY2026')), ('dates', EarningsDate('2026-Q3', '2026-10-28', 'q')),
  ('dates', EarningsDate('2025-FY', '2026-03-10', 'q')),
]
VOCAB_MISS = [  # 버려져야 하는 표기
  ('volume', _v('quarter', '2026Q3')), ('volume', _v('quarter', 'Q3 2026')), ('volume', _v('ytd', '2026-H1')),
  ('volume', _v('month', '2026-13')), ('volume', _v('week', '2026-W40')),
  ('results', _res('quarter', '2026Q3')), ('results', _res('ytd', '2026-H1')), ('results', _res('month', '2026-10')),
  ('guidance', _g('2026')), ('guidance', _g('FY 2026')),
  ('dates', EarningsDate('2026-Q4', '2027-02-10', 'q')),   # 연간 발표는 2026-FY
  ('dates', EarningsDate('Q3 2026', '2026-10-28', 'q')), ('dates', EarningsDate('2026-Q3', '28.10.2026', 'q')),
]


def self_test() -> list[str]:
  errs = [f'VOCAB_HIT 버려짐: {k} {x.period}' for k, x in VOCAB_HIT if _row_errors(k, x)]
  errs += [f'VOCAB_MISS 통과돼 버림: {k} {x.period}' for k, x in VOCAB_MISS if not _row_errors(k, x)]
  return errs


# ---------------------------------------------------------------- 숫자 읽기
_NUM_CELL = re.compile(r'^\(?[-+]?\d[\d,]*(?:\.\d+)?\)?$')
MONTHS = {m: i for i, m in enumerate(
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
   'september', 'october', 'november', 'december'], 1)}
QUARTER_WORDS = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4}


def to_number(s: str) -> float | None:
  """'1,472' → 1472 · '(191)' → -191 · '(13,441,754' → -13441754(괄호가 셀로 쪼개진 꼴) · '-0.5' → -0.5."""
  s = norm_text(s).replace('$', '').replace('€', '').strip()
  if not s:
    return None
  neg = s.startswith('(') or s.startswith('-')
  digits = s.strip('()').lstrip('+-').replace(',', '')
  try:
    v = float(digits)
  except ValueError:
    return None
  return -v if neg else v


def numeric_cells(row: list[str]) -> list[float]:
  """라벨(첫 셀)을 뺀 숫자 셀만. '$'·'%'·'n.m.'·'—' 셀은 건너뛴다(퍼센트 셀은 숫자로 안 본다)."""
  out = []
  for c in row[1:]:
    c = norm_text(c)
    if _NUM_CELL.match(c):
      v = to_number(c)
      if v is not None:
        out.append(v)
  return out


def find_row(tables: list[list[list[str]]], label_re: str) -> list[str] | None:
  """첫 셀(또는 'I F R S' 같은 머리 셀 다음 둘째 셀)이 라벨에 맞는 첫 행."""
  rx = re.compile(label_re, re.I)
  for rows in tables:
    for row in rows:
      for i in (0, 1):
        if i < len(row) and rx.match(norm_text(row[i])):
          return row[i:]
  return None


def prev_month(published_at: str) -> str:
  """공시일 → 그 전달 'YYYY-MM'(국내 월 판매 공시는 매월 첫 영업일에 전달 분을 낸다)."""
  d = date.fromisoformat(published_at)
  y, m = (d.year, d.month - 1) if d.month > 1 else (d.year - 1, 12)
  return f'{y}-{m:02d}'


def prev_quarter(published_at: str) -> str:
  """공시일 → 직전 분기 'YYYY-Qn'(분기 종료 직후 나오는 생산·인도 보도자료)."""
  d = date.fromisoformat(published_at)
  q = (d.month - 1) // 3  # 이번 분기 번호 - 1
  return f'{d.year - 1}-Q4' if q == 0 else f'{d.year}-Q{q}'


def month_name_date(month: str, day: str, year: str) -> str:
  return f'{int(year)}-{MONTHS[month.lower()]:02d}-{int(day):02d}'
