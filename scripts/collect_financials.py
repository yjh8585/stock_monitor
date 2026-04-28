#!/usr/bin/env python3
"""
21개사 분기·연간 재무제표를 수집해 financials 테이블에 upsert한다.
- DART API: 한국 8개사 (최근 5년 연간 + 분기, DART_API_KEY 필수)
- yfinance: 글로벌 13개사 (최근 5년 분기·연간)
단위: 원본 통화 기준 백만(MILLION) 단위로 정규화 후 저장.
"""
import os
import sys
import time
from calendar import monthrange
from datetime import date
from pathlib import Path
from typing import Optional

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.accounts_map import (
    DART_TO_DB,
    YF_BALANCE_TO_DB,
    YF_CURRENT_ASSETS_KEY,
    YF_CURRENT_LIABILITIES_KEY,
    YF_INCOME_TO_DB,
)
from lib.companies import get_global_companies, get_kr_companies
from lib.db import get_client, upsert_rows

MILLION = 1_000_000
HISTORY_YEARS = 5
DART_DELAY = 0.5  # DART API 요청 간격 (초) — 초당 2회 제한 준수

# generated columns: DB가 자동 계산하므로 INSERT 페이로드에서 제외
GENERATED_COLS = frozenset({'operating_margin', 'gross_margin', 'net_margin', 'debt_ratio'})

# (reprt_code, period_type, fiscal_quarter)
# H1/9M는 누적(cumulative) 분기 데이터로 저장
DART_REPORTS: list[tuple[str, str, Optional[int]]] = [
    ('11013', 'quarterly', 1),
    ('11012', 'quarterly', 2),
    ('11014', 'quarterly', 3),
    ('11011', 'annual', None),
]


def _parse_dart_amount(value) -> Optional[float]:
    """DART API 금액 문자열을 float으로 파싱한다."""
    if value is None:
        return None
    s = str(value).strip()
    if s in ('', '-', 'None', 'nan', 'NaN'):
        return None
    try:
        return float(s.replace(',', '').replace(' ', ''))
    except (ValueError, TypeError):
        return None


def _month_to_quarter(month: int) -> int:
    """월을 분기 번호(1~4)로 변환한다."""
    return (month - 1) // 3 + 1


def _load_company_maps() -> tuple[dict[str, str], dict[str, str]]:
    """DB에서 ticker → company_id, ticker → currency 매핑을 로드한다."""
    rows = get_client().table('companies').select('id,ticker,currency').execute().data
    return (
        {r['ticker']: r['id'] for r in rows},
        {r['ticker']: r['currency'] for r in rows},
    )


def _get_dart_corp_map(dart) -> dict[str, str]:
    """DART corp_codes에서 stock_code(6자리) → corp_code(8자리) 매핑을 반환한다."""
    try:
        df = dart.corp_codes
    except Exception as e:
        logger.error(f"DART corp_codes 로드 실패: {e}")
        return {}
    if df is None or df.empty:
        return {}
    result: dict[str, str] = {}
    for _, row in df.iterrows():
        sc = str(row.get('stock_code') or '').strip().zfill(6)
        cc = str(row.get('corp_code') or '').strip()
        if sc and sc != '000000' and cc:
            result[sc] = cc
    return result


def _extract_dart_values(dart, corp_code: str, year: int, reprt_code: str) -> dict[str, float]:
    """DART finstate에서 DB 컬럼명 → 값(백만원) 딕셔너리를 추출한다."""
    try:
        df = dart.finstate(corp_code, year, reprt_code=reprt_code, fs_div='CFS')
    except Exception as e:
        logger.debug(f"DART {corp_code}/{year}/{reprt_code}: {e}")
        return {}
    if df is None or df.empty:
        return {}

    values: dict[str, float] = {}
    ca = cl = None
    for _, row in df.iterrows():
        nm = str(row.get('account_nm') or '').strip()
        raw = _parse_dart_amount(row.get('thstrm_amount'))
        if raw is None:
            continue
        if nm in DART_TO_DB:
            col = DART_TO_DB[nm]
            if col not in GENERATED_COLS and col not in ('current_ratio', 'roe', 'roa'):
                values[col] = raw / MILLION
        elif nm == '유동자산':
            ca = raw
        elif nm == '유동부채':
            cl = raw

    if ca is not None and cl and cl != 0:
        values['current_ratio'] = round(ca / cl, 4)
    ni = values.get('net_income')
    eq = values.get('total_equity')
    assets = values.get('total_assets')
    if ni is not None and eq and eq != 0:
        values['roe'] = round(ni / eq * 100, 4)
    if ni is not None and assets and assets != 0:
        values['roa'] = round(ni / assets * 100, 4)
    return values


