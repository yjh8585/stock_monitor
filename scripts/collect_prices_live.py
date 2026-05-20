#!/usr/bin/env python3
"""
21개사 현재가를 수집해 companies 테이블의
last_price / last_change_pct / last_volume / last_updated_at / market_cap을 갱신한다.
- KR 8개사: pykrx 당일 OHLCV + 시가총액 (보통주 기준, KRX 공식)
- 글로벌 13개사: yfinance fast_info (시총은 collect_global_snapshot.py 담당, 여기서는 미갱신)
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf
from dotenv import load_dotenv
from loguru import logger
from pykrx import stock as pykrx_stock

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.companies import get_global_companies, get_kr_companies
from lib.db import get_client

# pykrx 시총은 KRW 원 단위 — DB 표준은 KRW 억원
EOK = 100_000_000


def _update_company(
  ticker: str,
  price: float,
  change_pct: float | None,
  volume: int | None,
  market_cap_eok: float | None = None,
) -> None:
  """companies 테이블의 현재가·시총 관련 필드를 갱신한다."""
  client = get_client()
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

  client.table('companies').update(payload).eq('ticker', ticker).execute()


def _collect_kr_live() -> int:
  """pykrx로 KR 8개사 현재가·시총을 수집해 갱신한다. 처리 성공 건수를 반환한다."""
  today_str = datetime.now().strftime('%Y%m%d')
  count = 0

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
      try:
        cap_df = pykrx_stock.get_market_cap(today_str, today_str, ticker)
        if not cap_df.empty:
          raw = float(cap_df.iloc[-1].get('시가총액', 0))
          if raw > 0:
            market_cap_eok = round(raw / EOK, 2)
      except Exception as e:
        logger.warning(f"KR {ticker} 시가총액 수집 실패(가격은 갱신 진행): {e}")

      _update_company(ticker, price, change_pct, volume, market_cap_eok)
      logger.debug(
        f"KR {ticker}: {price:,.0f}원 ({change_pct:+.2f}%) "
        f"market_cap={market_cap_eok}억원"
      )
      count += 1
    except Exception as e:
      logger.error(f"KR {ticker} 현재가 수집 실패: {e}")

  return count


def _collect_global_live() -> int:
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
      _update_company(ticker, float(price), change_pct, int(volume) if volume else None)
      logger.debug(f"글로벌 {ticker}: {price:.4f} ({f'{change_pct:+.2f}%' if change_pct is not None else 'N/A'})")
      count += 1
    except Exception as e:
      logger.error(f"글로벌 {ticker} 현재가 수집 실패: {e}")

  return count


def collectPricesLive() -> None:
  """21개사 현재가를 수집해 companies 테이블을 갱신한다."""
  kr_count = _collect_kr_live()
  global_count = _collect_global_live()
  logger.info(f"현재가 갱신 완료 — KR {kr_count}개 + 글로벌 {global_count}개")


if __name__ == '__main__':
  try:
    collectPricesLive()
  except Exception as e:
    logger.error(f"현재가 수집 실패: {e}")
    sys.exit(1)
