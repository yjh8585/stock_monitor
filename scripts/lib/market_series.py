"""
기타 섹션 시계열 수집 관련 상수·공용 조회.
실제 수집 대상은 market_series 테이블에서 yf_symbol IS NOT NULL인 행을 조회해 사용.
"""
from typing import Final

from lib.db import get_client

HISTORY_YEARS: Final[int] = 5


def existing_trade_dates(series_code: str) -> set[str]:
  """market_series_daily 에 이미 적재된 날짜 — 백필 때 원천을 다시 열지 않으려고 쓴다.

  PostgREST 는 1000행 상한이라 .order() + .range() 로 넘긴다(AGENTS.md 「.range() 는 .order() 필수」).
  """
  client = get_client()
  dates: set[str] = set()
  page_size = 1000
  for page in range(20):
    res = client.table('market_series_daily').select('trade_date') \
      .eq('series_code', series_code).order('trade_date') \
      .range(page * page_size, (page + 1) * page_size - 1).execute()
    batch = res.data or []
    dates.update(r['trade_date'] for r in batch)
    if len(batch) < page_size:
      break
  return dates
