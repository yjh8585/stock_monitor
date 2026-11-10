"""lib/llm_guidance.py 시험 — 가짜 클라이언트(네트워크 없음).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_llm_guidance.py -q
"""
import importlib.util
import json
import pathlib
import re
import sys
import unittest
from collections import Counter
from types import SimpleNamespace
from unittest.mock import patch

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

from customer_parsers import base  # noqa: E402
from lib import llm_guidance as lg  # noqa: E402

_p = _SCRIPTS / 'collect_customer_numbers.py'
spec = importlib.util.spec_from_file_location('ccn', _p)
ccn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ccn)

# 시험 회사는 가짜 이름 — 공개 레포
_SRC = ('Acme Motors 2026 OUTLOOK. The Company expects 2026 deliveries of 65,000 to 70,000 vehicles and capital '
        'expenditures of $1.7 billion. We expect fourth quarter deliveries of 20,000 to 22,000 vehicles.')
_DOC = base.Doc(id=9, company_id='c-1', ticker='ACME', source='edgar', doc_type='earnings_release', form='8-K',
                items='2.02', title='Acme Motors Q3 2026 results', url='https://example.com/x.htm',
                published_at='2026-10-28', source_id='0000-26-1')


def _item(**kw):
  base_item = {'metric': 'deliveries', 'metric_label': 'Deliveries', 'year': 2026, 'low': 65000, 'high': 70000,
               'value_text': None, 'unit': 'units', 'currency': None, 'basis': None,
               'quote': 'The Company expects 2026 deliveries of 65,000 to 70,000 vehicles', 'stated': None}
  return {**base_item, **kw}


class _FakeClient:
  """messages.create 가 정해진 JSON 을 돌려준다 · 받은 인자를 남긴다."""

  def __init__(self, items=None, stop_reason='end_turn', body=None):
    self.calls = []
    text = body if body is not None else json.dumps({'items': items or []})
    msg = SimpleNamespace(stop_reason=stop_reason, content=[SimpleNamespace(type='thinking', thinking=''),
                                                             SimpleNamespace(type='text', text=text)])
    self.messages = SimpleNamespace(create=lambda **kw: (self.calls.append(kw), msg)[1])


