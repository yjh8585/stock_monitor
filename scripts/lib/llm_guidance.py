"""고객사 가이던스 LLM 추출 — 코드 파서가 못 뽑는 칸만(회사별 llm_wants). 결과는 반드시 quote_check 를 지난다.

모델 상수는 여기 한곳. 구조화 출력 본보기 = collect_oem_model_outlook.py _evaluate(output_config.format · adaptive thinking).
호출 = scripts/collect_customer_numbers.py _CompanyRun._llm(문서마다 한 번 · 예외는 그 문서만 「LLM 실패」로 격리).

- extract 가 돌려준 행은 오케스트레이터가 코드 행 «뒤»에 붙인다 → dedupe 가 같은 (metric, period) 의 코드 행을 남긴다(코드 우선).
  extractor='llm' 표시·quote_check 대조도 오케스트레이터 몫이다(코드 행과 같은 검사).
- 🔴 응답이 잘리거나(max_tokens) 거절되면(refusal) 빈 목록이 아니라 Incomplete 를 던진다 — 빈 목록이면 «LLM 이 읽었는데
  전망이 없다»로 보여 IR 문서가 not_target 으로 닫히고 다시 안 읽힌다(요약서 시제품의 「경고 후 빈 목록」에서 바꿈).
- 🔴 분기 전망이 FY 행으로 새지 않게(폴라리스 10월 잠정실적 · Task 8 carry): 프롬프트에서 빼고, 그래도 quote 에 분기 표지
  ('fourth quarter'·'Q4'·'4Q25'·'4분기')가 있는 행은 버린다(QUARTER_MISS — 조용히 틀린 칸보다 빈칸).
- 키·본문은 출력하지 않는다(경고는 문서 id 와 글자 수만).
"""
import json
import os
import re
from dataclasses import replace

