"""lib.dart_api 회귀 테스트 — requests.Session 대역(가짜 get)으로, 네트워크 없음.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_dart_api.py
"""
import io
import os
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib import dart_api  # noqa: E402

FAKE_KEY = 'TESTKEY0123456789abcdef'


class _Resp:
  def __init__(self, status_code=200, payload=None, content=b''):
    self.status_code = status_code
    self._payload = payload
    self.content = content

  def json(self):
    return self._payload


class _Session:
  """get 이 불릴 때마다 준비한 응답(또는 예외)을 차례로 돌려준다."""

  def __init__(self, *responses):
    self._responses = list(responses)
    self.calls = []

  def get(self, url, params=None, timeout=None):
    self.calls.append((url, dict(params or {})))
    r = self._responses.pop(0)
    if isinstance(r, Exception):
      raise r
    return r


@patch.dict(os.environ, {'DART_API_KEY': FAKE_KEY})
@patch.object(dart_api.time, 'sleep')
class ListDisclosuresTest(unittest.TestCase):
  def test_status_013_is_empty(self, _sleep):
    s = _Session(_Resp(payload={'status': '013', 'message': '조회된 데이타가 없습니다.'}))
    self.assertEqual(dart_api.list_disclosures(s, '00164742', '20250101', '20261109', 'I002'), [])

  def test_two_pages_joined(self, _sleep):
    s = _Session(
      _Resp(payload={'status': '000', 'total_page': 2, 'list': [{'rcept_no': '1'}, {'rcept_no': '2'}]}),
      _Resp(payload={'status': '000', 'total_page': 2, 'list': [{'rcept_no': '3'}]}),
    )
    out = dart_api.list_disclosures(s, '00164742', '20250101', '20261109', 'I002')
    self.assertEqual([r['rcept_no'] for r in out], ['1', '2', '3'])
    self.assertEqual([c[1]['page_no'] for c in s.calls], [1, 2])
    self.assertEqual(s.calls[0][1]['crtfc_key'], FAKE_KEY)  # 키는 요청 인자로만

  def test_bad_status_raises_without_key(self, _sleep):
    s = _Session(_Resp(payload={'status': '020', 'message': '요청 제한을 초과하였습니다.'}))
    with self.assertRaises(RuntimeError) as cm:
      dart_api.list_disclosures(s, '00164742', '20250101', '20261109', 'I002')
    msg = str(cm.exception)
    self.assertIn('020', msg)
    self.assertNotIn('crtfc_key', msg)
    self.assertNotIn(FAKE_KEY, msg)

  def test_http_error_message_has_no_key(self, _sleep):
    """4xx 는 재시도 없이 바로 — 예외 문장에 쿼리(키)가 없다."""
    s = _Session(_Resp(status_code=403))
    with self.assertRaises(requests.HTTPError) as cm:
      dart_api.list_disclosures(s, '00164742', '20250101', '20261109', 'I002')
    self.assertNotIn(FAKE_KEY, str(cm.exception))
    self.assertEqual(len(s.calls), 1)

  def test_connection_error_retried_and_key_hidden(self, _sleep):
    leak = requests.ConnectionError(f'Max retries exceeded with url: /api/list.json?crtfc_key={FAKE_KEY}')
    s = _Session(leak, leak, leak)
    with patch('lib.retry.time.sleep'), self.assertRaises(requests.ConnectionError) as cm:
      dart_api.list_disclosures(s, '00164742', '20250101', '20261109', 'I002')
    self.assertNotIn(FAKE_KEY, str(cm.exception))
    self.assertEqual(len(s.calls), 3)  # 종류를 지켜 with_retry 가 일시 오류로 다시 시도했다


@patch.dict(os.environ, {'DART_API_KEY': FAKE_KEY})
@patch.object(dart_api.time, 'sleep')
class DocumentTextTest(unittest.TestCase):
  def test_zip_xml_joined_in_name_order(self, _sleep):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
      z.writestr('20261030000002_00760.xml', '<P>둘째&nbsp;문서</P>')
      z.writestr('20261030000002.xml', '<P>매출액</P><TD>1,234</TD>')
    s = _Session(_Resp(content=buf.getvalue()))
    self.assertEqual(dart_api.document_text(s, '20261030000002'), '매출액 1,234\n둘째 문서')
    self.assertEqual(s.calls[0][1], {'crtfc_key': FAKE_KEY, 'rcept_no': '20261030000002'})


if __name__ == '__main__':
  unittest.main()
