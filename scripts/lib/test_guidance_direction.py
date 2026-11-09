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
      {**base, 'id': 3, 'published_at': '2026-11-05', 'document_id': 30, 'low': 67000, 'high': 70000},
      {**base, 'id': 1, 'published_at': '2026-02-20', 'document_id': 10, 'low': 65000, 'high': 70000},
      {**base, 'id': 2, 'published_at': '2026-10-29', 'document_id': 20, 'low': 67000, 'high': 70000},
    ]
    self.assertEqual(dict(gd.assign(rows)), {1: 'initiated', 2: 'raised', 3: 'maintained'})

  def test_assign_same_day_rows_compare_to_previous_date(self):
    """같은 날 두 행은 서로 비교하지 않고 둘 다 직전 날짜의 마지막 행과 비교한다
    (현대 FY2026 판매목표 — 2026-11-10 DB 행 10·11·15·16(재파싱 뒤 31) 의 값·날짜 그대로: 2026-10-29 두 공시가 둘 다 lowered).
    그다음 날짜 행은 같은 날 묶음의 마지막 행과 비교한다."""
    base = {'metric': 'sales_units', 'period': 'FY2026', 'value_text': None, 'stated': None}
    rows = [
      {**base, 'id': 10, 'published_at': '2026-01-05', 'document_id': 47, 'low': 4158300, 'high': 4158300},
      {**base, 'id': 11, 'published_at': '2026-01-29', 'document_id': 45, 'low': 4160000, 'high': 4160000},
      {**base, 'id': 15, 'published_at': '2026-10-29', 'document_id': 29, 'low': 4000000, 'high': 4000000},
      {**base, 'id': 16, 'published_at': '2026-10-29', 'document_id': 30, 'low': 4000000, 'high': 4000000},
      {**base, 'id': 99, 'published_at': '2027-01-05', 'document_id': 99, 'low': 4100000, 'high': 4100000},
    ]
    self.assertEqual(dict(gd.assign(rows)),
                     {10: 'initiated', 11: 'maintained', 15: 'lowered', 16: 'lowered', 99: 'raised'})

  def test_assign_same_day_first_rows_are_initiated(self):
    """첫 날짜에 두 행이 있으면 둘 다 initiated(서로 비교하지 않는다)."""
    base = {'metric': 'sales_units', 'period': 'FY2026', 'value_text': None, 'stated': None}
    rows = [
      {**base, 'id': 1, 'published_at': '2026-01-29', 'document_id': 10, 'low': 4000000, 'high': 4000000},
      {**base, 'id': 2, 'published_at': '2026-01-29', 'document_id': 20, 'low': 4160000, 'high': 4160000},
    ]
    self.assertEqual(dict(gd.assign(rows)), {1: 'initiated', 2: 'initiated'})

  def test_assign_same_day_code_row_is_next_baseline(self):
    """잔여 Minor 2 — 같은 날 code 16 · llm 15.5 면 code 가 뒤(= 다음 비교 기준 · 화면 foldHistory 와 같은 규칙).
    document_id 만으로 정렬하면 llm 행(문서 번호가 뒤)이 기준이 돼 다음 공시 16 이 「상향」으로 찍힌다."""
    base = {'metric': 'revenue', 'period': 'FY2026', 'value_text': None, 'stated': None}
    rows = [
      {**base, 'id': 1, 'published_at': '2026-02-01', 'document_id': 10, 'extractor': 'code', 'low': 16.0, 'high': 16.0},
      {**base, 'id': 2, 'published_at': '2026-02-01', 'document_id': 20, 'extractor': 'llm', 'low': 15.5, 'high': 15.5},
      {**base, 'id': 3, 'published_at': '2026-05-01', 'document_id': 30, 'extractor': 'code', 'low': 16.0, 'high': 16.0},
    ]
    self.assertEqual(dict(gd.assign(rows))[3], 'maintained')

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
