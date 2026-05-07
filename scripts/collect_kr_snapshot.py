#!/usr/bin/env python3
"""
국내 8개사 Snapshot 데이터 수집 (fnguide.com Playwright).

수집 항목:
- 시가총액 → companies.market_cap UPDATE
- 기업개요 → companies.business_summary UPDATE
"""
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.companies import get_kr_companies
from lib.db import get_client

# ──────────────────────────────────────────────
# 상수
# ──────────────────────────────────────────────

FNGUIDE_BASE_URL     = 'https://comp.fnguide.com'
FNGUIDE_SNAPSHOT_URL = (
  f'{FNGUIDE_BASE_URL}/SVO2/ASP/SVD_Main.asp'
  '?pGB=1&gicode={gicode}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=11&stkGb=701'
)
FNGUIDE_PAGE_TIMEOUT = 30_000   # 30초 (ms)
FNGUIDE_NAV_WAIT_MS  = 2_000    # 탭 전환 후 대기 (ms)


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


def _load_company_id_map() -> dict[str, str]:
  """DB에서 ticker → company_id 매핑을 로드한다."""
  rows = get_client().table('companies').select('id,ticker').execute().data
  return {r['ticker']: r['id'] for r in rows}


# ──────────────────────────────────────────────
# 파싱 함수
# ──────────────────────────────────────────────

def _parse_market_cap(page) -> Optional[float]:
  """Snapshot 페이지에서 시가총액(억원)을 파싱해 반환한다."""
  try:
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
    return _parse_number(value_text)
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

  market_cap       = _parse_market_cap(page)
  business_summary = _parse_business_summary(page)
  _update_company_info(company_id, market_cap, business_summary)

  logger.info(f"KR {ticker}: market_cap={market_cap}")


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
