"""collect_customer_docs.py 시험 — 문서 종류 분류 · 적재 칸 · 상태 판정 · edgar.fetch_filings 거르기(네트워크·DB 없음).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_customer_docs_classify.py -q
"""
import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import MagicMock, patch

import requests

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

from lib import edgar  # noqa: E402

_p = _SCRIPTS / 'collect_customer_docs.py'
spec = importlib.util.spec_from_file_location('ccd', _p)
ccd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ccd)

# 🔴 재수집 때 이 칸이 payload 에 실리면 이미 파싱한 문서가 pending 으로 되돌아간다(Task 2 검토 지적).
_FORBIDDEN = {'parse_status', 'sha256', 'first_seen_at', 'parse_note', 'id'}
_ROW_KEYS = {'company_id', 'source', 'source_id', 'doc_type', 'form', 'items', 'title', 'url', 'published_at'}


def _sub(entries: list[tuple]) -> dict:
  """(accession, filingDate, form, items, primaryDocument, primaryDocDescription) → submissions JSON 꼴."""
  keys = ('accessionNumber', 'filingDate', 'form', 'items', 'primaryDocument', 'primaryDocDescription')
  rec = {k: [e[i] for e in entries] for i, k in enumerate(keys)}
  rec['reportDate'] = [''] * len(entries)
  return {'filings': {'recent': rec}}


_GM_SUB = _sub([
  ('0001467858-26-000056', '2026-10-21', '8-K', '2.02,9.01', 'gm-20261021.htm', '8-K'),
  ('0001467858-26-000050', '2026-10-01', '8-K', '7.01,9.01', 'gm-20261001.htm', ''),
  ('0001467858-26-000049', '2026-09-30', '4', '', 'xslF345X05/wk-form4.xml', ''),  # 내부자 거래 — 버림
  ('0001467858-26-000040', '2026-07-22', '8-K/A', '2.02', 'gm-a.htm', ''),         # 정정 — 거르기 대상 아님
  ('0001467858-26-000030', '2026-07-21', '10-Q', '', 'gm-20260630.htm', '10-Q'),
  ('0001467858-24-000010', '2024-10-22', '8-K', '2.02,9.01', 'gm-20241022.htm', '8-K'),  # since 이전 — 버림
])


class ClassifyTest(unittest.TestCase):
  def test_dart(self):
    self.assertEqual(ccd.classify_dart('연결재무제표기준영업(잠정)실적(공정공시)'), 'prelim_results')
    self.assertEqual(ccd.classify_dart('영업(잠정)실적(공정공시)'), 'prelim_results')
    self.assertEqual(ccd.classify_dart('[기재정정]영업실적등에대한전망(공정공시)'), 'guidance')
    self.assertEqual(ccd.classify_dart('기업설명회(IR)개최(안내공시)'), 'ir_event')
    self.assertIsNone(ccd.classify_dart('임원ㆍ주요주주특정증권등소유상황보고서'))

  def test_dart_spacing_and_attachment_header(self):
    self.assertEqual(ccd.classify_dart('  [첨부정정] 연결재무제표기준 영업(잠정)실적(공정공시) '), 'prelim_results')
    self.assertEqual(ccd.classify_dart('장래사업ㆍ경영계획(공정공시)'), 'guidance')

  def test_edgar(self):
    self.assertEqual(ccd.classify_edgar('8-K', '2.02,9.01', ''), 'earnings_release')
    self.assertEqual(ccd.classify_edgar('8-K', '7.01,9.01', ''), 'current_report')
    self.assertEqual(ccd.classify_edgar('6-K', '', 'Q3 2026 Shipments'), 'sales_release')
    self.assertEqual(ccd.classify_edgar('10-Q', '', ''), 'periodic')

  def test_edgar_more(self):
    self.assertEqual(ccd.classify_edgar('6-K', '', 'Third Quarter 2026 Results'), 'earnings_release')
    self.assertEqual(ccd.classify_edgar('6-K', '', ''), 'current_report')
    self.assertEqual(ccd.classify_edgar('20-F', '', ''), 'periodic')
    self.assertIsNone(ccd.classify_edgar('4', '', ''))
    # 8-K 의 2.02 는 항목 «단위»로 본다 — 12.02 같은 꼴에 잘못 걸리지 않게
    self.assertEqual(ccd.classify_edgar('8-K', '12.02', ''), 'current_report')


