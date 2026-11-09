"""lib/llm_guidance.py 시험 — 가짜 클라이언트(네트워크 없음).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_llm_guidance.py -q
"""
import importlib.util
import json
import pathlib
import sys
import unittest
from types import SimpleNamespace

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
               'value_text': None, 'unit': 'units', 'basis': None,
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
    """① JSON → GuidanceRow(period 'FY2026' · 칸 그대로)."""
    c = _FakeClient([_item(), _item(metric='capex', metric_label='Capital expenditures', low=1.7, high=1.7,
                                    unit='billion', quote='capital expenditures of $1.7 billion')])
    rows = lg.extract(c, _DOC, _SRC, 'Acme Motors', '힌트')
    self.assertEqual([(g.metric, g.period, g.low, g.high, g.unit) for g in rows],
                     [('deliveries', 'FY2026', 65000, 70000, 'units'), ('capex', 'FY2026', 1.7, 1.7, 'billion')])
    self.assertIsInstance(rows[0], base.GuidanceRow)
    kw = c.calls[0]
    self.assertEqual(kw['model'], lg.MODEL)
    self.assertEqual(kw['thinking'], {'type': 'adaptive'})
    self.assertEqual(kw['output_config']['format'], {'type': 'json_schema', 'schema': lg.SCHEMA})
    content = kw['messages'][0]['content']
    self.assertIn('Acme Motors', content)
    self.assertIn('힌트', content)
    self.assertIn(_SRC, content)

  def test_unquoted_value_is_unverified(self):
    """② quote 가 원문에 없는 항목 → 오케스트레이터 대조(verify)에서 verified=false."""
    c = _FakeClient([_item(), _item(metric='revenue', metric_label='Revenue', low=9.0, high=9.5, unit='billion',
                                    quote='The Company expects 2026 revenue of $9.0 to $9.5 billion')])
    res = base.ParseResult(guidance=lg.extract(c, _DOC, _SRC, 'Acme Motors'))
    checks = ccn.verify(res, _SRC)
    self.assertEqual([checks[id(g)][0] for g in res.guidance], [True, False])
    self.assertEqual(checks[id(res.guidance[1])][1], 'quote_not_in_source')

  def test_max_tokens_raises_not_empty(self):
    """③ 응답이 잘리면(max_tokens·refusal) 빈 목록이 아니라 Incomplete — 빈 목록이면 «전망 없음»으로 문서가 닫힌다."""
    for reason in ('max_tokens', 'refusal'):
      with self.assertRaises(lg.Incomplete):
        lg.extract(_FakeClient([_item()], stop_reason=reason), _DOC, _SRC, 'Acme Motors')

  def test_bad_json_raises(self):
    with self.assertRaises(json.JSONDecodeError):
      lg.extract(_FakeClient(body='{"items": ['), _DOC, _SRC, 'Acme Motors')

  def test_quarter_rows_dropped(self):
    """분기 표지가 든 quote 의 행은 FY 행으로 새지 않게 버린다(폴라리스 carry)."""
    c = _FakeClient([_item(), _item(low=20000, high=22000,
                                    quote='We expect fourth quarter deliveries of 20,000 to 22,000 vehicles')])
    rows = lg.extract(c, _DOC, _SRC, 'Acme Motors')
    self.assertEqual([(g.low, g.high) for g in rows], [(65000, 70000)])

  def test_unit_mismatch_rows_dropped(self):
    """quote_check 는 단위를 안 보므로 extract 에서 — '89.7억'을 89.7 billion 으로 → 8970 million 환산 ·
    비율 지표에 금액 → 버림."""
    c = _FakeClient([_item(),
                     _item(metric='order_intake', metric_label='수주', low=89.7, high=89.7, unit='billion',
                           quote='26년 수주 목표 USD 89.7억'),
                     _item(metric='investment_ratio', metric_label='투자', low=1.7, high=1.7, unit='billion',
                           quote='capital expenditures of $1.7 billion')])
    rows = lg.extract(c, _DOC, _SRC, 'Acme Motors')
    self.assertEqual([(g.metric, g.low, g.unit) for g in rows],
                     [('deliveries', 65000, 'units'), ('order_intake', 8970, 'million')])

  def test_schema_strict(self):
    """④ 구조화 출력 스키마 — additionalProperties false · 항목 칸 전부 required · 어휘는 base 와 같다."""
    self.assertIs(lg.SCHEMA['additionalProperties'], False)
    item = lg.SCHEMA['properties']['items']['items']
    self.assertIs(item['additionalProperties'], False)
    self.assertEqual(set(item['required']), set(item['properties']))
    self.assertEqual(item['properties']['metric']['enum'], list(base.METRICS))
    self.assertEqual(item['properties']['unit']['enum'], list(base.UNITS))

  def test_self_test(self):
    self.assertEqual(lg.self_test(), [])

  def test_no_key_no_client(self):
    import os
    from unittest.mock import patch
    with patch.dict(os.environ, {'ANTHROPIC_API_KEY': ''}):
      self.assertIsNone(lg.make_client())


if __name__ == '__main__':
  unittest.main()
