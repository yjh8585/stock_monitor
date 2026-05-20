#!/usr/bin/env python3
"""
21개사 분기·연간 재무제표를 수집해 financials 테이블에 upsert한다.
- fnguide.com Playwright: 한국 8개사 (로그인 불필요)
- yfinance: 글로벌 13개사 (최근 5년 분기·연간)
단위: 원본 통화 기준 백만(MILLION) 단위로 정규화 후 저장.
"""
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

# ──────────────────────────────────────────────
# 상수
# ──────────────────────────────────────────────

MILLION = 1_000_000

# fnguide 관련 상수
FNGUIDE_BASE_URL     = 'https://comp.fnguide.com'
FNGUIDE_SNAPSHOT_URL = (
  f'{FNGUIDE_BASE_URL}/SVO2/ASP/SVD_Main.asp'
  '?pGB=1&gicode={gicode}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=11&stkGb=701'
)
FNGUIDE_PAGE_TIMEOUT = 30_000   # 30초 (ms)
FNGUIDE_NAV_WAIT_MS  = 3_000   # 탭 전환 후 networkidle 대기 (ms)

# fnguide 재무제표 테이블 인덱스 (GoMenu('103') 이동 후)
FNGUIDE_TABLE_ANNUAL_INCOME  = 0
FNGUIDE_TABLE_QTR_INCOME     = 1
FNGUIDE_TABLE_ANNUAL_BALANCE = 2
FNGUIDE_TABLE_QTR_BALANCE    = 3

# fnguide 억원 → 백만원 변환 승수
FNGUIDE_UNIT_MULTIPLIER = 100.0

# DB GENERATED ALWAYS AS 컬럼 — INSERT 페이로드에서 제외
GENERATED_COLS = frozenset({'operating_margin', 'gross_margin', 'net_margin', 'debt_ratio'})

# 단위 배수(억원→백만원)를 곱하지 않는 컬럼 (배수·원 단위)
NO_UNIT_COLS = frozenset({'per', 'pbr', 'eps', 'bps', 'dps', 'cfps', 'ev_ebitda',
                          'dividend_yield', 'psr', 'ev_ebit'})

# fnguide 행 라벨 → DB 컬럼 매핑 (손익계산서 + 대차대조표 + Snapshot FH 지표)
# 행 라벨은 split('\n')[0].strip() 정규화 후 매핑
FNGUIDE_TO_DB: dict[str, str] = {
  '매출액':               'revenue',
  '매출원가':             'cogs',
  '매출총이익':           'gross_profit',
  '판매비와관리비':       'sga',
  '영업이익':             'operating_income',
  'EBITDA':               'ebitda',
  '당기순이익':           'net_income',
  '지배기업주주귀속순이익': 'net_income',
  '자산총계':             'total_assets',
  '부채총계':             'total_liabilities',
  '자본총계':             'total_equity',
  '재고자산':             'inventory',
  # Snapshot Financial Highlight 추가 항목
  'EPS':                  'eps',
  'BPS':                  'bps',
  'DPS':                  'dps',
  'PER':                  'per',
  'PBR':                  'pbr',
  # current_ratio 계산용 (DB 직접 컬럼 없음)
  '유동자산':             '_ca',
  '유동부채':             '_cl',
}

# '전년동기' 계열 헤더는 period 파싱 불가 → 스킵
FNGUIDE_SKIP_HEADERS = frozenset({'전년동기', '전년동기(%)'})

# fnguide 투자지표 탭 (GoMenu('105')) 행 → DB 컬럼
FNGUIDE_INVEST_TO_DB: dict[str, str] = {
  'EPS':       'eps',
  'BPS':       'bps',
  'DPS':       'dps',
  'CFPS':      'cfps',
  'PER':       'per',
  'PBR':       'pbr',
  'PSR':       'psr',
  'EV/EBITDA': 'ev_ebitda',
  'EV/EBIT':   'ev_ebit',
  '배당수익률':  'dividend_yield',
}


# ──────────────────────────────────────────────
# 공통 유틸
# ──────────────────────────────────────────────

def _month_to_quarter(month: int) -> int:
  """월을 분기 번호(1~4)로 변환한다."""
  return (month - 1) // 3 + 1


