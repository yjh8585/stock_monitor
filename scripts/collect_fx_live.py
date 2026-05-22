#!/usr/bin/env python3
"""
6개 통화쌍 현재 환율을 yfinance에서 수집해
exchange_rates_live 테이블을 갱신한다.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client
from lib.fx import FX_TICKERS, FX_CROSS_VIA_USD


def collectFxLive() -> None:
  """직접 환율 + USD cross-rate 통화의 현재 환율을 exchange_rates_live에 upsert한다."""
  client = get_client()
  now_iso = datetime.now(timezone.utc).isoformat()
  rows: list[dict] = []
  usd_krw: float | None = None

  # 1) 직접 환율 (X/KRW)
  for base, yf_ticker in FX_TICKERS.items():
    try:
      info = yf.Ticker(yf_ticker).fast_info
      rate = info.last_price
      if rate is None:
        logger.warning(f"{base}: last_price 없음, 스킵")
        continue
      rate = float(rate)
      rows.append({'base': base, 'quote': 'KRW', 'rate': rate, 'updated_at': now_iso})
      if base == 'USD':
        usd_krw = rate
      logger.debug(f"{base}/KRW = {rate:.4f}")
    except Exception as e:
      logger.error(f"{base} 현재 환율 수집 실패: {e}")

  # 2) USD를 경유한 cross-rate (1 X = USDKRW / USDX KRW)
  if usd_krw is None:
    logger.warning("USD/KRW 미수집 — VND 등 cross-rate 계산 불가")
  else:
    for base, cross_ticker in FX_CROSS_VIA_USD.items():
      try:
        info = yf.Ticker(cross_ticker).fast_info
        usd_per_x = info.last_price  # 1 USD = N base (예: 1 USD = 26320 VND)
        if not usd_per_x:
          logger.warning(f"{base}: cross-rate({cross_ticker}) 미수집, 스킵")
          continue
        rate = usd_krw / float(usd_per_x)
        rows.append({'base': base, 'quote': 'KRW', 'rate': rate, 'updated_at': now_iso})
        logger.debug(f"{base}/KRW = {rate:.6f} (cross via {cross_ticker}={usd_per_x})")
      except Exception as e:
        logger.error(f"{base} cross-rate 수집 실패: {e}")

  if not rows:
    logger.warning("수집된 환율 데이터 없음")
    return

  client.table('exchange_rates_live').upsert(rows, on_conflict='base,quote').execute()
  logger.info(f"환율 현재값 갱신 완료 — {len(rows)}개 통화쌍")

  # Next.js 캐시 무효화 — client.table().upsert()는 db.upsert_rows 자동 hook이 발화하지 않음
  try:
    from lib.revalidate import revalidate_for_tables
    revalidate_for_tables(['exchange_rates_live'])
  except Exception as e:
    logger.debug(f"  revalidate skip: {e}")


if __name__ == '__main__':
  try:
    collectFxLive()
  except Exception as e:
    logger.error(f"환율 현재값 수집 실패: {e}")
    sys.exit(1)
