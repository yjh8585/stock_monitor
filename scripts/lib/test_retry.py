"""lib.retry 회귀 테스트 — 2026-08-17 GHA 실패 2건을 그대로 재현한다.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_retry.py
"""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import requests
from postgrest.exceptions import APIError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.retry import is_transient_error, with_retry  # noqa: E402

# 실패 로그에 찍힌 실제 예외를 그대로 재현
CLOUDFLARE_502 = APIError({
  'message': 'JSON could not be generated',
  'code': 502,
  'hint': 'Refer to full message for details',
  'details': '<html><head><title>502 Bad Gateway</title></head></html>',
})
INCOMPLETE_READ = requests.exceptions.ChunkedEncodingError(
  'Connection broken: IncompleteRead(2080495 bytes read, 581403 more expected)'
)


def _http_error(status: int) -> requests.exceptions.HTTPError:
  """raise_for_status()가 던지는 형태의 HTTPError."""
  response = requests.Response()
  response.status_code = status
  return requests.exceptions.HTTPError(f'{status} Error', response=response)


class TestIsTransientError(unittest.TestCase):
  def test_cloudflare_502_is_transient(self):
    """collect_market_series를 죽인 Supabase 앞단 502."""
    self.assertTrue(is_transient_error(CLOUDFLARE_502))

  def test_incomplete_read_is_transient(self):
    """collect_uzauto_financials를 죽인 PDF 다운로드 중 연결 끊김."""
    self.assertTrue(is_transient_error(INCOMPLETE_READ))

  def test_gateway_and_overload_codes_are_transient(self):
    for code in (429, 500, 502, 503, 504):
      with self.subTest(code=code):
        self.assertTrue(is_transient_error(_http_error(code)))

  def test_httpx_transport_error_is_transient(self):
    self.assertTrue(is_transient_error(httpx.ConnectError('connection failed')))

  def test_dead_link_is_not_transient(self):
    """404/410은 재시도해도 같은 답 — UzAuto의 source_link_missing skip 경로를 지켜야 한다."""
    for code in (400, 401, 403, 404, 410, 422):
      with self.subTest(code=code):
        self.assertFalse(is_transient_error(_http_error(code)))

  def test_postgres_sqlstate_is_not_transient(self):
    """PostgREST가 DB 오류를 담아 보낼 때의 code(SQLSTATE)를 5xx로 오인하면 안 된다."""
    for sqlstate in ('23505', '42P01', '23503'):
      with self.subTest(sqlstate=sqlstate):
        self.assertFalse(is_transient_error(APIError({'message': 'db error', 'code': sqlstate})))

  def test_plain_error_is_not_transient(self):
    self.assertFalse(is_transient_error(ValueError('잘못된 값')))


class TestWithRetry(unittest.TestCase):
  def test_recovers_after_transient_failures(self):
    calls = []

    def flaky():
      calls.append(1)
      if len(calls) < 3:
        raise CLOUDFLARE_502
      return 'ok'

    with patch('lib.retry.time.sleep') as sleep:
      self.assertEqual(with_retry(flaky), 'ok')
    self.assertEqual(len(calls), 3)
    self.assertEqual([c.args[0] for c in sleep.call_args_list], [2.0, 4.0])  # 지수 백오프

  def test_non_transient_raises_immediately(self):
    calls = []

    def bad():
      calls.append(1)
      raise _http_error(404)

    with patch('lib.retry.time.sleep') as sleep:
      with self.assertRaises(requests.exceptions.HTTPError):
        with_retry(bad)
    self.assertEqual(len(calls), 1, '4xx는 재시도하지 않는다')
    sleep.assert_not_called()

  def test_gives_up_after_attempts(self):
    """끝내 실패하면 그대로 raise — 진짜 장애가 워크플로 실패로 드러나야 한다."""
    calls = []

    def always_down():
      calls.append(1)
      raise INCOMPLETE_READ

    with patch('lib.retry.time.sleep'):
      with self.assertRaises(requests.exceptions.ChunkedEncodingError):
        with_retry(always_down, _attempts=3)
    self.assertEqual(len(calls), 3)

  def test_passes_through_args(self):
    with patch('lib.retry.time.sleep'):
      self.assertEqual(with_retry(lambda a, b=0: a + b, 1, b=2), 3)


class TestUpsertRowsRetry(unittest.TestCase):
  """lib.db.upsert_rows에 재시도가 실제로 배선됐는지 — 공용 경로라 회귀 시 40여 수집기가 함께 죽는다."""

  def setUp(self):
    os.environ.setdefault('SUPABASE_URL', 'http://localhost:54321')
    os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'test-key')

  def _run_upsert(self, execute_side_effect):
    from lib import db as db_module

    execute = MagicMock(side_effect=execute_side_effect)
    builder = MagicMock()
    builder.upsert.return_value = MagicMock(execute=execute)
    client = MagicMock()
    client.table.return_value = builder

    rows = [{'id': 1}, {'id': 2}]
    with patch.object(db_module, 'get_client', return_value=client),          patch('lib.retry.time.sleep'),          patch('lib.revalidate.revalidate_for_tables'):
      total = db_module.upsert_rows('market_series_daily', rows, 'id')
    return total, builder, execute

  def test_retries_cloudflare_502_then_succeeds(self):
    total, builder, execute = self._run_upsert([CLOUDFLARE_502, CLOUDFLARE_502, None])
    self.assertEqual(total, 2)
    self.assertEqual(execute.call_count, 3)
    # 재시도할 때마다 같은 배치가 그대로 넘어가야 한다 (lambda 캡처 회귀 방지)
    for call in builder.upsert.call_args_list:
      self.assertEqual(call.args[0], [{'id': 1}, {'id': 2}])

  def test_raises_after_persistent_502(self):
    with self.assertRaises(APIError):
      self._run_upsert([CLOUDFLARE_502] * 5)


if __name__ == '__main__':
  unittest.main(verbosity=2)
