"""summarize_customer_news.py 시험 — 주 경계(순수 함수) · 가짜 LLM 으로 저장 갈래(네트워크·DB 없음).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_customer_news_weeks.py -q
"""
import json
import pathlib
import sys
import unittest
from datetime import date
from types import SimpleNamespace

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

import summarize_customer_news as scn  # noqa: E402


class Weeks(unittest.TestCase):
  def test_week_start(self):
    self.assertEqual(scn.week_start(date(2026, 11, 9)), date(2026, 11, 9))    # 월요일
    self.assertEqual(scn.week_start(date(2026, 11, 15)), date(2026, 11, 9))   # 일요일 → 그 주 월요일
    self.assertEqual(scn.week_start(date(2026, 11, 12)), date(2026, 11, 9))   # 목요일

  def test_completed_weeks_on_sunday(self):
    # 일요일은 이번 주가 아직 안 끝났다 → 지난주까지
    self.assertEqual(scn.completed_weeks(date(2026, 11, 15), 1), [date(2026, 11, 2)])

  def test_completed_weeks_on_monday(self):
    self.assertEqual(scn.completed_weeks(date(2026, 11, 16), 2), [date(2026, 11, 2), date(2026, 11, 9)])

  def test_backfill_drops_partial_oldest_week(self):
    # 가장 오래된 기사가 수요일 → 그 주는 잘렸다 → 다음 주부터
    self.assertEqual(scn.backfill_weeks(date(2026, 9, 16), date(2026, 10, 7)),
                     [date(2026, 9, 21), date(2026, 9, 28)])
    self.assertEqual(scn.backfill_weeks(date(2026, 9, 14), date(2026, 9, 28))[0], date(2026, 9, 14))
    self.assertEqual(scn.backfill_weeks(date(2026, 11, 10), date(2026, 11, 12)), [])

  def test_week_bounds_kst(self):
    self.assertEqual(scn.week_bounds(date(2026, 11, 2)),
                     ('2026-11-02T00:00:00+09:00', '2026-11-09T00:00:00+09:00'))


class _LLM:
  def __init__(self, *bodies):
    self.bodies, self.calls = list(bodies), []
    self.messages = self

  def create(self, **kw):
    self.calls.append(kw)
    return SimpleNamespace(stop_reason='end_turn', usage=SimpleNamespace(input_tokens=500, output_tokens=100),
                           content=[SimpleNamespace(type='text', text=json.dumps(self.bodies.pop(0)))])


class _WS:
  def __init__(self):
    self.writes = []

  def table(self, name):
    ws = self

    class _B:
      def upsert(self, row, on_conflict=None):
        ws.writes.append((name, row, on_conflict))
        return self

      def execute(self):
        return SimpleNamespace(data=[])
    return _B()


NEWS = [{'id': 'uuid-a', 'title': '가나자동차 3분기 영업이익 2.5조', 'summary': None, 'source': 'A', 'url': 'https://a',
         'published_at': '2026-11-03T01:00:00+00:00'},
        {'id': 'uuid-b', 'title': '가나자동차 신차 출시', 'summary': '전기 SUV 를 공개했다', 'source': 'B', 'url': 'https://b',
         'published_at': '2026-11-04T01:00:00+00:00'},
        {'id': 'uuid-c', 'title': '가나자동차 노조 파업', 'summary': None, 'source': 'C', 'url': 'https://c',
         'published_at': '2026-11-05T01:00:00+00:00'}]
GOOD = {'lines': ['가나자동차의 3분기 영업이익은 2.5조 원이었다.', '가나자동차는 전기 SUV 신차를 공개했다.', '가나자동차 노조가 파업했다.'],
        'link_ids': [1, 2], 'empty': False, 'relevant_count': 3}
MON = date(2026, 11, 2)


class SummarizeWeek(unittest.TestCase):
  def test_dry_run_writes_nothing(self):
    ws = _WS()
    res = scn.summarize_week(_LLM(GOOD), 'c-1', '가나자동차', MON, NEWS, dry_run=True, ws=ws)
    self.assertEqual((res['outcome'], ws.writes), ('ok', []))

  def test_links_map_back_to_uuid(self):
    ws = _WS()
    llm = _LLM(GOOD)
    res = scn.summarize_week(llm, 'c-1', '가나자동차', MON, NEWS, dry_run=False, ws=ws)
    name, row, conflict = ws.writes[0]
    self.assertEqual((name, conflict), ('customer_news_weekly', 'company_id,week_start'))
    self.assertEqual([lk['news_id'] for lk in row['links']], ['uuid-a', 'uuid-b'])
    self.assertEqual((row['status'], row['week_start'], row['news_count']), ('ok', '2026-11-02', 3))
    self.assertTrue(row['updated_at'])
    self.assertIn('[1]', llm.calls[0]['messages'][0]['content'])     # 모델엔 uuid 가 아니라 번호
    self.assertNotIn('uuid-a', llm.calls[0]['messages'][0]['content'])
    self.assertEqual(res['tries'], 1)

  def test_no_news_is_empty_without_call(self):
    ws, llm = _WS(), _LLM()
    res = scn.summarize_week(llm, 'c-1', '가나자동차', MON, [], dry_run=False, ws=ws)
    self.assertEqual((res['outcome'], llm.calls, ws.writes[0][1]['status']), ('empty', [], 'empty'))

  def test_model_says_empty(self):
    body = {'lines': [], 'link_ids': [], 'empty': True, 'relevant_count': 0}
    res = scn.summarize_week(_LLM(body), 'c-1', '가나자동차', MON, NEWS, dry_run=True)
    self.assertEqual((res['outcome'], res['row']['links']), ('empty', []))

  def test_retry_then_check_failed(self):
    bad = {**GOOD, 'link_ids': [99]}
    ws = _WS()
    res = scn.summarize_week(_LLM(bad, bad), 'c-1', '가나자동차', MON, NEWS, dry_run=False, ws=ws)
    self.assertEqual((res['outcome'], res['tries']), ('check_failed', 2))
    self.assertIn('99', ws.writes[0][1]['check_note'])
    self.assertEqual(ws.writes[0][1]['links'], [])
    self.assertEqual(ws.writes[0][1]['input_tokens'], 1000)


class _NewsQuery:
  """news 조회 사슬을 받아 limit 값만 기록하는 가짜 클라이언트."""
  def __init__(self, rows):
    self.rows, self.limit_n = rows, None

  def table(self, _name):
    return self

  def select(self, *_a):
    return self

  def eq(self, *_a):
    return self

  gte = lt = eq

  def order(self, *_a, **_kw):
    return self

  def limit(self, n):
    self.limit_n = n
    return self

  def execute(self):
    return SimpleNamespace(data=list(self.rows))


class LoadNews(unittest.TestCase):
  def test_limit_150_and_time_order(self):
    # 큰 회사는 한 주 기사가 60건을 넘어 그 주 앞쪽이 빠졌다(2026-11-12) — 상한 150
    q = _NewsQuery(list(reversed(NEWS)))
    rows = scn.load_news(q, 'c-1', MON)
    self.assertEqual((scn.MAX_ITEMS, q.limit_n), (150, 150))
    self.assertEqual([r['id'] for r in rows], ['uuid-a', 'uuid-b', 'uuid-c'])


if __name__ == '__main__':
  unittest.main()