def _build_dart_row(
    company_id: str,
    currency: str,
    year: int,
    period_type: str,
    fiscal_quarter: Optional[int],
    values: dict[str, float],
) -> dict:
    """DART 수집 데이터로 financials DB 행을 생성한다."""
    month_map: dict[Optional[int], int] = {1: 3, 2: 6, 3: 9, None: 12}
    month = month_map[fiscal_quarter]
    last_day = monthrange(year, month)[1]
    row: dict = {
        'company_id': company_id,
        'period_type': period_type,
        'fiscal_year': year,
        'fiscal_quarter': fiscal_quarter,
        'period_end_date': date(year, month, last_day).isoformat(),
        'currency': currency,
    }
    row.update(values)
    return row


def _collect_kr_financials(
    dart,
    corp_map: dict[str, str],
    id_map: dict[str, str],
    cur_map: dict[str, str],
) -> list[dict]:
    """DART API로 한국 8개사 재무데이터를 수집한다."""
    rows: list[dict] = []
    current_year = date.today().year
    years = range(current_year - HISTORY_YEARS, current_year + 1)

    for company in get_kr_companies():
        ticker = company['ticker']
        corp_code = corp_map.get(ticker)
        company_id = id_map.get(ticker)
        if not corp_code:
            logger.warning(f"KR {ticker}: DART corp_code 없음, 스킵")
            continue
        if not company_id:
            logger.warning(f"KR {ticker}: company_id 없음, 스킵")
            continue

        currency = cur_map.get(ticker, 'KRW')
        collected = 0
        for year in years:
            for reprt_code, period_type, fiscal_quarter in DART_REPORTS:
                time.sleep(DART_DELAY)
                values = _extract_dart_values(dart, corp_code, year, reprt_code)
                if not values:
                    continue
                rows.append(_build_dart_row(company_id, currency, year, period_type, fiscal_quarter, values))
                collected += 1
        logger.info(f"KR {ticker} ({company['name_kr']}): {collected}개 기간 수집")
    return rows


def _get_yf_value(series: pd.Series, key: str) -> Optional[float]:
    """yfinance Series에서 키 값을 float으로 안전하게 추출한다."""
    try:
        val = series.get(key)
        if val is None:
            return None
        f = float(val)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


def _build_yf_row(
    income_col: pd.Series,
    balance_col: pd.Series,
    company_id: str,
    currency: str,
    period_type: str,
    period_end: date,
) -> dict:
    """yfinance 재무 데이터 컬럼을 financials DB 행으로 변환한다."""
    fiscal_quarter = _month_to_quarter(period_end.month) if period_type == 'quarterly' else None
    row: dict = {
        'company_id': company_id,
        'period_type': period_type,
        'fiscal_year': period_end.year,
        'fiscal_quarter': fiscal_quarter,
        'period_end_date': period_end.isoformat(),
        'currency': currency,
    }
    for yf_key, db_col in YF_INCOME_TO_DB.items():
        if db_col in GENERATED_COLS:
            continue
        v = _get_yf_value(income_col, yf_key)
        if v is not None:
            row[db_col] = round(v / MILLION, 4)
    for yf_key, db_col in YF_BALANCE_TO_DB.items():
        if db_col in GENERATED_COLS:
            continue
        v = _get_yf_value(balance_col, yf_key)
        if v is not None:
            row[db_col] = round(v / MILLION, 4)

    ca = _get_yf_value(balance_col, YF_CURRENT_ASSETS_KEY)
    cl = _get_yf_value(balance_col, YF_CURRENT_LIABILITIES_KEY)
    if ca is not None and cl and cl != 0:
        row['current_ratio'] = round(ca / cl, 4)
    ni, eq, assets = row.get('net_income'), row.get('total_equity'), row.get('total_assets')
    if ni is not None and eq and eq != 0:
        row['roe'] = round(ni / eq * 100, 4)
    if ni is not None and assets and assets != 0:
        row['roa'] = round(ni / assets * 100, 4)
    return row


