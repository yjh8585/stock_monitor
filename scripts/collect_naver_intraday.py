#!/usr/bin/env python3
"""
한세 3종목(016450/105630/069640)의 분 단위 체결 시세를 네이버 금융 차트 API로 수집해
stock_quotes_5min 테이블에 upsert한다.

API: https://api.finance.naver.com/siseJson.naver?symbol={ticker}&requestType=1
     &startTime=YYYYMMDD&endTime=YYYYMMDD&timeframe=minute

응답 형식 (Python literal):
  [['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],
   ["202605151550", null, null, null, 1613, 1464783, null], ...]
시가/고가/저가는 분 단위에서 null로 옴 — 분당 마지막 체결가만 종가에 표시.
volume은 그날 누적 거래량.

수집 모드 (--mode):
- today        : 오늘 거래일분 (기본, cron용)
- date         : --date YYYY-MM-DD 지정일 1일치
- backfill     : --days N (기본 5)일 백필
"""
import argparse
import ast
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows

HANSAE_TICKERS = ['016450', '105630', '069640', '053280']
KST = timezone(timedelta(hours=9))
HEADERS = {
  'User-Agent': (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
  ),
  'Referer': 'https://finance.naver.com/',
}


def _load_hansae_companies() -> list[dict]:
  client = get_client()
  res = (
    client.table('companies')
    .select('id,ticker,name_kr')
    .in_('ticker', HANSAE_TICKERS)
    .execute()
  )
  return res.data


def _load_prev_close(ticker: str, target_date: date) -> float | None:
  """target_date 이전 가장 가까운 거래일 종가 (등락률 계산용)."""
  client = get_client()
  res = (
    client.table('companies')
    .select('id')
    .eq('ticker', ticker)
    .limit(1)
    .execute()
  )
  if not res.data:
    return None
  company_id = res.data[0]['id']
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


def _fetch_intraday(ticker: str, target_date: date) -> list[dict]:
  """네이버 차트 API에서 target_date의 분 단위 종가/거래량 시리즈를 dict 배열로 반환."""
  d = target_date.strftime('%Y%m%d')
  url = (
    f'https://api.finance.naver.com/siseJson.naver?symbol={ticker}'
    f'&requestType=1&startTime={d}&endTime={d}&timeframe=minute'
  )
  r = requests.get(url, headers=HEADERS, timeout=15)
  r.raise_for_status()
  text = r.text.strip()
  # 응답이 JS array literal — python literal_eval로 안전하게 파싱
  text = text.replace('null', 'None')
  try:
    data = ast.literal_eval(text)
  except (ValueError, SyntaxError) as e:
    logger.warning(f'{ticker} {target_date}: 파싱 실패 — {e}')
    return []
  if not data or len(data) < 2:
    return []
  rows = []
  for row in data[1:]:
    # ['YYYYMMDDHHMM', open, high, low, close, volume, foreign_pct]
    if len(row) < 6 or not row[0]:
      continue
    ts_str = str(row[0])
    if len(ts_str) != 12:
      continue
    try:
      dt = datetime.strptime(ts_str, '%Y%m%d%H%M').replace(tzinfo=KST)
    except ValueError:
      continue
    close = row[4]
    volume = row[5]
    if close is None:
      continue
    rows.append({
      'ts': dt.isoformat(),
      'price': float(close),
      'volume': int(volume) if volume is not None else None,
    })
  return rows


def collectNaverIntraday(
  mode: str = 'today',
  target_date: date | None = None,
  backfill_days: int = 5,
) -> None:
  companies = _load_hansae_companies()
  logger.info(f'분 단위 시세 수집 모드: {mode}, 종목 {len(companies)}개')

  if mode == 'today':
    targets = [datetime.now(KST).date()]
  elif mode == 'date':
    if target_date is None:
      logger.error('--mode date 는 --date YYYY-MM-DD 필요')
      sys.exit(1)
    targets = [target_date]
  else:  # backfill
    today = datetime.now(KST).date()
    targets = [today - timedelta(days=i) for i in range(backfill_days)]

  total_rows = 0
  for company in companies:
    ticker = company['ticker']
    for d in targets:
      try:
        rows = _fetch_intraday(ticker, d)
      except Exception as e:
        logger.warning(f'{ticker} {d}: fetch 실패 — {e}')
        continue
      if not rows:
        logger.debug(f'{ticker} {d}: 빈 응답')
        continue

      prev_close = _load_prev_close(ticker, d)
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
      # 1000개 chunk
      for i in range(0, len(payload), 500):
        upsert_rows('stock_quotes_5min', payload[i:i + 500], 'company_id,ts')
      total_rows += len(payload)
      logger.info(f"{ticker} ({company['name_kr']}) {d}: {len(payload)}건 upsert")

  logger.info(f'분 단위 시세 수집 완료 — 총 {total_rows}건')


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='한세 3종목 네이버 분 단위 시세 수집')
  parser.add_argument(
    '--mode', choices=['today', 'date', 'backfill'], default='today'
  )
  parser.add_argument('--date', type=str, help='--mode date 일 때 YYYY-MM-DD')
  parser.add_argument('--days', type=int, default=5, help='--mode backfill 기간 (기본 5일)')
  args = parser.parse_args()

  tdate = None
  if args.date:
    try:
      tdate = date.fromisoformat(args.date)
    except ValueError:
      logger.error(f'잘못된 --date 형식: {args.date}')
      sys.exit(1)

  try:
    collectNaverIntraday(mode=args.mode, target_date=tdate, backfill_days=args.days)
  except Exception as e:
    import traceback
    logger.error(f'분 단위 시세 수집 실패: {e}\n{traceback.format_exc()}')
    sys.exit(1)
