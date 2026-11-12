"""lib/customer_breakdown.py 시험 — 지역·차종·점유율 행의 모양·증감률 거르기·글자층 대조·두 번째 읽기(C8).
네트워크·DB 없음. 가짜 회사 이름만 쓴다(공개 레포).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_customer_breakdown.py -q
"""
import pathlib
import sys
import unittest
from types import SimpleNamespace

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

import fitz  # noqa: E402

from customer_parsers.base import Content  # noqa: E402
from lib import customer_breakdown as cb  # noqa: E402

P1 = 'Acme Motors Q3 2026 deliveries by region North America 357 Europe 588 China 95 (thousand units)'
P2 = 'Market share North America 7.5% Europe 14.8% South America 18.6% — Q3 2026'
P3 = 'Deliveries mix chart'   # 그림 속 숫자 — 글자층엔 값이 없다


def _pdf(*pages: str) -> bytes:
  doc = fitz.open()
  for t in pages:
    doc.new_page().insert_text((40, 60), t, fontsize=8)
  raw = doc.tobytes()
  doc.close()
  return raw


def _row(**kw) -> cb.Row:
  base = dict(kind='region', metric='deliveries', label_raw='North America', label_ko='북미', period_grain='quarter',
              period='2026-Q3', value=357000, unit='units', quote='North America 357 Europe 588', page=1,
              extractor='manual')
  base.update(kw)
  return cb.Row(**base)


class HierarchyTest(unittest.TestCase):
  """상위 합계 ↔ 하위 구분 — 같은 metric 이면 화면이 두 번 쌓는다(GM 인도 2026-11-12). 값은 가짜."""

  def _found(self, spec, **kw):
    rows = [_row(label_raw=l, value=v, **kw) for l, v in spec]
    before = [r.metric for r in rows]
    found = cb.suspect_parent_sums(rows)
    self.assertEqual([r.metric for r in rows], before)   # 행은 안 바꾼다(경고만)
    return found

  def test_parent_then_children(self):
    got = self._found([('Total North America', 1000), ('United States', 870), ('Other', 130), ('China', 500)])
    self.assertEqual(got, [('Total North America', ['Other', 'United States'])])

  def test_children_then_parent(self):
    got = self._found([('China', 500), ('United States', 870), ('Other', 130), ('Total North America', 1000)])
    self.assertEqual(got, [('Total North America', ['Other', 'United States'])])

  def test_no_hierarchy(self):
    self.assertEqual(self._found([('North America', 1000), ('Europe', 600), ('China', 350)]), [])

  def test_prefix_children_left_to_screen(self):
    self.assertEqual(self._found([('Macan', 100), ('Macan BEV', 60), ('Macan ICE', 40)]), [])

  def test_percent_skipped(self):
    self.assertEqual(self._found([('A', 100), ('B', 60), ('C', 40)], unit='pct'), [])

  def test_share_only_for_domestic(self):
    rows = [_row(), _row(kind='share', metric='market_share', unit='share_pct', value=7.5)]
    self.assertEqual([r.kind for r in cb.keep_for_company('005380', rows)], ['share'])
    self.assertEqual(len(cb.keep_for_company('GM', rows)), 2)


class ShapeTest(unittest.TestCase):
  def test_period_formats(self):
    good = [('month', '2026-10'), ('quarter', '2026-Q3'), ('half', '2026-H1'), ('ytd', '2026-9M'), ('year', '2026'),
            ('asof', '2026-06-30')]
    for grain, period in good:
      self.assertIsNone(cb.shape_problem(_row(period_grain=grain, period=period)), (grain, period))
    bad = [('quarter', '2026Q3'), ('half', '2026-6M'), ('ytd', '2026-Q3'), ('year', 'FY2026'), ('month', '2026-13')]
    for grain, period in bad:
      self.assertIsNotNone(cb.shape_problem(_row(period_grain=grain, period=period)), (grain, period))

  def test_enums_and_ranges(self):
    self.assertIsNotNone(cb.shape_problem(_row(kind='segment')))
    self.assertIsNotNone(cb.shape_problem(_row(unit='thousand')))
    self.assertIsNotNone(cb.shape_problem(_row(unit='share_pct', value=140)))
    self.assertIsNotNone(cb.shape_problem(_row(value=-3)))
    self.assertIsNotNone(cb.shape_problem(_row(label_ko='')))
    self.assertIsNone(cb.shape_problem(_row(unit='share_pct', value=7.5)))


class GrowthTest(unittest.TestCase):
  """C7 — 증감률만 있는 항목은 싣지 않는다. 값이 quote 안에서 부호(+/−)와 함께만 나오면 증감률로 본다."""
  MUST_HIT = [('Europe +11% order backlog', 11), ('China −20% y/y', 20), ('North America (12)% vs prior year', 12),
              ('BEV order backlog +105%', 105)]
  MUST_MISS = [('Market share North America 7.5%', 7.5), ('Europe 14.8% share, up from 13.1%', 14.8),
               ('BEV share 31% of deliveries', 31)]

  def test_samples(self):
    for q, v in self.MUST_HIT:
      self.assertTrue(cb.looks_like_growth(q, v), q)
    for q, v in self.MUST_MISS:
      self.assertFalse(cb.looks_like_growth(q, v), q)


