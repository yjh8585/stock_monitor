"""collect_customer_numbers.py 시험 — 판정·적재 행·받기 실패·파서 예외·방향·--add-file·파서 없는 회사(네트워크·DB 없음).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_customer_numbers.py -q
"""
import importlib.util
import pathlib
import sys
import tempfile
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
_MOBIS_LIKE = 'https://www.example.co.kr/cmm/fms/PdfFileDown.do?fileId=ABC&fileNm=x.pdf'


def _vol(period='2026-Q3', value=1234, quote='Acme Motors delivered | 1,234 | vehicles'):
  return base.VolumeRow('deliveries', 'total', 'quarter', period, value, 'retail', quote)


def _date(event='2026-10-28'):
  return base.EarningsDate('2026-Q3', event, 'Results on October 28, 2026 after close')


def _doc(**kw):
  return base.Doc(**{**_DOC.__dict__, **kw})


def _http_error(code):
  return requests.HTTPError('boom https://secret.example/?k=1', response=SimpleNamespace(status_code=code))


def _mod(fetch=None, parse=None):
  return SimpleNamespace(TICKERS=('ACME',), wants=lambda d: True, fetch=fetch or (lambda s, d: base.Content(_TEXT)),
                         parse=parse or (lambda d, c: base.ParseResult(volume=[_vol()], recognized=True)))


def _run(mod, dry_run=False):
  ws = MagicMock()
  return ccn._CompanyRun(mod, MagicMock(), None, ws, SimpleNamespace(dry_run=dry_run, no_llm=True), 'c-1'), ws


def _doc_patches(ws) -> list[dict]:
  return [c.args[0] for c in ws.table.return_value.update.call_args_list]


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


class NewerOnlyTests(unittest.TestCase):
  def _row(self, metric, pub='2026-10-02', verified=True):
    return {'metric': metric, 'published_at': pub, 'verified': verified}

  def test_later_existing_wins(self):
    rows = [self._row('deliveries'), self._row('production')]
    existing = {('deliveries',): ('2026-11-01', True), ('production',): ('2026-10-02', True)}
    self.assertEqual([r['metric'] for r in ccn.newer_only(rows, existing, ('metric',))], ['production'])

  def test_unverified_never_covers_verified(self):
    """나중 문서의 대조 실패 행이 앞 문서의 검증 행을 덮지 않는다(덮으면 화면이 빈칸)."""
    rows = [self._row('deliveries', '2026-11-03', False), self._row('production', '2026-11-03', False),
            self._row('sales', '2026-11-03', True)]
    existing = {('deliveries',): ('2026-10-02', True), ('production',): ('2026-10-02', False),
                ('sales',): ('2026-10-02', True)}
    self.assertEqual([r['metric'] for r in ccn.newer_only(rows, existing, ('metric',))], ['production', 'sales'])


