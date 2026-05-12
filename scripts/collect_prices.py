#!/usr/bin/env python3
"""
상장사(status=active AND market IS NOT NULL) 주가 일봉을 stock_prices에 upsert한다.
- country='KR' → pykrx (ticker 6자리 종목코드)
- country!='KR' → yfinance (ticker 거래소 접미사 포함)

대상 회사 목록은 companies.json이 아니라 DB에서 직접 조회한다.

수집 모드 (--mode):
- full         : 회사별 5년 전 ~ 오늘 (월 1회 백필용)
- incremental  : 회사별 MAX(trade_date)+1일 ~ 오늘. 데이터 없는 신규 종목은 full 폴백 (매일용)
기본값: incremental
"""
import argparse
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

from lib.db import get_client, upsert_rows

HISTORY_YEARS = 5
UPSERT_BATCH = 5000  # 한 회사씩 누적해 일정량마다 flush


def _sf(v) -> float | None:
  """float 변환 + NaN/Inf 방어."""
  try:
    f = float(v)
    return None if (math.isnan(f) or math.isinf(f)) else f
  except (TypeError, ValueError):
    return None


def _load_listed_companies() -> list[dict]:
  """status='active' AND market IS NOT NULL인 회사 목록을 country/name 정렬 순으로 반환."""
  client = get_client()
  # postgrest는 not.is.null 표현이 .not_.is_(...) 형태
  result = (
    client.table('companies')
    .select('id,ticker,name_kr,country,market')
    .eq('status', 'active')
    .not_.is_('market', 'null')
    .order('country')
    .order('name_kr')
    .execute()
  )
  return result.data


def _load_max_trade_date(company_id: str) -> str | None:
  """단일 회사의 stock_prices.MAX(trade_date)를 ISO 문자열로 반환. 없으면 None."""
  client = get_client()
  res = (
    client.table('stock_prices')
    .select('trade_date')
    .eq('company_id', company_id)
    .order('trade_date', desc=True)
    .limit(1)
    .execute()
  )
  if res.data:
    return res.data[0]['trade_date']
  return None


def _resolve_range(company_id: str, mode: str, full_start: str, end_str: str) -> tuple[str, str] | None:
  """수집 모드에 따라 회사별 (start, end) 결정. None 반환 시 스킵."""
  if mode == 'full':
    return full_start, end_str
  # incremental: max(trade_date) + 1일 ~ 오늘
  max_d = _load_max_trade_date(company_id)
  if max_d is None:
    return full_start, end_str  # 신규 종목 → 5년 fallback
  next_day = (date.fromisoformat(max_d) + timedelta(days=1)).isoformat()
  if next_day > end_str:
    return None  # 이미 최신
  return next_day, end_str


def _flush(rows: list[dict]) -> int:
  """누적된 rows를 stock_prices에 upsert하고 비운다. 처리된 행 수 반환."""
  if not rows:
    return 0
  upsert_rows('stock_prices', rows, 'company_id,trade_date')
  n = len(rows)
  rows.clear()
  return n


def _collect_kr(company: dict, start: str, end: str) -> list[dict]:
  """pykrx로 KR 1개 종목의 일봉을 반환."""
  ticker = company['ticker']
  start_pykrx = start.replace('-', '')
  end_pykrx = end.replace('-', '')
  rows: list[dict] = []
  try:
    df = pykrx_stock.get_market_ohlcv(start_pykrx, end_pykrx, ticker)
    if df.empty:
      logger.warning(f"KR {ticker} ({company['name_kr']}): pykrx 데이터 없음")
      return rows
    for dt, row in df.iterrows():
      close_val = row.get('종가')
      if close_val is None:
        continue
      rows.append({
        'company_id': company['id'],
        'trade_date': dt.date().isoformat() if hasattr(dt, 'date') else str(dt),
        'open': float(row.get('시가', 0)) or None,
        'high': float(row.get('고가', 0)) or None,
        'low': float(row.get('저가', 0)) or None,
        'close': float(close_val),
        'adj_close': None,
        'volume': int(row.get('거래량', 0)) or None,
      })
    logger.info(f"KR {ticker} ({company['name_kr']}): {len(rows)}행")
  except Exception as e:
    logger.error(f"KR {ticker} 수집 실패: {e}")
  return rows


