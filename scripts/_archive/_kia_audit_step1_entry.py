#!/usr/bin/env python3
"""Kia IR audit - Step 1: 사이트 진입 탐색.

worldwide.kia.com → IR/Investors 메뉴 → Sales Results 페이지 후보 URL 탐색.
Playwright headless로 스크린샷 + HTML dump.

산출물:
  data/_kia_audit_screenshots/01_homepage.png
  data/_kia_audit_screenshots/02_ir_menu.png
  data/_kia_audit_screenshots/03_sales_results.png
  data/_kia_audit_logs/01_navigation.json
"""
import json
import sys
from pathlib import Path

from loguru import logger
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = PROJECT_ROOT / 'data' / '_kia_audit_screenshots'
LOG_DIR = PROJECT_ROOT / 'data' / '_kia_audit_logs'
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

# 후보 URL — 한국·영문 IR 페이지
CANDIDATE_URLS = [
  'https://worldwide.kia.com/int/company/ir/sales-results',
  'https://www.kia.com/kr/company/ir/sales-results',
  'https://worldwide.kia.com/int/company/ir',
  'https://www.kia.com/kr/company/ir',
]

PLAYWRIGHT_TIMEOUT_MS = 30_000


def explore_url(page, url: str, label: str) -> dict:
  """URL 탐색 + 스크린샷 + 메타데이터 수집."""
  result = {
    'url': url,
    'label': label,
    'final_url': None,
    'title': None,
    'status': None,
    'links': [],
    'buttons_download': [],
    'iframes': [],
    'error': None,
  }
  try:
    logger.info(f'Navigating to {url}')
    resp = page.goto(url, timeout=PLAYWRIGHT_TIMEOUT_MS, wait_until='networkidle')
    page.wait_for_timeout(2000)
    result['final_url'] = page.url
    result['title'] = page.title()
    result['status'] = resp.status if resp else None
    # 모든 href 수집 (IR 관련 키워드만 필터)
    links = page.evaluate("""() => {
      return Array.from(document.querySelectorAll('a[href]')).map(a => ({
        href: a.href,
        text: (a.innerText || a.textContent || '').trim().slice(0, 80),
      }));
    }""")
    keywords = ('sales', 'ir', 'investor', '판매', '실적', 'result', 'finance', 'quarter', 'earnings', '재무', '분기')
    result['links'] = [
      l for l in links
      if any(k.lower() in (l['href'] + l['text']).lower() for k in keywords)
    ][:60]
    # 다운로드 버튼 추정
    buttons = page.evaluate("""() => {
      const out = [];
      document.querySelectorAll('button, a.btn-download, a[href$=".xlsx"], a[href$=".xls"], a[href$=".pdf"]').forEach(el => {
        const t = (el.innerText || el.textContent || '').trim();
        if (t.length === 0) return;
        const cls = el.className || '';
        const href = el.getAttribute('href') || '';
        if (t.toLowerCase().includes('download') || t.includes('다운') || cls.includes('download') || href.match(/\\.(xlsx|xls|pdf)$/i)) {
          out.push({ tag: el.tagName, text: t.slice(0, 80), class: cls, href: href });
        }
      });
      return out;
    }""")
    result['buttons_download'] = buttons[:40]
    # iframe (IR 페이지가 iframe으로 외부 호스트 사용하는지)
    iframes = page.evaluate("""() => {
      return Array.from(document.querySelectorAll('iframe')).map(f => ({
        src: f.src, name: f.name, id: f.id,
      }));
    }""")
    result['iframes'] = iframes
    # 스크린샷
    safe_label = label.replace(' ', '_').replace('/', '_')
    shot_path = SCREENSHOT_DIR / f'{safe_label}.png'
    page.screenshot(path=str(shot_path), full_page=True)
    logger.info(f'  Screenshot saved: {shot_path.name}')
    logger.info(f'  Title: {result["title"]}')
    logger.info(f'  Final URL: {result["final_url"]}')
    logger.info(f'  Links matched: {len(result["links"])}, Download buttons: {len(result["buttons_download"])}, iframes: {len(result["iframes"])}')
  except Exception as e:
    result['error'] = str(e)
    logger.error(f'  Failed: {e}')
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
    for i, url in enumerate(CANDIDATE_URLS):
      label = f'{i+1:02d}_{url.replace("https://", "").replace("/", "_")[:60]}'
      r = explore_url(page, url, label)
      results.append(r)
    ctx.close()
    browser.close()
  log_path = LOG_DIR / '01_navigation.json'
  log_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
  logger.info(f'Saved: {log_path}')
  # 요약
  for r in results:
    print(f"  {r['url']} → status={r['status']}, links={len(r['links'])}, downloads={len(r['buttons_download'])}")


if __name__ == '__main__':
  main()
