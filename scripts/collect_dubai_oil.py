#!/usr/bin/env python3
"""
두바이 원유(DUBAI) 시계열 수집기.

- 소스: FRED `POILDUBUSDM` (IMF Primary Commodity Prices, Dubai Crude, USD/bbl, 월별)
- 일별 데이터는 무료 공개 소스가 없어 월별로 백필 (월말일을 trade_date로 저장).
- 적재 성공 시 market_series.source / label / unit을 실제 값으로 갱신.
"""
import calendar
import io
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows
from lib.series_sources import (
  BACKFILL_YEARS,
  DUBAI_FRED_SYMBOL,
  DUBAI_LABEL,
  DUBAI_SOURCE,
  DUBAI_UNIT,
  FRED_CSV_URL,
)


def _monthStartToEnd(month_start: date) -> date:
  """YYYY-MM-01 → 해당 월 마지막 일자(일별 캘린더 기준)."""
  last_day = calendar.monthrange(month_start.year, month_start.month)[1]
  return date(month_start.year, month_start.month, last_day)


def fetchDubaiMonthly(start: date, end: date) -> list[dict]:
  """FRED CSV에서 두바이 월별 USD/bbl 시계열을 받아 market_series_daily 행으로 변환."""
  params = {'id': DUBAI_FRED_SYMBOL, 'cosd': start.isoformat(), 'coed': end.isoformat()}
  try:
    resp = requests.get(FRED_CSV_URL, params=params, timeout=30)
    resp.raise_for_status()
  except Exception as e:
    logger.error(f"FRED 호출 실패 — {e}")
    return []

  df = pd.read_csv(io.StringIO(resp.text))
  if df.empty or len(df.columns) < 2:
    logger.warning("FRED 응답이 비어 있음")
    return []

  date_col, val_col = df.columns[0], df.columns[1]
  rows: list[dict] = []
  for _, r in df.iterrows():
    raw = r[val_col]
    if raw is None or str(raw).strip() in ('.', '', 'nan'):
      continue
    try:
      val = float(raw)
    except (TypeError, ValueError):
      continue
    # FRED는 월별 시리즈를 'YYYY-MM-01'로 표기 → 가시성을 위해 월말일로 저장
    month_start = date.fromisoformat(str(r[date_col])[:10])
    trade_date = _monthStartToEnd(month_start)
    rows.append({
      'series_code': 'DUBAI',
      'trade_date': trade_date.isoformat(),
      'close': val,
    })
  return rows


def _updateSeriesMeta() -> None:
  """DUBAI 메타(source/label/unit) 갱신."""
  client = get_client()
  try:
    client.table('market_series') \
      .update({'source': DUBAI_SOURCE, 'label': DUBAI_LABEL, 'unit': DUBAI_UNIT}) \
      .eq('series_code', 'DUBAI') \
      .execute()
    logger.info(f"market_series.DUBAI 메타 갱신 (source={DUBAI_SOURCE})")
  except Exception as e:
    logger.warning(f"DUBAI 메타 갱신 실패: {e}")


def collectDubaiOil() -> None:
  """FRED POILDUBUSDM 5년 백필 → market_series_daily upsert."""
  end = date.today()
  start = end - timedelta(days=BACKFILL_YEARS * 365)
  logger.info(f"DUBAI 수집 시작 (FRED {DUBAI_FRED_SYMBOL}, {start} ~ {end})")

  rows = fetchDubaiMonthly(start, end)
  if not rows:
    logger.error("DUBAI: 적재할 데이터 없음")
    sys.exit(1)

  upsert_rows('market_series_daily', rows, 'series_code,trade_date')
  _updateSeriesMeta()
  logger.info(f"DUBAI 수집 완료 — {len(rows)}행 upsert")


if __name__ == '__main__':
  try:
    collectDubaiOil()
  except Exception as e:
    logger.error(f"DUBAI 수집 실패: {e}")
    sys.exit(1)