def _parse_number(text: str) -> Optional[float]:
  """숫자 문자열을 float으로 파싱한다. 빈 값·대시·N/A는 None 반환."""
  s = str(text).strip().replace(',', '').replace(' ', '')
  if s in ('', '-', 'N/A', 'NA', '--', 'None', 'null'):
    return None
  try:
    return float(s)
  except (ValueError, TypeError):
    return None


def _parse_period(header: str) -> Optional[date]:
  """'2024/03', '2024.03', '2024-03' 형태를 해당 월 말일 date로 변환한다."""
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


def _to_gicode(ticker: str) -> str:
  """6자리 종목코드를 fnguide gicode 형식(A + 6자리)으로 변환한다."""
  return f'A{ticker}'


def _load_company_maps() -> tuple[dict[str, str], dict[str, str]]:
  """DB에서 ticker → company_id, ticker → currency 매핑을 로드한다."""
  rows = get_client().table('companies').select('id,ticker,currency').execute().data
  return (
    {r['ticker']: r['id'] for r in rows},
    {r['ticker']: r['currency'] for r in rows},
  )


# ──────────────────────────────────────────────
# fnguide 테이블 파싱
# ──────────────────────────────────────────────

def _extract_fnguide_tables(page) -> list[dict]:
  """페이지의 fnguide 재무 테이블(us_table_ty1)에서 headers/rows를 추출한다."""
  return page.evaluate("""
    () => Array.from(
      document.querySelectorAll('table.us_table_ty1')
    ).map(tbl => ({
      headers: Array.from(
        tbl.querySelectorAll('thead tr:last-child th, thead tr:last-child td')
      ).map(el => el.innerText.trim()),
      rows: Array.from(tbl.querySelectorAll('tbody tr')).map(tr =>
        Array.from(tr.querySelectorAll('td, th')).map(td => td.innerText.trim())
      ),
    }))
  """)


def _parse_income_table(
  tbl: dict,
  unit: float,
) -> dict[str, dict]:
  """손익계산서 테이블을 period_end → {db_col: val} 딕셔너리로 파싱한다."""
  period_data: dict[str, dict] = {}
  headers = tbl.get('headers', [])

  # Snapshot 테이블은 헤더[0]부터 날짜 — 재무제표 탭은 헤더[0]이 라벨 열 헤더
  header_start = 0 if (headers and _parse_period(headers[0]) is not None) else 1

  for row in tbl.get('rows', []):
    if not row:
      continue
    # 여러 줄 라벨(예: 'EPS\n(원)')은 첫 줄만 사용
    metric = row[0].split('\n')[0].strip()
    db_col = FNGUIDE_TO_DB.get(metric)
    if db_col is None or db_col in GENERATED_COLS:
      continue

    for i, hdr in enumerate(headers[header_start:], 1):
      # 전년동기 계열 헤더 또는 추정치((E)/(P)) 헤더는 스킵
      if hdr.strip() in FNGUIDE_SKIP_HEADERS:
        continue
      if '(E)' in hdr or '(P)' in hdr:
        continue
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
      # 같은 period에 동일 db_col이 이미 있으면 첫 번째 값 우선 유지
      if db_col not in period_data[key]:
        # 배수·원 단위 컬럼은 unit 배수 없이 저장
        multiplier = 1.0 if db_col in NO_UNIT_COLS else unit
        period_data[key][db_col] = round(val * multiplier, 4)

  return period_data


def _merge_period_data(
  base: dict[str, dict],
  extra: dict[str, dict],
) -> None:
  """extra의 period_data를 base에 in-place 병합한다.

  같은 period_end 키 안에서 컬럼이 이미 존재하면 덮어쓰지 않음 (먼저 들어온 값 우선).
  Snapshot 테이블에서 이미 채운 값을 재무제표 탭이 덮어쓰지 않도록 보장한다.
  """
  for key, vals in extra.items():
    if key not in base:
      base[key] = dict(vals)
      continue
    for col, v in vals.items():
      if col not in base[key]:
        base[key][col] = v


