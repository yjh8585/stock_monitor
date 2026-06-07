#!/usr/bin/env python3
"""
한세 4종목(016450/105630/069640/053280)의 일별 투자자별 매매동향을 pykrx로 수집해
stock_supply_demand 테이블에 upsert한다.

- 외국인합계 → foreign_net
- 기관합계   → institution_net
- 개인       → individual_net
- program_net은 pykrx에 종목 단위 함수가 없어 None (현재 보강 경로 없음)

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

from lib.krx_auth import disable_pykrx_autologin, ensure_krx_login

# .env를 먼저 로드해 KRX_ID/KRX_PW를 환경에 올린 뒤, pykrx import 전에 자동 로그인을 끈다.
# pykrx의 import-time 자동 로그인은 KRX가 GHA IP에 간헐적으로 빈 응답을 줄 때 import
# 전체(=수급 수집)를 죽인다(상세는 lib/krx_auth). 수집 직전 ensure_krx_login으로 직접 로그인.
load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

disable_pykrx_autologin()

from pykrx import stock as pykrx_stock

from lib.db import get_client, upsert_rows

HANSAE_TICKERS = ['016450', '105630', '069640', '053280']
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
  if mode == 'intraday':
    # 장중 cron — 오늘만 강제 재수집(KRX 잠정값을 매 5분 덮어쓰기)
    return end_str, end_str
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


def _pick_float(row, *names):
  """row에서 첫 매칭되는 컬럼 값을 float으로 반환. NaN/변환 실패면 None."""
  for n in names:
    if n in row.index:
      try:
        v = row[n]
        f = float(v)
        return f if f == f else None  # NaN guard
      except (TypeError, ValueError):
        return None
  return None


def _load_ohlcv_map(ticker: str, start_pykrx: str, end_pykrx: str) -> dict:
  """trade_date(ISO) → {close, change_pct} 매핑.
  pykrx OHLCV가 실패해도 수급 수집 자체는 진행되도록 빈 dict 반환."""
  try:
    df = pykrx_stock.get_market_ohlcv_by_date(start_pykrx, end_pykrx, ticker)
  except Exception as e:
    logger.warning(f"{ticker} OHLCV 조회 실패 (수급은 계속): {e}")
    return {}
  if df is None or df.empty:
    return {}
  out: dict = {}
  for dt, row in df.iterrows():
    key = dt.date().isoformat() if hasattr(dt, 'date') else str(dt)
    out[key] = {
      'close_price': _pick_float(row, '종가'),
      'change_pct': _pick_float(row, '등락률'),
    }
  return out


def collectSupplyDemand(mode: str = 'incremental') -> None:
  today = date.today()
  # 수급 수집은 전적으로 KRX에 의존하므로 로그인 실패 시 DB 접근 없이 조기 종료한다.
  if not ensure_krx_login():
    logger.warning("수급 수집을 건너뜁니다(다음 실행에서 재시도).")
    return
  companies = _load_hansae_companies()
  logger.info(f"수급 수집 모드: {mode}, 종목 {len(companies)}개")

  # intraday 모드: 분 단위 스냅샷 timestamp (모든 종목 동일 ts)
  from datetime import datetime as _dt, timezone as _tz, timedelta as _td
  snapshot_ts = (
    _dt.now(_tz(_td(hours=9))).replace(second=0, microsecond=0).isoformat()
    if mode == 'intraday'
    else None
  )

  total_rows = 0
  intraday_snapshots: list[dict] = []
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
      ohlcv_map = _load_ohlcv_map(company['ticker'], start_pykrx, end_pykrx)
      rows = []
      for dt, row in df.iterrows():
        trade_date = dt.date().isoformat() if hasattr(dt, 'date') else str(dt)
        px = ohlcv_map.get(trade_date, {})
        rows.append({
          'company_id': company['id'],
          'trade_date': trade_date,
          'foreign_net': _pick(row, '외국인합계', '외국인'),
          'institution_net': _pick(row, '기관합계'),
          'individual_net': _pick(row, '개인'),
          'program_net': None,
          'close_price': px.get('close_price'),
          'change_pct': px.get('change_pct'),
        })
      if rows:
        upsert_rows('stock_supply_demand', rows, 'company_id,trade_date')
        total_rows += len(rows)
        logger.info(f"{company['ticker']} ({company['name_kr']}): {len(rows)}행 upsert")
        # intraday: 오늘 행의 잠정 누적값을 시간별 스냅샷으로 보존
        if mode == 'intraday' and snapshot_ts:
          for r in rows:
            if r['trade_date'] == today.isoformat():
              intraday_snapshots.append({
                'company_id': r['company_id'],
                'snapshot_ts': snapshot_ts,
                'trade_date': r['trade_date'],
                'foreign_net': r['foreign_net'],
                'institution_net': r['institution_net'],
                'individual_net': r['individual_net'],
              })
    except Exception as e:
      logger.error(f"{company['ticker']} 수급 수집 실패: {e}")

  if intraday_snapshots:
    upsert_rows('stock_supply_demand_intraday', intraday_snapshots, 'company_id,snapshot_ts')
    logger.info(f"장중 스냅샷: {len(intraday_snapshots)}건 upsert (ts={snapshot_ts})")

  logger.info(f"수급 수집 완료 — 총 {total_rows}행")


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='한세 3종목 수급 수집')
  parser.add_argument(
    '--mode', choices=['full', 'incremental', 'intraday'], default='incremental',
    help='full: 30일치, incremental: 마지막 수집 다음날부터(기본), intraday: 오늘만 매 5분 갱신'
  )
  args = parser.parse_args()
  try:
    collectSupplyDemand(mode=args.mode)
  except Exception as e:
    logger.error(f"수급 수집 실패: {e}")
    sys.exit(1)
