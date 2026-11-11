"""고객사 가이던스 LLM 추출 — 코드 파서가 못 뽑는 칸만(회사별 llm_wants). 결과는 반드시 quote_check 를 지난다.

모델 상수는 여기 한곳. 구조화 출력 본보기 = collect_oem_model_outlook.py _evaluate(output_config.format · adaptive thinking).
호출 = scripts/collect_customer_numbers.py _CompanyRun._llm(문서마다 한 번 · 예외는 그 문서만 「LLM 실패」로 격리).

- extract 가 돌려준 행은 오케스트레이터가 코드 행 «뒤»에 붙인다 → dedupe 가 같은 (metric, period) 의 코드 행을 남긴다(코드 우선).
  extractor='llm' 표시·quote_check 대조도 오케스트레이터 몫이다(코드 행과 같은 검사).
- 🔴 응답이 잘리거나(max_tokens) 거절되면(refusal) 빈 목록이 아니라 Incomplete 를 던진다 — 빈 목록이면 «LLM 이 읽었는데
  전망이 없다»로 보여 IR 문서가 not_target 으로 닫히고 다시 안 읽힌다(요약서 시제품의 「경고 후 빈 목록」에서 바꿈).
- 🔴 quote_check 는 «수가 quote 에 있나»를 배수 10가지 중 아무것으로나 맞춰 보므로 규모·단위·통화·기간이 틀린 행도
  통과한다(2026-11-10 백필 실측 — 'USD 89.7억'을 89.7 billion 으로 적은 행이 verified). 그래서 extract 가 LLM 행을
  돌려주기 전에 직접 거른다(screen — 조용히 틀린 칸보다 빈칸). 거른 수는 (행, 사유별 건수)로 돌려주고 오케스트레이터가
  문서 note 에 남긴다(「LLM 이 못 찾음」과 「검사가 다 버림」을 DB 에서 가른다):
  · 숫자 other — 맞는 지표가 없는 숫자 항목(other 는 숫자 없는 확인·철회 행 전용)
  · 분기·반기 — quote 에 분기·반기 표지(폴라리스 잠정실적 분기 범위 · 스텔란티스 H2 상자)
  · 여러 해 성장률 — CAGR·연평균·('24~'27) 꼴의 비율 행(모비스 IR)
  · 파서 제외 — 파서 LLM_DROP(빈패스트 이륜차)
  · 규모 — quote 의 값 숫자에 붙은 배수 낱말(조·억·만·천·billion·B·M·in thousands …)로 구한 원문 절대값 ≠ low×단위
  · text 숫자 · 비율 단위 — unit='text' 인데 숫자 / 비율 지표에 percent 가 아닌 단위
  · 통화 — 값 바로 옆에 보고 통화가 아닌 통화 표지가 있는데 currency 가 비었다
  · 과거 연도 — year < 문서 발행 연도(과거 실적 오독 · 상태 행 other 는 제외) · 범위 뒤집힘 — low > high (최종 검토 P9)
  stated 는 인용 대조 밖이라 quote 에 그 낱말 어간(raise·increase·reaffirm·lower·trim·withdraw·상향·올린·유지·낮춘 …)이
  없으면 stated 만 지운다
  (행은 남긴다 · 사유 'stated 근거 없음' — 방향 계산이 withdrawn 을 숫자보다 먼저 쓰므로 · 최종 검토 P2).
  단 원문 'N억' 을 billion·trillion·text 로 적은 행만은 N×100 million 으로 환산한다(fix_eok — 억은 정의상 1e8 이라 배수
  낱말이 확실히 읽힐 때만 · 모비스 IR 에서 프롬프트에 규칙을 적어도 3회 중 3회 반복된 오류라 버리면 그 문서 값을 매번 잃는다).
- 키·본문은 출력하지 않는다(경고는 문서 id 와 글자 수만).
"""
import json
import os
import re
from collections import Counter
from dataclasses import dataclass, replace

from customer_parsers.base import BASES, CURRENCIES, METRICS, STATED, UNITS, GuidanceRow

MODEL = os.environ.get('CUSTOMER_GUIDANCE_MODEL', 'claude-sonnet-5-5')
EFFORT = 'medium'
MAX_TOKENS = 16000     # 사고+응답 합산 상한(비스트리밍 — SDK 시간 초과 경고 아래)
MAX_CHARS = 120_000    # 문서 글 상한(앞에서 자른다) — 실적 보도자료는 대개 40k 이하 · 넘으면 경고를 찍는다

_NULLABLE_NUM = {'anyOf': [{'type': 'number'}, {'type': 'null'}]}
_NULLABLE_STR = {'anyOf': [{'type': 'string'}, {'type': 'null'}]}
SCHEMA = {
  'type': 'object', 'additionalProperties': False, 'required': ['items'],
  'properties': {'items': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False,
    'required': ['metric', 'metric_label', 'year', 'low', 'high', 'value_text', 'unit', 'currency', 'basis', 'quote',
                 'stated'],
    'properties': {
      'metric': {'type': 'string', 'enum': list(METRICS)},   # 파서와 같은 어휘(base.py)
      'metric_label': {'type': 'string'},
      'year': {'type': 'integer'},
      'low': _NULLABLE_NUM, 'high': _NULLABLE_NUM, 'value_text': _NULLABLE_STR,
      'unit': {'type': 'string', 'enum': list(UNITS)},
      'currency': {'anyOf': [{'type': 'string', 'enum': list(CURRENCIES)}, {'type': 'null'}]},
      'basis': {'anyOf': [{'type': 'string', 'enum': list(BASES)}, {'type': 'null'}]},
      'quote': {'type': 'string'},
      'stated': {'anyOf': [{'type': 'string', 'enum': list(STATED)}, {'type': 'null'}]},
    }}}},
}

