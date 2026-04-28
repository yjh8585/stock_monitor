#!/usr/bin/env python3
"""
21개사 분기·연간 재무제표를 수집해 financials 테이블에 upsert한다.
- valley.town Playwright: 한국 8개사 (VALLEY_EMAIL, VALLEY_PASSWORD 필수)
- yfinance: 글로벌 13개사 (최근 5년 분기·연간)
단위: 원본 통화 기준 백만(MILLION) 단위로 정규화 후 저장.
"""
import os
import re
import sys
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
    YF_BALANCE_TO_DB,
    YF_CURRENT_ASSETS_KEY,
    YF_CURRENT_LIABILITIES_KEY,
    YF_INCOME_TO_DB,
)
from lib.companies import get_global_companies, get_kr_companies
from lib.db import get_client, upsert_rows

MILLION = 1_000_000

# valley.town 상수
VALLEY_BASE_URL    = 'https://www.valley.town'
VALLEY_LOGIN_URL   = f'{VALLEY_BASE_URL}/login'
VALLEY_FINSTATE_URL = f'{VALLEY_BASE_URL}/financials/quote/{{ticker}}:KRX/financial-statement'
VALLEY_PAGE_TIMEOUT = 30_000   # 30초 (ms)
VALLEY_TAB_WAIT_MS  = 2_500    # 탭 전환 후 대기 (ms)

# DB generated columns — INSERT 페이로드에서 제외
GENERATED_COLS = frozenset({'operating_margin', 'gross_margin', 'net_margin', 'debt_ratio'})

# valley.town 계정명 → DB 컬럼 (연결 재무제표 기준)
VALLEY_TO_DB: dict[str, str] = {
    '매출액':              'revenue',
    '매출원가':            'cogs',
    '매출총이익':          'gross_profit',
    '판매비와관리비':      'sga',
    '영업이익':            'operating_income',
    'EBITDA':              'ebitda',
    '당기순이익':          'net_income',
    '지배기업주주귀속순이익': 'net_income',
    '당기순이익(지배)':    'net_income',
    '자산총계':            'total_assets',
    '부채총계':            'total_liabilities',
    '자본총계':            'total_equity',
    # 유동 항목은 current_ratio 계산 후 버림 (DB 컬럼 없음)
    '유동자산':            '_ca',
    '유동부채':            '_cl',
}


# ──────────────────────────────────────────────
# 공통 유틸
# ──────────────────────────────────────────────

def _month_to_quarter(month: int) -> int:
    """월을 분기 번호(1~4)로 변환한다."""
    return (month - 1) // 3 + 1


def _parse_number(text: str) -> Optional[float]:
    """숫자 문자열을 float으로 파싱한다."""
    s = str(text).strip().replace(',', '').replace(' ', '')
    if s in ('', '-', 'N/A', 'NA', '--', 'None', 'null'):
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_period(header: str) -> Optional[date]:
    """'2024/03', '2024.03', '2024-03' 형태를 month 말일 date로 변환한다."""
    m = re.search(r'(\d{4})[/.\-](\d{1,2})', header.strip())
    if not m:
        return None
    try:
        year, month = int(m.group(1)), int(m.group(2))
        if not (1 <= month <= 12):
            return None
        return date(year, month, monthrange(year, month)[1])
    except (ValueError, OverflowError):
        return None


def _load_company_maps() -> tuple[dict[str, str], dict[str, str]]:
    """DB에서 ticker → company_id, ticker → currency 매핑을 로드한다."""
    rows = get_client().table('companies').select('id,ticker,currency').execute().data
    return (
        {r['ticker']: r['id'] for r in rows},
        {r['ticker']: r['currency'] for r in rows},
    )


# ──────────────────────────────────────────────
# valley.town Playwright 수집
# ──────────────────────────────────────────────

def _valley_login(playwright, email: str, password: str):
    """valley.town에 로그인하고 (browser, page)를 반환한다."""
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_context().new_page()

    page.goto(VALLEY_LOGIN_URL, timeout=VALLEY_PAGE_TIMEOUT)
    page.wait_for_load_state('networkidle', timeout=VALLEY_PAGE_TIMEOUT)

    page.fill('input[type="email"]', email)
    page.fill('input[type="password"]', password)
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle', timeout=VALLEY_PAGE_TIMEOUT)

    if 'login' in page.url:
        raise RuntimeError(f"로그인 실패: 여전히 로그인 페이지 ({page.url})")

    logger.info("valley.town 로그인 성공")
    return browser, page


