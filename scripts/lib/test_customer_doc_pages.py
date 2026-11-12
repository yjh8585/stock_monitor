"""lib/customer_doc_pages.py · summarize_customer_docs.py 시험 — 가짜 LLM·가짜 업로더(네트워크·DB 없음).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_customer_doc_pages.py -q
"""
import json
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

import fitz  # noqa: E402

import collect_customer_numbers as ccn  # noqa: E402
import summarize_customer_docs as scd  # noqa: E402
from customer_parsers.base import Content  # noqa: E402
from lib import customer_doc_pages as cdp  # noqa: E402

P1 = ('Revenue was $4,213 million in Q3 2026, up from $3,980 million in Q3 2025. We now expect FY2026 adjusted '
      'operating margin of 4% to 5%, down from 5% to 6%. ') * 3
P2 = 'Regional deliveries table North America Europe China. ' * 3


def _pdf(*pages: str) -> bytes:
  doc = fitz.open()
  for t in pages:
    doc.new_page().insert_textbox(fitz.Rect(40, 40, 560, 800), t, fontsize=9)
  b = doc.tobytes()
  doc.close()
  return b


GOOD = {'lines': ['가나자동차는 2026년 조정 영업이익률 전망을 5~6%에서 4~5%로 낮췄다.',
                  '3분기 매출은 42.1억 달러였다.', '전년 같은 분기는 39.8억 달러였다.'],
        'importance': 'high', 'importance_reason': '전망 하향',
        'evidence': [{'quote': 'We now expect FY2026 adjusted operating margin of 4% to 5%', 'page': 1}],
        'pages': [{'page': 2, 'caption': '지역별 인도 표'}], 'c_materials': []}
BAD = {**GOOD, 'lines': ['3분기 매출은 45억 달러였다.'] * 3}


class _LLM:
  """messages.create 가 차례로 응답을 준다 — 호출 인자를 남긴다."""

  def __init__(self, *bodies):
    self.bodies, self.calls = list(bodies), []
    self.messages = self

  def create(self, **kw):
    self.calls.append(kw)
    body = self.bodies.pop(0)
    return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(body))],
                           usage=SimpleNamespace(input_tokens=1000, output_tokens=200))


class _WS:
  def __init__(self):
    self.writes = []

  def table(self, name):
    ws = self

    class _B:
      def upsert(self, row, on_conflict=None):
        ws.writes.append((name, row, on_conflict))
        return self

      def update(self, row):
        ws.writes.append((name, row, 'update'))
        return self

      def eq(self, col, val):
        ws.writes[-1] = (*ws.writes[-1], (col, val))
        return self

      def execute(self):
        return SimpleNamespace(data=[])
    return _B()


ROW = {'id': 11, 'company_id': 'c-1', 'doc_type': 'presentation', 'title': 'Q3 2026 results', 'published_at': '2026-10-28'}


class Pages(unittest.TestCase):
  def test_page_marked_text(self):
    text, n = cdp.page_marked_text(_pdf('first page body', 'second page body'))
    self.assertEqual(n, 2)
    self.assertTrue(text.startswith('[p.1]\n'))
    self.assertLess(text.index('first page'), text.index('[p.2]'))
    self.assertLess(text.index('[p.2]'), text.index('second page'))

  def test_page_key(self):
    self.assertEqual(cdp.page_key('c-1', 11, 7), 'c-1/11/p7.png')

  def test_render_page(self):
    b = _pdf('one', 'two')
    self.assertTrue(cdp.render_page(b, 2).startswith(b'\x89PNG'))
    self.assertIsNone(cdp.render_page(b, 3))
    self.assertIsNone(cdp.render_page(b'not a pdf', 1))

  def test_source_text_tables_are_three_deep(self):
    # Content.tables = [표[행[칸]]] — 행 목록으로 읽으면 AttributeError(EDGAR·XLSX 실측 2026-11-12)
    c = Content('body', [[['Revenue', '4,213'], ['Deliveries', '42,000']], [['Margin', '5%']]], b'<html>')
    text, is_pdf, n = scd.source_text(c)
    self.assertFalse(is_pdf)
    self.assertEqual(n, 0)
    self.assertIn('Revenue | 4,213', text)
    self.assertIn('Margin | 5%', text)