SYSTEM = """너는 자동차 회사 공식 문서에서 «회사가 이번 문서에서 밝힌 연간 전망(가이던스)·연간 목표»만 뽑는다.

뽑는 것
- 회계연도 전체에 대한 회사 자신의 전망·목표. year 는 그 회계연도. 연도가 밝혀진 중장기 목표(예 2030년 목표)도 그 해로.
- 범위면 low·high, 한 점이면 low=high, '최대 X'·'X 이하' 면 high 만, 'X 이상' 이면 low 만.
- 숫자가 아닌 전망('mid-single digit increase'·'Improved Y-o-Y')은 value_text 에 원문 낱말 그대로, low·high 는 null, unit='text'.
  unit='text' 이면 low·high 는 반드시 null(숫자가 있으면 숫자 단위를 쓴다).
- 회사가 숫자를 다시 적지 않고 기존 연간 전망을 확인·유지(confirm·reaffirm·remains unchanged)하거나 철회(withdraw·suspend)
  한다고만 밝혔으면 한 항목: metric 은 원문이 밝힌 지표, 밝히지 않았으면 'other' · value_text 는 그 원문 낱말(예 'confirms') ·
  low·high 는 null · unit='text' · stated 는 maintained 또는 withdrawn. 숫자 항목이 하나라도 있으면 이 항목은 만들지 않는다.
- metric 'other' 는 바로 위 확인·철회 항목에만 쓴다. 숫자가 있는데 맞는 지표가 없는 항목(배당성향·전기차 판매 대수 등)은
  만들지 않는다.

뽑지 않는 것
- 분기·반기 전망(예 'fourth quarter'·'Q4'·'H2'·'second half'·'4분기'·'하반기') — 연간 칸에 넣지 말고 아예 만들지 않는다.
- 과거 실적 · 애널리스트·시장 추정 · 직전 전망(바뀌기 전 값 — '(previously: …)'·'versus prior guidance of …'·
  'previous forecast') · 연도가 없는 중장기 목표 · 업계 전체(시장) 전망 · 여러 해 누적 금액('2026~2030년 5년간 투자 49조' —
  한 해 값이 아니다) · 여러 해 연평균 성장률(CAGR·연평균·'compound annual'·"('24~'27)" 꼴 — 한 해 성장률이 아니다).

값과 단위
- low·high 는 원문에 적힌 수를 쓴다. unit 은 원문 단위: million·billion·trillion(금액) · per_share(주당) · percent(%) ·
  units(대수 — '416만 대' 는 4160000, '1.2 million units' 는 1200000) · text(숫자 아님).
  국문 금액: 'N조원' → N, unit=trillion · 'N억원' → N×100, unit=million(억원은 백만원 단위로) · 'N백만원' → N, unit=million.
  외화도 같다: 'USD 89.7억'·'89.7억 달러' → 8970, unit=million(억은 billion 이 아니다).
- currency: 금액·주당 값의 통화가 아래 «보고 통화»와 다르면 그 통화(KRW·USD·EUR·VND), 보고 통화이거나 금액이 아니면 null.
- 비율 지표(revenue_growth·operating_margin·aoi_margin·automotive_ncf_margin·automotive_ebitda_margin·investment_ratio·
  bev_share·operating_margin_adjusted)는 unit 이 percent 또는 text 일 때만 쓴다. 투자 «금액»은 capex.
- 감소 전망('down 1 to 4 percent')처럼 부호가 원문 수와 달라지는 것은 숫자로 바꾸지 말고 value_text 에 원문 그대로.
- basis 는 원문이 조정(adjusted·non-GAAP·before special items)이라고 밝혔으면 adjusted, 장부상(reported·IFRS·GAAP)이면
  reported, 밝히지 않았으면 null.
- stated 는 원문이 raise·reaffirm·confirm·lower·withdraw 같은 말을 직접 썼을 때만(raised·maintained·lowered·withdrawn),
  아니면 null.

quote (가장 중요)
- 값이 든 원문 문장(또는 표 한 행) «전체»를 한 글자도 바꾸지 말고 그대로. 번역·요약·생략 부호('…')·짜깁기 금지.
- 기계가 quote 의 12자 이상 이어진 조각이 원문에 그대로 있는지, 값(low·high·value_text)이 그 조각 안에 있는지 대조한다 —
  값과 그 앞뒤 낱말(단위 낱말 포함)이 한 덩어리로 들어가게 문장·행을 통째로 옮긴다.

확신이 없으면 항목을 만들지 말고 빈 목록을 돌려준다."""

# 분기·반기 표지 — FY 행 quote 에 있으면 버린다(분기·반기 전망이 연간 칸으로 새는 것 차단)
_QUARTER = re.compile(
  r'\b(?:first|second|third|fourth|1st|2nd|3rd|4th)[- ]quarter\b|\bQ[1-4]\b|\b[1-4]Q(?:\d{4}|\d{2})?\b|[1-4]\s*분기'
  r'|\bH[12]\b|\b(?:first|second)[- ]half\b|[상하]반기',
  re.I)
# 표지가 «전망 기간»이 아니라 지난 기간·행사 이름을 가리키는 구 — 표지 검사 전에 지운다.
# SHORTCUT: 실물 2꼴만(스텔란티스 2026 상자 'payments related to H2 '25 charges' · 확인 6-K 'during the H1 Earnings Call')
#   → 다른 꼴이 정상 연간 행을 버리면 여기에 더한다(QUARTER_HIT 에 실물 문장을 같이)
_PERIOD_REF = re.compile(r"related to (?:H[12]|Q[1-4])\s*['’]?\d{2}(?:\d{2})?\s+charges|"
                         r"\b(?:H[12]|Q[1-4])\s*(?:20\d{2}\s+)?Earnings Call\b", re.I)
# 연간 전망 머리('FY 2024 GUIDANCE'·'Full Year 2026 Guidance') — 그 앞의 표지는 표 머리의 실적 기간이다(실물 287:
# 'Q3 2024 Q3 2023 Change FY 2024 GUIDANCE AOI margin…'). 마지막 머리부터만 본다 — 머리 뒤의 분기 표지는 그대로 걸린다.
_ANNUAL_HEAD = re.compile(r'\b(?:FY\s?\d{2,4}|full[- ]year(?:\s+20\d{2})?)\s+guidance\b', re.I)


class Incomplete(Exception):
  """응답이 끝까지 오지 않았다(max_tokens·refusal) — 그 문서는 LLM 대기로 남긴다(오케스트레이터가 note 에 클래스 이름)."""


def make_client():
  """실행마다 한 번. 키가 없으면 None — 오케스트레이터가 LLM 칸을 건너뛰고 문서를 LLM 대기로 남긴다(실행은 계속)."""
  if not os.environ.get('ANTHROPIC_API_KEY'):
    return None
  from anthropic import Anthropic
  return Anthropic()


