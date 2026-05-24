"""
헤디드 모드로 marklines top500/bosch 페이지를 열어 Data 섹션 동작 확인.

목적
----
- 사용자 본 Chrome 프로파일 직접 사용 (단일 디바이스 정책 우회)
- 페이지 로드 → Data 섹션 후보 요소 자동 탐색 → 클릭 → 본문 추출
- Business Highlight, EBIT, Sales, Revenue 키워드 주변 컨텍스트 출력

⚠ 실행 전 필수
--------------
  Chrome 완전 종료. 작업관리자 Chrome 프로세스 모두 종료해야 user_data_dir lock 안 걸림.

실행
----
  python scripts/debug_marklines_data_section.py

흐름
----
  1. 사용자 Chrome 프로파일로 Chromium 창 열림 (이미 marklines 로그인된 상태)
  2. 보쉬 페이지 자동 이동 + DOM 분석 결과 출력
  3. Data 섹션 자동 클릭 시도 (실패 시 수동 클릭 후 Enter)
  4. 분석 결과 + 본문을 _debug_bosch_body.txt 에 저장

봇 종료 후 Chrome 재시작 가능.
"""
import os
import shutil
import sys
import time
from pathlib import Path

# 사용자 Chrome 프로파일 (Windows 표준 경로)
CHROME_USER_DATA = Path(os.environ.get('LOCALAPPDATA', '')) / 'Google' / 'Chrome' / 'User Data'
# 환경변수 CHROME_PROFILE 로 'Profile 1' 등 다른 프로파일 지정 가능 (default: 'Default')
CHROME_PROFILE = os.environ.get('CHROME_PROFILE', 'Default')

URL = 'https://www.marklines.com/en/top500/bosch'

try:
  from playwright.sync_api import sync_playwright
except ImportError:
  print('playwright 미설치 — pip install playwright 후 playwright install chromium')
  sys.exit(1)


def _heading(title: str) -> None:
  print('\n' + '=' * 60)
  print(title)
  print('=' * 60)


def _check_chrome_running() -> bool:
  """Chrome 프로세스가 살아있는지 확인 (Windows tasklist 기반)."""
  if shutil.which('tasklist') is None:
    return False
  import subprocess
  try:
    out = subprocess.run(
      ['tasklist', '/FI', 'IMAGENAME eq chrome.exe', '/NH'],
      capture_output=True, text=True, timeout=10, shell=False,
    )
    return 'chrome.exe' in (out.stdout or '').lower()
  except Exception:
    return False


if not CHROME_USER_DATA.exists():
  print(f'Chrome 프로파일 디렉토리 없음: {CHROME_USER_DATA}')
  print('Chrome 설치 위치가 표준이 아니면 LOCALAPPDATA 환경변수 확인 필요')
  sys.exit(1)

if _check_chrome_running():
  print('=' * 60)
  print('Chrome 이 실행 중입니다. 작업관리자에서 모든 Chrome 프로세스를 완전 종료하세요.')
  print('(주소창에 chrome://settings/system 열어 "백그라운드에서 계속 실행" 끄기 권장)')
  print('=' * 60)
  sys.exit(2)

print(f'  사용자 Chrome 프로파일: {CHROME_USER_DATA}\\{CHROME_PROFILE}')

