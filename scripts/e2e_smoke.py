"""모든 보호 라우트 E2E smoke test — 로그인 자동화 + 콘솔/네트워크 에러 캡처.

사용: scripts/venv/Scripts/python.exe scripts/e2e_smoke.py

환경변수(`.env.local` · `scripts/.env`):
  MOBILITY_ID · MOBILITY_PW  없으면 그 자리에서 멈춘다(코드에 기본값을 두지 않는다)
  E2E_BASE_URL               dev 주소. 🔴 **기본 3000 을 믿지 말 것** — 3000 은 다른 앱이
                             점유해 이 레포의 dev 는 3001+ 로 뜬다(AGENTS.md §검증 명령).
                             틀리면 로그인부터 실패하고 원인이 인증으로 보인다.
  E2E_OUT_DIR                산출물 폴더. 기본은 **프로젝트 밖** 임시 폴더다.

🔴 **산출물을 프로젝트 폴더에 쓰지 않는다**(2026-09-09 수리). 스크린샷·리포트를 레포 안에
쓰면 Turbopack 이 파일 변경을 감지해 재컴파일하고, 그 순간 Server Action ID 가 어긋나
**로그인 POST 가 404 로 죽는다** — 이 스크립트가 자기가 만든 파일로 자기 로그인을 깨뜨린다.
`.gitignore` 대상 폴더도 예외가 아니다(파일 감시자는 gitignore 를 보지 않는다).
경위 = `docs/gotchas-playwright-ui.md` §검증 산출물 위치.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from playwright.sync_api import sync_playwright, ConsoleMessage, Request

BASE = os.environ.get('E2E_BASE_URL', 'http://localhost:3001')
# 🔴 자격증명 기본값을 코드에 두지 않는다. 옛 코드는 아이디·비밀번호를 소스에 박아 두어
#    ① 저장소에 자격증명이 남고 ② `.env.local` 이 안 읽혀도 로그인이 «되는 것처럼» 보였다
#    (계정이 바뀌면 그때서야 실패하고, 원인은 인증 코드로 오진된다).
USER = os.environ.get('MOBILITY_ID')
PASS = os.environ.get('MOBILITY_PW')

# 검증 대상: AGENTS.md의 7개 페이지 구성 + 보고서·관리
ROUTES = [
    '/related-stocks',
    '/compare',
    '/domestic',
    '/oem',
    '/parts-top100',
    '/hansae',
    '/etc',
    '/reports',
    '/management/pnl',
]

# 🔴 프로젝트 «밖» 이 기본값이다(위 docstring 참조). 폴더는 실행할 때 만든다 —
#    import 만 해도 폴더가 생기면 의도치 않은 자리에 흔적이 남는다.
_DEFAULT_OUT = Path(tempfile.gettempdir()) / 'stock_monitor_e2e'
REPORT_DIR = Path(os.environ.get('E2E_OUT_DIR') or _DEFAULT_OUT)


def login(page) -> None:
    page.goto(f'{BASE}/login', wait_until='networkidle', timeout=30000)
    page.fill('input[name="id"]', USER)
    page.fill('input[name="password"]', PASS)
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle', timeout=30000)
    # 🔴 고정 대기가 필요하다. 로그인 리다이렉트 체인(`/login`→`/`→`/management`→탭)은
    #    전부 200(RSC client redirect)이라 `networkidle` 뒤에도 아직 진행 중이다.
    #    바로 다음 `goto` 를 하면 세션 쿠키가 붙기 전이라 로그인 폼이 돌아온다
    #    (`docs/gotchas-playwright-ui.md` §보호 라우트 UI Playwright 검증).
    page.wait_for_timeout(2500)


def looksLoggedOut(page) -> bool:
    """이 화면이 로그인 폼인가 — 로그인 여부는 **내용**으로만 판정한다.

    🔴 **HTTP 상태로 판정하면 안 된다.** `cacheComponents`(PPR) 는 정적 셸을 먼저 200 으로
    흘려보내므로, 페이지 안에서 `notFound()` 가 걸려도 응답은 **200** 이다
    (`docs/gotchas-playwright-ui.md` §권한 차단 검증). 그래서 옛 코드는 로그인이 통째로
    실패해도 아홉 라우트 전부 `[OK]` 를 찍었다 — **실패할 수 없는 검사기**였다.

    ⚠️ `page.url` 로도 판정하지 않는다. 로그인 직후의 리다이렉트 체인은 `networkidle`
    이후에 끝나서, **성공했는데도** 주소가 아직 `/login` 인 순간이 있다(실측).
    """
    return page.query_selector('input[name="password"]') is not None


def slugify(path: str) -> str:
    return path.strip('/').replace('/', '_') or 'root'


def main() -> int:
    # 🔴 자격증명이 없으면 «시작 전에» 멈춘다. 브라우저를 띄운 뒤 로그인에서 실패하면
    #    30초를 쓰고 나서 「인증이 깨졌나」로 오진하게 된다.
    if not USER or not PASS:
        print('[FAIL] MOBILITY_ID / MOBILITY_PW 가 없다 — .env.local 을 확인할 것')
        print('       (코드에 기본값을 두지 않는다. 자격증명은 저장소에 남기지 않는다.)')
        return 1
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    print(f'[정보] 대상 {BASE} · 산출물 {REPORT_DIR}')

    summary: list[dict] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()

        # 로그인
        try:
            login(page)
        except Exception as e:
            print(f'[FAIL] login: {e}')
            return 1

        # 🔴 로그인이 «실제로» 됐는지 보호 라우트로 확인한다. 이 확인이 없으면 로그인이
        #    통째로 실패해도 아래 아홉 라우트가 전부 로그인 폼을 200 으로 돌려주고
        #    검사기는 [OK] 를 찍는다.
        page.goto(f'{BASE}/management/pnl', wait_until='networkidle', timeout=30000)
        if looksLoggedOut(page):
            print(f'[FAIL] login: 보호 라우트가 로그인 폼을 돌려준다 — 계정·세션을 확인할 것')
            print(f'       (dev 로그의 POST /login 이 303 이면 인증은 성공한 것이다: '
                  f'{BASE} 주소가 맞는지부터 볼 것)')
            return 1
        print(f'[OK] login as {USER} — 보호 라우트 접근 확인')

        for route in ROUTES:
            console_errors: list[str] = []
            failed_requests: list[str] = []

            def on_console(msg: ConsoleMessage) -> None:
                if msg.type in ('error', 'warning'):
                    console_errors.append(f'[{msg.type}] {msg.text[:200]}')

            def on_requestfailed(req: Request) -> None:
                # 외부 분석 도구(GA 등) 실패는 무시. localhost/relative만.
                if BASE in req.url or req.url.startswith('/'):
                    failed_requests.append(f'{req.method} {req.url} — {req.failure}')

            page.on('console', on_console)
            page.on('requestfailed', on_requestfailed)

            url = f'{BASE}{route}'
            status = 'ok'
            err: str | None = None
            http_status: int | None = None
            try:
                resp = page.goto(url, wait_until='domcontentloaded', timeout=30000)
                http_status = resp.status if resp else None
                page.wait_for_load_state('networkidle', timeout=30000)
                # 차트 마운트 안정화 대기
                page.wait_for_timeout(2000)
                # 🔴 200 이어도 로그인 폼이면 세션이 끊긴 것이다(PPR 이 셸을 먼저 200 으로 준다).
                if looksLoggedOut(page):
                    status = 'fail'
                    err = '로그인 폼이 돌아왔다 — 세션이 끊겼거나 권한이 없다(HTTP 는 200)'
                # 스크린샷
                screenshot_path = REPORT_DIR / f'{slugify(route)}.png'
                page.screenshot(path=str(screenshot_path), full_page=False)
            except Exception as e:
                status = 'fail'
                err = str(e)[:300]

            page.remove_listener('console', on_console)
            page.remove_listener('requestfailed', on_requestfailed)

            row = {
                'route': route,
                'status': status,
                'http_status': http_status,
                'console_errors': console_errors[:10],
                'failed_requests': failed_requests[:5],
                'error': err,
            }
            summary.append(row)
            errs_n = len(console_errors)
            fr_n = len(failed_requests)
            tag = 'OK' if status == 'ok' and errs_n == 0 and fr_n == 0 else 'WARN'
            print(f'[{tag}] {route} http={http_status} console_err={errs_n} req_fail={fr_n}')

        browser.close()

    # 🔴 리포트도 프로젝트 밖이다 — 옛 코드는 `scripts/` 에 써서 Turbopack 재컴파일을 유발했다.
    out = REPORT_DIR / '_e2e_smoke_report.json'
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n→ report saved: {out}')
    print(f'→ screenshots: {REPORT_DIR}')

    # 실패 1개라도 있으면 exit 1
    has_fail = any(r['status'] != 'ok' for r in summary)
    return 1 if has_fail else 0


if __name__ == '__main__':
    sys.exit(main())
