#!/usr/bin/env python3
"""현대차 IR sales-results 페이지에서 '미국/유럽 현지 판매' 버튼 존재 여부 audit.

목적: Phase 2C — retail 데이터 가용성 확인.
출력: 연도별 모든 .btn-download 텍스트 + 실제 파일 다운로드 1건(가장 최근 연도).
"""
import sys
from pathlib import Path

from loguru import logger
from playwright.sync_api import sync_playwright

from lib.bootstrap import init_script

init_script(__file__)

SOURCE_URL = 'https://www.hyundai.com/worldwide/ko/company/ir/ir-resources/sales-results'
AUDIT_YEARS = [2024, 2025]
DEST_DIR = Path(__file__).resolve().parent.parent / 'data' / '_hyundai_audit_retail'
DEST_DIR.mkdir(parents=True, exist_ok=True)


def main() -> None:
  with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(accept_downloads=True)
    page = ctx.new_page()
    page.set_default_timeout(60_000)
    page.goto(SOURCE_URL, wait_until='domcontentloaded')
    page.wait_for_timeout(3000)

    for year in AUDIT_YEARS:
      logger.info(f'=== {year}년 audit ===')
      try:
        page.locator('#field-sales-type .btn-dropdown').click()
        page.wait_for_timeout(400)
        page.locator(f'#field-sales-type .btn-option:has-text("{year}")').first.click()
        page.wait_for_timeout(2500)
      except Exception as e:
        logger.warning(f'{year}년 dropdown 실패: {e}')
        continue

      btns = page.locator('button.btn-download').all()
      logger.info(f'  버튼 개수: {len(btns)}')
      for i, b in enumerate(btns):
        try:
          text = b.inner_text().strip().replace('\n', ' ')
          logger.info(f'  [{i}] {text!r}')
        except Exception:
          pass

      # retail 후보: '미국'/'유럽'/'현지' 키워드 포함 버튼 시도
      retail_kws = ['미국', '유럽', '현지', 'Retail', 'retail']
      for kw in retail_kws:
        loc = page.locator(f'button.btn-download:has-text("{kw}")')
        n = loc.count()
        if n > 0:
          logger.info(f'  키워드 "{kw}" 일치 버튼 {n}개:')
          for j in range(n):
            t = loc.nth(j).inner_text().strip().replace('\n', ' ')
            logger.info(f'    -> {t!r}')
            if year == 2024:
              try:
                with page.expect_download(timeout=30_000) as dl_info:
                  loc.nth(j).click()
                dl = dl_info.value
                safe = ''.join(c if c.isalnum() else '_' for c in t)[:80]
                dest = DEST_DIR / f'{year}_{kw}_{j}_{safe}.xlsx'
                dl.save_as(str(dest))
                logger.success(f'    다운로드: {dest.name} ({dest.stat().st_size/1024:.0f} KB)')
              except Exception as e:
                logger.warning(f'    다운로드 실패: {e}')

    browser.close()


if __name__ == '__main__':
  main()