def has_quarter_mark(quote: str, values: tuple = ()) -> bool:
  """quote 에 분기·반기 표지가 있나. 연간 전망 머리 앞의 표지는 «값이 전부 머리 뒤에 있을 때만» 무시한다 —
  값이 머리 앞이면('Fourth quarter sales … $1.9 billion, and we are reaffirming our full year guidance') 앞 표지가 그 값의
  기간이다(수정 2회차 N1). 값을 모르면(values 비었음·원문에 없음) quote 전체를 본다."""
  q = _PERIOD_REF.sub(lambda m: ' ' * len(m.group(0)), quote or '')   # 자리 유지 — 아래 토큰 위치와 맞춘다
  heads = list(_ANNUAL_HEAD.finditer(q))
  vals = [abs(v) for v in values if v is not None]
  if heads and vals:
    from lib.quote_check import _MULTS
    h = heads[-1].start()
    toks = [t for t in number_tokens(q) if t.start == 0 or not q[t.start - 1].isalpha()]   # 'Q3'·'H2' 의 숫자 제외
    at = [[t.start for t in toks if any(_close(t.n * m, v) for m in _MULTS)] for v in vals]
    if all(a and min(a) >= h for a in at):
      q = q[h:]
  return _QUARTER.search(q) is not None


# ---------------------------------------------------------------- 숫자 토큰 + 배수 낱말
PERCENT_METRICS = frozenset(('revenue_growth', 'operating_margin', 'aoi_margin', 'automotive_ncf_margin',
                             'automotive_ebitda_margin', 'investment_ratio', 'bev_share', 'operating_margin_adjusted'))
SCALE = {'million': 1e6, 'billion': 1e9, 'trillion': 1e12, 'units': 1.0, 'percent': 1.0, 'per_share': 1.0}
MONEY_UNITS = ('million', 'billion', 'trillion', 'per_share')
_EOK = 1e8

_NUM = re.compile(r'\d[\d,]*(?:\.\d+)?')
_AFTER = re.compile(r'\)?\s*')
_KO = re.compile(r'([천백])?\s?(조|억|만)')
_KO_CHEON = re.compile(r'천(?=\s*(?:원|대|명)|[^가-힣]|$)')
_EN = re.compile(r'(trillion|tn|billion|bn|million|mn|thousand|[kbm])(?![a-z])', re.I)
_PCT = re.compile(r'%|per\s?cent\b', re.I)
_KO_MULT = {'조': 1e12, '억': 1e8, '만': 1e4}
_KO_PRE = {'천': 1e3, '백': 1e2, None: 1.0}
_EN_MULT = {'trillion': 1e12, 'tn': 1e12, 'billion': 1e9, 'bn': 1e9, 'b': 1e9, 'million': 1e6, 'mn': 1e6, 'm': 1e6,
            'thousand': 1e3, 'k': 1e3}
# 범위 잇기('35 to 36 billion' · '-1.0 ~ 0.5조' · '$7.15B - $7.30B' · 'between 3 and 5 per cent') — 앞 수가 뒤 수의 배수를 받는다
_JOIN = re.compile(r"\s*\)?\s*(?:to|~|-|–|—|and)\s*(?:US\$|\$|€|£|₩|USD|EUR|KRW)?\s*\(?\s*", re.I)
# 표 머리 배수('in thousands' · '(€ million)' · '(단위: 억원)') — 붙은 낱말이 없는 수에만
_HEADER = re.compile(r'\bin\s+(thousand|million|billion)s?\b|\(\s*(?:[€$£₩]|EUR|USD|KRW)?\s*(thousand|million|billion)s?\s*\)'
                     r'|단위\s*[:：]?\s*(천|백만|억|조)', re.I)
_HEADER_MULT = {'thousand': 1e3, 'million': 1e6, 'billion': 1e9, '천': 1e3, '백만': 1e6, '억': 1e8, '조': 1e12}


@dataclass(frozen=True)
class _Tok:
  n: float        # 부호 없는 수
  mult: float     # 붙은(또는 이어받은·표 머리) 배수 — 없으면 1
  start: int
  end: int


def _own_mult(rest: str) -> float | None:
  """수 바로 뒤 글 → 배수(낱말 없음 = None · % = 1)."""
  rest = rest[_AFTER.match(rest).end():]
  if m := _KO.match(rest):
    return _KO_PRE[m.group(1)] * _KO_MULT[m.group(2)]
  if _KO_CHEON.match(rest):
    return 1e3
  if m := _EN.match(rest):
    return _EN_MULT[m.group(1).lower()]
  if _PCT.match(rest):
    return 1.0
  return None


def number_tokens(quote: str) -> list[_Tok]:
  q = quote or ''
  raw = []
  for m in _NUM.finditer(q):
    s = m.group(0).rstrip(',')
    try:
      n = float(s.replace(',', ''))
    except ValueError:
      continue
    end = m.start() + len(s)
    raw.append([n, _own_mult(q[end:end + 16]), m.start(), end])
  for i in range(len(raw) - 2, -1, -1):     # 뒤에서부터 — '1 to 2 to 3 billion' 도 끝까지 이어받는다
    if raw[i][1] is None and raw[i + 1][1] is not None and _JOIN.fullmatch(q[raw[i][3]:raw[i + 1][2]]):
      raw[i][1] = raw[i + 1][1]
  h = _HEADER.search(q)
  head = _HEADER_MULT[next(g for g in h.groups() if g).lower()] if h else 1.0
  return [_Tok(n, head if mult is None else mult, s, e) for n, mult, s, e in raw]


def _close(a: float, b: float) -> bool:
  return abs(a - b) <= max(abs(b) * 1e-6, 1e-9)


def _matches(v: float, unit: str, toks: list[_Tok]) -> list[_Tok]:
  """원문 절대값(수 × 배수)이 v × 단위와 같은 토큰. percent·per_share 는 배수 1 만."""
  target = abs(v) * SCALE[unit]
  return [t for t in toks if _close(t.n * t.mult, target) and (SCALE[unit] != 1.0 or unit == 'units' or t.mult == 1.0)]


def scale_mismatch(g: GuidanceRow) -> bool:
  """quote_check 는 통과하는데(어느 배수로든 수가 맞는다) 원문 배수 낱말로 구한 절대값이 low×단위와 다르다 → 버린다.
  아예 수가 없는 행은 여기서 안 버린다 — quote_check 가 value_not_in_quote 로 남긴다(대조 실패 수에 잡히게)."""
  if g.unit not in SCALE:
    return False
  from lib.quote_check import _MULTS
  toks = number_tokens(g.quote)
  for v in (g.low, g.high):
    if v is None or _matches(v, g.unit, toks):
      continue
    if any(_close(t.n * m, abs(v)) for t in toks for m in _MULTS):
      return True
  return False


def fix_eok(g: GuidanceRow) -> GuidanceRow:
  """원문 'N억'(배수 낱말이 정확히 억)을 N billion·trillion·text 로 적은 행 → N×100 million. 그 밖의 어긋남은 고치지 않는다."""
  if g.unit not in ('billion', 'trillion', 'text'):
    return g
  vals = [v for v in (g.low, g.high) if v is not None]
  toks = number_tokens(g.quote)
  if not vals or not all(any(_close(t.n, abs(v)) and t.mult == _EOK for t in toks) for v in vals):
    return g
  x100 = lambda v: None if v is None else round(v * 100, 6)
  return replace(g, low=x100(g.low), high=x100(g.high), unit='million')