class FetchFailureTests(unittest.TestCase):
  def test_note_has_class_and_status_only(self):
    self.assertEqual(ccn.fetch_failure_note(_http_error(404), _DOC), '내용 받기 실패: HTTPError HTTP 404')

  def test_expiring_url_marked_and_retried(self):
    doc = _doc(url=_MOBIS_LIKE)
    self.assertIn('만료 가능 URL', ccn.fetch_failure_note(_http_error(404), doc))
    self.assertEqual(ccn.fetch_failure_kind(_http_error(404), doc), 'retry')   # 목록 수집기가 새 URL 을 넣으면 받힌다

  def test_kinds(self):
    k = ccn.fetch_failure_kind
    self.assertEqual(k(_http_error(403), _DOC), 'blocked')
    self.assertEqual(k(_http_error(503), _DOC), 'retry')
    self.assertEqual(k(_http_error(429), _DOC), 'retry')
    self.assertEqual(k(requests.ConnectionError('x'), _DOC), 'retry')
    self.assertEqual(k(requests.Timeout('x'), _DOC), 'retry')
    self.assertEqual(k(_http_error(404), _DOC), 'failed')
    self.assertEqual(k(_http_error(410), _DOC), 'failed')
    self.assertEqual(k(ValueError('not a pdf'), _DOC), 'failed')

  def _one(self, code):
    def fetch(session, doc):
      raise _http_error(code)
    run, ws = _run(_mod(fetch=fetch))
    with patch('collect_customer_docs.write_status') as st:
      fails = run.process(_DOC, None) or run.finish('ACME', 1)
    return _doc_patches(ws)[0], st.call_args.args[3], st.call_args.args[4], fails

  def test_403_pending_and_blocked(self):
    patch_, status, reason, fails = self._one(403)
    self.assertEqual(patch_, {'parse_status': 'pending', 'parse_note': '내용 받기 실패: HTTPError HTTP 403'})
    self.assertEqual(status, 'blocked')
    self.assertIn('HTTP 403', reason)
    self.assertEqual(fails, 0)

  def test_404_failed(self):
    patch_, status, _, fails = self._one(404)
    self.assertEqual(patch_['parse_status'], 'failed')
    self.assertEqual(status, 'error')
    self.assertEqual(fails, 1)

  def test_5xx_pending_and_error(self):
    patch_, status, _, fails = self._one(502)
    self.assertEqual(patch_['parse_status'], 'pending')
    self.assertEqual(status, 'error')
    self.assertEqual(fails, 1)

  def test_failure_marks_only_that_doc_and_continues(self):
    """받기 실패 문서는 그것만 처리되고 다음 문서는 그대로 파싱된다."""
    calls = []

    def fetch(session, doc):
      calls.append(doc.id)
      if doc.id == 1:
        raise _http_error(404)
      return base.Content(_TEXT)

    run, ws = _run(_mod(fetch=fetch))
    with patch.object(ccn, 'existing_pubs', return_value={}), patch('collect_customer_docs.write_status'):
      run.process(_doc(id=1), None)
      run.process(_DOC, None)
      run.finish('ACME', 2)
    self.assertEqual(calls, [1, 7])
    self.assertEqual(run.outcomes, {'fetch_failed': 1, 'parsed': 1})
    self.assertEqual([p['parse_status'] for p in _doc_patches(ws)], ['failed', 'parsed'])


class ParserErrorTests(unittest.TestCase):
  def test_parse_exception_fails_that_doc_only(self):
    def parse(d, c):
      if d.id == 1:
        raise ZeroDivisionError
      return base.ParseResult(volume=[_vol()], recognized=True)
    run, ws = _run(_mod(parse=parse))
    with patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_doc(id=1), None)
      run.process(_DOC, None)
    self.assertEqual(run.outcomes, {'failed': 1, 'parsed': 1})
    self.assertEqual(_doc_patches(ws)[0], {'parse_status': 'failed', 'parse_note': '파서 예외: ZeroDivisionError'})

  def test_module_fetch_programming_error_is_parser_error(self):
    def fetch(session, doc):
      raise AttributeError('x')
    run, ws = _run(_mod(fetch=fetch))
    run.process(_DOC, None)
    self.assertEqual(run.outcomes, {'failed': 1})
    self.assertEqual(_doc_patches(ws)[0]['parse_note'], '파서 예외: AttributeError')


class VocabDropInRunTests(unittest.TestCase):
  def test_bad_period_row_dropped_good_row_kept(self):
    res = base.ParseResult(volume=[_vol(), _vol(period='2026Q3')], recognized=True)
    run, ws = _run(_mod(parse=lambda d, c: res))
    with patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None)
    self.assertEqual(run.rows['customer_volume_ir'], 1)
    patch_ = _doc_patches(ws)[0]
    self.assertEqual(patch_['parse_status'], 'parsed')
    self.assertIn('형식 밖 1행', patch_['parse_note'])

  def test_drop_runs_before_dedupe(self):
    """같은 키의 (형식 밖 행, 맞는 행) — dedupe 가 먼저면 앞의 형식 밖 행이 남았다가 버려져 둘 다 잃는다."""
    q = 'Acme Motors delivered | 1,234 | vehicles'
    bad = base.GuidanceRow('deliveries', 'Deliveries', 'FY2026', 1234.0, None, None, 'cars', None, q)
    good = base.GuidanceRow('deliveries', 'Deliveries', 'FY2026', 1234.0, None, None, 'units', None, q)
    res = base.ParseResult(guidance=[bad, good], recognized=True)
    run, _ = _run(_mod(parse=lambda d, c: res), dry_run=True)
    with patch.object(ccn, 'fetch_all', return_value=[]):
      run.process(_DOC, None)
    self.assertEqual(run.rows['customer_guidance'], 1)
    self.assertEqual(run.outcomes, {'parsed': 1})


