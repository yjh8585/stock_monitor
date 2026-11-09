"""collect_customer_numbers.py 시험 — 판정·적재 행·받기 실패·파서 없는 회사(네트워크·DB 없음).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_customer_numbers.py -q
"""
import importlib.util
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import requests

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

from customer_parsers import base  # noqa: E402

_p = _SCRIPTS / 'collect_customer_numbers.py'
spec = importlib.util.spec_from_file_location('ccn', _p)
ccn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ccn)

# 시험 회사는 가짜 이름 — 공개 레포
_TEXT = 'Acme Motors delivered | 1,234 | vehicles in the third quarter of 2026. Results on October 28, 2026 after close.'
_DOC = base.Doc(id=7, company_id='c-1', ticker='ACME', source='ir', doc_type='sales_release', form='', items='',
                title='Acme Motors Q3 2026 deliveries', url='https://ir.example.com/q3.pdf', published_at='2026-10-02',
                source_id='ir.example.com/q3.pdf')


def _vol(period='2026-Q3', value=1234, quote='Acme Motors delivered | 1,234 | vehicles'):
  return base.VolumeRow('deliveries', 'total', 'quarter', period, value, 'retail', quote)


def _date(event='2026-10-28'):
  return base.EarningsDate('2026-Q3', event, 'Results on October 28, 2026 after close')


class JudgeTests(unittest.TestCase):
  def test_order(self):
    R = base.ParseResult
    self.assertEqual(ccn.judge(R(volume=[_vol()]), 1, 0), ('not_target', None))
    self.assertEqual(ccn.judge(R(recognized=True), 0, 0), ('failed', '새 문서인데 숫자 0개'))
    self.assertEqual(ccn.judge(R(dates=[_date()], recognized=True), 0, 1), ('parsed', None))   # 일정 전용 문서
    self.assertEqual(ccn.judge(R(dates=[_date()], recognized=True), 0, 0), ('failed', '대조 통과 0'))
    self.assertEqual(ccn.judge(R(volume=[_vol()], dates=[_date()], recognized=True), 0, 1), ('failed', '대조 통과 0'))
    self.assertEqual(ccn.judge(R(volume=[_vol()], recognized=True), 1, 0), ('parsed', None))


class PayloadTests(unittest.TestCase):
  def test_verified_flags_extractor_and_dates(self):
    g_code = base.GuidanceRow('deliveries', 'Deliveries', 'FY2026', 1000.0, 2000.0, None, 'units', None, 'x')
    g_llm = base.GuidanceRow('revenue', 'Revenue', 'FY2026', 1.0, 2.0, None, 'billion', None, 'y')
    bad_date = _date('2026-10-29')
    res = base.ParseResult(volume=[_vol()], guidance=[g_code, g_llm], dates=[_date(), bad_date], recognized=True)
    checks = ccn.verify(res, _TEXT)
    out = ccn.payloads(_DOC, res, checks, {id(g_llm)})
    v = out['customer_volume_ir'][0]
    self.assertTrue(v['verified'])
    self.assertEqual((v['document_id'], v['source'], v['source_ref'], v['published_at']),
                     (7, 'ir', 'ir.example.com/q3.pdf', '2026-10-02'))
    self.assertEqual([g['extractor'] for g in out['customer_guidance']], ['code', 'llm'])
    self.assertEqual([g['verified'] for g in out['customer_guidance']], [False, False])   # quote 가 원문에 없다
    self.assertEqual([d['event_date'] for d in out['customer_earnings_dates']], ['2026-10-28'])  # 통과한 일정만

  def test_newer_only(self):
    rows = [{'metric': 'deliveries', 'published_at': '2026-10-02'}, {'metric': 'production', 'published_at': '2026-10-02'}]
    existing = {('deliveries',): '2026-11-01', ('production',): '2026-10-02'}
    self.assertEqual([r['metric'] for r in ccn.newer_only(rows, existing, ('metric',))], ['production'])


