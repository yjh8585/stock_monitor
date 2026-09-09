"""표 화면의 «조작» 검증 — 필터·정렬·팝업이 실제로 동작하는가.

사용: scripts/venv/Scripts/python.exe scripts/e2e_interact.py
      scripts/venv/Scripts/python.exe scripts/e2e_interact.py --self-test
      scripts/venv/Scripts/python.exe scripts/e2e_interact.py --route /oem
      exit 0 = 정상 · exit 1 = 실패

🔴 **`e2e_smoke.py` 와 재는 것이 다르다.** 그쪽은 「화면이 열리고 그려지는가」까지다.
여기는 **누르면 무엇이 달라지는가** 를 잰다 — 열리기만 하고 필터가 죽어 있어도
smoke 는 전부 초록이다(실제로 그 구멍이 있었다).

🔴 **모든 시험을 양방향으로 쓴다.** 「필터를 끄니 줄었다」만 재면, 아무 때나 0행을 내는
고장도 통과한다. 그래서 ①끄면 줄고 ②켜면 돌아오고 ③남은 것이 실제로 조건에 맞는지
셋을 함께 본다. 정렬도 마찬가지 — 「순서가 바뀌었다」가 아니라 «값이 실제로 정렬돼
있는가» 를 잰다.

🔴 **화면마다 사양(`SCREENS`)을 «따로» 둔다.** 2026-09-09 에 네 화면을 실물로 재 보니
서로 딴판이었다 — `/oem` 은 **정렬 머리글이 0개이고 팝업도 없다**, `/parts-top100` 은
구분 필터가 「국가」이고 `/domestic` 은 「그룹」이다. 한 화면 스크립트를 그대로 돌렸으면
버튼을 못 찾아 **조용히 0건**이 됐을 것이다. 새 화면을 더할 때도 실물을 먼저 재고 적는다.
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

# 화면별 사양 — 전부 2026-09-09 에 실물로 재서 적었다(위 docstring 참조).
#   filters   : 껐다 켰다 하며 행 수 변화를 볼 버튼 이름
#   sort      : 누르면 정렬되는 머리글(없으면 None)
#   popup     : 뉴스 팝업 단추가 있는가
#   typeCol   : 「구분」 열 번호와 끄면 사라져야 할 값(있는 화면만)
SCREENS: list[dict] = [
    {'route': '/related-stocks', 'filters': ['OEM', '비상장'], 'sort': "'25 매출",
     'popup': True, 'typeCol': 0, 'typeOff': 'OEM'},
    {'route': '/domestic', 'filters': ['비상장'], 'sort': "'25 매출",
     'popup': True, 'typeCol': None, 'typeOff': None},
    {'route': '/parts-top100', 'filters': ['비상장'], 'sort': "'25 매출",
     'popup': True, 'typeCol': None, 'typeOff': None},
    # ⚠️ `/oem` 은 «정렬 머리글 0개 · 팝업 0개» 다. 게다가 「연간·월간」은 필터가 아니라
    #    차트의 «기간 전환 탭»(`role="tab"`)이라 **행 수가 안 변한다**(80 → 80).
    #    필터로 알고 걸었다가 2건이 빨개졌다 — 바뀌는 것은 «막대 개수»(951 ↔ 944)와
    #    선택된 탭이다. 그래서 이 화면만 다른 방식(`tabs`)으로 잰다.
    {'route': '/oem', 'filters': [], 'sort': None, 'popup': False,
     'typeCol': None, 'typeOff': None, 'tabs': ['월간', '연간']},
]


def _assertScreensMeasureSomething() -> None:
    """사양마다 «잴 것이 하나라도» 있는지 — 실행 «전에» 못 박는다.

    🔴 필터·탭·정렬·팝업이 전부 비어 있으면 그 화면은 「표에 행이 있다」 한 줄만 재고
    초록으로 끝난다. 화면을 추가하다 사양을 덜 적으면 **검사한 척** 이 되는 자리다.
    """
    for spec in SCREENS:
        if not (spec['filters'] or spec.get('tabs') or spec['sort'] or spec['popup']):
            raise SystemExit(f"{spec['route']}: 잴 조작이 하나도 없다 — 사양을 채울 것")


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


def colTexts(page, idx: int) -> list[str]:
    """한 열의 글자들 — 열 번호가 행 칸 수를 넘으면 빈 문자열."""
    out = []
    for tr in page.query_selector_all('tbody tr'):
        tds = tr.query_selector_all('td')
        out.append((tds[idx].inner_text() or '').strip() if idx < len(tds) else '')
    return out


def rowCount(page) -> int:
    return len(page.query_selector_all('tbody tr'))


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
    """본문 글자가 정확히 `label` 인 버튼을 누른다.

    🔴 «정확히» 같아야 한다. 부분일치로 하면 `/domestic` 의 「상장」이
    「비상장」에도 걸려 엉뚱한 버튼을 누른다(그러고도 행 수는 변해서 통과한다).
    """
    for btn in page.query_selector_all('button'):
        if (btn.inner_text() or '').strip() == label:
            btn.click()
            page.wait_for_timeout(500)
            return
    raise RuntimeError(f'버튼 「{label}」 을 못 찾았다')


def checkFilters(page, spec: dict, nAll: int) -> list[tuple[str, bool, str]]:
    """필터를 껐다 켜며 «양방향» 으로 본다.

    🔴 「끄면 줄어든다」만 재면 아무 때나 0행을 내는 고장도 통과한다.
    반드시 «켜면 돌아오는지» 를 함께 잰다.
    """
    cases: list[tuple[str, bool, str]] = []
    for label in spec['filters']:
        clickButton(page, label)
        off = rowCount(page)
        cases.append((f'「{label}」 을 끄면 행 수가 달라진다',
                      off != nAll, f'{nAll} → {off}행'))

        # 「구분」 열이 있는 화면은 «남은 행이 실제로 조건에 맞는지» 까지 본다.
        if spec['typeOff'] and label == spec['typeOff'] and spec['typeCol'] is not None:
            left = colTexts(page, spec['typeCol'])
            n = sum(1 for t in left if t == spec['typeOff'])
            cases.append((f'끈 뒤 남은 행에 「{spec["typeOff"]}」 이 없다',
                          n == 0, f'남은 {n}건'))

        clickButton(page, label)
        back = rowCount(page)
        cases.append((f'「{label}」 을 다시 켜면 원래대로 돌아온다',
                      back == nAll, f'{back} vs 처음 {nAll}'))
    return cases


def checkTabs(page, spec: dict) -> list[tuple[str, bool, str]]:
    """차트의 기간 전환 탭 — 표가 아니라 «그림» 이 달라지는 자리다.

    🔴 행 수로 재면 안 된다. 이 탭은 행을 거르지 않고 차트가 그리는 «기간» 을 바꾼다
    (`/oem` 에서 80행 그대로였다). 바뀌는 것은 **선택된 탭**과 **막대 개수**다.
    """
    cases: list[tuple[str, bool, str]] = []

    def selected() -> list[str]:
        return [(b.inner_text() or '').strip()
                for b in page.query_selector_all('[role="tab"][aria-selected="true"]')]

    def bars() -> int:
        return len(page.query_selector_all('.recharts-bar-rectangle'))

    before = bars()
    cases.append(('차트에 막대가 있다(없으면 아래 시험이 무의미하다)',
                  before > 0, f'{before}개'))
    if before == 0:
        return cases

    for label in spec['tabs']:
        clickButton(page, label)
        page.wait_for_timeout(1200)
        cases.append((f'「{label}」 을 누르면 그 탭이 선택된다',
                      label in selected(), f'선택 {selected()}'))
        after = bars()
        cases.append((f'「{label}」 로 바꾸면 차트가 다시 그려진다',
                      after > 0 and after != before, f'막대 {before} → {after}개'))
        before = after
    return cases


def checkSort(page, spec: dict, nAll: int) -> list[tuple[str, bool, str]]:
    """정렬 — 「순서가 바뀌었다」가 아니라 «값이 실제로 정렬돼 있는가» 를 잰다."""
    cases: list[tuple[str, bool, str]] = []
    header = spec['sort']
    idx = headerIndex(page, header)

    clickButton(page, header)
    desc = colValues(page, idx)
    cases.append((f'「{header}」 을 누르면 내림차순이 된다',
                  len(desc) >= 2 and isDescending(desc),
                  f'{len(desc)}개 · {desc[:2]} … {desc[-2:]}' if desc else '값 없음'))
    cases.append(('정렬해도 행 수는 그대로다(정렬이 자료를 잃지 않는다)',
                  rowCount(page) == nAll, f'{rowCount(page)} vs {nAll}'))

    clickButton(page, header)
    asc = colValues(page, idx)
    cases.append(('한 번 더 누르면 오름차순으로 뒤집힌다',
                  len(asc) >= 2 and isAscending(asc),
                  f'{asc[:2]} … {asc[-2:]}' if asc else '값 없음'))
    cases.append(('두 방향이 실제로 다르다(누르기만 하고 안 바뀌면 안 된다)',
                  desc != asc, ''))
    return cases


def checkPopup(page, route: str) -> list[tuple[str, bool, str]]:
    """팝업 — 뜨는 것과 «닫히는 것» 을 함께 잰다."""
    cases: list[tuple[str, bool, str]] = []
    page.goto(f'{BASE}{route}', wait_until='networkidle', timeout=60000)
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


def runScreen(page, spec: dict) -> list[tuple[str, bool, str]]:
    """한 화면의 조작을 전부 본다 — 사양에 «있다고 적힌 것만»."""
    route = spec['route']
    cases: list[tuple[str, bool, str]] = []

    page.goto(f'{BASE}{route}', wait_until='networkidle', timeout=60000)
    page.wait_for_timeout(2500)

    nAll = rowCount(page)
    cases.append(('표에 행이 있다(없으면 아래 시험이 전부 무의미하다)',
                  nAll > 0, f'{nAll}행'))
    if nAll == 0:
        return cases

    if spec['filters']:
        cases += checkFilters(page, spec, nAll)
    if spec.get('tabs'):
        cases += checkTabs(page, spec)
    if spec['sort']:
        cases += checkSort(page, spec, nAll)
    if spec['popup']:
        cases += checkPopup(page, route)
    return cases


def runChecks(page, screens: list[dict] | None = None) -> list[tuple[str, bool, str]]:
    """모든 화면 — (시험 이름, 통과, 메모) 목록. 이름 앞에 화면 경로를 붙인다."""
    out: list[tuple[str, bool, str]] = []
    for spec in (screens if screens is not None else SCREENS):
        for name, ok, note in runScreen(page, spec):
            out.append((f"{spec['route']} · {name}", ok, note))
    return out


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
    ap.add_argument('--route', help='이 화면만 검사(예: /oem)')
    args = ap.parse_args()
    _assertScreensMeasureSomething()
    if args.self_test:
        return selfTest()

    if not USER or not PASS:
        print('[FAIL] ADMIN_ID / ADMIN_PW 가 없다 — .env.local 을 확인할 것')
        return 1

    screens = SCREENS
    if args.route:
        screens = [s for s in SCREENS if s['route'] == args.route]
        if not screens:
            # 🔴 조용히 0건으로 끝내지 않는다 — 「통과」로 보이면 안 된다.
            print(f'[FAIL] 「{args.route}」 사양이 없다. 있는 것: '
                  f'{[s["route"] for s in SCREENS]}')
            return 1

    print(f"[정보] 대상 {BASE} · 화면 {[s['route'] for s in screens]}")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={'width': 1600, 'height': 1000})
        page = ctx.new_page()
        try:
            login(page)
            cases = runChecks(page, screens)
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
