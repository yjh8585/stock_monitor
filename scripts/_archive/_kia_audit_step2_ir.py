#!/usr/bin/env python3
"""Kia IR audit - Step 2: IR 서브 페이지 탐색.

worldwide.kia.com IR 메뉴의 sales / financial / library 하위 페이지를
모두 방문해서 다운로드 버튼·엑셀/PDF 링크 수집.
"""
import json
from pathlib import Path

from loguru import logger
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = PROJECT_ROOT / 'data' / '_kia_audit_screenshots'
LOG_DIR = PROJECT_ROOT / 'data' / '_kia_audit_logs'

# Step 1에서 발견한 IR 입구 + ko/en 양쪽 후보
CANDIDATE_URLS = [
  # Korean IR
  ('ko_ir_home', 'https://worldwide.kia.com/ko/company/investor-relations/'),
  ('ko_sales', 'https://worldwide.kia.com/ko/company/investor-relations/sales/'),
  ('ko_sales_monthly', 'https://worldwide.kia.com/ko/company/investor-relations/sales/sales-results/'),
  ('ko_sales_results', 'https://worldwide.kia.com/ko/company/investor-relations/sales-results/'),
  ('ko_financial', 'https://worldwide.kia.com/ko/company/investor-relations/financial/'),
  ('ko_financial_summary', 'https://worldwide.kia.com/ko/company/investor-relations/financial/summary-statements/'),
  ('ko_library', 'https://worldwide.kia.com/ko/company/investor-relations/library/'),
  ('ko_library_ir', 'https://worldwide.kia.com/ko/company/investor-relations/library/ir-activities/'),
  # English IR
  ('en_ir_home', 'https://worldwide.kia.com/en/company/investor-relations/'),
  ('en_sales', 'https://worldwide.kia.com/en/company/investor-relations/sales/'),
  ('en_sales_results', 'https://worldwide.kia.com/en/company/investor-relations/sales/sales-results/'),
  ('en_financial', 'https://worldwide.kia.com/en/company/investor-relations/financial/'),
  ('en_financial_summary', 'https://worldwide.kia.com/en/company/investor-relations/financial/summary-statements/'),
  ('en_library', 'https://worldwide.kia.com/en/company/investor-relations/library/'),
  ('en_library_ir', 'https://worldwide.kia.com/en/company/investor-relations/library/ir-activities/'),
]

PLAYWRIGHT_TIMEOUT_MS = 30_000


def explore(page, label: str, url: str) -> dict:
  result = {
    'label': label, 'url': url, 'final_url': None, 'title': None,
    'status': None, 'links': [], 'download_buttons': [],
    'all_buttons': [], 'tables_summary': None, 'iframes': [],
    'select_options': [], 'error': None,
  }
  try:
    resp = page.goto(url, timeout=PLAYWRIGHT_TIMEOUT_MS, wait_until='networkidle')
    page.wait_for_timeout(2500)
    result['final_url'] = page.url
    result['title'] = page.title()
    result['status'] = resp.status if resp else None

    # 모든 링크 (전부 수집 — 분석 단계에서 필터)
    links = page.evaluate("""() => {
      return Array.from(document.querySelectorAll('a[href]')).map(a => ({
        href: a.href,
        text: (a.innerText || a.textContent || '').trim().slice(0, 100),
        class: a.className || '',
      }));
    }""")
    # IR 페이지 내부에서만 수집 (외부 nav 메뉴 제외)
    result['links'] = [
      l for l in links
      if l['href'] and ('investor' in l['href'].lower() or 'sales' in l['href'].lower()
                        or l['href'].endswith(('.xlsx', '.xls', '.pdf', '.csv'))
                        or 'download' in l['href'].lower() or 'attach' in l['href'].lower())
    ][:80]

    # 다운로드 버튼/아이콘
    downloads = page.evaluate("""() => {
      const out = [];
      document.querySelectorAll('button, a').forEach(el => {
        const t = (el.innerText || el.textContent || '').trim();
        const cls = el.className || '';
        const href = el.getAttribute('href') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        if (t.toLowerCase().includes('download') ||
            t.includes('다운') ||
            t.includes('내려받기') ||
            cls.toLowerCase().includes('download') ||
            ariaLabel.toLowerCase().includes('download') ||
            href.match(/\\.(xlsx|xls|pdf|csv)$/i)) {
          out.push({ tag: el.tagName, text: t.slice(0, 100), class: cls, href: href, aria: ariaLabel });
        }
      });
      return out;
    }""")
    result['download_buttons'] = downloads[:50]

    # select 옵션 (연도 dropdown 등)
    selects = page.evaluate("""() => {
      return Array.from(document.querySelectorAll('select')).map(s => ({
        id: s.id, name: s.name, class: s.className,
        options: Array.from(s.options).map(o => o.value + ':' + o.textContent.trim()).slice(0, 30),
      }));
    }""")
    result['select_options'] = selects

    # iframe
    iframes = page.evaluate("""() => {
      return Array.from(document.querySelectorAll('iframe')).map(f => ({
        src: f.src, name: f.name, id: f.id,
      }));
    }""")
    result['iframes'] = [f for f in iframes if f['src']]

    # 테이블 개수
    tables = page.evaluate("""() => {
      const t = document.querySelectorAll('table');
      return { count: t.length, headers: Array.from(t).slice(0, 3).map(tb =>
        Array.from(tb.querySelectorAll('th')).slice(0, 10).map(th => th.textContent.trim().slice(0, 30))) };
    }""")
    result['tables_summary'] = tables

    shot = SCREENSHOT_DIR / f'step2_{label}.png'
    page.screenshot(path=str(shot), full_page=True)
    logger.info(f'  {label}: status={result["status"]}, links={len(result["links"])}, dl={len(result["download_buttons"])}, tables={tables["count"]}, iframes={len(result["iframes"])}, selects={len(selects)}')
  except Exception as e:
    result['error'] = str(e)
    logger.error(f'  {label} FAIL: {e}')
  return result


def main():
  results = []
  with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(
      user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      locale='ko-KR',
      viewport={'width': 1440, 'height': 900},
    )
    page = ctx.new_page()
    for label, url in CANDIDATE_URLS:
      logger.info(f'>> {label}: {url}')
      r = explore(page, label, url)
      results.append(r)
    ctx.close()
    browser.close()
  log_path = LOG_DIR / '02_ir_pages.json'
  log_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
  logger.info(f'Saved: {log_path}')
  for r in results:
    print(f"  {r['label']:40s} status={r['status']} links={len(r['links']):3d} dl={len(r['download_buttons']):2d} tables={r['tables_summary']['count'] if r['tables_summary'] else 0}")


if __name__ == '__main__':
  main()
