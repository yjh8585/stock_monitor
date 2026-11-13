"""MarkLines 서플라이어 DB HTTP — 검색 id · 상세 JSON (2026-11-13 실측 경로).

🔴 쿠키는 scripts/.env 의 MARKLINES_COOKIE 만 쓴다. .env.local 의 같은 이름은 GA 쿠키뿐인 껍데기라
   유료 벽이 HTTP 200 으로 온다(docs/oem-collection.md 「쿠키가 «두 곳»에 있다」).
🔴 로그인 판정은 상세 JSON 의 profile 존재로 한다(200 은 아무것도 보장하지 않는다).
"""
from __future__ import annotations

import html
import json
import pathlib
import re
import time

import requests
from dotenv import dotenv_values

from lib.retry import with_retry  # with_retry(fn, *args, _attempts=3, _backoff=2.0, _label='', **kwargs) — 일시적 오류만 재시도

BASE = 'https://www.marklines.com/en/supplier_db'
MIN_INTERVAL_SEC = 1.0
# 검색 결과 id 는 3,000 개에서 잘린다(2026-11-13 실측 — 공정·범용 분류 3종이 모두 정확히 3000).
# 건수가 이 값이면 「3,000 곳」이 아니라 「3,000 곳 이상 · 잘림」이다.
SEARCH_CAP = 3000


class NotLoggedIn(RuntimeError):
  pass


def load_cookie() -> str:
  env = pathlib.Path(__file__).resolve().parents[1] / '.env'
  cookie = dotenv_values(env).get('MARKLINES_COOKIE')
  if not cookie or 'PLATFORM_SESSION' not in cookie:
    raise NotLoggedIn('scripts/.env 의 MARKLINES_COOKIE 에 세션 쿠키가 없다')
  return cookie


class SupplierDb:
  def __init__(self, cookie: str):
    self._s = requests.Session()
    self._s.headers.update({'Cookie': cookie, 'User-Agent': 'Mozilla/5.0',
                            'X-Requested-With': 'XMLHttpRequest'})
    self._last = 0.0

  def _get(self, url: str, params: dict) -> requests.Response:
    def call() -> requests.Response:
      # 간격은 실제 HTTP 호출마다 — 재시도 요청도 1초 간격을 지킨다(Codex 대조 2026-11-13).
      wait = MIN_INTERVAL_SEC - (time.monotonic() - self._last)
      if wait > 0:
        time.sleep(wait)
      self._last = time.monotonic()
      resp = self._s.get(url, params=params, timeout=60)
      # 🔴 수집 도중 세션이 끊기면 상세가 401 JSON 으로 온다(2026-11-13 본 수집 #480 부터 1,416건).
      # HTTPError 로 두면 「한 업체 실패」로 세어 헛요청을 계속하므로 로그인 풀림으로 즉시 멈춘다.
      # NotLoggedIn 은 retry.py 의 일시 오류 판정에 걸리지 않아 재시도하지 않는다.
      if resp.status_code in (401, 403):
        raise NotLoggedIn(f'HTTP {resp.status_code}')
      # 그 밖의 4xx 는 즉시 raise — 단 429 는 retry.py 가 일시적 오류로 보고 재시도한다(retry.py:24).
      resp.raise_for_status()
      return resp
    return with_retry(call, _label='marklines supplier_db')

  def search(self, **params) -> tuple[list[int], list[str]]:
    """결과 HTML 숨은 칸에서 id 목록을 읽는다.

    정상 0건이면 칸은 있고 값이 `[]` 다(2026-11-13 실측 — 납품처 검색 0건 사례).
    🔴 칸 자체가 없으면 로그인 풀림·화면 구조 변경이다 — 0건으로 삼키지 않고 멈춘다.
    """
    text = self._get(f'{BASE}/result', params).text
    ids = re.search(r'id="supplier_ids"[^>]*value="([^"]*)"', text)
    codes = re.search(r'id="suppliers_code_list"[^>]*value="([^"]*)"', text)
    if not ids or not codes:
      raise NotLoggedIn('검색 결과에 supplier_ids 칸이 없다(로그인 풀림 또는 화면 구조 변경)')
    return json.loads(html.unescape(ids.group(1))), json.loads(html.unescape(codes.group(1)))

  def detail(self, rand_code: str) -> dict:
    r = self._get(f'{BASE}/{rand_code}/', {'is_modal': 'true', 'index': 1, 'count': 1})
    try:
      data = r.json()
    except ValueError as e:
      raise NotLoggedIn(f'상세가 JSON 이 아니다(유료 벽 의심): {rand_code}') from e
    if not data.get('profile'):
      raise NotLoggedIn(f'상세에 profile 이 없다: {rand_code}')
    return data
