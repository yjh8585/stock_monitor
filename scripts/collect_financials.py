#!/usr/bin/env python3
"""
21개사 분기·연간 재무제표를 수집해 financials 테이블에 upsert한다.
- fnguide 신버전(wcomp) JSON 엔드포인트: 한국 상장사 (로그인·브라우저 불필요)
- yfinance: 글로벌 13개사 (최근 5년 분기·연간)
단위: 원본 통화 기준 백만(MILLION) 단위로 정규화 후 저장.
"""
import sys
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
from lib import fnguide_client as fng
from lib.companies import get_global_companies, get_kr_companies
from lib.db import get_client, upsert_rows
from lib.financial_sources import SOURCE_FNGUIDE, SOURCE_YFINANCE

# ──────────────────────────────────────────────
# 상수
# ──────────────────────────────────────────────

MILLION = 1_000_000

# fnguide 억원 → 백만원 변환 승수
FNGUIDE_UNIT_MULTIPLIER = 100.0

# DB GENERATED ALWAYS AS 컬럼 — INSERT 페이로드에서 제외
GENERATED_COLS = frozenset({'operating_margin', 'gross_margin', 'net_margin', 'debt_ratio'})

# fnguide 신버전 계정 코드(AC_CODE) → DB 컬럼.
# 계정'명' 문자열이 아니라 회사 무관 표준 코드로 매칭한다 — 2026-07-18 감사에서
# '부채총계'가 '부채및자본총계'를 집어 79개사 217행의 부채=자산이 된 부류의 사고를
# 원천 차단하기 위함. 코드표 근거는 docs/fnguide-wcomp-migration.md.
FNGUIDE_INCOME_CODES: dict[str, str] = {
  '200000': 'revenue',           # 매출액(수익)
  '200360': 'cogs',              # 매출원가
  '200810': 'gross_profit',      # 매출총이익
  '200820': 'sga',               # 판매비와관리비
  '201370': 'operating_income',  # 영업이익
  '203170': 'net_income',        # 당기순이익
}

FNGUIDE_BALANCE_CODES: dict[str, str] = {
  '110000': 'total_assets',       # 자산총계
  '130000': 'total_liabilities',  # 부채총계
  '120000': 'total_equity',       # 자본총계
  '112840': 'inventory',          # 재고자산
  '112830': '_ca',                # 유동자산 — current_ratio 계산용
  '131580': '_cl',                # 유동부채 — current_ratio 계산용
}

# 투자지표(invValueIndex) 항목명 → DB 컬럼. 배수·원 단위라 단위 배수를 곱하지 않는다.
# 신버전은 배당수익률·EV/EBIT를 제공하지 않는다(구버전에서도 실적재 0건이라 회귀 아님).
FNGUIDE_INVEST_TO_DB: dict[str, str] = {
  'EPS':               'eps',
  'BPS':               'bps',
  'CFPS':              'cfps',
  'PER':               'per',
  'PBR':               'pbr',
  'PSR':               'psr',
  'EV/EBITDA':         'ev_ebitda',
  '수정DPS(보통주,현금)': 'dps',
}


# ──────────────────────────────────────────────
# 공통 유틸
# ──────────────────────────────────────────────

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


