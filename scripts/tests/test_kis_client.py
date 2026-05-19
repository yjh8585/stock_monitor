"""
KIS 클라이언트 단위 테스트 (mock 기반, 외부 통신 없음).

실행
  cd scripts && python -m pytest tests/test_kis_client.py -v
  (또는) cd scripts && python -m unittest tests.test_kis_client
"""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from typing import Optional
from unittest.mock import MagicMock

from lib.kis_client import (
  InMemoryTokenStore,
  KisClient,
  SlidingWindowRateLimiter,
  TokenRecord,
)


def _make_response(status_code: int = 200, json_data: Optional[dict] = None) -> MagicMock:
  r = MagicMock()
  r.status_code = status_code
  r.json.return_value = json_data or {}
  r.text = str(json_data or {})
  return r


def _fixed_now(dt: datetime):
  return lambda: dt


class TokenIssueAndCacheTest(unittest.TestCase):
  def setUp(self) -> None:
    self.now = datetime(2026, 5, 19, 9, 0, tzinfo=timezone.utc)
    self.session = MagicMock()
    self.session.post.return_value = _make_response(200, {
      'access_token': 'tok-A',
      'expires_in': 86400,
    })
    self.store = InMemoryTokenStore()
    self.client = KisClient(
      app_key='K', app_secret='S', env_key='vts',
      token_store=self.store, session=self.session,
      now_fn=_fixed_now(self.now),
    )

  def test_first_call_issues_and_caches(self):
    t = self.client.get_access_token()
    self.assertEqual(t, 'tok-A')
    self.assertEqual(self.session.post.call_count, 1)
    # 메모리 + store 둘 다 채워짐
    self.assertEqual(self.store.load('vts').token, 'tok-A')

  def test_second_call_uses_memory_cache(self):
    self.client.get_access_token()
    self.client.get_access_token()
    self.assertEqual(self.session.post.call_count, 1)

  def test_new_client_uses_db_cache(self):
    self.client.get_access_token()
    new_client = KisClient(
      app_key='K', app_secret='S', env_key='vts',
      token_store=self.store, session=self.session,
      now_fn=_fixed_now(self.now + timedelta(hours=1)),
    )
    t = new_client.get_access_token()
    self.assertEqual(t, 'tok-A')
    # 신규 발급 호출 없음
    self.assertEqual(self.session.post.call_count, 1)

  def test_refresh_within_leeway_window(self):
    self.client.get_access_token()
    # 만료 30분 전 (leeway=1h 안쪽) → 재발급해야 함
    self.client._now = _fixed_now(self.now + timedelta(hours=23, minutes=30))
    self.session.post.return_value = _make_response(200, {
      'access_token': 'tok-B', 'expires_in': 86400,
    })
    t = self.client.get_access_token()
    self.assertEqual(t, 'tok-B')
    self.assertEqual(self.session.post.call_count, 2)

  def test_token_issue_failure_raises(self):
    fresh_store = InMemoryTokenStore()
    bad_session = MagicMock()
    bad_session.post.return_value = _make_response(403, {'msg1': 'forbidden'})
    bad_client = KisClient(
      app_key='K', app_secret='S', env_key='vts',
      token_store=fresh_store, session=bad_session,
      now_fn=_fixed_now(self.now),
    )
    with self.assertRaises(RuntimeError):
      bad_client.get_access_token()


class GetRequestTest(unittest.TestCase):
  def setUp(self) -> None:
    self.now = datetime(2026, 5, 19, 9, 0, tzinfo=timezone.utc)
    self.session = MagicMock()
    self.session.post.return_value = _make_response(200, {
      'access_token': 'tok-X', 'expires_in': 86400,
    })
    # rate limiter는 즉시 통과 (sleep 호출 안 함)
    self.client = KisClient(
      app_key='K', app_secret='S', env_key='prod',
      token_store=InMemoryTokenStore(), session=self.session,
      rate_limiter=SlidingWindowRateLimiter(
        max_per_sec=100, sleep_fn=lambda _s: None,
      ),
      now_fn=_fixed_now(self.now),
    )

  def test_get_price_builds_correct_request(self):
    self.session.get.return_value = _make_response(200, {
      'rt_cd': '0', 'msg1': 'OK',
      'output': {'stck_prpr': '4355', 'prdy_ctrt': '-0.57'},
    })
    res = self.client.get_price('016450')
    self.assertEqual(res['output']['stck_prpr'], '4355')
    args, kwargs = self.session.get.call_args
    self.assertIn('/inquire-price', args[0])
    self.assertEqual(kwargs['headers']['tr_id'], 'FHKST01010100')
    self.assertEqual(kwargs['headers']['authorization'], 'Bearer tok-X')
    self.assertEqual(kwargs['params']['FID_INPUT_ISCD'], '016450')

  def test_rt_cd_non_zero_raises(self):
    self.session.get.return_value = _make_response(200, {
      'rt_cd': '1', 'msg1': 'invalid ticker',
    })
    with self.assertRaises(RuntimeError):
      self.client.get_price('XXXXXX')

  def test_http_5xx_raises(self):
    self.session.get.return_value = _make_response(503, {'msg1': 'busy'})
    with self.assertRaises(RuntimeError):
      self.client.get_price('016450')

  def test_minute_bars_endpoint(self):
    self.session.get.return_value = _make_response(200, {'rt_cd': '0', 'output1': {}, 'output2': []})
    self.client.get_minute_bars('016450', interval=5)
    args, kwargs = self.session.get.call_args
    self.assertIn('inquire-time-itemchartprice', args[0])
    self.assertEqual(kwargs['headers']['tr_id'], 'FHKST03010200')
    self.assertEqual(kwargs['params']['FID_INPUT_HOUR_1'], '05')

  def test_investor_trend_endpoint(self):
    self.session.get.return_value = _make_response(200, {'rt_cd': '0', 'output': []})
    self.client.get_investor_trend('016450')
    args, kwargs = self.session.get.call_args
    self.assertIn('inquire-investor', args[0])
    self.assertEqual(kwargs['headers']['tr_id'], 'FHKST01010900')


class RateLimiterTest(unittest.TestCase):
  def test_under_limit_does_not_sleep(self):
    sleeps: list[float] = []
    t = [0.0]
    limiter = SlidingWindowRateLimiter(
      max_per_sec=3,
      sleep_fn=lambda s: sleeps.append(s),
      now_fn=lambda: t[0],
    )
    for _ in range(3):
      limiter.acquire()
      t[0] += 0.1
    self.assertEqual(sleeps, [])

  def test_exceeding_limit_triggers_sleep(self):
    sleeps: list[float] = []
    t = [0.0]
    def sleep_fn(s):
      sleeps.append(s)
      t[0] += s
    limiter = SlidingWindowRateLimiter(
      max_per_sec=3,
      sleep_fn=sleep_fn,
      now_fn=lambda: t[0],
    )
    # 3건 모두 t=0 시점에 acquire
    for _ in range(3):
      limiter.acquire()
    # 4번째는 윈도우 가득 → sleep 발생
    limiter.acquire()
    self.assertEqual(len(sleeps), 1)
    self.assertGreater(sleeps[0], 0)


if __name__ == '__main__':
  unittest.main()