class SummarizeDoc(unittest.TestCase):
  def setUp(self):
    self.pdf = _pdf(P1, P2)
    self.content = Content('', [], self.pdf)
    self.uploads = []

  def _up(self, key, png):
    self.uploads.append(key)

  def test_dry_run_writes_nothing(self):
    ws = _WS()
    res = scd.summarize_doc(_LLM(GOOD), ROW, '가나자동차', self.content, 'sha', dry_run=True, ws=ws, uploader=self._up)
    self.assertEqual(res['outcome'], 'ok')
    self.assertEqual((self.uploads, ws.writes), ([], []))
    self.assertEqual(res['row']['pages'][0]['key'], 'c-1/11/p2.png')   # 렌더는 한다

  def test_real_run_uploads_and_upserts(self):
    ws = _WS()
    res = scd.summarize_doc(_LLM(GOOD), ROW, '가나자동차', self.content, 'sha', dry_run=False, ws=ws, uploader=self._up)
    self.assertEqual(self.uploads, ['c-1/11/p2.png'])
    self.assertEqual(len(ws.writes), 1)
    name, row, conflict = ws.writes[0]
    self.assertEqual((name, conflict, row['status'], row['importance']), ('customer_doc_summaries', 'doc_id', 'ok', 'high'))
    self.assertTrue(row['updated_at'])
    self.assertEqual((row['input_tokens'], row['output_tokens']), (1000, 200))
    self.assertEqual(res['tries'], 1)

  def test_retry_once_then_ok(self):
    llm = _LLM(BAD, GOOD)
    res = scd.summarize_doc(llm, ROW, '가나자동차', self.content, None, dry_run=True, uploader=self._up)
    self.assertEqual((res['outcome'], res['tries'], len(llm.calls)), ('ok', 2, 2))
    second = llm.calls[1]['messages']
    self.assertEqual([m['role'] for m in second], ['user', 'assistant', 'user'])
    self.assertIn('숫자', second[2]['content'])
    self.assertEqual(res['row']['input_tokens'], 2000)

  def test_retry_fails_check_failed(self):
    ws = _WS()
    res = scd.summarize_doc(_LLM(BAD, BAD), ROW, '가나자동차', self.content, None, dry_run=False, ws=ws, uploader=self._up)
    self.assertEqual(res['outcome'], 'check_failed')
    self.assertEqual(self.uploads, [])                       # 검사 실패면 캡처하지 않는다
    self.assertEqual(ws.writes[0][1]['status'], 'check_failed')
    self.assertIn('숫자', ws.writes[0][1]['check_note'])
    # 고른 쪽·캡션은 key 없이 남긴다 — 검사기를 고친 뒤 --recheck 가 통과시키면 그때 캡처한다
    # (소급 2026-11-12: pages=[] 로 저장해 재검사로 ok 가 된 PDF 6건의 쪽을 되살릴 수 없었다)
    self.assertEqual(ws.writes[0][1]['pages'], [{'page': 2, 'caption': '지역별 인도 표', 'key': None}])

  def test_upload_failure_keeps_page_without_key(self):
    # Codex 지적 8(2026-11-12): 실패한 쪽을 지우면 복구 대상에서 사라진다 → key=None 으로 남기고 사유를 check_note 에
    def boom(key, png):
      raise RuntimeError('x')
    ws = _WS()
    res = scd.summarize_doc(_LLM(GOOD), ROW, '가나자동차', self.content, None, dry_run=False, ws=ws, uploader=boom)
    row = ws.writes[0][1]
    self.assertEqual((res['outcome'], row['status']), ('ok', 'ok'))
    self.assertEqual(row['pages'], [{'page': 2, 'caption': '지역별 인도 표', 'key': None}])
    self.assertIn('2쪽 캡처 실패(업로드 RuntimeError)', row['check_note'])

  def test_render_failure_keeps_page_without_key(self):
    ws = _WS()
    with patch.object(cdp, 'render_page', return_value=None):
      scd.summarize_doc(_LLM(GOOD), ROW, '가나자동차', self.content, None, dry_run=False, ws=ws, uploader=self._up)
    row = ws.writes[0][1]
    self.assertEqual((self.uploads, row['pages'][0]['key']), ([], None))
    self.assertIn('2쪽 캡처 실패(렌더)', row['check_note'])

  def test_short_text_skipped(self):
    llm = _LLM()
    res = scd.summarize_doc(llm, ROW, '가나자동차', Content('짧다'), None, dry_run=True)
    self.assertEqual((res['outcome'], llm.calls), ('skipped', []))

  def test_html_has_no_pages(self):
    html_good = {**GOOD, 'pages': [], 'evidence': [{'quote': GOOD['evidence'][0]['quote'], 'page': None}]}
    llm = _LLM(html_good)
    res = scd.summarize_doc(llm, {**ROW, 'doc_type': 'earnings_release'}, '가나자동차', Content(P1), None,
                            dry_run=True)
    self.assertEqual((res['outcome'], res['row']['pages']), ('ok', []))
    self.assertIn('PDF 아님', llm.calls[0]['messages'][0]['content'])
    self.assertEqual(llm.calls[0]['model'], scd.MODEL)


