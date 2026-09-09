"""관련주식 표의 «조작» 검증 — 필터·정렬·팝업이 실제로 동작하는가.

사용: scripts/venv/Scripts/python.exe scripts/e2e_interact.py
      scripts/venv/Scripts/python.exe scripts/e2e_interact.py --self-test
      exit 0 = 정상 · exit 1 = 실패

🔴 **`e2e_smoke.py` 와 재는 것이 다르다.** 그쪽은 「화면이 열리고 그려지는가」까지다.
여기는 **누르면 무엇이 달라지는가** 를 잰다 — 열리기만 하고 필터가 죽어 있어도
smoke 는 전부 초록이다(실제로 그 구멍이 있었다).

🔴 **모든 시험을 양방향으로 쓴다.** 「필터를 끄니 줄었다」만 재면, 아무 때나 0행을 내는
고장도 통과한다. 그래서 ①끄면 줄고 ②켜면 돌아오고 ③남은 것이 실제로 조건에 맞는지
셋을 함께 본다. 정렬도 마찬가지 — 「순서가 바뀌었다」가 아니라 «값이 실제로 정렬돼
있는가» 를 잰다.

⚠️ 이 화면은 `/related-stocks` 하나만 다룬다. 다른 표로 넓힐 때는 열 위치·필터 이름이
다르므로 그 화면의 실물을 먼저 재고 상수를 따로 둘 것(짐작으로 복사하면 조용히 0건이 된다).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(Path(__file__).parent / '.env')
load_dotenv(ROOT / '.env.local')

from playwright.sync_api import sync_playwright  # noqa: E402

BASE = os.environ.get('E2E_BASE_URL', 'http://localhost:3001')
USER = os.environ.get('ADMIN_ID')
PASS = os.environ.get('ADMIN_PW')

ROUTE = '/related-stocks'
COL_TYPE = 0          # 구분 (OEM / 부품사)
SORT_HEADER = "'25 매출"


def parseNum(text: str) -> float | None:
    """표 칸의 글자에서 숫자를 뽑는다 — 쉼표·단위·부호를 견딘다.

    ⚠️ 숫자가 없으면 `0` 이 아니라 `None` 이다. 빈 칸을 0으로 읽으면 정렬 시험이
    「맨 아래가 0이니 내림차순 맞다」로 **틀린 채 통과**한다.
    """
    t = (text or '').replace(',', '').strip()
    m = re.search(r'-?\d+(?:\.\d+)?', t)
    return float(m.group()) if m else None


def isDescending(vals: list[float]) -> bool:
    return all(a >= b for a, b in zip(vals, vals[1:]))


def isAscending(vals: list[float]) -> bool:
    return all(a <= b for a, b in zip(vals, vals[1:]))


def rowTypes(page) -> list[str]:
    """각 행의 「구분」 칸 글자."""
    out = []
    for tr in page.query_selector_all('tbody tr'):
        tds = tr.query_selector_all('td')
        out.append((tds[COL_TYPE].inner_text() or '').strip() if tds else '')
    return out


def colValues(page, idx: int) -> list[float]:
    """한 열의 숫자들 — 빈 칸은 «버린다»(0으로 바꾸지 않는다. 위 parseNum 참조)."""
    vals: list[float] = []
    for tr in page.query_selector_all('tbody tr'):
        tds = tr.query_selector_all('td')
        if idx < len(tds):
            v = parseNum(tds[idx].inner_text())
            if v is not None:
                vals.append(v)
    return vals


def headerIndex(page, label: str) -> int:
    for i, th in enumerate(page.query_selector_all('th')):
        if label in (th.inner_text() or ''):
            return i
    raise RuntimeError(f'머리글 「{label}」 을 못 찾았다 — 열 구성이 바뀌었는지 볼 것')


def login(page) -> None:
    page.goto(f'{BASE}/login', wait_until='networkidle', timeout=60000)
    page.fill('input[name="id"]', USER)
    page.fill('input[name="password"]', PASS)
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle', timeout=60000)
    # 로그인 리다이렉트 체인은 networkidle 뒤에도 진행 중이다(gotchas-playwright-ui.md).
    page.wait_for_timeout(2500)


def clickButton(page, label: str) -> None:
    """본문 글자가 정확히 `label` 인 버튼을 누른다."""
    for btn in page.query_selector_all('button'):
        if (btn.inner_text() or '').strip() == label:
            btn.click()
            page.wait_for_timeout(400)
            return
    raise RuntimeError(f'버튼 「{label}」 을 못 찾았다')


def runChecks(page) -> list[tuple[str, bool, str]]:
    """(시험 이름, 통과, 메모) 목록."""
    cases: list[tuple[str, bool, str]] = []

    page.goto(f'{BASE}{ROUTE}', wait_until='networkidle', timeout=60000)
    page.wait_for_timeout(2500)

    baseTypes = rowTypes(page)
    nAll = len(baseTypes)
    nOem = sum(1 for t in baseTypes if t == 'OEM')
    nPart = nAll - nOem
    cases.append(('표에 행이 있다(없으면 아래 시험이 전부 무의미하다)',
                  nAll > 0, f'{nAll}행 · OEM {nOem} · 부품사 {nPart}'))
    if nAll == 0:
        return cases
    cases.append(('두 구분이 모두 있다(한쪽만이면 필터 시험이 성립 안 한다)',
                  nOem > 0 and nPart > 0, f'OEM {nOem} · 부품사 {nPart}'))

    # ── 필터 ────────────────────────────────────────────────────────────────
    clickButton(page, 'OEM')                       # OEM 끄기
    afterOff = rowTypes(page)
    cases.append(('OEM 을 끄면 행이 줄어든다',
                  len(afterOff) < nAll, f'{nAll} → {len(afterOff)}행'))
    cases.append(('끈 뒤 남은 행에 OEM 이 하나도 없다',
                  all(t != 'OEM' for t in afterOff),
                  f"남은 OEM {sum(1 for t in afterOff if t == 'OEM')}건"))
    cases.append(('부품사는 그대로 남아 있다',
                  len(afterOff) == nPart, f'{len(afterOff)} vs 부품사 {nPart}'))

    clickButton(page, 'OEM')                       # 다시 켜기
    restored = rowTypes(page)
    # 🔴 반대 방향 — 켜면 «돌아와야» 한다. 이게 없으면 「항상 줄이는 고장」도 통과한다.
    cases.append(('OEM 을 다시 켜면 원래대로 돌아온다',
                  len(restored) == nAll, f'{len(restored)} vs 처음 {nAll}'))

    clickButton(page, '비상장')                     # 비상장 끄기
    afterListing = rowTypes(page)
    cases.append(('다른 필터(비상장)도 행 수를 바꾼다',
                  len(afterListing) != nAll, f'{nAll} → {len(afterListing)}행'))
    clickButton(page, '비상장')
    cases.append(('비상장을 다시 켜면 원래대로 돌아온다',
                  len(rowTypes(page)) == nAll, ''))

    # ── 정렬 ────────────────────────────────────────────────────────────────
    idx = headerIndex(page, SORT_HEADER)
    clickButton(page, SORT_HEADER)
    desc = colValues(page, idx)
    cases.append(('매출 머리글을 누르면 내림차순이 된다',
                  len(desc) >= 2 and isDescending(desc),
                  f'{len(desc)}개 · 처음 {desc[:2]} … 끝 {desc[-2:]}' if desc else '값 없음'))
    cases.append(('정렬해도 행 수는 그대로다(정렬이 자료를 잃지 않는다)',
                  len(rowTypes(page)) == nAll, f'{len(rowTypes(page))} vs {nAll}'))

    clickButton(page, SORT_HEADER)                 # 한 번 더 → 뒤집힘
    asc = colValues(page, idx)
    cases.append(('한 번 더 누르면 오름차순으로 뒤집힌다',
                  len(asc) >= 2 and isAscending(asc),
                  f'처음 {asc[:2]} … 끝 {asc[-2:]}' if asc else '값 없음'))
    cases.append(('두 방향이 실제로 다르다(누르기만 하고 안 바뀌면 안 된다)',
                  desc != asc, ''))

    # ── 팝업 ────────────────────────────────────────────────────────────────
    page.goto(f'{BASE}{ROUTE}', wait_until='networkidle', timeout=60000)
    page.wait_for_timeout(2000)
    cases.append(('열기 전에는 팝업이 없다',
                  page.query_selector('[role="dialog"]') is None, ''))
    trigger = page.query_selector('[title="뉴스 보기"]')
    if trigger is None:
        cases.append(('뉴스 팝업 단추가 있다', False, '못 찾았다'))
        return cases
    trigger.click()
    page.wait_for_timeout(2500)
    dlg = page.query_selector('[role="dialog"]')
    cases.append(('단추를 누르면 팝업이 뜬다', dlg is not None, ''))
    if dlg is not None:
        body = (dlg.inner_text() or '').strip()
        cases.append(('팝업에 내용이 있다(빈 껍데기가 아니다)',
                      len(body) > 5, f'{len(body)}자'))
        page.keyboard.press('Escape')
        page.wait_for_timeout(1200)
        # 🔴 반대 방향 — 닫히는지도 잰다. 안 닫히면 다음 조작이 전부 막힌다.
        cases.append(('Esc 를 누르면 팝업이 닫힌다',
                      page.query_selector('[role="dialog"]') is None, ''))
    return cases


def selfTest() -> int:
    """판정 함수들이 «틀린 입력을 실제로 거르는가» — 브라우저 없이 잰다."""
    cases = [
        ('내림차순을 내림차순이라 한다', isDescending([3.0, 2.0, 2.0, 1.0])),
        ('오름차순을 내림차순이라 하지 않는다', not isDescending([1.0, 2.0])),
        ('오름차순을 오름차순이라 한다', isAscending([1.0, 2.0, 2.0])),
        ('내림차순을 오름차순이라 하지 않는다', not isAscending([2.0, 1.0])),
        ('쉼표가 든 숫자를 읽는다', parseNum('12,345') == 12345.0),
        ('음수를 읽는다', parseNum('-3.5%') == -3.5),
        ('숫자가 없으면 None 이다(0 이 아니다)', parseNum('—') is None),
    ]
    bad = [n for n, ok in cases if not ok]
    for n, ok in cases:
        print(f"  [{'OK  ' if ok else 'FAIL'}] {n}")
    print(f'자기시험 {len(cases) - len(bad)}/{len(cases)}')
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true')
    ap.add_argument('--headed', action='store_true', help='브라우저를 보이게(진단용)')
    args = ap.parse_args()
    if args.self_test:
        return selfTest()

    if not USER or not PASS:
        print('[FAIL] ADMIN_ID / ADMIN_PW 가 없다 — .env.local 을 확인할 것')
        return 1

    print(f'[정보] 대상 {BASE}{ROUTE}')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={'width': 1600, 'height': 1000})
        page = ctx.new_page()
        try:
            login(page)
            cases = runChecks(page)
        finally:
            ctx.close()
            browser.close()

    for name, ok, note in cases:
        tail = f' — {note}' if note else ''
        print(f"  [{'OK  ' if ok else 'FAIL'}] {name}{tail}")
    bad = [c for c in cases if not c[1]]
    print(f'\n{len(cases)}건 중 실패 {len(bad)}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
