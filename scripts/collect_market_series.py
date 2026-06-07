#!/usr/bin/env python3
"""
market_series 메타에서 yf_symbol 또는 fred_symbol이 지정된 모든 시리즈의 5년 일봉을
각 데이터 소스(yfinance / FRED)에서 수집해 market_series_daily에 upsert한다.
환율 USD/EUR/CNY → KRW 5년 히스토리는 collect_fx.py가 exchange_rates에 별도 저장한다.
"""
import io
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

# pykrx는 import 시점에 KRX_ID/KRX_PW가 있으면 KRX에 자동 로그인한다. 그러나 KRX가
# GitHub Actions IP에 간헐적으로 빈 응답을 주면 pykrx의 login_krx가 resp.json()에서
# 처리되지 않은 JSONDecodeError를 던져 import 전체가 죽고, KRX와 무관한 yfinance/FRED
# 수집까지 함께 중단된다. 자동 로그인을 막기 위해 자격증명을 import 전에 빼두고,
# 아래 _ensureKrxLogin에서 재시도·예외 처리로 직접 로그인한다.
_KRX_ID = os.environ.pop('KRX_ID', None)
_KRX_PW = os.environ.pop('KRX_PW', None)

from pykrx import stock as pykrx_stock

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows
from lib.market_series import HISTORY_YEARS

FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv'

# 한국 주요 지수는 yfinance(^KS11/^KQ11)가 당일 종가를 하루 이상 늦게 제공하므로
# KRX(pykrx)에서 직접 수집한다. 값 체계는 yfinance와 동일해 과거 데이터와 연속된다.
KRX_INDEX_CODES = {'KOSPI': '1001', 'KOSDAQ': '2001'}


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


def _fetchKrxIndexDaily(series_code: str, krx_code: str, start: date, end: date) -> list[dict]:
  """pykrx로 KRX 지수 일봉 종가를 수집해 market_series_daily 행 목록을 반환한다.

  get_index_ohlcv의 todate는 inclusive라 yfinance와 달리 +1 보정이 필요 없다.
  """
  df = pykrx_stock.get_index_ohlcv(start.strftime('%Y%m%d'), end.strftime('%Y%m%d'), krx_code)
  if df is None or df.empty:
    logger.warning(f"{series_code}: pykrx 데이터 없음 ({krx_code})")
    return []

  rows = []
  for dt, val in df['종가'].items():
    if val is None or pd.isna(val) or float(val) == 0:
      continue
    rows.append({
      'series_code': series_code,
      'trade_date': dt.date().isoformat() if hasattr(dt, 'date') else str(dt)[:10],
      'close': float(val),
    })
  return rows


def _ensureKrxLogin(attempts: int = 3, delay: int = 3) -> bool:
  """KRX 로그인을 직접 수행해 pykrx 세션에 주입한다(best-effort).

  pykrx의 import-time 자동 로그인은 KRX가 빈 응답을 줄 때 예외가 import를 통째로
  중단시키므로 비활성화했다(자격증명을 import 전에 pop). 여기서 재시도·예외 처리로
  감싸 로그인하고, 실패하면 코스피/코스닥만 건너뛴다(yfinance/FRED 수집은 영향 없음).
  """
  krx_id = _KRX_ID or os.getenv('KRX_ID')
  krx_pw = _KRX_PW or os.getenv('KRX_PW')
  if not (krx_id and krx_pw):
    logger.warning("KRX_ID/KRX_PW 미설정 — 코스피/코스닥 KRX 수집을 건너뜁니다.")
    return False

  from pykrx.website.comm import auth

  for attempt in range(1, attempts + 1):
    try:
      session = auth.build_krx_session(krx_id, krx_pw)
    except Exception as e:
      logger.warning(f"KRX 로그인 시도 {attempt}/{attempts} 예외 — {e}")
      session = None
    if session is not None:
      auth.set_auth_session(session)
      return True
    if attempt < attempts:
      time.sleep(delay)

  logger.warning("KRX 로그인 실패 — 코스피/코스닥은 이번 수집에서 건너뜁니다.")
  return False


def collectMarketSeries() -> None:
  """market_series의 yf_symbol/fred_symbol/KRX 지수 시리즈를 수집·upsert한다."""
  end = date.today()
  start = end - timedelta(days=HISTORY_YEARS * 365)
  start_str = start.isoformat()
  end_str = end.isoformat()
  # yfinance의 end는 exclusive — UTC 당일 거래일 데이터가 누락되지 않도록 +1일.
  yf_end_str = (end + timedelta(days=1)).isoformat()

  client = get_client()
  meta = client.table('market_series') \
    .select('series_code, yf_symbol, fred_symbol, label, source') \
    .order('sort_order') \
    .execute().data or []

  collectable = [
    r for r in meta
    if r.get('yf_symbol') or r.get('fred_symbol') or r['series_code'] in KRX_INDEX_CODES
  ]
  if not collectable:
    logger.warning("market_series 메타에 수집 대상이 없습니다. 시드를 먼저 적용하세요.")
    return

  needs_krx = any(r['series_code'] in KRX_INDEX_CODES for r in collectable)
  krx_ready = _ensureKrxLogin() if needs_krx else False

  total = 0
  for row in collectable:
    code = row['series_code']
    label = row.get('label', '')
    if code in KRX_INDEX_CODES:
      if not krx_ready:
        logger.warning(f"{code}: KRX 로그인 불가 — 건너뜀")
        continue
      krx_code = KRX_INDEX_CODES[code]
      logger.info(f"{code} ({label}) KRX 수집 — {krx_code}")
      try:
        rows = _fetchKrxIndexDaily(code, krx_code, start, end)
      except Exception as e:
        logger.error(f"{code}: KRX 호출 실패 ({krx_code}) — {e}")
        rows = []
    elif row.get('yf_symbol'):
      sym = row['yf_symbol']
      logger.info(f"{code} ({label}) yfinance 수집 — {sym}")
      rows = _fetchYfDaily(code, sym, start_str, yf_end_str)
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