from customer_parsers.base import BASES, METRICS, STATED, UNITS, GuidanceRow

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
    'required': ['metric', 'metric_label', 'year', 'low', 'high', 'value_text', 'unit', 'basis', 'quote', 'stated'],
    'properties': {
      'metric': {'type': 'string', 'enum': list(METRICS)},   # 파서와 같은 어휘(base.py)
      'metric_label': {'type': 'string'},
      'year': {'type': 'integer'},
      'low': _NULLABLE_NUM, 'high': _NULLABLE_NUM, 'value_text': _NULLABLE_STR,
      'unit': {'type': 'string', 'enum': list(UNITS)},
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

뽑지 않는 것
- 분기·반기 전망(예 'fourth quarter'·'Q4'·'H2'·'4분기'·'하반기') — 연간 칸에 넣지 말고 아예 만들지 않는다.
- 과거 실적 · 애널리스트·시장 추정 · 직전 전망(바뀌기 전 값 — '(previously: …)'·'versus prior guidance of …'·
  'previous forecast') · 연도가 없는 중장기 목표 · 업계 전체(시장) 전망 · 여러 해 누적 금액('2026~2030년 5년간 투자 49조' —
  한 해 값이 아니다).

값과 단위
- low·high 는 원문에 적힌 수를 쓴다. unit 은 원문 단위: million·billion·trillion(금액) · per_share(주당) · percent(%) ·
  units(대수 — '416만 대' 는 4160000, '1.2 million units' 는 1200000) · text(숫자 아님).
  국문 금액: 'N조원' → N, unit=trillion · 'N억원' → N×100, unit=million(억원은 백만원 단위로) · 'N백만원' → N, unit=million.
  외화도 같다: 'USD 89.7억'·'89.7억 달러' → 8970, unit=million(억은 billion 이 아니다).
- 비율 지표(revenue_growth·operating_margin·aoi_margin·automotive_ncf_margin·automotive_ebitda_margin·investment_ratio·
  bev_share)는 unit 이 percent 또는 text 일 때만 쓴다. 투자 «금액»은 capex, 전기차 «대수»처럼 맞는 지표가 없으면 'other'.
- 감소 전망('down 1 to 4 percent')처럼 부호가 원문 수와 달라지는 것은 숫자로 바꾸지 말고 value_text 에 원문 그대로.
- basis 는 원문이 조정(adjusted·non-GAAP·before special items)이라고 밝혔으면 adjusted, 장부상(reported·IFRS·GAAP)이면
  reported, 밝히지 않았으면 null.
- stated 는 원문이 raise·reaffirm·confirm·lower·withdraw 같은 말을 직접 썼을 때만(raised·maintained·lowered·withdrawn),
  아니면 null.

quote (가장 중요)
- 값이 든 원문 문장(또는 표 한 행) «전체»를 한 글자도 바꾸지 말고 그대로. 번역·요약·생략 부호('…')·짜깁기 금지.
- 기계가 quote 의 12자 이상 이어진 조각이 원문에 그대로 있는지, 값(low·high·value_text)이 그 조각 안에 있는지 대조한다 —
  값과 그 앞뒤 낱말이 한 덩어리로 들어가게 문장·행을 통째로 옮긴다.

확신이 없으면 항목을 만들지 말고 빈 목록을 돌려준다."""

# 분기 표지 — FY 행 quote 에 있으면 버린다(분기 전망이 연간 칸으로 새는 것 차단)
_QUARTER = re.compile(
  r'\b(?:first|second|third|fourth|1st|2nd|3rd|4th)[- ]quarter\b|\bQ[1-4]\b|\b[1-4]Q(?:\d{4}|\d{2})?\b|[1-4]\s*분기',
  re.I)


class Incomplete(Exception):
  """응답이 끝까지 오지 않았다(max_tokens·refusal) — 그 문서는 LLM 대기로 남긴다(오케스트레이터가 note 에 클래스 이름)."""


def make_client():
  """실행마다 한 번. 키가 없으면 None — 오케스트레이터가 LLM 칸을 건너뛰고 문서를 LLM 대기로 남긴다(실행은 계속)."""
  if not os.environ.get('ANTHROPIC_API_KEY'):
    return None
  from anthropic import Anthropic
  return Anthropic()


def has_quarter_mark(quote: str) -> bool:
  return _QUARTER.search(quote or '') is not None


# 단위가 어긋난 행 — quote_check 는 «수가 원문에 있는가»만 보므로 단위가 틀려도 통과한다(2026-11-10 실측 백필).
# - '89.7억'을 89.7 billion 으로(모비스 IR · 10배 틀린 값이 검증 통과 · 프롬프트에 적어도 반복) → 원문 'N억' 은 정의상
#   N×100 million 이라 환산해 바로잡는다(fix_eok).
# - 비율 지표에 금액·대수(투자 17.8조 → investment_ratio · EV 100만 대 → bev_share) → 맞는 칸을 추측하지 않고 버린다.
PERCENT_METRICS = frozenset(('revenue_growth', 'operating_margin', 'aoi_margin', 'automotive_ncf_margin',
                             'automotive_ebitda_margin', 'investment_ratio', 'bev_share'))


def _num(v: float) -> str:
  return f'{v:f}'.rstrip('0').rstrip('.')


def unit_mismatch(g: GuidanceRow) -> bool:
  """버린다(조용히 틀린 칸보다 빈칸) — 비율 지표에 percent·text 가 아닌 단위 · unit='text' 인데 숫자(단위를 모르는 수)."""
  if g.unit == 'text':
    return g.low is not None or g.high is not None
  return g.metric in PERCENT_METRICS and g.unit != 'percent'


def _eok(v: float | None, quote: str) -> bool:
  return v is not None and re.search(rf'(?<![\d.]){re.escape(_num(v))}\s*억', quote or '') is not None


def fix_eok(g: GuidanceRow) -> GuidanceRow:
  """원문 'N억' 을 N billion·trillion(또는 text)으로 적은 행 → N×100 million(억 = 1e8 = 100 million)."""
  if g.unit not in ('billion', 'trillion', 'text') or not (_eok(g.low, g.quote) or _eok(g.high, g.quote)):
    return g
  x100 = lambda v: None if v is None else round(v * 100, 6)
  return replace(g, low=x100(g.low), high=x100(g.high), unit='million')


def to_rows(items: list[dict]) -> list[GuidanceRow]:
  return [GuidanceRow(i['metric'], i['metric_label'], f'FY{i["year"]}', i['low'], i['high'], i['value_text'],
                      i['unit'], i['basis'], i['quote'], i['stated']) for i in items]


def extract(client, doc, text: str, company_label: str, hint: str = '') -> list[GuidanceRow]:
  if len(text) > MAX_CHARS:
    print(f'    경고: 문서 {doc.id} 글 {len(text):,}자 → 앞 {MAX_CHARS:,}자만 LLM 에 넘김')
  msg = client.messages.create(
    model=MODEL, max_tokens=MAX_TOKENS, thinking={'type': 'adaptive'},
    output_config={'effort': EFFORT, 'format': {'type': 'json_schema', 'schema': SCHEMA}},
    system=SYSTEM,
    messages=[{'role': 'user', 'content':
               f'회사: {company_label}\n문서: {doc.title} ({doc.published_at})\n{hint}\n\n--- 원문 ---\n{text[:MAX_CHARS]}'}],
  )
  if msg.stop_reason in ('max_tokens', 'refusal'):
    print(f'    경고: 문서 {doc.id} LLM 응답 중단({msg.stop_reason}) — LLM 대기로 남긴다')
    raise Incomplete(msg.stop_reason)
  body = next((b.text for b in msg.content if b.type == 'text'), '')
  rows = to_rows(json.loads(body).get('items', []))
  kept = [g for g in rows if not has_quarter_mark(g.quote)]
  if len(kept) < len(rows):
    print(f'    문서 {doc.id} LLM 행 중 분기 표지 {len(rows) - len(kept)}행 버림')
  fixed = [fix_eok(g) for g in kept]
  n_fix = sum(a is not b for a, b in zip(kept, fixed))
  if n_fix:
    print(f'    문서 {doc.id} LLM 행 중 억 단위 {n_fix}행 million 으로 환산')
  out = [g for g in fixed if not unit_mismatch(g)]
  if len(out) < len(fixed):
    print(f'    문서 {doc.id} LLM 행 중 비율 지표 단위 어긋남 {len(fixed) - len(out)}행 버림')
  return out


# ---------------------------------------------------------------- 자가 시험(분기 표지 — 실물 문장꼴)
QUARTER_MISS = [   # 버려져야 하는 quote(분기 전망)
  # 폴라리스 10월 잠정실적 8-K(분기 범위)
  'we expect third quarter sales to be at the high end of our previously issued guidance range of $1.6 billion to '
  '$1.8 billion. We anticipate third quarter adjusted EPS to be in the range of $0.31 to $0.41',
  'The Company introduced second quarter 2025 sales guidance of $1.6 billion to $1.8 billion.',
  'Q4 2026 revenue is expected to be between $1.9 billion and $2.0 billion',
  'will release its 4Q25 and full year 2025 financial results',
  'fourth-quarter deliveries are expected to be around 20,000 units',
  '4분기 판매 목표 10만 대',
]
QUARTER_HIT = [    # 남아야 하는 quote(연간 전망)
  'The Company now expects 2026 adjusted sales to be between $7.55 billion to $7.60 billion versus prior guidance of '
  '$7.30 billion to $7.50 billion.',
  'Full Year 2026 Guidance (Updated 3/3/26) Sales $7.15B - $7.30B Adjusted EPS $1.60 - $1.70',
  'Expect positive Industrial free cash flows (3) in 2027',
  '2026년 판매목표 : 416만 대',
  'Group sales revenue of between 35 and 36 billion euros.',
  '2026년 연결 기준 매출액 성장률(전년대비) : 3.0~4.0%',
]


# (metric, low, high, unit, quote) — 실물 문장꼴(2026-11-10 백필)
UNIT_MISS = [   # 버려져야 하는 행
  ('investment_ratio', 17.8, 17.8, 'trillion', '17.8조 자동차부문투자계획'),
  ('bev_share', 1000000, 1000000, 'units', '·판매 목표 2030년 : 413만대 (EV : 100만대, xHEV : 115만대)'),
  ('revenue', 89.7, 89.7, 'text', 'Sales of 89.7 next year'),   # text 인데 숫자 — 단위를 모른다
]
UNIT_HIT = [    # 남아야 하는 행
  ('capex', 17.8, 17.8, 'trillion', '17.8조 자동차부문투자계획'),
  ('investment_ratio', 12, 13, 'percent', 'investment ratio between 12 and 13 percent'),
  ('revenue', 170, 170, 'trillion', '1. 매출액 2028년 : 150조원 2030년 : 170조원'),
]
_EOK_Q = "※ '26년목표는'25년실적대비2.1% 감소한USD 89.7억(전동화부품수주목표USD 28억포함)"
EOK_FIX = [     # (low, high, unit, quote) → 기대 (low, high, unit)
  ((89.7, 89.7, 'billion', _EOK_Q), (8970, 8970, 'million')),
  ((8970, 8970, 'million', _EOK_Q), (8970, 8970, 'million')),              # 이미 맞음
  ((2.8, 2.8, 'billion', 'USD 2.8 billion, 전년 128억'), (2.8, 2.8, 'billion')),   # 다른 수의 '억'은 상관없다
  ((1.5, 2, 'trillion', '매출 1.5억~2억 달러'), (150, 200, 'million')),
  ((89.7, 89.7, 'text', _EOK_Q), (8970, 8970, 'million')),                  # 2026-11-10 실측(모비스 IR 재실행)
]


def self_test() -> list[str]:
  errs = [f'QUARTER_MISS 안 걸림: {q[:60]}' for q in QUARTER_MISS if not has_quarter_mark(q)]
  row = lambda m, lo, hi, u, q: GuidanceRow(m, m, 'FY2026', lo, hi, None, u, None, q)
  errs += [f'UNIT_MISS 안 걸림: {c[0]} {c[3]}' for c in UNIT_MISS if not unit_mismatch(row(*c))]
  errs += [f'UNIT_HIT 걸림: {c[0]} {c[3]}' for c in UNIT_HIT if unit_mismatch(row(*c))]
  for (lo, hi, u, q), want in EOK_FIX:
    g = fix_eok(row('order_intake', lo, hi, u, q))
    if (g.low, g.high, g.unit) != want:
      errs.append(f'EOK_FIX 어긋남: {lo} {u} → {(g.low, g.high, g.unit)}')
  errs += [f'QUARTER_HIT 걸림: {q[:60]}' for q in QUARTER_HIT if has_quarter_mark(q)]
  item = SCHEMA['properties']['items']['items']
  if SCHEMA.get('additionalProperties') is not False or item.get('additionalProperties') is not False:
    errs.append('SCHEMA additionalProperties 가 false 가 아니다(구조화 출력 필수)')
  if set(item['required']) != set(item['properties']):
    errs.append('SCHEMA 항목 칸 중 required 에 빠진 것이 있다')
  return errs