def unit_mismatch(g: GuidanceRow) -> str | None:
  if g.unit == 'text':
    return 'text 숫자' if g.low is not None or g.high is not None else None
  return '비율 단위' if g.metric in PERCENT_METRICS and g.unit != 'percent' else None


# 여러 해 연평균 — 비율 행만. metric_label · 값 앞(바로 앞 수 뒤부터, 최대 32자)의 낱말 · 값 바로 뒤(14자)의 ('24~'27) 꼴.
# 앞 구간을 «바로 앞 수»에서 끊는 까닭: 모비스 한 줄에 'CAGR +8% ('24~'27) 영업이익률 5~6%' 가 같이 있어 고정 폭이면
# 연간 영업이익률까지 CAGR 로 버린다(MULTI_YEAR_HIT)
_MULTI_YEAR = re.compile(r'CAGR|연평균|compound annual', re.I)
_YY_RANGE = re.compile(r"['’‘]\d{2}\s*[~\-–]\s*['’‘]?\d{2}\b|\b20\d{2}\s*[~\-–]\s*(?:20)?\d{2}\b")


def multi_year_rate(g: GuidanceRow) -> bool:
  if g.metric not in PERCENT_METRICS:
    return False
  if _MULTI_YEAR.search(g.metric_label or ''):
    return True
  q = g.quote or ''
  toks = number_tokens(q)
  for v in (g.low, g.high):
    for t in (_matches(v, 'percent', toks) if v is not None else []):
      start = max([x.end for x in toks if x.end <= t.start] + [t.start - 32, 0])
      if _MULTI_YEAR.search(q[start:t.start]) or _YY_RANGE.search(q[t.end:t.end + 14]):
        return True
  return False


# 통화 표지 — «그 값의» 통화만 본다: 수 바로 앞('USD 89.7억'·'VND47,028'·'€(5)'·'(US$1.85') 또는 수·배수 낱말에 바로
# 붙은 뒤('17.8조원'·'36 billion euros'). 값 뒤 괄호 환산('VND47,028 billion (US$1.85 billion)'·'EUR 35 to 36 billion
# (USD 38 to 39 billion)')은 괄호 안 수의 통화라 앞 값의 통화로 보지 않는다(수정 2회차 N4 — 빈패스트 보도자료 꼴).
# 범위('35 and 36 billion euros')는 _JOIN 으로 이어진 수끼리 통화를 나눠 받는다.
_CUR_MARK = {
  'USD': re.compile(r'US\$|\$|USD|달러|dollars?', re.I),
  'EUR': re.compile(r'€|EUR|euros?|유로', re.I),
  'VND': re.compile(r'VND|đồng|₫', re.I),
  'KRW': re.compile(r'₩|KRW|원', re.I),
}
_CUR_PRE = re.compile(r'(US\$|\$|€|₩|₫|USD|EUR|VND|KRW)\s*\(?\s*$', re.I)
# 배수 낱말과 통화 사이의 'in'·'US'·'U.S.'('36 billion US dollars'·'35 billion in US dollars')는 건너뛴다(최종 검토 P1)
_CUR_SUF = re.compile(r'\)?\s*(?:[천백]?\s?(?:조|억|만)|(?:trillion|tn|billion|bn|million|mn|thousand|[kbm])(?![a-z]))?'
                      r'\s*(?:in\s+)?(?:U\.?\s?S\.?\s*)?(euros?\b|dollars?\b|달러|유로|원(?![가-힣])|USD\b|EUR\b|VND\b|KRW\b|đồng|₫)', re.I)


def _currency_of(word: str) -> str:
  return next(c for c, p in _CUR_MARK.items() if p.fullmatch(word))


def _token_currencies(q: str, toks: list[_Tok]) -> list[set[str]]:
  """토큰마다 그 수에 붙은 통화 표지(앞·바로 뒤) — 범위로 이어진 수끼리는 합친다."""
  out = []
  for t in toks:
    cur = set()
    if m := _CUR_PRE.search(q[max(0, t.start - 6):t.start]):
      cur.add(_currency_of(m.group(1)))
    if m := _CUR_SUF.match(q, t.end):
      cur.add(_currency_of(m.group(1)))
    out.append(cur)
  for i in range(len(toks) - 1):   # 앞으로 한 번 · 뒤로 한 번 — '1 to 2 to 3 billion euros' 도 끝까지
    if _JOIN.fullmatch(q[toks[i].end:toks[i + 1].start]):
      out[i + 1] |= out[i]
  for i in range(len(toks) - 2, -1, -1):
    if _JOIN.fullmatch(q[toks[i].end:toks[i + 1].start]):
      out[i] |= out[i + 1]
  return out


def foreign_currency(g: GuidanceRow, base: str | None) -> set[str]:
  """값에 붙은 보고 통화 아닌 통화 표지."""
  if not base or g.unit not in MONEY_UNITS:
    return set()
  q, out = g.quote or '', set()
  toks = number_tokens(q)
  curs = _token_currencies(q, toks)
  for v in (g.low, g.high):
    if v is None:
      continue
    hit = {i for i, t in enumerate(toks) if _close(t.n, abs(v))} | {toks.index(t) for t in _matches(v, g.unit, toks)}
    for i in hit:
      out |= curs[i] - {base}
  return out


def to_rows(items: list[dict]) -> list[GuidanceRow]:
  return [GuidanceRow(i['metric'], i['metric_label'], f'FY{i["year"]}', i['low'], i['high'], i['value_text'],
                      i['unit'], i['basis'], i['quote'], i['stated'], i['currency']) for i in items]