class FetchFailureTests(unittest.TestCase):
  def _http_error(self, code):
    return requests.HTTPError('boom https://secret.example/?k=1', response=SimpleNamespace(status_code=code))

  def test_note_has_class_and_status_only(self):
    note = ccn.fetch_failure_note(self._http_error(404), _DOC)
    self.assertEqual(note, '내용 받기 실패: HTTPError HTTP 404')

  def test_expiring_url_marked(self):
    doc = base.Doc(**{**_DOC.__dict__, 'url': 'https://www.example.co.kr/cmm/fms/PdfFileDown.do?fileId=ABC&fileNm=x.pdf'})
    self.assertIn('만료 가능 URL', ccn.fetch_failure_note(self._http_error(500), doc))

  def test_failure_marks_only_that_doc_and_continues(self):
    """받기 실패 문서는 failed + note, 다음 문서는 그대로 파싱된다."""
    calls = []

    def fetch(session, doc):
      calls.append(doc.id)
      if doc.id == 1:
        raise self._http_error(404)
      return base.Content(_TEXT)

    mod = SimpleNamespace(TICKERS=('ACME',), wants=lambda d: True, fetch=fetch,
                          parse=lambda d, c: base.ParseResult(volume=[_vol()], recognized=True))
    ws = MagicMock()
    args = SimpleNamespace(dry_run=False, no_llm=True)
    run = ccn._CompanyRun(mod, MagicMock(), None, ws, args, 'c-1')
    with patch.object(ccn, 'existing_pubs', return_value={}), patch.object(ccn, 'fetch_all', return_value=[]), \
         patch('collect_customer_docs.write_status') as ws_status:
      run.process(base.Doc(**{**_DOC.__dict__, 'id': 1}), None)
      run.process(_DOC, None)
      failures = run.finish('ACME', 2)
    self.assertEqual(calls, [1, 7])
    self.assertEqual(run.outcomes, {'fetch_failed': 1, 'parsed': 1})
    self.assertEqual(failures, 1)
    patches = [c.args[0] for c in ws.table.return_value.update.call_args_list]
    self.assertEqual(patches[0], {'parse_status': 'failed', 'parse_note': '내용 받기 실패: HTTPError HTTP 404'})
    self.assertEqual(patches[1]['parse_status'], 'parsed')
    self.assertEqual(ws_status.call_args.args[3], 'error')

  def test_403_is_blocked_not_failure_exit(self):
    def fetch(session, doc):
      raise self._http_error(403)
    mod = SimpleNamespace(TICKERS=('ACME',), wants=lambda d: True, fetch=fetch, parse=None)
    run = ccn._CompanyRun(mod, MagicMock(), None, MagicMock(), SimpleNamespace(dry_run=True, no_llm=True), 'c-1')
    run.process(_DOC, None)
    self.assertEqual(run.finish('ACME', 1), 0)
    self.assertEqual(run.outcomes, {'blocked': 1})


class VocabDropInRunTests(unittest.TestCase):
  def test_bad_period_row_dropped_good_row_kept(self):
    res = base.ParseResult(volume=[_vol(), _vol(period='2026Q3')], recognized=True)
    mod = SimpleNamespace(TICKERS=('ACME',), wants=lambda d: True, fetch=lambda s, d: base.Content(_TEXT),
                          parse=lambda d, c: res)
    ws = MagicMock()
    run = ccn._CompanyRun(mod, MagicMock(), None, ws, SimpleNamespace(dry_run=False, no_llm=True), 'c-1')
    with patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None)
    self.assertEqual(run.rows['customer_volume_ir'], 1)
    patch_ = ws.table.return_value.update.call_args.args[0]
    self.assertEqual(patch_['parse_status'], 'parsed')
    self.assertIn('형식 밖 1행', patch_['parse_note'])


class NoParserTests(unittest.TestCase):
  def test_company_without_parser_untouched(self):
    """등록부가 비어(Task 6) 파서 없는 회사 — 문서 상태·상태 표를 건드리지 않고 실패 0."""
    ws = MagicMock()
    docs = [{'id': 1, 'company_id': 'c-1'}, {'id': 2, 'company_id': 'c-1'}]
    args = SimpleNamespace(dry_run=False, no_llm=False)
    with patch('customer_parsers.module_for', return_value=None):
      self.assertEqual(ccn._run(docs, {'c-1': 'ACME'}, MagicMock(), None, ws, args, None), 0)
    ws.table.assert_not_called()


class SelfTests(unittest.TestCase):
  def test_self_tests_pass(self):
    self.assertEqual(ccn.self_tests(), [])


if __name__ == '__main__':
  unittest.main()
