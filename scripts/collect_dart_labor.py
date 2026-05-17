#!/usr/bin/env python3
"""
DART 연결감사보고서/사업보고서에서 비교 페이지 4개사의 인건비(+매출원가/판관비)를 추출.

인건비 분해표 패턴(다단 헤더: 계정과목 | 당기[제조원가/판관비/합계] | 전기[...])을
직접 탐지하여 인건비성 행(급여/퇴직급여/복리후생 등)을 합산하고,
합계 행의 "당기 제조원가"/"당기 판관비" 컬럼에서 cogs/sga도 함께 추출한다.

회사별로 다단 헤더가 아닌 단일 헤더 표(한세모빌리티의 종업원급여 1행 표 등)도 처리.
파싱 결과는 GOLDEN_2025와 ±1%p 이내인지 검증.
"""
import argparse
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client
from lib.labor_targets import (
  LABOR_REJECT, GOLDEN_2025, GOLDEN_TOLERANCE_PP, get_target,
)
from collect_dart_audit import (
  _get_audit_rcpt, _normalize, _parse_num, _detect_unit_divider,
  _with_retry, _fallback_viewer_url,
)

DART_KEY = os.environ.get('DART_API_KEY', '')
try:
  from dotenv import dotenv_values
  _env = dotenv_values(Path(__file__).parent / '.env')
  DART_KEY = DART_KEY or _env.get('DART_API_KEY', '')
except Exception:
  pass

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
TMP_DIR = Path(__file__).parent / '_tmp'

PRIOR_YEAR_KEYWORDS = ('전기', '직전', '前期')
TOTAL_KEYWORDS = ('합계', '소계', '총계')
COGS_KEYWORDS = ('제조원가', '매출원가')
SGA_KEYWORDS = ('판매비와관리비', '판매관리비', '판매비', '판관비')
MAX_TABLE_ROWS = 50  # 인건비 분해표용 (재무상태표 등 거대 표 회피)
MAX_INCOME_ROWS = 100  # 손익계산서는 세부 항목이 많아 더 큼
MIN_LABOR_ROW_MATCHES = 1


@dataclass
class BreakdownResult:
  labor_million: float
  cogs_million: float | None
  sga_million: float | None
  matched_labels: list[str]


def _get_dart():
  try:
    import OpenDartReader as ODR
    if not DART_KEY:
      logger.error('DART_API_KEY 없음')
      return None
    return ODR(DART_KEY)
  except ImportError:
    logger.error('pip install opendartreader')
    return None


def _all_sub_doc_urls(dart, rcpt_no: str) -> list[str]:
  try:
    docs = _with_retry(dart.sub_docs, rcpt_no, _deadline=60, _silence_stdout=True)
  except Exception as e:
    logger.warning(f'sub_docs 실패 (rcpNo={rcpt_no}): {e} — main.do fallback 사용')
    fb = _fallback_viewer_url(rcpt_no)
    return [fb] if fb else []
  if docs is None or docs.empty:
    fb = _fallback_viewer_url(rcpt_no)
    return [fb] if fb else []

  def length(u: str) -> int:
    m = re.search(r'length=(\d+)', str(u))
    return int(m.group(1)) if m else 0

  return sorted((str(u) for u in docs['url'].tolist()), key=length, reverse=True)


def _fetch_html(url: str) -> str | None:
  try:
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.encoding = r.apparent_encoding or 'utf-8'
    return r.text
  except Exception as e:
    logger.error(f'HTML 수집 실패 ({url}): {e}')
    return None


def _is_prior(txt: str) -> bool:
  norm = _normalize(txt)
  return any(kw in norm for kw in PRIOR_YEAR_KEYWORDS)


def _row_cells(row) -> list[str]:
  return [c.get_text(strip=True) for c in row.find_all(['th', 'td'])]


def _table_unit_divider(table) -> int:
  """표 본문 + 직전 5개 sibling 텍스트에서 단위 인식 (단위 표기가 표 위에 있는 경우 회피)."""
  text = _normalize(table.get_text())
  prev = table
  for _ in range(5):
    prev = prev.find_previous(['p', 'div', 'td', 'b', 'strong'])
    if prev is None:
      break
    text += ' ' + _normalize(prev.get_text())
  return _detect_unit_divider(text)


