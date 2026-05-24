#!/usr/bin/env python3
"""실제 브라우저로 /oem 페이지 렌더링 상태를 점검."""
import io
import sys
from pathlib import Path

# Windows cp949 환경에서 유니코드 출력 강제
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

URL = 'http://localhost:3000/oem'
SCREENSHOT_DIR = Path(__file__).resolve().parents[1] / '참고'
SCREENSHOT_DIR.mkdir(exist_ok=True)


def main():
  with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1600, 'height': 900})
    page = ctx.new_page()

    console_logs = []
    page.on('console', lambda msg: console_logs.append(f'[{msg.type}] {msg.text[:300]}'))
    page.on('pageerror', lambda err: console_logs.append(f'[PAGEERROR] {err}'))

    print(f'Navigating to {URL}')
    page.goto(URL, wait_until='networkidle', timeout=60000)
    page.wait_for_timeout(3000)  # recharts 그리기 대기

    # 차트 SVG 개수
    svg_count = page.evaluate('document.querySelectorAll("svg.recharts-surface").length')
    rcontainer = page.evaluate('document.querySelectorAll(".recharts-wrapper").length')
    cells = page.evaluate(
      '''
      Array.from(document.querySelectorAll("section")).map(s => {
        const h = s.querySelector("h2");
        return {
          title: h ? h.textContent : null,
          width: s.getBoundingClientRect().width,
          height: s.getBoundingClientRect().height,
          svgs: s.querySelectorAll("svg.recharts-surface").length,
          tables: s.querySelectorAll("table").length,
        };
      });
      '''
    )

    print(f'\n=== /oem render report ===')
    print(f'recharts-surface SVGs: {svg_count}')
    print(f'recharts-wrapper divs: {rcontainer}')
    print(f'\nSection breakdown:')
    for c in cells:
      print(
        f'  {(c["title"] or "?")[:40]:<40}  w={c["width"]:.0f} h={c["height"]:.0f}  svgs={c["svgs"]} tables={c["tables"]}'
      )

    # 콘솔 로그 출력
    if console_logs:
      print(f'\n=== Browser console ({len(console_logs)} entries) ===')
      for l in console_logs[:30]:
        print(f'  {l}')

    # 섹션 단위 스크린샷 (한 번에 보기 쉽게 각 섹션을 별도 PNG로)
    page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
    page.wait_for_timeout(2000)
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(500)

    sections = page.query_selector_all('section')
    for i, sec in enumerate(sections, 1):
      try:
        path = SCREENSHOT_DIR / f'oem_section_{i:02d}.png'
        sec.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        sec.screenshot(path=str(path))
        print(f'  Section {i} saved → {path.name}')
      except Exception as e:
        print(f'  Section {i} screenshot failed: {e}')

    shot_path = SCREENSHOT_DIR / 'oem_page_debug.png'
    page.screenshot(path=str(shot_path), full_page=True)
    print(f'\nFull screenshot saved: {shot_path}')

    browser.close()


if __name__ == '__main__':
  sys.exit(main() or 0)
