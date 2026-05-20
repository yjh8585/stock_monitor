"""
KIS Developers (한국투자증권 OpenAPI) 클라이언트.

설계 원칙
- 토큰 발급은 1분당 1회 제한, 유효기간 24시간 → Supabase kis_tokens 테이블에 캐싱.
- in-memory 캐시 → DB 캐시 → 신규 발급 순.
- 만료 1시간 전부터 신규 발급으로 전환(시간차로 인한 401 방지).
- REST 초당 호출은 안전마진 15건/sec sliding window로 제한.
- HTTP 세션 1개 재사용. 요청별 헤더는 build_headers()로 조립.
- 외부 의존성은 모두 생성자로 주입 가능 → mock 테스트 용이.

환경변수
- KIS_ENV           : 'prod' (실전) | 'vts' (모의투자), 기본 'prod'
- KIS_APP_KEY       : 앱키
- KIS_APP_SECRET    : 앱시크릿

사용 예
  client = KisClient.from_env()
  price = client.get_price('016450')
  bars  = client.get_minute_bars('016450', interval=5)
  flow  = client.get_investor_trend('016450')
"""
from __future__ import annotations

import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, Protocol

import requests
from loguru import logger


BASE_URLS = {
  'prod': 'https://openapi.koreainvestment.com:9443',
  'vts': 'https://openapivts.koreainvestment.com:29443',
}

# 토큰 만료 N초 전부터 재발급 (시간차/시계 오차 안전마진)
TOKEN_REFRESH_LEEWAY_SEC = 3600

# REST 초당 호출 안전마진 (실전 한도 20/s)
RATE_LIMIT_PER_SEC = 15


# ───────────────────────── Token Store ─────────────────────────

@dataclass
class TokenRecord:
  token: str
  expires_at: datetime  # tz-aware UTC


class TokenStore(Protocol):
  def load(self, env_key: str) -> Optional[TokenRecord]: ...
  def save(self, env_key: str, rec: TokenRecord) -> None: ...


class InMemoryTokenStore:
  """프로세스 내에서만 유효. 단위 테스트 / 단발 스크립트 용도."""

  def __init__(self) -> None:
    self._data: dict[str, TokenRecord] = {}
    self._lock = threading.Lock()

  def load(self, env_key: str) -> Optional[TokenRecord]:
    with self._lock:
      return self._data.get(env_key)

  def save(self, env_key: str, rec: TokenRecord) -> None:
    with self._lock:
      self._data[env_key] = rec


class SupabaseTokenStore:
  """Supabase kis_tokens 테이블에 영속화. 다중 워크플로 / 머신 간 공유."""

  TABLE = 'kis_tokens'

  def __init__(self, postgrest_client=None) -> None:
    if postgrest_client is None:
      from lib.db import get_client
      postgrest_client = get_client()
    self._db = postgrest_client

  def load(self, env_key: str) -> Optional[TokenRecord]:
    try:
      res = (
        self._db.table(self.TABLE)
        .select('token,expires_at')
        .eq('env_key', env_key)
        .limit(1)
        .execute()
      )
    except Exception as e:
      logger.warning(f'kis_tokens 조회 실패 (캐시 미스로 처리): {e}')
      return None
    if not res.data:
      return None
    row = res.data[0]
    return TokenRecord(
      token=row['token'],
      expires_at=_parse_iso(row['expires_at']),
    )

  def save(self, env_key: str, rec: TokenRecord) -> None:
    payload = {
      'env_key': env_key,
      'token': rec.token,
      'expires_at': rec.expires_at.astimezone(timezone.utc).isoformat(),
      'updated_at': datetime.now(timezone.utc).isoformat(),
    }
    self._db.table(self.TABLE).upsert(payload, on_conflict='env_key').execute()


def _parse_iso(s: str) -> datetime:
  # postgrest가 timestamptz를 'YYYY-MM-DD HH:MM:SS+00' 또는 ISO로 돌려줌
  s2 = s.replace(' ', 'T') if 'T' not in s else s
  if s2.endswith('Z'):
    s2 = s2[:-1] + '+00:00'
  return datetime.fromisoformat(s2)