class RetryPages(unittest.TestCase):
  """--retry-pages — 키 없는 쪽만 다시 렌더·업로드(API 호출 0)."""

  def setUp(self):
    self.content = Content('', [], _pdf(P1, P2))
    self.uploads = []
    self.summary = {'doc_id': 11, 'company_id': 'c-1',
                    'pages': [{'page': 1, 'caption': '요약', 'key': 'c-1/11/p1.png'},
                              {'page': 2, 'caption': '지역별 인도 표', 'key': None}],
                    'check_note': '근거 쪽 3→1 · 2쪽 캡처 실패(업로드 RuntimeError)'}

  def _up(self, key, png):
    self.uploads.append(key)

  def test_missing_pages(self):
    self.assertEqual(scd.missing_pages(self.summary['pages']), [2])
    self.assertEqual(scd.missing_pages([{'page': 1, 'caption': 'x', 'key': 'k'}]), [])
    self.assertEqual(scd.missing_pages(None), [])

  def test_retry_uploads_only_missing_and_updates(self):
    ws = _WS()
    res = scd.retry_pages(self.summary, self.content, dry_run=False, ws=ws, uploader=self._up)
    self.assertEqual((self.uploads, res['fixed'], res['still']), (['c-1/11/p2.png'], 1, 0))
    name, row, kind, where = ws.writes[0]
    self.assertEqual((name, kind, where), ('customer_doc_summaries', 'update', ('doc_id', 11)))
    self.assertEqual([p['key'] for p in row['pages']], ['c-1/11/p1.png', 'c-1/11/p2.png'])
    self.assertEqual(row['check_note'], '근거 쪽 3→1')          # 고친 쪽의 실패 사유만 지운다
    self.assertNotIn('status', row)                             # 요약·상태는 건드리지 않는다

  def test_retry_dry_run_writes_nothing(self):
    ws = _WS()
    res = scd.retry_pages(self.summary, self.content, dry_run=True, ws=ws, uploader=self._up)
    self.assertEqual((self.uploads, ws.writes, res['fixed']), ([], [], 1))

  def test_retry_fails_again_keeps_reason(self):
    def boom(key, png):
      raise OSError('x')
    ws = _WS()
    res = scd.retry_pages(self.summary, self.content, dry_run=False, ws=ws, uploader=boom)
    self.assertEqual((res['fixed'], res['still'], ws.writes), (0, 1, []))