def _get_unit_multiplier(page) -> float:
    """페이지 텍스트에서 금액 단위를 감지해 백만원 변환 승수를 반환한다.

    억원 → 백만원 변환 시 ×100 필요.
    단위를 감지 못하면 억원(×100)으로 가정한다.
    """
    try:
        body = page.inner_text('body')
        if '백만원' in body or '백만 원' in body:
            return 1.0
        if '억원' in body or '억 원' in body:
            return 100.0
    except Exception:
        pass
    return 100.0   # 기본: 억원


def _extract_all_tables(page) -> list[dict]:
    """페이지의 모든 <table>에서 headers/rows를 추출한다."""
    return page.evaluate("""
        () => Array.from(document.querySelectorAll('table')).map(tbl => ({
            headers: Array.from(
                tbl.querySelectorAll('thead tr:last-child th, thead tr:last-child td')
            ).map(el => el.innerText.trim()),
            rows: Array.from(tbl.querySelectorAll('tbody tr')).map(tr =>
                Array.from(tr.querySelectorAll('td, th')).map(td => td.innerText.trim())
            ),
        }))
    """)


def _click_tab(page, label: str) -> None:
    """텍스트가 label인 버튼/탭을 클릭하고 로딩을 기다린다."""
    try:
        btn = page.locator(
            f'button:has-text("{label}"), [role="tab"]:has-text("{label}")'
        )
        if btn.count() > 0:
            btn.first.click()
            page.wait_for_timeout(VALLEY_TAB_WAIT_MS)
    except Exception as e:
        logger.debug(f"탭 '{label}' 클릭 실패: {e}")


def _parse_tables_to_period_dict(
    tables: list[dict],
    unit: float,
) -> dict[str, dict]:
    """추출된 tables를 period_end(isodate) → {db_col: val} 딕셔너리로 변환한다."""
    period_data: dict[str, dict] = {}

    for tbl in tables:
        headers = tbl['headers']
        if len(headers) < 2:
            continue

        for row in tbl['rows']:
            if len(row) < 2:
                continue
            metric = row[0].strip()
            db_col = VALLEY_TO_DB.get(metric)
            if db_col is None or db_col in GENERATED_COLS:
                continue

            for i, hdr in enumerate(headers[1:], 1):
                if i >= len(row):
                    break
                period_end = _parse_period(hdr)
                if period_end is None:
                    continue
                val = _parse_number(row[i])
                if val is None:
                    continue

                key = period_end.isoformat()
                if key not in period_data:
                    period_data[key] = {'_period_end': period_end}

                # 내부 컬럼(_ca, _cl)은 단위 변환만, 나머지는 백만 단위로 저장
                stored = round(val * unit, 4)
                if db_col not in period_data[key]:
                    period_data[key][db_col] = stored

    return period_data


def _build_kr_rows(
    company_id: str,
    currency: str,
    period_type: str,
    period_data: dict[str, dict],
) -> list[dict]:
    """period_data를 financials DB 행 목록으로 변환한다."""
    rows: list[dict] = []
    for vals in period_data.values():
        period_end: date = vals['_period_end']
        fiscal_quarter = _month_to_quarter(period_end.month) if period_type == 'quarterly' else None

        row: dict = {
            'company_id':     company_id,
            'period_type':    period_type,
            'fiscal_year':    period_end.year,
            'fiscal_quarter': fiscal_quarter,
            'period_end_date': period_end.isoformat(),
            'currency':       currency,
        }

        for col, val in vals.items():
            if col.startswith('_'):
                continue
            row[col] = val

        # current_ratio
        ca = vals.get('_ca')
        cl = vals.get('_cl')
        if ca and cl and cl != 0:
            row['current_ratio'] = round(ca / cl, 4)

        # ROE / ROA
        ni     = row.get('net_income')
        eq     = row.get('total_equity')
        assets = row.get('total_assets')
        if ni is not None and eq and eq != 0:
            row['roe'] = round(ni / eq * 100, 4)
        if ni is not None and assets and assets != 0:
            row['roa'] = round(ni / assets * 100, 4)

        rows.append(row)
    return rows


