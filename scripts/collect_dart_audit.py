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
from datetime import datetime
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
  '매출': 'revenue',
  '영업수익': 'revenue',
  '수익(매출액)': 'revenue',
  '매출(영업수익)': 'revenue',
  '영업이익': 'operating_income',
  '영업이익(손실)': 'operating_income',
  '영업손실': 'operating_income',
  '당기순이익': 'net_income',
  '당기순이익(손실)': 'net_income',
  '지배기업주주귀속순이익': 'net_income',
  '자산총계': 'total_assets',
  '부채총계': 'total_liabilities',
  '자본총계': 'total_equity',
  '재고자산': 'inventory',
}

# 매출/영업이익 키워드와 충돌하는 비손익 항목 — 부분 일치 시 거부
ACCT_REJECT = frozenset({
  '매출원가', '매출총이익', '매출채권', '매출채권및기타채권',
  '영업외수익', '영업외비용', '기타수익', '기타영업수익',
  '금융수익', '금융비용', '미실현수익', '이연수익',
  '영업이익률', '영업비용',
})

# 감사보고서 유형 키워드 (결산감사보고서 우선)
AUDIT_REPORT_KEYWORDS = ['결산감사보고서', '감사보고서']

# 수집 대상 회계연도 — 직전 회계연도부터 과거 N년치
YEARS_BACK = 4


def _target_years() -> list[int]:
  """직전 회계연도부터 과거 YEARS_BACK 년치 (최신 우선)."""
  this_year = datetime.now().year
  return list(range(this_year - 1, this_year - 1 - YEARS_BACK, -1))


def _get_dart():
  """OpenDartReader 클라이언트 반환."""
  try:
    from opendartreader import OpenDartReader as ODR
  except ImportError:
    try:
      import OpenDartReader as ODR  # 구버전(단일 파일 모듈) 호환
    except ImportError as e:
      logger.error(f'OpenDartReader import 실패: {e!r}')
      return None
  if not DART_KEY:
    logger.error('DART_API_KEY 없음')
    return None
  return ODR(DART_KEY)


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
  """계정명을 ACCT_TO_DB에서 찾는다 (공백 정규화 후 매칭).
  ACCT_REJECT에 포함된 비손익 항목은 부분 일치를 차단한다.
  """
  clean = _clean_acct(raw)
  if clean in ACCT_REJECT or any(rej in clean for rej in ACCT_REJECT):
    return None
  if clean in ACCT_TO_DB:
    return ACCT_TO_DB[clean]
  for key, col in ACCT_TO_DB.items():
    if key in clean:
      return col
  return None


def _detect_unit_divider(tbl_text: str) -> int:
  """표 본문 텍스트에서 단위(백만원/천원/원) 인식 → 백만원 환산 divider 반환.

  - "백만원" 표기 → divider=1 (이미 백만원)
  - "천원"   표기 → divider=1000 (천원 → 백만원)
  - 기본(원)        → divider=MILLION
  """
  if '백만원' in tbl_text:
    return 1
  if '천원' in tbl_text:
    return 1000
  return MILLION


