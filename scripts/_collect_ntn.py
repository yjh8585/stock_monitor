#!/usr/bin/env python3
"""NTN(6472.T) 재무 데이터 yfinance 수집 (일회성)."""
import sys
from pathlib import Path
import numpy as np
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows

MILLION = 1_000_000
TICKER = '6472.T'


def _safe(col_ts, key: str, frame: pd.DataFrame) -> float | None:
  if frame is None or frame.empty or col_ts not in frame.columns:
    return None
  if key not in frame.index:
    return None
  try:
    v = frame[col_ts].get(key)
    if v is None:
      return None
    f = float(v)
    return None if (pd.isna(f) or np.isinf(f)) else round(f / MILLION, 4)
  except Exception:
    return None


def main() -> None:
  client = get_client()
  rows_meta = client.table('companies').select('id,ticker').execute().data
  cid = next((r['id'] for r in rows_meta if r['ticker'] == TICKER), None)
  if not cid:
    logger.error(f'{TICKER}: company_id 없음')
    sys.exit(1)

  t = yf.Ticker(TICKER)
  out = []
  pairs = [
    (t.income_stmt, t.balance_sheet, 'annual'),
    (t.quarterly_income_stmt, t.quarterly_balance_sheet, 'quarterly'),
  ]
  for inc_df, bs_df, ptype in pairs:
    if inc_df is None or inc_df.empty:
      continue
    for col_ts in inc_df.columns:
      pe = col_ts.date() if hasattr(col_ts, 'date') else col_ts
      fq = ((pe.month - 1) // 3 + 1) if ptype == 'quarterly' else None
      row: dict = {
        'company_id': cid,
        'period_type': ptype,
        'fiscal_year': pe.year,
        'fiscal_quarter': fq,
        'period_end_date': pe.isoformat(),
        'currency': 'JPY',
        'revenue': _safe(col_ts, 'Total Revenue', inc_df),
        'operating_income': _safe(col_ts, 'Operating Income', inc_df),
        'net_income': _safe(col_ts, 'Net Income', inc_df),
        'total_assets': _safe(col_ts, 'Total Assets', bs_df),
        'total_liabilities': _safe(col_ts, 'Total Liabilities Net Minority Interest', bs_df),
        'total_equity': _safe(col_ts, 'Stockholders Equity', bs_df),
      }
      out.append(row)

  upsert_rows('financials', out, 'company_id,period_type,fiscal_year,fiscal_quarter')
  logger.info(f'NTN(6472.T) 재무 {len(out)}행 수집 완료')


if __name__ == '__main__':
  main()