def _merge_balance_table(
  period_data: dict[str, dict],
  tbl: dict,
  unit: float,
) -> None:
  """대차대조표 테이블을 기존 period_data에 병합한다 (in-place)."""
  headers = tbl.get('headers', [])

  for row in tbl.get('rows', []):
    if not row:
      continue
    metric = row[0].split('\n')[0].strip()
    db_col = FNGUIDE_TO_DB.get(metric)
    if db_col is None or db_col in GENERATED_COLS:
      continue

    for i, hdr in enumerate(headers[1:], 1):
      if hdr.strip() in FNGUIDE_SKIP_HEADERS:
        continue
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
      if db_col not in period_data[key]:
        multiplier = 1.0 if db_col in NO_UNIT_COLS else unit
        period_data[key][db_col] = round(val * multiplier, 4)


def _build_invest_map(invest_tbl: dict) -> dict[str, dict]:
  """투자지표 테이블을 period_end.isodate → {db_col: val} 딕셔너리로 변환한다."""
  invest_map: dict[str, dict] = {}
  if not invest_tbl or not invest_tbl.get('headers'):
    return invest_map
  headers = invest_tbl['headers']
  for row in invest_tbl.get('rows', []):
    if not row:
      continue
    metric = row[0].split('\n')[0].strip()
    db_col = FNGUIDE_INVEST_TO_DB.get(metric)
    if db_col is None:
      continue
    for i, hdr in enumerate(headers[1:], 1):
      if hdr.strip() in FNGUIDE_SKIP_HEADERS:
        continue
      if i >= len(row):
        break
      period_end = _parse_period(hdr)
      if period_end is None:
        continue
      val = _parse_number(row[i])
      if val is None:
        continue
      key = period_end.isoformat()
      if key not in invest_map:
        invest_map[key] = {}
      if db_col not in invest_map[key]:
        invest_map[key][db_col] = val
  return invest_map


def _build_kr_rows(
  company_id: str,
  currency: str,
  period_type: str,
  period_data: dict[str, dict],
  invest_map: Optional[dict[str, dict]] = None,
) -> list[dict]:
  """period_data를 financials DB 행 목록으로 변환한다.

  fnguide Snapshot의 연간 Financial Highlight 테이블은 가장 우측에 최근 분기 열을
  포함하는 경우가 있어, 그대로 적재하면 분기 데이터가 annual로 잘못 분류된다.
  KR 회사는 12월 결산이 표준이므로 annual + period_end.month != 12 는 스킵한다.
  (비12월 결산 한국 상장사는 거의 없음 — 발견 시 별도 정책 결정.)
  """
  rows: list[dict] = []
  for vals in period_data.values():
    period_end: date = vals['_period_end']
    if period_type == 'annual' and period_end.month != 12:
      logger.warning(
        f"KR {company_id}: annual period_end={period_end} (월 {period_end.month}!=12) "
        f"→ fnguide 분기 열 오적재로 추정, 스킵"
      )
      continue
    fiscal_quarter = _month_to_quarter(period_end.month) if period_type == 'quarterly' else None

    row: dict = {
      'company_id':      company_id,
      'period_type':     period_type,
      'fiscal_year':     period_end.year,
      'fiscal_quarter':  fiscal_quarter,
      'period_end_date': period_end.isoformat(),
      'currency':        currency,
    }

    for col, val in vals.items():
      # 내부 임시 컬럼(_prefix) 및 generated 컬럼은 제외
      if col.startswith('_') or col in GENERATED_COLS:
        continue
      row[col] = val

    # current_ratio 계산
    ca = vals.get('_ca')
    cl = vals.get('_cl')
    if ca is not None and cl and cl != 0:
      row['current_ratio'] = round(ca / cl, 4)

    # ROE / ROA 계산
    ni     = row.get('net_income')
    eq     = row.get('total_equity')
    assets = row.get('total_assets')
    if ni is not None and eq and eq != 0:
      row['roe'] = round(ni / eq * 100, 4)
    if ni is not None and assets and assets != 0:
      row['roa'] = round(ni / assets * 100, 4)

    # 연간 기간에만 투자지표 병합
    if period_type == 'annual' and invest_map:
      merged = invest_map.get(period_end.isoformat(), {})
      for col, val in merged.items():
        if col not in row:
          row[col] = val

    rows.append(row)
  return rows