# ───────────────────────── Rate Limiter ─────────────────────────

class SlidingWindowRateLimiter:
  """초당 N건 슬라이딩 윈도우. 한도 초과 시 sleep으로 자동 대기."""

  def __init__(self, max_per_sec: int, sleep_fn: Callable[[float], None] = time.sleep,
               now_fn: Callable[[], float] = time.monotonic) -> None:
    self._max = max_per_sec
    self._window = 1.0
    self._sleep = sleep_fn
    self._now = now_fn
    self._timestamps: deque[float] = deque()
    self._lock = threading.Lock()

  def acquire(self) -> None:
    with self._lock:
      now = self._now()
      while self._timestamps and now - self._timestamps[0] > self._window:
        self._timestamps.popleft()
      if len(self._timestamps) >= self._max:
        wait = self._window - (now - self._timestamps[0]) + 0.01
        if wait > 0:
          self._sleep(wait)
        now = self._now()
        while self._timestamps and now - self._timestamps[0] > self._window:
          self._timestamps.popleft()
      self._timestamps.append(now)


# ───────────────────────── KIS Client ─────────────────────────

class KisClient:
  def __init__(
    self,
    app_key: str,
    app_secret: str,
    env_key: str = 'prod',
    token_store: Optional[TokenStore] = None,
    session: Optional[requests.Session] = None,
    rate_limiter: Optional[SlidingWindowRateLimiter] = None,
    now_fn: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
  ) -> None:
    if env_key not in BASE_URLS:
      raise ValueError(f'Unknown KIS env: {env_key}')
    self.app_key = app_key
    self.app_secret = app_secret
    self.env_key = env_key
    self.base_url = BASE_URLS[env_key]
    self._store = token_store or InMemoryTokenStore()
    self._session = session or requests.Session()
    self._limiter = rate_limiter or SlidingWindowRateLimiter(RATE_LIMIT_PER_SEC)
    self._now = now_fn
    self._mem: Optional[TokenRecord] = None
    self._token_lock = threading.Lock()

  # ── factory ──────────────────────────────────────────────
  @classmethod
  def from_env(cls, token_store: Optional[TokenStore] = None) -> 'KisClient':
    env_key = os.environ.get('KIS_ENV', 'prod')
    app_key = os.environ['KIS_APP_KEY']
    app_secret = os.environ['KIS_APP_SECRET']
    if token_store is None:
      try:
        token_store = SupabaseTokenStore()
      except Exception as e:
        logger.warning(f'Supabase TokenStore 초기화 실패, in-memory 사용: {e}')
        token_store = InMemoryTokenStore()
    return cls(app_key, app_secret, env_key=env_key, token_store=token_store)

  # ── token ────────────────────────────────────────────────
  def get_access_token(self) -> str:
    """캐시 → DB → 신규 발급 순. 만료 1h 전부터 재발급."""
    with self._token_lock:
      now = self._now()
      if self._mem and self._is_fresh(self._mem, now):
        return self._mem.token
      cached = self._store.load(self.env_key)
      if cached and self._is_fresh(cached, now):
        self._mem = cached
        return cached.token
      rec = self._issue_token()
      self._store.save(self.env_key, rec)
      self._mem = rec
      return rec.token

  def _is_fresh(self, rec: TokenRecord, now: datetime) -> bool:
    return rec.expires_at - now > timedelta(seconds=TOKEN_REFRESH_LEEWAY_SEC)

  def _issue_token(self) -> TokenRecord:
    url = f'{self.base_url}/oauth2/tokenP'
    body = {
      'grant_type': 'client_credentials',
      'appkey': self.app_key,
      'appsecret': self.app_secret,
    }
    logger.info(f'KIS 토큰 신규 발급 ({self.env_key})')
    r = self._session.post(url, json=body, timeout=10)
    if r.status_code != 200:
      raise RuntimeError(f'KIS 토큰 발급 실패 status={r.status_code} body={r.text[:300]}')
    data = r.json()
    token = data['access_token']
    expires_in = int(data.get('expires_in', 86400))
    expires_at = self._now() + timedelta(seconds=expires_in)
    return TokenRecord(token=token, expires_at=expires_at)

  # ── headers ──────────────────────────────────────────────
  def build_headers(self, tr_id: str) -> dict[str, str]:
    return {
      'content-type': 'application/json; charset=utf-8',
      'authorization': f'Bearer {self.get_access_token()}',
      'appkey': self.app_key,
      'appsecret': self.app_secret,
      'tr_id': tr_id,
      'custtype': 'P',
    }

  # ── core GET ─────────────────────────────────────────────
  def get(self, path: str, tr_id: str, params: dict) -> dict:
    self._limiter.acquire()
    url = f'{self.base_url}{path}'
    headers = self.build_headers(tr_id)
    r = self._session.get(url, headers=headers, params=params, timeout=10)
    if r.status_code != 200:
      raise RuntimeError(f'KIS GET 실패 {path} status={r.status_code} body={r.text[:300]}')
    data = r.json()
    rt_cd = data.get('rt_cd')
    if rt_cd is not None and rt_cd != '0':
      raise RuntimeError(f'KIS GET 응답오류 {path} rt_cd={rt_cd} msg={data.get("msg1")}')
    return data

  # ── endpoint wrappers ────────────────────────────────────
  def get_price(self, ticker: str) -> dict:
    """현재가 시세 (단건). tr_id=FHKST01010100."""
    return self.get(
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      tr_id='FHKST01010100',
      params={'FID_COND_MRKT_DIV_CODE': 'J', 'FID_INPUT_ISCD': ticker},
    )

  def get_minute_bars(self, ticker: str, end_hhmmss: str = '153000', include_past_data: bool = False) -> dict:
    """주식당일분봉조회. tr_id=FHKST03010200.

    `end_hhmmss` (HHMMSS): 조회 종료 시각. 1회 호출당 30건이 응답되며,
    호출자가 시각을 슬라이딩하며 09:00 시작까지 반복 조회한다.
    `include_past_data` (Y/N): KIS의 과거영업일 데이터 포함 옵션. 당일만 받을 때는 N.
    """
    return self.get(
      '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice',
      tr_id='FHKST03010200',
      params={
        'FID_ETC_CLS_CODE': '',
        'FID_COND_MRKT_DIV_CODE': 'J',
        'FID_INPUT_ISCD': ticker,
        'FID_INPUT_HOUR_1': end_hhmmss,
        'FID_PW_DATA_INCU_YN': 'Y' if include_past_data else 'N',
      },
    )

  def get_investor_trend(self, ticker: str) -> dict:
    """주식현재가 투자자 (일별 외국인/기관/개인 매매동향). tr_id=FHKST01010900.

    당일 행은 장중에는 빈 문자열로 옴 (KIS는 장 마감 후 publish).
    어제 이전 30영업일 시계열 확정값 보강에 사용.
    """
    return self.get(
      '/uapi/domestic-stock/v1/quotations/inquire-investor',
      tr_id='FHKST01010900',
      params={'FID_COND_MRKT_DIV_CODE': 'J', 'FID_INPUT_ISCD': ticker},
    )

  def get_investor_estimate(self, ticker: str) -> dict:
    """종목투자자별 매매추정 — 장중 잠정 외국인+기관 누적. tr_id=HHPTJ04160200.

    응답 output2가 시간 슬롯 배열 (output2[0]이 가장 최신). 갱신 시각:
    외국인 09:30/11:20/13:20/14:30, 기관 10:00/11:20/13:20/14:30 (±10분).
    개인 필드 미제공 — 한국 시장 제로섬으로 도출(individual ≈ -(foreign+institution)).
    """
    return self.get(
      '/uapi/domestic-stock/v1/quotations/investor-trend-estimate',
      tr_id='HHPTJ04160200',
      params={'MKSC_SHRN_ISCD': ticker},
    )
