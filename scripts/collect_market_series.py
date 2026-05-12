#!/usr/bin/env python3
"""
market_series 메타에서 yf_symbol 또는 fred_symbol이 지정된 모든 시리즈의 5년 일봉을
각 데이터 소스(yfinance / FRED)에서 수집해 market_series_daily에 upsert한다.
환율 USD/EUR/CNY → KRW 5년 히스토리는 collect_fx.py가 exchange_rates에 별도 저장한다.
"""
import io
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows
from lib.market_series import HISTORY_YEARS

FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv'


def _fetchYfDaily(series_code: str, yf_symbol: str, start: str, end: str) -> list[dict]:
  """yfinance로 일봉 종가를 수집해 market_series_daily 행 목록을 반환한다."""
  df = yf.download(yf_symbol, start=start, end=end, progress=False, auto_adjust=True)
  if df.empty:
    logger.warning(f"{series_code}: yfinance 데이터 없음 ({yf_symbol})")
    return []

  # 단일 ticker라도 yfinance가 MultiIndex columns를 반환할 수 있음
  if isinstance(df.columns, pd.MultiIndex):
    df.columns = df.columns.get_level_values(0)

  close_col = df['Close'] if 'Close' in df.columns else df.iloc[:, 0]
  if isinstance(close_col, pd.DataFrame):
    close_col = close_col.iloc[:, 0]

  rows = []
  for dt, val in close_col.items():
    if val is None or pd.isna(val):
      continue
    rows.append({
      'series_code': series_code,
      'trade_date': dt.date().isoformat() if hasattr(dt, 'date') else str(dt),
      'close': float(val),
    })
  return rows


def _fetchFredDaily(series_code: str, fred_symbol: str, start: str, end: str) -> list[dict]:
  """FRED CSV(API 키 불필요)에서 일봉을 수집해 market_series_daily 행 목록을 반환한다."""
  params = {'id': fred_symbol, 'cosd': start, 'coed': end}
  resp = requests.get(FRED_CSV_URL, params=params, timeout=30)
  resp.raise_for_status()

  df = pd.read_csv(io.StringIO(resp.text))
  if df.empty or len(df.columns) < 2:
    logger.warning(f"{series_code}: FRED 데이터 없음 ({fred_symbol})")
    return []

  date_col, val_col = df.columns[0], df.columns[1]
  rows = []
  for _, r in df.iterrows():
    raw = r[val_col]
    # FRED는 결측을 '.'으로 표기
    if raw is None or str(raw).strip() in ('.', '', 'nan'):
      continue
    try:
      val = float(raw)
    except (TypeError, ValueError):
      continue
    rows.append({
      'series_code': series_code,
      'trade_date': str(r[date_col])[:10],
      'close': val,
    })
  return rows


def collectMarketSeries() -> None:
  """market_series의 yf_symbol/fred_symbol이 지정된 모든 시리즈를 수집·upsert한다."""
  end = date.today()
  start = end - timedelta(days=HISTORY_YEARS * 365)
  start_str = start.isoformat()
  end_str = end.isoformat()

  client = get_client()
  meta = client.table('market_series') \
    .select('series_code, yf_symbol, fred_symbol, label, source') \
    .order('sort_order') \
    .execute().data or []

  collectable = [r for r in meta if r.get('yf_symbol') or r.get('fred_symbol')]
  if not collectable:
    logger.warning("market_series 메타에 수집 대상이 없습니다. 시드를 먼저 적용하세요.")
    return

  total = 0
  for row in collectable:
    code = row['series_code']
    label = row.get('label', '')
    if row.get('yf_symbol'):
      sym = row['yf_symbol']
      logger.info(f"{code} ({label}) yfinance 수집 — {sym}")
      rows = _fetchYfDaily(code, sym, start_str, end_str)
    else:
      sym = row['fred_symbol']
      logger.info(f"{code} ({label}) FRED 수집 — {sym}")
      try:
        rows = _fetchFredDaily(code, sym, start_str, end_str)
      except Exception as e:
        logger.error(f"{code}: FRED 호출 실패 ({sym}) — {e}")
        rows = []

    if not rows:
      continue
    upsert_rows('market_series_daily', rows, 'series_code,trade_date')
    total += len(rows)
    logger.info(f"{code}: {len(rows)}행 upsert 완료")

  logger.info(f"market_series 수집 완료 — 총 {total}행")


if __name__ == '__main__':
  try:
    collectMarketSeries()
  except Exception as e:
    logger.error(f"market_series 수집 실패: {e}")
    sys.exit(1)