def _process_yf_frames(
    income_df: Optional[pd.DataFrame],
    balance_df: Optional[pd.DataFrame],
    company_id: str,
    currency: str,
    period_type: str,
) -> list[dict]:
    """yfinance income/balance DataFrame 쌍을 DB 행 목록으로 변환한다."""
    if income_df is None or income_df.empty:
        return []
    rows: list[dict] = []
    for col_ts in income_df.columns:
        period_end: date = col_ts.date() if hasattr(col_ts, 'date') else col_ts
        income_col = income_df[col_ts]
        balance_col = (
            balance_df[col_ts]
            if balance_df is not None and not balance_df.empty and col_ts in balance_df.columns
            else pd.Series(dtype=float)
        )
        rows.append(_build_yf_row(income_col, balance_col, company_id, currency, period_type, period_end))
    return rows


def _collect_global_financials(
    id_map: dict[str, str],
    cur_map: dict[str, str],
) -> list[dict]:
    """yfinance로 글로벌 13개사 재무데이터를 수집한다."""
    rows: list[dict] = []
    for company in get_global_companies():
        if company['status'] != 'active':
            logger.debug(f"글로벌 {company['ticker']}: status={company['status']}, 스킵")
            continue
        ticker = company['ticker']
        company_id = id_map.get(ticker)
        if not company_id:
            logger.warning(f"글로벌 {ticker}: company_id 없음, 스킵")
            continue

        try:
            t = yf.Ticker(ticker)
            period_rows = _process_yf_frames(
                t.quarterly_income_stmt, t.quarterly_balance_sheet, company_id, cur_map.get(ticker, 'USD'), 'quarterly'
            ) + _process_yf_frames(
                t.income_stmt, t.balance_sheet, company_id, cur_map.get(ticker, 'USD'), 'annual'
            )
            rows.extend(period_rows)
            logger.info(f"글로벌 {ticker} ({company['name_kr']}): {len(period_rows)}개 기간 수집")
        except Exception as e:
            logger.error(f"글로벌 {ticker} 수집 실패: {e}")
    return rows


def collectFinancials() -> None:
    """21개사 재무데이터를 수집해 financials 테이블에 upsert한다."""
    id_map, cur_map = _load_company_maps()

    kr_rows: list[dict] = []
    dart_api_key = os.environ.get('DART_API_KEY')
    if dart_api_key:
        try:
            # import OpenDartReader 하면 모듈이 아닌 클래스가 직접 바인딩됨
            import OpenDartReader
            dart = OpenDartReader(dart_api_key)
            corp_map = _get_dart_corp_map(dart)
            kr_rows = _collect_kr_financials(dart, corp_map, id_map, cur_map)
        except Exception as e:
            logger.error(f"DART 수집 실패: {e}")
    else:
        logger.warning("DART_API_KEY 없음 — 한국 기업 재무 수집 스킵")

    global_rows = _collect_global_financials(id_map, cur_map)
    all_rows = kr_rows + global_rows

    if not all_rows:
        logger.warning("수집된 재무 데이터 없음")
        return

    upsert_rows('financials', all_rows, 'company_id,period_type,fiscal_year,fiscal_quarter')
    logger.info(
        f"재무 수집 완료 — 총 {len(all_rows)}행 (KR {len(kr_rows)} + 글로벌 {len(global_rows)})"
    )


if __name__ == '__main__':
    try:
        collectFinancials()
    except Exception as e:
        logger.error(f"재무 수집 실패: {e}")
        sys.exit(1)
