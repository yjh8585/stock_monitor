"""KOMIS 차단 응답 처리 회귀 검증 — 네트워크 없이 가짜 요청 컨텍스트로.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_komis.py -q

2026-11-20 코드 리뷰 11번: 401·403·429 를 빈 결과로 보고 3회 다시 두드렸다(전역 규칙 「즉시 멈춤」 위반).
차단 응답은 `KomisBlocked` 로 던지고, 그 밖의 오류(500 등)는 종전대로 빈 목록 → 재시도.
"""
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

from lib.komis import KomisBlocked, KomisTarget, fetchDailySeries  # noqa: E402

TARGET = KomisTarget('T', 'https://example.invalid/page', 'HP001', 'MNRL0001', '현물')


class _Resp:
  def __init__(self, status: int, body: dict | None = None):
    self.status = status
    self.ok = 200 <= status < 300
    self._body = body or {}

  def json(self):
    return self._body


class _Ctx:
  """페이지 GET · 가격기준 POST · 차트 POST 순서로 응답을 돌려주는 가짜 컨텍스트."""

  def __init__(self, page: int = 200, price: int = 200, chart: int = 200):
    self.page, self.price, self.chart = page, price, chart
    self.posts = 0

  def get(self, *a, **k):
    return _Resp(self.page)

  def post(self, url, *a, **k):
    self.posts += 1
    if self.posts == 1:
      return _Resp(self.price, {'data': [{'cdVal': '현물', 'cdKey': '878'}]})
    return _Resp(self.chart, {'data': {'xaxis': ['2026.11.20'], 'series': [{'data': ['1,234']}]}})


class KomisBlockedTest(unittest.TestCase):
  def test_차단_응답은_단계마다_즉시_던진다(self):
    for kw in ({'page': 403}, {'price': 429}, {'chart': 401}):
      with self.subTest(kw=kw), self.assertRaises(KomisBlocked):
        fetchDailySeries(_Ctx(**kw), TARGET, 1)

  def test_그_밖의_오류는_빈_목록이라_재시도_대상(self):
    self.assertEqual(fetchDailySeries(_Ctx(chart=500), TARGET, 1), [])

  def test_정상이면_행을_돌려준다(self):
    rows = fetchDailySeries(_Ctx(), TARGET, 1)
    self.assertEqual(rows, [{'series_code': 'T', 'trade_date': '2026-11-20', 'close': 1234.0}])

  def test_수집기는_첫_금속에서_막히면_다음_금속을_조회하지_않는다(self):
    """수집기의 `except KomisBlocked: raise` 를 지우면 `except Exception` 이 삼켜 알루미늄을 또 두드린다(검토 2회차)."""
    from unittest import mock

    import collect_komis_lme as lme
    with mock.patch.object(lme, 'fetchWithRetry', side_effect=KomisBlocked('403')) as fetch, \
         mock.patch.object(lme, 'upsert_rows') as upsert:
      with self.assertRaises(KomisBlocked):
        lme.collectKomisLme()
    self.assertEqual(fetch.call_count, 1)
    upsert.assert_not_called()


if __name__ == '__main__':
  unittest.main()
