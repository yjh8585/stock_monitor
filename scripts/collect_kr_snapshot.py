#!/usr/bin/env python3
"""
국내 active 한국 상장사들의 fnguide Snapshot 페이지에서 기업개요(bizSummaryContent)만 수집한다.

수집 항목 분담:
- 기업개요 → companies.business_summary  (이 스크립트)
- PER/PBR/EV-EBITDA → financials (collect_financials.py가 이미 분기 1회 fnguide로 수집)
- 시가총액·주가 → companies.market_cap/last_price (collect_prices_live.py가 pykrx로 매시간)

운영: 분기 1회 (collect-financials.yml에 step으로 통합 실행).
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
FNGUIDE_NAV_WAIT_MS  = 2_000    # 페이지 안정화 대기 (ms)


# ──────────────────────────────────────────────
# 유틸
# ──────────────────────────────────────────────

def _to_gicode(ticker: str) -> str:
  """6자리 종목코드를 fnguide gicode 형식(A + 6자리)으로 변환한다."""
  return f'A{ticker}'


def _load_company_id_map() -> dict[str, str]:
  """DB에서 ticker → company_id 매핑을 로드한다."""
  rows = get_client().table('companies').select('id,ticker').execute().data
  return {r['ticker']: r['id'] for r in rows}


# ──────────────────────────────────────────────
# 파싱·DB
# ──────────────────────────────────────────────

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


def _update_business_summary(company_id: str, summary: Optional[str]) -> None:
  """companies.business_summary만 갱신 (시총·주가는 pykrx 담당이라 손대지 않음)."""
  if not summary:
    return
  try:
    (
      get_client()
      .table('companies')
      .update({'business_summary': summary})
      .eq('id', company_id)
      .execute()
    )
  except Exception as e:
    logger.error(f"companies {company_id} business_summary 갱신 실패: {e}")


# ──────────────────────────────────────────────
# 스크레이핑
# ──────────────────────────────────────────────

def _scrape_company(page, ticker: str, company_id: str) -> None:
  """단일 회사 Snapshot 페이지에서 기업개요 추출 후 DB UPDATE."""
  gicode       = _to_gicode(ticker)
  snapshot_url = FNGUIDE_SNAPSHOT_URL.format(gicode=gicode)

  try:
    page.goto(snapshot_url, timeout=FNGUIDE_PAGE_TIMEOUT)
    page.wait_for_load_state('networkidle', timeout=FNGUIDE_PAGE_TIMEOUT)
    page.wait_for_timeout(FNGUIDE_NAV_WAIT_MS)
  except Exception as e:
    logger.error(f"KR {ticker}: Snapshot 페이지 로드 실패: {e}")
    return

  summary = _parse_business_summary(page)
  _update_business_summary(company_id, summary)
  logger.info(f"KR {ticker}: business_summary={'OK' if summary else '미수집'}")


# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────

def collectKrSnapshot() -> None:
  """국내 active 한국 상장사들의 기업개요를 fnguide Snapshot에서 수집해 DB 반영."""
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

  logger.info("국내 기업개요 수집 완료")


if __name__ == '__main__':
  try:
    collectKrSnapshot()
  except Exception as e:
    logger.error(f"기업개요 수집 실패: {e}")
    sys.exit(1)