class VerifyTest(unittest.TestCase):
  def setUp(self):
    self.content = Content(text='', tables=[], raw=_pdf(P1, P2, P3))
    self.src = cb.SourcePages(self.content)

  def test_text_layer_ok(self):
    ok, note = cb.verify(_row(), self.src)
    self.assertEqual((ok, note), (True, 'ok'))

  def test_page_scoped(self):
    """다른 쪽의 글로는 통과하지 않는다 — 인용은 그 쪽 글자층에서만 찾는다."""
    ok, note = cb.verify(_row(page=2), self.src)
    self.assertFalse(ok)
    self.assertEqual(note, 'quote_not_in_source')

  def test_share_ok(self):
    ok, _ = cb.verify(_row(kind='share', metric='share', unit='share_pct', value=14.8, page=2,
                           label_raw='Europe', label_ko='유럽', quote='Europe 14.8% South America 18.6%'), self.src)
    self.assertTrue(ok)

  def test_growth_rejected(self):
    src = cb.SourcePages(Content(text='Europe +11% order backlog', tables=[], raw=b''))
    ok, note = cb.verify(_row(kind='region', unit='pct', value=11, page=None, quote='Europe +11% order backlog'), src)
    self.assertEqual((ok, note), (False, 'growth_rate'))

  def test_image_double_read(self):
    row = _row(page=3, value=47, unit='pct', kind='model', label_raw='VF 3 · VF 5', label_ko='VF 3·VF 5',
               quote='Deliveries mix chart', second_value=47)
    self.assertEqual(cb.verify(row, self.src), (True, 'double_read'))
    row.second_value = 46
    self.assertEqual(cb.verify(row, self.src), (False, 'double_read_mismatch'))

  def test_image_without_second_read(self):
    row = _row(page=3, value=47, unit='pct', quote='Deliveries mix chart')
    ok, note = cb.verify(row, self.src)
    self.assertFalse(ok)
    self.assertTrue(note.startswith('value_not_in_quote'))

  def test_llm_image_only(self):
    """정기(API) 경로 — 두 번째 읽기가 없으니 그림 속 숫자는 image_only 로 남는다."""
    row = _row(page=3, value=47, unit='pct', quote='Deliveries mix chart', extractor='llm')
    ok, note = cb.verify(row, self.src)
    self.assertFalse(ok)
    self.assertTrue(note.startswith('image_only'))

  def test_non_pdf_whole_text(self):
    src = cb.SourcePages(Content(text='North America sales of $1,815 million represented 89 percent', tables=[],
                                 raw=b''))
    row = _row(page=None, metric='revenue', unit='USD', value=1_815_000_000,
               quote='North America sales of $1,815 million')
    self.assertEqual(cb.verify(row, src), (True, 'ok'))


class PayloadTest(unittest.TestCase):
  DOC = {'id': 7, 'company_id': 'c-1', 'published_at': '2026-10-28'}

  def test_payload_and_dedupe(self):
    a = _row()
    b = _row(value=358000)   # 같은 키 · 다른 값 — 먼저 온 것만 남기고 충돌로 센다
    c = _row(label_raw='Europe', label_ko='유럽', value=588000, quote='Europe 588')
    rows, conflicts = cb.payloads(self.DOC, [(a, True, 'ok'), (b, True, 'ok'), (c, False, 'x')])
    self.assertEqual(len(rows), 2)
    self.assertEqual(conflicts, 1)
    self.assertEqual(rows[0]['document_id'], 7)
    self.assertEqual(rows[0]['company_id'], 'c-1')
    self.assertEqual(rows[0]['published_at'], '2026-10-28')
    self.assertNotIn('second_value', rows[0])
    self.assertFalse(rows[1]['verified'])
    self.assertEqual(rows[1]['verify_note'], 'x')

  def test_row_from_dict_ignores_ids(self):
    """JSON 의 company_id·document_id 는 믿지 않는다 — 문서 행에서 채운다."""
    r = cb.row_from_dict({'kind': 'region', 'metric': 'deliveries', 'label_raw': 'X', 'label_ko': 'X',
                          'period_grain': 'year', 'period': '2025', 'value': 1, 'unit': 'units', 'quote': 'X 1',
                          'company_id': 'evil', 'document_id': 999})
    self.assertEqual(r.extractor, 'manual')
    self.assertFalse(hasattr(r, 'company_id'))


class SaveTest(unittest.TestCase):
  def test_save_replaces_and_marks(self):
    calls = []

    class B:
      def __init__(self, name):
        self.name = name

      def __getattr__(self, op):
        def f(*a, **k):
          calls.append((self.name, op, a, k))
          return self
        return f

    ws = SimpleNamespace(table=lambda n: B(n))
    cb.save_document(ws, 7, [{'x': 1}], now='2026-11-12T00:00:00Z')
    ops = [(n, op) for n, op, _, _ in calls if op in ('delete', 'insert', 'update')]
    self.assertEqual(ops, [('customer_breakdown_ir', 'delete'), ('customer_breakdown_ir', 'insert'),
                           ('customer_doc_summaries', 'update')])
    calls.clear()
    cb.save_document(ws, 7, [], now='2026-11-12T00:00:00Z')   # 0행 문서도 표식은 찍는다
    ops = [(n, op) for n, op, _, _ in calls if op in ('delete', 'insert', 'update')]
    self.assertEqual(ops, [('customer_breakdown_ir', 'delete'), ('customer_doc_summaries', 'update')])


if __name__ == '__main__':
  unittest.main()
