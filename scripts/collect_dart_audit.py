#!/usr/bin/env python3
"""
국내 비상장 외감법인의 연결감사보고서를 DART에서 직접 파싱해 재무 데이터를 수집한다.
- OpenDartReader로 결산감사보고서 rcpNo 조회
- sub_docs로 재무제표 문서 URL 확인
- requests + BeautifulSoup으로 HTML 테이블 파싱
- financials 테이블에 upsert

단위: DART 문서의 원(KRW) 단위 → 백만원으로 변환해 저장.
"""
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows

DART_KEY = ''
try:
  from dotenv import dotenv_values
  _env = dotenv_values(Path(__file__).parent / '.env')
  DART_KEY = _env.get('DART_API_KEY', '')
except Exception:
  pass

import os
DART_KEY = DART_KEY or os.environ.get('DART_API_KEY', '')

MILLION = 1_000_000
GENERATED_COLS = frozenset({'operating_margin', 'gross_margin', 'net_margin', 'debt_ratio'})
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

# DART 계정명 → DB 컬럼 매핑 (부분 일치 우선)
ACCT_TO_DB: dict[str, str] = {
  '매출액': 'revenue',
  '영업이익': 'operating_income',
  '영업이익(손실)': 'operating_income',
  '당기순이익': 'net_income',
  '당기순이익(손실)': 'net_income',
  '지배기업주주귀속순이익': 'net_income',
  '자산총계': 'total_assets',
  '부채총계': 'total_liabilities',
  '자본총계': 'total_equity',
  '재고자산': 'inventory',
}

# 감사보고서 유형 키워드 (결산감사보고서 우선)
AUDIT_REPORT_KEYWORDS = ['결산감사보고서', '감사보고서']


def _get_dart():
  """OpenDartReader 클라이언트 반환."""
  try:
    import OpenDartReader as ODR
    if not DART_KEY:
      logger.error('DART_API_KEY 없음')
      return None
    return ODR(DART_KEY)
  except ImportError:
    logger.error('pip install opendartreader')
    return None


def _normalize(s: str) -> str:
  """공백·비공백(\xa0) 문자 제거해 계정명을 정규화한다."""
  return re.sub(r'[\s\xa0]+', '', s)


def _parse_num(s: str) -> float | None:
  """문자열에서 숫자 파싱. 괄호는 음수로 처리."""
  s = s.strip().replace(',', '').replace(' ', '')
  negative = s.startswith('(') and s.endswith(')')
  s = s.strip('()')
  if not s or s in ('-', '', 'None'):
    return None
  try:
    v = float(s)
    return -v if negative else v
  except (ValueError, TypeError):
    return None


def _clean_acct(raw: str) -> str:
  """계정명 정규화: 공백 제거 → 주석·서수 접두어 제거."""
  s = _normalize(raw)
  s = re.sub(r'\(주석\d+.*?\)', '', s)
  # Ⅰ. Ⅱ. 등 Unicode 로마자 및 한글 접두어 제거
  s = re.sub(r'^[Ⅰ-Ⅿⅰ-ⅿ가-힣]+\.', '', s)
  s = re.sub(r'^\(\d+\)\.?', '', s)
  s = re.sub(r'^\d+\.', '', s)
  return s.strip()


def _match_acct(raw: str) -> str | None:
  """계정명을 ACCT_TO_DB에서 찾는다 (공백 정규화 후 매칭)."""
  clean = _clean_acct(raw)
  if clean in ACCT_TO_DB:
    return ACCT_TO_DB[clean]
  for key, col in ACCT_TO_DB.items():
    if key in clean:
      return col
  return None


def _parse_financial_tables(tables: list) -> dict[str, dict[str, float | None]]:
  """
  재무제표 테이블 목록에서 {db_col: {current, prior}} 형태로 파싱한다.
  테이블 열 구조: 계정명 | 당기세부 | 당기합계 | 전기세부 | 전기합계
  """
  result: dict[str, dict[str, float | None]] = {}
  seen: set[str] = set()

  for tbl in tables:
    tbl_text = _normalize(tbl.get_text())
    if not any(kw in tbl_text for kw in ACCT_TO_DB):
      continue

    rows = tbl.find_all('tr')
    for row in rows:
      cells = [td.get_text(strip=True) for td in row.find_all(['th', 'td'])]
      if len(cells) < 2:
        continue

      db_col = _match_acct(cells[0])
      if db_col is None or db_col in GENERATED_COLS or db_col in seen:
        continue

      # 당기: col2(합계) 우선, 없으면 col1(세부)
      curr: float | None = None
      prior: float | None = None
      if len(cells) >= 3:
        curr = _parse_num(cells[2]) or _parse_num(cells[1])
        prior = _parse_num(cells[4]) if len(cells) >= 5 else _parse_num(cells[3])
      else:
        curr = _parse_num(cells[1])

      if curr is not None:
        result[db_col] = {'current': curr / MILLION, 'prior': prior / MILLION if prior else None}
        seen.add(db_col)

  return result


