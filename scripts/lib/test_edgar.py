"""lib.edgar 회귀 테스트 — 고정 픽스처(네트워크 없음).

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_edgar.py
"""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib import edgar  # noqa: E402


class EdgarTest(unittest.TestCase):
  def test_parse_recent(self):
    sub = {'filings': {'recent': {
      'accessionNumber': ['0001467858-26-000056'], 'filingDate': ['2026-10-20'], 'reportDate': ['2026-10-20'],
      'form': ['8-K'], 'items': ['2.02,9.01'], 'primaryDocument': ['gm-20261020.htm'],
      'primaryDocDescription': ['8-K']}}}
    f = edgar.parse_recent(sub)[0]
    self.assertEqual((f.form, f.items), ('8-K', '2.02,9.01'))
    self.assertEqual(f.base_url('1467858'), 'https://www.sec.gov/Archives/edgar/data/1467858/000146785826000056')

  def test_parse_recent_none_to_empty(self):
    sub = {'filings': {'recent': {
      'accessionNumber': ['0001605484-26-000001'], 'filingDate': ['2026-10-30'], 'reportDate': [None],
      'form': ['6-K'], 'items': [None], 'primaryDocument': ['a.htm'], 'primaryDocDescription': [None]}}}
    f = edgar.parse_recent(sub)[0]
    self.assertEqual((f.report_date, f.items, f.primary_desc), ('', '', ''))

  def test_htm_names(self):
    idx = {'directory': {'item': [{'name': 'gm-20261020.htm'}, {'name': 'R1.htm'}, {'name': 'gmq32026pressreleaseandfin.htm'},
                                  {'name': '0001467858-26-000056-index.htm'}, {'name': 'logo.jpg'}]}}
    self.assertEqual(edgar.filing_htm_names(idx, 'gm-20261020.htm'),
                     ['gm-20261020.htm', 'gmq32026pressreleaseandfin.htm'])

  def test_default_ua(self):
    with patch.dict(os.environ, {}, clear=False):
      os.environ.pop('SEC_USER_AGENT', None)
      self.assertIn('@', edgar.user_agent())
      self.assertEqual(edgar.headers()['User-Agent'], edgar.DEFAULT_UA)

  def test_ua_from_env(self):
    with patch.dict(os.environ, {'SEC_USER_AGENT': 'x y@z.com'}):
      self.assertEqual(edgar.headers()['User-Agent'], 'x y@z.com')


class NormalizeCikTest(unittest.TestCase):
  """Task 1 검토 지적: companies.sec_cik CHECK 가 앞 0 붙은 꼴도 통과시킨다 → 넣는 쪽이 한 꼴로 맞춘다."""

  def test_leading_zeros_removed(self):
    self.assertEqual(edgar.normalize_cik('0000320193'), '320193')
    self.assertEqual(edgar.normalize_cik('0001605484'), '1605484')

  def test_int_and_spaces(self):
    self.assertEqual(edgar.normalize_cik(1467858), '1467858')
    self.assertEqual(edgar.normalize_cik(' 931015 '), '931015')

  def test_same_cik_two_forms_collapse(self):
    self.assertEqual(edgar.normalize_cik('0000320193'), edgar.normalize_cik(320193))

  def test_invalid(self):
    for bad in ('', 'abc', '-5', '12a', '0', '00000000000', '12345678901'):
      with self.subTest(bad=bad), self.assertRaises(ValueError):
        edgar.normalize_cik(bad)


class EdgarGetTest(unittest.TestCase):
  def test_sends_ua_and_returns(self):
    resp = MagicMock(status_code=200)
    session = MagicMock()
    session.get.return_value = resp
    with patch.object(edgar.time, 'sleep'):
      self.assertIs(edgar.edgar_get(session, 'https://data.sec.gov/x.json'), resp)
    self.assertIn('User-Agent', session.get.call_args.kwargs['headers'])

  def test_4xx_raises_without_retry(self):
    resp = MagicMock(status_code=404)
    resp.raise_for_status.side_effect = requests.HTTPError('404', response=resp)
    session = MagicMock()
    session.get.return_value = resp
    with patch.object(edgar.time, 'sleep'), self.assertRaises(requests.HTTPError):
      edgar.edgar_get(session, 'https://www.sec.gov/missing')
    self.assertEqual(session.get.call_count, 1)


if __name__ == '__main__':
  unittest.main()