class Recheck(unittest.TestCase):
  """--recheck — 검사 실패 행의 저장된 요약을 고친 검사기로 다시 검사(API 호출 0)."""

  def setUp(self):
    self.content = Content('', [], _pdf(P1, P2))
    self.uploads = []
    # 검사 실패 행은 캡처를 안 해 pages 에 key 가 없다
    self.summary = {'doc_id': 11, 'company_id': 'c-1', 'status': 'check_failed', 'source_sha': 'sha',
                    **{k: GOOD[k] for k in ('lines', 'importance', 'importance_reason', 'evidence', 'c_materials')},
                    'pages': [{'page': 2, 'caption': '지역별 인도 표'}], 'check_note': '숫자 원문 없음: 옛 지적'}

  def _up(self, key, png):
    self.uploads.append(key)

  def test_pass_sets_ok_and_captures(self):
    ws = _WS()
    res = scd.recheck_doc(self.summary, self.content, dry_run=False, ws=ws, uploader=self._up)
    self.assertEqual((res['outcome'], self.uploads), ('ok', ['c-1/11/p2.png']))
    name, row, kind, where = ws.writes[0]
    self.assertEqual((name, kind, where), ('customer_doc_summaries', 'update', ('doc_id', 11)))
    self.assertEqual(row['status'], 'ok')
    self.assertEqual(row['pages'], [{'page': 2, 'caption': '지역별 인도 표', 'key': 'c-1/11/p2.png'}])
    self.assertIsNone(row['check_note'])                        # 옛 지적은 지운다
    self.assertTrue(row['updated_at'])
    for kept in ('prompt_version', 'model', 'lines', 'input_tokens'):   # 요약 본문·판은 그대로
      self.assertNotIn(kept, row)

  def test_still_failing_updates_note_only(self):
    ws = _WS()
    res = scd.recheck_doc({**self.summary, 'lines': BAD['lines']}, self.content, dry_run=False, ws=ws,
                          uploader=self._up)
    self.assertEqual((res['outcome'], self.uploads), ('check_failed', []))
    _, row, kind, _ = ws.writes[0]
    self.assertEqual((kind, list(row)), ('update', ['check_note']))
    self.assertIn('숫자 원문 없음', row['check_note'])
    self.assertNotIn('옛 지적', row['check_note'])

  def test_dry_run_writes_nothing(self):
    ws = _WS()
    res = scd.recheck_doc(self.summary, self.content, dry_run=True, ws=ws, uploader=self._up)
    self.assertEqual((res['outcome'], self.uploads, ws.writes), ('ok', [], []))


class DocContentOrder(unittest.TestCase):
  DOC = SimpleNamespace(source='ir', url='https://example.com/a.pdf')

  def test_module_fetch_first(self):
    mod = SimpleNamespace(fetch=lambda s, d: Content('from module', [], b''))
    with patch.object(ccn, 'fetch_content', side_effect=AssertionError('공통 경로를 타면 안 된다')):
      c, sha = ccn.doc_content(mod, None, self.DOC)
    self.assertEqual((c.text, len(sha)), ('from module', 64))

  def test_no_module_common_path(self):
    with patch.object(ccn, 'fetch_content', return_value=(Content('common'), 'h')) as f:
      self.assertEqual(ccn.doc_content(None, None, self.DOC)[1], 'h')
      self.assertEqual(ccn.doc_content(SimpleNamespace(), None, self.DOC)[1], 'h')
    self.assertEqual(f.call_count, 2)

  def test_blob_first(self):
    mod = SimpleNamespace(fetch=lambda s, d: (_ for _ in ()).throw(AssertionError('blob 이 우선')))
    with patch.object(ccn, 'fetch_content', return_value=(Content('blob'), 'b')) as f:
      self.assertEqual(ccn.doc_content(mod, None, self.DOC, b'%PDF-x')[1], 'b')
    f.assert_called_once()


class FetchFailureKind(unittest.TestCase):
  """받기 실패 갈래 — 401·403·404·크기 초과는 경고(exit 0) · 그 밖은 오류(exit 1)."""

  @staticmethod
  def _http(code):
    import requests
    return requests.HTTPError(response=SimpleNamespace(status_code=code))

  def test_warning_kinds(self):
    from lib.ir_lists import TooLarge
    for e in (self._http(401), self._http(403), self._http(404), TooLarge(60 * 1024 * 1024)):
      self.assertTrue(scd.fetch_failure_is_warning(e), repr(e))

  def test_error_kinds(self):
    import requests
    for e in (self._http(500), self._http(429), requests.ConnectionError(), ValueError('PDF 깨짐')):
      self.assertFalse(scd.fetch_failure_is_warning(e), repr(e))