# stated 값 → quote 에 있어야 하는 낱말 어간(최종 검토 P2). stated 는 인용 대조 밖인데 guidance_direction.decide 가
# withdrawn 을 숫자보다 먼저 쓰므로, 근거 낱말 없는 stated 는 지운다(행은 남긴다). 영어는 \b 로 낱말 머리만
# ('execution' 속 cut · 'flower' 속 lower 를 안 잡게) · 한국어는 명사(상향·하향·유지·철회)와 동사 활용형을 낱낱이
# (올려·올린·높여·높인 / 낮춰·낮춘·내려·내린 — 어간 「올리」「낮추」는 활용하면 글자가 바뀌어 부분 일치로 안 걸린다 · 잔여 Minor 3).
_STATED_WORDS = {
  'raised': re.compile(r'\brais(?:e|ed|es|ing)\b|\bincreas|\bboost|\bupgrad|\blift(?:s|ed|ing)?\b|'
                       r'상향|올려|올린|높여|높인', re.I),
  'maintained': re.compile(r'\b(?:re)?affirm|\b(?:re)?confirm|\bmaintain|\breiterat|\bunchanged\b|'
                           r'\bcontinu(?:e|es|ed|ing) to expect|\bremains?\s+(?:in\s+line|on\s+track)|유지|재확인', re.I),
  'lowered': re.compile(r'\blower(?:s|ed|ing)?\b|\breduc|\bcut(?:s|ting)?\b|\bdecreas|\btrim(?:s|med|ming)?\b|'
                        r'하향|낮춰|낮춘|내려|내린', re.I),
  'withdrawn': re.compile(r'\bwithdr[ae]w|\bwithh[eo]ld|\bsuspend|철회', re.I),
}


def stated_supported(g: GuidanceRow) -> bool:
  return g.stated is None or bool(_STATED_WORDS[g.stated].search(g.quote or ''))


REASON_PAST_YEAR = '과거 연도'
REASON_RANGE = '범위 뒤집힘'
STATED_CLEARED = 'stated 근거 없음'   # 버림이 아니라 고침(행은 남고 stated 만 None) — '억→million 환산' 과 같은 갈래
NOT_DROPPED = frozenset({'억→million 환산', STATED_CLEARED})   # why 의 키 중 «버림 수»에 안 넣는 것


def screen(rows: list[GuidanceRow], base_currency: str | None = None, drop: re.Pattern | None = None,
           pub_year: int | None = None) -> tuple[list[GuidanceRow], Counter]:
  """LLM 행 거르기(모듈 docstring 의 목록). 반환 = (남은 행, 사유 → 건수 — NOT_DROPPED 의 키는 버림이 아니라 고침).
  pub_year = 문서 발행 연도 — 그보다 앞선 해의 숫자 지표 행은 과거 실적 오독으로 버린다(None 이면 이 검사를 건너뛴다 ·
  상태 행 metric='other' 는 검사 밖)."""
  out, why = [], Counter()
  for g in rows:
    reason = None
    if g.metric == 'other' and (g.low is not None or g.high is not None):
      reason = '숫자 other'
    elif has_quarter_mark(g.quote, (g.low, g.high)):
      reason = '분기·반기'
    elif multi_year_rate(g):
      reason = '여러 해 성장률'
    elif drop is not None and (drop.search(g.quote or '') or drop.search(g.metric_label or '')):
      reason = '파서 제외'
    elif pub_year is not None and g.metric != 'other' and int(g.period.removeprefix('FY')) < pub_year:
      # 상태 행(other — 숫자는 위 「숫자 other」가 이미 버렸다)은 연초 문서의 「작년 전망 달성·확인」이라 남긴다(잔여 Minor 4)
      reason = REASON_PAST_YEAR
    elif g.low is not None and g.high is not None and g.low > g.high:
      reason = REASON_RANGE
    if reason is None:
      fixed = fix_eok(g)
      if fixed is not g:
        why['억→million 환산'] += 1
        g = fixed
      reason = unit_mismatch(g) or ('규모' if scale_mismatch(g) else None)
    if reason is None:
      if g.unit not in MONEY_UNITS or g.currency == base_currency:
        g = replace(g, currency=None) if g.currency else g   # 비금액·보고 통화 = None(칸 뜻: None = 회사 보고 통화)
      if g.currency is None and foreign_currency(g, base_currency):
        reason = '통화'
    if reason:
      why[reason] += 1
      continue
    if not stated_supported(g):
      why[STATED_CLEARED] += 1
      g = replace(g, stated=None)
    out.append(g)
  return out, why


def extract(client, doc, text: str, company_label: str, hint: str = '', base_currency: str | None = None,
            drop: re.Pattern | None = None) -> tuple[list[GuidanceRow], Counter]:
  """(남은 LLM 행, 거른 사유 → 건수). 예외는 오케스트레이터가 문서 하나로 격리한다."""
  if len(text) > MAX_CHARS:
    print(f'    경고: 문서 {doc.id} 글 {len(text):,}자 → 앞 {MAX_CHARS:,}자만 LLM 에 넘김')
  msg = client.messages.create(
    model=MODEL, max_tokens=MAX_TOKENS, thinking={'type': 'adaptive'},
    output_config={'effort': EFFORT, 'format': {'type': 'json_schema', 'schema': SCHEMA}},
    system=SYSTEM,
    messages=[{'role': 'user', 'content':
               f'회사: {company_label}\n보고 통화: {base_currency or "모름"}\n문서: {doc.title} ({doc.published_at})\n'
               f'{hint}\n\n--- 원문 ---\n{text[:MAX_CHARS]}'}],
  )
  # 토큰 실측(D6 — 큰 IR PDF 한 건이 얼마를 쓰는지). 금액 계산은 하지 않는다
  usage = getattr(msg, 'usage', None)
  if usage is not None:
    print(f'    문서 {doc.id} LLM 토큰: 입력 {usage.input_tokens:,} · 출력 {usage.output_tokens:,}')
  if msg.stop_reason in ('max_tokens', 'refusal'):
    print(f'    경고: 문서 {doc.id} LLM 응답 중단({msg.stop_reason}) — LLM 대기로 남긴다')
    raise Incomplete(msg.stop_reason)
  body = next((b.text for b in msg.content if b.type == 'text'), '')
  pub = str(doc.published_at or '')[:4]
  rows, why = screen(to_rows(json.loads(body).get('items', [])), base_currency, drop, int(pub) if pub.isdigit() else None)
  if why:
    print(f'    문서 {doc.id} LLM 행 거름: ' + ' · '.join(f'{k} {v}' for k, v in sorted(why.items())))
  return rows, why


# ---------------------------------------------------------------- 자가 시험(실물 문장꼴)
_STLA_287 = ('Q3 2024 Q3 2023 Change FY 2024 GUIDANCE AOI margin (2) : 5.5% - 7% Industrial free cash flows (3) : '
             '€(5) billion - €(10) billion')
