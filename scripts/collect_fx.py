#!/usr/bin/env python3
"""
6개 통화쌍(USD/EUR/GBP/JPY/HKD/CNY → KRW) 5년 일봉 환율을 수집해
exchange_rates 테이블에 upsert한다.
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import upsert_rows
from lib.fx import FX_TICKERS

HISTORY_YEARS = 5


def _fetch_fx_history(base: str, yf_ticker: str, start: str, end: str) -> list[dict]:
  """yfinance로 환율 일봉을 수집해 exchange_rates 형식 행 목록을 반환한다."""
  df = yf.download(yf_ticker, start=start, end=end, progress=False, auto_adjust=True)
  if df.empty:
    logger.warning(f"{base}: 데이터 없음 ({yf_ticker})")
    return []

  rows = []
  close_col = df['Close'] if 'Close' in df.columns else df.iloc[:, 0]
  for dt, rate in close_col.items():
    if rate is None or (hasattr(rate, '__float__') and str(rate) == 'nan'):
      continue
    rows.append({
      'base': base,
      'quote': 'KRW',
      'rate_date': dt.date().isoformat() if hasattr(dt, 'date') else str(dt),
      'rate': float(rate),
    })
  return rows


def collectFxHistory() -> None:
  """6개 통화쌍 5년 일봉 환율을 수집해 DB에 upsert한다."""
  end = date.today()
  start = end - timedelta(days=HISTORY_YEARS * 365)
  start_str = start.isoformat()
  end_str = end.isoformat()

  total = 0
  for base, yf_ticker in FX_TICKERS.items():
    logger.info(f"{base}/KRW 수집 시작 ({yf_ticker})")
    rows = _fetch_fx_history(base, yf_ticker, start_str, end_str)
    if not rows:
      continue
    upsert_rows('exchange_rates', rows, 'base,quote,rate_date')
    total += len(rows)
    logger.info(f"{base}/KRW: {len(rows)}행 upsert 완료")

  logger.info(f"환율 히스토리 수집 완료 — 총 {total}행")


if __name__ == '__main__':
  try:
    collectFxHistory()
  except Exception as e:
    logger.error(f"환율 히스토리 수집 실패: {e}")
    sys.exit(1)
