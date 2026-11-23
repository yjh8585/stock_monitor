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

  # ---- 코드 리뷰 2차(2026-11-20) 9번 — 검사기 구멍
  def test_scale_needs_marker(self):
    """배수(×1,000 등)로만 맞는 값은 그 배수 표지(thousand·천·million …)가 quote 나 그 쪽에 있어야 한다."""
    bare = cb.SourcePages(Content(text='North America deliveries were 357 vehicles.', tables=[], raw=b''))
    row = _row(page=None, value=357000, quote='North America deliveries were 357 vehicles.', extractor='llm')
    self.assertEqual(cb.verify(row, bare), (False, 'scale_not_in_source'))
    row.value = 357
    self.assertEqual(cb.verify(row, bare), (True, 'ok'))
    # 표 머리 '(thousand units)' 가 같은 쪽에 있으면 인정(P1)
    self.assertEqual(cb.verify(_row(extractor='llm'), self.src), (True, 'ok'))
    # 소급(manual) 행은 아직 검사 밖(SHORTCUT — 기존 검증 행 788 이 quote 에 표지가 없다)
    self.assertEqual(cb.verify(_row(page=None, value=357000, quote='North America deliveries were 357 vehicles.'), bare),
                     (True, 'ok'))

  def test_scale_warning(self):
    """정기 실행이 「배수 표기 없음」으로 떨어뜨린 행을 스스로 알린다 — 20% 이상이면 검사가 과할 수 있다는 경고(2026-11-23 사용자 「1번으로 해」)."""
    self.assertIsNone(cb.scale_warning(0, 0))
    self.assertIsNone(cb.scale_warning(0, 50))
    small = cb.scale_warning(1, 50)
    self.assertIn('1/50', small)
    self.assertNotIn('과할 수', small)
    big = cb.scale_warning(10, 50)
    self.assertIn('10/50', big)
    self.assertIn('과할 수', big)
    self.assertIn('과할 수', cb.scale_warning(1, 5))   # 경계 = 20%

  def test_collector_counts_scale_flags(self):
    """수집기 _store 가 정기 API 행 수와 배수 표기 없음 건수를 합계에 모은다(경고의 재료 · dry-run)."""
    from collections import Counter

    import collect_customer_breakdown as ccb
    bare = Content(text='North America deliveries were 357 vehicles.', tables=[], raw=b'')
    rows = [_row(page=None, value=357000, quote='North America deliveries were 357 vehicles.', extractor='llm'),
            _row(page=None, label_raw='Europe', label_ko='유럽', value=357, quote='North America deliveries were 357 vehicles.',
                 extractor='llm')]
    totals = Counter()
    doc = {'id': 7, 'company_id': 'c-1', 'published_at': '2026-10-28'}
    self.assertTrue(ccb._store(None, doc, 'STLA', bare, {}, rows, totals, 'now'))
    self.assertEqual((totals['llm_rows'], totals['scale']), (2, 1))

  def test_pdf_row_needs_page(self):
    """PDF 인데 쪽 번호가 없으면 문서 전체를 근거로 삼지 않는다."""
    ok, note = cb.verify(_row(page=None), self.src)
    self.assertEqual((ok, note), (False, 'no_page'))

  def test_double_read_needs_valid_page(self):
    """두 번째 읽기가 같아도 쪽 번호가 범위 밖·없음이면 통과시키지 않는다."""
    for page, note in ((None, 'no_page'), (9, 'page_out_of_range')):
      row = _row(page=page, value=47, unit='pct', quote='Deliveries mix chart', second_value=47)
      self.assertEqual(cb.verify(row, self.src), (False, note))

  def test_double_read_needs_quote_on_page(self):
    """두 번째 읽기는 «그림 속 숫자»(인용은 그 쪽에 있고 값만 밖)에만 — 인용 자체가 그 쪽에 없으면 통과 못 한다(검토 2회차)."""
    row = _row(page=1, value=4321, quote='Europe deliveries 4,321 units (fabricated sentence)', second_value=4321)
    self.assertEqual(cb.verify(row, self.src), (False, 'quote_not_in_source'))

  def test_scale_marker_forms(self):
    """숫자에 붙여 쓴 배수('357k'·'1.2m'·'12.3bn')는 표지로 읽고, 'a.m.'·'3(b)' 의 낱글자는 표지가 아니다(검토 2회차)."""
    def unmarked(quote, value, page_text=''):
      return cb.scale_unmarked(_row(page=None, value=value, quote=quote, extractor='llm'), page_text or quote)
    self.assertFalse(unmarked('Regional deliveries reached 357k vehicles.', 357_000))
    self.assertFalse(unmarked('Regional deliveries reached 1.2m vehicles.', 1_200_000))
    self.assertFalse(unmarked('Europe revenue of €12.3bn in the quarter', 12_300_000_000))
    self.assertFalse(unmarked('Europe deliveries (’000) 357', 357_000))
    bare = 'North America deliveries were 357 vehicles.'
    self.assertTrue(unmarked(bare, 357_000_000, bare + ' Conference call at 10:00 a.m. ET.'))
    self.assertTrue(unmarked(bare, 357_000_000_000, bare + ' See note 3(b).'))
    self.assertTrue(unmarked(bare, 357_000_000, bare + ' Strategy update on M&A.'))

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

  def test_dedupe_keeps_verified_when_same_value(self):
    """같은 키·같은 값이면 검증된 행이 이긴다 — 먼저 온 실패 행이 맞는 값을 화면에서 가리던 것(코드 리뷰 8번 (나))."""
    a = _row(quote='other page')
    b = _row()
    rows, conflicts = cb.payloads(self.DOC, [(a, False, 'not_found'), (b, True, 'ok')])
    self.assertEqual(conflicts, 0)
    self.assertEqual(len(rows), 1)
    self.assertTrue(rows[0]['verified'])
    self.assertEqual(rows[0]['verify_note'], 'ok')
    # 반대 순서(검증 행이 먼저)면 그대로 남는다
    rows, _ = cb.payloads(self.DOC, [(b, True, 'ok'), (a, False, 'not_found')])
    self.assertTrue(rows[0]['verified'])

  def test_conflict_keeps_verified(self):
    """값이 달라도(충돌) 검증된 행이 미검증 행을 이긴다 — 먼저 온 실패 행이 검증된 값을 가리던 것(검토 2회차)."""
    a = _row(value=100, quote='other page')
    b = _row()
    rows, conflicts = cb.payloads(self.DOC, [(a, False, 'not_found'), (b, True, 'ok')])
    self.assertEqual(conflicts, 1)
    self.assertEqual(len(rows), 1)
    self.assertEqual((rows[0]['value'], rows[0]['verified']), (357000.0, True))

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
    ops = [(n, op, a) for n, op, a, _ in calls if op in ('delete', 'insert', 'update')]
    # 🔴 표식을 먼저 비운다 — 넣기가 실패해도 정기 실행(breakdown_at is null)이 다시 집게(코드 리뷰 8번 (가))
    self.assertEqual(ops, [('customer_doc_summaries', 'update', ({'breakdown_at': None},)),
                           ('customer_breakdown_ir', 'delete', ()), ('customer_breakdown_ir', 'insert', ([{'x': 1}],)),
                           ('customer_doc_summaries', 'update', ({'breakdown_at': '2026-11-12T00:00:00Z'},))])
    calls.clear()
    cb.save_document(ws, 7, [], now='2026-11-12T00:00:00Z')   # 0행 문서도 표식은 찍는다
    ops = [(n, op) for n, op, _, _ in calls if op in ('delete', 'insert', 'update')]
    self.assertEqual(ops, [('customer_doc_summaries', 'update'), ('customer_breakdown_ir', 'delete'),
                           ('customer_doc_summaries', 'update')])

  def test_insert_failure_leaves_mark_empty(self):
    """넣기가 실패하면 표식은 비어 있어야 한다(옛 표식이 남으면 문서가 영영 빈 채로 남는다)."""
    marks = []

    class B:
      def __init__(self, name):
        self.name = name

      def update(self, v):
        marks.append(v['breakdown_at'])
        return self

      def insert(self, rows):
        raise RuntimeError('insert 실패')

      def __getattr__(self, op):
        return lambda *a, **k: self

    ws = SimpleNamespace(table=lambda n: B(n))
    with self.assertRaises(RuntimeError):
      cb.save_document(ws, 7, [{'x': 1}], now='2026-11-12T00:00:00Z')
    self.assertEqual(marks, [None])


if __name__ == '__main__':
  unittest.main()