# 항목 = quote 또는 (quote, 행 값) — 값을 주면 연간 머리 규칙이 값 위치를 본다
QUARTER_MISS = [   # 버려져야 하는 quote(분기·반기 전망)
  # 폴라리스 10월 잠정실적 8-K(분기 범위)
  'we expect third quarter sales to be at the high end of our previously issued guidance range of $1.6 billion to '
  '$1.8 billion. We anticipate third quarter adjusted EPS to be in the range of $0.31 to $0.41',
  'The Company introduced second quarter 2025 sales guidance of $1.6 billion to $1.8 billion.',
  'Q4 2026 revenue is expected to be between $1.9 billion and $2.0 billion',
  'will release its 4Q25 and full year 2025 financial results',
  'fourth-quarter deliveries are expected to be around 20,000 units',
  '4분기 판매 목표 10만 대',
  # 스텔란티스 2025-07 반기 상자(stellantis.py 머리 'H2 2025 FINANCIAL GUIDANCE')
  'H2 2025 FINANCIAL GUIDANCE Net revenues Low-Single Digit % Increase Adj. operating income margin Low-Single Digit %',
  'We expect second-half deliveries to improve',
  '하반기 판매 목표 20만 대',
  # 연간 머리 «뒤»의 분기 표지는 그대로 걸린다
  ('Full Year 2026 Guidance Sales $7.15B - $7.30B. Q4 2026 sales are expected to be $1.9 billion', (1.9,)),
  # 값이 연간 머리 «앞»이면 앞의 분기 표지가 그 값의 기간이다(수정 2회차 N1 · 값을 줘도 걸려야 한다)
  ('Fourth quarter sales are expected to be $1.9 billion, and we are reaffirming our full year guidance', (1.9,)),
  ('We expect third quarter sales of $1.6 billion to $1.8 billion. Full-year 2026 guidance is unchanged.', (1.6, 1.8)),
  ('Q4 2026 sales are expected to be $1.9 billion. Full Year 2026 Guidance Sales $7.15B - $7.30B', (1.9,)),
]
QUARTER_HIT = [    # 남아야 하는 quote(연간 전망)
  'The Company now expects 2026 adjusted sales to be between $7.55 billion to $7.60 billion versus prior guidance of '
  '$7.30 billion to $7.50 billion.',
  'Full Year 2026 Guidance (Updated 3/3/26) Sales $7.15B - $7.30B Adjusted EPS $1.60 - $1.70',
  'Expect positive Industrial free cash flows (3) in 2027',
  '2026년 판매목표 : 416만 대',
  'Group sales revenue of between 35 and 36 billion euros.',
  '2026년 연결 기준 매출액 성장률(전년대비) : 3.0~4.0%',
  # 스텔란티스 2026 상자(실물 252) — H2 는 지난 기간의 비용을 가리킨다
  "Industrial free cash flows Improved Y-o-Y Includes (€2B) in 2026 payments related to H2 '25 charges Expect Positive "
  'IFCF in 2027',
  'Stellantis confirms that its 2025 financial guidance, as communicated during the H1 Earnings Call on July 29, 2025, '
  'remains unchanged in all respects.',
  # 스텔란티스 2024 Q3 6-K(실물 287) — 표 머리의 분기 실적 칸 뒤에 연간 전망 머리 · 값은 전부 머리 뒤
  (_STLA_287, (5.5, 7)),
  (_STLA_287, (-10, -5)),
  # 같은 문장에서 머리 뒤 연간 값은 남는다(앞의 Q4 값만 분기)
  ('Q4 2026 sales are expected to be $1.9 billion. Full Year 2026 Guidance Sales $7.15B - $7.30B', (7.15, 7.30)),
]

# (metric, low, high, unit, quote) — 실물 문장꼴(2026-11-10 백필) + 검토 지적 반례
SCALE_MISS = [   # 규모가 틀려 버려져야 하는 행(quote_check 는 통과한다)
  ('capex', 17.8, 17.8, 'billion', '17.8조 자동차부문투자계획'),                       # 조 → billion
  ('sales_units', 416, 416, 'units', '2026년 판매목표 : 416만 대'),                      # 만 → units
  ('order_intake', 89.7, 89.7, 'million', "감소한USD 89.7억(전동화부품수주목표USD 28억포함)"),   # 억 → million
  ('deliveries', 1234, 1234, 'units', 'Deliveries (in thousands) 1,234 1,100'),          # in thousands
  ('revenue', 35, 36, 'million', 'Group sales revenue of between 35 and 36 billion euros.'),
  ('operating_margin', 5, 5, 'percent', '영업이익률 5억'),                               # percent 는 배수 1 만
]
SCALE_HIT = [    # 남아야 하는 행
  ('capex', 17.8, 17.8, 'trillion', '17.8조 자동차부문투자계획'),
  ('sales_units', 4160000, 4160000, 'units', '2026년 판매목표 : 416만 대'),
  ('order_intake', 8970, 8970, 'million', "감소한USD 89.70억(전동화부품수주목표USD 28억포함)"),
  ('deliveries', 1234000, 1234000, 'units', 'Deliveries (in thousands) 1,234 1,100'),
  ('revenue', 35, 36, 'billion', 'Group sales revenue of between 35 and 36 billion euros.'),
  ('free_cash_flow', -1.0, 0.5, 'trillion', 'FCF(금융제외) -1.0 ~ 0.5조'),
  ('industrial_fcf', -10, -5, 'billion', 'Industrial free cash flows (3) : €(5) billion - €(10) billion'),
  ('revenue', 7.15, 7.30, 'billion', 'Full Year 2026 Guidance Sales $7.15B - $7.30B Adjusted EPS $1.60 - $1.70'),
  ('eps_adjusted', 1.6, 1.7, 'per_share', 'Full Year 2026 Guidance Sales $7.15B - $7.30B Adjusted EPS $1.60 - $1.70'),
  ('automotive_ncf_margin', 3, 5, 'percent', 'ranging between 3 and 5 per cent.'),
  ('deliveries', 300000, None, 'units', 'VinFast reiterates its global deliveries of at least 300,000 EVs'),
  ('operating_income', 13.5, 13.5, 'trillion', '2. 영업이익 / 영업이익률 2028년 : 13.5조원 / 9% 2030년 : 17.0조원 / 10%'),
]
UNIT_MISS = [    # 비율 단위·text 숫자
  ('investment_ratio', 17.8, 17.8, 'trillion', '17.8조 자동차부문투자계획'),
  ('bev_share', 1000000, 1000000, 'units', '·판매 목표 2030년 : 413만대 (EV : 100만대, xHEV : 115만대)'),
  ('revenue', 89.7, 89.7, 'text', 'Sales of 89.7 next year'),
]
_EOK_Q = "※ '26년목표는'25년실적대비2.1% 감소한USD 89.7억(전동화부품수주목표USD 28억포함)"
EOK_FIX = [      # (low, high, unit, quote) → 기대 (low, high, unit)
  ((89.7, 89.7, 'billion', _EOK_Q), (8970, 8970, 'million')),
  ((89.7, 89.7, 'text', _EOK_Q), (8970, 8970, 'million')),                  # 2026-11-10 실측(모비스 IR 재실행)
  ((89.7, 89.7, 'billion', '수주 목표 USD 89.70억'), (8970, 8970, 'million')),   # 끝 0
  ((8970, 8970, 'million', _EOK_Q), (8970, 8970, 'million')),              # 이미 맞음
  ((2.8, 2.8, 'billion', 'USD 2.8 billion, 전년 128억'), (2.8, 2.8, 'billion')),   # 다른 수의 억은 상관없다
  ((3, 3, 'trillion', '투자 3천억'), (3, 3, 'trillion')),                  # 천억은 억이 아니다 — 고치지 않는다(규모가 버린다)
]
# 모비스 IR 실물(510) — CAGR 은 버리고 같은 줄의 연간 영업이익률은 남긴다
_MOBIS = "'27년 재무목표 : 매출성장 CAGR +8% ('24~'27) 영업이익률 5~6% ('27) TSR 30%+ ('25~'27)"
MULTI_YEAR_MISS = [('revenue_growth', 8, 8, _MOBIS, '매출성장 CAGR'), ('revenue_growth', 8, 8, _MOBIS, '매출성장'),
                   ('revenue_growth', 4, 4, 'Net sales compound annual growth of 4% through 2030', 'Net sales growth')]
