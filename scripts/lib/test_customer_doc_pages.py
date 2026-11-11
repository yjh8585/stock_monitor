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

  def test_upload_failure_drops_page_only(self):
    def boom(key, png):
      raise RuntimeError('x')
    ws = _WS()
    res = scd.summarize_doc(_LLM(GOOD), ROW, '가나자동차', self.content, None, dry_run=False, ws=ws, uploader=boom)
    self.assertEqual((res['outcome'], ws.writes[0][1]['pages']), ('ok', []))

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


if __name__ == '__main__':
  unittest.main()