# ──────────────────────────────────────────────
# fnguide Playwright 수집
# ──────────────────────────────────────────────

def _find_annual_table(tables: list[dict]) -> Optional[dict]:
  """Snapshot IFRS(연결) 연간 아카이브 테이블을 반환한다.

  _extract_fnguide_tables는 thead tr:last-child만 가져오므로 'IFRS(연결)' 텍스트가
  헤더에 없다. 대신 행 데이터 기준으로 식별:
  - 첫 행 라벨 '매출액'
  - 헤더에 12월(연간) 기간만 2개 이상
  - 분기 기간(03/06/09월) 없음
  순서상 IFRS(연결)이 IFRS(별도)보다 앞에 있으므로 첫 번째 매치를 반환.
  """
  for tbl in tables:
    hdrs = tbl.get('headers', [])
    rows = tbl.get('rows', [])
    if not rows or not rows[0]:
      continue
    if rows[0][0].split('\n')[0].strip() != '매출액':
      continue
    # '(E)', '(P)' 접미어 없는 정확한 YYYY/12 형식만 연간으로 판별
    annual_hdrs  = [h for h in hdrs if re.match(r'^\d{4}/12$', h.strip())]
    quarter_hdrs = [h for h in hdrs if re.match(r'^\d{4}/(?:03|06|09)$', h.strip())]
    if len(annual_hdrs) >= 2 and not quarter_hdrs:
      return tbl
  return None


def _find_quarterly_table(tables: list[dict]) -> Optional[dict]:
  """Snapshot IFRS(연결) 분기 테이블을 반환한다."""
  for tbl in tables:
    hdrs = tbl.get('headers', [])
    rows = tbl.get('rows', [])
    if not rows or not rows[0]:
      continue
    if rows[0][0].split('\n')[0].strip() != '매출액':
      continue
    quarter_hdrs = [h for h in hdrs if re.match(r'^\d{4}/(?:03|06|09)$', h.strip())]
    if len(quarter_hdrs) >= 2:
      return tbl
  return None


