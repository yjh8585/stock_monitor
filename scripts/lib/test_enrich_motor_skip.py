"""enrich_company.py 가 모터 회사를 LLM 메타 보강에서 빼는지 회귀 검증.

배경(2026-11-27 최종 검토 Critical): 모터 탭 시드로 로봇 회사 5곳에 'motor' 페이지가 붙자
`_skips_customers`(「휴머노이드에만 있는 로봇 회사」 판정)가 거짓이 되어, 주간 collect-humanoid
(`--page humanoid`)가 이 5곳을 「고객사 누락」 메타 보강 대상으로 잡게 됐다. 월간 enrich-company 는
설명이 빈 신규 모터 회사 30곳의 제품을 LLM 결과로 통째 바꾼다(products 덮어쓰기).
명세(docs/superpowers/specs/2026-11-26-motor-tab-design.md 83행)는 「모터 회사의 설명·제품은 명단
정본에서 시드하고 enrich_company.py 는 돌리지 않는다(API 과금 · 공개된 사실만)」이다.
재무 보강(fnguide·DART)은 그대로 둔다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_enrich_motor_skip.py
"""
import argparse
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))
os.environ.setdefault('MODEL', 'test-model')  # import 때 최신 하이쿠 조회(API)를 피한다

import enrich_company as ec  # noqa: E402


def _company(**kw) -> dict:
  base = {
    'id': 'c1', 'status': 'active', 'robot_roles': None, 'motor_types': None,
    'business_summary': None, 'products': [], 'customers': [], 'homepage_url': None,
    '_pages': ['domestic'],
  }
  base.update(kw)
  return base


class _Query:
  def __init__(self, rows, log):
    self.rows, self.log = rows, log

  def select(self, cols):
    self.log.append(cols)
    return self

  def in_(self, *_a):
    return self

  def execute(self):
    return type('R', (), {'data': self.rows})()


class _Client:
  """postgrest 흉내 — companies 조회 칸을 기록하고, 받은 칸만 돌려준다."""

  def __init__(self, company_row: dict, pages: list[dict]):
    self.company_row, self.pages, self.cols_log = company_row, pages, []

  def table(self, name):
    if name == 'company_pages':
      return _Query(self.pages, [])
    return _Query([self.company_row], self.cols_log)


class NeedsMetaTest(unittest.TestCase):
  def test_new_motor_company_with_empty_meta_is_not_enriched(self):
    c = _company(motor_types=['control'], _pages=['motor', 'domestic'])
    self.assertTrue(ec._missing_meta(c))  # 칸이 비어 있어도
    self.assertFalse(ec._needs_meta(c))   # 모터 회사라 LLM 보강을 하지 않는다

  def test_robot_company_on_humanoid_and_motor_is_not_enriched(self):
    c = _company(robot_roles=['parts'], motor_types=['actuator'], _pages=['humanoid', 'motor'],
                 business_summary='국내 감속기 회사', products=[{'name': 'x'}], homepage_url='https://x')
    self.assertFalse(ec._needs_meta(c))

  def test_non_motor_company_keeps_existing_behavior(self):
    c = _company(motor_types=None, _pages=['domestic'])
    self.assertTrue(ec._needs_meta(c))
    self.assertTrue(ec._needs_meta(_company(motor_types=[], _pages=['domestic'])))

  def test_load_targets_selects_motor_types(self):
    # 🔴 조회 칸에 motor_types 가 없으면 판정이 운영에서 늘 None 을 봐 죽은 코드가 된다.
    row = {'id': 'c1', 'status': 'active', 'ticker': 'T', 'motor_types': ['control']}
    client = _Client(row, [{'company_id': 'c1', 'page': 'motor'}])
    out = ec._load_targets(client, None, {'T'})
    self.assertIn('motor_types', client.cols_log[0].split(','))
    self.assertEqual(out[0]['_pages'], ['motor'])


class EntryPointTest(unittest.TestCase):
  def test_main_never_sends_motor_company_to_llm_meta(self):
    # 판정 함수만 시험하면 진입점이 `_needs_meta` 를 안 불러도 통과한다(2026-11-27 Codex 지적).
    # 일반 회사를 대조군으로 넣어 메타 경로가 실제로 돈다는 것도 함께 본다.
    calls: list[str] = []
    motor = _company(id='m1', name_kr='모터사', motor_types=['control'], _pages=['motor'])
    plain = _company(id='p1', name_kr='일반사', _pages=['domestic'])
    args = argparse.Namespace(page=None, skip_financials=True, skip_meta=False, skip_news=True)
    with mock.patch.object(ec, 'fetch_product_categories', return_value=[]), \
         mock.patch.object(ec, '_meta_tool_with_categories', return_value={}), \
         mock.patch.object(ec, '_load_targets', return_value=[motor, plain]), \
         mock.patch.object(ec, '_enrich_meta', side_effect=lambda _llm, c, _t: calls.append(c['name_kr'])), \
         mock.patch.object(ec.time, 'sleep'), \
         mock.patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key'}):
      ec._main_in_session(object(), args, set())
    self.assertEqual(calls, ['일반사'])


if __name__ == '__main__':
  unittest.main()
