#!/usr/bin/env python3
"""1개 연도(2025)의 첫 "실적 발표 자료" 버튼을 클릭해서 어떤 파일이 받아지는지 확인.

목표: PDF인지 PPT인지 형식 파악 + 분기 정보 어떻게 결합되는지 확인 + DOM 구조 캡쳐.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = 'https://www.hyundai.com/worldwide/ko/company/ir/financial-information/quarterly-earnings'
OUT_DIR = Path(__file__).resolve().parent.parent / 'data' / '_hyundai_quarterly_downloads'
DOM_OUT = Path(__file__).resolve().parent / '_audit_hyundai_quarterly_dom.json'


def main() -> int:
  OUT_DIR.mkdir(parents=True, exist_ok=True)

  with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(accept_downloads=True)
    page = ctx.new_page()
    page.goto(URL, wait_until='domcontentloaded', timeout=60_000)
    page.wait_for_load_state('load', timeout=30_000)
    page.wait_for_timeout(4_000)

    # 연도 selector — 2025로 변경
    try:
      page.locator('#field-yearly-type-1 .btn-dropdown').first.click()
      page.wait_for_timeout(500)
      page.locator('#field-yearly-type-1 .btn-option:has-text("2025")').first.click()
      page.wait_for_timeout(2_500)
    except Exception as e:
      print(f"year-select failed: {e}")

    # 분기 카드 영역의 HTML 구조 파악 — section/article 캡쳐
    quarter_cards: list[dict] = []
    # quarter별 li 또는 article 후보 selector
    for selector in [
      'section ul li',
      'section.cont-area li',
      'article',
      '.list-quarter li',
      '.tab-content li',
      'ul li',
    ]:
      cards = page.locator(selector).all()
      if 4 <= len(cards) <= 50:
        for i, card in enumerate(cards[:20]):
          try:
            txt = card.text_content() or ''
            cls = card.get_attribute('class') or ''
            outer = card.evaluate('e => e.outerHTML') or ''
            quarter_cards.append({
              'selector': selector,
              'i': i,
              'class': cls,
              'text': ' '.join(txt.split())[:300],
              'outer_html_excerpt': outer[:1500],
            })
          except Exception:
            pass
        if quarter_cards:
          break

    # 첫 번째 "실적 발표 자료" 버튼 클릭 → 다운로드
    download_info = None
    try:
      btn = page.locator('button.btn-download:has-text("실적 발표 자료")').first
      btn.wait_for(state='visible', timeout=10_000)
      # 버튼 주변 텍스트 (어떤 분기인지)
      parent_txt = btn.evaluate(
        '''e => {
          let p = e;
          for (let i = 0; i < 5 && p; i++) p = p.parentElement;
          return p ? p.textContent : '';
        }'''
      )
      print(f"first btn parent text: {' '.join((parent_txt or '').split())[:300]}")
      with page.expect_download(timeout=30_000) as dl_info:
        btn.click()
      dl = dl_info.value
      suggested = dl.suggested_filename
      dest = OUT_DIR / f'__audit_{suggested}'
      dl.save_as(str(dest))
      download_info = {
        'suggested_filename': suggested,
        'dest_path': str(dest),
        'size': dest.stat().st_size,
      }
      print(f"downloaded → {dest} ({download_info['size']} bytes)")
    except Exception as e:
      print(f"download failed: {e}")
      download_info = {'error': str(e)}

    # 추가로 두 번째 카드 (3Q?) 다운로드 시도
    download2 = None
    try:
      btns = page.locator('button.btn-download:has-text("실적 발표 자료")').all()
      if len(btns) >= 2:
        b2 = btns[1]
        parent_txt = b2.evaluate(
          '''e => {
            let p = e;
            for (let i = 0; i < 5 && p; i++) p = p.parentElement;
            return p ? p.textContent : '';
          }'''
        )
        with page.expect_download(timeout=30_000) as dl_info:
          b2.click()
        dl2 = dl_info.value
        suggested2 = dl2.suggested_filename
        dest2 = OUT_DIR / f'__audit_2_{suggested2}'
        dl2.save_as(str(dest2))
        download2 = {
          'suggested_filename': suggested2,
          'dest_path': str(dest2),
          'size': dest2.stat().st_size,
          'parent_text': ' '.join((parent_txt or '').split())[:300],
        }
        print(f"downloaded 2 → {dest2} ({download2['size']} bytes)")
    except Exception as e:
      print(f"download2 failed: {e}")
      download2 = {'error': str(e)}

    result = {
      'year': 2025,
      'quarter_cards': quarter_cards[:10],
      'download_1': download_info,
      'download_2': download2,
    }
    DOM_OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"DOM JSON → {DOM_OUT}")
    ctx.close()
    browser.close()
  return 0


if __name__ == '__main__':
  sys.exit(main())