def _skip_unit_rows(rows: list) -> int:
  """단위 표기(1셀) 행을 skip하고 첫 멀티셀 행 인덱스 반환."""
  for i, r in enumerate(rows):
    if len(_row_cells(r)) >= 2:
      return i
  return len(rows)


def _parse_table(table, labor_keywords: list[str]) -> BreakdownResult | None:
  """비용의 성격별 분류/부가가치 분해표에서 인건비 + 매출원가/판관비 추출.

  지원 표 형식:
    (a) 단순:
        ROW0?: (단위:천원)
        ROW1: 계정과목 | 당기 | 전기
        ROW2~: 라벨 | 당기값 | 전기값
    (b) 다단 헤더:
        ROW0?: (단위:천원)
        ROW1: 계정과목 | 당기 | 전기                          (셀 수 = G+1)
        ROW2: 제조원가 | 판관비 | 합계 | 제조원가 | 판관비 | 합계   (셀 수 = G * sub_n)
        ROW3~: 라벨 | (G * sub_n)개의 숫자                      (셀 수 = G*sub_n + 1)
  """
  rows = table.find_all('tr')
  if len(rows) > MAX_TABLE_ROWS or len(rows) < 3:
    return None

  start = _skip_unit_rows(rows)
  if start >= len(rows) - 1:
    return None

  r0 = _row_cells(rows[start])
  r1 = _row_cells(rows[start + 1]) if start + 1 < len(rows) else []

  is_multi = len(r1) > len(r0) and len(r0) >= 2
  cogs_col: int | None = None
  sga_col: int | None = None
  total_col: int | None = None
  current_cols: list[int] = []
  data_start: int

  if is_multi and len(r0) >= 2:
    group_size = len(r1) // (len(r0) - 1)
    data_start = start + 2
    for gi, top in enumerate(r0[1:]):
      is_prior = _is_prior(top)
      for si in range(group_size):
        col_in_sub = gi * group_size + si
        if col_in_sub >= len(r1):
          continue
        sub = _normalize(r1[col_in_sub])
        data_idx = col_in_sub + 1
        if is_prior:
          continue
        current_cols.append(data_idx)
        if any(kw in sub for kw in TOTAL_KEYWORDS):
          total_col = data_idx
        elif any(kw in sub for kw in COGS_KEYWORDS):
          cogs_col = data_idx
        elif any(kw in sub for kw in SGA_KEYWORDS):
          sga_col = data_idx
  else:
    data_start = start + 1
    for i, txt in enumerate(r0):
      if i == 0:
        continue
      if not _is_prior(txt):
        current_cols.append(i)
    if not current_cols and len(r0) > 1:
      current_cols = list(range(1, len(r0)))

  if not current_cols:
    return None

  labor_cols = [total_col] if total_col is not None else current_cols

  labor_total = 0.0
  matched: list[tuple[str, float]] = []
  grand_cogs: float | None = None
  grand_sga: float | None = None

  for row in rows[data_start:]:
    cells = _row_cells(row)
    if not cells:
      continue
    label = cells[0]
    label_norm = _normalize(label)

    if any(kw in label_norm for kw in TOTAL_KEYWORDS):
      if cogs_col is not None and cogs_col < len(cells):
        v = _parse_num(cells[cogs_col])
        if v is not None:
          grand_cogs = v
      if sga_col is not None and sga_col < len(cells):
        v = _parse_num(cells[sga_col])
        if v is not None:
          grand_sga = v
      continue

    if not any(_normalize(kw) in label_norm for kw in labor_keywords):
      continue
    if any(rej in label_norm for rej in LABOR_REJECT):
      continue

    row_sum = 0.0
    for ci in labor_cols:
      if ci is None or ci >= len(cells):
        continue
      num = _parse_num(cells[ci])
      if num is not None:
        row_sum += num
    if row_sum > 0:
      labor_total += row_sum
      matched.append((label, row_sum))

  if len(matched) < MIN_LABOR_ROW_MATCHES or labor_total <= 0:
    return None

  divider = _table_unit_divider(table)
  return BreakdownResult(
    labor_million=labor_total / divider,
    cogs_million=grand_cogs / divider if grand_cogs is not None else None,
    sga_million=grand_sga / divider if grand_sga is not None else None,
    matched_labels=[m[0] for m in matched],
  )


