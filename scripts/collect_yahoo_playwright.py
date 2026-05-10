"""Playwright로 Yahoo Finance financials 페이지 직접 열어 매출/EBIT 추출.

사용:
  TARGET_TICKERS="HLE.DE,KBX.DE,..." python scripts/collect_yahoo_playwright.py

흐름 (회사별):
  1. https://finance.yahoo.com/quote/{ticker}/financials/ 이동
  2. consent banner 처리 (있으면 Accept)
  3. 'Total Revenue' / 'Operating Income' 행에서 fiscal_year별 값 추출
  4. DB upsert

회사 PC 보안 프로그램이 Playwright Chromium 차단할 수 있음.
이전 시도에서 `<process did exit: exitCode=1>` 발생 — 보안 정책 변경 시 재시도.
"""
import os
import re
import sys
import time
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows  # noqa: E402

URL_TPL = 'https://finance.yahoo.com/quote/{ticker}/financials/'


def _safe_num(s: str) -> float | None:
  s = (s or '').strip().replace(',', '')
  if not s or s == '--':
    return None
  # (1,234) = -1234
  is_neg = s.startswith('(') and s.endswith(')')
  if is_neg:
    s = s[1:-1]
  try:
    v = float(s)
    return -v if is_neg else v
  except ValueError:
    return None


def main():
  raw = os.environ.get('TARGET_TICKERS', '').strip()
  tickers = [t.strip() for t in raw.split(',') if t.strip()]
  if not tickers:
    sys.exit('TARGET_TICKERS 필요')

  client = get_client()
  rows = (
    client.table('companies').select('id,ticker,name,name_kr,country,currency')
    .in_('ticker', tickers).execute().data
  )
  if not rows:
    sys.exit('회사 없음')
  logger.info(f'대상 {len(rows)}개')

  try:
    from playwright.sync_api import sync_playwright
  except ImportError:
    sys.exit('playwright 미설치 — pip install playwright')

  upserts: list[dict] = []
  fail = []

  with sync_playwright() as pw:
    try:
      browser = pw.chromium.launch(headless=True)
    except Exception as e:
      logger.error(f'Chromium 실행 실패 (보안 프로그램?): {e}')
      sys.exit(2)

    ctx = browser.new_context(
      user_agent=(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      ),
      viewport={'width': 1280, 'height': 900},
    )
    page = ctx.new_page()

    for c in rows:
      ticker = c['ticker']
      logger.info(f'[{c["name_kr"]}] {ticker}')
      try:
        page.goto(URL_TPL.format(ticker=ticker), timeout=30_000, wait_until='domcontentloaded')
        time.sleep(2)

        # consent dialog 처리
        for sel in ['button[name="agree"]', 'button:has-text("Accept all")', 'button:has-text("I agree")']:
          try:
            btn = page.query_selector(sel)
            if btn:
              btn.click(timeout=2_000)
              time.sleep(1)
              break
          except Exception:
            pass

        # 페이지 본문에서 Total Revenue 행 찾기
        # Yahoo Finance financials는 div table 구조
        page.wait_for_load_state('networkidle', timeout=15_000)
        time.sleep(2)

        # JS로 row 텍스트 추출
        rows_js = page.evaluate(
          """
() => {
  const out = {};
  const rowsAll = Array.from(document.querySelectorAll('div[data-test*="fin-row"], div.tableBody div.row, div.table-body-container div.row, [class*="row"]'));
  // 너무 광범위, 다른 방법 시도
  // 일반적으로 div.tableContainer 안에 row.lv-0
  const possibleRows = Array.from(document.querySelectorAll('div[class*="row"]'));
  const labels = ['Total Revenue', 'Operating Income', 'Net Income Common Stockholders'];
  for (const lbl of labels) {
    for (const r of possibleRows) {
      const txt = r.innerText || '';
      if (txt.startsWith(lbl)) {
        out[lbl] = txt.split('\\n').slice(1, 8);  // 첫 번째는 라벨, 그 다음은 값들
        break;
      }
    }
  }
  // 헤더(연도) 추출
  const headers = Array.from(document.querySelectorAll('div[class*="column"] div[class*="title"]')).map(d => d.innerText.trim());
  out['_headers'] = headers.slice(0, 8);
  return out;
}
          """
        )

        if not rows_js or 'Total Revenue' not in rows_js:
          # 다른 방법: 본문 텍스트 일부 캡쳐
          body_text = page.evaluate('() => document.body.innerText')
          tr_idx = body_text.find('Total Revenue')
          if tr_idx >= 0:
            snippet = body_text[tr_idx:tr_idx + 500]
            logger.warning(f'  Total Revenue snippet: {snippet[:200]}')
          else:
            logger.warning('  Total Revenue 못 찾음')
          fail.append(ticker)
          continue

        logger.info(f'  headers: {rows_js.get("_headers", [])}')
        logger.info(f'  Total Revenue: {rows_js.get("Total Revenue")}')
        logger.info(f'  Operating Income: {rows_js.get("Operating Income")}')

        # 추출만 (DB upsert는 별도 검증 후)
      except Exception as e:
        logger.error(f'  예외: {e}')
        fail.append(ticker)

    browser.close()

  if fail:
    logger.warning(f'실패 {len(fail)}: {", ".join(fail)}')


if __name__ == '__main__':
  main()