class _Resp:
  """stream 응답 흉내 — iter_content 가 조각을 차례로 준다."""

  def __init__(self, body: bytes, length: str | None = None):
    self.body, self.headers, self.closed = body, ({'Content-Length': length} if length else {}), False

  def raise_for_status(self):
    pass

  def iter_content(self, n):
    for i in range(0, len(self.body), n):
      yield self.body[i:i + n]

  def close(self):
    self.closed = True


class LargePdfDownload(unittest.TestCase):
  """50MB 를 넘는 PDF — 디스크로 받아 파일에서 글자층·쪽 그림을 뽑는다(2026-11-12 리비안 63~410MB)."""

  def setUp(self):
    import tempfile
    self.td = tempfile.mkdtemp()
    self.path = str(pathlib.Path(self.td) / 'doc.pdf')

  def tearDown(self):
    import shutil
    shutil.rmtree(self.td, ignore_errors=True)

  def test_writes_file_and_sha(self):
    import hashlib

    from lib import ir_lists
    body = _pdf(P1, P2)
    s = SimpleNamespace(get=lambda *a, **k: _Resp(body))
    sha = ir_lists.ir_get_to_file(s, 'https://example.com/a.pdf', self.path)
    self.assertEqual(sha, hashlib.sha256(body).hexdigest())
    self.assertEqual(pathlib.Path(self.path).read_bytes(), body)

  def test_over_cap_removes_partial_file(self):
    from lib import ir_lists
    s = SimpleNamespace(get=lambda *a, **k: _Resp(b'x' * (3 << 20)))   # 머리 없음 — 쓰는 도중에 넘는다
    with self.assertRaises(ir_lists.TooLarge):
      ir_lists.ir_get_to_file(s, 'https://example.com/a.pdf', self.path, max_bytes=2 << 20)
    self.assertFalse(pathlib.Path(self.path).exists())

  def test_over_cap_by_header_reads_nothing(self):
    from lib import ir_lists
    resp = _Resp(b'', length=str(10 << 20))
    with self.assertRaises(ir_lists.TooLarge):
      ir_lists.ir_get_to_file(SimpleNamespace(get=lambda *a, **k: resp), 'https://e.com/a.pdf', self.path,
                              max_bytes=2 << 20)
    self.assertTrue(resp.closed)
    self.assertFalse(pathlib.Path(self.path).exists())

  def _source(self, url, body):
    from lib import ir_lists

    def fake_get(session, u, path, max_bytes=None):
      pathlib.Path(path).write_bytes(body)
      return 'sha-big'
    doc = SimpleNamespace(source='ir', url=url)
    return (patch.object(ccn, 'doc_content', side_effect=ir_lists.TooLarge(60 << 20)),
            patch.object(ir_lists, 'ir_get_to_file', side_effect=fake_get), doc)

  def test_summary_source_falls_back_to_file_and_cleans_up(self):
    p1, p2, doc = self._source('https://example.com/Q3.PDF?v=1', _pdf(P1, P2))
    with p1, p2:
      with scd.summary_source(None, None, doc) as (content, sha):
        path = content.path
        self.assertEqual(sha, 'sha-big')
        text, is_pdf, n = scd.source_text(content)
        self.assertEqual((is_pdf, n), (True, 2))
        self.assertIn('[p.2]', text)
        self.assertTrue(scd.pdf_source(content) == path and pathlib.Path(path).exists())
    self.assertFalse(pathlib.Path(path).exists())   # 블록을 나가면 임시 파일이 지워진다

  def test_summary_source_small_doc_passes_through(self):
    doc = SimpleNamespace(source='ir', url='https://example.com/a.pdf')
    c = Content('', [], _pdf(P1))
    with patch.object(ccn, 'doc_content', return_value=(c, 'h')):
      with scd.summary_source(None, None, doc) as (content, sha):
        self.assertEqual((content, sha), (c, 'h'))
        self.assertEqual(scd.pdf_source(content), c.raw)

  def test_summary_source_non_pdf_url_keeps_warning(self):
    from lib import ir_lists
    p1, p2, doc = self._source('https://example.com/report.html', b'<html>')
    with p1, p2 as g, self.assertRaises(ir_lists.TooLarge):
      with scd.summary_source(None, None, doc):
        pass
    g.assert_not_called()

  def test_summary_source_not_a_pdf_raises(self):
    from lib import ir_lists
    p1, p2, doc = self._source('https://example.com/a.pdf', b'<html>login</html>')
    with p1, p2, self.assertRaises(ir_lists.TooLarge):
      with scd.summary_source(None, None, doc):
        pass

  def test_summarize_large_pdf_captures_from_file(self):
    p1, p2, doc = self._source('https://example.com/a.pdf', _pdf(P1, P2))
    ups = []
    with p1, p2, scd.summary_source(None, None, doc) as (content, sha):
      res = scd.summarize_doc(_LLM(GOOD), ROW, '가나자동차', content, sha, dry_run=False, ws=_WS(),
                              uploader=lambda k, png: ups.append((k, png[:4])))
    self.assertEqual(res['outcome'], 'ok')
    self.assertEqual(ups, [('c-1/11/p2.png', b'\x89PNG')])


