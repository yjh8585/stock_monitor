#!/usr/bin/env python3
"""분기별 IR 보고서 페이지 audit. 페이지 구조와 다운로드 자료 형식 확인."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = 'https://www.hyundai.com/worldwide/ko/company/ir/financial-information/quarterly-earnings'
OUT = Path(__file__).resolve().parent / '_audit_hyundai_quarterly.json'


def main() -> int:
  with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto(URL, wait_until='domcontentloaded', timeout=60_000)
    page.wait_for_load_state('load', timeout=30_000)
    page.wait_for_timeout(4_000)

    # 페이지 전체 HTML 크기 + title
    title = page.title()
    html = page.content()
    print(f"title={title}, html bytes={len(html)}")

    # 모든 button 추출
    btns = page.locator('button').all()
    btn_info: list[dict] = []
    for i, b in enumerate(btns):
      try:
        cls = b.get_attribute('class') or ''
        txt = b.text_content() or ''
        txt = ' '.join(txt.split())
        bid = b.get_attribute('id') or ''
        btn_info.append({'i': i, 'class': cls, 'text': txt[:120], 'id': bid})
      except Exception:
        pass

    # 모든 a[href] 추출 (.pdf/.xlsx/.zip 포함 + 그 외)
    links = page.locator('a[href]').all()
    a_info: list[dict] = []
    for a in links:
      try:
        href = a.get_attribute('href') or ''
        txt = a.text_content() or ''
        txt = ' '.join(txt.split())
        cls = a.get_attribute('class') or ''
        a_info.append({'href': href, 'text': txt[:120], 'class': cls})
      except Exception:
        pass

    # dropdown 후보 (selector div with 'field-' id)
    fields = page.locator('[id*="field-"]').all()
    field_info: list[dict] = []
    for f in fields:
      try:
        fid = f.get_attribute('id') or ''
        cls = f.get_attribute('class') or ''
        txt = f.text_content() or ''
        txt = ' '.join(txt.split())
        field_info.append({'id': fid, 'class': cls, 'text': txt[:200]})
      except Exception:
        pass

    # btn-dropdown 클릭해서 옵션 보기
    dropdown_options: dict[str, list[str]] = {}
    for fi in field_info[:6]:
      fid = fi['id']
      try:
        page.locator(f'#{fid} .btn-dropdown').first.click()
        page.wait_for_timeout(700)
        opts = page.locator(f'#{fid} .btn-option').all()
        dropdown_options[fid] = [
          ' '.join((o.text_content() or '').split())
          for o in opts[:30]
        ]
        # close
        page.locator(f'#{fid} .btn-dropdown').first.click()
        page.wait_for_timeout(300)
      except Exception as e:
        dropdown_options[fid] = [f'<error: {e}>']

    summary = {
      'title': title,
      'url': URL,
      'html_bytes': len(html),
      'field_count': len(field_info),
      'fields': field_info,
      'dropdown_options': dropdown_options,
      'button_count': len(btn_info),
      'buttons_first_40': btn_info[:40],
      'link_count': len(a_info),
      'pdf_links': [a for a in a_info if '.pdf' in (a['href'] or '').lower()][:30],
      'xlsx_links': [a for a in a_info if '.xlsx' in (a['href'] or '').lower()][:30],
      'zip_links': [a for a in a_info if '.zip' in (a['href'] or '').lower()][:30],
      'download_class_links': [a for a in a_info if 'download' in (a['class'] or '').lower()][:30],
    }

    OUT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"audit JSON → {OUT}")
    print(f"fields={len(field_info)}, buttons={len(btn_info)}, links={len(a_info)}")
    print(f"pdf links={len(summary['pdf_links'])}, xlsx={len(summary['xlsx_links'])}, "
          f"zip={len(summary['zip_links'])}, download class={len(summary['download_class_links'])}")

    ctx.close()
    browser.close()
  return 0


if __name__ == '__main__':
  sys.exit(main())
