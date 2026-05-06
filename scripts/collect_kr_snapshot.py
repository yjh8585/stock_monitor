#!/usr/bin/env python3
"""
국내 8개사 Snapshot 데이터 수집 (fnguide.com Playwright).

수집 항목:
- 시가총액       → companies.market_cap UPDATE
- 기업개요       → companies.business_summary UPDATE
- 대주주 현황    → shareholders upsert (holder_type='major')
- 주주구분 현황  → shareholders upsert (holder_type='category')
- 신용등급 CP    → credit_ratings upsert (rating_type='CP')
- 신용등급 Bond  → credit_ratings upsert (rating_type='Bond')
"""
import re
import sys
from datetime import date
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.companies import get_kr_companies
from lib.db import get_client, upsert_rows

# ──────────────────────────────────────────────
# 상수
# ──────────────────────────────────────────────

FNGUIDE_BASE_URL     = 'https://comp.fnguide.com'
FNGUIDE_SNAPSHOT_URL = (
  f'{FNGUIDE_BASE_URL}/SVO2/ASP/SVD_Main.asp'
  '?pGB=1&gicode={gicode}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=11&stkGb=701'
)
FNGUIDE_PAGE_TIMEOUT = 30_000   # 30초 (ms)
FNGUIDE_NAV_WAIT_MS  = 2_000   # 탭 전환 후 대기 (ms)

# 신용등급 문자열에서 날짜를 제거하는 패턴 (예: "AAA [2025/06/02]" → "AAA")
RATING_DATE_PATTERN = re.compile(r'\s*\[.*?\]')

# 신용등급 기관명 (fnguide 열 순서와 일치)
RATING_AGENCIES = ['KIS', 'KR', 'NICE']

# 주주현황 그리드 ID
GRID_MAJOR_SHAREHOLDERS = 'svdMainGrid4'
GRID_SHAREHOLDER_CATEGORIES = 'svdMainGrid5'
GRID_CREDIT_CP   = 'svdMainGrid6'
GRID_CREDIT_BOND = 'svdMainGrid7'


# ──────────────────────────────────────────────
# 유틸
# ──────────────────────────────────────────────

def _to_gicode(ticker: str) -> str:
  """6자리 종목코드를 fnguide gicode 형식(A + 6자리)으로 변환한다."""
  return f'A{ticker}'


def _parse_number(text: str) -> Optional[float]:
  """숫자 문자열(쉼표 포함)을 float으로 파싱한다. 실패 시 None 반환."""
  s = str(text).strip().replace(',', '').replace(' ', '')
  if s in ('', '-', 'N/A', 'NA', '--', 'None', 'null'):
    return None
  try:
    return float(s)
  except (ValueError, TypeError):
    return None


def _parse_percent(text: str) -> Optional[float]:
  """'25.30%' 또는 '25.30' 형태 문자열을 float으로 파싱한다."""
  s = str(text).strip().replace('%', '').replace(',', '')
  return _parse_number(s)


def _clean_rating(text: str) -> Optional[str]:
  """'AAA [2025/06/02]' 형태에서 날짜 부분을 제거해 등급 문자열만 반환한다."""
  cleaned = RATING_DATE_PATTERN.sub('', text).strip()
  if cleaned in ('', '-', 'N/A'):
    return None
  return cleaned


def _load_company_id_map() -> dict[str, str]:
  """DB에서 ticker → company_id 매핑을 로드한다."""
  rows = get_client().table('companies').select('id,ticker').execute().data
  return {r['ticker']: r['id'] for r in rows}


# ──────────────────────────────────────────────
# 파싱 함수
# ──────────────────────────────────────────────

def _parse_market_cap(page) -> Optional[float]:
  """Snapshot 페이지에서 시가총액(억원)을 파싱해 백만원 단위로 반환한다."""
  try:
    # svdMainGrid1 내 테이블에서 '시가총액(보통주,억원)' 행 탐색
    value_text: str = page.evaluate("""
      () => {
        const rows = document.querySelectorAll('#svdMainGrid1 table tbody tr');
        for (const tr of rows) {
          const cells = tr.querySelectorAll('td, th');
          if (cells.length >= 2) {
            const label = cells[0].innerText.trim();
            if (label.includes('시가총액')) {
              return cells[1].innerText.trim();
            }
          }
        }
        return null;
      }
    """)
    if value_text is None:
      return None
    val = _parse_number(value_text)
    # DB 컬럼 market_cap은 억원 단위로 저장
    return val
  except Exception as e:
    logger.debug(f"시가총액 파싱 실패: {e}")
    return None