class StoreTests(unittest.TestCase):
  def test_parsed_doc_guidance_rows_deleted_first(self):
    """다시 파싱한 문서에서 사라진 가이던스 칸이 옛 행으로 남지 않게 — document_id 조건으로 지운 뒤 싣는다."""
    run, ws = _run(_mod())
    with patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None)
    ws.table.return_value.delete.return_value.eq.assert_called_once_with('document_id', 7)
    names = [c.args[0] for c in ws.table.call_args_list]
    self.assertLess(names.index('customer_guidance'), names.index('customer_volume_ir'))


class DirectionTests(unittest.TestCase):
  def test_only_changed_rows_updated(self):
    base_row = {'metric': 'deliveries', 'period': 'FY2026', 'value_text': None, 'stated': None}
    rows = [{**base_row, 'id': 1, 'published_at': '2026-02-01', 'document_id': 1, 'low': 100, 'high': 200,
             'direction': 'initiated'},
            {**base_row, 'id': 2, 'published_at': '2026-05-01', 'document_id': 2, 'low': 150, 'high': 200,
             'direction': None}]
    run, ws = _run(_mod())
    with patch.object(ccn, 'fetch_all', return_value=rows):
      self.assertEqual(run._directions(), 1)
    ws.table.return_value.update.assert_called_once_with({'direction': 'raised'})
    ws.table.return_value.update.return_value.eq.assert_called_once_with('id', 2)

  def test_dry_run_does_not_write(self):
    rows = [{'id': 1, 'metric': 'm', 'period': 'FY2026', 'published_at': '2026-02-01', 'document_id': 1, 'low': 1,
             'high': 2, 'value_text': None, 'stated': None, 'direction': None}]
    run, ws = _run(_mod(), dry_run=True)
    with patch.object(ccn, 'fetch_all', return_value=rows):
      self.assertEqual(run._directions(), 1)
    ws.table.assert_not_called()


class AddFileTests(unittest.TestCase):
  def _args(self, **kw):
    a = dict(company='ACME', url='https://ir.example.com/fact.pdf', doc_type='fact_sheet', title='T',
             published='2026-02-26', dry_run=False)
    return SimpleNamespace(**{**a, **kw})

  def test_arg_errors(self):
    self.assertIn('--url', ccn._add_file_error(self._args(url=None)))
    self.assertIn('--published', ccn._add_file_error(self._args(published=None)))
    self.assertIn('형식 아님', ccn._add_file_error(self._args(published='2026/02/26')))
    self.assertIsNone(ccn._add_file_error(self._args()))

  def test_main_exit_2_on_missing_args(self):
    self.assertEqual(ccn.main(['--add-file', 'x.pdf']), 2)

  def test_existing_list_row_kept(self):
    """IR 목록이 넣은 행이 있으면 title·published_at 등을 덮지 않고 그 행을 그대로 쓴다."""
    listed = {'id': 42, 'company_id': 'c-1', 'source': 'ir', 'source_id': 'ir.example.com/fact.pdf',
              'doc_type': 'fact_sheet', 'form': 'list-form', 'items': None, 'title': '목록 제목',
              'url': 'https://ir.example.com/fact.pdf?v=1', 'published_at': '2026-02-20'}
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [listed]
    with patch('lib.db.upsert_rows') as up:
      got = ccn.add_file_doc(client, self._args(), {'id': 'c-1'}, b'%PDF-1.4')
    up.assert_not_called()
    self.assertEqual(got, listed)

  def test_no_parser_exit_2_before_creating_row(self):
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
      f.write(b'%PDF-1.4 test')
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{'id': 'c-1',
                                                                                                 'ticker': 'ACME'}]
    argv = ['--add-file', f.name, '--company', 'ACME', '--url', 'https://ir.example.com/fact.pdf', '--doc-type',
            'fact_sheet', '--title', 'T', '--published', '2026-02-26']
    try:
      with patch('lib.db.get_client', return_value=client), patch.object(ccn, 'add_file_doc') as add:
        self.assertEqual(ccn.main(argv), 2)
      add.assert_not_called()
    finally:
      pathlib.Path(f.name).unlink()


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