def _extract_income_statement(soup: BeautifulSoup) -> tuple[float | None, float | None]:
  """손익계산서 표(매출원가+판관비 행 보유)에서 당기 cogs/sga 추출.
  헤더 "제 N 기" 가장 큰 N이 당기. 데이터 행 셀 수가 헤더보다 많으면 다단 헤더로 처리.
  """
  for tbl in soup.find_all('table'):
    rows = tbl.find_all('tr')
    if len(rows) > MAX_INCOME_ROWS or len(rows) < 4:
      continue

    labels: list[str] = []
    for r in rows:
      first = r.find(['td', 'th'])
      labels.append(_normalize(first.get_text()) if first else '')
    has_cogs = any('매출원가' in l and '율' not in l and '총이익' not in l for l in labels)
    has_sga = any(any(kw in l for kw in SGA_KEYWORDS) for l in labels)
    if not (has_cogs and has_sga):
      continue

    start = _skip_unit_rows(rows)
    if start >= len(rows):
      continue
    r0 = _row_cells(rows[start])

    # 첫 데이터 행의 셀 수로 다단 헤더 추정
    data_cells_len = 0
    for r in rows[start + 1:]:
      cl = len(_row_cells(r))
      if cl > 0:
        data_cells_len = cl
        break
    if data_cells_len == 0:
      continue

    # 헤더 컬럼별 "제 N 기" 매핑 — 가장 큰 N이 당기
    col_period: dict[int, int] = {}
    for i, txt in enumerate(r0):
      m = re.search(r'제\s*(\d+)', txt)
      if m:
        col_period[i] = int(m.group(1))

    if col_period and data_cells_len > len(r0):
      current_header = max(col_period, key=lambda k: col_period[k])
      group_size = (data_cells_len - 1) // max(1, len(r0) - 1)
      current_col = current_header * group_size  # 그룹 내 마지막 sub-column(보통 합계)
    elif col_period:
      current_col = max(col_period, key=lambda k: col_period[k])
    else:
      current_col = None
      for i, txt in enumerate(r0):
        if i == 0:
          continue
        if _is_prior(txt) or '주석' in _normalize(txt):
          continue
        current_col = i
        break
    if current_col is None:
      continue

    cogs_val: float | None = None
    sga_val: float | None = None
    for row in rows[start + 1:]:
      cells = _row_cells(row)
      if not cells or current_col >= len(cells):
        continue
      label = _normalize(cells[0])
      if cogs_val is None and '매출원가' in label and '율' not in label and '총이익' not in label:
        cogs_val = _parse_num(cells[current_col])
      if sga_val is None and any(kw in label for kw in SGA_KEYWORDS):
        sga_val = _parse_num(cells[current_col])
      if cogs_val is not None and sga_val is not None:
        break

    if cogs_val is None and sga_val is None:
      continue
    divider = _table_unit_divider(tbl)
    return (
      cogs_val / divider if cogs_val is not None else None,
      sga_val / divider if sga_val is not None else None,
    )
  return None, None


def _table_has_labor_pattern(table, labor_keywords: list[str]) -> bool:
  """표가 인건비 분해 패턴인지 빠른 사전 검증."""
  text = _normalize(table.get_text())
  # 다단 헤더 패턴(제조원가+판관비+합계) 또는 단순(당기+전기) + 인건비 키워드 1개 이상
  if not any(kw in text for kw in PRIOR_YEAR_KEYWORDS):
    return False
  if sum(1 for kw in labor_keywords if _normalize(kw) in text) < 1:
    return False
  return True