def _collect_overseas(company: dict, start: str, end: str) -> list[dict]:
  """yfinance로 해외 1개 종목의 일봉을 반환."""
  ticker = company['ticker']
  rows: list[dict] = []
  try:
    hist = yf.Ticker(ticker).history(start=start, end=end, auto_adjust=True)
    if hist.empty:
      logger.warning(f"해외 {ticker} ({company['name_kr']}): yfinance 데이터 없음")
      return rows
    for dt, row in hist.iterrows():
      close_val = _sf(row.get('Close'))
      if close_val is None:
        continue
      vol_raw = row.get('Volume')
      vol = None
      if vol_raw is not None:
        try:
          if not math.isnan(float(vol_raw)):
            vol = int(vol_raw)
        except (TypeError, ValueError):
          pass
      rows.append({
        'company_id': company['id'],
        'trade_date': dt.date().isoformat() if hasattr(dt, 'date') else str(dt),
        'open': _sf(row.get('Open')),
        'high': _sf(row.get('High')),
        'low': _sf(row.get('Low')),
        'close': close_val,
        'adj_close': close_val,  # auto_adjust=True → 이미 수정주가
        'volume': vol,
      })
    logger.info(f"해외 {ticker} ({company['name_kr']}): {len(rows)}행")
  except Exception as e:
    logger.error(f"해외 {ticker} 수집 실패: {e}")
  return rows


def collectPrices(mode: str = 'incremental') -> None:
  """상장사 주가 일봉을 수집해 stock_prices에 upsert한다.

  Args:
    mode: 'full'이면 회사별 5년치, 'incremental'이면 MAX(trade_date)+1일부터 오늘까지.
  """
  end = date.today()
  full_start = (end - timedelta(days=HISTORY_YEARS * 365)).isoformat()
  end_str = end.isoformat()

  logger.info(f"주가 수집 모드: {mode} (full 기준 {full_start} ~ {end_str})")

  companies = _load_listed_companies()
  kr = [c for c in companies if c.get('country') == 'KR']
  overseas = [c for c in companies if c.get('country') != 'KR']
  logger.info(f"상장사 대상: 총 {len(companies)}개 (KR {len(kr)} + 해외 {len(overseas)})")

  buffer: list[dict] = []
  total = 0
  ok_count = 0
  fail_count = 0
  skip_count = 0

  def process(company: dict, collect_fn) -> None:
    nonlocal total, ok_count, fail_count, skip_count
    rng = _resolve_range(company['id'], mode, full_start, end_str)
    if rng is None:
      skip_count += 1
      return
    rows = collect_fn(company, rng[0], rng[1])
    if rows:
      buffer.extend(rows)
      ok_count += 1
    else:
      fail_count += 1
    if len(buffer) >= UPSERT_BATCH:
      total += _flush(buffer)

  for company in kr:
    process(company, _collect_kr)
  for company in overseas:
    process(company, _collect_overseas)

  total += _flush(buffer)
  logger.info(
    f"주가 수집 완료 — {total}행 / 성공 {ok_count} / 실패 {fail_count} / 스킵(최신) {skip_count}"
  )


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='상장사 주가 일봉 수집')
  parser.add_argument(
    '--mode', choices=['full', 'incremental'], default='incremental',
    help='full: 5년치 전체, incremental: 마지막 수집 다음날부터 (기본값: incremental)'
  )
  args = parser.parse_args()
  try:
    collectPrices(mode=args.mode)
  except Exception as e:
    logger.error(f"주가 히스토리 수집 실패: {e}")
    sys.exit(1)
