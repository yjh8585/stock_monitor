#!/usr/bin/env python3
"""
21개사 현재가를 수집해 companies 테이블의
last_price / last_change_pct / last_volume / last_updated_at / market_cap을 갱신한다.
- KR 8개사: pykrx 당일 OHLCV + 시가총액 (보통주 기준, KRX 공식)
- 글로벌 13개사: yfinance fast_info (시총은 collect_global_snapshot.py 담당, 여기서는 미갱신)
"""
import sys
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import yfinance as yf
from dotenv import load_dotenv
from loguru import logger
from pykrx import stock as pykrx_stock

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.companies import get_global_companies, get_kr_companies
from lib.db import WriteSession

# pykrx 시총은 KRW 원 단위 — DB 표준은 KRW 억원
EOK = 100_000_000


@lru_cache(maxsize=1)
def _market_cap_by_ticker(date: str) -> dict[str, float]:
  """시장 전체 시가총액을 **하루 한 번** 받아 티커→원 단위로 매핑한다.

  종목 단위 `get_market_cap()` 이 죽었을 때의 대체 경로다(2026-09-16). 살아 있으면
  호출 수도 180회에서 1회로 줄어 이쪽이 낫다. 둘 다 죽으면 KRX 응답 형식이 바뀐
  것이므로 네이버 JSON API 를 대안으로 검토한다(계획서 Task 7).
  """
  try:
    df = pykrx_stock.get_market_cap_by_ticker(date, market='ALL')
  except Exception as e:
    logger.warning(f"시가총액 시장 전체 조회 실패: {e}")
    return {}
  if df.empty or '시가총액' not in df.columns:
    logger.warning("시가총액 시장 전체 조회가 빈 응답 — KRX 응답 형식 변경 의심")
    return {}
  caps = {str(t): float(v) for t, v in df['시가총액'].items() if v and float(v) > 0}
  logger.info(f"시가총액 시장 전체 조회 {len(caps)}종목 확보 (종목 단위 조회 대체)")
  return caps


class MarketCapBroken(Exception):
  """시가총액 조회가 **전면** 실패했다(부분 실패는 해당 없음).

  주가 갱신은 이미 DB 에 반영된 상태이므로, 이 예외는 「작업을 되돌리라」가 아니라
  「조용히 낡는 중이니 사람이 봐야 한다」는 신호다. 호출부가 글로벌 수집까지 마친 뒤
  exit 3 으로 끝낸다.
  """

  def __init__(self, ratio: str, updated: int) -> None:
    super().__init__(ratio)
    self.updated = updated


def _update_company(
  w,
  ticker: str,
  price: float,
  change_pct: float | None,
  volume: int | None,
  market_cap_eok: float | None = None,
) -> None:
  """companies 테이블의 현재가·시총 관련 필드를 갱신한다."""
  payload: dict = {
    'last_price': price,
    'last_updated_at': datetime.now(timezone.utc).isoformat(),
  }
  if change_pct is not None:
    payload['last_change_pct'] = change_pct
  if volume is not None:
    payload['last_volume'] = volume
  if market_cap_eok is not None:
    payload['market_cap'] = market_cap_eok

  w.table('companies').update(payload).eq('ticker', ticker).execute()