def _parse_business_summary(page) -> Optional[str]:
  """Snapshot 페이지의 기업개요 li 항목을 합쳐 반환한다."""
  try:
    items: list[str] = page.evaluate("""
      () => Array.from(
        document.querySelectorAll('ul#bizSummaryContent li')
      ).map(li => li.innerText.trim()).filter(t => t.length > 0)
    """)
    if not items:
      return None
    return ' '.join(items)
  except Exception as e:
    logger.debug(f"기업개요 파싱 실패: {e}")
    return None


def _parse_grid_table(page, grid_id: str) -> tuple[list[str], list[list[str]]]:
  """지정 grid div 내 첫 번째 테이블의 헤더와 행을 추출한다."""
  try:
    result: dict = page.evaluate(f"""
      () => {{
        const grid = document.getElementById('{grid_id}');
        if (!grid) return {{headers: [], rows: []}};
        const tbl = grid.querySelector('table');
        if (!tbl) return {{headers: [], rows: []}};
        const headers = Array.from(
          tbl.querySelectorAll('thead tr:last-child th, thead tr:last-child td')
        ).map(el => el.innerText.trim());
        const rows = Array.from(tbl.querySelectorAll('tbody tr')).map(tr =>
          Array.from(tr.querySelectorAll('td, th')).map(td => td.innerText.trim())
        );
        return {{headers, rows}};
      }}
    """)
    return result.get('headers', []), result.get('rows', [])
  except Exception as e:
    logger.debug(f"그리드 {grid_id} 테이블 추출 실패: {e}")
    return [], []


def _parse_major_shareholders(page, company_id: str) -> list[dict]:
  """대주주 지분현황(svdMainGrid4)을 파싱해 shareholders 행을 반환한다.

  테이블 헤더: 항목 / 보통주 / 지분율 / 최종변동일
  """
  _, rows = _parse_grid_table(page, GRID_MAJOR_SHAREHOLDERS)
  result: list[dict] = []
  as_of_date = date.today().isoformat()

  for row in rows:
    if len(row) < 3:
      continue
    holder_name = row[0].strip()
    if not holder_name or holder_name in ('합계', '소계'):
      continue
    shares = _parse_number(row[1]) if len(row) > 1 else None
    pct    = _parse_percent(row[2]) if len(row) > 2 else None
    # 최종변동일이 있으면 해당 날짜 사용
    if len(row) > 3 and row[3].strip():
      raw_date = row[3].strip().replace('/', '-').replace('.', '-')
      m = re.match(r'(\d{4}-\d{2}-\d{2})', raw_date)
      as_of_date = m.group(1) if m else date.today().isoformat()

    result.append({
      'company_id':    company_id,
      'holder_type':   'major',
      'holder_name':   holder_name,
      'common_shares': shares,
      'ownership_pct': pct,
      'as_of_date':    as_of_date,
    })

  return result


def _parse_shareholder_categories(page, company_id: str) -> list[dict]:
  """주주구분 현황(svdMainGrid5)을 파싱해 shareholders 행을 반환한다.

  테이블 헤더: 주주구분 / 대표주주수 / 보통주 / 지분율 / 최종변동일
  """
  _, rows = _parse_grid_table(page, GRID_SHAREHOLDER_CATEGORIES)
  result: list[dict] = []
  as_of_date = date.today().isoformat()

  for row in rows:
    if len(row) < 2:
      continue
    holder_name = row[0].strip()
    if not holder_name:
      continue
    # 열 순서: 주주구분(0) / 대표주주수(1) / 보통주(2) / 지분율(3) / 최종변동일(4)
    shares = _parse_number(row[2]) if len(row) > 2 else None
    pct    = _parse_percent(row[3]) if len(row) > 3 else None
    if len(row) > 4 and row[4].strip():
      raw_date = row[4].strip().replace('/', '-').replace('.', '-')
      m = re.match(r'(\d{4}-\d{2}-\d{2})', raw_date)
      as_of_date = m.group(1) if m else date.today().isoformat()

    result.append({
      'company_id':    company_id,
      'holder_type':   'category',
      'holder_name':   holder_name,
      'common_shares': shares,
      'ownership_pct': pct,
      'as_of_date':    as_of_date,
    })

  return result