class SaveManual(unittest.TestCase):
  """--from-json — 직접 쓴 요약도 같은 검사기를 통과해야 저장된다(API 호출 0)."""

  def setUp(self):
    self.content = Content('', [], _pdf(P1, P2))
    self.uploads = []

  def test_ok_saves_with_manual_model_and_zero_tokens(self):
    ws = _WS()
    res = scd.save_manual(ROW, self.content, 'sha', GOOD, dry_run=False, ws=ws,
                          uploader=lambda k, png: self.uploads.append(k))
    self.assertEqual(res['outcome'], 'ok')
    (name, row, conflict), = ws.writes
    self.assertEqual((name, conflict), ('customer_doc_summaries', 'doc_id'))
    self.assertEqual((row['input_tokens'], row['output_tokens']), (0, 0))
    self.assertIn('수동', row['model'])   # 상수를 베끼지 않는다 — 수동 표시가 상수에서 빠지면 걸려야 한다
    self.assertEqual((row['status'], row['source_sha']), ('ok', 'sha'))
    self.assertEqual(self.uploads, ['c-1/11/p2.png'])

  def test_check_failure_saves_nothing(self):
    ws = _WS()
    res = scd.save_manual(ROW, self.content, 'sha', BAD, dry_run=False, ws=ws,
                          uploader=lambda k, png: self.uploads.append(k))
    self.assertEqual(res['outcome'], 'check_failed')
    self.assertTrue(res['problems'])
    self.assertEqual((ws.writes, self.uploads), ([], []))

  def test_missing_or_bad_fields_save_nothing(self):
    bad = [
      {k: v for k, v in GOOD.items() if k != 'importance'},
      {**GOOD, 'importance': 'urgent'},
      {**GOOD, 'extra': 1},
    ]
    for data in bad:
      ws = _WS()
      res = scd.save_manual(ROW, self.content, 'sha', data, dry_run=False, ws=ws,
                            uploader=lambda k, png: self.uploads.append(k))
      self.assertEqual(res['outcome'], 'check_failed', data)
      self.assertEqual((ws.writes, self.uploads), ([], []))

  def test_dry_run_writes_nothing(self):
    ws = _WS()
    res = scd.save_manual(ROW, self.content, 'sha', GOOD, dry_run=True, ws=ws,
                          uploader=lambda k, png: self.uploads.append(k))
    self.assertEqual(res['outcome'], 'ok')
    self.assertEqual((ws.writes, self.uploads), ([], []))


if __name__ == '__main__':
  unittest.main()
