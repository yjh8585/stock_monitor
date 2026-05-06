#!/usr/bin/env python3
"""
21개사 5년 주가 일봉을 수집해 stock_prices 테이블에 upsert한다.
- KR 8개사: pykrx
- 글로벌 13개사: yfinance (active 종목만)
"""
import math
import sys
from datetime import date, timedelta
from pathlib import Path

import yfinance as yf
from dotenv import load_dotenv
from loguru import logger
from pykrx import stock as pykrx_stock

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.companies import get_global_companies, get_kr_companies
from lib.db import get_client, upsert_rows

HISTORY_YEARS = 5


def _sf(v) -> float | None:
  """float 변환 + NaN/Inf 방어."""
  try:
    f = float(v)
    return None if (math.isnan(f) or math.isinf(f)) else f
  except (TypeError, ValueError):
    return None


def _load_company_id_map() -> dict[str, str]:
  """DB에서 ticker → company_id 매핑을 로드한다."""
  result = get_client().table('companies').select('id,ticker').execute()
  return {row['ticker']: row['id'] for row in result.data}


def _collect_kr_prices(company_id_map: dict[str, str], start: str, end: str) -> list[dict]:
  """pykrx로 KR 8개사 일봉을 수집해 반환한다."""
  # pykrx는 YYYYMMDD 형식 사용
  start_pykrx = start.replace('-', '')
  end_pykrx = end.replace('-', '')
  rows = []

  for company in get_kr_companies():
    ticker = company['ticker']
    company_id = company_id_map.get(ticker)
    if not company_id:
      logger.warning(f"KR {ticker}: company_id 없음, 스킵")
      continue

    try:
      df = pykrx_stock.get_market_ohlcv(start_pykrx, end_pykrx, ticker)
      if df.empty:
        logger.warning(f"KR {ticker}: 데이터 없음")
        continue

      for dt, row in df.iterrows():
        close_val = row.get('종가')
        if close_val is None:
          continue
        rows.append({
          'company_id': company_id,
          'trade_date': dt.date().isoformat() if hasattr(dt, 'date') else str(dt),
          'open': float(row.get('시가', 0)) or None,
          'high': float(row.get('고가', 0)) or None,
          'low': float(row.get('저가', 0)) or None,
          'close': float(close_val),
          'adj_close': None,
          'volume': int(row.get('거래량', 0)) or None,
        })
      logger.info(f"KR {ticker} ({company['name_kr']}): {len(df)}행 수집")
    except Exception as e:
      logger.error(f"KR {ticker} 수집 실패: {e}")

  return rows


def _collect_global_prices(company_id_map: dict[str, str], start: str, end: str) -> list[dict]:
  """yfinance로 글로벌 active 종목 일봉을 수집해 반환한다."""
  rows = []

  for company in get_global_companies():
    if company['status'] != 'active':
      logger.debug(f"글로벌 {company['ticker']}: status={company['status']}, 스킵")
      continue

    ticker = company['ticker']
    company_id = company_id_map.get(ticker)
    if not company_id:
      logger.warning(f"글로벌 {ticker}: company_id 없음, 스킵")
      continue

    try:
      hist = yf.Ticker(ticker).history(start=start, end=end, auto_adjust=True)
      if hist.empty:
        logger.warning(f"글로벌 {ticker}: 데이터 없음")
        continue

      for dt, row in hist.iterrows():
        close_val = _sf(row.get('Close'))
        if close_val is None:
          continue
        rows.append({
          'company_id': company_id,
          'trade_date': dt.date().isoformat() if hasattr(dt, 'date') else str(dt),
          'open': _sf(row.get('Open')),
          'high': _sf(row.get('High')),
          'low': _sf(row.get('Low')),
          'close': close_val,
          'adj_close': close_val,  # yfinance auto_adjust=True → 이미 수정주가
          'volume': int(row.get('Volume')) if row.get('Volume') is not None and not math.isnan(float(row.get('Volume', 0))) else None,
        })
      logger.info(f"글로벌 {ticker} ({company['name_kr']}): {len(hist)}행 수집")
    except Exception as e:
      logger.error(f"글로벌 {ticker} 수집 실패: {e}")

  return rows


def collectPrices() -> None:
  """21개사 5년 주가 일봉을 수집해 stock_prices에 upsert한다."""
  end = date.today()
  start = end - timedelta(days=HISTORY_YEARS * 365)
  start_str = start.isoformat()
  end_str = end.isoformat()

  logger.info(f"주가 수집 기간: {start_str} ~ {end_str}")
  company_id_map = _load_company_id_map()

  kr_rows = _collect_kr_prices(company_id_map, start_str, end_str)
  global_rows = _collect_global_prices(company_id_map, start_str, end_str)
  all_rows = kr_rows + global_rows

  if not all_rows:
    logger.warning("수집된 주가 데이터 없음")
    return

  upsert_rows('stock_prices', all_rows, 'company_id,trade_date')
  logger.info(f"주가 히스토리 수집 완료 — 총 {len(all_rows)}행 (KR {len(kr_rows)} + 글로벌 {len(global_rows)})")


if __name__ == '__main__':
  try:
    collectPrices()
  except Exception as e:
    logger.error(f"주가 히스토리 수집 실패: {e}")
    sys.exit(1)