def _get_audit_rcpt(dart, corp_code: str, fiscal_year: int) -> str | None:
  """특정 회계연도의 결산감사보고서 rcpNo를 반환한다."""
  filings = dart.list(corp_code, start=f'{fiscal_year}-01-01', end=f'{fiscal_year + 1}-06-30')
  if filings is None or filings.empty:
    return None
  for kw in AUDIT_REPORT_KEYWORDS:
    for _, row in filings.iterrows():
      rpt = str(row.get('report_nm', ''))
      if kw in rpt and str(fiscal_year) in rpt:
        return str(row['rcept_no'])
  return None


def _get_main_doc_url(dart, rcpt_no: str) -> str | None:
  """sub_docs에서 가장 큰(재무제표 본문) 문서 URL을 반환한다."""
  docs = dart.sub_docs(rcpt_no)
  if docs is None or docs.empty:
    return None
  # length 파라미터가 가장 큰 URL 선택 (재무제표 본문)
  def extract_length(url: str) -> int:
    m = re.search(r'length=(\d+)', str(url))
    return int(m.group(1)) if m else 0

  best_url = max(docs['url'], key=extract_length)
  return str(best_url)


def _fetch_tables(url: str) -> list:
  """DART 뷰어 URL에서 HTML 테이블 목록을 반환한다."""
  try:
    r = requests.get(url, headers=HEADERS, timeout=30)
    soup = BeautifulSoup(r.content, 'html.parser')
    return soup.find_all('table')
  except Exception as e:
    logger.error(f'HTML 수집 실패 ({url}): {e}')
    return []


def _collect_company(dart, company_id: str, corp_code: str, years: list[int]) -> list[dict]:
  """비상장사의 연도별 연결감사보고서를 파싱해 financials 행 목록을 반환한다."""
  rows: list[dict] = []

  for year in years:
    rcpt_no = _get_audit_rcpt(dart, corp_code, year)
    if not rcpt_no:
      logger.warning(f'{corp_code} {year}년: 결산감사보고서 없음')
      continue

    logger.info(f'{corp_code} {year}년: rcpNo={rcpt_no}')
    doc_url = _get_main_doc_url(dart, rcpt_no)
    if not doc_url:
      logger.warning(f'{corp_code} {year}년: 문서 URL 없음')
      continue

    tables = _fetch_tables(doc_url)
    if not tables:
      logger.warning(f'{corp_code} {year}년: 테이블 없음')
      continue

    parsed = _parse_financial_tables(tables)
    if not parsed:
      logger.warning(f'{corp_code} {year}년: 재무 데이터 파싱 실패')
      continue

    # 당기(year) 행
    row: dict = {
      'company_id': company_id,
      'period_type': 'annual',
      'fiscal_year': year,
      'fiscal_quarter': None,
      'period_end_date': f'{year}-12-31',
      'currency': 'KRW',
    }
    for db_col, vals in parsed.items():
      row[db_col] = round(vals['current'], 4) if vals['current'] is not None else None

    if len(row) > 6:
      rows.append(row)
      logger.info(f'{corp_code} {year}년: {len(row) - 6}개 항목 수집 — {list(parsed.keys())}')

    # 전기(year-1) 행 — parsed에 prior 값이 있으면 추가
    prior_vals = {col: v['prior'] for col, v in parsed.items() if v['prior'] is not None}
    if prior_vals:
      prior_row: dict = {
        'company_id': company_id,
        'period_type': 'annual',
        'fiscal_year': year - 1,
        'fiscal_quarter': None,
        'period_end_date': f'{year - 1}-12-31',
        'currency': 'KRW',
      }
      for db_col, val in prior_vals.items():
        prior_row[db_col] = round(val, 4)
      if len(prior_row) > 6:
        rows.append(prior_row)
        logger.debug(f'{corp_code} {year - 1}년(전기): {len(prior_row) - 6}개 항목')

  return rows


def collectDartAudit() -> None:
  """data_source='dart'인 비상장사의 연결감사보고서 재무 데이터를 수집한다."""
  if not DART_KEY:
    logger.error('DART_API_KEY 없음. scripts/.env에 추가하세요.')
    sys.exit(1)

  dart = _get_dart()
  if not dart:
    sys.exit(1)

  client = get_client()
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
    try:
      import OpenDartReader as ODR
      corp_code = ODR(DART_KEY).find_corp_code(name)
    except Exception as e:
      logger.error(f'{name} corp_code 검색 실패: {e}')
      continue

    if not corp_code:
      logger.warning(f'{name}: DART 코드 없음 — 스킵')
      continue

    logger.info(f'{name}: corp_code={corp_code}')
    rows = _collect_company(dart, company_id, corp_code, years=[2025, 2024, 2023, 2022])
    all_rows.extend(rows)
    logger.info(f'{name}({corp_code}): {len(rows)}행 수집')

  if all_rows:
    # 중복 제거 (같은 company_id + fiscal_year는 최신 당기 우선)
    deduped: dict[tuple, dict] = {}
    for r in all_rows:
      key = (r['company_id'], r['fiscal_year'])
      if key not in deduped:
        deduped[key] = r
    final = list(deduped.values())
    upsert_rows('financials', final, 'company_id,period_type,fiscal_year,fiscal_quarter')
    logger.info(f'DART 감사보고서 수집 완료 — {len(final)}행')
  else:
    logger.warning('수집된 재무 데이터 없음')


if __name__ == '__main__':
  try:
    collectDartAudit()
  except Exception as e:
    logger.error(f'DART 감사보고서 수집 실패: {e}')
    sys.exit(1)
