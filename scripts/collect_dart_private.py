#!/usr/bin/env python3
"""
비상장 국내 기업의 재무 데이터를 OpenDartReader로 수집한다.
- DART API key: scripts/.env의 DART_API_KEY
- 현재 대상: 남양넥스모 (ticker='남양넥스모', data_source='dart')
참고: https://nbviewer.org/gist/FinanceData/12440c298682c44758e4789909a3f333
"""
import os
import sys
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows

DART_KEY = os.environ.get('DART_API_KEY', '')
MILLION = 1_000_000

# 수집 대상 연간 범위 — 직전 회계연도부터 과거 5년치
YEARS_BACK = 5


def _target_years() -> list[int]:
  """직전 회계연도부터 과거 YEARS_BACK 년치 (오래된 순)."""
  this_year = datetime.now().year
  return list(range(this_year - YEARS_BACK, this_year))

# DART 연결재무제표 계정명 → DB 컬럼 매핑
DART_TO_DB: dict[str, str] = {
  '매출액': 'revenue',
  '영업이익': 'operating_income',
  '영업이익(손실)': 'operating_income',
  '당기순이익': 'net_income',
  '당기순이익(손실)': 'net_income',
  '자산총계': 'total_assets',
  '부채총계': 'total_liabilities',
  '자본총계': 'total_equity',
  '재고자산': 'inventory',
}

# GENERATED ALWAYS 컬럼 제외
GENERATED_COLS = frozenset({'operating_margin', 'gross_margin', 'net_margin', 'debt_ratio'})


def _get_dart_client():
  """OpenDartReader 클라이언트를 초기화한다."""
  try:
    import OpenDartReader as ODR
    if not DART_KEY:
      logger.error('DART_API_KEY 환경 변수가 설정되지 않았습니다.')
      return None
    # OpenDartReader 패키지는 import 시 클래스 자체를 반환한다
    return ODR(DART_KEY)
  except ImportError:
    logger.error('OpenDartReader 미설치 — pip install opendartreader')
    return None


def _search_corp_code(dart, company_name: str) -> str | None:
  """회사명으로 DART corp_code를 검색한다."""
  try:
    corp_code = dart.find_corp_code(company_name)
    if not corp_code:
      logger.warning(f'DART 검색 결과 없음: {company_name}')
      return None
    logger.info(f'DART corp_code 검색 결과: {company_name} → {corp_code}')
    return corp_code
  except Exception as e:
    logger.error(f'DART corp_code 검색 실패: {e}')
    return None


def _collect_company(dart, company_id: str, corp_code: str, years: list[int]) -> list[dict]:
  """특정 기업의 연간 재무 데이터를 DART에서 수집한다.
  finstate_all: 사업보고서 기반 (상장사 및 일부 비상장사).
  감사보고서만 제출하는 비상장 외감법인은 해당 API로 조회 불가."""
  rows: list[dict] = []
  for year in years:
    try:
      # 연결재무제표(CFS) 우선, 없으면 별도재무제표(OFS)
      df = None
      for fs_div in ['CFS', 'OFS']:
        result = dart.finstate_all(corp_code, year, fs_div=fs_div)
        if result is not None and not result.empty:
          df = result
          break
      if df is None:
        logger.warning(f'{corp_code} {year}년: 재무 데이터 없음 (감사보고서 전용 비상장사는 DART API 미지원)')
        continue

      row: dict = {
        'company_id': company_id,
        'period_type': 'annual',
        'fiscal_year': year,
        'fiscal_quarter': None,
        'period_end_date': f'{year}-12-31',
        'currency': 'KRW',
      }

      for _, r in df.iterrows():
        acct = str(r.get('account_nm', '')).strip()
        db_col = DART_TO_DB.get(acct)
        if db_col is None or db_col in GENERATED_COLS:
          continue
        # thstrm_amount: 당기 금액 (단위: 원)
        raw = str(r.get('thstrm_amount', '')).replace(',', '').strip()
        if not raw or raw in ('-', '', 'None'):
          continue
        try:
          val = float(raw) / MILLION  # 원 → 백만원
          if db_col not in row:
            row[db_col] = round(val, 4)
        except (ValueError, TypeError):
          continue

      if len(row) > 8:  # 기본 컬럼 외 데이터가 있으면 추가
        rows.append(row)
        logger.info(f'{corp_code} {year}년: {len(row)-8}개 항목 수집')
      else:
        logger.warning(f'{corp_code} {year}년: 유효 데이터 없음')

    except Exception as e:
      logger.error(f'{corp_code} {year}년 수집 실패: {e}')

  return rows


def collectDartPrivate() -> None:
  if not DART_KEY:
    logger.error('DART_API_KEY 없음. scripts/.env에 추가하세요.')
    sys.exit(1)

  dart = _get_dart_client()
  if not dart:
    sys.exit(1)

  client = get_client()
  # data_source='dart'인 회사 목록
  companies = [
    r for r in client.table('companies').select('id,ticker,name_kr,data_source').execute().data
    if r.get('data_source') == 'dart'
  ]

  if not companies:
    logger.info('DART 수집 대상 기업 없음')
    return

  all_rows: list[dict] = []
  for company in companies:
    name = company['name_kr']
    company_id = company['id']

    logger.info(f'{name} DART 코드 검색 중...')
    corp_code = _search_corp_code(dart, name)
    if not corp_code:
      logger.warning(f'{name}: DART 코드 없음 — 스킵')
      continue

    rows = _collect_company(dart, company_id, corp_code, years=_target_years())
    all_rows.extend(rows)
    logger.info(f'{name}({corp_code}): {len(rows)}년치 수집')

  if all_rows:
    upsert_rows('financials', all_rows, 'company_id,period_type,fiscal_year,fiscal_quarter')
    logger.info(f'DART 수집 완료 — 총 {len(all_rows)}행')
  else:
    logger.warning('수집된 DART 재무 데이터 없음')


if __name__ == '__main__':
  try:
    collectDartPrivate()
  except Exception as e:
    logger.error(f'DART 수집 실패: {e}')
    sys.exit(1)