def _parse_credit_ratings(
  page,
  company_id: str,
  grid_id: str,
  rating_type: str,
) -> list[dict]:
  """신용등급 테이블(svdMainGrid6 or 7)을 파싱해 credit_ratings 행을 반환한다.

  열 구성: (행 라벨) / KIS / KR / NICE
  등급 형식: 'AAA [2025/06/02]' → 등급 'AAA', 날짜 '2025-06-02'
  """
  _, rows = _parse_grid_table(page, grid_id)
  result: list[dict] = []
  as_of = date.today().isoformat()

  for row in rows:
    if not row:
      continue
    # 기관별 열 처리 (열 1=KIS, 2=KR, 3=NICE)
    for col_idx, agency in enumerate(RATING_AGENCIES, start=1):
      if col_idx >= len(row):
        continue
      cell = row[col_idx].strip()
      rating = _clean_rating(cell)
      if rating is None:
        continue
      # '[YYYY/MM/DD]' 패턴에서 날짜 추출
      date_match = re.search(r'\[(\d{4})/(\d{2})/(\d{2})\]', cell)
      rated_at = (
        f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"
        if date_match
        else as_of
      )

      result.append({
        'company_id':  company_id,
        'rating_type': rating_type,
        'agency':      agency,
        'rating':      rating,
        'rating_date': rated_at,
      })

  return result


# ──────────────────────────────────────────────
# 회사별 스크레이핑
# ──────────────────────────────────────────────

def _update_company_info(
  company_id: str,
  market_cap: Optional[float],
  business_summary: Optional[str],
) -> None:
  """companies 테이블의 market_cap, business_summary를 UPDATE한다."""
  payload: dict = {}
  if market_cap is not None:
    payload['market_cap'] = market_cap
  if business_summary is not None:
    payload['business_summary'] = business_summary
  if not payload:
    return
  try:
    get_client().table('companies').update(payload).eq('id', company_id).execute()
    logger.debug(f"companies {company_id} UPDATE 완료: {list(payload.keys())}")
  except Exception as e:
    logger.error(f"companies {company_id} UPDATE 실패: {e}")


def _scrape_company(page, ticker: str, company_id: str) -> None:
  """단일 회사의 Snapshot 페이지를 스크레이핑해 DB에 반영한다."""
  gicode       = _to_gicode(ticker)
  snapshot_url = FNGUIDE_SNAPSHOT_URL.format(gicode=gicode)

  try:
    page.goto(snapshot_url, timeout=FNGUIDE_PAGE_TIMEOUT)
    page.wait_for_load_state('networkidle', timeout=FNGUIDE_PAGE_TIMEOUT)
    page.wait_for_timeout(FNGUIDE_NAV_WAIT_MS)
  except Exception as e:
    logger.error(f"KR {ticker}: Snapshot 페이지 로드 실패: {e}")
    return

  # 시가총액 + 기업개요 → companies UPDATE
  market_cap       = _parse_market_cap(page)
  business_summary = _parse_business_summary(page)
  _update_company_info(company_id, market_cap, business_summary)

  # 대주주 현황 upsert
  major_rows = _parse_major_shareholders(page, company_id)
  if major_rows:
    upsert_rows('shareholders', major_rows, 'company_id,holder_name,holder_type')

  # 주주구분 현황 upsert
  cat_rows = _parse_shareholder_categories(page, company_id)
  if cat_rows:
    upsert_rows('shareholders', cat_rows, 'company_id,holder_name,holder_type')

  # 신용등급 CP upsert
  cp_rows = _parse_credit_ratings(page, company_id, GRID_CREDIT_CP, 'CP')
  if cp_rows:
    upsert_rows('credit_ratings', cp_rows, 'company_id,rating_type,agency')

  # 신용등급 Bond upsert
  bond_rows = _parse_credit_ratings(page, company_id, GRID_CREDIT_BOND, 'Bond')
  if bond_rows:
    upsert_rows('credit_ratings', bond_rows, 'company_id,rating_type,agency')

  logger.info(
    f"KR {ticker}: market_cap={market_cap}, "
    f"대주주={len(major_rows)}, 주주구분={len(cat_rows)}, "
    f"CP={len(cp_rows)}, Bond={len(bond_rows)}"
  )


# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────

def collectKrSnapshot() -> None:
  """국내 8개사 Snapshot 데이터를 수집해 DB에 반영한다."""
  try:
    from playwright.sync_api import sync_playwright
  except ImportError:
    logger.error("playwright 미설치 — pip install playwright && playwright install chromium")
    sys.exit(1)

  id_map = _load_company_id_map()

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

        try:
          _scrape_company(page, ticker, company_id)
        except Exception as e:
          logger.error(f"KR {ticker} 수집 중 예외 발생: {e}")

    finally:
      browser.close()

  logger.info("국내 Snapshot 수집 완료")


if __name__ == '__main__':
  try:
    collectKrSnapshot()
  except Exception as e:
    logger.error(f"Snapshot 수집 실패: {e}")
    sys.exit(1)