def _collect_kr_live(w) -> int:
  """pykrx로 KR 8개사 현재가·시총을 수집해 갱신한다. 처리 성공 건수를 반환한다.

  🔴 시가총액이 **조용히 낡는** 구조였다(2026-09-16 발견). 값이 없으면 갱신 payload 에서
     빠지므로 과거 값이 그대로 남는데, 주가는 정상 갱신되니 화면에서 구분되지 않는다.
     실측 당시 `market_cap=None` 이 179건인데 예외 로그는 0건이었다 — `cap_df.empty`
     경로에 로그가 없어서다. 그래서 빈 응답·0원에도 경고를 남기고, 전면 실패면 끝에서
     exit 3 으로 알린다.
  """
  today_str = datetime.now().strftime('%Y%m%d')
  count = 0
  cap_attempted = 0
  cap_failed = 0

  for company in get_kr_companies():
    ticker = company['ticker']
    try:
      df = pykrx_stock.get_market_ohlcv(today_str, today_str, ticker)
      if df.empty:
        logger.warning(f"KR {ticker}: 당일 데이터 없음 (휴장일 가능성)")
        continue

      row = df.iloc[-1]
      price = float(row.get('종가', 0))
      if not price:
        continue

      change_pct = float(row.get('등락률', 0))
      volume = int(row.get('거래량', 0)) or None

      # 시가총액 — 별도 API 호출. 보통주 기준(KRX 종목코드 단위) KRW 원 → 억원 변환
      market_cap_eok: float | None = None
      cap_attempted += 1
      try:
        cap_df = pykrx_stock.get_market_cap(today_str, today_str, ticker)
        raw = 0.0
        if not cap_df.empty:
          raw = float(cap_df.iloc[-1].get('시가총액', 0))
        if raw <= 0:
          # 예전에는 여기가 조용했다 — 빈 응답이 예외가 아니라서 실패로 안 잡혔고,
          # 값이 없으면 payload 에서 빠져 과거 값이 그대로 남았다.
          raw = _market_cap_by_ticker(today_str).get(str(ticker).zfill(6), 0.0)
        if raw > 0:
          market_cap_eok = round(raw / EOK, 2)
        else:
          logger.warning(f"KR {ticker} 시가총액 조회 실패 — 기존 값이 그대로 남는다")
          cap_failed += 1
      except Exception as e:
        logger.warning(f"KR {ticker} 시가총액 수집 실패(가격은 갱신 진행): {e}")
        cap_failed += 1

      _update_company(w, ticker, price, change_pct, volume, market_cap_eok)
      logger.debug(
        f"KR {ticker}: {price:,.0f}원 ({change_pct:+.2f}%) "
        f"market_cap={market_cap_eok}억원"
      )
      count += 1
    except Exception as e:
      logger.error(f"KR {ticker} 현재가 수집 실패: {e}")

  if cap_attempted and cap_failed > cap_attempted / 2:
    # 부분 실패는 넘어가되 **전면 실패는 알린다**. 조용히 두면 화면이 과거 시총을
    # 계속 보여 주고, 주가는 정상이라 아무도 눈치채지 못한다.
    logger.error(
      f"시가총액 전면 실패 {cap_failed}/{cap_attempted} — 화면은 과거 값을 계속 보여 준다. "
      f"pykrx get_market_cap 엔드포인트를 확인하라(2026-09-16 실사고)."
    )
    raise MarketCapBroken(f'{cap_failed}/{cap_attempted}', count)

  return count


def _collect_global_live(w) -> int:
  """yfinance로 글로벌 active 종목 현재가를 수집해 갱신한다. 처리 성공 건수를 반환한다."""
  count = 0

  for company in get_global_companies():
    if company['status'] != 'active':
      continue

    ticker = company['ticker']
    try:
      info = yf.Ticker(ticker).fast_info
      price = info.last_price
      if price is None:
        logger.warning(f"글로벌 {ticker}: last_price 없음")
        continue

      prev_close = info.previous_close
      change_pct = None
      if prev_close and prev_close != 0:
        change_pct = round((price - prev_close) / prev_close * 100, 4)

      volume = getattr(info, 'three_month_average_volume', None)
      _update_company(w, ticker, float(price), change_pct, int(volume) if volume else None)
      logger.debug(f"글로벌 {ticker}: {price:.4f} ({f'{change_pct:+.2f}%' if change_pct is not None else 'N/A'})")
      count += 1
    except Exception as e:
      logger.error(f"글로벌 {ticker} 현재가 수집 실패: {e}")

  return count


def collectPricesLive() -> None:
  """21개사 현재가를 수집해 companies 테이블을 갱신한다.

  시가총액이 전면 실패해도 **주가 갱신과 글로벌 수집은 끝까지 마치고**, 마지막에
  exit 3 으로 알린다(2026-09-16 — 조용한 실패로 179건이 과거 값에 멈춰 있었다).
  """
  cap_broken: MarketCapBroken | None = None
  with WriteSession() as w:
    try:
      kr_count = _collect_kr_live(w)
    except MarketCapBroken as e:
      cap_broken, kr_count = e, e.updated
    global_count = _collect_global_live(w)
  logger.info(f"현재가 갱신 완료 — KR {kr_count}개 + 글로벌 {global_count}개")
  # WriteSession.__exit__이 자동으로 revalidate_for_tables(['companies'])를 호출한다.
  if cap_broken:
    sys.exit(3)


if __name__ == '__main__':
  try:
    collectPricesLive()
  except Exception as e:
    logger.error(f"현재가 수집 실패: {e}")
    sys.exit(1)
