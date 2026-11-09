"""가이던스 방향 판정 시험(네트워크·DB 없음).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_guidance_direction.py -q
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))  # scripts/

from lib import guidance_direction as gd  # noqa: E402


class GuidanceDirectionTests(unittest.TestCase):
  def test_self_test(self):
    self.assertEqual(gd.self_test(), [])

  def test_assign_orders_by_published_then_document(self):
    """같은 metric·period 3행을 날짜 뒤섞어 넣어도 공시 순으로 initiated → raised → maintained."""
    base = {'metric': 'deliveries', 'period': 'FY2026', 'value_text': None, 'stated': None}
    rows = [
      {**base, 'id': 3, 'published_at': '2026-10-29', 'document_id': 30, 'low': 67000, 'high': 70000},
      {**base, 'id': 1, 'published_at': '2026-02-20', 'document_id': 10, 'low': 65000, 'high': 70000},
      {**base, 'id': 2, 'published_at': '2026-10-29', 'document_id': 20, 'low': 67000, 'high': 70000},
    ]
    self.assertEqual(dict(gd.assign(rows)), {1: 'initiated', 2: 'raised', 3: 'maintained'})

  def test_assign_groups_by_metric_and_period(self):
    rows = [
      {'id': 1, 'metric': 'revenue', 'period': 'FY2026', 'published_at': '2026-02-01', 'document_id': 1,
       'low': 10.0, 'high': 12.0, 'value_text': None, 'stated': None},
      {'id': 2, 'metric': 'revenue', 'period': 'FY2027', 'published_at': '2026-03-01', 'document_id': 2,
       'low': 5.0, 'high': 6.0, 'value_text': None, 'stated': None},
    ]
    self.assertEqual(dict(gd.assign(rows)), {1: 'initiated', 2: 'initiated'})


if __name__ == '__main__':
  unittest.main()
