#!/usr/bin/env python3
"""Kia IR audit - Step 3: 핵심 페이지 깊이 탐색.

발견된 IR 페이지 위주로 다운로드 자원 모두 인벤토리.
- library/performance-and-plans (Quarterly Business Results)
- library/ir-activities (CEO Investor Day, IR Activities)
- financial/summary-statements
- financial/financial-graphs
- financial/reports

기다림과 click을 통해 동적 컨텐츠를 모두 노출시킨다.
"""
import json
import time
from pathlib import Path

from loguru import logger
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = PROJECT_ROOT / 'data' / '_kia_audit_screenshots'
LOG_DIR = PROJECT_ROOT / 'data' / '_kia_audit_logs'

CANDIDATE_URLS = [
  ('perf_plans_ko', 'https://worldwide.kia.com/ko/company/investor-relations/library/performance-and-plans/'),
  ('perf_plans_en', 'https://worldwide.kia.com/en/company/investor-relations/library/performance-and-plans/'),
  ('ir_activities_ko', 'https://worldwide.kia.com/ko/company/investor-relations/library/ir-activities/'),
  ('reports_ko', 'https://worldwide.kia.com/ko/company/investor-relations/financial/reports/'),
  ('reports_en', 'https://worldwide.kia.com/en/company/investor-relations/financial/reports/'),
  ('finance_graphs_ko', 'https://worldwide.kia.com/ko/company/investor-relations/financial/financial-graphs/'),
  ('finance_summary_ko', 'https://worldwide.kia.com/ko/company/investor-relations/financial/summary-statements/'),
  ('disclosure_ko', 'https://worldwide.kia.com/ko/company/investor-relations/official-notice/disclosure/'),
  ('e_disclosure_ko', 'https://worldwide.kia.com/ko/company/investor-relations/official-notice/electronic-disclosure/'),
]

PLAYWRIGHT_TIMEOUT_MS = 45_000


def collect_all_assets(page) -> dict:
  """페이지 내 모든 다운로드 자원(.xlsx/.pdf/.xls/.csv) + 버튼 + select 캡처."""
  return page.evaluate("""() => {
    // 1. 모든 .xlsx/.pdf/.xls/.csv 링크
    const fileLinks = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => a.href.match(/\\.(xlsx|xls|pdf|csv)(\\?|$)/i))
      .map(a => ({
        href: a.href,
        text: (a.innerText || a.textContent || '').trim().slice(0, 100),
        class: a.className || '',
        parent: a.parentElement ? a.parentElement.tagName + '.' + (a.parentElement.className||'').slice(0, 50) : '',
      }));
    // 2. 다운로드 버튼/아이콘
    const dlButtons = [];
    document.querySelectorAll('button, a').forEach(el => {
      const t = (el.innerText || el.textContent || '').trim();
      const cls = el.className || '';
      const href = el.getAttribute('href') || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const dataAttr = el.getAttribute('data-link') || el.getAttribute('data-href') || el.getAttribute('data-url') || '';
      if (t.toLowerCase().includes('download') ||
          t.includes('다운') ||
          t.includes('내려받기') ||
          cls.toLowerCase().includes('download') ||
          ariaLabel.toLowerCase().includes('download')) {
        dlButtons.push({ tag: el.tagName, text: t.slice(0, 120), class: cls, href, aria: ariaLabel, dataLink: dataAttr });
      }
    });
    // 3. tab/dropdown/select
    const selects = Array.from(document.querySelectorAll('select')).map(s => ({
      id: s.id, name: s.name, class: s.className,
      options: Array.from(s.options).map(o => o.value + ':' + o.textContent.trim()).slice(0, 30),
    }));
    // 4. 연도/분기 dropdown 패턴 (커스텀 dropdown UI)
    const dropdowns = Array.from(document.querySelectorAll('[class*="dropdown"], [class*="Dropdown"], [class*="select"]'))
      .slice(0, 20)
      .map(d => ({ class: d.className, text: (d.innerText || '').trim().slice(0, 100) }));
    // 5. tab navigation
    const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab, [class*="tab-"]'))
      .slice(0, 30)
      .map(t => ({ text: (t.innerText || '').trim().slice(0, 80), class: t.className }));
    return { fileLinks, dlButtons, selects, dropdowns, tabs };
  }""")


def explore(page, label: str, url: str) -> dict:
  result = {
    'label': label, 'url': url, 'final_url': None, 'title': None,
    'status': None, 'assets': None, 'error': None,
    'tables': None, 'html_dump_path': None,
  }
  try:
    resp = page.goto(url, timeout=PLAYWRIGHT_TIMEOUT_MS, wait_until='networkidle')
    page.wait_for_timeout(4000)
    # 추가 동적 컨텐츠 로딩을 위해 스크롤
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(1500)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(800)

    result['final_url'] = page.url
    result['title'] = page.title()
    result['status'] = resp.status if resp else None
    result['assets'] = collect_all_assets(page)

    # 테이블 첫 3개 헤더 + 첫 2 row
    tables = page.evaluate("""() => {
      const out = [];
      document.querySelectorAll('table').forEach((tb, i) => {
        if (i >= 4) return;
        const headers = Array.from(tb.querySelectorAll('thead th, thead td'))
          .map(h => (h.innerText||'').trim().slice(0, 40));
        const rows = Array.from(tb.querySelectorAll('tbody tr')).slice(0, 3).map(tr =>
          Array.from(tr.children).map(td => (td.innerText||'').trim().slice(0, 60)));
        out.push({ idx: i, headers, rows });
      });
      return out;
    }""")
    result['tables'] = tables

    # HTML 덤프 (분석용)
    html = page.content()
    html_path = LOG_DIR / f'html_{label}.html'
    html_path.write_text(html, encoding='utf-8')
    result['html_dump_path'] = str(html_path)
    # 스크린샷
    shot = SCREENSHOT_DIR / f'step3_{label}.png'
    page.screenshot(path=str(shot), full_page=True)
    a = result['assets']
    logger.info(
      f"  {label}: status={result['status']} files={len(a['fileLinks'])} "
      f"dl-btn={len(a['dlButtons'])} selects={len(a['selects'])} "
      f"tabs={len(a['tabs'])} tables={len(tables)}"
    )
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
      time.sleep(0.5)
    ctx.close()
    browser.close()
  log_path = LOG_DIR / '03_deep.json'
  log_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
  logger.info(f'Saved: {log_path}')
  for r in results:
    if r['status'] == 200 and r['assets']:
      a = r['assets']
      print(f"  {r['label']:30s} files={len(a['fileLinks']):3d} dl={len(a['dlButtons']):3d} tables={len(r['tables']):2d}")


if __name__ == '__main__':
  main()
