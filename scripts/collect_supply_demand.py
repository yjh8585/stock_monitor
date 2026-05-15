#!/usr/bin/env python3
"""
한세 3종목(016450/105630/069640)의 일별 투자자별 매매동향을 pykrx로 수집해
stock_supply_demand 테이블에 upsert한다.

- 외국인합계 → foreign_net
- 기관합계   → institution_net
- 개인       → individual_net
- program_net은 pykrx에 종목 단위 함수가 없어 None (장중 키움 REST에서 보강)

수집 모드 (--mode):
- full         : 30일 전 ~ 오늘
- incremental  : 회사별 MAX(trade_date)+1일 ~ 오늘 (기본)
"""
import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger
from pykrx import stock as pykrx_stock

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows

HANSAE_TICKERS = ['016450', '105630', '069640']
FULL_DAYS = 30


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
    client.table('stock_supply_demand')
    .select('trade_date')
    .eq('company_id', company_id)
    .order('trade_date', desc=True)
    .limit(1)
    .execute()
  )
  return res.data[0]['trade_date'] if res.data else None


def _resolve_range(company_id: str, mode: str, today: date) -> tuple[str, str] | None:
  end_str = today.isoformat()
  if mode == 'full':
    return (today - timedelta(days=FULL_DAYS)).isoformat(), end_str
  max_d = _load_max_trade_date(company_id)
  if max_d is None:
    return (today - timedelta(days=FULL_DAYS)).isoformat(), end_str
  next_day = (date.fromisoformat(max_d) + timedelta(days=1)).isoformat()
  return None if next_day > end_str else (next_day, end_str)


def _pick(row, *names):
  """row에서 첫 매칭되는 컬럼 값을 int로 반환. 없거나 변환 실패면 None."""
  for n in names:
    if n in row.index:
      try:
        v = row[n]
        return int(v) if v == v else None  # NaN guard
      except (TypeError, ValueError):
        return None
  return None


def collectSupplyDemand(mode: str = 'incremental') -> None:
  today = date.today()
  companies = _load_hansae_companies()
  logger.info(f"수급 수집 모드: {mode}, 종목 {len(companies)}개")

  total_rows = 0
  for company in companies:
    rng = _resolve_range(company['id'], mode, today)
    if rng is None:
      logger.info(f"{company['ticker']} ({company['name_kr']}): 이미 최신, 스킵")
      continue
    start, end = rng
    start_pykrx = start.replace('-', '')
    end_pykrx = end.replace('-', '')
    try:
      df = pykrx_stock.get_market_trading_volume_by_date(
        start_pykrx, end_pykrx, company['ticker'], on='순매수'
      )
      if df.empty:
        logger.warning(f"{company['ticker']}: 수급 데이터 없음 ({start} ~ {end})")
        continue
      rows = []
      for dt, row in df.iterrows():
        rows.append({
          'company_id': company['id'],
          'trade_date': dt.date().isoformat() if hasattr(dt, 'date') else str(dt),
          'foreign_net': _pick(row, '외국인합계', '외국인'),
          'institution_net': _pick(row, '기관합계'),
          'individual_net': _pick(row, '개인'),
          'program_net': None,
        })
      if rows:
        upsert_rows('stock_supply_demand', rows, 'company_id,trade_date')
        total_rows += len(rows)
        logger.info(f"{company['ticker']} ({company['name_kr']}): {len(rows)}행 upsert")
    except Exception as e:
      logger.error(f"{company['ticker']} 수급 수집 실패: {e}")

  logger.info(f"수급 수집 완료 — 총 {total_rows}행")


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='한세 3종목 수급 수집')
  parser.add_argument(
    '--mode', choices=['full', 'incremental'], default='incremental',
    help='full: 30일치, incremental: 마지막 수집 다음날부터 (기본값)'
  )
  args = parser.parse_args()
  try:
    collectSupplyDemand(mode=args.mode)
  except Exception as e:
    logger.error(f"수급 수집 실패: {e}")
    sys.exit(1)
