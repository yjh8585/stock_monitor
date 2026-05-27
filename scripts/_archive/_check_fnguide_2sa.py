"""인지디스플레이(155960) · 한국파워트레인(396470) fnguide 매출 직접 검증."""
import os, sys
from pathlib import Path
from dotenv import load_dotenv
from loguru import logger
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')
sys.path.insert(0, str(ROOT))

from collect_financials import _scrape_company_financials  # noqa: E402
from lib.db import get_client  # noqa: E402

TARGETS = [
  ('155960', '인지디스플레이'),
  ('396470', '한국파워트레인'),
]


def main() -> int:
  client = get_client()
  with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(
      user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
      viewport={'width': 1280, 'height': 900}, locale='ko-KR',
    )
    page = ctx.new_page()
    for ticker, name in TARGETS:
      logger.info(f'\n=== {name} ({ticker}) ===')
      cid = client.table('companies').select('id').eq('ticker', ticker).execute().data[0]['id']
      rows = _scrape_company_financials(page, ticker, cid, 'KRW')
      annual = [r for r in rows if r.get('period_type') == 'annual']
      annual.sort(key=lambda r: r['fiscal_year'], reverse=True)
      logger.info(f'  fnguide 추출 annual {len(annual)}건:')
      for r in annual[:6]:
        rev = r.get('revenue')
        op = r.get('operating_income')
        cons = r.get('consolidation')
        logger.info(f'    FY{r["fiscal_year"]} | {cons} | revenue={rev} | op={op}')
    browser.close()
  return 0


if __name__ == '__main__':
  sys.exit(main())
