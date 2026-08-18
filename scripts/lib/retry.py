"""일시적 네트워크·게이트웨이 오류 재시도 유틸.

배경(2026-08-17 GHA 실패 2건): 둘 다 "외부 요청 1회 실패 = 워크플로 전체 실패"였다.
  - collect_market_series: Supabase 앞단 Cloudflare가 502를 1회 반환 (lib.db.upsert_rows)
  - collect_uzauto_financials: PDF 다운로드 중 IncompleteRead (연결이 도중에 끊김)
데이터도 코드도 멀쩡했고 다음 회차에 저절로 회복됐다. 판정 문구는
collect_dart_audit.py의 _is_transient_error를 따른다 — 그쪽은 OpenDartReader 전용
요소(deadline 스레드·stdout 침묵)가 섞여 있어 그대로 두고, 여기엔 공통 부분만 둔다.

🔴 재시도해도 끝내 실패하면 그대로 raise한다. 진짜 장애는 워크플로 실패로 드러나야 한다.
"""
import time
from typing import Any, Callable, TypeVar

import httpx
import requests
from loguru import logger
from postgrest.exceptions import APIError

T = TypeVar('T')

# 잠시 뒤 같은 요청이 성공할 수 있는 상태 코드만. 4xx는 재시도해도 같은 답이 온다.
TRANSIENT_STATUS_CODES = frozenset({429, 500, 502, 503, 504})

# 응답을 받는 도중 연결이 끊긴 경우 — 예외 타입이 라이브러리마다 달라 문구로도 잡는다.
_TRANSIENT_MESSAGE_MARKERS = (
  'connection broken',
  'connection reset',
  'connection aborted',
  'incompleteread',
  'remote end closed',
  'server disconnected',
  'ssleof',
  'timed out',
)


def _status_code(e: Exception) -> int | None:
  """예외에서 HTTP 상태 코드를 뽑는다. postgrest APIError는 code 필드에 담아 온다."""
  if isinstance(e, APIError):
    try:
      # PostgREST가 DB 오류를 담아 보낼 때의 code는 Postgres SQLSTATE(예: '23505')라
      # 5자리 정수가 되어 TRANSIENT_STATUS_CODES에 걸리지 않는다.
      return int(e.code)  # type: ignore[arg-type]
    except (TypeError, ValueError):
      return None
  return getattr(getattr(e, 'response', None), 'status_code', None)


def is_transient_error(e: Exception) -> bool:
  """일시적 네트워크·게이트웨이 오류면 True. 4xx·데이터 오류는 False(즉시 실패)."""
  if _status_code(e) in TRANSIENT_STATUS_CODES:
    return True
  if isinstance(
    e,
    (
      requests.exceptions.ConnectionError,
      requests.exceptions.Timeout,
      requests.exceptions.ChunkedEncodingError,
      httpx.TransportError,
    ),
  ):
    return True
  msg = str(e).lower()
  return any(marker in msg for marker in _TRANSIENT_MESSAGE_MARKERS)


def with_retry(
  fn: Callable[..., T],
  *args: Any,
  _attempts: int = 3,
  _backoff: float = 2.0,
  _label: str = '',
  **kwargs: Any,
) -> T:
  """fn(*args, **kwargs)를 실행하고, 일시적 오류면 지수 백오프로 다시 시도한다.

  기본 3회 호출(실패 시 2초·4초 대기). 제어 인자는 fn의 인자와 섞이지 않도록
  collect_dart_audit.py와 같은 `_` 접두사 컨벤션을 쓴다.

  Args:
    fn: 호출할 함수
    _attempts: 최대 호출 횟수 (재시도 횟수 + 1)
    _backoff: 첫 대기 초. i번째 재시도는 _backoff * 2**i 초 대기
    _label: 로그에 붙일 식별자 (예: 'market_series_daily upsert')

  Returns:
    fn의 반환값

  Raises:
    일시적이지 않은 예외, 또는 마지막 시도까지 실패한 예외를 그대로 raise
  """
  prefix = f'{_label} ' if _label else ''
  last: Exception | None = None

  for i in range(_attempts):
    try:
      return fn(*args, **kwargs)
    except Exception as e:
      last = e
      if i >= _attempts - 1 or not is_transient_error(e):
        raise
      wait = _backoff * (2 ** i)
      logger.warning(
        f'{prefix}일시적 오류 — {wait:.0f}s 후 재시도 '
        f'({i + 1}/{_attempts - 1}) [{type(e).__name__}: {e}]'
      )
      time.sleep(wait)

  raise last  # 도달하지 않음 (루프에서 return 또는 raise)
