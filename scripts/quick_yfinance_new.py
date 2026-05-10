"""신규 등록 회사 yfinance 빠른 수집 (annual financials만)."""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows  # noqa: E402

# 환경변수 TARGET_TICKERS로 override 가능 (콤마 분리)
_env = os.environ.get('TARGET_TICKERS', '').strip()
NEW_TICKERS = (
  [t.strip() for t in _env.split(',') if t.strip()] if _env
  else [
    'ZIL.F', 'AUM.DE', '6773.T', '300124.SZ', '0425.HK', 'AAV.BK', '002179.SZ',
    'HLE.DE', 'MB.VI', '1929.T', 'UNOMINDA.NS', '7278.T', 'MBLY', 'GNTX',
    '7280.T', '6923.T', '7699.T', '601501.SS', '6835.T', '5852.T', '300850.SZ',
    '001316.SZ', '5334.T',
    # 본사 3개 (yfinance) + LSAuto는 marklines
    '6594.T', 'GTX', '0179.HK',
  ]
)

import yfinance as yf  # noqa: E402

client = get_client()
rows = client.table('companies').select('id,ticker,name,name_kr,country,currency').in_('ticker', NEW_TICKERS).execute().data
ticker_to_company = {r['ticker']: r for r in rows}
logger.info(f'대상 {len(NEW_TICKERS)}개, DB 매칭 {len(rows)}개')

upserts = []
fail = []
for ticker in NEW_TICKERS:
  c = ticker_to_company.get(ticker)
  if not c:
    logger.warning(f'  {ticker}: DB 없음 — 스킵')
    fail.append(f'{ticker}-DB없음')
    continue
  try:
    t = yf.Ticker(ticker)
    fin_currency = c.get('currency', 'USD')
    try:
      info_cur = t.info.get('financialCurrency')
      if info_cur:
        fin_currency = info_cur
    except Exception:
      pass

    # annual income statement
    fin = t.income_stmt
    if fin is None or fin.empty:
      logger.warning(f'  {ticker} ({c["name_kr"]}): annual income_stmt 비어있음')
      fail.append(f'{ticker}-비어있음')
      continue

    cols = list(fin.columns)
    if not cols:
      fail.append(f'{ticker}-no columns')
      continue

    rows_added = 0
    for col in cols:  # 5년치 모두 처리
      fy_year = col.year if hasattr(col, 'year') else None
      if not fy_year:
        continue
      # period_end_date를 column의 실제 날짜로 (Mar/Jun/Sep/Dec 종료 회사 대응)
      period_end = col.strftime('%Y-%m-%d') if hasattr(col, 'strftime') else f'{fy_year}-12-31'
      # 미래 날짜 (오늘 이후) record는 추정치 — skip
      from datetime import date
      if hasattr(col, 'date') and col.date() > date.today():
        continue

      def _safe(idx):
        if idx not in fin.index:
          return None
        v = fin.loc[idx, col]
        try:
          fv = float(v)
          if fv != fv:  # NaN check
            return None
          return fv
        except (TypeError, ValueError):
          return None

      rev = _safe('Total Revenue')
      if rev is None:
        continue
      op = _safe('Operating Income')
      ni = _safe('Net Income')

      rev_m = rev / 1_000_000
      op_m = op / 1_000_000 if op is not None else None
      ni_m = ni / 1_000_000 if ni is not None else None

      upserts.append({
        'company_id': c['id'],
        'period_type': 'annual',
        'fiscal_year': fy_year,
        'fiscal_quarter': None,
        'period_end_date': period_end,
        'currency': fin_currency,
        'revenue': round(rev_m, 4),
        'operating_income': round(op_m, 4) if op_m is not None else None,
        'net_income': round(ni_m, 4) if ni_m is not None else None,
      })
      rows_added += 1
    logger.info(f'  ✓ {ticker} ({c["name_kr"]}): {rows_added}개 연도 ({fin_currency})')
  except Exception as e:
    logger.error(f'  {ticker} ({c.get("name_kr", "?")}): {e}')
    fail.append(f'{ticker}-err')

if upserts:
  upsert_rows('financials', upserts, 'company_id,period_type,fiscal_year,fiscal_quarter')
  logger.info(f'\nupsert {len(upserts)}행 완료')
if fail:
  logger.warning(f'실패 {len(fail)}: {", ".join(fail)}')
