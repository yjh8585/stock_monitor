#!/usr/bin/env python3
"""Kia IR audit - Step 4: 네트워크 트래픽 + 동적 액션 캡처.

performance-and-plans 페이지에서:
  - 모든 XHR/fetch 응답 캡처 (특히 sales-related JSON API)
  - 각 "다운로드" 아이콘/링크 click 시도 → expect_download() 캡처
  - 분기/연도 dropdown 옵션 추출
"""
import json
from pathlib import Path

from loguru import logger
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = PROJECT_ROOT / 'data' / '_kia_audit_screenshots'
LOG_DIR = PROJECT_ROOT / 'data' / '_kia_audit_logs'
EXCEL_DIR = PROJECT_ROOT / 'data' / '_kia_audit_excel'
PDF_DIR = PROJECT_ROOT / 'data' / '_kia_audit_pdf'

TARGET_URLS = [
  ('perf_plans_ko', 'https://worldwide.kia.com/ko/company/investor-relations/library/performance-and-plans/'),
  ('reports_ko', 'https://worldwide.kia.com/ko/company/investor-relations/financial/reports/'),
  ('ir_activities_ko', 'https://worldwide.kia.com/ko/company/investor-relations/library/ir-activities/'),
  ('e_disclosure_ko', 'https://worldwide.kia.com/ko/company/investor-relations/official-notice/electronic-disclosure/'),
]

PLAYWRIGHT_TIMEOUT_MS = 60_000


def main():
  for label, url in TARGET_URLS:
    logger.info(f'>> {label}: {url}')
    network_log = []
    download_log = []

    with sync_playwright() as pw:
      browser = pw.chromium.launch(headless=True)
      ctx = browser.new_context(
        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        locale='ko-KR',
        viewport={'width': 1440, 'height': 900},
        accept_downloads=True,
      )
      page = ctx.new_page()

      # 모든 응답 캡처 (특히 XHR/fetch JSON 또는 .xlsx/.pdf)
      def on_response(resp):
        try:
          rt = resp.request.resource_type
          ct = resp.headers.get('content-type', '')
          ext = ''
          if rt in ('xhr', 'fetch') or '.xlsx' in resp.url or '.pdf' in resp.url or 'json' in ct or 'excel' in ct or 'pdf' in ct:
            network_log.append({
              'url': resp.url, 'method': resp.request.method,
              'status': resp.status, 'content_type': ct,
              'resource_type': rt,
            })
        except Exception:
          pass

      def on_download(dl):
        try:
          fn = dl.suggested_filename
          dest = EXCEL_DIR / f'{label}_{fn}' if fn.lower().endswith(('.xlsx', '.xls', '.csv')) else PDF_DIR / f'{label}_{fn}'
          dl.save_as(str(dest))
          download_log.append({'url': dl.url, 'filename': fn, 'saved_to': str(dest)})
          logger.info(f'  ↓↓ download: {fn} → {dest.name}')
        except Exception as e:
          logger.error(f'  download save failed: {e}')

      page.on('response', on_response)
      page.on('download', on_download)

      try:
        page.goto(url, timeout=PLAYWRIGHT_TIMEOUT_MS, wait_until='networkidle')
        page.wait_for_timeout(5000)
        # 스크롤로 lazy 데이터 트리거
        for _ in range(6):
          page.evaluate("window.scrollBy(0, 500)")
          page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(2000)

        # 모든 click 가능한 다운로드 후보 식별
        # icon-box, "다운로드", 등의 클래스
        candidates = page.evaluate("""() => {
          const out = [];
          const selectors = [
            'button[class*="download"]',
            'a[class*="download"]',
            '.icon-box',
            'a[download]',
            'button[aria-label*="다운"]',
            '[class*="btn-download"]',
            'a[href*="download"]',
            'button[onclick*="download"]',
          ];
          const seen = new Set();
          selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
              if (seen.has(el)) return;
              seen.add(el);
              const rect = el.getBoundingClientRect();
              out.push({
                tag: el.tagName,
                text: (el.innerText || '').trim().slice(0, 100),
                class: el.className || '',
                href: el.getAttribute('href') || '',
                visible: rect.width > 0 && rect.height > 0,
                outerHTML: el.outerHTML.slice(0, 300),
              });
            });
          });
          return out;
        }""")
        logger.info(f'  candidates: {len(candidates)}')

        # 처음 5개 click 시도 (다운로드 트리거)
        for i, c in enumerate(candidates[:8]):
          if not c['visible']:
            continue
          try:
            sel = (
              c['tag'].lower() + (f'.{c["class"].split()[0]}' if c["class"] else '')
            )
            # nth-of-type 안전하지 않으므로 outerHTML로 match 시도
            handle = page.evaluate_handle(f"""() => {{
              const els = document.querySelectorAll('button, a, div, span');
              for (const e of els) {{
                if (e.outerHTML.startsWith({json.dumps(c['outerHTML'][:100])})) return e;
              }}
              return null;
            }}""")
            elem = handle.as_element() if handle else None
            if not elem:
              continue
            with page.expect_download(timeout=5000) as dl_info:
              elem.click(timeout=3000)
            dl = dl_info.value
            fn = dl.suggested_filename
            dest = (EXCEL_DIR if fn.lower().endswith(('.xlsx', '.xls', '.csv')) else PDF_DIR) / f'{label}_{i:02d}_{fn}'
            dl.save_as(str(dest))
            download_log.append({'url': dl.url, 'filename': fn, 'saved_to': str(dest), 'candidate_idx': i})
            logger.info(f'  → downloaded via click #{i}: {fn}')
          except Exception as e:
            # 다운로드 안 일어남 (페이지 변경, modal 등) — 다음 후보로
            err = str(e)[:80]
            logger.debug(f'  click #{i} no download ({err})')
            # 새 페이지 열림 가능성 → 뒤로
            try:
              if page.url != url:
                page.go_back()
                page.wait_for_load_state('networkidle', timeout=5000)
            except Exception:
              pass

        # 캡처
        shot = SCREENSHOT_DIR / f'step4_{label}.png'
        page.screenshot(path=str(shot), full_page=True)

        out = {
          'label': label, 'url': url,
          'candidates': candidates,
          'network': network_log,
          'downloads': download_log,
        }
        out_path = LOG_DIR / f'04_network_{label}.json'
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
        logger.info(f'  saved {out_path.name} (network={len(network_log)}, dl={len(download_log)})')
      except Exception as e:
        logger.error(f'  {label} ERR: {e}')
      finally:
        ctx.close()
        browser.close()


if __name__ == '__main__':
  main()
