"""marklines에 1회 수동 로그인 후 세션을 storage_state.json으로 저장.
이후 collect_marklines_direct.py 가 이 state 를 사용해 헤드리스 자동 접근.

사용법:
  1. python scripts/marklines_login_once.py
  2. 열린 브라우저에서 marklines 로그인 (사용자 ID/PW 직접 입력)
  3. 메인 화면 보이면 터미널에 Enter
  4. _marklines_state.json 저장됨

주의: marklines 단일 디바이스 정책 — 이후 사용자 PC에서 marklines 로그인하면
이 state 가 무효화될 수 있음. 자동 수집 직전에 한 번 실행하는 패턴 권장.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

STATE_PATH = Path(__file__).parent / '_marklines_state.json'

with sync_playwright() as pw:
  browser = pw.chromium.launch(headless=False)  # 사용자가 보고 로그인할 창
  ctx = browser.new_context(
    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
               '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  )
  page = ctx.new_page()
  page.goto('https://www.marklines.com/en/members/login')
  print('=' * 60)
  print('1. 열린 Chromium 창에서 marklines 로그인 진행')
  print('2. 메인 페이지가 정상 표시되면 이 터미널로 돌아와 Enter 입력')
  print('=' * 60)
  input('  >>> 로그인 완료 후 Enter: ')
  ctx.storage_state(path=str(STATE_PATH))
  print(f'\n세션 저장 완료 → {STATE_PATH}')
  browser.close()