def _find_candidate_tables(soup: BeautifulSoup, target: dict) -> list:
  """섹션 헤더 매칭 + 표 자체 패턴 매칭으로 후보 표 모음.
  중복 제거 후 등장 순서대로 반환.
  """
  candidates: list = []

  for sec in target['section_candidates']:
    sec_norm = _normalize(sec)
    for tag in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'b', 'strong', 'td']):
      text = _normalize(tag.get_text())
      if not text or sec_norm not in text or len(text) > 500:
        continue
      for tbl in tag.find_all_next('table', limit=4):
        if tbl not in candidates:
          candidates.append(tbl)

  # 표 자체 패턴 매칭 fallback
  for tbl in soup.find_all('table'):
    if tbl in candidates:
      continue
    if _table_has_labor_pattern(tbl, target['labor_keywords']):
      candidates.append(tbl)

  return candidates


def _find_report_rcpt(dart, corp_code: str, fiscal_year: int) -> str | None:
  rcpt_no, _, _ = _get_audit_rcpt(dart, corp_code, fiscal_year)
  if rcpt_no:
    return rcpt_no
  filings = dart.list(
    corp_code,
    start=f'{fiscal_year}-01-01',
    end=f'{fiscal_year + 1}-06-30',
    final=False,
  )
  if filings is None or filings.empty:
    return None
  for _, row in filings.iterrows():
    rpt = str(row.get('report_nm', ''))
    if '사업보고서' in rpt and str(fiscal_year) in rpt:
      return str(row['rcept_no'])
  return None


def _dump_failure(name: str, year: int, html: str) -> None:
  TMP_DIR.mkdir(exist_ok=True)
  path = TMP_DIR / f'labor_{name}_{year}.html'
  path.write_text(html, encoding='utf-8')
  logger.warning(f'  파싱 실패 → {path}')


def _extract(dart, corp_code: str, name: str, year: int) -> BreakdownResult | None:
  rcpt_no = _find_report_rcpt(dart, corp_code, year)
  if not rcpt_no:
    logger.warning(f'  {year}년 감사/사업 보고서 없음')
    return None

  urls = _all_sub_doc_urls(dart, rcpt_no)
  if not urls:
    logger.warning(f'  {year}년 sub_docs 없음')
    return None

  target = get_target(name)
  last_html = ''

  for url in urls:
    html = _fetch_html(url)
    if not html:
      continue
    last_html = html
    soup = BeautifulSoup(html, 'html.parser')

    for table in _find_candidate_tables(soup, target):
      result = _parse_table(table, target['labor_keywords'])
      if result is None:
        continue
      # cogs/sga는 손익계산서 값을 우선시 (성격별 분류표의 제조원가는 손익계산서 매출원가와 의미가 다름)
      is_cogs, is_sga = _extract_income_statement(soup)
      if is_cogs is not None:
        result.cogs_million = is_cogs
      if is_sga is not None:
        result.sga_million = is_sga
      cogs_str = f'{result.cogs_million:,.0f}' if result.cogs_million else '-'
      sga_str = f'{result.sga_million:,.0f}' if result.sga_million else '-'
      logger.info(
        f'  {year}년 매칭행={result.matched_labels} '
        f'→ labor={result.labor_million:,.0f}M, cogs={cogs_str}M, sga={sga_str}M'
      )
      return result

  _dump_failure(name, year, last_html)
  return None


def _validate_golden(name: str, year: int, labor_million: float, revenue_million: float | None) -> bool:
  if year != 2025 or not revenue_million or revenue_million <= 0:
    return True
  expected = GOLDEN_2025.get(name)
  if expected is None:
    return True
  actual = labor_million / revenue_million
  diff_pp = abs(actual - expected) * 100
  ok = diff_pp <= GOLDEN_TOLERANCE_PP
  level = logger.info if ok else logger.error
  level(
    f'  GOLDEN[{"OK" if ok else "FAIL"}] {name} {year}: '
    f'actual={actual * 100:.2f}% expected={expected * 100:.2f}% diff={diff_pp:.2f}pp'
  )
  return ok