with sync_playwright() as pw:
  ctx = pw.chromium.launch_persistent_context(
    user_data_dir=str(CHROME_USER_DATA),
    channel='chrome',  # 사용자 실제 Chrome 사용 (Chromium 아님)
    headless=False,
    viewport={'width': 1280, 'height': 900},
    args=[f'--profile-directory={CHROME_PROFILE}'],
  )
  page = ctx.pages[0] if ctx.pages else ctx.new_page()

  print('=' * 60)
  print('STEP 1. 사용자 Chrome 프로파일로 marklines 메인 진입')
  print('  - 이미 로그인되어 있어야 정상 (사용자 평소 세션 그대로)')
  print('=' * 60)
  page.goto('https://www.marklines.com/en/', timeout=60_000)
  time.sleep(2)
  print(f'  현재 URL: {page.url}')
  input('  >>> 메인 페이지 정상 보이면 Enter: ')

  _heading('STEP 2. 보쉬 페이지 이동')
  page.goto(URL, timeout=60_000)
  page.wait_for_load_state('domcontentloaded', timeout=60_000)
  time.sleep(2)
  print(f'  현재 URL: {page.url}')
  print(f'  타이틀: {page.title()}')

  # ---- Data 섹션 후보 요소 ----
  _heading('STEP 3. Data 섹션 후보 (anchor / button / link)')
  candidates = page.evaluate(
    """
() => {
  const out = [];
  document.querySelectorAll('a, button').forEach((el) => {
    const text = (el.textContent || '').trim();
    const href = el.getAttribute('href') || '';
    const cls = el.className || '';
    if (/^data$/i.test(text) || /data/i.test(href) || /data/i.test(cls)) {
      out.push({
        tag: el.tagName,
        text: text.slice(0, 60),
        href: href.slice(0, 80),
        classes: typeof cls === 'string' ? cls.slice(0, 80) : '',
        id: el.id || '',
      });
    }
  });
  return out.slice(0, 30);
}
    """
  )
  for i, c in enumerate(candidates):
    print(f'  [{i}] {c}')

  # ---- 헤딩 구조 ----
  _heading('STEP 4. H1/H2/H3 구조')
  headings = page.evaluate(
    """
() => Array.from(document.querySelectorAll('h1,h2,h3,h4')).map((h) => ({
  tag: h.tagName,
  id: h.id || '',
  text: (h.textContent || '').trim().slice(0, 90),
}))
    """
  )
  for h in headings[:30]:
    print(f'  [{h["tag"]}] id={h["id"]:20s} - {h["text"]}')

  # ---- Business Highlight 컨텍스트 ----
  _heading('STEP 5. "Business Highlight" 키워드 주변 (3000 chars)')
  bh = page.evaluate(
    """
() => {
  const all = document.body.innerText || '';
  const idx = all.toLowerCase().indexOf('business highlight');
  if (idx === -1) return null;
  return all.slice(idx, idx + 3000);
}
    """
  )
  print(bh if bh else '  (못 찾음)')

  # ---- EBIT 컨텍스트 ----
  _heading('STEP 6. "EBIT" 키워드 주변 (앞 100자 + 뒤 600자)')
  ebit_chunks = page.evaluate(
    """
() => {
  const all = document.body.innerText || '';
  const re = /ebit/gi;
  const out = [];
  let m;
  while ((m = re.exec(all)) !== null && out.length < 5) {
    const s = Math.max(0, m.index - 100);
    out.push(all.slice(s, m.index + 600));
  }
  return out;
}
    """
  )
  if not ebit_chunks:
    print('  (EBIT 키워드 없음)')
  for i, chunk in enumerate(ebit_chunks):
    print(f'\n  --- EBIT 매치 {i+1} ---')
    print(chunk)

  # ---- Sales/Revenue 컨텍스트 ----
  _heading('STEP 7. "Sales" 또는 "Revenue" 주변 (첫 3개)')
  rev_chunks = page.evaluate(
    """
() => {
  const all = document.body.innerText || '';
  const re = /\\b(sales|revenue|turnover)\\b/gi;
  const out = [];
  let m;
  while ((m = re.exec(all)) !== null && out.length < 5) {
    const s = Math.max(0, m.index - 60);
    out.push(all.slice(s, m.index + 400));
  }
  return out;
}
    """
  )
  for i, chunk in enumerate(rev_chunks):
    print(f'\n  --- Sales/Revenue 매치 {i+1} ---')
    print(chunk)

  # ---- 페이지 통계 ----
  body = page.evaluate('() => document.body.innerText || ""')
  _heading('STEP 8. 페이지 본문 통계')
  print(f'  본문 총 길이: {len(body):,} chars')
  print(f'  paywall 안내(free trial) 포함 여부: {"sign up for a free trial" in body.lower()}')
  print(f'  로그인 상태 (logout/sign out 보임): '
        f'{any(kw in body.lower() for kw in ["logout", "sign out", "/members/logout"])}')

  # ---- Data 섹션 클릭 시도 ----
  _heading('STEP 9. Data 섹션 자동 클릭 시도 후 재추출')
  clicked = False
  for sel in [
    'a[href$="#data"]',
    'a[href*="#data"]',
    'a:has-text("Data")',
    'button:has-text("Data")',
    '[data-target*="data"]',
    'a.tab[href*="data"]',
  ]:
    try:
      el = page.query_selector(sel)
      if el:
        el.click(timeout=3_000)
        time.sleep(2)
        print(f'  클릭 성공: selector={sel}')
        clicked = True
        break
    except Exception as e:
      print(f'  selector 실패 {sel}: {e}')
  if not clicked:
    print('  (자동 클릭 실패 — DOM 후보를 보고 사용자가 수동 클릭 후 Enter)')
    input('  >>> 수동 클릭 후 Enter: ')

  # 클릭 후 추출
  body2 = page.evaluate('() => document.body.innerText || ""')
  print(f'\n  클릭 후 본문 길이: {len(body2):,} chars (원본 {len(body):,})')

  # 클릭 후 EBIT
  ebit2 = page.evaluate(
    """
() => {
  const all = document.body.innerText || '';
  const re = /ebit/gi;
  const out = [];
  let m;
  while ((m = re.exec(all)) !== null && out.length < 5) {
    const s = Math.max(0, m.index - 100);
    out.push(all.slice(s, m.index + 600));
  }
  return out;
}
    """
  )
  if ebit2:
    print(f'\n  클릭 후 EBIT 매치 {len(ebit2)}개:')
    for i, chunk in enumerate(ebit2):
      print(f'\n  --- EBIT 매치 {i+1} ---')
      print(chunk)

  # ---- 본문 전체를 디버그 파일로 저장 ----
  log_path = Path(__file__).parent / '_debug_bosch_body.txt'
  log_path.write_text(body2, encoding='utf-8')
  print(f'\n  전체 본문 저장 → {log_path}')

  print('\n=== 분석 완료. 브라우저 닫으려면 Enter ===')
  input()
  ctx.close()