class FetchFilingsFilterTest(unittest.TestCase):
  """Task 2 검토 지적: edgar.fetch_filings 의 공시 종류·날짜 거르기에 시험이 없었다."""

  def _fetch(self, forms, since):
    resp = MagicMock()
    resp.json.return_value = _GM_SUB
    with patch.object(edgar, 'edgar_get', return_value=resp) as g:
      out = edgar.fetch_filings(MagicMock(), '1467858', forms, since)
    self.assertEqual(g.call_args.args[1], 'https://data.sec.gov/submissions/CIK0001467858.json')
    return out

  def test_forms_filter_exact(self):
    out = self._fetch(('8-K', '10-Q'), '2026-01-01')
    self.assertEqual([f.form for f in out], ['8-K', '8-K', '10-Q'])  # 4 · 8-K/A 는 빠진다

  def test_since_inclusive(self):
    out = self._fetch(('8-K',), '2026-10-01')
    self.assertEqual([f.filing_date for f in out], ['2026-10-21', '2026-10-01'])  # 같은 날은 포함

  def test_since_excludes_older(self):
    out = self._fetch(('8-K',), '2025-01-01')
    self.assertNotIn('2024-10-22', [f.filing_date for f in out])


class RowsTest(unittest.TestCase):
  GM = {'id': 'u-gm', 'ticker': 'GM', 'sec_cik': '1467858', 'dart_corp_code': None}
  KR = {'id': 'u-kr', 'ticker': '000000', 'sec_cik': None, 'dart_corp_code': '00000001'}

  def _edgar_rows(self):
    resp = MagicMock()
    resp.json.return_value = _GM_SUB
    with patch.object(edgar, 'edgar_get', return_value=resp):
      return ccd.edgar_rows(MagicMock(), self.GM, '2026-01-01')

  def _dart_rows(self):
    by_ty = {
      'I002': [{'rcept_no': '20261023800001', 'rcept_dt': '20261023', 'report_nm': '연결재무제표기준영업(잠정)실적(공정공시) '},
               {'rcept_no': '20261023800002', 'rcept_dt': '20261023', 'report_nm': '자기주식취득결과보고서'}],
      'I003': [{'rcept_no': '20261020800003', 'rcept_dt': '20261020', 'report_nm': '기업설명회(IR)개최(안내공시)'}],
    }
    with patch.object(ccd.dart_api, 'list_disclosures', side_effect=lambda s, cc, b, e, ty: by_ty[ty]):
      return ccd.dart_rows(MagicMock(), self.KR, '20260101', '20261109')

  def test_edgar_rows(self):
    rows = self._edgar_rows()
    self.assertEqual([r['doc_type'] for r in rows], ['earnings_release', 'current_report', 'periodic'])
    r = rows[0]
    self.assertEqual(r['url'], 'https://www.sec.gov/Archives/edgar/data/1467858/000146785826000056/gm-20261021.htm')
    self.assertEqual((r['source'], r['source_id'], r['published_at']), ('edgar', '0001467858-26-000056', '2026-10-21'))
    self.assertEqual(rows[1]['title'], '8-K')  # 설명이 비면 공시 종류로

  def test_dart_rows(self):
    rows = self._dart_rows()
    self.assertEqual([(r['doc_type'], r['form']) for r in rows], [('prelim_results', 'I002'), ('ir_event', 'I003')])
    r = rows[0]
    self.assertEqual(r['published_at'], '2026-10-23')
    self.assertEqual(r['title'], '연결재무제표기준영업(잠정)실적(공정공시)')
    self.assertEqual(r['url'], 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261023800001')

  def test_payload_never_carries_parse_state(self):
    """🔴 upsert payload 칸 = 목록 칸뿐. parse_status·first_seen_at 은 새 행이면 DB DEFAULT, 기존 행이면 손대지 않는다."""
    for r in self._edgar_rows() + self._dart_rows():
      self.assertEqual(set(r), _ROW_KEYS)
      self.assertFalse(_FORBIDDEN & set(r))

  def test_dedupe_keeps_one_per_key(self):
    rows = self._dart_rows()
    self.assertEqual(len(ccd.dedupe(rows + rows)), len(rows))


class StoreTest(unittest.TestCase):
  def test_store_upserts_only_list_columns(self):
    rows = [{'company_id': 'u', 'source': 'edgar', 'source_id': 'a', 'doc_type': 'periodic', 'form': '10-Q', 'items': '',
             'title': '10-Q', 'url': 'x', 'published_at': '2026-07-21'}]
    with patch.object(ccd, '_db') as db:
      ccd.store(rows)
    table, sent, conflict = db.return_value.upsert_rows.call_args.args
    self.assertEqual((table, conflict), ('customer_documents', 'source,source_id'))
    self.assertFalse(_FORBIDDEN & set(sent[0]))

  def test_store_rejects_forbidden_column(self):
    with patch.object(ccd, '_db'):
      with self.assertRaises(ValueError):
        ccd.store([{'source': 'dart', 'source_id': '1', 'parse_status': 'pending'}])


class NewKeysTest(unittest.TestCase):
  def test_counts_only_unseen_keys(self):
    client = MagicMock()
    q = client.table.return_value.select.return_value.eq.return_value.in_.return_value
    q.execute.return_value.data = [{'source_id': 'a'}]
    rows = [{'source': 'edgar', 'source_id': 'a'}, {'source': 'edgar', 'source_id': 'b'}]
    self.assertEqual(ccd.count_new(client, rows), 1)
    client.table.assert_called_with('customer_documents')
    client.table.return_value.select.return_value.eq.assert_called_with('source', 'edgar')

  def test_empty_rows_no_query(self):
    client = MagicMock()
    self.assertEqual(ccd.count_new(client, []), 0)
    client.table.assert_not_called()


class StatusTest(unittest.TestCase):
  def _http(self, code):
    r = requests.Response()
    r.status_code = code
    return requests.HTTPError(f'HTTP {code}', response=r)

  def test_403_is_blocked(self):
    self.assertEqual(ccd.failure_status('EDGAR', self._http(403)), ('blocked', 'EDGAR 접근 차단(HTTP 403)'))

  def test_other_http_is_error_class_name_only(self):
    self.assertEqual(ccd.failure_status('DART', self._http(404)), ('error', 'HTTPError'))

  def test_other_exception_class_name_only(self):
    self.assertEqual(ccd.failure_status('DART', RuntimeError('DART list status=020 corp=x')), ('error', 'RuntimeError'))

  def test_write_status_sets_checked_at_every_time(self):
    """default now() 는 INSERT 에만 — upsert 로는 확인 시각이 첫 기록에 멈춘다. payload 에 매번 싣는다."""
    ws = MagicMock()
    ccd.write_status(ws, 'u-gm', 'edgar_list', 'no_new', None)
    ws.table.assert_called_with('customer_collect_status')
    payload = ws.table.return_value.upsert.call_args.args[0]
    self.assertEqual(ws.table.return_value.upsert.call_args.kwargs['on_conflict'], 'company_id,collector')
    self.assertEqual((payload['company_id'], payload['collector'], payload['status']), ('u-gm', 'edgar_list', 'no_new'))
    self.assertRegex(payload['checked_at'], r'^\d{4}-\d{2}-\d{2}T.*\+00:00$')


if __name__ == '__main__':
  unittest.main()
