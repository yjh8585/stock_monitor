"""모든 보호 라우트 E2E smoke test — 로그인 자동화 + 콘솔/네트워크 에러 캡처.

사용: python scripts/_e2e_smoke.py
환경변수: MOBILITY_ID, MOBILITY_PW (.env.local)
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from playwright.sync_api import sync_playwright, ConsoleMessage, Request

BASE = os.environ.get('E2E_BASE_URL', 'http://localhost:3000')
USER = os.environ.get('MOBILITY_ID') or 'hansaemobility'
PASS = os.environ.get('MOBILITY_PW') or '1234!'

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

REPORT_DIR = Path(__file__).parent.parent / 'data' / '_e2e_screenshots'
REPORT_DIR.mkdir(parents=True, exist_ok=True)


def login(page) -> None:
    page.goto(f'{BASE}/login', wait_until='networkidle', timeout=30000)
    page.fill('input[name="id"]', USER)
    page.fill('input[name="password"]', PASS)
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle', timeout=30000)


def slugify(path: str) -> str:
    return path.strip('/').replace('/', '_') or 'root'


def main() -> int:
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
        print(f'[OK] login as {USER}, redirected to: {page.url}')

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

    out = Path('scripts/_e2e_smoke_report.json')
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n→ report saved: {out}')
    print(f'→ screenshots: {REPORT_DIR}')

    # 실패 1개라도 있으면 exit 1
    has_fail = any(r['status'] != 'ok' for r in summary)
    return 1 if has_fail else 0


if __name__ == '__main__':
    sys.exit(main())
