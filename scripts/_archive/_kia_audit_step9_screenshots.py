#!/usr/bin/env python3
"""Step 9: 최종 정리된 페이지 스크린샷 (보고서 첨부용)."""
from pathlib import Path

from loguru import logger
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = PROJECT_ROOT / 'data' / '_kia_audit_screenshots'

TARGETS = [
  ('kia_perf_plans_ko_final', 'https://worldwide.kia.com/ko/company/investor-relations/library/performance-and-plans/'),
  ('kia_reports_ko_final', 'https://worldwide.kia.com/ko/company/investor-relations/financial/reports/'),
  ('kia_finance_graphs_ko_final', 'https://worldwide.kia.com/ko/company/investor-relations/financial/financial-graphs/'),
  ('kia_finance_summary_ko_final', 'https://worldwide.kia.com/ko/company/investor-relations/financial/summary-statements/'),
]


def main():
  with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True)
    c = b.new_context(
      locale='ko-KR',
      user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport={'width': 1440, 'height': 900},
    )
    p = c.new_page()
    for label, url in TARGETS:
      try:
        p.goto(url, wait_until='networkidle', timeout=45_000)
        p.wait_for_timeout(3500)
        for _ in range(3):
          p.evaluate("window.scrollBy(0, 600)")
          p.wait_for_timeout(400)
        p.evaluate("window.scrollTo(0, 0)")
        p.wait_for_timeout(1000)
        out = SCREENSHOT_DIR / f'{label}.png'
        p.screenshot(path=str(out), full_page=True)
        logger.info(f'  {out.name} saved')
      except Exception as e:
        logger.error(f'  {label}: {e}')
    c.close()
    b.close()


if __name__ == '__main__':
  main()