def _parse_financial_tables(tables: list) -> dict[str, dict[str, float | None]]:
  """
  재무제표 테이블 목록에서 {db_col: {current, prior}} 형태로 파싱한다.
  테이블 열 구조: 계정명 | 당기세부 | 당기합계 | 전기세부 | 전기합계
  단위는 표별로 인식 — 표 텍스트에 '백만원'/'천원' 표기가 있으면 그에 맞춰 환산.
  """
  result: dict[str, dict[str, float | None]] = {}
  seen: set[str] = set()

  for tbl in tables:
    tbl_text = _normalize(tbl.get_text())
    if not any(kw in tbl_text for kw in ACCT_TO_DB):
      continue

    divider = _detect_unit_divider(tbl_text)

    rows = tbl.find_all('tr')
    for row in rows:
      cells = [td.get_text(strip=True) for td in row.find_all(['th', 'td'])]
      if len(cells) < 2:
        continue

      db_col = _match_acct(cells[0])
      if db_col is None or db_col in GENERATED_COLS or db_col in seen:
        continue

      # 셀 길이별 컬럼 위치 분기 (DART 감사보고서 표준 구조).
      # 6 cells: [계정명, 주석, 당기세부, 당기합계, 전기세부, 전기합계]
      # 5 cells: [계정명, 당기세부, 당기합계, 전기세부, 전기합계]
      # 4 cells: [계정명, 주석, 당기, 전기]
      # 3 cells: [계정명, 당기, 전기]
      # 2 cells: [계정명, 당기]
      # 주석 컬럼(cells[1])에 '25,26' 같은 주석 번호가 있으면 _parse_num이 2526으로
      # 잘못 파싱하므로, 6 cells일 때는 cells[1]을 항상 skip한다.
      curr: float | None = None
      prior: float | None = None
      if len(cells) >= 6:
        curr = _parse_num(cells[3]) or _parse_num(cells[2])
        prior = _parse_num(cells[5]) or _parse_num(cells[4])
      elif len(cells) == 5:
        curr = _parse_num(cells[2]) or _parse_num(cells[1])
        prior = _parse_num(cells[4]) or _parse_num(cells[3])
      elif len(cells) == 4:
        curr = _parse_num(cells[2])
        prior = _parse_num(cells[3])
      elif len(cells) == 3:
        curr = _parse_num(cells[1])
        prior = _parse_num(cells[2])
      else:
        curr = _parse_num(cells[1])

      if curr is not None:
        result[db_col] = {'current': curr / divider, 'prior': prior / divider if prior else None}
        seen.add(db_col)

  return _correct_unit_heuristic(result)


def _correct_unit_heuristic(parsed: dict[str, dict[str, float | None]]) -> dict[str, dict[str, float | None]]:
  """단위 미표기 표 휴리스틱 보정.

  자동차 부품사는 거의 모두 매출 100백만원(1억) 이상이므로,
  revenue가 100 미만이면 표가 "천원" 단위였는데 단위 분기가 "원"으로 잡힌 케이스로 가정 → 모든 값을 ×1000 보정.
  """
  rev = (parsed.get('revenue') or {}).get('current')
  if rev is None or rev <= 0 or rev >= 100:
    return parsed
  for col, vals in parsed.items():
    if vals.get('current') is not None:
      vals['current'] = vals['current'] * 1000
    if vals.get('prior') is not None:
      vals['prior'] = vals['prior'] * 1000
  return parsed


def _get_audit_rcpt(dart, corp_code: str, fiscal_year: int) -> str | None:
  """특정 회계연도의 결산감사보고서 rcpNo를 반환한다.
  final=False — [기재정정] 보고서를 포함해 조회한다. OpenDartReader 기본 final=True 는
  정정 처리된 보고서가 안 잡혀 동희그룹 등 일부 회사가 누락되는 사례 발견.
  """
  filings = dart.list(
    corp_code,
    start=f'{fiscal_year}-01-01',
    end=f'{fiscal_year + 1}-06-30',
    final=False,
  )
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
  raw = os.environ.get('TARGET_TICKERS', '').strip()
  target_filter: set[str] = {t.strip() for t in raw.split(',') if t.strip()}

  companies = [
    r for r in client.table('companies').select('id,ticker,name_kr,data_source').execute().data
    if r.get('data_source') == 'dart'
    and (not target_filter or r.get('ticker') in target_filter)
  ]
  if target_filter:
    logger.info(f'TARGET_TICKERS 필터 적용: {sorted(target_filter)} → {len(companies)}개')

  if not companies:
    logger.info('DART 수집 대상 기업 없음')
    return

  all_rows: list[dict] = []
  for company in companies:
    name = company['name_kr']
    company_id = company['id']

    logger.info(f'{name} DART 코드 검색 중...')
    try:
      corp_code = dart.find_corp_code(name)
    except Exception as e:
      logger.error(f'{name} corp_code 검색 실패: {e}')
      continue

    if not corp_code:
      logger.warning(f'{name}: DART 코드 없음 — 스킵')
      continue

    logger.info(f'{name}: corp_code={corp_code}')
    rows = _collect_company(dart, company_id, corp_code, years=_target_years())
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