MULTI_YEAR_HIT = [('operating_margin', 5, 6, _MOBIS, '영업이익률'),
                  ('revenue_growth', 3.0, 4.0, '2026년 연결 기준 매출액 성장률(전년대비) : 3.0~4.0%', '매출액 성장률')]
# (unit, low, quote, currency, base) → 버려지나
CURRENCY_CASES = [
  ('million', 8970, _EOK_Q, None, 'KRW', True),        # USD 표지인데 통화 칸이 비었다
  ('million', 8970, _EOK_Q, 'USD', 'KRW', False),
  ('trillion', 17.8, '17.8조원 투자', None, 'KRW', False),
  ('billion', 7.15, 'Sales $7.15B - $7.30B', None, 'USD', False),
  ('billion', 35, 'between 35 and 36 billion euros', None, 'EUR', False),
  ('billion', 35, 'between 35 and 36 billion euros', None, 'USD', True),
  ('percent', 5, '영업이익률 5% (USD 기준 매출)', None, 'KRW', False),   # 비금액은 보지 않는다
  # 값 뒤 괄호 환산은 그 값의 통화가 아니다(수정 2회차 N4 — 빈패스트 보도자료 꼴)
  ('billion', 47028, 'Total revenues of VND47,028 billion (US$1.85 billion)', None, 'VND', False),
  ('billion', 35, 'Group revenue of EUR 35 to 36 billion (USD 38 to 39 billion)', None, 'EUR', False),
  ('billion', 1.85, 'Total revenues of VND47,028 billion (US$1.85 billion)', None, 'VND', True),   # 괄호 안 값은 USD
  ('billion', 38, 'Group revenue of EUR 35 to 36 billion (USD 38 to 39 billion)', None, 'EUR', True),
  # 배수 낱말과 통화 사이에 US·U.S.·in US 가 끼는 꼴(최종 검토 P1 — 전엔 통화를 못 찾아 그대로 통과)
  ('billion', 35, 'Revenue of 35 to 36 billion US dollars', None, 'EUR', True),
  ('billion', 35, 'Revenue of 35 billion U.S. dollars', None, 'EUR', True),
  ('billion', 35, 'Revenue of 35 billion in US dollars', None, 'EUR', True),
  ('billion', 35, 'Revenue of 35 billion in euros', None, 'EUR', False),
  ('billion', 35, 'Revenue of 35 billion US dollars', None, 'USD', False),
]
# (stated, quote) — stated 는 인용 대조 밖이라 quote 에 그 낱말 어간이 있어야 남는다(최종 검토 P2)
STATED_HIT = [   # stated 가 그대로 남아야 한다
  ('maintained', 'Stellantis confirms that its 2025 financial guidance, as communicated during the H1 Earnings Call on '
                 'July 29, 2025, remains unchanged in all respects.'),
  ('maintained', 'VinFast reiterates its global deliveries of at least 300,000 EVs'),
  ('maintained', 'The Company reaffirmed its full-year 2026 guidance.'),
  # 실물 LLM 행(2026-11-10 DB) — 확인 낱말 없이 유지를 밝힌 꼴
  ('maintained', 'The company continues to expect group sales revenue in the region of 37 to 38 billion euros.'),
  ('maintained', 'our current expectations for production and deliveries remain in line with our business plan'),
  ('raised', 'GM is raising its full-year 2025 guidance: EBIT-adjusted of $12.0 billion to $13.0 billion'),
  ('raised', 'Acme Motors raised its 2026 deliveries outlook to 70,000 vehicles'),
  ('lowered', 'The Company lowered its 2026 sales guidance to $7.0 billion'),
  ('lowered', 'Acme Motors cut its full-year outlook to 60,000 units'),
  ('withdrawn', 'Due to tariff uncertainty, the Company is withdrawing its 2025 guidance.'),
  ('withdrawn', 'Acme Motors withheld full-year guidance'),
  ('withdrawn', 'The Company suspended its 2025 guidance'),
  ('raised', '2026년 판매 목표 상향 조정 : 420만 대'),
  ('lowered', '연간 영업이익률 가이던스 하향 : 5~6%'),
  ('maintained', '2026년 투자 계획 17.8조 유지'),
  ('withdrawn', '연간 가이던스 철회'),
  # 잔여 Minor 3 — 같은 뜻의 다른 낱말·한국어 활용형
  ('raised', 'The Company increased its full-year guidance for adjusted EBITDA.'),
  ('raised', 'Acme Motors boosted its 2026 deliveries outlook to 72,000 vehicles'),
  ('raised', 'Acme Motors upgraded its full-year margin outlook'),
  ('raised', 'Acme Motors lifts 2026 revenue guidance'),
  ('lowered', 'The Company decreased its full-year capital expenditure outlook.'),
  ('lowered', 'Acme Motors trimmed its 2026 deliveries forecast to 58,000 units'),
  ('raised', '연간 판매 목표를 430만 대로 올려 잡았다'),
  ('raised', '영업이익률 목표를 높인 7~8%'),
  ('lowered', '연간 판매 목표를 400만 대로 낮춰 잡았다'),
  ('lowered', '투자 계획을 내린 15조 원'),
]
STATED_MISS = [  # stated 를 지워야 한다(행은 남는다)
  ('raised', 'The Company now expects 2026 adjusted sales to be between $7.55 billion to $7.60 billion versus prior '
             'guidance of $7.30 billion to $7.50 billion.'),
  ('withdrawn', 'Expect positive Industrial free cash flows (3) in 2027'),
  ('maintained', 'Group sales revenue of between 35 and 36 billion euros.'),
  ('lowered', 'Disciplined cost execution supports 2026 operating margin of 5%'),   # execution 속 'cut'
  ('raised', 'The Company lowered its 2026 sales guidance to $7.0 billion'),          # 낱말이 다른 방향
  ('lowered', 'Acme Motors raised its 2026 deliveries outlook to 70,000 vehicles'),
]
# (year, low, high, 발행 연도) → 버려지나(최종 검토 P9 — 과거 실적 오독 · 범위 뒤집힘)
SHAPE_CASES = [
  (2025, 10.0, 12.0, 2026, True),    # 발행 연도보다 앞선 해 = 과거 실적
  (2026, 10.0, 12.0, 2026, False),
  (2030, 10.0, 12.0, 2026, False),   # 중장기 목표
  (2026, 12.0, 10.0, 2026, True),    # low > high
  (2026, -10.0, -5.0, 2026, False),  # 음수 범위(€(5)~€(10) → -10~-5)
  (2026, 10.0, None, 2026, False),   # 한쪽 끝만
  (2025, 10.0, 12.0, None, False),   # 발행 연도 모름 → 연도 검사 안 함
]
# 상태 행(metric='other' · 숫자 없음)은 과거 연도 검사 밖(잔여 Minor 4 — 연초 문서의 「작년 전망 달성·확인」)
STATUS_PAST_KEEP = ['Stellantis confirms that it achieved its 2025 financial guidance.']
# 파서 LLM_DROP 을 screen 이 쓰는지(장치 시험 — 빈패스트 정규식 자체의 실물 시험은 vinfast.self_test)
_DROP_PROBE = re.compile(r'scooter', re.I)
DROP_MISS = ['For the full year 2025, the Company delivered 406,498 e-scooters and e-bikes, representing a 473% increase.']