def _scrape_company_financials(
  page,
  ticker: str,
  company_id: str,
  currency: str,
) -> list[dict]:
  """단일 회사의 연간·분기 재무제표를 fnguide에서 스크레이핑한다.

  전략:
  - Snapshot(SVD_main) Financial Highlight 테이블 → 연간·분기 재무 + PER·PBR·EPS
  - GoMenu('103') 재무제표 탭 → 매출원가·매출총이익·판관비·재고자산 (Snapshot에 없음)
  - GoMenu('105') 투자지표 탭 → EV/EBITDA 등 추가 지표
  Snapshot에서 채운 값은 후속 페이지가 덮어쓰지 않음.
  """
  gicode = _to_gicode(ticker)
  snapshot_url = FNGUIDE_SNAPSHOT_URL.format(gicode=gicode)
  all_rows: list[dict] = []

  try:
    # Snapshot 페이지 직접 로드 (Financial Highlight 포함)
    page.goto(snapshot_url, timeout=FNGUIDE_PAGE_TIMEOUT)
    page.wait_for_load_state('networkidle', timeout=FNGUIDE_PAGE_TIMEOUT)
    page.wait_for_timeout(FNGUIDE_NAV_WAIT_MS)

    snap_tables = _extract_fnguide_tables(page)

    annual_tbl = _find_annual_table(snap_tables)
    qtr_tbl    = _find_quarterly_table(snap_tables)

    if annual_tbl is None:
      logger.warning(f"KR {ticker}: Financial Highlight 연간 테이블 없음 — 스킵")
      return []

    # Snapshot 데이터 파싱 (억원 × 100 → 백만원)
    annual_data = _parse_income_table(annual_tbl, FNGUIDE_UNIT_MULTIPLIER)
    qtr_data: dict[str, dict] = (
      _parse_income_table(qtr_tbl, FNGUIDE_UNIT_MULTIPLIER) if qtr_tbl else {}
    )

    # 재무제표 탭(GoMenu('103')) — 매출원가·매출총이익·판관비·재고자산 보강
    try:
      page.evaluate("GoMenu('103')")
      page.wait_for_load_state('networkidle', timeout=FNGUIDE_PAGE_TIMEOUT)
      page.wait_for_timeout(FNGUIDE_NAV_WAIT_MS)
      fin_tables = _extract_fnguide_tables(page)

      if len(fin_tables) > FNGUIDE_TABLE_ANNUAL_INCOME:
        _merge_period_data(
          annual_data,
          _parse_income_table(fin_tables[FNGUIDE_TABLE_ANNUAL_INCOME], FNGUIDE_UNIT_MULTIPLIER),
        )
      if len(fin_tables) > FNGUIDE_TABLE_ANNUAL_BALANCE:
        _merge_balance_table(
          annual_data, fin_tables[FNGUIDE_TABLE_ANNUAL_BALANCE], FNGUIDE_UNIT_MULTIPLIER
        )
      if qtr_tbl and len(fin_tables) > FNGUIDE_TABLE_QTR_INCOME:
        _merge_period_data(
          qtr_data,
          _parse_income_table(fin_tables[FNGUIDE_TABLE_QTR_INCOME], FNGUIDE_UNIT_MULTIPLIER),
        )
      if qtr_tbl and len(fin_tables) > FNGUIDE_TABLE_QTR_BALANCE:
        _merge_balance_table(
          qtr_data, fin_tables[FNGUIDE_TABLE_QTR_BALANCE], FNGUIDE_UNIT_MULTIPLIER
        )
    except Exception as e:
      logger.warning(f"KR {ticker} 재무제표(103) 수집 실패: {e}")

    # 투자지표 탭(GoMenu('105')) — EV/EBITDA 수집
    invest_map: dict[str, dict] = {}
    try:
      page.evaluate("GoMenu('105')")
      page.wait_for_load_state('networkidle', timeout=FNGUIDE_PAGE_TIMEOUT)
      page.wait_for_timeout(FNGUIDE_NAV_WAIT_MS)
      inv_tables = _extract_fnguide_tables(page)
      invest_map = _build_invest_map(inv_tables[1] if len(inv_tables) > 1 else {})
    except Exception as e:
      logger.warning(f"KR {ticker} 투자지표 수집 실패: {e}")

    all_rows.extend(_build_kr_rows(company_id, currency, 'annual', annual_data, invest_map))
    if qtr_data:
      all_rows.extend(_build_kr_rows(company_id, currency, 'quarterly', qtr_data))

  except Exception as e:
    logger.error(f"KR {ticker} 스크레이핑 실패: {e}")

  return all_rows


def _collect_kr_financials(
  id_map: dict[str, str],
  cur_map: dict[str, str],
) -> list[dict]:
  """fnguide Playwright로 한국 8개사 연결 재무데이터를 수집한다."""
  try:
    from playwright.sync_api import sync_playwright
  except ImportError:
    logger.error("playwright 미설치 — pip install playwright && playwright install chromium")
    return []

  all_rows: list[dict] = []

  with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(
      user_agent=(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
      )
    )
    page = context.new_page()

    try:
      for company in get_kr_companies():
        ticker     = company['ticker']
        company_id = id_map.get(ticker)
        if not company_id:
          logger.warning(f"KR {ticker}: company_id 없음, 스킵")
          continue

        currency = cur_map.get(ticker, 'KRW')
        rows     = _scrape_company_financials(page, ticker, company_id, currency)
        all_rows.extend(rows)
        logger.info(f"KR {ticker} ({company['name_kr']}): {len(rows)}개 기간 수집")

    finally:
      browser.close()

  return all_rows


# ──────────────────────────────────────────────
# yfinance 글로벌 수집
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
    'company_id':      company_id,
    'period_type':     period_type,
    'fiscal_year':     period_end.year,
    'fiscal_quarter':  fiscal_quarter,
    'period_end_date': period_end.isoformat(),
    'currency':        currency,
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
    rows.append(
      _build_yf_row(income_col, balance_col, company_id, currency, period_type, period_end)
    )
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
      # 재무제표 통화는 yfinance financialCurrency 우선 (VFS=USD주가/VND재무 같은 케이스 대응)
      try:
        fin_currency = (t.info.get('financialCurrency')
                        or cur_map.get(ticker, 'USD'))
      except Exception:
        fin_currency = cur_map.get(ticker, 'USD')

      period_rows = _process_yf_frames(
        t.quarterly_income_stmt, t.quarterly_balance_sheet,
        company_id, fin_currency, 'quarterly',
      ) + _process_yf_frames(
        t.income_stmt, t.balance_sheet,
        company_id, fin_currency, 'annual',
      )
      rows.extend(period_rows)
      logger.info(
        f"글로벌 {ticker} ({company['name_kr']}): {len(period_rows)}개 기간 수집 "
        f"(financialCurrency={fin_currency})"
      )
    except Exception as e:
      logger.error(f"글로벌 {ticker} 수집 실패: {e}")
  return rows