def _collect_kr_financials(
    id_map: dict[str, str],
    cur_map: dict[str, str],
) -> list[dict]:
    """valley.town Playwright로 한국 8개사 연결 재무데이터를 수집한다."""
    email    = os.environ.get('VALLEY_EMAIL')
    password = os.environ.get('VALLEY_PASSWORD')
    if not email or not password:
        logger.warning("VALLEY_EMAIL/VALLEY_PASSWORD 없음 — 한국 기업 재무 수집 스킵")
        return []

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.error("playwright 미설치 — pip install playwright && playwright install chromium")
        return []

    all_rows: list[dict] = []

    with sync_playwright() as pw:
        try:
            browser, page = _valley_login(pw, email, password)
        except Exception as e:
            logger.error(f"valley.town 로그인 실패: {e}")
            return []

        try:
            for company in get_kr_companies():
                ticker     = company['ticker']
                company_id = id_map.get(ticker)
                if not company_id:
                    logger.warning(f"KR {ticker}: company_id 없음, 스킵")
                    continue

                currency  = cur_map.get(ticker, 'KRW')
                collected = 0

                try:
                    url = VALLEY_FINSTATE_URL.format(ticker=ticker)
                    page.goto(url, timeout=VALLEY_PAGE_TIMEOUT)
                    page.wait_for_load_state('networkidle', timeout=VALLEY_PAGE_TIMEOUT)

                    # 연결 탭 선택 (기본값 아닐 경우 대비)
                    _click_tab(page, '연결')

                    unit = _get_unit_multiplier(page)
                    logger.debug(f"KR {ticker}: 단위 승수={unit}")

                    for period_type, btn_label in [('annual', '연간'), ('quarterly', '분기')]:
                        _click_tab(page, btn_label)
                        tables      = _extract_all_tables(page)
                        period_data = _parse_tables_to_period_dict(tables, unit)
                        rows        = _build_kr_rows(company_id, currency, period_type, period_data)
                        all_rows.extend(rows)
                        collected  += len(rows)

                    logger.info(f"KR {ticker} ({company['name_kr']}): {collected}개 기간 수집")

                except Exception as e:
                    logger.error(f"KR {ticker} 수집 실패: {e}")

        finally:
            browser.close()

    return all_rows


# ──────────────────────────────────────────────
# yfinance 글로벌 수집 (변경 없음)
# ──────────────────────────────────────────────

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
        'company_id':     company_id,
        'period_type':    period_type,
        'fiscal_year':    period_end.year,
        'fiscal_quarter': fiscal_quarter,
        'period_end_date': period_end.isoformat(),
        'currency':       currency,
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
        ticker     = company['ticker']
        company_id = id_map.get(ticker)
        if not company_id:
            logger.warning(f"글로벌 {ticker}: company_id 없음, 스킵")
            continue
        try:
            t = yf.Ticker(ticker)
            period_rows = _process_yf_frames(
                t.quarterly_income_stmt, t.quarterly_balance_sheet,
                company_id, cur_map.get(ticker, 'USD'), 'quarterly',
            ) + _process_yf_frames(
                t.income_stmt, t.balance_sheet,
                company_id, cur_map.get(ticker, 'USD'), 'annual',
            )
            rows.extend(period_rows)
            logger.info(f"글로벌 {ticker} ({company['name_kr']}): {len(period_rows)}개 기간 수집")
        except Exception as e:
            logger.error(f"글로벌 {ticker} 수집 실패: {e}")
    return rows


# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────

def collectFinancials() -> None:
    """21개사 재무데이터를 수집해 financials 테이블에 upsert한다."""
    id_map, cur_map = _load_company_maps()

    kr_rows     = _collect_kr_financials(id_map, cur_map)
    global_rows = _collect_global_financials(id_map, cur_map)
    all_rows    = kr_rows + global_rows

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
