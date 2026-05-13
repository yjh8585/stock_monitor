#!/usr/bin/env python3
"""
6개 통화쌍(USD/EUR/GBP/JPY/HKD/CNY → KRW) 5년 일봉 환율을 수집해
exchange_rates 테이블에 upsert한다.
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import upsert_rows
from lib.fx import FX_TICKERS

HISTORY_YEARS = 5


def _fetchCloseSeries(yf_ticker: str, start: str, end: str) -> pd.Series | None:
  """yfinance 일봉 Close 시리즈(date → close)를 반환. 빈 응답이면 None.

  yf.download는 최신 버전에서 단일 ticker도 MultiIndex를 반환해 컬럼 처리가
  불안정하므로, 단순 컬럼을 보장하는 Ticker.history()를 사용한다.
  """
  df = yf.Ticker(yf_ticker).history(start=start, end=end, auto_adjust=True)
  if df.empty:
    return None
  close = df['Close'] if 'Close' in df.columns else df.iloc[:, 0]
  if isinstance(close, pd.DataFrame):
    close = close.iloc[:, 0]
  return close.dropna()


def _seriesToRows(base: str, series: pd.Series) -> list[dict]:
  """Close 시리즈를 exchange_rates 행 목록으로 변환."""
  rows = []
  for dt, rate in series.items():
    if rate is None or pd.isna(rate):
      continue
    rows.append({
      'base': base,
      'quote': 'KRW',
      'rate_date': dt.date().isoformat() if hasattr(dt, 'date') else str(dt),
      'rate': float(rate),
    })
  return rows


def _fetch_fx_history(base: str, yf_ticker: str, start: str, end: str) -> list[dict]:
  """yfinance로 환율 일봉을 수집한다. 직접 ticker 결측 시 USD 크로스레이트로 폴백."""
  series = _fetchCloseSeries(yf_ticker, start, end)
  if series is not None and not series.empty:
    return _seriesToRows(base, series)

  # 폴백: 1 USD = X base 의 USD 크로스 ticker로 base/KRW = USDKRW/USDbase 산출
  cross_ticker = f'USD{base}=X'
  if base == 'USD':
    logger.warning(f"{base}: 데이터 없음 ({yf_ticker})")
    return []
  logger.warning(f"{base}/KRW yfinance 결측 — USD 크로스레이트({cross_ticker})로 폴백")
  usdkrw = _fetchCloseSeries('USDKRW=X', start, end)
  usdbase = _fetchCloseSeries(cross_ticker, start, end)
  if usdkrw is None or usdbase is None or usdkrw.empty or usdbase.empty:
    logger.warning(f"{base}/KRW: 크로스레이트 산출 실패")
    return []
  # 날짜 교집합 + USDbase가 0 아닌 지점만
  combined = pd.concat([usdkrw, usdbase], axis=1, keys=['usdkrw', 'usdbase']).dropna()
  combined = combined[combined['usdbase'] != 0]
  cross = combined['usdkrw'] / combined['usdbase']
  return _seriesToRows(base, cross)


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
