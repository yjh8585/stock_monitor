"""prod 회사명 클릭 무반응 진단. Playwright로 직접 확인.

흐름:
1. 로그인 → /related-stocks
2. 첫 행 회사명 button 클릭 → popup/console/error 캡처
3. 결과 출력
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(Path(__file__).parent.parent / '.env.local')

PROD_URL = 'https://stock-monitor-orcin.vercel.app'
LOGIN_ID = os.environ['MOBILITY_ID']
LOGIN_PW = os.environ['MOBILITY_PW']


def main() -> None:
  with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1400, 'height': 900}, locale='ko-KR')
    page = ctx.new_page()

    console_msgs: list[str] = []
    page_errors: list[str] = []
    popups: list[str] = []

    page.on('console', lambda m: console_msgs.append(f'[{m.type}] {m.text}'))
    page.on('pageerror', lambda e: page_errors.append(str(e)))

    def _on_popup(p):
      popups.append(p.url)
      try:
        p.wait_for_load_state('domcontentloaded', timeout=5000)
        popups[-1] = f'{popups[-1]} → final={p.url}'
      except Exception as ex:
        popups[-1] = f'{popups[-1]} → load_err={ex}'

    page.on('popup', _on_popup)

    # 로그인
    page.goto(f'{PROD_URL}/login', timeout=30_000)
    # 로그인 폼 hydration 대기 — input[name="id"]가 React 렌더 후 나타날 때까지
    page.wait_for_load_state('networkidle', timeout=30_000)
    try:
      page.wait_for_selector('input[name="id"]', timeout=10_000)
    except Exception:
      print('로그인 폼 셀렉터 미발견 — body HTML 일부:')
      print(page.locator('body').inner_html()[:1500])
      browser.close()
      return
    page.fill('input[name="id"]', LOGIN_ID)
    page.fill('input[name="password"]', LOGIN_PW)
    page.click('button[type="submit"]')
    # form submit → server action → redirect. URL 바뀔 때까지 대기.
    try:
      page.wait_for_url(lambda u: '/login' not in u, timeout=20_000)
    except Exception as e:
      print(f'로그인 후 URL 변화 timeout: {e}')
    print(f'로그인 후 URL: {page.url}')

    if '/login' in page.url:
      print('로그인 실패! body 일부:')
      print(page.locator('body').inner_text()[:800])
      browser.close()
      return

    # /related-stocks 로 이동
    page.goto(f'{PROD_URL}/related-stocks', timeout=30_000)
    page.wait_for_load_state('networkidle', timeout=20_000)
    page.wait_for_timeout(2000)

    # 회사명 button 탐색 — sticky cell 내 button. 첫 5개 정보 dump.
    print('\n=== 회사명 button 정보 ===')
    info = page.evaluate("""
      () => {
        const tds = Array.from(document.querySelectorAll('tbody tr'));
        const out = [];
        for (const tr of tds.slice(0, 5)) {
          const btn = tr.querySelector('button');
          const span = tr.querySelector('span');
          out.push({
            firstButtonText: btn?.textContent?.trim()?.slice(0, 30) || null,
            firstButtonDisabled: btn?.disabled ?? null,
            firstButtonPointerEvents: btn ? window.getComputedStyle(btn).pointerEvents : null,
            firstButtonZIndex: btn ? window.getComputedStyle(btn).zIndex : null,
            firstButtonElementAtCenter: btn ? (() => {
              const r = btn.getBoundingClientRect();
              const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return el?.tagName + (el?.className ? '.' + String(el.className).slice(0, 60) : '');
            })() : null,
            buttonsInRow: tr.querySelectorAll('button').length,
            spansInRow: tr.querySelectorAll('span').length,
          });
        }
        return out;
      }
    """)
    for i, r in enumerate(info):
      print(f'  row{i}: {r}')

    # 첫 회사명 button 클릭 → popup 캡처
    print('\n=== 첫 회사명 button 클릭 시도 ===')
    target = page.locator('tbody tr').first.locator('button').first
    target_text = target.text_content() or ''
    print(f'  타겟: {target_text.strip()[:30]}')

    try:
      # popup expect 이벤트로 한 번 더 안전하게 캡처
      with page.expect_popup(timeout=5000) as popup_info:
        target.click()
      popup_page = popup_info.value
      print(f'  ✓ popup 열림: {popup_page.url}')
      try:
        popup_page.wait_for_load_state('domcontentloaded', timeout=5000)
        print(f'    final URL: {popup_page.url}')
        print(f'    title: {popup_page.title()}')
      except Exception as e:
        print(f'    popup load err: {e}')
    except Exception as e:
      print(f'  ✗ popup 안 열림: {type(e).__name__}: {e}')

    print('\n=== 캡처 정리 ===')
    print(f'popups (on event): {popups}')
    print(f'console msgs ({len(console_msgs)}):')
    for m in console_msgs[-20:]:
      print(f'  {m}')
    print(f'page errors ({len(page_errors)}):')
    for e in page_errors[-10:]:
      print(f'  {e}')

    browser.close()


if __name__ == '__main__':
  main()