def _update_financials(
  client, company_id: str, fiscal_year: int, result: BreakdownResult
) -> int:
  payload: dict = {'labor_cost': int(round(result.labor_million))}
  if result.cogs_million is not None and result.cogs_million > 0:
    payload['cogs'] = int(round(result.cogs_million))
  if result.sga_million is not None and result.sga_million > 0:
    payload['sga'] = int(round(result.sga_million))

  res = (
    client.table('financials')
    .update(payload)
    .eq('company_id', company_id)
    .eq('period_type', 'annual')
    .eq('fiscal_year', fiscal_year)
    .is_('fiscal_quarter', 'null')
    .execute()
  )
  return len(res.data) if res.data else 0


def collect_dart_labor(target_years: list[int]) -> int:
  if not DART_KEY:
    logger.error('DART_API_KEY 없음. scripts/.env에 추가하세요.')
    sys.exit(1)

  dart = _get_dart()
  if not dart:
    sys.exit(1)

  client = get_client()
  # 비교 페이지(company_pages.page='compare')에 매핑된 회사를 자동 수집 대상으로 사용
  companies = (
    client.table('companies')
    .select('id,name_kr,company_pages!inner(page)')
    .eq('company_pages.page', 'compare')
    .execute().data
  )
  if not companies:
    logger.error("company_pages.page='compare' 매핑된 회사 없음. 마이그레이션 20260513000004 적용 필요.")
    return 0
  logger.info(f'비교 페이지 대상 회사: {[c["name_kr"] for c in companies]}')

  company_ids = [c['id'] for c in companies]
  existing = (
    client.table('financials')
    .select('company_id,fiscal_year,revenue')
    .in_('company_id', company_ids)
    .eq('period_type', 'annual')
    .is_('fiscal_quarter', 'null')
    .execute().data
  )
  rev_map: dict[tuple[str, int], float] = {
    (r['company_id'], r['fiscal_year']): r['revenue']
    for r in existing if r.get('revenue')
  }

  updated_total = 0
  all_pass = True

  for c in companies:
    name = c['name_kr']
    company_id = c['id']
    logger.info(f'=== {name} ===')

    try:
      import OpenDartReader as ODR
      corp_code = ODR(DART_KEY).find_corp_code(name)
    except Exception as e:
      logger.error(f'{name} corp_code 검색 실패: {e}')
      continue
    if not corp_code:
      logger.warning(f'{name} corp_code 없음')
      continue

    for year in target_years:
      result = _extract(dart, corp_code, name, year)
      if result is None:
        continue

      ok = _validate_golden(name, year, result.labor_million, rev_map.get((company_id, year)))
      all_pass = all_pass and ok

      n = _update_financials(client, company_id, year, result)
      if n == 0:
        logger.warning(f'  {year}년 financials row 없음 — 업데이트 미반영')
      else:
        updated_total += n

  if updated_total > 0:
    try:
      from lib.revalidate import revalidate_for_tables
      revalidate_for_tables(['financials'])
    except Exception as e:
      logger.debug(f'revalidate skip: {e}')

  logger.info(f'인건비 수집 완료: {updated_total}행 업데이트')
  if not all_pass:
    logger.error('GOLDEN 검증 실패 — 매핑/파싱 로직 점검 필요')
    sys.exit(2)
  return updated_total


def _parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description='DART 인건비 수집')
  p.add_argument('--year', type=int, action='append', help='수집할 회계연도 (반복 가능). 미지정 시 직전 4년치.')
  return p.parse_args()


if __name__ == '__main__':
  args = _parse_args()
  if args.year:
    years = sorted(set(args.year), reverse=True)
  else:
    this_year = datetime.now().year
    years = [this_year - i for i in range(1, 5)]

  logger.info(f'대상 연도: {years}')
  try:
    collect_dart_labor(years)
  except SystemExit:
    raise
  except Exception as e:
    import traceback
    logger.error(f'인건비 수집 실패: {e}\n{traceback.format_exc()}')
    sys.exit(1)