class ExtractTests(unittest.TestCase):
  def test_json_to_rows(self):
    """① JSON → GuidanceRow(period 'FY2026' · 칸 그대로) · 프롬프트에 회사·보고 통화·힌트·원문."""
    c = _FakeClient([_item(), _item(metric='capex', metric_label='Capital expenditures', low=1.7, high=1.7,
                                    unit='billion', quote='capital expenditures of $1.7 billion')])
    rows, why = lg.extract(c, _DOC, _SRC, 'Acme Motors', '힌트', 'USD')
    self.assertEqual([(g.metric, g.period, g.low, g.high, g.unit, g.currency) for g in rows],
                     [('deliveries', 'FY2026', 65000, 70000, 'units', None),
                      ('capex', 'FY2026', 1.7, 1.7, 'billion', None)])
    self.assertEqual(why, Counter())
    self.assertIsInstance(rows[0], base.GuidanceRow)
    kw = c.calls[0]
    self.assertEqual(kw['model'], lg.MODEL)
    self.assertEqual(kw['thinking'], {'type': 'adaptive'})
    self.assertEqual(kw['output_config']['format'], {'type': 'json_schema', 'schema': lg.SCHEMA})
    content = kw['messages'][0]['content']
    for want in ('Acme Motors', '힌트', '보고 통화: USD', _SRC):
      self.assertIn(want, content)

  def test_unquoted_value_is_unverified(self):
    """② quote 가 원문에 없는 항목 → 오케스트레이터 대조(verify)에서 verified=false."""
    c = _FakeClient([_item(), _item(metric='revenue', metric_label='Revenue', low=9.0, high=9.5, unit='billion',
                                    quote='The Company expects 2026 revenue of $9.0 to $9.5 billion')])
    res = base.ParseResult(guidance=lg.extract(c, _DOC, _SRC, 'Acme Motors')[0])
    checks = ccn.verify(res, _SRC)
    self.assertEqual([checks[id(g)][0] for g in res.guidance], [True, False])
    self.assertEqual(checks[id(res.guidance[1])][1], 'quote_not_in_source')

  def test_max_tokens_raises_not_empty(self):
    """③ 응답이 잘리면(max_tokens·refusal) 빈 목록이 아니라 Incomplete — 빈 목록이면 «전망 없음»으로 문서가 닫힌다."""
    for reason in ('max_tokens', 'refusal'):
      with self.assertRaises(lg.Incomplete):
        lg.extract(_FakeClient([_item()], stop_reason=reason), _DOC, _SRC, 'Acme Motors')

  def test_usage_tokens_printed(self):
    """D6(Task 5) — 응답의 입력·출력 토큰을 한 줄 찍는다(금액 계산 없음)."""
    c = _FakeClient([_item()])
    c.messages = SimpleNamespace(create=lambda **kw: SimpleNamespace(
      stop_reason='end_turn', usage=SimpleNamespace(input_tokens=123456, output_tokens=789),
      content=[SimpleNamespace(type='text', text=json.dumps({'items': []}))]))
    with patch('builtins.print') as out:
      lg.extract(c, _DOC, _SRC, 'Acme Motors')
    self.assertIn('입력 123,456 · 출력 789', '\n'.join(str(a.args[0]) for a in out.call_args_list))

  def test_bad_json_raises(self):
    with self.assertRaises(json.JSONDecodeError):
      lg.extract(_FakeClient(body='{"items": ['), _DOC, _SRC, 'Acme Motors')

  def test_quarter_rows_dropped(self):
    """분기 표지가 든 quote 의 행은 FY 행으로 새지 않게 버린다(폴라리스 carry) · 사유 건수를 돌려준다."""
    c = _FakeClient([_item(), _item(low=20000, high=22000,
                                    quote='We expect fourth quarter deliveries of 20,000 to 22,000 vehicles')])
    rows, why = lg.extract(c, _DOC, _SRC, 'Acme Motors')
    self.assertEqual([(g.low, g.high) for g in rows], [(65000, 70000)])
    self.assertEqual(why, Counter({'분기·반기': 1}))

  def test_screen_reasons(self):
    """검토 1회차 반례 — 규모(조→billion·만→units·억→million) · 숫자 other · 여러 해 성장률 · 통화 · 파서 제외 ·
    억→million 환산(고침)."""
    c = _FakeClient([
      _item(),
      _item(metric='capex', metric_label='투자', low=17.8, high=17.8, unit='billion', quote='투자계획 17.8조 원'),
      _item(metric='sales_units', metric_label='판매', low=416, high=416, quote='2026년 판매목표 : 416만 대'),
      _item(metric='order_intake', metric_label='수주', low=89.7, high=89.7, unit='million', currency='USD',
            quote='26년 수주 목표 USD 89.7억'),
      _item(metric='order_intake', metric_label='수주', year=2027, low=89.7, high=89.7, unit='billion', currency='USD',
            quote='27년 수주 목표 USD 89.70억'),
      _item(metric='other', metric_label='배당성향', low=30, high=30, unit='percent', quote='배당성향 30% 이상 유지'),
      _item(metric='revenue_growth', metric_label='매출성장', low=8, high=8, unit='percent',
            quote="매출성장 CAGR +8% ('24~'27) 영업이익률 5~6% ('27)"),
      _item(metric='revenue', metric_label='Revenue', low=9.0, high=9.5, unit='billion',
            quote='revenue of USD 9.0 to 9.5 billion'),
      _item(metric='deliveries', metric_label='E-scooter deliveries', year=2025, low=406498, high=406498,
            quote='the Company delivered 406,498 e-scooters and e-bikes'),
    ])
    rows, why = lg.extract(c, _DOC, _SRC, 'Acme Motors', '', 'EUR', re.compile('scooter'))
    self.assertEqual([(g.metric, g.low, g.unit, g.currency) for g in rows],
                     [('deliveries', 65000, 'units', None), ('order_intake', 8970, 'million', 'USD')])
    self.assertEqual(why, Counter({'규모': 3, '숫자 other': 1, '여러 해 성장률': 1, '통화': 1, '파서 제외': 1,
                                   '억→million 환산': 1}))

  def test_shape_and_stated_screen(self):
    """최종 검토 P9·P2 — 문서 발행 연도(2026)보다 앞선 해 · low > high 는 버린다 · 근거 낱말 없는 stated 는 지운다(행 유지)."""
    c = _FakeClient([
      _item(),
      _item(year=2025, quote='The Company expects 2026 deliveries of 65,000 to 70,000 vehicles'),
      _item(low=70000, high=65000),
      _item(stated='withdrawn'),
      _item(stated='raised', quote='Acme Motors raised its 2026 deliveries outlook to 65,000 to 70,000 vehicles'),
    ])
    rows, why = lg.extract(c, _DOC, _SRC, 'Acme Motors')
    self.assertEqual([(g.period, g.low, g.stated) for g in rows],
                     [('FY2026', 65000, None), ('FY2026', 65000, None), ('FY2026', 65000, 'raised')])
    self.assertEqual(why, Counter({lg.REASON_PAST_YEAR: 1, lg.REASON_RANGE: 1, lg.STATED_CLEARED: 1}))

  def test_base_currency_normalized_to_none(self):
    """보고 통화와 같은 currency · 비금액 행의 currency 는 None(칸 뜻: None = 보고 통화)."""
    c = _FakeClient([_item(currency='EUR'),
                     _item(metric='revenue', metric_label='Revenue', low=35, high=36, unit='billion', currency='EUR',
                           quote='Group sales revenue of between 35 and 36 billion euros.')])
    rows, _ = lg.extract(c, _DOC, _SRC, 'Acme Motors', '', 'EUR')
    self.assertEqual([g.currency for g in rows], [None, None])

  def test_parenthetical_conversion_not_value_currency(self):
    """수정 2회차 N4 — 보고 통화 값 뒤 괄호 환산('(US$1.85 billion)')은 그 값의 통화가 아니다 → 보고 통화 행은 남는다.
    외화 값인데 currency 가 빈 행은 여전히 「통화」로 버린다."""
    vfs = 'VinFast targets full year 2026 revenues of VND47,028 billion (US$1.85 billion)'
    eur = 'Group revenue of EUR 35 to 36 billion (USD 38 to 39 billion)'
    keep = [(vfs, 'VND', 47028, 47028), (eur, 'EUR', 35, 36)]
    for q, cur, lo, hi in keep:
      rows, why = lg.screen([base.GuidanceRow('revenue', 'Revenue', 'FY2026', lo, hi, None, 'billion', None, q)], cur)
      self.assertEqual((len(rows), why), (1, Counter()), q)
    for q, cur, lo, hi in [(vfs, 'VND', 1.85, 1.85), (eur, 'EUR', 38, 39),
                           ('revenue of USD 9.0 to 9.5 billion', 'EUR', 9.0, 9.5)]:
      rows, why = lg.screen([base.GuidanceRow('revenue', 'Revenue', 'FY2026', lo, hi, None, 'billion', None, q)], cur)
      self.assertEqual((rows, why), ([], Counter({'통화': 1})), q)

  def test_no_multiplier_money_dropped(self):
    """수정 2회차 N3(동작 고정) — 배수 낱말이 없는 금액 표 행은 버린다. 표 머리 단위('in € million')가 quote 밖이라
    원문만으로 절대값을 확정할 수 없다(322,284 를 million 으로 읽을지 원으로 읽을지 quote 가 말하지 않는다)."""
    g = base.GuidanceRow('revenue', 'Sales revenue', 'FY2026', 320000, 320000, None, 'million', None,
                         'Sales revenue | 322,284 | 320,000')
    self.assertEqual(lg.screen([g], 'EUR'), ([], Counter({'규모': 1})))

  def test_schema_strict(self):
    """④ 구조화 출력 스키마 — additionalProperties false · 항목 칸 전부 required · 어휘는 base 와 같다."""
    self.assertIs(lg.SCHEMA['additionalProperties'], False)
    item = lg.SCHEMA['properties']['items']['items']
    self.assertIs(item['additionalProperties'], False)
    self.assertEqual(set(item['required']), set(item['properties']))
    self.assertEqual(item['properties']['metric']['enum'], list(base.METRICS))
    self.assertEqual(item['properties']['unit']['enum'], list(base.UNITS))
    self.assertEqual(item['properties']['currency']['anyOf'][0]['enum'], list(base.CURRENCIES))

  def test_self_test(self):
    self.assertEqual(lg.self_test(), [])

  def test_no_key_no_client(self):
    import os
    from unittest.mock import patch
    with patch.dict(os.environ, {'ANTHROPIC_API_KEY': ''}):
      self.assertIsNone(lg.make_client())


if __name__ == '__main__':
  unittest.main()
