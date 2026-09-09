"""보호 라우트 E2E smoke — 역할 5종 × 라우트 접근 «양방향» 검증 + 화면 실물 확인.

사용: scripts/venv/Scripts/python.exe scripts/e2e_smoke.py
      (한 역할만: `--role admin` · 화면 검증 생략: `--matrix-only`)

환경변수(`.env.local` · `scripts/.env`):
  ADMIN_ID/PW · HOLDING_ID/PW · MOBILITY_ID/PW · HMOBILITY_ID/PW · GUEST_ID/PW
                             없는 역할은 그 자리에서 **실패**로 센다(조용히 건너뛰지 않는다).
  E2E_BASE_URL               dev 주소. 🔴 **기본 3000 을 믿지 말 것** — 3000 은 다른 앱이
                             점유해 이 레포의 dev 는 3001+ 로 뜬다(AGENTS.md §검증 명령).
                             틀리면 로그인부터 실패하고 원인이 인증으로 보인다.
  E2E_OUT_DIR                산출물 폴더. 기본은 **프로젝트 밖** 임시 폴더다.

🔴 **산출물을 프로젝트 폴더에 쓰지 않는다**(2026-09-09 수리). 스크린샷·리포트를 레포 안에
쓰면 Turbopack 이 파일 변경을 감지해 재컴파일하고, 그 순간 Server Action ID 가 어긋나
**로그인 POST 가 404 로 죽는다** — 이 스크립트가 자기가 만든 파일로 자기 로그인을 깨뜨린다.
`.gitignore` 대상 폴더도 예외가 아니다(파일 감시자는 gitignore 를 보지 않는다).
경위 = `docs/gotchas-playwright-ui.md` §검증 산출물 위치.

🔴 **admin 하나로 돌리면 이 검사기는 아무것도 못 잡는다**(2026-09-09 확장 이유).
`permissions.ts` 의 `canAccess` 첫 줄이 `if (role === 'admin') return true` 라서
admin 은 모든 경로를 통과한다 — 「열리는가」만 재고 「막히는가」는 한 번도 안 재게 된다.
그래서 아래 `EXPECTED` 는 **차단이 기대되는 칸을 반드시 포함**하고, 실행 끝에
`_assertMatrixIsBidirectional` 이 그 사실을 기계로 강제한다.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from playwright.sync_api import ConsoleMessage, Request, sync_playwright

BASE = os.environ.get('E2E_BASE_URL', 'http://localhost:3001')

# 🔴 자격증명 기본값을 코드에 두지 않는다. 옛 코드는 아이디·비밀번호를 소스에 박아 두어
#    ① 저장소에 자격증명이 남고 ② `.env.local` 이 안 읽혀도 로그인이 «되는 것처럼» 보였다
#    (계정이 바뀌면 그때서야 실패하고, 원인은 인증 코드로 오진된다).
ROLE_ENV: dict[str, tuple[str, str]] = {
    'admin': ('ADMIN_ID', 'ADMIN_PW'),
    'holdings': ('HOLDING_ID', 'HOLDING_PW'),
    'mobility': ('MOBILITY_ID', 'MOBILITY_PW'),
    'hmobility': ('HMOBILITY_ID', 'HMOBILITY_PW'),
    'guest': ('GUEST_ID', 'GUEST_PW'),
}

ALLOW = 'allow'
DENY = 'deny'

# 역할 × 라우트 기대표 — **정본은 `lib/auth/permissions.ts` 가 아니라 여기다.**
# 🔴 permissions.ts 를 import 해 기대값을 만들면 「구현이 곧 정답」이 되어 검사기가
#    규칙 변경을 영원히 통과시킨다. 그래서 사람이 읽는 규약(AGENTS.md §역할)을 손으로 옮겼고,
#    한쪽이 바뀌면 여기서 실패가 나야 한다.
EXPECTED: dict[str, dict[str, str]] = {
    # 공개 표 — 다섯 역할 전부 열린다
    '/related-stocks': {r: ALLOW for r in ROLE_ENV},
    '/domestic': {r: ALLOW for r in ROLE_ENV},
    '/oem': {r: ALLOW for r in ROLE_ENV},
    '/parts-top100': {r: ALLOW for r in ROLE_ENV},
    '/etc': {r: ALLOW for r in ROLE_ENV},
    '/reports': {r: ALLOW for r in ROLE_ENV},
    # 비교 — guest 만 차단
    '/compare': {'admin': ALLOW, 'holdings': ALLOW, 'mobility': ALLOW,
                 'hmobility': ALLOW, 'guest': DENY},
    # 한세그룹 — holdings(+admin) 만
    '/hansae': {'admin': ALLOW, 'holdings': ALLOW, 'mobility': DENY,
                'hmobility': DENY, 'guest': DENY},
    # 경영관리 손익 — 현장(hmobility)·게스트 차단
    '/management/pnl': {'admin': ALLOW, 'holdings': ALLOW, 'mobility': ALLOW,
                        'hmobility': DENY, 'guest': DENY},
    # 경영관리 재고 — 현장은 여기만 열린다
    '/management/inventory': {'admin': ALLOW, 'holdings': ALLOW, 'mobility': ALLOW,
                              'hmobility': ALLOW, 'guest': DENY},
    # 조직도 — 사외비 계열. 현장·게스트 차단
    '/management/org-chart': {'admin': ALLOW, 'holdings': ALLOW, 'mobility': ALLOW,
                              'hmobility': DENY, 'guest': DENY},
    # 회사관리·업로드 — admin 전용
    '/management/companies': {'admin': ALLOW, 'holdings': DENY, 'mobility': DENY,
                              'hmobility': DENY, 'guest': DENY},
    '/management/upload': {'admin': ALLOW, 'holdings': DENY, 'mobility': DENY,
                           'hmobility': DENY, 'guest': DENY},
}

# 🔴 프로젝트 «밖» 이 기본값이다(위 docstring 참조). 폴더는 실행할 때 만든다 —
#    import 만 해도 폴더가 생기면 의도치 않은 자리에 흔적이 남는다.
_DEFAULT_OUT = Path(tempfile.gettempdir()) / 'stock_monitor_e2e'
REPORT_DIR = Path(os.environ.get('E2E_OUT_DIR') or _DEFAULT_OUT)

# 화면 실물 확인 — 「열렸다」와 「내용이 그려졌다」는 다르다.
#
# 🔴 모든 허용 칸에 **공통 바닥**(`_MIN_CHARS` + 표·그림 하나 이상)을 깐다. 라우트마다
#    선택자를 적는 방식만 쓰면 «적지 않은 라우트» 는 영영 안 재게 된다 — 오늘 실제로
#    `/management/companies` · `/management/upload` 가 그 구멍으로 무검사 통과했다.
# ⚠️ 라우트별 선택자는 **표인지 그림인지가 갈리는 곳만** 적는다. 2026-09-09 실측에서
#    `/compare` · `/management/inventory` · `/management/org-chart` 는 표가 아니라
#    차트(svg)로 그리는 화면이었다 — 전부 `table` 로 기대했다가 오탐 6건이 났다.
_MIN_CHARS = 200
CONTENT: dict[str, str] = {
    '/related-stocks': 'table',
    '/domestic': 'table',
    '/oem': 'table',
    '/parts-top100': 'table',
    '/etc': 'table',
    '/reports': 'table',
    '/hansae': 'table',
    '/management/pnl': 'table',
    '/compare': 'svg',
    '/management/inventory': 'svg',
    '/management/org-chart': 'svg',
}


def _assertMatrixIsBidirectional() -> None:
    """기대표가 «양쪽» 을 재는지 — 빌드 시점에 못 박는다.

    🔴 이 단언이 이 파일의 핵심이다. 차단 칸이 하나도 없는 표는 admin 만으로도 전부
    초록이 되고, 그러면 검사기는 **실패할 수 없다.** 반대로 허용 칸이 없으면
    「다 막혔다」를 정상으로 보고한다. 둘 다 있어야 검사기가 성립한다.
    """
    flat = [v for row in EXPECTED.values() for v in row.values()]
    if ALLOW not in flat:
        raise SystemExit('기대표에 허용 칸이 없다 — 「열려야 할 때 열리는가」를 못 잰다')
    if DENY not in flat:
        raise SystemExit('기대표에 차단 칸이 없다 — 「막혀야 할 때 막히는가」를 못 잰다')
    for route, row in EXPECTED.items():
        missing = set(ROLE_ENV) - set(row)
        if missing:
            raise SystemExit(f'{route}: 역할 {sorted(missing)} 의 기대값이 비었다')


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


def login(page, user: str, pw: str) -> None:
    page.goto(f'{BASE}/login', wait_until='networkidle', timeout=30000)
    page.fill('input[name="id"]', user)
    page.fill('input[name="password"]', pw)
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle', timeout=30000)
    # 🔴 고정 대기가 필요하다. 로그인 리다이렉트 체인(`/login`→`/`→`/management`→탭)은
    #    전부 200(RSC client redirect)이라 `networkidle` 뒤에도 아직 진행 중이다.
    #    바로 다음 `goto` 를 하면 세션 쿠키가 붙기 전이라 로그인 폼이 돌아온다
    #    (`docs/gotchas-playwright-ui.md` §보호 라우트 UI Playwright 검증).
    page.wait_for_timeout(2500)


def landedElsewhere(page, route: str) -> bool:
    """요청한 경로에서 «쫓겨났는가» — 차단 판정 전용.

    ⚠️ 로그인 판정과 달리 여기서는 주소를 봐도 된다. 권한 차단은 `proxy.ts` 가 내는
    **서버 리다이렉트(307)** 라서 `networkidle` 시점엔 이미 끝나 있다. 로그인 직후의
    RSC 클라이언트 리다이렉트와는 성질이 다르다 — 그래서 판정 방법도 다르다.

    🔴 **하위 경로로 내려간 것은 쫓겨난 것이 아니다**(2026-09-09 실측). `/etc` 는 설계상
    `/etc/fx`(환율 탭)로 자동 이동한다 — 정확히 일치만 보면 이 정상 이동이 다섯 역할
    전부에서 「차단」으로 찍힌다. 차단은 항상 `/` 나 역할별 랜딩으로 나가므로 하위 경로가
    될 수 없고, 그래서 접두 비교로 둘을 정확히 가를 수 있다.
    """
    path = page.url.split(BASE, 1)[-1].split('?', 1)[0].rstrip('/') or '/'
    want = route.rstrip('/')
    return not (path == want or path.startswith(f'{want}/'))


def contentComplaint(page, route: str) -> str | None:
    """열린 화면에 «내용이 있는가» — 없으면 사유를 돌려준다(없으면 None).

    셸만 200 으로 오고 본문이 비어도 「열렸다」로 보이는 것을 막는 자리다.
    """
    body = (page.inner_text('body') or '').strip()
    if len(body) < _MIN_CHARS:
        return f'열리긴 했는데 글자가 {len(body)}자뿐이다(최소 {_MIN_CHARS}) — 셸만 온 것으로 본다'
    if not page.query_selector_all('table, svg, canvas'):
        return '열리긴 했는데 표도 그림도 없다'
    sel = CONTENT.get(route)
    if sel and page.query_selector(sel) is None:
        return f'열리긴 했는데 이 화면의 본문(`{sel}`)이 없다'
    return None


def slugify(role: str, path: str) -> str:
    return f"{role}__{path.strip('/').replace('/', '_') or 'root'}"


def checkRoute(page, role: str, route: str, expected: str, shoot: bool, _retry: bool = True) -> dict:
    """한 역할이 한 라우트에 갔을 때 기대대로인지 본다.

    ⚠️ **시간 초과는 한 번 다시 해 본다**(2026-09-09 실측). dev 서버는 그 화면을 «처음»
    열 때 Turbopack 이 컴파일을 하느라 30초를 넘길 수 있다. 실제로 65칸 중
    `admin//management/org-chart` 한 칸만 시간 초과로 빨개졌고, 곧바로 다시 돌리니
    13/13 통과였다 — 화면 문제가 아니라 **환경 문제**다.
    🔴 시간 초과«만» 다시 한다. 다른 실패(차단 오판·본문 없음)를 재시도하면
    간헐적으로 통과해 진짜 결함을 숨긴다.
    """
    consoleErrors: list[str] = []
    failedRequests: list[str] = []

    def onConsole(msg: ConsoleMessage) -> None:
        if msg.type in ('error', 'warning'):
            consoleErrors.append(f'[{msg.type}] {msg.text[:200]}')

    def onRequestFailed(req: Request) -> None:
        # 외부 분석 도구(GA 등) 실패는 무시. localhost/relative만.
        if BASE in req.url or req.url.startswith('/'):
            failedRequests.append(f'{req.method} {req.url} — {req.failure}')

    page.on('console', onConsole)
    page.on('requestfailed', onRequestFailed)

    httpStatus: int | None = None
    actual = '?'
    err: str | None = None
    try:
        resp = page.goto(f'{BASE}{route}', wait_until='domcontentloaded', timeout=30000)
        httpStatus = resp.status if resp else None
        page.wait_for_load_state('networkidle', timeout=30000)
        page.wait_for_timeout(1500)          # 차트·표 마운트 안정화

        if looksLoggedOut(page):
            # 세션이 끊긴 것이지 권한 차단이 아니다 — 둘을 섞으면 오진한다.
            actual = 'logged_out'
            err = '로그인 폼이 돌아왔다 — 세션이 끊겼다(HTTP 는 200)'
        elif landedElsewhere(page, route):
            actual = DENY
        else:
            actual = ALLOW
            err = contentComplaint(page, route)
        if shoot:
            page.screenshot(path=str(REPORT_DIR / f'{slugify(role, route)}.png'),
                            full_page=False)
    except Exception as e:                   # noqa: BLE001 — 무엇이 터졌든 한 칸의 실패다
        actual = 'error'
        err = str(e)[:300]

    page.remove_listener('console', onConsole)
    page.remove_listener('requestfailed', onRequestFailed)

    if _retry and actual == 'error' and 'Timeout' in (err or ''):
        # 첫 컴파일이 느렸을 뿐일 수 있다 — 딱 한 번만 다시 본다(위 docstring 참조).
        print(f'  [재시도] {route} — 시간 초과, 한 번 다시 본다')
        return checkRoute(page, role, route, expected, shoot, _retry=False)

    ok = actual == expected and err is None
    return {
        'role': role, 'route': route, 'expected': expected, 'actual': actual,
        'ok': ok, 'http_status': httpStatus, 'error': err,
        'console_errors': consoleErrors[:10], 'failed_requests': failedRequests[:5],
    }


def runRole(browser, role: str, shoot: bool) -> list[dict]:
    idKey, pwKey = ROLE_ENV[role]
    user, pw = os.environ.get(idKey), os.environ.get(pwKey)
    if not user or not pw:
        # 🔴 조용히 건너뛰지 않는다. 건너뛰면 「계정이 없어서 안 쟀다」가 「통과」로 보인다.
        return [{'role': role, 'route': '(login)', 'expected': 'login', 'actual': 'no_credentials',
                 'ok': False, 'http_status': None,
                 'error': f'{idKey}/{pwKey} 가 없다 — .env.local 을 확인할 것',
                 'console_errors': [], 'failed_requests': []}]

    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = context.new_page()
    rows: list[dict] = []
    try:
        login(page, user, pw)
        # 로그인 자체가 됐는지 먼저 본다 — 이 확인이 없으면 아래 칸들이 전부
        # 「로그인 폼」을 200 으로 받고 차단으로 오독된다.
        page.goto(f'{BASE}/related-stocks', wait_until='networkidle', timeout=30000)
        if looksLoggedOut(page):
            rows.append({'role': role, 'route': '(login)', 'expected': 'login',
                         'actual': 'logged_out', 'ok': False, 'http_status': None,
                         'error': '로그인 실패 — 계정·비밀번호 또는 주소를 확인할 것',
                         'console_errors': [], 'failed_requests': []})
            return rows
        print(f'  [OK] login as {role}')
        for route, row in EXPECTED.items():
            res = checkRoute(page, role, route, row[role], shoot)
            rows.append(res)
            mark = 'OK  ' if res['ok'] else 'FAIL'
            note = f" — {res['error']}" if res['error'] else ''
            print(f"  [{mark}] {route:<26} 기대={res['expected']:<5} 실제={res['actual']}{note}")
    finally:
        context.close()
    return rows


def selfTest(browser) -> int:
    """이 검사기가 «실패할 수 있는가» — 틀린 답을 일부러 넣어 확인한다.

    🔴 초록은 그 자체로 증거가 아니다. 2026-09-09 오전에 고친 결함이 바로 이것이었다 —
    아홉 라우트가 전부 `[OK]` 였는데 로그인이 통째로 실패해도 같은 결과가 나왔다.
    그래서 **틀린 입력을 넣으면 정말 빨개지는지**를 여기서 기계로 확인한다.
    """
    cases: list[tuple[str, bool]] = []

    # ① 차단돼야 할 칸을 「열려야 한다」고 우기면 실패해야 한다
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    try:
        login(page, os.environ.get('GUEST_ID', ''), os.environ.get('GUEST_PW', ''))
        r = checkRoute(page, 'guest', '/management/pnl', ALLOW, shoot=False)
        cases.append(('차단되는 칸을 허용으로 우기면 실패한다', not r['ok']))
        # ② 반대 방향 — 열리는 칸을 「막혀야 한다」고 우겨도 실패해야 한다
        r = checkRoute(page, 'guest', '/related-stocks', DENY, shoot=False)
        cases.append(('열리는 칸을 차단으로 우기면 실패한다', not r['ok']))
        # ③ 정상 칸은 통과해야 한다(모두 실패시키는 검사기도 고장이다)
        r = checkRoute(page, 'guest', '/related-stocks', ALLOW, shoot=False)
        cases.append(('정상인 칸은 통과한다', r['ok']))
    finally:
        ctx.close()

    # ④ 틀린 비밀번호면 로그인 실패를 잡아야 한다
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    try:
        login(page, os.environ.get('GUEST_ID', ''), 'wrong-password-on-purpose')
        page.goto(f'{BASE}/related-stocks', wait_until='networkidle', timeout=30000)
        cases.append(('틀린 비밀번호는 로그인 실패로 잡힌다', looksLoggedOut(page)))
    finally:
        ctx.close()

    bad = [name for name, ok in cases if not ok]
    for name, ok in cases:
        print(f"  [{'OK  ' if ok else 'FAIL'}] {name}")
    print(f'자기시험 {len(cases) - len(bad)}/{len(cases)}')
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--role', choices=sorted(ROLE_ENV), help='이 역할만 검사')
    ap.add_argument('--matrix-only', action='store_true', help='스크린샷 생략')
    ap.add_argument('--self-test', action='store_true',
                    help='검사기가 실패할 수 있는지만 확인하고 끝낸다')
    args = ap.parse_args()

    if args.self_test:
        _assertMatrixIsBidirectional()
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                return selfTest(browser)
            finally:
                browser.close()

    _assertMatrixIsBidirectional()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    roles = [args.role] if args.role else list(ROLE_ENV)
    print(f'[정보] 대상 {BASE} · 역할 {roles} · 산출물 {REPORT_DIR}')

    summary: list[dict] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            for role in roles:
                print(f'\n== {role} ==')
                summary += runRole(browser, role, shoot=not args.matrix_only)
        finally:
            browser.close()

    # 🔴 리포트도 프로젝트 밖이다 — 옛 코드는 `scripts/` 에 써서 Turbopack 재컴파일을 유발했다.
    out = REPORT_DIR / '_e2e_smoke_report.json'
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

    fails = [r for r in summary if not r['ok']]
    nAllow = sum(1 for r in summary if r['expected'] == ALLOW)
    nDeny = sum(1 for r in summary if r['expected'] == DENY)
    print(f'\n총 {len(summary)}칸 (열려야 {nAllow} · 막혀야 {nDeny}) · 실패 {len(fails)}')
    for r in fails:
        print(f"  FAIL {r['role']}/{r['route']}: 기대={r['expected']} 실제={r['actual']} {r['error'] or ''}")
    print(f'→ report saved: {out}')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
