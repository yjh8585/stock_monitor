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
from lib.fx import FX_TICKERS


def collectFxLive() -> None:
  """6개 통화쌍 현재 환율을 수집해 exchange_rates_live를 upsert한다."""
  client = get_client()
  rows = []

  for base, yf_ticker in FX_TICKERS.items():
    try:
      info = yf.Ticker(yf_ticker).fast_info
      rate = info.last_price
      if rate is None:
        logger.warning(f"{base}: last_price 없음, 스킵")
        continue
      rows.append({
        'base': base,
        'quote': 'KRW',
        'rate': float(rate),
        'updated_at': datetime.now(timezone.utc).isoformat(),
      })
      logger.debug(f"{base}/KRW = {rate:.4f}")
    except Exception as e:
      logger.error(f"{base} 현재 환율 수집 실패: {e}")

  if not rows:
    logger.warning("수집된 환율 데이터 없음")
    return

  client.table('exchange_rates_live').upsert(rows, on_conflict='base,quote').execute()
  logger.info(f"환율 현재값 갱신 완료 — {len(rows)}개 통화쌍")


if __name__ == '__main__':
  try:
    collectFxLive()
  except Exception as e:
    logger.error(f"환율 현재값 수집 실패: {e}")
    sys.exit(1)
