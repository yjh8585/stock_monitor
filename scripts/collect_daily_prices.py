#!/usr/bin/env python3
"""
한세 3종목(016450/105630/069640)의 일별 OHLCV를 pykrx로 수집해
stock_daily_prices 테이블에 upsert한다.

수집 모드 (--mode):
- full         : 5년 전 ~ 오늘 (기본, --years로 기간 조정)
- incremental  : 회사별 MAX(trade_date)+1일 ~ 오늘
"""
import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from pykrx import stock as pykrx_stock

from lib.db import get_client, upsert_rows

HANSAE_TICKERS = ['016450', '105630', '069640', '053280']
DEFAULT_YEARS = 5


def _load_hansae_companies() -> list[dict]:
  client = get_client()
  res = (
    client.table('companies')
    .select('id,ticker,name_kr')
    .in_('ticker', HANSAE_TICKERS)
    .execute()
  )
  return res.data


def _load_max_trade_date(company_id: str) -> str | None:
  client = get_client()
  res = (
    client.table('stock_daily_prices')
    .select('trade_date')
    .eq('company_id', company_id)
    .order('trade_date', desc=True)
    .limit(1)
    .execute()
  )
  return res.data[0]['trade_date'] if res.data else None


def _resolve_range(company_id: str, mode: str, today: date, years: int) -> tuple[str, str] | None:
  end_str = today.isoformat()
  if mode == 'full':
    return (today - timedelta(days=years * 365 + 10)).isoformat(), end_str
  max_d = _load_max_trade_date(company_id)
  if max_d is None:
    return (today - timedelta(days=years * 365 + 10)).isoformat(), end_str
  next_day = (date.fromisoformat(max_d) + timedelta(days=1)).isoformat()
  return None if next_day > end_str else (next_day, end_str)


def _pick_float(row, *names):
  for n in names:
    if n in row.index:
      try:
        v = float(row[n])
        return v if v == v else None
      except (TypeError, ValueError):
        return None
  return None


def _pick_int(row, *names):
  for n in names:
    if n in row.index:
      try:
        v = int(row[n])
        return v if v == v else None
      except (TypeError, ValueError):
        return None
  return None


def collectDailyPrices(mode: str = 'incremental', years: int = DEFAULT_YEARS) -> None:
  today = date.today()
  companies = _load_hansae_companies()
  logger.info(f'일봉 수집 모드: {mode}, 기간: {years}년, 종목 {len(companies)}개')

  total_rows = 0
  for company in companies:
    rng = _resolve_range(company['id'], mode, today, years)
    if rng is None:
      logger.info(f"{company['ticker']} ({company['name_kr']}): 이미 최신, 스킵")
      continue
    start, end = rng
    start_pykrx = start.replace('-', '')
    end_pykrx = end.replace('-', '')
    try:
      df = pykrx_stock.get_market_ohlcv_by_date(start_pykrx, end_pykrx, company['ticker'])
      if df is None or df.empty:
        logger.warning(f"{company['ticker']}: OHLCV 없음 ({start} ~ {end})")
        continue
      rows = []
      for dt, row in df.iterrows():
        trade_date = dt.date().isoformat() if hasattr(dt, 'date') else str(dt)
        rows.append({
          'company_id': company['id'],
          'trade_date': trade_date,
          'open_price': _pick_float(row, '시가'),
          'high_price': _pick_float(row, '고가'),
          'low_price': _pick_float(row, '저가'),
          'close_price': _pick_float(row, '종가'),
          'volume': _pick_int(row, '거래량'),
          'change_pct': _pick_float(row, '등락률'),
        })
      if rows:
        # supabase upsert는 1000행 chunk가 무난
        for i in range(0, len(rows), 500):
          upsert_rows('stock_daily_prices', rows[i:i + 500], 'company_id,trade_date')
        total_rows += len(rows)
        logger.info(f"{company['ticker']} ({company['name_kr']}): {len(rows)}행 upsert ({start} ~ {end})")
    except Exception as e:
      logger.error(f"{company['ticker']} 일봉 수집 실패: {e}")

  logger.info(f'일봉 수집 완료 — 총 {total_rows}행')


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='한세 3종목 일별 OHLCV 수집')
  parser.add_argument(
    '--mode', choices=['full', 'incremental'], default='incremental',
    help='full: --years년치 백필, incremental: 마지막 수집 다음날부터 (기본값)'
  )
  parser.add_argument('--years', type=int, default=DEFAULT_YEARS, help='full 모드 기간 (년, 기본 5)')
  args = parser.parse_args()
  try:
    collectDailyPrices(mode=args.mode, years=args.years)
  except Exception as e:
    import traceback
    logger.error(f'일봉 수집 실패: {e}\n{traceback.format_exc()}')
    sys.exit(1)