def self_test() -> list[str]:
  row = lambda m, lo, hi, u, q, label=None, cur=None: GuidanceRow(m, label or m, 'FY2026', lo, hi, None, u, None, q,
                                                                  None, cur)
  qv = lambda c: c if isinstance(c, tuple) else (c, ())
  errs = [f'QUARTER_MISS 안 걸림: {q[:60]} {v}' for q, v in map(qv, QUARTER_MISS) if not has_quarter_mark(q, v)]
  errs += [f'QUARTER_HIT 걸림: {q[:60]} {v}' for q, v in map(qv, QUARTER_HIT) if has_quarter_mark(q, v)]
  errs += [f'SCALE_MISS 안 걸림: {c[0]} {c[1]} {c[3]}' for c in SCALE_MISS if not scale_mismatch(row(*c))]
  errs += [f'SCALE_HIT 걸림: {c[0]} {c[1]} {c[3]}' for c in SCALE_HIT if scale_mismatch(row(*c))]
  errs += [f'UNIT_MISS 안 걸림: {c[0]} {c[3]}' for c in UNIT_MISS if not unit_mismatch(row(*c))]
  for (lo, hi, u, q), want in EOK_FIX:
    g = fix_eok(row('order_intake', lo, hi, u, q))
    if (g.low, g.high, g.unit) != want:
      errs.append(f'EOK_FIX 어긋남: {lo} {u} {q[-12:]} → {(g.low, g.high, g.unit)}')
  errs += [f'MULTI_YEAR_MISS 안 걸림: {c[4]}' for c in MULTI_YEAR_MISS
           if not multi_year_rate(row(c[0], c[1], c[2], 'percent', c[3], c[4]))]
  errs += [f'MULTI_YEAR_HIT 걸림: {c[4]}' for c in MULTI_YEAR_HIT
           if multi_year_rate(row(c[0], c[1], c[2], 'percent', c[3], c[4]))]
  for unit, lo, q, cur, base, dropped in CURRENCY_CASES:
    _, why = screen([row('revenue' if unit != 'percent' else 'operating_margin', lo, lo, unit, q, None, cur)], base)
    if bool(why.get('통화')) != dropped:
      errs.append(f'CURRENCY 어긋남: {unit} {lo} {cur} {base} {q[:30]}')
  errs += [f'DROP_MISS 안 걸림: {q[:50]}' for q in DROP_MISS
           if screen([row('deliveries', 406498, 406498, 'units', q)], None, _DROP_PROBE)[1].get('파서 제외') != 1]
  if screen([row('other', 30, 30, 'percent', '배당성향 30%')])[1].get('숫자 other') != 1:
    errs.append('숫자 other 가 안 걸림')
  for want_kept, cases in ((True, STATED_HIT), (False, STATED_MISS)):
    for st, q in cases:
      g = replace(row('other', None, None, 'text', q), value_text='x', stated=st)
      kept, why = screen([g])
      if len(kept) != 1:
        errs.append(f'STATED 행이 버려짐: {st} {q[:40]}')
      elif (kept[0].stated == st) != want_kept:
        errs.append(f'STATED_{"HIT" if want_kept else "MISS"} 어긋남: {st} {q[:40]}')
      elif not want_kept and why.get(STATED_CLEARED) != 1:
        errs.append(f'STATED_MISS 건수 안 셈: {st} {q[:40]}')
  for year, lo, hi, pub, dropped in SHAPE_CASES:
    g = GuidanceRow('revenue', 'Revenue', f'FY{year}', lo, hi, None, 'billion', None, 'revenue of 10 to 12 billion')
    _, why = screen([g], None, None, pub)
    if bool(why.get(REASON_PAST_YEAR) or why.get(REASON_RANGE)) != dropped:
      errs.append(f'SHAPE 어긋남: FY{year} {lo}~{hi} 발행 {pub}')
  for q in STATUS_PAST_KEEP:
    g = GuidanceRow('other', 'Guidance', 'FY2025', None, None, 'confirms', 'text', None, q, 'maintained')
    kept, why = screen([g], None, None, 2026)
    if len(kept) != 1 or why.get(REASON_PAST_YEAR):
      errs.append(f'STATUS_PAST_KEEP 버려짐: {q[:40]}')
  item = SCHEMA['properties']['items']['items']
  if SCHEMA.get('additionalProperties') is not False or item.get('additionalProperties') is not False:
    errs.append('SCHEMA additionalProperties 가 false 가 아니다(구조화 출력 필수)')
  if set(item['required']) != set(item['properties']):
    errs.append('SCHEMA 항목 칸 중 required 에 빠진 것이 있다')
  return errs
