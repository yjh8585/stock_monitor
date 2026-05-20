#!/usr/bin/env python3
"""
한세 4종목(016450/105630/069640/053280)의 당일 분봉을 KIS OpenAPI로 받아
stock_quotes_5min 테이블에 upsert한다.

TR: FHKST03010200 (주식당일분봉조회)
- 1회 호출 ≤ 30건. 09:00 ~ 현재 시각까지 받으려면 시각을 슬라이딩하며 반복 조회.
- 기존 `lib.kis_client.KisClient.get_minute_bars()`를 그대로 사용.

수집 모드 (--mode):
- today : 오늘 거래일 (기본, cron용)
- date  : --date YYYY-MM-DD 지정일
"""
import argparse
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows
from lib.kis_client import KisClient

HANSAE_TICKERS = ['016450', '105630', '069640', '053280']
KST = timezone(timedelta(hours=9))


def _load_hansae_companies() -> list[dict[str, Any]]:
  client = get_client()
  res = (
    client.table('companies')
    .select('id,ticker,name_kr')
    .in_('ticker', HANSAE_TICKERS)
    .execute()
  )
  return res.data


def _load_prev_close(company_id: str, target_date: date) -> float | None:
  """target_date 이전 가장 가까운 거래일 종가 (등락률 계산용)."""
  client = get_client()
  res = (
    client.table('stock_daily_prices')
    .select('close_price')
    .eq('company_id', company_id)
    .lt('trade_date', target_date.isoformat())
    .order('trade_date', desc=True)
    .limit(1)
    .execute()
  )
  if res.data and res.data[0].get('close_price') is not None:
    return float(res.data[0]['close_price'])
  return None


def _to_int(v: Any) -> int | None:
  if v is None or v == '':
    return None
  try:
    return int(float(v))
  except (TypeError, ValueError):
    return None


def _to_float(v: Any) -> float | None:
  if v is None or v == '':
    return None
  try:
    return float(v)
  except (TypeError, ValueError):
    return None


def _fetch_intraday(kis: KisClient, ticker: str, target_date: date) -> list[dict[str, Any]]:
  """target_date의 09:00 ~ 종료시각까지 분봉을 모두 수집해 [{ts, price, volume}] 반환."""
  now_kst = datetime.now(KST)
  is_today = target_date == now_kst.date()
  end_dt = now_kst if is_today else now_kst.replace(hour=16, minute=0, second=0)

  rows: list[dict[str, Any]] = []
  seen_ts: set[str] = set()
  cur_hhmmss = end_dt.strftime('%H%M%S')
  prev_oldest: str | None = None

  for _iter in range(20):
    try:
      data = kis.get_minute_bars(ticker, end_hhmmss=cur_hhmmss, include_past_data=False)
    except RuntimeError as e:
      # KIS EGW00201 (초당 거래건수 초과): 잠시 대기 후 1회 재시도
      if 'EGW00201' in str(e):
        logger.warning(f'{ticker} {cur_hhmmss}: KIS 초당 한도 — 1.2s 대기 후 재시도')
        time.sleep(1.2)
        data = kis.get_minute_bars(ticker, end_hhmmss=cur_hhmmss, include_past_data=False)
      else:
        raise
    chunk = data.get('output2') or []
    if not isinstance(chunk, list) or not chunk:
      break

    oldest_hhmmss: str | None = None
    for r in chunk:
      bsop_date = r.get('stck_bsop_date')
      hhmmss = r.get('stck_cntg_hour')
      if not bsop_date or not hhmmss:
        continue
      if bsop_date != target_date.strftime('%Y%m%d'):
        continue
      try:
        dt = datetime.strptime(f'{bsop_date}{hhmmss}', '%Y%m%d%H%M%S').replace(tzinfo=KST)
      except ValueError:
        continue
      ts_iso = dt.isoformat()
      if ts_iso in seen_ts:
        continue
      close = _to_float(r.get('stck_prpr'))
      volume = _to_int(r.get('cntg_vol'))
      if close is None:
        continue
      rows.append({'ts': ts_iso, 'price': close, 'volume': volume})
      seen_ts.add(ts_iso)
      if oldest_hhmmss is None or hhmmss < oldest_hhmmss:
        oldest_hhmmss = hhmmss

    if not oldest_hhmmss or oldest_hhmmss == prev_oldest:
      break
    try:
      oldest_dt = datetime.strptime(oldest_hhmmss, '%H%M%S') - timedelta(seconds=1)
      cur_hhmmss = oldest_dt.strftime('%H%M%S')
    except ValueError:
      break
    if cur_hhmmss <= '085959':
      break
    prev_oldest = oldest_hhmmss
    time.sleep(0.15)  # KIS 분당 한도 여유

  rows.sort(key=lambda r: r['ts'])
  return rows


def collectKisIntraday(mode: str = 'today', target_date: date | None = None) -> None:
  kis = KisClient.from_env()
  companies = _load_hansae_companies()
  logger.info(f'KIS 분봉 수집 모드: {mode}, 종목 {len(companies)}개')

  if mode == 'today':
    targets = [datetime.now(KST).date()]
  else:
    if target_date is None:
      logger.error('--mode date 는 --date YYYY-MM-DD 필요')
      sys.exit(1)
    targets = [target_date]

  total_rows = 0
  for ci, company in enumerate(companies):
    ticker = company['ticker']
    if ci > 0:
      time.sleep(1.0)  # 종목 사이 여유 (KIS 분당 한도 보호)
    for d in targets:
      try:
        rows = _fetch_intraday(kis, ticker, d)
      except Exception as e:
        logger.warning(f'{ticker} {d}: KIS fetch 실패 — {e}')
        continue
      if not rows:
        logger.debug(f'{ticker} {d}: 빈 응답')
        continue

      prev_close = _load_prev_close(company['id'], d)
      payload = []
      for r in rows:
        change_pct = None
        if prev_close and prev_close > 0:
          change_pct = (r['price'] - prev_close) / prev_close * 100
        payload.append({
          'company_id': company['id'],
          'ts': r['ts'],
          'price': r['price'],
          'change_pct': change_pct,
          'volume': r['volume'],
        })
      for i in range(0, len(payload), 500):
        upsert_rows('stock_quotes_5min', payload[i:i + 500], 'company_id,ts')
      total_rows += len(payload)
      logger.info(f"{ticker} ({company['name_kr']}) {d}: {len(payload)}건 upsert")

  logger.info(f'KIS 분봉 수집 완료 — 총 {total_rows}건')


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='한세 4종목 KIS 분봉 수집')
  parser.add_argument('--mode', choices=['today', 'date'], default='today')
  parser.add_argument('--date', type=str, help='--mode date 일 때 YYYY-MM-DD')
  args = parser.parse_args()

  tdate = None
  if args.date:
    try:
      tdate = date.fromisoformat(args.date)
    except ValueError:
      logger.error(f'잘못된 --date 형식: {args.date}')
      sys.exit(1)

  try:
    collectKisIntraday(mode=args.mode, target_date=tdate)
  except Exception as e:
    import traceback
    logger.error(f'KIS 분봉 수집 실패: {e}\n{traceback.format_exc()}')
    sys.exit(1)