# ──────────────────────────────────────────────
# Incremental upsert 필터
# ──────────────────────────────────────────────

# 최근 N개 분기/연간은 정정 발표 가능성을 고려해 무조건 upsert
RECENT_QUARTERS_KEEP = 4
RECENT_YEARS_KEEP    = 2


def _load_existing_keys() -> set[tuple]:
  """financials 테이블의 (company_id, period_type, fiscal_year, fiscal_quarter) 키 셋을 로드한다."""
  try:
    rows = (
      get_client()
      .table('financials')
      .select('company_id,period_type,fiscal_year,fiscal_quarter')
      .limit(50_000)
      .execute()
      .data
    )
  except Exception as e:
    logger.warning(f"기존 financials 키 조회 실패 — 필터링 없이 전체 upsert: {e}")
    return set()
  return {
    (r['company_id'], r['period_type'], r['fiscal_year'], r.get('fiscal_quarter'))
    for r in rows
  }


def _filter_to_upsert(rows: list[dict], existing_keys: set[tuple]) -> list[dict]:
  """최근 N분기/N연간은 무조건 upsert, 그 외는 DB에 이미 있으면 스킵.

  - 최근 분기 임계값: max(fiscal_year * 4 + fiscal_quarter) - (RECENT_QUARTERS_KEEP - 1)
  - 최근 연간 임계값: max(fiscal_year) - (RECENT_YEARS_KEEP - 1)
  """
  if not rows:
    return rows

  qtr_codes = [
    r['fiscal_year'] * 4 + (r['fiscal_quarter'] or 0)
    for r in rows if r['period_type'] == 'quarterly'
  ]
  qtr_threshold = (max(qtr_codes) - (RECENT_QUARTERS_KEEP - 1)) if qtr_codes else None

  annual_years = [r['fiscal_year'] for r in rows if r['period_type'] == 'annual']
  annual_threshold = (max(annual_years) - (RECENT_YEARS_KEEP - 1)) if annual_years else None

  filtered: list[dict] = []
  skipped = 0
  for r in rows:
    period_type = r['period_type']
    fy          = r['fiscal_year']
    fq          = r.get('fiscal_quarter')

    if period_type == 'quarterly' and qtr_threshold is not None:
      code = fy * 4 + (fq or 0)
      if code >= qtr_threshold:
        filtered.append(r)
        continue
    elif period_type == 'annual' and annual_threshold is not None:
      if fy >= annual_threshold:
        filtered.append(r)
        continue

    key = (r['company_id'], period_type, fy, fq)
    if key not in existing_keys:
      filtered.append(r)
    else:
      skipped += 1

  if skipped:
    logger.info(f"안정화된 과거 분기/연간 {skipped}개 스킵 (이미 DB에 존재)")
  return filtered


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

  existing_keys = _load_existing_keys()
  to_upsert     = _filter_to_upsert(all_rows, existing_keys)

  if not to_upsert:
    logger.info("upsert 대상 행 없음 (모두 안정화된 과거 데이터)")
    return

  upsert_rows('financials', to_upsert, 'company_id,period_type,fiscal_year,fiscal_quarter')
  logger.info(
    f"재무 수집 완료 — {len(to_upsert)}/{len(all_rows)}행 upsert "
    f"(KR {len(kr_rows)} + 글로벌 {len(global_rows)})"
  )


if __name__ == '__main__':
  try:
    collectFinancials()
  except Exception as e:
    logger.error(f"재무 수집 실패: {e}")
    sys.exit(1)