def _build_kr_rows(
  company_id: str,
  currency: str,
  period_type: str,
  period_data: dict[str, dict],
  invest_map: Optional[dict[str, dict]] = None,
  fiscal_year_end_month: int = 12,
) -> list[dict]:
  """period_data를 financials DB 행 목록으로 변환한다.

  fnguide Snapshot의 연간 Financial Highlight 테이블은 가장 우측에 최근 분기 열을
  포함하는 경우가 있어, 그대로 적재하면 분기 데이터가 annual로 잘못 분류된다.
  회사별 결산월(`fiscal_year_end_month`, default 12)과 period_end.month를 비교해:
    - 일치: 정상 annual로 인정. 비-12월 결산은 한국식 -1 보정(period_end.year - 1)
            적용 (예: 도요타 결산월 3월, FY2024는 2025-03-31 → fiscal_year=2024).
    - 불일치: 분기 데이터로 판정해 스킵 (fnguide 우측 분기 열 오적재 방지).
  """
  rows: list[dict] = []
  for vals in period_data.values():
    period_end: date = vals['_period_end']
    if period_type == 'annual' and period_end.month != fiscal_year_end_month:
      logger.warning(
        f"KR {company_id}: annual period_end={period_end} (월 {period_end.month}!="
        f"결산월 {fiscal_year_end_month}) → fnguide 분기 열 오적재로 추정, 스킵"
      )
      continue

    # 한국식 -1 보정: 12월 결산이 아닌 경우 fiscal_year = period_end.year - 1
    # (예: 결산월 3월 → FY2024는 2025-03-31에 끝남)
    fy_offset = -1 if (period_type == 'annual' and fiscal_year_end_month != 12) else 0
    fiscal_quarter = _month_to_quarter(period_end.month) if period_type == 'quarterly' else None

    row: dict = {
      'company_id':      company_id,
      'period_type':     period_type,
      'fiscal_year':     period_end.year + fy_offset,
      'fiscal_quarter':  fiscal_quarter,
      'period_end_date': period_end.isoformat(),
      'currency':        currency,
      'source':          SOURCE_FNGUIDE,
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
# fnguide 신버전(wcomp) 수집
# ──────────────────────────────────────────────

def _fetch_statements(
  cmp_cd: str,
  freq: str,
  consol: str,
  session,
) -> dict[str, dict]:
  """손익 + 재무상태를 한 기준(연간/분기 × 연결/별도)으로 받아 병합한다.

  손익이 비면 해당 기준에 데이터가 없다는 뜻이라 빈 dict를 돌려준다(별도 폴백 신호).
  """
  income = fng.fetch_fin_dataset(cmp_cd, 'income', freq, consol, session=session)
  if not fng.has_dataset_values(income):
    return {}

  period_data = fng.extract_accounts(
    income, FNGUIDE_INCOME_CODES, freq, FNGUIDE_UNIT_MULTIPLIER
  )
  balance = fng.fetch_fin_dataset(cmp_cd, 'balance', freq, consol, session=session)
  if balance:
    for key, vals in fng.extract_accounts(
      balance, FNGUIDE_BALANCE_CODES, freq, FNGUIDE_UNIT_MULTIPLIER
    ).items():
      period_data.setdefault(key, {'_period_end': vals['_period_end']}).update(
        {k: v for k, v in vals.items() if k != '_period_end'}
      )
  return period_data


def _fetch_company_financials(
  ticker: str,
  company_id: str,
  currency: str,
  fiscal_year_end_month: int = 12,
  session=None,
) -> list[dict]:
  """단일 회사의 연간·분기 재무제표를 fnguide 신버전 JSON에서 수집한다.

  전략 (2026-08 wcomp 이전):
  - `getFinIncome`/`getFinBalance` JSON을 연간(Y)·분기(Q)로 각각 호출한다. 분기 응답이
    discrete 분기값을 주므로 Q4=연간누적 오류가 원천 차단된다.
  - 계정 식별은 계정명이 아니라 표준 `AC_CODE`로 한다.
  - **연결(C) 우선, 연결 데이터가 없으면 별도(P)로 폴백**(종속회사 없는 회사).
  - 투자지표는 Invest 페이지의 인라인 JSON(`invValueIndex`)에서 연간 기간에만 병합한다.
  """
  session = session or fng.new_session()
  all_rows: list[dict] = []

  try:
    consol = fng.CONSOL_CONSOLIDATED
    annual_data = _fetch_statements(ticker, fng.FREQ_ANNUAL, consol, session)
    if not annual_data:
      # 연결 재무제표가 없는 회사 — 별도로 폴백 (AGENTS.md: 연결 우선, 없으면 별도)
      consol = fng.CONSOL_SEPARATE
      annual_data = _fetch_statements(ticker, fng.FREQ_ANNUAL, consol, session)
      if annual_data:
        logger.info(f"KR {ticker}: 연결 데이터 없음 → 별도(consol_typ=P) 사용")

    if not annual_data:
      logger.warning(f"KR {ticker}: 연간 손익 데이터 없음 — 스킵")
      return []

    qtr_data = _fetch_statements(ticker, fng.FREQ_QUARTER, consol, session)

    invest_map: dict[str, dict] = {}
    try:
      invest_map = fng.extract_invest_map(
        fng.fetch_invest_index(ticker, session=session), FNGUIDE_INVEST_TO_DB
      )
    except Exception as e:
      logger.warning(f"KR {ticker} 투자지표 수집 실패: {e}")

    all_rows.extend(_build_kr_rows(
      company_id, currency, 'annual', annual_data, invest_map,
      fiscal_year_end_month=fiscal_year_end_month,
    ))
    if qtr_data:
      all_rows.extend(_build_kr_rows(
        company_id, currency, 'quarterly', qtr_data,
        fiscal_year_end_month=fiscal_year_end_month,
      ))

  except Exception as e:
    logger.error(f"KR {ticker} 수집 실패: {e}")

  return all_rows


def _collect_kr_financials(
  id_map: dict[str, str],
  cur_map: dict[str, str],
) -> list[dict]:
  """fnguide 신버전 JSON으로 한국 상장사 재무데이터를 수집한다."""
  all_rows: list[dict] = []
  session = fng.new_session()

  for company in get_kr_companies():
    ticker     = company['ticker']
    company_id = id_map.get(ticker)
    if not company_id:
      logger.warning(f"KR {ticker}: company_id 없음, 스킵")
      continue

    currency  = cur_map.get(ticker, 'KRW')
    fye_month = int(company.get('fiscal_year_end_month') or 12)
    rows = _fetch_company_financials(
      ticker, company_id, currency,
      fiscal_year_end_month=fye_month, session=session,
    )
    all_rows.extend(rows)
    logger.info(
      f"KR {ticker} ({company['name_kr']}, 결산월 {fye_month}): "
      f"{len(rows)}개 기간 수집"
    )

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
  fy_offset: int = 0,
) -> dict:
  """yfinance 재무 데이터 컬럼을 financials DB 행으로 변환한다.

  fy_offset: 일본 비-12월 결산법인 한국식 표기 보정 (-1) 등에 사용.
  (예: 덴소 FY2025/4~2026/3 → period_end=2026-03-31, fy_offset=-1 → fiscal_year=2025)
  """
  fiscal_quarter = _month_to_quarter(period_end.month) if period_type == 'quarterly' else None
  row: dict = {
    'company_id':      company_id,
    'period_type':     period_type,
    'fiscal_year':     period_end.year + fy_offset,
    'fiscal_quarter':  fiscal_quarter,
    'period_end_date': period_end.isoformat(),
    'currency':        currency,
    'source':          SOURCE_YFINANCE,
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
  fy_offset: int = 0,
) -> list[dict]:
  """yfinance income/balance DataFrame 쌍을 DB 행 목록으로 변환한다.

  미래 period_end (결산일이 오늘 이후 = 미발표) 행은 적재하지 않는다 — yfinance가
  간헐적으로 estimate/forecast 컬럼을 끼워주면 실제 발표 전 데이터가 DB에 들어가
  parts-top100/related-stocks 페이지의 매출/영업이익 컬럼에 미래 연도가 보이는 사고가
  발생(2026-05-21 머더슨/인테바 케이스)."""
  if income_df is None or income_df.empty:
    return []
  today = date.today()
  rows: list[dict] = []
  for col_ts in income_df.columns:
    period_end: date = col_ts.date() if hasattr(col_ts, 'date') else col_ts
    if period_end > today:
      continue
    income_col = income_df[col_ts]
    balance_col = (
      balance_df[col_ts]
      if balance_df is not None and not balance_df.empty and col_ts in balance_df.columns
      else pd.Series(dtype=float)
    )
    rows.append(
      _build_yf_row(income_col, balance_col, company_id, currency, period_type, period_end, fy_offset)
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

      # 비-12월 결산 글로벌 회사 한국식 표기 보정 (-1).
      # annual columns의 첫 결산일로 회사 결산월 판단 → 비-12월이면 fy_offset=-1.
      # 마이그레이션 20260521000002(JP) + 20260521000003(JP 외 글로벌)과 동일 정책.
      # 9월 결산 등 비-12월 결산법인의 FY 표기를 다수파 12월 결산법인과 같은 시간축에 정렬.
      fy_offset = 0
      annual_income = t.income_stmt
      if annual_income is not None and not annual_income.empty:
        first_col = annual_income.columns[0]
        first_end = first_col.date() if hasattr(first_col, 'date') else first_col
        if first_end.month != 12:
          fy_offset = -1
          logger.info(
            f"글로벌 {ticker} ({company['name_kr']}): {first_end.month}월 결산법인 → fiscal_year -1 보정"
          )

      period_rows = _process_yf_frames(
        t.quarterly_income_stmt, t.quarterly_balance_sheet,
        company_id, fin_currency, 'quarterly', fy_offset=fy_offset,
      ) + _process_yf_frames(
        annual_income, t.balance_sheet,
        company_id, fin_currency, 'annual', fy_offset=fy_offset,
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

# fnguide 구조 변경 감지 임계값 — KR 회사 대량 0행이면 파서가 깨진 신호.
KR_HEALTH_MIN_COMPANIES = 10   # 이보다 적으면 신호 부족 → 판단 보류
KR_HEALTH_MIN_RATIO     = 0.5  # 데이터 획득 회사 비율 하한


def _kr_health_ok(attempted: int, with_data: int) -> bool:
  """KR fnguide 수집 건전성. 구조 변경 시 발생하는 대량 0행을 감지한다.

  회사가 KR_HEALTH_MIN_COMPANIES 미만이면 신호가 부족해 판단 보류(True — 정상 회사
  과차단 방지). 그 이상이면 데이터를 얻은 회사 비율이 KR_HEALTH_MIN_RATIO 이상이어야
  정상. fnguide가 페이지 구조를 바꿔 파서가 표를 못 찾으면 대부분 0행이 되어 감지된다
  (2026-07 Snapshot→통합표 변경을 침묵 처리했던 재발 방지)."""
  if attempted < KR_HEALTH_MIN_COMPANIES:
    return True
  return with_data >= attempted * KR_HEALTH_MIN_RATIO


def collectFinancials() -> None:
  """KR 상장사 + 글로벌 재무데이터를 수집해 financials 테이블에 upsert한다."""
  id_map, cur_map = _load_company_maps()

  kr_rows     = _collect_kr_financials(id_map, cur_map)
  global_rows = _collect_global_financials(id_map, cur_map)
  all_rows    = kr_rows + global_rows

  # fnguide 구조 변경 감지 — 대량 0행이면 파서가 깨진 신호(이번 사태의 침묵 실패 방지).
  kr_attempted = sum(1 for c in get_kr_companies() if id_map.get(c['ticker']))
  kr_with_data = len({r['company_id'] for r in kr_rows})
  structure_broken = not _kr_health_ok(kr_attempted, kr_with_data)
  if structure_broken:
    logger.error(
      f"⚠️ fnguide 구조 변경 의심 — KR {kr_with_data}/{kr_attempted} 회사만 수집됨. "
      "wcomp JSON 계약(getFinIncome/getFinBalance)·계정 코드 매핑 점검 필요 — "
      "scripts/verify_fnguide.py 실행."
    )

  if all_rows:
    existing_keys = _load_existing_keys()
    to_upsert     = _filter_to_upsert(all_rows, existing_keys)
    if to_upsert:
      upsert_rows('financials', to_upsert, 'company_id,period_type,fiscal_year,fiscal_quarter')
      logger.info(
        f"재무 수집 완료 — {len(to_upsert)}/{len(all_rows)}행 upsert "
        f"(KR {len(kr_rows)} + 글로벌 {len(global_rows)})"
      )
    else:
      logger.info("upsert 대상 행 없음 (모두 안정화된 과거 데이터)")
  else:
    logger.warning("수집된 재무 데이터 없음")

  # 구조 이상은 수집분 upsert 후 non-zero 종료로 워크플로에 알린다.
  if structure_broken:
    sys.exit(2)


if __name__ == '__main__':
  try:
    collectFinancials()
  except Exception as e:
    logger.error(f"재무 수집 실패: {e}")
    sys.exit(1)
